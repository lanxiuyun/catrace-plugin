import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const MARKER = 'catrace-agent-hook'
const PORT = 23456
const PERM_TIMEOUT_SECS = 600
const SHARED_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
]

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

function commandFor(scriptPath, agentId = '') {
  const suffix = agentId ? ` --agent=${agentId}` : ''
  if (win()) return `& "node" "${scriptPath}"${suffix}`
  return `"node" "${scriptPath}"${suffix}`
}

function containsMarker(entry) {
  const raw = typeof entry === 'string' ? entry : JSON.stringify(entry)
  return (
    raw.includes(MARKER) ||
    raw.includes('catrace-agent-hook') ||
    raw.includes('agent-notify') ||
    raw.includes(`${path.sep}hook.cjs`) ||
    raw.includes('/hook.cjs')
  )
}

function isPermHook(entry) {
  const raw = JSON.stringify(entry)
  if (!raw.includes('PermissionRequest') && !raw.includes('/permission')) return false
  // http 形式（Claude）：url 直推 /permission；command 形式（ZCode/Codex）：同一脚本加长 timeout
  if (raw.includes('/permission') && raw.includes(`:${PORT}`)) return true
  return raw.includes('--agent=') && /"timeout"\s*:\s*(600|590)/.test(raw)
}

function jsonHasCatrace(file) {
  const settings = readJson(file)
  const hooks = settings.hooks
  if (!hooks || typeof hooks !== 'object') return false
  return Object.values(hooks).some((arr) => Array.isArray(arr) && arr.some((e) => containsMarker(e) || isPermHook(e)))
}

