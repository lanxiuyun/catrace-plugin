import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import readline from 'node:readline'
import tls from 'node:tls'
import { fileURLToPath } from 'node:url'
import { URL } from 'node:url'

const pluginId = process.env.CATRACE_PLUGIN_ID || 'linuxdo-notify'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STATE_PATH = path.join(__dirname, 'state.json')
const MAX_SEEN = 500
const DEFAULT_BASE_URL = 'https://linux.do'

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

const DEFAULT_CONFIG = {
  baseUrl: DEFAULT_BASE_URL,
  cookieT: '',
  cookieForumSession: '',
  cookieCfClearance: '',
  cookieExtra: '',
  sessionCookie: '',
  apiKey: '',
  apiUsername: '',
  userAgent: DEFAULT_UA,
  proxyUrl: '',
  pollIntervalSec: 60,
  cardDurationSec: 10,
  onlyWhenActive: true,
  enabled: true,
}

/** @type {typeof DEFAULT_CONFIG} */
let config = { ...DEFAULT_CONFIG }

/**
 * Seen map: notificationId -> created_at ISO (or '*').
 * @type {Map<string, string>}
 */
let seenMap = new Map()
let seeded = false
let lastPollAt = 0
let lastPollError = ''
let lastPollStatus = 0
let lastPublishAt = 0
let publishCount = 0
let pollInFlight = null
let timer = null
let hostActivityActive = null
let hostActivityAt = 0

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

function normalizeBaseUrl(input) {
  const raw = typeof input === 'string' ? input.trim() : ''
  if (!raw) return config.baseUrl || DEFAULT_BASE_URL
  try {
    const u = new URL(raw)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return config.baseUrl || DEFAULT_BASE_URL
    return `${u.protocol}//${u.host}`
  } catch {
    return config.baseUrl || DEFAULT_BASE_URL
  }
}

/** Accept http(s)://host:port or host:port (default http). Empty → ''. */
function normalizeProxyUrl(input) {
  const raw = typeof input === 'string' ? input.trim() : ''
  if (!raw) return ''
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) ? raw : `http://${raw}`
  try {
    const u = new URL(withScheme)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
    if (!u.hostname) return ''
    return u.href.replace(/\/$/, '')
  } catch {
    return ''
  }
}

/**
 * Minimal GET via HTTP CONNECT proxy (for https targets).
 * Node global fetch ignores system proxy — must tunnel ourselves.
 */
