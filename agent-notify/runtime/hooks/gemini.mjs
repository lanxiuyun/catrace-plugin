import path from 'node:path'
import {
  SHARED_EVENTS,
  backup,
  commandFor,
  containsMarker,
  home,
  jsonHasCatrace,
  readJson,
  uninstallJson,
  writeJson,
} from './shared.mjs'

export function installGemini(scriptPath) {
  const settingsPath = path.join(home(), '.gemini', 'settings.json')
  backup(settingsPath)
  const settings = readJson(settingsPath)
  if (!settings.hooks || typeof settings.hooks !== 'object') settings.hooks = {}
  const command = commandFor(scriptPath, 'gemini')
  const geminiEvents = [...SHARED_EVENTS, 'BeforeAgent', 'AfterAgent', 'BeforeTool', 'AfterTool']
  for (const event of geminiEvents) {
    if (!Array.isArray(settings.hooks[event])) settings.hooks[event] = []
    if (!settings.hooks[event].some(containsMarker)) {
      settings.hooks[event].push({
        matcher: '*',
        hooks: [{ name: 'catrace', type: 'command', command }],
      })
    }
  }
  writeJson(settingsPath, settings)
  return { ok: true, agent: 'gemini' }
}

export function uninstallGemini() {
  return uninstallJson(path.join(home(), '.gemini', 'settings.json'))
}

export function isGeminiInstalled() {
  return jsonHasCatrace(path.join(home(), '.gemini', 'settings.json'))
}
