import { spawn } from 'node:child_process'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

const pluginId = process.env.CATRACE_PLUGIN_ID || 'dota2-typewriter'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(__dirname, 'typewriter.ps1')
const isWindows = process.platform === 'win32'
const DEDUPE = 'dota2-typewriter:card'
const MIN_MS = 20
const MAX_MS = 60_000
const DEFAULT_MS = 100

const DEFAULT_CONFIG = {
  showCard: true,
  intervalMs: DEFAULT_MS,
}

/** @type {typeof DEFAULT_CONFIG} */
let config = { ...DEFAULT_CONFIG }
let running = false
let roundTimer = null
let cycleBusy = false
/** @type {import('node:child_process').ChildProcessWithoutNullStreams | null} */
let worker = null

const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`)
const log = (message, data, level = 'info') => send({ v: 1, op: 'log', level, message, data })

function respond(requestId, ok, result, error) {
  const message = { v: 1, op: 'response', requestId, ok }
  if (ok) message.result = result ?? null
  else message.error = error || 'request failed'
  send(message)
}

function clampMs(value, fallback = DEFAULT_MS) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(MAX_MS, Math.max(MIN_MS, Math.round(n)))
}

function normalizeConfig(input = {}) {
  return {
    showCard: input.showCard !== false,
    intervalMs: clampMs(input.intervalMs, config.intervalMs),
  }
}

function publishCard() {
  if (!config.showCard) return
  send({
    v: 1,
    op: 'publish',
    event: {
      eventType: 'dota2-typewriter.card',
      kind: 'dota2-typewriter',
      title: '暗黑狂欢打字机',
      body: running ? '正在打 a→z' : '待机',
      level: running ? 'success' : 'info',
      sticky: true,
      actions: running
        ? [
            { id: 'pause', label: '暂停' },
            { id: 'end', label: '结束' },
          ]
        : [
            { id: 'start', label: '开始' },
            { id: 'end', label: '结束' },
          ],
      payload: { running, intervalMs: config.intervalMs },
      dedupeKey: DEDUPE,
    },
  })
}

function publishDismiss() {
  send({
    v: 1,
    op: 'publish',
    event: {
      eventType: 'dota2-typewriter.card',
      kind: 'dota2-typewriter',
      title: '暗黑狂欢打字机',
      body: '',
      sticky: true,
      payload: { dismiss: true },
      dedupeKey: DEDUPE,
    },
  })
}

function ensureWorker() {
  if (!isWindows) return false
  if (worker && !worker.killed) return true
  worker = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  )
  worker.on('exit', () => {
    worker = null
  })
  worker.stderr.on('data', (buf) => {
    const text = String(buf).trim()
    if (text) log('powershell stderr', { text }, 'warn')
  })
  return true
}

function sendCmd(cmd) {
  if (!ensureWorker()) return
  try {
    worker.stdin.write(`${cmd}\n`)
  } catch (e) {
    log('write worker failed', { error: String(e) }, 'warn')
  }
}

function fireCycle() {
  if (cycleBusy) return
  cycleBusy = true
  sendCmd('CYCLE')
  cycleBusy = false
}

function startRounds() {
  if (!isWindows) {
    log('typewriter is Windows-only', {}, 'warn')
    return
  }
  stopRounds()
  running = true
  fireCycle()
  roundTimer = setInterval(fireCycle, config.intervalMs)
  publishCard()
}

function stopRounds() {
  if (roundTimer) {
    clearInterval(roundTimer)
    roundTimer = null
  }
  running = false
}

function hideCardAndStop() {
  stopRounds()
  config.showCard = false
  publishDismiss()
}

function applyConfig(input) {
  const next = normalizeConfig(input)
  const intervalChanged = next.intervalMs !== config.intervalMs
  config = next
  if (!config.showCard) {
    hideCardAndStop()
    return
  }
  if (running && intervalChanged) {
    startRounds()
    return
  }
  publishCard()
}

send({ v: 1, op: 'ready' })
log('dota2-typewriter ready', { pluginId, pid: process.pid, windows: isWindows })
let gotConfig = false
setTimeout(() => {
  if (!gotConfig && config.showCard) publishCard()
}, 400)

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }

  if (message.op === 'shutdown') {
    stopRounds()
    try {
      if (worker && !worker.killed) {
        worker.stdin.write('QUIT\n')
        worker.kill()
      }
    } catch {
      /* ignore */
    }
    process.exit(0)
  }

  if (message.op === 'config' && message.config && typeof message.config === 'object') {
    gotConfig = true
    applyConfig(message.config)
  }

  if (message.requestId && message.method) {
    const method = String(message.method)
    const params = message.params && typeof message.params === 'object' ? message.params : {}
    try {
      if (method === 'setConfig') {
        applyConfig(params)
        respond(message.requestId, true, { showCard: config.showCard, intervalMs: config.intervalMs, running })
        return
      }
      if (method === 'status') {
        respond(message.requestId, true, { showCard: config.showCard, intervalMs: config.intervalMs, running })
        return
      }
      respond(message.requestId, false, null, `unknown method: ${method}`)
    } catch (e) {
      respond(message.requestId, false, null, e instanceof Error ? e.message : String(e))
    }
  }

  if (message.op === 'resolved') {
    const actionId = message.actionId || ''
    const kind = message.resolutionKind || ''
    if (kind === 'dismissed' || actionId === 'end' || actionId === 'dismiss') {
      hideCardAndStop()
      return
    }
    if (actionId === 'start') startRounds()
    else if (actionId === 'pause') {
      stopRounds()
      publishCard()
    }
  }
})
