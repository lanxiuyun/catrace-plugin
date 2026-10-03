/**
 * dsh-chat 小窗卡片（Catrace Toast 自定义卡）。
 *
 * 小窗 = 一个常驻（sticky）的小窗口：上面是 DSH 会话的消息流，下面是输入框。
 *  - 镜像：跟随/固定某个 DSH 会话，按 pollMs 轮询日志，实现「在 DSH 里聊，小窗里看」；
 *  - 对话：输入框里的消息通过官方 SDK 起一个新会话（回复同样落进 DSH 会话库）。
 *
 * 数据通路：**Toast 窗不能调 plugin.sidecar.request**（宿主只放行 main 窗），
 * 因此卡片用 fetch 访问 sidecar 的本机 HTTP 桥，端口与口令来自事件 payload。
 *
 * 尺寸约束（见插件 .agent/features/dsh-chat/README.md）：
 *  宿主 .toast-card 卡槽固定 22.5rem（360px），.toast-stack 是 overflow-x: hidden。
 *  所以根节点只能 width:100% + border-box，且内部一切长文本必须能换行/截断，
 *  否则会顶出横向滚动条（overflow-y:auto 会把 overflow-x 也算成 auto）。
 *
 * 约束（Catrace 外部插件合同）：只用注入的 Vue/Naive 白名单、尺寸用 rem、样式带 dsh-chat 前缀。
 */
const { h, ref, computed, watch, onMounted, onBeforeUnmount } = globalThis.__CATRACE_VUE__ || {}

if (typeof h !== 'function') throw new Error('Catrace plugin Vue runtime missing')

const { NButton, NInput, NSelect, NTag, NTooltip } = globalThis.__CATRACE_NAIVE__ || {}

const STYLE_ID = 'dsh-chat-card-style'

