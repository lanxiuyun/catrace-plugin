/** History rest/focus visualization: React ring / timeline / flow cards. */
const React = globalThis.__CATRACE_REACT__
if (!React?.createElement) throw new Error('Catrace React runtime missing (__CATRACE_REACT__)')
const { createElement: h, useState, useEffect, useMemo, useId } = React
const MINUTES = 1440
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
const COLOR = { active: 'var(--ct-accent)', rest: 'var(--ct-success)', empty: 'var(--ct-surface-2)' }
const VIEWS = [
  { id: 'timeline', label: '单轴时间线' },
  { id: 'ring', label: '环形表盘' },
  { id: 'cards', label: '作息流卡片' },
]
const STYLE_ID = 'catrace-plugin-heatmap-settings-css'
const CSS = `
.hm {
  width: 100%; min-width: 0; box-sizing: border-box;
  display: flex; flex-direction: column; gap: 0.875rem;
  color: #4c1d95;
  container-type: inline-size; container-name: hm;
}
.hm *, .hm *::before, .hm *::after { box-sizing: border-box; }
.hm-bar {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  grid-template-areas:
    "nav nav"
    "stats seg";
  gap: 0.75rem 1.25rem;
  align-items: center;
  width: 100%; min-width: 0;
  padding: 0.625rem 0.875rem 0.625rem 0.75rem; background: #fff;
  border: 0.0625rem solid #efeaf8; border-radius: 1.25rem;
  box-shadow: 0 0.5rem 1.25rem rgba(76, 29, 149, 0.045);
}
.hm-nav {
  grid-area: nav;
  display: flex; align-items: center; gap: 0.375rem; flex-wrap: wrap;
  min-width: 0;
}
.hm-picker { width: 10.5rem; flex-shrink: 0; }
.hm-picker {height:2.25rem;border:1px solid #ddd6fe;border-radius:.75rem;background:#f6f3fc;font:inherit;font-weight:700;color:inherit;padding:0 .5rem;min-width:0;}
.hm-week { font-size: 0.875rem; font-weight: 700; color: #8b5cf6; padding: 0 0.15rem; }
.hm-today, .hm-round, .hm-seg button {
  appearance: none; -webkit-appearance: none;
  font: inherit; cursor: pointer;
  border: 0.0625rem solid transparent !important;
  box-shadow: none !important; outline: none;
  background: transparent; color: inherit;
}
.hm-round {
  width: 2.25rem; height: 2.25rem; border-radius: 999px;
  background: #f3f0fa !important; color: #6d5b93;
  display: inline-flex; align-items: center; justify-content: center; padding: 0;
}
.hm-round svg { width: 0.875rem; height: 0.875rem; }
.hm-round:hover:not(:disabled) { background: #ebe4f8 !important; }
.hm-round:focus-visible, .hm-today:focus-visible, .hm-seg button:focus-visible {
  box-shadow: 0 0 0 0.125rem #fff, 0 0 0 0.25rem #8b5cf6 !important;
}
.hm-round:disabled, .hm-today:disabled { opacity: 0.38; cursor: default; }
.hm-today {
  height: 2.25rem; padding: 0 0.85rem; border-radius: 999px;
  background: #f3f0fa !important; color: #6d5b93; font-size: 0.8125rem; font-weight: 600;
}
.hm-today:hover:not(:disabled) { background: #ebe4f8 !important; }
.hm-stats {
  grid-area: stats;
  display: flex; align-items: center; gap: 1.25rem;
  flex-wrap: nowrap; white-space: nowrap;
}
.hm-stat {
  display: inline-flex; align-items: center; gap: 0.45rem;
  white-space: nowrap; font-size: 0.8125rem; color: #6b7280; font-weight: 500;
}
.hm-stat b {
  font-size: 1rem; font-weight: 800; color: #2e1065;
  font-variant-numeric: tabular-nums;
}
.hm-dot { width: 0.5rem; height: 0.5rem; border-radius: 999px; flex-shrink: 0; }
.hm-seg {
  grid-area: seg;
  display: inline-flex; align-items: center; gap: 0.125rem;
  padding: 0.1875rem; background: #f3f0fa;
  border-radius: 999px; justify-self: end;
}
.hm-seg button {
  font-size: 0.8125rem; font-weight: 600; color: #6b7280;
  padding: 0.4rem 0.8rem; border-radius: 999px; line-height: 1.2;
}
.hm-seg button:hover:not(.is-on) { color: #4c1d95; background: #fff; }
.hm-seg button.is-on {
  background: #8b5cf6 !important; color: #fff;
  box-shadow: 0 0.25rem 0.7rem rgba(139, 92, 246, 0.28) !important;
}
.hm-card {
  padding: 1.5rem 1.5rem 1.35rem; background: #fff;
  border: 0.0625rem solid #efeaf8; border-radius: 1.5rem;
  box-shadow: 0 0.75rem 1.75rem rgba(76, 29, 149, 0.05);
}
.hm-err { margin: 0 0 0.75rem; font-size: 0.8125rem; color: #b91c1c; }
.hm-ring-wrap { display: flex; flex-direction: column; align-items: center; gap: 1.25rem; }
.hm-ring-stage { position: relative; width: min(20.5rem, 100%); }
.hm-ring { width: 100%; height: auto; overflow: visible; display: block; }
.hm-ring path { cursor: pointer; transition: opacity 0.2s ease; }
.hm-ring path.is-dim { opacity: 0.32; }
.hm-center {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; pointer-events: none; text-align: center;
}
.hm-badge {
  display: inline-block; padding: 0.2rem 0.6rem; border-radius: 999px;
  font-size: 0.75rem; font-weight: 700;
}
.hm-badge.active { background: #f3e8ff; color: #6d28d9; }
.hm-badge.rest { background: #d1fae5; color: #047857; }
.hm-badge.empty { background: #eef2f7; color: #64748b; }
.hm-range {
  margin: 0.45rem 0 0; font-size: 1.375rem; font-weight: 800;
  letter-spacing: 0.02em; color: #2e1065; font-variant-numeric: tabular-nums;
}
.hm-dur { margin: 0.3rem 0 0; font-size: 0.8125rem; color: #94a3b8; }
.hm-legend {
  display: flex; justify-content: center; gap: 1.15rem; flex-wrap: wrap;
  font-size: 0.75rem; color: #6b7280; font-weight: 500;
}
.hm-legend span { display: inline-flex; align-items: center; gap: 0.35rem; }
.hm-axis {
  display: flex; height: 3.25rem; border-radius: 999px; overflow: hidden;
  background: #eef2f7; cursor: pointer;
  box-shadow: inset 0 0 0 0.0625rem rgba(76, 29, 149, 0.04);
}
.hm-axis i {
  display: block; height: 100%; min-width: 0.125rem;
  transition: filter 0.15s ease, box-shadow 0.15s ease;
}
.hm-axis i.is-on {
  box-shadow: inset 0 0 0 0.125rem rgba(255,255,255,0.92);
  filter: saturate(1.08) brightness(1.03);
  z-index: 1;
}
.hm-hours {
  display: flex; justify-content: space-between; margin-top: 0.55rem;
  padding: 0 0.15rem; font-size: 0.75rem; color: #94a3b8;
  font-variant-numeric: tabular-nums;
}
.hm-detail { margin-top: 1.5rem; text-align: center; }
.hm-flow { display: flex; flex-direction: column; gap: 0.45rem; }
.hm-flow-item {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0.8rem 0.95rem; border-radius: 0.95rem; background: #f8f6fc;
  cursor: pointer; border: 0.0625rem solid transparent;
  transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
}
.hm-flow-item:hover { background: #f3eefc; }
.hm-flow-item.is-on {
  border-color: #ddd6fe; background: #f5f3ff;
  box-shadow: 0 0.25rem 0.75rem rgba(139, 92, 246, 0.08);
}
.hm-flow-bar { width: 0.3rem; align-self: stretch; border-radius: 999px; }
.hm-flow-time { font-weight: 700; font-variant-numeric: tabular-nums; min-width: 9.5rem; color: #2e1065; }
.hm-flow-name { flex: 1; color: #6b7280; font-size: 0.875rem; }
.hm-flow-dur { font-weight: 700; font-variant-numeric: tabular-nums; color: #2e1065; }
@container hm (max-width: 42rem) {
  .hm-bar {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      "nav"
      "stats"
      "seg";
  }
  .hm-seg { width: 100%; justify-self: stretch; }
  .hm-seg button { flex: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .hm-ring path, .hm-axis i, .hm-flow-item { transition: none; }
}
`

