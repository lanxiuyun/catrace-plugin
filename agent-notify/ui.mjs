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
.agent-toast .hint-row { display: flex; justify-content: flex-end; }
.agent-toast .goto-hint { font-size: 0.6875rem; color: var(--accent); opacity: 0.85; font-weight: 600; }
.agent-toast .dump-wrap { position: relative; margin-top: 0.5rem; }
.agent-toast .dump-copy,
.perm-card .dump-copy {
  position: absolute; top: 0.375rem; right: 1rem; z-index: 1;
  height: 1.5rem; padding: 0 0.5rem; border: none; border-radius: 0.25rem;
  font-size: 0.625rem; font-weight: 600; cursor: pointer;
  background: rgba(148, 163, 184, 0.25); color: #e2e8f0;
}
.agent-toast .dump-copy:hover,
.perm-card .dump-copy:hover { background: rgba(148, 163, 184, 0.4); }
.agent-toast .dump,
.perm-card .dump {
  margin: 0; max-height: 16rem; overflow-x: hidden; overflow-y: scroll;
  padding: 0.5rem 0.5rem 0.5rem 0.625rem; padding-top: 1.875rem; border-radius: 0.5rem;
  background: #0f172a; color: #e2e8f0;
  font-size: 0.625rem; line-height: 1.45;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: pre-wrap; word-break: break-word;
  -webkit-user-select: text; user-select: text;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: rgba(148, 163, 184, 0.7) transparent;
}
.agent-toast .dump::-webkit-scrollbar,
.perm-card .dump::-webkit-scrollbar { width: 0.5rem; }
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
  Stop: '任务完成',
  StopFailure: '任务出错 / 异常',
  Notification: '等待交互',
}
const EVENT_BODY = {
  SessionStart: '会话已开始',
  UserPromptSubmit: '正在处理你的请求',
  Stop: '本轮任务已完成，等你继续',
  StopFailure: '执行中断，请查看终端',
  Notification: '需要你回来看一眼',
}
const EVENT_THEMES = {
  StopFailure: { accent: '#EF4444', title: '#991B1B', body: '#B91C1C', lightBg: '#FECACA', border: '#FECACA', badgeBg: '#FEE2E2', badgeFg: '#B91C1C' },
  Stop: { accent: '#06B6D4', title: '#0F172A', body: '#475569', lightBg: '#CFFAFE', border: '#A5F3FC', badgeBg: '#CFFAFE', badgeFg: '#0E7490' },
  Notification: { accent: '#8B5CF6', title: '#0F172A', body: '#475569', lightBg: '#E9D5FF', border: '#DDD6FE', badgeBg: '#EDE9FE', badgeFg: '#6D28D9' },
  SessionStart: { accent: '#10B981', title: '#0F172A', body: '#475569', lightBg: '#A7F3D0', border: '#6EE7B7', badgeBg: '#D1FAE5', badgeFg: '#047857' },
  UserPromptSubmit: { accent: '#6B7280', title: '#0F172A', body: '#475569', lightBg: '#E5E7EB', border: '#D1D5DB', badgeBg: '#F3F4F6', badgeFg: '#4B5563' },
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

function dumpText(event) {
  const p = (event && event.payload) || {}
  const raw = p.raw || (p.entry && p.entry.raw)
  try {
    return JSON.stringify(raw ?? { note: '没有收到 hook POST body' }, null, 2)
  } catch (err) {
    return String(err)
  }
}

export default {
  name: 'AgentNotifyCard',
  props: {
    event: { type: Object, required: true },
    isHovered: { type: Boolean, default: false },
  },
  emits: ['close', 'action'],
  data() {
    return { copied: false }
  },
  created() {
    ensureStyles()
  },
  methods: {
    copyDump() {
      const text = dumpText(this.event)
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
  },
  render() {
    const event = this.event || {}
    const p = event.payload || {}
    const debug = !!p.debug
    const dump = debug
      ? h('div', { class: 'dump-wrap' }, [
          h('button', {
            class: 'dump-copy',
            type: 'button',
            onClick: (ev) => {
              ev.stopPropagation()
              this.copyDump()
            },
          }, this.copied ? '已复制' : '复制'),
          h('pre', { class: 'dump' }, dumpText(event)),
        ])
      : null
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
          h('button', { class: 'btn btn-allow', type: 'button', onClick: () => this.$emit('action', `allow:${p.requestId}`) }, '允许'),
          h('button', { class: 'btn btn-deny', type: 'button', onClick: () => this.$emit('action', `deny:${p.requestId}`) }, '拒绝'),
        ]),
        dump,
      ])
    }

    const entry = p.entry || (Array.isArray(p.entries) ? p.entries[0] : null) || {}
    const sessionId = p.sessionId || entry.sessionId || ''
    const theme = themeOf(entry.event)
    const title = (entry.sessionTitle && entry.sessionTitle.trim()) || projectName(entry.cwd) || 'AI 助手'
    const body = entry.summary || EVENT_BODY[entry.event] || '状态已更新'

    return h('div', { class: 'agent-toast', style: themeStyle(theme) }, [
      h('div', { class: 'header' }, [
        h('div', { class: 'header-left' }, [
          h('div', { class: 'pulse-dot' }),
          h('h2', { class: 'title' }, title),
        ]),
        h('button', {
          class: 'close-btn',
          type: 'button',
          onClick: () => this.$emit('action', `dismiss:${sessionId}`),
        }, '×'),
      ]),
      h('div', { class: 'meta-row' }, [
        projectName(entry.cwd)
          ? h('span', { class: 'chip project-chip' }, projectName(entry.cwd))
          : h('span', { class: 'chip project-chip muted' }, '未知项目'),
        h('span', { class: 'chip event-chip' }, EVENT_LABEL[entry.event] || entry.event || ''),
      ]),
      debug ? h('div', { class: 'sid' }, sessionId) : null,
      h('p', { class: 'body-text' }, body),
      h('div', { class: 'hint-row' }, [h('span', { class: 'goto-hint' }, '点击前往会话')]),
      dump,
    ])
  },
}
