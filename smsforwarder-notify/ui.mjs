/** SmsForwarder Toast and conversation card, rendered directly by React. */
const React = globalThis.__CATRACE_REACT__
if (!React?.createElement || !React.useState) throw new Error('Catrace React runtime missing')
const { createElement: h, useState, useRef, useEffect, useLayoutEffect } = React

const STYLE_ID = 'catrace-plugin-smsforwarder-notify-css-react-20261109'
const THREAD_ROW_EST = 56
const THREAD_OVERSCAN = 6
const HISTORY_PAGE_SIZE = 40
/** Group chat stamps into 2-minute buckets counting back from now. */
const TIME_SEGMENT_MS = 2 * 60 * 1000
const THREAD_COMPACT_MAX = 256
const THREAD_EXPANDED_DEFAULT = 384
const THREAD_HEIGHT_KEY = 'chatThreadHeight'
const CSS = `
.sf-card {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: 0;
  box-sizing: border-box;
  font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  color: #1f2937;
  gap: 0;
}
.sf-card * { box-sizing: border-box; }
.sf-card .row-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
}
.sf-card .who {
  display: flex;
  align-items: flex-start;
  gap: 0.625rem;
  min-width: 0;
  flex: 1;
}
.sf-card .avatar {
  flex-shrink: 0;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8125rem;
  font-weight: 700;
  color: #fff;
  line-height: 1;
  user-select: none;
  overflow: hidden;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.18);
}
.sf-card .avatar.is-qq {
  background: linear-gradient(160deg, #4fc3f7 0%, #12b7f5 45%, #0b9bd8 100%);
  font-size: 0.875rem;
  letter-spacing: -0.02em;
}
.sf-card .meta-col {
  min-width: 0;
  flex: 1;
  padding-top: 0.0625rem;
}
.sf-card .name-line {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  min-width: 0;
}
.sf-card .sender {
  margin: 0;
  flex: 1;
  min-width: 0;
  font-size: 0.9375rem;
  font-weight: 700;
  color: #111827;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sf-card .tag {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  height: 1.25rem;
  padding: 0 0.5rem;
  border-radius: 999px;
  background: #d1fae5;
  color: #10b981;
  font-size: 0.6875rem;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.01em;
}
/* Default: clock + lag badge. Hover badge: chain tip. */
.sf-card .time-row {
  position: relative;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.3125rem;
  margin: 0.125rem 0 0;
  min-height: 0.75rem;
}
.sf-card .clock {
  margin: 0;
  font-size: 0.75rem;
  color: #9ca3af;
  line-height: 1;
  height: 0.75rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.sf-card .lag-badge {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.1875rem;
  height: 1.0625rem;
  box-sizing: border-box;
  padding: 0 0.4375rem;
  border-radius: 999px;
  background: #fef3c7;
  color: #b45309;
  font-size: 0.6875rem;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  cursor: default;
  border: 1px solid #fde68a;
}
.sf-card .lag-badge .lag-ico {
  width: 0.6875rem;
  height: 0.6875rem;
  flex-shrink: 0;
}
.sf-card .lag-badge .lag-chev {
  width: 0.5625rem;
  height: 0.5625rem;
  opacity: 0.7;
  flex-shrink: 0;
}
.sf-card .lag-pop {
  display: none;
  position: absolute;
  left: 50%;
  top: calc(100% + 0.25rem);
  transform: translateX(-50%);
  z-index: 20;
  max-width: min(18rem, 90vw);
  padding: 0.375rem 0.5rem;
  border-radius: 0.5rem;
  background: #1f2937;
  color: #f9fafb;
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow:
    0 0 0 1px rgba(15, 23, 42, 0.2),
    0 8px 24px rgba(15, 23, 42, 0.45),
    0 2px 6px rgba(15, 23, 42, 0.3);
  pointer-events: none;
  flex-wrap: nowrap;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.6875rem;
  line-height: 1.25;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.sf-card .lag-badge:hover .lag-pop {
  display: inline-flex;
}
.sf-card .lag-pop .t {
  color: #fff;
  font-weight: 700;
  white-space: nowrap;
}
.sf-card .lag-pop .lab {
  color: #e5e7eb;
  font-weight: 600;
  white-space: nowrap;
}
.sf-card .lag-pop .arr {
  color: #9ca3af;
  font-size: 0.625rem;
  flex-shrink: 0;
}
.sf-card .lag-pop .pill {
  display: inline-flex;
  align-items: center;
  height: 1rem;
  padding: 0 0.375rem;
  border-radius: 999px;
  font-size: 0.625rem;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
}
.sf-card .lag-pop .pill.is-slow {
  background: rgba(251, 146, 60, 0.35);
  color: #fed7aa;
  border: 1px solid rgba(251, 146, 60, 0.5);
}
.sf-card .lag-pop .pill.is-ok {
  background: rgba(16, 185, 129, 0.35);
  color: #a7f3d0;
  border: 1px solid rgba(16, 185, 129, 0.5);
}
.sf-card .ops {
  display: flex;
  align-items: center;
  gap: 0.125rem;
  flex-shrink: 0;
  margin-top: -0.0625rem;
  margin-right: -0.25rem;
}
.sf-card .op {
  width: 1.75rem;
  height: 1.75rem;
  border: none;
  background: transparent;
  border-radius: 0.375rem;
  color: #9ca3af;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
.sf-card .op:hover {
  background: #f3f4f6;
  color: #6b7280;
}
.sf-card .op-close {
  color: #fca5a5;
}
.sf-card .op-close:hover {
  background: #fef2f2;
  color: #ef4444;
}
.sf-card .op svg {
  width: 1rem;
  height: 1rem;
  display: block;
}
.sf-card .bar {
  height: 0.125rem;
  border-radius: 999px;
  background: linear-gradient(90deg, #34d399, #a7f3d0);
  transform-origin: left center;
  animation: sf-card-shrink var(--toast-auto-hide-ms, 10000ms) linear forwards;
  margin: 0.5rem 0 0;
}
.sf-card .bar.paused { animation-play-state: paused; }
@keyframes sf-card-shrink { from { transform: scaleX(1); } to { transform: scaleX(0); } }
.sf-card .msg {
  margin: 0.5rem 0 0;
  font-size: 0.875rem;
  line-height: 1.55;
  color: #4b5563;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 10.5rem;
  overflow-y: auto;
  user-select: text !important;
  -webkit-user-select: text !important;
  cursor: text;
}
.sf-card .thread-shell {
  position: relative;
  margin: 0.25rem 0 0;
}
.sf-card .thread-resize {
  height: 0.5rem;
  margin: -0.25rem 0 0.25rem;
  cursor: ns-resize;
  display: flex;
  align-items: center;
  justify-content: center;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  flex-shrink: 0;
}
.sf-card .thread-resize::after {
  content: '';
  width: 2.25rem;
  height: 0.1875rem;
  border-radius: 999px;
  background: #d1d5db;
}
.sf-card .thread-resize:hover::after,
.sf-card .thread-resize.is-active::after {
  background: #10b981;
}
.sf-card .thread {
  margin: 0;
  max-height: 16rem;
  overflow-y: auto;
  padding: 0 0.25rem 0.125rem 0;
  scrollbar-width: thin;
  scrollbar-color: #cbd5e1 transparent;
}
.sf-card .jump-new {
  position: absolute;
  right: 0.5rem;
  bottom: 0.5rem;
  z-index: 3;
  border: none;
  cursor: pointer;
  font-family: inherit;
  font-size: 0.6875rem;
  font-weight: 700;
  line-height: 1;
  color: #fff;
  background: #10b981;
  box-shadow: 0 0.25rem 0.75rem rgba(16, 185, 129, 0.35);
  border-radius: 999px;
  padding: 0.375rem 0.625rem;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
}
.sf-card .jump-new.is-arrow {
  width: 1.75rem;
  height: 1.75rem;
  padding: 0;
  color: #0f766e;
  background: #fff;
  border: 1px solid #99f6e4;
  box-shadow: 0 0.25rem 0.75rem rgba(15, 118, 110, 0.16);
}
.sf-card .jump-new.is-arrow:hover { background: #f0fdfa; }
.sf-card .jump-new:hover { background: #059669; }
.sf-card .jump-new svg { width: 0.875rem; height: 0.875rem; display: block; }
.sf-card .thread-inner {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}
.sf-card .thread-up {
  display: flex;
  align-items: center;
  justify-content: center;
  align-self: center;
  width: 1rem;
  height: 0.75rem;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: #3b82f6;
  cursor: pointer;
  line-height: 1;
  font-family: inherit;
  font-size: 0.875rem;
  font-weight: 700;
  transform: rotate(-90deg);
  user-select: none;
  -webkit-user-select: none;
  animation: sf-thread-up-breathe 2.8s ease-in-out infinite;
}
.sf-card .thread-up:hover {
  color: #2563eb;
  animation-duration: 1.1s;
}
@keyframes sf-thread-up-breathe {
  0%, 100% {
    opacity: 0.55;
    transform: rotate(-90deg) translateX(0) scale(1);
  }
  50% {
    opacity: 1;
    transform: rotate(-90deg) translateX(0.125rem) scale(1.12);
  }
}
@media (prefers-reduced-motion: reduce) {
  .sf-card .thread-up { animation: none; opacity: 1; }
}
.sf-card .time-divider {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0;
  margin: 0;
  user-select: none;
  -webkit-user-select: none;
}
.sf-card .time-divider span {
  font-size: 0.6875rem;
  color: #9ca3af;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}
.sf-card .thread::-webkit-scrollbar { width: 0.375rem; }
.sf-card .thread::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 999px;
}
.sf-card .bubble-row {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.125rem;
  max-width: 100%;
  min-width: 0;
}
.sf-card .bubble-wrap {
  display: flex;
  align-items: flex-start;
  gap: 0.25rem;
  max-width: 100%;
  min-width: 0;
}
.sf-card .bubble-copy {
  flex-shrink: 0;
  opacity: 0;
  border: none;
  background: #fff;
  padding: 0;
  margin: 0.0625rem 0 0;
  width: 2rem;
  height: 2rem;
  color: #10b981;
  cursor: pointer;
  border-radius: 0.5rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  border: 1px solid #d1fae5;
}
.sf-card .bubble-row:hover .bubble-copy,
.sf-card .bubble-copy:focus-visible {
  opacity: 1;
}
.sf-card .bubble-copy:hover { background: #ecfdf5; color: #059669; border-color: #a7f3d0; }
.sf-card .bubble-copy.is-ok { opacity: 1; color: #047857; background: #ecfdf5; }
.sf-card .bubble-copy svg { width: 1.125rem; height: 1.125rem; display: block; }
.sf-card .bubble-name {
  font-size: 0.6875rem;
  color: #9ca3af;
  font-weight: 600;
  line-height: 1.2;
  padding: 0 0.125rem;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sf-card .bubble {
  max-width: 100%;
  padding: 0.375rem 0.625rem;
  border-radius: 0.25rem 0.75rem 0.75rem 0.75rem;
  background: #f3f4f6;
  color: #1f2937;
  font-size: 0.8125rem;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text !important;
  -webkit-user-select: text !important;
  cursor: text;
}
.sf-card .bubble.is-otp {
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
}
.sf-card .otp-chip {
  margin-top: 0.5rem;
  align-self: flex-start;
  padding: 0.3125rem 0.625rem;
  border-radius: 0.5rem;
  background: #ecfdf5;
  color: #047857;
  border: 1px solid #a7f3d0;
  font-size: 0.9375rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  font-variant-numeric: tabular-nums;
  user-select: text !important;
  -webkit-user-select: text !important;
  cursor: text;
}
.sf-card .copy-btn {
  flex: 0 0 auto;
  align-self: flex-end;
  border: none;
  background: transparent;
  padding: 0.25rem 0.375rem;
  margin: 0;
  font-size: 0.8125rem;
  font-weight: 600;
  color: #10b981;
  cursor: pointer;
  font-family: inherit;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  white-space: nowrap;
}
.sf-card .copy-btn:hover { color: #059669; }
.sf-card .copy-btn svg { width: 0.9375rem; height: 0.9375rem; flex-shrink: 0; }
.sf-card .foot-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.25rem;
  min-width: 0;
  flex: 1 1 auto;
}
.sf-card .foot-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.75rem;
  min-width: 0;
  flex-wrap: nowrap;
}
.sf-card .block-btn {
  border: none;
  background: transparent;
  padding: 0;
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  color: #f87171;
  cursor: pointer;
  font-family: inherit;
  line-height: 1.2;
  display: inline-flex;
  align-items: center;
  gap: 0.1875rem;
  white-space: nowrap;
}
.sf-card .block-btn:hover { color: #ef4444; }
.sf-card .block-btn.is-armed {
  color: #fff;
  background: #ef4444;
  border-radius: 0.375rem;
  padding: 0.1875rem 0.5rem;
}
.sf-card .block-btn.is-armed:hover { color: #fff; }
.sf-card .block-btn svg { width: 0.8125rem; height: 0.8125rem; flex-shrink: 0; }
.sf-card .row-foot {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 0.75rem;
  margin-top: 0.875rem;
}
.sf-card .dev {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.3125rem;
  min-width: 0;
  max-width: 100%;
  font-size: 0.75rem;
  color: #9ca3af;
}
.sf-card .dev svg {
  width: 0.875rem;
  height: 0.875rem;
  flex-shrink: 0;
}
.sf-card .dev-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sf-card .reply {
  flex-shrink: 0;
  border: none;
  background: transparent;
  padding: 0;
  margin: 0;
  font-size: 0.8125rem;
  font-weight: 600;
  color: #10b981;
  cursor: default;
  line-height: 1.2;
  display: inline-flex;
  align-items: center;
  gap: 0.125rem;
  font-family: inherit;
}
.sf-card .reply.is-active {
  cursor: pointer;
}
.sf-card .reply.is-active:hover {
  color: #059669;
}
.sf-card .reply .arrow {
  font-size: 0.875rem;
  line-height: 1;
  transform: translateY(-0.03125rem);
}
.sf-card .dismiss {
  flex-shrink: 0;
  border: none;
  background: #f3f4f6;
  color: #6b7280;
  border-radius: 0.375rem;
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
}
.sf-card .dismiss:hover { background: #e5e7eb; }
`