function ensureStyles() {
  if (typeof document === 'undefined') return
  let el = document.getElementById(STYLE_ID)
  if (!el) {
    el = document.createElement('style')
    el.id = STYLE_ID
    document.head.appendChild(el)
  }
  el.textContent = plugin.theme.css(CSS)
}

function startOfLocalDay(d) {
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000)
}
function ymdSlash(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}/${m}/${day}`
}
function ymd(d) {
  return ymdSlash(d).replace(/\//g, '-')
}
function parseYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim())
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (Number.isNaN(d.getTime()) || ymd(d) !== `${m[1]}-${m[2]}-${m[3]}`) return null
  return d
}
function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}
function todayLocal() {
  const n = new Date()
  return new Date(n.getFullYear(), n.getMonth(), n.getDate())
}
function clampToToday(d) {
  const t = todayLocal()
  return d.getTime() > t.getTime() ? t : d
}
function densify(from, rows) {
  const map = new Map()
  for (const r of rows || []) {
    if (r && typeof r.timestamp === 'number') map.set(r.timestamp, !!r.active)
  }
  const minutes = []
  for (let i = 0; i < MINUTES; i++) {
    const ts = from + i * 60
    minutes.push({ ts, active: map.has(ts) ? map.get(ts) : null })
  }
  return minutes
}
function mergeBlocks(minutes) {
  const blocks = []
  for (let i = 0; i < minutes.length; i++) {
    const a = minutes[i].active
    const last = blocks[blocks.length - 1]
    if (last && last.active === a) last.endIdx = i + 1
    else blocks.push({ startIdx: i, endIdx: i + 1, active: a, startTs: minutes[i].ts })
  }
  for (const b of blocks) {
    b.mins = b.endIdx - b.startIdx
    b.endTs = minutes[b.endIdx - 1].ts + 60
  }
  return blocks
}
function kindOf(active) {
  if (active === true) return 'active'
  if (active === false) return 'rest'
  return 'empty'
}
function nameOf(active) {
  if (active === true) return '专注活跃'
  if (active === false) return '休息睡眠'
  return '未记录'
}
function colorOf(active) {
  if (active === true) return COLOR.active
  if (active === false) return COLOR.rest
  return COLOR.empty
}
function hhmm(ts) {
  const d = new Date(ts * 1000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function hmLabel(mins) {
  const hr = Math.floor(mins / 60)
  const m = mins % 60
  return `${hr}h ${String(m).padStart(2, '0')}m`
}
function durZh(mins) {
  const hr = Math.floor(mins / 60)
  const m = mins % 60
  if (hr && m) return `${hr} 小时 ${m} 分钟`
  if (hr) return `${hr} 小时`
  return `${m} 分钟`
}
function polar(cx, cy, r, deg) {
  const a = (deg * Math.PI) / 180
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
}
function arcPath(cx, cy, r, startMin, endMin) {
  const span = Math.max(1, endMin - startMin)
  let deg = (span / MINUTES) * 360
  let pad = deg > 5 ? 1.4 : 0.2
  if (deg - pad < 0.4) pad = 0
  const startA = (startMin / MINUTES) * 360 - 90 + pad / 2
  const endA = (endMin / MINUTES) * 360 - 90 - pad / 2
  const large = endA - startA > 180 ? 1 : 0
  const [x1, y1] = polar(cx, cy, r, startA)
  const [x2, y2] = polar(cx, cy, r, endA)
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`
}

