/** Timer settings: self-contained React function component, injected plugin facade. */
const React = globalThis.__CATRACE_REACT__
if (!React?.createElement) throw new Error('Catrace React runtime missing (__CATRACE_REACT__)')
const { createElement: h, useState, useEffect, useMemo, useRef } = React
const MAX_RULES = 20
const MAX_DAILY_TIMES = 8
const MIN_INTERVAL = 1
const MAX_INTERVAL = 24 * 60
const MIN_CARD_SEC = 3
const MAX_CARD_SEC = 600
const DEFAULT_CARD_SEC = 8
const CSS = `
.timer-settings{width:100%;min-width:0;display:flex;flex-direction:column;gap:.75rem;color:var(--ct-text,#2e1065)}
.timer-settings *{box-sizing:border-box}
.timer-settings .header-row,.timer-settings .group-head,.timer-settings .rule-header{display:flex;align-items:center;justify-content:space-between;gap:.75rem;flex-wrap:wrap}
.timer-settings .header-title,.timer-settings .group-label{margin:0;font-size:.75rem;font-weight:600;color:var(--ct-text-muted,#8b7aab);display:flex;align-items:center;gap:.5rem}
.timer-settings .header-actions,.timer-settings .rule-title-row,.timer-settings .rule-acts{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;min-width:0}
.timer-settings .group,.timer-settings .rule,.timer-settings .empty{background:var(--ct-surface,#fff);border:1px solid var(--ct-border,#ebe6f2);border-radius:.875rem;padding:1rem 1.25rem}
.timer-settings .list{display:flex;flex-direction:column;gap:.75rem}
.timer-settings .rule{display:flex;flex-direction:column;gap:.625rem}
.timer-settings .rule.is-off{background:var(--ct-surface-2,#f8f7fc);border-style:dashed}
.timer-settings .rule.is-off .rule-title{color:var(--ct-text-muted,#8b7aab)}
.timer-settings .rule.is-editing{border-color:var(--ct-accent,#007aff)}
.timer-settings .rule-title{margin:0;font-size:.875rem;font-weight:600;line-height:1.4}
.timer-settings .rule-desc{margin:0;font-size:.8125rem;color:var(--ct-text-muted,#8b7aab);white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5}
.timer-settings button{font:inherit;font-size:.8125rem;padding:.375rem .625rem;border:1px solid var(--ct-border,#ddd6fe);border-radius:.375rem;color:inherit;background:var(--ct-surface,#fff);cursor:pointer;line-height:1.4}
.timer-settings button:hover:not(:disabled){background:var(--ct-surface-2,#f3f0fa)}
.timer-settings button.primary{background:var(--ct-accent,#007aff);color:#fff;border-color:transparent}
.timer-settings button.danger{color:#b91c1c;border-color:#fecaca}
.timer-settings :disabled{opacity:.5;cursor:default}
.timer-settings input:not([type=checkbox]):not([type=range]):not([type=color]),.timer-settings textarea,.timer-settings select{font:inherit;font-size:.8125rem;color:inherit;background:var(--ct-surface,#fff);border:1px solid var(--ct-border,#d1d5db);border-radius:.375rem;padding:.4375rem .625rem;min-width:0}
.timer-settings input[type=checkbox]{width:1rem;height:1rem;accent-color:var(--ct-accent,#007aff);cursor:pointer}
.timer-settings input[type=range]{accent-color:var(--ct-accent,#007aff);width:8rem}
.timer-settings textarea{resize:vertical}
.timer-settings .timer-tag{display:inline-flex;align-items:center;gap:.25rem;font-size:.6875rem;font-weight:600;padding:.1875rem .4375rem;border-radius:999px;background:var(--ct-surface-2,#f3f0fa);color:var(--ct-text-muted,#6b7280)}
.timer-settings .timer-tag.success{color:#047857;background:#d1fae5}
.timer-settings .timer-tag.daily{color:#b45309;background:#fef3c7}
.timer-settings .timer-tag button{border:0;padding:0 .125rem;background:transparent}
.timer-settings .rule-editor{display:flex;flex-direction:column;gap:.625rem;padding-top:.75rem;border-top:1px solid var(--ct-border,#ebe6f2)}
.timer-settings .ed-line{display:grid;grid-template-columns:4.75rem minmax(0,1fr);align-items:start;gap:.75rem}
.timer-settings .ed-lab{font-size:.8125rem;font-weight:600;line-height:2rem}
.timer-settings .ed-main{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;min-width:0}
.timer-settings .grow{width:100%;flex:1;min-width:0}
.timer-settings .ed-num{width:5.5rem}
.timer-settings .ed-inline,.timer-settings .ed-switch-pair{display:inline-flex;align-items:center;gap:.375rem;font-size:.8125rem}
.timer-settings .ed-times{display:flex;flex-direction:column;gap:.5rem;width:100%}
.timer-settings .ed-add,.timer-settings .ed-chips,.timer-settings .ed-foot,.timer-settings .delete-confirm{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
.timer-settings .ed-foot{justify-content:flex-end;padding-top:.5rem;border-top:1px solid var(--ct-border,#ebe6f2)}
.timer-settings .ed-color-input{width:2rem;height:1.75rem;border:0;padding:0;background:transparent;cursor:pointer}
.timer-settings .ed-sound-input{flex:1;min-width:8rem}
.timer-settings .ed-empty,.timer-settings .empty{font-size:.8125rem;color:var(--ct-text-muted,#8b7aab)}
.timer-settings .log-list{max-height:8.5rem;overflow:auto;margin-top:.5rem}
.timer-settings .log-item{display:flex;gap:.5rem;font-size:.75rem;line-height:1.5;padding:.375rem 0}
.timer-settings .log-time{flex-shrink:0;color:var(--ct-text-muted,#8b7aab);font-variant-numeric:tabular-nums}
.timer-settings .log-text{overflow-wrap:anywhere}
.timer-settings .log-item.err{color:#b91c1c}.timer-settings .log-item.warn{color:#b45309}.timer-settings .log-item.ok{color:#047857}
.timer-settings .log-empty{font-size:.75rem;color:var(--ct-text-muted,#8b7aab)}
.timer-settings :focus-visible{outline:.125rem solid var(--ct-accent,#007aff);outline-offset:.125rem}
@media(max-width:36rem){.timer-settings .ed-line{grid-template-columns:1fr;gap:.25rem}}
`
function ensureStyles() {
  if (typeof document === 'undefined') return
  let el = document.getElementById('catrace-plugin-timer-settings-css')
  if (!el) { el = document.createElement('style'); el.id = 'catrace-plugin-timer-settings-css'; document.head.appendChild(el) }
  el.textContent = plugin.theme.css(CSS)
}
function colorInputValue(color) {
  const value = normalizeAccentColor(color) || '#7c3aed'
  return value.length === 4 ? '#' + value.slice(1).split('').map((c) => c + c).join('') : value
}

