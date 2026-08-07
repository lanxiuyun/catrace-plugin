/** smsforwarder-notify settings — webhook / filter / status / guide. */
const vue = globalThis.__CATRACE_VUE__ || {}
const naive = globalThis.__CATRACE_NAIVE__ || {}
const { h, ref, computed, onMounted } = vue
const { NButton, NInput, NSwitch, NTag, NPopconfirm, useMessage } = naive

if (typeof h !== 'function' || typeof ref !== 'function') {
  throw new Error('Catrace plugin Vue runtime missing (__CATRACE_VUE__.h)')
}
if (!NButton || !NInput || !NSwitch || !NTag || !useMessage) {
  throw new Error('Catrace plugin naive runtime missing (__CATRACE_NAIVE__)')
}
if (!plugin || !plugin.config || !plugin.events || !plugin.setEnabled) {
  throw new Error('Catrace plugin API missing (plugin facade)')
}

const PLUGIN_ID = 'smsforwarder-notify'
const MIN_PORT = 1024
const MAX_PORT = 65535
const DEFAULT_PORT = 17890
const DEFAULT_PATH = '/webhook'
const MIN_CARD_SEC = 0
const MAX_CARD_SEC = 600
const DEFAULT_CARD_SEC = 10
const MIN_DEDUPE_SEC = 0
const MAX_DEDUPE_SEC = 300
const DEFAULT_DEDUPE_SEC = 5

const STYLE_ID = 'catrace-plugin-smsforwarder-notify-settings-css'
const CSS = `
.sf-settings {
  width: 100%; box-sizing: border-box;
  display: flex; flex-direction: column; gap: 0.75rem;
  color: #134e4a;
}
.sf-settings *, .sf-settings *::before, .sf-settings *::after { box-sizing: border-box; }
.sf-settings .card {
  padding: 1rem 1.25rem;
  border: 0.0625rem solid #99f6e4;
  border-radius: 0.875rem;
  background: #fff;
  display: flex; flex-direction: column; gap: 0.75rem;
}
.sf-settings .head {
  display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;
}
.sf-settings h2 { margin: 0; font-size: 0.9375rem; font-weight: 700; color: #134e4a; }
.sf-settings .desc { margin: 0; font-size: 0.8125rem; line-height: 1.55; color: #5b6b6a; }
.sf-settings .field { display: flex; flex-direction: column; gap: 0.375rem; min-width: 0; flex: 1; }
.sf-settings .label { font-size: 0.75rem; font-weight: 600; color: #5b6b6a; }
.sf-settings .hint { margin: 0; font-size: 0.6875rem; color: #8b949e; line-height: 1.45; }
.sf-settings .warn {
  margin: 0; font-size: 0.75rem; line-height: 1.5; color: #b45309;
  padding: 0.5rem 0.625rem; border-radius: 0.5rem; background: #fffbeb;
  border: 0.0625rem solid #fde68a;
}
.sf-settings .row {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;
}
.sf-settings .row-inline { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.sf-settings .num { width: 6.5rem; }
.sf-settings .unit { font-size: 0.75rem; color: #5b6b6a; font-weight: 600; }
.sf-settings .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
.sf-settings .status {
  display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 0.75rem;
  padding: 0.625rem 0.75rem; border-radius: 0.5rem; background: #f0fdfa;
  font-size: 0.75rem; color: #424a53;
}
.sf-settings .status strong { color: #0d9488; font-weight: 650; }
.sf-settings .switch-pair {
  display: inline-flex; align-items: center; gap: 0.5rem;
  font-size: 0.8125rem; color: #424a53; font-weight: 500;
}
.sf-settings .mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.75rem; line-height: 1.45;
  padding: 0.5rem 0.625rem; border-radius: 0.5rem;
  background: #f0fdfa; color: #134e4a; word-break: break-all; white-space: pre-wrap;
  border: 0.0625rem solid #ccfbf1; margin: 0;
}
.sf-settings .copy-row {
  display: flex; align-items: flex-start; gap: 0.5rem;
}
.sf-settings .copy-row .mono { flex: 1; min-width: 0; }
.sf-settings .url-list { display: flex; flex-direction: column; gap: 0.375rem; }
`

function ensureStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = CSS
  document.head.appendChild(el)
}

