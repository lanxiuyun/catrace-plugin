/**
 * DSH 会话日志解析。
 *
 * 日志是"一行一个 JSON 对象"的 UTF-8 文本（解压后），本模块只做**纯函数式**的解析与规整：
 * - `parseSessionLog`：文本 -> 事件流 + 头部 + 标题（永不抛错）
 * - `toTranscript`：事件流 -> 渲染用的消息列表
 *
 * 设计原则：**未知事件类型 / 缺失字段 / 畸形行一律容忍**，只计数不报错，
 * 因为 DSH 的事件类型会随版本增加，插件不能因为多了一种事件就崩。
 */

/** 单条消息最多保留的文本长度默认值 */
const DEFAULT_MAX_TEXT = 4000
/** 单条 tool-call 参数摘要的默认长度 */
const DEFAULT_ARGS_MAX = 160
/** reminder 消息退化为 text 时保留的字符数 */
const REMINDER_PREVIEW = 200
/** 标题回退时取首条用户文本的字符数 */
const TITLE_FALLBACK_CHARS = 60

/** 注入上下文（不是真人输入）的文本前缀 */
const CONTEXT_PREFIXES = [
  '<system-reminder',
  '<runtime-context',
  'Your parent agent id is',
  '[model changed', // 真实日志里出现的注入通知：模型切换后由宿主插入，不是用户输入
]

/** 摘要成一行时的空白压缩 */
const WHITESPACE_RE = /\s+/g

/** 先读字段再兜底，避免 undefined */
function asString(value) {
  return typeof value === 'string' ? value : ''
}

/** 取出事件的 data 对象（缺失时返回空对象，便于链式取字段） */
function dataOf(event) {
  const data = event?.data
  return data && typeof data === 'object' ? data : {}
}

/** 取出 content 数组（兼容字符串形式） */
function blocksOf(content) {
  if (Array.isArray(content)) return content
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return []
}

/**
 * 判断一个文本块是否是"注入上下文"而非真实用户输入。
 * @param {{type?:string,text?:string}} block
 */
export function isContextBlock(block) {
  if (!block || block.type !== 'text') return false
  const text = asString(block.text).trimStart()
  return CONTEXT_PREFIXES.some((prefix) => text.startsWith(prefix))
}

/**
 * 清洗用户消息的 content 块，得到"真人文本"。
 *
 * @param {any} blocks content 数组（或字符串）
 * @returns {{text:string, context:boolean, reminder:string|null}}
 *   text     真人文本（`\n\n` 连接后 trim，可能为空串）
 *   context  是否整条只剩注入上下文
 *   reminder 首个上下文块的原文（供退化展示用）
 */
export function cleanUserText(blocks) {
  const list = blocksOf(blocks)
  const real = []
  let reminder = null
  for (const block of list) {
    if (!block || block.type !== 'text') continue
    const text = asString(block.text)
    if (isContextBlock(block)) {
      if (reminder === null) reminder = text
      continue
    }
    if (text.length > 0) real.push(text)
  }
  const text = real.join('\n\n').trim()
  return { text, context: text.length === 0, reminder }
}

/**
 * 把 arguments/参数对象压成一行摘要。
 *
 * @param {any} jsonText 原始参数（通常是 JSON 字符串）
 * @param {number} max 最大长度
 * @returns {string}
 */
export function argsSummary(jsonText, max = DEFAULT_ARGS_MAX) {
  if (jsonText === null || jsonText === undefined) return ''
  let raw
  if (typeof jsonText === 'string') {
    raw = jsonText
  } else {
    try {
      raw = JSON.stringify(jsonText) ?? ''
    } catch {
      raw = String(jsonText)
    }
  }
  const oneLine = raw.replace(WHITESPACE_RE, ' ').trim()
  return oneLine.length > max ? oneLine.slice(0, max) : oneLine
}

/**
 * 按上限截断文本，超出时追加中文截断标记。
 */
