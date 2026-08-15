/**
 * PasteDrop sidecar — 宿主 JSONL 协议端点。
 *
 * 本进程只做三件事：
 *   1. 与宿主走 sidecar 契约（ready/publish/log/response，config/resolved/shutdown/request）
 *   2. 监督 PowerShell worker（runtime/main.ps1，干全局键盘钩子 + 剪贴板存图的重活）
 *   3. 把 worker 的 `saved` 报告按配置转成 Toast，处理卡片按钮（打开文件夹）
 *
 * 为什么 worker 用 PowerShell：全局低级键盘钩子（WH_KEYBOARD_LL）需要真正的 Win32
 * 消息循环，Node 纯 JS 拿不到；PowerShell 是 Windows 标配（含 .NET / System.Windows.Forms
 * 剪贴板与 Shell.Application COM），零额外依赖，与 bt-music 的 Add-Type C# 同款方案。
 * worker 把 PasteDrop 的 Python 实现逻辑近直译为 C# 钩子。
 *
 * worker 通信：stdout 只发 ASCII JSON 标记（ready/saved/fatal/exit），saved 的路径
 * 详情写 runtime/last-saved.txt（中文路径不走 stdout）；关闭用 shutdown.signal 文件信号，
 * 超时 taskkill 兜底（宿主 Job Object 也会在退出时清掉整棵树）。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const pluginId = process.env.CATRACE_PLUGIN_ID || 'pastedrop'
const isWindows = process.platform === 'win32'

const DEFAULT_CONFIG = {
  /** both = 桌面 + 资源管理器当前文件夹（PasteDrop 原生行为） */
  saveScope: 'both',
  namePrefix: 'Pasted Image',
  /** 保存后是否弹一张 Toast 卡片（原生 PasteDrop 是静默的） */
  notifyOnSave: false,
  /** 0 = 卡片不自动消失 */
  toastAutoHideSec: 4,
}

let config = { ...DEFAULT_CONFIG }

let worker = null
let workerRl = null
let workerGeneration = 0
let workerRestartTimer = null
let fatalExited = false
let shuttingDown = false

/** null=未知 false=缺依赖 true=OK */
let workerOk = null
let lastWorkerError = ''
/** @type {{ path: string, fileName: string, size: number, savedAt: string } | null} */
let lastSaved = null
let workerErrorNotified = false

