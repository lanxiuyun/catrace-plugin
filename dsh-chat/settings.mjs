/**
 * dsh-chat 插件设置面板。
 *
 * 关键点：
 *  1. **输入必须真能改**：之前用 `value` + `onChange`（受控但没人接 update）→ 打字不会落，
 *     所以「设置完全没办法调整」。现在全部 `onUpdate:value` 写回本地表单，再 debounce 落盘。
 *  2. **数值字段先存字符串、保存时钳制**：边打字边钳会让「12」打成「1」就被改成 6。
 *  3. **行排版自造（field）**：宿主 SettingRow 给右侧控件只保证 ≈4rem 余量，desc 一长就把
 *     输入框压扁（数字只剩「23」，实测）；自造的 field 让说明整行长在下面，任何宽度都安全。
 *  4. 根节点不写外层 padding / max-width（详情区外壳负责），长文本一律可换行，避免横向滚动条。
 *  5. **保存要有脏检查**：输入框 onBlur 会触发保存——点进去再点走（没改任何东西）不该弹
 *     「已保存」、更不该反复写盘。
 *
 * 0.3.0 起大幅瘦身：镜像卡 / SDK 对话链路已移除，「对话」「DSH 会话」两张卡没了；
 * 小窗只剩官方 GUI 一种形态；外观只剩 4 个顶层开关，细粒度微调走自定义 CSS。
 */
const { h, ref, onMounted, onBeforeUnmount } = globalThis.__CATRACE_VUE__ || {}
const { NAlert, NButton, NInput, NSwitch, NTag, NTooltip, useMessage } =
  globalThis.__CATRACE_NAIVE__ || {}

if (typeof h !== 'function') throw new Error('Catrace plugin Vue runtime missing')

const STYLE_ID = 'dsh-chat-settings-style'

/** RPC 契约版本：与 runtime/main.mjs 的 CONTRACT_VERSION 必须一致（改动 RPC 就两边一起 +1） */
const CONTRACT_VERSION = 7

/**
 * 默认值（必须与 runtime/lib/config.mjs 的 DEFAULT_CONFIG 一致；
 * plugin-contract.test.mjs 会比对这两处，防止漂移）。
 */
const DEFAULTS = {
  dshHome: '',
  // 状态通知（与 runtime/lib/config.mjs 的 DEFAULT_CONFIG 逐键一致）
  noticeEnabled: true,
  noticePollMs: 2000,
  noticeDoneHoldMs: 30000,
  httpPort: 23457,
  guiPort: 23458,
  compactSpacing: false,
  // 小窗里"显示哪些元素"（true = 显示）；与 runtime/lib/config.mjs 的 DEFAULT_CONFIG 逐键一致
  showRail: false,
  showHeader: false,
  showTabs: false,
  showHeaderIcons: false,
  showHeaderMore: true,
  showHeaderPanel: true,
  showHeaderTitle: false,
  showHeaderChips: true,
  showComposerStatus: false,
  showMessageMeta: false,
  showHeaderLabels: false,
  customCss: '',
}

const LIMITS = {
  noticePollMs: { min: 500, max: 30000 },
  noticeDoneHoldMs: { min: 3000, max: 600000 },
  httpPort: { min: 0, max: 65535 },
  guiPort: { min: 0, max: 65535 },
}

