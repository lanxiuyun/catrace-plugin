/** pywechat-reply settings — risk notice, dependency help, polling config, test toast. */
const vue = globalThis.__CATRACE_VUE__ || {}
const naive = globalThis.__CATRACE_NAIVE__ || {}
const { h, ref, onMounted } = vue
const { NButton, NInput, NSwitch, useMessage } = naive

if (typeof h !== 'function' || typeof ref !== 'function') {
  throw new Error('Catrace plugin Vue runtime missing (__CATRACE_VUE__.h)')
}
if (!NButton || !NInput || !NSwitch || !useMessage) {
  throw new Error('Catrace plugin naive runtime missing (__CATRACE_NAIVE__)')
}
if (!plugin || !plugin.config || !plugin.events || !plugin.setEnabled) {
  throw new Error('Catrace plugin API missing (plugin facade)')
}

const PLUGIN_ID = 'pywechat-reply'
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
  style.textContent = CSS
  document.head.appendChild(style)
}

function clampInt(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

export default {
  name: 'PywechatReplySettings',
  props: {
    context: { type: Object, default: () => ({}) },
  },
  setup(props) {
    const { context } = props || {}
    const message = useMessage()
    const configRef = ref({})
    const pollMs = ref(8000)
    const debug = ref(false)

    onMounted(async () => {
      injectStyles()
      try {
        const cfg = (await plugin.config.get()) || {}
        configRef.value = cfg
        pollMs.value = clampInt(cfg.pollIntervalMs, 500, 60000, 8000)
        debug.value = Boolean(cfg.debug)
      } catch (e) {
        console.warn('[pywechat-reply] failed to load config', e)
      }
    })

    async function saveConfig() {
      const cfg = {
        ...configRef.value,
        pollIntervalMs: pollMs.value,
        debug: debug.value,
      }
      try {
        await plugin.config.set(cfg)
        configRef.value = cfg
        message.success('配置已保存')
      } catch (e) {
        message.error(`保存失败: ${e}`)
      }
    }

    function sendTestToast() {
      plugin.events
        .publish({
          eventType: 'pywechat-reply.message',
          kind: 'pywechat-reply',
          title: '测试聊天',
          body: '这是一条测试消息，点击回复可在输入框里打字。',
          level: 'info',
          actions: [
            { id: 'reply', label: '回复' },
            { id: 'dismiss', label: '忽略' },
          ],
          payload: {
            chatName: '测试聊天',
            sender: '测试发送人',
            messageId: `test-${Date.now()}`,
          },
          dedupeKey: `pywechat-reply:test`,
        })
        .then(() => message.success('测试 Toast 已发送'))
        .catch((e) => message.error(`发送失败: ${e}`))
    }

    return () =>
      h('div', { class: 'pwr-settings' }, [
        h('div', { class: 'card warn' }, [
          h('h2', null, '使用风险提示'),
          h('p', null, '本插件通过 pywechat127（pyweixin）模拟操作微信 PC，不是官方 API。'),
          h('p', null, '高频自动操作或发送敏感内容可能导致微信风控、限制登录甚至封号。请仅自用，勿用于商业或违法违规用途。'),
        ]),
        h('div', { class: 'card' }, [
          h('h2', null, '依赖安装'),
          h('p', null, '启用前请 pip 安装 pywechat127，且微信 PC 已登录。sidecar 用的 python 必须能 import pyweixin：'),
          h('div', { class: 'mono' }, 'pip install pywechat127'),
          h('p', { class: 'hint' }, '微信 4.x 走 pyweixin；3.9 才走 pywechat。Catrace 的 python 要和你 pip 的是同一套。'),
        ]),
        h('div', { class: 'card' }, [
          h('h2', null, '轮询设置'),
          h('div', { class: 'row' }, [
            h('div', { class: 'field' }, [
              h('span', { class: 'label' }, '轮询间隔（毫秒）'),
              h('span', { class: 'hint' }, '轮询会操作微信窗口、抢焦点。建议 8000ms 以上。'),
            ]),
            h(NInput, {
              value: String(pollMs.value),
              onUpdateValue: (v) => {
                pollMs.value = clampInt(v, 500, 60000, 8000)
              },
              style: { width: '8rem' },
            }),
          ]),
          h('div', { class: 'row' }, [
            h('span', { class: 'label' }, '调试模式'),
            h(NSwitch, {
              value: debug.value,
              onUpdateValue: (v) => {
                debug.value = Boolean(v)
              },
            }),
          ]),
          h('div', { class: 'row' }, [
            h(NButton, { type: 'primary', onClick: saveConfig }, () => '保存配置'),
            h(NButton, { onClick: sendTestToast }, () => '发送测试 Toast'),
          ]),
        ]),
      ])
  },
}