const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`)
const log = (message, data, level = 'info') =>
  send({ v: 1, op: 'log', level, message, data })

function respond(requestId, ok, result, error) {
  const message = { v: 1, op: 'response', requestId, ok }
  if (ok) message.result = result ?? null
  else message.error = error || 'request failed'
  send(message)
}

function clampToastSec(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  const rounded = Math.round(n)
  if (rounded <= 0) return 0
  return Math.min(600, Math.max(3, rounded))
}

function normalizeConfig(input = {}) {
  const next = { ...config }
  if (input.saveScope === 'desktop' || input.saveScope === 'explorer' || input.saveScope === 'both') {
    next.saveScope = input.saveScope
  }
  if (typeof input.namePrefix === 'string') next.namePrefix = input.namePrefix.trim() || 'Pasted Image'
  if (typeof input.notifyOnSave === 'boolean') next.notifyOnSave = input.notifyOnSave
  if (typeof input.toastAutoHideSec === 'number') {
    next.toastAutoHideSec = clampToastSec(input.toastAutoHideSec, DEFAULT_CONFIG.toastAutoHideSec)
  }
  return next
}

function workerEnv() {
  return {
    ...process.env,
    CATRACE_PD_SAVE_SCOPE: config.saveScope,
    CATRACE_PD_NAME_PREFIX: config.namePrefix,
  }
}

function notifyWorkerError(message) {
  if (workerErrorNotified) return
  workerErrorNotified = true
  log('worker startup failed', { message }, 'error')
  send({
    v: 1,
    op: 'publish',
    event: {
      eventType: 'pastedrop.worker-error',
      kind: 'pastedrop',
      title: 'PasteDrop 钩子启动失败',
      body: `需要 Windows PowerShell 5.1+（系统标配）。${message}`,
      level: 'warning',
      sticky: false,
      actions: [{ id: 'dismiss', label: '知道了' }],
      payload: { auto_hide_ms: 15000, error: message },
      dedupeKey: 'pastedrop:worker-error',
    },
  })
}

function publishSaved(info) {
  if (!config.notifyOnSave) return
  const hideSec = clampToastSec(config.toastAutoHideSec, DEFAULT_CONFIG.toastAutoHideSec)
  const sticky = hideSec <= 0
  const payload = {
    path: info.path,
    folder: path.dirname(info.path),
    fileName: info.fileName,
    size: info.size,
    savedAt: info.savedAt,
    publishedAt: new Date().toISOString(),
  }
  if (!sticky) payload.auto_hide_ms = hideSec * 1000
  send({
    v: 1,
    op: 'publish',
    event: {
      eventType: 'pastedrop.saved',
      kind: 'pastedrop',
      title: '图片已保存',
      body: info.fileName,
      level: 'success',
      sticky,
      actions: [
        { id: 'open-folder', label: '打开文件夹' },
        { id: 'dismiss', label: sticky ? '知道了' : '关闭' },
      ],
      payload,
      dedupeKey: `pastedrop:saved:${info.path}`,
    },
  })
}

function readLastSavedPath() {
  const file = path.join(process.cwd(), 'runtime', 'last-saved.txt')
  try {
    const raw = fs.readFileSync(file, 'utf8').trim()
    if (!raw) return null
    // 成功读取后清掉，避免下次误报旧记录。
    try {
      fs.unlinkSync(file)
    } catch {}
    return raw
  } catch {
    return null
  }
}

function startWorker() {
  if (!isWindows) {
    lastWorkerError = '仅支持 Windows'
    return
  }
  const generation = ++workerGeneration
  fatalExited = false
  workerErrorNotified = false
  if (workerRestartTimer) {
    clearTimeout(workerRestartTimer)
    workerRestartTimer = null
  }
  if (worker) stopWorker()

  // -Sta: System.Windows.Forms.Clipboard 需要 STA 线程。
  worker = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Sta', '-File', path.join('runtime', 'main.ps1')],
    {
      cwd: process.cwd(), // manifest cwd: "." → 插件目录
      env: workerEnv(),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )
  const pid = worker.pid

  worker.on('error', (error) => {
    if (generation !== workerGeneration) return
    workerOk = false
    lastWorkerError = `powershell 启动失败：${error.message}`
    log('worker failed to start', { error: lastWorkerError }, 'error')
    notifyWorkerError(error.message)
    worker = null
  })

  worker.on('exit', (code, signal) => {
    if (generation !== workerGeneration) return
    worker = null
    workerRl = null
    if (shuttingDown) return
    if (fatalExited) {
      log('worker exited after fatal; not restarting', { code, signal }, 'warn')
      return
    }
    lastWorkerError = `worker exited code=${code} signal=${signal || ''}`
    log('worker exited; restarting in 2s', { code, signal }, 'warn')
    workerRestartTimer = setTimeout(() => {
      workerRestartTimer = null
      if (generation === workerGeneration && !shuttingDown) startWorker()
    }, 2000)
    workerRestartTimer.unref?.()
  })

  workerRl = readline.createInterface({ input: worker.stdout })
  workerRl.on('line', (line) => {
    if (generation !== workerGeneration) return
    let message
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    if (!message || typeof message !== 'object') return
    switch (message.op) {
      case 'ready':
        workerOk = true
        lastWorkerError = ''
        log('worker ready', { pid })
        break
      case 'saved': {
        const filePath = readLastSavedPath()
        if (!filePath) {
          log('saved marker but no path file', {}, 'warn')
          break
        }
        let size = 0
        try {
          size = fs.statSync(filePath).size
        } catch {}
        lastSaved = {
          path: filePath,
          fileName: path.basename(filePath),
          size,
          savedAt: new Date().toISOString(),
        }
        log('image saved', { ...lastSaved })
        publishSaved(lastSaved)
        break
      }
      case 'fatal':
        fatalExited = true
        workerOk = false
        lastWorkerError = String(message.message || 'worker fatal')
        log('worker fatal', { error: lastWorkerError }, 'error')
        notifyWorkerError(lastWorkerError)
        break
      default:
        break
    }
  })
}

function stopWorker() {
  const child = worker
  worker = null
  workerRl = null
  if (!child) return
  // 文件信号优雅退出；taskkill 兜底（宿主 Job Object 也会在宿主退出时清树）。
  const signalFile = path.join(process.cwd(), 'runtime', 'shutdown.signal')
  try {
    fs.writeFileSync(signalFile, '1')
  } catch {}
  try {
    child.stdin?.end()
  } catch {}
  const killTimer = setTimeout(() => {
    try {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      }).unref?.()
    } catch {}
  }, 1500)
  killTimer.unref?.()
  child.on('exit', () => {
    clearTimeout(killTimer)
    try {
      fs.unlinkSync(signalFile)
    } catch {}
  })
  return child
}

function applyHostConfig(input) {
  const prevScope = config.saveScope
  const prevPrefix = config.namePrefix
  config = normalizeConfig(input)
  log('config applied', { config })

  if (!isWindows) {
    lastWorkerError = '仅支持 Windows'
    return
  }

  const workerRelevantChanged =
    config.saveScope !== prevScope || config.namePrefix !== prevPrefix

  if (worker) {
    if (workerRelevantChanged) {
      log('worker-relevant config changed; restarting worker', {})
      startWorker()
    }
    return
  }
  startWorker()
}

function statusPayload() {
  return {
    pluginId,
    platform: process.platform,
    supported: isWindows,
    workerOk,
    workerRunning: !!worker,
    workerPid: worker?.pid ?? null,
    config,
    lastSaved,
    lastWorkerError: lastWorkerError || null,
  }
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
      case 'setConfig': {
        applyHostConfig(params)
        respond(requestId, true, statusPayload())
        break
      }
      case 'testToast': {
        publishSaved({
          path: path.join('C:', '测试', 'Pasted Image 2026-01-01 00-00-00.png'),
          fileName: 'Pasted Image 2026-01-01 00-00-00.png',
          size: 0,
          savedAt: new Date().toISOString(),
        })
        respond(requestId, true, { sent: true })
        break
      }
      default:
        respond(requestId, false, null, `unknown method: ${method}`)
    }
  } catch (error) {
    respond(requestId, false, null, error instanceof Error ? error.message : String(error))
  }
}

function shutdown() {
  shuttingDown = true
  log('graceful shutdown', { workerRunning: !!worker })
  if (workerRestartTimer) clearTimeout(workerRestartTimer)
  const child = stopWorker()
  // 等 worker 退出并清掉信号文件再退出（worker 每 ~200ms 检查一次）。
  if (child) {
    child.once('exit', () => process.exit(0))
    setTimeout(() => process.exit(0), 1500).unref?.()
  } else {
    process.exit(0)
  }
}

send({ v: 1, op: 'ready' })
log('pastedrop sidecar ready', {
  pluginId,
  pid: process.pid,
  platform: process.platform,
  supported: isWindows,
  protocol: process.env.CATRACE_PROTOCOL_VERSION,
})

// 启用即监听：不能等 config 推送才起 worker。宿主只在「存过配置」后才会推 config
// （spawn_sidecar 里 get_plugin_config 为 Some 才 push），新启用插件没配置 → 永不 startWorker。
if (isWindows) {
  startWorker()
}

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
    if (message.actionId === 'open-folder') {
      const filePath =
        message.payload?.path || message.event?.payload?.path || message.payload?.filePath || ''
      if (filePath) {
        spawn('explorer.exe', [`/select,"${filePath}"`], { windowsHide: true, stdio: 'ignore' }).unref?.()
      }
    }
  }
})
