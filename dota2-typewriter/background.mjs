/** Persist showCard=false when the sticky card is ended or closed. */
window.addEventListener('catrace:plugin-event-resolved', (ev) => {
  const detail = ev && ev.detail
  if (!detail || detail.kind !== 'dota2-typewriter') return
  const actionId = detail.actionId || ''
  const hide = detail.resolutionKind === 'dismissed' || actionId === 'end' || actionId === 'dismiss'
  if (!hide) return
  Promise.resolve()
    .then(async () => {
      const raw = (await plugin.config.get()) || {}
      if (raw.showCard === false) return
      await plugin.config.set({ ...raw, showCard: false })
    })
    .catch((e) => console.error('[dota2-typewriter] hide card config failed', e))
})
