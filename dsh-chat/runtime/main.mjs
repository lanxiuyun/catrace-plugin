/**
 * dsh-chat sidecar —— Catrace 外挂插件进程（stdio JSON Lines v1）。
 *
 * 两条通路：
 *  1. stdio JSON Lines：设置页（主窗）用 `plugin.sidecar.request` 调本进程的方法；
 *  2. 本机 HTTP（127.0.0.1:<httpPort>，带一次性 token）：
 *     **Toast 小窗卡片不能调 sidecar.request**（宿主只放行 `main` 窗），所以卡片用 fetch 走这里。
 *
 * 职责：读 DSH 会话日志（$DSH_HOME/sessions/.../session.v4.jsonl.zstd）成转录；
 *       需要「向 DSH 提问」时拉起 `dsh --profile sdk`（官方 stdio JSON-RPC SDK）。
 *
 * 协议：stdout 只写 JSON Lines（宿主逐行解析），诊断走 log op 或 stderr。
 */
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import http from 'node:http'
import os from 'node:os'
import process from 'node:process'
import { createInterface } from 'node:readline'

import { cropFlagsFor, DEFAULT_CONFIG, forceLabelsFor, guiSignature, normalizeConfig } from './lib/config.mjs'
import { GUI_CLASS_GROUPS, listGuiClasses } from './lib/gui-classes.mjs'
import { callApi, describeDiscoveryFailure, discoverHost, readBrowserSessionSecret } from './lib/dsh-gui.mjs'
import { NoticeTracker } from './lib/inspector.mjs'
import { buildCropCss, startGuiProxy } from './lib/gui-proxy.mjs'
import { DshSdkClient } from './lib/sdk-client.mjs'
import { buildSpawnPlan, resolveDshCommand } from './lib/spawn-plan.mjs'
import {
  latestSession,
  listSessions,
  readParsedSessionLog,
  readSession,
  resolveDshHome,
  scanSessionLogs,
} from './lib/session-store.mjs'

const WINDOW_DEDUPE_KEY = 'dsh-chat.window'
const NOTICE_DEDUPE_PREFIX = 'dsh-chat.notice:'
const NOTICE_STATUS_LABELS = { running: '进行中', done: '已完成', waiting: '等你审批' }
const MAX_PROMPT_CHARS = 20000
const VERSION_TIMEOUT_MS = 15000
const DEFAULT_HTTP_PORT = 23457
const HTTP_ROUTES = ['/health', '/status', '/sessions', '/session', '/mirror', '/prompt', '/stop', '/window', '/gui', '/notice/view']

/** @type {ReturnType<typeof normalizeConfig>} */
let config = { ...DEFAULT_CONFIG }
/** @type {DshSdkClient|null} */
let sdk = null
/** 小窗是否已经按 autoOpenWindow 弹过（一次启用只弹一次） */
let autoOpened = false
let chatSessionId = null
let chatRunning = false
let lastError = null
/** @type {http.Server|null} */
let httpServer = null
let httpPort = null
/** 卡片访问本机 HTTP 的一次性口令：只有拿到已发布 payload 的卡片知道。 */
const httpToken = randomBytes(16).toString('hex')

// ---- 状态通知巡检（NoticeTracker 是纯逻辑，IO 与定时器都在这里）----
const noticeLoop = { timer: null, tracker: null, polling: false, lastPollAt: 0 }

function send(payload) {
  process.stdout.write(`${JSON.stringify({ v: 1, ...payload })}\n`)
}

function log(level, message, data) {
  send({ op: 'log', level, message, data })
}

function respond(requestId, ok, result, error) {
  const msg = { op: 'response', requestId, ok: !!ok }
  if (ok) msg.result = result ?? null
  else msg.error = error instanceof Error ? error.message : String(error ?? 'request failed')
  send(msg)
}

/**
 * RPC 契约版本：**改动/新增 RPC 方法时手工 +1**（settings.mjs 里有同名常量）。
 * 设置页会拿 sidecar 报回的版本跟自己对，不一致就提示"插件在跑旧代码，关掉再打开"——
 * 这类"改了代码但侧车还是老的"的困惑已经出现过好几次了。
 */
const CONTRACT_VERSION = 3

