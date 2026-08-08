/** smsforwarder-notify background — copy OTP / body to clipboard on action. */
if (!plugin || !plugin.config || !plugin.events || !plugin.log) {
  throw new Error('Catrace plugin API missing (plugin facade)')
}

const PLUGIN_ID = 'smsforwarder-notify'

function pickOtp(text) {
  const near =
    /(?:验证码|校验码|动态码|动态密码|短信码|登录码|确认码|授权码|安全码|OTP|code)[^\d]{0,12}(\d(?:[\s-]?\d){3,7})/i
  const m = near.exec(text)
  if (m) return m[1].replace(/\D/g, '')
  const all = text.match(/(?<!\d)\d{4,8}(?!\d)/g) || []
  return all.find((x) => x.length === 6) || all[0] || ''
}

async function writeClipboard(text, tag) {
  if (!text) {
    plugin.log.warn(`${tag} empty`).catch(() => {})
    return
  }
  if (plugin.clipboard && typeof plugin.clipboard.writeText === 'function') {
    try {
      await plugin.clipboard.writeText(String(text))
      await plugin.log.info(`${tag} ok`, { len: String(text).length })
    } catch (e) {
      console.warn(`[smsforwarder-notify] clipboard write failed`, e)
      plugin.log.warn('clipboard write failed', { error: String(e) }).catch(() => {})
    }
  } else {
    plugin.log.warn('plugin.clipboard.writeText unavailable').catch(() => {})
  }
}

window.addEventListener('catrace:plugin-event-resolved', (ev) => {
  const detail = ev && ev.detail
  if (!detail || detail.kind !== 'smsforwarder-notify') return

  const event = detail.event || {}
  const pl = detail.payload || event.payload || {}
  const title = pl.title || event.title || ''
  const body = pl.body || event.body || ''
  const text = `${title}\n${body}`

  if (detail.actionId === 'copy-otp') {
    let otp = pl.otp || ''
    if (!otp) otp = pickOtp(text)
    writeClipboard(otp, 'otp copied')
    return
  }

  if (detail.actionId === 'copy-body') {
    const content = String(body || title || '').trim()
    writeClipboard(content, 'body copied')
    return
  }

  if (detail.actionId === 'block-app') {
    blockApp(pl.packageName || '', pl.appName || '').catch((e) => {
      console.warn('[smsforwarder-notify] block-app failed', e)
      plugin.log.warn('block-app failed', { error: String(e) }).catch(() => {})
    })
  }
})

async function blockApp(packageName, appName) {
  const targets = []
  if (packageName) targets.push(String(packageName).trim())
  if (appName) targets.push(String(appName).trim())
  const added = []
  try {
    const cfg =
      plugin.config && typeof plugin.config.get === 'function'
        ? ((await plugin.config.get()) || {})
        : {}
    const list = Array.isArray(cfg.appBlacklist) ? cfg.appBlacklist.slice() : []
    for (const t of targets) {
      if (!t) continue
      const hit = list.some(
        (x) =>
          String(x || '').toLowerCase() === t.toLowerCase() ||
          t.toLowerCase().includes(String(x || '').toLowerCase()),
      )
      if (!hit) {
        list.push(t)
        added.push(t)
      }
    }
    if (!added.length) {
      await plugin.log.info('block-app already blocked').catch(() => {})
      return
    }
    cfg.appBlacklist = list.slice(0, 200)
    if (plugin.config && typeof plugin.config.set === 'function') {
      await plugin.config.set(cfg)
    }
    if (plugin.sidecar && typeof plugin.sidecar.request === 'function') {
      const res = await plugin.sidecar.request('setConfig', cfg)
      if (res && res.ok === false) {
        await plugin.log.warn('block-app sidecar sync failed', { error: res.error }).catch(() => {})
      }
    }
    await plugin.log.info('block-app added', { added }).catch(() => {})
  } catch (e) {
    throw e
  }
}

await plugin.log.info(`${PLUGIN_ID} background loaded`)