const SETTINGS_CSS = `
.dsh-chat-settings { display: flex; flex-direction: column; gap: 1rem; font-size: 0.8125rem; min-width: 0; }
.dsh-chat-settings__card {
  border: 1px solid var(--ct-border, rgba(0,0,0,0.08)); border-radius: 0.75rem;
  padding: 0.25rem 1rem 0.75rem; display: flex; flex-direction: column;
  background: var(--ct-surface, #fff); min-width: 0;
}
.dsh-chat-settings__head { display: flex; align-items: center; gap: 0.5rem; padding: 0.75rem 0 0.25rem; }
.dsh-chat-settings__head-title { font-weight: 600; font-size: 0.875rem; color: var(--ct-text, #2e1065); }
.dsh-chat-settings__head-actions { margin-left: auto; display: flex; align-items: center; gap: 0.25rem; }
.dsh-chat-settings__head-desc { color: var(--ct-text-muted, #8a94a6); font-size: 0.75rem; padding-bottom: 0.375rem; line-height: 1.5; }
/* 小窗外观：chip 分组 */
.dsh-chat-settings__group { padding: 0.375rem 0 0.25rem; }
.dsh-chat-settings__tags { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 0.5rem; padding: 0.25rem 0 0.375rem; }
/* 描边 chip：checkable 的 NTag 会忽略 bordered（边框层条件是 !checkable），未选中就是透明底，
   所以描边/底色全部自己画，并且用紫色系——浅色与深色主题下都看得见。 */
.dsh-chat-settings__chip {
  border-radius: 999px !important;
  padding: 0.125rem 0.625rem !important;
  line-height: 1.6 !important;
  cursor: pointer;
  transition: border-color 0.15s, background-color 0.15s, color 0.15s;
}
.dsh-chat-settings__chip:not(.is-on) {
  border: 1px solid rgba(124, 58, 237, 0.38) !important;
  background: rgba(124, 58, 237, 0.07) !important;
  color: var(--ct-text, #2e1065) !important;
}
.dsh-chat-settings__chip:not(.is-on):hover { border-color: rgba(124, 58, 237, 0.8) !important; background: rgba(124, 58, 237, 0.14) !important; }
.dsh-chat-settings__chip.is-on { border: 1px solid transparent !important; }
/* 全宽块（自定义 CSS 区这类内容用） */
.dsh-chat-settings__block { display: flex; flex-direction: column; gap: 0.375rem; }
.dsh-chat-settings__block-title { font-weight: 600; font-size: 0.8125rem; color: var(--ct-text, #2e1065); }
.dsh-chat-settings__block-desc { font-size: 0.75rem; color: var(--ct-text-muted, #8a94a6); line-height: 1.5; overflow-wrap: anywhere; }
.dsh-chat-settings__block-actions { display: flex; gap: 0.375rem; }
/* class 速查表 */
.dsh-chat-settings__cls-note { font-size: 0.75rem; color: var(--ct-text-muted, #8a94a6); line-height: 1.5; padding-bottom: 0.375rem; }
.dsh-chat-settings__cls-note.is-warn { color: #b45309; background: rgba(245, 158, 11, 0.08); border-radius: 0.375rem; padding: 0.5rem 0.625rem; margin-top: 0.5rem; }
.dsh-chat-settings__cls-group { font-size: 0.75rem; font-weight: 600; color: var(--ct-text-muted, #8a94a6); padding: 0.5rem 0 0.125rem; }
.dsh-chat-settings__cls-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.125rem 0; min-width: 0; }
.dsh-chat-settings__cls-selector { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.6875rem; color: var(--ct-text, #2e1065); flex: 0 0 auto; }
.dsh-chat-settings__cls-desc { font-size: 0.6875rem; color: var(--ct-text-muted, #8a94a6); flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
.dsh-chat-settings__code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.75rem; overflow-wrap: anywhere; }
.dsh-chat-settings__muted { color: var(--ct-text-muted, #8a94a6); font-size: 0.75rem; overflow-wrap: anywhere; }
/* 带输入框的行：标题/控件一行，说明整行长在下面（对窄面板安全，见 settings.mjs 的 field() 注释） */
.dsh-chat-settings__field { padding: 0.625rem 0; display: flex; flex-direction: column; gap: 0.125rem; min-width: 0; }
.dsh-chat-settings__field-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; min-width: 0; }
.dsh-chat-settings__field-title { font-size: 0.875rem; font-weight: 600; color: var(--ct-text, #2e1065); min-width: 0; }
.dsh-chat-settings__field-control { display: flex; align-items: center; justify-content: flex-end; gap: 0.5rem; flex: 0 1 auto; min-width: 0; max-width: 100%; }
.dsh-chat-settings__field-desc { font-size: 0.75rem; color: var(--ct-text-muted, #8a94a6); line-height: 1.5; overflow-wrap: anywhere; }
.dsh-chat-settings__fold { min-width: 0; }
.dsh-chat-settings__fold > summary {
  cursor: pointer; list-style: none; color: var(--ct-text-muted, #8a94a6); font-size: 0.6875rem;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.dsh-chat-settings__fold > summary::-webkit-details-marker { display: none; }
.dsh-chat-settings__fold > summary::before { content: '▸ '; }
.dsh-chat-settings__fold[open] > summary::before { content: '▾ '; }
.dsh-chat-settings__fold-body {
  margin: 0.1875rem 0 0 0.5rem; padding-left: 0.5rem;
  border-left: 2px solid var(--ct-border, rgba(0,0,0,0.12));
  color: var(--ct-text-muted, #8a94a6); font-size: 0.75rem;
  white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word;
}
`

