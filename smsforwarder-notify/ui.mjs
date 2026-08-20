/** smsforwarder-notify toast — match SMS sync card (avatar / sender / badge / device). */
const { h } = globalThis.__CATRACE_VUE__ || {}
const vueWatch = globalThis.__CATRACE_VUE__ && globalThis.__CATRACE_VUE__.watch
if (typeof h !== 'function') {
  throw new Error('Catrace plugin Vue runtime missing (__CATRACE_VUE__.h)')
}

// bump id when CSS changes so toast window picks up new rules without full app reinstall
const STYLE_ID = 'catrace-plugin-smsforwarder-notify-css-v29'
const THREAD_ROW_EST = 56
const THREAD_OVERSCAN = 6
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
  margin: 0.625rem 0 0.25rem;
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
}
.sf-card .thread-shell {
  position: relative;
  margin: 0.5rem 0 0;
}
.sf-card .thread {
  margin: 0;
  max-height: 16rem;
  overflow-y: auto;
  padding: 0.125rem 0.25rem 0.125rem 0;
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
  gap: 0.4375rem;
}
.sf-card .thread-more {
  font-size: 0.6875rem;
  color: #9ca3af;
  text-align: center;
  padding: 0.25rem 0;
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
  background: transparent;
  padding: 0.1875rem;
  margin: 0.125rem 0 0;
  color: #10b981;
  cursor: pointer;
  border-radius: 0.375rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}
.sf-card .bubble-row:hover .bubble-copy,
.sf-card .bubble-copy:focus-visible {
  opacity: 1;
}
.sf-card .bubble-copy:hover { background: #ecfdf5; color: #059669; }
.sf-card .bubble-copy.is-ok { opacity: 1; color: #047857; }
.sf-card .bubble-copy svg { width: 0.8125rem; height: 0.8125rem; display: block; }
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
}
.sf-card .copy-btn {
  align-self: flex-start;
  margin-top: 0.5rem;
  border: none;
  background: transparent;
  padding: 0.25rem 0.375rem;
  margin: 0;
  font-size: 0.8125rem;
  font-weight: 600;
  color: #10b981;
  cursor: pointer;
  font-family: inherit;
  line-height: 1.2;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}
.sf-card .copy-btn:hover { color: #059669; }
.sf-card .copy-btn svg { width: 0.9375rem; height: 0.9375rem; flex-shrink: 0; }
.sf-card .foot-right {
  display: flex;
  align-items: center;
  gap: 0.5rem 0.75rem;
  min-width: 0;
  flex-shrink: 1;
  flex-wrap: wrap;
  justify-content: flex-end;
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
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-top: 0.875rem;
  min-height: 1.25rem;
}
.sf-card .dev {
  display: inline-flex;
  align-items: center;
  gap: 0.3125rem;
  min-width: 0;
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
  // remove older style tags from previous plugin versions
  for (const id of [
    'catrace-plugin-smsforwarder-notify-css',
    'catrace-plugin-smsforwarder-notify-css-v2',
    'catrace-plugin-smsforwarder-notify-css-v3',
    'catrace-plugin-smsforwarder-notify-css-v4',
    'catrace-plugin-smsforwarder-notify-css-v5',
    'catrace-plugin-smsforwarder-notify-css-v6',
    'catrace-plugin-smsforwarder-notify-css-v7',
    'catrace-plugin-smsforwarder-notify-css-v8',
    'catrace-plugin-smsforwarder-notify-css-v9',
    'catrace-plugin-smsforwarder-notify-css-v10',
    'catrace-plugin-smsforwarder-notify-css-v11',
    'catrace-plugin-smsforwarder-notify-css-v12',
    'catrace-plugin-smsforwarder-notify-css-v13',
    'catrace-plugin-smsforwarder-notify-css-v14',
    'catrace-plugin-smsforwarder-notify-css-v15',
    'catrace-plugin-smsforwarder-notify-css-v16',
    'catrace-plugin-smsforwarder-notify-css-v17',
    'catrace-plugin-smsforwarder-notify-css-v18',
    'catrace-plugin-smsforwarder-notify-css-v19',
    'catrace-plugin-smsforwarder-notify-css-v20',
    'catrace-plugin-smsforwarder-notify-css-v21',
    'catrace-plugin-smsforwarder-notify-css-v22',
    'catrace-plugin-smsforwarder-notify-css-v23',
    'catrace-plugin-smsforwarder-notify-css-v24',
    'catrace-plugin-smsforwarder-notify-css-v25',
    'catrace-plugin-smsforwarder-notify-css-v26',
    'catrace-plugin-smsforwarder-notify-css-v27',
    'catrace-plugin-smsforwarder-notify-css-v28',
  ]) {
    const old = document.getElementById(id)
    if (old) old.remove()
  }
  let el = document.getElementById(STYLE_ID)
  if (!el) {
    el = document.createElement('style')
    el.id = STYLE_ID
    document.head.appendChild(el)
  }
  el.textContent = CSS
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
      class: 'lag-ico',
      viewBox: '0 0 24 24',
      fill: 'none',
      xmlns: 'http://www.w3.org/2000/svg',
      'aria-hidden': 'true',
    },
    [
      h('path', {
        d: 'M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z',
        stroke: 'currentColor',
        'stroke-width': '1.8',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      }),
    ],
  )
}

