/** pywechat-reply toast card — chat name, sender, message body, quick reply. */
const { h, ref, onMounted, onBeforeUnmount } = globalThis.__CATRACE_VUE__ || {}
if (typeof h !== 'function') {
  throw new Error('Catrace plugin Vue runtime missing (__CATRACE_VUE__.h)')
}

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
  style.textContent = CSS
  document.head.appendChild(style)
}

export default {
  name: 'PywechatReplyCard',
  props: {
    event: { type: Object, required: true },
    isHovered: { type: Boolean, default: false },
  },
  emits: ['action'],
  setup(props) {
    const { event, onAction } = props || {}
    const payload = event?.payload || {}
    const chatName = event?.title || payload.chatName || '微信'
    const sender = payload.sender || ''
    const body = event?.body || ''
    const replyText = ref('')
    const sending = ref(false)

    onMounted(injectStyles)

    function sendReply() {
      const text = replyText.value.trim()
      if (!text || sending.value) return
      sending.value = true
      if (typeof onAction === 'function') {
        onAction({
          actionId: 'reply',
          payload: {
            ...payload,
            text,
          },
        })
      }
    }

    function onKeydown(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        sendReply()
      }
    }

    return () =>
      h('div', { class: 'pwr-card' }, [
        h('div', { class: 'header' }, [
          h('div', { class: 'avatar' }, '微'),
          h('div', { class: 'meta' }, [
            h('p', { class: 'chat-name' }, chatName),
            sender && sender !== chatName ? h('p', { class: 'sender' }, sender) : null,
          ]),
        ]),
        body ? h('p', { class: 'body' }, body) : null,
        h('div', { class: 'reply-box' }, [
          h('input', {
            class: 'reply-input',
            type: 'text',
            placeholder: '输入回复…',
            value: replyText.value,
            disabled: sending.value,
            onInput: (e) => {
              replyText.value = e.target.value
            },
            onKeydown,
          }),
          h(
            'button',
            {
              class: 'send-btn',
              disabled: !replyText.value.trim() || sending.value,
              onClick: sendReply,
            },
            '发送',
          ),
        ]),
        h('p', { class: 'hint' }, '依赖 pywechat 操控微信 PC 客户端'),
      ])
  },
}
