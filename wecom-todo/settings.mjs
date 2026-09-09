/** WeCom todo workbench — complete in-plugin HTML UI. */
const vue = globalThis.__CATRACE_VUE__ || {}
const naive = globalThis.__CATRACE_NAIVE__ || {}
const { h, ref, computed, onMounted, onBeforeUnmount } = vue
const { useMessage } = naive

if (typeof h !== 'function' || typeof ref !== 'function') {
  throw new Error('Catrace plugin Vue runtime missing (__CATRACE_VUE__.h)')
}
if (!useMessage) {
  throw new Error('Catrace plugin naive runtime missing (__CATRACE_NAIVE__)')
}
if (!plugin || !plugin.config || !plugin.setEnabled) {
  throw new Error('Catrace plugin API missing (plugin facade)')
}

const PLUGIN_ID = 'wecom-todo'
const MIN_POLL_SEC = 30
const MAX_POLL_SEC = 3600
const DEFAULT_POLL_SEC = 120
const STYLE_ID = 'catrace-plugin-wecom-todo-settings-css'
const CSS = `
.wc { width: 100%; box-sizing: border-box; color: #0f172a; font-family: inherit; font-size: inherit; line-height: inherit; }
.wc *, .wc *::before, .wc *::after { box-sizing: border-box; }
.wc-bar { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; margin-bottom: 0.875rem; flex-wrap: wrap; }
.wc-bar-left { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
.wc-h { margin: 0; font-size: 1.25rem; font-weight: 700; letter-spacing: -0.02em; color: #0f172a; line-height: 1.3; }
.wc-badge { display: inline-flex; align-items: center; height: 1.5rem; padding: 0 0.6rem; border-radius: 999px; background: #dbeafe; color: #1d4ed8; font-size: 0.75rem; font-weight: 700; }
.wc-bar-right { display: flex; align-items: center; gap: 0.4rem; }
.wc-setting { display: flex; align-items: flex-start; gap: 0.6rem; margin: 0 0 0.875rem; padding: 0.75rem 0.85rem; border: 0.0625rem solid #e2e8f0; border-radius: 0.7rem; background: #fff; color: #475569; font-size: 0.75rem; line-height: 1.4; }
.wc-setting input { width: 1rem; height: 1rem; margin: 0.1rem 0 0; accent-color: #2563eb; flex-shrink: 0; }
.wc-setting strong { display: block; color: #334155; font-size: 0.8125rem; }
.wc-setting span { display: block; margin-top: 0.15rem; }
.wc-btn { appearance: none; font-family: inherit; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 0.35rem; height: 2.25rem; padding: 0 1rem; border-radius: 0.65rem; font-size: 0.8125rem; font-weight: 600; line-height: 1.3; border: 0.0625rem solid transparent; transition: background .15s, border-color .15s, color .15s, box-shadow .15s; }
.wc-btn:disabled { opacity: .55; cursor: default; }
.wc-btn-text { background: transparent; color: #64748b; border-color: transparent; }
.wc-btn-text:hover:not(:disabled) { background: #eff6ff; color: #2563eb; }
.wc-btn-ghost { background: #fff; color: #334155; border-color: #e2e8f0; }
.wc-btn-ghost:hover:not(:disabled) { background: #f8fafc; border-color: #cbd5e1; }
.wc-btn-primary { background: #2563eb; color: #fff; border-color: #2563eb; box-shadow: 0 0.125rem 0.4rem rgba(37,99,235,.25); }
.wc-btn-primary:hover:not(:disabled) { background: #1d4ed8; border-color: #1d4ed8; }
.wc-card { background: #fff; border: 0.0625rem solid #e8eef5; border-radius: 1rem; padding: 1.05rem 1.15rem 1.1rem; box-shadow: 0 0.0625rem 0.2rem rgba(15,23,42,.04); transition: border-color .15s, background .15s, box-shadow .15s; }
.wc-card + .wc-card { margin-top: 0.75rem; }
.wc-card.is-row { cursor: pointer; }
.wc-card.is-row:hover { border-color: #93c5fd; background: #f8fbff; box-shadow: 0 0.35rem 1rem rgba(37,99,235,.08); }
.wc-card.is-edit { border-color: #60a5fa; box-shadow: 0 0.5rem 1.5rem rgba(37,99,235,.1); }
.wc-edit-top { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; margin-bottom: 0.75rem; }
.wc-kicker { margin: 0; display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.8125rem; font-weight: 600; line-height: 1.3; color: #2563eb; }
.wc-hint { margin: 0; font-size: 0.75rem; line-height: 1.4; color: #64748b; }
.wc-area { width: 100%; min-height: 6.5rem; padding: 0.9rem 1rem; border: 0.0625rem solid #e2e8f0; border-radius: 0.75rem; background: #f8fafc; color: #0f172a; font-family: inherit; font-size: 0.8125rem; line-height: 1.4; resize: none; }
.wc-area:focus { outline: none; border-color: #60a5fa; background: #fff; box-shadow: 0 0 0 0.2rem rgba(37,99,235,.12); }
.wc-area.sm { min-height: 4rem; }
.wc-attach { display: flex; align-items: center; justify-content: space-between; margin: 0.9rem 0 0.55rem; }
.wc-attach-l { font-size: 0.75rem; line-height: 1.4; color: #64748b; }
.wc-link { appearance: none; border: 0; background: none; color: #2563eb; font-family: inherit; font-size: 0.8125rem; font-weight: 600; line-height: 1.3; cursor: pointer; display: inline-flex; align-items: center; gap: 0.3rem; }
.wc-link:hover { color: #1d4ed8; }
.wc-thumbs { display: flex; flex-wrap: wrap; gap: 0.65rem; }
.wc-thumb { position: relative; width: 7rem; height: 5rem; }
.wc-thumb img, .wc-thumb .ph { width: 7rem; height: 5rem; object-fit: cover; border-radius: 0.7rem; display: block; background: #e2e8f0; }
.wc-x { position: absolute; top: 0.3rem; right: 0.3rem; width: 1.35rem; height: 1.35rem; border: 0; border-radius: 999px; background: rgba(15,23,42,.62); color: #fff; cursor: pointer; font-size: 0.8rem; line-height: 1; }
.wc-x:hover { background: #0f172a; }
.wc-add { width: 7rem; height: 5rem; border: 0.0625rem dashed #cbd5e1; border-radius: 0.7rem; background: #f8fafc; color: #94a3b8; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.2rem; font-size: 0.75rem; line-height: 1.4; font-family: inherit; }
.wc-add:hover, .wc-add.is-over { border-color: #60a5fa; color: #2563eb; background: #eff6ff; }
.wc-foot { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1rem; padding-top: 0.9rem; border-top: 0.0625rem solid #f1f5f9; }
.wc-row { display: flex; gap: 0.7rem; align-items: flex-start; }
.wc-check { width: 1.1rem; height: 1.1rem; margin-top: 0.2rem; flex-shrink: 0; border: 0.125rem solid #cbd5e1; border-radius: 0.28rem; background: #fff; }
.wc-body { min-width: 0; flex: 1; }
.wc-title { margin: 0; font-size: 0.8125rem; font-weight: 600; color: #0f172a; line-height: 1.4; white-space: pre-line; }
.wc-desc {
  margin: 0.35rem 0 0; font-size: 0.75rem; font-weight: 400; color: #64748b; line-height: 1.4;
  white-space: pre-line;
  display: -webkit-box; -webkit-line-clamp: 8; -webkit-box-orient: vertical; overflow: hidden;
}
.wc-previews { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 0.7rem 0 0.2rem; }
.wc-previews img { width: 6.5rem; height: 4.6rem; object-fit: cover; border-radius: 0.55rem; background: #e2e8f0; }
.wc-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 0.65rem; margin-top: 0.5rem; font-size: 0.75rem; line-height: 1.4; color: #94a3b8; }
.wc-meta .ok { color: #2563eb; font-weight: 650; }
.wc-empty { padding: 3rem 1rem; text-align: center; color: #64748b; }
.wc-empty h3 { margin: 0 0 0.4rem; font-size: 0.875rem; font-weight: 600; line-height: 1.3; color: #0f172a; }
.wc-empty p { margin: 0 0 1rem; font-size: 0.8125rem; line-height: 1.4; }
.wc-banner { margin: 0 0 0.75rem; padding: 0.7rem 0.85rem; border-radius: 0.65rem; background: #fef2f2; color: #b91c1c; font-size: 0.8125rem; line-height: 1.4; }
.wc-field { margin-top: 0.75rem; }
.wc-lab { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.4rem; font-size: 0.75rem; font-weight: 600; line-height: 1.4; color: #64748b; }
.wc-skel { height: 5.5rem; border-radius: 1rem; background: linear-gradient(90deg,#f1f5f9,#fff,#f1f5f9); background-size: 200% 100%; animation: wcsh 1.2s ease infinite; }
.wc-skel + .wc-skel { margin-top: 0.75rem; }
@keyframes wcsh { from { background-position: 100% 0; } to { background-position: -100% 0; } }
@media (prefers-reduced-motion: reduce) { .wc-skel { animation: none; } .wc-card, .wc-btn { transition: none; } }
.wc-tabs { display: flex; align-items: center; gap: 0.25rem; margin-bottom: 0.875rem; border-bottom: 0.0625rem solid #e2e8f0; padding-bottom: 0.25rem; }
.wc-tab { appearance: none; font-family: inherit; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; height: 2rem; padding: 0 0.75rem; border-radius: 0.5rem; font-size: 0.8125rem; font-weight: 600; line-height: 1; border: 0.0625rem solid transparent; background: transparent; color: #64748b; transition: background .15s, color .15s; }
.wc-tab:hover { background: #f1f5f9; color: #334155; }
.wc-tab.active { background: #eff6ff; color: #2563eb; }
.wc-tab-panel { width: 100%; }
.wc-section { margin: 0 0 0.75rem; }
.wc-section-title { margin: 0 0 0.45rem; font-size: 1rem; font-weight: 700; color: #0f172a; line-height: 1.3; }
.wc-section p { margin: 0 0 0.5rem; font-size: 0.8125rem; line-height: 1.5; color: #475569; }
.wc-steps { display: flex; flex-direction: column; gap: 0.65rem; }
.wc-step { display: flex; gap: 0.6rem; align-items: flex-start; }
.wc-step-num { flex-shrink: 0; width: 1.5rem; height: 1.5rem; display: flex; align-items: center; justify-content: center; border-radius: 999px; background: #2563eb; color: #fff; font-size: 0.75rem; font-weight: 700; }
.wc-step-body { min-width: 0; flex: 1; }
.wc-step-title { margin: 0 0 0.2rem; font-size: 0.8125rem; font-weight: 700; color: #0f172a; line-height: 1.4; }
.wc-step-list { margin: 0; padding-left: 1.1rem; font-size: 0.8125rem; line-height: 1.5; color: #475569; }
.wc-step-list li { margin: 0.25rem 0; }
.wc-copy-row { display: flex; align-items: center; gap: 0.5rem; margin: 0.35rem 0; }
.wc-code { flex: 1; min-width: 0; padding: 0.45rem 0.6rem; border-radius: 0.4rem; background: #f1f5f9; color: #0f172a; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.75rem; line-height: 1.4; overflow-x: auto; white-space: pre-wrap; word-break: break-all; }
.wc-copy-btn { appearance: none; font-family: inherit; cursor: pointer; flex-shrink: 0; height: 1.75rem; padding: 0 0.55rem; border-radius: 0.4rem; border: 0.0625rem solid #e2e8f0; background: #fff; color: #475569; font-size: 0.75rem; font-weight: 600; }
.wc-copy-btn:hover { border-color: #93c5fd; color: #2563eb; background: #f8fbff; }
.wc-faq { margin: 0.6rem 0 0; }
.wc-faq-q { font-size: 0.8125rem; font-weight: 700; color: #0f172a; line-height: 1.4; margin-bottom: 0.25rem; }
.wc-faq-a { margin: 0; font-size: 0.8125rem; line-height: 1.5; color: #475569; }
.wc-privacy { display: flex; gap: 0.5rem; align-items: flex-start; font-size: 0.75rem; line-height: 1.5; color: #64748b; }
.wc-privacy svg { flex-shrink: 0; margin-top: 0.1rem; color: #94a3b8; }
.wc-banner .wc-link { color: #b91c1c; text-decoration: underline; margin-left: 0.5rem; }
.wc-banner .wc-link:hover { color: #7f1d1d; }
`

