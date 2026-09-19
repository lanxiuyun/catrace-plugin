/** napcat-qq settings — OneBot HTTP/WS, token, status, test card. */
const vue = globalThis.__CATRACE_VUE__ || {}
const naive = globalThis.__CATRACE_NAIVE__ || {}
const { h, ref, onMounted } = vue
const { NButton, NInput, NSwitch, useMessage } = naive

if (typeof h !== 'function' || typeof ref !== 'function') {
  throw new Error('Catrace plugin Vue runtime missing (__CATRACE_VUE__.h)')
}
if (!NButton || !NInput || !useMessage) {
  throw new Error('Catrace plugin naive runtime missing (__CATRACE_NAIVE__)')
}
if (!plugin || !plugin.config || !plugin.events) {
  throw new Error('Catrace plugin API missing (plugin facade)')
}

const PLUGIN_ID = 'napcat-qq'
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
  el.textContent = CSS
  document.head.appendChild(el)
}

export default {
  name: 'NapcatQqSettings',
  setup() {
    ensureStyles()
    const message = useMessage()
    const httpBase = ref('http://127.0.0.1:3000')
    const wsUrl = ref('ws://127.0.0.1:3001')
    const token = ref('')
    const sticky = ref(true)
    const statusText = ref('未刷新')
    const busy = ref(false)

    async function load() {
      try {
        const cfg = (await plugin.config.get()) || {}
        if (cfg.httpBase) httpBase.value = cfg.httpBase
        if (cfg.wsUrl) wsUrl.value = cfg.wsUrl
        if (typeof cfg.token === 'string') token.value = cfg.token
        sticky.value = !(Number(cfg.cardDurationSec) > 0)
      } catch (e) {
        console.warn('[napcat-qq] load config', e)
      }
    }

    async function save() {
      busy.value = true
      try {
        const cfg = {
          httpBase: httpBase.value.trim(),
          wsUrl: wsUrl.value.trim(),
          token: token.value.trim(),
          cardDurationSec: sticky.value ? 0 : 12,
          enabled: true,
        }
        await plugin.config.set(cfg)
        if (plugin.sidecar?.request) {
          await plugin.sidecar.request('setConfig', cfg)
        }
        message.success('已保存并同步 sidecar')
      } catch (e) {
        message.error(String(e))
      } finally {
        busy.value = false
      }
    }

    async function refreshStatus() {
      busy.value = true
      try {
        if (!plugin.sidecar?.request) {
          statusText.value = 'sidecar 未运行（先启用插件并刷新）'
          return
        }
        const st = await plugin.sidecar.request('getStatus')
        const nick = st?.login?.nickname || '-'
        const uid = st?.login?.userId || '-'
        statusText.value = `WS ${st?.wsState || '?'} · ${nick} (${uid}) · ${st?.lastError || 'ok'}`
      } catch (e) {
        statusText.value = String(e)
      } finally {
        busy.value = false
      }
    }

    async function testCard() {
      busy.value = true
      try {
        if (plugin.sidecar?.request) {
          await plugin.sidecar.request('testCard', {})
        } else {
          await plugin.events.publish({
            eventType: 'napcat-qq.message',
            kind: 'napcat-qq',
            title: '测试好友',
            body: 'sidecar 未运行时的测试卡。回复 dry-run。',
            sticky: true,
            payload: { chatType: 'private', chatId: 'test', senderName: '测试好友' },
            dedupeKey: `napcat-qq:test-${Date.now()}`,
          })
        }
        message.success('测试 Toast 已发（chatId=test，不会真发 QQ）')
      } catch (e) {
        message.error(String(e))
      } finally {
        busy.value = false
      }
    }

    onMounted(() => {
      void load()
    })

    return () =>
      h('div', { class: 'nq-settings' }, [
        h('div', { class: 'card' }, [
          h('h2', null, 'NapCat OneBot'),
          h('p', null, '本机要有 QQ NT + 已登录的 NapCat。WebUI 是 6099，OneBot HTTP/WS 默认 3000 / 3001。'),
          h('p', { class: 'hint' }, '不要把 6099 填进 HTTP。完整 Shell.zip 还要另装官方 QQ；OneKey 免官网安装包，但仍有无头 QQ 进程。'),
        ]),
        h('div', { class: 'card' }, [
          h('div', { class: 'field' }, [
            h('span', { class: 'label' }, 'HTTP'),
            h(NInput, {
              value: httpBase.value,
              onUpdateValue: (v) => {
                httpBase.value = v
              },
            }),
          ]),
          h('div', { class: 'field' }, [
            h('span', { class: 'label' }, '正向 WS'),
            h(NInput, {
              value: wsUrl.value,
              onUpdateValue: (v) => {
                wsUrl.value = v
              },
            }),
          ]),
          h('div', { class: 'field' }, [
            h('span', { class: 'label' }, 'Token'),
            h(NInput, {
              type: 'password',
              showPasswordOn: 'click',
              value: token.value,
              onUpdateValue: (v) => {
                token.value = v
              },
            }),
          ]),
          NSwitch
            ? h('div', { class: 'row' }, [
                h(NSwitch, {
                  value: sticky.value,
                  onUpdateValue: (v) => {
                    sticky.value = v
                  },
                }),
                h('span', null, '卡片常驻（不自动关）'),
              ])
            : null,
          h('div', { class: 'row' }, [
            h(NButton, { type: 'primary', loading: busy.value, onClick: () => void save() }, { default: () => '保存' }),
            h(NButton, { loading: busy.value, onClick: () => void refreshStatus() }, { default: () => '刷新状态' }),
            h(NButton, { loading: busy.value, onClick: () => void testCard() }, { default: () => '测试 Toast' }),
          ]),
          h('div', { class: 'status' }, [
            h('span', null, '状态'),
            h('strong', null, statusText.value),
          ]),
        ]),
      ])
  },
}
