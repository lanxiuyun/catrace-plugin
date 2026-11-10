const { createElement: h, useState, useEffect, useRef } = globalThis.__CATRACE_REACT__ || {}
if (typeof h !== 'function' || typeof useState !== 'function') throw new Error('Catrace React runtime missing (__CATRACE_REACT__)')

const STYLE_ID = 'catrace-plugin-wecom-todo-css'
const CSS = `
.wc-todo {
  display: flex; flex-direction: column; width: 100%; min-height: 0;
  --accent: #2563eb; --title: #1e3a8a; --body: #1e40af; --bg: #eff6ff;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}
.wc-todo .hdr { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.wc-todo .left { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
.wc-todo .badge {
  flex-shrink: 0; padding: 0.1875rem 0.4375rem; border-radius: 999px;
  background: #dbeafe; color: #1d4ed8;
  font-size: 0.6875rem; font-weight: 700;
}
.wc-todo .title {
  margin: 0; font-size: 0.875rem; font-weight: 650; color: var(--title);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.wc-todo .x {
  flex-shrink: 0; width: 1.5rem; height: 1.5rem; border: none; background: transparent;
  border-radius: 0.25rem; color: #94a3b8; font-size: 1.125rem; line-height: 1; cursor: pointer;
}
.wc-todo .x:hover { background: var(--bg); color: var(--accent); }
.wc-todo .bar {
  height: 0.125rem; border-radius: 999px;
  background: linear-gradient(90deg, #2563eb, #dbeafe);
  transform-origin: left center;
  animation: wc-todo-shrink var(--toast-auto-hide-ms, 12000ms) linear forwards;
  margin: 0.35rem 0 0.5rem;
}
.wc-todo .bar.paused { animation-play-state: paused; }
@keyframes wc-todo-shrink { from { transform: scaleX(1); } to { transform: scaleX(0); } }
.wc-todo .plain {
  margin: 0; font-size: 0.8125rem; line-height: 1.5; color: var(--body);
  white-space: pre-wrap; word-break: break-word;
}
.wc-todo .meta { margin: 0.35rem 0 0; font-size: 0.6875rem; color: #3b82f6; }
.wc-todo .acts { display: flex; flex-wrap: wrap; gap: 0.375rem; margin-top: 0.625rem; }
.wc-todo .btn {
  border: none; border-radius: 0.375rem; padding: 0.375rem 0.625rem;
  font-size: 0.75rem; font-weight: 600; cursor: pointer;
}
.wc-todo .btn.ghost { background: var(--bg); color: var(--title); }
.wc-todo .btn.primary { background: var(--accent); color: #fff; }
.wc-todo .btn:hover { filter: brightness(0.97); }
`

function ensureStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = plugin.theme.css(CSS)
  document.head.appendChild(el)
}

export default function WecomTodoCard({ event = {}, isHovered = false, onClose, onAction }) {
  useEffect(ensureStyles, [])
  const payload = event.payload || {}, actions = event.actions || []
  return h('div', { className: 'wc-todo' },
    h('div', { className: 'hdr' }, h('div', { className: 'left' }, h('span', { className: 'badge' }, '待办'), h('h2', { className: 'title' }, event.title || '企业微信待办')), h('button', { className: 'x', type: 'button', 'aria-label': 'Close', onClick: () => onClose?.() }, '×')),
    !event.sticky ? h('div', { className: `bar${isHovered ? ' paused' : ''}` }) : null,
    event.body && event.body !== event.title ? h('p', { className: 'plain' }, event.body) : null,
    payload.create_time ? h('p', { className: 'meta' }, payload.create_time) : null,
    actions.length ? h('div', { className: 'acts' }, actions.map((action, i) => h('button', { key: action.id, type: 'button', className: `btn ${i === 0 ? 'primary' : 'ghost'}`, onClick: () => onAction?.(action.id) }, action.label))) : null)
}
