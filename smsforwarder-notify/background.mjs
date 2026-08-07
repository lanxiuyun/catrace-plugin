/** smsforwarder-notify background — copy OTP to clipboard on action. */
if (!plugin || !plugin.config || !plugin.events || !plugin.log) {
  throw new Error('Catrace plugin API missing (plugin facade)')
}

const PLUGIN_ID = 'smsforwarder-notify'

window.addEventListener('catrace:plugin-event-resolved', (ev) => {
  const detail = ev && ev.detail
  if (!detail || detail.kind !== 'smsforwarder-notify') return

  if (detail.actionId === 'copy-otp') {
    const otp =
      (detail.payload && detail.payload.otp) ||
      (detail.event && detail.event.payload && detail.event.payload.otp) ||
      ''
    if (!otp) {
      plugin.log.warn('copy-otp missing code').catch(() => {})
      return
    }
    if (plugin.clipboard && typeof plugin.clipboard.writeText === 'function') {
      plugin.clipboard
        .writeText(String(otp))
        .then(() => plugin.log.info('otp copied', { len: String(otp).length }))
        .catch((e) => {
          console.warn('[smsforwarder-notify] clipboard write failed', e)
          plugin.log.warn('clipboard write failed', { error: String(e) }).catch(() => {})
        })
    } else {
      plugin.log.warn('plugin.clipboard.writeText unavailable').catch(() => {})
    }
  }
})

await plugin.log.info(`${PLUGIN_ID} background loaded`)
