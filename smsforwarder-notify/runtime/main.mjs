import crypto from 'node:crypto'
import http from 'node:http'
import os from 'node:os'
import readline from 'node:readline'

const pluginId = process.env.CATRACE_PLUGIN_ID || 'smsforwarder-notify'

const MAX_BODY_BYTES = 64 * 1024
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 120
const MAX_DEDUPE = 500
const OTP_KEYWORD_RE = /验证码|校验码|动态码|verification code|security code|OTP/i
const OTP_CODE_RE = /(?<!\d)\d{4,8}(?!\d)/g

const DEFAULT_CONFIG = {
  enabled: true,
  host: '0.0.0.0',
  port: 17890,
  path: '/webhook',
  token: '',
  cardDurationSec: 10,
  dedupeWindowSec: 5,
  appBlacklist: [],
  hideSensitiveBody: false,
  enableOtpAction: true,
}

/** @type {typeof DEFAULT_CONFIG} */
let config = { ...DEFAULT_CONFIG, appBlacklist: [] }

/** @type {http.Server | null} */
let server = null
/** @type {{ host: string, port: number, path: string } | null} */
let listenMeta = null
let starting = false

/** @type {Map<string, number[]>} ip -> timestamps */
const rateMap = new Map()
/** @type {Map<string, number>} hash -> expireAt */
const dedupeMap = new Map()

let acceptedCount = 0
let rejectedCount = 0
let dedupedCount = 0
let lastSuccessAt = 0
let lastErrorSummary = ''
let lastErrorAt = 0
let lastClientIp = ''

