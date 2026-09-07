/** Dota2 typewriter settings — show card + round interval. */
const vue = globalThis.__CATRACE_VUE__ || {}
const naive = globalThis.__CATRACE_NAIVE__ || {}
const { h, ref, onMounted, onBeforeUnmount } = vue
const { NInput, NSwitch, useMessage } = naive

if (typeof h !== 'function' || typeof ref !== 'function') {
  throw new Error('Catrace plugin Vue runtime missing (__CATRACE_VUE__.h)')
}
if (!NInput || !NSwitch || !useMessage) {
  throw new Error('Catrace plugin naive runtime missing (__CATRACE_NAIVE__)')
}
if (!plugin || !plugin.config) {
  throw new Error('Catrace plugin API missing (plugin facade)')
}

const MIN_MS = 20
const MAX_MS = 60_000
const DEFAULT_MS = 100
const STYLE_ID = 'catrace-plugin-dota2-typewriter-settings-css'
const CSS = `
.d2tw-settings { width: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: 0.75rem; }
.d2tw-settings *, .d2tw-settings *::before, .d2tw-settings *::after { box-sizing: border-box; }
.d2tw-settings .card {
  padding: 1rem 1.25rem; border: 0.0625rem solid #ebe6f2; border-radius: 0.875rem;
  background: #fff; display: flex; flex-direction: column; gap: 0.875rem;
}
.d2tw-settings h2 { margin: 0; font-size: 0.9375rem; font-weight: 600; color: #2e1065; }
.d2tw-settings .desc { margin: 0; font-size: 0.8125rem; line-height: 1.55; color: #6b7280; }
.d2tw-settings .row {
  display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;
}
.d2tw-settings .label { font-size: 0.8125rem; font-weight: 600; color: #4c1d95; }
.d2tw-settings .field { display: flex; flex-direction: column; gap: 0.375rem; min-width: 0; }
.d2tw-settings .hint { margin: 0; font-size: 0.6875rem; color: #9ca3af; line-height: 1.45; }
.d2tw-settings .num { width: 8.5rem; }
.d2tw-settings .unit { font-size: 0.75rem; color: #6b7280; font-weight: 600; }
.d2tw-settings .row-inline { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
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

function portable(cfg) {
  return {
    showCard: cfg.showCard !== false,
    intervalMs: clamp(cfg.intervalMs, MIN_MS, MAX_MS, DEFAULT_MS),
  }
}

export default {
  name: 'Dota2TypewriterSettings',
  setup() {
    ensureStyles()
    const message = useMessage()
    const loading = ref(true)
    const showCard = ref(true)
    const intervalMs = ref(DEFAULT_MS)
    let saveTimer = null

    async function load() {
      loading.value = true
      try {
        const raw = await plugin.config.get()
        const s = portable(raw && typeof raw === 'object' ? raw : {})
        showCard.value = s.showCard
        intervalMs.value = s.intervalMs
      } catch (e) {
        message.error(`加载失败：${e instanceof Error ? e.message : String(e)}`)
      } finally {
        loading.value = false
      }
    }

    async function persist() {
      const cfg = portable({ showCard: showCard.value, intervalMs: intervalMs.value })
      await plugin.config.set(cfg)
      if (plugin.sidecar && typeof plugin.sidecar.request === 'function') {
        try {
          await plugin.sidecar.request('setConfig', cfg)
        } catch {
          /* sidecar may not be up until enabled */
        }
      }
    }

    function scheduleSave() {
      clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        persist().catch((e) => message.error(`保存失败：${e instanceof Error ? e.message : String(e)}`))
      }, 200)
    }

    function onConfigChanged(ev) {
      const id = ev && ev.detail && ev.detail.pluginId
      if (id && id !== 'dota2-typewriter') return
      load()
    }

    onMounted(() => {
      load()
      window.addEventListener('catrace:plugin-config-changed', onConfigChanged)
    })
    onBeforeUnmount(() => {
      window.removeEventListener('catrace:plugin-config-changed', onConfigChanged)
      clearTimeout(saveTimer)
    })

    return () =>
      h('div', { class: 'd2tw-settings' }, [
        h('div', { class: 'card' }, [
          h('h2', '暗黑狂欢打字机'),
          h('p', { class: 'desc' }, '循环往前台打 a→z。间隔是打完一轮 a–z 的总时间，不是每个字母隔这么久。'),
          h('div', { class: 'row' }, [
            h('span', { class: 'label' }, '显示卡片'),
            h(NSwitch, {
              value: showCard.value,
              disabled: loading.value,
              'onUpdate:value': (v) => {
                showCard.value = !!v
                persist().catch((e) => message.error(`保存失败：${e instanceof Error ? e.message : String(e)}`))
              },
            }),
          ]),
          h('div', { class: 'field' }, [
            h('span', { class: 'label' }, '一轮间隔'),
            h('div', { class: 'row-inline' }, [
              h(NInput, {
                class: 'num',
                value: String(intervalMs.value),
                disabled: loading.value,
                'onUpdate:value': (v) => {
                  intervalMs.value = clamp(v, MIN_MS, MAX_MS, DEFAULT_MS)
                  scheduleSave()
                },
              }),
              h('span', { class: 'unit' }, 'ms / 一轮 a–z'),
            ]),
            h('p', { class: 'hint' }, `默认 ${DEFAULT_MS}ms 打完一轮。Windows。`),
          ]),
        ]),
      ])
  },
}
