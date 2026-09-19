import readline from 'node:readline'

const pluginId = process.env.CATRACE_PLUGIN_ID || 'napcat-qq'

const DEFAULT_CONFIG = {
  enabled: true,
  httpBase: 'http://127.0.0.1:3000',
  wsUrl: 'ws://127.0.0.1:3001',
  token: '',
  cardDurationSec: 0,
}

let config = { ...DEFAULT_CONFIG }
let ws = null
let wsTimer = null
let outboxTimer = null
let seq = 0
let lastError = ''
let login = { userId: 0, nickname: '' }
let wsState = 'idle'
const seenIds = new Set()
/** @type {Map<string, { key: string, chatType: string, chatId: string, title: string, messages: object[] }>} */
const sessions = new Map()
const pending = new Map()
const MAX_THREAD = 50

const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`)
const log = (message, data, level = 'info') => send({ v: 1, op: 'log', level, message, data: data || {} })

function respond(requestId, ok, result, error) {
  const message = { v: 1, op: 'response', requestId, ok }
  if (ok) message.result = result ?? null
  else message.error = error || 'request failed'
  send(message)
}

function nextId(prefix) {
  seq += 1
  return `${prefix}${Date.now().toString(36)}${seq}`
}

function authHeaders() {
  const headers = { 'Content-Type': 'application/json' }
  if (config.token) headers.Authorization = `Bearer ${config.token}`
  return headers
}

function isDryRun(chatId) {
  const id = String(chatId || '')
  return id === '10000' || id.toLowerCase() === 'test'
}

function storageCall(op, key, value) {
  const requestId = nextId('st')
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      pending.delete(requestId)
      reject(new Error(`storage ${op} timeout`))
    }, 5000)
    pending.set(requestId, {
      resolve: (v) => {
        clearTimeout(t)
        resolve(v)
      },
      reject: (e) => {
        clearTimeout(t)
        reject(e)
      },
    })
    const payload = { v: 1, op, requestId, key }
    if (op === 'storage.set') payload.value = value
    send(payload)
  })
}

function handleResponse(message) {
  const requestId = message.requestId
  const waiter = requestId && pending.get(requestId)
  if (!waiter) return false
  pending.delete(requestId)
  if (message.ok === false) waiter.reject(new Error(message.error || 'rpc failed'))
  else waiter.resolve(message.result)
  return true
}

function clampInt(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

function applyConfig(input) {
  if (!input || typeof input !== 'object') return
  if (typeof input.httpBase === 'string') config.httpBase = input.httpBase.trim().replace(/\/$/, '')
  if (typeof input.wsUrl === 'string') config.wsUrl = input.wsUrl.trim()
  if (typeof input.token === 'string') config.token = input.token.trim()
  if (typeof input.enabled === 'boolean') config.enabled = input.enabled
  config.cardDurationSec = clampInt(input.cardDurationSec, 0, 600, config.cardDurationSec)
  log('config applied', {
    httpBase: config.httpBase,
    wsUrl: config.wsUrl,
    hasToken: Boolean(config.token),
    cardDurationSec: config.cardDurationSec,
  })
  connectWs()
}

function statusPayload() {
  return {
    wsState,
    lastError: lastError || null,
    login,
    httpBase: config.httpBase,
    wsUrl: config.wsUrl,
    hasToken: Boolean(config.token),
  }
}

async function napcatPost(path, body) {
  const url = `${config.httpBase}${path}`
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body || {}),
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text }
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 160)}`)
  if (json && json.status && json.status !== 'ok') {
    throw new Error(json.message || json.wording || JSON.stringify(json).slice(0, 160))
  }
  return json
}

async function refreshLogin() {
  try {
    const json = await napcatPost('/get_login_info', {})
    const data = json?.data || json || {}
    login = {
      userId: Number(data.user_id || 0),
      nickname: String(data.nickname || ''),
    }
    lastError = ''
    return login
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error)
    throw error
  }
}

function extractText(evt) {
  if (!evt || typeof evt !== 'object') return ''
  const raw = evt.raw_message
  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  const m = evt.message
  if (typeof m === 'string') return m.trim()
  if (Array.isArray(m)) {
    return m
      .map((seg) => {
        if (!seg || typeof seg !== 'object') return ''
        if (seg.type === 'text') return String(seg.data?.text || '')
        if (seg.type) return `[${seg.type}]`
        return ''
      })
      .join('')
      .trim()
  }
  return ''
}

function sessionKey(chatType, chatId) {
  return `${chatType}:${chatId}`
}

