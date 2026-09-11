if (!plugin || !plugin.log) {
  throw new Error('Catrace plugin API missing (plugin facade)')
}

window.addEventListener('catrace:plugin-event-resolved', (ev) => {
  const detail = ev && ev.detail
  if (!detail || detail.kind !== 'napcat-qq') return
  plugin.log
    .info('resolved', {
      actionId: detail.actionId,
      chatId: (detail.payload || {}).chatId,
    })
    .catch(() => {})
})

plugin.log.info('napcat-qq background loaded').catch(() => {})
