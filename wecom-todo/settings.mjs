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

function previewDesc(item) {
  const raw = String(item && item.description ? item.description : '').trim()
  if (!raw) return ''
  const original = String(item.originalTitle || '')
  return raw.replace(/@raw_title/g, original)
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
    const board = ref([])
    const openKey = ref('')
    const drafts = ref({})
    const creating = ref(false)
    const draftTitle = ref('')
    const draftDesc = ref('')
    const status = ref(null)
    const dragOver = ref(false)
    const headerEnabled = computed(() => enabled.value !== false)

    function currentConfig() {
      return {
        cliPath: String(cliPath.value || '').trim(),
        pollIntervalSec: clamp(pollIntervalSec.value, MIN_POLL_SEC, MAX_POLL_SEC, DEFAULT_POLL_SEC),
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

    function insertRaw(item) {
      const d = draftOf(item.key)
      const cur = String(d.description || '')
      const next = cur.includes('@raw_title') ? cur : (cur.trim() ? `${cur.trim()}\n\n@raw_title` : '@raw_title')
      patchDraft(item.key, { description: next })
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
            h('span', '正文 · @raw_title 会在保存时替换成原文'),
            isNew
              ? null
              : h('button', { type: 'button', class: 'wc-link', onClick: () => insertRaw(item) }, '插入 @raw_title'),
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
            previewDesc(item) ? h('p', { class: 'wc-desc' }, collapseBlankLines(previewDesc(item))) : null,
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

    return () => {
      const st = status.value || {}
      const err = st.lastPollError || st.error || ''
      return h('div', { class: 'wc' }, [
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
        err ? h('div', { class: 'wc-banner' }, err) : null,
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
      ])
    }
  },
}