function uninstallJson(file) {
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

function claudeSpec(scriptPath) {
  const spec = {
    type: 'command',
    command: commandFor(scriptPath, 'claude'),
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
  for (const event of SHARED_EVENTS) {
    if (!Array.isArray(settings.hooks[event])) settings.hooks[event] = []
    const arr = settings.hooks[event]
    if (!arr.some(containsMarker)) arr.push({ matcher: '', hooks: [{ ...spec }] })
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
  const permSpec = { type: 'command', command: commandFor(scriptPath, 'codex'), timeout: 600 }
  if (win()) permSpec.commandWindows = commandFor(scriptPath, 'codex')
  if (!Array.isArray(settings.hooks.PermissionRequest)) settings.hooks.PermissionRequest = []
  if (!settings.hooks.PermissionRequest.some(containsMarker)) {
    settings.hooks.PermissionRequest.push({ hooks: [{ ...permSpec }] })
  }
  writeJson(hooksPath, settings)
  ensureCodexHooksFeature()
  return { ok: true, agent: 'codex' }
}

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

function kimiConfigPaths() {
  const paths = [path.join(home(), '.kimi', 'config.toml')]
  const envHome = process.env.KIMI_CODE_HOME
  const kimiCode = envHome && envHome.trim() ? envHome.trim() : path.join(home(), '.kimi-code')
  paths.push(path.join(kimiCode, 'config.toml'))
  return paths
}

function kimiHasHook(content) {
  return content.includes('[[hooks]]') && containsMarker(content)
}

function stripKimiHooks(content) {
  const lines = content.split(/\r?\n/)
  const out = []
  let removed = 0
  let i = 0
  const isHeader = (l) => {
    const t = l.trim()
    return t.startsWith('[') && t.endsWith(']')
  }
  while (i < lines.length) {
    if (lines[i].trim() === '[[hooks]]') {
      const start = i
      let j = i + 1
      while (j < lines.length && !isHeader(lines[j])) j += 1
      const block = lines.slice(start, j).join('\n')
      if (containsMarker(block)) removed += 1
      else out.push(...lines.slice(start, j))
      i = j
    } else {
      out.push(lines[i])
      i += 1
    }
  }
  return { text: out.join('\n'), removed }
}

function kimiHookBlocks(scriptPath) {
  const command = commandFor(scriptPath, 'kimi').replace(/'/g, '')
  const events = SHARED_EVENTS
  return events
    .map(
      (event) =>
        `[[hooks]]\nevent = "${event}"\ncommand = '${command}'\nmatcher = ""\ntimeout = 30\n`,
    )
    .join('\n')
}

export function installKimi(scriptPath) {
  const targets = kimiConfigPaths().filter((p) => fs.existsSync(path.dirname(p)))
  if (!targets.length) {
    throw new Error('未找到 Kimi 配置目录（~/.kimi 或 ~/.kimi-code）')
  }
  const block = kimiHookBlocks(scriptPath)
  for (const file of targets) {
    backup(file)
    let content = ''
    try {
      content = fs.readFileSync(file, 'utf8')
    } catch {
      content = ''
    }
    const stripped = stripKimiHooks(content).text.trimEnd()
    const next = `${stripped}${stripped ? '\n\n' : ''}${block}\n`
    fs.writeFileSync(file, next, 'utf8')
  }
  return { ok: true, agent: 'kimi', targets }
}

export function uninstallKimi() {
  let removed = 0
  for (const file of kimiConfigPaths()) {
    if (!fs.existsSync(file)) continue
    const content = fs.readFileSync(file, 'utf8')
    const next = stripKimiHooks(content)
    if (next.removed) {
      fs.writeFileSync(file, next.text, 'utf8')
      removed += next.removed
    }
  }
  return { removed }
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
  if (agent === 'claude') return uninstallJson(path.join(home(), '.claude', 'settings.json'))
  if (agent === 'codex') return uninstallJson(path.join(home(), '.codex', 'hooks.json'))
  if (agent === 'gemini') return uninstallJson(path.join(home(), '.gemini', 'settings.json'))
  if (agent === 'kimi') return uninstallKimi()
  if (agent === 'zcode') return uninstallZcode()
  throw new Error(`unknown agent: ${agent}`)
}

export function isInstalled(agent) {
  if (agent === 'claude') return jsonHasCatrace(path.join(home(), '.claude', 'settings.json'))
  if (agent === 'codex') return jsonHasCatrace(path.join(home(), '.codex', 'hooks.json'))
  if (agent === 'gemini') return jsonHasCatrace(path.join(home(), '.gemini', 'settings.json'))
  if (agent === 'kimi') {
    return kimiConfigPaths().some((p) => {
      try {
        return kimiHasHook(fs.readFileSync(p, 'utf8'))
      } catch {
        return false
      }
    })
  }
  if (agent === 'zcode') return isZcodeInstalled()
  return false
}

function zcodeConfigPath() {
  return path.join(home(), '.zcode', 'cli', 'config.json')
}

function zcodeHookSpec(scriptPath) {
  const spec = {
    type: 'command',
    command: commandFor(scriptPath, 'zcode'),
    enabled: true,
    async: true,
    timeout: 5,
  }
  if (win()) spec.shell = 'powershell'
  return spec
}

const ZCODE_EVENTS = SHARED_EVENTS

export function installZcode(scriptPath) {
  const file = zcodeConfigPath()
  const dir = path.dirname(file)
  if (!fs.existsSync(dir)) throw new Error('未找到 ZCode 配置目录（~/.zcode/cli）')
  backup(file)
  const config = readJson(file)
  if (!config.hooks || typeof config.hooks !== 'object') config.hooks = {}
  config.hooks.enabled = true
  if (!config.hooks.events || typeof config.hooks.events !== 'object') config.hooks.events = {}
  const spec = zcodeHookSpec(scriptPath)
  for (const event of ZCODE_EVENTS) {
    if (!Array.isArray(config.hooks.events[event])) config.hooks.events[event] = []
    const arr = config.hooks.events[event]
    const existing = arr.find(containsMarker)
    if (existing && Array.isArray(existing.hooks)) {
      for (const hook of existing.hooks) {
        if (hook && typeof hook === 'object') {
          hook.command = spec.command
          hook.type = 'command'
          hook.enabled = true
          hook.timeout = 5
          if (spec.shell) hook.shell = spec.shell
        }
      }
    } else if (!existing) {
      arr.push({ hooks: [{ ...spec }] })
    }
  }
  // PermissionRequest 需要阻塞等待用户审批。ZCode 的 hook schema 只接受
  // 'process' | 'command'（type:"http" 会让整个 config.json 加载失败），
  // 因此与 Codex 一致用 command hook，由 hook.cjs 阻塞等待 /permission 决策。
  if (!Array.isArray(config.hooks.events.PermissionRequest)) config.hooks.events.PermissionRequest = []
  // 清理旧版 http 权限 hook：无 marker 且 schema 非法，留着会继续破坏配置加载
  config.hooks.events.PermissionRequest = config.hooks.events.PermissionRequest.filter(
    (e) => !isPermHook(e) || containsMarker(e),
  )
  const permArr = config.hooks.events.PermissionRequest
  const permSpec = zcodeHookSpec(scriptPath)
  permSpec.timeout = PERM_TIMEOUT_SECS
  const existingPerm = permArr.find(containsMarker)
  if (existingPerm && Array.isArray(existingPerm.hooks)) {
    for (const hook of existingPerm.hooks) {
      if (hook && typeof hook === 'object') {
        hook.command = permSpec.command
        hook.type = 'command'
        hook.enabled = true
        hook.timeout = PERM_TIMEOUT_SECS
        if (permSpec.shell) hook.shell = permSpec.shell
      }
    }
  } else {
    permArr.push({ hooks: [{ ...permSpec }] })
  }
  writeJson(file, config)
  return { ok: true, agent: 'zcode' }
}

export function uninstallZcode() {
  const file = zcodeConfigPath()
  const config = readJson(file)
  if (!config.hooks || !config.hooks.events || typeof config.hooks.events !== 'object') return { removed: 0 }
  let removed = 0
  for (const event of Object.keys(config.hooks.events)) {
    const arr = config.hooks.events[event]
    if (!Array.isArray(arr)) continue
    const next = arr.filter((e) => !containsMarker(e) && !isPermHook(e))
    removed += arr.length - next.length
    if (next.length) config.hooks.events[event] = next
    else delete config.hooks.events[event]
  }
  if (removed) writeJson(file, config)
  return { removed }
}

function isZcodeInstalled() {
  const config = readJson(zcodeConfigPath())
  const events = config.hooks && config.hooks.events
  if (!events || typeof events !== 'object') return false
  return Object.values(events).some((arr) =>
    Array.isArray(arr) && arr.some((e) => containsMarker(e) || isPermHook(e)),
  )
}

export const AGENTS = ['claude', 'zcode', 'codex', 'gemini', 'kimi']
