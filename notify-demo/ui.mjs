/** notify-demo toast card — 渲染「发送通知」发布出来的事件。
 * 合同：props.event (BusEvent)、props.isHovered?；emits close / action(actionId)。
 */
const { h } = globalThis.__CATRACE_VUE__ || {}
if (typeof h !== 'function') {
  throw new Error('Catrace plugin Vue runtime missing (__CATRACE_VUE__.h)')
}

const STYLE_ID = 'catrace-plugin-notify-demo-css'
const CSS = `
.notify-card {
  display: flex; flex-direction: column; gap: 0.5rem;
  width: 100%; min-height: 0;
  --accent: #4f46e5; --title: #1e1b4b; --body: #4b5563;
  font-family: system-ui, -apple-system, Segoe UI, sans-serif;
}
.notify-card .hdr { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.notify-card .left { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
.notify-card .badge {
  flex-shrink: 0; padding: 0.1875rem 0.4375rem; border-radius: 999px;
  background: #eef2ff; color: var(--accent);
  font-size: 0.6875rem; font-weight: 700; letter-spacing: 0.03rem;
}
.notify-card .title {
  margin: 0; font-size: 0.9375rem; font-weight: 600; color: var(--title);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.notify-card .x {
  flex-shrink: 0; width: 1.5rem; height: 1.5rem; border: none; background: transparent;
  border-radius: 0.25rem; color: #94a3b8; font-size: 1.125rem; line-height: 1; cursor: pointer;
}
.notify-card .x:hover { background: #eef2ff; color: var(--accent); }
.notify-card .body {
  margin: 0; font-size: 0.8125rem; line-height: 1.5; color: var(--body);
  white-space: pre-wrap; word-break: break-word;
}
.notify-card .meta { font-size: 0.6875rem; color: #9ca3af; }
`

function ensureStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = CSS
  document.head.appendChild(el)
}

function bellIcon() {
  return h(
    'svg',
    {
      class: 'badge',
      width: 16,
      height: 16,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 2,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    },
    [
      h('path', { d: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9' }),
      h('path', { d: 'M13.73 21a2 2 0 0 1-3.46 0' }),
    ],
  )
}

export default {
  name: 'NotifyDemoCard',
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
    const payload = event.payload || {}
    return h('div', { class: 'notify-card' }, [
      h('div', { class: 'hdr' }, [
        h('div', { class: 'left' }, [
          bellIcon(),
          h('h2', { class: 'title' }, event.title || '间隔通知'),
        ]),
        h('button', {
          class: 'x',
          type: 'button',
          'aria-label': 'Close',
          onClick: () => this.$emit('close'),
        }, '×'),
      ]),
      h('p', { class: 'body' }, event.body || ''),
      payload.count != null
        ? h('div', { class: 'meta' }, `第 ${payload.count} 条通知`)
        : null,
    ])
  },
}