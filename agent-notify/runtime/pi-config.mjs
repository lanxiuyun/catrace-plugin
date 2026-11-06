import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { HTTP_PORT } from './constants.mjs'

export const PI_TARGET = 'catrace-agent-notify'
export const PI_SOURCE = 'npm:pi-webhook'
export const PI_EVENTS = ['started', 'completed', 'error', 'waiting', 'resumed', 'cancelled', 'tool_error', 'session_started', 'session_closed']
// Subscribe to every supported event; Catrace's shared event policy decides display.
export const PI_DEFAULT_EVENTS = [...PI_EVENTS]
// These events keep stale waiting/completion cards from surviving the next run.
export const PI_CONTROL_EVENTS = ['started', 'resumed', 'session_closed', 'cancelled']

export function piAgentDir() {
  return path.resolve(process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent'))
}

function read(file, fallback) {
  try {
    const text = fs.readFileSync(file, 'utf8')
    const value = JSON.parse(text)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected JSON object')
    return { file, text, value }
  } catch (error) {
    if (error.code === 'ENOENT') return { file, text: null, value: fallback }
    throw new Error(`无法读取 ${file}，未修改配置：${error.message}`)
  }
}

function currentText(file) {
  try { return fs.readFileSync(file, 'utf8') } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(temp, text, { flag: 'wx', mode: 0o600 })
    fs.renameSync(temp, file)
  } finally {
    fs.rmSync(temp, { force: true })
  }
}

function save(snapshot) {
  if (currentText(snapshot.file) !== snapshot.text) throw new Error('Pi 配置已被其他进程修改，请重试')
  const next = `${JSON.stringify(snapshot.value, null, 2)}\n`
  if (next === snapshot.text) return
  if (snapshot.text !== null) atomicWrite(`${snapshot.file}.catrace.bak`, snapshot.text)
  atomicWrite(snapshot.file, next)
}