/** 把一次可能失败的读取收敛成兜底值，避免整个 RPC 因单个坏文件失败。 */
function safe(fn, fallback) {
  try {
    return fn()
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error)
    log('warn', '读取 DSH 数据失败', { error: lastError })
    return fallback
  }
}

function clampInt(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

function dshHome() {
  return resolveDshHome({ configured: config.dshHome })
}

/** 当前小窗要显示的会话：固定会话优先，否则跟随最近活跃会话。 */
function mirrorTarget() {
  if (config.mirrorSessionId) return config.mirrorSessionId
  if (!config.followLatest) return ''
  const latest = safe(() => latestSession({ dshHome: dshHome() }), null)
  return latest?.id ?? ''
}

function dshArgs() {
  const args = ['--profile', config.profile || 'sdk']
  if (config.patchFile) args.push('--patch', config.patchFile)
  return args
}

function resolvedCwd() {
  if (config.cwd) return config.cwd
  const target = mirrorTarget()
  if (target) {
    const session = safe(() => readSession({ dshHome: dshHome(), id: target, limit: 1, maxText: 120 }), null)
    if (session?.cwd) return session.cwd
  }
  return os.homedir()
}

// ---------------------------------------------------------------- 方法实现

async function methodStatus() {
  const home = dshHome()
  const command = resolveDshCommand(config.dshCommand)
  const sessions = safe(() => listSessions({ dshHome: home, limit: 500, readTitles: false }), [])
  const target = mirrorTarget()
  return {
    dshHome: home,
    dshCommand: config.dshCommand,
    dshCommandResolved: command,
    profile: config.profile,
    provider: config.provider,
    model: config.model,
    reasoningEffort: config.reasoningEffort,
    sessionCount: Array.isArray(sessions) ? sessions.length : 0,
    mirrorSessionId: target,
    mirrorPinned: Boolean(config.mirrorSessionId),
    chatSessionId,
    chatRunning,
    chatAlive: Boolean(sdk?.alive),
    cwd: resolvedCwd(),
    node: process.version,
    zstd: typeof (await import('node:zlib')).zstdDecompressSync === 'function',
    httpPort,
    httpReady: Boolean(httpServer?.listening),
    lastError,
    // 给设置页做"是不是在跑旧代码"的自检
    contract: CONTRACT_VERSION,
    // 生效配置（normalizeConfig 之后）：设置界面以它为准，避免"存盘缺键 → 开关显示成关"
    config: { ...config },
  }
}

async function methodListSessions(params = {}) {
  const limit = clampInt(params.limit, 1, 500, 50)
  const sessions = safe(() => listSessions({ dshHome: dshHome(), limit }), [])
  return {
    sessions: (sessions ?? []).map((s) => ({
      id: s.id,
      title: s.title || s.id,
      cwd: s.cwd || '',
      createdAt: s.createdAt ?? null,
      updatedAt: s.updatedAt ?? null,
      sizeBytes: s.sizeBytes ?? 0,
      hasProjcache: Boolean(s.hasProjcache),
    })),
  }
}

async function methodReadSession(params = {}) {
  const id = String(params.id ?? '') || mirrorTarget()
  if (!id) return { session: null, reason: 'no-session' }
  const limit = clampInt(params.limit, 1, 200, config.mirrorLimit)
  const session = safe(
    () => readSession({ dshHome: dshHome(), id, limit, maxText: params.maxText ?? 4000 }),
    null,
  )
  if (!session) return { session: null, reason: 'unreadable', id }
  return { session, source: id === config.mirrorSessionId ? 'pinned' : 'latest' }
}

async function methodSetMirror(params = {}) {
  const id = String(params.sessionId ?? '').trim()
  if (id) {
    const known = safe(() => listSessions({ dshHome: dshHome(), limit: 500, readTitles: false }), [])
    if (Array.isArray(known) && known.length > 0 && !known.some((s) => s.id === id)) {
      throw new Error(`找不到会话：${id}`)
    }
  }
  config = normalizeConfig({ ...config, mirrorSessionId: id, followLatest: id ? false : true })
  log('info', '镜像会话已切换', { mirrorSessionId: id || '(跟随最新)' })
  return { mirrorSessionId: mirrorTarget(), pinned: Boolean(config.mirrorSessionId) }
}

async function ensureSdk() {
  if (sdk && sdk.alive) return sdk
  const command = resolveDshCommand(config.dshCommand)
  const client = new DshSdkClient({
    command,
    args: dshArgs(),
    cwd: resolvedCwd(),
    onLog: (entry) =>
      log(
        entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'warn' : 'info',
        `[dsh] ${entry.message}`,
        entry.data,
      ),
    onSessionEvent: (event, meta) => {
      const type = event?.type
      if (type === 'turn/start') chatRunning = true
      if (type === 'turn/end') {
        chatRunning = false
        log('info', 'DSH 回合结束', {
          sessionId: meta?.sessionId ?? chatSessionId,
          reason: event?.data?.reason?.kind ?? null,
        })
      }
    },
    onStatus: ({ status }) => {
      chatRunning = status === 'running'
    },
  })
  sdk = client
  await client.start({
    provider: config.provider,
    model: config.model,
    reasoningEffort: config.reasoningEffort || undefined,
    maxTokens: config.maxTokens > 0 ? config.maxTokens : undefined,
    cwd: resolvedCwd(),
  })
  log('info', 'DSH SDK 会话已就绪', { provider: config.provider, model: config.model, cwd: resolvedCwd() })
  return client
}

async function methodSendPrompt(params = {}) {
  const text = String(params.text ?? '').trim()
  if (!text) throw new Error('消息不能为空')
  if (text.length > MAX_PROMPT_CHARS) throw new Error(`消息过长（上限 ${MAX_PROMPT_CHARS} 字符）`)
  const client = await ensureSdk()
  const target = params.sessionId ? { sessionId: String(params.sessionId) } : undefined
  const result = await client.prompt(text, target)
  chatSessionId = result.sessionId
  chatRunning = true
  return { sessionId: result.sessionId, messageId: result.messageId }
}

async function methodStopChat() {
  if (!sdk || !sdk.alive) {
    chatRunning = false
    return { stopped: false, reason: 'not-running' }
  }
  sdk.kill()
  sdk = null
  chatRunning = false
  log('info', '已停止 DSH 会话进程')
  return { stopped: true }
}

async function methodOpenWindow(params = {}) {
  const target = mirrorTarget()
  const session = target
    ? safe(() => readSession({ dshHome: dshHome(), id: target, limit: 1, maxText: 160 }), null)
    : null
  const last = session?.items?.length ? session.items[session.items.length - 1] : null
  send({
    op: 'publish',
    event: {
      eventType: 'dsh-chat.window',
      kind: 'dsh-chat',
      title: config.cardTitle || 'DSH 对话',
      body: session?.title || last?.text || '还没有可显示的 DSH 会话',
      level: 'info',
      sticky: true,
      dedupeKey: WINDOW_DEDUPE_KEY,
      payload: {
        open: true,
        // 独立外壳：宿主放弃自己的白底/padding/圆角/阴影，由 ui.mjs 画完整卡片。
        // 不传的话卡片会被套在宿主 22.5rem 卡槽里，宽高都会被裁。
        toastStyle: 'standalone',
        limit: clampInt(params.limit, 6, 200, config.mirrorLimit),
        pollMs: clampInt(config.pollMs, 500, 30000, 2000),
        mirrorSessionId: target,
        chatSessionId,
        httpPort,
        httpToken,
        at: Date.now(),
      },
    },
  })
  return { opened: true, mirrorSessionId: target, httpPort }
}

/** GUI 复用状态（A2：把真 DSH GUI 代理进小窗） */
const gui = { proxy: null, target: null, lastError: null, startedAt: 0, lastSessionId: '', diag: [] }

/**
 * 确保「真 GUI」可用：发现正在运行的 DSH host → 自签 cookie → 起同源反代。
 * 找不到 host / 拿不到凭据都只抛错，不影响其它功能（小窗可回退到镜像模式）。
 */
async function ensureGui() {
  if (gui.proxy && gui.target) {
    const alive = await fetch(`${gui.proxy.url}catrace-gui-health`).then((r) => r.ok).catch(() => false)
    if (alive) return gui
    gui.proxy = null
    gui.target = null
  }
  const secret = readBrowserSessionSecret({ dshHome: config.dshHome || undefined })
  if (!secret) throw new Error('读不到 ~/.dsh/.credentials.yaml 里的 client-connection/browser-session 密钥')
  gui.diag = []
  const found = await discoverHost({ secret, diag: gui.diag })
  if (!found) {
    gui.lastError = describeDiscoveryFailure(gui.diag)
    throw new Error(gui.lastError)
  }
  const cssText = buildCropCss({
    ...cropFlagsFor(config),
    forceLabels: forceLabelsFor(config),
    compactSpacing: config.compactSpacing,
    customCss: config.customCss,
  })
  const proxy = await startGuiProxy({
    targetPort: found.port,
    authority: found.authority,
    cookie: found.cookie,
    port: Number(config.guiPort) || 0,
    cssText,
    log,
  })
  gui.cssBytes = Buffer.byteLength(cssText, 'utf8')
  gui.proxy = proxy
  gui.target = { port: found.port, authority: found.authority, sessions: found.sessions }
  gui.startedAt = Date.now()
  gui.lastError = null
  log('info', 'GUI 复用已就绪', { target: found.authority, proxy: proxy.url, sessions: found.sessions })
  return gui
}

async function methodGuiStatus() {
  const secret = readBrowserSessionSecret({ dshHome: config.dshHome || undefined })
  return {
    ready: Boolean(gui.proxy),
    proxyUrl: gui.proxy?.url ?? null,
    target: gui.target,
    credentialsFound: Boolean(secret),
    guiPort: Number(config.guiPort) || 0,
    lastError: gui.lastError,
    startedAt: gui.startedAt || null,
    guiSessionId: gui.lastSessionId || '',
    // 实际注入的裁剪项（true = 隐藏），由 show* 取反而来，便于排查"设置了没生效"
    crop: cropFlagsFor(config),
    // 紧凑留白是否已进当前反代 + 注入的 CSS 字节数：用户问"怎么没区别"时先看这两个数
    compactSpacing: Boolean(config.compactSpacing),
    cssBytes: gui.cssBytes ?? null,
  }
}

/**
 * A2：把某条会话的**真 GUI** 准备好（发现 host → 自签 cookie → 同源反代），
 * 返回 iframe 用的 URL 与会话标题。设置页「小窗打开」和状态卡「展开」共用这一步。
 */
async function methodGuiUrl(params = {}) {
  const sessionId = String(params.sessionId ?? '') || chatSessionId || mirrorTarget()
  if (!sessionId) throw new Error('没有可打开的 DSH 会话')
  let state
  try {
    state = await ensureGui()
  } catch (error) {
    gui.lastError = error instanceof Error ? error.message : String(error)
    throw error
  }
  const url = `${state.proxy.url}?dshw-session=${encodeURIComponent(sessionId)}`
  gui.lastSessionId = sessionId
  // 卡片顶栏要显示"会话标题"而不是 id（官方顶栏被去装饰隐藏后，标题就靠这一行）
  const session = safe(() => readSession({ dshHome: dshHome(), id: sessionId, limit: 1, maxText: 120 }), null)
  return { guiUrl: url, title: session?.title || '', sessionId, target: state.target }
}

/** A2：把某条会话的**真 GUI** 打开到独立小窗卡（iframe 指向我们的同源反代）。 */
async function methodOpenGui(params = {}) {
  const { guiUrl, title, sessionId } = await methodGuiUrl(params)
  send({
    op: 'publish',
    event: {
      eventType: 'dsh-chat.window',
      kind: 'dsh-chat',
      title: title || config.cardTitle || 'DSH 对话',
      body: title || sessionId || 'DSH GUI',
      level: 'info',
      sticky: true,
      dedupeKey: WINDOW_DEDUPE_KEY,
      payload: {
        open: true,
        toastStyle: 'standalone',
        guiUrl,
        guiSessionId: sessionId,
        guiTitle: title,
        httpPort,
        httpToken,
        at: Date.now(),
      },
    },
  })
  return { opened: true, guiUrl, sessionId, target: gui.target }
}

// ---------------------------------------------------------------- 状态通知巡检

function noticeTracker() {
  if (!noticeLoop.tracker) noticeLoop.tracker = new NoticeTracker({ doneHoldMs: config.noticeDoneHoldMs })
  return noticeLoop.tracker
}

/** 把巡检产出的动作转成 publish op（dedupeKey 按会话，宿主原地刷新同一张卡）。 */
function publishNotice(sessionId, action) {
  const statusLabel = NOTICE_STATUS_LABELS[action.status] ?? action.status
  const preview = action.preview || ''
  send({
    op: 'publish',
    event: {
      eventType: 'dsh-chat.notice',
      kind: 'dsh-chat',
      title: action.title || config.cardTitle || 'DSH 任务',
      body: preview || statusLabel,
      level: action.status === 'waiting' ? 'warning' : 'info',
      sticky: !!action.sticky,
      dedupeKey: `${NOTICE_DEDUPE_PREFIX}${sessionId}`,
      payload: {
        notice: true,
        sessionId,
        status: action.status,
        statusLabel,
        preview,
        // 独立外壳：状态卡自己画完整的卡面（折叠条也要自己的边框圆角阴影）
        toastStyle: 'standalone',
        autoExpand: action.autoExpand === true,
        expandMode: config.noticeExpandMode,
        doneHoldMs: config.noticeDoneHoldMs,
        // 宿主的 auto-hide 钳制 3s..10min；running/waiting 是 sticky，用不到这个值
        auto_hide_ms: action.status === 'done' && !action.sticky ? config.noticeDoneHoldMs : undefined,
        httpPort,
        httpToken,
        at: Date.now(),
      },
    },
  })
}

/** 扫一遍会话目录：只重新解析 mtime/size 变化的日志，把状态迁移转成发布动作。 */
async function pollNotices() {
  if (noticeLoop.polling || !config.noticeEnabled) return
  noticeLoop.polling = true
  const startedAt = Date.now()
  try {
    const home = dshHome()
    const entries = safe(() => scanSessionLogs(home), [])
    const tracker = noticeTracker()
    tracker.doneHoldMs = config.noticeDoneHoldMs
    for (const entry of entries) {
      const state = tracker.stateOf(entry.id)
      if (state.initialized && state.mtimeMs === entry.mtimeMs && state.sizeBytes === entry.sizeBytes) continue
      const logEntry = safe(() => readParsedSessionLog(entry.logPath), null)
      if (!logEntry) continue
      const actions = tracker.ingest(entry.id, logEntry.parsed.events, {
        now: startedAt,
        // 30s 内还在写的日志才算"确实在跑"（首见快进时防止给陈旧会话补卡）
        fresh: startedAt - entry.mtimeMs < 30000,
        mtimeMs: entry.mtimeMs,
        sizeBytes: entry.sizeBytes,
      })
      for (const action of actions) publishNotice(entry.id, action)
    }
    noticeLoop.lastPollAt = startedAt
  } catch (error) {
    log('warn', '状态通知巡检失败', { error: error instanceof Error ? error.message : String(error) })
  } finally {
    noticeLoop.polling = false
  }
}

function startNoticeLoop() {
  stopNoticeLoop()
  if (!config.noticeEnabled) {
    log('info', '状态通知已关闭，巡检不启动')
    return
  }
  const interval = Math.min(30000, Math.max(500, Number(config.noticePollMs) || 2000))
  noticeLoop.timer = setInterval(() => void pollNotices(), interval)
  log('info', '状态通知巡检已启动', { interval, doneHoldMs: config.noticeDoneHoldMs, expandMode: config.noticeExpandMode })
  void pollNotices()
}

function stopNoticeLoop() {
  if (noticeLoop.timer) {
    clearInterval(noticeLoop.timer)
    noticeLoop.timer = null
  }
}

/** 卡片展开/收起上报：展开期间 sticky 持有（完成也不自动收），收起时按状态重新计时。 */
async function methodNoticeView(params = {}) {
  const sessionId = String(params.sessionId ?? '')
  if (!sessionId) throw new Error('需要 sessionId')
  const action = noticeTracker().setExpanded(sessionId, params.expanded !== false)
  if (action) publishNotice(sessionId, action)
  return { ok: true, republished: Boolean(action) }
}

/** 巡检状态（设置页展示 + 排查）。 */
async function methodNoticeStatus() {
  const tracker = noticeLoop.tracker
  return {
    enabled: Boolean(config.noticeEnabled),
    loopRunning: Boolean(noticeLoop.timer),
    pollMs: config.noticePollMs,
    doneHoldMs: config.noticeDoneHoldMs,
    expandMode: config.noticeExpandMode,
    lastPollAt: noticeLoop.lastPollAt || null,
    sessions: tracker ? tracker.summary(8) : [],
  }
}

/** 设置页的「发一张测试卡」：不走巡检，直接按指定状态发布（sessionId 固定 notice-demo）。 */
async function methodNoticeDemo(params = {}) {
  const status = params.status === 'done' ? 'done' : params.status === 'waiting' ? 'waiting' : 'running'
  // 注意：动作对象里不要用 kind 字段——plugin-contract 测试会把 main.mjs 里的 kind 字面量当事件 kind 扫描
  publishNotice('notice-demo', {
    status,
    sticky: status !== 'done',
    autoHideMs: status === 'done' ? config.noticeDoneHoldMs : null,
    autoExpand: status === 'waiting',
    title: 'DSH 状态卡预览',
    preview:
      status === 'done'
        ? '测试卡：这一轮已完成，停留一段时间后会自动收掉。'
        : status === 'waiting'
          ? '测试卡：DSH 在等你审批，卡片会自动展开官方界面。'
          : '测试卡：DSH 正在处理任务，这一行会跟着最新输出刷新。',
  })
  return { ok: true, status }
}


async function methodTestDsh() {
  const command = resolveDshCommand(config.dshCommand)
  const plan = buildSpawnPlan(command, ['--version'])
  const started = Date.now()
  const output = await new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(plan.command, plan.args, { ...plan.options, windowsHide: true })
    } catch (error) {
      reject(error)
      return
    }
    let text = ''
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* 已经退出 */
      }
      reject(new Error(`执行 ${command} --version 超时`))
    }, VERSION_TIMEOUT_MS)
    child.stdout?.on('data', (chunk) => {
      text += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk) => {
      text += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve({ code, text: text.trim().slice(0, 2000) })
    })
  })
  return { ok: output.code === 0, command, code: output.code, output: output.text, elapsedMs: Date.now() - started }
}

