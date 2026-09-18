import fs from 'node:fs'
import path from 'node:path'
import {
  PERM_TIMEOUT_SECS,
  SHARED_EVENTS,
  STATE_HOOK_TIMEOUT_SECS,
  backup,
  commandFor,
  containsMarker,
  home,
  isPermHook,
  readJson,
  win,
  writeJson,
} from './shared.mjs'

function zcodeConfigPath() {
  return path.join(home(), '.zcode', 'cli', 'config.json')
}

function zcodeHookSpec(scriptPath) {
  const spec = {
    type: 'command',
    command: commandFor(scriptPath, 'zcode'),
    enabled: true,
    async: true,
    timeout: STATE_HOOK_TIMEOUT_SECS,
  }
  if (win()) spec.shell = 'powershell'
  return spec
}

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
  for (const event of SHARED_EVENTS) {
    if (!Array.isArray(config.hooks.events[event])) config.hooks.events[event] = []
    const arr = config.hooks.events[event]
    const existing = arr.find(containsMarker)
    if (existing && Array.isArray(existing.hooks)) {
      for (const hook of existing.hooks) {
        if (hook && typeof hook === 'object') {
          hook.command = spec.command
          hook.type = 'command'
          hook.enabled = true
          hook.timeout = STATE_HOOK_TIMEOUT_SECS
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

export function isZcodeInstalled() {
  const config = readJson(zcodeConfigPath())
  const events = config.hooks && config.hooks.events
  if (!events || typeof events !== 'object') return false
  return Object.values(events).some((arr) =>
    Array.isArray(arr) && arr.some((e) => containsMarker(e) || isPermHook(e)),
  )
}