const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`)
const log = (message, data, level = 'info') =>
  send({ v: 1, op: 'log', level, message, data })

function respond(requestId, ok, result, error) {
  const message = { v: 1, op: 'response', requestId, ok }
  if (ok) message.result = result ?? null
  else message.error = error || 'request failed'
  send(message)
}

function clampInt(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

function clampStr(value, max, fallback = '') {
  const s = value == null ? '' : String(value)
  if (!s) return fallback
  return s.length > max ? s.slice(0, max) : s
}

function normalizePath(raw) {
  let p = String(raw || '/webhook').trim() || '/webhook'
  if (!p.startsWith('/')) p = `/${p}`
  // strip trailing slash except root
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
  return p
}

function normalizeBlacklist(input) {
  if (Array.isArray(input)) {
    return input
      .map((v) => String(v || '').trim())
      .filter(Boolean)
      .slice(0, 200)
  }
  if (typeof input === 'string') {
    return input
      .split(/\r?\n|,/)
      .map((v) => v.trim())
      .filter(Boolean)
      .slice(0, 200)
  }
  return []
}

function normalizeConfig(input = {}) {
  const next = {
    enabled: input.enabled !== false,
    host:
      typeof input.host === 'string' && input.host.trim()
        ? input.host.trim()
        : config.host || DEFAULT_CONFIG.host,
    port: clampInt(input.port, 1024, 65535, config.port || DEFAULT_CONFIG.port),
    path: normalizePath(
      typeof input.path === 'string' ? input.path : config.path || DEFAULT_CONFIG.path,
    ),
    // empty string from host must not wipe existing / auto-generated token
    token:
      typeof input.token === 'string' && input.token.trim()
        ? input.token.trim()
        : config.token || '',
    cardDurationSec: clampInt(
      input.cardDurationSec,
      0,
      600,
      config.cardDurationSec ?? DEFAULT_CONFIG.cardDurationSec,
    ),
    dedupeWindowSec: clampInt(
      input.dedupeWindowSec,
      0,
      300,
      config.dedupeWindowSec ?? DEFAULT_CONFIG.dedupeWindowSec,
    ),
    appBlacklist:
      input.appBlacklist !== undefined
        ? normalizeBlacklist(input.appBlacklist)
        : [...(config.appBlacklist || [])],
    hideSensitiveBody: input.hideSensitiveBody === true,
    enableOtpAction: input.enableOtpAction !== false,
  }
  return next
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex')
}

function ensureToken() {
  if (!config.token || config.token.length < 16) {
    config.token = generateToken()
    log('generated webhook token', { length: config.token.length })
  }
}

function listIPv4() {
  const out = []
  const ifaces = os.networkInterfaces()
  for (const name of Object.keys(ifaces || {})) {
    for (const info of ifaces[name] || []) {
      if (!info || info.family !== 'IPv4' || info.internal) continue
      out.push({ name, address: info.address })
    }
  }
  return out
}

function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(String(a || ''), 'utf8')
  const bb = Buffer.from(String(b || ''), 'utf8')
  if (ba.length !== bb.length) {
    // still compare to keep timing flatter
    crypto.timingSafeEqual(ba.length ? ba : Buffer.from([0]), ba.length ? ba : Buffer.from([0]))
    return false
  }
  if (ba.length === 0) return false
  return crypto.timingSafeEqual(ba, bb)
}

function extractBearer(req) {
  const h = req.headers.authorization || req.headers.Authorization || ''
  const s = String(h)
  const m = /^Bearer\s+(.+)$/i.exec(s)
  if (m) return m[1].trim()
  // also allow X-Token / query ?token= for easier debug (still checked)
  const xt = req.headers['x-token'] || req.headers['x-webhook-token']
  if (xt) return String(xt).trim()
  try {
    const u = new URL(req.url || '/', 'http://localhost')
    const q = u.searchParams.get('token')
    if (q) return q.trim()
  } catch {
    /* ignore */
  }
  return ''
}

function clientIp(req) {
  const xf = req.headers['x-forwarded-for']
  if (typeof xf === 'string' && xf.trim()) return xf.split(',')[0].trim()
  const ra = req.socket && req.socket.remoteAddress
  return ra ? String(ra).replace(/^::ffff:/, '') : 'unknown'
}

function checkRate(ip) {
  const now = Date.now()
  let arr = rateMap.get(ip)
  if (!arr) {
    arr = []
    rateMap.set(ip, arr)
  }
  const cutoff = now - RATE_LIMIT_WINDOW_MS
  while (arr.length && arr[0] < cutoff) arr.shift()
  if (arr.length >= RATE_LIMIT_MAX) return false
  arr.push(now)
  // prune map size
  if (rateMap.size > 500) {
    for (const [k, v] of rateMap) {
      if (!v.length || v[v.length - 1] < cutoff) rateMap.delete(k)
    }
  }
  return true
}

function contentTypeIsJson(req) {
  const ct = String(req.headers['content-type'] || '').toLowerCase()
  if (!ct) return true // allow missing CT from some clients
  return ct.includes('application/json') || ct.includes('+json') || ct.includes('text/json')
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let tooLarge = false
    req.on('data', (chunk) => {
      if (tooLarge) return
      size += chunk.length
      if (size > limit) {
        tooLarge = true
        chunks.length = 0
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (tooLarge) {
        reject(Object.assign(new Error('payload too large'), { code: 'TOO_LARGE' }))
        return
      }
      resolve(Buffer.concat(chunks))
    })
    req.on('error', (err) => {
      reject(err)
    })
  })
}

function writeJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

function normalizePayload(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const packageName = clampStr(src.packageName ?? src.package_name ?? src.pkg, 255, 'unknown') || 'unknown'
  let appName = clampStr(src.appName ?? src.app_name ?? src.app, 100, '')
  if (!appName) appName = packageName
  let title = clampStr(src.title ?? src.Title, 300, '')
  if (!title) title = appName
  const body = clampStr(src.body ?? src.msg ?? src.message ?? src.MSG ?? src.content, 4000, '')
  const receivedAt = clampStr(src.receivedAt ?? src.receive_time ?? src.RECEIVE_TIME, 64, '')
  const device = clampStr(src.device ?? src.device_mark, 100, '')
  const uid = clampStr(src.uid ?? src.UID, 128, '')
  const timestamp = src.timestamp
  return { packageName, appName, title, body, receivedAt, device, uid, timestamp }
}

function isBlacklisted(n) {
  const list = config.appBlacklist || []
  if (!list.length) return false
  const pkg = String(n.packageName || '').toLowerCase()
  const app = String(n.appName || '').toLowerCase()
  for (const item of list) {
    const k = String(item || '').toLowerCase()
    if (!k) continue
    if (pkg === k || app === k || pkg.includes(k) || app.includes(k)) return true
  }
  return false
}

function extractOtp(title, body) {
  const text = `${title || ''}\n${body || ''}`
  if (!OTP_KEYWORD_RE.test(text)) return ''
  const matches = text.match(OTP_CODE_RE)
  if (!matches || !matches.length) return ''
  // prefer 6-digit if present
  const six = matches.find((m) => m.length === 6)
  return six || matches[0]
}

function contentHash(n) {
  const h = crypto.createHash('sha256')
  h.update(String(n.packageName || ''))
  h.update('\0')
  h.update(String(n.title || ''))
  h.update('\0')
  h.update(String(n.body || ''))
  h.update('\0')
  h.update(String(n.device || ''))
  return h.digest('hex')
}

function isDuplicate(hash) {
  const windowSec = clampInt(config.dedupeWindowSec, 0, 300, 5)
  if (windowSec <= 0) return false
  const now = Date.now()
  // cleanup
  if (dedupeMap.size > MAX_DEDUPE) {
    for (const [k, exp] of dedupeMap) {
      if (exp <= now) dedupeMap.delete(k)
    }
    if (dedupeMap.size > MAX_DEDUPE) {
      const entries = [...dedupeMap.entries()].sort((a, b) => a[1] - b[1])
      for (let i = 0; i < entries.length - MAX_DEDUPE + 50; i++) {
        dedupeMap.delete(entries[i][0])
      }
    }
  }
  const exp = dedupeMap.get(hash)
  if (exp && exp > now) return true
  dedupeMap.set(hash, now + windowSec * 1000)
  return false
}

function toastBody(n) {
  const raw = String(n.body || '')
  if (raw.length <= 500) return raw
  return `${raw.slice(0, 499)}…`
}

function publishNotification(n, hash, otp) {
  const cardSec = clampInt(config.cardDurationSec, 0, 600, 10)
  const sticky = cardSec <= 0
  const hideBody = config.hideSensitiveBody === true
  const title = `${n.appName} · ${n.title}`
  const body = hideBody ? '' : toastBody(n)
  const actions = []
  if (!hideBody && config.enableOtpAction !== false && otp) {
    actions.push({ id: 'copy-otp', label: '复制验证码' })
  }
  if (sticky) {
    actions.push({ id: 'dismiss', label: '知道了' })
  }

  const payload = {
    packageName: n.packageName,
    appName: n.appName,
    title: n.title,
    receivedAt: n.receivedAt || new Date().toISOString(),
    device: n.device || '',
    uid: n.uid || '',
    auto_hide_ms: sticky ? 0 : cardSec * 1000,
    card_duration_sec: cardSec,
  }
  if (!hideBody) {
    payload.body = n.body
    if (otp && config.enableOtpAction !== false) payload.otp = otp
  }

  send({
    v: 1,
    op: 'publish',
    event: {
      eventType: 'smsforwarder-notify.notification',
      kind: 'smsforwarder-notify',
      title,
      body: hideBody ? `${n.appName} 发来通知` : body,
      level: 'info',
      sticky,
      actions,
      payload,
      dedupeKey: `smsforwarder-notify:${hash}`,
    },
  })
}

function noteError(summary) {
  lastErrorSummary = String(summary || '').slice(0, 200)
  lastErrorAt = Date.now()
}

async function handleWebhook(req, res, ip) {
  if (!contentTypeIsJson(req)) {
    rejectedCount += 1
    noteError(`415 unsupported content-type from ${ip}`)
    writeJson(res, 415, { ok: false, error: 'content-type must be application/json' })
    log('reject non-json', { ip, status: 415 }, 'warn')
    return
  }

  const token = extractBearer(req)
  if (!timingSafeEqualStr(token, config.token)) {
    rejectedCount += 1
    noteError(`401 unauthorized from ${ip}`)
    writeJson(res, 401, { ok: false, error: 'unauthorized' })
    log('reject unauthorized', { ip, status: 401 }, 'warn')
    return
  }

  let buf
  try {
    buf = await readBody(req, MAX_BODY_BYTES)
  } catch (err) {
    if (err && err.code === 'TOO_LARGE') {
      rejectedCount += 1
      noteError(`413 too large from ${ip}`)
      writeJson(res, 413, { ok: false, error: 'payload too large' })
      log('reject too large', { ip, status: 413 }, 'warn')
      return
    }
    rejectedCount += 1
    noteError(`400 body read fail from ${ip}`)
    writeJson(res, 400, { ok: false, error: 'bad request' })
    return
  }

  let raw
  try {
    const text = buf.toString('utf8').trim()
    if (!text) throw new Error('empty body')
    raw = JSON.parse(text)
  } catch {
    rejectedCount += 1
    noteError(`400 invalid json from ${ip}`)
    writeJson(res, 400, { ok: false, error: 'invalid json' })
    log('reject invalid json', { ip, status: 400, bytes: buf.length }, 'warn')
    return
  }

  if (config.enabled === false) {
    // still ack so phone does not retry storm
    writeJson(res, 200, { ok: true, skipped: true, reason: 'disabled' })
    log('skipped disabled', { ip, status: 200 })
    return
  }

  const n = normalizePayload(raw)
  if (isBlacklisted(n)) {
    rejectedCount += 1
    writeJson(res, 200, { ok: true, skipped: true, reason: 'blacklist' })
    log('skipped blacklist', {
      ip,
      status: 200,
      packageName: n.packageName,
      bodyLen: (n.body || '').length,
    })
    return
  }

  const hash = contentHash(n)
  if (isDuplicate(hash)) {
    dedupedCount += 1
    writeJson(res, 200, { ok: true, deduped: true })
    log('deduped', {
      ip,
      status: 200,
      packageName: n.packageName,
      bodyLen: (n.body || '').length,
    })
    return
  }

  const otp = extractOtp(n.title, n.body)
  try {
    publishNotification(n, hash, otp)
    acceptedCount += 1
    lastSuccessAt = Date.now()
    lastClientIp = ip
    writeJson(res, 200, { ok: true })
    log('accepted', {
      ip,
      status: 200,
      packageName: n.packageName,
      bodyLen: (n.body || '').length,
      hasOtp: Boolean(otp),
    })
  } catch (err) {
    rejectedCount += 1
    noteError(`500 publish fail: ${err instanceof Error ? err.message : String(err)}`)
    writeJson(res, 500, { ok: false, error: 'publish failed' })
    log(
      'publish failed',
      { ip, error: err instanceof Error ? err.message : String(err) },
      'error',
    )
  }
}

function requestListener(req, res) {
  const ip = clientIp(req)
  const method = String(req.method || 'GET').toUpperCase()

  // health for local debug
  let urlPath = '/'
  try {
    urlPath = new URL(req.url || '/', 'http://localhost').pathname
  } catch {
    urlPath = '/'
  }
  if (urlPath.length > 1 && urlPath.endsWith('/')) urlPath = urlPath.slice(0, -1)

  if (urlPath === '/health' && method === 'GET') {
    writeJson(res, 200, {
      ok: true,
      pluginId,
      listening: Boolean(server && server.listening),
      path: config.path,
    })
    return
  }

  if (urlPath !== config.path) {
    rejectedCount += 1
    writeJson(res, 404, { ok: false, error: 'not found' })
    return
  }

  if (method !== 'POST') {
    rejectedCount += 1
    noteError(`405 method ${method} from ${ip}`)
    writeJson(res, 405, { ok: false, error: 'method not allowed' })
    log('reject method', { ip, method, status: 405 }, 'warn')
    return
  }

  if (!checkRate(ip)) {
    rejectedCount += 1
    noteError(`429 rate limit ${ip}`)
    writeJson(res, 429, { ok: false, error: 'too many requests' })
    log('reject rate limit', { ip, status: 429 }, 'warn')
    return
  }

  handleWebhook(req, res, ip).catch((err) => {
    rejectedCount += 1
    noteError(`500 ${err instanceof Error ? err.message : String(err)}`)
    try {
      writeJson(res, 500, { ok: false, error: 'internal error' })
    } catch {
      /* ignore */
    }
    log('handler error', { ip, error: err instanceof Error ? err.message : String(err) }, 'error')
  })
}

function stopServer() {
  return new Promise((resolve) => {
    const s = server
    server = null
    listenMeta = null
    if (!s) {
      resolve()
      return
    }
    s.close(() => resolve())
    // force close hang connections shortly
    setTimeout(() => {
      try {
        s.closeAllConnections?.()
      } catch {
        /* ignore */
      }
      resolve()
    }, 1500).unref?.()
  })
}

function startServer() {
  if (starting) return Promise.resolve({ ok: false, error: 'starting' })
  starting = true
  return (async () => {
    const host = config.host || '0.0.0.0'
    const port = clampInt(config.port, 1024, 65535, 17890)
    const path = normalizePath(config.path)

    // if same bind, keep
    if (
      server &&
      server.listening &&
      listenMeta &&
      listenMeta.host === host &&
      listenMeta.port === port &&
      listenMeta.path === path
    ) {
      return { ok: true, reused: true, ...statusPayload() }
    }

    const prevServer = server
    const prevMeta = listenMeta

    const next = http.createServer(requestListener)
    next.on('error', (err) => {
      log('http server error', { error: err instanceof Error ? err.message : String(err) }, 'error')
      noteError(`server error: ${err instanceof Error ? err.message : String(err)}`)
    })

    try {
      await new Promise((resolve, reject) => {
        const onErr = (err) => {
          next.off('listening', onListen)
          reject(err)
        }
        const onListen = () => {
          next.off('error', onErr)
          resolve()
        }
        next.once('error', onErr)
        next.once('listening', onListen)
        next.listen(port, host)
      })
    } catch (err) {
      try {
        next.close()
      } catch {
        /* ignore */
      }
      const msg = err instanceof Error ? err.message : String(err)
      noteError(`listen failed: ${msg}`)
      log('listen failed, keep previous', { error: msg, host, port }, 'error')
      // keep old if any
      if (prevServer && prevServer.listening) {
        server = prevServer
        listenMeta = prevMeta
      }
      return { ok: false, error: msg, ...statusPayload() }
    }

    // swap: close old after new is up
    server = next
    listenMeta = { host, port, path: config.path }
    config.path = path
    config.host = host
    config.port = port

    if (prevServer && prevServer !== next) {
      await new Promise((resolve) => {
        prevServer.close(() => resolve())
        setTimeout(resolve, 1000).unref?.()
      })
    }

    log('http listening', { host, port, path: config.path })
    return { ok: true, ...statusPayload() }
  })().finally(() => {
    starting = false
  })
}

function statusPayload() {
  const ipv4 = listIPv4()
  const port = listenMeta?.port ?? config.port
  const path = listenMeta?.path ?? config.path
  const urls = ipv4.map((x) => `http://${x.address}:${port}${path}`)
  return {
    pluginId,
    pid: process.pid,
    enabled: config.enabled !== false,
    running: Boolean(server && server.listening),
    host: listenMeta?.host ?? config.host,
    port,
    path,
    hasToken: Boolean(config.token),
    tokenLength: config.token ? config.token.length : 0,
    // token only returned on explicit getWebhookInfo
    cardDurationSec: config.cardDurationSec,
    dedupeWindowSec: config.dedupeWindowSec,
    appBlacklist: [...(config.appBlacklist || [])],
    hideSensitiveBody: config.hideSensitiveBody === true,
    enableOtpAction: config.enableOtpAction !== false,
    ipv4,
    webhookUrls: urls,
    acceptedCount,
    rejectedCount,
    dedupedCount,
    lastSuccessAt,
    lastErrorSummary: lastErrorSummary || null,
    lastErrorAt: lastErrorAt || null,
    lastClientIp: lastClientIp || null,
    dedupeSize: dedupeMap.size,
  }
}

