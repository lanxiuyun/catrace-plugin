import crypto from 'node:crypto'
import http from 'node:http'
import os from 'node:os'
import readline from 'node:readline'

const pluginId = process.env.CATRACE_PLUGIN_ID || 'smsforwarder-notify'

const MAX_BODY_BYTES = 64 * 1024
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 120
const MAX_DEDUPE = 500
const MAX_PENDING = 200
const MAX_FILTERS = 50
const MAX_THREAD_MESSAGES = 10000
const MAX_THREADS = 500
const TOAST_LIVE_SIZE = 1
const TOAST_PAGE_SIZE = 40
const PENDING_POLL_MS = 3000
const THREAD_INDEX_KEY = 'chatIndex'
const LEGACY_THREAD_STORE_KEY = 'chatThreads'
const DEFAULT_CHAT_APPS = [
  'QQ',
  '微信',
  'WeChat',
  'TIM',
  'Telegram',
  'Discord',
  'WhatsApp',
  'com.tencent.mobileqq',
  'com.tencent.mm',
  'com.tencent.tim',
  'org.telegram.messenger',
  'org.telegram.messenger.web',
  'com.discord',
  'com.whatsapp',
]
const FILTER_FIELDS = new Set(['title', 'body', 'app', 'package', 'any'])
const FILTER_MATCHES = new Set(['contains', 'equals', 'startsWith', 'regex'])
// keywords near which a 4–8 digit code is treated as OTP
const OTP_KEYWORD_RE =
  /验证码|校验码|动态码|动态密码|短信码|短信验证|登录码|确认码|授权码|安全码|识别码|提取码|兑换码|OTP|verification\s*code|security\s*code|auth(?:entication)?\s*code|one[-\s]?time\s*(?:pass)?(?:word|code)?/i
// plain ASCII digits, optional spaces/dashes between (e.g. 123 456 / 123-456)
const OTP_CODE_RE = /(?<!\d)(?:\d[ \t-]*){3,7}\d(?!\d)/g
// fullwidth digits ０-９
const OTP_FULLWIDTH_RE = /(?<![0-9０-９])[０-９]{4,8}(?![0-9０-９])/g

// Packages Android may re-label notifications with while the screen is locked.
// Every lock-screen SMS shares the same package (com.android.mms) no matter the
// real source app, so blacklist entries must never match it directly — that
// would silently drop ALL lock-screen SMS. Such notifications are filtered by
// their title (sender / chat name) instead; a literal "com.android.mms" entry
// therefore stays inert, which is what users expect after adding it by mistake.
const LOCKSCREEN_PACKAGES = new Set(['com.android.mms'])

const DEFAULT_CONFIG = {
  enabled: true,
  host: '0.0.0.0',
  port: 17890,
  path: '/webhook',
  token: '',
  cardDurationSec: 10,
  dedupeWindowSec: 5,
  appBlacklist: [],
  appBlacklistPaused: [],
  mmsTitleBlacklist: [],
  filters: [],
  hideSensitiveBody: false,
  enableOtpAction: true,
  onlyPushWhenActive: false,
  mergeChatThreads: true,
  chatApps: [...DEFAULT_CHAT_APPS],
}

/** @type {typeof DEFAULT_CONFIG} */
let config = {
  ...DEFAULT_CONFIG,
  appBlacklist: [],
  appBlacklistPaused: [],
  mmsTitleBlacklist: [],
  filters: [],
  chatApps: [...DEFAULT_CHAT_APPS],
}

/** @type {http.Server | null} */
let server = null
/** @type {{ host: string, port: number, path: string } | null} */
let listenMeta = null
let starting = false

/** @type {Map<string, number[]>} ip -> timestamps */
const rateMap = new Map()
/** @type {Map<string, number>} hash -> expireAt */
const dedupeMap = new Map()
/** @type {Map<string, { n: object, hash: string, queuedAt: number }>} notifications deferred while idle */
const pendingQueue = new Map()
let pendingTimer = null
/** @type {Map<string, { key: string, messages: object[], lastAt: number }>} live toast chat threads */
const threadSessions = new Map()

let acceptedCount = 0
let rejectedCount = 0
let dedupedCount = 0
let lastSuccessAt = 0
let lastErrorSummary = ''
let lastErrorAt = 0
let lastClientIp = ''

/** Host requestId -> pending storage.get resolvers */
const storagePending = new Map()
let storageReqSeq = 0

