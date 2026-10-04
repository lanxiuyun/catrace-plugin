/**
 * dsh-chat 插件设置面板。
 *
 * 关键点：
 *  1. **输入必须真能改**：之前用 `value` + `onChange`（受控但没人接 update）→ 打字不会落，
 *     所以「设置完全没办法调整」。现在全部 `onUpdate:value` 写回本地表单，再 debounce 落盘。
 *  2. **数值字段先存字符串、保存时钳制**：边打字边钳会让「12」打成「1」就被改成 6。
 *  3. 用宿主注入的 `SettingRow`（`__CATRACE_UI__`）跟系统设置同款排版，避免自造一套排版。
 *  4. 根节点不写外层 padding / max-width（详情区外壳负责），长文本一律可换行，避免横向滚动条。
 */
const { h, ref, computed, onMounted, onBeforeUnmount } = globalThis.__CATRACE_VUE__ || {}
const { NAlert, NButton, NDivider, NInput, NSelect, NSpace, NSwitch, NTag, NTooltip, useMessage } =
  globalThis.__CATRACE_NAIVE__ || {}
const SettingRow = (globalThis.__CATRACE_UI__ || {}).SettingRow

if (typeof h !== 'function') throw new Error('Catrace plugin Vue runtime missing')

const STYLE_ID = 'dsh-chat-settings-style'

/** RPC 契约版本：与 runtime/main.mjs 的 CONTRACT_VERSION 必须一致（改动 RPC 就两边一起 +1） */
const CONTRACT_VERSION = 2

/**
 * 默认值（必须与 runtime/lib/config.mjs 的 DEFAULT_CONFIG 一致；
 * plugin-contract.test.mjs 会比对这两处，防止漂移）。
 */
const DEFAULTS = {
  dshHome: '',
  dshCommand: 'dsh',
  profile: 'sdk',
  provider: 'deepseek-account',
  model: 'deepseek-flash',
  reasoningEffort: 'high',
  maxTokens: 0,
  cwd: '',
  patchFile: '',
  mirrorLimit: 40,
  pollMs: 2000,
  mirrorSessionId: '',
  followLatest: true,
  cardTitle: 'DSH 对话',
  autoOpenWindow: false,
  httpPort: 23457,
  guiPort: 23458,
  compactSpacing: false,
  customCss: '',
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
}

const LIMITS = {
  mirrorLimit: { min: 6, max: 200 },
  pollMs: { min: 500, max: 30000 },
  httpPort: { min: 0, max: 65535 },
  guiPort: { min: 0, max: 65535 },
  maxTokens: { min: 0, max: 200000 },
}

