/**
 * spawn-plan.mjs —— 跨平台可执行文件解析 + spawn 参数生成。
 *
 * 背景：Windows 上 `dsh` CLI 安装为 `dsh.cmd`，而 Node 无法直接 spawn 一个
 * .cmd/.bat（会抛 EINVAL，CVE-2024-27980 修复后的行为）。因此这里显式做两件事：
 *   1) 只用 node:fs + env.PATH / env.PATHEXT 把命令名解析成真实文件路径
 *      （绝不调用外部命令 where/which）；
 *   2) 对 .cmd/.bat 生成 `cmd.exe /d /s /c "<命令行>"` 计划，并设置
 *      windowsVerbatimArguments，由我们自己负责引号转义。
 * 任何情况下都不会设置 shell: true —— 绝不用 shell 拼字符串执行用户输入。
 */
import fs from 'node:fs'
import path from 'node:path'

/** PATHEXT 缺失时的兜底列表（与 Windows 默认值一致）。 */
const WIN_DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD'

/** 需要被双引号包裹的字符：空白与 cmd.exe 的特殊字符。 */
const CMD_SPECIAL_CHARS = /[\s"&|<>^()%!;,=]/

/** 判断 p 是否是一个普通文件（软链接会跟随）。任何异常都视为「不是文件」。 */
function isFile(p) {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

/** 把 PATHEXT 字符串拆成扩展名数组；优先用显式参数，其次 env.PATHEXT，最后用默认值。 */
function normalizePathExt(pathExt, env) {
  let raw = ''
  if (typeof pathExt === 'string' && pathExt.trim() !== '') raw = pathExt
  else if (env && typeof env.PATHEXT === 'string' && env.PATHEXT.trim() !== '') raw = env.PATHEXT
  else raw = WIN_DEFAULT_PATHEXT
  return raw
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 按平台切分 PATH。宿主是 win32 时 PATH 恒为分号分隔（即便调用方在模拟 posix 平台）。 */
function splitPathList(raw, platform) {
  if (typeof raw !== 'string' || raw === '') return []
  if (platform !== 'win32' && /^[A-Za-z]:[\\/]/.test(raw)) return raw.split(';')
  return raw.split(platform === 'win32' ? ';' : ':')
}

/** 去掉 PATH 条目两端空白与可能存在的包裹引号。 */
function cleanDir(dir) {
  const t = String(dir).trim()
  if (t === '') return ''
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1)
  return t
}

/**
 * 在单个目录里找 target(+扩展名)。
 * win32 下文件名大小写不敏感，这里显式读一次目录项并按小写匹配，
 * 好处是：1) 返回真实存在的文件名（大小写与磁盘一致）；2) 在 Linux 宿主上模拟 win32 也能命中。
 * 非 win32 只做精确存在性判断。
 */
function resolveInDir(dir, target, exts, platform) {
  if (platform !== 'win32') {
    const direct = path.join(dir, target)
    return isFile(direct) ? path.resolve(direct) : null
  }

  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  const realNames = new Map()
  for (const entry of entries) {
    if (!entry.name) continue
    if (!entry.isFile() && !entry.isSymbolicLink() && !entry.isDirectory()) continue
    realNames.set(entry.name.toLowerCase(), entry.name)
  }

  for (const ext of exts) {
    const real = realNames.get(`${target}${ext}`.toLowerCase())
    if (!real) continue
    const full = path.join(dir, real)
    if (isFile(full)) return path.resolve(full)
  }
  return null
}

/**
 * 在 PATH 中查找可执行文件；win32 下按 PATHEXT 逐个尝试（.CMD/.EXE/...）。找不到返回 null。
 *
 * @param {string} name 命令名；含路径分隔符时直接判断该文件是否存在。
 * @param {{platform?: string, env?: Record<string,string|undefined>, pathExt?: string|null}} [options]
 * @returns {string|null} 绝对路径或 null
 */
export function resolveExecutable(name, { platform = process.platform, env = process.env, pathExt = null } = {}) {
  if (typeof name !== 'string' || name.trim() === '') return null
  const target = name.trim()

  // 含路径分隔符：不做 PATH 搜索，只看这个文件在不在（相对路径按宿主 cwd 解析）。
  if (target.includes('/') || target.includes('\\')) {
    return isFile(target) ? path.resolve(target) : null
  }

  const dirs = splitPathList(env ? env.PATH : '', platform).map(cleanDir).filter(Boolean)
  if (dirs.length === 0) return null

  // win32：先试裸名字，再按 PATHEXT 逐个追加扩展名；其它平台只试裸名字。
  const exts = platform === 'win32' ? ['', ...normalizePathExt(pathExt, env)] : ['']
  const tried = new Set()
  for (const dir of dirs) {
    const key = `${dir}\u0000${target.toLowerCase()}`
    if (tried.has(key)) continue
    tried.add(key)
    const hit = resolveInDir(dir, target, exts, platform)
    if (hit) return hit
  }
  return null
}

/**
 * 用 Windows cmd 规则给单个参数加引号：含空格或特殊字符时用双引号包裹，
 * 内部双引号转义为 \"。无需包裹时原样返回。
 *
 * 注意：cmd.exe 仍会展开 %VAR% / !VAR!，双引号挡不住变量展开；
 * 因此不要把不可信字符串当命令路径用（本插件的命令来自用户自己的配置）。
 */
export function quoteWin(value) {
  const s = value === null || value === undefined ? '' : String(value)
  if (s === '') return '""'
  if (!CMD_SPECIAL_CHARS.test(s)) return s
  return `"${s.replace(/"/g, '\\"')}"`
}

/** 命令（或它的解析结果）是否是 .cmd/.bat 脚本。 */
function isCmdScript(p) {
  return typeof p === 'string' && /\.(cmd|bat)$/i.test(p)
}

/**
 * 生成实际 spawn 参数。返回 { command, args, options }，options 可直接展开给 child_process.spawn。
 *
 * 规则：
 *  - win32 且命令（或其解析结果）以 .cmd/.bat 结尾 → cmd.exe /d /s /c "<整条命令行>"，
 *    并设置 windowsVerbatimArguments: true（引号由 quoteWin 负责，不经过 Node 的转义）。
 *  - 其它平台 / 非 .cmd/.bat → { command, args, options: {} }。
 *  - 绝不设置 shell: true。
 *
 * @param {string} command 建议先经 resolveDshCommand 解析；裸命令名也会尝试解析一次。
 * @param {Array<string|number>} [args]
 * @param {{platform?: string}} [options]
 */
export function buildSpawnPlan(command, args = [], { platform = process.platform } = {}) {
  const list = Array.isArray(args) ? args.map((a) => (a === null || a === undefined ? '' : String(a))) : []
  let cmd = typeof command === 'string' ? command : String(command)

  // 允许直接传裸命令名：先尝试解析出真实路径（找不到就原样交给 spawn 让它自己报错）。
  if (platform === 'win32' && !isCmdScript(cmd) && !cmd.includes('/') && !cmd.includes('\\')) {
    const resolved = resolveExecutable(cmd, { platform, env: process.env })
    if (resolved) cmd = resolved
  }

  if (platform === 'win32' && isCmdScript(cmd)) {
    const comSpec = (process.env && (process.env.ComSpec || process.env.COMSPEC)) || 'cmd.exe'
    let line = [quoteWin(cmd), ...list.map(quoteWin)].join(' ')
    // cmd /s 会剥掉「紧随 /c 的整条命令」的首尾引号。若命令本身被引号包裹
    // （路径含空格），必须再套一层外层引号，否则
    //   "C:\Program Files\dsh.cmd" --profile sdk
    // 会被剥成 C:\Program Files\dsh.cmd" --profile sdk（结尾引号丢失）。
    if (line.startsWith('"')) line = `"${line}"`
    return {
      command: comSpec,
      args: ['/d', '/s', '/c', line],
      options: { windowsVerbatimArguments: true },
    }
  }

  return { command: cmd, args: list, options: {} }
}

/**
 * 面向插件的解析入口：用户配置的命令名 → 可执行路径。
 * 解析不到时原样返回（让 spawn 自己报 ENOENT，报错信息里带用户配置值更好排查）。
 *
 * @param {string} configured
 * @param {{platform?: string, env?: Record<string,string|undefined>}} [options]
 * @returns {string}
 */
export function resolveDshCommand(configured, { platform = process.platform, env = process.env } = {}) {
  const raw = typeof configured === 'string' ? configured : ''
  const name = raw.trim() || 'dsh'
  const found = resolveExecutable(name, { platform, env })
  return found || name
}
