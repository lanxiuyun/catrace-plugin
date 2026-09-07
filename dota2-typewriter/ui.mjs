/** Dota2 typewriter toast — stacked start/pause + end; idle purple / running green. */
const { h } = globalThis.__CATRACE_VUE__ || {}
if (typeof h !== 'function') {
  throw new Error('Catrace plugin Vue runtime missing (__CATRACE_VUE__.h)')
}

const STYLE_ID = 'catrace-plugin-dota2-typewriter-css'
const CSS = `
.d2tw {
  display: flex; flex-direction: column; width: 100%; min-height: 0; gap: 0.625rem;
  --accent: #8b5cf6; --title: #4c1d95; --body: #6d28d9; --bg: #f5f3ff;
  font-family: system-ui, -apple-system, Segoe UI, sans-serif;
}
.d2tw.is-run {
  --accent: #10b981; --title: #065f46; --body: #047857; --bg: #ecfdf5;
}
.d2tw .hdr { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.d2tw .left { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
.d2tw .dot {
  flex-shrink: 0; width: 0.625rem; height: 0.625rem; border-radius: 999px;
  background: var(--accent);
}
.d2tw .title {
  margin: 0; font-size: 0.9375rem; font-weight: 600; color: var(--title);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.d2tw .x {
  flex-shrink: 0; width: 1.5rem; height: 1.5rem; border: none; background: transparent;
  border-radius: 0.25rem; color: #94a3b8; font-size: 1.125rem; line-height: 1; cursor: pointer;
}
.d2tw .x:hover { background: var(--bg); color: var(--accent); }
.d2tw .body { margin: 0; font-size: 0.8125rem; line-height: 1.45; color: var(--body); }
.d2tw .acts { display: flex; flex-direction: column; gap: 0.375rem; }
.d2tw .btn {
  width: 100%; border: none; border-radius: 0.5rem; padding: 0.5rem 0.625rem;
  font-size: 0.8125rem; font-weight: 700; cursor: pointer;
}
.d2tw .btn.primary { background: var(--accent); color: #fff; }
.d2tw .btn.ghost { background: var(--bg); color: var(--title); }
.d2tw .btn:hover { filter: brightness(0.97); }
`

function ensureStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = CSS
  document.head.appendChild(el)
}

export default {
  name: 'Dota2TypewriterCard',
  props: {
    event: { type: Object, required: true },
    isHovered: { type: Boolean, default: false },
  },
  emits: ['close', 'action'],
  created() {
    ensureStyles()
  },
  render() {
    const event = this.event || {}
    const running = !!(event.payload && event.payload.running)
    return h('div', { class: ['d2tw', running ? 'is-run' : ''] }, [
      h('div', { class: 'hdr' }, [
        h('div', { class: 'left' }, [
          h('span', { class: 'dot' }),
          h('h2', { class: 'title' }, event.title || '暗黑狂欢打字机'),
        ]),
        h(
          'button',
          { class: 'x', type: 'button', 'aria-label': 'Close', onClick: () => this.$emit('close') },
          '×',
        ),
      ]),
      event.body ? h('p', { class: 'body' }, event.body) : null,
      h('div', { class: 'acts' }, [
        h(
          'button',
          {
            type: 'button',
            class: 'btn primary',
            onClick: () => this.$emit('action', running ? 'pause' : 'start'),
          },
          running ? '暂停' : '开始',
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'btn ghost',
            onClick: () => this.$emit('action', 'end'),
          },
          '结束',
        ),
      ]),
    ])
  },
}
