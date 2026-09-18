import http from 'node:http'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import { AGENTS, installAgent, isAgentPresent, isInstalled, uninstallAgent } from './hooks.mjs'
import { focusExternalWindow } from './focus-windows.mjs'
import { publishTestCard } from './preview-cards.mjs'
import { DEFAULT_MODE, DEDUP_MS, EVENT_BODY, PERM_WAIT_MS } from './constants.mjs'
import { cacheKey, cardBody, cardTitle, createTitleCache, normalizeHookData } from './hook-data.mjs'
import { createPidChainCache } from './pid-chain.mjs'
import { createPermissionStore, elicitationQuestions } from './permission.mjs'

const pluginId = process.env.CATRACE_PLUGIN_ID || 'agent-notify'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.CATRACE_AGENT_NOTIFY_PORT) || 23456
const TITLE_CACHE_PATH = path.join(__dirname, 'cache', 'session-titles.json')

const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`)
const log = (message, data, level = 'info') => send({ v: 1, op: 'log', level, message, data })
const { loadTitleCache, deriveSessionTitle } = createTitleCache({ cachePath: TITLE_CACHE_PATH, log })
const { ensurePidChain } = createPidChainCache()

let config = {
  enabled: true,
  showDebug: false,
  debugView: 'off',
  debugExpanded: false,
  autoHideSeconds: 8,
  eventModes: { ...DEFAULT_MODE },
}
/** @type {Map<string, object>} sessionId -> entry */
const stickyEntries = new Map()
const dedup = new Map()
let publishSeq = 0
const publishRequests = new Map()
const sessionEventIds = new Map()
let server = null

function respond(requestId, ok, result, error) {
  const message = { v: 1, op: 'response', requestId, ok }
  if (ok) message.result = result ?? null
  else message.error = error || 'request failed'
  send(message)
}

function cors(res, status = 200, body = '') {
  const buf = Buffer.from(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': buf.length,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  res.end(buf)
}

function debugViewOf() {
  if (config.debugView === 'common' || config.debugView === 'raw' || config.debugView === 'off') {
    return config.debugView
  }
  return config.showDebug ? 'raw' : 'off'
}

function modeOf(event) {
  return config.eventModes[event] || DEFAULT_MODE[event] || 'off'
}

function autoHideMs() {
  const seconds = Number(config.autoHideSeconds)
  const clamped = Number.isFinite(seconds) ? Math.min(600, Math.max(3, seconds)) : 8
  return Math.round(clamped * 1000)
}

function debugPayload() {
  return {
    debug: debugViewOf() !== 'off',
    debugView: debugViewOf(),
    debugExpanded: config.debugExpanded,
  }
}

function publishSession(entry, { gone = false } = {}) {
  const sessionId = entry.sessionId || 'unknown'
  const requestId = `publish-${++publishSeq}`
  if (!gone) publishRequests.set(requestId, { sessionId, entry })
  send({
    v: 1,
    op: 'publish',
    requestId,
    event: {
      eventType: 'agent-notify.state',
      kind: 'agent-notify',
      title: cardTitle(entry),
      body: cardBody(entry, EVENT_BODY),
      level: entry.event === 'PostToolUseFailure' || entry.event === 'StopFailure' ? 'error' : 'info',
      sticky: !gone,
      actions: gone ? [] : [{ id: 'dismiss', label: '知道了' }],
      payload: {
        sessionId,
        toastStyle: 'standalone',
        auto_hide_ms: gone ? 0 : autoHideMs(),
        entry,
        ...debugPayload(),
        raw: entry.raw || null,
      },
      dedupeKey: `agent-notify:session:${sessionId}`,
    },
  })
}

function publishPermission(id, data) {
  const permission = data.permission || {}
  send({
    v: 1,
    op: 'publish',
    event: {
      eventType: 'agent-notify.permission',
      kind: 'agent-notify',
      title: '权限审批',
      body: permission.toolName || '工具调用',
      level: 'warning',
      sticky: true,
      actions: [
        { id: `allow:${id}`, label: '允许' },
        { id: `deny:${id}`, label: '拒绝' },
      ],
      payload: {
        requestId: id,
        toastStyle: 'standalone',
        agentId: data.agentId,
        toolName: permission.toolName,
        toolInput: permission.toolInput,
        sessionId: data.sessionId,
        sessionTitle: data.sessionTitle,
        projectName: data.projectName,
        cwd: data.cwd,
        entry: data,
        ...debugPayload(),
        raw: data.raw,
      },
      dedupeKey: `agent-notify:perm:${id}`,
    },
  })
}

const permissions = createPermissionStore({
  cors,
  log,
  permWaitMs: PERM_WAIT_MS,
  publishPermission,
})

function dismissSessionCard(sessionId) {
  if (!sessionId || sessionId === 'unknown') return
  const eventId = sessionEventIds.get(sessionId)
  if (!eventId) return
  send({ v: 1, op: 'resolve', eventId })
  sessionEventIds.delete(sessionId)
}

async function handleState(payload) {
  if (!config.enabled) return
  const data = normalizeHookData(payload, payload.agentId, deriveSessionTitle)
  const { event, sessionId } = data
  // HTTP response 等待首次进程链捕获完成，保证短命 hook 父进程在快照期间仍存活。
  if (data.hookPpid && sessionId && sessionId !== 'unknown') {
    const key = cacheKey(data.agentId, sessionId)
    try {
      const chain = await ensurePidChain(key, data.hookPpid)
      if (chain.length) {
        data.pidChain = chain
        log('pid chain captured', { sessionId, chain })
      } else {
        log('pid chain capture failed', { sessionId, hookPpid: data.hookPpid }, 'warn')
      }
    } catch (error) {
      log('pid chain capture error', { sessionId, error: String(error) }, 'warn')
    }
  }
  if (event === 'UserPromptSubmit' && sessionId && sessionId !== 'unknown') {
    permissions.timeoutSessionPerms(sessionId)
    if (stickyEntries.has(sessionId)) {
      stickyEntries.delete(sessionId)
      dismissSessionCard(sessionId)
    }
  }
  const mode = modeOf(event)
  if (mode === 'off') return
  if (mode !== 'sticky') {
    const key = `${sessionId}:${event}`
    const now = Date.now()
    const prev = dedup.get(key)
    if (prev && now - prev < DEDUP_MS) return
    dedup.set(key, now)
  }
  if (mode === 'sticky') {
    stickyEntries.set(sessionId, data)
    publishSession(data)
    return
  }
  send({
    v: 1,
    op: 'publish',
    event: {
      eventType: 'agent-notify.state',
      kind: 'agent-notify',
      title: cardTitle(data),
      body: cardBody(data, EVENT_BODY),
      level: data.event === 'PostToolUseFailure' || data.event === 'StopFailure' ? 'error' : 'info',
      sticky: false,
      payload: {
        sessionId,
        toastStyle: 'standalone',
        auto_hide_ms: autoHideMs(),
        entry: data,
        ...debugPayload(),
        raw: data.raw,
      },
      dedupeKey: `agent-notify:session:${sessionId}`,
    },
  })
}

function handlePermission(req, res, payload, agentId) {
  const data = normalizeHookData(payload, agentId || payload.agentId, deriveSessionTitle)
  const mode = modeOf('PermissionRequest')
  if (mode === 'off') {
    cors(res, 200, JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'deny' },
      },
    }))
    return
  }
  permissions.startPermission(req, res, data)
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        resolve(null)
      }
    })
    req.on('error', () => resolve(null))
  })
}

function startHttp() {
  if (server) return
  server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url || '/', `http://127.0.0.1:${PORT}`)
    const url = requestUrl.pathname
    const agentId = requestUrl.searchParams.get('agent') || ''
    if (req.method === 'OPTIONS') {
      cors(res, 204)
      return
    }
    if (req.method === 'GET' && url === '/focus') {
      const rawPids = requestUrl.searchParams.get('pids') || ''
      const pids = rawPids.split(',').map((pid) => Number(pid))
      log('focus http request', { pids }, 'info')
      try {
        const result = await focusExternalWindow(pids)
        log('focus result', result, result.ok ? 'info' : 'warn')
        cors(res, 200, JSON.stringify(result))
      } catch (error) {
        const result = { ok: false, category: 'none', restored: 0, candidates: 0 }
        log('focus failed', { error: String(error) }, 'warn')
        cors(res, 500, JSON.stringify(result))
      }
      return
    }
    if (url === '/permission-decide') {
      if (req.method === 'GET') {
        permissions.handlePermissionDecideHttp({
          id: requestUrl.searchParams.get('id'),
          decision: requestUrl.searchParams.get('decision'),
          answers: requestUrl.searchParams.get('answers'),
        }, res)
        return
      }
      if (req.method === 'POST') {
        permissions.handlePermissionDecideHttp(await readBody(req), res)
        return
      }
    }
    if (req.method === 'GET' && url === '/health') {
      cors(res, 200, JSON.stringify({ ok: true, routes: ['/state', '/permission', '/focus', '/permission-decide'] }))
      return
    }
    if (req.method !== 'POST' || (url !== '/state' && url !== '/permission')) {
      cors(res, 404)
      return
    }
    const payload = await readBody(req)
    if (!payload) {
      cors(res, 400)
      return
    }
    if (url === '/permission') {
      handlePermission(req, res, payload, agentId)
      return
    }
    await handleState(payload)
    cors(res, 200)
  })
  server.on('error', (err) => log('http bind failed', { error: String(err), hint: 'port 23456 is still held by an old sidecar; refresh the plugin to kill it' }, 'error'))
  server.listen(PORT, '127.0.0.1', () => {
    log('listening', { port: PORT, routes: ['/state', '/permission', '/focus', '/permission-decide'] })
    send({ v: 1, op: 'ready' })
    log('agent-notify ready', { pluginId, pid: process.pid })
  })
}