const METHODS = {
  status: methodStatus,
  listSessions: methodListSessions,
  readSession: methodReadSession,
  setMirror: methodSetMirror,
  sendPrompt: methodSendPrompt,
  stopChat: methodStopChat,
  openWindow: methodOpenWindow,
  openGui: methodOpenGui,
  guiStatus: methodGuiStatus,
  guiClasses: methodGuiClasses,
  applyConfig: methodApplyConfig,
  testDsh: methodTestDsh,
  noticeStatus: methodNoticeStatus,
  noticeDemo: methodNoticeDemo,
}

/** 官方 class 速查表：给「自定义样式（CSS）」当索引，用户照着改就知道动哪个选择器 */
async function methodGuiClasses() {
  return { groups: GUI_CLASS_GROUPS, flat: listGuiClasses() }
}

/**
 * 让设置页把新配置**主动推给 sidecar**。
 *
 * 为什么必须有这个：宿主的 `set_plugin_config` 只写 store + 通知前端，
 * **不会**给正在运行的 sidecar 发 `{op:'config'}`（那条只在 sidecar 启动时发一次，
 * 见 src-tauri/src/plugin_sidecar.rs）。所以如果只靠宿主，改设置必须 disable/enable 插件才生效。
 * 设置页跑在主窗口，`plugin.sidecar.request` 是可用的（sidecar 只允许 main 窗口调用）。
 */
