import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

const pluginId = process.env.CATRACE_PLUGIN_ID || 'github-notify'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STATE_PATH = path.join(__dirname, 'state.json')
const API_URL = 'https://api.github.com/notifications?all=false&participating=false'
const MAX_SEEN = 500
/** After this many consecutive 304s, force a full body fetch once. */
const FORCE_FULL_AFTER_304 = 6

const DEFAULT_CONFIG = {
  token: '',
  pollIntervalSec: 60,
  cardDurationSec: 10,
  onlyWhenActive: true,
  enabled: true,
}

/** @type {typeof DEFAULT_CONFIG} */
let config = { ...DEFAULT_CONFIG }

/**
 * Seen map: notificationId -> last published updated_at (ISO).
 * Same thread with newer updated_at = new activity → publish again.
 * @type {Map<string, string>}
 */
let seenMap = new Map()
/** @type {string | null} */
let lastModified = null
/** @type {string | null} */
let etag = null
let seeded = false
let lastPollAt = 0
let lastPollError = ''
let lastPollStatus = 0
let lastPublishAt = 0
let publishCount = 0
let consecutive304 = 0
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

function normalizeConfig(input = {}) {
  const next = {
    token: typeof input.token === 'string' ? input.token.trim() : config.token,
    pollIntervalSec: clampInt(input.pollIntervalSec, 1, 3600, config.pollIntervalSec),
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
    // New format: { seen: { id: updatedAt } }
    if (raw.seen && typeof raw.seen === 'object' && !Array.isArray(raw.seen)) {
      for (const [id, updatedAt] of Object.entries(raw.seen)) {
        if (id) seenMap.set(String(id), String(updatedAt || ''))
      }
    } else if (Array.isArray(raw.seenIds)) {
      // Legacy: id-only → treat as seen with empty stamp (won't re-fire until updated_at changes... 
      // empty means any real updated_at is "newer" → would re-fire all. Use '*' sentinel = fully seen once.
      for (const id of raw.seenIds) {
        if (id) seenMap.set(String(id), '*')
      }
    }
    if (typeof raw.lastModified === 'string') lastModified = raw.lastModified
    if (typeof raw.etag === 'string') etag = raw.etag
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
    // Cap map size
    if (seenMap.size > MAX_SEEN) {
      const entries = [...seenMap.entries()].slice(-MAX_SEEN)
      seenMap = new Map(entries)
    }
    const seen = {}
    for (const [id, updatedAt] of seenMap) seen[id] = updatedAt
    fs.writeFileSync(
      STATE_PATH,
      JSON.stringify({
        seen,
        lastModified,
        etag,
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

function itemUpdatedAt(item) {
  return String(item?.updated_at || item?.updatedAt || '')
}

/** True if we should treat this notification as new activity. */
function isFresh(item) {
  const id = String(item?.id || '')
  if (!id) return false
  const updatedAt = itemUpdatedAt(item)
  const prev = seenMap.get(id)
  if (prev == null) return true
  if (prev === '*') return false
  if (!updatedAt) return false
  return updatedAt !== prev
}

function markSeen(item) {
  const id = String(item?.id || '')
  if (!id) return
  seenMap.set(id, itemUpdatedAt(item) || '*')
}

function subjectTypeLabel(type) {
  const t = String(type || '').toLowerCase()
  if (t === 'pullrequest') return 'PR'
  if (t === 'issue') return 'Issue'
  if (t === 'commit') return 'Commit'
  if (t === 'release') return 'Release'
  if (t === 'discussion') return 'Discussion'
  if (t === 'checksuite' || t === 'checkrun') return 'Check'
  if (t === 'repositoryinvitation') return 'Invite'
  if (t === 'repositoryvulnerabilityalert') return 'Security'
  return type ? String(type) : 'Notice'
}

function reasonLabel(reason) {
  const map = {
    assign: '被指派',
    author: '你创建的',
    comment: '新评论',
    ci_activity: 'CI',
    invitation: '邀请',
    manual: '已订阅',
    mention: '提到你',
    review_requested: '请求评审',
    security_alert: '安全告警',
    state_change: '状态变更',
    subscribed: '订阅',
    team_mention: '团队提及',
  }
  return map[String(reason || '')] || reason || ''
}

function htmlUrlFrom(item) {
  const subject = item.subject || {}
  const latest = subject.latest_comment_url || subject.url || ''
  if (typeof item.repository?.html_url === 'string' && !latest) {
    return item.repository.html_url
  }
  if (typeof latest === 'string' && latest.includes('api.github.com/repos/')) {
    return latest
      .replace('https://api.github.com/repos/', 'https://github.com/')
      .replace(/\/pulls\//, '/pull/')
      .replace(/\/comments\/\d+$/, '')
  }
  if (typeof subject.url === 'string' && subject.url.includes('api.github.com/repos/')) {
    return subject.url
      .replace('https://api.github.com/repos/', 'https://github.com/')
      .replace(/\/pulls\//, '/pull/')
  }
  return item.repository?.html_url || 'https://github.com/notifications'
}

function authHeaders() {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${config.token}`,
    'User-Agent': 'catrace-github-notify',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

/** Strip markdown-ish noise for toast body. */
function plainSnippet(raw, maxLen = 180) {
  let s = String(raw || '')
  // HTML comments / zero-width
  s = s.replace(/<!--[\s\S]*?-->/g, '')
  // fenced code → short marker
  s = s.replace(/```[\s\S]*?```/g, '[代码]')
  // images
  s = s.replace(/!\[[^\]]*\]\([^)]+\)/g, '')
  // links keep label
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  // headings / quotes / lists
  s = s.replace(/^#{1,6}\s+/gm, '')
  s = s.replace(/^>\s?/gm, '')
  s = s.replace(/^[-*+]\s+/gm, '· ')
  s = s.replace(/`([^`]+)`/g, '$1')
  s = s.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n')
  s = s.replace(/[ \t]+\n/g, '\n').trim()
  if (!s) return ''
  if (s.length <= maxLen) return s
  return `${s.slice(0, maxLen - 1).trimEnd()}…`
}

/**
 * Notifications API has no body. Pull subject / latest_comment for snippet.
 * Prefer latest_comment_url (what triggered the ping), else subject.url.
 */
async function fetchBodySnippet(item) {
  const subject = item.subject || {}
  const urls = []
  if (subject.latest_comment_url) urls.push(subject.latest_comment_url)
  if (subject.url) urls.push(subject.url)

  for (const url of urls) {
    if (typeof url !== 'string' || !url.startsWith('https://api.github.com/')) continue
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 4000)
      const res = await fetch(url, { headers: authHeaders(), signal: ctrl.signal })
      clearTimeout(t)
      if (!res.ok) continue
      const data = await res.json()
      // comment / review comment / issue / PR / commit / release / discussion
      const raw =
        data.body ||
        data.body_html ||
        data.commit?.message ||
        data.message ||
        data.pull_request?.body ||
        ''
      const snippet = plainSnippet(raw)
      if (snippet) {
        return {
          snippet,
          author: data.user?.login || data.author?.login || data.actor?.login || '',
          html_url: data.html_url || '',
        }
      }
    } catch {
      /* try next url */
    }
  }
  return { snippet: '', author: '', html_url: '' }
}

async function toEvent(item) {
  const repo = item.repository?.full_name || item.repository?.name || 'GitHub'
  const subject = item.subject || {}
  const typeLabel = subjectTypeLabel(subject.type)
  const reason = reasonLabel(item.reason)
  const title = subject.title || 'GitHub 通知'
  let htmlUrl = htmlUrlFrom(item)
  const updatedAt = itemUpdatedAt(item) || new Date().toISOString()
  const cardSec = clampInt(config.cardDurationSec, 0, 600, 10)
  const sticky = cardSec <= 0

  const detail = await fetchBodySnippet(item)
  if (detail.html_url) htmlUrl = detail.html_url

  // body: title first line, then snippet
  let body = title
  if (detail.snippet) {
    const who = detail.author ? `${detail.author}: ` : ''
    body = `${title}\n${who}${detail.snippet}`
  }

  return {
    eventType: 'github-notify.notification',
    kind: 'github-notify',
    title: `${typeLabel} · ${repo}`,
    body,
    level: 'info',
    sticky,
    actions: [
      { id: 'open', label: '打开' },
      { id: 'dismiss', label: sticky ? '知道了' : '关闭' },
    ],
    payload: {
      notification_id: String(item.id || ''),
      repo,
      subject_type: subject.type || '',
      subject_title: title,
      body_snippet: detail.snippet || '',
      body_author: detail.author || '',
      reason: item.reason || '',
      reason_label: reason,
      html_url: htmlUrl,
      updated_at: updatedAt,
      unread: item.unread !== false,
      auto_hide_ms: sticky ? 0 : cardSec * 1000,
      card_duration_sec: cardSec,
    },
    dedupeKey: `github-notify:${item.id}:${updatedAt}`,
  }
}

async function publishItem(item) {
  const event = await toEvent(item)
  send({ v: 1, op: 'publish', event })
  lastPublishAt = Date.now()
  publishCount += 1
}

function mayPublishNow() {
  if (config.onlyWhenActive === false) return true
  if (hostActivityActive != null && Date.now() - hostActivityAt < 90_000) {
    return hostActivityActive === true
  }
  // No heartbeat → allow (don't silently drop)
  return true
}

function statusPayload() {
  return {
    pluginId,
    pid: process.pid,
    seeded,
    enabled: config.enabled !== false,
    hasToken: Boolean(config.token),
    pollIntervalSec: config.pollIntervalSec,
    cardDurationSec: config.cardDurationSec,
    onlyWhenActive: config.onlyWhenActive !== false,
    seenCount: seenMap.size,
    lastPollAt,
    lastPollStatus,
    lastPollError: lastPollError || null,
    lastPublishAt,
    publishCount,
    consecutive304,
    hostActivityActive,
    hostActivityAgeMs: hostActivityAt ? Date.now() - hostActivityAt : null,
    lastModified,
    etag,
  }
}

/**
 * @param {{ forceFull?: boolean }} [opts]
 */
async function fetchNotifications({ forceFull = false } = {}) {
  if (!config.token) {
    lastPollError = 'missing token'
    lastPollStatus = 0
    return { status: 0, items: [], notModified: false, skipped: true }
  }

  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${config.token}`,
    'User-Agent': 'catrace-github-notify',
    'X-GitHub-Api-Version': '2022-11-28',
  }

  const useConditional =
    !forceFull && consecutive304 < FORCE_FULL_AFTER_304 && (lastModified || etag)

  if (useConditional) {
    if (lastModified) headers['If-Modified-Since'] = lastModified
    if (etag) headers['If-None-Match'] = etag
  }

  const res = await fetch(API_URL, { headers })
  lastPollStatus = res.status
  lastPollAt = Date.now()

  if (res.status === 304) {
    consecutive304 += 1
    lastPollError = ''
    // After many 304s, next poll will forceFull via FORCE_FULL_AFTER_304
    return { status: 304, items: [], notModified: true, skipped: false }
  }

  consecutive304 = 0

  if (res.status === 401 || res.status === 403) {
    const text = await res.text().catch(() => '')
    lastPollError = `HTTP ${res.status}${text ? `: ${text.slice(0, 120)}` : ''}`
    throw new Error(lastPollError)
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    lastPollError = `HTTP ${res.status}${text ? `: ${text.slice(0, 120)}` : ''}`
    throw new Error(lastPollError)
  }

  const lm = res.headers.get('last-modified')
  const tag = res.headers.get('etag')
  if (lm) lastModified = lm
  if (tag) etag = tag

  const data = await res.json()
  lastPollError = ''
  return {
    status: res.status,
    items: Array.isArray(data) ? data : [],
    notModified: false,
    skipped: false,
  }
}

/**
 * @param {{ forceSeed?: boolean, forceFull?: boolean }} [opts]
 */
async function pollOnce({ forceSeed = false, forceFull = false } = {}) {
  if (pollInFlight) return pollInFlight
  pollInFlight = (async () => {
    try {
      if (config.enabled === false) {
        return { ok: true, skipped: true, reason: 'disabled', newCount: 0 }
      }

      // Manual pull or too many 304s → skip conditional headers
      const doFull = forceFull || consecutive304 >= FORCE_FULL_AFTER_304
      if (doFull && consecutive304 >= FORCE_FULL_AFTER_304) {
        log('force full fetch after consecutive 304', { consecutive304 })
      }

      const result = await fetchNotifications({ forceFull: doFull })
      if (result.skipped) {
        return { ok: true, skipped: true, reason: 'no-token', newCount: 0 }
      }
      if (result.notModified) {
        return { ok: true, notModified: true, newCount: 0, consecutive304 }
      }

      // Baseline: mark everything currently unread as seen, no toast
      if (!seeded || forceSeed) {
        for (const item of result.items) markSeen(item)
        seeded = true
        saveState()
        log('baseline seeded', { count: result.items.length })
        return { ok: true, seeded: true, newCount: 0, fetched: result.items.length }
      }

      const fresh = result.items.filter((item) => isFresh(item))
      if (!fresh.length) {
        // Still refresh stamps for items we already know (updated_at catch-up without toast? no)
        saveState()
        return { ok: true, newCount: 0, fetched: result.items.length }
      }

      if (!mayPublishNow()) {
        // Do NOT mark seen — keep for next active poll
        log('new notifications held (inactive)', {
          count: fresh.length,
          titles: fresh.slice(0, 5).map((i) => i.subject?.title || i.id),
        })
        return { ok: true, newCount: 0, held: fresh.length, fetched: result.items.length }
      }

      for (const item of fresh) {
        await publishItem(item)
        markSeen(item)
      }
      saveState()
      log('published notifications', {
        count: fresh.length,
        titles: fresh.slice(0, 5).map((i) => i.subject?.title || i.id),
      })
      return { ok: true, newCount: fresh.length, fetched: result.items.length }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log('poll failed', { error: message }, /401|403|missing token/i.test(message) ? 'warn' : 'error')
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
  const ms = clampInt(config.pollIntervalSec, 1, 3600, 60) * 1000
  timer = setInterval(() => {
    pollOnce().catch(() => {})
  }, ms)
  timer.unref?.()
}

function applyHostConfig(input) {
  config = normalizeConfig(input || {})
  log('config applied', {
    hasToken: Boolean(config.token),
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
        // Always full body on manual pull so 304 cannot hide new items
        pollOnce({ forceSeed: params.forceSeed === true, forceFull: true })
          .then((result) => respond(requestId, true, { ...statusPayload(), ...result }))
          .catch((error) =>
            respond(requestId, false, null, error instanceof Error ? error.message : String(error)),
          )
        break
      case 'resetSeen':
        seenMap = new Map()
        seeded = false
        lastModified = null
        etag = null
        consecutive304 = 0
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
log('github-notify sidecar ready', {
  pluginId,
  pid: process.pid,
  protocol: process.env.CATRACE_PROTOCOL_VERSION,
  seenCount: seenMap.size,
  seeded,
})

setTimeout(() => {
  pollOnce({ forceFull: true }).catch(() => {})
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