function stopHttp() {
  if (!server) return
  server.close()
  server = null
  for (const id of [...permissions.pendingPerm.keys()]) permissions.finishPerm(id, 'timeout')
}

function applyConfig(input = {}) {
  if (typeof input.enabled === 'boolean') config.enabled = input.enabled
  if (typeof input.showDebug === 'boolean') config.showDebug = input.showDebug
  if (input.debugView === 'off' || input.debugView === 'common' || input.debugView === 'raw') {
    config.debugView = input.debugView
  }
  if (typeof input.debugExpanded === 'boolean') config.debugExpanded = input.debugExpanded
  const seconds = Number(input.autoHideSeconds)
  if (Number.isFinite(seconds)) config.autoHideSeconds = Math.min(600, Math.max(3, Math.round(seconds)))
  if (input.eventModes && typeof input.eventModes === 'object') {
    config.eventModes = { ...DEFAULT_MODE, ...input.eventModes }
  }
}

function handleRequest(message) {
  const requestId = message.requestId || message.id
  if (!requestId) return
  const method = String(message.method || '')
  const params = message.params && typeof message.params === 'object' ? message.params : {}
  const scriptPath = path.join(__dirname, 'hook.cjs')
  try {
    switch (method) {
      case 'setConfig':
        applyConfig(params)
        respond(requestId, true, { enabled: config.enabled })
        break
      case 'listAgents':
        respond(
          requestId,
          true,
          AGENTS.map((id) => ({ id, installed: isInstalled(id), detected: isAgentPresent(id) })),
        )
        break
      case 'install':
        respond(requestId, true, installAgent(String(params.agent || ''), scriptPath))
        break
      case 'uninstall':
        respond(requestId, true, uninstallAgent(String(params.agent || '')))
        break
      case 'testCard':
        respond(requestId, true, {
          kind: publishTestCard(String(params.kind || 'stop'), {
            publishSession,
            publishPermission,
            pendingPerm: permissions.pendingPerm,
            finishPerm: permissions.finishPerm,
            permWaitMs: PERM_WAIT_MS,
            allocPermId: permissions.allocPermId,
          }),
        })
        break
      default:
        respond(requestId, false, null, `unknown method: ${method}`)
    }
  } catch (error) {
    respond(requestId, false, null, error instanceof Error ? error.message : String(error))
  }
}

