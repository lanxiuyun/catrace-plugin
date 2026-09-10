/** Agent notify toast — one card per sessionId; optional debug dump. */
const { h } = globalThis.__CATRACE_VUE__ || {}
if (typeof h !== 'function') throw new Error('Catrace plugin Vue runtime missing')

const STYLE_ID = 'catrace-plugin-agent-notify-css'
const CSS = `
.agent-toast {
  display: flex; flex-direction: column; width: 100%; min-height: 0;
  font-family: system-ui, -apple-system, Segoe UI, sans-serif;
}
.agent-toast .header {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 0.5rem; margin-bottom: 0.375rem; min-height: 1.25rem;
}
.agent-toast .header-left {
  display: flex; align-items: flex-start; gap: 0.5rem; min-width: 0; flex: 1;
}
.agent-toast .pulse-dot {
  width: 0.5rem; height: 0.5rem; margin-top: 0.35rem; border-radius: 50%;
  background: var(--accent); flex-shrink: 0;
  animation: an-pulse 1.5s ease-in-out infinite;
}
@keyframes an-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(1.3); }
}
.agent-toast .title {
  flex: 1; min-width: 0; margin: 0; font-size: 0.9375rem; font-weight: 700;
  color: var(--title); line-height: 1.3; word-break: break-word;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.agent-toast .close-btn {
  width: 1.5rem; height: 1.5rem; display: flex; align-items: center; justify-content: center;
  background: transparent; border: none; color: #9C8DB5; cursor: pointer;
  border-radius: 0.375rem; padding: 0; flex-shrink: 0;
}
.agent-toast .close-btn:hover { background: var(--light-bg); color: var(--accent); }
.agent-toast .meta-row {
  display: flex; flex-wrap: wrap; align-items: center; gap: 0.375rem; margin-bottom: 0.375rem;
}
.agent-toast .chip {
  display: inline-flex; align-items: center; max-width: 100%; height: 1.25rem;
  padding: 0 0.4375rem; border-radius: 0.25rem; font-size: 0.6875rem; font-weight: 600;
  line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.agent-toast .project-chip {
  background: rgba(15, 23, 42, 0.06); color: #334155;
  border: 0.0625rem solid rgba(15, 23, 42, 0.08);
}
.agent-toast .project-chip.muted { color: #94a3b8; font-weight: 500; }
.agent-toast .event-chip {
  background: var(--badge-bg); color: var(--badge-fg); border: 0.0625rem solid var(--border);
}
.agent-toast .sid {
  font-size: 0.625rem; color: #94a3b8; font-family: ui-monospace, Menlo, Consolas, monospace;
  word-break: break-all;
}
.agent-toast .body-text {
  font-size: 0.75rem; color: var(--body); line-height: 1.45; margin: 0 0 0.5rem 0;
  word-break: break-word;
}
.agent-toast .hint-row { display: flex; justify-content: flex-end; margin-bottom: 0.5rem; }
.agent-toast .goto-hint { font-size: 0.6875rem; color: var(--accent); opacity: 0.85; font-weight: 600; }
.agent-toast .dump-wrap,
.perm-card .dump-wrap {
  margin: 0.5rem 0 0.625rem;
  border: 0.0625rem solid #dedede;
  border-radius: 0.625rem;
  overflow: hidden;
  background: #ffffff;
  box-shadow: none;
}
.agent-toast .dump-bar,
.perm-card .dump-bar {
  display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
  min-height: 1.875rem; padding: 0.125rem 0.5rem 0.125rem 0.625rem;
  background: #f7f7f7;
  border-bottom: 0.0625rem solid #e5e5e5;
  cursor: pointer;
  transition: background 0.15s ease;
}
.agent-toast .dump-toggle,
.perm-card .dump-toggle {
  display: inline-flex; flex: 1; align-items: center; gap: 0.3rem;
  border: none; background: transparent; color: #475569;
  font-size: 0.6875rem; font-weight: 700; cursor: pointer; padding: 0.25rem 0;
  text-align: left;
}
.agent-toast .dump-arrow,
.perm-card .dump-arrow { width: 0.625rem; color: #94a3b8; font-size: 0.6875rem; line-height: 1; }
.agent-toast .dump-tools,
.perm-card .dump-tools { display: flex; align-items: center; gap: 0.375rem; }
.agent-toast .dump-tabs,
.perm-card .dump-tabs {
  display: flex; gap: 0.0625rem; padding: 0.0625rem;
  border-radius: 0.3125rem; background: #e9e9e9;
}
.agent-toast .dump-tab,
.perm-card .dump-tab {
  border: none; border-radius: 0.25rem; height: 1.25rem; padding: 0 0.4375rem;
  font-size: 0.625rem; font-weight: 700; cursor: pointer;
  background: transparent; color: #8a8a8a;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}
.agent-toast .dump-tab.is-on,
.perm-card .dump-tab.is-on {
  background: #ffffff; color: #475569;
  box-shadow: 0 0.0625rem 0.125rem rgba(0, 0, 0, 0.1);
}
.agent-toast .dump-copy,
.perm-card .dump-copy {
  position: static; height: 1.25rem; padding: 0 0.5rem;
  border: 0.0625rem solid #d6d6d6; border-radius: 0.3125rem;
  font-size: 0.625rem; font-weight: 700; cursor: pointer;
  background: #ffffff; color: #64748b;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.agent-toast .dump-fields,
.perm-card .dump-fields {
  margin: 0; max-height: 14rem; overflow-y: scroll; overflow-x: hidden;
  padding: 0.25rem 0.625rem 0.5rem;
  scrollbar-gutter: stable; scrollbar-width: thin;
  background: #ffffff;
  color: #1e293b;
  -webkit-user-select: text !important;
  user-select: text !important;
  cursor: text;
  pointer-events: auto !important;
}
.agent-toast .dump-fields *,
.perm-card .dump-fields * {
  -webkit-user-select: text !important;
  user-select: text !important;
  cursor: text;
}
.agent-toast .dump-row,
.perm-card .dump-row {
  padding: 0.4rem 0;
  border-bottom: 0.0625rem solid #e2e8f0;
}
.agent-toast .dump-row:last-child,
.perm-card .dump-row:last-child { border-bottom: none; }
.agent-toast .dump-key,
.perm-card .dump-key {
  font-size: 0.625rem; font-weight: 700; letter-spacing: 0.02em;
  color: #2563eb; margin-bottom: 0.15rem;
}
.agent-toast .dump-val,
.perm-card .dump-val {
  font-size: 0.75rem; color: #1e293b; line-height: 1.45;
  white-space: pre-wrap; word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.agent-toast .dump,
.perm-card .dump {
  margin: 0; max-height: 14rem; overflow-x: hidden; overflow-y: scroll;
  padding: 0.5rem 0.625rem; border-radius: 0;
  background: #0f172a; color: #e2e8f0;
  font-size: 0.6875rem; line-height: 1.5;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: pre-wrap; word-break: break-word;
  -webkit-user-select: text !important;
  user-select: text !important;
  cursor: text;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: #94a3b8 #f8fafc;
}
.agent-toast .dump-fields::-webkit-scrollbar,
.perm-card .dump-fields::-webkit-scrollbar { width: 0.5rem; }
.agent-toast .dump-fields::-webkit-scrollbar-thumb,
.perm-card .dump-fields::-webkit-scrollbar-thumb {
  background: #94a3b8; border-radius: 999px;
}
.agent-toast .dump-fields::-webkit-scrollbar-track,
.perm-card .dump-fields::-webkit-scrollbar-track { background: #f8fafc; }
.agent-toast .dump::-webkit-scrollbar-thumb,
.perm-card .dump::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.7); border-radius: 999px;
}
.agent-toast .dump::-webkit-scrollbar-track,
.perm-card .dump::-webkit-scrollbar-track { background: rgba(15, 23, 42, 0.4); }
.perm-card .dump-wrap { position: relative; margin-top: 0.5rem; }
.perm-card { display: flex; flex-direction: column; width: 100%; font-family: system-ui, sans-serif; }
.perm-card .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.375rem; }
.perm-card .header-left { display: flex; align-items: center; gap: 0.5rem; }
.perm-card .pulse-dot {
  width: 0.5rem; height: 0.5rem; border-radius: 50%; background: #f59e0b;
  animation: an-pulse 1.2s ease-in-out infinite;
}
.perm-card .title { margin: 0; font-size: 0.875rem; font-weight: 700; color: #92400e; }
.perm-card .project { font-size: 0.6875rem; color: #b45309; }
.perm-card .tool-block {
  background: #fffbeb; border: 0.0625rem solid #fde68a; border-radius: 0.375rem;
  padding: 0.5rem 0.625rem; margin-bottom: 0.625rem;
}
.perm-card .tool-name {
  font-size: 0.75rem; font-weight: 700; color: #92400e; background: #fef3c7;
  border-radius: 0.25rem; padding: 0.0625rem 0.375rem;
}
.perm-card .tool-summary { font-size: 0.75rem; color: #b45309; margin: 0.25rem 0 0; font-family: ui-monospace, monospace; word-break: break-all; }
.perm-card .actions { display: flex; flex-wrap: wrap; gap: 0.375rem; }
.perm-card .btn { border: none; border-radius: 0.375rem; height: 1.75rem; padding: 0 0.625rem; font-size: 0.75rem; font-weight: 600; cursor: pointer; }
.perm-card .btn-allow { background: #059669; color: #fff; }
.perm-card .btn-deny { background: #fee2e2; color: #991b1b; }
`

