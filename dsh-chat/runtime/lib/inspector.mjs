/**
 * DSH 会话状态巡检（通知巡检）—— 纯逻辑，无 IO。
 *
 * 喂入某个会话的**增量事件流**（append-only 日志，配合 mtime+size 跳过未变化的文件），
 * 产出「应该发布状态卡」的动作清单，由 main.mjs 转成 publish op：
 *  - running  进行中：sticky 常驻，随最新模型输出节流刷新
 *  - done     本轮完成：非 sticky，auto_hide_ms = 完成停留时长
 *  - waiting  等你审批：sticky，并让卡片自动展开成真 GUI 去处理
 *
 * 设计约定（2026-10-06 grill 定稿）：
 *  - 只有活跃会话出卡：新回合（turn/start）才诞生卡片，静默的会话永远不出卡
 *  - 完成是回合级：turn/end 即完成；用户继续追问 → 下一轮 开始→进行中→完成
 *  - 首见快进不轰炸：sidecar 重启/冷启动全量读历史时，只在「审批未决」或
 *    「回合未结束且日志仍在新鲜期」时补发一张卡
 *  - 审批优先级最高：哪怕卡片被用户 × 掉，waiting 也会重新弹出
 *  - × 关掉的卡在本轮内静默（dismissed），下一个 turn/start 解除
 *  - 卡片展开期间（用户在看真 GUI）一律 sticky：完成也不自动消失，收起时再按状态计时
 */

import { cleanUserText } from './session-log.mjs'

/** 预览文本的最大长度（单行，折叠条里最多显示两行） */
const PREVIEW_MAX_CHARS = 140
/** 进行中时「最新输出」刷新的最小间隔（毫秒）：预览变了且距上次发布够久才重发 */
const PREVIEW_REPUBLISH_MS = 4000
/** 标题回退：首条真人输入的截断长度 */
const TITLE_FALLBACK_CHARS = 60

export const NOTICE_STATUSES = ['running', 'done', 'waiting']

/** 取事件的 data 对象（缺失返回空对象） */
function dataOf(event) {
  const data = event?.data
  return data && typeof data === 'object' ? data : {}
}

/** content 数组（兼容字符串形式） */
function blocksOf(content) {
  if (Array.isArray(content)) return content
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return []
}

