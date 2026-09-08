/** Agent notify toast — state list or permission. */
const { h } = globalThis.__CATRACE_VUE__ || {}
if (typeof h !== 'function') throw new Error('Catrace plugin Vue runtime missing')

const STYLE_ID = 'catrace-plugin-agent-notify-css'
const CSS = `
.an-card { display:flex; flex-direction:column; gap:0.5rem; width:100%; font-family:system-ui,sans-serif; }
.an-card .hdr { display:flex; justify-content:space-between; align-items:center; gap:0.5rem; }
.an-card .title { margin:0; font-size:0.9375rem; font-weight:700; color:#0f172a; }
.an-card .x { border:none; background:transparent; cursor:pointer; color:#94a3b8; font-size:1.125rem; }
.an-card .row { display:flex; justify-content:space-between; gap:0.5rem; padding:0.5rem 0.6rem; border-radius:0.5rem; background:#f8fafc; }
.an-card .meta { font-size:0.75rem; color:#64748b; }
.an-card .body { margin:0; font-size:0.8125rem; color:#334155; }
.an-card .acts { display:flex; gap:0.375rem; }
.an-card .btn { border:none; border-radius:0.375rem; padding:0.4rem 0.7rem; font-size:0.75rem; font-weight:600; cursor:pointer; }
.an-card .btn.ok { background:#059669; color:#fff; }
.an-card .btn.no { background:#fee2e2; color:#991b1b; }
.an-card .btn.ghost { background:#eef2ff; color:#3730a3; }
`

function ensureStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = CSS
  document.head.appendChild(el)
}

function projectName(cwd) {
  if (!cwd) return ''
  const parts = String(cwd).replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || ''
}

export default {
  name: 'AgentNotifyCard',
  props: { event: { type: Object, required: true }, isHovered: { type: Boolean, default: false } },
  emits: ['close', 'action'],
  created() {
    ensureStyles()
  },
  render() {
    const event = this.event || {}
    const p = event.payload || {}
    const isPerm = event.event_type === 'agent-notify.permission' || p.requestId != null
    if (isPerm) {
      return h('div', { class: 'an-card' }, [
        h('div', { class: 'hdr' }, [
          h('h2', { class: 'title' }, '权限审批'),
          h('button', { class: 'x', type: 'button', onClick: () => this.$emit('close') }, '×'),
        ]),
        h('p', { class: 'body' }, p.toolName || event.body || ''),
        p.cwd ? h('p', { class: 'meta' }, projectName(p.cwd)) : null,
        h('div', { class: 'acts' }, [
          h('button', { class: 'btn ok', type: 'button', onClick: () => this.$emit('action', `allow:${p.requestId}`) }, '允许'),
          h('button', { class: 'btn no', type: 'button', onClick: () => this.$emit('action', `deny:${p.requestId}`) }, '拒绝'),
        ]),
      ])
    }
    const entries = Array.isArray(p.entries) ? p.entries : []
    return h('div', { class: 'an-card' }, [
      h('div', { class: 'hdr' }, [
        h('h2', { class: 'title' }, event.title || 'Agent 通知'),
        h('button', { class: 'x', type: 'button', onClick: () => this.$emit('action', 'dismiss') }, '×'),
      ]),
      ...entries.map((e, i) =>
        h('div', { class: 'row', key: e.sessionId || i }, [
          h('div', [
            h('div', { class: 'meta' }, [projectName(e.cwd) || '会话', ' · ', e.event].join('')),
            h('p', { class: 'body' }, e.summary || e.sessionTitle || ''),
          ]),
        ]),
      ),
      h('div', { class: 'acts' }, [
        h('button', { class: 'btn ghost', type: 'button', onClick: () => this.$emit('action', 'dismiss') }, '知道了'),
      ]),
    ])
  },
}
