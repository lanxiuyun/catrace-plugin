const { createElement: h, useState, useEffect, useRef } = globalThis.__CATRACE_REACT__ || {}
if (typeof h !== 'function' || typeof useState !== 'function') throw new Error('Catrace React runtime missing (__CATRACE_REACT__)')

const STYLE_ID = 'catrace-plugin-pywechat-reply-css-v1'
const CSS = `
.pwr-card {
  display: flex;
  flex-direction: column;
  width: 100%;
  box-sizing: border-box;
  gap: 0.5rem;
  font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  color: #1f2937;
}
.pwr-card * { box-sizing: border-box; }
.pwr-card .header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}
.pwr-card .avatar {
  flex-shrink: 0;
  width: 2rem;
  height: 2rem;
  border-radius: 0.5rem;
  background: linear-gradient(135deg, #07c160, #05a350);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 0.875rem;
  font-weight: 700;
}
.pwr-card .meta {
  flex: 1;
  min-width: 0;
}
.pwr-card .chat-name {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 700;
  color: #111827;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pwr-card .sender {
  margin: 0.125rem 0 0;
  font-size: 0.75rem;
  color: #6b7280;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pwr-card .body {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.4;
  color: #374151;
  word-break: break-word;
}
.pwr-card .reply-box {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.25rem;
}
.pwr-card .reply-input {
  flex: 1;
  min-width: 0;
  padding: 0.375rem 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  outline: none;
  background: #fff;
  color: #111827;
}
.pwr-card .reply-input:focus {
  border-color: #07c160;
}
.pwr-card .send-btn {
  flex-shrink: 0;
  padding: 0.375rem 0.75rem;
  border: none;
  border-radius: 0.375rem;
  background: #07c160;
  color: #fff;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
}
.pwr-card .send-btn:disabled {
  background: #9ca3af;
  cursor: not-allowed;
}
.pwr-card .hint {
  margin: 0.25rem 0 0;
  font-size: 0.6875rem;
  color: #9ca3af;
}
`

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = plugin.theme.css(CSS)
  document.head.appendChild(style)
}

export default function PywechatReplyCard({ event = {}, onAction }) {
  const payload = event.payload || {}, chatName = event.title || payload.chatName || '微信', sender = payload.sender || ''
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)
  const sendingRef = useRef(false)
  useEffect(injectStyles, [])
  function sendReply() {
    const text = replyText.trim()
    if (!text || sendingRef.current) return
    sendingRef.current = true
    setSending(true)
    onAction?.('reply', { text })
  }
  return h('div', { className: 'pwr-card' },
    h('div', { className: 'header' }, h('div', { className: 'avatar' }, '微'), h('div', { className: 'meta' }, h('p', { className: 'chat-name' }, chatName), sender && sender !== chatName ? h('p', { className: 'sender' }, sender) : null)),
    event.body ? h('p', { className: 'body' }, event.body) : null,
    h('div', { className: 'reply-box' }, h('input', { className: 'reply-input', type: 'text', placeholder: '输入回复…', value: replyText, disabled: sending, onChange: e => setReplyText(e.target.value), onKeyDown: e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent?.isComposing) { e.preventDefault(); sendReply() } } }), h('button', { className: 'send-btn', disabled: !replyText.trim() || sending, onClick: sendReply }, '发送')),
    h('p', { className: 'hint' }, '通过 pywechat127 操控微信 PC，发送会抢焦点'))
}