function IconChevron() {
  return h(
    'svg',
    {
      class: 'lag-chev',
      viewBox: '0 0 24 24',
      fill: 'none',
      xmlns: 'http://www.w3.org/2000/svg',
      'aria-hidden': 'true',
    },
    [
      h('path', {
        d: 'M6 9l6 6 6-6',
        stroke: 'currentColor',
        'stroke-width': '2',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      }),
    ],
  )
}

function pillNode(p) {
  if (!p) return null
  return h('span', { class: ['pill', p.slow ? 'is-slow' : 'is-ok'] }, p.text)
}

function renderTimeRow(meta) {
  if (!meta || !meta.clock) return null
  const kids = [h('p', { class: 'clock' }, `${meta.clock}${meta.clockSuffix || ''}`)]
  if (meta.showLag && meta.lagLabel) {
    kids.push(
      h('span', { class: 'lag-badge' }, [
        IconWarn(),
        meta.lagLabel,
        IconChevron(),
        h('div', { class: 'lag-pop', role: 'tooltip' }, [
          h('span', { class: 't' }, meta.clock),
          h('span', { class: 'lab' }, '手机'),
          h('span', { class: 'arr' }, '→'),
          pillNode(meta.pathPill),
          h('span', { class: 'lab' }, '电脑'),
          h('span', { class: 'arr' }, '→'),
          pillNode(meta.hostPill),
          h('span', { class: 'lab' }, '弹出'),
        ]),
      ]),
    )
  }
  return h('div', { class: 'time-row' }, kids)
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
      class: ['avatar', brand.className].filter(Boolean).join(' '),
      style: brand.style || undefined,
      text: brand.label,
    }
  }
  const key = appName || packageName || 'app'
  const hue = hashHue(key)
  return {
    class: 'avatar',
    style: {
      background: `linear-gradient(145deg, hsl(${hue} 58% 54%), hsl(${(hue + 24) % 360} 55% 42%))`,
    },
    text: avatarInitials(appName, packageName),
  }
}

function pickOtpFromText(title, body, packageName, appName) {
  const text = `${title || ''}\n${body || ''}`.replace(/[０-９]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30),
  )
  if (!text.trim()) return ''
  const nearAfter =
    /(?:验证码|校验码|动态码|动态密码|短信码|登录码|确认码|授权码|安全码|识别码|提取码|口令|密码|OTP|PIN|code|Code|CODE)[^\d]{0,16}(\d(?:[\s-]?\d){3,7})/i
  const nm = nearAfter.exec(text)
  if (nm) {
    const d = nm[1].replace(/\D/g, '')
    if (d.length >= 4 && d.length <= 8) return d
  }
  const nearBefore =
    /(\d(?:[\s-]?\d){3,7})[^\d]{0,8}(?:验证码|校验码|动态码|动态密码|登录码|OTP|code)/i
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
  const kw =
    /验证码|校验码|动态码|动态密码|短信码|登录码|确认码|授权码|安全码|识别码|口令|密码|验证|校验|OTP|PIN|verification\s*code|security\s*code|\bcode\b/i
  const all = text.match(/(?<!\d)\d{4,8}(?!\d)/g) || []
  if (kw.test(text) && all.length) return all.find((x) => x.length === 6) || all[0]
  const smsLike =
    /mms|sms|messaging|telephony|短信|信息|SMS|MMS/i.test(`${packageName || ''} ${appName || ''}`)
  const compact = text.replace(/\s+/g, ' ').trim()
  if ((smsLike || compact.length <= 120) && all.length) {
    if (all.length === 1) return all[0]
    return all.find((x) => x.length === 6) || all[0]
  }
  return ''
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
    paths,
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
      'stroke-width': '1.7',
    }),
    h('path', {
      d: 'M7 15H6.2A1.2 1.2 0 0 1 5 13.8V6.2A1.2 1.2 0 0 1 6.2 5h7.6A1.2 1.2 0 0 1 15 6.2V7',
      stroke: 'currentColor',
      'stroke-width': '1.7',
      'stroke-linecap': 'round',
    }),
  ])
}

