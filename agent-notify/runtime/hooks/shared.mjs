import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const MARKER = 'catrace-agent-hook'
export const PORT = 23456
export const PERM_TIMEOUT_SECS = 600
export const STATE_HOOK_TIMEOUT_SECS = 15
export const SHARED_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
]

export function home() {
  return os.homedir()
}

export function readJson(file) {
  try {
    if (!fs.existsSync(file)) return {}
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export function backup(file) {
  if (!fs.existsSync(file)) return
  try {
    fs.copyFileSync(file, `${file}.bak`)
  } catch {
    /* ignore */
  }
}

export function win() {
  return process.platform === 'win32'
}

export function commandFor(scriptPath, agentId = '') {
  const suffix = agentId ? ` --agent=${agentId}` : ''
  if (win()) return `& "node" "${scriptPath}"${suffix}`
  return `"node" "${scriptPath}"${suffix}`
}

export function containsMarker(entry) {
  const raw = typeof entry === 'string' ? entry : JSON.stringify(entry)
  return (
    raw.includes(MARKER) ||
    raw.includes('catrace-agent-hook') ||
    raw.includes('agent-notify') ||
    raw.includes(`${path.sep}hook.cjs`) ||
    raw.includes('/hook.cjs')
  )
}

export function isPermHook(entry) {
  const raw = JSON.stringify(entry)
  if (!raw.includes('PermissionRequest') && !raw.includes('/permission')) return false
  // http 形式（Claude）：url 直推 /permission；command 形式（ZCode/Codex）：同一脚本加长 timeout
  if (raw.includes('/permission') && raw.includes(`:${PORT}`)) return true
  return raw.includes('--agent=') && /"timeout"\s*:\s*(600|590)/.test(raw)
}

export function jsonHasCatrace(file) {
  const settings = readJson(file)
  const hooks = settings.hooks
  if (!hooks || typeof hooks !== 'object') return false
  return Object.values(hooks).some((arr) => Array.isArray(arr) && arr.some((e) => containsMarker(e) || isPermHook(e)))
}

export function uninstallJson(file) {
  const settings = readJson(file)
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
  if (removed) writeJson(file, settings)
  return { removed }
}