function clamp(n, min, max, fallback) {
  const v = Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.min(max, Math.max(min, Math.round(v)))
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

function normalizePath(raw) {
  let p = String(raw || DEFAULT_PATH).trim() || DEFAULT_PATH
  if (!p.startsWith('/')) p = `/${p}`
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
  return p
}

function blacklistToText(list) {
  if (Array.isArray(list)) return list.join('\n')
  return String(list || '')
}

function textToBlacklist(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 200)
}

const DEFAULT_CONFIG = {
  enabled: true,
  host: '0.0.0.0',
  port: DEFAULT_PORT,
  path: DEFAULT_PATH,
  token: '',
  cardDurationSec: DEFAULT_CARD_SEC,
  dedupeWindowSec: DEFAULT_DEDUPE_SEC,
  appBlacklist: [],
  hideSensitiveBody: false,
  enableOtpAction: true,
}

const JSON_TEMPLATE = `{
  "packageName": "{{PACKAGE_NAME}}",
  "appName": "{{APP_NAME}}",
  "title": "{{TITLE}}",
  "body": "{{MSG}}",
  "receivedAt": "{{RECEIVE_TIME}}",
  "uid": "{{UID}}",
  "device": "[device_mark]",
  "timestamp": "[timestamp]"
}`

export default {
  name: 'SmsforwarderNotifySettings',
  setup(_props, { expose }) {
    ensureStyles()
    const message = useMessage()
    const loading = ref(true)
    const busy = ref('')
    const headerLoading = ref(false)
    const enabled = ref(true)
    const host = ref('0.0.0.0')
    const port = ref(DEFAULT_PORT)
    const path = ref(DEFAULT_PATH)
    const token = ref('')
    const showToken = ref(false)
    const cardDurationSec = ref(DEFAULT_CARD_SEC)
    const dedupeWindowSec = ref(DEFAULT_DEDUPE_SEC)
    const blacklistText = ref('')
    const hideSensitiveBody = ref(false)
    const enableOtpAction = ref(true)
    const status = ref(null)
    const webhookInfo = ref(null)
    let saveTimer = null

    const headerEnabled = computed(() => enabled.value !== false)

    function currentConfig() {
      return {
        enabled: enabled.value !== false,
        host: String(host.value || '0.0.0.0').trim() || '0.0.0.0',
        port: clamp(port.value, MIN_PORT, MAX_PORT, DEFAULT_PORT),
        path: normalizePath(path.value),
        token: String(token.value || '').trim(),
        cardDurationSec: clamp(cardDurationSec.value, MIN_CARD_SEC, MAX_CARD_SEC, DEFAULT_CARD_SEC),
        dedupeWindowSec: clamp(
          dedupeWindowSec.value,
          MIN_DEDUPE_SEC,
          MAX_DEDUPE_SEC,
          DEFAULT_DEDUPE_SEC,
        ),
        appBlacklist: textToBlacklist(blacklistText.value),
        hideSensitiveBody: hideSensitiveBody.value === true,
        enableOtpAction: enableOtpAction.value !== false,
      }
    }

    function applyConfig(cfg = {}) {
      enabled.value = cfg.enabled !== false
      if (typeof cfg.host === 'string' && cfg.host.trim()) host.value = cfg.host.trim()
      port.value = clamp(cfg.port, MIN_PORT, MAX_PORT, DEFAULT_PORT)
      path.value = normalizePath(cfg.path)
      if (typeof cfg.token === 'string') token.value = cfg.token
      cardDurationSec.value = clamp(cfg.cardDurationSec, MIN_CARD_SEC, MAX_CARD_SEC, DEFAULT_CARD_SEC)
      dedupeWindowSec.value = clamp(
        cfg.dedupeWindowSec,
        MIN_DEDUPE_SEC,
        MAX_DEDUPE_SEC,
        DEFAULT_DEDUPE_SEC,
      )
      blacklistText.value = blacklistToText(cfg.appBlacklist)
      hideSensitiveBody.value = cfg.hideSensitiveBody === true
      enableOtpAction.value = cfg.enableOtpAction !== false
    }

    async function run(key, task) {
      busy.value = key
      try {
        await task()
      } catch (error) {
        message.error(errorText(error))
      } finally {
        busy.value = ''
      }
    }

    async function copyText(text, okMsg = '已复制') {
      const s = String(text || '')
      if (!s) {
        message.warning('无可复制内容')
        return
      }
      try {
        if (plugin.clipboard && typeof plugin.clipboard.writeText === 'function') {
          await plugin.clipboard.writeText(s)
        } else if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(s)
        } else {
          throw new Error('clipboard unavailable')
        }
        message.success(okMsg)
      } catch (e) {
        message.error(`复制失败：${errorText(e)}`)
      }
    }

    async function persistAndSync({ quiet = false } = {}) {
      const cfg = currentConfig()
      port.value = cfg.port
      path.value = cfg.path
      cardDurationSec.value = cfg.cardDurationSec
      dedupeWindowSec.value = cfg.dedupeWindowSec
      await plugin.config.set(cfg)
      try {
        if (plugin.sidecar && typeof plugin.sidecar.request === 'function') {
          const result = await plugin.sidecar.request('setConfig', cfg)
          status.value = result && typeof result === 'object' ? result : status.value
          if (result && result.ok === false && result.error) {
            if (!quiet) message.error(`监听失败：${result.error}`)
          } else if (!quiet) {
            message.success('已保存')
          }
          // pull token if sidecar generated one
          await refreshWebhookInfo({ quiet: true })
        } else if (!quiet) {
          message.warning('已保存（启用插件后 sidecar 生效）')
        }
      } catch (error) {
        if (!quiet) message.warning('已保存（启用插件后 sidecar 生效）')
        await plugin.log?.warn?.('config saved without sidecar', { error: errorText(error) })
      }
    }

    function scheduleSave() {
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        saveTimer = null
        persistAndSync({ quiet: true }).catch((error) => message.error(errorText(error)))
      }, 400)
    }

    async function refreshStatus() {
      if (!plugin.sidecar || typeof plugin.sidecar.request !== 'function') {
        status.value = { error: 'sidecar 未运行（请启用插件）', running: false }
        return
      }
      const result = await plugin.sidecar.request('getStatus')
      status.value = result && typeof result === 'object' ? result : { raw: result }
    }

    async function refreshWebhookInfo({ quiet = false } = {}) {
      if (!plugin.sidecar || typeof plugin.sidecar.request !== 'function') {
        if (!quiet) webhookInfo.value = null
        return
      }
      try {
        const result = await plugin.sidecar.request('getWebhookInfo')
        webhookInfo.value = result && typeof result === 'object' ? result : null
        if (result && typeof result.token === 'string' && result.token) {
          token.value = result.token
          // persist generated token
          const cfg = currentConfig()
          if (!cfg.token) {
            cfg.token = result.token
            await plugin.config.set(cfg)
          }
        }
        if (result) {
          status.value = {
            ...(status.value && typeof status.value === 'object' ? status.value : {}),
            ...result,
            token: undefined,
          }
        }
      } catch (e) {
        if (!quiet) throw e
      }
    }

    async function regenerateToken() {
      await run('regen', async () => {
        if (!plugin.sidecar?.request) {
          // local fallback
          const bytes = new Uint8Array(32)
          crypto.getRandomValues(bytes)
          token.value = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
          await persistAndSync({ quiet: true })
          message.success('已重新生成 Token')
          return
        }
        const result = await plugin.sidecar.request('regenerateToken')
        if (result && typeof result.token === 'string') {
          token.value = result.token
          webhookInfo.value = result
          await plugin.config.set(currentConfig())
          message.success('已重新生成 Token（手机端需同步更新）')
        }
        await refreshStatus()
      })
    }

    async function restartServer() {
      await run('restart', async () => {
        await persistAndSync({ quiet: true })
        if (!plugin.sidecar?.request) {
          message.warning('sidecar 未运行')
          return
        }
        const result = await plugin.sidecar.request('restartServer')
        status.value = result
        if (result?.ok === false) message.error(result.error || '重启失败')
        else message.success('服务已重启')
        await refreshWebhookInfo({ quiet: true })
      })
    }

    async function sendTest() {
      await run('test', async () => {
        const cfg = currentConfig()
        // prefer sidecar test (exercises publish path)
        if (plugin.sidecar?.request) {
          try {
            await plugin.sidecar.request('setConfig', cfg)
            await plugin.sidecar.request('sendTest', {})
            message.success('已发送测试通知')
            await refreshStatus()
            return
          } catch {
            /* fall through */
          }
        }
        const sticky = cfg.cardDurationSec <= 0
        await plugin.events.publish({
          eventType: 'smsforwarder-notify.notification',
          kind: 'smsforwarder-notify',
          title: '测试 App · 测试通知',
          body: '这是一条 SmsForwarder 测试消息，验证码 123456',
          level: 'info',
          sticky,
          actions: [
            { id: 'copy-otp', label: '复制验证码' },
            ...(sticky ? [{ id: 'dismiss', label: '知道了' }] : []),
          ],
          payload: {
            packageName: 'com.example.test',
            appName: '测试 App',
            title: '测试通知',
            body: '这是一条 SmsForwarder 测试消息，验证码 123456',
            receivedAt: new Date().toLocaleString(),
            otp: '123456',
            auto_hide_ms: sticky ? 0 : cfg.cardDurationSec * 1000,
            card_duration_sec: cfg.cardDurationSec,
          },
          dedupeKey: `smsforwarder-notify:test:${Date.now()}`,
        })
        message.success('已发送测试通知')
      })
    }

    async function toggleEnabled(val) {
      const previous = enabled.value
      enabled.value = val
      headerLoading.value = true
      try {
        await plugin.setEnabled(val)
        await plugin.config.set(currentConfig())
        window.dispatchEvent(
          new CustomEvent('catrace:plugin-enabled-changed', {
            detail: { id: PLUGIN_ID, enabled: val },
          }),
        )
        try {
          if (plugin.sidecar?.request) {
            const result = await plugin.sidecar.request('setConfig', currentConfig())
            status.value = result
          }
        } catch {
          /* ignore */
        }
      } catch (e) {
        enabled.value = previous
        message.error(errorText(e))
      } finally {
        headerLoading.value = false
      }
    }

    onMounted(() => {
      run('boot', async () => {
        loading.value = true
        try {
          const raw = await plugin.config.get()
          applyConfig(raw && typeof raw === 'object' ? raw : DEFAULT_CONFIG)
          try {
            await refreshStatus()
            await refreshWebhookInfo({ quiet: true })
            // if no token yet, sidecar generates — pull & persist
            if (!token.value && webhookInfo.value?.token) {
              token.value = webhookInfo.value.token
              await plugin.config.set(currentConfig())
            }
          } catch {
            status.value = null
          }
        } finally {
          loading.value = false
        }
      })
    })

    expose({
      headerEnabled,
      headerLoading,
      toggleEnabled,
    })

    return () => {
      const st = status.value || {}
      const info = webhookInfo.value || {}
      const urls =
        (Array.isArray(st.webhookUrls) && st.webhookUrls.length
          ? st.webhookUrls
          : Array.isArray(info.webhookUrls)
            ? info.webhookUrls
            : []) || []
      const primaryUrl = urls[0] || `http://<电脑IP>:${port.value}${normalizePath(path.value)}`
      const authHeader =
        info.authorizationHeader ||
        (token.value ? `Authorization: Bearer ${token.value}` : 'Authorization: Bearer <token>')
      const template = info.jsonTemplate || JSON_TEMPLATE

      const statusRows = st.error
        ? [['状态', st.error]]
        : [
            ['服务', st.running ? '运行中' : '未运行'],
            ['监听', st.running ? `${st.host || host.value}:${st.port || port.value}` : '-'],
            ['路径', st.path || path.value],
            ['Token', st.hasToken || token.value ? '已配置' : '未配置'],
            ['已接收', String(st.acceptedCount ?? 0)],
            ['已拒绝', String(st.rejectedCount ?? 0)],
            ['已去重', String(st.dedupedCount ?? 0)],
            [
              '最近成功',
              st.lastSuccessAt ? new Date(st.lastSuccessAt).toLocaleString() : '-',
            ],
            ['最近来源', st.lastClientIp || '-'],
            ['最近错误', st.lastErrorSummary || '无'],
          ]

      const copyBtn = (label, text, key) =>
        h(
          NButton,
          {
            size: 'tiny',
            secondary: true,
            loading: busy.value === key,
            onClick: () => copyText(text),
          },
          { default: () => label },
        )

      return h('div', { class: 'sf-settings' }, [
        h('div', { class: 'card' }, [
          h('div', { class: 'head' }, [
            h('h2', 'SmsForwarder 通知'),
            h(
              NTag,
              {
                size: 'small',
                round: true,
                bordered: false,
                type: enabled.value ? 'success' : 'default',
              },
              { default: () => (enabled.value ? '已启用' : '已关闭') },
            ),
          ]),
          h(
            'p',
            { class: 'desc' },
            '本机开 HTTP Webhook，接收 Android SmsForwarder 转发的 App 通知，弹出 Catrace Toast。仅建议可信局域网使用。',
          ),
          h(
            'p',
            { class: 'warn' },
            '安全：默认监听 0.0.0.0（全部网卡）。务必使用强 Token，勿暴露到公网。Windows 防火墙需放行入站端口。',
          ),
        ]),

        h('div', { class: 'card' }, [
          h('div', { class: 'head' }, [h('h2', '服务状态')]),
          loading.value
            ? h('p', { class: 'desc' }, '加载中…')
            : h(
                'div',
                { class: 'status' },
                statusRows.flatMap(([k, v]) => [h('strong', k), h('span', String(v))]),
              ),
          h('div', { class: 'actions' }, [
            h(
              NButton,
              {
                size: 'small',
                loading: busy.value === 'status',
                disabled: !!busy.value && busy.value !== 'status',
                onClick: () =>
                  run('status', async () => {
                    await refreshStatus()
                    await refreshWebhookInfo({ quiet: true })
                  }),
              },
              { default: () => '刷新状态' },
            ),
            h(
              NButton,
              {
                size: 'small',
                loading: busy.value === 'restart',
                disabled: !!busy.value && busy.value !== 'restart',
                onClick: restartServer,
              },
              { default: () => '重启服务' },
            ),
            h(
              NButton,
              {
                size: 'small',
                type: 'primary',
                loading: busy.value === 'test',
                disabled: !!busy.value && busy.value !== 'test',
                onClick: sendTest,
              },
              { default: () => '发送测试 Toast' },
            ),
          ]),
        ]),

        h('div', { class: 'card' }, [
          h('div', { class: 'head' }, [h('h2', '连接配置')]),
          h('div', { class: 'row' }, [
            h('div', { class: 'field' }, [
              h('div', { class: 'label' }, '端口'),
              h('div', { class: 'row-inline' }, [
                h(NInput, {
                  class: 'num',
                  value: String(port.value),
                  'onUpdate:value': (v) => {
                    port.value = clamp(v, MIN_PORT, MAX_PORT, DEFAULT_PORT)
                    scheduleSave()
                  },
                }),
              ]),
              h('p', { class: 'hint' }, `${MIN_PORT}–${MAX_PORT}`),
            ]),
            h('div', { class: 'field' }, [
              h('div', { class: 'label' }, '路径'),
              h(NInput, {
                value: path.value,
                placeholder: '/webhook',
                'onUpdate:value': (v) => {
                  path.value = v
                  scheduleSave()
                },
              }),
            ]),
          ]),
          h('div', { class: 'field' }, [
            h('div', { class: 'label' }, 'Token'),
            h('div', { class: 'row-inline' }, [
              h(NInput, {
                value: token.value,
                type: showToken.value ? 'text' : 'password',
                showPasswordOn: 'click',
                placeholder: '启用插件后自动生成',
                style: { flex: 1, minWidth: '12rem' },
                'onUpdate:value': (v) => {
                  token.value = v
                  scheduleSave()
                },
              }),
              h(
                NButton,
                {
                  size: 'small',
                  onClick: () => {
                    showToken.value = !showToken.value
                  },
                },
                { default: () => (showToken.value ? '隐藏' : '显示') },
              ),
              NPopconfirm
                ? h(
                    NPopconfirm,
                    {
                      onPositiveClick: regenerateToken,
                    },
                    {
                      trigger: () =>
                        h(
                          NButton,
                          {
                            size: 'small',
                            type: 'warning',
                            loading: busy.value === 'regen',
                            disabled: !!busy.value && busy.value !== 'regen',
                          },
                          { default: () => '重新生成' },
                        ),
                      default: () => '重新生成会使手机端旧 Token 立即失效，确认？',
                    },
                  )
                : h(
                    NButton,
                    {
                      size: 'small',
                      type: 'warning',
                      loading: busy.value === 'regen',
                      onClick: regenerateToken,
                    },
                    { default: () => '重新生成' },
                  ),
            ]),
            h('p', { class: 'hint' }, 'SmsForwarder 请求头：Authorization: Bearer <token>'),
          ]),
          h('div', { class: 'row' }, [
            h('div', { class: 'field' }, [
              h('div', { class: 'label' }, 'Toast 停留'),
              h('div', { class: 'row-inline' }, [
                h(NInput, {
                  class: 'num',
                  value: String(cardDurationSec.value),
                  'onUpdate:value': (v) => {
                    cardDurationSec.value = clamp(v, MIN_CARD_SEC, MAX_CARD_SEC, DEFAULT_CARD_SEC)
                    scheduleSave()
                  },
                }),
                h('span', { class: 'unit' }, '秒（0=常驻）'),
              ]),
            ]),
            h('div', { class: 'field' }, [
              h('div', { class: 'label' }, '去重窗口'),
              h('div', { class: 'row-inline' }, [
                h(NInput, {
                  class: 'num',
                  value: String(dedupeWindowSec.value),
                  'onUpdate:value': (v) => {
                    dedupeWindowSec.value = clamp(
                      v,
                      MIN_DEDUPE_SEC,
                      MAX_DEDUPE_SEC,
                      DEFAULT_DEDUPE_SEC,
                    )
                    scheduleSave()
                  },
                }),
                h('span', { class: 'unit' }, '秒'),
              ]),
            ]),
          ]),
          h('div', { class: 'actions' }, [
            h(
              NButton,
              {
                size: 'small',
                type: 'primary',
                loading: busy.value === 'save',
                onClick: () => run('save', () => persistAndSync({ quiet: false })),
              },
              { default: () => '保存并应用' },
            ),
          ]),
        ]),

        h('div', { class: 'card' }, [
          h('div', { class: 'head' }, [h('h2', '过滤与隐私')]),
          h('div', { class: 'field' }, [
            h('div', { class: 'label' }, 'App 黑名单（一行一个包名或 App 名）'),
            h(NInput, {
              value: blacklistText.value,
              type: 'textarea',
              rows: 4,
              placeholder: 'com.example.ads\n某广告 App',
              'onUpdate:value': (v) => {
                blacklistText.value = v
                scheduleSave()
              },
            }),
          ]),
          h('div', { class: 'row' }, [
            h('span', { class: 'switch-pair' }, [
              h(NSwitch, {
                value: hideSensitiveBody.value,
                'onUpdate:value': (v) => {
                  hideSensitiveBody.value = !!v
                  scheduleSave()
                },
              }),
              '隐私模式（不显示正文/验证码）',
            ]),
          ]),
          h('div', { class: 'row' }, [
            h('span', { class: 'switch-pair' }, [
              h(NSwitch, {
                value: enableOtpAction.value,
                'onUpdate:value': (v) => {
                  enableOtpAction.value = !!v
                  scheduleSave()
                },
              }),
              '识别验证码并显示复制按钮',
            ]),
          ]),
        ]),

        h('div', { class: 'card' }, [
          h('div', { class: 'head' }, [h('h2', 'SmsForwarder 配置指南')]),
          h(
            'p',
            { class: 'desc' },
            '手机与电脑同一 Wi-Fi；SmsForwarder 开启通知使用权，并开启“启动时异步获取已安装 App 列表”。通道选 Webhook / 自定义请求。',
          ),
          h('div', { class: 'field' }, [
            h('div', { class: 'label' }, '推荐 Webhook URL（选本机局域网 IP）'),
            h('div', { class: 'url-list' },
              urls.length
                ? urls.map((u) =>
                    h('div', { class: 'copy-row', key: u }, [
                      h('pre', { class: 'mono' }, u),
                      copyBtn('复制', u, 'copy-url'),
                    ]),
                  )
                : [
                    h('div', { class: 'copy-row' }, [
                      h('pre', { class: 'mono' }, primaryUrl),
                      copyBtn('复制', primaryUrl, 'copy-url'),
                    ]),
                  ],
            ),
            h(
              'p',
              { class: 'hint' },
              '若列表为空：先启用插件，确认服务运行中。防火墙需放行 TCP 入站端口；部分路由器开启「客户端隔离」会导致手机访问不到电脑。',
            ),
          ]),
          h('div', { class: 'field' }, [
            h('div', { class: 'label' }, '请求头'),
            h('div', { class: 'copy-row' }, [
              h('pre', { class: 'mono' }, authHeader),
              copyBtn('复制', authHeader, 'copy-hdr'),
            ]),
          ]),
          h('div', { class: 'field' }, [
            h('div', { class: 'label' }, 'JSON 消息模板'),
            h('div', { class: 'copy-row' }, [
              h('pre', { class: 'mono' }, template),
              copyBtn('复制', template, 'copy-tpl'),
            ]),
          ]),
          h('div', { class: 'field' }, [
            h('div', { class: 'label' }, '响应关键词（可选）'),
            h('div', { class: 'copy-row' }, [
              h('pre', { class: 'mono' }, '"ok":true'),
              copyBtn('复制', '"ok":true', 'copy-kw'),
            ]),
          ]),
          h(
            'p',
            { class: 'hint' },
            '方法选 POST；Content-Type: application/json。本插件不支持 GET。公网中继/HTTPS 不在首版范围。',
          ),
        ]),
      ])
    }
  },
}
