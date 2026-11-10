/** Interval demo settings: React hooks and the injected plugin facade. */
const React = globalThis.__CATRACE_REACT__
if (!React?.createElement) throw new Error('Catrace React runtime missing (__CATRACE_REACT__)')
const { createElement: h, useState, useRef, useEffect } = React
const MIN_INTERVAL_MS = 50
const MAX_INTERVAL_MS = 86_400_000
const DEFAULT_INTERVAL_MS = 30_000
const DEFAULTS = { intervalMs: DEFAULT_INTERVAL_MS, onlyWhenActive: true, title: '间隔通知', body: '这是第 {count} 条间隔通知。' }
const CSS = `
.notify-demo-settings{width:100%;display:flex;flex-direction:column;gap:.75rem;color:var(--ct-text,#111827)}
.notify-demo-settings *{box-sizing:border-box}
.notify-demo-settings .card{padding:1rem 1.25rem;border:1px solid var(--ct-border,#e5e7eb);border-radius:.875rem;background:var(--ct-surface,#fff);display:flex;flex-direction:column;gap:.75rem}
.notify-demo-settings h2{margin:0;font-size:.9375rem;font-weight:600}
.notify-demo-settings p{margin:0;font-size:.8125rem;line-height:1.55;color:var(--ct-text-muted,#6b7280)}
.notify-demo-settings .field{display:flex;flex-direction:column;gap:.375rem;min-width:0;font-size:.8125rem}
.notify-demo-settings input:not([type=checkbox]),.notify-demo-settings textarea{width:100%;min-width:0;font:inherit;color:inherit;background:var(--ct-surface,#fff);border:1px solid var(--ct-border,#d1d5db);border-radius:.375rem;padding:.5rem .625rem}
.notify-demo-settings textarea{resize:vertical}
.notify-demo-settings .row{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;font-size:.8125rem}
.notify-demo-settings button{font:inherit;padding:.5rem .75rem;border:0;border-radius:.375rem;background:var(--ct-accent,#007aff);color:#fff;cursor:pointer}
.notify-demo-settings :disabled{opacity:.5;cursor:default}
.notify-demo-settings .error{color:#b91c1c}
.notify-demo-settings .meta{font-size:.75rem;color:var(--ct-text-muted,#6b7280)}
.notify-demo-settings :focus-visible{outline:.125rem solid var(--ct-accent,#007aff);outline-offset:.125rem}
`
function ensureStyles() {
  if (typeof document === 'undefined') return
  let el = document.getElementById('catrace-plugin-notify-demo-settings-css')
  if (!el) { el = document.createElement('style'); el.id = 'catrace-plugin-notify-demo-settings-css'; document.head.appendChild(el) }
  el.textContent = plugin.theme.css(CSS)
}
function clamp(value) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.round(n))) : DEFAULT_INTERVAL_MS
}
function portable(config) {
  return { intervalMs: clamp(config.intervalMs), onlyWhenActive: config.onlyWhenActive !== false, title: config.title.trim() || '间隔通知', body: config.body.trim() || '间隔通知已触发。' }
}
export default function NotifyDemoSettings() {
  const [config, setConfig] = useState(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [sent, setSent] = useState({ count: 0, at: '' })
  const latest = useRef(DEFAULTS)
  const pending = useRef(null)
  const timer = useRef(null)
  const queue = useRef(Promise.resolve())
  const mounted = useRef(false)
  const testingRef = useRef(false)
  const persist = (snapshot) => {
    if (mounted.current) setSaving(true)
    const result = queue.current.catch(() => {}).then(() => plugin.config.set(portable(snapshot)))
    queue.current = result
    void result.catch((e) => { if (mounted.current) setError(`保存失败：${String(e)}`) }).finally(() => {
      if (mounted.current && queue.current === result) setSaving(false)
    })
    return result
  }
  useEffect(() => {
    mounted.current = true
    ensureStyles()
    void plugin.config.get().then((raw) => {
      if (!mounted.current) return
      const s = raw || {}
      const next = {
        intervalMs: clamp(s.intervalMs ?? (s.intervalSec == null ? DEFAULT_INTERVAL_MS : Number(s.intervalSec) * 1000)),
        onlyWhenActive: s.onlyWhenActive !== false && s.onlyWhenActive !== 0,
        title: typeof s.title === 'string' && s.title.trim() ? s.title : DEFAULTS.title,
        body: typeof s.body === 'string' && s.body.trim() ? s.body : DEFAULTS.body,
      }
      latest.current = next
      setConfig(next)
    }).catch((e) => { if (mounted.current) setError(`加载失败：${String(e)}`) }).finally(() => { if (mounted.current) setLoading(false) })
    return () => {
      mounted.current = false
      if (timer.current) clearTimeout(timer.current)
      if (pending.current) { void persist(pending.current).catch(() => {}); pending.current = null }
    }
  }, [])
  const update = (patch) => {
    const next = { ...latest.current, ...patch }
    latest.current = next
    setConfig(next)
    setError('')
    pending.current = next
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const snapshot = pending.current
      pending.current = null
      if (snapshot) void persist(snapshot).catch(() => {})
    }, 400)
  }
  const sendNow = async () => {
    if (testingRef.current || loading) return
    testingRef.current = true
    setTesting(true)
    setError('')
    try {
      const cfg = portable(latest.current)
      const count = sent.count + 1
      await plugin.events.publish({ eventType: 'notify-demo.send', kind: 'notify-demo', title: cfg.title, body: cfg.body.replace(/\{count\}/g, String(count)), level: 'info', payload: { count, intervalMs: cfg.intervalMs, manual: true } })
      if (mounted.current) { setSent({ count, at: new Date().toLocaleTimeString() }); setStatus('通知已发送') }
    } catch (e) { if (mounted.current) setError(`发送失败：${String(e)}`) }
    finally { testingRef.current = false; if (mounted.current) setTesting(false) }
  }
  return h('div', { className: 'notify-demo-settings' }, h('section', { className: 'card', 'aria-busy': loading },
    h('h2', null, '间隔通知'),
    h('p', null, '按设定毫秒数自动 Toast。可只在电脑活跃时发送。正文可用 {count} 表示序号。'),
    error ? h('p', { className: 'error', role: 'alert' }, error) : null,
    h('label', { className: 'field' }, '间隔（毫秒）', h('input', { type: 'number', min: MIN_INTERVAL_MS, max: MAX_INTERVAL_MS, step: 1, value: config.intervalMs, disabled: loading, onChange: (e) => update({ intervalMs: clamp(e.target.value) }) }), h('span', { className: 'meta' }, `范围 ${MIN_INTERVAL_MS}–${MAX_INTERVAL_MS} 毫秒`)),
    h('label', { className: 'row' }, h('input', { type: 'checkbox', checked: config.onlyWhenActive, disabled: loading, onChange: (e) => update({ onlyWhenActive: e.target.checked }) }), '仅活跃时通知', h('span', { className: 'meta' }, config.onlyWhenActive ? '休息/锁屏时不弹' : '始终按间隔弹')),
    h('label', { className: 'field' }, '标题', h('input', { value: config.title, disabled: loading, onChange: (e) => update({ title: e.target.value }) })),
    h('label', { className: 'field' }, '正文', h('textarea', { rows: 2, value: config.body, disabled: loading, onChange: (e) => update({ body: e.target.value }) })),
    h('div', { className: 'row' }, h('button', { type: 'button', disabled: loading || testing, onClick: sendNow }, testing ? '发送中…' : '立即发送'), saving ? h('span', { className: 'meta', role: 'status' }, '保存中…') : null, sent.count > 0 ? h('span', { className: 'meta' }, `本页已发 ${sent.count} 条 · 上次 ${sent.at}`) : null),
    status ? h('span', { className: 'meta', role: 'status' }, status) : null))
}