async function methodApplyConfig(params = {}) {
  if (!params || typeof params.config !== 'object' || params.config === null) {
    throw new Error('applyConfig 需要 { config: {...} }')
  }
  applyConfig(params.config)
  return { ok: true, config: { ...config } }
}

// ---------------------------------------------------------------- 本机 HTTP

function httpReply(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload ?? null), 'utf8')
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Dsh-Chat-Token',
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (!text) {
        resolve({})
        return
      }
      try {
        const parsed = JSON.parse(text)
        resolve(parsed && typeof parsed === 'object' ? parsed : {})
      } catch {
        resolve(null)
      }
    })
    req.on('error', () => resolve(null))
  })
}

/** 卡片侧路由表：与 stdio RPC 共用同一批方法实现。 */
const HTTP_ROUTES_TABLE = {
  '/health': { method: 'GET', call: async () => ({ ok: true, routes: HTTP_ROUTES, port: httpPort }) },
  '/status': { method: 'GET', call: () => methodStatus() },
  '/sessions': { method: 'GET', call: (params) => methodListSessions(params) },
  '/session': { method: 'GET', call: (params) => methodReadSession(params) },
  '/mirror': { method: 'POST', call: (params) => methodSetMirror(params) },
  '/prompt': { method: 'POST', call: (params) => methodSendPrompt(params) },
  '/stop': { method: 'POST', call: () => methodStopChat() },
  '/window': { method: 'POST', call: (params) => methodOpenWindow(params) },
  '/gui': { method: 'POST', call: (params) => methodGuiUrl(params) },
  '/notice/view': { method: 'POST', call: (params) => methodNoticeView(params) },
}