const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`)
const log = (message, data, level = 'info') =>
  send({ v: 1, op: 'log', level, message, data })

function storageGet(key) {
  return new Promise((resolve) => {
    const requestId = `stg-${++storageReqSeq}`
    storagePending.set(requestId, { resolve, timer: null })
    send({ v: 1, op: 'storage.get', requestId, key })
    const timer = setTimeout(() => {
      if (storagePending.has(requestId)) {
        storagePending.delete(requestId)
        resolve(null)
      }
    }, 2500)
    const pending = storagePending.get(requestId)
    if (pending) pending.timer = timer
  })
}

function storageSet(key, value) {
  return new Promise((resolve) => {
    const requestId = `stg-${++storageReqSeq}`
    storagePending.set(requestId, { resolve, timer: null })
    send({ v: 1, op: 'storage.set', requestId, key, value })
    const timer = setTimeout(() => {
      if (storagePending.has(requestId)) {
        storagePending.delete(requestId)
        resolve(false)
      }
    }, 2500)
    const pending = storagePending.get(requestId)
    if (pending) pending.timer = timer
  })
}

function handleHostResponse(message) {
  const requestId = message.requestId
  if (!requestId || !storagePending.has(requestId)) return
  const pending = storagePending.get(requestId)
  storagePending.delete(requestId)
  if (pending && pending.timer) clearTimeout(pending.timer)
  if (pending) pending.resolve(message.ok ? message.result ?? null : null)
}

/** True when the user is currently active; unknown/stale state fails open (allow push). */
async function isUserActive() {
  try {
    const snap = await storageGet('activitySnapshot')
    if (!snap || typeof snap !== 'object') return true
    const age = Date.now() - (Number(snap.at) || 0)
    // stale snapshot (background not updating) → fail open, don't drop notifications
    if (!Number.isFinite(age) || age < 0 || age > 30_000) return true
    return snap.active === true
  } catch {
    return true
  }
}

function toIsoNow() {
  return new Date().toISOString()
}

function toIsoFromMs(ms) {
  const n = Number(ms)
  if (!Number.isFinite(n) || n <= 0) return ''
  return new Date(n).toISOString()
}

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

/** Skip leading whitespace / punctuation so `"短信"` sorts as 短信, not before digits. */
function firstSignificantChar(value) {
  const str = String(value || '')
  for (const ch of str) {
    if (/\s/u.test(ch)) continue
    if (/[\p{P}\p{S}]/u.test(ch)) continue
    return ch
  }
  return ''
}

function blacklistSortRank(value) {
  const ch = firstSignificantChar(value)
  if (!ch) return 3
  if (/\d/u.test(ch)) return 0
  if (/\p{Script=Latin}/u.test(ch)) return 1
  if (/\p{Script=Han}/u.test(ch)) return 2
  return 3
}

/** Digits, then Latin, then CJK by pinyin. Leading quotes/brackets do not change the group. */
function compareBlacklist(a, b) {
  const sa = String(a || '')
  const sb = String(b || '')
  const ra = blacklistSortRank(sa)
  const rb = blacklistSortRank(sb)
  if (ra !== rb) return ra - rb
  return sa.localeCompare(sb, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
}

function sortBlacklist(list) {
  return [...list].sort(compareBlacklist)
}

function normalizeBlacklist(input) {
  if (Array.isArray(input)) {
    return sortBlacklist(
      input
        .map((v) => String(v || '').trim())
        .filter(Boolean)
        .slice(0, 200),
    )
  }
  if (typeof input === 'string') {
    return sortBlacklist(
      input
        .split(/\r?\n|,/)
        .map((v) => v.trim())
        .filter(Boolean)
        .slice(0, 200),
    )
  }
  return []
}

/** Strip QQ/WeChat unread suffixes so "群名(36条未读)" still matches next time. */
function stripTitleNoise(title) {
  let s = String(title || '').trim()
  s = s.replace(/[（(]\s*\d+\s*条[^）)]*[）)]?\s*$/u, '')
  s = s.replace(/[（(]\s*\d+\s*[）)]\s*$/u, '')
  s = s.replace(/[.…]+$/u, '')
  return s.trim()
}

function newFilterId() {
  return `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeFilter(raw) {
  if (!raw || typeof raw !== 'object') return null
  const field = FILTER_FIELDS.has(raw.field) ? raw.field : 'title'
  const match = FILTER_MATCHES.has(raw.match) ? raw.match : 'contains'
  const value = clampStr(raw.value, match === 'regex' ? 80 : 200, '').trim()
  const id = clampStr(raw.id, 64, '').trim() || newFilterId()
  const appContains = clampStr(raw.appContains ?? raw.app, 100, '').trim()
  return {
    id,
    enabled: raw.enabled !== false,
    field,
    match,
    value,
    appContains,
  }
}

function normalizeFilters(input) {
  if (!Array.isArray(input)) return [...(config.filters || [])]
  const out = []
  const seen = new Set()
  for (const raw of input) {
    if (out.length >= MAX_FILTERS) break
    const f = normalizeFilter(raw)
    if (!f) continue
    if (seen.has(f.id)) f.id = newFilterId()
    seen.add(f.id)
    out.push(f)
  }
  return out
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
    appBlacklistPaused:
      input.appBlacklistPaused !== undefined
        ? normalizeBlacklist(input.appBlacklistPaused)
        : [...(config.appBlacklistPaused || [])],
    mmsTitleBlacklist:
      input.mmsTitleBlacklist !== undefined
        ? normalizeBlacklist(input.mmsTitleBlacklist)
        : [...(config.mmsTitleBlacklist || [])],
    filters:
      input.filters !== undefined ? normalizeFilters(input.filters) : [...(config.filters || [])],
    hideSensitiveBody: false,
    enableOtpAction: input.enableOtpAction !== false,
    onlyPushWhenActive: input.onlyPushWhenActive === true,
    mergeChatThreads: input.mergeChatThreads !== false,
    chatApps:
      input.chatApps !== undefined
        ? normalizeBlacklist(input.chatApps)
        : [...(config.chatApps || DEFAULT_CHAT_APPS)],
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
  // SmsForwarder / misc clients may use many aliases; fold them
  const packageName =
    clampStr(
      src.packageName ?? src.package_name ?? src.pkg ?? src.PACKAGE_NAME,
      255,
      'unknown',
    ) || 'unknown'
  let appName = clampStr(
    src.appName ?? src.app_name ?? src.app ?? src.APP_NAME,
    100,
    '',
  )
  if (!appName) appName = packageName

  let title = clampStr(src.title ?? src.Title ?? src.TITLE ?? src.subject, 300, '')
  let body = clampStr(
    src.body ??
      src.msg ??
      src.message ??
      src.MSG ??
      src.content ??
      src.text ??
      src.sms ??
      src.desc ??
      src.description,
    4000,
    '',
  )

  // some clients put the whole SMS only in title, or only in a nested field
  if (!body && typeof src.data === 'string') body = clampStr(src.data, 4000, '')
  if (!body && src.data && typeof src.data === 'object') {
    body = clampStr(src.data.body ?? src.data.msg ?? src.data.message, 4000, '')
    if (!title) title = clampStr(src.data.title, 300, '')
  }

  // if title holds the long text and body is empty, swap for display/OTP
  if (!body && title && title.length > 20) {
    body = title
    title = appName
  }
  // if body empty but title looks like SMS content with digits, keep title as body too
  if (!body && title) body = title

  if (!title) title = appName

  const receivedAt = clampStr(
    src.receivedAt ?? src.receive_time ?? src.RECEIVE_TIME ?? src.time ?? src.date,
    64,
    '',
  )
  const device = clampStr(src.device ?? src.device_mark ?? src.from, 100, '')
  const uid = clampStr(src.uid ?? src.UID, 128, '')
  const timestamp = src.timestamp
  // keep raw-ish preview fields for OTP (never log full body)
  return { packageName, appName, title, body, receivedAt, device, uid, timestamp }
}