function fetchViaHttpProxy(targetUrl, { headers = {}, proxyUrl, redirect = 'manual', timeoutMs = 25_000 } = {}) {
  const target = new URL(targetUrl)
  if (target.protocol !== 'https:') {
    return Promise.reject(new Error('proxy tunnel only supports https targets'))
  }
  const proxy = new URL(proxyUrl)
  const proxyPort = Number(proxy.port) || (proxy.protocol === 'https:' ? 443 : 80)
  const connectHost = `${target.hostname}:${target.port || 443}`

  return new Promise((resolve, reject) => {
    let settled = false
    const fail = (err) => {
      if (settled) return
      settled = true
      reject(err instanceof Error ? err : new Error(String(err)))
    }
    const timer = setTimeout(() => fail(new Error('proxy connect timeout')), timeoutMs)

    const connectHeaders = {
      Host: connectHost,
      'Proxy-Connection': 'keep-alive',
    }
    if (proxy.username || proxy.password) {
      const auth = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`
      connectHeaders['Proxy-Authorization'] = `Basic ${Buffer.from(auth).toString('base64')}`
    }

    const connectReq = http.request({
      protocol: 'http:',
      host: proxy.hostname,
      port: proxyPort,
      method: 'CONNECT',
      path: connectHost,
      headers: connectHeaders,
      timeout: timeoutMs,
    })

    connectReq.on('error', fail)
    connectReq.on('timeout', () => {
      connectReq.destroy()
      fail(new Error('proxy connect timeout'))
    })

    connectReq.on('connect', (res, socket, head) => {
      if (res.statusCode !== 200) {
        socket.destroy()
        fail(new Error(`proxy CONNECT HTTP ${res.statusCode}`))
        return
      }

      const tlsSocket = tls.connect({
        socket,
        servername: target.hostname,
        ALPNProtocols: ['http/1.1'],
      })

      tlsSocket.once('error', fail)
      tlsSocket.once('timeout', () => {
        tlsSocket.destroy()
        fail(new Error('proxy tls timeout'))
      })
      tlsSocket.setTimeout(timeoutMs)

      tlsSocket.once('secureConnect', () => {
        if (head && head.length) tlsSocket.unshift(head)

        const pathAndQuery = `${target.pathname || '/'}${target.search || ''}`
        const headerLines = [
          `GET ${pathAndQuery} HTTP/1.1`,
          `Host: ${target.host}`,
          'Connection: close',
        ]
        for (const [k, v] of Object.entries(headers || {})) {
          if (v == null || v === '') continue
          if (/^host$/i.test(k) || /^connection$/i.test(k)) continue
          headerLines.push(`${k}: ${v}`)
        }
        headerLines.push('', '')
        tlsSocket.write(headerLines.join('\r\n'))

        const chunks = []
        tlsSocket.on('data', (c) => chunks.push(c))
        tlsSocket.on('end', () => {
          clearTimeout(timer)
          if (settled) return
          settled = true
          try {
            resolve(parseRawHttpResponse(Buffer.concat(chunks), redirect))
          } catch (e) {
            reject(e)
          }
        })
      })
    })

    connectReq.end()
  })
}

function parseRawHttpResponse(buf, redirect = 'manual') {
  const sep = buf.indexOf('\r\n\r\n')
  if (sep < 0) throw new Error('invalid proxy http response')
  const head = buf.subarray(0, sep).toString('latin1')
  let body = buf.subarray(sep + 4)
  const lines = head.split('\r\n')
  const statusLine = lines[0] || ''
  const m = statusLine.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})\s*(.*)$/i)
  if (!m) throw new Error(`invalid status line: ${statusLine.slice(0, 80)}`)
  const status = Number(m[1])
  const statusText = m[2] || ''
  const headers = new Headers()
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    headers.append(line.slice(0, idx).trim(), line.slice(idx + 1).trim())
  }

  // crude chunked decode
  if (/chunked/i.test(headers.get('transfer-encoding') || '')) {
    body = decodeChunked(body)
    headers.delete('transfer-encoding')
  }

  const response = new Response(body, { status, statusText, headers })
  // redirect:manual — do not follow; caller handles 3xx
  void redirect
  return response
}

function decodeChunked(buf) {
  const out = []
  let offset = 0
  while (offset < buf.length) {
    const lineEnd = buf.indexOf('\r\n', offset)
    if (lineEnd < 0) break
    const sizeLine = buf.subarray(offset, lineEnd).toString('latin1').split(';', 1)[0].trim()
    const size = parseInt(sizeLine, 16)
    if (!Number.isFinite(size)) break
    offset = lineEnd + 2
    if (size === 0) break
    out.push(buf.subarray(offset, offset + size))
    offset += size + 2 // data + CRLF
  }
  return Buffer.concat(out)
}

async function httpGet(url, { headers = {}, redirect = 'manual' } = {}) {
  const proxy = normalizeProxyUrl(config.proxyUrl)
  if (proxy) {
    try {
      return await fetchViaHttpProxy(url, { headers, proxyUrl: proxy, redirect })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      throw new Error(`proxy fetch failed (${proxy}): ${msg}`)
    }
  }
  try {
    return await fetch(url, { headers, redirect })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    throw new Error(
      `fetch failed: ${msg}。若浏览器需代理才能打开 linux.do，请在设置里填写同一代理（如 http://127.0.0.1:7890）`,
    )
  }
}

function stripCookieValue(raw, key) {
  let s = String(raw || '').trim()
  if (!s) return ''
  const re = new RegExp(`^${key}\\s*=\\s*`, 'i')
  s = s.replace(re, '')
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1)
  }
  return s.trim()
}

