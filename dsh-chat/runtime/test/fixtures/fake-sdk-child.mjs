/**
 * fake-sdk-child.mjs —— 测试用的「假 dsh」子进程。
 *
 * 零依赖，只用 node 内置模块，在 stdin/stdout 上讲同一套换行分隔 JSON-RPC 2.0：
 *   - initialize      → { serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' } }
 *                       provider === 'bad-provider' → JSON-RPC error -32000
 *   - session/prompt  → { messageId: 'msg-<n>' }，随后依次发通知：
 *                       session.status(running) → session/title → assistant/message('收到')
 *                       → turn/end → session.status(idle)
 *   - shutdown        → {} 然后退出 0
 *
 * 环境开关：
 *   FAKE_SDK_NEVER_READY=1 → 什么都不回答（用于超时测试）
 *   FAKE_SDK_BAD_LINE=1    → 先写一行垃圾再正常服务
 *   FAKE_SDK_STDERR=1      → 往 stderr 写一行，验证诊断信息转发
 *
 * argv 里的 --profile <name> / --patch <file> 会被消费掉（只为了覆盖参数拼装），值不解释。
 */
import process from 'node:process'
import { StringDecoder } from 'node:string_decoder'

const NEVER_READY = process.env.FAKE_SDK_NEVER_READY === '1'
const BAD_LINE = process.env.FAKE_SDK_BAD_LINE === '1'
const STDERR_LINE = process.env.FAKE_SDK_STDERR === '1'

// 消费 --profile / --patch 的值，证明调用方真的把参数传进来了。
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i]
  if ((arg === '--profile' || arg === '--patch') && i + 1 < process.argv.length) i += 1
}

const decoder = new StringDecoder('utf8')
let buffer = ''
let promptCount = 0
let seq = 0
let initialized = false
let exiting = false

function writeLine(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function sendResult(id, result) {
  writeLine({ jsonrpc: '2.0', id, result })
}

function sendError(id, code, message) {
  writeLine({ jsonrpc: '2.0', id, error: { code, message } })
}

function sendNotification(method, params) {
  writeLine({ jsonrpc: '2.0', method, params })
}

function nextEvent(type, data) {
  seq += 1
  return { type, seq, time: Date.now(), data }
}

function handleInitialize(id, params) {
  if (params && params.provider === 'bad-provider') {
    sendError(id, -32000, 'no adapter registered for provider "bad-provider"')
    return
  }
  if (params && params.maxTokens !== undefined && !(Number.isSafeInteger(params.maxTokens) && params.maxTokens > 0)) {
    sendError(id, -32602, 'maxTokens must be a positive safe integer')
    return
  }
  if (params && params.reasoningEffort !== undefined && typeof params.reasoningEffort !== 'string') {
    sendError(id, -32602, 'reasoningEffort must be a non-empty string')
    return
  }
  initialized = true
  sendResult(id, { serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' } })
}

function handlePrompt(id, params) {
  if (!initialized) {
    sendError(id, -32002, 'session/prompt called before a successful initialize')
    return
  }
  const sessionId = params && params.sessionId ? params.sessionId : 'session-unknown'
  promptCount += 1
  const messageId = `msg-${promptCount}`
  sendResult(id, { messageId })

  sendNotification('session.status', { sessionId, status: 'running' })
  sendNotification('session.event', {
    sessionId,
    event: nextEvent('session/title', {
      title: 'fake',
      messageSeqs: [promptCount],
      source: { kind: 'fallback' },
    }),
  })
  sendNotification('session.event', {
    sessionId,
    event: nextEvent('assistant/message', {
      messageId,
      content: [{ type: 'text', text: '收到' }],
    }),
  })
  sendNotification('session.event', {
    sessionId,
    event: nextEvent('turn/end', { sessionId, stopReason: 'end_turn' }),
  })
  sendNotification('session.status', { sessionId, status: 'idle' })
}

function handleLine(line) {
  let frame
  try {
    frame = JSON.parse(line)
  } catch {
    return
  }
  if (!frame || typeof frame !== 'object' || typeof frame.method !== 'string') return
  if (NEVER_READY) return

  const { id, method, params } = frame
  if (method === 'initialize') handleInitialize(id, params)
  else if (method === 'session/prompt') handlePrompt(id, params)
  else if (method === 'shutdown') {
    sendResult(id, {})
    exiting = true
    // 让 stdin 里可能残留的字节先落完，再退出。
    setTimeout(() => process.exit(0), 10)
  } else if (id !== undefined) {
    sendError(id, -32601, `method not found: ${method}`)
  }
}

if (BAD_LINE) process.stdout.write('this is definitely not json\n')
if (STDERR_LINE) process.stderr.write('fake-sdk-stderr 诊断信息\n')

process.stdin.on('data', (chunk) => {
  if (exiting) return
  try {
    buffer += decoder.write(chunk)
    let index = buffer.indexOf('\n')
    while (index !== -1) {
      const raw = buffer.slice(0, index)
      buffer = buffer.slice(index + 1)
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
      if (line.trim() !== '') handleLine(line)
      index = buffer.indexOf('\n')
    }
  } catch {
    // 测试夹具不需要因为坏输入崩掉
  }
})

process.stdin.on('end', () => process.exit(0))
process.stdin.on('close', () => process.exit(0))
