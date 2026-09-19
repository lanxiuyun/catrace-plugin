import fs from 'node:fs'
import path from 'node:path'
import { installClaude, isClaudeInstalled, uninstallClaude } from './hooks/claude.mjs'
import { installCodex, isCodexInstalled, uninstallCodex } from './hooks/codex.mjs'
import { installGemini, isGeminiInstalled, uninstallGemini } from './hooks/gemini.mjs'
import { installKimi, isKimiInstalled, kimiPresent, uninstallKimi } from './hooks/kimi.mjs'
import { installZcode, isZcodeInstalled, uninstallZcode } from './hooks/zcode.mjs'
import { home } from './hooks/shared.mjs'

export { installClaude, installCodex, installGemini, installKimi, installZcode }

const AGENT_CONFIG_DIRS = {
  claude: () => path.join(home(), '.claude'),
  codex: () => path.join(home(), '.codex'),
  gemini: () => path.join(home(), '.gemini'),
  zcode: () => path.join(home(), '.zcode', 'cli'),
}

export function installAgent(agent, scriptPath) {
  if (agent === 'claude') return installClaude(scriptPath)
  if (agent === 'codex') return installCodex(scriptPath)
  if (agent === 'gemini') return installGemini(scriptPath)
  if (agent === 'kimi') return installKimi(scriptPath)
  if (agent === 'zcode') return installZcode(scriptPath)
  throw new Error(`unknown agent: ${agent}`)
}

export function uninstallAgent(agent) {
  if (agent === 'claude') return uninstallClaude()
  if (agent === 'codex') return uninstallCodex()
  if (agent === 'gemini') return uninstallGemini()
  if (agent === 'kimi') return uninstallKimi()
  if (agent === 'zcode') return uninstallZcode()
  throw new Error(`unknown agent: ${agent}`)
}

export function isInstalled(agent) {
  if (agent === 'claude') return isClaudeInstalled()
  if (agent === 'codex') return isCodexInstalled()
  if (agent === 'gemini') return isGeminiInstalled()
  if (agent === 'kimi') return isKimiInstalled()
  if (agent === 'zcode') return isZcodeInstalled()
  return false
}

export function isAgentPresent(agent) {
  if (agent === 'kimi') return kimiPresent()
  const dir = AGENT_CONFIG_DIRS[agent]
  return dir ? fs.existsSync(dir()) : false
}

export const AGENTS = ['claude', 'zcode', 'codex', 'gemini', 'kimi']