/** 卡片样式（尺寸必须落在宿主 22.5rem 卡槽内，见文件头注释）。 */
const CARD_CSS = `
.dsh-chat-card {
  display: flex; flex-direction: column;
  /* 撑满卡槽：宿主 .toast-card 固定 22.5rem，超出会被 .toast-stack 裁掉 */
  width: 100%; box-sizing: border-box;
  height: 30rem;
  background: var(--ct-surface, #ffffff);
  color: var(--ct-text, #2e1065);
  border: 1px solid var(--ct-border, rgba(0, 0, 0, 0.10));
  border-radius: 0.75rem;
  box-shadow:
    0 0.5rem 1.5rem rgba(0, 0, 0, 0.18),
    0 0.125rem 0.375rem rgba(0, 0, 0, 0.12);
  overflow: hidden;
  font-size: 0.8125rem; line-height: 1.5;
  overflow-wrap: anywhere;
}

/* ---------- 顶栏 ---------- */
.dsh-chat-card__header {
  display: flex; flex-direction: column; gap: 0.125rem;
  padding: 0.5rem 0.5rem 0.4375rem 0.75rem;
  border-bottom: 1px solid var(--ct-border, rgba(0,0,0,0.08));
  flex: 0 0 auto;
}
.dsh-chat-card__header-top { display: flex; align-items: center; gap: 0.375rem; min-width: 0; }
.dsh-chat-card__title {
  font-weight: 600; flex: 1 1 auto; min-width: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.dsh-chat-card__actions { display: flex; align-items: center; gap: 0.0625rem; flex: 0 0 auto; }
.dsh-chat-card__header-sub {
  display: flex; align-items: center; gap: 0.375rem;
  color: var(--ct-text-subtle, #9aa4b2); font-size: 0.6875rem;
  min-width: 0;
}
.dsh-chat-card__header-sub > span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* ---------- 消息区 ---------- */
.dsh-chat-card__body {
  flex: 1 1 auto; min-height: 0;
  overflow-y: auto; overflow-x: hidden;
  padding: 0.625rem 0.75rem;
  display: flex; flex-direction: column; gap: 0.5rem;
  overscroll-behavior: contain;
}
.dsh-chat-card__row { display: flex; flex-direction: column; gap: 0.125rem; max-width: 100%; min-width: 0; }
.dsh-chat-card__row.is-user { align-items: flex-end; }
.dsh-chat-card__row.is-assistant { align-items: stretch; }
.dsh-chat-card__bubble {
  white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word;
  padding: 0.375rem 0.5rem; border-radius: 0.5rem;
  max-width: 92%; box-sizing: border-box;
}
.dsh-chat-card__row.is-user .dsh-chat-card__bubble {
  align-self: flex-end;
  background: var(--ct-accent-soft, rgba(124, 58, 237, 0.14));
}
.dsh-chat-card__row.is-assistant .dsh-chat-card__bubble {
  background: var(--ct-surface-2, rgba(127, 127, 127, 0.09));
}
.dsh-chat-card__meta { color: var(--ct-text-subtle, #9aa4b2); font-size: 0.625rem; }

/* 折叠块（思考 / 工具调用）：summary 单行，内容可长但必须换行 */
.dsh-chat-card__fold { min-width: 0; }
.dsh-chat-card__fold > summary {
  cursor: pointer; list-style: none;
  color: var(--ct-text-muted, #8a94a6); font-size: 0.6875rem;
  display: flex; align-items: center; gap: 0.25rem;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.dsh-chat-card__fold > summary::-webkit-details-marker { display: none; }
.dsh-chat-card__fold > summary::before { content: '▸'; flex: 0 0 auto; }
.dsh-chat-card__fold[open] > summary::before { content: '▾'; }
.dsh-chat-card__fold-body {
  margin: 0.1875rem 0 0.1875rem 0.5rem;
  padding-left: 0.4375rem;
  border-left: 2px solid var(--ct-border, rgba(0,0,0,0.12));
  display: flex; flex-direction: column; gap: 0.25rem;
  min-width: 0;
}
.dsh-chat-card__reasoning {
  color: var(--ct-text-muted, #8a94a6); font-size: 0.75rem;
  white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word;
  max-height: 8rem; overflow-y: auto; overflow-x: hidden;
}
.dsh-chat-card__tool {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.6875rem; color: var(--ct-text-muted, #6b7280);
  display: flex; align-items: baseline; gap: 0.25rem;
  min-width: 0;
}
.dsh-chat-card__tool-name { flex: 0 0 auto; color: var(--ct-accent, #7c3aed); }
.dsh-chat-card__tool-target {
  flex: 1 1 auto; min-width: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  direction: rtl; text-align: left;   /* 长路径优先保留尾部文件名 */
}
.dsh-chat-card__tool-state { flex: 0 0 auto; }
.dsh-chat-card__tool.is-error .dsh-chat-card__tool-name,
.dsh-chat-card__tool.is-error .dsh-chat-card__tool-state { color: #b42318; }
.dsh-chat-card__empty { color: var(--ct-text-muted, #8a94a6); padding: 1.25rem 0.25rem; text-align: center; }
.dsh-chat-card__notice {
  margin: 0 0.75rem; padding: 0.3125rem 0.5rem; border-radius: 0.375rem;
  background: rgba(180, 35, 24, 0.08); color: #b42318;
  font-size: 0.6875rem; overflow-wrap: anywhere;
}
.dsh-chat-card__notice.is-info { background: var(--ct-accent-softer, rgba(127,127,127,0.10)); color: var(--ct-text-muted, #6b7280); }

/* ---------- 输入区 ---------- */
.dsh-chat-card__footer {
  flex: 0 0 auto; border-top: 1px solid var(--ct-border, rgba(0,0,0,0.08));
  padding: 0.5rem 0.5rem 0.4375rem 0.75rem;
  display: flex; flex-direction: column; gap: 0.3125rem;
}
.dsh-chat-card__composer { display: flex; align-items: flex-end; gap: 0.375rem; min-width: 0; }
.dsh-chat-card__composer-main { flex: 1 1 auto; min-width: 0; }
.dsh-chat-card__hint {
  display: flex; align-items: center; gap: 0.375rem;
  color: var(--ct-text-subtle, #9aa4b2); font-size: 0.625rem; min-width: 0;
}
.dsh-chat-card__hint-text {
  flex: 1 1 auto; min-width: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.dsh-chat-card__picker { width: 8.5rem; flex: 0 0 auto; }

/* ---------- A2：真 GUI 模式（iframe 指向 sidecar 的同源反代） ---------- */
.dsh-chat-card__header.is-compact { flex-direction: row; align-items: center; gap: 0.375rem; padding: 0.3125rem 0.375rem 0.3125rem 0.625rem; }
.dsh-chat-card__frame {
  flex: 1 1 auto; min-height: 0; width: 100%; border: 0;
  background: var(--ct-surface, #ffffff);
}
.dsh-chat-card__actions button { min-width: 1.5rem; }
`