function ensureStyles() {
  if (typeof document === 'undefined') return
  let el = document.getElementById(STYLE_ID)
  if (!el) {
    el = document.createElement('style')
    el.id = STYLE_ID
    document.head.appendChild(el)
  }
  el.textContent = CSS
}

function clamp(n, min, max, fallback) {
  const v = Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.min(max, Math.max(min, Math.round(v)))
}

function collapseBlankLines(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

function displayTitle(item) {
  const t = collapseBlankLines(item && item.title)
  return t || '未命名待办'
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

function svg(d, size = 16) {
  return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, [
    h('path', { d }),
  ])
}

export default {
  name: 'WecomTodoSettings',
  setup(_props, { expose }) {
    ensureStyles()
    const message = useMessage()
    const loading = ref(true)
    const busy = ref('')
    const headerLoading = ref(false)
    const cliPath = ref('')
    const pollIntervalSec = ref(DEFAULT_POLL_SEC)
    const enabled = ref(true)
    const preserveOriginalTitle = ref(true)
    const board = ref([])
    const openKey = ref('')
    const drafts = ref({})
    const creating = ref(false)
    const draftTitle = ref('')
    const draftDesc = ref('')
    const status = ref(null)
    const dragOver = ref(false)
    const activeTab = ref('board')
    const headerEnabled = computed(() => enabled.value !== false)

    async function copyToClipboard(text) {
      try {
        await navigator.clipboard.writeText(String(text || ''))
        message.success('已复制到剪贴板')
      } catch (e) {
        message.error('复制失败')
      }
    }

    async function runInTerminal(command) {
      const cmd = String(command || '').trim()
      if (!cmd) return
      console.log('[wecom-todo] runInTerminal', cmd)
      try {
        if (!plugin.platform || !plugin.process || typeof plugin.process.spawn !== 'function') {
          throw new Error('plugin platform/process API not available')
        }
        const info = await plugin.platform.getInfo()
        console.log('[wecom-todo] platform', info)
        if (info.os === 'windows') {
          // /c start cmd.exe /k ... 强制打开一个新终端窗口
          await plugin.process.spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/k', cmd])
        } else if (info.os === 'macos') {
          const script = `tell application "Terminal" to do script "${cmd.replace(/"/g, '\\"')}"`
          await plugin.process.spawn('osascript', ['-e', script])
        } else {
          await plugin.process.spawn('xterm', ['-e', cmd])
        }
        message.success('已在终端打开命令')
      } catch (e) {
        console.error('[wecom-todo] runInTerminal failed', e)
        try {
          await navigator.clipboard.writeText(cmd)
          message.warning('当前系统不支持直接运行，已复制命令，请手动粘贴到终端')
        } catch {
          message.error('无法运行或复制命令')
        }
      }
    }

    function currentConfig() {
      return {
        cliPath: String(cliPath.value || '').trim(),
        pollIntervalSec: clamp(pollIntervalSec.value, MIN_POLL_SEC, MAX_POLL_SEC, DEFAULT_POLL_SEC),
        preserveOriginalTitle: preserveOriginalTitle.value !== false,
        enabled: enabled.value !== false,
      }
    }

    function applyBoard(result) {
      if (result && typeof result === 'object') status.value = result
      const list = Array.isArray(result?.board) ? result.board : Array.isArray(result?.lastTitles) ? result.lastTitles : []
      board.value = list
      const next = { ...drafts.value }
      for (const item of list) {
        if (!item.key) continue
        if (!next[item.key] || openKey.value !== item.key) {
          next[item.key] = { title: item.title || '', description: item.description || '' }
        }
      }
      drafts.value = next
    }

    function draftOf(key) {
      if (!drafts.value[key]) drafts.value = { ...drafts.value, [key]: { title: '', description: '' } }
      return drafts.value[key]
    }

    function patchDraft(key, patch) {
      drafts.value = { ...drafts.value, [key]: { ...draftOf(key), ...patch } }
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

    async function persistAndSync() {
      const cfg = currentConfig()
      await plugin.config.set(cfg)
      try {
        if (plugin.sidecar?.request) await plugin.sidecar.request('setConfig', cfg)
      } catch {
        /* sidecar may be down */
      }
    }

    function togglePreserveOriginalTitle(value) {
      preserveOriginalTitle.value = value
      void run('config', persistAndSync)
    }

    async function refreshBoard() {
      if (!plugin.sidecar?.request) {
        status.value = { error: 'sidecar 未运行，请先启用插件' }
        return
      }
      const result = await plugin.sidecar.request('getBoard')
      applyBoard(result)
    }

    async function saveItem(item) {
      const d = draftOf(item.key)
      if (!String(d.title || '').trim()) {
        message.warning('标题不能为空')
        return
      }
      await run(`save:${item.key}`, async () => {
        const result = await plugin.sidecar.request('saveTodo', {
          key: item.key,
          title: d.title,
          description: d.description,
        })
        applyBoard(result)
        message.success('已保存到企业微信')
      })
    }

    async function addPic(item) {
      const picked = plugin.dialog?.showOpenDialog
        ? await plugin.dialog.showOpenDialog({
            title: '选择图片',
            filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
          })
        : await plugin.dialog?.pickFile?.()
      if (!picked) return
      await run(`img:${item.key}`, async () => {
        applyBoard(await plugin.sidecar.request('addImage', { key: item.key, path: picked }))
      })
    }

    async function attachDataUrl(key, dataUrl) {
      applyBoard(await plugin.sidecar.request('addImageBase64', { key, dataUrl }))
    }

    function ingestFiles(key, files) {
      const list = Array.from(files || []).filter((f) => f && String(f.type || '').startsWith('image/'))
      if (!list.length) return
      const file = list[0]
      const reader = new FileReader()
      reader.onload = () => {
        attachDataUrl(key, String(reader.result || '')).catch((e) => message.error(errorText(e)))
      }
      reader.readAsDataURL(file)
    }

    function onPaste(ev) {
      const key = openKey.value
      if (!key) return
      const files = ev.clipboardData && ev.clipboardData.files
      if (files && files.length) {
        ev.preventDefault()
        ingestFiles(key, files)
      }
    }

    function onKey(ev) {
      if (ev.key === 'Escape') {
        creating.value = false
        openKey.value = ''
      }
    }

    async function dropPic(item, rel) {
      await run(`rm:${item.key}`, async () => {
        applyBoard(await plugin.sidecar.request('removeImage', { key: item.key, rel }))
      })
    }

    async function createNew() {
      const title = String(draftTitle.value || '').trim()
      if (!title) {
        message.warning('先写标题')
        return
      }
      await run('create', async () => {
        const result = await plugin.sidecar.request('createTodo', { title, description: draftDesc.value })
        applyBoard(result)
        draftTitle.value = ''
        draftDesc.value = ''
        creating.value = false
        if (result && result.key) openKey.value = result.key
        message.success('已创建')
      })
    }

    async function toggleEnabled(val) {
      const previous = enabled.value
      enabled.value = val
      headerLoading.value = true
      try {
        await plugin.setEnabled(val)
        await plugin.config.set(currentConfig())
        window.dispatchEvent(new CustomEvent('catrace:plugin-enabled-changed', { detail: { id: PLUGIN_ID, enabled: val } }))
      } catch (e) {
        enabled.value = previous
        message.error(errorText(e))
      } finally {
        headerLoading.value = false
      }
    }

    onMounted(() => {
      window.addEventListener('paste', onPaste)
      window.addEventListener('keydown', onKey)
      run('boot', async () => {
        loading.value = true
        try {
          const raw = await plugin.config.get()
          if (raw && typeof raw === 'object') {
            if (typeof raw.cliPath === 'string') cliPath.value = raw.cliPath
            pollIntervalSec.value = clamp(raw.pollIntervalSec, MIN_POLL_SEC, MAX_POLL_SEC, DEFAULT_POLL_SEC)
            preserveOriginalTitle.value = raw.preserveOriginalTitle !== false
            enabled.value = raw.enabled !== false
          }
          await persistAndSync()
          await refreshBoard()
        } finally {
          loading.value = false
        }
      })
    })
    onBeforeUnmount(() => {
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('keydown', onKey)
    })

    expose({ headerEnabled, headerLoading, toggleEnabled })

    function renderEditor(item, opts) {
      const isNew = !!opts?.isNew
      const imgs = item && item.images ? item.images : []
      const d = isNew ? { title: draftTitle.value, description: draftDesc.value } : draftOf(item.key)
      const setTitle = (v) => {
        if (isNew) draftTitle.value = v
        else patchDraft(item.key, { title: v })
      }
      const setDesc = (v) => {
        if (isNew) draftDesc.value = v
        else patchDraft(item.key, { description: v })
      }
      return h('article', { class: 'wc-card is-edit' }, [
        h('div', { class: 'wc-edit-top' }, [
          h('p', { class: 'wc-kicker' }, [
            svg('M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z', 15),
            isNew ? '新建待办' : '编辑待办事项',
          ]),
          h('p', { class: 'wc-hint' }, '支持直接粘贴图片 (Ctrl+V)'),
        ]),
        h('textarea', {
          class: 'wc-area',
          placeholder: '待办标题',
          value: d.title,
          onInput: (e) => setTitle(e.target.value),
        }),
        h('div', { class: 'wc-field' }, [
          h('div', { class: 'wc-lab' }, [
            h('span', '正文'),
          ]),
          h('textarea', {
            class: 'wc-area sm',
            placeholder: '补充说明，可选',
            value: d.description,
            onInput: (e) => setDesc(e.target.value),
          }),
        ]),
        isNew
          ? null
          : [
              h('div', { class: 'wc-attach' }, [
                h('span', { class: 'wc-attach-l' }, `已附加图片 (${imgs.length})`),
                h('button', { type: 'button', class: 'wc-link', onClick: () => addPic(item) }, [
                  svg('M12 5v14M5 12h14', 14),
                  '添加图片',
                ]),
              ]),
              h('div', {
                class: 'wc-thumbs',
                onDragover: (e) => {
                  e.preventDefault()
                  dragOver.value = true
                },
                onDragleave: () => {
                  dragOver.value = false
                },
                onDrop: (e) => {
                  e.preventDefault()
                  dragOver.value = false
                  ingestFiles(item.key, e.dataTransfer && e.dataTransfer.files)
                },
              }, [
                ...imgs.map((img) =>
                  h('div', { class: 'wc-thumb' }, [
                    img.dataUrl ? h('img', { src: img.dataUrl, alt: '' }) : h('div', { class: 'ph' }),
                    h('button', { type: 'button', class: 'wc-x', onClick: (e) => { e.stopPropagation(); dropPic(item, img.rel) } }, '×'),
                  ]),
                ),
                h('button', {
                  type: 'button',
                  class: ['wc-add', dragOver.value ? 'is-over' : ''],
                  onClick: () => addPic(item),
                }, [h('span', '+'), h('span', '上传/粘贴')]),
              ]),
            ],
        h('div', { class: 'wc-foot' }, [
          h('button', {
            type: 'button',
            class: 'wc-btn wc-btn-ghost',
            onClick: () => {
              creating.value = false
              openKey.value = ''
            },
          }, '取消'),
          h('button', {
            type: 'button',
            class: 'wc-btn wc-btn-primary',
            disabled: isNew ? busy.value === 'create' : busy.value === `save:${item.key}`,
            onClick: () => (isNew ? createNew() : saveItem(item)),
          }, [
            svg('M5 12l5 5L20 7', 16),
            isNew
              ? (busy.value === 'create' ? '创建中…' : '保存修改')
              : (busy.value === `save:${item.key}` ? '保存中…' : '保存修改'),
          ]),
        ]),
      ])
    }

    function renderRow(item) {
      if (openKey.value === item.key) return renderEditor(item)
      const imgs = item.images || []
      return h('article', {
        class: 'wc-card is-row',
        onClick: () => {
          creating.value = false
          openKey.value = item.key
        },
      }, [
        h('div', { class: 'wc-row' }, [
          h('div', { class: 'wc-check', 'aria-hidden': 'true' }),
          h('div', { class: 'wc-body' }, [
            h('p', { class: 'wc-title' }, displayTitle(item)),
            item.description ? h('p', { class: 'wc-desc' }, collapseBlankLines(item.description)) : null,
            imgs.some((x) => x.dataUrl)
              ? h('div', { class: 'wc-previews' }, imgs.filter((x) => x.dataUrl).slice(0, 4).map((img) => h('img', { src: img.dataUrl, alt: '' })))
              : null,
            h('div', { class: 'wc-meta' }, [
              svg('M12 7v5l3 2M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z', 13),
              h('span', item.create_time || ''),
              svg('M4 6h16v12H4zM8 10h.01M14 16l-3-3-2 2-1-1-4 4', 13),
              h('span', { class: imgs.length ? 'ok' : '' }, imgs.length ? `${imgs.length} 张图片` : '无图片'),
            ]),
          ]),
        ]),
      ])
    }

    function renderTabs() {
      const tabs = [
        { id: 'board', label: '待办' },
        { id: 'tutorial', label: '教程' },
      ]
      return h('div', { class: 'wc-tabs' }, tabs.map((tab) =>
        h('button', {
          key: tab.id,
          type: 'button',
          class: ['wc-tab', activeTab.value === tab.id ? 'active' : ''],
          onClick: () => { activeTab.value = tab.id },
        }, tab.label),
      ))
    }

    function renderTutorial() {
      const runRow = (text) =>
        h('div', { class: 'wc-copy-row' }, [
          h('code', { class: 'wc-code' }, text),
          h('button', {
            type: 'button',
            class: 'wc-copy-btn',
            onClick: () => runInTerminal(text),
          }, '运行'),
        ])

      const introCard = h('div', { class: 'wc-card' }, [
        h('div', { class: 'wc-section' }, [
          h('h2', { class: 'wc-section-title' }, '这是什么'),
          h('p', '本插件调用你本机安装的 wecom-cli，定时拉取企业微信工作台里的「进行中」待办。出现新的或发生更新的待办时，会在桌面右下角弹出 Toast 小窗；你可以在 Toast 上直接点「完成」把待办标记为已办。'),
        ]),
      ])

      const prereqCard = h('div', { class: 'wc-card' }, [
        h('div', { class: 'wc-section' }, [
          h('h2', { class: 'wc-section-title' }, '前置条件'),
          h('div', { class: 'wc-steps' }, [
            h('div', { class: 'wc-step' }, [
              h('span', { class: 'wc-step-num' }, '1'),
              h('div', { class: 'wc-step-body' }, [
                h('div', { class: 'wc-step-title' }, '安装 Node.js'),
                h('p', { style: { margin: 0 } }, '确保命令行可以执行 node，建议 Node.js ≥ 18。'),
              ]),
            ]),
            h('div', { class: 'wc-step' }, [
              h('span', { class: 'wc-step-num' }, '2'),
              h('div', { class: 'wc-step-body' }, [
                h('div', { class: 'wc-step-title' }, '安装企业微信 CLI'),
                h('p', { style: { margin: 0 } }, '全局安装 @wecom/cli（建议 ≥ 1.1.0）：'),
                runRow('npm install -g @wecom/cli'),
              ]),
            ]),
            h('div', { class: 'wc-step' }, [
              h('span', { class: 'wc-step-num' }, '3'),
              h('div', { class: 'wc-step-body' }, [
                h('div', { class: 'wc-step-title' }, '扫码登录一次'),
                h('p', { style: { margin: 0 } }, '在命令行执行：'),
                runRow('wecom-cli auth init'),
                h('p', { style: { margin: '0.35rem 0 0' } }, '按提示扫码后，wecom-cli 会在本机保存登录会话。'),
              ]),
            ]),
            h('div', { class: 'wc-step' }, [
              h('span', { class: 'wc-step-num' }, '4'),
              h('div', { class: 'wc-step-body' }, [
                h('div', { class: 'wc-step-title' }, '验证待办列表可访问'),
                h('p', { style: { margin: 0 } }, '执行下面命令，确认能返回 JSON 数据：'),
                runRow('wecom-cli todo list --page-count 20'),
                h('p', { style: { margin: '0.35rem 0 0' } }, '如果这里报错，请检查企业微信权限或重新 auth init。'),
              ]),
            ]),
          ]),
        ]),
      ])

      const enableCard = h('div', { class: 'wc-card' }, [
        h('div', { class: 'wc-section' }, [
          h('h2', { class: 'wc-section-title' }, '启用插件'),
          h('p', '在 Catrace 左侧「功能插件」列表里打开「企业微信待办」开关。首次启用后的第一次轮询会被当作基线：已有的进行中待办不会弹 Toast，只有基线之后新增或更新的待办才会提醒。'),
        ]),
      ])

      const configCard = h('div', { class: 'wc-card' }, [
        h('div', { class: 'wc-section' }, [
          h('h2', { class: 'wc-section-title' }, '配置项说明'),
          h('ul', { class: 'wc-step-list' }, [
            h('li', [h('strong', 'cliPath：'), '如果 wecom-cli 不在系统 PATH 中，可以填写 wecom-cli.cmd 的完整路径。']),
            h('li', [h('strong', 'pollIntervalSec：'), `轮询间隔，默认 ${DEFAULT_POLL_SEC} 秒，最短 ${MIN_POLL_SEC} 秒。`]),
            h('li', [h('strong', 'cardDurationSec：'), 'Toast 停留秒数，默认 12 秒；设为 0 则常驻不自动消失。']),
            h('li', [h('strong', 'onlyWhenActive：'), '只在电脑处于活跃状态时弹窗，离开/锁屏期间不打扰。']),
            h('li', [h('strong', 'preserveOriginalTitle：'), '首次同步时把原始标题包进正文，方便后续修改后仍能回看原标题。']),
          ]),
        ]),
      ])

      const usageCard = h('div', { class: 'wc-card' }, [
        h('div', { class: 'wc-section' }, [
          h('h2', { class: 'wc-section-title' }, '使用说明'),
          h('ul', { class: 'wc-step-list' }, [
            h('li', '「待办」页会展示当前进行中的待办列表，点击卡片可编辑标题和正文。'),
            h('li', '在 Catrace 里新建或编辑的标题会写回企业微信；图片仅保存在插件本地的 media/ 目录，不会上传到企微服务器。'),
            h('li', '收到新待办时，桌面会弹出 Toast；点「完成」会调用 wecom-cli todo finish 把待办标记完成。'),
            h('li', '点「关闭」只是把 Toast 关掉，不会同步到企业微信。'),
          ]),
        ]),
      ])

      const faqCard = h('div', { class: 'wc-card' }, [
        h('div', { class: 'wc-section' }, [
          h('h2', { class: 'wc-section-title' }, '常见问题'),
          h('div', { class: 'wc-faq' }, [
            h('div', { class: 'wc-faq-q' }, '提示「找不到 wecom-cli」'),
            h('p', { class: 'wc-faq-a' }, '先确认已执行 npm install -g @wecom/cli；如果仍找不到，检查系统 PATH，或在配置里填写 wecom-cli.cmd 的完整路径后重启插件。'),
          ]),
          h('div', { class: 'wc-faq' }, [
            h('div', { class: 'wc-faq-q' }, '有新待办但不弹窗'),
            h('p', { class: 'wc-faq-a' }, '检查插件是否已启用、onlyWhenActive 是否在你离开电脑时过滤了通知、以及企业微信里的待办状态是否为「进行中」。'),
          ]),
          h('div', { class: 'wc-faq' }, [
            h('div', { class: 'wc-faq-q' }, '点「完成」没有反应'),
            h('p', { class: 'wc-faq-a' }, '通常是 wecom-cli 登录会话过期，重新执行 wecom-cli auth init 扫码登录即可。'),
          ]),
        ]),
      ])

      const privacyCard = h('div', { class: 'wc-card' }, [
        h('div', { class: 'wc-privacy' }, [
          svg('M12 2a4 4 0 0 0-4 4v2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4zm-2 6V6a2 2 0 1 1 4 0v2h-4z', 14),
          h('span', '隐私说明：本插件不保存任何企业微信 Secret 或密码，完全依赖本机 wecom-cli 的登录会话；图片附件也仅保存在本机。'),
        ]),
      ])

      return h('div', { class: 'wc-tab-panel' }, [introCard, prereqCard, enableCard, configCard, usageCard, faqCard, privacyCard])
    }

    return () => {
      const st = status.value || {}
      const err = st.lastPollError || st.error || ''
      const cliMissing = err.includes('找不到 wecom-cli')
      return h('div', { class: 'wc' }, [
        renderTabs(),
        activeTab.value === 'board'
          ? h('div', { class: 'wc-tab-panel' }, [
              err
                ? h('div', { class: 'wc-banner' }, [
                    err,
                    h('button', {
                      type: 'button',
                      class: 'wc-link',
                      onClick: () => { activeTab.value = 'tutorial' },
                    }, '查看教程'),
                  ])
                : null,
              cliMissing
                ? h('div', { class: 'wc-empty' }, [
                    h('h3', '无法连接企业微信'),
                    h('p', '本插件依赖本机安装的 wecom-cli。请先完成安装与登录，或切到「教程」查看步骤。'),
                    h('button', {
                      type: 'button',
                      class: 'wc-btn wc-btn-primary',
                      onClick: () => { activeTab.value = 'tutorial' },
                    }, '查看教程'),
                  ])
                : [
                    h('div', { class: 'wc-bar' }, [
                      h('div', { class: 'wc-bar-left' }, [
                        h('h1', { class: 'wc-h' }, '进行中'),
                        h('span', { class: 'wc-badge' }, `${board.value.length} 条待办`),
                      ]),
                      h('div', { class: 'wc-bar-right' }, [
                        h('button', {
                          type: 'button',
                          class: 'wc-btn wc-btn-text',
                          disabled: busy.value === 'boot' || busy.value === 'refresh',
                          onClick: () => run('refresh', refreshBoard),
                        }, busy.value === 'refresh' ? '刷新中…' : '刷新'),
                        h('button', {
                          type: 'button',
                          class: 'wc-btn wc-btn-primary',
                          onClick: () => {
                            creating.value = !creating.value
                            if (creating.value) openKey.value = ''
                          },
                        }, creating.value ? '取消新建' : '新建'),
                      ]),
                    ]),
                    h('label', { class: 'wc-setting' }, [
                      h('input', {
                        type: 'checkbox',
                        checked: preserveOriginalTitle.value,
                        onChange: (e) => togglePreserveOriginalTitle(e.target.checked),
                      }),
                      h('span', [
                        h('strong', '首次收到待办时保留原始标题'),
                        h('span', '将原始 title 追加到正文末尾，并用 [原始标题] 标记包裹。'),
                      ]),
                    ]),
                    creating.value ? renderEditor({}, { isNew: true }) : null,
                    loading.value
                      ? [h('div', { class: 'wc-skel' }), h('div', { class: 'wc-skel' }), h('div', { class: 'wc-skel' })]
                      : board.value.length
                        ? board.value.map((item) => renderRow(item))
                        : h('div', { class: 'wc-empty' }, [
                            h('h3', '还没有进行中的待办'),
                            h('p', '从企业微信同步，或在这里新建一条。标题会写回企微，图片只存在本机。'),
                            h('button', { type: 'button', class: 'wc-btn wc-btn-primary', onClick: () => { creating.value = true } }, '新建待办'),
                          ]),
                  ],
            ])
          : renderTutorial(),
      ])
    }
  },
}