function isBlacklisted(n) {
  const pkg = String(n.packageName || '').toLowerCase()
  if (LOCKSCREEN_PACKAGES.has(pkg)) {
    // Only titles added by the card's explicit block action may suppress a
    // lock-screen SMS. App-blacklist typos (including com.android.mms) can
    // never hide one. Exact title match avoids broad/partial false positives.
    const title = String(n.title || '').toLowerCase()
    if (!title) return false
    for (const item of config.mmsTitleBlacklist || []) {
      const k = String(item || '').toLowerCase()
      if (k && title === k) return true
    }
    return false
  }

  const list = config.appBlacklist || []
  if (!list.length) return false
  const paused = new Set(
    (config.appBlacklistPaused || []).map((x) => String(x || '').toLowerCase()).filter(Boolean),
  )
  const app = String(n.appName || '').toLowerCase()
  for (const item of list) {
    const k = String(item || '').toLowerCase()
    if (!k || paused.has(k)) continue
    if (pkg === k || app === k || pkg.includes(k) || app.includes(k)) return true
  }
  return false
}

function filterFieldTexts(n, field) {
  const rawTitle = String(n.title || '')
  const stripped = stripTitleNoise(rawTitle) || rawTitle
  const pkg = String(n.packageName || '')
  const app = String(n.appName || '')
  const body = String(n.body || '')
  switch (field) {
    case 'title':
      return stripped && stripped !== rawTitle ? [rawTitle, stripped] : [rawTitle]
    case 'body':
      return [body]
    case 'app':
      return [app]
    case 'package':
      return [pkg]
    case 'any': {
      const texts = [`${pkg}\n${app}\n${rawTitle}\n${body}`]
      if (stripped && stripped !== rawTitle) texts.push(`${pkg}\n${app}\n${stripped}\n${body}`)
      return texts
    }
    default:
      return ['']
  }
}

function matchFilterValue(text, match, value) {
  const t = String(text || '')
  const v = String(value || '')
  if (!v) return false
  if (match === 'equals') return t.toLowerCase() === v.toLowerCase()
  if (match === 'startsWith') return t.toLowerCase().startsWith(v.toLowerCase())
  if (match === 'contains') return t.toLowerCase().includes(v.toLowerCase())
  if (match === 'regex') {
    try {
      return new RegExp(v, 'i').test(t)
    } catch {
      return false
    }
  }
  return false
}

function matchesFilter(n) {
  const list = config.filters || []
  if (!list.length) return false
  for (const f of list) {
    if (!f || f.enabled === false || !f.value) continue
    if (f.appContains) {
      const hay = `${n.appName || ''} ${n.packageName || ''}`.toLowerCase()
      if (!hay.includes(String(f.appContains).toLowerCase())) continue
    }
    const texts = filterFieldTexts(n, f.field)
    if (texts.some((text) => matchFilterValue(text, f.match, f.value))) return true
  }
  return false
}

function toHalfWidthDigits(s) {
  return String(s || '').replace(/[０-９]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30),
  )
}

function normalizeOtpCandidate(raw) {
  const digits = toHalfWidthDigits(raw).replace(/\D/g, '')
  if (digits.length < 4 || digits.length > 8) return ''
  if (/^0+$/.test(digits)) return ''
  // bare year
  if (/^(19|20)\d{2}$/.test(digits)) return ''
  return digits
}

