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
.sf-settings .tabs {
  display: flex; gap: 0.25rem; flex-wrap: wrap;
  background: #f0fdfa; border: 0.0625rem solid #ccfbf1;
  border-radius: 0.75rem; padding: 0.25rem;
}
.sf-settings .tab {
  border: 0; background: transparent; cursor: pointer;
  padding: 0.5rem 1rem; border-radius: 0.625rem;
  font-size: 0.8125rem; font-weight: 600; color: #5b6b6a;
  transition: background 0.15s, color 0.15s;
}
.sf-settings .tab:hover { color: #0d9488; }
.sf-settings .tab.is-active { background: #14b8a6; color: #fff; }
.sf-settings .sf-tab-panel {
  display: flex; flex-direction: column; gap: 0.75rem;
}
.sf-settings .step {
  display: flex; gap: 0.75rem; align-items: flex-start;
  padding: 0.875rem 1rem;
  border: 0.0625rem solid #ccfbf1; border-radius: 0.75rem;
  background: #fff;
}
.sf-settings .step-num {
  flex: 0 0 auto;
  width: 1.5rem; height: 1.5rem; border-radius: 50%;
  background: #14b8a6; color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 0.8125rem; font-weight: 700;
}
.sf-settings .step-body { display: flex; flex-direction: column; gap: 0.375rem; min-width: 0; }
.sf-settings .step-title { font-size: 0.875rem; font-weight: 700; color: #134e4a; }
.sf-settings .step-list {
  margin: 0; padding-left: 1.25rem;
  font-size: 0.8125rem; color: #424a53; line-height: 1.7;
}
.sf-settings .step-list li + li { margin-top: 0.125rem; }
.sf-settings .faq {
  display: flex; flex-direction: column; gap: 0.25rem;
  padding: 0.625rem 0; border-bottom: 0.0625rem solid #f0fdfa;
}
.sf-settings .faq:last-child { border-bottom: 0; }
.sf-settings .faq-q { font-size: 0.8125rem; font-weight: 700; color: #134e4a; }
.sf-settings .faq-a { margin: 0; font-size: 0.75rem; line-height: 1.6; color: #5b6b6a; }
.sf-settings .steps-wrap { display: flex; flex-direction: column; gap: 0.5rem; }
.sf-settings .dl-list { display: flex; flex-direction: column; gap: 0.375rem; }
.sf-settings .dl-item {
  display: flex; flex-direction: column; gap: 0.125rem;
  padding: 0.5rem 0.625rem; border-radius: 0.5rem;
  background: #f0fdfa; border: 0.0625rem solid #ccfbf1;
}
.sf-settings .dl-name { font-size: 0.8125rem; font-weight: 600; color: #134e4a; }
.sf-settings .dl-name a { color: #0d9488; text-decoration: none; }
.sf-settings .dl-name a:hover { text-decoration: underline; }
.sf-settings .dl-note { margin: 0; font-size: 0.6875rem; color: #8b949e; line-height: 1.45; }
.sf-settings .step-list .step-copy {
  list-style: none;
  display: flex; flex-direction: column; gap: 0.375rem;
  margin-left: -1.25rem; min-width: 0;
}
.sf-settings .step-copy-label { font-size: 0.8125rem; font-weight: 600; color: #134e4a; }
.sf-settings .step-copy-values { display: flex; flex-direction: column; gap: 0.375rem; }
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
  onlyPushWhenActive: false,
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

const TABS = [
  { id: 'overview', label: '概览' },
  { id: 'settings', label: '设置' },
  { id: 'tutorial', label: '教程' },
]

const DOWNLOAD_LINKS = [
  {
    name: 'GitHub Releases（官方首发）',
    url: 'https://github.com/pppscn/SmsForwarder/releases',
    note: '官方 APK 下载页，推荐优先使用；国内网络可能访问较慢',
  },
  {
    name: 'Gitee 国内镜像',
    url: 'https://gitee.com/pp/SmsForwarder/releases',
    note: '国内下载更快，版本与 GitHub 同步',
  },
  {
    name: '蓝奏云网盘',
    url: 'https://wws.lanzoui.com/b025yl86h',
    note: '访问密码：pppscn',
  },
  {
    name: '项目主页（源码与 Wiki 文档）',
    url: 'https://github.com/pppscn/SmsForwarder',
    note: '查看使用文档、提交 Issue 或参与开发',
  },
  {
    name: '官方使用流程（必读）',
    url: 'https://gitee.com/pp/SmsForwarder/wikis/%E3%80%90%E5%BF%85%E8%AF%BB%E3%80%91%E4%BD%BF%E7%94%A8%E6%B5%81%E7%A8%8B',
    note: '通用设置 → 发送通道 → 转发规则 的完整图文教程',
  },
]

const FAQ = [
  [
    '通道测试成功但真实通知不来',
    '发送通道只负责投递；还须在「转发规则」里新建规则，发送通道选 catrace，打开「启用该条转发规则」。通知与短信是两套规则，要分别建。',
  ],
  [
    '手机访问不到电脑',
    '确认与电脑同一 Wi-Fi；首次启动时若防火墙弹窗选过「允许访问」则无需手动配置；若仍未放行，可在「Windows Defender 防火墙 → 高级设置 → 入站规则」手动放行 TCP 端口；同时关闭路由器「客户端隔离」，并在「设置」里核对端口、路径、Token 是否一致。',
  ],
  [
    '服务显示未运行',
    '确认插件已启用；确认电脑能执行 node 命令；点「重启服务」；查看「最近错误」摘要。',
  ],
  [
    '取不到 App 名，只显示包名',
    'SmsForwarder 需开启「启动时异步获取已安装 App 列表」；未开启时回退显示包名属正常现象。',
  ],
  [
    '重复通知刷屏',
    '在「设置」里调大「去重窗口」（默认 5 秒）。',
  ],
  [
    '验证码没有复制按钮',
    '正文或标题需包含「验证码 / 校验码 / 动态码 / OTP」等关键词，且出现独立的 4–8 位数字；开启「隐私模式」时不提供复制按钮。',
  ],
  [
    '端口被占用',
    '换一个端口（1024–65535），保存并重启服务。',
  ],
]

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
    const onlyPushWhenActive = ref(false)
    const status = ref(null)
    const webhookInfo = ref(null)
    const activeTab = ref('overview')
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
        onlyPushWhenActive: onlyPushWhenActive.value === true,
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
      onlyPushWhenActive.value = cfg.onlyPushWhenActive === true
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
          // sidecar is source of truth for the live webhook secret
          const prev = String(token.value || '').trim()
          const live = result.token.trim()
          if (prev !== live) {
            token.value = live
            await plugin.config.set(currentConfig())
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
            { id: 'copy-body', label: '复制正文' },
            { id: 'copy-otp', label: '复制验证码' },
            ...(sticky ? [{ id: 'dismiss', label: '知道了' }] : []),
            { id: 'block-app', label: '拉黑此应用' },
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
            // push UI/plugin.config into sidecar first so the Token field is what HTTP checks
            if (plugin.sidecar?.request) {
              const pushed = await plugin.sidecar.request('setConfig', currentConfig())
              if (pushed && typeof pushed === 'object') status.value = pushed
            }
            await refreshStatus()
            // pull live token (sidecar may have generated one if field was empty)
            await refreshWebhookInfo({ quiet: true })
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

      const tabBar = h(
        'div',
        { class: 'tabs' },
        TABS.map((t) =>
          h(
            'button',
            {
              key: t.id,
              class: ['tab', { 'is-active': activeTab.value === t.id }],
              onClick: () => {
                activeTab.value = t.id
              },
            },
            t.label,
          ),
        ),
      )

      const headerCard = h('div', { class: 'card' }, [
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
          '安全：默认监听 0.0.0.0（全部网卡）。务必使用强 Token，勿暴露到公网。首次启动防火墙弹窗选「允许访问」即可，无需手动配置；手机连不上时再放行入站端口。',
        ),
      ])

      const overviewCard = h('div', { class: 'card' }, [
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
      ])

      const settingsCard = h('div', { class: 'card' }, [
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
      ])

      const filterCard = h('div', { class: 'card' }, [
        h('div', { class: 'head' }, [h('h2', '过滤与推送')]),
        h('div', { class: 'row' }, [
          h('div', { class: 'field' }, [
            h('div', { class: 'label' }, '仅电脑活跃时推送'),
            h('div', { class: 'row-inline' }, [
              h(NSwitch, {
                value: onlyPushWhenActive.value,
                'onUpdate:value': (v) => {
                  onlyPushWhenActive.value = v === true
                  scheduleSave()
                },
              }),
              h('span', { class: 'switch-pair' }, onlyPushWhenActive.value ? '已开启' : '已关闭'),
            ]),
            h(
              'p',
              { class: 'hint' },
              '开启后，电脑处于空闲（无键鼠操作）时收到的通知不弹 Toast，回到活跃状态后才继续推送。',
            ),
          ]),
        ]),
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
      ])

      const urlRows = urls.length ? urls : [primaryUrl]

      const steps = [
        {
          title: '准备条件',
          items: [
            '电脑已安装 Catrace，且能在命令行执行 node 命令（sidecar 依赖 Node）',
            '手机与电脑连接同一 Wi-Fi',
            '手机上安装 SmsForwarder（官方支持 Android 4.4–13，14 以上需实机验证；下载地址见上方）',
            '在 Catrace 插件列表启用 smsforwarder-notify，回到本页「概览」确认服务「运行中」',
            'Windows 防火墙首次弹窗选「允许访问」；手机连不上时再手动放行入站端口',
          ],
        },
        {
          title: 'SmsForwarder 通用设置',
          items: [
            '打开 SmsForwarder → 通用设置，开启需要的转发能力（短信 / 应用通知）',
            '按系统弹窗逐一授权；加入电池优化白名单，允许后台运行，勿强杀',
            '转发应用通知：开启「通知使用权」',
            '设置里开启「启动时异步获取已安装 App 列表」，否则取不到 App 名',
          ],
        },
        {
          title: '新建发送通道（Webhook）',
          items: [
            '发送通道 → 新建，类型选 Webhook，方法选 POST，通道名称随意（如 catrace）',
            {
              kind: 'copy',
              label: 'Webhook Server：选手机能访问的电脑局域网 IP',
              urls: urlRows,
              emptyUrls: !urls.length,
            },
            {
              kind: 'copy',
              label: 'Headers：点 + 加一行，Key / Value 分开填',
              headers: [
                { key: 'Authorization', value: authHeader.replace(/^Authorization:\s*/i, '') },
              ],
            },
            { kind: 'copy', label: '消息模板：整段粘贴', value: template, copyKey: 'copy-tpl' },
            '保存后点「测试」，SmsForwarder 显示发送成功、电脑弹出 Toast 即通道 OK',
          ],
        },
        {
          title: '新建转发规则（通道建好后必做）',
          items: [
            '仅有发送通道不会转发；必须再配「转发规则」并绑定到刚才的通道',
            '应用通知：转发规则 → 通知转发规则 → 新建',
            '短信：转发规则 → 短信转发规则 → 新建（可选）',
            '规则别名随意（如 catrace）；发送通道选刚建的 catrace',
            '匹配字段选「全部」（先跑通全量；之后可改成包名/内容过滤）',
            '「启用自定义模版」「启用正则替换」保持关闭（用通道里的消息模板即可）',
            '打开「启用该条转发规则」，免打扰时段保持 00:00～00:00（相等=不启用）',
            '保存后点「测试」；再让手机来一条真实通知/短信，电脑应弹 Toast',
          ],
        },
      ]

      const renderStepItem = (it) => {
        if (!it || it.kind !== 'copy') return h('li', it)
        if (Array.isArray(it.headers)) {
          return h('li', { class: 'step-copy' }, [
            h('span', { class: 'step-copy-label' }, it.label),
            h(
              'div',
              { class: 'step-copy-values' },
              it.headers.map((hdr) =>
                h('div', { class: 'copy-row', key: hdr.key }, [
                  h('pre', { class: 'mono' }, `${hdr.key}: ${hdr.value}`),
                  h('div', { class: 'row-inline' }, [
                    copyBtn('复制 Key', hdr.key, `copy-hk-${hdr.key}`),
                    copyBtn('复制 Value', hdr.value, `copy-hv-${hdr.key}`),
                  ]),
                ]),
              ),
            ),
          ])
        }
        const rows = Array.isArray(it.urls)
          ? it.urls.map((u) =>
              h('div', { class: 'copy-row', key: u }, [
                h('pre', { class: 'mono' }, u),
                copyBtn('复制', u, `copy-${u}`),
              ]),
            )
          : [
              h('div', { class: 'copy-row' }, [
                h('pre', { class: 'mono' }, it.value),
                copyBtn('复制', it.value, it.copyKey),
              ]),
            ]
        return h('li', { class: 'step-copy' }, [
          h('span', { class: 'step-copy-label' }, it.label),
          h('div', { class: 'step-copy-values' }, rows),
          it.emptyUrls
            ? h('p', { class: 'hint' }, 'URL 列表为空：先启用插件，确认服务运行中，再点「刷新状态」。')
            : null,
        ])
      }

      const tutorialCard = h('div', { class: 'card' }, [
        h('div', { class: 'head' }, [h('h2', '使用教程')]),
        h(
          'p',
          { class: 'desc' },
          '按官方流程：通用设置 → 发送通道 → 转发规则。通道只决定「发到哪」；规则决定「哪些通知/短信会转发」。需要填写的内容点「复制」即可。',
        ),
        h('div', { class: 'field' }, [
          h('div', { class: 'label' }, '下载 SmsForwarder'),
          h(
            'div',
            { class: 'dl-list' },
            DOWNLOAD_LINKS.map((d) =>
              h('div', { class: 'dl-item', key: d.url }, [
                h(
                  'div',
                  { class: 'dl-name' },
                  h(
                    'a',
                    { href: d.url, target: '_blank', rel: 'noopener noreferrer' },
                    d.name,
                  ),
                ),
                h('p', { class: 'dl-note' }, d.note),
              ]),
            ),
          ),
        ]),
        h(
          'div',
          { class: 'steps-wrap' },
          steps.map((s, i) =>
            h('div', { class: 'step', key: s.title }, [
              h('span', { class: 'step-num' }, String(i + 1)),
              h('div', { class: 'step-body' }, [
                h('div', { class: 'step-title' }, s.title),
                h('ul', { class: 'step-list' }, s.items.map(renderStepItem)),
              ]),
            ]),
          ),
        ),
      ])

      const faqCard = h('div', { class: 'card' }, [
        h('div', { class: 'head' }, [h('h2', '常见问题')]),
        ...FAQ.map(([q, a]) =>
          h('div', { class: 'faq', key: q }, [
            h('div', { class: 'faq-q' }, q),
            h('p', { class: 'faq-a' }, a),
          ]),
        ),
      ])

      let panel
      if (activeTab.value === 'settings') {
        panel = h('div', { class: 'sf-tab-panel' }, [settingsCard, filterCard])
      } else if (activeTab.value === 'tutorial') {
        panel = h('div', { class: 'sf-tab-panel' }, [tutorialCard, faqCard])
      } else {
        panel = h('div', { class: 'sf-tab-panel' }, [overviewCard])
      }

      return h('div', { class: 'sf-settings' }, [headerCard, tabBar, panel])
    }
  },
}