function webhookInfoPayload() {
  const st = statusPayload()
  const header = `Authorization: Bearer ${config.token}`
  const template = {
    packageName: '{{PACKAGE_NAME}}',
    appName: '{{APP_NAME}}',
    title: '{{TITLE}}',
    body: '{{MSG}}',
    receivedAt: '{{RECEIVE_TIME}}',
    uid: '{{UID}}',
    device: '[device_mark]',
    timestamp: '[timestamp]',
  }
  return {
    ...st,
    token: config.token,
    authorizationHeader: header,
    jsonTemplate: JSON.stringify(template, null, 2),
    responseKeyword: '"ok":true',
  }
}

async function applyHostConfig(input) {
  const prev = {
    host: config.host,
    port: config.port,
    path: config.path,
    token: config.token,
  }
  config = normalizeConfig(input || {})
  ensureToken()

  const bindChanged =
    prev.host !== config.host || prev.port !== config.port || prev.path !== config.path

  log('config applied', {
    enabled: config.enabled,
    host: config.host,
    port: config.port,
    path: config.path,
    hasToken: Boolean(config.token),
    cardDurationSec: config.cardDurationSec,
    dedupeWindowSec: config.dedupeWindowSec,
    blacklist: (config.appBlacklist || []).length,
    hideSensitiveBody: config.hideSensitiveBody,
    enableOtpAction: config.enableOtpAction,
    bindChanged,
  })

  if (config.enabled === false) {
    await stopServer()
    return statusPayload()
  }

  if (bindChanged || !server || !server.listening) {
    return startServer()
  }
  return { ok: true, ...statusPayload() }
}

