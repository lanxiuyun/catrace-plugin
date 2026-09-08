import http from 'node:http'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import { AGENTS, installAgent, isInstalled, uninstallAgent } from './hooks.mjs'

const pluginId = process.env.CATRACE_PLUGIN_ID || 'agent-notify'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 23456
const PERM_WAIT_MS = 540_000
const DEDUP_MS = 8000

const KNOWN = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'StopFailure',
  'Notification',
]
const DEFAULT_MODE = {
  SessionStart: 'off',
  UserPromptSubmit: 'off',
  PreToolUse: 'auto',
  PostToolUse: 'auto',
  PostToolUseFailure: 'sticky',
  Stop: 'sticky',
  StopFailure: 'sticky',
  Notification: 'sticky',
}
const EVENT_BODY = {
  SessionStart: '会话已开始',
  UserPromptSubmit: '正在处理你的请求',
  PreToolUse: '正在调用工具',
  PostToolUse: '工具调用完成',
  PostToolUseFailure: '工具调用失败',
  Stop: '本轮任务已完成，等你继续',
  StopFailure: '执行中断，请查看终端',
  Notification: '需要你回来看一眼',
}

function projectName(cwd) {
  if (!cwd) return ''
  const parts = String(cwd).replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || ''
}

function cardTitle(entry) {
  const named = entry.sessionTitle && String(entry.sessionTitle).trim()
  if (named) return named
  return projectName(entry.cwd) || 'AI 助手'
}

function cardBody(entry) {
  if (entry.prompt) return entry.prompt
  return EVENT_BODY[entry.event] || '状态已更新'
}

let config = {
  enabled: true,
  showDebug: false,
  eventModes: { ...DEFAULT_MODE },
}
/** @type {Map<string, object>} sessionId -> entry */
const stickyEntries = new Map()
/** @type {Map<number, { res: http.ServerResponse, sessionId: string, timer: NodeJS.Timeout }>} */
const pendingPerm = new Map()
const dedup = new Map()
let permId = 1
let server = null

