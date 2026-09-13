import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import readline from 'node:readline'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { AGENTS, installAgent, isAgentPresent, isInstalled, uninstallAgent } from './hooks.mjs'

const pluginId = process.env.CATRACE_PLUGIN_ID || 'agent-notify'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 23456
const PERM_WAIT_MS = 540_000
const DEDUP_MS = 8000
const TITLE_CACHE_PATH = path.join(__dirname, 'cache', 'session-titles.json')
const TITLE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const TITLE_MAX_LENGTH = 120

function projectName(cwd) {
  if (!cwd) return ''
  const parts = String(cwd).replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || ''
}

const KNOWN = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'StopFailure',
  'Notification',
  'PermissionRequest',
]
const DEFAULT_MODE = {
  SessionStart: 'auto',
  UserPromptSubmit: 'auto',
  PreToolUse: 'off',
  PostToolUse: 'off',
  PostToolUseFailure: 'off',
  Stop: 'sticky',
  StopFailure: 'sticky',
  Notification: 'sticky',
  PermissionRequest: 'sticky',
}
const EVENT_ALIASES = {
  BeforeAgent: 'UserPromptSubmit',
  AfterAgent: 'Stop',
  BeforeTool: 'PreToolUse',
  AfterTool: 'PostToolUse',
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

const titleCache = new Map()

function loadTitleCache() {
  try {
    const raw = JSON.parse(fs.readFileSync(TITLE_CACHE_PATH, 'utf8'))
    const now = Date.now()
    for (const [key, value] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
      if (value && typeof value.title === 'string' && now - Number(value.ts || 0) < TITLE_CACHE_TTL_MS) {
        titleCache.set(key, { title: value.title, ts: Number(value.ts), pinned: value.pinned === true })
      }
    }
  } catch {
    /* cache is optional */
  }
}

function saveTitleCache() {
  try {
    const now = Date.now()
    const out = {}
    for (const [key, value] of titleCache) {
      if (now - value.ts < TITLE_CACHE_TTL_MS) out[key] = value
    }
    fs.mkdirSync(path.dirname(TITLE_CACHE_PATH), { recursive: true })
    fs.writeFileSync(TITLE_CACHE_PATH, `${JSON.stringify(out, null, 2)}\n`, 'utf8')
  } catch (error) {
    log('save title cache failed', { error: String(error) }, 'warn')
  }
}

function cleanTitle(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > TITLE_MAX_LENGTH ? `${text.slice(0, TITLE_MAX_LENGTH - 1)}…` : text
}

function cacheKey(agentId, sessionId) {
  return `${agentId || 'unknown'}:${sessionId || 'unknown'}`
}

// 会话标题优先级：payload.session_title（--name、/rename 或宿主自动命名，pinned，
// 不被 prompt 覆盖）> 缓存 > UserPromptSubmit 首条 prompt 填空（非 pinned，定名后
// 不随后续 prompt 变化）。不读 transcript：各家落盘滞后，ZCode 的 transcript_path
// 还是一次性临时目录，metadata.json 永远不在旁边。
function deriveSessionTitle(payload, agentId, sessionId, event) {
  const key = cacheKey(agentId, sessionId)
  const explicit = cleanTitle(payload.session_title || payload.sessionTitle)
  if (explicit) {
    const cached = titleCache.get(key)
    if (!cached || !cached.pinned || cached.title !== explicit) {
      titleCache.set(key, { title: explicit, ts: Date.now(), pinned: true })
      saveTitleCache()
    }
    return explicit
  }
  const cached = titleCache.get(key)
  if (cached && Date.now() - cached.ts < TITLE_CACHE_TTL_MS) return cached.title
  if (event === 'UserPromptSubmit') {
    const fromPrompt = cleanTitle(payload.prompt)
    if (fromPrompt) {
      titleCache.set(key, { title: fromPrompt, ts: Date.now(), pinned: false })
      saveTitleCache()
      return fromPrompt
    }
  }
  return ''
}

function firstString(...values) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() || ''
}