function extractOtp(title, body, _meta = {}) {
  const text = toHalfWidthDigits(`${title || ''}\n${body || ''}`)
  if (!text.trim()) return ''
  if (!OTP_KEYWORD_RE.test(text)) return ''

  const candidates = []

  const nearAfter =
    /(?:验证码|校验码|动态码|动态密码|短信码|登录码|确认码|授权码|安全码|识别码|提取码|兑换码|OTP)[^\d０-９]{0,16}([0-9０-９][0-9０-９ \t-]{2,18}[0-9０-９])/gi
  let m
  while ((m = nearAfter.exec(text)) !== null) {
    const c = normalizeOtpCandidate(m[1])
    if (c) candidates.push({ code: c, rank: 4 })
  }

  const nearBefore =
    /([0-9０-９][0-9０-９ \t-]{2,18}[0-9０-９])[^\d０-９]{0,8}(?:验证码|校验码|动态码|动态密码|登录码|OTP)/gi
  while ((m = nearBefore.exec(text)) !== null) {
    const c = normalizeOtpCandidate(m[1])
    if (c) candidates.push({ code: c, rank: 4 })
  }

  const cnBare =
    /(?:码为|码是|码：|码:)[^\d０-９]{0,8}([0-9０-９][0-9０-９ \t-]{2,18}[0-9０-９])/gi
  while ((m = cnBare.exec(text)) !== null) {
    const c = normalizeOtpCandidate(m[1])
    if (c) candidates.push({ code: c, rank: 3 })
  }

  const ascii = text.match(OTP_CODE_RE) || []
  for (const raw of ascii) {
    const c = normalizeOtpCandidate(raw)
    if (c) candidates.push({ code: c, rank: 2 })
  }
  const fw = text.match(OTP_FULLWIDTH_RE) || []
  for (const raw of fw) {
    const c = normalizeOtpCandidate(raw)
    if (c) candidates.push({ code: c, rank: 2 })
  }

  if (!candidates.length) return ''

  candidates.sort((a, b) => {
    if (b.rank !== a.rank) return b.rank - a.rank
    if (a.code.length === 6 && b.code.length !== 6) return -1
    if (b.code.length === 6 && a.code.length !== 6) return 1
    return Math.abs(a.code.length - 6) - Math.abs(b.code.length - 6)
  })
  return candidates[0].code
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

function matchesChatApp(n) {
  const list = config.chatApps && config.chatApps.length ? config.chatApps : DEFAULT_CHAT_APPS
  const pkg = String(n.packageName || '').toLowerCase()
  const app = String(n.appName || '').toLowerCase()
  for (const item of list) {
    const k = String(item || '').toLowerCase().trim()
    if (!k) continue
    if (pkg === k || app === k || pkg.includes(k) || app.includes(k)) return true
  }
  return false
}

function shouldMergeChat(n) {
  if (config.mergeChatThreads === false) return false
  const pkg = String(n.packageName || '').trim()
  const title = (stripTitleNoise(n.title) || String(n.title || '')).trim()
  return Boolean(pkg && title && matchesChatApp(n))
}

function classifyNotice(n, otp) {
  if (shouldMergeChat(n)) return 'chat'
  if (otp && config.enableOtpAction !== false) return 'otp'
  return 'notice'
}

function threadIds(n) {
  const pkg = String(n.packageName || 'unknown').toLowerCase()
  const title = (stripTitleNoise(n.title) || String(n.title || '')).trim().toLowerCase()
  const device = String(n.device || '').trim().toLowerCase()
  const h = crypto.createHash('sha256')
  h.update(pkg)
  h.update('\0')
  h.update(title)
  h.update('\0')
  h.update(device)
  const digest = h.digest('hex').slice(0, 20)
  return {
    dedupeKey: `smsforwarder-notify:thread:${digest}`,
    storeKey: `chat_${digest}`,
    digest,
  }
}

function parseSpeaker(body) {
  const raw = String(body || '')
  const m = raw.match(/^(.{1,24}?)[:：]\s*([\s\S]+)$/)
  if (!m) return { speaker: '', text: raw }
  const name = m[1].trim()
  if (!name || name.includes('\n') || /https?:\/\//i.test(name)) return { speaker: '', text: raw }
  if (/^\d{1,2}:\d{2}/.test(name)) return { speaker: '', text: raw }
  return { speaker: name, text: String(m[2] || '').trim() }
}

function storageKeyForDigest(digest) {
  return `chat_${String(digest || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)}`
}

function normalizeStoredMessage(m) {
  if (!m || typeof m !== 'object') return null
  const text = String(m.text || '')
  const speaker = String(m.speaker || '')
  if (!text && !speaker) return null
  return {
    id: String(m.id || ''),
    speaker,
    text,
    receivedAt: m.receivedAt || '',
    otp: m.otp ? String(m.otp) : '',
  }
}

function sliceTail(messages, count) {
  const list = Array.isArray(messages) ? messages : []
  if (list.length <= count) return list.slice()
  return list.slice(list.length - count)
}

let persistTimer = null
/** @type {Promise<void> | null} */
let threadsLoadPromise = null
/** @type {Map<string, { key: string, storeKey: string, lastAt: number, packageName: string, appName: string, title: string, device: string, count: number }>} */
const threadIndex = new Map()
const dirtyThreadKeys = new Set()
let indexDirty = false

function schedulePersistThreads() {
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    persistThreads().catch((err) => {
      log(
        'persist threads failed',
        { error: err instanceof Error ? err.message : String(err) },
        'warn',
      )
    })
  }, 250)
  persistTimer.unref?.()
}

async function persistThreads() {
  const keys = [...dirtyThreadKeys]
  dirtyThreadKeys.clear()
  for (const key of keys) {
    const session = threadSessions.get(key)
    const meta = threadIndex.get(key)
    if (!session || !meta) continue
    await storageSet(meta.storeKey, {
      v: 1,
      key,
      messages: Array.isArray(session.messages)
        ? session.messages.slice(-MAX_THREAD_MESSAGES)
        : [],
      lastAt: session.lastAt || 0,
      packageName: session.packageName || '',
      appName: session.appName || '',
      title: session.title || '',
      device: session.device || '',
    })
  }
  if (indexDirty || keys.length) {
    indexDirty = false
    await storageSet(THREAD_INDEX_KEY, {
      v: 2,
      threads: [...threadIndex.values()].map((t) => ({
        key: t.key,
        storeKey: t.storeKey,
        lastAt: t.lastAt || 0,
        packageName: t.packageName || '',
        appName: t.appName || '',
        title: t.title || '',
        device: t.device || '',
        count: t.count || 0,
      })),
    })
  }
}

function rememberIndex(session) {
  const storeKey = session.storeKey || storageKeyForDigest(String(session.key || '').split(':').pop())
  threadIndex.set(session.key, {
    key: session.key,
    storeKey,
    lastAt: session.lastAt || 0,
    packageName: session.packageName || '',
    appName: session.appName || '',
    title: session.title || '',
    device: session.device || '',
    count: Array.isArray(session.messages) ? session.messages.length : 0,
  })
  indexDirty = true
}

