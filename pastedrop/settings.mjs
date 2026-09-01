/** PasteDrop 剪贴板存图 — 设置面板。 */
const vue = globalThis.__CATRACE_VUE__ || {}
const naive = globalThis.__CATRACE_NAIVE__ || {}
const { h, ref, onMounted } = vue
const { NAlert, NButton, NInput, NSelect, useMessage } = naive

if (typeof h !== 'function' || typeof ref !== 'function') {
  throw new Error('Catrace plugin Vue runtime missing')
}
if (!NAlert || !NButton || !NInput || !NSelect || !useMessage) {
  throw new Error('Catrace plugin naive runtime missing')
}
if (!plugin || !plugin.config || !plugin.sidecar) {
  throw new Error('Catrace plugin API missing (plugin facade)')
}

const STYLE_ID = 'catrace-plugin-pastedrop-settings-css'
const CSS = `
.pd-settings { width:100%; display:flex; flex-direction:column; gap:0.75rem; color:#0f172a; }
.pd-settings * { box-sizing:border-box; }
.pd-settings .card {
  min-width:0; padding:1.125rem 1.25rem 1.25rem; border:0.0625rem solid #e8eef7;
  border-radius:1rem; background:#fff;
  box-shadow:0 0.0625rem 0.125rem rgba(15,23,42,0.03);
  display:flex; flex-direction:column; gap:0.875rem;
}
.pd-settings h3 { margin:0; font-size:0.9375rem; font-weight:700; color:#0f172a; }
.pd-settings .field { display:flex; flex-direction:column; gap:0.375rem; min-width:0; }
.pd-settings .label { font-size:0.75rem; color:#64748b; font-weight:600; }
.pd-settings .hint { margin:0; color:#94a3b8; font-size:0.6875rem; line-height:1.4; }
.pd-settings .row { display:flex; align-items:center; gap:0.5rem; }
.pd-settings .row .n-input { flex:1; min-width:0; }
.pd-settings .actions { display:flex; flex-wrap:wrap; gap:0.5rem; }
.pd-settings .status-line { font-size:0.75rem; color:#475569; line-height:1.5; }
.pd-settings .status-line .tag {
  display:inline-block; padding:0.0625rem 0.375rem; border-radius:0.375rem;
  font-weight:600; margin-right:0.375rem;
}
.pd-settings .tag.ok { background:#ecfdf5; color:#059669; }
.pd-settings .tag.bad { background:#fef2f2; color:#dc2626; }
.pd-settings .tag.muted { background:#f1f5f9; color:#64748b; }
.pd-settings .saved-line { font-size:0.6875rem; color:#94a3b8; word-break:break-all; }
`

const SAVE_SCOPE_OPTIONS = [
  { label: '桌面 + 资源管理器当前文件夹', value: 'both' },
  { label: '仅桌面', value: 'desktop' },
  { label: '仅资源管理器当前文件夹', value: 'explorer' },
]

const SAVE_FORMAT_OPTIONS = [
  { label: '自动（优先无损 PNG）', value: 'auto' },
  { label: 'PNG', value: 'png' },
  { label: 'JPG', value: 'jpg' },
]

