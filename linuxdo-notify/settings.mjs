/** linuxdo-notify settings — cookie / poll / card duration / active gate. */
const vue = globalThis.__CATRACE_VUE__ || {}
const naive = globalThis.__CATRACE_NAIVE__ || {}
const { h, ref, computed, onMounted } = vue
const { NButton, NInput, NSwitch, NTag, useMessage } = naive

if (typeof h !== 'function' || typeof ref !== 'function') {
  throw new Error('Catrace plugin Vue runtime missing (__CATRACE_VUE__.h)')
}
if (!NButton || !NInput || !NSwitch || !NTag || !useMessage) {
  throw new Error('Catrace plugin naive runtime missing (__CATRACE_NAIVE__)')
}
if (!plugin || !plugin.config || !plugin.events || !plugin.setEnabled) {
  throw new Error('Catrace plugin API missing (plugin facade)')
}

const PLUGIN_ID = 'linuxdo-notify'
const MIN_POLL_SEC = 15
const MAX_POLL_SEC = 3600
const MIN_CARD_SEC = 0
const MAX_CARD_SEC = 600
const DEFAULT_POLL_SEC = 60
const DEFAULT_CARD_SEC = 10
const DEFAULT_BASE_URL = 'https://linux.do'

const STYLE_ID = 'catrace-plugin-linuxdo-notify-settings-css'
const CSS = `
.ld-settings {
  width: 100%; box-sizing: border-box;
  display: flex; flex-direction: column; gap: 0.75rem;
  color: #1f2328;
}
.ld-settings *, .ld-settings *::before, .ld-settings *::after { box-sizing: border-box; }
.ld-settings .card {
  padding: 1rem 1.25rem;
  border: 0.0625rem solid #f0d0b8;
  border-radius: 0.875rem;
  background: #fff;
  display: flex; flex-direction: column; gap: 0.75rem;
}
.ld-settings .head {
  display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;
}
.ld-settings h2 { margin: 0; font-size: 0.9375rem; font-weight: 700; color: #1f2328; }
.ld-settings .desc { margin: 0; font-size: 0.8125rem; line-height: 1.55; color: #656d76; }
.ld-settings .field { display: flex; flex-direction: column; gap: 0.375rem; min-width: 0; }
.ld-settings .label { font-size: 0.75rem; font-weight: 600; color: #656d76; }
.ld-settings .hint { margin: 0; font-size: 0.6875rem; color: #8b949e; line-height: 1.45; }
.ld-settings .row {
  display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;
}
.ld-settings .row-inline { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.ld-settings .num { width: 6.5rem; }
.ld-settings .unit { font-size: 0.75rem; color: #656d76; font-weight: 600; }
.ld-settings .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.ld-settings .status {
  display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 0.75rem;
  padding: 0.625rem 0.75rem; border-radius: 0.5rem; background: #fff7f0;
  font-size: 0.75rem; color: #424a53;
}
.ld-settings .status strong { color: #e85d04; font-weight: 650; }
.ld-settings .switch-pair {
  display: inline-flex; align-items: center; gap: 0.5rem;
  font-size: 0.8125rem; color: #424a53; font-weight: 500;
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

function clamp(n, min, max, fallback) {
  const v = Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.min(max, Math.max(min, Math.round(v)))
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

/** Parse legacy single-line cookie into named parts. */
function parseCookieBlob(raw) {
  const out = { _t: '', _forum_session: '', cf_clearance: '' }
  const s = String(raw || '')
    .replace(/^Cookie:\s*/i, '')
    .trim()
  if (!s) return out
  for (const part of s.split(';')) {
    const idx = part.indexOf('=')
    if (idx <= 0) continue
    const k = part.slice(0, idx).trim()
    const v = part.slice(idx + 1).trim()
    if (k === '_t' && v) out._t = v
    else if (k === '_forum_session' && v) out._forum_session = v
    else if (k === 'cf_clearance' && v) out.cf_clearance = v
  }
  // bare value without key → treat as _t if only one token and no keys matched
  if (!out._t && !out._forum_session && s && !s.includes('=')) {
    out._t = s
  }
  return out
}

function stripCookieValue(raw, key) {
  let s = String(raw || '').trim()
  if (!s) return ''
  // user pasted "key=value" or "key = value"
  const re = new RegExp(`^${key}\\s*=\\s*`, 'i')
  s = s.replace(re, '')
  // also strip wrapping quotes
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1)
  }
  return s.trim()
}

function buildSessionCookie(cookieT, cookieForumSession, cookieCfClearance = '', cookieExtra = '') {
  const parts = []
  const t = stripCookieValue(cookieT, '_t')
  const fs = stripCookieValue(cookieForumSession, '_forum_session')
  const cf = stripCookieValue(cookieCfClearance, 'cf_clearance')
  if (t) parts.push(`_t=${t}`)
  if (fs) parts.push(`_forum_session=${fs}`)
  if (cf) parts.push(`cf_clearance=${cf}`)
  const extra = String(cookieExtra || '')
    .replace(/^Cookie:\s*/i, '')
    .trim()
  if (extra) {
    for (const part of extra.split(';')) {
      const p = part.trim()
      if (!p || !p.includes('=')) continue
      const k = p.slice(0, p.indexOf('=')).trim()
      if (k === '_t' || k === '_forum_session' || k === 'cf_clearance') continue
      parts.push(p)
    }
  }
  return parts.join('; ')
}

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

const DEFAULT_CONFIG = {
  baseUrl: DEFAULT_BASE_URL,
  cookieT: '',
  cookieForumSession: '',
  cookieCfClearance: '',
  cookieExtra: '',
  sessionCookie: '',
  apiKey: '',
  apiUsername: '',
  userAgent: DEFAULT_UA,
  proxyUrl: '',
  pollIntervalSec: DEFAULT_POLL_SEC,
  cardDurationSec: DEFAULT_CARD_SEC,
  onlyWhenActive: true,
  enabled: true,
}

export default {
  name: 'LinuxdoNotifySettings',
  setup(_props, { expose }) {
    ensureStyles()
    const message = useMessage()
    const loading = ref(true)
    const busy = ref('')
    const headerLoading = ref(false)
    const baseUrl = ref(DEFAULT_BASE_URL)
    const cookieT = ref('')
    const cookieForumSession = ref('')
    const cookieCfClearance = ref('')
    const cookieExtra = ref('')
    const apiKey = ref('')
    const apiUsername = ref('')
    const userAgent = ref(DEFAULT_UA)
    const proxyUrl = ref('')
    const pollIntervalSec = ref(DEFAULT_POLL_SEC)
    const cardDurationSec = ref(DEFAULT_CARD_SEC)
    const onlyWhenActive = ref(true)
    const enabled = ref(true)
    const status = ref(null)
    let saveTimer = null

    const headerEnabled = computed(() => enabled.value !== false)

    function normalizeProxyInput(raw) {
      const s = String(raw || '').trim()
      if (!s) return ''
      const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s) ? s : `http://${s}`
      try {
        const u = new URL(withScheme)
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
        if (!u.hostname) return ''
        return u.href.replace(/\/$/, '')
      } catch {
        return s
      }
    }

    function currentConfig() {
      const t = stripCookieValue(cookieT.value, '_t')
      const fs = stripCookieValue(cookieForumSession.value, '_forum_session')
      const cf = stripCookieValue(cookieCfClearance.value, 'cf_clearance')
      const extra = String(cookieExtra.value || '')
        .replace(/^Cookie:\s*/i, '')
        .trim()
      const ua = String(userAgent.value || '').trim() || DEFAULT_UA
      return {
        baseUrl: String(baseUrl.value || DEFAULT_BASE_URL).trim().replace(/\/+$/, '') || DEFAULT_BASE_URL,
        cookieT: t,
        cookieForumSession: fs,
        cookieCfClearance: cf,
        cookieExtra: extra,
        sessionCookie: buildSessionCookie(t, fs, cf, extra),
        apiKey: String(apiKey.value || '').trim(),
        apiUsername: String(apiUsername.value || '').trim(),
        userAgent: ua,
        proxyUrl: normalizeProxyInput(proxyUrl.value),
        pollIntervalSec: clamp(pollIntervalSec.value, MIN_POLL_SEC, MAX_POLL_SEC, DEFAULT_POLL_SEC),
        cardDurationSec: clamp(cardDurationSec.value, MIN_CARD_SEC, MAX_CARD_SEC, DEFAULT_CARD_SEC),
        onlyWhenActive: onlyWhenActive.value !== false,
        enabled: enabled.value !== false,
      }
    }

    function applyConfig(cfg = {}) {
      if (typeof cfg.baseUrl === 'string' && cfg.baseUrl.trim()) {
        baseUrl.value = cfg.baseUrl.trim().replace(/\/+$/, '')
      }
      let t = typeof cfg.cookieT === 'string' ? cfg.cookieT : ''
      let fs = typeof cfg.cookieForumSession === 'string' ? cfg.cookieForumSession : ''
      let cf = typeof cfg.cookieCfClearance === 'string' ? cfg.cookieCfClearance : ''
      // migrate legacy single blob
      if ((!t || !fs) && typeof cfg.sessionCookie === 'string' && cfg.sessionCookie.trim()) {
        const parsed = parseCookieBlob(cfg.sessionCookie)
        if (!t && parsed._t) t = parsed._t
        if (!fs && parsed._forum_session) fs = parsed._forum_session
        if (!cf && parsed.cf_clearance) cf = parsed.cf_clearance
      }
      cookieT.value = stripCookieValue(t, '_t')
      cookieForumSession.value = stripCookieValue(fs, '_forum_session')
      cookieCfClearance.value = stripCookieValue(cf, 'cf_clearance')
      cookieExtra.value = typeof cfg.cookieExtra === 'string' ? cfg.cookieExtra : ''
      apiKey.value = typeof cfg.apiKey === 'string' ? cfg.apiKey : ''
      apiUsername.value = typeof cfg.apiUsername === 'string' ? cfg.apiUsername : ''
      userAgent.value =
        typeof cfg.userAgent === 'string' && cfg.userAgent.trim() ? cfg.userAgent.trim() : DEFAULT_UA
      proxyUrl.value = typeof cfg.proxyUrl === 'string' ? cfg.proxyUrl : ''
      pollIntervalSec.value = clamp(cfg.pollIntervalSec, MIN_POLL_SEC, MAX_POLL_SEC, DEFAULT_POLL_SEC)
      cardDurationSec.value = clamp(cfg.cardDurationSec, MIN_CARD_SEC, MAX_CARD_SEC, DEFAULT_CARD_SEC)
      onlyWhenActive.value = cfg.onlyWhenActive !== false
      enabled.value = cfg.enabled !== false
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

    async function readActivityPulse() {
      try {
        if (plugin.storage && typeof plugin.storage.get === 'function') {
          const pulse = await plugin.storage.get('activity_pulse')
          if (pulse && typeof pulse.active === 'boolean') return !!pulse.active
        }
      } catch {
        /* ignore */
      }
      return null
    }

    async function persistAndSync({ quiet = false } = {}) {
      const cfg = currentConfig()
      pollIntervalSec.value = cfg.pollIntervalSec
      cardDurationSec.value = cfg.cardDurationSec
      baseUrl.value = cfg.baseUrl
      await plugin.config.set(cfg)
      try {
        if (plugin.sidecar && typeof plugin.sidecar.request === 'function') {
          const activityActive = await readActivityPulse()
          const payload = activityActive == null ? cfg : { ...cfg, activityActive }
          await plugin.sidecar.request('setConfig', payload)
        }
        if (!quiet) message.success('已保存')
      } catch (error) {
        if (!quiet) message.warning('已保存（启用插件后 sidecar 生效）')
        await plugin.log?.warn?.('config saved without sidecar', { error: errorText(error) })
      }
    }

    async function forwardActivityPulse() {
      try {
        if (!plugin.sidecar || typeof plugin.sidecar.request !== 'function') return
        const active = await readActivityPulse()
        if (active == null) return
        await plugin.sidecar.request('setActivity', { active })
      } catch {
        /* ignore */
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
        status.value = { error: 'sidecar 未运行（请启用插件）' }
        return
      }
      const result = await plugin.sidecar.request('getStatus')
      status.value = result && typeof result === 'object' ? result : { raw: result }
    }

    async function pollNow() {
      await run('poll', async () => {
        await persistAndSync({ quiet: true })
        if (!plugin.sidecar?.request) {
          message.warning('sidecar 未运行')
          return
        }
        const result = await plugin.sidecar.request('pollNow', { forceFull: true })
        status.value = result
        if (result?.held) {
          message.warning(`有 ${result.held} 条，但当前不活跃，暂不弹窗`)
        } else {
          message.success(
            result?.newCount
              ? `拉取完成，新增 ${result.newCount} 条（已推送）`
              : result?.seeded
                ? '已建立基线（不弹历史）'
                : result?.skipped
                   ? '已跳过（检查 API Key 或 Cookie / 开关）'
                  : '拉取完成，无新通知',
          )
        }
      })
    }

    async function resetAndReseed() {
      await run('reset', async () => {
        if (!plugin.sidecar?.request) {
          message.warning('sidecar 未运行')
          return
        }
        await plugin.sidecar.request('resetSeen')
        const result = await plugin.sidecar.request('pollNow', { forceSeed: true, forceFull: true })
        status.value = result
        message.success('已清空已见记录并重新建基线（不弹历史）')
      })
    }

    async function sendTest() {
      await run('test', async () => {
        const cfg = currentConfig()
        const sticky = cfg.cardDurationSec <= 0
        const base = cfg.baseUrl || DEFAULT_BASE_URL
        await plugin.events.publish({
          eventType: 'linuxdo-notify.notification',
          kind: 'linuxdo-notify',
          title: '回复 · 测试主题',
          body: '这是一条 LINUX DO 测试通知',
          level: 'info',
          sticky,
          actions: [
            { id: 'open', label: '打开' },
            { id: 'dismiss', label: sticky ? '知道了' : '关闭' },
          ],
          payload: {
            notification_id: `test-${Date.now()}`,
            notification_type: 'replied',
            type_label: '回复了你',
            topic_id: 1,
            topic_title: '测试主题：欢迎来到 LINUX DO',
            post_number: 2,
            excerpt: '这是一条 LINUX DO 测试通知正文摘要。',
            acting_username: 'test_user',
            html_url: `${base}/t/topic/1/2`,
            created_at: new Date().toISOString(),
            auto_hide_ms: sticky ? 0 : cfg.cardDurationSec * 1000,
            card_duration_sec: cfg.cardDurationSec,
          },
          dedupeKey: `linuxdo-notify:test:${Date.now()}`,
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
          if (plugin.sidecar?.request) await plugin.sidecar.request('setConfig', currentConfig())
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

    let activityTimer = null
    onMounted(() => {
      run('boot', async () => {
        loading.value = true
        try {
          const raw = await plugin.config.get()
          applyConfig(raw && typeof raw === 'object' ? raw : DEFAULT_CONFIG)
          try {
            await refreshStatus()
          } catch {
            status.value = null
          }
          forwardActivityPulse().catch(() => {})
          activityTimer = setInterval(() => {
            forwardActivityPulse().catch(() => {})
          }, 5000)
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
      const statusRows = st.error
        ? [['状态', st.error]]
        : [
            ['站点', st.baseUrl || '-'],
            ['代理', st.hasProxy ? st.proxyUrl || '已配置' : '未配置（直连）'],
            ['API', st.hasApiAuth ? '已配置' : '未配置'],
            [
              'Cookie',
              st.hasCookie
                ? `已配置${st.hasCookieT === false ? '（缺 _t）' : ''}${st.hasCookieForumSession === false ? '（缺 session）' : ''}${st.hasCfClearance === false ? '（缺 cf）' : ''}`
                : '未配置',
            ],
            ['基线', st.seeded ? '已建立' : '未建立'],
            ['已见', String(st.seenCount ?? '-')],
            ['已推送', String(st.publishCount ?? '-')],
            ['上次轮询', st.lastPollAt ? new Date(st.lastPollAt).toLocaleTimeString() : '-'],
            ['HTTP', st.lastPollStatus ? String(st.lastPollStatus) : '-'],
            [
              '活跃门控',
              st.hostActivityActive == null
                ? '未同步（关设置页时默认放行）'
                : st.hostActivityActive
                  ? '活跃'
                  : '不活跃',
            ],
            ['错误', st.lastPollError || '无'],
          ]

      return h('div', { class: 'ld-settings' }, [
        h('div', { class: 'card' }, [
          h('div', { class: 'head' }, [
            h('h2', 'LINUX DO 通知'),
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
            '推荐：API Key + 用户名（偏好设置→安全/API）。Cookie 方案需代理 + 与浏览器一致的 UA + 刚过验证的 cf_clearance。首次只建基线不弹历史。',
          ),
          h('div', { class: 'field' }, [
            h('div', { class: 'label' }, '站点地址'),
            h(NInput, {
              value: baseUrl.value,
              placeholder: DEFAULT_BASE_URL,
              'onUpdate:value': (v) => {
                baseUrl.value = v
                scheduleSave()
              },
            }),
          ]),
          h('div', { class: 'field' }, [
            h('div', { class: 'label' }, 'HTTP 代理（浏览器开 linux.do 用的那个）'),
            h(NInput, {
              value: proxyUrl.value,
              placeholder: 'http://127.0.0.1:7890  （Clash / V2 混合端口）',
              'onUpdate:value': (v) => {
                proxyUrl.value = v
                scheduleSave()
              },
            }),
            h(
              'p',
              { class: 'hint' },
              'Node 不走系统代理。仅支持 http 代理 + HTTPS CONNECT，不支持 socks5。',
            ),
          ]),
          h('div', { class: 'field' }, [
            h('div', { class: 'label' }, 'Discourse API Key（推荐）'),
            h(NInput, {
              value: apiKey.value,
              type: 'password',
              showPasswordOn: 'click',
              placeholder: '用户偏好设置 → 安全 → API → 新建密钥',
              'onUpdate:value': (v) => {
                apiKey.value = v
                scheduleSave()
              },
            }),
          ]),
          h('div', { class: 'field' }, [
            h('div', { class: 'label' }, 'API 用户名'),
            h(NInput, {
              value: apiUsername.value,
              placeholder: '你的 linux.do 用户名（与 Key 绑定）',
              'onUpdate:value': (v) => {
                apiUsername.value = v
                scheduleSave()
              },
            }),
            h(
              'p',
              { class: 'hint' },
              '有 API Key 时优先走 Api-Key / Api-Username 头，仍可能被 Cloudflare 拦，代理仍建议开。',
            ),
          ]),
          h('div', { class: 'field' }, [
            h('div', { class: 'label' }, 'User-Agent（须与浏览器完全一致）'),
            h(NInput, {
              value: userAgent.value,
              type: 'textarea',
              autosize: { minRows: 2, maxRows: 4 },
              placeholder: DEFAULT_UA,
              'onUpdate:value': (v) => {
                userAgent.value = v
                scheduleSave()
              },
            }),
            h(
              'p',
              { class: 'hint' },
              'F12 → Network → 点任意 linux.do 请求 → Request Headers → user-agent 整段复制。cf_clearance 和 UA 绑定，不一致必拦。',
            ),
          ]),
          h('div', { class: 'field' }, [
            h('div', { class: 'label' }, 'Cookie · _t'),
            h(NInput, {
              value: cookieT.value,
              type: 'password',
              showPasswordOn: 'click',
              placeholder: '双击浏览器 Cookies 表「值」列复制（可带 _t= 前缀）',
              'onUpdate:value': (v) => {
                cookieT.value = v
                scheduleSave()
              },
            }),
          ]),
          h('div', { class: 'field' }, [
            h('div', { class: 'label' }, 'Cookie · _forum_session'),
            h(NInput, {
              value: cookieForumSession.value,
              type: 'password',
              showPasswordOn: 'click',
              placeholder: '会话 Cookie 值（可带 _forum_session= 前缀）',
              'onUpdate:value': (v) => {
                cookieForumSession.value = v
                scheduleSave()
              },
            }),
          ]),
          h('div', { class: 'field' }, [
            h('div', { class: 'label' }, 'Cookie · cf_clearance'),
            h(NInput, {
              value: cookieCfClearance.value,
              type: 'password',
              showPasswordOn: 'click',
              placeholder: '过完 Cloudflare 后立刻复制',
              'onUpdate:value': (v) => {
                cookieCfClearance.value = v
                scheduleSave()
              },
            }),
          ]),
          h('div', { class: 'field' }, [
            h('div', { class: 'label' }, '额外 Cookie（可选，如 __cf_bm）'),
            h(NInput, {
              value: cookieExtra.value,
              type: 'password',
              showPasswordOn: 'click',
              placeholder: '__cf_bm=...; 其它=...',
              'onUpdate:value': (v) => {
                cookieExtra.value = v
                scheduleSave()
              },
            }),
            h(
              'p',
              { class: 'hint' },
              'Chrome → Application → Cookies → https://linux.do。Cookie 方案：代理 + 同 UA + 新鲜 cf_clearance。更稳请用上面 API Key。仅存本机。',
            ),
          ]),
          h('div', { class: 'row' }, [
            h('div', { class: 'field' }, [
              h('div', { class: 'label' }, '轮询间隔'),
              h('div', { class: 'row-inline' }, [
                h(NInput, {
                  class: 'num',
                  value: String(pollIntervalSec.value),
                  'onUpdate:value': (v) => {
                    pollIntervalSec.value = clamp(v, MIN_POLL_SEC, MAX_POLL_SEC, DEFAULT_POLL_SEC)
                    scheduleSave()
                  },
                }),
                h('span', { class: 'unit' }, '秒'),
              ]),
            ]),
            h('div', { class: 'field' }, [
              h('div', { class: 'label' }, '卡片停留'),
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
          ]),
          h('div', { class: 'row' }, [
            h('span', { class: 'switch-pair' }, [
              h(NSwitch, {
                value: onlyWhenActive.value,
                'onUpdate:value': (v) => {
                  onlyWhenActive.value = !!v
                  scheduleSave()
                },
              }),
              '仅在用户活跃时推送',
            ]),
          ]),
          h('div', { class: 'actions' }, [
            h(
              NButton,
              {
                size: 'small',
                type: 'primary',
                loading: busy.value === 'poll',
                disabled: !!busy.value && busy.value !== 'poll',
                onClick: pollNow,
              },
              { default: () => '立即拉取' },
            ),
            h(
              NButton,
              {
                size: 'small',
                loading: busy.value === 'test',
                disabled: !!busy.value && busy.value !== 'test',
                onClick: sendTest,
              },
              { default: () => '测试卡片' },
            ),
            h(
              NButton,
              {
                size: 'small',
                loading: busy.value === 'status',
                disabled: !!busy.value && busy.value !== 'status',
                onClick: () => run('status', refreshStatus),
              },
              { default: () => '刷新状态' },
            ),
            h(
              NButton,
              {
                size: 'small',
                loading: busy.value === 'reset',
                disabled: !!busy.value && busy.value !== 'reset',
                onClick: resetAndReseed,
              },
              { default: () => '重置基线' },
            ),
          ]),
        ]),
        h('div', { class: 'card' }, [
          h('div', { class: 'head' }, [h('h2', '运行状态')]),
          loading.value
            ? h('p', { class: 'desc' }, '加载中…')
            : h(
                'div',
                { class: 'status' },
                statusRows.flatMap(([k, v]) => [h('strong', k), h('span', String(v))]),
              ),
        ]),
      ])
    }
  },
}
