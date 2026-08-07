/** linuxdo-notify toast card — topic + type + excerpt + open link. */
const { h } = globalThis.__CATRACE_VUE__ || {}
if (typeof h !== 'function') {
  throw new Error('Catrace plugin Vue runtime missing (__CATRACE_VUE__.h)')
}

const STYLE_ID = 'catrace-plugin-linuxdo-notify-css'
const CSS = `
.ld-card {
  display: flex; flex-direction: column; width: 100%; min-height: 0;
  --accent: #ff6a00; --title: #1f2328; --body: #656d76; --bg: #fff7f0;
  --link: #e85d04;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}
.ld-card .hdr { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.ld-card .left { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
.ld-card .badge {
  flex-shrink: 0; padding: 0.1875rem 0.4375rem; border-radius: 999px;
  background: #fff0e6; color: var(--link);
  font-size: 0.6875rem; font-weight: 700; letter-spacing: 0.02rem;
}
.ld-card .title {
  margin: 0; font-size: 0.875rem; font-weight: 650; color: var(--title);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ld-card .x {
  flex-shrink: 0; width: 1.5rem; height: 1.5rem; border: none; background: transparent;
  border-radius: 0.25rem; color: #94a3b8; font-size: 1.125rem; line-height: 1; cursor: pointer;
}
.ld-card .x:hover { background: var(--bg); color: var(--accent); }
.ld-card .bar {
  height: 0.125rem; border-radius: 999px;
  background: linear-gradient(90deg, #ff6a00, #ffe0c2);
  transform-origin: left center;
  animation: ld-card-shrink var(--toast-auto-hide-ms, 10000ms) linear forwards;
  margin: 0.35rem 0 0.5rem;
}
.ld-card .bar.paused { animation-play-state: paused; }
@keyframes ld-card-shrink { from { transform: scaleX(1); } to { transform: scaleX(0); } }
.ld-card .body {
  margin: 0; font-size: 0.8125rem; line-height: 1.45; color: var(--body);
  white-space: pre-wrap; word-break: break-word;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 5;
  overflow: hidden;
}
.ld-card .subj {
  margin: 0 0 0.25rem; font-size: 0.8125rem; font-weight: 600; color: var(--title);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ld-card .snippet {
  margin: 0; font-size: 0.75rem; line-height: 1.45; color: var(--body);
  white-space: pre-wrap; word-break: break-word;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4;
  overflow: hidden;
}
.ld-card .meta {
  display: flex; flex-wrap: wrap; gap: 0.375rem 0.625rem;
  margin-top: 0.375rem; font-size: 0.6875rem; color: #8b949e;
}
.ld-card .acts { display: flex; flex-wrap: wrap; gap: 0.375rem; margin-top: 0.625rem; }
.ld-card .btn {
  border: none; border-radius: 0.375rem; padding: 0.375rem 0.625rem;
  font-size: 0.75rem; font-weight: 600; cursor: pointer;
}
.ld-card .btn.ghost { background: var(--bg); color: var(--title); }
.ld-card .btn.primary { background: #ff6a00; color: #fff; }
.ld-card .btn:hover { filter: brightness(0.97); }
`

function ensureStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = CSS
  document.head.appendChild(el)
}

function formatTime(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleString()
  } catch {
    return ''
  }
}

export default {
  name: 'LinuxdoNotifyCard',
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
    const typeLabel = payload.type_label || payload.notification_type || ''
    const when = formatTime(payload.created_at || payload.updated_at)
    const who = payload.acting_username || payload.username || ''

    const children = [
      h('div', { class: 'hdr' }, [
        h('div', { class: 'left' }, [
          h('span', { class: 'badge' }, 'LDO'),
          h('h2', { class: 'title' }, event.title || 'LINUX DO'),
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

    const topicTitle = payload.topic_title || ''
    const snippet = payload.excerpt || ''
    if (topicTitle || snippet || event.body) {
      if (snippet || topicTitle) {
        children.push(
          h('div', { class: 'body' }, [
            topicTitle ? h('p', { class: 'subj' }, topicTitle) : null,
            snippet
              ? h('p', { class: 'snippet' }, who ? `${who}: ${snippet}` : snippet)
              : event.body && !topicTitle
                ? h('p', { class: 'snippet' }, event.body)
                : null,
          ]),
        )
      } else {
        children.push(h('p', { class: 'body' }, event.body || ''))
      }
    }

    if (typeLabel || when || who) {
      children.push(
        h('div', { class: 'meta' }, [
          typeLabel ? h('span', typeLabel) : null,
          who && !snippet ? h('span', `@${who}`) : null,
          when ? h('span', when) : null,
        ]),
      )
    }

    if (actions.length) {
      children.push(
        h(
          'div',
          { class: 'acts' },
          actions.map((a, i) =>
            h(
              'button',
              {
                key: a.id,
                type: 'button',
                class: ['btn', a.id === 'open' || i === 0 ? 'primary' : 'ghost'],
                onClick: () => this.$emit('action', a.id),
              },
              a.label,
            ),
          ),
        ),
      )
    }

    return h('div', { class: 'ld-card' }, children)
  },
}