function newRuleId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `rule_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

function normalizeMode(mode) {
  if (mode === 'daily') return 'daily'
  return 'interval'
}

function wantsResetOnRest(r) {
  return !!(r && r.reset_on_rest)
}

const BUILTIN_EYE_ID = '__builtin_eye__'
const EYE_FIXED = {
  title: '护眼提醒',
  mode: 'interval',
  interval_minutes: 20,
  reset_on_rest: true,
  daily_times: [],
}

function isEyeRule(r) {
  return !!(r && (r.builtin === 'eye' || r.id === BUILTIN_EYE_ID))
}

function applyEyeFixed(rule) {
  if (!rule) return rule
  rule.id = BUILTIN_EYE_ID
  rule.builtin = 'eye'
  rule.title = EYE_FIXED.title
  rule.mode = EYE_FIXED.mode
  // interval_minutes is user-tunable for the eye sample
  rule.reset_on_rest = EYE_FIXED.reset_on_rest
  rule.daily_times = []
  if (rule.interval_minutes == null || !Number.isFinite(Number(rule.interval_minutes))) {
    rule.interval_minutes = EYE_FIXED.interval_minutes
  } else {
    rule.interval_minutes = clamp(rule.interval_minutes, MIN_INTERVAL, MAX_INTERVAL)
  }
  return rule
}

function isValidHexColor(s) {
  if (typeof s !== 'string') return false
  return /^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$/.test(s.trim())
}

function normalizeAccentColor(s) {
  const v = String(s || '').trim().toLowerCase()
  return isValidHexColor(v) ? v : ''
}

function createRule(partial = {}) {
  return {
    id: newRuleId(),
    enabled: true,
    title: '',
    body: '',
    mode: 'interval',
    interval_minutes: 60,
    reset_on_rest: false,
    sticky: false,
    card_duration_sec: DEFAULT_CARD_SEC,
    daily_times: [],
    last_fired_at: null,
    last_daily_keys: [],
    builtin: null,
    accent_color: '',
    sound_enabled: false,
    sound_path: '',
    sound_volume: 0.8,
    ...partial,
  }
}

function builtinEyeRule() {
  return applyEyeFixed(
    createRule({
      enabled: true,
      body: '远眺一下，放松眼睛。',
      sticky: false,
      card_duration_sec: 25,
      accent_color: '',
      sound_enabled: false,
      sound_path: '',
      sound_volume: 0.8,
    }),
  )
}

function ensureBuiltinEyeRule(settings) {
  if (!Array.isArray(settings.rules)) settings.rules = []
  const eyes = settings.rules.filter((r) => isEyeRule(r))
  const others = settings.rules.filter((r) => !isEyeRule(r))
  let eye
  if (eyes.length) {
    eye = eyes[0]
    applyEyeFixed(eye)
    if (eye.body == null || eye.body === '') eye.body = '远眺一下，放松眼睛。'
    if (eye.card_duration_sec == null) eye.card_duration_sec = 25
    if (eye.sticky == null) eye.sticky = false
    if (eye.enabled == null) eye.enabled = true
  } else {
    eye = builtinEyeRule()
  }
  settings.rules = [eye, ...others]
}

function normalizeHhmm(raw) {
  const m = String(raw || '')
    .trim()
    .match(/^(\d{1,2}):(\d{1,2})$/)
  if (!m) return null
  const hh = Number(m[1])
  const min = Number(m[2])
  if (!Number.isFinite(hh) || !Number.isFinite(min) || hh > 23 || min > 59) return null
  return `${String(hh).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, Number(n) || min))
}

