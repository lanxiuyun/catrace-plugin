const { createElement: h, useState, useEffect, useRef } = globalThis.__CATRACE_REACT__ || {}
if (typeof h !== 'function' || typeof useState !== 'function') throw new Error('Catrace React runtime missing (__CATRACE_REACT__)')
const { Button, TextField, Switch } = globalThis.__CATRACE_RADIX__ || {}
if (!Button || !TextField || !Switch) throw new Error('Catrace Radix runtime missing (__CATRACE_RADIX__)')

const STYLE_ID = 'catrace-plugin-napcat-qq-settings-css-v1'
const CSS = `
.nq-settings {
  width: 100%; box-sizing: border-box;
  display: flex; flex-direction: column; gap: 0.75rem; color: #374151;
}
.nq-settings * { box-sizing: border-box; }
.nq-settings .card {
  padding: 1rem; border: 1px solid #e5e7eb; border-radius: 0.75rem;
  background: #fff; display: flex; flex-direction: column; gap: 0.625rem;
}
.nq-settings h2 { margin: 0; font-size: 0.9375rem; font-weight: 700; color: #111827; }
.nq-settings p, .nq-settings .hint { margin: 0; font-size: 0.8125rem; line-height: 1.55; color: #4b5563; }
.nq-settings .hint { font-size: 0.6875rem; color: #9ca3af; }
.nq-settings .field { display: flex; flex-direction: column; gap: 0.25rem; }
.nq-settings .label { font-size: 0.75rem; font-weight: 600; color: #6b7280; }
.nq-settings .row { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.nq-settings .status {
  display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 0.75rem;
  padding: 0.625rem 0.75rem; border-radius: 0.5rem; background: #f3f4f6;
  font-size: 0.75rem;
}
`

function ensureStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = plugin.theme.css(CSS)
  document.head.appendChild(el)
}

export default function NapcatQqSettings() {
  const [httpBase, setHttpBase] = useState('http://127.0.0.1:3000')
  const [wsUrl, setWsUrl] = useState('ws://127.0.0.1:3001')
  const [token, setToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [sticky, setSticky] = useState(true)
  const [statusText, setStatusText] = useState('未刷新')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const operation = useRef(false)
  useEffect(() => {
    ensureStyles()
    let alive = true
    void plugin.config.get().then((cfg) => {
      if (!alive || !cfg) return
      if (cfg.httpBase) setHttpBase(cfg.httpBase)
      if (cfg.wsUrl) setWsUrl(cfg.wsUrl)
      if (typeof cfg.token === 'string') setToken(cfg.token)
      setSticky(!(Number(cfg.cardDurationSec) > 0))
    }).catch((error) => console.warn('[napcat-qq] load config', error))
    return () => { alive = false }
  }, [])
  async function run(task) {
    if (operation.current) return
    operation.current = true
    setBusy(true)
    setFeedback(null)
    try { await task() }
    catch (error) { setFeedback({ error: true, text: String(error) }) }
    finally { operation.current = false; setBusy(false) }
  }
  const save = () => run(async () => {
    const cfg = { httpBase: httpBase.trim(), wsUrl: wsUrl.trim(), token: token.trim(), cardDurationSec: sticky ? 0 : 12 }
    await plugin.config.set(cfg)
    if (plugin.sidecar?.request) await plugin.sidecar.request('setConfig', cfg)
    setFeedback({ text: '已保存并同步 sidecar' })
  })
  const refreshStatus = () => run(async () => {
    if (!plugin.sidecar?.request) { setStatusText('sidecar 未运行（先启用插件并刷新）'); return }
    try {
      const st = await plugin.sidecar.request('getStatus')
      setStatusText(`WS ${st?.wsState || '?'} · ${st?.login?.nickname || '-'} (${st?.login?.userId || '-'}) · ${st?.lastError || 'ok'}`)
    } catch (error) { setStatusText(String(error)) }
  })
  const testCard = () => run(async () => {
    if (plugin.sidecar?.request) await plugin.sidecar.request('testCard', {})
    else await plugin.events.publish({ eventType: 'napcat-qq.message', kind: 'napcat-qq', title: '测试好友', body: 'sidecar 未运行时的测试卡。回复 dry-run。', sticky: true, payload: { chatType: 'private', chatId: 'test', senderName: '测试好友' }, dedupeKey: `napcat-qq:test-${Date.now()}` })
    setFeedback({ text: '测试 Toast 已发（chatId=test，不会真发 QQ）' })
  })
  const field = (label, value, change, extra = {}) => h('label', { className: 'field' }, h('span', { className: 'label' }, label), h(TextField.Root, { value, onChange: event => change(event.target.value), ...extra }))
  return h('div', { className: 'nq-settings' },
    h('div', { className: 'card' }, h('h2', null, 'NapCat OneBot'), h('p', null, '本机要有 QQ NT + 已登录的 NapCat。WebUI 是 6099，OneBot HTTP/WS 默认 3000 / 3001。'), h('p', { className: 'hint' }, '不要把 6099 填进 HTTP。完整 Shell.zip 还要另装官方 QQ；OneKey 免官网安装包，但仍有无头 QQ 进程。')),
    h('div', { className: 'card' },
      field('HTTP', httpBase, setHttpBase), field('正向 WS', wsUrl, setWsUrl),
      field('Token', token, setToken, { type: showToken ? 'text' : 'password' }),
      h('div', { className: 'row' }, h(Button, { size: '1', variant: 'soft', onClick: () => setShowToken(value => !value) }, showToken ? '隐藏 Token' : '显示 Token')),
      h('label', { className: 'row' }, h(Switch, { checked: sticky, onCheckedChange: setSticky }), h('span', null, '卡片常驻（不自动关）')),
      h('div', { className: 'row' }, h(Button, { disabled: busy, onClick: save }, '保存'), h(Button, { variant: 'soft', disabled: busy, onClick: refreshStatus }, '刷新状态'), h(Button, { variant: 'soft', disabled: busy, onClick: testCard }, '测试 Toast')),
      h('div', { className: 'status' }, h('span', null, '状态'), h('strong', null, statusText)),
      feedback ? h('p', { role: feedback.error ? 'alert' : 'status' }, feedback.text) : null))
}
