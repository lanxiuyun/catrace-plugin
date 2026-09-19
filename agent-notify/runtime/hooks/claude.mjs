import path from 'node:path'
import {
  PORT,
  PERM_TIMEOUT_SECS,
  SHARED_EVENTS,
  STATE_HOOK_TIMEOUT_SECS,
  backup,
  commandFor,
  containsMarker,
  home,
  isPermHook,
  jsonHasCatrace,
  readJson,
  uninstallJson,
  win,
  writeJson,
} from './shared.mjs'

function claudeSpec(scriptPath) {
  const spec = {
    type: 'command',
    command: commandFor(scriptPath, 'claude'),
    async: true,
    timeout: STATE_HOOK_TIMEOUT_SECS,
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
  for (const event of SHARED_EVENTS) {
    if (!Array.isArray(settings.hooks[event])) settings.hooks[event] = []
    const arr = settings.hooks[event]
    const existing = arr.find(containsMarker)
    if (existing && Array.isArray(existing.hooks)) {
      for (const hook of existing.hooks) {
        if (hook && typeof hook === 'object') Object.assign(hook, spec)
      }
    } else if (!existing) {
      arr.push({ matcher: '', hooks: [{ ...spec }] })
    }
  }
  // 清理旧版 command hook（StopFailure/Notification 已不再为 Claude 注册）
  for (const event of ['StopFailure', 'Notification']) {
    const arr = settings.hooks[event]
    if (!Array.isArray(arr)) continue
    const next = arr.filter((e) => !containsMarker(e))
    if (next.length) settings.hooks[event] = next
    else delete settings.hooks[event]
  }
  if (!Array.isArray(settings.hooks.PermissionRequest)) settings.hooks.PermissionRequest = []
  settings.hooks.PermissionRequest = settings.hooks.PermissionRequest.filter((e) => !containsMarker(e) || isPermHook(e))
  const permUrl = `http://127.0.0.1:${PORT}/permission?agent=claude`
  if (!settings.hooks.PermissionRequest.some(isPermHook)) {
    settings.hooks.PermissionRequest.push({
      matcher: '',
      hooks: [{ type: 'http', url: permUrl, timeout: PERM_TIMEOUT_SECS }],
    })
  }
  writeJson(settingsPath, settings)
  return { ok: true, agent: 'claude' }
}

export function uninstallClaude() {
  return uninstallJson(path.join(home(), '.claude', 'settings.json'))
}

export function isClaudeInstalled() {
  return jsonHasCatrace(path.join(home(), '.claude', 'settings.json'))
}