function portableSettings(settings) {
  return {
    enabled: settings.enabled !== false,
    rules: (settings.rules || []).slice(0, MAX_RULES).map((r) => {
      const eye = isEyeRule(r)
      return {
        id: eye ? BUILTIN_EYE_ID : r.id || newRuleId(),
        enabled: r.enabled !== false,
        title: eye ? EYE_FIXED.title : r.title || '',
        body: r.body || '',
        mode: eye ? EYE_FIXED.mode : normalizeMode(r.mode),
        interval_minutes: clamp(
          eye ? (r.interval_minutes || EYE_FIXED.interval_minutes) : (r.interval_minutes || 60),
          MIN_INTERVAL,
          MAX_INTERVAL,
        ),
        reset_on_rest: eye ? EYE_FIXED.reset_on_rest : wantsResetOnRest(r),
        sticky: !!r.sticky,
        card_duration_sec: clamp(r.card_duration_sec || DEFAULT_CARD_SEC, MIN_CARD_SEC, MAX_CARD_SEC),
        daily_times: eye
          ? []
          : (r.daily_times || [])
              .map(normalizeHhmm)
              .filter(Boolean)
              .filter((v, i, a) => a.indexOf(v) === i)
              .sort()
              .slice(0, MAX_DAILY_TIMES),
        builtin: eye ? 'eye' : r.builtin || null,
        last_fired_at: null,
        last_daily_keys: [],
        accent_color: normalizeAccentColor(r.accent_color),
        sound_enabled: !!r.sound_enabled,
        sound_path: (r.sound_path || '').trim(),
        sound_volume: clamp(r.sound_volume == null ? 0.8 : r.sound_volume, 0, 1),
      }
    }),
  }
}