function ensureStyle() {
  if (typeof document === 'undefined') return
  const existing = document.getElementById(STYLE_ID)
  if (existing) {
    if (existing.textContent !== SETTINGS_CSS) existing.textContent = SETTINGS_CSS
    return
  }
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = SETTINGS_CSS
  document.head.appendChild(style)
}

const DshChatSettings = {
  name: 'DshChatSettings',
  setup() {
    const message = useMessage?.()
    const status = ref(null)

    /** 文本字段（原样字符串） */
    const text = ref({ ...DEFAULTS })
    /** 数值字段（字符串，保存时钳制，避免打字中途被改写） */
    const nums = ref({
      noticePollMs: String(DEFAULTS.noticePollMs),
      noticeDoneHoldMs: String(DEFAULTS.noticeDoneHoldMs),
      httpPort: String(DEFAULTS.httpPort),
      guiPort: String(DEFAULTS.guiPort),
    })

    const TEXT_KEYS = ['dshHome', 'customCss']
    const NUM_KEYS = ['noticePollMs', 'noticeDoneHoldMs', 'httpPort', 'guiPort']

    function clamp(text_, key) {
      const { min, max } = LIMITS[key]
      const n = Number(String(text_).trim())
      if (!Number.isFinite(n)) return DEFAULTS[key]
      return Math.min(max, Math.max(min, Math.round(n)))
    }

    /**
     * 组装要写盘的配置。
     *
     * **遍历 DEFAULTS 的全键、按默认值类型处理**——这是刻意设计：早先只把 SHOW_KEYS 写回，
     * 结果没登记进列表的键每次保存都被抹回默认值，用户看到的就是「改了没区别 + 重启还原」。
     * 加键不再需要改这里。
     */
    function compose() {
      const out = { ...DEFAULTS }
      for (const key of Object.keys(DEFAULTS)) {
        const fallback = DEFAULTS[key]
        if (NUM_KEYS.includes(key)) {
          out[key] = clamp(nums.value[key], key)
        } else if (typeof fallback === 'boolean') {
          out[key] = Boolean(text.value[key])
        } else {
          out[key] = String(text.value[key] ?? fallback).trim()
        }
      }
      return out
    }

    let saveTimer = null
    /** 上次真正落盘的配置（JSON 字符串）：用来跳过"没改动也保存"——输入框 onBlur 会触发保存，
     *  点进去再点走（什么都没改）不该弹「已保存」，更不该反复写盘（用户实测反馈过）。 */
    let savedJson = null
    function scheduleSave() {
      if (saveTimer !== null) window.clearTimeout(saveTimer)
      saveTimer = window.setTimeout(() => void saveNow(), 500)
    }

    async function saveNow() {
      if (saveTimer !== null) {
        window.clearTimeout(saveTimer)
        saveTimer = null
      }
      try {
        const composed = compose()
        const json = JSON.stringify(composed)
        if (savedJson !== null && json === savedJson) return // 没有实际变化：不落盘、不提示
        await plugin.config.set(composed)
        // 关键：宿主不会把新配置推给正在运行的 sidecar（只在启动时发一次），
        // 所以这里主动推一次，改设置才不用 disable/enable 插件。
        try {
          await call('applyConfig', { config: composed })
        } catch (error) {
          message?.warning?.(`配置已保存，但推给 sidecar 失败（可能需要重开插件）：${error?.message || error}`)
        }
        savedJson = json
        // 写回钳制后的值，让界面与真实配置一致（例如 99999 → 200）
        for (const key of NUM_KEYS) nums.value[key] = String(composed[key])
        // 端口/外观类改动没法"就地生效"：applyConfig 已让 sidecar 关掉旧反代，
        // 卡片下次展开会自动拿到新地址（这里不再自动弹窗——没有「打开小窗」按钮了，弹窗会打扰）
        // 保存反馈走 useMessage 弹出通知（和其他插件一致），卡头不放内联状态文字
        message?.success?.('已保存')
      } catch (error) {
        message?.error?.(`保存失败：${error?.message || error}`)
      }
    }

    async function loadConfig() {
      const stored = await plugin.config.get()
      // sidecar 的 normalizeConfig 才是"生效配置"的唯一真相：存盘里缺键时以它为准，
      // 否则界面会显示成 false（开关全灰）而实际生效的却是默认 true。
      let effective = null
      try {
        effective = (await call('status'))?.config ?? null
      } catch {
        effective = null
      }
      const merged = { ...DEFAULTS, ...(stored && typeof stored === 'object' ? stored : {}), ...(effective || {}) }
      // 同样遍历 DEFAULTS 全键：漏键会让开关显示成默认值（看起来"设置还原了"）
      for (const key of Object.keys(DEFAULTS)) {
        const fallback = DEFAULTS[key]
        if (NUM_KEYS.includes(key)) nums.value[key] = String(merged[key] ?? fallback)
        else if (typeof fallback === 'boolean') text.value[key] = Boolean(merged[key] ?? fallback)
        else text.value[key] = String(merged[key] ?? fallback)
      }
      // 记下加载后的配置快照：之后 onBlur 触发的保存要先跟它比对，没变化就不落盘、不提示
      savedJson = JSON.stringify(compose())
    }

    async function call(method, params = {}) {
      if (!plugin || typeof plugin.sidecar?.request !== 'function') {
        throw new Error('插件运行时不可用（sidecar 未连接）')
      }
      return plugin.sidecar.request(method, params)
    }

    /** 官方 class 速查表（sidecar 提供）。拿不到要说清楚原因——否则界面什么都不显示，用户只会觉得"功能没做" */
    const guiClasses = ref([])
    const guiClassesError = ref('')
    async function loadGuiClasses() {
      try {
        const res = await call('guiClasses')
        guiClasses.value = Array.isArray(res?.flat) ? res.flat : []
        guiClassesError.value = guiClasses.value.length > 0 ? '' : 'sidecar 返回了空清单'
      } catch (error) {
        guiClasses.value = []
        guiClassesError.value = error?.message || String(error)
      }
    }

    /** sidecar 是否在跑旧代码（契约版本不一致）——这类困惑出现过好几次，直接摆到页面上 */
    const staleSidecar = ref(false)

    async function loadStatus() {
      try {
        status.value = await call('status')
        staleSidecar.value = Number(status.value?.contract) !== CONTRACT_VERSION
      } catch (error) {
        status.value = { lastError: error?.message || String(error) }
        staleSidecar.value = true
      }
    }

    async function pickFolder() {
      const dir = await plugin.dialog.pickFolder()
      if (dir) {
        text.value.dshHome = dir
        void saveNow()
      }
    }

    /** 状态通知：DSH 干活时右下角的可折叠状态卡（通知巡检） */
    const noticeInfo = ref(null)
    async function loadNoticeStatus() {
      try {
        noticeInfo.value = await call('noticeStatus')
      } catch (error) {
        noticeInfo.value = { error: error?.message || String(error) }
      }
    }

    async function sendNoticeDemo(status_) {
      try {
        await call('noticeDemo', { status: status_ })
        message?.success?.(`已发送「${status_ === 'done' ? '已完成' : status_ === 'error' ? '处理失败' : status_ === 'waiting' ? '等你处理' : '进行中'}」测试卡到右下角`)
      } catch (error) {
        message?.error?.(`发送测试卡失败：${error?.message || error}`)
      }
    }

    /** 「运行状态」每几秒自动刷新：sidecar 的 GUI 连接是懒启动的（点状态卡才连），
     *  不刷新的话页面会一直停在"未连接"，用户以为坏了。页面隐藏时跳过。 */
    let statusTimer = null
    onMounted(async () => {
      ensureStyle()
      await loadConfig()
      await loadStatus()
      await loadNoticeStatus()
      await loadGuiClasses()
      statusTimer = window.setInterval(() => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
        void loadStatus()
        void loadNoticeStatus()
      }, 4000)
    })

    onBeforeUnmount(() => {
      if (saveTimer !== null) window.clearTimeout(saveTimer)
      if (statusTimer !== null) window.clearInterval(statusTimer)
      statusTimer = null
    })

    /**
     * 带输入框的一行：标题在左、控件在右，说明整行长在下面。
     * 为什么不用宿主 SettingRow：它给右侧控件只保证 ≈4rem 的余量（desc 一长就把控件压扁），
     * 而我们要放固定宽度的输入框——之前被压成几十像素，数字只剩「23」（实测截图）。
     * 这个排版对任何面板宽度都安全：说明永远不跟控件抢宽度。
     */
    function field(title, control, desc) {
      const children = Array.isArray(control) ? control : [control]
      return h('div', { class: 'dsh-chat-settings__field' }, [
        h('div', { class: 'dsh-chat-settings__field-head' }, [
          h('div', { class: 'dsh-chat-settings__field-title' }, title),
          h('div', { class: 'dsh-chat-settings__field-control' }, children),
        ]),
        desc ? h('div', { class: 'dsh-chat-settings__field-desc' }, desc) : null,
      ])
    }

    function textInput(key, { placeholder = '', width = '16rem' } = {}) {
      return h(NInput, {
        // flex 参与收缩：面板窄时输入框变窄，而不是溢出被裁
        style: { width, minWidth: '7rem', flex: '0 1 auto' },
        size: 'small',
        value: text.value[key],
        placeholder,
        'onUpdate:value': (value) => {
          text.value[key] = value
          scheduleSave()
        },
        onBlur: () => void saveNow(),
      })
    }

    function numberInput(key, { width = '8rem' } = {}) {
      return h(NInput, {
        style: { width, flex: '0 0 auto' },
        size: 'small',
        value: nums.value[key],
        'onUpdate:value': (value) => {
          nums.value[key] = value.replace(/[^\d]/g, '')
          scheduleSave()
        },
        onBlur: () => {
          nums.value[key] = String(clamp(nums.value[key], key))
          void saveNow()
        },
      })
    }

    function switchInput(key) {
      if (!NSwitch) return null
      return h(NSwitch, {
        size: 'small',
        value: Boolean(text.value[key]),
        'onUpdate:value': (value) => {
          text.value[key] = value
          scheduleSave()
        },
      })
    }

    function card(title, desc, children, actions) {
      return h('div', { class: 'dsh-chat-settings__card' }, [
        h('div', { class: 'dsh-chat-settings__head' }, [
          h('div', { class: 'dsh-chat-settings__head-title' }, title),
          h('div', { class: 'dsh-chat-settings__head-actions' }, [
            ...(Array.isArray(actions) ? actions : actions ? [actions] : []),
          ]),
        ]),
        desc ? h('div', { class: 'dsh-chat-settings__head-desc' }, desc) : null,
        ...(Array.isArray(children) ? children : [children]),
      ])
    }

    function renderStatus() {
      const s = status.value || {}
      const tag = (label, type = 'default') =>
        NTag ? h(NTag, { size: 'small', type, bordered: false }, { default: () => label }) : null
      /** 票据寿命说人话：30 天 / 7 天 / 1 天 / 6 小时 / 55 分钟 */
      const ttlLabel = (ttlMs) => {
        const minutes = Math.round(Number(ttlMs) / 60000)
        if (!Number.isFinite(minutes) || minutes <= 0) return '—'
        if (minutes >= 60 * 24) return `${Math.round(minutes / (60 * 24))} 天`
        if (minutes >= 60) return `${Math.round(minutes / 60)} 小时`
        return `${minutes} 分钟`
      }
      const button = (label, onClick, options = {}) =>
        NButton ? h(NButton, { size: 'small', onClick, ...options }, { default: () => label }) : null
      // 端口被占用时 sidecar 会自动换一个；这里说清"实际在用哪个"，否则用户以为设置没生效
      const actualPort = Number(s.httpPort)
      const wantedPort = Number(nums.value.httpPort)
      const usedPort = Number.isFinite(actualPort) && actualPort > 0 && actualPort !== wantedPort
      const cardPortNote = usedPort
        ? `原端口被别的程序占用，现在实际在用 ${actualPort}。`
        : '被别的程序占用时会自动换一个，一般不用改。'
      return card(
        '运行状态',
        '插件在后台盯着 DSH 的动静；这里的信息每几秒自动刷新。下面的端口与目录一般都不用改。',
        [
          field('状态卡端口', numberInput('httpPort'), `状态卡跟插件后台通话的数据线（纯数据，不是网页）。${cardPortNote}0 = 自动分配。`),
          field(
            '小窗页面端口',
            numberInput('guiPort'),
            '小窗里那个官方页面挂在这个端口上。没端口冲突就别改——固定不变，页面里的状态才能保留；填 0 = 每次随机分配（页面状态会重置）。',
          ),
          field(
            'DSH 数据目录',
            [
              textInput('dshHome', { placeholder: '留空 = 自动找 ~/.dsh', width: '20rem' }),
              NButton ? h(NButton, { size: 'small', onClick: () => void pickFolder() }, { default: () => '选择' }) : null,
            ],
            '会话日志和凭据都从这里读。',
          ),
          field(
            '运行环境',
            [
              tag(`Node ${s.node || '—'}`),
              tag(s.zstd === false ? 'zstd 不可用' : 'zstd 正常', s.zstd === false ? 'error' : 'success'),
              // 小窗的登录票据有寿命（顶到 DSH 允许的上限），反代到期前自己续；续过就写出来
              s.gui && s.gui.cookieTtlMs ? tag(`小窗票据 ${ttlLabel(s.gui.cookieTtlMs)}`) : null,
              s.gui && s.gui.cookieRefreshes > 0 ? tag(`小窗票据已自动续期 ${s.gui.cookieRefreshes} 次`) : null,
            ],
            s.zstd === false
              ? 'zstd 用来解压 DSH 的会话日志；「不可用」说明 Node 版本过低（需 ≥ 22.15）。'
              : 'zstd 用来解压 DSH 的会话日志。',
          ),
          s.lastError ? h(NAlert, { type: 'warning', size: 'small', bordered: false }, { default: () => `最近一次错误：${s.lastError}` }) : null,
        ],
        [
          button('刷新', () => {
            void loadStatus()
            void loadNoticeStatus()
          }, { quaternary: true }),
        ],
      )
    }

    function renderNotices() {
      const info = noticeInfo.value || {}
      const tracked = Array.isArray(info.sessions) ? info.sessions : []
      const summary = info.error
        ? `读取状态失败：${info.error}`
        : info.loopRunning
          ? `正在盯着 DSH（每 ${info.pollMs ?? '—'}ms 看一眼，盯着 ${tracked.length} 个会话）`
          : info.enabled === false
            ? '状态通知已关闭'
            : '还没开始看（插件启用后自动开始）'
      const button = (label, onClick, options = {}) =>
        NButton ? h(NButton, { size: 'small', onClick, ...options }, { default: () => label }) : null
      // 系统设置同款卡片：开关放卡头右侧，关掉时下面的内容整块不渲染（只留标题 + 描述 + 开关）
      const enabled = Boolean(text.value.noticeEnabled)
      return card(
        '状态通知',
        'DSH 开始干活时在右下角弹一张可折叠状态卡：折叠 = 标题 + 最新输出，点正文原地展开成官方界面；等你审批时会自动展开；回合失败显示红色状态。',
        enabled
          ? [
              field('检查间隔(ms)', numberInput('noticePollMs'), `多久看一眼 DSH 有没有新动静；500–30000，当前 ${nums.value.noticePollMs}`),
              field('完成后停留(ms)', numberInput('noticeDoneHoldMs'), `「已完成」的卡在右下角停留多久；3000–600000，当前 ${nums.value.noticeDoneHoldMs}`),
              field(
                '测试卡',
                [
                  button('进行中', () => void sendNoticeDemo('running')),
                  button('已完成', () => void sendNoticeDemo('done')),
                  button('等你处理', () => void sendNoticeDemo('waiting')),
                  button('处理失败', () => void sendNoticeDemo('error')),
                  button('刷新状态', () => void loadNoticeStatus(), { quaternary: true }),
                ],
                '发一张测试卡到右下角，看看折叠/展开的手感',
              ),
              h('div', { class: 'dsh-chat-settings__muted' }, summary),
            ]
          : [],
        [switchInput('noticeEnabled')],
      )
    }

    /**
     * 小窗外观：点亮的 chip = 该元素在小窗里显示。
     * 顶栏的子项在父项点亮后才出现（`when`），说明全部收进 tooltip；
     * 更细的微调走下面的自定义 CSS。
     */
    function renderDeclutter() {
      const GROUPS = [
        {
          title: '',
          items: [
            { key: 'showRail', label: '左侧栏', tip: '官方左侧 56px 图标栏：鲸鱼 logo、新建会话、搜索、设置…' },
            {
              key: 'showHeader',
              label: '官方顶栏',
              tip: '顶栏整条：会话标题 + 子智能体提示 + 对话/轨迹标签 + 右侧图标。隐藏时标题由卡片自己那行显示',
            },
            { key: 'showComposerStatus', label: '输入区状态条', tip: '输入框下方那行：tok/s、缓存命中、费用明细、上下文占比' },
            { key: 'showMessageMeta', label: '消息操作行', tip: '每条消息的复制/点赞/点踩/分享 + 时间，以及「本轮费用」' },
          ],
        },
        {
          title: '顶栏内部：',
          when: () => Boolean(text.value.showHeader),
          items: [
            { key: 'showTabs', label: '对话/轨迹 标签', tip: '顶栏里那两个页签' },
            { key: 'showHeaderTitle', label: '官方标题', tip: '官方标题（面包屑）；与卡片那行重复，所以默认关' },
            { key: 'showHeaderChips', label: '子智能体/后台任务', tip: '「N 个子智能体」「N 个后台任务运行中」提示' },
            { key: 'showHeaderIcons', label: '顶栏右侧图标', tip: '文件夹下拉、「…」、面板开关；整组' },
            {
              key: 'showHeaderLabels',
              label: '强制文字标签',
              tip: '窄宽时官方会把顶栏文字折叠成只剩图标；点亮则强制显示文字（可能有点挤）',
            },
          ],
        },
        {
          title: '顶栏右侧图标内部：',
          when: () => Boolean(text.value.showHeader) && Boolean(text.value.showHeaderIcons),
          items: [
            { key: 'showHeaderMore', label: '「…」更多操作', tip: '仅那颗「…」按钮；文件夹下拉不受影响' },
            { key: 'showHeaderPanel', label: '面板开关', tip: '仅最右那颗"打开右侧边栏"按钮' },
          ],
        },
      ]

      const chip = (item) => {
        if (!NTag) return null
        const on = Boolean(text.value[item.key])
        const tag = h(
          NTag,
          {
            size: 'small',
            checkable: true,
            checked: on,
            // 注意：checkable 的 NTag 会忽略 bordered（边框层要求 !checkable），
            // 所以"描边"由我们自己的 CSS 类给（见 style 里的 .dsh-chat-settings__chip）
            class: `dsh-chat-settings__chip${on ? ' is-on' : ''}`,
            'onUpdate:checked': (value) => {
              text.value[item.key] = value
              scheduleSave()
            },
          },
          { default: () => item.label },
        )
        // tooltip 必须限宽 + 允许换行：说明文字长，默认会拉成一条横线撑出窗口被裁（实测截图）
        return NTooltip
          ? h(NTooltip, { contentStyle: { maxWidth: '17rem', whiteSpace: 'normal', overflowWrap: 'anywhere', lineHeight: '1.5' } }, {
              trigger: () => tag,
              default: () => `${item.label}：${item.tip}。点亮 = 在小窗里显示`,
            })
          : tag
      }

      const setAll = (on) => {
        for (const group of GROUPS) for (const item of group.items) text.value[item.key] = on
        scheduleSave()
      }
      const restoreRecommended = () => {
        for (const group of GROUPS) {
          for (const item of group.items) text.value[item.key] = Boolean(DEFAULTS[item.key])
        }
        scheduleSave()
      }
      const smallButton = (label, onClick) =>
        NButton ? h(NButton, { size: 'tiny', quaternary: true, onClick }, { default: () => label }) : null

      /** 官方 class 速查：列出可改的选择器，点「插入」把规则骨架写进上面的输入框 */
      const classCheatSheet = () => {
        const list = guiClasses.value
        if (!Array.isArray(list) || list.length === 0) {
          // 拿不到就把原因摆出来：最常见的原因是 sidecar 还在跑旧代码（没有 guiClasses 方法）
          return h(
            'div',
            { class: 'dsh-chat-settings__cls-note is-warn' },
            `class 速查表没加载出来${guiClassesError.value ? `：${guiClassesError.value}` : ''}。多半是插件还在运行旧代码（sidecar 里没有这个方法）——把插件**关掉再打开**（或重启 Catrace）后就会显示。`,
          )
        }
        const insert = (selector) => {
          const skeleton = `${selector} {\n  \n}`
          text.value.customCss = text.value.customCss ? `${text.value.customCss.trimEnd()}\n${skeleton}` : skeleton
          scheduleSave()
        }
        const rows = []
        let currentGroup = ''
        for (const item of list) {
          if (item.group !== currentGroup) {
            currentGroup = item.group
            rows.push(h('div', { class: 'dsh-chat-settings__cls-group' }, currentGroup))
          }
          rows.push(
            h('div', { class: 'dsh-chat-settings__cls-row' }, [
              h('code', { class: 'dsh-chat-settings__cls-selector' }, item.selector),
              h('span', { class: 'dsh-chat-settings__cls-desc' }, item.desc),
              smallButton('插入', () => insert(item.selector)),
            ]),
          )
        }
        return h('div', { class: 'dsh-chat-settings__block' }, [
          h('div', { class: 'dsh-chat-settings__cls-note' }, [
            '官方 class 带哈希前缀（如 uPhUma_titleRow、Q7WfXG_dock），每次构建都会变，所以要用 [class*="_语义名"] 匹配；点名「插入」会把规则骨架写进上面的输入框。',
          ]),
          ...rows,
        ])
      }

      const cssFold = () =>
        h('details', { class: 'dsh-chat-settings__fold' }, [
          h('summary', null, '自定义样式（CSS）与 class 速查'),
          h('div', { class: 'dsh-chat-settings__fold-body' }, [
            h('div', { class: 'dsh-chat-settings__block' }, [
              h(
                'div',
                { class: 'dsh-chat-settings__block-desc' },
                '追加注入到官方页面，排在我们的规则之后，所以能覆盖。选择器用语义后缀（官方 class 带哈希，每次构建都会变），例如 [class*="_headerCorner"]',
              ),
              // 注意：naive-ui 里**没有** NInput.Textarea（只有 NInput/NInputGroup/…），
              // 多行输入必须是 NInput + type:'textarea'，否则会掉进兜底分支（连 placeholder 都丢）
              NInput
                ? h(NInput, {
                    value: text.value.customCss,
                    type: 'textarea',
                    rows: 6,
                    placeholder: '例：\n[class*="_headerCorner"] { display: none !important; }\n[class*="_header"] { padding: 0 !important; }',
                    'onUpdate:value': (value) => {
                      text.value.customCss = value
                      scheduleSave()
                    },
                  })
                : null,
              h('div', { class: 'dsh-chat-settings__block-actions' }, [
                smallButton('插入示例', () => {
                  const sample = '[class*="_header"] { padding: 0 !important; }'
                  text.value.customCss = text.value.customCss ? `${text.value.customCss}\n${sample}` : sample
                  scheduleSave()
                }),
                smallButton('清空', () => {
                  text.value.customCss = ''
                  scheduleSave()
                }),
              ]),
              classCheatSheet(),
            ]),
          ]),
        ])

      return card(
        '小窗外观',
        '点亮 = 在小窗里显示，灰掉 = 隐藏；鼠标悬停看每一项的说明。改动在下次展开状态卡时生效。',
        [
          field(
            '紧凑留白',
            switchInput('compactSpacing'),
            '开 = 把官方留白与滚动区/输入框/消息间距收到小窗尺度（官方输入框每侧留白 32px → 16px，多出约 16px/侧宽度；消息间距 16px → 10px）',
          ),
          ...GROUPS.filter((group) => !group.when || group.when()).map((group) =>
            h('div', { class: 'dsh-chat-settings__group' }, [
              group.title ? h('div', { class: 'dsh-chat-settings__group-title' }, group.title) : null,
              h('div', { class: 'dsh-chat-settings__tags' }, group.items.map(chip)),
            ]),
          ),
          cssFold(),
        ],
        [smallButton('全部显示', () => setAll(true)), smallButton('恢复推荐', restoreRecommended)],
      )
    }

    return () =>
      h('div', { class: 'dsh-chat-settings' }, [
        staleSidecar.value
          ? h(
              'div',
              { class: 'dsh-chat-settings__cls-note is-warn' },
              '插件侧车（runtime）还在运行旧代码：界面上的新功能不会生效。把插件**关掉再打开**一次（或重启 Catrace）即可。',
            )
          : null,
        renderStatus(),
        renderNotices(),
        renderDeclutter(),
      ])
  },
}

/** 默认导出即设置组件（宿主取 default）。 */
export default DshChatSettings
export const Settings = DshChatSettings