export function loadPiToken(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  try {
    fs.writeFileSync(file, `${randomBytes(32).toString('hex')}\n`, { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
  const token = fs.readFileSync(file, 'utf8').trim()
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Pi receiver token 文件损坏，请备份后移除并重新安装 Pi Hook')
  return token
}

function isWebhookPackage(entry, dir) {
  const source = typeof entry === 'string' ? entry : entry?.source
  if (typeof source !== 'string') return false
  if (/^npm:pi-webhook(?:@|$)/.test(source)) return true
  if (/^(?:git:|https:\/\/)(?:github\.com\/)?YHQY-Dev\/pi-webhook(?:\.git)?(?:@|$)/i.test(source)) return true
  if (source.startsWith('.') || path.isAbsolute(source)) {
    try { return JSON.parse(fs.readFileSync(path.resolve(dir, source, 'package.json'), 'utf8')).name === 'pi-webhook' } catch { /* not a local package */ }
  }
  return false
}

function validateWebhook(root) {
  function keys(value, allowed) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) throw new Error('Pi Webhook 配置含未知字段或无效对象，未修改配置')
  }
  function booleans(value, names) {
    if (names.some((name) => value[name] !== undefined && typeof value[name] !== 'boolean')) throw new Error('Pi Webhook 开关必须为布尔值，未修改配置')
  }
  keys(root, ['enabled', 'timeoutMs', 'retries', 'webhooks'])
  booleans(root, ['enabled'])
  for (const [key, min, max] of [['timeoutMs', 100, 30000], ['retries', 0, 5]]) {
    if (root[key] !== undefined && (!Number.isInteger(root[key]) || root[key] < min || root[key] > max)) throw new Error(`Pi Webhook ${key} 无效，未修改配置`)
  }
  if (!Array.isArray(root.webhooks) || root.webhooks.length > 16) throw new Error('Pi Webhook 接收端列表无效，未修改配置')
  const names = new Set()
  for (const target of root.webhooks) {
    keys(target, ['name', 'url', 'enabled', 'events', 'headers', 'includeMessage', 'includeCwd'])
    if (typeof target.name !== 'string' || !/^[\w.-]{1,64}$/.test(target.name) || names.has(target.name)) throw new Error('Pi Webhook 接收端名称无效或重复，未修改配置')
    names.add(target.name)
    if (typeof target.url !== 'string') throw new Error('Pi Webhook URL 无效，未修改配置')
    const url = new URL(target.url)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('Pi Webhook URL 无效，未修改配置')
    if (!Array.isArray(target.events) || !target.events.every((event) => PI_EVENTS.includes(event))) throw new Error('Pi Webhook 事件列表无效，未修改配置')
    booleans(target, ['enabled', 'includeMessage', 'includeCwd'])
    const headers = target.headers ?? {}
    if (typeof headers !== 'object' || Array.isArray(headers)) throw new Error('Pi Webhook headers 无效，未修改配置')
    for (const [key, value] of Object.entries(headers)) {
      if (!/^[!#$%&'*+.^_`|~\w-]+$/.test(key) || typeof value !== 'string' || /[\r\n]/.test(value) || ['host', 'content-length', 'content-type', 'connection', 'transfer-encoding'].includes(key.toLowerCase()) || key.toLowerCase().startsWith('x-pi-')) throw new Error('Pi Webhook header 无效，未修改配置')
    }
  }
}

function snapshots(dir) {
  const settings = read(path.join(dir, 'settings.json'), {})
  const webhook = read(path.join(dir, 'webhook.json'), { enabled: true, timeoutMs: 3000, retries: 2, webhooks: [] })
  if (settings.value.packages !== undefined && !Array.isArray(settings.value.packages)) throw new Error('Pi settings.packages 必须是数组，未修改配置')
  validateWebhook(webhook.value)
  return { settings, webhook }
}

export function piStatus({ dir = piAgentDir(), port = HTTP_PORT } = {}) {
  const base = { dir, url: `http://127.0.0.1:${port}/pi`, detected: fs.existsSync(dir) }
  try {
    const { settings, webhook } = snapshots(dir)
    const target = webhook.value.webhooks.find((target) => target.name === PI_TARGET)
    const packageConfigured = (settings.value.packages || []).some((entry) => isWebhookPackage(entry, dir))
    return { ...base, installed: packageConfigured && !!target, packageConfigured, enabled: webhook.value.enabled !== false && target?.enabled !== false, events: target?.events || [...PI_DEFAULT_EVENTS], includeMessage: target?.includeMessage === true, includeCwd: target?.includeCwd === true }
  } catch (error) {
    return { ...base, installed: false, error: error.message, events: [...PI_DEFAULT_EVENTS], includeMessage: false, includeCwd: false }
  }
}

export function installPi({ dir = piAgentDir(), port = HTTP_PORT, token, events = PI_DEFAULT_EVENTS, includeMessage = false, includeCwd = false } = {}) {
  if (!/^[a-f0-9]{64}$/.test(token || '')) throw new Error('Pi receiver 未就绪，无法安装')
  if (!Array.isArray(events) || !events.every((event) => PI_EVENTS.includes(event))) throw new Error('无效的 Pi 事件列表')
  const { settings, webhook } = snapshots(dir)
  if (webhook.value.enabled === false) throw new Error('Pi Webhook 总开关已关闭，请先在 Pi 中执行 /webhook on；不会自动开启其他接收端')
  const packages = settings.value.packages || []
  const existing = packages.find((entry) => isWebhookPackage(entry, dir))
  if (existing && typeof existing === 'object' && existing.extensions !== undefined) throw new Error('现有 pi-webhook 包设置了扩展过滤，请手动确认加载 src/index.ts 后再安装')
  if (!existing) settings.value.packages = [...packages, PI_SOURCE]
  const target = {
    name: PI_TARGET,
    url: `http://127.0.0.1:${port}/pi`,
    enabled: true,
    events: [...new Set([...events, ...PI_CONTROL_EVENTS])],
    headers: { Authorization: `Bearer ${token}` },
    includeMessage: includeMessage === true,
    includeCwd: includeCwd === true,
  }
  const targets = webhook.value.webhooks
  const index = targets.findIndex((item) => item.name === PI_TARGET)
  if (index === -1) {
    if (targets.length >= 16) throw new Error('Pi Webhook 接收端已达 16 个上限，未修改配置')
    targets.push(target)
  } else targets[index] = target
  // Write receiver first: a settings failure cannot load an unconfigured extension.
  save(webhook)
  try { save(settings) } catch (error) {
    // Do not roll back over an external edit.
    if (currentText(webhook.file) === `${JSON.stringify(webhook.value, null, 2)}\n`) {
      if (webhook.text === null) fs.rmSync(webhook.file, { force: true })
      else atomicWrite(webhook.file, webhook.text)
    }
    throw error
  }
  return { ...piStatus({ dir, port }), reloadRequired: true }
}

export function uninstallPi({ dir = piAgentDir(), port = HTTP_PORT } = {}) {
  const { webhook } = snapshots(dir)
  const next = webhook.value.webhooks.filter((target) => target.name !== PI_TARGET)
  const removed = webhook.value.webhooks.length - next.length
  if (removed) {
    webhook.value.webhooks = next
    save(webhook)
  }
  // The generic package may serve other targets: never remove its package declaration.
  return { removed, dir, reloadRequired: true, port }
}