function parseCookieBlob(raw) {
  const out = { _t: '', _forum_session: '', cf_clearance: '' }
  const s = String(raw || '')
    .replace(/^Cookie:\s*/i, '')
    .trim()
  if (!s) return out
  for (const part of s.split(';')) {
    const idx = part.indexOf('=')
    if (idx <= 0) continue
    const k = part.slice(0, idx).trim()
    const v = part.slice(idx + 1).trim()
    if (k === '_t' && v) out._t = v
    else if (k === '_forum_session' && v) out._forum_session = v
    else if (k === 'cf_clearance' && v) out.cf_clearance = v
  }
  if (!out._t && !out._forum_session && s && !s.includes('=')) out._t = s
  return out
}

function buildSessionCookie(
  cookieT,
  cookieForumSession,
  cookieCfClearance = '',
  cookieExtra = '',
) {
  const parts = []
  const t = stripCookieValue(cookieT, '_t')
  const fs = stripCookieValue(cookieForumSession, '_forum_session')
  const cf = stripCookieValue(cookieCfClearance, 'cf_clearance')
  if (t) parts.push(`_t=${t}`)
  if (fs) parts.push(`_forum_session=${fs}`)
  if (cf) parts.push(`cf_clearance=${cf}`)
  const extra = String(cookieExtra || '')
    .replace(/^Cookie:\s*/i, '')
    .trim()
  if (extra) {
    for (const part of extra.split(';')) {
      const p = part.trim()
      if (!p || !p.includes('=')) continue
      const k = p.slice(0, p.indexOf('=')).trim()
      // avoid duplicating primary keys
      if (k === '_t' || k === '_forum_session' || k === 'cf_clearance') continue
      parts.push(p)
    }
  }
  return parts.join('; ')
}

function normalizeConfig(input = {}) {
  let cookieT =
    typeof input.cookieT === 'string' ? input.cookieT : config.cookieT
  let cookieForumSession =
    typeof input.cookieForumSession === 'string'
      ? input.cookieForumSession
      : config.cookieForumSession
  let cookieCfClearance =
    typeof input.cookieCfClearance === 'string'
      ? input.cookieCfClearance
      : config.cookieCfClearance
  let cookieExtra =
    typeof input.cookieExtra === 'string' ? input.cookieExtra : config.cookieExtra

  const legacy =
    typeof input.sessionCookie === 'string' ? input.sessionCookie : ''
  if (legacy && (!stripCookieValue(cookieT, '_t') || !stripCookieValue(cookieForumSession, '_forum_session'))) {
    const parsed = parseCookieBlob(legacy)
    if (!stripCookieValue(cookieT, '_t') && parsed._t) cookieT = parsed._t
    if (!stripCookieValue(cookieForumSession, '_forum_session') && parsed._forum_session) {
      cookieForumSession = parsed._forum_session
    }
    if (!stripCookieValue(cookieCfClearance, 'cf_clearance') && parsed.cf_clearance) {
      cookieCfClearance = parsed.cf_clearance
    }
  }

  cookieT = stripCookieValue(cookieT, '_t')
  cookieForumSession = stripCookieValue(cookieForumSession, '_forum_session')
  cookieCfClearance = stripCookieValue(cookieCfClearance, 'cf_clearance')
  cookieExtra = String(cookieExtra || '')
    .replace(/^Cookie:\s*/i, '')
    .trim()

  const apiKey =
    typeof input.apiKey === 'string' ? input.apiKey.trim() : String(config.apiKey || '').trim()
  const apiUsername =
    typeof input.apiUsername === 'string'
      ? input.apiUsername.trim()
      : String(config.apiUsername || '').trim()
  const userAgentRaw =
    typeof input.userAgent === 'string' ? input.userAgent.trim() : String(config.userAgent || '').trim()
  const userAgent = userAgentRaw || DEFAULT_UA

  const next = {
    baseUrl: normalizeBaseUrl(input.baseUrl ?? config.baseUrl),
    cookieT,
    cookieForumSession,
    cookieCfClearance,
    cookieExtra,
    sessionCookie: buildSessionCookie(cookieT, cookieForumSession, cookieCfClearance, cookieExtra),
    apiKey,
    apiUsername,
    userAgent,
    proxyUrl: normalizeProxyUrl(input.proxyUrl ?? config.proxyUrl),
    pollIntervalSec: clampInt(input.pollIntervalSec, 15, 3600, config.pollIntervalSec),
    cardDurationSec: clampInt(input.cardDurationSec, 0, 600, config.cardDurationSec),
    onlyWhenActive: input.onlyWhenActive !== false,
    enabled: input.enabled !== false,
  }
  if (typeof input.activityActive === 'boolean') {
    hostActivityActive = input.activityActive
    hostActivityAt = Date.now()
  }
  return next
}