function toThreadMsg(evt) {
  const userId = String(evt.user_id || evt.sender?.user_id || '')
  const self =
    evt.post_type === 'message_sent' ||
    (login.userId && Number(userId) === Number(login.userId))
  const sender = evt.sender || {}
  const speaker = self
    ? login.nickname || '我'
    : String(sender.card || sender.nickname || userId || '')
  const text = extractText(evt)
  const messageId = String(evt.message_id || `${userId}:${evt.time || Date.now()}:${text}`)
  return {
    id: messageId,
    speaker,
    text,
    self: !!self,
    time: Number(evt.time || 0) * 1000 || Date.now(),
    userId,
  }
}

function appendMsg(session, msg) {
  if (!msg || !msg.text) return false
  if (session.messages.some((m) => m.id === msg.id)) return false
  session.messages.push(msg)
  if (session.messages.length > MAX_THREAD) {
    session.messages = session.messages.slice(-MAX_THREAD)
  }
  return true
}

function publishThread(session) {
  const last = session.messages[session.messages.length - 1]
  const sticky = config.cardDurationSec <= 0
  send({
    v: 1,
    op: 'publish',
    event: {
      eventType: 'napcat-qq.message',
      kind: 'napcat-qq',
      title: session.title,
      body: last ? last.text : '',
      level: 'info',
      sticky,
      actions: [{ id: 'dismiss', label: '关闭' }],
      payload: {
        chatType: session.chatType,
        chatId: session.chatId,
        senderName: session.title,
        userId: session.chatType === 'private' ? session.chatId : '',
        groupId: session.chatType === 'group' ? session.chatId : '',
        messages: session.messages,
        pluginId,
      },
      dedupeKey: `napcat-qq:${session.key}`,
    },
  })
}

async function loadHistory(chatType, chatId) {
  try {
    const path = chatType === 'group' ? '/get_group_msg_history' : '/get_friend_msg_history'
    const body =
      chatType === 'group'
        ? { group_id: Number(chatId), count: 20 }
        : { user_id: Number(chatId), count: 20 }
    const json = await napcatPost(path, body)
    const list = json?.data?.messages || json?.data || []
    return Array.isArray(list) ? list : []
  } catch (error) {
    log('history failed', { error: String(error), chatType, chatId }, 'warn')
    return []
  }
}

async function ingestEvent(evt) {
  const messageType = evt.message_type === 'group' ? 'group' : 'private'
  const chatId = messageType === 'group' ? String(evt.group_id || '') : String(evt.user_id || '')
  if (!chatId) return
  const sender = evt.sender || {}
  const peerName = String(sender.card || sender.nickname || chatId)
  const title = messageType === 'group' ? `群 ${chatId}` : peerName
  const key = sessionKey(messageType, chatId)
  let session = sessions.get(key)
  if (!session) {
    session = { key, chatType: messageType, chatId, title, messages: [] }
    sessions.set(key, session)
    const hist = await loadHistory(messageType, chatId)
    for (const row of hist) appendMsg(session, toThreadMsg(row))
  }
  if (messageType === 'private' && peerName && peerName !== chatId) session.title = peerName
  appendMsg(session, toThreadMsg(evt))
  publishThread(session)
}

function handleNapcatEvent(raw) {
  const events = Array.isArray(raw) ? raw : [raw]
  for (const evt of events) {
    if (!evt || typeof evt !== 'object') continue
    const post = evt.post_type
    if (
      post === 'message' ||
      post === 'message_sent' ||
      evt.message_type === 'private' ||
      evt.message_type === 'group'
    ) {
      void ingestEvent(evt)
    }
  }
}

function connectWs() {
  if (wsTimer) clearTimeout(wsTimer)
  if (typeof WebSocket !== 'function') {
    wsState = 'no-ws'
    lastError = 'Node 无 WebSocket，请用 Node 22+ 或改用 HTTP 上报'
    log(lastError, {}, 'warn')
    return
  }
  try {
    if (ws) {
      ws.onclose = null
      ws.close()
    }
  } catch {
    /* ignore */
  }
  wsState = 'connecting'
  let url = config.wsUrl
  if (config.token && !/[?&]access_token=/.test(url)) {
    url += (url.includes('?') ? '&' : '?') + `access_token=${encodeURIComponent(config.token)}`
  }
  try {
    ws = new WebSocket(url)
  } catch (error) {
    wsState = 'error'
    lastError = error instanceof Error ? error.message : String(error)
    scheduleWsRetry()
    return
  }
  ws.onopen = () => {
    wsState = 'open'
    lastError = ''
    log('ws open', { url: config.wsUrl })
    refreshLogin().catch((e) => log('get_login_info failed', { error: String(e) }, 'warn'))
  }
  ws.onmessage = (ev) => {
    try {
      handleNapcatEvent(JSON.parse(String(ev.data || '')))
    } catch (error) {
      log('ws parse failed', { error: String(error) }, 'warn')
    }
  }
  ws.onerror = () => {
    lastError = 'ws error'
  }
  ws.onclose = () => {
    wsState = 'closed'
    scheduleWsRetry()
  }
}