function ensureStyles() {
  if (typeof document === 'undefined') return
  document.querySelectorAll('style[id^="catrace-plugin-smsforwarder-notify-css"]').forEach(node => { if (!node.id.includes('settings') && node.id !== STYLE_ID) node.remove() })
  let el = document.getElementById(STYLE_ID)
  if (!el) {
    el = document.createElement('style')
    el.id = STYLE_ID
    document.head.appendChild(el)
  }
  el.textContent = plugin.theme.css(CSS)
}

function formatClock(raw) {
  if (!raw) return ''
  try {
    const d = new Date(raw)
    if (!Number.isNaN(d.getTime())) {
      const hh = String(d.getHours()).padStart(2, '0')
      const mm = String(d.getMinutes()).padStart(2, '0')
      const ss = String(d.getSeconds()).padStart(2, '0')
      return `${hh}:${mm}:${ss}`
    }
  } catch {
    /* fallthrough */
  }
  const s = String(raw)
  const m = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s)
  if (m) {
    return `${m[1].padStart(2, '0')}:${m[2]}:${(m[3] || '00').padStart(2, '0')}`
  }
  return s
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function startOfLocalDay(ms) {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** QQ-style divider: 今天 12:34 / 昨天 12:34 / 周一 12:34 / 3月12日 12:34 / 2025年3月12日 12:34 */
function formatChatStamp(raw, nowMs = Date.now()) {
  const ms = parseTimeMs(raw)
  if (!Number.isFinite(ms)) return ''
  const d = new Date(ms)
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  const today0 = startOfLocalDay(nowMs)
  const that0 = startOfLocalDay(ms)
  const dayDiff = Math.round((today0 - that0) / 86400000)
  if (dayDiff <= 0) return hm
  if (dayDiff === 1) return `昨天 ${hm}`
  if (dayDiff < 7) {
    const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    return `${week[d.getDay()]} ${hm}`
  }
  const md = `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`
  if (d.getFullYear() === new Date(nowMs).getFullYear()) return md
  return `${d.getFullYear()}年${md}`
}

function messageTimeMs(m) {
  if (!m) return NaN
  return parseTimeMs(m.receivedAt)
}

function timeSegmentIndex(ms, nowMs = Date.now()) {
  if (!Number.isFinite(ms)) return NaN
  return Math.floor(Math.max(0, nowMs - ms) / TIME_SEGMENT_MS)
}

function shouldShowTimeDivider(curr, prev, nowMs = Date.now()) {
  if (!curr) return false
  const currMs = messageTimeMs(curr)
  if (!Number.isFinite(currMs)) return !prev
  if (!prev) return true
  const prevMs = messageTimeMs(prev)
  if (!Number.isFinite(prevMs)) return true
  return timeSegmentIndex(currMs, nowMs) !== timeSegmentIndex(prevMs, nowMs)
}

function sortMessagesByTime(list) {
  return [...list].sort((a, b) => {
    const ta = messageTimeMs(a)
    const tb = messageTimeMs(b)
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb
    return 0
  })
}

function insertChronological(messages, msg) {
  if (!msg || !msg.id) return false
  if (messages.some((m) => m && m.id === msg.id)) return false
  const t = messageTimeMs(msg)
  if (!messages.length || !Number.isFinite(t)) {
    messages.push(msg)
    return true
  }
  const lastT = messageTimeMs(messages[messages.length - 1])
  if (!Number.isFinite(lastT) || t >= lastT) {
    messages.push(msg)
    return true
  }
  let i = messages.length - 1
  while (i >= 0) {
    const mt = messageTimeMs(messages[i])
    if (Number.isFinite(mt) && mt <= t) break
    i -= 1
  }
  messages.splice(i + 1, 0, msg)
  return true
}

function parseTimeMs(raw) {
  if (raw == null || raw === '') return NaN
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw < 1e12 ? raw * 1000 : raw
  }
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? NaN : d.getTime()
}