function cutText(text, maxText) {
  const limit = Number.isFinite(maxText) && maxText > 0 ? maxText : DEFAULT_MAX_TEXT
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}…（已截断，共 ${text.length} 字符）`
}

/** 拼接某个类型的文本块（用 `\n\n` 连接并 trim） */
function joinBlocks(blocks, type) {
  const parts = []
  for (const block of blocksOf(blocks)) {
    if (!block || block.type !== type) continue
    const text = asString(block.text)
    if (text.length > 0) parts.push(text)
  }
  return parts.join('\n\n').trim()
}

/** 事件 id：优先 data.id / data.message.id / data.callId，兜底 `seq-<seq>` */
function eventId(event) {
  const data = dataOf(event)
  const candidates = [data.id, data.message?.id, data.callId]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  return `seq-${event?.seq ?? '?'}`
}

/**
 * 解析解压后的会话日志文本。永不抛错：无法解析的行记入 badLines 计数。
 *
 * @param {string} text
 * @returns {{header: {id:string|null,cwd:string|null,createdAt:number|null,agentPreset:string|null}|null,
 *            events: any[], title: string|null, badLines: number}}
 */
export function parseSessionLog(text) {
  const events = []
  let badLines = 0
  let header = null
  let title = null
  const lines = asString(text).split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    let event
    try {
      event = JSON.parse(trimmed)
    } catch {
      badLines += 1
      continue
    }
    if (!event || typeof event !== 'object') {
      badLines += 1
      continue
    }
    events.push(event)
    if (header === null && event.type === 'session') {
      header = {
        id: typeof event.id === 'string' ? event.id : null,
        cwd: typeof event.cwd === 'string' ? event.cwd : null,
        createdAt: Number.isFinite(event.createdAt) ? event.createdAt : null,
        agentPreset: typeof event.agentPreset === 'string' ? event.agentPreset : null,
      }
    }
    if (event.type === 'session/title') {
      const value = asString(dataOf(event).title).trim()
      if (value.length > 0) title = value // 取最后一个非空标题
    }
  }
  return { header, events, title, badLines }
}

/** user/message -> Item */
function userItem(event, time) {
  const data = dataOf(event)
  const blocks = data.content ?? data.message?.content
  const cleaned = cleanUserText(blocks)
  const fallback = cleaned.reminder ? cleaned.reminder.trim().slice(0, REMINDER_PREVIEW) : ''
  return {
    kind: 'user',
    id: eventId(event),
    time,
    text: cleaned.context ? fallback : cleaned.text,
    context: cleaned.context,
  }
}

/** assistant/message -> Item */
function assistantItem(event, time) {
  const message = dataOf(event).message ?? {}
  const blocks = blocksOf(message.content)
  const tools = []
  for (const block of blocks) {
    if (!block || block.type !== 'tool-call') continue
    tools.push({
      id: asString(block.id) || null,
      name: asString(block.name) || null,
      argsSummary: argsSummary(block.arguments),
    })
  }
  const reasoning = joinBlocks(blocks, 'reasoning')
  return {
    kind: 'assistant',
    id: typeof message.id === 'string' && message.id ? message.id : eventId(event),
    time,
    text: joinBlocks(blocks, 'text'),
    reasoning: reasoning.length > 0 ? reasoning : null,
    tools,
  }
}

/** tool/result -> Item */
function toolItem(event, time, toolCallNames) {
  const data = dataOf(event)
  const message = data.message ?? {}
  const callId = asString(data.toolCallId) || asString(message.toolCallId) || asString(message.source?.callId)
  const name = toolCallNames.get(callId) ?? null
  return {
    kind: 'tool',
    id: callId || eventId(event),
    time,
    name,
    ok: message.isError !== true,
    text: joinBlocks(message.content, 'text'),
  }
}

/** system/message -> Item */
function systemItem(event, time) {
  const message = dataOf(event).message ?? {}
  return {
    kind: 'system',
    id: typeof message.id === 'string' && message.id ? message.id : eventId(event),
    time,
    text: joinBlocks(message.content, 'text'),
  }
}

/**
 * 把事件流规整成渲染用的消息列表（跳过 turn/step 边界、title、inbox/spliced 等）。
 *
 * @param {{header?:any,events?:any[],title?:string|null}} parsed parseSessionLog 的结果
 * @param {{limit?:number,maxText?:number,now?:number}} [options]
 * @returns {{id:string|null,title:string|null,cwd:string|null,createdAt:number|null,updatedAt:number,
 *            messageCount:number,hasMore:boolean,items:any[]}}
 */
export function toTranscript(parsed, options = {}) {
  const limit = Number.isFinite(options.limit) ? options.limit : 60
  const maxText = options.maxText ?? DEFAULT_MAX_TEXT
  const now = Number.isFinite(options.now) ? options.now : Date.now()
  const events = Array.isArray(parsed?.events) ? parsed.events : []
  const header = parsed?.header ?? null

  const items = []
  const toolCallNames = new Map()
  let lastTime = 0
  let createdAt = Number.isFinite(header?.createdAt) ? header.createdAt : null

  for (const event of events) {
    // 时间：缺失则沿用上一条，都没有则 0
    const time = Number.isFinite(event?.time) ? event.time : lastTime
    lastTime = time
    if (createdAt === null && event?.type === 'session' && Number.isFinite(event.createdAt)) {
      createdAt = event.createdAt
    }
    const type = event?.type
    if (type === 'tool/call') {
      // 先登记 callId -> name，供后续 tool/result 匹配
      const data = dataOf(event)
      const callId = asString(data.callId) || asString(data.id)
      if (callId) toolCallNames.set(callId, asString(data.name) || null)
      continue
    }
    if (type === 'user/message') {
      const item = userItem(event, time)
      item.text = cutText(item.text, maxText)
      items.push(item)
    } else if (type === 'assistant/message') {
      const item = assistantItem(event, time)
      item.text = cutText(item.text, maxText)
      item.reasoning = item.reasoning === null ? null : cutText(item.reasoning, maxText)
      items.push(item)
    } else if (type === 'tool/result') {
      const item = toolItem(event, time, toolCallNames)
      item.text = cutText(item.text, maxText)
      items.push(item)
    } else if (type === 'system/message') {
      const item = systemItem(event, time)
      item.text = cutText(item.text, maxText)
      items.push(item)
    }
    // 其他类型（turn/step 边界、title、inbox/spliced、未知事件）一律忽略
  }

  const title = asString(parsed?.title).trim()
  const visible = limit > 0 && items.length > limit ? items.slice(items.length - limit) : items
  return {
    id: asString(header?.id) || null,
    title: title.length > 0 ? title : null,
    cwd: asString(header?.cwd) || null,
    createdAt,
    updatedAt: lastTime > 0 ? lastTime : now,
    messageCount: items.length,
    hasMore: visible.length < items.length,
    items: visible,
  }
}