// —— 前往会话：终端窗口进程链 ——
// hook 只带得到直接父 pid，祖先要靠一次全量进程快照向上爬。hook 的直接父可能是
// CLI 的临时 shell 包装（cmd /c），只在 hook 运行期间存活，所以链必须在收到事件时
// 立刻爬完并按会话缓存；之后的事件直接用缓存，等不回爬已经死掉的中间进程。
const PID_CHAIN_MAX_DEPTH = 20
const PID_CHAIN_MAX_CACHED = 500
const PID_CHAIN_FAIL_TTL_MS = 30_000
const PID_CHAIN_SNAPSHOT_TIMEOUT_MS = 6_000
/** @type {Map<string, number[]>} `agentId:sessionId` -> 进程链（由内向外） */
const pidChainCache = new Map()
const pidChainInflight = new Map()
const pidChainFailAt = new Map()

function execFileText(file, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true, encoding: 'utf8' }, (err, stdout) => {
      resolve(err ? '' : String(stdout))
    })
  })
}

async function processParentMap() {
  const parents = new Map()
  let out
  if (process.platform === 'win32') {
    out = await execFileText(
      'powershell.exe',
      [
        '-NoProfile', '-NonInteractive', '-Command',
        'Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId | ForEach-Object { "{0} {1}" -f $_.ProcessId, $_.ParentProcessId }',
      ],
      PID_CHAIN_SNAPSHOT_TIMEOUT_MS,
    )
  } else {
    out = await execFileText('ps', ['-axo', 'pid=,ppid='], 4_000)
  }
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(line)
    if (m) parents.set(Number(m[1]), Number(m[2]))
  }
  return parents
}

async function capturePidChain(hookPpid) {
  if (!hookPpid || hookPpid <= 1) return []
  const parents = await processParentMap()
  const chain = []
  let pid = hookPpid
  while (pid > 1 && !chain.includes(pid) && chain.length < PID_CHAIN_MAX_DEPTH) {
    chain.push(pid)
    pid = parents.get(pid) || 0
  }
  return chain
}

async function ensurePidChain(key, hookPpid) {
  const cached = pidChainCache.get(key)
  if (cached) return cached
  const failedAt = pidChainFailAt.get(key)
  if (failedAt && Date.now() - failedAt < PID_CHAIN_FAIL_TTL_MS) return []
  const pending = pidChainInflight.get(key)
  if (pending) return pending
  const task = capturePidChain(hookPpid)
    .then((chain) => {
      if (chain.length) {
        if (pidChainCache.size >= PID_CHAIN_MAX_CACHED) {
          for (const stale of [...pidChainCache.keys()].slice(0, PID_CHAIN_MAX_CACHED / 2)) {
            pidChainCache.delete(stale)
          }
        }
        pidChainCache.set(key, chain)
      } else {
        pidChainFailAt.set(key, Date.now())
      }
      return chain
    })
    .finally(() => pidChainInflight.delete(key))
  pidChainInflight.set(key, task)
  return task
}

function normalizeHookData(raw, agentId = 'unknown') {
  const rawEvent = raw.event || raw.hook_event_name || raw.hookEventName || ''
  const event = EVENT_ALIASES[rawEvent] || rawEvent
  const sessionId = firstString(raw.session_id, raw.sessionId) || 'unknown'
  const cwd = firstString(raw.cwd, raw.working_directory)
  const sessionTitle = deriveSessionTitle(raw, agentId, sessionId, event)
  let message = firstString(
    raw.last_assistant_message,
    raw.lastAssistantMessage,
    raw.responsePreview,
    raw.response_preview,
    raw.responseText,
    raw.response_text,
    raw.prompt,
  )
  // UserPromptSubmit 的标题就是 prompt 摘要时，正文不再回显同一句
  if (event === 'UserPromptSubmit' && message && cleanTitle(message) === sessionTitle) message = ''
  const normalizedAgentId = agentId !== 'unknown' ? agentId : raw.agentId || 'unknown'
  return {
    agentId: normalizedAgentId,
    event,
    sessionId,
    sessionTitle,
    projectName: projectName(cwd),
    cwd,
    timestamp: firstString(raw.timestamp, raw.created_at) || new Date().toISOString(),
    message,
    hookPpid: Number(raw.catrace_hook_ppid ?? raw.hook_ppid) || 0,
    permission: event === 'PermissionRequest' ? {
      toolName: firstString(raw.tool_name, raw.toolName, raw.name) || '工具调用',
      toolInput: raw.tool_input ?? raw.toolInput,
    } : undefined,
    raw,
  }
}


