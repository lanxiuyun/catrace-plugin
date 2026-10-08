/**
 * dsh-chat sidecar —— Catrace 外挂插件进程（stdio JSON Lines v1）。
 *
 * 两条通路：
 *  1. stdio JSON Lines：设置页（主窗）用 `plugin.sidecar.request` 调本进程的方法；
 *  2. 本机 HTTP（127.0.0.1:<httpPort>，带一次性 token）：
 *     **Toast 小窗卡片不能调 sidecar.request**（宿主只放行 `main` 窗），所以卡片用 fetch 走这里。
 *
 * 职责：读 DSH 会话日志（$DSH_HOME/sessions/.../session.v4.jsonl.zstd）驱动右下角状态卡；
 *       小窗 = 官方 GUI 的同源反代（发现正在运行的 DSH Desktop → 自签 cookie → 反代）。
 *       0.2.x 的镜像卡 / SDK 提问链路已移除（下一个大版本再以更好的形态回来）。
 *
 * 协议：stdout 只写 JSON Lines（宿主逐行解析），诊断走 log op 或 stderr。
 */
import { randomBytes } from 'node:crypto'
import http from 'node:http'
import process from 'node:process'
import { createInterface } from 'node:readline'

import { cropFlagsFor, DEFAULT_CONFIG, forceLabelsFor, guiSignature, normalizeConfig } from './lib/config.mjs'
import { GUI_CLASS_GROUPS, listGuiClasses } from './lib/gui-classes.mjs'
import { describeDiscoveryFailure, discoverHost, mintAuthCookie, readBrowserSessionSecret } from './lib/dsh-gui.mjs'
import { NoticeTracker } from './lib/inspector.mjs'
import { buildCropCss, startGuiProxy } from './lib/gui-proxy.mjs'
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
const DEFAULT_HTTP_PORT = 23457
const HTTP_ROUTES = ['/health', '/status', '/sessions', '/session', '/window', '/gui', '/notice/view']

/** @type {ReturnType<typeof normalizeConfig>} */
let config = { ...DEFAULT_CONFIG }
let lastError = null
/** @type {http.Server|null} */
let httpServer = null
let httpPort = null
/** 卡片访问本机 HTTP 的一次性口令：只有拿到已发布 payload 的卡片知道。 */
const httpToken = randomBytes(16).toString('hex')

// ---- 状态通知巡检（NoticeTracker 是纯逻辑，IO 与定时器都在这里）----
const noticeLoop = { timer: null, tracker: null, polling: false, lastPollAt: 0 }
/** 正开着小窗卡的会话：状态卡让位（暂停发布），小窗关掉后再按当前状态弹回 */
const openWindows = new Set()

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
const CONTRACT_VERSION = 7

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

/** 小窗默认打开的会话：最近活跃的那条（固定会话的能力随镜像卡一起移除了）。 */
function defaultSessionId() {
  const latest = safe(() => latestSession({ dshHome: dshHome() }), null)
  return latest?.id ?? ''
}

// ---------------------------------------------------------------- 方法实现

