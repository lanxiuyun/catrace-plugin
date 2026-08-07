/** github-notify settings — token / poll / card duration / active gate. */
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

const PLUGIN_ID = 'github-notify'
const MIN_POLL_SEC = 1
const MAX_POLL_SEC = 3600
const MIN_CARD_SEC = 0
const MAX_CARD_SEC = 600
const DEFAULT_POLL_SEC = 60
const DEFAULT_CARD_SEC = 10

const STYLE_ID = 'catrace-plugin-github-notify-settings-css'
const CSS = `
.gh-settings {
  width: 100%; box-sizing: border-box;
  display: flex; flex-direction: column; gap: 0.75rem;
  color: #1f2328;
}
.gh-settings *, .gh-settings *::before, .gh-settings *::after { box-sizing: border-box; }
.gh-settings .card {
  padding: 1rem 1.25rem;
  border: 0.0625rem solid #d0d7de;
  border-radius: 0.875rem;
  background: #fff;
  display: flex; flex-direction: column; gap: 0.75rem;
}
.gh-settings .head {
  display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;
}
.gh-settings h2 { margin: 0; font-size: 0.9375rem; font-weight: 700; color: #1f2328; }
.gh-settings .desc { margin: 0; font-size: 0.8125rem; line-height: 1.55; color: #656d76; }
.gh-settings .field { display: flex; flex-direction: column; gap: 0.375rem; min-width: 0; }
.gh-settings .label { font-size: 0.75rem; font-weight: 600; color: #656d76; }
.gh-settings .hint { margin: 0; font-size: 0.6875rem; color: #8b949e; line-height: 1.45; }
.gh-settings .row {
  display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;
}
.gh-settings .row-inline { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.gh-settings .num { width: 6.5rem; }
.gh-settings .unit { font-size: 0.75rem; color: #656d76; font-weight: 600; }
.gh-settings .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.gh-settings .status {
  display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 0.75rem;
  padding: 0.625rem 0.75rem; border-radius: 0.5rem; background: #f6f8fa;
  font-size: 0.75rem; color: #424a53;
}
.gh-settings .status strong { color: #0969da; font-weight: 650; }
.gh-settings .switch-pair {
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

const DEFAULT_CONFIG = {
  token: '',
  pollIntervalSec: DEFAULT_POLL_SEC,
  cardDurationSec: DEFAULT_CARD_SEC,
  onlyWhenActive: true,
  enabled: true,
}

export default {
  name: 'GithubNotifySettings',
  setup(_props, { expose }) {
    ensureStyles()
    const message = useMessage()
    const loading = ref(true)
    const busy = ref('')
    const headerLoading = ref(false)
    const token = ref('')
    const pollIntervalSec = ref(DEFAULT_POLL_SEC)
    const cardDurationSec = ref(DEFAULT_CARD_SEC)
    const onlyWhenActive = ref(true)
    const enabled = ref(true)
    const status = ref(null)
    let saveTimer = null

    const headerEnabled = computed(() => enabled.value !== false)

    function currentConfig() {
      return {
        token: String(token.value || '').trim(),
        pollIntervalSec: clamp(pollIntervalSec.value, MIN_POLL_SEC, MAX_POLL_SEC, DEFAULT_POLL_SEC),
        cardDurationSec: clamp(cardDurationSec.value, MIN_CARD_SEC, MAX_CARD_SEC, DEFAULT_CARD_SEC),
        onlyWhenActive: onlyWhenActive.value !== false,
        enabled: enabled.value !== false,
      }
    }

    function applyConfig(cfg = {}) {
      if (typeof cfg.token === 'string') token.value = cfg.token
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
      await plugin.config.set(cfg)
      try {
        if (plugin.sidecar && typeof plugin.sidecar.request === 'function') {
          const activityActive = await readActivityPulse()
          const payload =
            activityActive == null ? cfg : { ...cfg, activityActive }
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
        // forceFull on sidecar side — bypass 304 cache
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
                  ? '已跳过（检查 Token / 开关）'
                  : result?.notModified
                    ? 'GitHub 返回 304（无变更）'
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
        await plugin.events.publish({
          eventType: 'github-notify.notification',
          kind: 'github-notify',
          title: 'PR · octocat/Hello-World',
          body: 'Fix readme typo（测试通知）',
          level: 'info',
          sticky,
          actions: [
            { id: 'open', label: '打开' },
            { id: 'dismiss', label: sticky ? '知道了' : '关闭' },
          ],
          payload: {
            notification_id: `test-${Date.now()}`,
            repo: 'octocat/Hello-World',
            subject_type: 'PullRequest',
            subject_title: 'Fix readme typo（测试通知）',
            reason: 'review_requested',
            reason_label: '请求评审',
            html_url: 'https://github.com/notifications',
            updated_at: new Date().toISOString(),
            auto_hide_ms: sticky ? 0 : cfg.cardDurationSec * 1000,
            card_duration_sec: cfg.cardDurationSec,
          },
          dedupeKey: `github-notify:test:${Date.now()}`,
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
          // settings window can talk to sidecar — forward background activity pulse
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
            ['Token', st.hasToken ? '已配置' : '未配置'],
            ['基线', st.seeded ? '已建立' : '未建立'],
            ['已见', String(st.seenCount ?? '-')],
            ['已推送', String(st.publishCount ?? '-')],
            ['连续304', String(st.consecutive304 ?? 0)],
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

      return h('div', { class: 'gh-settings' }, [
        h('div', { class: 'card' }, [
          h('div', { class: 'head' }, [
            h('h2', 'GitHub 通知'),
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
            '用 Personal Access Token 轮询 GitHub Notifications API。首次仅建立基线不弹历史；之后新通知在活跃时弹出卡片。',
          ),
          h('div', { class: 'field' }, [
            h('div', { class: 'label' }, 'GitHub PAT'),
            h(NInput, {
              value: token.value,
              type: 'password',
              showPasswordOn: 'click',
              placeholder: 'ghp_… 或 github_pat_…（notifications 读权限）',
              'onUpdate:value': (v) => {
                token.value = v
                scheduleSave()
              },
            }),
            h(
              'p',
              { class: 'hint' },
              '经典 Token 勾选 notifications；Fine-grained 需 Repository access + Notifications 读权限。Token 仅存本机 plugin_config。',
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
