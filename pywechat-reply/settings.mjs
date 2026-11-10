const { createElement: h, useState, useEffect, useRef } = globalThis.__CATRACE_REACT__ || {}
if (typeof h !== 'function' || typeof useState !== 'function') throw new Error('Catrace React runtime missing (__CATRACE_REACT__)')
const { Button, TextField, Switch } = globalThis.__CATRACE_RADIX__ || {}
if (!Button || !TextField || !Switch) throw new Error('Catrace Radix runtime missing (__CATRACE_RADIX__)')

const STYLE_ID = 'catrace-plugin-pywechat-reply-settings-css-v1'
const CSS = `
.pwr-settings {
  width: 100%; box-sizing: border-box;
  display: flex; flex-direction: column; gap: 0.75rem;
  color: #374151;
}
.pwr-settings *, .pwr-settings *::before, .pwr-settings *::after { box-sizing: border-box; }
.pwr-settings .card {
  padding: 1rem;
  border: 1px solid #e5e7eb;
  border-radius: 0.75rem;
  background: #fff;
  display: flex; flex-direction: column;
  gap: 0.625rem;
}
.pwr-settings .card.warn {
  border-color: #fde68a;
  background: #fffbeb;
}
.pwr-settings h2 { margin: 0; font-size: 0.9375rem; font-weight: 700; color: #111827; }
.pwr-settings p { margin: 0; font-size: 0.8125rem; line-height: 1.55; color: #4b5563; }
.pwr-settings .row {
  display: flex; align-items: center; justify-content: space-between;
  gap: 0.75rem; flex-wrap: wrap;
}
.pwr-settings .field { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; flex: 1; }
.pwr-settings .label { font-size: 0.75rem; font-weight: 600; color: #6b7280; }
.pwr-settings .hint { font-size: 0.6875rem; color: #9ca3af; }
.pwr-settings .mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.75rem;
  padding: 0.375rem 0.5rem;
  background: #f3f4f6;
  border-radius: 0.375rem;
  color: #374151;
  user-select: all;
}
`

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = plugin.theme.css(CSS)
  document.head.appendChild(style)
}

function clampInt(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

export default function PywechatReplySettings() {
  const [config, setConfig] = useState({})
  const [pollMs, setPollMs] = useState(8000)
  const [debug, setDebug] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    injectStyles()
    let alive = true
    void plugin.config.get().then((cfg) => {
      if (!alive) return
      const next = cfg || {}
      setConfig(next)
      setPollMs(clampInt(next.pollIntervalMs, 500, 60000, 8000))
      setDebug(Boolean(next.debug))
    }).catch((error) => console.warn('[pywechat-reply] failed to load config', error))
    return () => { alive = false }
  }, [])
  async function saveConfig() {
    const cfg = { ...config, pollIntervalMs: pollMs, debug }
    // Only the host switch owns the top-level enable flag; nested business flags stay intact.
    delete cfg.enabled
    setBusy(true)
    try { await plugin.config.set(cfg); setConfig(cfg); setFeedback({ text: '配置已保存' }) }
    catch (error) { setFeedback({ error: true, text: `保存失败: ${error}` }) }
    finally { setBusy(false) }
  }
  async function sendTestToast() {
    setBusy(true)
    try {
      await plugin.events.publish({ eventType: 'pywechat-reply.message', kind: 'pywechat-reply', title: '测试聊天', body: '这是一条测试消息，点击回复可在输入框里打字。', level: 'info', actions: [{ id: 'reply', label: '回复' }, { id: 'dismiss', label: '忽略' }], payload: { chatName: '测试聊天', sender: '测试发送人', messageId: `test-${Date.now()}` }, dedupeKey: 'pywechat-reply:test' })
      setFeedback({ text: '测试 Toast 已发送' })
    } catch (error) { setFeedback({ error: true, text: `发送失败: ${error}` }) }
    finally { setBusy(false) }
  }
  return h('div', { className: 'pwr-settings' },
    h('div', { className: 'card warn' }, h('h2', null, '使用风险提示'), h('p', null, '本插件通过 pywechat127（pyweixin）模拟操作微信 PC，不是官方 API。'), h('p', null, '高频自动操作或发送敏感内容可能导致微信风控、限制登录甚至封号。请仅自用，勿用于商业或违法违规用途。')),
    h('div', { className: 'card' }, h('h2', null, '依赖安装'), h('p', null, '启用前请 pip 安装 pywechat127，且微信 PC 已登录。sidecar 用的 python 必须能 import pyweixin：'), h('div', { className: 'mono' }, 'pip install pywechat127'), h('p', { className: 'hint' }, '微信 4.x 走 pyweixin；3.9 才走 pywechat。Catrace 的 python 要和你 pip 的是同一套。')),
    h('div', { className: 'card' }, h('h2', null, '轮询设置'),
      h('div', { className: 'row' }, h('label', { className: 'field', htmlFor: 'pwr-poll' }, h('span', { className: 'label' }, '轮询间隔（毫秒）'), h('span', { className: 'hint' }, '轮询会操作微信窗口、抢焦点。建议 8000ms 以上。')), h(TextField.Root, { id: 'pwr-poll', type: 'number', min: 500, max: 60000, value: String(pollMs), onChange: event => setPollMs(clampInt(event.target.value, 500, 60000, 8000)), style: { width: '8rem' } })),
      h('label', { className: 'row' }, h('span', { className: 'label' }, '调试模式'), h(Switch, { checked: debug, onCheckedChange: setDebug })),
      h('div', { className: 'row' }, h(Button, { disabled: busy, onClick: saveConfig }, '保存配置'), h(Button, { disabled: busy, variant: 'soft', onClick: sendTestToast }, '发送测试 Toast')),
      feedback ? h('p', { role: feedback.error ? 'alert' : 'status' }, feedback.text) : null))
}