/** 端口约定：未配置/非法 → 默认 23457；显式 0 → 交给系统分配（测试用）。 */
function wantedHttpPort() {
  const n = Number(config.httpPort)
  if (Number.isFinite(n) && n >= 0) return Math.round(n)
  return DEFAULT_HTTP_PORT
}

function startHttp() {
  if (httpServer) return
  bindHttp(wantedHttpPort(), true)
}

/** 绑定端口；默认端口被占用时自动退到系统分配端口（卡片端口来自事件 payload，不受影响）。 */
function bindHttp(port, allowFallback) {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      httpReply(res, 204, null)
      return
    }
    let parsed
    try {
      parsed = new URL(req.url || '/', 'http://127.0.0.1')
    } catch {
      httpReply(res, 400, { ok: false, error: 'bad url' })
      return
    }
    const path = parsed.pathname
    if (req.headers['x-dsh-chat-token'] !== httpToken && parsed.searchParams.get('token') !== httpToken) {
      httpReply(res, 403, { ok: false, error: 'token 不匹配' })
      return
    }
    const route = HTTP_ROUTES_TABLE[path]
    if (!route) {
      httpReply(res, 404, { ok: false, error: `未知路由 ${path}`, routes: HTTP_ROUTES })
      return
    }
    if (req.method !== route.method) {
      httpReply(res, 405, { ok: false, error: `请用 ${route.method} ${path}` })
      return
    }
    let params = {}
    if (route.method === 'POST') {
      const body = await readJsonBody(req)
      if (body === null) {
        httpReply(res, 400, { ok: false, error: '请求体不是合法 JSON' })
        return
      }
      params = body
    } else {
      params = Object.fromEntries(parsed.searchParams.entries())
    }
    try {
      const result = await route.call(params)
      httpReply(res, 200, { ok: true, result })
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      log('warn', `HTTP ${path} 失败`, { error: lastError })
      httpReply(res, 400, { ok: false, error: lastError })
    }
  })
  server.on('error', (error) => {
    if (error && error.code === 'EADDRINUSE' && allowFallback) {
      log('warn', '本机 HTTP 默认端口被占用，改用系统分配端口', { port })
      bindHttp(0, false)
      return
    }
    log('error', '本机 HTTP 端口绑定失败', {
      port,
      error: String(error),
      hint: '端口可能被上一个 sidecar 占着：到插件页刷新（force 重启 sidecar），或把 httpPort 改成别的端口',
    })
  })
  server.listen(port, '127.0.0.1', () => {
    httpServer = server
    const address = server.address()
    httpPort = address && typeof address === 'object' ? address.port : port
    log('info', '本机 HTTP 已就绪', { port: httpPort, routes: HTTP_ROUTES })
  })
}

