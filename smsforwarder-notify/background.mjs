/** smsforwarder-notify background — copy OTP / body to clipboard on action. */
if (!plugin || !plugin.config || !plugin.events || !plugin.log) {
  throw new Error('Catrace plugin API missing (plugin facade)')
}

const PLUGIN_ID = 'smsforwarder-notify'
const ACTIVITY_KEY = 'activitySnapshot'
const ACTIVITY_POLL_MS = 5000

let activityTimer = null

async function refreshActivitySnapshot() {
  try {
    if (!plugin.activity || typeof plugin.activity.get !== 'function') return
    const snap = await plugin.activity.get()
    const payload = {
      active: Boolean(snap && snap.active),
      at: Date.now(),
    }
    if (plugin.storage && typeof plugin.storage.set === 'function') {
      await plugin.storage.set(ACTIVITY_KEY, payload)
    }
  } catch (e) {
    console.warn('[smsforwarder-notify] activity snapshot failed', e)
    plugin.log?.warn?.('activity snapshot failed', { error: String(e) }).catch(() => {})
  }
}

function startActivityPoller() {
  if (activityTimer) return
  void refreshActivitySnapshot()
  activityTimer = setInterval(refreshActivitySnapshot, ACTIVITY_POLL_MS)
}

function pickOtp(text) {
  const s = String(text || '')
  if (
    !/验证码|校验码|动态码|动态密码|短信码|短信验证|登录码|确认码|授权码|安全码|识别码|提取码|兑换码|OTP|verification\s*code|security\s*code/i.test(
      s,
    )
  ) {
    return ''
  }
  const near =
    /(?:验证码|校验码|动态码|动态密码|短信码|登录码|确认码|授权码|安全码|OTP)[^\d]{0,12}(\d(?:[\s-]?\d){3,7})/i
  const m = near.exec(s)
  if (m) return m[1].replace(/\D/g, '')
  const all = s.match(/(?<!\d)\d{4,8}(?!\d)/g) || []
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
    blockApp(pl.packageName || '', pl.appName || '', pl.title || '').catch((e) => {
      console.warn('[smsforwarder-notify] block-app failed', e)
      plugin.log.warn('block-app failed', { error: String(e) }).catch(() => {})
    })
    return
  }

  if (detail.actionId === 'block-title') {
    blockTitle(pl.packageName || '', pl.appName || '', pl.title || '').catch((e) => {
      console.warn('[smsforwarder-notify] block-title failed', e)
      plugin.log.warn('block-title failed', { error: String(e) }).catch(() => {})
    })
  }
})

// Android lock-screen notifications all carry the SMS package (com.android.mms);
// blocking it would silently kill every lock-screen SMS, so block the sender
// (title) instead of the package when the notification arrived with that label.
const LOCKSCREEN_PACKAGES = new Set(['com.android.mms'])

/** Strip QQ/WeChat unread suffixes so "群名(36条未读)" still matches next time. */
function stripTitleNoise(title) {
  let s = String(title || '').trim()
  s = s.replace(/[（(]\s*\d+\s*条[^）)]*[）)]?\s*$/u, '')
  s = s.replace(/[（(]\s*\d+\s*[）)]\s*$/u, '')
  s = s.replace(/[.…]+$/u, '')
  return s.trim()
}

function newFilterId() {
  return `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

async function readConfig() {
  if (plugin.config && typeof plugin.config.get === 'function') {
    const cfg = await plugin.config.get()
    return cfg && typeof cfg === 'object' ? cfg : {}
  }
  return {}
}

async function writeConfig(cfg) {
  if (plugin.config && typeof plugin.config.set === 'function') {
    await plugin.config.set(cfg)
  }
  if (plugin.sidecar && typeof plugin.sidecar.request === 'function') {
    const res = await plugin.sidecar.request('setConfig', cfg)
    if (res && res.ok === false) {
      await plugin.log.warn('config sidecar sync failed', { error: res.error }).catch(() => {})
    }
  }
}

async function blockTitle(packageName, appName, title) {
  const rawTitle = String(title || '').trim()
  const value = stripTitleNoise(rawTitle) || rawTitle
  if (!value) {
    await plugin.log.warn('block-title missing title').catch(() => {})
    return
  }
  const cfg = await readConfig()
  const list = Array.isArray(cfg.filters) ? cfg.filters.slice() : []
  const appContains = String(appName || '').trim() || String(packageName || '').trim()
  const dup = list.some((f) => {
    if (!f || f.field !== 'title') return false
    const sameVal = String(f.value || '').toLowerCase() === value.toLowerCase()
    const sameApp =
      String(f.appContains || '').toLowerCase() === String(appContains || '').toLowerCase()
    return sameVal && sameApp && (f.match === 'contains' || f.match === 'equals')
  })
  if (dup) {
    await plugin.log.info('block-title already filtered').catch(() => {})
    return
  }
  list.push({
    id: newFilterId(),
    enabled: true,
    field: 'title',
    match: 'contains',
    value,
    appContains,
  })
  cfg.filters = list.slice(0, 50)
  await writeConfig(cfg)
  await plugin.log.info('block-title added', { value, appContains }).catch(() => {})
}

async function blockApp(packageName, appName, title) {
  const pkg = String(packageName || '').trim()
  const isLockscreenSms = pkg && LOCKSCREEN_PACKAGES.has(pkg.toLowerCase())
  const targets = []
  if (!isLockscreenSms && pkg) targets.push(pkg)
  if (!isLockscreenSms && appName) targets.push(String(appName).trim())
  const mmsSender = isLockscreenSms ? String(title || '').trim() : ''
  const added = []
  try {
    const cfg = await readConfig()
    if (isLockscreenSms) {
      if (!mmsSender) {
        await plugin.log.warn('block-app missing mms title').catch(() => {})
        return
      }
      const list = Array.isArray(cfg.mmsTitleBlacklist) ? cfg.mmsTitleBlacklist.slice() : []
      if (!list.some((x) => String(x || '').toLowerCase() === mmsSender.toLowerCase())) {
        list.push(mmsSender)
        added.push(mmsSender)
      }
      cfg.mmsTitleBlacklist = list.slice(0, 200)
    } else {
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
      cfg.appBlacklist = list.slice(0, 200)
    }
    if (!added.length) {
      await plugin.log.info('block-app already blocked').catch(() => {})
      return
    }
    await writeConfig(cfg)
    await plugin.log.info('block-app added', { added }).catch(() => {})
  } catch (e) {
    throw e
  }
}

startActivityPoller()
await plugin.log.info(`${PLUGIN_ID} background loaded`)