function iconChevron(dir) {
  const d = dir === 'left' ? 'M15 6L9 12l6 6' : 'M9 6l6 6-6 6'
  return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2.2', strokeLinecap: 'round', strokeLinejoin: 'round' }, [
    h('path', { key: 'chevron', d }),
  ])
}

export default function HeatmapSettings() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [day, setDay] = useState(todayLocal)
  const [minutes, setMinutes] = useState([])
  const [view, setView] = useState('ring')
  const [selected, setSelected] = useState(0)
  const [initialized, setInitialized] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const filterId = `hm-shadow-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const blocks = useMemo(() => mergeBlocks(minutes), [minutes])
  const stats = useMemo(() => {
    let active = 0, rest = 0
    for (const minute of minutes) {
      if (minute.active === true) active++
      else if (minute.active === false) rest++
    }
    return { active, rest }
  }, [minutes])
  const selectedBlock = blocks[selected] || blocks[0] || null
  const isToday = ymd(day) === ymd(todayLocal())
  useEffect(() => {
    let alive = true
    ensureStyles()
    void (async () => {
      let initial = todayLocal(), lastView = 'ring'
      try {
        const saved = await plugin.storage.get('lastDay')
        const parsed = parseYmd(saved)
        if (parsed) initial = clampToToday(parsed)
        const savedView = await plugin.storage.get('lastView')
        if (VIEWS.some((entry) => entry.id === savedView)) lastView = savedView
      } catch { /* Storage is optional for the initial view. */ }
      if (alive) { setDay(initial); setView(lastView); setInitialized(true) }
    })()
    return () => { alive = false }
  }, [])
  useEffect(() => {
    if (!initialized) return
    let alive = true
    const from = startOfLocalDay(day)
    setLoading(true)
    setError('')
    setMinutes(densify(from, []))
    setSelected(0)
    void (async () => {
      try {
        if (typeof plugin.activity.getRecords !== 'function') throw new Error('当前 Catrace 没有历史记录 API，请更新并重启宿主。')
        const rows = await plugin.activity.getRecords({ from, to: from + MINUTES * 60 })
        if (!alive) return
        const dense = densify(from, Array.isArray(rows) ? rows : [])
        const list = mergeBlocks(dense)
        let best = 0, longestRest = -1
        list.forEach((block, index) => {
          if (block.active === false && block.mins > longestRest) { best = index; longestRest = block.mins }
        })
        setMinutes(dense)
        setSelected(best)
        await plugin.storage.set('lastDay', ymd(day)).catch(() => {})
      } catch (e) { if (alive) setError(e instanceof Error ? e.message : String(e)) }
      finally { if (alive) setLoading(false) }
    })()
    return () => { alive = false }
  }, [day, initialized, attempt])
  useEffect(() => {
    if (initialized) void plugin.storage.set('lastView', view).catch(() => {})
  }, [view, initialized])
  const changeDay = (next) => { if (!loading) setDay(clampToToday(next)) }
  const selectBlockProps = (index) => ({
    tabIndex: 0,
    role: 'button',
    'aria-label': `${nameOf(blocks[index].active)} ${hhmm(blocks[index].startTs)}–${hhmm(blocks[index].endTs)}，${durZh(blocks[index].mins)}`,
    'aria-pressed': index === selected,
    onMouseEnter: () => setSelected(index),
    onClick: () => setSelected(index),
    onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(index) } },
  })
  const legend = () => h('div', { className: 'hm-legend' }, [['active', '专注/活跃'], ['rest', '休息/睡眠'], ['empty', '未记录']].map(([kind, label]) => h('span', { key: kind }, h('i', { className: 'hm-dot', style: { background: COLOR[kind] } }), label)))
  const details = (className) => h('div', { className, 'aria-live': 'polite' }, selectedBlock
    ? [h('span', { key: 'kind', className: `hm-badge ${kindOf(selectedBlock.active)}` }, nameOf(selectedBlock.active)), h('p', { key: 'range', className: 'hm-range' }, `${hhmm(selectedBlock.startTs)} – ${hhmm(selectedBlock.endTs)}`), h('p', { key: 'duration', className: 'hm-dur' }, durZh(selectedBlock.mins))]
    : h('p', { className: 'hm-dur' }, '当天没有记录'))
  const renderRing = () => h('div', { className: 'hm-ring-wrap' },
    h('div', { className: 'hm-ring-stage' },
      h('svg', { className: 'hm-ring', viewBox: '0 0 320 320', 'aria-label': '全天作息环形表盘' },
        h('defs', null, h('filter', { id: filterId, x: '-20%', y: '-20%', width: '140%', height: '140%' }, h('feDropShadow', { dx: 0, dy: 6, stdDeviation: 8, floodColor: '#8b5cf6', floodOpacity: .14 }))),
        h('g', { filter: `url(#${filterId})` }, blocks.map((block, index) => h('path', { key: block.startIdx, d: arcPath(160, 160, 118, block.startIdx, block.endIdx), fill: 'none', stroke: colorOf(block.active), strokeWidth: 36, strokeLinecap: 'round', className: selectedBlock && index !== selected ? 'is-dim' : '', ...selectBlockProps(index) })))),
      details('hm-center')),
    legend())
  const renderTimeline = () => h('div', null,
    h('div', { className: 'hm-axis', 'aria-label': '全天单轴时间线' }, blocks.map((block, index) => h('i', { key: block.startIdx, className: index === selected ? 'is-on' : '', style: { flexGrow: block.mins, background: colorOf(block.active) }, ...selectBlockProps(index) }))),
    h('div', { className: 'hm-hours' }, ['00', '06', '12', '18', '24'].map((label) => h('span', { key: label }, label))),
    details('hm-detail'), legend())
  const renderCards = () => h('div', { className: 'hm-flow' }, blocks.map((block, index) => h('div', { key: block.startIdx, className: `hm-flow-item${index === selected ? ' is-on' : ''}`, ...selectBlockProps(index) },
    h('i', { className: 'hm-flow-bar', style: { background: colorOf(block.active) } }),
    h('span', { className: 'hm-flow-time' }, `${hhmm(block.startTs)} – ${hhmm(block.endTs)}`),
    h('span', { className: 'hm-flow-name' }, nameOf(block.active)), h('span', { className: 'hm-flow-dur' }, hmLabel(block.mins)))))
  return h('div', { className: 'hm' },
    h('div', { className: 'hm-bar' },
      h('div', { className: 'hm-nav' },
        h('button', { type: 'button', className: 'hm-round', 'aria-label': '前一天', disabled: loading, onClick: () => changeDay(addDays(day, -1)) }, iconChevron('left')),
        h('input', { className: 'hm-picker', type: 'date', value: ymd(day), max: ymd(todayLocal()), 'aria-label': '选择日期', disabled: loading, onChange: (e) => { const next = parseYmd(e.target.value); if (next) changeDay(next) } }),
        h('span', { className: 'hm-week' }, `周${WEEKDAYS[day.getDay()]}`),
        h('button', { type: 'button', className: 'hm-round', 'aria-label': '后一天', disabled: loading || isToday, onClick: () => changeDay(addDays(day, 1)) }, iconChevron('right')),
        h('button', { type: 'button', className: 'hm-today', disabled: loading || isToday, onClick: () => changeDay(todayLocal()) }, '今天')),
      h('div', { className: 'hm-stats' }, h('span', { className: 'hm-stat' }, h('i', { className: 'hm-dot', style: { background: COLOR.active } }), '专注活跃 ', h('b', null, hmLabel(stats.active))), h('span', { className: 'hm-stat' }, h('i', { className: 'hm-dot', style: { background: COLOR.rest } }), '休息睡眠 ', h('b', null, hmLabel(stats.rest)))),
      h('div', { className: 'hm-seg', role: 'group', 'aria-label': '作息视图' }, VIEWS.map((entry) => h('button', { key: entry.id, type: 'button', className: view === entry.id ? 'is-on' : '', 'aria-pressed': view === entry.id, onClick: () => setView(entry.id) }, entry.label)))),
    h('div', { className: 'hm-card', 'aria-busy': loading },
      error ? h('div', { className: 'hm-err', role: 'alert' }, error, h('button', { type: 'button', onClick: () => setAttempt((n) => n + 1) }, '重试')) : null,
      loading ? h('p', { className: 'hm-dur', role: 'status' }, '加载中…') : view === 'ring' ? renderRing() : view === 'timeline' ? renderTimeline() : renderCards()))
}