function gapMs(fromMs, toMs) {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return NaN
  return Math.max(0, toMs - fromMs)
}

/** Badge: 23秒 / 1分5秒 / 5分 */
function formatDurationZh(ms) {
  if (!Number.isFinite(ms) || ms < 0) return ''
  const sec = Math.round(ms / 1000)
  if (sec < 1) return ''
  if (sec < 60) return `${sec}秒`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return s === 0 ? `${m}分` : `${m}分${s}秒`
}

/** Pill: 即时 | +23s | +1m5s */
function formatPillLag(ms) {
  if (!Number.isFinite(ms) || ms < 0) return { text: '即时', slow: false }
  const sec = Math.round(ms / 1000)
  if (sec < 2) return { text: '即时', slow: false }
  if (sec < 60) return { text: `+${sec}s`, slow: true }
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m < 60) return { text: s === 0 ? `+${m}m` : `+${m}m${s}s`, slow: true }
  const h = Math.floor(m / 60)
  const rm = m % 60
  return { text: rm === 0 ? `+${h}h` : `+${h}h${rm}m`, slow: true }
}

/**
 * Default: "16:29:05 发送" + badge "延迟 5分"
 * Hover badge: "16:29:05 手机 → +5m 电脑 → 即时 弹出"
 */
function buildTimeMeta(payload) {
  const receivedAt = payload.receivedAt
  const webhookAt = payload.webhookAt
  const publishedAt = payload.publishedAt || payload.shownAt
  const deferred = payload.deferred === true

  const tMsg = parseTimeMs(receivedAt)
  const tWh = parseTimeMs(webhookAt)
  const tPub = parseTimeMs(publishedAt)

  const msgL = formatClock(receivedAt)
  const pubL = formatClock(publishedAt) || formatClock(webhookAt)
  if (!msgL && !pubL) return null

  const pathMs = gapMs(tMsg, Number.isFinite(tWh) ? tWh : tPub)
  const hostMs = Number.isFinite(tWh) && Number.isFinite(tPub) ? gapMs(tWh, tPub) : 0
  const totalMs = gapMs(Number.isFinite(tMsg) ? tMsg : tWh, Number.isFinite(tPub) ? tPub : tWh)

  const pathPill = formatPillLag(pathMs)
  let hostPill = formatPillLag(Number.isFinite(hostMs) ? hostMs : 0)
  if (deferred && !hostPill.slow) hostPill = { text: '补推', slow: true }

  const showLag = deferred || (Number.isFinite(totalMs) && totalMs >= 10000)

  return {
    clock: msgL || pubL || '',
    clockSuffix: '',
    showLag,
    lagLabel: showLag && Number.isFinite(totalMs) ? `延迟 ${formatDurationZh(totalMs)}` : '',
    pathPill,
    hostPill,
  }
}