function earliestDailyMinutes(rule) {
  const times = Array.isArray(rule.daily_times) ? rule.daily_times : []
  let min = Number.POSITIVE_INFINITY
  for (const t of times) {
    const m = String(t || '').match(/^(\d{1,2}):(\d{1,2})$/)
    if (!m) continue
    const mins = Number(m[1]) * 60 + Number(m[2])
    if (Number.isFinite(mins) && mins < min) min = mins
  }
  return min
}

function isZh(locale) {
  return String(locale || '').toLowerCase().startsWith('zh')
}

function defaultTitle(locale) {
  return isZh(locale) ? '定时提醒' : 'Timed Reminder'
}

function defaultBody(locale) {
  return isZh(locale) ? '该处理这件事了。' : "It's time for this reminder."
}

function actionLabel(locale, id) {
  const map = {
    zh: { ack: '知道了', snooze_5: '5 分钟后', skip: '跳过' },
    en: { ack: 'Got it', snooze_5: 'Snooze 5m', skip: 'Skip' },
  }
  const table = isZh(locale) ? map.zh : map.en
  return table[id] || id
}

async function getLocale() {
  try {
    if (plugin.i18n && typeof plugin.i18n.getLocale === 'function') {
      const lang = String((await plugin.i18n.getLocale()) || '').trim()
      if (lang) return isZh(lang) ? 'zh-CN' : 'en-US'
    }
  } catch {
    /* ignore */
  }
  return 'zh-CN'
}

function compareRules(a, b) {
  // 1) enabled first
  const ae = a.enabled !== false ? 1 : 0
  const be = b.enabled !== false ? 1 : 0
  if (ae !== be) return be - ae

  // 2) interval before daily
  const am = normalizeMode(a.mode) === 'daily' ? 1 : 0
  const bm = normalizeMode(b.mode) === 'daily' ? 1 : 0
  if (am !== bm) return am - bm

  // 3) interval: by minutes asc; daily: by earliest time asc
  if (am === 0) {
    const ai = clamp(a.interval_minutes || 0, MIN_INTERVAL, MAX_INTERVAL)
    const bi = clamp(b.interval_minutes || 0, MIN_INTERVAL, MAX_INTERVAL)
    if (ai !== bi) return ai - bi
  } else {
    const at = earliestDailyMinutes(a)
    const bt = earliestDailyMinutes(b)
    if (at !== bt) return at - bt
  }

  // stable-ish fallback: title
  return String(a.title || '').localeCompare(String(b.title || ''), 'zh')
}

function ruleMetaParts(rule) {
  const stayLabel = rule.sticky
    ? '卡片常驻'
    : `停留 ${clamp(rule.card_duration_sec || DEFAULT_CARD_SEC, MIN_CARD_SEC, MAX_CARD_SEC)}s`
  let schedule = { kind: 'interval', label: '未设置时间点' }
  if (rule.mode === 'interval') {
    schedule = { kind: 'interval', label: `每 ${rule.interval_minutes} 分钟` }
  } else if (rule.daily_times && rule.daily_times.length) {
    schedule = {
      kind: 'daily',
      label:
        rule.daily_times.length === 1
          ? `定点 ${rule.daily_times[0]}`
          : `定点 ${rule.daily_times.join(', ')}`,
    }
  } else {
    schedule = { kind: 'daily', label: '未设置时间点' }
  }
  return {
    schedule,
    stay: stayLabel,
    restReset: rule.mode === 'interval' && !!rule.reset_on_rest,
  }
}