async function methodStatus() {
  const home = dshHome()
  // 设置页的「GUI 复用状态」行直接读这里（以前 settings 只认 status.gui，但 status 不带 gui → 永远显示"未启动"）
  let gui = null
  try {
    const info = await methodGuiStatus()
    gui = {
      ready: info.ready,
      proxyUrl: info.proxyUrl,
      target: info.target,
      lastError: info.lastError,
      lastSessionId: info.guiSessionId,
      credentialsFound: info.credentialsFound,
      cookieRefreshes: info.cookieRefreshes,
      cookieTtlMs: info.cookieTtlMs,
    }
  } catch {
    gui = null
  }
  return {
    dshHome: home,
    node: process.version,
    zstd: typeof (await import('node:zlib')).zstdDecompressSync === 'function',
    httpPort,
    httpReady: Boolean(httpServer?.listening),
    lastError,
    // 给设置页做"是不是在跑旧代码"的自检
    contract: CONTRACT_VERSION,
    // 生效配置（normalizeConfig 之后）：设置界面以它为准，避免"存盘缺键 → 开关显示成关"
    config: { ...config },
    gui,
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
  const id = String(params.id ?? '') || defaultSessionId()
  if (!id) return { session: null, reason: 'no-session' }
  const limit = clampInt(params.limit, 1, 200, 40)
  const session = safe(
    () => readSession({ dshHome: dshHome(), id, limit, maxText: params.maxText ?? 4000 }),
    null,
  )
  if (!session) return { session: null, reason: 'unreadable', id }
  return { session }
}

/** GUI 复用状态（A2：把真 DSH GUI 代理进小窗） */
const gui = { proxy: null, target: null, lastError: null, startedAt: 0, lastSessionId: '', diag: [], ttlMs: 0 }

/**
 * 确保「真 GUI」可用：发现正在运行的 DSH host → 自签 cookie → 起同源反代。
 * 找不到 host / 拿不到凭据都只抛错，不影响其它功能（状态卡照常巡检发布）。
 *
 * **票会过期**（写死 7 天，见 `dsh-gui.mjs` 的 `DEFAULT_COOKIE_TTL_MS`），小窗却是常驻的 ⇒
 * 把"换一张新票"的能力交给反代（`refreshCookie`）：吃到 401 就重读凭据文件（票过期、密钥被重置
 * 都一并解决）并按同一个 authority 重签、重放。没有这条，小窗开满寿命后整片 iframe 就变成一行
 * `dsh web authentication required`（0.3.1 的线上 bug）。
 */
async function ensureGui() {
  if (gui.proxy && gui.target) {
    const alive = await fetch(`${gui.proxy.url}catrace-gui-health`).then((r) => r.ok).catch(() => false)
    if (alive) return gui
    gui.proxy = null
    gui.target = null
  }
  // 测试缝：DSH_GUI_COOKIE_TTL_MS 能把票寿命压到毫秒级（生产不设 ⇒ 用 dsh-gui 里写死的 7 天）
  const ttlOverride = Number(process.env.DSH_GUI_COOKIE_TTL_MS)
  const ttlMs = Number.isFinite(ttlOverride) && ttlOverride > 0 ? ttlOverride : undefined
  const readSecret = () => readBrowserSessionSecret({ dshHome: config.dshHome || undefined })
  const secret = readSecret()
  if (!secret) throw new Error('读不到 ~/.dsh/.credentials.yaml 里的 client-connection/browser-session 密钥')
  gui.diag = []
  // 测试缝：e2e 用临时端口起假 host，生产不设这两个环境变量时走桌面默认探测区间
  const probeFrom = Number(process.env.DSH_GUI_PROBE_FROM)
  const probeDrift = Number(process.env.DSH_GUI_PROBE_DRIFT)
  const found = await discoverHost({
    secret,
    diag: gui.diag,
    ...(ttlMs === undefined ? {} : { ttlMs }),
    ...(Number.isFinite(probeFrom) ? { from: probeFrom } : {}),
    ...(Number.isFinite(probeDrift) ? { drift: probeDrift } : {}),
  })
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
    // 反代换票时**重读凭据**（票过期、密钥被 DSH 重置都能自愈），寿命仍是写死的那 7 天
    refreshCookie: () => {
      const fresh = readSecret()
      if (!fresh) throw new Error('读不到 ~/.dsh/.credentials.yaml 里的 client-connection/browser-session 密钥')
      return mintAuthCookie({ secret: fresh, authority: found.authority, ...(ttlMs === undefined ? {} : { ttlMs }) })
    },
  })
  gui.cssBytes = Buffer.byteLength(cssText, 'utf8')
  gui.proxy = proxy
  gui.target = { port: found.port, authority: found.authority, sessions: found.sessions }
  gui.ttlMs = found.ttlMs
  gui.startedAt = Date.now()
  gui.lastError = null
  log('info', 'GUI 复用已就绪', { target: found.authority, proxy: proxy.url, sessions: found.sessions, cookieTtlMs: found.ttlMs })
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
    // 反代换过几次票（票过 7 天才需要换，正常情况下是 0）
    cookieRefreshes: gui.proxy?.cookieRefreshes?.() ?? 0,
    // 这张票的寿命（毫秒；写死 7 天）
    cookieTtlMs: gui.ttlMs || null,
    // 实际注入的裁剪项（true = 隐藏），由 show* 取反而来，便于排查"设置了没生效"
    crop: cropFlagsFor(config),
    // 紧凑留白是否已进当前反代 + 注入的 CSS 字节数：用户问"怎么没区别"时先看这两个数
    compactSpacing: Boolean(config.compactSpacing),
    cssBytes: gui.cssBytes ?? null,
  }
}