/**
 * 注入/更新卡片样式。
 * Toast 窗会跨挂载复用（同一 document），所以不能「有就跳过」——否则改了 ui.mjs 后
 * 老样式一直生效，只有重启应用才看得到新样式。这里发现内容不同就覆盖。
 */
function ensureStyle() {
  if (typeof document === 'undefined') return
  const existing = document.getElementById(STYLE_ID)
  if (existing) {
    if (existing.textContent !== CARD_CSS) existing.textContent = CARD_CSS
    return
  }
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CARD_CSS
  document.head.appendChild(style)
}

function clockOf(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 工具参数太长，只留「像路径的那一段」的最后两节，例如 dsh-chat/ui.mjs */
function toolTarget(argsSummary, max = 40) {
  if (!argsSummary) return ''
  const quoted = String(argsSummary).match(/"([^"]{3,240})"/)
  const candidate = (quoted ? quoted[1] : String(argsSummary)).replace(/\s+/g, ' ').trim()
  const looksLikePath = /[\\/]/.test(candidate)
  const cleaned = looksLikePath
    ? candidate.replace(/^[A-Za-z]:[\\/]/, '').split(/[\\/]/).filter(Boolean).slice(-2).join('/')
    : candidate
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned
}

/** 把连续的 tool item 合成一个「N 个工具调用」折叠组，别把消息流冲成工具墙 */
function groupItems(items) {
  const out = []
  for (const item of items) {
    if (!item) continue
    const last = out[out.length - 1]
    if (item.kind === 'tool') {
      if (last && last.kind === 'toolGroup') {
        last.tools.push(item)
      } else {
        out.push({ kind: 'toolGroup', id: `g:${item.id}`, time: item.time, tools: [item] })
      }
      continue
    }
    out.push(item)
  }
  return out
}

/** 重新加载 iframe：改 src 会重挂，用 about:blank 中转一次 */
function reloadFrame(frameRef) {
  const frame = frameRef?.value?.$el ?? frameRef?.value
  if (!frame || typeof frame.src !== 'string') return
  const target = frame.src
  frame.src = 'about:blank'
  window.setTimeout(() => {
    frame.src = target
  }, 50)
}