function shutdown() {
  stopHttp()
  log('shutdown', { pluginId })
  process.exit(0)
}

loadTitleCache()
startHttp()

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
    applyConfig(message.config)
    return
  }
  if (message.op === 'request') {
    handleRequest(message)
    return
  }
  if (message.op === 'response') {
    const pending = publishRequests.get(message.requestId)
    if (pending) {
      publishRequests.delete(message.requestId)
      const eventId = message.result && message.result.eventId
      if (message.ok && eventId) sessionEventIds.set(pending.sessionId, eventId)
    }
    return
  }
  if (message.op === 'resolved') {
    const actionId = String(message.actionId || '')
    const kind = String(message.resolutionKind || '')
    const sessionId =
      (message.payload && message.payload.sessionId) ||
      (message.payload && message.payload.entry && message.payload.entry.sessionId) ||
      ''
    if (actionId === 'dismiss' || kind === 'dismissed') {
      if (sessionId) stickyEntries.delete(sessionId)
      return
    }
    const m = /^(allow|deny):(\d+)$/.exec(actionId)
    if (m) {
      const id = Number(m[2])
      const pending = permissions.pendingPerm.get(id)
      if (m[1] === 'allow' && pending && elicitationQuestions(pending.toolInput).length) {
        log('ignore host allow without elicitation answers', { id }, 'warn')
        return
      }
      permissions.finishPerm(id, m[1])
    }
  }
})
