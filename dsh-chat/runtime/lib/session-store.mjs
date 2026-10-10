/**
 * DSH 会话存储发现与读取。
 *
 * 目录约定（`<dshHome>` 默认 `~/.dsh`）：
 * - 会话日志：`<dshHome>/sessions/<workspace-slug>/<sessionId>/session.v4.jsonl.zstd`
 * - 会话元数据缓存：`<dshHome>/storages/session_projcache/sessions/<sessionId>.json`（明文 JSON）
 *
 * 说明：`<workspace-slug>` 只是兜底标签 —— 这里从不依赖 slug 反推工作区路径，
 * 而是先扫 `sessions` 下两级目录里的 `session.v4.jsonl.zstd`，再从 projcache / 日志头部取 cwd。
 *
 * 所有函数对坏文件（缺失、截断、非法 JSON、不支持的 zstd）都**返回 null / 跳过**，不抛错。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { decodeZstdDetailed } from './zstd-frames.mjs'
import { parseSessionLog, toTranscript } from './session-log.mjs'

/** 会话日志文件名 */
const SESSION_LOG_NAME = 'session.v4.jsonl.zstd'
/** projcache 目录（相对 dshHome） */
const PROJCACHE_DIR = path.join('storages', 'session_projcache', 'sessions')
/** 标题回退时取首条用户文本的字符数 */
const TITLE_FALLBACK_CHARS = 60
/** 解压文本内存缓存的最大条目数 */
const CACHE_MAX = 64

/** logPath -> { mtimeMs, size, text, parsed }，避免重复解压未变化的日志 */
const textCache = new Map()

/** 读取缓存条目（命中则零 IO 零解压） */
function readCacheEntry(logPath) {
  const entry = textCache.get(logPath)
  return entry ?? null
}

/** 写入缓存并做容量控制（Map 保持插入顺序，超限淘汰最旧） */
function writeCacheEntry(logPath, entry) {
  if (textCache.size >= CACHE_MAX) {
    const oldest = textCache.keys().next()
    if (!oldest.done) textCache.delete(oldest.value)
  }
  textCache.set(logPath, entry)
}

/**
 * 清空内部缓存（测试用；文件被就地改写后也可手动调用）。
 */
export function clearSessionCache() {
  textCache.clear()
  projcacheCache.clear()
}

/**
 * 解析 dsh home 目录。
 *
 * @param {{configured?:string, env?:Record<string,string|undefined>, homedir?:string}} [options]
 * @returns {string}
 */
export function resolveDshHome({ configured, env = process.env, homedir = os.homedir() } = {}) {
  if (typeof configured === 'string' && configured.trim().length > 0) return configured.trim()
  const fromEnv = env?.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return fromEnv.trim()
  return path.join(homedir, '.dsh')
}

/** 删除目录（测试用；不存在不报错） */
function tryStat(file) {
  try {
    return fs.statSync(file)
  } catch {
    return null
  }
}

/** 读 JSON 文件并不抛错；失败/畸形返回 null */
function tryReadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** 从 projcache 对象提取 { id, cwd, title, createdAt }，畸形时全为 null */
export function projcacheInfo(raw) {
  const record = raw && typeof raw === 'object' ? raw.record : null
  const rows = record && typeof record === 'object' ? record.rows : null
  const identity = record && typeof record === 'object' ? record.identity : null
  const rowsObj = rows && typeof rows === 'object' ? rows : {}
  const identityObj = identity && typeof identity === 'object' ? identity : {}
  const titleVal = rowsObj.title?.val
  const firstVal = rowsObj.titleInput?.val?.first
  const title =
    typeof titleVal === 'string' && titleVal.trim().length > 0
      ? titleVal
      : typeof firstVal === 'string' && firstVal.trim().length > 0
        ? firstVal
        : null
  return {
    id: typeof identityObj.id === 'string' && identityObj.id.length > 0 ? identityObj.id : null,
    cwd: typeof identityObj.cwd === 'string' && identityObj.cwd.length > 0 ? identityObj.cwd : null,
    title,
    createdAt: Number.isFinite(identityObj.createdAt) ? identityObj.createdAt : null,
  }
}

/** 某 sessionId 对应的 projcache 文件路径 */
function projcachePath(dshHome, id) {
  return path.join(dshHome, PROJCACHE_DIR, `${id}.json`)
}

