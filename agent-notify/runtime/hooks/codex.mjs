import fs from 'node:fs'
import path from 'node:path'
import {
  PERM_TIMEOUT_SECS,
  SHARED_EVENTS,
  backup,
  commandFor,
  containsMarker,
  home,
  jsonHasCatrace,
  readJson,
  uninstallJson,
  win,
  writeJson,
} from './shared.mjs'

function ensureCodexHooksFeature() {
  const configPath = path.join(home(), '.codex', 'config.toml')
  const dir = path.dirname(configPath)
  if (!fs.existsSync(dir)) return
  let text = ''
  try {
    text = fs.readFileSync(configPath, 'utf8')
  } catch {
    text = ''
  }
  if (/^\s*hooks\s*=\s*false/m.test(text)) return
  if (/^\s*hooks\s*=\s*true/m.test(text)) return
  backup(configPath)
  if (!text.includes('[features]')) {
    text = `${text.trimEnd()}\n\n[features]\nhooks = true\n`
  } else {
    text = text.replace('[features]', '[features]\nhooks = true')
  }
  fs.writeFileSync(configPath, text, 'utf8')
}

export function installCodex(scriptPath) {
  const hooksPath = path.join(home(), '.codex', 'hooks.json')
  backup(hooksPath)
  const settings = readJson(hooksPath)
  if (!settings.hooks || typeof settings.hooks !== 'object') settings.hooks = {}
  const spec = { type: 'command', command: commandFor(scriptPath, 'codex'), timeout: 30 }
  if (win()) spec.commandWindows = commandFor(scriptPath, 'codex')
  for (const event of SHARED_EVENTS) {
    if (!Array.isArray(settings.hooks[event])) settings.hooks[event] = []
    if (!settings.hooks[event].some(containsMarker)) {
      settings.hooks[event].push({ hooks: [{ ...spec }] })
    }
  }
  // PermissionRequest 需要阻塞等待用户审批，timeout 设长
  const permSpec = { type: 'command', command: commandFor(scriptPath, 'codex'), timeout: PERM_TIMEOUT_SECS }
  if (win()) permSpec.commandWindows = commandFor(scriptPath, 'codex')
  if (!Array.isArray(settings.hooks.PermissionRequest)) settings.hooks.PermissionRequest = []
  if (!settings.hooks.PermissionRequest.some(containsMarker)) {
    settings.hooks.PermissionRequest.push({ hooks: [{ ...permSpec }] })
  }
  writeJson(hooksPath, settings)
  ensureCodexHooksFeature()
  return { ok: true, agent: 'codex' }
}

export function uninstallCodex() {
  return uninstallJson(path.join(home(), '.codex', 'hooks.json'))
}

export function isCodexInstalled() {
  return jsonHasCatrace(path.join(home(), '.codex', 'hooks.json'))
}