async function hydrateSession(key) {
  let session = threadSessions.get(key)
  if (session && Array.isArray(session.messages)) return session
  const meta = threadIndex.get(key)
  if (!meta) return null
  const raw = await storageGet(meta.storeKey)
  const messages = raw && Array.isArray(raw.messages)
    ? raw.messages.map(normalizeStoredMessage).filter(Boolean)
    : []
  session = {
    key,
    storeKey: meta.storeKey,
    messages,
    lastAt: Number(raw && raw.lastAt) || meta.lastAt || 0,
    packageName: (raw && raw.packageName) || meta.packageName || '',
    appName: (raw && raw.appName) || meta.appName || '',
    title: (raw && raw.title) || meta.title || '',
    device: (raw && raw.device) || meta.device || '',
  }
  threadSessions.set(key, session)
  return session
}

function loadThreads() {
  if (threadsLoadPromise) return threadsLoadPromise
  threadsLoadPromise = (async () => {
    try {
      const indexRaw = await storageGet(THREAD_INDEX_KEY)
      const listed =
        indexRaw && typeof indexRaw === 'object' && Array.isArray(indexRaw.threads)
          ? indexRaw.threads
          : null
      if (listed && listed.length) {
        for (const t of listed) {
          if (!t || !t.key) continue
          const storeKey = String(t.storeKey || storageKeyForDigest(String(t.key).split(':').pop()))
          threadIndex.set(String(t.key), {
            key: String(t.key),
            storeKey,
            lastAt: Number(t.lastAt) || 0,
            packageName: t.packageName || '',
            appName: t.appName || '',
            title: t.title || '',
            device: t.device || '',
            count: Number(t.count) || 0,
          })
        }
        log('chat index loaded', { count: threadIndex.size })
        return
      }
      const legacy = await storageGet(LEGACY_THREAD_STORE_KEY)
      const list = legacy && typeof legacy === 'object' && Array.isArray(legacy.threads) ? legacy.threads : []
      for (const t of list) {
        if (!t || typeof t !== 'object' || !t.key) continue
        const key = String(t.key)
        const digest = key.split(':').pop() || key
        const storeKey = storageKeyForDigest(digest)
        const messages = Array.isArray(t.messages)
          ? t.messages.map(normalizeStoredMessage).filter(Boolean).slice(-MAX_THREAD_MESSAGES)
          : []
        const session = {
          key,
          storeKey,
          messages,
          lastAt: Number(t.lastAt) || 0,
          packageName: t.packageName || '',
          appName: t.appName || '',
          title: t.title || '',
          device: t.device || '',
        }
        threadSessions.set(key, session)
        rememberIndex(session)
        dirtyThreadKeys.add(key)
      }
      if (list.length) {
        await persistThreads()
        log('chat threads migrated', { count: threadIndex.size })
      } else {
        log('chat threads loaded', { count: 0 })
      }
    } catch (err) {
      log(
        'load threads failed',
        { error: err instanceof Error ? err.message : String(err) },
        'warn',
      )
    }
  })()
  return threadsLoadPromise
}

async function takeThreadSession(n, hash, otp) {
  if (!shouldMergeChat(n)) return null
  const ids = threadIds(n)
  let session = threadSessions.get(ids.dedupeKey)
  if (!session) session = await hydrateSession(ids.dedupeKey)
  if (!session) {
    session = {
      key: ids.dedupeKey,
      storeKey: ids.storeKey,
      messages: [],
      lastAt: 0,
    }
    threadSessions.set(ids.dedupeKey, session)
  }
  session.storeKey = session.storeKey || ids.storeKey
  const parsed = parseSpeaker(n.body)
  const msg = {
    id: String(hash || '').slice(0, 16) || `${Date.now().toString(36)}`,
    speaker: parsed.speaker,
    text: parsed.text || String(n.body || ''),
    receivedAt: n.receivedAt || n.webhookAt || toIsoNow(),
    otp: otp || '',
  }
  const last = session.messages[session.messages.length - 1]
  if (msg.text || msg.speaker) {
    if (!last || last.id !== msg.id) {
      session.messages.push(msg)
      if (session.messages.length > MAX_THREAD_MESSAGES) {
        session.messages = session.messages.slice(-MAX_THREAD_MESSAGES)
      }
    }
  }
  session.lastAt = Date.now()
  session.packageName = n.packageName
  session.appName = n.appName
  session.title = stripTitleNoise(n.title) || n.title
  session.device = n.device
  session.uid = n.uid
  rememberIndex(session)
  dirtyThreadKeys.add(session.key)
  schedulePersistThreads()
  return session
}

function pageFromSession(session, beforeId, limit = TOAST_PAGE_SIZE) {
  const messages = Array.isArray(session && session.messages) ? session.messages : []
  const size = Math.max(1, Math.min(100, Number(limit) || TOAST_PAGE_SIZE))
  if (!beforeId) {
    const page = sliceTail(messages, size)
    return {
      messages: page,
      total: messages.length,
      hasMore: messages.length > page.length,
    }
  }
  const idx = messages.findIndex((m) => m && m.id === beforeId)
  const end = idx < 0 ? messages.length : idx
  const start = Math.max(0, end - size)
  const page = messages.slice(start, end)
  return {
    messages: page,
    total: messages.length,
    hasMore: start > 0,
  }
}

function closeThreadFromResolved(_message) {
  // History stays on disk. Closing a toast must not wipe the conversation.
}

function toastBody(n) {
  const raw = String(n.body || '')
  // toast card can scroll/wrap; keep generous limit
  if (raw.length <= 2000) return raw
  return `${raw.slice(0, 1999)}…`
}