function stopHttp() {
  if (!httpServer) return
  try {
    httpServer.close()
  } catch {
    /* 忽略关闭异常 */
  }
  httpServer = null
  httpPort = null
}

// ---------------------------------------------------------------- 输入循环

function applyConfig(raw) {
  const previousPort = Number(config.httpPort)
  const previousNoticePoll = Number(config.noticePollMs)
  const previousNoticeEnabled = Boolean(config.noticeEnabled)
  // 用 config 模块给的签名：任一个 show* 或 guiPort 变了都要重建反代（清单漏一个就会"设置没用"）
  const previousGui = guiSignature(config)
  config = normalizeConfig(raw ?? {})
  const nextGui = guiSignature(config)
  if (nextGui !== previousGui && gui.proxy) {
    // 去装饰 CSS 与端口是反代启动时固化的：配置一变就关掉，下次「小窗打开」用新配置重建
    const stale = gui.proxy
    gui.proxy = null
    gui.target = null
    void stale.close().catch(() => {})
    log('info', 'GUI 代理配置变化，已关闭旧代理（重开小窗生效）')
  }
  log('info', '配置已更新', {
    dshHome: config.dshHome || '(默认 ~/.dsh)',
    dshCommand: config.dshCommand,
    provider: config.provider,
    model: config.model,
    mirrorLimit: config.mirrorLimit,
    pollMs: config.pollMs,
    httpPort: config.httpPort,
    noticeEnabled: config.noticeEnabled,
    noticePollMs: config.noticePollMs,
  })
  if (Number(config.httpPort) !== previousPort) {
    stopHttp()
    startHttp()
  } else {
    startHttp()
  }
  // 状态通知巡检：首次配置/开关切换/轮询间隔变化都要重启；其余只同步停留时长
  if (!config.noticeEnabled) {
    stopNoticeLoop()
  } else if (!previousNoticeEnabled || !noticeLoop.timer || Number(config.noticePollMs) !== previousNoticePoll) {
    startNoticeLoop()
  } else if (noticeLoop.tracker) {
    noticeLoop.tracker.doneHoldMs = config.noticeDoneHoldMs
  }
  if (config.autoOpenWindow && !autoOpened) {
    autoOpened = true
    void methodOpenWindow({}).catch((error) => log('warn', '自动打开小窗失败', { error: String(error) }))
  }
}

