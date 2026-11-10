const { createElement: h, useState, useEffect, useRef } = globalThis.__CATRACE_REACT__ || {}
if (typeof h !== 'function' || typeof useState !== 'function') throw new Error('Catrace React runtime missing (__CATRACE_REACT__)')

const STYLE_ID = 'catrace-plugin-napcat-qq-css-v2'
const CSS = `
.nq-card {
  display: flex; flex-direction: column; width: 100%; min-height: 0;
  box-sizing: border-box; gap: 0.5rem;
  font-family: system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  color: #1f2937;
}
.nq-card * { box-sizing: border-box; }
.nq-card .header { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
.nq-card .avatar {
  flex-shrink: 0; width: 2rem; height: 2rem; border-radius: 0.5rem;
  background: linear-gradient(160deg, #4fc3f7, #12b7f5 50%, #0b9bd8);
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 0.75rem; font-weight: 700;
}
.nq-card .meta { flex: 1; min-width: 0; }
.nq-card .chat-name {
  margin: 0; font-size: 0.9375rem; font-weight: 700; color: #111827;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.nq-card .sub {
  margin: 0.125rem 0 0; font-size: 0.75rem; color: #6b7280;
}
.nq-card .thread {
  display: flex; flex-direction: column; gap: 0.375rem;
  max-height: 16rem; overflow-y: auto; padding: 0.25rem 0.125rem;
  background: #f3f4f6; border-radius: 0.5rem;
}
.nq-card .row { display: flex; width: 100%; }
.nq-card .row.is-self { justify-content: flex-end; }
.nq-card .row.is-peer { justify-content: flex-start; }
.nq-card .col { max-width: 85%; display: flex; flex-direction: column; gap: 0.125rem; }
.nq-card .row.is-self .col { align-items: flex-end; }
.nq-card .name { font-size: 0.6875rem; color: #9ca3af; }
.nq-card .bubble {
  padding: 0.375rem 0.625rem; border-radius: 0.75rem;
  font-size: 0.8125rem; line-height: 1.4; word-break: break-word; white-space: pre-wrap;
}
.nq-card .row.is-peer .bubble { background: #fff; color: #111827; border-bottom-left-radius: 0.25rem; }
.nq-card .row.is-self .bubble { background: #12b7f5; color: #fff; border-bottom-right-radius: 0.25rem; }
.nq-card .reply-box { display: flex; gap: 0.5rem; }
.nq-card .reply-input {
  flex: 1; min-width: 0; padding: 0.375rem 0.5rem;
  border: 1px solid #d1d5db; border-radius: 0.375rem; font-size: 0.875rem;
  outline: none; background: #fff; color: #111827;
}
.nq-card .reply-input:focus { border-color: #12b7f5; }
.nq-card .send-btn {
  flex-shrink: 0; padding: 0.375rem 0.75rem; border: none; border-radius: 0.375rem;
  background: #12b7f5; color: #fff; font-size: 0.875rem; font-weight: 600; cursor: pointer;
}
.nq-card .send-btn:disabled { background: #9ca3af; cursor: not-allowed; }
.nq-card .empty { margin: 0; padding: 0.75rem; font-size: 0.8125rem; color: #9ca3af; text-align: center; }
`

function injectStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = plugin.theme.css(CSS)
  document.head.appendChild(style)
}

async function enqueueOutbox(item) {
  const create = globalThis.__CATRACE_CREATE_PLUGIN_API__
  const api = typeof create === 'function' ? create('napcat-qq') : null
  if (!api?.storage?.get || !api?.storage?.set) return
  const box = await api.storage.get('outbox')
  const list = Array.isArray(box) ? box : []
  list.push(item)
  await api.storage.set('outbox', list)
}

export default function NapcatQqCard({ event = {}, onAction }) {
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)
  const sendingRef = useRef(false)
  const threadEl = useRef(null)
  const payload = event.payload || {}
  const messages = Array.isArray(payload.messages) ? payload.messages : []
  const chatType = payload.chatType === 'group' ? 'group' : 'private'
  const chatId = String(payload.chatId || payload.userId || '')
  const title = event.title || (chatType === 'group' ? `群 ${chatId}` : 'QQ')
  useEffect(injectStyles, [])
  useEffect(() => { const el = threadEl.current; if (el) el.scrollTop = el.scrollHeight }, [messages.length])
  async function sendReply() {
    const text = replyText.trim()
    if (!text || sendingRef.current) return
    sendingRef.current = true
    setSending(true)
    const item = { chatType, chatId, text, at: Date.now() }
    try { await enqueueOutbox(item) }
    catch (error) { console.warn('[napcat-qq] outbox failed', error) }
    try { onAction?.('reply', { text, chatType: item.chatType, chatId: item.chatId }); setReplyText('') }
    finally { sendingRef.current = false; setSending(false) }
  }
  return h('div', { className: 'nq-card' },
    h('div', { className: 'header' }, h('div', { className: 'avatar' }, 'QQ'), h('div', { className: 'meta' }, h('p', { className: 'chat-name' }, title), h('p', { className: 'sub' }, `${messages.length} 条 · 迷你会话`))),
    h('div', { className: 'thread', ref: threadEl }, messages.length ? messages.map((m, i) => {
      const self = !!m.self, previous = i ? messages[i - 1] : null, name = String(m.speaker || '')
      const showName = !self && name && (!previous || previous.self || String(previous.speaker || '') !== name)
      return h('div', { className: `row ${self ? 'is-self' : 'is-peer'}`, key: String(m.id || i) }, h('div', { className: 'col' }, showName ? h('div', { className: 'name' }, name) : null, h('div', { className: 'bubble' }, String(m.text || ''))))
    }) : h('p', { className: 'empty' }, event.body || '暂无消息')),
    h('div', { className: 'reply-box' }, h('input', { className: 'reply-input', type: 'text', placeholder: '发消息…', value: replyText, disabled: sending, onChange: e => setReplyText(e.target.value), onKeyDown: e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent?.isComposing) { e.preventDefault(); void sendReply() } } }), h('button', { className: 'send-btn', disabled: !replyText.trim() || sending, onClick: () => void sendReply() }, '发送')))
}
