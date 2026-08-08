/** notify-demo settings — interval toast + only-when-active. */
const vue = globalThis.__CATRACE_VUE__ || {}
const naive = globalThis.__CATRACE_NAIVE__ || {}
const { h, ref, onMounted, onBeforeUnmount } = vue
const { NButton, NInput, NSwitch, useMessage } = naive

if (typeof h !== 'function' || typeof ref !== 'function') {
  throw new Error('Catrace plugin Vue runtime missing (__CATRACE_VUE__.h)')
}
if (!NButton || !NInput || !NSwitch || !useMessage) {
  throw new Error('Catrace plugin naive runtime missing (__CATRACE_NAIVE__)')
}
if (!plugin || !plugin.config || !plugin.events) {
  throw new Error('Catrace plugin API missing (plugin facade)')
}

const MIN_INTERVAL_MS = 50
const MAX_INTERVAL_MS = 24 * 60 * 60 * 1000
const DEFAULT_INTERVAL_MS = 30_000

const STYLE_ID = 'catrace-plugin-notify-demo-settings-css'
const CSS = `
.notify-demo-settings {
  width: 100%; box-sizing: border-box;
  display: flex; flex-direction: column; gap: 0.75rem;
}
.notify-demo-settings *, .notify-demo-settings *::before, .notify-demo-settings *::after { box-sizing: border-box; }
.notify-demo-settings .card {
  padding: 1rem 1.25rem;
  border: 0.0625rem solid #e5e7eb;
  border-radius: 0.875rem;
  background: #fff;
  display: flex; flex-direction: column; gap: 0.75rem;
}
.notify-demo-settings h2 { margin: 0; font-size: 0.9375rem; font-weight: 600; color: #111827; }
.notify-demo-settings .desc { margin: 0; font-size: 0.8125rem; line-height: 1.55; color: #6b7280; }
.notify-demo-settings .field { display: flex; flex-direction: column; gap: 0.375rem; min-width: 0; }
.notify-demo-settings .label { font-size: 0.75rem; font-weight: 600; color: #6b7280; }
.notify-demo-settings .hint { margin: 0; font-size: 0.6875rem; color: #9ca3af; line-height: 1.45; }
.notify-demo-settings .row {
  display: flex; align-items: center; justify-content: space-between;
  gap: 0.75rem; flex-wrap: wrap;
}
.notify-demo-settings .row-inline { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.notify-demo-settings .num { width: 8.5rem; }
.notify-demo-settings .unit { font-size: 0.75rem; color: #6b7280; font-weight: 600; }
.notify-demo-settings .switch-pair {
  display: inline-flex; align-items: center; gap: 0.5rem;
  font-size: 0.8125rem; color: #374151; font-weight: 500;
}
.notify-demo-settings .meta { font-size: 0.75rem; color: #9ca3af; }
.notify-demo-settings .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
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
    enabled: cfg.enabled !== false,
    intervalMs: clamp(cfg.intervalMs, MIN_INTERVAL_MS, MAX_INTERVAL_MS, DEFAULT_INTERVAL_MS),
    onlyWhenActive: cfg.onlyWhenActive !== false,
    title: (cfg.title || '').trim() || '间隔通知',
    body: (cfg.body || '').trim() || '间隔通知已触发。',
  }
}

export default {
  name: 'NotifyDemoSettings',
  setup() {
    ensureStyles()
    const message = useMessage()
    const loading = ref(true)
    const saving = ref(false)
    const testing = ref(false)
    const sentCount = ref(0)
    const lastSentAt = ref('')
    const intervalMs = ref(DEFAULT_INTERVAL_MS)
    const onlyWhenActive = ref(true)
    const title = ref('间隔通知')
    const body = ref('这是第 {count} 条间隔通知。')

    let saveTimer = null

    async function load() {
      loading.value = true
      try {
        const raw = await plugin.config.get()
        const s = raw && typeof raw === 'object' ? raw : {}
        let loadedMs = s.intervalMs
        if (loadedMs == null && s.intervalSec != null) loadedMs = Number(s.intervalSec) * 1000
        intervalMs.value = clamp(loadedMs, MIN_INTERVAL_MS, MAX_INTERVAL_MS, DEFAULT_INTERVAL_MS)
        onlyWhenActive.value = s.onlyWhenActive !== false && s.onlyWhenActive !== 0
        title.value = typeof s.title === 'string' && s.title.trim() ? s.title : '间隔通知'
        body.value =
          typeof s.body === 'string' && s.body.trim()
            ? s.body
            : '这是第 {count} 条间隔通知。'
      } catch (e) {
        message.error(`加载失败：${e instanceof Error ? e.message : String(e)}`)
      } finally {
        loading.value = false
      }
    }

    function current() {
      return portable({
        enabled: true,
        intervalMs: intervalMs.value,
        onlyWhenActive: onlyWhenActive.value,
        title: title.value,
        body: body.value,
      })
    }

    async function persist() {
      saving.value = true
      try {
        await plugin.config.set(current())
      } catch (e) {
        message.error(`保存失败：${e instanceof Error ? e.message : String(e)}`)
      } finally {
        saving.value = false
      }
    }

    function scheduleSave() {
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        persist()
      }, 400)
    }

    async function sendNow() {
      if (testing.value) return
      testing.value = true
      const next = sentCount.value + 1
      const cfg = current()
      try {
        await plugin.events.publish({
          eventType: 'notify-demo.send',
          kind: 'notify-demo',
          title: cfg.title,
          body: cfg.body.replace(/\{count\}/g, String(next)),
          level: 'info',
          payload: { count: next, intervalMs: cfg.intervalMs, manual: true },
        })
        sentCount.value = next
        lastSentAt.value = new Date().toLocaleTimeString()
        message.success('通知已发送')
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error)
        message.error(`发送失败：${text}`)
      } finally {
        testing.value = false
      }
    }

    onMounted(() => {
      load()
    })

    onBeforeUnmount?.(() => {
      if (saveTimer) clearTimeout(saveTimer)
    })

    return () =>
      h('div', { class: 'notify-demo-settings' }, [
        h('div', { class: 'card' }, [
          h('h2', '间隔通知'),
          h(
            'p',
            { class: 'desc' },
            '按设定毫秒数自动 Toast。可只在电脑活跃时发送。正文可用 {count} 表示序号。',
          ),
          h('div', { class: 'field' }, [
            h('div', { class: 'label' }, '间隔（毫秒）'),
            h('div', { class: 'row-inline' }, [
              h(NInput, {
                class: 'num',
                size: 'small',
                value: String(intervalMs.value),
                disabled: loading.value,
                'onUpdate:value': (v) => {
                  intervalMs.value = clamp(v, MIN_INTERVAL_MS, MAX_INTERVAL_MS, DEFAULT_INTERVAL_MS)
                  scheduleSave()
                },
              }),
              h('span', { class: 'unit' }, 'ms'),
            ]),
            h('p', { class: 'hint' }, `范围 ${MIN_INTERVAL_MS}–${MAX_INTERVAL_MS} 毫秒`),
          ]),
          h('div', { class: 'row' }, [
            h('div', { class: 'switch-pair' }, [
              h(NSwitch, {
                value: onlyWhenActive.value,
                disabled: loading.value,
                'onUpdate:value': (v) => {
                  onlyWhenActive.value = !!v
                  scheduleSave()
                },
              }),
              '仅活跃时通知',
            ]),
            h('span', { class: 'meta' }, onlyWhenActive.value ? '休息/锁屏时不弹' : '始终按间隔弹'),
          ]),
          h('div', { class: 'field' }, [
            h('div', { class: 'label' }, '标题'),
            h(NInput, {
              size: 'small',
              value: title.value,
              disabled: loading.value,
              placeholder: '间隔通知',
              'onUpdate:value': (v) => {
                title.value = v
                scheduleSave()
              },
            }),
          ]),
          h('div', { class: 'field' }, [
            h('div', { class: 'label' }, '正文'),
            h(NInput, {
              type: 'textarea',
              size: 'small',
              rows: 2,
              value: body.value,
              disabled: loading.value,
              placeholder: '这是第 {count} 条间隔通知。',
              'onUpdate:value': (v) => {
                body.value = v
                scheduleSave()
              },
            }),
          ]),
          h('div', { class: 'actions' }, [
            h(
              NButton,
              {
                type: 'primary',
                size: 'medium',
                loading: testing.value || saving.value,
                disabled: loading.value,
                onClick: sendNow,
              },
              { default: () => '立即发送' },
            ),
            sentCount.value > 0
              ? h('span', { class: 'meta' }, `本页已发 ${sentCount.value} 条 · 上次 ${lastSentAt.value}`)
              : null,
          ]),
        ]),
      ])
  },
}