function handleResolved(msg) {
  const kind = msg.resolutionKind ?? msg.resolution ?? 'unknown'
  const payload = msg.payload && typeof msg.payload === 'object' ? msg.payload : {}
  // 状态卡被 ×（dismissed）：本轮静默，直到下一个 turn/start；expired（完成卡到时自动收）无需处理
  if (payload.notice === true || msg.eventType === 'dsh-chat.notice') {
    const sessionId = String(payload.sessionId ?? '')
    if (sessionId && kind === 'dismissed' && noticeLoop.tracker) {
      noticeLoop.tracker.markDismissed(sessionId)
    }
  }
  log('info', '小窗卡片已被处理', { actionId: msg.actionId ?? null, kind })
}

function handleLine(line) {
  const text = line.trim()
  if (!text) return
  let msg
  try {
    msg = JSON.parse(text)
  } catch {
    log('warn', '收到无法解析的宿主指令', { line: text.slice(0, 200) })
    return
  }
  if (msg.op === 'shutdown') {
    void shutdown()
    return
  }
  if (msg.op === 'config') {
    applyConfig(msg.config)
    return
  }
  if (msg.op === 'resolved') {
    handleResolved(msg)
    return
  }
  if (msg.requestId && msg.method) {
    const handler = METHODS[msg.method]
    if (!handler) {
      respond(msg.requestId, false, null, `未知方法：${msg.method}`)
      return
    }
    Promise.resolve()
      .then(() => handler(msg.params ?? {}))
      .then((result) => respond(msg.requestId, true, result))
      .catch((error) => {
        lastError = error instanceof Error ? error.message : String(error)
        log('error', `RPC ${msg.method} 失败`, { error: lastError })
        respond(msg.requestId, false, null, error)
      })
    return
  }
  log('warn', '未知的宿主指令', { op: msg.op ?? null })
}

let shuttingDown = false
async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  stopNoticeLoop()
  stopHttp()
  try {
    if (gui.proxy) await gui.proxy.close()
  } catch (error) {
    log('warn', '关闭 GUI 代理失败', { error: String(error) })
  }
  gui.proxy = null
  try {
    if (sdk) await sdk.shutdown()
  } catch (error) {
    log('warn', '关闭 DSH SDK 进程失败', { error: String(error) })
  } finally {
    sdk?.kill?.()
    sdk = null
    process.exit(0)
  }
}

process.on('SIGTERM', () => void shutdown())
process.on('SIGINT', () => void shutdown())
process.stdin.on('end', () => void shutdown())

createInterface({ input: process.stdin }).on('line', handleLine)

send({ op: 'ready' })
log('info', 'dsh-chat sidecar 已启动', { node: process.version, pid: process.pid })
