/** github-notify background — activity heartbeat + open action.
 * Sidecar publishes via stdout (op:publish). Background cannot call
 * plugin.sidecar.request (settings-window only). Activity is written to
 * plugin.storage so settings page can forward it when open; sidecar also
 * receives activity via host config push when settings syncs.
 *
 * Primary gate path: background writes storage key `activity_pulse`.
 * Settings (when open) forwards pulse via sidecar.request('setActivity').
 * When settings closed: onlyWhenActive falls open (publish) after stale pulse —
 * acceptable; idle drop needs settings open OR host-side activity push.
 *
 * Direct path that always works: sidecar op:publish (no request RPC).
 */
if (!plugin || !plugin.config || !plugin.events || !plugin.activity || !plugin.log) {
  throw new Error('Catrace plugin API missing (plugin facade)')
}

const PLUGIN_ID = 'github-notify'
const PULSE_KEY = 'activity_pulse'
const PULSE_EVERY_MS = 5_000

async function writePulse(active) {
  try {
    if (plugin.storage && typeof plugin.storage.set === 'function') {
      await plugin.storage.set(PULSE_KEY, {
        active: !!active,
        at: Date.now(),
      })
    }
  } catch {
    /* ignore */
  }
}

async function tickActivity() {
  let active = false
  try {
    const activity = await plugin.activity.get()
    active = !!(activity && activity.active)
  } catch (e) {
    await plugin.log.warn('plugin.activity.get failed', { error: String(e) })
    return
  }
  await writePulse(active)

  // Best-effort: if host ever exposes sidecar.request outside settings, use it.
  try {
    if (plugin.sidecar && typeof plugin.sidecar.request === 'function') {
      await plugin.sidecar.request('setActivity', { active })
    }
  } catch {
    /* expected outside settings window */
  }
}

let timer = null

function schedule() {
  if (timer) clearInterval(timer)
  timer = setInterval(() => {
    tickActivity().catch(() => {})
  }, PULSE_EVERY_MS)
}

window.addEventListener('catrace:plugin-event-resolved', (ev) => {
  const detail = ev && ev.detail
  if (!detail || detail.kind !== 'github-notify') return
  if (detail.actionId === 'open') {
    const url =
      (detail.payload && (detail.payload.html_url || detail.payload.htmlUrl)) ||
      (detail.event && detail.event.payload && detail.event.payload.html_url)
    if (url && plugin.shell && typeof plugin.shell.openExternal === 'function') {
      plugin.shell.openExternal(url).catch((e) => {
        console.warn('[github-notify] openExternal failed', e)
      })
    }
  }
})

await plugin.log.info(`${PLUGIN_ID} background loaded`)
schedule()
tickActivity().catch(() => {})