/** 压成单行预览文本 */
function oneLine(text, max = PREVIEW_MAX_CHARS) {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/** assistant/message → 最新输出预览（text 块；没有 text 不硬凑） */
function previewFromAssistant(data) {
  const message = data.message && typeof data.message === 'object' ? data.message : {}
  const parts = []
  for (const block of blocksOf(message.content)) {
    if (!block || block.type !== 'text') continue
    const text = typeof block.text === 'string' ? block.text : ''
    if (text.length > 0) parts.push(text)
  }
  const joined = parts.join(' ').trim()
  return joined.length > 0 ? oneLine(joined) : ''
}

/** user/message → 标题回退（首条真人文本，跳过注入上下文） */
function titleFromUserMessage(data) {
  const blocks = data.content ?? data.message?.content
  const cleaned = cleanUserText(blocks)
  return cleaned.context ? '' : oneLine(cleaned.text, TITLE_FALLBACK_CHARS)
}

/** 审批事件的相关 id（用于 asked/decided 配对；缺失时退化为 seq） */
function approvalId(event, data) {
  if (typeof data.id === 'string' && data.id.length > 0) return data.id
  return `seq-${event?.seq ?? '?'}`
}

function emptySessionState() {
  return {
    seen: 0, // 已消费的事件数（增量下标）
    initialized: false, // 是否已完成首见快进
    title: null,
    cwd: null, // 会话工作目录（session 头事件，卡片的项目行用）
    turnActive: false,
    turnNo: null,
    phase: 'idle', // idle | running | done | waiting
    pendingAsks: new Set(), // 未决审批 id
    preview: '',
    dismissed: false, // 用户 × 过这张卡：本轮静默
    expanded: false, // 卡片当前展开（真 GUI 在看）
    doneAt: 0,
    lastPublishAt: 0,
    lastPublishPreview: '',
    mtimeMs: 0,
    sizeBytes: 0,
  }
}

/**
 * 会话状态巡检器。
 *
 * @param {{doneHoldMs?:number, now?:() => number, previewRepublishMs?:number}} [options]
 */
export class NoticeTracker {
  constructor({ doneHoldMs = 30000, now = Date.now, previewRepublishMs = PREVIEW_REPUBLISH_MS } = {}) {
    this.sessions = new Map()
    this.doneHoldMs = doneHoldMs
    this.now = now
    this.previewRepublishMs = previewRepublishMs
  }

  /** 读取（或创建）某会话的内部状态 */
  stateOf(sessionId) {
    let state = this.sessions.get(sessionId)
    if (!state) {
      state = emptySessionState()
      this.sessions.set(sessionId, state)
    }
    return state
  }

  /** 设置 phase；返回是否发生了变化 */
  #setPhase(state, next) {
    if (state.phase === next) return false
    state.phase = next
    return true
  }

  /**
   * 依据当前状态生成发布动作；返回 null 表示这次不该打扰用户。
   * `force` 用于首见快进/展开收起这类"必须表态"的场景（仍受 dismissed 约束，审批除外）。
   */
  #actionFor(state, { now = this.now() } = {}) {
    if (state.phase === 'idle') return null
    const isWaiting = state.phase === 'waiting'
    // × 过的卡保持静默（审批除外）——force 也越不过去
    if (state.dismissed && !isWaiting) return null
    const expanded = state.expanded
    const sticky = state.phase === 'done' ? expanded : true
    state.lastPublishAt = now
    state.lastPublishPreview = state.preview
    return {
      status: state.phase,
      sticky,
      // done 且未展开时交给宿主 auto-hide 计时（毫秒）；展开期间 sticky 持有
      autoHideMs: state.phase === 'done' && !expanded ? this.doneHoldMs : null,
      autoExpand: isWaiting && !expanded,
      title: state.title,
      cwd: state.cwd,
      preview: state.preview,
    }
  }

  /**
   * 主入口：喂入某会话的事件流（可重复喂，内部按 seen 增量消费），
   * 返回要发布的动作清单（0..n 个）。
   *
   * @param {string} sessionId
   * @param {any[]} events parseSessionLog 的 events（全量；内部切片增量）
   * @param {{fresh?:boolean, now?:number, mtimeMs?:number, sizeBytes?:number}} [options]
   *   fresh 日志是否仍在新鲜期（mtime 距今很近），用于首见快进时判断"是不是真的在跑"
   */
  ingest(sessionId, events, options = {}) {
    const list = Array.isArray(events) ? events : []
    let state = this.stateOf(sessionId)
    if (list.length < state.seen) {
      // 日志变短了（被重写/压缩）：整段重置后重新快进
      this.sessions.set(sessionId, emptySessionState())
      state = this.stateOf(sessionId)
    }
    const now = Number.isFinite(options.now) ? options.now : this.now()
    if (Number.isFinite(options.mtimeMs)) state.mtimeMs = options.mtimeMs
    if (Number.isFinite(options.sizeBytes)) state.sizeBytes = options.sizeBytes

    const freshEvents = list.slice(state.seen)
    state.seen = list.length

    const actions = []
    let phaseChanged = false
    for (const event of freshEvents) {
      if (this.#applyEvent(state, event, now)) phaseChanged = true
    }

    if (!state.initialized) {
      state.initialized = true
      // 首见快进：历史会话默认闭嘴，只补「审批未决」和「确实还在跑」两张卡
      if (state.phase === 'waiting') {
        const action = this.#actionFor(state, { now })
        if (action) actions.push(action)
      } else if (state.turnActive && options.fresh) {
        const action = this.#actionFor(state, { now })
        if (action) actions.push(action)
      } else {
        state.lastPublishAt = now
        state.lastPublishPreview = state.preview
      }
    } else if (phaseChanged) {
      const action = this.#actionFor(state, { now })
      if (action) actions.push(action)
    } else if (
      state.phase === 'running' &&
      !state.dismissed &&
      state.preview &&
      state.preview !== state.lastPublishPreview &&
      now - state.lastPublishAt >= this.previewRepublishMs
    ) {
      // 进行中：最新输出变了才节流刷新（让折叠条的预览活着）
      const action = this.#actionFor(state, { now })
      if (action) actions.push(action)
    }
    return actions
  }

  /** 单事件推进状态；返回 phase 是否变化 */
  #applyEvent(state, event, now) {
    const type = event?.type
    const data = dataOf(event)
    if (type === 'session') {
      // session 头事件的 cwd 在顶层（parseSessionLog 的 header 也从这里取）
      if (typeof event?.cwd === 'string' && event.cwd.length > 0) state.cwd = event.cwd
      return false
    }
    if (type === 'session/title') {
      const title = typeof data.title === 'string' ? data.title.trim() : ''
      if (title.length > 0) state.title = title
      return false
    }
    if (type === 'user/message') {
      if (!state.title) {
        const fallback = titleFromUserMessage(data)
        if (fallback.length > 0) state.title = fallback
      }
      return false
    }
    if (type === 'assistant/message') {
      const preview = previewFromAssistant(data)
      if (preview.length > 0) state.preview = preview
      return false
    }
    if (type === 'turn/start') {
      const turn = Number.isFinite(data.turn) ? data.turn : null
      const isNewTurn = !state.turnActive || (turn !== null && turn !== state.turnNo)
      state.turnActive = true
      if (turn !== null) state.turnNo = turn
      if (isNewTurn) {
        // 新回合：× 的静默解除，完成时间清零
        state.dismissed = false
        state.doneAt = 0
      }
      return this.#setPhase(state, 'running')
    }
    if (type === 'turn/end') {
      state.turnActive = false
      if (state.doneAt === 0) state.doneAt = now
      // 审批未决优先展示：turn/end 不把 waiting 翻成 done
      if (state.phase === 'waiting') return false
      return this.#setPhase(state, 'done')
    }
    if (type === 'approval/asked') {
      state.pendingAsks.add(approvalId(event, data))
      return this.#setPhase(state, 'waiting')
    }
    if (type === 'approval/decided') {
      state.pendingAsks.delete(approvalId(event, data))
      if (state.pendingAsks.size > 0) return false
      if (state.turnActive) return this.#setPhase(state, 'running')
      if (state.phase === 'waiting') {
        if (state.doneAt === 0) state.doneAt = now
        return this.#setPhase(state, 'done')
      }
      return false
    }
    // 其他事件（step/*、tool/*、inbox/spliced、未知类型）一律只影响预览/标题，不动 phase
    return false
  }

  /** 卡片被用户 ×：本轮静默（审批除外）；下一个 turn/start 自动解除 */
  markDismissed(sessionId) {
    const state = this.sessions.get(sessionId)
    if (!state) return
    state.dismissed = true
    state.expanded = false
  }

  /**
   * 卡片展开/收起（真 GUI 在看 / 折叠回去）。
   * 返回需要补发的动作（状态没变也要重发一次，让宿主把 sticky/计时切对），null = 无需动作。
   */
  setExpanded(sessionId, expanded) {
    const state = this.sessions.get(sessionId)
    if (!state || !state.initialized) return null
    const next = !!expanded
    if (state.expanded === next) return null
    state.expanded = next
    if (state.phase === 'idle') return null
    return this.#actionFor(state)
  }

  /**
   * 当前状态的发布动作（小窗卡关闭后重发状态卡用）。
   * 与 setExpanded 不同：不改任何状态，只按现状出一次牌；该静默的照样静默。
   */
  currentAction(sessionId) {
    const state = this.sessions.get(sessionId)
    if (!state || !state.initialized || state.phase === 'idle') return null
    return this.#actionFor(state)
  }

  /** 供设置页/排查用：当前跟踪中的会话摘要 */
  summary(limit = 8) {
    const rows = []
    for (const [id, state] of this.sessions) {
      rows.push({
        id,
        title: state.title,
        phase: state.phase,
        preview: state.preview,
        turnActive: state.turnActive,
        pendingApprovals: state.pendingAsks.size,
        expanded: state.expanded,
        dismissed: state.dismissed,
        eventsSeen: state.seen,
      })
      if (rows.length >= limit) break
    }
    return rows
  }
}