/** 读取 projcache；文件不存在返回 null */
function readProjcache(dshHome, id) {
  const file = projcachePath(dshHome, id)
  if (!tryStat(file)) return null
  const raw = tryReadJson(file)
  return raw ? projcacheInfo(raw) : null
}

/**
 * 扫描 `<dshHome>/sessions/<slug>/<sessionId>/session.v4.jsonl.zstd`。
 *
 * @returns {Array<{id:string,slug:string,dir:string,logPath:string,mtimeMs:number,sizeBytes:number}>}
 */
export function scanSessionLogs(dshHome) {
  const sessionsRoot = path.join(dshHome, 'sessions')
  let slugs
  try {
    slugs = fs.readdirSync(sessionsRoot, { withFileTypes: true })
  } catch {
    return [] // 目录不存在 / 无权限
  }
  const found = []
  for (const slugEntry of slugs) {
    if (!slugEntry.isDirectory()) continue
    const slugDir = path.join(sessionsRoot, slugEntry.name)
    let ids
    try {
      ids = fs.readdirSync(slugDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const idEntry of ids) {
      if (!idEntry.isDirectory()) continue
      const dir = path.join(slugDir, idEntry.name)
      const logPath = path.join(dir, SESSION_LOG_NAME)
      const stat = tryStat(logPath)
      if (!stat || !stat.isFile()) continue // 坏目录 / 缺日志：跳过
      found.push({
        id: idEntry.name,
        slug: slugEntry.name,
        dir,
        logPath,
        mtimeMs: stat.mtimeMs,
        sizeBytes: stat.size,
      })
    }
  }
  return found
}

/**
 * 列出会话摘要，按 updatedAt 降序。
 *
 * @param {{dshHome?:string, limit?:number, readTitles?:boolean}} [options]
 * @returns {Array<{id:string,slug:string,dir:string,logPath:string,cwd:string|null,title:string|null,
 *                  createdAt:number,updatedAt:number,sizeBytes:number,hasProjcache:boolean}>}
 */
export function listSessions({ dshHome, limit = 50, readTitles = true } = {}) {
  const home = dshHome ?? resolveDshHome()
  const summaries = []
  for (const found of scanSessionLogs(home)) {
    const cache = readProjcacheCached(home, found.id, readTitles)
    summaries.push({
      id: found.id,
      slug: found.slug,
      dir: found.dir,
      logPath: found.logPath,
      cwd: cache?.cwd ?? null,
      title: cache?.title ?? null,
      createdAt: cache?.createdAt ?? Math.round(found.mtimeMs),
      updatedAt: Math.round(found.mtimeMs),
      sizeBytes: found.sizeBytes,
      hasProjcache: cache !== null,
    })
  }
  summaries.sort((a, b) => b.updatedAt - a.updatedAt)
  const max = Number.isFinite(limit) && limit >= 0 ? limit : summaries.length
  return summaries.slice(0, max)
}

/** projcache 读取的小缓存（一次 listSessions 内避免重复读盘） */
const projcacheCache = new Map()
/** 读取 projcache（带进程内缓存）；readTitles=false 时直接跳过读盘 */
function readProjcacheCached(dshHome, id, readTitles) {
  if (!readTitles) return null
  const file = projcachePath(dshHome, id)
  const stat = tryStat(file)
  if (!stat) return null
  const key = `${file}:${stat.mtimeMs}:${stat.size}`
  const hit = projcacheCache.get(key)
  if (hit !== undefined) return hit
  const raw = tryReadJson(file)
  const info = raw ? projcacheInfo(raw) : null
  if (projcacheCache.size >= CACHE_MAX) {
    const oldest = projcacheCache.keys().next()
    if (!oldest.done) projcacheCache.delete(oldest.value)
  }
  projcacheCache.set(key, info)
  return info
}

/**
 * 定位某个会话的目录。
 *
 * @param {{dshHome?:string, id:string}} params
 * @returns {string|null} 先按目录名匹配 id，再回退到 projcache identity.id / 日志 header.id
 */
export function findSessionDir({ dshHome, id }) {
  const home = dshHome ?? resolveDshHome()
  if (typeof id !== 'string' || id.length === 0) return null
  const found = scanSessionLogs(home)
  const direct = found.find((entry) => entry.id === id)
  if (direct) return direct.dir
  for (const entry of found) {
    // 目录名和会话 id 不一致时（改名、拷贝等），回退看 projcache / 日志头部
    if (readProjcache(home, entry.id)?.id === id) return entry.dir
    const parsed = parseLogEntry(entry.logPath)
    if (parsed?.parsed?.header?.id === id) return entry.dir
  }
  return null
}

/** 读取并解析日志（带 mtime+size 缓存）；任何失败返回 null */
function parseLogEntry(logPath) {
  const stat = tryStat(logPath)
  if (!stat) return null
  const cached = readCacheEntry(logPath)
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached
  try {
    const buf = fs.readFileSync(logPath)
    // 容忍尾部半个帧：DSH 正在写的日志随时可能被我们读到中间状态。
    const decoded = decodeZstdDetailed(buf, { tolerant: true })
    if (decoded.decodedFrames === 0) return null // 一个完整帧都没有：当作坏文件
    const text = decoded.text
    const entry = {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      text,
      parsed: parseSessionLog(text),
      tailTruncated: decoded.tailTruncated,
    }
    writeCacheEntry(logPath, entry)
    return entry
  } catch {
    return null // 非法帧 / 缺少 zstd 支持：当作坏文件
  }
}

/** 读取并解析日志（带 mtime+size 缓存）；供状态巡检等外部调用者复用同一份缓存 */
export function readParsedSessionLog(logPath) {
  return parseLogEntry(logPath)
}

/** 标题回退：首条非 context 用户文本前 N 字 */
function titleFromEvents(events) {
  for (const event of events ?? []) {
    if (event?.type !== 'user/message') continue
    const blocks = event.data?.content ?? event.data?.message?.content
    const list = Array.isArray(blocks) ? blocks : []
    const texts = []
    for (const block of list) {
      if (!block || block.type !== 'text') continue
      const text = typeof block.text === 'string' ? block.text : ''
      if (text.length > 0) texts.push(text)
    }
    const joined = texts.filter((text) => !/^\s*<(system-reminder|runtime-context)/.test(text)).join('\n\n').trim()
    if (joined.length > 0) return joined.slice(0, TITLE_FALLBACK_CHARS)
  }
  return null
}

/**
 * 读取并解析一个会话的完整对话（消息列表）。
 *
 * @param {{dshHome?:string, id:string, limit?:number, maxText?:number}} params
 * @returns {any|null} Transcript（见 toTranscript），读不到返回 null
 */
export function readSession({ dshHome, id, limit = 60, maxText = 4000 } = {}) {
  const home = dshHome ?? resolveDshHome()
  const dir = findSessionDir({ dshHome: home, id })
  if (!dir) return null
  const logPath = path.join(dir, SESSION_LOG_NAME)
  const entry = parseLogEntry(logPath)
  if (!entry) return null
  const transcript = toTranscript(entry.parsed, {
    limit,
    maxText,
    now: Math.round(entry.mtimeMs),
  })
  const cache = readProjcache(home, path.basename(dir))
  if (!transcript.title) {
    transcript.title = entry.parsed.title || cache?.title || titleFromEvents(entry.parsed.events) || id
  }
  if (!transcript.cwd) transcript.cwd = cache?.cwd ?? entry.parsed.header?.cwd ?? null
  if (transcript.createdAt === null && Number.isFinite(cache?.createdAt)) {
    transcript.createdAt = cache.createdAt
  }
  // 子智能体会话仍可被显式读取/打开，但不应被状态通知轮询当作独立主会话。
  transcript.isSubagent = entry.parsed.header?.isSubagent === true
  transcript.delegationDepth = entry.parsed.header?.delegationDepth ?? 0
  // 日志尾部有半个帧（DSH 正在写）：UI 用它提示「显示的是已落盘部分」
  transcript.tailTruncated = Boolean(entry.tailTruncated)
  return transcript
}

/**
 * 最近活跃的会话（updatedAt 最大）。
 *
 * @param {{dshHome?:string}} [params]
 * @returns {any|null}
 */
export function latestSession({ dshHome } = {}) {
  const home = dshHome ?? resolveDshHome()
  const [first] = listSessions({ dshHome: home, limit: 1, readTitles: true })
  return first ?? null
}