const SETTINGS_CSS = `
.dsh-chat-settings { display: flex; flex-direction: column; gap: 1rem; font-size: 0.8125rem; min-width: 0; }
.dsh-chat-settings__card {
  border: 1px solid var(--ct-border, rgba(0,0,0,0.08)); border-radius: 0.75rem;
  padding: 0.25rem 1rem 0.75rem; display: flex; flex-direction: column;
  background: var(--ct-surface, #fff); min-width: 0;
}
.dsh-chat-settings__head { display: flex; align-items: baseline; gap: 0.5rem; padding: 0.75rem 0 0.25rem; }
.dsh-chat-settings__head-title { font-weight: 600; font-size: 0.875rem; color: var(--ct-text, #2e1065); }
.dsh-chat-settings__head-actions { margin-left: auto; display: flex; align-items: center; gap: 0.25rem; }
.dsh-chat-settings__head-desc { color: var(--ct-text-muted, #8a94a6); font-size: 0.75rem; padding-bottom: 0.375rem; line-height: 1.5; }
/* 小窗外观：chip 分组 */
.dsh-chat-settings__group { padding: 0.375rem 0 0.25rem; }
.dsh-chat-settings__group + .dsh-chat-settings__group { margin-top: 0.25rem; }
.dsh-chat-settings__group-title { font-size: 0.75rem; color: var(--ct-text-muted, #8a94a6); padding: 0.375rem 0 0.375rem; }
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
/* 整行块（宿主 SettingRow 只能放右列，全宽内容要自造） */
.dsh-chat-settings__block { padding: 0.75rem 0 0.25rem; border-top: 1px solid var(--ct-border, rgba(0,0,0,0.08)); margin-top: 0.5rem; display: flex; flex-direction: column; gap: 0.375rem; }
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
.dsh-chat-settings__toolbar { display: flex; flex-wrap: wrap; gap: 0.5rem; padding: 0.5rem 0; }
.dsh-chat-settings__code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.75rem; overflow-wrap: anywhere; }
.dsh-chat-settings__value { font-size: 0.8125rem; color: var(--ct-text, #2e1065); overflow-wrap: anywhere; }
.dsh-chat-settings__muted { color: var(--ct-text-muted, #8a94a6); font-size: 0.75rem; overflow-wrap: anywhere; }
.dsh-chat-settings__state { font-size: 0.75rem; color: var(--ct-text-muted, #8a94a6); }
/* 拿不到宿主 SettingRow 时的兜底行排版 */
.dsh-chat-settings__row {
  display: flex; align-items: center; justify-content: space-between; gap: 1rem;
  padding: 0.5rem 0; min-width: 0; border-bottom: 1px solid var(--ct-border, rgba(0,0,0,0.06));
}
.dsh-chat-settings__sessions {
  max-height: 13rem; overflow-y: auto; overflow-x: hidden;
  border: 1px solid var(--ct-border, rgba(0,0,0,0.08)); border-radius: 0.5rem; margin: 0.25rem 0 0.75rem;
}
.dsh-chat-settings__session {
  display: flex; flex-direction: column; gap: 0.0625rem;
  padding: 0.375rem 0.625rem; cursor: pointer; min-width: 0;
  border-bottom: 1px solid var(--ct-border, rgba(0,0,0,0.06));
}
.dsh-chat-settings__session:last-child { border-bottom: none; }
.dsh-chat-settings__session:hover { background: var(--ct-accent-softer, rgba(127,127,127,0.06)); }
.dsh-chat-settings__session.is-active { background: var(--ct-accent-soft, rgba(124,58,237,0.12)); }
.dsh-chat-settings__session-title {
  font-weight: 500; color: var(--ct-text, #2e1065);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;
}
.dsh-chat-settings__session-meta {
  color: var(--ct-text-subtle, #9aa4b2); font-size: 0.6875rem;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;
}
.dsh-chat-settings__transcript {
  max-height: 22rem; overflow-y: auto; overflow-x: hidden;
  display: flex; flex-direction: column; gap: 0.5rem;
  padding: 0.625rem; border-radius: 0.5rem;
  background: var(--ct-accent-softer, rgba(127,127,127,0.05));
  margin-bottom: 0.375rem; min-width: 0;
}
.dsh-chat-settings__msg-user {
  align-self: flex-end; max-width: 85%; box-sizing: border-box;
  background: var(--ct-accent-soft, rgba(124,58,237,0.14));
  border-radius: 0.5rem; padding: 0.25rem 0.5rem;
  white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word;
}
.dsh-chat-settings__msg-assistant {
  align-self: flex-start; max-width: 92%; box-sizing: border-box;
  background: var(--ct-surface, #fff); border: 1px solid var(--ct-border, rgba(0,0,0,0.08));
  border-radius: 0.5rem; padding: 0.25rem 0.5rem;
  white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word;
}
.dsh-chat-settings__fold { min-width: 0; }
.dsh-chat-settings__fold > summary {
  cursor: pointer; list-style: none; color: var(--ct-text-muted, #8a94a6); font-size: 0.6875rem;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.dsh-chat-settings__fold > summary::-webkit-details-marker { display: none; }
.dsh-chat-settings__fold > summary::before { content: '▸ '; }
.dsh-chat-settings__fold[open] > summary::before { content: '▾ '; }
/* 去装饰标签云：点亮的标签 = 该元素在小窗里显示（间距/描边统一在文件前面的 __tags/__chip 规则里） */
.dsh-chat-settings__fold-body {
  margin: 0.1875rem 0 0 0.5rem; padding-left: 0.5rem;
  border-left: 2px solid var(--ct-border, rgba(0,0,0,0.12));
  color: var(--ct-text-muted, #8a94a6); font-size: 0.75rem;
  white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word;
}
.dsh-chat-settings__tool {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.6875rem;
  color: var(--ct-text-muted, #6b7280); overflow-wrap: anywhere;
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

function formatTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function shortId(id) {
  if (!id) return '—'
  return id.length > 20 ? `${id.slice(0, 12)}…${id.slice(-4)}` : id
}

/** 连续 tool item 合成折叠组，和卡片保持同一种读法 */
function groupItems(items) {
  const out = []
  const args = new Map()
  for (const item of items || []) {
    if (item?.kind === 'assistant' && Array.isArray(item.tools)) {
      for (const tool of item.tools) if (tool?.id) args.set(tool.id, tool.argsSummary || '')
    }
  }
  for (const item of items || []) {
    if (!item) continue
    const last = out[out.length - 1]
    if (item.kind === 'tool') {
      if (last && last.kind === 'toolGroup') last.tools.push(item)
      else out.push({ kind: 'toolGroup', id: `g:${item.id}`, tools: [item] })
      continue
    }
    out.push(item)
  }
  return { groups: out, args }
}

const DshChatSettings = {
  name: 'DshChatSettings',
  setup() {
    const message = useMessage?.()
    const status = ref(null)
    const sessions = ref([])
    const selected = ref('')
    const transcript = ref(null)
    const loading = ref(false)
    const testing = ref(false)
    const testResult = ref('')
    const saveState = ref('')
    const loaded = ref(false)

    /** 文本字段（原样字符串） */
    const text = ref({ ...DEFAULTS })
    /** 数值字段（字符串，保存时钳制，避免打字中途被改写） */
    const nums = ref({
      mirrorLimit: String(DEFAULTS.mirrorLimit),
      pollMs: String(DEFAULTS.pollMs),
      httpPort: String(DEFAULTS.httpPort),
      guiPort: String(DEFAULTS.guiPort),
      maxTokens: String(DEFAULTS.maxTokens),
    })

    const effortOptions = [
      { label: '默认（模型自带）', value: '' },
      { label: 'low 低', value: 'low' },
      { label: 'medium 中', value: 'medium' },
      { label: 'high 高', value: 'high' },
    ]
    const sessionOptions = computed(() =>
      sessions.value.map((s) => ({ label: `${s.title || s.id} · ${formatTime(s.updatedAt)}`, value: s.id })),
    )
    const transcriptGroups = computed(() => groupItems(transcript.value?.items || []))

    const TEXT_KEYS = ['dshHome', 'dshCommand', 'profile', 'provider', 'model', 'cwd', 'patchFile', 'cardTitle', 'reasoningEffort']
    const NUM_KEYS = ['mirrorLimit', 'pollMs', 'httpPort', 'guiPort', 'maxTokens']
    /** 布尔开关（小窗显示项 + 行为开关）：保存与加载都必须带上，漏一个就等于「设置没用」 */
    const SHOW_KEYS = [
      'showRail',
      'showHeader',
      'showTabs',
      'showHeaderIcons',
      'showHeaderMore',
      'showHeaderPanel',
      'showHeaderTitle',
      'showHeaderChips',
      'showComposerStatus',
      'showMessageMeta',
      'showHeaderLabels',
    ]
    /**
     * 布尔开关（小窗显示项 + 行为开关 + 紧凑留白）：保存与加载都必须带上，漏一个就等于「设置没用」。
     * 注意：**新增键不需要在这里登记**——compose()/loadConfig() 都是遍历 DEFAULTS 全键、按值类型处理，
     * 这个列表只用于"空值回退"那类需要显式认识的场景。
     */
    const BOOL_KEYS = ['followLatest', 'autoOpenWindow', 'compactSpacing', ...SHOW_KEYS]

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
     * 结果 `compactSpacing`、`customCss` 这类"没登记进列表"的键每次保存都被抹回默认值，
     * 用户看到的就是「改了没区别 + 重启还原」。加键不再需要改这里。
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
      // 空字符串要回退默认（sidecar 的 normalizeConfig 也这么处理）
      for (const key of ['dshCommand', 'profile', 'provider', 'model', 'cardTitle']) {
        if (!out[key]) out[key] = DEFAULTS[key]
      }
      return out
    }

    let saveTimer = null
    /** 上一次保存的配置快照：用来判断"端口变了 → 需要把卡片/代理重建一次" */
    let lastSaved = null
    function scheduleSave() {
      if (saveTimer !== null) window.clearTimeout(saveTimer)
      saveState.value = '编辑中…'
      saveTimer = window.setTimeout(() => void saveNow(), 500)
    }

    async function saveNow() {
      if (saveTimer !== null) {
        window.clearTimeout(saveTimer)
        saveTimer = null
      }
      try {
        const composed = compose()
        await plugin.config.set(composed)
        // 关键：宿主不会把新配置推给正在运行的 sidecar（只在启动时发一次），
        // 所以这里主动推一次，改设置才不用 disable/enable 插件。
        try {
          await call('applyConfig', { config: composed })
        } catch (error) {
          message?.warning?.(`配置已保存，但推给 sidecar 失败（可能需要重开插件）：${error?.message || error}`)
        }
        // 写回钳制后的值，让界面与真实配置一致（例如 99999 → 200）
        for (const key of NUM_KEYS) nums.value[key] = String(composed[key])
        // 端口类改动没法"就地生效"：GUI 代理端口变了要重建反代，本机端口变了卡片要拿新端口
        const previous = lastSaved
        lastSaved = composed
        if (previous) {
          if (String(previous.guiPort) !== String(composed.guiPort)) reopenGuiSoon()
          if (String(previous.httpPort) !== String(composed.httpPort)) void openWindow()
        }
        saveState.value = '已保存'
        window.setTimeout(() => {
          if (saveState.value === '已保存') saveState.value = ''
        }, 1500)
      } catch (error) {
        saveState.value = `保存失败：${error?.message || error}`
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
      text.value.mirrorSessionId = String(merged.mirrorSessionId || '')
      loaded.value = true
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

    async function loadSessions() {
      loading.value = true
      try {
        const res = await call('listSessions', { limit: 60 })
        sessions.value = Array.isArray(res?.sessions) ? res.sessions : []
        if (!selected.value && status.value?.mirrorSessionId) selected.value = status.value.mirrorSessionId
        if (!selected.value && sessions.value.length > 0) selected.value = sessions.value[0].id
      } catch (error) {
        message?.error?.(`读取会话列表失败：${error?.message || error}`)
      } finally {
        loading.value = false
      }
    }

    async function preview(id) {
      selected.value = id || selected.value
      if (!selected.value) return
      try {
        const res = await call('readSession', { id: selected.value, limit: 60 })
        transcript.value = res?.session ?? null
      } catch (error) {
        transcript.value = null
        message?.error?.(`读取会话失败：${error?.message || error}`)
      }
    }

    async function openGui() {
      const sessionId = selected.value || status.value?.mirrorSessionId || ''
      if (!sessionId) {
        message?.warning?.('先在下面选一条会话')
        return
      }
      try {
        const res = await call('openGui', { sessionId })
        message?.success?.(`已在小窗打开官方界面：${shortId(res?.sessionId)}`)
        await loadStatus()
      } catch (error) {
        message?.error?.(`打开真 GUI 失败：${error?.message || error}`)
      }
    }

    async function openWindow() {
      try {
        await call('openWindow', {})
        message?.success?.('小窗已发送到桌面右下角')
      } catch (error) {
        message?.error?.(`打开小窗失败：${error?.message || error}`)
      }
    }

    async function pinMirror() {
      if (!selected.value) return
      text.value.mirrorSessionId = selected.value
      text.value.followLatest = false
      await saveNow()
      try {
        await call('setMirror', { sessionId: selected.value })
        message?.success?.('小窗已固定到该会话')
      } catch (error) {
        message?.error?.(`固定会话失败：${error?.message || error}`)
      }
    }

    async function followLatest() {
      text.value.mirrorSessionId = ''
      text.value.followLatest = true
      await saveNow()
      try {
        await call('setMirror', { sessionId: '' })
        message?.success?.('小窗会跟随最近活跃的会话')
      } catch (error) {
        message?.error?.(`切换失败：${error?.message || error}`)
      }
    }

    async function testDsh() {
      testing.value = true
      testResult.value = ''
      try {
        const res = await call('testDsh', {})
        testResult.value = res?.ok
          ? `可用：${res.command}\n${res.output || '(无输出)'}`
          : `不可用（退出码 ${res?.code}）：${res?.output || ''}`
      } catch (error) {
        testResult.value = `不可用：${error?.message || error}`
      } finally {
        testing.value = false
      }
    }

    async function pickFolder() {
      const dir = await plugin.dialog.pickFolder()
      if (dir) {
        text.value.cwd = dir
        void saveNow()
      }
    }

    async function pickPatch() {
      const file = await plugin.dialog.pickFile()
      if (file) {
        text.value.patchFile = file
        void saveNow()
      }
    }

    onMounted(async () => {
      ensureStyle()
      await loadConfig()
      await loadStatus()
      await loadGuiClasses()
      await loadSessions()
      await preview(selected.value)
    })

    onBeforeUnmount(() => {
      if (saveTimer !== null) window.clearTimeout(saveTimer)
    })

    /** 一行设置：优先用宿主 SettingRow，拿不到就退回本插件自己的行排版 */
    function row(title, control, desc) {
      const children = Array.isArray(control) ? control : [control]
      if (SettingRow) {
        return h(SettingRow, { title, desc }, { default: () => children })
      }
      return h('div', { class: 'dsh-chat-settings__row' }, [
        h('div', null, [
          h('div', { class: 'dsh-chat-settings__value' }, title),
          desc ? h('div', { class: 'dsh-chat-settings__muted' }, desc) : null,
        ]),
        h('div', null, children),
      ])
    }

    function textInput(key, { placeholder = '', width = '16rem' } = {}) {      return h(NInput, {
        style: { width },
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

    /** 去装饰开关：CSS 是反代启动时注入的，改完必须重开小窗才生效 —— 这里自动帮你重开 */
    let reopenTimer = null
    function reopenGuiSoon() {
      if (reopenTimer !== null) window.clearTimeout(reopenTimer)
      reopenTimer = window.setTimeout(async () => {
        reopenTimer = null
        const sessionId = selected.value || status.value?.guiSessionId || status.value?.mirrorSessionId || ''
        if (!sessionId) return
        try {
          await call('openGui', { sessionId })
          await loadStatus()
        } catch (error) {
          message?.warning?.(`重开小窗失败（改动已保存，手动点「小窗打开（真 GUI）」即可）：${error?.message || error}`)
        }
      }, 1200)
    }

    function numberInput(key, { width = '8rem', desc = '' } = {}) {
      return h(NInput, {
        style: { width },
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

    function card(title, desc, children, actions) {
      return h('div', { class: 'dsh-chat-settings__card' }, [
        h('div', { class: 'dsh-chat-settings__head' }, [
          h('div', { class: 'dsh-chat-settings__head-title' }, title),
          h('div', { class: 'dsh-chat-settings__head-actions' }, [
            ...(Array.isArray(actions) ? actions : actions ? [actions] : []),
            saveState.value ? h('span', { class: 'dsh-chat-settings__state' }, saveState.value) : null,
          ]),
        ]),
        desc ? h('div', { class: 'dsh-chat-settings__head-desc' }, desc) : null,
        ...(Array.isArray(children) ? children : [children]),
      ])
    }

    function renderStatus() {
      const s = status.value || {}
      return card('运行状态', '插件读的是本机 DSH 的会话数据；「对话」通过官方 SDK 起子进程。', [
        row('DSH 主目录', h('span', { class: 'dsh-chat-settings__code' }, s.dshHome || '—')),
        row(
          'dsh 命令',
          [
            h('span', { class: 'dsh-chat-settings__code', style: { maxWidth: '26rem' } }, s.dshCommandResolved || s.dshCommand || '—'),
            NButton ? h(NButton, { size: 'small', loading: testing.value, onClick: () => void testDsh() }, { default: () => '测试' }) : null,
          ],
          '点「测试」会执行 dsh --version',
        ),
        row('DSH 会话数', h('span', { class: 'dsh-chat-settings__value' }, `${s.sessionCount ?? 0} 个`)),
        row(
          '当前镜像',
          h('span', { class: 'dsh-chat-settings__code' }, s.mirrorSessionId ? `${shortId(s.mirrorSessionId)}${s.mirrorPinned ? '（固定）' : '（跟随最新）'}` : '（无）'),
        ),
        row(
          '运行环境',
          h('span', { class: 'dsh-chat-settings__muted' }, `Node ${s.node || '—'} · zstd ${s.zstd === false ? '不可用（需 Node ≥ 22.15）' : '正常'} · 本机端口 ${s.httpPort ?? '—'}`),
        ),
        testResult.value
          ? h(NAlert, { type: testResult.value.startsWith('可用：') ? 'success' : 'warning', size: 'small', bordered: false }, {
              default: () => h('pre', { class: 'dsh-chat-settings__code', style: { margin: 0, whiteSpace: 'pre-wrap' } }, testResult.value),
            })
          : null,
        s.lastError ? h(NAlert, { type: 'warning', size: 'small', bordered: false }, { default: () => `最近一次错误：${s.lastError}` }) : null,
      ])
    }

    function renderWindow() {
      const gui = status.value?.gui ?? null
      return card('小窗', '两种打开方式：①「真 GUI」= 在小窗 iframe 里显示官方界面（/ 指令、@ 文件、审批全都有）；②「镜像卡」= 自己画的消息流（只读镜像 + SDK 提问）。', [
        row(
          '打开小窗',
          NButton ? h(NButton, { size: 'small', type: 'primary', onClick: () => void openWindow() }, { default: () => '打开镜像卡' }) : null,
          'sidecar 重启后端口会变，需重新打开一次',
        ),
        row(
          'GUI 复用状态',
          h(
            'span',
            { class: 'dsh-chat-settings__muted' },
            gui?.ready
              ? `已就绪：代理 ${gui.proxyUrl} → 目标 ${gui.target?.authority}（${gui.target?.sessions ?? 0} 条会话）`
              : `未启动${gui?.lastError ? `（${gui.lastError}）` : ''}；依赖正在运行的 DSH Desktop 与 ~/.dsh 凭据`,
          ),
          '在下面选一条会话后点「小窗打开（真 GUI）」',
        ),
        row('小窗标题', textInput('cardTitle')),
        row('显示条数', numberInput('mirrorLimit'), `镜像卡用；6–200，当前 ${nums.value.mirrorLimit}`),
        row('轮询间隔(ms)', numberInput('pollMs'), `镜像卡用；500–30000，当前 ${nums.value.pollMs}`),
        row('本机端口', numberInput('httpPort'), '镜像卡读数据的回环端口；0 = 系统分配'),
        row(
          'GUI 代理端口',
          numberInput('guiPort'),
          '真 GUI 的反代端口；固定不改可让 iframe 的 origin 稳定（0 = 每次系统分配，会丢页面内状态）',
        ),
        row(
          '启用即弹出',
          NSwitch
            ? h(NSwitch, {
                size: 'small',
                value: Boolean(text.value.autoOpenWindow),
                'onUpdate:value': (value) => {
                  text.value.autoOpenWindow = value
                  scheduleSave()
                },
              })
            : null,
        ),
      ])
    }

    /**
     * 小窗外观：点亮的 chip = 该元素在小窗里显示。
     * 子项在父项没点亮时**直接不渲染**（不是置灰），所以不会出现"点了没反应"；
     * 说明全部收进 tooltip，行里只放 chip 本身。
     */
    function renderDeclutter() {
      const GROUPS = [
        {
          title: '',
          items: [
            { key: 'showRail', label: '左栏图标', tip: '官方左侧 56px 图标栏：鲸鱼 logo、新建会话、搜索、设置…' },
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
              tip: '官方在窄宽下会把「智能体团队 / 标准模式 / 智能体预设」折叠成只剩图标（容器查询 ≤460~540px）；点亮后强制显示文字，可能有点挤',
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
              reopenGuiSoon()
            },
          },
          { default: () => item.label },
        )
        return NTooltip
          ? h(NTooltip, null, {
              trigger: () => tag,
              default: () => `${item.label}：${item.tip}。点亮 = 在小窗里显示`,
            })
          : tag
      }

      const setAll = (on) => {
        for (const group of GROUPS) for (const item of group.items) text.value[item.key] = on
        scheduleSave()
        reopenGuiSoon()
      }
      const restoreRecommended = () => {
        for (const group of GROUPS) {
          for (const item of group.items) text.value[item.key] = Boolean(DEFAULTS[item.key])
        }
        scheduleSave()
        reopenGuiSoon()
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
          reopenGuiSoon()
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
        return h('details', { class: 'dsh-chat-settings__fold' }, [
          h('summary', null, `可改的 class 速查（${list.length} 个选择器）`),
          h('div', { class: 'dsh-chat-settings__fold-body' }, [
            h(
              'div',
              { class: 'dsh-chat-settings__cls-note' },
              '官方 class 带哈希前缀（如 uPhUma_titleRow、Q7WfXG_dock），每次构建都会变，所以要用 [class*="_语义名"] 匹配；点名「插入」会把规则骨架写进上面的输入框。',
            ),
            ...rows,
          ]),
        ])
      }

      const cssBlock = () =>        h('div', { class: 'dsh-chat-settings__block' }, [
          h('div', { class: 'dsh-chat-settings__block-title' }, '自定义样式（CSS）'),
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
                  reopenGuiSoon()
                },
              })
            : null,
          h('div', { class: 'dsh-chat-settings__block-actions' }, [
            smallButton('插入示例', () => {
              const sample = '[class*="_header"] { padding: 0 !important; }'
              text.value.customCss = text.value.customCss ? `${text.value.customCss}\n${sample}` : sample
              scheduleSave()
              reopenGuiSoon()
            }),
            smallButton('清空', () => {
              text.value.customCss = ''
              scheduleSave()
              reopenGuiSoon()
            }),
          ]),
          classCheatSheet(),
        ])

      return card(
        '小窗外观',
        '点亮 = 在小窗里显示，灰掉 = 隐藏；鼠标悬停看每一项的说明。改动会自动重开小窗（~1 秒生效）。',
        [
          row(
            '紧凑留白',
            NSwitch
              ? h(NSwitch, {
                  size: 'small',
                  value: Boolean(text.value.compactSpacing),
                  'onUpdate:value': (value) => {
                    text.value.compactSpacing = value
                    scheduleSave()
                    reopenGuiSoon()
                  },
                })
              : null,
            '开 = 把官方留白与滚动区/输入框/消息间距收到小窗尺度（官方输入框每侧留白 32px → 16px，多出约 16px/侧宽度；消息间距 16px → 10px）',
          ),
          ...GROUPS.filter((group) => !group.when || group.when()).map((group) =>
            h('div', { class: 'dsh-chat-settings__group' }, [
              group.title ? h('div', { class: 'dsh-chat-settings__group-title' }, group.title) : null,
              h('div', { class: 'dsh-chat-settings__tags' }, group.items.map(chip)),
            ]),
          ),
          cssBlock(),
        ],
        [smallButton('全部显示', () => setAll(true)), smallButton('恢复推荐', restoreRecommended)],
      )
    }

    function renderToolbar() {
      const button = (label, onClick, options = {}) =>
        NButton ? h(NButton, { size: 'small', onClick, ...options }, { default: () => label }) : null
      return h('div', { class: 'dsh-chat-settings__toolbar' }, [
        button('刷新列表', () => void loadSessions(), { loading: loading.value }),
        button('读取转录', () => void preview(selected.value), { disabled: !selected.value }),
        button('小窗打开（真 GUI）', () => void openGui(), { type: 'primary', disabled: !selected.value }),
        button('固定到镜像卡', () => void pinMirror(), { disabled: !selected.value }),
        button('跟随最新', () => void followLatest()),
      ])
    }

    function renderSessionList() {
      const rows = sessions.value.map((s) =>
        h(
          'div',
          {
            class: `dsh-chat-settings__session${s.id === selected.value ? ' is-active' : ''}`,
            key: s.id,
            onClick: () => void preview(s.id),
          },
          [
            h('div', { class: 'dsh-chat-settings__session-title', title: s.title || s.id }, s.title || s.id),
            h(
              'div',
              { class: 'dsh-chat-settings__session-meta', title: `${s.cwd || ''}` },
              `${formatTime(s.updatedAt)} · ${s.cwd || '未知工作目录'}`,
            ),
          ],
        ),
      )
      return h(
        'div',
        { class: 'dsh-chat-settings__sessions' },
        rows.length > 0
          ? rows
          : [h('div', { class: 'dsh-chat-settings__muted', style: { padding: '0.75rem' } }, '没有扫描到 DSH 会话。先在 DSH 里说句话，或检查「DSH 主目录」。')],
      )
    }

    function renderTranscript() {
      if (!transcript.value) {
        return h('div', { class: 'dsh-chat-settings__muted' }, '点上面任意一个会话查看转录。')
      }
      const { groups, args } = transcriptGroups.value
      const nodes = groups.map((item, index) => {
        if (item.kind === 'user') {
          if (item.context) return null
          return h('div', { class: 'dsh-chat-settings__msg-user', key: `u${index}` }, item.text || '')
        }
        if (item.kind === 'assistant') {
          const children = []
          if (item.reasoning) {
            children.push(
              h('details', { class: 'dsh-chat-settings__fold', key: 'r' }, [
                h('summary', null, '思考'),
                h('div', { class: 'dsh-chat-settings__fold-body' }, item.reasoning),
              ]),
            )
          }
          if (item.text) children.push(h('div', { key: 't' }, item.text))
          if (children.length === 0) return null
          return h('div', { class: 'dsh-chat-settings__msg-assistant', key: `a${index}` }, children)
        }
        if (item.kind === 'toolGroup') {
          const failed = item.tools.filter((tool) => tool.ok === false).length
          return h('div', { class: 'dsh-chat-settings__msg-assistant', key: item.id ?? `g${index}` }, [
            h('details', { class: 'dsh-chat-settings__fold' }, [
              h('summary', null, `${item.tools.length} 个工具调用${failed > 0 ? `（${failed} 个失败）` : ''}`),
              h(
                'div',
                { class: 'dsh-chat-settings__fold-body' },
                item.tools.map((tool, i) =>
                  h(
                    'div',
                    { class: 'dsh-chat-settings__tool', key: `t${i}` },
                    `${tool.name || 'tool'} ${args.get(tool.id) || ''}${tool.ok === false ? ' · 失败' : ''}`.trim(),
                  ),
                ),
              ),
            ]),
          ])
        }
        return null
      })
      return h('div', { class: 'dsh-chat-settings__transcript' }, nodes.length > 0 ? nodes : [h('div', { class: 'dsh-chat-settings__muted' }, '这个会话没有可显示的消息。')])
    }

    function renderSessions() {
      return card('DSH 会话', '列出本机所有 DSH 会话（含 DSH 主窗口里的对话）；选一个可以看转录，或固定给小窗。', [
        renderToolbar(),
        sessionOptions.value.length > 1 && NSelect
          ? h(NSelect, {
              size: 'small',
              value: selected.value || null,
              options: sessionOptions.value,
              consistentMenuWidth: false,
              'onUpdate:value': (value) => void preview(value),
            })
          : null,
        renderSessionList(),
        renderTranscript(),
      ])
    }

    function renderChat() {
      return card('对话（向 DSH 提问）', '小窗输入框发出的消息走 DeepSeek Harness 官方 stdio SDK（dsh --profile sdk），会话同样落进 DSH 会话库，之后可在 DSH 主窗口继续。', [
        row('dsh 命令', textInput('dshCommand', { placeholder: 'dsh 或 dsh.cmd 的绝对路径' }), '留空 = 用 PATH 里的 dsh'),
        row('profile', textInput('profile', { width: '8rem' })),
        row('provider', textInput('provider', { width: '12rem' })),
        row('model', textInput('model', { width: '12rem' })),
        row(
          '思考强度',
          NSelect
            ? h(NSelect, {
                style: { width: '12rem' },
                size: 'small',
                value: text.value.reasoningEffort,
                options: effortOptions,
                'onUpdate:value': (value) => {
                  text.value.reasoningEffort = value
                  scheduleSave()
                },
              })
            : null,
        ),
        row('最大输出', numberInput('maxTokens'), `0 = 模型默认；当前 ${nums.value.maxTokens}`),
        row(
          '工作目录',
          [
            h(NInput, {
              style: { width: '20rem' },
              size: 'small',
              value: text.value.cwd,
              placeholder: '留空 = 镜像会话的 cwd',
              'onUpdate:value': (value) => {
                text.value.cwd = value
                scheduleSave()
              },
              onBlur: () => void saveNow(),
            }),
            NButton ? h(NButton, { size: 'small', onClick: () => void pickFolder() }, { default: () => '选择' }) : null,
          ],
          'SDK 子进程的工作目录',
        ),
        row(
          '权限补丁',
          [
            h(NInput, {
              style: { width: '20rem' },
              size: 'small',
              value: text.value.patchFile,
              placeholder: '可选：dsh --patch 的 yml 路径',
              'onUpdate:value': (value) => {
                text.value.patchFile = value
                scheduleSave()
              },
              onBlur: () => void saveNow(),
            }),
            NButton ? h(NButton, { size: 'small', onClick: () => void pickPatch() }, { default: () => '选择' }) : null,
          ],
          '传给 dsh --patch，用来覆盖 profile 的权限策略',
        ),
        row(
          'DSH 主目录',
          h(NInput, {
            style: { width: '20rem' },
            size: 'small',
            value: text.value.dshHome,
            placeholder: '留空 = ~/.dsh',
            'onUpdate:value': (value) => {
              text.value.dshHome = value
              scheduleSave()
            },
            onBlur: () => void saveNow(),
          }),
        ),
        NAlert
          ? h(NAlert, { type: 'info', size: 'small', bordered: false }, {
              default: () =>
                'SDK 协议没有「列出历史 / 接续已有会话 / 审批应答」的方法：小窗里的提问是新会话，' +
                '已有会话只能只读镜像；工具需要批准时按 profile 默认策略处理（要完全访问请用上面的权限补丁，或改在 DSH 主窗口里聊）。',
            })
          : null,
      ])
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
        renderWindow(),
        renderDeclutter(),
        NDivider ? h(NDivider, null) : null,
        renderSessions(),
        renderChat(),
      ])
  },
}

/** 默认导出即设置组件（宿主取 default）。 */
export default DshChatSettings
export const Settings = DshChatSettings