function loadState() {
  try {
    if (!fs.existsSync(STATE_PATH)) return
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))
    seenMap = new Map()
    if (raw.seen && typeof raw.seen === 'object' && !Array.isArray(raw.seen)) {
      for (const [id, stamp] of Object.entries(raw.seen)) {
        if (id) seenMap.set(String(id), String(stamp || ''))
      }
    } else if (Array.isArray(raw.seenIds)) {
      for (const id of raw.seenIds) {
        if (id) seenMap.set(String(id), '*')
      }
    }
    if (raw.seeded === true) seeded = true
  } catch (error) {
    log(
      'load state failed',
      { error: error instanceof Error ? error.message : String(error) },
      'warn',
    )
  }
}

function saveState() {
  try {
    if (seenMap.size > MAX_SEEN) {
      const entries = [...seenMap.entries()].slice(-MAX_SEEN)
      seenMap = new Map(entries)
    }
    const seen = {}
    for (const [id, stamp] of seenMap) seen[id] = stamp
    fs.writeFileSync(
      STATE_PATH,
      JSON.stringify({
        seen,
        seeded,
        savedAt: new Date().toISOString(),
      }),
      'utf8',
    )
  } catch (error) {
    log(
      'save state failed',
      { error: error instanceof Error ? error.message : String(error) },
      'warn',
    )
  }
}

function itemStamp(item) {
  return String(item?.created_at || item?.createdAt || item?.updated_at || '')
}

function itemId(item) {
  if (item?.id != null) return String(item.id)
  // fallback composite
  const tid = item?.topic_id ?? item?.data?.topic_id ?? ''
  const pn = item?.post_number ?? item?.data?.post_number ?? ''
  const t = item?.notification_type ?? item?.type ?? ''
  const c = itemStamp(item)
  if (tid || pn || t || c) return `${t}:${tid}:${pn}:${c}`
  return ''
}

function isFresh(item) {
  const id = itemId(item)
  if (!id) return false
  const stamp = itemStamp(item)
  const prev = seenMap.get(id)
  if (prev == null) return true
  if (prev === '*') return false
  if (!stamp) return false
  return stamp !== prev
}

function markSeen(item) {
  const id = itemId(item)
  if (!id) return
  seenMap.set(id, itemStamp(item) || '*')
}

/** Discourse notification_type → label (common subset). */
function typeLabel(type) {
  const map = {
    1: '提到你',
    2: '回复了你',
    3: '引用了你',
    4: '编辑了',
    5: '点赞了',
    6: '私信',
    9: '发了私信',
    12: '徽章',
    13: '邀请',
    17: '群组提及',
    24: '书签提醒',
    25: '反应',
    29: '关注的话题有新帖',
  }
  const n = Number(type)
  if (Number.isFinite(n) && map[n]) return map[n]
  if (typeof type === 'string' && type) return type
  return '通知'
}