function scheduleWsRetry() {
  if (wsTimer) clearTimeout(wsTimer)
  wsTimer = setTimeout(connectWs, 4000)
  wsTimer.unref?.()
}

async function sendQq({ chatType, chatId, text }) {
  const body = String(text || '').trim()
  const id = String(chatId || '')
  if (!body) return { ok: false, error: 'empty' }
  const type = chatType === 'group' ? 'group' : 'private'
  if (!isDryRun(id)) {
    if (type === 'group') {
      await napcatPost('/send_group_msg', { group_id: Number(id), message: body })
    } else {
      await napcatPost('/send_private_msg', { user_id: Number(id), message: body })
    }
  } else {
    log('dry-run send skipped', { chatType: type, chatId: id, textLength: body.length })
  }
  const key = sessionKey(type, id)
  let session = sessions.get(key)
  if (!session) {
    session = {
      key,
      chatType: type,
      chatId: id,
      title: type === 'group' ? `群 ${id}` : id,
      messages: [],
    }
    sessions.set(key, session)
  }
  appendMsg(session, {
    id: `out-${Date.now()}`,
    speaker: login.nickname || '我',
    text: body,
    self: true,
    time: Date.now(),
    userId: String(login.userId || ''),
  })
  publishThread(session)
  return { ok: true, dryRun: isDryRun(id) }
}

async function drainOutbox() {
  try {
    const box = await storageCall('storage.get', 'outbox')
    const list = Array.isArray(box) ? box : []
    if (!list.length) return
    const remain = []
    for (const item of list) {
      try {
        await sendQq(item)
      } catch (error) {
        log('outbox send failed', { error: String(error), item }, 'warn')
        remain.push(item)
      }
    }
    await storageCall('storage.set', 'outbox', remain)
  } catch {
    /* host storage may lag at boot */
  }
}

function handleRequest(message) {
  const requestId = message.requestId || message.id
  if (!requestId) return
  const method = String(message.method || '')
  const params = message.params && typeof message.params === 'object' ? message.params : {}
  try {
    switch (method) {
      case 'getStatus':
        refreshLogin()
          .then(() => respond(requestId, true, statusPayload()))
          .catch(() => respond(requestId, true, statusPayload()))
        break
      case 'setConfig':
        applyConfig(params)
        respond(requestId, true, statusPayload())
        break
      case 'testCard': {
        const key = sessionKey('private', 'test')
        const session = {
          key,
          chatType: 'private',
          chatId: 'test',
          title: '测试好友',
          messages: [
            { id: 't1', speaker: '测试好友', text: '在吗？', self: false, time: Date.now() - 120000 },
            { id: 't2', speaker: '我', text: '在的', self: true, time: Date.now() - 60000 },
            { id: 't3', speaker: '测试好友', text: '这是 NapCat 迷你会话测试，回复不会真发 QQ。', self: false, time: Date.now() },
          ],
        }
        sessions.set(key, session)
        publishThread(session)
        respond(requestId, true, { ok: true })
        break
      }
      default:
        respond(requestId, false, null, `unknown method: ${method}`)
    }
  } catch (error) {
    respond(requestId, false, null, error instanceof Error ? error.message : String(error))
  }
}

function handleResolved(message) {
  if (message.actionId !== 'reply') return
  const payload = message.payload || {}
  const resolution = message.resolutionPayload || {}
  const text = String(resolution.text || '')
  const chatType = resolution.chatType || payload.chatType || 'private'
  const chatId = resolution.chatId || payload.chatId || payload.userId || ''
  sendQq({ chatType, chatId, text }).catch((error) => {
    log('resolved send failed', { error: String(error) }, 'warn')
  })
}

send({ v: 1, op: 'ready' })
log('napcat-qq sidecar ready', { pluginId, pid: process.pid })
connectWs()
outboxTimer = setInterval(() => {
  drainOutbox().catch(() => {})
}, 400)
outboxTimer.unref?.()

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  if (handleResponse(message)) return
  if (message.op === 'shutdown') {
    log('graceful shutdown', {})
    process.exit(0)
  }
  if (message.op === 'config') {
    applyConfig(message.config || message)
    return
  }
  if (message.op === 'request') {
    handleRequest(message)
    return
  }
  if (message.op === 'resolved') handleResolved(message)
})
