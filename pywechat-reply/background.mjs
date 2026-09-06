/** pywechat-reply background — log reply outcomes and keep sidecar informed. */
if (!plugin || !plugin.config || !plugin.events || !plugin.log) {
  throw new Error('Catrace plugin API missing (plugin facade)')
}

const PLUGIN_ID = 'pywechat-reply'

window.addEventListener('catrace:plugin-event-resolved', (ev) => {
  const detail = ev && ev.detail
  if (!detail || detail.kind !== PLUGIN_ID) return

  const actionId = detail.actionId
  const eventPayload = detail.payload || {}
  const resolutionPayload = detail.resolutionPayload || {}

  if (actionId === 'reply') {
    const chatName = eventPayload.chatName || ''
    const text = resolutionPayload.text || ''
    plugin.log
      .info('reply requested', {
        chatName,
        textLength: String(text).length,
      })
      .catch(() => {})
    return
  }

  if (actionId === 'dismiss') {
    plugin.log.info('message dismissed', { chatName: eventPayload.chatName || '' }).catch(() => {})
  }
})

plugin.log.info(`${PLUGIN_ID} background loaded`).catch(() => {})