function cardTitle(entry) {
  const named = entry.sessionTitle && String(entry.sessionTitle).trim()
  if (named) return named
  return entry.projectName || projectName(entry.cwd) || 'AI 助手'
}

function cardBody(entry) {
  return entry.message || EVENT_BODY[entry.event] || '状态已更新'
}

let config = {
  enabled: true,
  showDebug: false,
  debugView: 'off',
  debugExpanded: false,
  eventModes: { ...DEFAULT_MODE },
}
/** @type {Map<string, object>} sessionId -> entry */
const stickyEntries = new Map()
/** @type {Map<number, { res: http.ServerResponse, sessionId: string, timer: NodeJS.Timeout }>} */
const pendingPerm = new Map()
const dedup = new Map()
let permId = 1
let publishSeq = 0
const publishRequests = new Map()
const sessionEventIds = new Map()
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

function debugViewOf() {
  if (config.debugView === 'common' || config.debugView === 'raw' || config.debugView === 'off') {
    return config.debugView
  }
  return config.showDebug ? 'raw' : 'off'
}

function modeOf(event) {
  return config.eventModes[event] || DEFAULT_MODE[event] || 'off'
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
      body: cardBody(entry),
      level: entry.event === 'PostToolUseFailure' || entry.event === 'StopFailure' ? 'error' : 'info',
      sticky: !gone,
      actions: gone ? [] : [{ id: 'dismiss', label: '知道了' }],
      payload: {
        sessionId,
        entry,
        debug: debugViewOf() !== 'off',
        debugView: debugViewOf(),
        debugExpanded: config.debugExpanded,
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
        agentId: data.agentId,
        toolName: permission.toolName,
        toolInput: permission.toolInput,
        sessionId: data.sessionId,
        sessionTitle: data.sessionTitle,
        projectName: data.projectName,
        cwd: data.cwd,
        entry: data,
        debug: debugViewOf() !== 'off',
        debugView: debugViewOf(),
        debugExpanded: config.debugExpanded,
        raw: data.raw,
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

function dismissSessionCard(sessionId) {
  if (!sessionId || sessionId === 'unknown') return
  const eventId = sessionEventIds.get(sessionId)
  if (!eventId) return
  send({ v: 1, op: 'resolve', eventId })
  sessionEventIds.delete(sessionId)
}

function handleState(payload) {
  if (!config.enabled) return
  const data = normalizeHookData(payload, payload.agentId)
  const { event, sessionId } = data
  // 前往会话用的进程链：缓存命中直接带上；未命中异步捕获，不阻塞卡片发布
  if (data.hookPpid && sessionId && sessionId !== 'unknown') {
    const key = cacheKey(data.agentId, sessionId)
    const cached = pidChainCache.get(key)
    if (cached) data.pidChain = cached
    else {
      ensurePidChain(key, data.hookPpid)
        .then((chain) => {
          if (!chain.length) return
          const sticky = stickyEntries.get(sessionId)
          if (sticky && !sticky.pidChain) sticky.pidChain = chain
        })
        .catch(() => {})
    }
  }
  if (event === 'UserPromptSubmit' && sessionId && sessionId !== 'unknown') {
    timeoutSessionPerms(sessionId)
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
      body: cardBody(data),
      level: data.event === 'PostToolUseFailure' || data.event === 'StopFailure' ? 'error' : 'info',
      sticky: false,
      payload: { sessionId, entry: data, debug: debugViewOf() !== 'off', debugView: debugViewOf(), debugExpanded: config.debugExpanded, raw: data.raw },
      dedupeKey: `agent-notify:session:${sessionId}`,
    },
  })
}

function handlePermission(req, res, payload, agentId) {
  const data = normalizeHookData(payload, agentId || payload.agentId)
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
  const id = permId++
  const sessionId = data.sessionId
  if (sessionId && sessionId !== 'unknown') timeoutSessionPerms(sessionId)
  const timer = setTimeout(() => finishPerm(id, 'timeout'), PERM_WAIT_MS)
  pendingPerm.set(id, { res, sessionId, timer })
  publishPermission(id, data)
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
  if (input.debugView === 'off' || input.debugView === 'common' || input.debugView === 'raw') {
    config.debugView = input.debugView
  }
  if (typeof input.debugExpanded === 'boolean') config.debugExpanded = input.debugExpanded
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
    if (m) finishPerm(Number(m[2]), m[1])
  }
})