function handleRequest(message) {
  const requestId = message.requestId || message.id
  if (!requestId) return
  const method = String(message.method || '')
  const params = message.params && typeof message.params === 'object' ? message.params : {}

  const run = async () => {
    switch (method) {
      case 'getStatus':
        return statusPayload()
      case 'getWebhookInfo':
        return webhookInfoPayload()
      case 'setConfig':
        return applyHostConfig(params)
      case 'regenerateToken': {
        config.token = generateToken()
        log('token regenerated', { length: config.token.length })
        return webhookInfoPayload()
      }
      case 'restartServer':
        await stopServer()
        return startServer()
      case 'sendTest': {
        const n = {
          packageName: 'com.example.test',
          appName: params.appName || '测试 App',
          title: params.title || '测试通知',
          body: params.body || '这是一条 SmsForwarder 测试消息，验证码 123456',
          receivedAt: new Date().toLocaleString(),
          device: 'local-test',
          uid: `test-${Date.now()}`,
        }
        const hash = contentHash({ ...n, body: `${n.body}:${Date.now()}` })
        const otp = extractOtp(n.title, n.body)
        publishNotification(n, hash, otp)
        acceptedCount += 1
        lastSuccessAt = Date.now()
        return { ok: true, otp: otp || null }
      }
      default:
        throw new Error(`unknown method: ${method}`)
    }
  }

  run()
    .then((result) => respond(requestId, true, result))
    .catch((error) =>
      respond(requestId, false, null, error instanceof Error ? error.message : String(error)),
    )
}

async function shutdown() {
  log('graceful shutdown', {
    acceptedCount,
    rejectedCount,
    dedupedCount,
  })
  await stopServer()
  process.exit(0)
}

ensureToken()
send({ v: 1, op: 'ready' })
log('smsforwarder-notify sidecar ready', {
  pluginId,
  pid: process.pid,
  protocol: process.env.CATRACE_PROTOCOL_VERSION,
})

setTimeout(() => {
  if (config.enabled !== false) {
    startServer().catch((err) => {
      log('initial listen failed', { error: err instanceof Error ? err.message : String(err) }, 'error')
    })
  }
}, 300).unref?.()

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }

  if (message.op === 'shutdown') {
    shutdown().catch(() => process.exit(0))
    return
  }

  if (message.op === 'config' && message.config && typeof message.config === 'object') {
    applyHostConfig(message.config).catch((err) => {
      log('config apply failed', { error: err instanceof Error ? err.message : String(err) }, 'error')
    })
    return
  }

  if (message.op === 'request') {
    handleRequest(message)
    return
  }

  if (message.op === 'resolved') {
    log('toast resolved by host', {
      eventId: message.eventId,
      actionId: message.actionId,
      resolutionKind: message.resolutionKind,
    })
  }
})