function typeShort(type) {
  const map = {
    1: '提及',
    2: '回复',
    3: '引用',
    5: '赞',
    6: '私信',
    9: '私信',
    25: '反应',
    29: '关注',
  }
  const n = Number(type)
  return (Number.isFinite(n) && map[n]) || typeLabel(type)
}

function plainExcerpt(raw, maxLen = 180) {
  let s = String(raw || '')
  s = s.replace(/<[^>]+>/g, ' ')
  s = s.replace(/&nbsp;/g, ' ')
  s = s.replace(/&amp;/g, '&')
  s = s.replace(/&lt;/g, '<')
  s = s.replace(/&gt;/g, '>')
  s = s.replace(/&quot;/g, '"')
  s = s.replace(/\s+/g, ' ').trim()
  if (!s) return ''
  if (s.length <= maxLen) return s
  return `${s.slice(0, maxLen - 1).trimEnd()}…`
}

function buildHtmlUrl(item) {
  const base = config.baseUrl || DEFAULT_BASE_URL
  const data = item?.data || {}
  const topicId = item?.topic_id ?? data.topic_id
  const postNumber = item?.post_number ?? data.post_number
  const slug = data.topic_title
    ? String(data.topic_title)
        .toLowerCase()
        .replace(/[^\w\u4e00-\u9fff]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'topic'
    : 'topic'

  if (topicId != null && postNumber != null) {
    return `${base}/t/${slug}/${topicId}/${postNumber}`
  }
  if (topicId != null) {
    return `${base}/t/${slug}/${topicId}`
  }
  // PM / badge etc.
  if (data.original_username && data.display_username) {
    return `${base}/u/${data.original_username || data.display_username}`
  }
  return `${base}/my/notifications`
}

function cookieHeader() {
  const built = buildSessionCookie(
    config.cookieT,
    config.cookieForumSession,
    config.cookieCfClearance,
    config.cookieExtra,
  )
  if (built) return built
  const raw = String(config.sessionCookie || '').trim()
  if (!raw) return ''
  return raw.replace(/^Cookie:\s*/i, '')
}

function hasApiAuth() {
  return Boolean(String(config.apiKey || '').trim() && String(config.apiUsername || '').trim())
}

function hasSessionAuth() {
  return Boolean(cookieHeader())
}

function authHeaders() {
  const cookie = cookieHeader()
  const base = config.baseUrl || DEFAULT_BASE_URL
  const ua = String(config.userAgent || '').trim() || DEFAULT_UA
  const headers = {
    Accept: 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    // cf_clearance is bound to the UA that passed the challenge — must match browser
    'User-Agent': ua,
    'X-Requested-With': 'XMLHttpRequest',
    // Discourse JSON convention
    'Discourse-Present': 'true',
    Referer: `${base}/`,
    Origin: base,
    'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
  }
  if (cookie) headers.Cookie = cookie
  // Prefer official Discourse API headers when provided
  const apiKey = String(config.apiKey || '').trim()
  const apiUsername = String(config.apiUsername || '').trim()
  if (apiKey && apiUsername) {
    headers['Api-Key'] = apiKey
    headers['Api-Username'] = apiUsername
  }
  return headers
}

function isCloudflareChallenge(status, text) {
  const body = String(text || '')
  if (/just a moment/i.test(body)) return true
  if (/cf-browser-verification|challenge-platform|cdn-cgi\/challenge/i.test(body)) return true
  if (status === 403 && /cloudflare|cf-ray/i.test(body)) return true
  return false
}

function toEvent(item) {
  const data = item?.data || {}
  const nType = item?.notification_type ?? item?.type
  const short = typeShort(nType)
  const label = typeLabel(nType)
  const topicTitle = data.topic_title || data.title || ''
  const username =
    data.display_username || data.original_username || data.username || item?.acting_user?.username || ''
  const excerpt = plainExcerpt(data.excerpt || data.message || item?.fancy_title || '')
  const createdAt = itemStamp(item) || new Date().toISOString()
  const htmlUrl = buildHtmlUrl(item)
  const cardSec = clampInt(config.cardDurationSec, 0, 600, 10)
  const sticky = cardSec <= 0
  const id = itemId(item)

  let body = topicTitle || label
  if (excerpt) {
    const who = username ? `${username}: ` : ''
    body = topicTitle ? `${topicTitle}\n${who}${excerpt}` : `${who}${excerpt}`
  } else if (username && topicTitle) {
    body = `${username} · ${topicTitle}`
  }

  return {
    eventType: 'linuxdo-notify.notification',
    kind: 'linuxdo-notify',
    title: topicTitle ? `${short} · ${topicTitle}` : short,
    body,
    level: 'info',
    sticky,
    actions: [
      { id: 'open', label: '打开' },
      { id: 'dismiss', label: sticky ? '知道了' : '关闭' },
    ],
    payload: {
      notification_id: id,
      notification_type: nType,
      type_label: label,
      topic_id: item?.topic_id ?? data.topic_id ?? null,
      topic_title: topicTitle,
      post_number: item?.post_number ?? data.post_number ?? null,
      excerpt,
      acting_username: username,
      html_url: htmlUrl,
      created_at: createdAt,
      read: item?.read === true,
      auto_hide_ms: sticky ? 0 : cardSec * 1000,
      card_duration_sec: cardSec,
    },
    dedupeKey: `linuxdo-notify:${id}:${createdAt}`,
  }
}

function publishItem(item) {
  const event = toEvent(item)
  send({ v: 1, op: 'publish', event })
  lastPublishAt = Date.now()
  publishCount += 1
}

function mayPublishNow() {
  if (config.onlyWhenActive === false) return true
  if (hostActivityActive != null && Date.now() - hostActivityAt < 90_000) {
    return hostActivityActive === true
  }
  return true
}

function statusPayload() {
  return {
    pluginId,
    pid: process.pid,
    seeded,
    enabled: config.enabled !== false,
    baseUrl: config.baseUrl,
    proxyUrl: config.proxyUrl || '',
    hasProxy: Boolean(config.proxyUrl),
    hasApiAuth: hasApiAuth(),
    hasCookie: Boolean(cookieHeader()),
    hasCookieT: Boolean(stripCookieValue(config.cookieT, '_t')),
    hasCookieForumSession: Boolean(
      stripCookieValue(config.cookieForumSession, '_forum_session'),
    ),
    hasCfClearance: Boolean(stripCookieValue(config.cookieCfClearance, 'cf_clearance')),
    userAgent: String(config.userAgent || DEFAULT_UA).slice(0, 80),
    pollIntervalSec: config.pollIntervalSec,
    cardDurationSec: config.cardDurationSec,
    onlyWhenActive: config.onlyWhenActive !== false,
    seenCount: seenMap.size,
    lastPollAt,
    lastPollStatus,
    lastPollError: lastPollError || null,
    lastPublishAt,
    publishCount,
    hostActivityActive,
    hostActivityAgeMs: hostActivityAt ? Date.now() - hostActivityAt : null,
  }
}

function cloudflareHint() {
  const bits = [
    'Cloudflare 拦截（Just a moment）',
    'Node 过不了 JS 挑战',
    '请：① 代理与浏览器相同',
    '② User-Agent 与浏览器完全一致（F12→Network→任意请求→Request Headers）',
    '③ 刚过验证后立刻复制 cf_clearance（可再附 __cf_bm）',
    '④ 更稳：用站内 API Key + 用户名（偏好设置→安全/API）',
  ]
  if (!config.proxyUrl) bits.push('当前未配代理')
  if (!stripCookieValue(config.cookieCfClearance, 'cf_clearance')) bits.push('当前未填 cf_clearance')
  if (!hasApiAuth()) bits.push('当前未配 API Key')
  return bits.join('。') + '。'
}

async function fetchNotifications() {
  if (!hasApiAuth() && !hasSessionAuth()) {
    lastPollError = 'missing auth（填 API Key+用户名，或 Cookie）'
    lastPollStatus = 0
    return { status: 0, items: [], skipped: true }
  }

  const base = config.baseUrl || DEFAULT_BASE_URL
  const url = `${base}/notifications.json?recent=true&limit=60`

  const res = await httpGet(url, {
    headers: authHeaders(),
    redirect: 'manual',
  })
  lastPollStatus = res.status
  lastPollAt = Date.now()

  // login redirect / unauth
  if (res.status === 301 || res.status === 302 || res.status === 303 || res.status === 307) {
    lastPollError = `redirect ${res.status}（Cookie/API 可能失效，或需代理）`
    throw new Error(lastPollError)
  }

  if (res.status === 401 || res.status === 403) {
    const text = await res.text().catch(() => '')
    if (isCloudflareChallenge(res.status, text)) {
      lastPollError = cloudflareHint()
      throw new Error(lastPollError)
    }
    lastPollError = `HTTP ${res.status}${text ? `: ${text.slice(0, 120)}` : ''}`
    throw new Error(lastPollError)
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    if (isCloudflareChallenge(res.status, text)) {
      lastPollError = cloudflareHint()
      throw new Error(lastPollError)
    }
    lastPollError = `HTTP ${res.status}${text ? `: ${text.slice(0, 120)}` : ''}`
    throw new Error(lastPollError)
  }

  const ct = (res.headers.get('content-type') || '').toLowerCase()
  const text = await res.text()
  if (isCloudflareChallenge(res.status, text)) {
    lastPollError = cloudflareHint()
    throw new Error(lastPollError)
  }
  if (ct.includes('text/html') || text.trimStart().startsWith('<!')) {
    lastPollError = 'got HTML（未登录、Cookie 无效，或被 Cloudflare 拦）'
    throw new Error(lastPollError)
  }

  let data
  try {
    data = JSON.parse(text)
  } catch {
    lastPollError = 'invalid JSON response'
    throw new Error(lastPollError)
  }

  lastPollError = ''
  const items = Array.isArray(data?.notifications)
    ? data.notifications
    : Array.isArray(data)
      ? data
      : []
  return { status: res.status, items, skipped: false }
}

/**
 * @param {{ forceSeed?: boolean }} [opts]
 */
async function pollOnce({ forceSeed = false } = {}) {
  if (pollInFlight) return pollInFlight
  pollInFlight = (async () => {
    try {
      if (config.enabled === false) {
        return { ok: true, skipped: true, reason: 'disabled', newCount: 0 }
      }

      const result = await fetchNotifications()
      if (result.skipped) {
        return { ok: true, skipped: true, reason: 'no-cookie', newCount: 0 }
      }

      if (!seeded || forceSeed) {
        for (const item of result.items) markSeen(item)
        seeded = true
        saveState()
        log('baseline seeded', { count: result.items.length })
        return { ok: true, seeded: true, newCount: 0, fetched: result.items.length }
      }

      const fresh = result.items.filter((item) => isFresh(item))
      if (!fresh.length) {
        saveState()
        return { ok: true, newCount: 0, fetched: result.items.length }
      }

      if (!mayPublishNow()) {
        log('new notifications held (inactive)', {
          count: fresh.length,
          titles: fresh.slice(0, 5).map((i) => i?.data?.topic_title || itemId(i)),
        })
        return { ok: true, newCount: 0, held: fresh.length, fetched: result.items.length }
      }

      // newest first typically — publish oldest-of-batch first for reading order
      const ordered = [...fresh].reverse()
      for (const item of ordered) {
        publishItem(item)
        markSeen(item)
      }
      saveState()
      log('published notifications', {
        count: ordered.length,
        titles: ordered.slice(0, 5).map((i) => i?.data?.topic_title || itemId(i)),
      })
      return { ok: true, newCount: ordered.length, fetched: result.items.length }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log(
        'poll failed',
        { error: message },
        /401|403|cookie|login|HTML|redirect/i.test(message) ? 'warn' : 'error',
      )
      return { ok: false, error: message }
    } finally {
      pollInFlight = null
    }
  })()
  return pollInFlight
}

function schedule() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  if (config.enabled === false) return
  const ms = clampInt(config.pollIntervalSec, 15, 3600, 60) * 1000
  timer = setInterval(() => {
    pollOnce().catch(() => {})
  }, ms)
  timer.unref?.()
}