/**
 * A2：把某条会话的**真 GUI** 准备好（发现 host → 自签 cookie → 同源反代），
 * 返回 iframe 用的 URL 与会话标题。状态卡「正文点击」与 /window 路由共用这一步；
 * 不点名 sessionId 时打开最近活跃的会话。
 */
async function methodGuiUrl(params = {}) {
  const sessionId = String(params.sessionId ?? '') || defaultSessionId()
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
  // 小窗卡开了：该会话的状态卡让位（暂停发布），小窗关闭后再按当前状态弹回
  openWindows.add(sessionId)
  send({
    op: 'publish',
    event: {
      eventType: 'dsh-chat.window',
      kind: 'dsh-chat',
      title: title || 'DSH 对话',
      body: title || sessionId || 'DSH GUI',
      level: 'info',
      sticky: true,
      dedupeKey: WINDOW_DEDUPE_KEY,
      payload: {
        open: true,
        sessionId,
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
      title: action.title || 'DSH 任务',
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
        cwd: action.cwd || '',
        autoExpand: action.autoExpand === true,
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
      for (const action of actions) {
        // 设置页手动开的小窗卡还开着：状态卡让位，什么都不发（小窗关闭时按当前状态补发）
        if (openWindows.has(entry.id)) break
        // 等你审批：waiting 卡带 autoExpand，状态卡自己会原地展开对话交互区
        publishNotice(entry.id, action)
      }
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
  log('info', '状态通知巡检已启动', { interval, doneHoldMs: config.noticeDoneHoldMs })
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


const METHODS = {
  status: methodStatus,
  listSessions: methodListSessions,
  readSession: methodReadSession,
  openWindow: methodOpenGui,
  openGui: methodOpenGui,
  guiStatus: methodGuiStatus,
  guiClasses: methodGuiClasses,
  applyConfig: methodApplyConfig,
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
  // /window 一律开官方 GUI 小窗（0.2.x 的 mode 镜像/对话分支随镜像卡移除；旧调用方带的 mode 参数直接忽略）
  '/window': { method: 'POST', call: (params) => methodOpenGui(params) },
  // 状态卡原地展开用：只准备反代并返回 iframe 地址，不发小窗卡
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
    httpPort: config.httpPort,
    guiPort: config.guiPort,
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
}

function handleResolved(msg) {
  const kind = msg.resolutionKind ?? msg.resolution ?? 'unknown'
  const payload = msg.payload && typeof msg.payload === 'object' ? msg.payload : {}
  if (payload.open === true) {
    // 小窗卡被关掉/被另一会话的小窗替换：让位结束，按当前状态把状态卡请回来
    const sessionId = String(payload.sessionId ?? payload.guiSessionId ?? '')
    if (sessionId && (kind === 'dismissed' || kind === 'superseded') && openWindows.delete(sessionId)) {
      const action = noticeTracker().currentAction(sessionId)
      if (action) publishNotice(sessionId, action)
    }
  } else if (payload.notice === true || msg.eventType === 'dsh-chat.notice') {
    const sessionId = String(payload.sessionId ?? '')
    if (sessionId && kind === 'dismissed' && noticeLoop.tracker) {
      // 状态卡上的 ×：本轮静默（下一个 turn/start 解除）。
      // 但如果该会话刚打开了小窗（正文点击 → 让位），这次关闭不是嫌吵，不能记 ×。
      if (!openWindows.has(sessionId)) noticeLoop.tracker.markDismissed(sessionId)
    }
    // expired（完成卡到时自动收）无需处理
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
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown())
process.on('SIGINT', () => void shutdown())
process.stdin.on('end', () => void shutdown())

createInterface({ input: process.stdin }).on('line', handleLine)

send({ op: 'ready' })
log('info', 'dsh-chat sidecar 已启动', { node: process.version, pid: process.pid })
