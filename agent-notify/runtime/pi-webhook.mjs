import { timingSafeEqual } from 'node:crypto'
import { PI_EVENTS } from './pi-config.mjs'
import { cleanTitle, projectName } from './hook-data.mjs'
import { piNavigation } from './pi-navigation.mjs'

const EVENT_MAP = {
  started: 'UserPromptSubmit', completed: 'Stop', error: 'StopFailure', waiting: 'Notification',
  tool_error: 'PostToolUseFailure', session_started: 'SessionStart', test: 'Notification',
}
const BODY_LIMIT = 64 * 1024

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

export function normalizePiEvent(raw) {
  if (!object(raw) || raw.schemaVersion !== 1 || raw.source !== 'pi') throw new Error('Expected Pi Webhook schemaVersion 1')
  if (typeof raw.id !== 'string' || !raw.id.trim() || raw.id.length > 128) throw new Error('Invalid event ID')
  if (![...PI_EVENTS, 'test'].includes(raw.type)) throw new Error('Unsupported Pi event')
  if (!object(raw.session) || typeof raw.session.id !== 'string' || !raw.session.id.trim() || raw.session.id.length > 512) throw new Error('Invalid session ID')
  if (typeof raw.timestamp !== 'string' || !Number.isFinite(Date.parse(raw.timestamp))) throw new Error('Invalid timestamp')
  if (!object(raw.data)) throw new Error('Expected event data object')
  for (const key of ['name', 'cwd']) {
    if (raw.session[key] !== undefined && typeof raw.session[key] !== 'string') throw new Error(`Invalid session ${key}`)
  }
  if (raw.data.message !== undefined && typeof raw.data.message !== 'string') throw new Error('Invalid message')
  const cwd = raw.session.cwd || ''
  return {
    agentId: 'pi', event: EVENT_MAP[raw.type] || '', sessionId: `pi:${raw.session.id}`,
    sessionTitle: `Pi · ${cleanTitle(raw.session.name || '') || '未命名会话'}`, projectName: projectName(cwd), cwd,
    timestamp: raw.timestamp, message: raw.type === 'test' ? 'Pi Webhook 连接测试成功' : (raw.data.message || '').slice(0, 2000),
    ...piNavigation(raw.session.navigation, raw.session.id), raw,
  }
}

function reply(res, status, value) {
  if (res.destroyed) return
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(value))
}

function authorized(req, token) {
  const actual = Buffer.from(req.headers.authorization || '')
  const expected = Buffer.from(`Bearer ${token}`)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

async function readEvent(req) {
  let timer
  try {
    return await new Promise((resolve, reject) => {
      let bytes = 0
      let finished = false
      const chunks = []
      timer = setTimeout(() => {
        finished = true
        chunks.length = 0
        reject(Object.assign(new Error('Request body timed out'), { status: 408 }))
      }, 5000)
      req.on('data', (chunk) => {
        if (finished) return
        bytes += chunk.length
        if (bytes > BODY_LIMIT) {
          finished = true
          chunks.length = 0
          reject(Object.assign(new Error('Payload too large'), { status: 413 }))
        } else chunks.push(chunk)
      })
      req.on('end', () => {
        if (finished) return
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch {
          reject(Object.assign(new Error('Invalid JSON'), { status: 400 }))
        }
      })
      req.on('aborted', () => reject(new Error('Request aborted')))
      req.on('error', reject)
    })
  } finally { clearTimeout(timer) }
}

// Route handler only. The existing Agent HTTP server owns the listener and lifecycle.
export function createPiHandler({ token, onEvent, log = () => {} }) {
  if (!/^[a-f0-9]{64}$/.test(token || '')) throw new Error('Invalid Pi receiver token')
  const seen = new Map()
  const inFlight = new Map()
  let active = 0
  const handle = async (req, res) => {
    let counted = false
    try {
      if (req.method !== 'POST' || req.url !== '/pi') {
        reply(res, 404, { error: 'Not found' })
        req.resume()
        return
      }
      // Not a browser API. Never allow CORS or publish events from a web page.
      if (req.headers.origin || !authorized(req, token)) {
        reply(res, 401, { error: 'Unauthorized' })
        req.resume()
        return
      }
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
        reply(res, 415, { error: 'Expected application/json' })
        req.resume()
        return
      }
      // Limit only Pi requests; never impose a global connection cap on legacy approvals.
      if (active >= 32) {
        reply(res, 503, { error: 'Pi receiver busy' })
        req.resume()
        return
      }
      active++
      counted = true
      const raw = await readEvent(req)
      let entry
      try { entry = normalizePiEvent(raw) } catch (error) {
        reply(res, 400, { error: error.message })
        return
      }
      const now = Date.now()
      for (const [key, time] of seen) if (now - time > 600_000) seen.delete(key)
      const key = `${entry.sessionId}:${raw.id}`
      if (!seen.has(key)) {
        let pending = inFlight.get(key)
        if (!pending) {
          pending = Promise.resolve().then(() => onEvent(raw.type, entry))
          inFlight.set(key, pending)
        }
        try {
          await pending
          seen.set(key, now)
          if (seen.size > 2048) seen.delete(seen.keys().next().value)
        } finally { inFlight.delete(key) }
      }
      reply(res, 200, { ok: true })
    } catch (error) {
      log('Pi webhook request failed', { error: error.status ? error.message : 'event handler failed' }, 'warn')
      if ([408, 413].includes(error.status)) {
        res.setHeader('Connection', 'close')
        res.once('finish', () => req.destroy())
      }
      reply(res, error.status || 500, { error: error.status ? error.message : 'Event handling failed' })
    } finally {
      if (counted) active--
    }
  }
  return { handle, clear: () => seen.clear() }
}