function applyHostConfig(input) {
  config = normalizeConfig(input || {})
  log('config applied', {
    baseUrl: config.baseUrl,
    hasCookie: Boolean(cookieHeader()),
    hasApiAuth: hasApiAuth(),
    hasProxy: Boolean(config.proxyUrl),
    proxyUrl: config.proxyUrl ? config.proxyUrl.replace(/\/\/([^:@/]+):([^@/]+)@/, '//$1:***@') : '',
    hasCfClearance: Boolean(stripCookieValue(config.cookieCfClearance, 'cf_clearance')),
    pollIntervalSec: config.pollIntervalSec,
    cardDurationSec: config.cardDurationSec,
    onlyWhenActive: config.onlyWhenActive,
    enabled: config.enabled,
    activityActive: hostActivityActive,
  })
  schedule()
}

function handleRequest(message) {
  const requestId = message.requestId || message.id
  if (!requestId) return
  const method = String(message.method || '')
  const params = message.params && typeof message.params === 'object' ? message.params : {}

  try {
    switch (method) {
      case 'getStatus':
        respond(requestId, true, statusPayload())
        break
      case 'setConfig':
        applyHostConfig(params)
        respond(requestId, true, statusPayload())
        break
      case 'setActivity': {
        if (typeof params.active === 'boolean') {
          hostActivityActive = params.active
          hostActivityAt = Date.now()
        }
        respond(requestId, true, { active: hostActivityActive, at: hostActivityAt })
        break
      }
      case 'pollNow':
        pollOnce({ forceSeed: params.forceSeed === true })
          .then((result) => respond(requestId, true, { ...statusPayload(), ...result }))
          .catch((error) =>
            respond(requestId, false, null, error instanceof Error ? error.message : String(error)),
          )
        break
      case 'resetSeen':
        seenMap = new Map()
        seeded = false
        saveState()
        respond(requestId, true, statusPayload())
        break
      default:
        respond(requestId, false, null, `unknown method: ${method}`)
    }
  } catch (error) {
    respond(requestId, false, null, error instanceof Error ? error.message : String(error))
  }
}

function shutdown() {
  log('graceful shutdown', { seen: seenMap.size, publishCount })
  if (timer) clearInterval(timer)
  saveState()
  process.exit(0)
}

loadState()
send({ v: 1, op: 'ready' })
log('linuxdo-notify sidecar ready', {
  pluginId,
  pid: process.pid,
  protocol: process.env.CATRACE_PROTOCOL_VERSION,
  seenCount: seenMap.size,
  seeded,
})

setTimeout(() => {
  pollOnce().catch(() => {})
  schedule()
}, 800).unref?.()

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }

  if (message.op === 'shutdown') {
    shutdown()
    return
  }

  if (message.op === 'config' && message.config && typeof message.config === 'object') {
    applyHostConfig(message.config)
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