const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`)
const log = (message, data, level = 'info') => send({ v: 1, op: 'log', level, message, data })

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
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  res.end(buf)
}

function modeOf(event) {
  return config.eventModes[event] || DEFAULT_MODE[event] || 'off'
}

function publishSession(entry, { gone = false } = {}) {
  const sessionId = entry.sessionId || 'unknown'
  send({
    v: 1,
    op: 'publish',
    event: {
      eventType: 'agent-notify.state',
      kind: 'agent-notify',
      title: cardTitle(entry),
      body: cardBody(entry),
      level: entry.event === 'PostToolUseFailure' || entry.event === 'StopFailure' ? 'error' : 'info',
      sticky: !gone,
      actions: gone ? [] : [{ id: `dismiss:${sessionId}`, label: '知道了' }],
      payload: {
        sessionId,
        entry,
        debug: !!config.showDebug,
        raw: entry.raw || null,
      },
      dedupeKey: `agent-notify:session:${sessionId}`,
    },
  })
}

function publishPermission(id, payload) {
  send({
    v: 1,
    op: 'publish',
    event: {
      eventType: 'agent-notify.permission',
      kind: 'agent-notify',
      title: '权限审批',
      body: payload.tool_name || '工具调用',
      level: 'warning',
      sticky: true,
      actions: [
        { id: `allow:${id}`, label: '允许' },
        { id: `deny:${id}`, label: '拒绝' },
      ],
      payload: {
        requestId: id,
        toolName: payload.tool_name || '',
        toolInput: payload.tool_input,
        sessionId: payload.session_id,
        cwd: payload.cwd,
        debug: !!config.showDebug,
        raw: payload,
      },
      dedupeKey: `agent-notify:perm:${id}`,
    },
  })
}

function finishPerm(id, decision) {
  const pending = pendingPerm.get(id)
  if (!pending) return false
  clearTimeout(pending.timer)
  pendingPerm.delete(id)
  const body =
    decision === 'allow' || decision === 'deny'
      ? JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PermissionRequest',
            decision: { behavior: decision },
          },
        })
      : '{}'
  try {
    cors(pending.res, 200, body)
  } catch {
    /* already closed */
  }
  return true
}

function timeoutSessionPerms(sessionId) {
  for (const [id, p] of pendingPerm) {
    if (p.sessionId === sessionId) finishPerm(id, 'timeout')
  }
}

function handleState(payload) {
  if (!config.enabled) return
  const event = payload.event || payload.hook_event_name || ''
  const sessionId = payload.session_id || 'unknown'
  if (event === 'UserPromptSubmit' && sessionId && sessionId !== 'unknown') {
    timeoutSessionPerms(sessionId)
    if (stickyEntries.has(sessionId)) {
      stickyEntries.delete(sessionId)
      publishSession({ sessionId }, { gone: true })
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
  const entry = {
    event,
    sessionId,
    cwd: payload.cwd || '',
    prompt: payload.prompt || '',
    sessionTitle: payload.session_title || payload.sessionTitle || '',
    raw: payload,
  }
  if (mode === 'sticky') {
    stickyEntries.set(sessionId, entry)
    publishSession(entry)
    return
  }
  send({
    v: 1,
    op: 'publish',
    event: {
      eventType: 'agent-notify.state',
      kind: 'agent-notify',
      title: cardTitle(entry),
      body: cardBody(entry),
      level: entry.event === 'PostToolUseFailure' || entry.event === 'StopFailure' ? 'error' : 'info',
      sticky: false,
      payload: { sessionId, entry, debug: !!config.showDebug, raw: payload },
      dedupeKey: `agent-notify:session:${sessionId}`,
    },
  })
}

function handlePermission(req, res, payload) {
  const id = permId++
  const sessionId = payload.session_id || ''
  if (sessionId && sessionId !== 'unknown') timeoutSessionPerms(sessionId)
  const timer = setTimeout(() => finishPerm(id, 'timeout'), PERM_WAIT_MS)
  pendingPerm.set(id, { res, sessionId, timer })
  publishPermission(id, payload)
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
    const url = (req.url || '').split('?')[0]
    if (req.method === 'OPTIONS') {
      cors(res, 204)
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
    if (!payload.event && payload.hook_event_name) payload.event = payload.hook_event_name
    if (url === '/permission') {
      handlePermission(req, res, payload)
      return
    }
    cors(res, 200)
    handleState(payload)
  })
  server.on('error', (err) => log('http bind failed', { error: String(err) }, 'error'))
  server.listen(PORT, '127.0.0.1', () => log('listening', { port: PORT }))
}

function stopHttp() {
  if (!server) return
  server.close()
  server = null
  for (const id of [...pendingPerm.keys()]) finishPerm(id, 'timeout')
}

function applyConfig(input = {}) {
  if (typeof input.enabled === 'boolean') config.enabled = input.enabled
  if (typeof input.showDebug === 'boolean') config.showDebug = input.showDebug
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
          AGENTS.map((id) => ({ id, installed: isInstalled(id) })),
        )
        break
      case 'install':
        respond(requestId, true, installAgent(String(params.agent || ''), scriptPath))
        break
      case 'uninstall':
        respond(requestId, true, uninstallAgent(String(params.agent || '')))
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

startHttp()
send({ v: 1, op: 'ready' })
log('agent-notify ready', { pluginId, pid: process.pid })

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
  if (message.op === 'resolved') {
    const actionId = String(message.actionId || '')
    const kind = String(message.resolutionKind || '')
    if (actionId.startsWith('dismiss:')) {
      stickyEntries.delete(actionId.slice('dismiss:'.length))
      return
    }
    if (kind === 'dismissed') return
    const m = /^(allow|deny):(\d+)$/.exec(actionId)
    if (m) finishPerm(Number(m[2]), m[1])
  }
})
