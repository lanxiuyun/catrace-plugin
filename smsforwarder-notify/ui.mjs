/** smsforwarder-notify toast card — app + title + body + OTP copy. */
const { h } = globalThis.__CATRACE_VUE__ || {}
if (typeof h !== 'function') {
  throw new Error('Catrace plugin Vue runtime missing (__CATRACE_VUE__.h)')
}

const STYLE_ID = 'catrace-plugin-smsforwarder-notify-css'
const CSS = `
.sf-card {
  display: flex; flex-direction: column; width: 100%; min-height: 0;
  --accent: #0f766e; --title: #134e4a; --body: #5b6b6a; --bg: #f0fdfa;
  --link: #0d9488;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}
.sf-card .hdr { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.sf-card .left { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
.sf-card .badge {
  flex-shrink: 0; padding: 0.1875rem 0.4375rem; border-radius: 999px;
  background: #ccfbf1; color: var(--link);
  font-size: 0.6875rem; font-weight: 700; letter-spacing: 0.02rem;
}
.sf-card .title {
  margin: 0; font-size: 0.875rem; font-weight: 650; color: var(--title);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.sf-card .x {
  flex-shrink: 0; width: 1.5rem; height: 1.5rem; border: none; background: transparent;
  border-radius: 0.25rem; color: #94a3b8; font-size: 1.125rem; line-height: 1; cursor: pointer;
}
.sf-card .x:hover { background: var(--bg); color: var(--accent); }
.sf-card .bar {
  height: 0.125rem; border-radius: 999px;
  background: linear-gradient(90deg, #0d9488, #99f6e4);
  transform-origin: left center;
  animation: sf-card-shrink var(--toast-auto-hide-ms, 10000ms) linear forwards;
  margin: 0.35rem 0 0.5rem;
}
.sf-card .bar.paused { animation-play-state: paused; }
@keyframes sf-card-shrink { from { transform: scaleX(1); } to { transform: scaleX(0); } }
.sf-card .body {
  margin: 0; font-size: 0.8125rem; line-height: 1.45; color: var(--body);
  white-space: pre-wrap; word-break: break-word;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 6;
  overflow: hidden;
}
.sf-card .otp {
  margin-top: 0.375rem; padding: 0.375rem 0.5rem; border-radius: 0.375rem;
  background: #ccfbf1; color: #115e59;
  font-size: 0.875rem; font-weight: 700; letter-spacing: 0.08em;
  font-variant-numeric: tabular-nums;
}
.sf-card .meta {
  display: flex; flex-wrap: wrap; gap: 0.375rem 0.625rem;
  margin-top: 0.375rem; font-size: 0.6875rem; color: #8b949e;
}
.sf-card .acts { display: flex; flex-wrap: wrap; gap: 0.375rem; margin-top: 0.625rem; }
.sf-card .btn {
  border: none; border-radius: 0.375rem; padding: 0.375rem 0.625rem;
  font-size: 0.75rem; font-weight: 600; cursor: pointer;
}
.sf-card .btn.ghost { background: var(--bg); color: var(--title); }
.sf-card .btn.primary { background: #0d9488; color: #fff; }
.sf-card .btn:hover { filter: brightness(0.97); }
`

function ensureStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = CSS
  document.head.appendChild(el)
}

function formatTime(raw) {
  if (!raw) return ''
  try {
    const d = new Date(raw)
    if (!Number.isNaN(d.getTime())) return d.toLocaleString()
  } catch {
    /* fallthrough */
  }
  return String(raw)
}

export default {
  name: 'SmsforwarderNotifyCard',
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
    const actions = event.actions || []
    const when = formatTime(payload.receivedAt)
    const otp = payload.otp || ''
    const pkg = payload.packageName || ''

    const children = [
      h('div', { class: 'hdr' }, [
        h('div', { class: 'left' }, [
          h('span', { class: 'badge' }, 'SMS'),
          h('h2', { class: 'title' }, event.title || payload.appName || '通知'),
        ]),
        h(
          'button',
          {
            class: 'x',
            type: 'button',
            'aria-label': 'Close',
            onClick: () => this.$emit('close'),
          },
          '×',
        ),
      ]),
    ]

    if (!event.sticky) {
      children.push(
        h('div', {
          class: ['bar', this.isHovered ? 'paused' : ''],
        }),
      )
    }

    if (event.body) {
      children.push(h('p', { class: 'body' }, event.body))
    }

    if (otp) {
      children.push(h('div', { class: 'otp' }, otp))
    }

    if (when || pkg || payload.device) {
      children.push(
        h('div', { class: 'meta' }, [
          when ? h('span', when) : null,
          payload.device ? h('span', payload.device) : null,
          pkg ? h('span', pkg) : null,
        ]),
      )
    }

    if (actions.length) {
      children.push(
        h(
          'div',
          { class: 'acts' },
          actions.map((a) =>
            h(
              'button',
              {
                key: a.id,
                type: 'button',
                class: ['btn', a.id === 'copy-otp' ? 'primary' : 'ghost'],
                onClick: () => this.$emit('action', a.id),
              },
              a.label,
            ),
          ),
        ),
      )
    }

    return h('div', { class: 'sf-card' }, children)
  },
}
