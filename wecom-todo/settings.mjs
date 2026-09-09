/** wecom-todo workbench — unfinished todos, inline edit, local images. */
const vue = globalThis.__CATRACE_VUE__ || {}
const naive = globalThis.__CATRACE_NAIVE__ || {}
const { h, ref, computed, onMounted, onBeforeUnmount } = vue
const { NButton, NInput, useMessage } = naive

if (typeof h !== 'function' || typeof ref !== 'function') {
  throw new Error('Catrace plugin Vue runtime missing (__CATRACE_VUE__.h)')
}
if (!NButton || !NInput || !useMessage) {
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
.wc-settings { width: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: 0.75rem; color: #2e1065; }
.wc-settings *, .wc-settings *::before, .wc-settings *::after { box-sizing: border-box; }
.wc-settings .header-row { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap; }
.wc-settings .header-left { display: flex; align-items: center; gap: 0.5rem; }
.wc-settings .header-title { margin: 0; font-size: 1.125rem; font-weight: 800; color: #1e1b4b; }
.wc-settings .badge {
  display: inline-flex; align-items: center; height: 1.5rem; padding: 0 0.55rem;
  border-radius: 999px; background: #dbeafe; color: #2563eb;
  font-size: 0.75rem; font-weight: 700;
}
.wc-settings .header-actions { display: flex; align-items: center; gap: 0.5rem; }
.wc-settings .card {
  background: #fff; border: 0.0625rem solid #ece8f5; border-radius: 1rem;
  box-shadow: 0 0.0625rem 0.25rem rgba(46, 16, 101, 0.04);
  padding: 1rem 1.15rem 1.05rem;
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
}
.wc-settings .card:hover:not(.is-edit) {
  border-color: #bfdbfe;
  background: #f8fbff;
  box-shadow: 0 0.25rem 0.85rem rgba(37, 99, 235, 0.08);
}
.wc-settings .card.is-edit { border-color: #93c5fd; box-shadow: 0 0.25rem 1.25rem rgba(37, 99, 235, 0.08); }
.wc-settings .edit-top { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; margin-bottom: 0.65rem; }
.wc-settings .edit-kicker { margin: 0; font-size: 0.875rem; font-weight: 700; color: #2563eb; display: inline-flex; align-items: center; gap: 0.35rem; }
.wc-settings .edit-hint { margin: 0; font-size: 0.75rem; color: #60a5fa; }
.wc-settings .box {
  width: 100%; min-height: 5.5rem; padding: 0.85rem 1rem; border: 0.0625rem solid #e8eef7;
  border-radius: 0.75rem; background: #f8fafc; color: #1e1b4b; font: inherit; font-size: 0.9375rem; line-height: 1.55;
  resize: none;
}
.wc-settings .box:focus { outline: none; border-color: #93c5fd; background: #fff; }
.wc-settings .attach-row { display: flex; align-items: center; justify-content: space-between; margin: 0.85rem 0 0.5rem; }
.wc-settings .attach-label { font-size: 0.8125rem; color: #6b7280; }
.wc-settings .link {
  border: 0; background: transparent; color: #2563eb; font: inherit; font-size: 0.8125rem; font-weight: 650; cursor: pointer;
  display: inline-flex; align-items: center; gap: 0.3rem;
}
.wc-settings .thumbs { display: flex; flex-wrap: wrap; gap: 0.65rem; align-items: flex-start; }
.wc-settings .thumb-wrap { position: relative; width: 6.5rem; height: 4.75rem; }
.wc-settings .thumb {
  width: 6.5rem; height: 4.75rem; object-fit: cover; border-radius: 0.65rem; display: block; background: #f3eef8;
}
.wc-settings .ximg {
  position: absolute; top: 0.25rem; right: 0.25rem; width: 1.25rem; height: 1.25rem; border: 0;
  border-radius: 999px; background: rgba(15, 23, 42, 0.55); color: #fff; cursor: pointer; font-size: 0.75rem; line-height: 1;
}
.wc-settings .add-tile {
  width: 6.5rem; height: 4.75rem; border: 0.0625rem dashed #d4d0e3; border-radius: 0.65rem;
  background: #fafafa; color: #9ca3af; cursor: pointer; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 0.2rem; font-size: 0.75rem;
}
.wc-settings .add-tile:hover { border-color: #93c5fd; color: #2563eb; }
.wc-settings .foot { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1rem; padding-top: 0.85rem; border-top: 0.0625rem solid #f3eef8; }
.wc-settings .sum { display: flex; gap: 0.65rem; align-items: flex-start; cursor: pointer; }
.wc-settings .check {
  width: 1.05rem; height: 1.05rem; margin-top: 0.15rem; flex-shrink: 0;
  border: 0.125rem solid #d4d0e3; border-radius: 0.25rem; background: #fff;
}
.wc-settings .sum-body { min-width: 0; flex: 1; }
.wc-settings .sum-title { margin: 0; font-size: 0.9375rem; font-weight: 600; color: #1e1b4b; line-height: 1.5; }
.wc-settings .preview { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 0.65rem 0 0.15rem; }
.wc-settings .preview img {
  width: 6.25rem; height: 4.5rem; object-fit: cover; border-radius: 0.5rem; background: #f3eef8;
}
.wc-settings .meta { display: flex; align-items: center; gap: 0.75rem; margin-top: 0.45rem; font-size: 0.75rem; color: #9ca3af; }
.wc-settings .meta .pics { color: #2563eb; font-weight: 600; }
.wc-settings .desc { margin: 0; padding: 1.25rem 0.25rem; font-size: 0.8125rem; color: #8b7aab; }
.wc-settings .err { margin: 0; font-size: 0.75rem; color: #b91c1c; }
.wc-settings .field { display: flex; flex-direction: column; gap: 0.35rem; margin-top: 0.65rem; }
.wc-settings .label { font-size: 0.75rem; font-weight: 600; color: #8b7aab; }
.wc-settings .btn {
  appearance: none; -webkit-appearance: none; font: inherit; cursor: pointer;
  height: 2.25rem; padding: 0 1.1rem; border-radius: 999px;
  font-size: 0.8125rem; font-weight: 650; line-height: 1;
}
.wc-settings .btn-ghost {
  background: #fff; color: #374151; border: 0.0625rem solid #e5e7eb;
}
.wc-settings .btn-ghost:hover { background: #f9fafb; border-color: #d1d5db; }
.wc-settings .btn-primary {
  background: #2563eb; color: #fff; border: 0.0625rem solid #2563eb;
}
.wc-settings .btn-primary:hover { background: #1d4ed8; border-color: #1d4ed8; }
.wc-settings .btn-primary:disabled { opacity: 0.6; cursor: default; }
.wc-settings .btn-text {
  background: transparent; border: 0; color: #6b7280; height: 2.25rem; padding: 0 0.75rem; border-radius: 0.5rem;
}
.wc-settings .btn-text:hover { color: #2563eb; background: #eff6ff; }
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
    let saveTimer = null
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
      const list = result && Array.isArray(result.board) ? result.board : result && Array.isArray(result.lastTitles) ? result.lastTitles : []
      board.value = list
      const next = { ...drafts.value }
      for (const item of list) {
        if (!item.key || next[item.key]) continue
        next[item.key] = { title: item.title || '', description: item.description || '' }
      }
      drafts.value = next
    }

    function draftOf(key) {
      if (!drafts.value[key]) drafts.value[key] = { title: '', description: '' }
      return drafts.value[key]
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

    async function persistAndSync({ quiet = true } = {}) {
      const cfg = currentConfig()
      await plugin.config.set(cfg)
      try {
        if (plugin.sidecar?.request) await plugin.sidecar.request('setConfig', cfg)
        if (!quiet) message.success('已保存')
      } catch {
        if (!quiet) message.warning('已保存（启用后 sidecar 生效）')
      }
    }

    function scheduleSave() {
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        saveTimer = null
        persistAndSync().catch((error) => message.error(errorText(error)))
      }, 400)
    }

    async function refreshBoard() {
      if (!plugin.sidecar?.request) {
        status.value = { error: 'sidecar 未运行（请启用插件）' }
        return
      }
      const result = await plugin.sidecar.request('getBoard')
      applyBoard(result)
    }

    async function saveItem(item) {
      await run(`save:${item.key}`, async () => {
        const d = draftOf(item.key)
        const result = await plugin.sidecar.request('saveTodo', {
          key: item.key,
          title: d.title,
          description: d.description,
        })
        applyBoard(result)
        message.success('已写回企业微信')
      })
    }

    function insertRaw(item) {
      const d = draftOf(item.key)
      const extra = d.description && !d.description.includes('@raw_title') ? `${d.description.trim()}\n\n@raw_title` : '@raw_title'
      d.description = extra
      drafts.value = { ...drafts.value, [item.key]: { ...d } }
    }

    async function addPic(item) {
      if (!plugin.dialog?.pickFile && !plugin.dialog?.showOpenDialog) {
        message.warning('当前宿主没有选文件能力')
        return
      }
      const picked = plugin.dialog.showOpenDialog
        ? await plugin.dialog.showOpenDialog({
            title: '选择图片',
            filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
          })
        : await plugin.dialog.pickFile()
      if (!picked) return
      await run(`img:${item.key}`, async () => {
        const result = await plugin.sidecar.request('addImage', { key: item.key, path: picked })
        applyBoard(result)
      })
    }

    async function attachDataUrl(key, dataUrl) {
      const result = await plugin.sidecar.request('addImageBase64', { key, dataUrl })
      applyBoard(result)
    }

    function onPaste(ev) {
      const key = openKey.value
      if (!key) return
      const items = ev.clipboardData && ev.clipboardData.items
      if (!items) return
      for (const it of items) {
        if (it.type && String(it.type).startsWith('image/')) {
          ev.preventDefault()
          const file = it.getAsFile()
          if (!file) return
          const reader = new FileReader()
          reader.onload = () => {
            attachDataUrl(key, String(reader.result || '')).catch((e) => message.error(errorText(e)))
          }
          reader.readAsDataURL(file)
          return
        }
      }
    }

    async function dropPic(item, rel) {
      await run(`rm:${item.key}`, async () => {
        const result = await plugin.sidecar.request('removeImage', { key: item.key, rel })
        applyBoard(result)
      })
    }

    async function coverPic(item, rel) {
      await run(`cover:${item.key}`, async () => {
        const result = await plugin.sidecar.request('setCover', { key: item.key, rel })
        applyBoard(result)
      })
    }

    async function createNew() {
      const title = String(draftTitle.value || '').trim()
      if (!title) {
        message.warning('先写标题')
        return
      }
      await run('create', async () => {
        const result = await plugin.sidecar.request('createTodo', {
          title,
          description: draftDesc.value,
        })
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
        window.dispatchEvent(
          new CustomEvent('catrace:plugin-enabled-changed', { detail: { id: PLUGIN_ID, enabled: val } }),
        )
      } catch (e) {
        enabled.value = previous
        message.error(errorText(e))
      } finally {
        headerLoading.value = false
      }
    }

    onMounted(() => {
      window.addEventListener('paste', onPaste)
      run('boot', async () => {
        loading.value = true
        try {
          const raw = await plugin.config.get()
          if (raw && typeof raw === 'object') {
            if (typeof raw.cliPath === 'string') cliPath.value = raw.cliPath
            pollIntervalSec.value = clamp(raw.pollIntervalSec, MIN_POLL_SEC, MAX_POLL_SEC, DEFAULT_POLL_SEC)
            enabled.value = raw.enabled !== false
          }
          await refreshBoard()
        } finally {
          loading.value = false
        }
      })
    })
    onBeforeUnmount(() => {
      window.removeEventListener('paste', onPaste)
    })

    expose({ headerEnabled, headerLoading, toggleEnabled })

    function iconClock() {
      return h('svg', { width: '12', height: '12', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }, [
        h('circle', { cx: '12', cy: '12', r: '9' }),
        h('path', { d: 'M12 7v5l3 2' }),
      ])
    }
    function iconPic() {
      return h('svg', { width: '12', height: '12', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }, [
        h('rect', { x: '3', y: '5', width: '18', height: '14', rx: '2' }),
        h('circle', { cx: '8.5', cy: '10', r: '1.5' }),
        h('path', { d: 'M21 16l-5-5-4 4-2-2-5 5' }),
      ])
    }

    function renderRow(item) {
      const open = openKey.value === item.key
      const d = draftOf(item.key)
      const imgs = item.images || []
      if (open) {
        return h('div', { class: 'card is-edit' }, [
          h('div', { class: 'edit-top' }, [
            h('p', { class: 'edit-kicker' }, [
              h('svg', { width: '14', height: '14', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }, [
                h('path', { d: 'M12 20h9' }),
                h('path', { d: 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z' }),
              ]),
              '编辑待办事项',
            ]),
            h('p', { class: 'edit-hint' }, '支持直接粘贴图片 (Ctrl+V)'),
          ]),
          h('textarea', {
            class: 'box',
            value: d.title,
            onInput: (e) => {
              d.title = e.target.value
              drafts.value = { ...drafts.value, [item.key]: { ...d } }
            },
          }),
          h('div', { class: 'field' }, [
            h('div', { class: 'attach-row', style: { margin: '0' } }, [
              h('span', { class: 'label' }, '正文 · 可用 @raw_title'),
              h('button', { type: 'button', class: 'link', onClick: () => insertRaw(item) }, '插入 @raw_title'),
            ]),
            h('textarea', {
              class: 'box',
              style: { minHeight: '3.5rem' },
              value: d.description,
              onInput: (e) => {
                d.description = e.target.value
                drafts.value = { ...drafts.value, [item.key]: { ...d } }
              },
            }),
          ]),
          h('div', { class: 'attach-row' }, [
            h('span', { class: 'attach-label' }, `已附加图片 (${imgs.length})`),
            h('button', { type: 'button', class: 'link', onClick: () => addPic(item) }, '☁ 添加图片'),
          ]),
          h('div', { class: 'thumbs' }, [
            ...imgs.map((img) =>
              h('div', { class: 'thumb-wrap' }, [
                img.dataUrl ? h('img', { class: 'thumb', src: img.dataUrl, alt: '' }) : h('div', { class: 'thumb' }),
                h('button', { type: 'button', class: 'ximg', onClick: () => dropPic(item, img.rel) }, '×'),
              ]),
            ),
            h('button', { type: 'button', class: 'add-tile', onClick: () => addPic(item) }, [
              h('span', '+'),
              h('span', '上传/粘贴'),
            ]),
          ]),
          h('div', { class: 'foot' }, [
            h('button', { type: 'button', class: 'btn btn-ghost', onClick: () => { openKey.value = '' } }, '取消'),
            h('button', {
              type: 'button',
              class: 'btn btn-primary',
              disabled: busy.value === `save:${item.key}`,
              onClick: () => saveItem(item),
            }, busy.value === `save:${item.key}` ? '保存中…' : '保存修改'),
          ]),
        ])
      }
      return h('div', {
        class: 'card',
        onClick: () => {
          openKey.value = item.key
        },
      }, [
        h('div', { class: 'sum' }, [
          h('div', { class: 'check' }),
          h('div', { class: 'sum-body' }, [
            h('p', { class: 'sum-title' }, item.title || '未命名待办'),
            imgs.length
              ? h('div', { class: 'preview' }, imgs.filter((x) => x.dataUrl).slice(0, 4).map((img) => h('img', { src: img.dataUrl, alt: '' })))
              : null,
            h('div', { class: 'meta' }, [
              iconClock(),
              h('span', item.create_time || ''),
              iconPic(),
              h('span', { class: imgs.length ? 'pics' : '' }, imgs.length ? `${imgs.length} 张图片` : '无图片'),
            ]),
          ]),
        ]),
      ])
    }

    return () => {
      const st = status.value || {}
      const err = st.lastPollError || st.error || ''
      return h('div', { class: 'wc-settings' }, [
        h('div', { class: 'header-row' }, [
          h('div', { class: 'header-left' }, [
            h('p', { class: 'header-title' }, '进行中'),
            h('span', { class: 'badge' }, `${board.value.length} 条待办`),
          ]),
          h('div', { class: 'header-actions' }, [
            h('button', {
              type: 'button',
              class: 'btn btn-text',
              disabled: busy.value === 'boot' || busy.value === 'refresh',
              onClick: () => run('refresh', refreshBoard),
            }, '刷新'),
            h('button', {
              type: 'button',
              class: 'btn btn-primary',
              onClick: () => {
                creating.value = !creating.value
              },
            }, creating.value ? '取消新建' : '新建'),
          ]),
        ]),
        err ? h('p', { class: 'err' }, err) : null,
        creating.value
          ? h('div', { class: 'card is-edit' }, [
              h('div', { class: 'edit-top' }, [h('p', { class: 'edit-kicker' }, '✎  新建待办')]),
              h('textarea', {
                class: 'box',
                placeholder: '标题',
                value: draftTitle.value,
                onInput: (e) => {
                  draftTitle.value = e.target.value
                },
              }),
              h('div', { class: 'field' }, [
                h('span', { class: 'label' }, '正文'),
                h('textarea', {
                  class: 'box',
                  style: { minHeight: '3.5rem' },
                  value: draftDesc.value,
                  onInput: (e) => {
                    draftDesc.value = e.target.value
                  },
                }),
              ]),
              h('div', { class: 'foot' }, [
                h('button', { type: 'button', class: 'btn btn-ghost', onClick: () => { creating.value = false } }, '取消'),
                h('button', {
                  type: 'button',
                  class: 'btn btn-primary',
                  disabled: busy.value === 'create',
                  onClick: createNew,
                }, busy.value === 'create' ? '保存中…' : '保存修改'),
              ]),
            ])
          : null,
        loading.value
          ? h('p', { class: 'desc' }, '加载中…')
          : board.value.length
            ? board.value.map((item) => renderRow(item))
            : h('p', { class: 'desc' }, '没有进行中的待办。'),
      ])
    }
  },
}
