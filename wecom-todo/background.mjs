/** Persist activity pulse; sidecar handles finish on resolved. */
if (!plugin || !plugin.activity || !plugin.log) {
  throw new Error('Catrace plugin API missing (plugin facade)')
}

const PULSE_KEY = 'activity_pulse'

async function writePulse(active) {
  try {
    if (plugin.storage && typeof plugin.storage.set === 'function') {
      await plugin.storage.set(PULSE_KEY, { active: !!active, at: Date.now() })
    }
  } catch {
    /* ignore */
  }
}

async function tickActivity() {
  try {
    const activity = await plugin.activity.get()
    await writePulse(!!(activity && activity.active))
  } catch (e) {
    await plugin.log.warn('plugin.activity.get failed', { error: String(e) })
  }
}

setInterval(() => {
  tickActivity().catch(() => {})
}, 5000)
tickActivity().catch(() => {})

await plugin.log.info('wecom-todo background loaded')