function IconClose() {
  return svgIcon([
    h('path', {
      d: 'M7 7l10 10M17 7L7 17',
      stroke: 'currentColor',
      'stroke-width': '1.7',
      'stroke-linecap': 'round',
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
      'stroke-width': '1.6',
    }),
    h('path', {
      d: 'M10.5 17.5h3',
      stroke: 'currentColor',
      'stroke-width': '1.6',
      'stroke-linecap': 'round',
    }),
  ])
}

function IconChevronDown() {
  return svgIcon([
    h('path', {
      d: 'M6 9l6 6 6-6',
      stroke: 'currentColor',
      'stroke-width': '1.8',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
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
      'stroke-width': '1.6',
    }),
    h('path', {
      d: 'M5.6 5.6l12.8 12.8',
      stroke: 'currentColor',
      'stroke-width': '1.6',
      'stroke-linecap': 'round',
    }),
  ])
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
    this.blockArmedAt = 0
    this.blockArmedKind = ''
    this.copiedId = ''
    this.copiedTimer = null
    this.stickToBottom = true
    this.unseenCount = 0
    this.messages = []
    this.total = 0
    this.hasMore = false
    this.loadingMore = false
    this.threadKey = ''
    this.scrollTop = 0
    this.needScrollBottom = false
    this.topLoadArmed = true
    this.syncFromPayload((this.event && this.event.payload) || {}, { initial: true })
  },
  mounted() {
    if (typeof vueWatch === 'function') {
      this._unwatchEvent = vueWatch(
        () => this.event,
        (ev) => this.syncFromPayload((ev && ev.payload) || {}),
        { deep: true },
      )
    }
    this.flushScrollBottom()
  },
  updated() {
    this.flushScrollBottom()
  },
  beforeUnmount() {
    if (this.blockArmedTimer) clearTimeout(this.blockArmedTimer)
    if (this.copiedTimer) clearTimeout(this.copiedTimer)
    if (typeof this._unwatchEvent === 'function') this._unwatchEvent()
  },
  methods: {
    storeKeyFromThread(key) {
      const digest = String(key || '').split(':').pop() || ''
      return `chat_${digest.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)}`
    },
    pluginApi() {
      return typeof plugin !== 'undefined' ? plugin : null
    },
    flushScrollBottom() {
      if (!this.needScrollBottom) return
      const el = this.$refs && this.$refs.thread
      if (!el) return
      this.needScrollBottom = false
      el.scrollTop = el.scrollHeight
      this.scrollTop = el.scrollTop
    },
    syncFromPayload(pl, opts = {}) {
      const incoming = Array.isArray(pl.messages)
        ? pl.messages.filter((m) => m && (m.text || m.speaker))
        : []
      const key = String(pl.threadKey || '')
      if (key && key !== this.threadKey) {
        this.messages = incoming.slice()
        this.threadKey = key
        this.stickToBottom = true
        this.unseenCount = 0
        this.needScrollBottom = true
        this.topLoadArmed = true
      } else if (incoming.length) {
        const seen = new Set(this.messages.map((m) => m && m.id))
        let added = 0
        for (const m of incoming) {
          if (m && m.id && !seen.has(m.id)) {
            this.messages.push(m)
            seen.add(m.id)
            added += 1
          }
        }
        if (added) {
          if (this.stickToBottom) {
            this.unseenCount = 0
            this.needScrollBottom = true
          } else {
            this.unseenCount += added
          }
        }
      } else if (opts.initial && this.stickToBottom) {
        this.needScrollBottom = true
      }
      this.total = Number(pl.threadCount) || this.messages.length
      this.hasMore = pl.hasMore === true || this.messages.length < this.total
    },
    visibleSlice() {
      const all = this.messages
      const viewH = 256
      const count = Math.ceil(viewH / THREAD_ROW_EST) + THREAD_OVERSCAN * 2
      if (this.stickToBottom || this.needScrollBottom) {
        const start = Math.max(0, all.length - count)
        return {
          start,
          end: all.length,
          padTop: start * THREAD_ROW_EST,
          padBottom: 0,
          rows: all.slice(start),
        }
      }
      const start = Math.max(0, Math.floor(this.scrollTop / THREAD_ROW_EST) - THREAD_OVERSCAN)
      const end = Math.min(all.length, start + count)
      return {
        start,
        end,
        padTop: start * THREAD_ROW_EST,
        padBottom: Math.max(0, (all.length - end) * THREAD_ROW_EST),
        rows: all.slice(start, end),
      }
    },
    async loadOlder() {
      if (this.loadingMore || !this.hasMore || !this.threadKey || !this.topLoadArmed) return
      const api = this.pluginApi()
      if (!api || !api.storage || typeof api.storage.get !== 'function') return
      const first = this.messages[0]
      const beforeId = first && first.id
      this.loadingMore = true
      this.topLoadArmed = false
      const el = this.$refs && this.$refs.thread
      const prevH = el ? el.scrollHeight : 0
      const prevTop = el ? el.scrollTop : 0
      try {
        const stored = await api.storage.get(this.storeKeyFromThread(this.threadKey))
        const all = stored && Array.isArray(stored.messages) ? stored.messages.filter((m) => m && (m.text || m.speaker)) : []
        const idx = beforeId ? all.findIndex((m) => m && m.id === beforeId) : all.length
        const end = idx < 0 ? all.length : idx
        const start = Math.max(0, end - 40)
        const older = all.slice(start, end)
        let prepended = 0
        if (older.length) {
          const seen = new Set(this.messages.map((m) => m && m.id))
          const prepend = []
          for (const m of older) {
            if (m && m.id && !seen.has(m.id)) {
              prepend.push(m)
              seen.add(m.id)
            }
          }
          prepended = prepend.length
          if (prepended) this.messages = prepend.concat(this.messages)
        }
        this.total = all.length || this.messages.length
        this.hasMore = start > 0
        this.$forceUpdate()
        await this.$nextTick()
        const node = this.$refs && this.$refs.thread
        if (node) {
          if (prepended && prevH) node.scrollTop = node.scrollHeight - prevH + prevTop
          else node.scrollTop = Math.max(prevTop, 48)
          this.scrollTop = node.scrollTop
        }
      } catch (e) {
        console.warn('[smsforwarder-notify] load older failed', e)
      } finally {
        this.loadingMore = false
        this.$forceUpdate()
      }
    },
    onThreadScroll(e) {
      const el = e && e.target
      if (!el) return
      this.scrollTop = el.scrollTop
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight
      const atBottom = gap < 8
      this.stickToBottom = atBottom
      if (atBottom) this.unseenCount = 0
      if (el.scrollTop > 80) this.topLoadArmed = true
      if (el.scrollTop < 48) this.loadOlder()
      this.$forceUpdate()
    },
    jumpToLatest() {
      this.stickToBottom = true
      this.unseenCount = 0
      this.needScrollBottom = true
      this.$forceUpdate()
      this.$nextTick(() => this.flushScrollBottom())
    },
    async copyBubble(text, id) {
      const value = String(text || '').trim()
      if (!value) return
      try {
        const api = this.pluginApi()
        if (api && api.clipboard && typeof api.clipboard.writeText === 'function') {
          await api.clipboard.writeText(value)
        } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
          await navigator.clipboard.writeText(value)
        }
        this.copiedId = id
        if (this.copiedTimer) clearTimeout(this.copiedTimer)
        this.copiedTimer = setTimeout(() => {
          this.copiedId = ''
          this.$forceUpdate()
        }, 1200)
        this.$forceUpdate()
      } catch (e) {
        console.warn('[smsforwarder-notify] copy bubble failed', e)
      }
    },
    handleBlockClick(kind) {
      const now = Date.now()
      if (this.blockArmedKind === kind && this.blockArmedAt && now - this.blockArmedAt < 5000) {
        if (this.blockArmedTimer) clearTimeout(this.blockArmedTimer)
        this.blockArmedAt = 0
        this.blockArmedKind = ''
        this.$emit('action', kind)
        return
      }
      this.blockArmedAt = now
      this.blockArmedKind = kind
      if (this.blockArmedTimer) clearTimeout(this.blockArmedTimer)
      this.blockArmedTimer = setTimeout(() => {
        this.blockArmedAt = 0
        this.blockArmedKind = ''
        this.$forceUpdate()
      }, 5000)
      this.$forceUpdate()
    },
  },
  render() {
    const event = this.event || {}
    const payload = event.payload || {}
    const appName = payload.appName || ''
    const pkg = payload.packageName || ''
    const isLockscreenSms = String(pkg).toLowerCase() === 'com.android.mms'
    // sender = notification title (contact / chat name); fallback app
    const sender =
      String(payload.title || '').trim() ||
      String(appName || '').trim() ||
      '通知'
    const timeMeta = buildTimeMeta(payload)
    const device = String(payload.device || '').trim()
    const noticeKind = String(payload.noticeKind || '')
    const messages = Array.isArray(this.messages) ? this.messages : []
    const isChat = noticeKind === 'chat' || messages.length > 0
    const bodyText = isChat ? '' : String(event.body || payload.body || '')

    let otp = payload.otp ? String(payload.otp) : ''
    if (!otp && noticeKind !== 'chat') {
      otp =
        pickOtpFromText(
          payload.title || event.title,
          payload.body || event.body,
          payload.packageName,
          payload.appName,
        ) || ''
    }

    const actions = Array.isArray(event.actions) ? event.actions.slice() : []
    const hasCopyOtp = actions.some((a) => a && a.id === 'copy-otp')
    const hasBlock = actions.some((a) => a && a.id === 'block-app')
    const hasBlockTitle = actions.some((a) => a && a.id === 'block-title')
    const copyActionId = otp && hasCopyOtp ? 'copy-otp' : ''
    const av = avatarProps(appName, pkg)
    const tagLabel = noticeKind === 'otp'
      ? '验证码'
      : isChat
        ? `${this.total || messages.length}条`
        : 'SMS'

    const children = [
      h('div', { class: 'row-top' }, [
        h('div', { class: 'who' }, [
          h(
            'div',
            {
              class: av.class,
              style: av.style,
              title: appName || pkg || '',
            },
            av.text,
          ),
          h('div', { class: 'meta-col' }, [
            h('div', { class: 'name-line' }, [
              h('h2', { class: 'sender', title: sender }, sender),
              h('span', { class: 'tag' }, tagLabel),
            ]),
            renderTimeRow(timeMeta),
          ]),
        ]),
        h('div', { class: 'ops' }, [
          h(
            'button',
            {
              class: ['op', 'op-close'],
              type: 'button',
              title: '关闭',
              'aria-label': 'Close',
              onClick: (e) => {
                e.stopPropagation()
                this.$emit('close')
              },
            },
            [IconClose()],
          ),
        ]),
      ]),
    ]

    if (!event.sticky) {
      children.push(
        h('div', {
          key: payload.publishedAt || payload.threadCount || 'bar',
          class: ['bar', this.isHovered ? 'paused' : ''],
        }),
      )
    }

    if (isChat && messages.length) {
      const slice = this.visibleSlice()
      const threadKids = []
      if (this.hasMore || this.loadingMore) {
        threadKids.push(
          h('div', { class: 'thread-more' }, this.loadingMore ? '加载更早的消息…' : '向上滚动加载更早'),
        )
      }
      threadKids.push(h('div', { style: { height: `${slice.padTop}px`, flexShrink: 0 } }))
      slice.rows.forEach((m, i) => {
        const abs = slice.start + i
        const text = String(m.text || '').trim()
        const name = String(m.speaker || '').trim()
        const prev = abs > 0 ? messages[abs - 1] : null
        const showName = Boolean(name && (!prev || String(prev.speaker || '') !== name))
        const id = String(m.id || `${abs}-${text.slice(0, 12)}`)
        threadKids.push(
          h('div', { class: 'bubble-row', key: id }, [
            showName ? h('div', { class: 'bubble-name', title: name }, name) : null,
            text
              ? h('div', { class: 'bubble-wrap' }, [
                  h('div', { class: 'bubble' }, text),
                  h(
                    'button',
                    {
                      class: ['bubble-copy', this.copiedId === id ? 'is-ok' : ''],
                      type: 'button',
                      title: this.copiedId === id ? '已复制' : '复制这条',
                      onClick: (e) => {
                        e.stopPropagation()
                        this.copyBubble(text, id)
                      },
                    },
                    [IconCopy()],
                  ),
                ])
              : null,
          ]),
        )
      })
      threadKids.push(h('div', { style: { height: `${slice.padBottom}px`, flexShrink: 0 } }))
      children.push(
        h('div', { class: 'thread-shell' }, [
          h(
            'div',
            { class: 'thread', ref: 'thread', onScroll: (e) => this.onThreadScroll(e) },
            [h('div', { class: 'thread-inner' }, threadKids)],
          ),
          !this.stickToBottom
            ? h(
                'button',
                {
                  class: ['jump-new', this.unseenCount > 0 ? '' : 'is-arrow'],
                  type: 'button',
                  title: this.unseenCount > 0 ? `有 ${this.unseenCount} 条新消息` : '回到最新',
                  onClick: (e) => {
                    e.stopPropagation()
                    this.jumpToLatest()
                  },
                },
                this.unseenCount > 0 ? `新消息 ${this.unseenCount}+` : [IconChevronDown()],
              )
            : null,
        ]),
      )
    } else if (bodyText) {
      children.push(h('p', { class: 'msg' }, bodyText))
    }

    if (otp && !isChat) {
      children.push(h('div', { class: 'otp-chip' }, otp))
    }

    children.push(
      h('div', { class: 'row-foot' }, [
        copyActionId
          ? h(
              'button',
              {
                class: 'copy-btn',
                type: 'button',
                onClick: () => this.$emit('action', copyActionId),
              },
              [IconCopy(), '复制验证码'],
            )
          : h('div', { class: 'dev' }),
        h('div', { class: 'foot-right' }, [
          hasBlockTitle
            ? h(
                'button',
                {
                  class: [
                    'block-btn',
                    this.blockArmedKind === 'block-title' && this.blockArmedAt ? 'is-armed' : '',
                  ],
                  type: 'button',
                  title: `不再显示标题含「${sender}」的通知`,
                  onClick: () => this.handleBlockClick('block-title'),
                },
                [
                  IconBan(),
                  this.blockArmedKind === 'block-title' && this.blockArmedAt
                    ? '确认屏蔽标题？'
                    : '屏蔽这个标题',
                ],
              )
            : null,
          hasBlock
            ? h(
                'button',
                {
                  class: [
                    'block-btn',
                    this.blockArmedKind === 'block-app' && this.blockArmedAt ? 'is-armed' : '',
                  ],
                  type: 'button',
                  title: isLockscreenSms
                    ? `不再显示标题为「${sender}」的通知`
                    : '不再显示该应用的通知',
                  onClick: () => this.handleBlockClick('block-app'),
                },
                [
                  IconBan(),
                  this.blockArmedKind === 'block-app' && this.blockArmedAt
                    ? isLockscreenSms
                      ? '确认屏蔽标题？'
                      : '确认屏蔽应用？'
                    : isLockscreenSms
                      ? '屏蔽这个标题'
                      : '屏蔽此应用',
                ],
              )
            : null,
          device
            ? h('div', { class: 'dev', title: device }, [
                IconPhone(),
                h('span', { class: 'dev-name' }, device),
              ])
            : h('div', { class: 'dev' }, [
                IconPhone(),
                h('span', { class: 'dev-name' }, appName || '设备'),
              ]),
        ]),
      ]),
    )

    return h('div', { class: 'sf-card' }, children)
  },
}