const EVENT_LABEL = {
  SessionStart: '会话开始',
  UserPromptSubmit: '开始思考',
  PreToolUse: '调用工具中',
  PostToolUse: '工具调用完成',
  PostToolUseFailure: '工具调用失败',
  Stop: '任务完成',
  StopFailure: '任务出错 / 异常',
  Notification: '等待交互',
}
const EVENT_BODY = {
  SessionStart: '会话已开始',
  UserPromptSubmit: '正在处理你的请求',
  PreToolUse: '正在调用工具',
  PostToolUse: '工具调用完成',
  PostToolUseFailure: '工具调用失败',
  Stop: '本轮任务已完成，等你继续',
  StopFailure: '执行中断，请查看终端',
  Notification: '需要你回来看一眼',
}
const EVENT_THEMES = {
  PostToolUseFailure: { accent: '#EF4444', title: '#991B1B', body: '#B91C1C', lightBg: '#FECACA', border: '#FECACA', badgeBg: '#FEE2E2', badgeFg: '#B91C1C' },
  StopFailure: { accent: '#EF4444', title: '#991B1B', body: '#B91C1C', lightBg: '#FECACA', border: '#FECACA', badgeBg: '#FEE2E2', badgeFg: '#B91C1C' },
  Stop: { accent: '#06B6D4', title: '#0F172A', body: '#475569', lightBg: '#CFFAFE', border: '#A5F3FC', badgeBg: '#CFFAFE', badgeFg: '#0E7490' },
  Notification: { accent: '#8B5CF6', title: '#0F172A', body: '#475569', lightBg: '#E9D5FF', border: '#DDD6FE', badgeBg: '#EDE9FE', badgeFg: '#6D28D9' },
  SessionStart: { accent: '#10B981', title: '#0F172A', body: '#475569', lightBg: '#A7F3D0', border: '#6EE7B7', badgeBg: '#D1FAE5', badgeFg: '#047857' },
  UserPromptSubmit: { accent: '#6B7280', title: '#0F172A', body: '#475569', lightBg: '#E5E7EB', border: '#D1D5DB', badgeBg: '#F3F4F6', badgeFg: '#4B5563' },
  PreToolUse: { accent: '#F59E0B', title: '#0F172A', body: '#475569', lightBg: '#FEF3C7', border: '#FDE68A', badgeBg: '#FEF3C7', badgeFg: '#B45309' },
  PostToolUse: { accent: '#14B8A6', title: '#0F172A', body: '#475569', lightBg: '#CCFBF1', border: '#99F6E4', badgeBg: '#CCFBF1', badgeFg: '#0F766E' },
}

function ensureStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = CSS
  document.head.appendChild(el)
}

function themeOf(event) {
  return EVENT_THEMES[event] || EVENT_THEMES.Stop
}

function themeStyle(t) {
  return {
    '--accent': t.accent,
    '--title': t.title,
    '--body': t.body,
    '--light-bg': t.lightBg,
    '--border': t.border,
    '--badge-bg': t.badgeBg,
    '--badge-fg': t.badgeFg,
  }
}

function projectName(cwd) {
  if (!cwd) return ''
  const parts = String(cwd).replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || ''
}

function toSnake(key) {
  return String(key).replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`).replace(/^_/, '')
}

function rawOf(event) {
  const p = (event && event.payload) || {}
  return p.raw || (p.entry && p.entry.raw) || null
}

function filterCommon(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const skip = new Set()
  for (const key of Object.keys(raw)) {
    const snake = toSnake(key)
    if (snake !== key && Object.prototype.hasOwnProperty.call(raw, snake)) skip.add(key)
  }
  const out = {}
  for (const key of Object.keys(raw)) {
    if (skip.has(key)) continue
    const val = raw[key]
    if (val === '' || val == null) continue
    out[toSnake(key)] = val
  }
  if (out.hook_event_name === out.event) delete out.hook_event_name
  const texts = ['last_assistant_message', 'response_preview', 'response_text']
  const first = texts.map((k) => out[k]).find((v) => typeof v === 'string' && v)
  if (first) {
    for (const k of texts) delete out[k]
    out.last_assistant_message = first
  }
  if (out.mode != null && out.permission_mode != null && out.mode === out.permission_mode) delete out.mode
  return out
}

const COMMON_SKIP = new Set(['response_preview', 'response_text', 'hook_event_name'])
const KEY_ORDER = [
  'event', 'last_assistant_message', 'cwd', 'session_id', 'timestamp',
  'permission_mode', 'state', 'tool_name', 'tool_call_count',
  'transcript_path', 'turn_id', 'trace_id', 'stop_hook_active',
]

function dumpObject(event, mode) {
  const raw = rawOf(event)
  if (mode === 'common') return filterCommon(raw)
  return raw
}

function dumpText(event, mode) {
  try {
    return JSON.stringify(dumpObject(event, mode) ?? { note: '没有收到 hook stdin' }, null, 2)
  } catch (err) {
    return String(err)
  }
}

function orderedKeys(obj) {
  const keys = Object.keys(obj || {})
  const head = KEY_ORDER.filter((k) => keys.includes(k))
  const rest = keys.filter((k) => !KEY_ORDER.includes(k)).sort()
  return [...head, ...rest]
}

function renderFields(obj, mode) {
  if (obj == null) {
    return h('div', { class: 'dump-fields' }, [h('div', { class: 'dump-val' }, '没有收到 hook stdin')])
  }
  if (typeof obj !== 'object' || Array.isArray(obj)) {
    return h('pre', { class: 'dump' }, dumpText({ payload: { raw: obj } }, 'raw'))
  }
  const skip = mode === 'common' ? COMMON_SKIP : new Set()
  const keys = orderedKeys(obj).filter((k) => !skip.has(k))
  return h(
    'div',
    { class: 'dump-fields' },
    keys.map((key) => {
      const val = obj[key]
      const text = typeof val === 'string' ? val : JSON.stringify(val, null, 2)
      return h('div', { class: 'dump-row' }, [
        h('div', { class: 'dump-key' }, key),
        h('div', { class: 'dump-val' }, text),
      ])
    }),
  )
}

export default {
  name: 'AgentNotifyCard',
  props: {
    event: { type: Object, required: true },
    isHovered: { type: Boolean, default: false },
  },
  emits: ['close', 'action'],
  data() {
    return { copied: false, dumpMode: '', dumpExpanded: false }
  },
  created() {
    ensureStyles()
    const p = this.event && this.event.payload
    const v = p && p.debugView
    this.dumpMode = v === 'raw' || v === 'common' ? v : 'common'
    this.dumpExpanded = p && p.debugExpanded === true
  },
  methods: {
    copyDump() {
      const text = dumpText(this.event, this.dumpMode || 'common')
      const done = () => {
        this.copied = true
        setTimeout(() => {
          this.copied = false
        }, 1200)
      }
      const clip = plugin && plugin.clipboard && plugin.clipboard.writeText
      const p = clip ? clip(text) : navigator.clipboard.writeText(text)
      Promise.resolve(p).then(done).catch(() => {})
    },
    renderDump() {
      const p = (this.event && this.event.payload) || {}
      if (!p.debug && p.debugView !== 'common' && p.debugView !== 'raw') return null
      const mode = this.dumpMode || p.debugView || 'common'
      const controls = this.dumpExpanded
        ? h('div', { class: 'dump-tools' }, [
            h('div', { class: 'dump-tabs' }, [
              h('button', {
                class: ['dump-tab', mode === 'common' ? 'is-on' : ''],
                type: 'button',
                onClick: (ev) => { ev.stopPropagation(); this.dumpMode = 'common' },
              }, '常用'),
              h('button', {
                class: ['dump-tab', mode === 'raw' ? 'is-on' : ''],
                type: 'button',
                onClick: (ev) => { ev.stopPropagation(); this.dumpMode = 'raw' },
              }, '原始'),
            ]),
            h('button', {
              class: 'dump-copy',
              type: 'button',
              onClick: (ev) => { ev.stopPropagation(); this.copyDump() },
            }, this.copied ? '已复制' : '复制'),
          ])
        : null
      return h('div', { class: 'dump-wrap' }, [
        h('div', {
          class: 'dump-bar',
          role: 'button',
          tabindex: 0,
          onClick: () => { this.dumpExpanded = !this.dumpExpanded },
          onKeydown: (ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') {
              ev.preventDefault()
              this.dumpExpanded = !this.dumpExpanded
            }
          },
        }, [
          h('span', { class: 'dump-toggle' }, [
            h('span', { class: 'dump-arrow', 'aria-hidden': 'true' }, this.dumpExpanded ? '▾' : '▸'),
            '调试字段',
          ]),
          controls,
        ]),
        this.dumpExpanded ? renderFields(dumpObject(this.event, mode), mode) : null,
      ])
    },
  },
  render() {
    const event = this.event || {}
    const p = event.payload || {}
    const dump = this.renderDump()
    const isPerm = (event.eventType || event.event_type) === 'agent-notify.permission' || p.requestId != null

    if (isPerm) {
      return h('div', { class: 'perm-card' }, [
        h('div', { class: 'header' }, [
          h('div', { class: 'header-left' }, [
            h('div', { class: 'pulse-dot' }),
            h('h2', { class: 'title' }, '等待你批准'),
          ]),
          projectName(p.cwd) ? h('span', { class: 'project' }, projectName(p.cwd)) : null,
        ]),
        h('div', { class: 'tool-block' }, [
          h('span', { class: 'tool-name' }, p.toolName || 'tool'),
        ]),
        h('div', { class: 'actions' }, [
          h('button', { class: 'btn btn-allow', type: 'button', onClick: () => { this.$emit('action', `allow:${p.requestId}`); this.$emit('close') } }, '允许'),
          h('button', { class: 'btn btn-deny', type: 'button', onClick: () => { this.$emit('action', `deny:${p.requestId}`); this.$emit('close') } }, '拒绝'),
        ]),
        dump,
      ])
    }

    const entry = p.entry || (Array.isArray(p.entries) ? p.entries[0] : null) || {}
    const sessionId = p.sessionId || entry.sessionId || ''
    const theme = themeOf(entry.event)
    const title = (entry.sessionTitle && entry.sessionTitle.trim()) || projectName(entry.cwd) || 'AI 助手'
    const body = (entry.raw && (entry.raw.last_assistant_message || entry.raw.responsePreview || entry.raw.responseText))
      || entry.prompt
      || EVENT_BODY[entry.event]
      || '状态已更新'

    return h('div', { class: 'agent-toast', style: themeStyle(theme) }, [
      h('div', { class: 'header' }, [
        h('div', { class: 'header-left' }, [
          h('div', { class: 'pulse-dot' }),
          h('h2', { class: 'title' }, title),
        ]),
        h('button', {
          class: 'close-btn',
          type: 'button',
          'aria-label': 'Close',
          onClick: (ev) => {
            ev.stopPropagation()
            this.$emit('close')
          },
        }, '×'),
      ]),
      h('div', { class: 'meta-row' }, [
        projectName(entry.cwd)
          ? h('span', { class: 'chip project-chip' }, projectName(entry.cwd))
          : h('span', { class: 'chip project-chip muted' }, '未知项目'),
        h('span', { class: 'chip event-chip' }, EVENT_LABEL[entry.event] || entry.event || ''),
      ]),
      dump,
      h('p', { class: 'body-text' }, body),
      h('div', { class: 'hint-row' }, [h('span', { class: 'goto-hint' }, '点击前往会话')]),
    ])
  },
}