const DEFAULT_CONFIG = {
  saveScope: 'both',
  namePrefix: 'Pasted Image',
  saveFormat: 'auto',
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

function normalizeConfig(input = {}) {
  return {
    saveScope:
      input.saveScope === 'desktop' || input.saveScope === 'explorer' || input.saveScope === 'both'
        ? input.saveScope
        : DEFAULT_CONFIG.saveScope,
    namePrefix:
      typeof input.namePrefix === 'string' && input.namePrefix.trim()
        ? input.namePrefix.trim()
        : DEFAULT_CONFIG.namePrefix,
    saveFormat:
      input.saveFormat === 'png' || input.saveFormat === 'jpg' || input.saveFormat === 'auto'
        ? input.saveFormat
        : DEFAULT_CONFIG.saveFormat,
  }
}

export default {
  name: 'PasteDropSettings',
  setup() {
    ensureStyles()
    const message = useMessage()
    const busy = ref('')
    const saveScope = ref(DEFAULT_CONFIG.saveScope)
    const namePrefix = ref(DEFAULT_CONFIG.namePrefix)
    const saveFormat = ref(DEFAULT_CONFIG.saveFormat)
    /** @type {import('vue').Ref<object|null>} */
    const status = ref(null)
    let saveTimer = null

    function currentConfig() {
      return normalizeConfig({
        saveScope: saveScope.value,
        namePrefix: namePrefix.value,
        saveFormat: saveFormat.value,
      })
    }

    function applyConfig(cfg = {}) {
      saveScope.value =
        cfg.saveScope === 'desktop' || cfg.saveScope === 'explorer' || cfg.saveScope === 'both'
          ? cfg.saveScope
          : DEFAULT_CONFIG.saveScope
      namePrefix.value =
        typeof cfg.namePrefix === 'string' && cfg.namePrefix.trim()
          ? cfg.namePrefix.trim()
          : DEFAULT_CONFIG.namePrefix
      saveFormat.value =
        cfg.saveFormat === 'png' || cfg.saveFormat === 'jpg' || cfg.saveFormat === 'auto'
          ? cfg.saveFormat
          : DEFAULT_CONFIG.saveFormat
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

    async function persistAndSync({ quiet = false } = {}) {
      const cfg = currentConfig()
      saveScope.value = cfg.saveScope
      namePrefix.value = cfg.namePrefix
      saveFormat.value = cfg.saveFormat
      await plugin.config.set(cfg)
      try {
        await plugin.sidecar.request('setConfig', cfg)
        status.value = await plugin.sidecar.request('getStatus')
        if (!quiet) message.success('已保存')
        await plugin.log.info('pastedrop config auto-saved', { cfg })
      } catch (error) {
        if (!quiet) message.warning('已保存（启用插件后生效）')
        await plugin.log.warn('pastedrop config saved without runtime', {
          error: errorText(error),
        })
      }
    }

    function scheduleSave() {
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        saveTimer = null
        persistAndSync({ quiet: true }).catch((error) => {
          message.error(errorText(error))
        })
      }, 400)
    }

    async function refreshStatus() {
      await run('status', async () => {
        status.value = await plugin.sidecar.request('getStatus')
      })
    }

    onMounted(() => {
      run('boot', async () => {
        const saved = await plugin.config.get()
        if (saved && typeof saved === 'object') applyConfig(saved)
        await persistAndSync({ quiet: true })
      })
    })

    const button = (label, key, onClick, props = {}) =>
      h(
        NButton,
        {
          size: 'small',
          type: 'primary',
          secondary: true,
          loading: busy.value === key,
          disabled: !!busy.value && busy.value !== key,
          onClick,
          ...props,
        },
        { default: () => label },
      )

    const statusTag = (ok, text) =>
      h('span', { class: `tag ${ok ? 'ok' : 'bad'}` }, text)

    return () => {
      const st = status.value
      const unsupported = st?.supported === false
      const workerBad = st && st.workerOk === false
      const workerRunning = st?.workerRunning === true

      return h('div', { class: 'pd-settings' }, [
        h('section', { class: 'card' }, [
          h('h3', '保存行为'),
          h('div', { class: 'field' }, [
            h('span', { class: 'label' }, '在哪些地方拦截 Ctrl+V'),
            h(NSelect, {
              value: saveScope.value,
              options: SAVE_SCOPE_OPTIONS,
              'onUpdate:value': (v) => {
                saveScope.value = v
                scheduleSave()
              },
            }),
            h(
              'p',
              { class: 'hint' },
              '拦截范围内且剪贴板是图片时，把图片存成文件；其他情况原样放行粘贴。',
            ),
          ]),
          h('div', { class: 'field' }, [
            h('span', { class: 'label' }, '文件名前缀'),
            h(NInput, {
              value: namePrefix.value,
              'onUpdate:value': (v) => {
                namePrefix.value = v
                scheduleSave()
              },
              placeholder: 'Pasted Image',
            }),
            h(
              'p',
              { class: 'hint' },
              '例如「Pasted Image 2026-08-13 10-00-00.png」，同名会自动加序号。',
            ),
          ]),
          h('div', { class: 'field' }, [
            h('span', { class: 'label' }, '保存格式'),
            h(NSelect, {
              value: saveFormat.value,
              options: SAVE_FORMAT_OPTIONS,
              'onUpdate:value': (v) => {
                saveFormat.value = v
                scheduleSave()
              },
            }),
            h(
              'p',
              { class: 'hint' },
              '自动：剪贴板自带 PNG 就原样写出（不重编码）；否则无损存 PNG。JPG 体积更小但有损。',
            ),
          ]),
        ]),

        h('section', { class: 'card' }, [
          h('h3', '状态'),
          unsupported
            ? h(NAlert, { type: 'warning', title: '仅支持 Windows' }, { default: () => '本插件依赖 Windows 全局键盘钩子，当前系统不可用。' })
            : null,
          workerBad && !unsupported
            ? h(
                NAlert,
                { type: 'warning', title: '钩子启动失败' },
                {
                  default: () => `需要 Windows PowerShell 5.1+（系统标配）。${st.lastWorkerError || ''}`,
                },
              )
            : null,
          st && !unsupported
            ? h('div', { class: 'status-line' }, [
                statusTag(workerRunning, workerRunning ? '运行中' : '未运行'),
                statusTag(st.workerOk === true, st.workerOk === true ? '钩子 OK' : '钩子未知'),
                st.lastWorkerError ? h('div', {}, st.lastWorkerError) : null,
              ])
            : null,
          st?.lastSaved
            ? h('div', { class: 'saved-line' }, [
                `最近保存：${st.lastSaved.fileName} @ ${st.lastSaved.path}`,
              ])
            : null,
          h('div', { class: 'actions' }, [
            button('刷新状态', 'status', refreshStatus),
          ]),
          h('p', { class: 'hint' }, '本插件跑一个 PowerShell 小子进程装全局键盘钩子，启用即信任其全部代码。'),
        ]),
      ])
    }
  },
}
