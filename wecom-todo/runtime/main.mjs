import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

const pluginId = process.env.CATRACE_PLUGIN_ID || 'wecom-todo'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STATE_PATH = path.join(__dirname, 'state.json')
const LOCAL_PATH = path.join(__dirname, 'local.json')
const MEDIA_DIR = path.join(__dirname, 'media')
const MAX_SEEN = 400
const DEFAULT_POLL_SEC = 120
const DEFAULT_CARD_SEC = 12

const DEFAULT_CONFIG = {
  cliPath: '',
  pollIntervalSec: DEFAULT_POLL_SEC,
  cardDurationSec: DEFAULT_CARD_SEC,
  onlyWhenActive: true,
  preserveOriginalTitle: true,
  enabled: true,
}

/** @type {typeof DEFAULT_CONFIG} */
let config = { ...DEFAULT_CONFIG }
/** @type {Map<string, string>} */
let seenMap = new Map()
let seeded = false
let lastPollAt = 0
let lastPollError = ''
let lastPublishAt = 0
let publishCount = 0
/** @type {Array<{ title: string, status: string, create_time: string }>} */
let lastTitles = []
let pollInFlight = null
let timer = null
let hostActivityActive = null
let hostActivityAt = 0

const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`)
const log = (message, data, level = 'info') => {
  const safe = data && typeof data === 'object' ? sanitize(data) : data
  send({ v: 1, op: 'log', level, message, data: safe })
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize)
  if (!value || typeof value !== 'object') return value
  const out = {}
  for (const [k, v] of Object.entries(value)) {
    if (k === 'extra_identity_context' || k.endsWith('_id') || k === 'userid' || k === 'todo_id') continue
    out[k] = sanitize(v)
  }
  return out
}

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
    cliPath: typeof input.cliPath === 'string' ? input.cliPath.trim() : config.cliPath,
    pollIntervalSec: clampInt(input.pollIntervalSec, 15, 3600, config.pollIntervalSec),
    cardDurationSec: clampInt(input.cardDurationSec, 0, 600, config.cardDurationSec),
    onlyWhenActive: input.onlyWhenActive !== false,
    preserveOriginalTitle: input.preserveOriginalTitle !== false,
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
        if (id) seenMap.set(String(id), String(stamp || '*'))
      }
    }
    if (raw.seeded === true) seeded = true
  } catch (error) {
    log('load state failed', { error: error instanceof Error ? error.message : String(error) }, 'warn')
  }
}

function saveState() {
  try {
    if (seenMap.size > MAX_SEEN) {
      seenMap = new Map([...seenMap.entries()].slice(-MAX_SEEN))
    }
    const seen = {}
    for (const [id, stamp] of seenMap) seen[id] = stamp
    fs.writeFileSync(STATE_PATH, JSON.stringify({ seen, seeded, savedAt: new Date().toISOString() }), 'utf8')
  } catch (error) {
    log('save state failed', { error: error instanceof Error ? error.message : String(error) }, 'warn')
  }
}

function itemId(item) {
  return String(item?.todo_id || item?.id || '')
}

function itemStamp(item) {
  return String(item?.update_time || item?.create_time || '')
}

function displayTitle(item) {
  const raw = String(item?.title || item?.content || '待办').trim()
  const line = raw.split('\n').map((s) => s.trim()).find(Boolean) || '待办'
  return line.length > 80 ? `${line.slice(0, 79)}…` : line
}

function displayBody(item) {
  const raw = String(item?.description || item?.title || '').trim()
  if (!raw) return ''
  return raw.length > 280 ? `${raw.slice(0, 279)}…` : raw
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

function decodeChunk(chunk) {
  if (typeof chunk === 'string') return chunk
  const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    try {
      return new TextDecoder('gbk').decode(buf)
    } catch {
      return buf.toString('utf8')
    }
  }
}

function npmGlobalBins() {
  const home = os.homedir()
  const appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
  const dirs = [
    path.join(appdata, 'npm'),
    path.join('D:', 'nvm4w', 'nodejs'),
    process.env.NVM_SYMLINK,
    process.execPath ? path.dirname(process.execPath) : '',
  ].filter(Boolean)
  return [...new Set(dirs)]
}

function looksLikeCli(file) {
  try {
    return fs.existsSync(file) && fs.statSync(file).isFile()
  } catch {
    return false
  }
}

function resolveCliPath() {
  const custom = String(config.cliPath || '').trim()
  if (custom && looksLikeCli(custom)) return custom
  const names =
    process.platform === 'win32'
      ? ['wecom-cli.cmd', 'wecom-cli.exe', 'wecom-cli']
      : ['wecom-cli']
  for (const dir of npmGlobalBins()) {
    for (const name of names) {
      const candidate = path.join(dir, name)
      if (looksLikeCli(candidate)) return candidate
    }
  }
  const pathDirs = String(process.env.PATH || process.env.Path || '').split(path.delimiter)
  for (const dir of pathDirs) {
    if (!dir) continue
    for (const name of names) {
      const candidate = path.join(dir, name)
      if (looksLikeCli(candidate)) return candidate
    }
  }
  return ''
}

function friendlySpawnError(raw) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim()
  if (/wecom-cli(\.exe)?/i.test(text) && /不是内部|not recognized|ENOENT|找不到/i.test(text)) {
    return '找不到 wecom-cli。请确认已 npm install -g @wecom/cli，或在设置里填写 wecom-cli.cmd 的完整路径。'
  }
  if (!text) return 'wecom-cli 执行失败'
  if (/[\uFFFD]/.test(text) || /wecom-cli\.exe/.test(text)) {
    return '找不到 wecom-cli。请确认已安装并在 PATH 中，或填写完整路径。'
  }
  return text.slice(0, 240)
}

function runCli(args, inputJson) {
  return new Promise((resolve, reject) => {
    const bin = resolveCliPath()
    if (!bin) {
      reject(new Error('找不到 wecom-cli。请在设置里填写 wecom-cli.cmd 的完整路径。'))
      return
    }
    const argv = inputJson ? [...args, '--json', inputJson] : args
    const env = { ...process.env }
    const extra = npmGlobalBins().filter((dir) => fs.existsSync(dir))
    env.PATH = [...extra, env.PATH || env.Path || ''].join(path.delimiter)
    env.Path = env.PATH
    const child = spawn(bin, argv, {
      windowsHide: true,
      shell: process.platform === 'win32' && /\.cmd$/i.test(bin),
      env,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += decodeChunk(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += decodeChunk(chunk)
    })
    child.on('error', (error) => {
      reject(new Error(friendlySpawnError(error.message)))
    })
    child.on('close', (code) => {
      const text = stdout.trim()
      if (code !== 0 && !text) {
        reject(new Error(friendlySpawnError(stderr) || `wecom-cli 退出 ${code}`))
        return
      }
      try {
        resolve(parseCliJson(text))
      } catch (error) {
        reject(new Error(error instanceof Error ? error.message : String(error)))
      }
    })
  })
}

function parseCliJson(text) {
  const start = text.indexOf('{')
  if (start < 0) throw new Error('wecom-cli 没有返回 JSON')
  const data = JSON.parse(text.slice(start))
  if (data && typeof data === 'object') delete data.extra_identity_context
  if (data?.error) {
    const msg = data.error.message || data.error.type || 'wecom-cli error'
    throw new Error(String(msg))
  }
  return data
}

function loadLocal() {
  try {
    if (!fs.existsSync(LOCAL_PATH)) return { todos: {} }
    const raw = JSON.parse(fs.readFileSync(LOCAL_PATH, 'utf8'))
    if (!raw || typeof raw !== 'object') return { todos: {} }
    if (!raw.todos || typeof raw.todos !== 'object') raw.todos = {}
    return raw
  } catch {
    return { todos: {} }
  }
}

function saveLocal(local) {
  fs.mkdirSync(__dirname, { recursive: true })
  fs.writeFileSync(LOCAL_PATH, JSON.stringify(local, null, 2), 'utf8')
}

function localEntry(local, id) {
  if (!local.todos[id]) local.todos[id] = { originalTitle: '', images: [] }
  if (!Array.isArray(local.todos[id].images)) local.todos[id].images = []
  return local.todos[id]
}

const ORIGINAL_TITLE_START = '[原始标题]'
const ORIGINAL_TITLE_END = '[/原始标题]'

function extractOriginalTitle(description) {
  const text = String(description || '')
  const match = text.match(/\[原始标题\]\n([\s\S]*?)\n\[\/原始标题\]/)
  return match ? match[1].trim() : ''
}

function originalTitleBlock(title) {
  return `${ORIGINAL_TITLE_START}\n${String(title || '').trim()}\n${ORIGINAL_TITLE_END}`
}

function appendOriginalTitle(description, title) {
  const current = String(description || '').trim()
  if (!String(title || '').trim()) return current
  if (current.includes(ORIGINAL_TITLE_START) && current.includes(ORIGINAL_TITLE_END)) return current
  const block = originalTitleBlock(title)
  return current ? `${current}\n\n${block}` : block
}

function mimeOf(file) {
  const ext = path.extname(file).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.bmp') return 'image/bmp'
  return 'application/octet-stream'
}

function thumbOf(absPath) {
  try {
    const buf = fs.readFileSync(absPath)
    if (buf.length > 700_000) return ''
    return `data:${mimeOf(absPath)};base64,${buf.toString('base64')}`
  } catch {
    return ''
  }
}

function boardItem(item, local) {
  const id = itemId(item)
  const entry = id ? localEntry(local, id) : { originalTitle: '', images: [] }
  const embedded = extractOriginalTitle(item.description)
  if (id && embedded && !entry.originalTitle) entry.originalTitle = embedded
  const images = (entry.images || []).map((rel, i) => {
    const abs = path.isAbsolute(rel) ? rel : path.join(__dirname, rel)
    return {
      name: path.basename(rel),
      rel,
      isCover: i === 0,
      dataUrl: thumbOf(abs),
    }
  })
  return {
    key: id,
    title: String(item.title || ''),
    description: String(item.description || ''),
    create_time: String(item.create_time || ''),
    originalTitle: entry.originalTitle || embedded,
    images,
  }
}

function mayPublishNow() {
  if (config.onlyWhenActive === false) return true
  if (hostActivityActive != null && Date.now() - hostActivityAt < 90_000) {
    return hostActivityActive === true
  }
  return true
}

function toEvent(item) {
  const cardSec = clampInt(config.cardDurationSec, 0, 600, DEFAULT_CARD_SEC)
  const sticky = cardSec <= 0
  const title = displayTitle(item)
  return {
    eventType: 'wecom-todo.item',
    kind: 'wecom-todo',
    title,
    body: displayBody(item),
    level: 'info',
    sticky,
    actions: [
      { id: 'done', label: '完成' },
      { id: 'dismiss', label: sticky ? '知道了' : '关闭' },
    ],
    payload: {
      todo_id: itemId(item),
      status: item.status || 'proceed',
      create_time: item.create_time || '',
      auto_hide_ms: sticky ? 0 : cardSec * 1000,
    },
    dedupeKey: `wecom-todo:${itemId(item)}:${itemStamp(item)}`,
  }
}

function publishItem(item) {
  send({ v: 1, op: 'publish', event: toEvent(item) })
  lastPublishAt = Date.now()
  publishCount += 1
}

function statusPayload() {
  return {
    pluginId,
    pid: process.pid,
    seeded,
    enabled: config.enabled !== false,
    pollIntervalSec: config.pollIntervalSec,
    cardDurationSec: config.cardDurationSec,
    onlyWhenActive: config.onlyWhenActive !== false,
    preserveOriginalTitle: config.preserveOriginalTitle !== false,
    seenCount: seenMap.size,
    lastPollAt,
    lastPollError: lastPollError || null,
    lastPublishAt,
    publishCount,
    lastCount: lastTitles.length,
    board: lastTitles,
    cliResolved: resolveCliPath() || '',
  }
}

async function fetchList() {
  const body = JSON.stringify({
    status_filter: ['proceed'],
    limit: 20,
  })
  const data = await runCli(['todo', 'list', '--page-count', '20'], body)
  return extractItems(data)
}

function extractItems(data) {
  const items = data?.items
  if (Array.isArray(items)) return items
  // wecom 后端把 items 当成对象（单条或 map），CLI schema 仍写 array
  if (items && typeof items === 'object') {
    if (items.todo_id || items.title) return [items]
    return Object.values(items).filter((v) => v && typeof v === 'object')
  }
  if (Array.isArray(data?.todo_list)) return data.todo_list
  return []
}

async function captureOriginalTitles(items, local, shouldWrite) {
  for (const item of items) {
    const id = itemId(item)
    if (!id) continue
    const entry = localEntry(local, id)
    const embedded = extractOriginalTitle(item.description)
    if (embedded) {
      entry.originalTitle = embedded
      continue
    }
    if (!shouldWrite || seenMap.has(id) || entry.originalTitle) continue
    const title = String(item.title || item.content || '').trim()
    if (!title) continue
    const description = appendOriginalTitle(item.description, title)
    await runCli(
      ['todo', 'update'],
      JSON.stringify({ items: { todo_id: id, title, description } }),
    )
    item.description = description
    entry.originalTitle = title
    saveLocal(local)
  }
}

async function saveTodo(params = {}) {
  const id = String(params.key || '')
  const title = String(params.title || '').trim()
  if (!id) throw new Error('missing todo')
  if (!title) throw new Error('标题不能为空')
  const description = String(params.description || '').trim()
  await runCli(
    ['todo', 'update'],
    JSON.stringify({ items: { todo_id: id, title, description } }),
  )
  const items = await fetchList()
  lastTitles = items.map((item) => boardItem(item, loadLocal()))
  return { ok: true, board: lastTitles }
}

async function createTodo(params = {}) {
  const title = String(params.title || '').trim()
  if (!title) throw new Error('标题不能为空')
  const description = String(params.description || '').trim()
  const data = await runCli(
    ['todo', 'create'],
    JSON.stringify({ items: { title, description } }),
  )
  const created = extractItems(data)[0] || data?.item || data
  const id = itemId(created)
  const items = await fetchList()
  const merged = loadLocal()
  lastTitles = items.map((item) => boardItem(item, merged))
  return { ok: true, key: id, board: lastTitles }
}

async function addImage(params = {}) {
  const id = String(params.key || '')
  const src = String(params.path || '').trim()
  if (!id) throw new Error('missing todo')
  if (!src || !fs.existsSync(src)) throw new Error('找不到图片文件')
  const dir = path.join(MEDIA_DIR, id.replace(/[^\w.-]/g, '_'))
  fs.mkdirSync(dir, { recursive: true })
  const destName = `${Date.now()}${path.extname(src) || '.png'}`
  const dest = path.join(dir, destName)
  fs.copyFileSync(src, dest)
  const rel = path.relative(__dirname, dest).replace(/\\/g, '/')
  const local = loadLocal()
  const entry = localEntry(local, id)
  entry.images.push(rel)
  saveLocal(local)
  const items = await fetchList()
  lastTitles = items.map((item) => boardItem(item, loadLocal()))
  return { ok: true, board: lastTitles }
}

async function addImageBase64(params = {}) {
  const id = String(params.key || '')
  const raw = String(params.dataUrl || '')
  const m = /^data:image\/([\w+]+);base64,(.+)$/.exec(raw)
  if (!id) throw new Error('missing todo')
  if (!m) throw new Error('无效图片')
  let ext = m[1].toLowerCase()
  if (ext === 'jpeg') ext = 'jpg'
  if (ext === 'svg+xml') ext = 'svg'
  const dir = path.join(MEDIA_DIR, id.replace(/[^\w.-]/g, '_'))
  fs.mkdirSync(dir, { recursive: true })
  const dest = path.join(dir, `${Date.now()}.${ext}`)
  fs.writeFileSync(dest, Buffer.from(m[2], 'base64'))
  const rel = path.relative(__dirname, dest).replace(/\\/g, '/')
  const local = loadLocal()
  localEntry(local, id).images.push(rel)
  saveLocal(local)
  const items = await fetchList()
  lastTitles = items.map((item) => boardItem(item, loadLocal()))
  return { ok: true, board: lastTitles }
}

async function removeImage(params = {}) {
  const id = String(params.key || '')
  const rel = String(params.rel || '')
  const local = loadLocal()
  const entry = localEntry(local, id)
  entry.images = entry.images.filter((x) => x !== rel)
  saveLocal(local)
  try {
    const abs = path.join(__dirname, rel)
    if (abs.startsWith(MEDIA_DIR) && fs.existsSync(abs)) fs.unlinkSync(abs)
  } catch {
    /* ignore */
  }
  const items = await fetchList()
  lastTitles = items.map((item) => boardItem(item, loadLocal()))
  return { ok: true, board: lastTitles }
}

async function setCover(params = {}) {
  const id = String(params.key || '')
  const rel = String(params.rel || '')
  const local = loadLocal()
  const entry = localEntry(local, id)
  entry.images = [rel, ...entry.images.filter((x) => x !== rel)]
  saveLocal(local)
  const items = await fetchList()
  lastTitles = items.map((item) => boardItem(item, loadLocal()))
  return { ok: true, board: lastTitles }
}

async function finishTodo(todoId) {
  const id = String(todoId || '')
  if (!id) throw new Error('missing todo')
  const body = JSON.stringify({ items: { todo_id: id, finished_all: true } })
  await runCli(['todo', 'finish'], body)
}

async function pollOnce({ forceSeed = false, notifyAll = false } = {}) {
  if (pollInFlight) return pollInFlight
  pollInFlight = (async () => {
    try {
      if (config.enabled === false) {
        return { ok: true, skipped: true, reason: 'disabled', newCount: 0 }
      }
      const items = await fetchList()
      lastPollAt = Date.now()
      lastPollError = ''
      const local = loadLocal()
      const isBaseline = !seeded
      await captureOriginalTitles(items, local, !isBaseline && config.preserveOriginalTitle !== false)
      lastTitles = items.map((item) => boardItem(item, local))
      saveLocal(local)

      for (const item of items) markSeen(item)
      seeded = true
      saveState()
      return { ok: true, seeded: true, newCount: 0, fetched: items.length, board: lastTitles }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      lastPollError = message
      lastPollAt = Date.now()
      log('poll failed', { error: message }, 'warn')
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
  const ms = clampInt(config.pollIntervalSec, 15, 3600, DEFAULT_POLL_SEC) * 1000
  timer = setInterval(() => {
    pollOnce().catch(() => {})
  }, ms)
  timer.unref?.()
}

function applyHostConfig(input) {
  config = normalizeConfig(input || {})
  log('config applied', {
    pollIntervalSec: config.pollIntervalSec,
    cardDurationSec: config.cardDurationSec,
    onlyWhenActive: config.onlyWhenActive,
    preserveOriginalTitle: config.preserveOriginalTitle,
    enabled: config.enabled,
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
      case 'setActivity':
        if (typeof params.active === 'boolean') {
          hostActivityActive = params.active
          hostActivityAt = Date.now()
        }
        respond(requestId, true, { active: hostActivityActive, at: hostActivityAt })
        break
      case 'pollNow':
        pollOnce({ forceSeed: params.forceSeed === true, notifyAll: params.notifyAll === true })
          .then((result) => respond(requestId, true, { ...statusPayload(), ...result }))
          .catch((error) =>
            respond(requestId, false, null, error instanceof Error ? error.message : String(error)),
          )
        break
      case 'getBoard':
        pollOnce()
          .then((result) => respond(requestId, true, { ...statusPayload(), ...result }))
          .catch((error) =>
            respond(requestId, false, null, error instanceof Error ? error.message : String(error)),
          )
        break
      case 'saveTodo':
        saveTodo(params)
          .then((result) => respond(requestId, true, { ...statusPayload(), ...result }))
          .catch((error) =>
            respond(requestId, false, null, error instanceof Error ? error.message : String(error)),
          )
        break
      case 'createTodo':
        createTodo(params)
          .then((result) => respond(requestId, true, { ...statusPayload(), ...result }))
          .catch((error) =>
            respond(requestId, false, null, error instanceof Error ? error.message : String(error)),
          )
        break
      case 'addImage':
        addImage(params)
          .then((result) => respond(requestId, true, { ...statusPayload(), ...result }))
          .catch((error) =>
            respond(requestId, false, null, error instanceof Error ? error.message : String(error)),
          )
        break
      case 'addImageBase64':
        addImageBase64(params)
          .then((result) => respond(requestId, true, { ...statusPayload(), ...result }))
          .catch((error) =>
            respond(requestId, false, null, error instanceof Error ? error.message : String(error)),
          )
        break
      case 'removeImage':
        removeImage(params)
          .then((result) => respond(requestId, true, { ...statusPayload(), ...result }))
          .catch((error) =>
            respond(requestId, false, null, error instanceof Error ? error.message : String(error)),
          )
        break
      case 'setCover':
        setCover(params)
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
log('wecom-todo sidecar ready', { pluginId, pid: process.pid, seeded, seenCount: seenMap.size })

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
    const actionId = message.actionId || ''
    const payload = message.payload || {}
    if (actionId === 'done') {
      finishTodo(payload.todo_id).catch((error) => {
        log('finish failed', { error: error instanceof Error ? error.message : String(error) }, 'warn')
      })
    }
  }
})
