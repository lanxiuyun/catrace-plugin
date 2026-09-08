const vue = globalThis.__CATRACE_VUE__ || {}
const naive = globalThis.__CATRACE_NAIVE__ || {}
const { h, ref, onMounted } = vue
const { NButton, NRadioButton, NRadioGroup, NSwitch, NTag, useMessage } = naive

if (typeof h !== 'function') throw new Error('Vue runtime missing')
if (!NButton || !NRadioGroup || !NTag || !NSwitch || !useMessage) throw new Error('naive runtime missing')
if (!plugin || !plugin.config || !plugin.sidecar) throw new Error('plugin API missing')

const STYLE_ID = 'catrace-plugin-agent-notify-settings-css'
const CSS = `
.an-set { width: 100%; display: flex; flex-direction: column; gap: 1.25rem; }
.an-set .plugin-section { display: flex; flex-direction: column; gap: 0.75rem; }
.an-set .section-title {
  margin: 0; font-size: 0.8125rem; font-weight: 700; color: #475569; letter-spacing: 0.02rem;
}
.an-set .section-card {
  background: #fff; border: 0.0625rem solid #e2e8f0; border-radius: 0.875rem;
  padding: 0.75rem 1rem; box-shadow: 0 0.0625rem 0.125rem rgba(15, 23, 42, 0.03);
}
.an-set .section-desc {
  margin: 0 0 0.5rem; font-size: 0.75rem; color: #94a3b8; line-height: 1.4;
}
.an-set .event-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: 0.75rem; padding: 0.5rem 0;
}
.an-set .event-row + .event-row { border-top: 0.0625rem solid #f1f5f9; }
.an-set .event-name { font-size: 0.8125rem; font-weight: 400; color: #334155; }
.an-set .agent-label { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
`
const EVENTS = [
  { id: 'SessionStart', label: '会话开始' },
  { id: 'UserPromptSubmit', label: '开始思考' },
  { id: 'PreToolUse', label: '调用工具中' },
  { id: 'PostToolUse', label: '工具调用完成' },
  { id: 'PostToolUseFailure', label: '工具调用失败' },
  { id: 'Stop', label: '任务完成' },
  { id: 'Notification', label: '等待交互' },
]
const NAMES = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI', kimi: 'Kimi' }

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = CSS
  document.head.appendChild(el)
}

function section(title, desc, children) {
  return h('section', { class: 'plugin-section' }, [
    h('h3', { class: 'section-title' }, title),
    h('div', { class: 'section-card' }, [
      desc ? h('p', { class: 'section-desc' }, desc) : null,
      ...children,
    ]),
  ])
}

export default {
  name: 'AgentNotifySettings',
  setup() {
    ensureStyles()
    const message = useMessage()
    const agents = ref([])
    const busy = ref('')
    const modes = ref({
      SessionStart: 'off',
      UserPromptSubmit: 'off',
      PreToolUse: 'auto',
      PostToolUse: 'auto',
      PostToolUseFailure: 'sticky',
      Stop: 'sticky',
      Notification: 'sticky',
    })
    const showDebug = ref(false)

    async function load() {
      try {
        const raw = await plugin.config.get()
        if (raw && raw.eventModes) modes.value = { ...modes.value, ...raw.eventModes }
        showDebug.value = !!(raw && raw.showDebug)
      } catch {
        /* ignore */
      }
      try {
        const list = await plugin.sidecar.request('listAgents', {})
        const result = list && list.result ? list.result : list
        agents.value = Array.isArray(result) ? result : []
      } catch {
        agents.value = ['claude', 'codex', 'gemini', 'kimi'].map((id) => ({ id, installed: false }))
      }
    }

    async function persistModes() {
      const cfg = { enabled: true, showDebug: !!showDebug.value, eventModes: { ...modes.value } }
      await plugin.config.set(cfg)
      try {
        await plugin.sidecar.request('setConfig', cfg)
      } catch {
        /* ignore */
      }
    }

    async function setDebug(v) {
      showDebug.value = !!v
      try {
        await persistModes()
      } catch (e) {
        message.error(e instanceof Error ? e.message : String(e))
      }
    }

    async function setMode(event, mode) {
      modes.value = { ...modes.value, [event]: mode }
      try {
        await persistModes()
      } catch (e) {
        message.error(e instanceof Error ? e.message : String(e))
      }
    }

    async function toggle(agent) {
      busy.value = agent.id
      const installing = !agent.installed
      try {
        if (installing) await plugin.sidecar.request('install', { agent: agent.id })
        else await plugin.sidecar.request('uninstall', { agent: agent.id })
        await load()
        const now = agents.value.find((x) => x.id === agent.id)
        if (installing && !now?.installed) {
          message.error('没有写入成功（该 Agent 的配置目录可能不存在）')
        } else {
          message.success(installing ? 'Hook 已安装' : 'Hook 已卸载')
        }
      } catch (e) {
        message.error(e instanceof Error ? e.message : String(e))
      } finally {
        busy.value = ''
      }
    }

    onMounted(load)

    return () =>
      h('div', { class: 'an-set' }, [
        section(
          'Agent 联动',
          '一键写入 agent 的配置文件，让它把状态推送到 Catrace（Claude Desktop 与 Claude Code 共用配置，安装一次即覆盖）',
          agents.value.map((a) =>
            h('div', { class: 'event-row', key: a.id }, [
              h('div', { class: 'agent-label' }, [
                h('span', { class: 'event-name' }, NAMES[a.id] || a.id),
                h(NTag, { size: 'small', type: a.installed ? 'success' : 'default' }, {
                  default: () => (a.installed ? '已安装' : '未安装'),
                }),
              ]),
              h(
                NButton,
                { size: 'small', loading: busy.value === a.id, onClick: () => toggle(a) },
                { default: () => (a.installed ? '卸载 Hook' : '安装 Hook') },
              ),
            ]),
          ),
        ),
        section(
          '调试',
          '打开后，卡片底部会列出这次 Toast 收到的全部字段，方便对照该显示什么。',
          [
            h('div', { class: 'event-row' }, [
              h('span', { class: 'event-name' }, '显示调试字段'),
              h(NSwitch, { value: showDebug.value, onUpdateValue: setDebug }),
            ]),
          ],
        ),
        section(
          '事件通知策略',
          '默认只对「需要你回来」的事件常驻；可按事件改成不通知 / 自动消失 / 常驻。',
          EVENTS.map((ev) =>
            h('div', { class: 'event-row', key: ev.id }, [
              h('span', { class: 'event-name' }, ev.label),
              h(
                NRadioGroup,
                {
                  value: modes.value[ev.id],
                  size: 'small',
                  onUpdateValue: (v) => setMode(ev.id, v),
                },
                {
                  default: () => [
                    h(NRadioButton, { value: 'off' }, { default: () => '不通知' }),
                    h(NRadioButton, { value: 'auto' }, { default: () => '自动消失' }),
                    h(NRadioButton, { value: 'sticky' }, { default: () => '常驻' }),
                  ],
                },
              ),
            ]),
          ),
        ),
      ])
  },
}