/**
 * @param {object} n
 * @param {string} hash
 * @param {string} otp
 * @param {{ queuedAt?: number } | undefined} meta — set when re-pushing after idle defer
 */
async function publishNotification(n, hash, otp, meta = {}) {
  const cardSec = clampInt(config.cardDurationSec, 0, 600, 10)
  const sticky = cardSec <= 0
  const kind = classifyNotice(n, otp)
  const session = kind === 'chat' ? await takeThreadSession(n, hash, otp) : null
  const page = session ? pageFromSession(session, '', TOAST_LIVE_SIZE) : null
  const messages = page ? page.messages : null
  const latest = messages && messages.length ? messages[messages.length - 1] : null
  const sender = String((session && session.title) || n.title || '').trim()
  const app = String(n.appName || '').trim()
  const head = sender || app || '通知'
  const body = kind === 'chat'
    ? (latest ? (latest.speaker ? `${latest.speaker}: ${latest.text}` : latest.text) : toastBody(n))
    : toastBody(n)
  const actions = []
  if (kind === 'otp' && config.enableOtpAction !== false && otp) {
    actions.push({ id: 'copy-otp', label: '复制验证码' })
  }
  if (sticky) actions.push({ id: 'dismiss', label: '知道了' })
  const lockscreen = LOCKSCREEN_PACKAGES.has(String(n.packageName || '').toLowerCase())
  actions.push({
    id: 'block-app',
    label: lockscreen ? '屏蔽这个标题' : '屏蔽此应用',
  })
  if (!lockscreen) actions.push({ id: 'block-title', label: '屏蔽这个标题' })

  const publishedAt = toIsoNow()
  const webhookAt = n.webhookAt || publishedAt
  const payload = {
    packageName: n.packageName,
    appName: n.appName,
    title: sender || n.title,
    body,
    receivedAt: (latest && latest.receivedAt) || n.receivedAt || webhookAt,
    webhookAt,
    publishedAt,
    shownAt: publishedAt,
    device: n.device || '',
    uid: n.uid || '',
    auto_hide_ms: sticky ? 0 : cardSec * 1000,
    card_duration_sec: cardSec,
    noticeKind: kind,
  }
  if (n.phoneTimestamp != null && n.phoneTimestamp !== '') {
    payload.phoneTimestamp = n.phoneTimestamp
  }
  const queuedAt = Number(meta && meta.queuedAt)
  if (Number.isFinite(queuedAt) && queuedAt > 0) {
    payload.deferred = true
    payload.queuedAt = toIsoFromMs(queuedAt)
  }
  if (kind === 'otp' && otp) payload.otp = otp
  if (kind === 'chat' && session) {
    payload.messages = messages
    payload.threadKey = session.key
    payload.threadCount = page.total
    payload.hasMore = page.hasMore
  }

  send({
    v: 1,
    op: 'publish',
    event: {
      eventType: 'smsforwarder-notify.notification',
      kind: 'smsforwarder-notify',
      title: head,
      body,
      level: 'info',
      sticky,
      actions,
      payload,
      dedupeKey: session ? session.key : `smsforwarder-notify:${hash}`,
    },
  })
}

function noteError(summary) {
  lastErrorSummary = String(summary || '').slice(0, 200)
  lastErrorAt = Date.now()
}

function stopPendingTimer() {
  if (pendingTimer) {
    clearInterval(pendingTimer)
    pendingTimer = null
  }
}

function enqueuePending(n, hash) {
  if (pendingQueue.has(hash)) return
  if (pendingQueue.size >= MAX_PENDING) {
    const oldest = pendingQueue.keys().next().value
    pendingQueue.delete(oldest)
  }
  pendingQueue.set(hash, { n, hash, queuedAt: Date.now() })
  if (!pendingTimer) {
    pendingTimer = setInterval(() => {
      flushPending().catch((err) => {
        log(
          'pending flush error',
          { error: err instanceof Error ? err.message : String(err) },
          'error',
        )
      })
    }, PENDING_POLL_MS)
    pendingTimer.unref?.()
  }
}

