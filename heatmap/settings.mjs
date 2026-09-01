/** History rest/focus visualization — ring / timeline / flow cards. */
const vue = globalThis.__CATRACE_VUE__ || {}
const naive = globalThis.__CATRACE_NAIVE__ || {}
const { h, ref, computed, onMounted } = vue
const { NDatePicker, useMessage } = naive

if (typeof h !== 'function' || typeof ref !== 'function') {
  throw new Error('Catrace plugin Vue runtime missing (__CATRACE_VUE__.h)')
}
if (!NDatePicker || !useMessage) {
  throw new Error('Catrace plugin naive runtime missing (__CATRACE_NAIVE__)')
}
if (!plugin || !plugin.activity) {
  throw new Error('Catrace plugin API missing (plugin facade)')
}

const MINUTES = 1440
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
const COLOR = { active: '#8B5CF6', rest: '#10B981', empty: '#E8EDF5' }
const VIEWS = [
  { id: 'timeline', label: '单轴时间线' },
  { id: 'ring', label: '环形表盘' },
  { id: 'cards', label: '作息流卡片' },
]
const STYLE_ID = 'catrace-plugin-heatmap-settings-css'
const CSS = `
.hm {
  width: 100%; box-sizing: border-box;
  display: flex; flex-direction: column; gap: 0.875rem;
  color: #4c1d95;
}
.hm *, .hm *::before, .hm *::after { box-sizing: border-box; }
.hm-bar {
  display: flex; align-items: center; gap: 0.75rem 1.25rem; flex-wrap: wrap;
  padding: 0.625rem 0.875rem 0.625rem 0.75rem; background: #fff;
  border: 0.0625rem solid #efeaf8; border-radius: 1.25rem;
  box-shadow: 0 0.5rem 1.25rem rgba(76, 29, 149, 0.045);
}
.hm-nav { display: flex; align-items: center; gap: 0.375rem; flex-wrap: wrap; }
.hm-picker { width: 10.5rem; flex-shrink: 0; }
.hm-picker .n-input {
  --n-height: 2.25rem !important;
  --n-border-radius: 0.75rem !important;
  background: #f6f3fc !important;
  font-weight: 700;
}
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
  display: flex; align-items: center; gap: 1.25rem;
  flex: 1; justify-content: flex-end; min-width: 0;
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
  display: inline-flex; align-items: center; gap: 0.125rem;
  padding: 0.1875rem; background: #f3f0fa;
  border-radius: 999px; flex-shrink: 0;
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
@media (max-width: 52rem) {
  .hm-stats { justify-content: flex-start; flex-basis: 100%; order: 3; }
  .hm-seg { margin-left: auto; }
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
  el.textContent = CSS
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
  return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2.2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, [
    h('path', { d }),
  ])
}

export default {
  name: 'HeatmapSettings',
  setup() {
    ensureStyles()
    useMessage()
    const loading = ref(false)
    const error = ref('')
    const day = ref(todayLocal())
    const minutes = ref([])
    const view = ref('ring')
    const selected = ref(0)

    const isToday = computed(() => ymd(day.value) === ymd(todayLocal()))
    const blocks = computed(() => mergeBlocks(minutes.value))
    const stats = computed(() => {
      let active = 0
      let rest = 0
      for (const m of minutes.value) {
        if (m.active === true) active += 1
        else if (m.active === false) rest += 1
      }
      return { active, rest }
    })
    const selectedBlock = computed(() => blocks.value[selected.value] || blocks.value[0] || null)

    function pickDefault(list) {
      let best = 0
      let bestMins = -1
      list.forEach((b, i) => {
        if (b.active === false && b.mins > bestMins) {
          best = i
          bestMins = b.mins
        }
      })
      if (bestMins < 0 && list.length) best = 0
      selected.value = best
    }

    async function persist() {
      try {
        await plugin.storage.set('lastDay', ymd(day.value))
        await plugin.storage.set('lastView', view.value)
      } catch {
        /* ignore */
      }
    }

    async function loadDay(next) {
      const target = clampToToday(next)
      day.value = target
      error.value = ''
      if (typeof plugin.activity.getRecords !== 'function') {
        error.value = '当前 Catrace 没有历史记录 API，请更新并重启宿主。'
        minutes.value = densify(startOfLocalDay(target), [])
        pickDefault(blocks.value)
        return
      }
      loading.value = true
      try {
        const from = startOfLocalDay(target)
        const rows = await plugin.activity.getRecords({ from, to: from + MINUTES * 60 })
        minutes.value = densify(from, Array.isArray(rows) ? rows : [])
        pickDefault(mergeBlocks(minutes.value))
        await persist()
      } catch (e) {
        minutes.value = densify(startOfLocalDay(target), [])
        error.value = e instanceof Error ? e.message : String(e)
      } finally {
        loading.value = false
      }
    }

    function setView(id) {
      view.value = id
      persist()
    }

    onMounted(async () => {
      let initial = todayLocal()
      try {
        const saved = await plugin.storage.get('lastDay')
        const parsed = parseYmd(saved)
        if (parsed) initial = parsed
        const v = await plugin.storage.get('lastView')
        if (VIEWS.some((x) => x.id === v)) view.value = v
      } catch {
        /* ignore */
      }
      await loadDay(initial)
    })

    function renderRing() {
      const cx = 160
      const cy = 160
      const r = 118
      const list = blocks.value
      const sel = selectedBlock.value
      const paths = list.map((b, i) =>
        h('path', {
          d: arcPath(cx, cy, r, b.startIdx, b.endIdx),
          fill: 'none',
          stroke: colorOf(b.active),
          'stroke-width': 36,
          'stroke-linecap': 'round',
          class: sel && i !== selected.value ? 'is-dim' : '',
          onMouseenter: () => {
            selected.value = i
          },
          onClick: () => {
            selected.value = i
          },
        }),
      )
      const k = sel ? kindOf(sel.active) : 'empty'
      return h('div', { class: 'hm-ring-wrap' }, [
        h('div', { class: 'hm-ring-stage' }, [
          h('svg', { class: 'hm-ring', viewBox: '0 0 320 320' }, [
            h('defs', [
              h('filter', { id: 'hm-shadow', x: '-20%', y: '-20%', width: '140%', height: '140%' }, [
                h('feDropShadow', { dx: '0', dy: '6', stdDeviation: '8', 'flood-color': '#8b5cf6', 'flood-opacity': '0.14' }),
              ]),
            ]),
            h('g', { filter: 'url(#hm-shadow)' }, paths),
          ]),
          h('div', { class: 'hm-center' }, sel
            ? [
                h('span', { class: `hm-badge ${k}` }, nameOf(sel.active)),
                h('p', { class: 'hm-range' }, `${hhmm(sel.startTs)}  -  ${hhmm(sel.endTs)}`),
                h('p', { class: 'hm-dur' }, durZh(sel.mins)),
              ]
            : [h('p', { class: 'hm-dur' }, '当天没有记录')]),
        ]),
        h('div', { class: 'hm-legend' }, [
          h('span', [h('i', { class: 'hm-dot', style: { background: COLOR.active } }), '专注/活跃']),
          h('span', [h('i', { class: 'hm-dot', style: { background: COLOR.rest } }), '休息/睡眠']),
          h('span', [h('i', { class: 'hm-dot', style: { background: COLOR.empty } }), '未记录']),
        ]),
      ])
    }

    function renderTimeline() {
      return h('div', [
        h('div', { class: 'hm-axis' }, blocks.value.map((b, i) =>
          h('i', {
            class: i === selected.value ? 'is-on' : '',
            style: { flexGrow: String(b.mins), background: colorOf(b.active) },
            onMouseenter: () => {
              selected.value = i
            },
            onClick: () => {
              selected.value = i
            },
          }),
        )),
        h('div', { class: 'hm-hours' }, ['00', '06', '12', '18', '24'].map((t) => h('span', t))),
        selectedBlock.value
          ? h('div', { class: 'hm-detail' }, [
              h('span', { class: `hm-badge ${kindOf(selectedBlock.value.active)}` }, nameOf(selectedBlock.value.active)),
              h('p', { class: 'hm-range' }, `${hhmm(selectedBlock.value.startTs)}  -  ${hhmm(selectedBlock.value.endTs)}`),
              h('p', { class: 'hm-dur' }, durZh(selectedBlock.value.mins)),
            ])
          : null,
        h('div', { class: 'hm-legend' }, [
          h('span', [h('i', { class: 'hm-dot', style: { background: COLOR.active } }), '专注/活跃']),
          h('span', [h('i', { class: 'hm-dot', style: { background: COLOR.rest } }), '休息/睡眠']),
          h('span', [h('i', { class: 'hm-dot', style: { background: COLOR.empty } }), '未记录']),
        ]),
      ])
    }

    function renderCards() {
      return h('div', { class: 'hm-flow' }, blocks.value.map((b, i) =>
        h('div', {
          class: ['hm-flow-item', i === selected.value ? 'is-on' : ''],
          onClick: () => {
            selected.value = i
          },
        }, [
          h('i', { class: 'hm-flow-bar', style: { background: colorOf(b.active) } }),
          h('span', { class: 'hm-flow-time' }, `${hhmm(b.startTs)} – ${hhmm(b.endTs)}`),
          h('span', { class: 'hm-flow-name' }, nameOf(b.active)),
          h('span', { class: 'hm-flow-dur' }, hmLabel(b.mins)),
        ]),
      ))
    }

    return () =>
      h('div', { class: 'hm' }, [
        h('div', { class: 'hm-bar' }, [
          h('div', { class: 'hm-nav' }, [
            h('button', {
              type: 'button',
              class: 'hm-round',
              'aria-label': '前一天',
              disabled: loading.value,
              onClick: () => loadDay(addDays(day.value, -1)),
            }, [iconChevron('left')]),
            h(NDatePicker, {
              class: 'hm-picker',
              value: day.value.getTime(),
              type: 'date',
              format: 'yyyy/MM/dd',
              clearable: false,
              inputReadonly: true,
              bordered: false,
              size: 'medium',
              disabled: loading.value,
              actions: null,
              placeholder: '选择日期',
              isDateDisabled: (ts) => ts > todayLocal().getTime(),
              'onUpdate:value': (v) => {
                if (typeof v === 'number') loadDay(new Date(v))
              },
            }),
            h('span', { class: 'hm-week' }, `周${WEEKDAYS[day.value.getDay()]}`),
            h('button', {
              type: 'button',
              class: 'hm-round',
              'aria-label': '后一天',
              disabled: loading.value || isToday.value,
              onClick: () => loadDay(addDays(day.value, 1)),
            }, [iconChevron('right')]),
            h('button', {
              type: 'button',
              class: 'hm-today',
              disabled: loading.value || isToday.value,
              onClick: () => loadDay(todayLocal()),
            }, '今天'),
          ]),
          h('div', { class: 'hm-stats' }, [
            h('span', { class: 'hm-stat' }, [
              h('i', { class: 'hm-dot', style: { background: COLOR.active } }),
              '专注活跃 ',
              h('b', hmLabel(stats.value.active)),
            ]),
            h('span', { class: 'hm-stat' }, [
              h('i', { class: 'hm-dot', style: { background: COLOR.rest } }),
              '休息睡眠 ',
              h('b', hmLabel(stats.value.rest)),
            ]),
          ]),
          h('div', { class: 'hm-seg' }, VIEWS.map((v) =>
            h('button', {
              type: 'button',
              class: view.value === v.id ? 'is-on' : '',
              onClick: () => setView(v.id),
            }, v.label),
          )),
        ]),
        h('div', { class: 'hm-card' }, [
          error.value ? h('p', { class: 'hm-err' }, error.value) : null,
          view.value === 'ring' ? renderRing() : view.value === 'timeline' ? renderTimeline() : renderCards(),
        ]),
      ])
  },
}