const DshChatWindowCard = {
  name: 'DshChatWindowCard',
  props: {
    event: { type: Object, required: true },
    isHovered: { type: Boolean, default: false },
  },
  emits: ['close', 'action'],
  setup(props, { emit }) {
    const items = ref([])
    const session = ref(null)
    const options = ref([])
    const targetId = ref('')
    const draft = ref('')
    const busy = ref(false)
    const error = ref('')
    const notice = ref('')
    const mode = ref('mirror')
    const pinned = ref(false)
    const statusLine = ref('')
    /** sidecar 报回的生效配置（改设置后不必重开小窗） */
    const liveConfigRef = ref(null)
    const bodyRef = ref(null)
    const inputRef = ref(null)
    const stickToBottom = ref(true)
    /** callId -> 参数摘要，用来给 tool item 补上「操作对象」 */
    const toolArgs = new Map()
    let timer = null
    let disposed = false

    const payload = computed(() => (props.event && props.event.payload) || {})
    const guiUrl = computed(() => String(payload.value.guiUrl || ''))
    const isGui = computed(() => guiUrl.value.length > 0)
    // 优先用 sidecar 报回的"生效配置"：这样在设置页改「显示条数 / 轮询间隔」后，
    // 卡片下一轮就自动跟着变，不用重新打开小窗（payload 里的值只是打开那一刻的快照）。
    const liveConfig = computed(() => liveConfigRef.value || {})
    const pollMs = computed(() => {
      const n = Number(liveConfig.value.pollMs ?? payload.value.pollMs)
      return Number.isFinite(n) ? Math.min(30000, Math.max(500, n)) : 2000
    })
    const limit = computed(() => {
      const n = Number(liveConfig.value.mirrorLimit ?? payload.value.limit)
      return Number.isFinite(n) ? Math.min(200, Math.max(6, n)) : 40
    })
    const isChat = computed(() => mode.value === 'chat')
    const canSend = computed(() => draft.value.trim().length > 0 && !busy.value)
    const viewItems = computed(() => groupItems(items.value))
    const subline = computed(() => {
      const s = session.value
      const parts = []
      if (s?.cwd) parts.push(s.cwd)
      if (s?.updatedAt) parts.push(`更新于 ${clockOf(s.updatedAt)}`)
      if (!parts.length && targetId.value) parts.push(targetId.value)
      return parts.join(' · ')
    })

    async function call(method, params = {}) {
      // 注意：Toast 卡片跑在 reminder-toast 窗，宿主只放行 main 窗调 `plugin.sidecar.request`，
      // 所以卡片一律走 sidecar 的本机 HTTP 桥（端口与口令来自事件 payload）。
      const port = Number(payload.value.httpPort) || 23457
      const token = String(payload.value.httpToken || '')
      const base = `http://127.0.0.1:${port}`
      const headers = token ? { 'X-Dsh-Chat-Token': token } : {}
      let url = base
      let init = { headers }
      if (method === 'sendPrompt') {
        url = `${base}/prompt`
        init = { ...init, method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: params.text }) }
      } else if (method === 'stopChat') {
        url = `${base}/stop`
        init = { ...init, method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' }
      } else if (method === 'setMirror') {
        url = `${base}/mirror`
        init = { ...init, method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: params.sessionId ?? '' }) }
      } else if (method === 'readSession') {
        const query = new URLSearchParams()
        if (params.id) query.set('id', params.id)
        query.set('limit', String(params.limit ?? limit.value))
        url = `${base}/session?${query.toString()}`
      } else if (method === 'listSessions') {
        url = `${base}/sessions?limit=${encodeURIComponent(String(params.limit ?? 12))}`
      } else if (method === 'status') {
        url = `${base}/status`
      } else {
        throw new Error(`卡片不支持的方法：${method}`)
      }

      let response
      try {
        response = await fetch(url, init)
      } catch (cause) {
        throw new Error(
          `本机 HTTP 桥连不上（127.0.0.1:${port}）：${cause?.message || cause}。` +
            '若插件或 sidecar 刚重启过，端口/口令会变，请到插件详情页重新点「打开小窗」。',
        )
      }
      let data = null
      try {
        data = await response.json()
      } catch {
        throw new Error(`HTTP ${response.status}：返回不是 JSON`)
      }
      if (!response.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${response.status}`)
      return data.result
    }

    async function loadStatus() {
      try {
        const info = await call('status')
        statusLine.value = [info.model, info.reasoningEffort].filter(Boolean).join(' · ')
        // 生效配置存下来：显示条数 / 轮询间隔跟着设置页实时变，不用重开小窗
        if (info && typeof info === 'object' && info.config) liveConfigRef.value = info.config
        if (!targetId.value && info.mirrorSessionId) targetId.value = info.mirrorSessionId
        pinned.value = Boolean(info.mirrorPinned)
      } catch (cause) {
        error.value = cause?.message || String(cause)
      }
    }

    async function loadOptions() {
      try {
        const res = await call('listSessions', { limit: 12 })
        const list = Array.isArray(res?.sessions) ? res.sessions : []
        options.value = list.map((s) => ({ label: s.title || s.id, value: s.id }))
        if (!targetId.value && list.length > 0) targetId.value = list[0].id
      } catch {
        /* 列表失败不阻塞正文 */
      }
    }

    async function refresh() {
      if (disposed) return
      try {
        const res = await call('readSession', { id: targetId.value || undefined, limit: limit.value })
        if (disposed) return
        if (!res?.session) {
          items.value = []
          session.value = null
          error.value = res?.reason === 'unreadable' ? '这个会话的日志暂时读不出来（可能正在写入）' : ''
          return
        }
        session.value = res.session
        items.value = Array.isArray(res.session.items) ? res.session.items : []
        toolArgs.clear()
        for (const item of items.value) {
          if (item.kind === 'assistant' && Array.isArray(item.tools)) {
            for (const tool of item.tools) if (tool?.id) toolArgs.set(tool.id, tool.argsSummary || '')
          }
        }
        notice.value = res.session.tailTruncated ? '日志正在写入，显示的是已落盘部分' : ''
        error.value = ''
        if (!targetId.value) targetId.value = res.session.id
      } catch (cause) {
        error.value = cause?.message || String(cause)
      }
    }

    function scrollToBottom() {
      const el = bodyRef.value
      if (el && stickToBottom.value) el.scrollTop = el.scrollHeight
    }

    function onBodyScroll() {
      const el = bodyRef.value
      if (!el) return
      stickToBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    }

    async function send() {
      const text = draft.value.trim()
      if (!text || busy.value) return
      busy.value = true
      error.value = ''
      try {
        const res = await call('sendPrompt', { text })
        draft.value = ''
        if (res?.sessionId) {
          targetId.value = res.sessionId
          mode.value = 'chat'
        }
        stickToBottom.value = true
        window.setTimeout(() => void refresh(), 600)
      } catch (cause) {
        error.value = cause?.message || String(cause)
      } finally {
        busy.value = false
        // 注入的 Vue 运行时没有 nextTick，用宏任务等一次渲染
        window.setTimeout(() => inputRef.value?.focus?.(), 0)
      }
    }

    async function stop() {
      try {
        await call('stopChat')
        notice.value = '已停止正在跑的 DSH 会话进程'
      } catch (cause) {
        error.value = cause?.message || String(cause)
      }
      busy.value = false
    }

    async function pickSession(id) {
      if (!id) return
      try {
        await call('setMirror', { sessionId: id })
        targetId.value = id
        mode.value = 'mirror'
        pinned.value = true
        await refresh()
      } catch (cause) {
        error.value = cause?.message || String(cause)
      }
    }

    function onKeydown(event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        void send()
      }
    }

    /** Toast 窗默认 noactivate：第一次点击才激活窗口，输入框需要手动补焦点。 */
    function onCardPointerDown() {
      window.setTimeout(() => inputRef.value?.focus?.(), 0)
    }

    onMounted(async () => {
      ensureStyle()
      // 真 GUI 模式：iframe 里就是官方界面，什么都不用我们拉
      if (isGui.value) return
      await Promise.all([loadStatus(), loadOptions()])
      await refresh()
      window.setTimeout(() => scrollToBottom(), 0)
      arm()
    })

    function arm() {
      if (timer !== null) window.clearInterval(timer)
      timer = window.setInterval(() => void refresh(), pollMs.value)
    }

    // 轮询间隔跟着生效配置走：设置页改了间隔，这里重挂定时器即可，不必重开小窗
    const stopWatch = watch ? watch(pollMs, () => arm()) : null

    onBeforeUnmount(() => {
      disposed = true
      if (typeof stopWatch === 'function') stopWatch()
      if (timer !== null) window.clearInterval(timer)
      timer = null
    })

    function renderFold(summaryText, children, key) {
      return h('details', { class: 'dsh-chat-card__fold', key }, [
        h('summary', null, summaryText),
        h('div', { class: 'dsh-chat-card__fold-body' }, children),
      ])
    }

    function renderItem(item, index) {
      if (!item) return null
      if (item.kind === 'user') {
        if (item.context) return null
        return h('div', { class: 'dsh-chat-card__row is-user', key: `u${index}` }, [
          h('div', { class: 'dsh-chat-card__bubble' }, item.text || ''),
        ])
      }
      if (item.kind === 'assistant') {
        const children = []
        if (item.reasoning) {
          children.push(
            renderFold('思考', [h('div', { class: 'dsh-chat-card__reasoning' }, item.reasoning)], 'r'),
          )
        }
        if (item.text) children.push(h('div', { class: 'dsh-chat-card__bubble', key: 't' }, item.text))
        if (children.length === 0) return null
        return h('div', { class: 'dsh-chat-card__row is-assistant', key: `a${index}` }, children)
      }
      if (item.kind === 'toolGroup') {
        const failed = item.tools.filter((tool) => tool.ok === false).length
        const label = `${item.tools.length} 个工具调用${failed > 0 ? `（${failed} 个失败）` : ''}`
        return h(
          'div',
          { class: 'dsh-chat-card__row is-assistant', key: item.id ?? `g${index}` },
          [
            renderFold(
              label,
              item.tools.map((tool, i) =>
                h(
                  'div',
                  { class: `dsh-chat-card__tool${tool.ok === false ? ' is-error' : ''}`, key: `t${i}` },
                  [
                    h('span', { class: 'dsh-chat-card__tool-name' }, tool.name || 'tool'),
                    h('span', { class: 'dsh-chat-card__tool-target', title: toolArgs.get(tool.id) || '' }, toolTarget(toolArgs.get(tool.id))),
                    h('span', { class: 'dsh-chat-card__tool-state' }, tool.ok === false ? '失败' : '完成'),
                  ],
                ),
              ),
              'tools',
            ),
          ],
        )
      }
      if (item.kind === 'tool') {
        return h(
          'div',
          { class: 'dsh-chat-card__row is-assistant', key: `k${index}` },
          [
            h('div', { class: `dsh-chat-card__tool${item.ok === false ? ' is-error' : ''}` }, [
              h('span', { class: 'dsh-chat-card__tool-name' }, item.name || 'tool'),
              h('span', { class: 'dsh-chat-card__tool-target' }, toolTarget(toolArgs.get(item.id))),
              h('span', { class: 'dsh-chat-card__tool-state' }, item.ok === false ? '失败' : '完成'),
            ]),
          ],
        )
      }
      return null
    }

    function renderBody() {
      if (items.value.length > 0) return viewItems.value.map((item, i) => renderItem(item, i))
      const message = error.value
        ? error.value
        : targetId.value
          ? '这个会话还没有可显示的消息'
          : '还没有找到 DSH 会话。先在 DSH 里说句话，或改用下面的输入框直接提问。'
      return [h('div', { class: 'dsh-chat-card__empty' }, message)]
    }

    function renderHeader() {
      return h('div', { class: 'dsh-chat-card__header' }, [
        h('div', { class: 'dsh-chat-card__header-top' }, [
          h('div', { class: 'dsh-chat-card__title', title: session.value?.title || props.event?.title || 'DSH 对话' },
            session.value?.title || props.event?.title || 'DSH 对话'),
          h('div', { class: 'dsh-chat-card__actions' }, [
            NTag
              ? h(NTag, { size: 'tiny', bordered: false, type: isChat.value ? 'info' : 'default' }, { default: () => (isChat.value ? '对话' : '镜像') })
              : null,
            NTooltip
              ? h(NTooltip, null, {
                  trigger: () => h(NButton, { size: 'tiny', quaternary: true, onClick: () => void refresh() }, { default: () => '⟳' }),
                  default: () => '重新读取会话日志',
                })
              : null,
            isChat.value
              ? h(NButton, { size: 'tiny', quaternary: true, onClick: () => void stop() }, { default: () => '■' })
              : null,
            h(NButton, { size: 'tiny', quaternary: true, onClick: () => emit('close') }, { default: () => '×' }),
          ]),
        ]),
        h('div', { class: 'dsh-chat-card__header-sub' }, [
          h('span', null, isChat.value ? `对话 ${targetId.value || ''}` : subline.value || '未选择会话'),
        ]),
      ])
    }

    function renderFooter() {
      const meta = []
      if (busy.value) meta.push('DSH 正在回复…')
      if (statusLine.value) meta.push(statusLine.value)
      if (pinned.value) meta.push('已固定')
      return h('div', { class: 'dsh-chat-card__footer' }, [
        h('div', { class: 'dsh-chat-card__composer' }, [
          h('div', { class: 'dsh-chat-card__composer-main' }, [
            NInput
              ? h(NInput, {
                  ref: inputRef,
                  type: 'textarea',
                  size: 'small',
                  autosize: { minRows: 1, maxRows: 3 },
                  value: draft.value,
                  placeholder: '问问 DSH…',
                  'onUpdate:value': (value) => {
                    draft.value = value
                  },
                  onKeydown,
                })
              : h('textarea', {
                  ref: inputRef,
                  value: draft.value,
                  onInput: (e) => {
                    draft.value = e.target.value
                  },
                  onKeydown,
                }),
          ]),
          h(
            NButton,
            { size: 'small', type: 'primary', disabled: !canSend.value, loading: busy.value, onClick: () => void send() },
            { default: () => '发送' },
          ),
        ]),
        h('div', { class: 'dsh-chat-card__hint' }, [
          h('span', { class: 'dsh-chat-card__hint-text', title: meta.join(' · ') }, meta.join(' · ') || 'Enter 发送，Shift+Enter 换行'),
          options.value.length > 1 && NSelect
            ? h(NSelect, {
                class: 'dsh-chat-card__picker',
                size: 'tiny',
                value: targetId.value || null,
                options: options.value,
                consistentMenuWidth: false,
                'onUpdate:value': (value) => void pickSession(value),
              })
            : null,
        ]),
      ])
    }

    function renderGui() {
      const frameRef = ref(null)
      // 官方顶栏被去装饰隐藏了，所以标题显示"会话标题"（拿不到才退回 id）
      const label = payload.value.guiTitle || session.value?.title || payload.value.guiSessionId || 'DSH'
      return h('div', { class: 'dsh-chat-card is-gui', onPointerdown: onCardPointerDown }, [
        h('div', { class: 'dsh-chat-card__header is-compact' }, [
          h(
            'div',
            { class: 'dsh-chat-card__title', title: `${label}\n${payload.value.guiSessionId || ''}` },
            label,
          ),
          h('div', { class: 'dsh-chat-card__actions' }, [
            NTooltip
              ? h(NTooltip, null, {
                  trigger: () =>
                    h(NButton, { size: 'tiny', quaternary: true, onClick: () => reloadFrame(frameRef) }, { default: () => '⟳' }),
                  default: () => '重新加载官方界面',
                })
              : null,
            h(NButton, { size: 'tiny', quaternary: true, onClick: () => emit('close') }, { default: () => '×' }),
          ]),
        ]),
        h('iframe', {
          class: 'dsh-chat-card__frame',
          src: guiUrl.value,
          ref: frameRef,
          // 不加 sandbox：sandbox 会让页面变成 opaque origin，DSH 的信任栅栏直接 403
          allow: 'clipboard-read; clipboard-write',
          onLoad: () => window.setTimeout(() => frameRef.value?.focus?.(), 0),
        }),
      ])
    }

    return () =>
      isGui.value
        ? renderGui()
        : h('div', { class: 'dsh-chat-card', onPointerdown: onCardPointerDown }, [
            renderHeader(),
            error.value ? h('div', { class: 'dsh-chat-card__notice', title: error.value }, error.value) : null,
            notice.value ? h('div', { class: 'dsh-chat-card__notice is-info', title: notice.value }, notice.value) : null,
            h('div', { class: 'dsh-chat-card__body', ref: bodyRef, onScroll: onBodyScroll }, renderBody()),
            renderFooter(),
          ])
  },
}

/** 默认导出即卡片组件；宿主同时兼容 `default` / `Card` 两种取法。 */
export default DshChatWindowCard
export const Card = DshChatWindowCard