/** Re-push notifications that arrived while the user was idle, once they are active again. */
async function flushPending(force = false) {
  if (!force && config.onlyPushWhenActive !== true) {
    stopPendingTimer()
    return
  }
  if (pendingQueue.size === 0) {
    stopPendingTimer()
    return
  }
  if (!force && !(await isUserActive())) return
  await loadThreads()
  const items = [...pendingQueue.values()]
  pendingQueue.clear()
  log('active, flushing deferred notifications', { count: items.length })
  for (const { n, hash, queuedAt } of items) {
    try {
      if (isBlacklisted(n) || matchesFilter(n)) {
        rejectedCount += 1
        log('skipped deferred (filter)', { packageName: n.packageName })
        continue
      }
      const otp = extractOtp(n.title, n.body, n)
      await publishNotification(n, hash, otp, { queuedAt })
      acceptedCount += 1
      lastSuccessAt = Date.now()
      log('flushed deferred notification', {
        packageName: n.packageName,
        titleLen: (n.title || '').length,
        bodyLen: (n.body || '').length,
        receivedAt: n.receivedAt || null,
        webhookAt: n.webhookAt || null,
        queuedAt: Number.isFinite(queuedAt) ? toIsoFromMs(queuedAt) : null,
        queuedMs: Number.isFinite(queuedAt) ? Date.now() - queuedAt : null,
      })
    } catch (err) {
      rejectedCount += 1
      noteError(`500 deferred publish fail: ${err instanceof Error ? err.message : String(err)}`)
      log(
        'deferred publish failed',
        { error: err instanceof Error ? err.message : String(err) },
        'error',
      )
    }
  }
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

  // debug shape only — keys + lengths, never full secrets
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const shape = {}
    for (const k of Object.keys(raw).slice(0, 40)) {
      const v = raw[k]
      if (v == null) shape[k] = null
      else if (typeof v === 'string') shape[k] = `str:${v.length}`
      else if (typeof v === 'number' || typeof v === 'boolean') shape[k] = typeof v
      else if (typeof v === 'object') shape[k] = Array.isArray(v) ? `arr:${v.length}` : 'obj'
      else shape[k] = typeof v
    }
    log('webhook fields', { ip, keys: Object.keys(raw).slice(0, 40), shape })
  }

  await loadThreads()
  const n = normalizePayload(raw)
  // host wall clock when HTTP body fully received (before idle gate / publish)
  n.webhookAt = toIsoNow()
  // keep raw phone-side timestamp field if present (may be epoch or string)
  if (raw && typeof raw === 'object' && raw.timestamp != null) {
    n.phoneTimestamp = raw.timestamp
  }
  const blacklisted = isBlacklisted(n)
  const filtered = !blacklisted && matchesFilter(n)
  if (blacklisted || filtered) {
    rejectedCount += 1
    const reason = blacklisted ? 'blacklist' : 'filter'
    writeJson(res, 200, { ok: true, skipped: true, reason })
    log(blacklisted ? 'skipped blacklist' : 'skipped filter', {
      ip,
      status: 200,
      packageName: n.packageName,
      titleLen: (n.title || '').length,
      bodyLen: (n.body || '').length,
      webhookAt: n.webhookAt,
    })
    return
  }

  // Idle gate: defer (not drop) so the notification re-pushes once the user
  // is active again. Dedupe by content so repeated syncs while idle collapse.
  if (config.onlyPushWhenActive === true && !(await isUserActive())) {
    const hash = contentHash(n)
    enqueuePending(n, hash)
    writeJson(res, 200, { ok: true, queued: true, reason: 'inactive' })
    log('queued while inactive', {
      ip,
      status: 200,
      packageName: n.packageName,
      bodyLen: (n.body || '').length,
      queueSize: pendingQueue.size,
      receivedAt: n.receivedAt || null,
      webhookAt: n.webhookAt,
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
      webhookAt: n.webhookAt,
    })
    return
  }

  const otp = extractOtp(n.title, n.body, n)
  try {
    await publishNotification(n, hash, otp)
    acceptedCount += 1
    lastSuccessAt = Date.now()
    lastClientIp = ip
    writeJson(res, 200, { ok: true })
    const merged = `${n.title || ''}\n${n.body || ''}`
    log('accepted', {
      ip,
      status: 200,
      packageName: n.packageName,
      titleLen: (n.title || '').length,
      bodyLen: (n.body || '').length,
      hasKeyword: OTP_KEYWORD_RE.test(merged),
      digitRuns: (merged.match(/(?<!\d)\d{4,8}(?!\d)/g) || []).length,
      hasOtp: Boolean(otp),
      otpLen: otp ? String(otp).length : 0,
      actionCount: !config.hideSensitiveBody && config.enableOtpAction !== false && otp ? 1 : 0,
      hideSensitiveBody: config.hideSensitiveBody === true,
      enableOtpAction: config.enableOtpAction !== false,
      receivedAt: n.receivedAt || null,
      webhookAt: n.webhookAt,
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

    const MAX_ATTEMPTS = 8
    const BACKOFF_MS = 500
    let lastErr = null
    let attempt = 0

    while (attempt < MAX_ATTEMPTS) {
      attempt += 1
      const next = http.createServer(requestListener)
      next.on('error', (err) => {
        log('http server error', { error: err instanceof Error ? err.message : String(err) }, 'error')
        noteError(`server error: ${err instanceof Error ? err.message : String(err)}`)
      })

      let bound = false
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
        bound = true
      } catch (err) {
        lastErr = err
        try {
          next.close()
        } catch {
          /* ignore */
        }
        const isBusy = Boolean(err && err.code === 'EADDRINUSE')
        // previous sidecar may still be releasing the port after a reload
        if (isBusy && attempt < MAX_ATTEMPTS) {
          log('listen busy, retry', { host, port, attempt }, 'warn')
          await new Promise((r) => setTimeout(r, BACKOFF_MS))
          continue
        }
        break
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

      log('http listening', { host, port, path: config.path, bound: true })
      return { ok: true, ...statusPayload() }
    }

    const msg =
      lastErr instanceof Error ? lastErr.message : String(lastErr || 'listen failed')
    noteError(`listen failed: ${msg}`)
    log('listen failed, keep previous', { error: msg, host, port, attempts: attempt }, 'error')
    // keep old if any
    if (prevServer && prevServer.listening) {
      server = prevServer
      listenMeta = prevMeta
    }
    return { ok: false, error: msg, ...statusPayload() }
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
    appBlacklistPaused: [...(config.appBlacklistPaused || [])],
    mmsTitleBlacklist: [...(config.mmsTitleBlacklist || [])],
    filters: (config.filters || []).map((f) => ({ ...f })),
    hideSensitiveBody: config.hideSensitiveBody === true,
    enableOtpAction: config.enableOtpAction !== false,
    onlyPushWhenActive: config.onlyPushWhenActive === true,
    mergeChatThreads: config.mergeChatThreads !== false,
    chatApps: [...(config.chatApps || DEFAULT_CHAT_APPS)],
    ipv4,
    webhookUrls: urls,
    acceptedCount,
    rejectedCount,
    dedupedCount,
    lastSuccessAt,
    lastErrorSummary: lastErrorSummary || null,
    lastErrorAt: lastErrorAt || null,
    lastClientIp: lastClientIp || null,
    pendingCount: pendingQueue.size,
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

function unwrapConfig(input) {
  if (!input || typeof input !== 'object') return {}
  // host may send flat config or { config: {...} }
  if (input.config && typeof input.config === 'object' && !Array.isArray(input.config)) {
    return input.config
  }
  return input
}

async function applyHostConfig(input) {
  const raw = unwrapConfig(input)
  const prev = {
    host: config.host,
    port: config.port,
    path: config.path,
    token: config.token,
  }
  config = normalizeConfig(raw)
  ensureToken()

  // feature turned off → release anything deferred while idle (queued push)
  if (config.onlyPushWhenActive !== true) {
    await flushPending(true)
  }
  if (config.mergeChatThreads === false) {
    // keep persisted history; only stop merging new cards
  }

  const bindChanged =
    prev.host !== config.host || prev.port !== config.port || prev.path !== config.path
  const tokenChanged = prev.token !== config.token

  log('config applied', {
    enabled: config.enabled,
    host: config.host,
    port: config.port,
    path: config.path,
    hasToken: Boolean(config.token),
    tokenLength: config.token ? config.token.length : 0,
    tokenChanged,
    // fingerprint only — never log the secret
    tokenFp: config.token ? config.token.slice(0, 4) + '…' + config.token.slice(-4) : null,
    cardDurationSec: config.cardDurationSec,
    dedupeWindowSec: config.dedupeWindowSec,
    blacklist: (config.appBlacklist || []).length,
    mmsTitleBlacklist: (config.mmsTitleBlacklist || []).length,
    filters: (config.filters || []).length,
    hideSensitiveBody: config.hideSensitiveBody,
    enableOtpAction: config.enableOtpAction,
    mergeChatThreads: config.mergeChatThreads !== false,
    chatApps: (config.chatApps || []).length,
    bindChanged,
  })

  if (config.enabled === false) {
    await stopServer()
    return { ok: true, ...statusPayload(), token: config.token }
  }

  if (bindChanged || !server || !server.listening) {
    const started = await startServer()
    return { ...started, token: config.token }
  }
  return { ok: true, ...statusPayload(), token: config.token }
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
        log('token regenerated', {
          length: config.token.length,
          tokenFp: config.token.slice(0, 4) + '…' + config.token.slice(-4),
        })
        return webhookInfoPayload()
      }
      case 'restartServer':
        await stopServer()
        return startServer()
      case 'clearChatHistory': {
        await loadThreads()
        const storeKeys = [...threadIndex.values()].map((t) => t.storeKey).filter(Boolean)
        threadSessions.clear()
        threadIndex.clear()
        dirtyThreadKeys.clear()
        indexDirty = true
        await persistThreads()
        await storageSet(LEGACY_THREAD_STORE_KEY, { v: 1, threads: [] })
        for (const key of storeKeys) {
          await storageSet(key, { v: 1, messages: [] })
        }
        return { ok: true, cleared: true }
      }
      case 'loadThreadPage': {
        await loadThreads()
        const key = String(params.threadKey || '')
        if (!key) return { ok: false, error: 'missing threadKey' }
        const session = (await hydrateSession(key)) || threadSessions.get(key)
        if (!session) return { ok: true, messages: [], total: 0, hasMore: false }
        return { ok: true, ...pageFromSession(session, params.beforeId || '', params.limit) }
      }
      case 'sendTest': {
        await loadThreads()
        // Simulate phone→PC lag so delay badge / hover chain is easy to verify.
        const lagMs = 5 * 60 * 1000
        const now = Date.now()
        const phoneAt = new Date(now - lagMs)
        const n = {
          packageName: 'com.example.test',
          appName: params.appName || '测试 App',
          title: params.title || '测试通知',
          body: params.body || '这是一条 SmsForwarder 测试消息，验证码 123456',
          // phone-side receive time (5 min earlier)
          receivedAt: phoneAt.toISOString(),
          // PC webhook "arrived" now → total lag ≈ 5 min
          webhookAt: new Date(now).toISOString(),
          device: 'local-test',
          uid: `test-${now}`,
        }
        const hash = contentHash({ ...n, body: `${n.body}:${now}` })
        const otp = extractOtp(n.title, n.body, n)
        await publishNotification(n, hash, otp)
        acceptedCount += 1
        lastSuccessAt = now
        return { ok: true, otp: otp || null, lagMs }
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
    pendingCount: pendingQueue.size,
    threadCount: threadSessions.size,
  })
  try {
    await persistThreads()
  } catch {
    /* ignore */
  }
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
  loadThreads()
    .catch(() => {})
    .finally(() => {
      if (config.enabled !== false) {
        startServer().catch((err) => {
          log(
            'initial listen failed',
            { error: err instanceof Error ? err.message : String(err) },
            'error',
          )
        })
      }
    })
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

  if (message.op === 'config') {
    const cfg =
      message.config && typeof message.config === 'object'
        ? message.config
        : message.params && typeof message.params === 'object'
          ? message.params
          : null
    if (cfg) {
      applyHostConfig(cfg).catch((err) => {
        log(
          'config apply failed',
          { error: err instanceof Error ? err.message : String(err) },
          'error',
        )
      })
    }
    return
  }

  if (message.op === 'request') {
    handleRequest(message)
    return
  }

  if (message.op === 'resolved') {
    closeThreadFromResolved(message)
    log('toast resolved by host', {
      eventId: message.eventId,
      actionId: message.actionId,
      resolutionKind: message.resolutionKind,
    })
    return
  }

  if (message.op === 'response') {
    handleHostResponse(message)
  }
})
