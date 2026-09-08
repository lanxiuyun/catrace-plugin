import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const MARKER = 'catrace-agent-hook'
const PORT = 23456
const PERM_TIMEOUT_SECS = 600

function home() {
  return os.homedir()
}

function readJson(file) {
  try {
    if (!fs.existsSync(file)) return {}
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function backup(file) {
  if (!fs.existsSync(file)) return
  try {
    fs.copyFileSync(file, `${file}.bak`)
  } catch {
    /* ignore */
  }
}

function win() {
  return process.platform === 'win32'
}

function commandFor(scriptPath) {
  if (win()) return `& "node" "${scriptPath}"`
  return `"node" "${scriptPath}"`
}

function containsMarker(entry) {
  const raw = JSON.stringify(entry)
  return raw.includes(MARKER) || raw.includes('catrace-agent-hook')
}

function isPermHook(entry) {
  const raw = JSON.stringify(entry)
  return raw.includes('/permission') && raw.includes(`:${PORT}`)
}

function claudeSpec(scriptPath) {
  const spec = {
    type: 'command',
    command: commandFor(scriptPath),
    async: true,
    timeout: 5,
  }
  if (win()) spec.shell = 'powershell'
  return spec
}

export function installClaude(scriptPath) {
  const settingsPath = path.join(home(), '.claude', 'settings.json')
  backup(settingsPath)
  const settings = readJson(settingsPath)
  if (!settings.hooks || typeof settings.hooks !== 'object') settings.hooks = {}
  const spec = claudeSpec(scriptPath)
  const events = ['SessionStart', 'UserPromptSubmit', 'Stop', 'StopFailure', 'Notification']
  for (const event of events) {
    if (!Array.isArray(settings.hooks[event])) settings.hooks[event] = []
    const arr = settings.hooks[event]
    const exists = arr.some(containsMarker)
    if (!exists) {
      arr.push({ matcher: '', hooks: [{ ...spec }] })
    }
  }
  if (!Array.isArray(settings.hooks.PermissionRequest)) settings.hooks.PermissionRequest = []
  settings.hooks.PermissionRequest = settings.hooks.PermissionRequest.filter((e) => !containsMarker(e) || isPermHook(e))
  const permUrl = `http://127.0.0.1:${PORT}/permission`
  const hasPerm = settings.hooks.PermissionRequest.some(isPermHook)
  if (!hasPerm) {
    settings.hooks.PermissionRequest.push({
      matcher: '',
      hooks: [{ type: 'http', url: permUrl, timeout: PERM_TIMEOUT_SECS }],
    })
  }
  writeJson(settingsPath, settings)
  return { ok: true, agent: 'claude' }
}

export function uninstallClaude() {
  const settingsPath = path.join(home(), '.claude', 'settings.json')
  const settings = readJson(settingsPath)
  if (!settings.hooks || typeof settings.hooks !== 'object') return { removed: 0 }
  let removed = 0
  for (const event of Object.keys(settings.hooks)) {
    const arr = settings.hooks[event]
    if (!Array.isArray(arr)) continue
    const next = arr.filter((e) => !containsMarker(e) && !isPermHook(e))
    removed += arr.length - next.length
    if (next.length) settings.hooks[event] = next
    else delete settings.hooks[event]
  }
  if (removed) writeJson(settingsPath, settings)
  return { removed }
}

export function isClaudeInstalled() {
  const settings = readJson(path.join(home(), '.claude', 'settings.json'))
  const hooks = settings.hooks
  if (!hooks || typeof hooks !== 'object') return false
  return Object.values(hooks).some((arr) => Array.isArray(arr) && arr.some((e) => containsMarker(e) || isPermHook(e)))
}

function installJsonAgent(settingsPath, events, scriptPath, extraHook) {
  backup(settingsPath)
  const settings = readJson(settingsPath)
  if (!settings.hooks || typeof settings.hooks !== 'object') settings.hooks = {}
  const spec = extraHook || { type: 'command', command: commandFor(scriptPath), timeout: 30 }
  for (const event of events) {
    if (!Array.isArray(settings.hooks[event])) settings.hooks[event] = []
    if (!settings.hooks[event].some(containsMarker)) {
      settings.hooks[event].push({ hooks: [{ ...spec }] })
    }
  }
  writeJson(settingsPath, settings)
  return { ok: true }
}

export function installAgent(agent, scriptPath) {
  if (agent === 'claude') return installClaude(scriptPath)
  if (agent === 'codex') return installJsonAgent(path.join(home(), '.codex', 'hooks.json'), ['SessionStart', 'UserPromptSubmit', 'Stop'], scriptPath)
  if (agent === 'gemini') return installJsonAgent(path.join(home(), '.gemini', 'settings.json'), ['SessionStart', 'BeforeAgent', 'AfterAgent', 'Notification'], scriptPath)
  if (agent === 'kimi') return installJsonAgent(path.join(home(), '.kimi', 'settings.json'), ['SessionStart', 'UserPromptSubmit', 'Stop', 'Notification'], scriptPath)
  throw new Error(`unknown agent: ${agent}`)
}

export function uninstallAgent(agent) {
  if (agent === 'claude') return uninstallClaude()
  const file =
    agent === 'codex'
      ? path.join(home(), '.codex', 'hooks.json')
      : agent === 'gemini'
        ? path.join(home(), '.gemini', 'settings.json')
        : path.join(home(), '.kimi', 'settings.json')
  const settings = readJson(file)
  if (!settings.hooks) return { removed: 0 }
  let removed = 0
  for (const event of Object.keys(settings.hooks)) {
    const arr = settings.hooks[event]
    if (!Array.isArray(arr)) continue
    const next = arr.filter((e) => !containsMarker(e))
    removed += arr.length - next.length
    if (next.length) settings.hooks[event] = next
    else delete settings.hooks[event]
  }
  if (removed) writeJson(file, settings)
  return { removed }
}

export function isInstalled(agent) {
  if (agent === 'claude') return isClaudeInstalled()
  const file =
    agent === 'codex'
      ? path.join(home(), '.codex', 'hooks.json')
      : agent === 'gemini'
        ? path.join(home(), '.gemini', 'settings.json')
        : path.join(home(), '.kimi', 'settings.json')
  const settings = readJson(file)
  const hooks = settings.hooks
  if (!hooks || typeof hooks !== 'object') return false
  return Object.values(hooks).some((arr) => Array.isArray(arr) && arr.some(containsMarker))
}

export const AGENTS = ['claude', 'codex', 'gemini', 'kimi']
