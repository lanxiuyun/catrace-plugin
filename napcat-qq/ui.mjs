/** napcat-qq mini chat window — both sides, same-thread upsert. */
const { h, ref, computed, watch, onMounted, nextTick } = globalThis.__CATRACE_VUE__ || {}
if (typeof h !== 'function') {
  throw new Error('Catrace plugin Vue runtime missing (__CATRACE_VUE__.h)')
}

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
  style.textContent = CSS
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

export default {
  name: 'NapcatQqCard',
  props: {
    event: { type: Object, required: true },
    isHovered: { type: Boolean, default: false },
  },
  emits: ['action'],
  setup(props, { emit }) {
    const replyText = ref('')
    const sending = ref(false)
    const threadEl = ref(null)

    const payload = computed(() => props.event?.payload || {})
    const messages = computed(() => {
      const list = payload.value.messages
      return Array.isArray(list) ? list : []
    })
    const chatType = computed(() => (payload.value.chatType === 'group' ? 'group' : 'private'))
    const chatId = computed(() => String(payload.value.chatId || payload.value.userId || ''))
    const title = computed(() => props.event?.title || (chatType.value === 'group' ? `群 ${chatId.value}` : 'QQ'))

    onMounted(injectStyles)

    watch(
      () => messages.value.length,
      async () => {
        await nextTick()
        const el = threadEl.value
        if (el) el.scrollTop = el.scrollHeight
      },
    )

    async function sendReply() {
      const text = replyText.value.trim()
      if (!text || sending.value) return
      sending.value = true
      const item = {
        chatType: chatType.value,
        chatId: chatId.value,
        text,
        at: Date.now(),
      }
      try {
        await enqueueOutbox(item)
      } catch (e) {
        console.warn('[napcat-qq] outbox failed', e)
      }
      emit('action', 'reply', { text, chatType: item.chatType, chatId: item.chatId })
      replyText.value = ''
      sending.value = false
    }

    function onKeydown(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void sendReply()
      }
    }

    return () => {
      const rows = messages.value
      return h('div', { class: 'nq-card' }, [
        h('div', { class: 'header' }, [
          h('div', { class: 'avatar' }, 'QQ'),
          h('div', { class: 'meta' }, [
            h('p', { class: 'chat-name' }, title.value),
            h('p', { class: 'sub' }, `${rows.length} 条 · 迷你会话`),
          ]),
        ]),
        h(
          'div',
          {
            class: 'thread',
            ref: (el) => {
              threadEl.value = el
            },
          },
          rows.length
            ? rows.map((m, i) => {
                const self = !!m.self
                const prev = i > 0 ? rows[i - 1] : null
                const name = String(m.speaker || '')
                const showName = !self && name && (!prev || prev.self || String(prev.speaker || '') !== name)
                return h('div', { class: ['row', self ? 'is-self' : 'is-peer'], key: String(m.id || i) }, [
                  h('div', { class: 'col' }, [
                    showName ? h('div', { class: 'name' }, name) : null,
                    h('div', { class: 'bubble' }, String(m.text || '')),
                  ]),
                ])
              })
            : [h('p', { class: 'empty' }, props.event?.body || '暂无消息')],
        ),
        h('div', { class: 'reply-box' }, [
          h('input', {
            class: 'reply-input',
            type: 'text',
            placeholder: '发消息…',
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
              onClick: () => void sendReply(),
            },
            '发送',
          ),
        ]),
      ])
    }
  },
}