export default function TimerSettings() {
  const [settings, setSettings] = useState({ enabled: true, rules: [] })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [saving, setSaving] = useState(false)
  const [testingId, setTestingId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(() => createRule({ interval_minutes: 20 }))
  const [draftHour, setDraftHour] = useState(9)
  const [draftMinute, setDraftMinute] = useState(0)
  const [logs, setLogs] = useState([])
  const [deleteId, setDeleteId] = useState(null)
  const latest = useRef(settings)
  const pending = useRef(null)
  const timer = useRef(null)
  const queue = useRef(Promise.resolve())
  const mounted = useRef(false)
  const testing = useRef(false)
  const pushLog = (type, text) => {
    if (!mounted.current) return
    setLogs((old) => [{ id: newRuleId(), type, text: String(text), time: new Date().toLocaleTimeString() }, ...old].slice(0, 50))
  }
  const persist = (snapshot) => {
    if (mounted.current) setSaving(true)
    // The host owns enabled. A pending form save must never re-enable a plugin being stopped.
    const { enabled: _enabled, ...portable } = portableSettings(snapshot)
    const result = queue.current.catch(() => {}).then(() => plugin.config.set(portable))
    queue.current = result
    void result.catch((e) => pushLog('err', `保存失败：${String(e)}`)).finally(() => {
      if (mounted.current && queue.current === result) setSaving(false)
    })
    return result
  }
  useEffect(() => {
    mounted.current = true
    ensureStyles()
    return () => {
      mounted.current = false
      if (timer.current) clearTimeout(timer.current)
      if (pending.current) { void persist(pending.current).catch(() => {}); pending.current = null }
    }
  }, [])
  useEffect(() => {
    let alive = true
    setLoading(true)
    setLoadError('')
    void plugin.config.get().then((raw) => {
      if (!alive) return
      const next = portableSettings(raw && typeof raw === 'object' ? raw : { enabled: true, rules: [] })
      ensureBuiltinEyeRule(next)
      latest.current = next
      setSettings(next)
    }).catch((e) => { if (alive) { setLoadError(`加载失败：${String(e)}`); pushLog('err', '加载失败') } }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [attempt])
  const patch = (mutator) => {
    const next = { ...latest.current, rules: latest.current.rules.map((r) => ({ ...r, daily_times: [...(r.daily_times || [])], last_daily_keys: [...(r.last_daily_keys || [])] })) }
    mutator(next)
    latest.current = next
    setSettings(next)
    pending.current = next
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const snapshot = pending.current
      pending.current = null
      if (snapshot) void persist(snapshot).catch(() => {})
    }, 400)
  }
  const updateForm = (update) => setForm((old) => ({ ...old, ...update }))
  const resetDraftTime = () => { setDraftHour(9); setDraftMinute(0) }
  const openCreate = () => {
    if (latest.current.rules.length >= MAX_RULES) { pushLog('warn', `最多 ${MAX_RULES} 条提醒`); return }
    setEditingId('__new__')
    setForm(createRule({ interval_minutes: 20 }))
    resetDraftTime()
    setDeleteId(null)
  }
  const openEdit = (rule) => {
    const next = { ...rule, daily_times: [...(rule.daily_times || [])] }
    if (isEyeRule(next)) applyEyeFixed(next)
    setForm(next)
    setEditingId(rule.id)
    resetDraftTime()
    setDeleteId(null)
  }
  const closeEditor = () => { setEditingId(null); resetDraftTime() }
  const addDailyTime = () => {
    const hh = Math.round(clamp(draftHour, 0, 23)), mm = Math.round(clamp(draftMinute, 0, 59))
    setDraftHour(hh); setDraftMinute(mm)
    const time = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
    if (form.daily_times.includes(time)) { pushLog('warn', '时间点已存在'); return }
    if (form.daily_times.length >= MAX_DAILY_TIMES) { pushLog('warn', `最多 ${MAX_DAILY_TIMES} 个时间点`); return }
    updateForm({ daily_times: [...form.daily_times, time].sort() })
  }
  const saveEditor = () => {
    const existing = latest.current.rules.find((r) => r.id === editingId)
    const eye = isEyeRule(existing)
    if (!eye && form.mode === 'daily' && !form.daily_times.length) { pushLog('err', '请至少添加一个时间点'); return }
    if (editingId === '__new__' && latest.current.rules.length >= MAX_RULES) { pushLog('warn', `最多 ${MAX_RULES} 条提醒`); return }
    const rule = portableSettings({ rules: [{ ...form, id: existing?.id || form.id, enabled: existing ? existing.enabled : true, title: eye ? EYE_FIXED.title : form.title.trim() || '定时提醒', body: existing ? form.body.trim() : form.body.trim() || '该处理这件事了。', reset_on_rest: eye || (form.mode === 'interval' && form.reset_on_rest) }] }).rules[0]
    if (eye) applyEyeFixed(rule)
    patch((next) => {
      if (existing) next.rules = next.rules.map((r) => r.id === existing.id ? rule : r)
      else next.rules.unshift(rule)
    })
    closeEditor()
  }
  const removeRule = (id) => {
    const rule = latest.current.rules.find((r) => r.id === id)
    if (!rule || rule.builtin || isEyeRule(rule)) { pushLog('warn', '内置提醒不可删除'); return }
    patch((next) => { next.rules = next.rules.filter((r) => r.id !== id) })
    setDeleteId(null)
  }
  const playSound = async (rule) => {
    const dir = await plugin.path.getPluginDir()
    return plugin.audio.play(rule.sound_path?.trim() || `${dir}/assets/notify.wav`, { volume: clamp(rule.sound_volume, 0, 1) })
  }
  const playPreview = async () => {
    try { await playSound(form); pushLog('ok', '正在预览') }
    catch (e) { pushLog('err', `预览失败：${String(e)}`) }
  }
  const pickSound = async () => {
    const editor = editingId
    try {
      const path = await plugin.dialog.showOpenDialog({ filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg', 'flac'] }, { name: 'All', extensions: ['*'] }] })
      if (mounted.current && path) {
        // File dialogs are modal; only apply to the editor that initiated the request.
        setForm((old) => old.id === form.id && editor ? { ...old, sound_path: Array.isArray(path) ? path[0] : path } : old)
      }
    } catch (e) { pushLog('err', `选择文件失败：${String(e)}`) }
  }
  const sendTest = async (rule) => {
    if (testing.current) return
    testing.current = true
    setTestingId(rule.id)
    try {
      if (rule.sound_enabled) {
        try { await playSound(rule) } catch (e) { pushLog('warn', `测试提示音失败：${String(e)}`) }
      }
      const locale = await getLocale()
      await plugin.events.publish({
        eventType: 'reminder.timer.due', kind: 'timer', level: 'info',
        title: rule.title.trim() || defaultTitle(locale), body: rule.body.trim() || defaultBody(locale), sticky: !!rule.sticky,
        actions: ['ack', 'snooze_5', 'skip'].map((id) => ({ id, label: actionLabel(locale, id) })),
        payload: { rule_id: rule.id, mode: normalizeMode(rule.mode), auto_hide_ms: rule.sticky ? 0 : clamp(rule.card_duration_sec || DEFAULT_CARD_SEC, MIN_CARD_SEC, MAX_CARD_SEC) * 1000, card_duration_sec: clamp(rule.card_duration_sec || DEFAULT_CARD_SEC, MIN_CARD_SEC, MAX_CARD_SEC), accent_color: normalizeAccentColor(rule.accent_color) },
        dedupeKey: `reminder.timer.due:${rule.id}`,
      })
      pushLog('ok', '已发送测试通知')
      await new Promise((resolve) => setTimeout(resolve, 1000))
    } catch (e) { pushLog('err', `发送失败：${String(e)}`) }
    finally { testing.current = false; if (mounted.current) setTestingId(null) }
  }
  const rules = useMemo(() => [...settings.rules].sort(compareRules), [settings.rules])
  const creating = editingId === '__new__'
  const button = (text, onClick, options = {}) => h('button', { type: 'button', onClick, ...options }, text)
  const numberInput = (value, onChange, min, max, label, options = {}) => h('input', { type: 'number', className: 'ed-num', value, min, max, step: 1, 'aria-label': label, onChange: (e) => onChange(clamp(e.target.value, min, max)), ...options })
  const checkbox = (label, checked, onChange, options = {}) => h('label', { className: 'ed-switch-pair' }, h('input', { type: 'checkbox', checked, onChange: (e) => onChange(e.target.checked), ...options }), label)
  const row = (label, content) => h('div', { className: 'ed-line', key: label }, h('span', { className: 'ed-lab' }, label), h('div', { className: 'ed-main' }, content))
  const tag = (text, kind = '') => h('span', { className: `timer-tag ${kind}`, key: text }, text)
  const renderEditor = () => {
    const eye = isEyeRule(settings.rules.find((r) => r.id === editingId))
    return h('div', { className: 'rule-editor' },
      row('标题', eye ? h('span', { className: 'ed-readonly' }, EYE_FIXED.title) : h('input', { className: 'grow', value: form.title, placeholder: '例如：护眼提醒', onChange: (e) => updateForm({ title: e.target.value }) })),
      row('正文', h('textarea', { className: 'grow', rows: 2, value: form.body, placeholder: '远眺一下，放松眼睛。', onChange: (e) => updateForm({ body: e.target.value }) })),
      row('触发', h(React.Fragment, null,
        eye ? tag('时间间隔') : h('select', { value: form.mode, 'aria-label': '提醒方式', onChange: (e) => updateForm({ mode: e.target.value }) }, h('option', { value: 'interval' }, '时间间隔'), h('option', { value: 'daily' }, '每日定点')),
        eye || form.mode === 'interval' ? h(React.Fragment, null,
          h('span', { className: 'ed-inline' }, '每 ', numberInput(form.interval_minutes, (v) => updateForm({ interval_minutes: v }), MIN_INTERVAL, MAX_INTERVAL, '间隔分钟'), ' 分钟'),
          eye ? tag('休息重置', 'success') : checkbox('休息重置', !!form.reset_on_rest, (v) => updateForm({ reset_on_rest: v }), { title: '无电脑操作时，从休息结束后重新计时' }))
          : h('div', { className: 'ed-times' },
            h('div', { className: 'ed-chips' }, form.daily_times.length ? form.daily_times.map((time) => h('span', { className: 'timer-tag', key: time }, time, button('×', () => updateForm({ daily_times: form.daily_times.filter((t) => t !== time) }), { 'aria-label': `删除时间点 ${time}` }))) : h('span', { className: 'ed-empty' }, '尚未添加时间点')),
            h('div', { className: 'ed-add', onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); addDailyTime() } } }, numberInput(draftHour, setDraftHour, 0, 23, '小时'), '时', numberInput(draftMinute, setDraftMinute, 0, 59, '分钟'), '分', button('添加', addDailyTime, { disabled: form.daily_times.length >= MAX_DAILY_TIMES }))))),
      row('通知', h(React.Fragment, null, checkbox('卡片常驻', !!form.sticky, (v) => updateForm({ sticky: v })), !form.sticky ? h('span', { className: 'ed-inline' }, '停留 ', numberInput(form.card_duration_sec, (v) => updateForm({ card_duration_sec: v }), MIN_CARD_SEC, MAX_CARD_SEC, '停留秒数'), ' 秒') : null)),
      row('颜色', h(React.Fragment, null, h('input', { type: 'color', value: colorInputValue(form.accent_color), className: 'ed-color-input', 'aria-label': '卡片颜色', onChange: (e) => updateForm({ accent_color: e.target.value }) }), form.accent_color ? button('恢复默认', () => updateForm({ accent_color: '' })) : null)),
      row('提示音', checkbox('触发时播放提示音', !!form.sound_enabled, (v) => updateForm({ sound_enabled: v }))),
      form.sound_enabled ? row('音量', h(React.Fragment, null, h('input', { type: 'range', min: 0, max: 1, step: .05, value: form.sound_volume, 'aria-label': '提示音音量', onChange: (e) => updateForm({ sound_volume: Number(e.target.value) }) }), h('span', null, `${Math.round(form.sound_volume * 100)}%`))) : null,
      form.sound_enabled ? row('音频', h(React.Fragment, null, h('input', { className: 'ed-sound-input', readOnly: true, value: form.sound_path || '使用默认提示音', 'aria-label': '提示音文件' }), button(form.sound_path ? '更换' : '选择', pickSound), form.sound_path ? button('恢复默认', () => updateForm({ sound_path: '' })) : null, button('预览', playPreview))) : null,
      h('div', { className: 'ed-foot' }, button('取消', closeEditor), button(creating ? '创建' : '保存', saveEditor, { className: 'primary' })))
  }
  return h('div', { className: 'timer-settings', 'aria-busy': loading },
    h('div', { className: 'header-row' }, h('h3', { className: 'header-title' }, '提醒列表 ', tag(String(rules.length))), h('div', { className: 'header-actions' }, saving ? h('span', { role: 'status' }, '保存中…') : null, button('新建提醒', openCreate, { className: 'primary', disabled: loading || !!loadError || creating || rules.length >= MAX_RULES }))),
    loadError ? h('div', { className: 'empty', role: 'alert' }, loadError, button('重试', () => setAttempt((n) => n + 1))) : null,
    h('div', { className: 'list' },
      creating ? h('section', { className: 'rule create-card is-editing' }, h('h3', { className: 'rule-title' }, '新建提醒'), renderEditor()) : null,
      loading ? h('div', { className: 'empty' }, '加载中…') : rules.map((rule) => {
        const editing = editingId === rule.id
        const meta = ruleMetaParts(rule)
        return h('section', { key: rule.id, className: `rule${rule.enabled ? '' : ' is-off'}${editing ? ' is-editing' : ''}` },
          h('div', { className: 'rule-header' }, h('div', { className: 'rule-title-row' }, h('h3', { className: 'rule-title' }, rule.title || '定时提醒'), !editing ? h(React.Fragment, null, tag(meta.schedule.label, meta.schedule.kind), tag(meta.stay), meta.restReset ? tag('休息重置', 'success') : null) : null),
            h('div', { className: 'rule-acts' }, editing ? button('收起', closeEditor) : h(React.Fragment, null,
              button(testingId === rule.id ? '…' : '测试', () => void sendTest(rule), { disabled: !!testingId || creating }),
              button('编辑', () => openEdit(rule), { disabled: creating }),
              !rule.builtin && !isEyeRule(rule) ? button('删除', () => setDeleteId(rule.id), { className: 'danger', disabled: creating }) : null),
              h('input', { type: 'checkbox', role: 'switch', checked: !!rule.enabled, disabled: editing || creating, 'aria-label': `启用 ${rule.title || '定时提醒'}`, onChange: (e) => patch((next) => { const target = next.rules.find((r) => r.id === rule.id); if (target) target.enabled = e.target.checked }) }))),
          deleteId === rule.id ? h('div', { className: 'delete-confirm', role: 'group', 'aria-label': '删除确认' }, `确认删除「${rule.title || '定时提醒'}」？此操作不可撤销。`, button('取消', () => setDeleteId(null)), button('删除', () => removeRule(rule.id), { className: 'danger' })) : null,
          editing ? renderEditor() : rule.enabled && rule.body ? h('p', { className: 'rule-desc' }, rule.body) : null)
      })),
    h('section', { className: 'group' }, h('div', { className: 'group-head' }, h('h3', { className: 'group-label' }, '运行日志'), logs.length ? button('清空', () => setLogs([])) : null), h('div', { className: 'log-list', role: 'log' }, logs.length ? logs.map((entry) => h('div', { key: entry.id, className: `log-item ${entry.type}` }, h('span', { className: 'log-time' }, entry.time), h('span', { className: 'log-text' }, entry.text))) : h('div', { className: 'log-empty' }, '暂无日志'))))
}
