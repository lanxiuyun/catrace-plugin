/** notify-demo background — interval toast + optional active-only gate. */
if (!plugin || !plugin.config || !plugin.events || !plugin.activity || !plugin.log) {
  throw new Error('Catrace plugin API missing (plugin facade)')
}

const MIN_INTERVAL_SEC = 1
const MAX_INTERVAL_SEC = 24 * 60 * 60
const DEFAULT_INTERVAL_SEC = 30
/** Check due / config every second so interval edits apply immediately. */
const CHECK_EVERY_MS = 1_000

let checkTimer = null
let sentCount = 0
/** epoch ms of last successful publish; 0 = never */
let lastSentAt = 0
/** first load: wait one full interval before auto toast (avoid burst on enable) */
let bootstrapped = false

function clamp(n, min, max, fallback) {
  const v = Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.min(max, Math.max(min, Math.round(v)))
}

function sanitizeConfig(raw) {
  const s = raw && typeof raw === 'object' ? raw : {}
  return {
    enabled: s.enabled !== false,
    intervalSec: clamp(s.intervalSec, MIN_INTERVAL_SEC, MAX_INTERVAL_SEC, DEFAULT_INTERVAL_SEC),
    onlyWhenActive: s.onlyWhenActive !== false && s.onlyWhenActive !== 0,
    title: typeof s.title === 'string' && s.title.trim() ? s.title.trim() : '间隔通知',
    body:
      typeof s.body === 'string' && s.body.trim()
        ? s.body.trim()
        : '间隔通知已触发。',
  }
}

async function loadConfig() {
  const raw = await plugin.config.get()
  return sanitizeConfig(raw || {})
}

async function isActive() {
  try {
    const activity = await plugin.activity.get()
    return !!(activity && activity.active)
  } catch (e) {
    await plugin.log.warn('plugin.activity.get failed', { error: String(e) })
    return false
  }
}

async function publishToast(cfg) {
  sentCount += 1
  lastSentAt = Date.now()
  const next = sentCount
  await plugin.events.publish({
    eventType: 'notify-demo.send',
    kind: 'notify-demo',
    title: cfg.title,
    body: cfg.body.replace(/\{count\}/g, String(next)),
    level: 'info',
    payload: { count: next, intervalSec: cfg.intervalSec },
  })
}

async function tick() {
  const cfg = await loadConfig()
  if (!cfg.enabled) return

  const intervalMs = cfg.intervalSec * 1000
  const now = Date.now()

  if (!bootstrapped) {
    bootstrapped = true
    // anchor without fire — next due after one full interval from now
    if (!lastSentAt) lastSentAt = now
    return
  }

  if (now - lastSentAt < intervalMs) return

  if (cfg.onlyWhenActive) {
    const active = await isActive()
    if (!active) return
  }

  try {
    await publishToast(cfg)
  } catch (e) {
    await plugin.log.error('notify-demo publish failed', { error: String(e) })
  }
}

await plugin.log.info('notify-demo background loaded')
if (checkTimer) clearInterval(checkTimer)
checkTimer = setInterval(() => {
  tick().catch((e) => console.error('[notify-demo] tick failed', e))
}, CHECK_EVERY_MS)
// run once soon so bootstrap anchors quickly
setTimeout(() => {
  tick().catch(() => {})
}, 200)