function IconWarn() {
  return h(
    'svg',
    {
      className: 'lag-ico',
      viewBox: '0 0 24 24',
      fill: 'none',
      xmlns: 'http://www.w3.org/2000/svg',
      'aria-hidden': 'true',
    },
    ...[
      h('path', {
        d: 'M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z',
        stroke: 'currentColor',
        strokeWidth: '1.8',
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
    ],
  )
}

function IconChevron() {
  return h(
    'svg',
    {
      className: 'lag-chev',
      viewBox: '0 0 24 24',
      fill: 'none',
      xmlns: 'http://www.w3.org/2000/svg',
      'aria-hidden': 'true',
    },
    ...[
      h('path', {
        d: 'M6 9l6 6 6-6',
        stroke: 'currentColor',
        strokeWidth: '2',
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
    ],
  )
}

function pillNode(p) {
  if (!p) return null
  return h('span', { className: `pill ${p.slow ? 'is-slow' : 'is-ok'}` }, p.text)
}

function renderTimeRow(meta) {
  if (!meta || !meta.clock) return null
  const kids = [h('p', { className: 'clock' }, `${meta.clock}${meta.clockSuffix || ''}`)]
  if (meta.showLag && meta.lagLabel) {
    kids.push(
      h('span', { className: 'lag-badge' }, ...[
        IconWarn(),
        meta.lagLabel,
        IconChevron(),
        h('div', { className: 'lag-pop', role: 'tooltip' }, ...[
          h('span', { className: 't' }, meta.clock),
          h('span', { className: 'lab' }, '手机'),
          h('span', { className: 'arr' }, '→'),
          pillNode(meta.pathPill),
          h('span', { className: 'lab' }, '电脑'),
          h('span', { className: 'arr' }, '→'),
          pillNode(meta.hostPill),
          h('span', { className: 'lab' }, '弹出'),
        ]),
      ]),
    )
  }
  return h('div', { className: 'time-row' }, ...kids)
}

function hashHue(str) {
  let hval = 0
  const s = String(str || '')
  for (let i = 0; i < s.length; i++) hval = (hval * 31 + s.charCodeAt(i)) >>> 0
  return hval % 360
}

/** Known messenger / app brands for avatar look. */
function resolveBrand(appName, packageName) {
  const s = `${appName || ''} ${packageName || ''}`.toLowerCase()
  if (/tencent\.mobileqq|com\.tencent\.qq|(\b|^)qq(\b|$)/i.test(s) && !/weixin|wechat|tim/i.test(s)) {
    return { key: 'qq', label: 'QQ', className: 'is-qq', style: null }
  }
  if (/weixin|wechat|com\.tencent\.mm/i.test(s)) {
    return {
      key: 'wechat',
      label: '微',
      className: '',
      style: { background: 'linear-gradient(160deg,#3fd168,#07c160)' },
    }
  }
  if (/sms|mms|messaging|telephony|短信|信息|讯息/i.test(s)) {
    return {
      key: 'sms',
      label: '信',
      className: '',
      style: { background: 'linear-gradient(160deg,#60a5fa,#3b82f6)' },
    }
  }
  return null
}

function avatarInitials(appName, packageName) {
  const name = String(appName || '').trim()
  if (name) {
    const ascii = name.match(/[A-Za-z0-9]+/g)
    if (ascii && ascii.join('').length >= 2) return ascii.join('').slice(0, 2).toUpperCase()
    if (ascii && ascii[0]) return ascii[0].slice(0, 2).toUpperCase()
    return name.slice(0, 1)
  }
  const pkg = String(packageName || '')
  const tail = pkg.split('.').filter(Boolean).pop() || 'N'
  return tail.slice(0, 2).toUpperCase()
}

function avatarProps(appName, packageName) {
  const brand = resolveBrand(appName, packageName)
  if (brand) {
    return {
      className: ['avatar', brand.className].filter(Boolean).join(' '),
      style: brand.style || undefined,
      text: brand.label,
    }
  }
  const key = appName || packageName || 'app'
  const hue = hashHue(key)
  return {
    className: 'avatar',
    style: {
      background: `linear-gradient(145deg, hsl(${hue} 58% 54%), hsl(${(hue + 24) % 360} 55% 42%))`,
    },
    text: avatarInitials(appName, packageName),
  }
}

function pickOtpFromText(title, body) {
  const text = `${title || ''}\n${body || ''}`.replace(/[０-９]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30),
  )
  if (!text.trim()) return ''
  const kw =
    /验证码|校验码|动态码|动态密码|短信码|短信验证|登录码|确认码|授权码|安全码|识别码|提取码|兑换码|OTP|verification\s*code|security\s*code/i
  if (!kw.test(text)) return ''
  const nearAfter =
    /(?:验证码|校验码|动态码|动态密码|短信码|登录码|确认码|授权码|安全码|识别码|提取码|兑换码|OTP)[^\d]{0,16}(\d(?:[\s-]?\d){3,7})/i
  const nm = nearAfter.exec(text)
  if (nm) {
    const d = nm[1].replace(/\D/g, '')
    if (d.length >= 4 && d.length <= 8) return d
  }
  const nearBefore =
    /(\d(?:[\s-]?\d){3,7})[^\d]{0,8}(?:验证码|校验码|动态码|动态密码|登录码|OTP)/i
  const nb = nearBefore.exec(text)
  if (nb) {
    const d = nb[1].replace(/\D/g, '')
    if (d.length >= 4 && d.length <= 8) return d
  }
  const cn = /(?:码为|码是|码：|码:)[^\d]{0,8}(\d(?:[\s-]?\d){3,7})/i.exec(text)
  if (cn) {
    const d = cn[1].replace(/\D/g, '')
    if (d.length >= 4 && d.length <= 8) return d
  }
  const all = text.match(/(?<!\d)\d{4,8}(?!\d)/g) || []
  return all.find((x) => x.length === 6) || all[0] || ''
}

function svgIcon(paths, viewBox = '0 0 24 24') {
  return h(
    'svg',
    {
      viewBox,
      fill: 'none',
      xmlns: 'http://www.w3.org/2000/svg',
      'aria-hidden': 'true',
    },
    ...paths,
  )
}

function IconCopy() {
  return svgIcon([
    h('rect', {
      x: '9',
      y: '9',
      width: '10',
      height: '10',
      rx: '1.6',
      stroke: 'currentColor',
      strokeWidth: '1.7',
    }),
    h('path', {
      d: 'M7 15H6.2A1.2 1.2 0 0 1 5 13.8V6.2A1.2 1.2 0 0 1 6.2 5h7.6A1.2 1.2 0 0 1 15 6.2V7',
      stroke: 'currentColor',
      strokeWidth: '1.7',
      strokeLinecap: 'round',
    }),
  ])
}

function IconClose() {
  return svgIcon([
    h('path', {
      d: 'M7 7l10 10M17 7L7 17',
      stroke: 'currentColor',
      strokeWidth: '1.7',
      strokeLinecap: 'round',
    }),
  ])
}

function IconPhone() {
  return svgIcon([
    h('rect', {
      x: '8',
      y: '3',
      width: '8',
      height: '18',
      rx: '1.8',
      stroke: 'currentColor',
      strokeWidth: '1.6',
    }),
    h('path', {
      d: 'M10.5 17.5h3',
      stroke: 'currentColor',
      strokeWidth: '1.6',
      strokeLinecap: 'round',
    }),
  ])
}

function IconChevronDown() {
  return svgIcon([
    h('path', {
      d: 'M6 9l6 6 6-6',
      stroke: 'currentColor',
      strokeWidth: '1.8',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
  ])
}

function IconBan() {
  return svgIcon([
    h('circle', {
      cx: '12',
      cy: '12',
      r: '8.5',
      stroke: 'currentColor',
      strokeWidth: '1.6',
    }),
    h('path', {
      d: 'M5.6 5.6l12.8 12.8',
      stroke: 'currentColor',
      strokeWidth: '1.6',
      strokeLinecap: 'round',
    }),
  ])
}

function clampThreadHeight(px) {
  const value = Number(px)
  return Number.isFinite(value) ? Math.max(THREAD_COMPACT_MAX, Math.round(value)) : THREAD_EXPANDED_DEFAULT
}
function initialThread(payload = {}) {
  const messages = sortMessagesByTime(Array.isArray(payload.messages) ? payload.messages.filter(m => m && (m.text || m.speaker)) : [])
  const total = Number(payload.threadCount) || messages.length
  return { key: String(payload.threadKey || ''), messages, total, hasMore: payload.hasMore === true || messages.length < total, loading: false, expanded: false, maxPx: THREAD_COMPACT_MAX, preferred: THREAD_EXPANDED_DEFAULT, scrollTop: 0, stick: true, unseen: 0, resizing: false }
}
function mergeIncomingThread(previous, payload) {
  const key = String(payload.threadKey || '')
  if (key !== previous.key) return initialThread(payload)
  const incoming = Array.isArray(payload.messages) ? payload.messages.filter(m => m && (m.text || m.speaker)) : []
  const messages = previous.messages.slice()
  let added = 0
  const lastId = messages[messages.length - 1]?.id
  for (const item of incoming) if (insertChronological(messages, item)) added += 1
  const tailChanged = lastId && messages[messages.length - 1]?.id !== lastId
  const total = Number(payload.threadCount) || messages.length
  return { ...previous, messages, total, hasMore: payload.hasMore === true || messages.length < total, unseen: previous.stick ? 0 : tailChanged ? previous.unseen + added : previous.unseen }
}
function threadSlice(thread) {
  const count = Math.ceil(thread.maxPx / THREAD_ROW_EST) + THREAD_OVERSCAN * 2
  const start = thread.stick ? Math.max(0, thread.messages.length - count) : Math.max(0, Math.floor(thread.scrollTop / THREAD_ROW_EST) - THREAD_OVERSCAN)
  const end = thread.stick ? thread.messages.length : Math.min(thread.messages.length, start + count)
  return { start, rows: thread.messages.slice(start, end), padTop: start * THREAD_ROW_EST, padBottom: Math.max(0, (thread.messages.length - end) * THREAD_ROW_EST) }
}

export default function SmsforwarderNotifyCard({ event = {}, isHovered = false, onClose, onAction }) {
  const payload = event.payload || {}
  const [thread, setThread] = useState(() => initialThread(payload))
  const threadState = useRef(thread)
  const eventRef = useRef(event)
  eventRef.current = event
  const threadElement = useRef(null)
  const mounted = useRef(false)
  const needBottom = useRef(true)
  const pendingAnchor = useRef(null)
  const historyRequest = useRef(0)
  const lastLoadAt = useRef(0)
  const heightMap = useRef({})
  const [armed, setArmed] = useState(null)
  const armRef = useRef(null)
  const armTimer = useRef(null)
  const [copiedId, setCopiedId] = useState('')
  const copiedTimer = useRef(null)
  const resize = useRef(null)

  function updateThread(patch) {
    const previous = threadState.current
    const next = typeof patch === 'function' ? patch(previous) : { ...previous, ...patch }
    threadState.current = next
    if (mounted.current) setThread(next)
    return next
  }
  function heightKey() {
    const current = eventRef.current || {}
    const title = String(current.payload?.title || current.title || '').trim()
    return title ? `title:${title.toLowerCase()}` : threadState.current.key ? `thread:${threadState.current.key}` : ''
  }
  function applyPreferredHeight() {
    const key = heightKey()
    const preferred = key && heightMap.current[key] ? clampThreadHeight(heightMap.current[key]) : THREAD_EXPANDED_DEFAULT
    updateThread(previous => ({ ...previous, preferred, maxPx: previous.expanded ? preferred : THREAD_COMPACT_MAX }))
  }
  function expandThread() {
    updateThread(previous => previous.expanded ? previous : { ...previous, expanded: true, maxPx: clampThreadHeight(previous.preferred) })
  }
  function persistThreadHeight() {
    const key = heightKey()
    if (!key || !plugin.storage?.set) return
    const next = { ...heightMap.current, [key]: threadState.current.preferred }
    heightMap.current = next
    void plugin.storage.set(THREAD_HEIGHT_KEY, { v: 2, heights: next }).catch(error => console.warn('[smsforwarder-notify] save thread height failed', error))
  }
  function stopResize(persist = false) {
    const active = resize.current
    if (!active) return
    window.removeEventListener('pointermove', active.move)
    window.removeEventListener('pointerup', active.up)
    window.removeEventListener('pointercancel', active.up)
    resize.current = null
    if (persist) persistThreadHeight()
    updateThread({ resizing: false })
  }
  function startResize(event) {
    if (event.button != null && event.button !== 0) return
    stopResize()
    expandThread()
    const startY = event.clientY
    const startHeight = threadState.current.maxPx
    const active = {
      move: moveEvent => {
        const px = clampThreadHeight(startHeight + startY - moveEvent.clientY)
        updateThread({ expanded: true, maxPx: px, preferred: px, resizing: true })
      },
      up: () => stopResize(true),
    }
    resize.current = active
    updateThread({ resizing: true })
    window.addEventListener('pointermove', active.move)
    window.addEventListener('pointerup', active.up)
    window.addEventListener('pointercancel', active.up)
    event.preventDefault()
    event.stopPropagation()
  }
  async function loadOlder() {
    const current = threadState.current
    if (current.loading || !current.hasMore || !current.key || Date.now() - lastLoadAt.current < 350) return
    lastLoadAt.current = Date.now()
    expandThread()
    const request = ++historyRequest.current
    const key = current.key
    const beforeId = current.messages[0]?.id || ''
    const element = threadElement.current
    const previousHeight = element?.scrollHeight || 0
    const previousTop = element?.scrollTop || 0
    updateThread({ loading: true, stick: false })
    try {
      let older = [], total = current.total, hasMore = false
      if (plugin.sidecar?.request) {
        try {
          const page = await plugin.sidecar.request('loadThreadPage', { threadKey: key, beforeId, limit: HISTORY_PAGE_SIZE })
          if (page && Array.isArray(page.messages)) {
            older = page.messages.filter(message => message && (message.text || message.speaker))
            total = Number(page.total) || total
            hasMore = page.hasMore === true
          }
        } catch (error) { console.warn('[smsforwarder-notify] loadThreadPage failed', error) }
      }
      if (!older.length && plugin.storage?.get) {
        const digest = key.split(':').pop() || ''
        const stored = await plugin.storage.get(`chat_${digest.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)}`)
        const all = sortMessagesByTime(Array.isArray(stored?.messages) ? stored.messages.filter(message => message && (message.text || message.speaker)) : [])
        const index = beforeId ? all.findIndex(message => message.id === beforeId) : all.length
        const end = index < 0 ? all.length : index
        const start = Math.max(0, end - HISTORY_PAGE_SIZE)
        older = all.slice(start, end)
        total = all.length || current.messages.length
        hasMore = start > 0
      }
      if (!mounted.current || request !== historyRequest.current || threadState.current.key !== key) return
      const messages = threadState.current.messages.slice()
      let prepended = 0
      for (const message of older) if (insertChronological(messages, message)) prepended += 1
      if (prepended) pendingAnchor.current = { previousHeight, previousTop }
      updateThread(previous => ({ ...previous, messages, total: Math.max(total || messages.length, messages.length), hasMore, loading: false, scrollTop: prepended ? previousTop + prepended * THREAD_ROW_EST : previous.scrollTop }))
    } catch (error) { console.warn('[smsforwarder-notify] load older failed', error) }
    finally {
      if (mounted.current && request === historyRequest.current && threadState.current.key === key) updateThread({ loading: false })
    }
  }
  function onThreadScroll(event) {
    const element = event.currentTarget
    const stick = element.scrollHeight - element.scrollTop - element.clientHeight < 8
    updateThread(previous => ({ ...previous, scrollTop: element.scrollTop, stick, unseen: stick ? 0 : previous.unseen, expanded: previous.expanded || !stick, maxPx: !stick && !previous.expanded ? clampThreadHeight(previous.preferred) : previous.maxPx }))
    if (element.scrollTop < 48) void loadOlder()
  }
  function onThreadWheel(event) {
    if (event.deltaY >= 0) return
    expandThread()
    if (threadElement.current?.scrollTop <= 8) void loadOlder()
  }
  function jumpToLatest() {
    needBottom.current = true
    updateThread({ stick: true, unseen: 0 })
  }
  async function copyBubble(text, id) {
    const value = String(text || '').trim()
    if (!value) return
    try {
      if (plugin.clipboard?.writeText) await plugin.clipboard.writeText(value)
      else if (globalThis.navigator?.clipboard?.writeText) await navigator.clipboard.writeText(value)
      else throw new Error('clipboard unavailable')
      if (!mounted.current) return
      setCopiedId(id)
      clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => { if (mounted.current) setCopiedId('') }, 1200)
    } catch (error) { console.warn('[smsforwarder-notify] copy bubble failed', error) }
  }
  function handleBlockClick(kind) {
    const now = Date.now()
    if (armRef.current?.kind === kind && now - armRef.current.at < 5000) {
      clearTimeout(armTimer.current)
      armRef.current = null
      setArmed(null)
      onAction?.(kind)
      return
    }
    const next = { kind, at: now }
    armRef.current = next
    setArmed(next)
    clearTimeout(armTimer.current)
    armTimer.current = setTimeout(() => { armRef.current = null; if (mounted.current) setArmed(null) }, 5000)
  }
  useEffect(() => {
    mounted.current = true
    ensureStyles()
    let disposed = false
    if (plugin.storage?.get) void plugin.storage.get(THREAD_HEIGHT_KEY).then(saved => {
      if (disposed) return
      const map = {}
      if (saved?.heights && typeof saved.heights === 'object') for (const [key, px] of Object.entries(saved.heights)) if (key) map[key] = clampThreadHeight(px)
      heightMap.current = map
      applyPreferredHeight()
    }).catch(() => {})
    return () => {
      disposed = true
      mounted.current = false
      ++historyRequest.current
      clearTimeout(armTimer.current)
      clearTimeout(copiedTimer.current)
      stopResize()
    }
  }, [])
  useEffect(() => {
    const previous = threadState.current
    const next = mergeIncomingThread(previous, payload)
    if (next.key !== previous.key) {
      ++historyRequest.current
      lastLoadAt.current = 0
      pendingAnchor.current = null
      stopResize()
      needBottom.current = true
    } else if (next.stick && next.messages.length !== previous.messages.length) needBottom.current = true
    updateThread(() => next)
    applyPreferredHeight()
  }, [event.id, event.revision, event.payload])
  useLayoutEffect(() => {
    const element = threadElement.current
    if (!element) return
    if (pendingAnchor.current) {
      const { previousHeight, previousTop } = pendingAnchor.current
      pendingAnchor.current = null
      element.scrollTop = previousHeight ? element.scrollHeight - previousHeight + previousTop : Math.max(previousTop, 8)
    } else if (needBottom.current) {
      needBottom.current = false
      element.scrollTop = element.scrollHeight
    } else return
    if (threadState.current.scrollTop !== element.scrollTop) updateThread({ scrollTop: element.scrollTop })
  }, [thread.messages, thread.maxPx, thread.stick])

  const appName = payload.appName || '', pkg = payload.packageName || ''
  const sender = String(payload.title || '').trim() || String(appName).trim() || '通知'
  const device = String(payload.device || '').trim()
  const noticeKind = String(payload.noticeKind || '')
  const isChat = noticeKind === 'chat' || thread.messages.length > 0
  const isLockscreenSms = String(pkg).toLowerCase() === 'com.android.mms'
  const bodyText = isChat ? '' : String(event.body || payload.body || '')
  const otp = payload.otp ? String(payload.otp) : noticeKind === 'chat' ? '' : pickOtpFromText(payload.title || event.title, payload.body || event.body)
  const actions = Array.isArray(event.actions) ? event.actions : []
  const hasAction = id => actions.some(action => action?.id === id)
  const avatar = avatarProps(appName, pkg)
  const children = [
    isChat && thread.expanded ? h('div', { key: 'resize', className: `thread-resize${thread.resizing ? ' is-active' : ''}`, title: '拖动调整高度', role: 'separator', 'aria-label': '调整聊天高度', 'aria-orientation': 'horizontal', onPointerDown: startResize }) : null,
    h('div', { key: 'header', className: 'row-top' }, h('div', { className: 'who' }, h('div', { className: avatar.className, style: avatar.style, title: appName || pkg }, avatar.text), h('div', { className: 'meta-col' }, h('div', { className: 'name-line' }, h('h2', { className: 'sender', title: sender }, sender), h('span', { className: 'tag' }, noticeKind === 'otp' ? '验证码' : isChat ? `${thread.total || thread.messages.length}条` : 'SMS')), renderTimeRow(buildTimeMeta(payload)))), h('div', { className: 'ops' }, h('button', { type: 'button', className: 'op op-close', title: '关闭', 'aria-label': '关闭通知', onClick: click => { click.stopPropagation(); onClose?.() } }, IconClose()))),
  ]
  if (!event.sticky) children.push(h('div', { key: `bar-${payload.publishedAt || payload.threadCount || 'bar'}`, className: `bar${isHovered ? ' paused' : ''}` }))
  if (isChat && thread.messages.length) {
    const slice = threadSlice(thread)
    const rows = []
    if (slice.padTop) rows.push(h('div', { key: 'pad-top', style: { height: `${slice.padTop / 16}rem`, flexShrink: 0 } }))
    if (thread.hasMore || thread.loading) rows.push(h('button', { key: 'load-older', type: 'button', className: 'thread-up', disabled: thread.loading, title: thread.loading ? '正在加载…' : '查看更早的消息', 'aria-label': '查看更早的消息', onClick: click => { click.stopPropagation(); void loadOlder() } }, thread.loading ? '…' : '>'))
    slice.rows.forEach((message, index) => {
      const absolute = slice.start + index
      const previous = absolute > 0 ? thread.messages[absolute - 1] : null
      const text = String(message.text || '').trim(), name = String(message.speaker || '').trim()
      const id = String(message.id || `${absolute}-${text.slice(0, 12)}`)
      const stamp = formatChatStamp(message.receivedAt)
      if (shouldShowTimeDivider(message, previous) && stamp) rows.push(h('div', { key: `time-${id}`, className: 'time-divider' }, h('span', null, stamp)))
      rows.push(h('div', { key: id, className: 'bubble-row' }, name && (!previous || String(previous.speaker || '') !== name) ? h('div', { className: 'bubble-name', title: name }, name) : null, text ? h('div', { className: 'bubble-wrap' }, h('div', { className: 'bubble' }, text), h('button', { type: 'button', className: `bubble-copy${copiedId === id ? ' is-ok' : ''}`, title: copiedId === id ? '已复制' : '复制这条', 'aria-label': copiedId === id ? '已复制' : '复制这条消息', onClick: click => { click.stopPropagation(); void copyBubble(text, id) } }, IconCopy())) : null))
    })
    if (slice.padBottom) rows.push(h('div', { key: 'pad-bottom', style: { height: `${slice.padBottom / 16}rem`, flexShrink: 0 } }))
    children.push(h('div', { key: 'thread', className: 'thread-shell' }, h('div', { className: 'thread', ref: threadElement, style: { maxHeight: `${thread.maxPx / 16}rem` }, onScroll: onThreadScroll, onWheel: onThreadWheel }, h('div', { className: 'thread-inner' }, rows)), !thread.stick ? h('button', { type: 'button', className: `jump-new${thread.unseen > 0 ? '' : ' is-arrow'}`, title: thread.unseen > 0 ? `有 ${thread.unseen} 条新消息` : '回到最新', onClick: click => { click.stopPropagation(); jumpToLatest() } }, thread.unseen > 0 ? `新消息 ${thread.unseen}+` : IconChevronDown()) : null))
  } else if (bodyText) children.push(h('p', { key: 'body', className: 'msg' }, bodyText))
  if (otp && !isChat) children.push(h('div', { key: 'otp', className: 'otp-chip' }, otp))
  const blockButton = (kind, label, confirmation, title) => h('button', { key: kind, type: 'button', className: `block-btn${armed?.kind === kind ? ' is-armed' : ''}`, title, onClick: click => { click.stopPropagation(); handleBlockClick(kind) } }, IconBan(), armed?.kind === kind ? confirmation : label)
  children.push(h('div', { key: 'footer', className: 'row-foot' }, otp && hasAction('copy-otp') ? h('button', { type: 'button', className: 'copy-btn', onClick: click => { click.stopPropagation(); onAction?.('copy-otp') } }, IconCopy(), '复制验证码') : h('div'), h('div', { className: 'foot-right' }, h('div', { className: 'dev', title: device || appName }, IconPhone(), h('span', { className: 'dev-name' }, device || appName || '设备')), h('div', { className: 'foot-actions' }, hasAction('block-app') ? blockButton('block-app', isLockscreenSms ? '屏蔽这个标题' : '屏蔽此应用', isLockscreenSms ? '确认屏蔽标题？' : '确认屏蔽应用？', isLockscreenSms ? `不再显示标题为「${sender}」的通知` : '不再显示该应用的通知') : null, hasAction('block-title') ? blockButton('block-title', '屏蔽这个标题', '确认屏蔽标题？', `不再显示标题含「${sender}」的通知`) : null))))
  return h('div', { className: 'sf-card' }, children)
}
export { SmsforwarderNotifyCard as Card }
