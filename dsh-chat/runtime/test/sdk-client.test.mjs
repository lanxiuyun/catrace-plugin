/**
 * sdk-client.test.mjs —— 用假 dsh 子进程（fixtures/fake-sdk-child.mjs）驱动 DshSdkClient。
 * 不依赖真实 dsh、不依赖网络；每个用例自己收尾，整体目标 < 10s。
 */
import assert from 'node:assert/strict'
import { spawn as nodeSpawn } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { DshSdkClient } from '../lib/sdk-client.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(HERE, 'fixtures', 'fake-sdk-child.mjs')
const PLUGIN_ROOT = path.resolve(HERE, '..', '..')

/** 通过 CLI 适配器向 dsh 提问时使用的凭据（与插件默认配置一致）。 */
const CREDS = { provider: 'deepseek-account', model: 'deepseek-flash' }

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(predicate, timeout = 3000, interval = 10) {
  const deadline = Date.now() + timeout
  for (;;) {
    if (predicate()) return true
    if (Date.now() > deadline) return false
    await sleep(interval)
  }
}

/**
 * 造一个客户端。
 * 默认注入 spawnFn：无论计划里的 command 是什么，都改成 `node <fixture> <args>`，
 * 这样既覆盖参数拼装，又能注入 FAKE_SDK_* 环境变量。
 */
function makeClient({ env = {}, spawnInject = true, seen = null, ...overrides } = {}) {
  const options = {
    command: process.execPath,
    profile: 'sdk',
    patchFile: 'fake-patch.json',
    cwd: PLUGIN_ROOT,
    env,
    requestTimeoutMs: 5000,
    shutdownTimeoutMs: 1500,
    onLog: () => {},
    ...overrides,
  }
  if (spawnInject) {
    options.spawnFn = (command, args, spawnOptions) => {
      if (seen) seen.push({ command, args, options: spawnOptions })
      return nodeSpawn(process.execPath, [FIXTURE, ...args], spawnOptions)
    }
  }
  return new DshSdkClient(options)
}

/** 把 start() 的拒绝结果取出来，而不是让测试直接失败。 */
function settled(promise) {
  return promise.then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error }),
  )
}

test('start() 完成握手，暴露状态与默认参数', async (t) => {
  const seen = []
  const client = makeClient({ seen })
  t.after(() => client.kill())

  assert.equal(client.started, false)
  assert.equal(client.sessionId, null)
  assert.equal(client.lastError, null)

  const result = await client.start({ ...CREDS, reasoningEffort: 'high', maxTokens: 4096 })
  assert.equal(result.serverInfo.name, 'deepseek-harness-sdk-runtime')
  assert.equal(result.serverInfo.version, '0.0.1')
  assert.equal(client.started, true)
  assert.equal(client.alive, true)
  assert.equal(client.sessionId, null)
  assert.equal(client.lastError, null)

  // 默认参数拼装：--profile sdk --patch <file>
  assert.equal(seen.length, 1)
  assert.deepEqual(seen[0].args, ['--profile', 'sdk', '--patch', 'fake-patch.json'])
  // spawn 选项：stdio 三管道 + windowsHide，且绝不设置 shell
  assert.deepEqual(seen[0].options.stdio, ['pipe', 'pipe', 'pipe'])
  assert.equal(seen[0].options.windowsHide, true)
  assert.equal(seen[0].options.shell, undefined)
})

test('start() 幂等：重复/并发调用只 spawn 一次并返回同一握手结果', async (t) => {
  const seen = []
  const client = makeClient({ seen })
  t.after(() => client.kill())

  const [a, b] = await Promise.all([client.start(CREDS), client.start(CREDS)])
  const c = await client.start(CREDS)
  assert.equal(seen.length, 1)
  assert.deepEqual(a, b)
  assert.deepEqual(a, c)
  assert.equal(a.serverInfo.name, 'deepseek-harness-sdk-runtime')
})

test('start() 参数校验在 spawn 之前拦下非法值', async () => {
  const client = makeClient()
  await assert.rejects(client.start({ model: 'deepseek-flash' }), /provider 必须是非空字符串/)
  await assert.rejects(client.start({ provider: 'deepseek-account' }), /model 必须是非空字符串/)
  await assert.rejects(
    client.start({ ...CREDS, maxTokens: -1 }),
    /maxTokens 必须是正整数/,
  )
  await assert.rejects(client.start({ ...CREDS, reasoningEffort: '  ' }), /reasoningEffort 必须是非空字符串/)
  assert.equal(client.alive, false)
})

test('initialize 的 JSON-RPC 错误保留 code 与 message', async (t) => {
  const client = makeClient()
  t.after(() => client.kill())

  const outcome = await settled(client.start({ provider: 'bad-provider', model: 'deepseek-flash' }))
  assert.equal(outcome.ok, false)
  assert.equal(outcome.error.code, -32000)
  assert.match(outcome.error.message, /no adapter registered for provider "bad-provider"/)
  assert.equal(client.started, false)
  assert.equal(client.lastError, outcome.error)
})

test('握手失败后子进程被收掉，修正配置可以重试成功', async (t) => {
  const seen = []
  const client = makeClient({ seen })
  t.after(() => client.kill())

  const bad = await settled(client.start({ provider: 'bad-provider', model: 'deepseek-flash' }))
  assert.equal(bad.ok, false)
  assert.equal(bad.error.code, -32000)
  assert.equal(client.started, false)
  const cleaned = await waitFor(() => client.alive === false)
  assert.ok(cleaned, '握手失败后应清理掉子进程')

  const ok = await client.start(CREDS)
  assert.equal(ok.serverInfo.name, 'deepseek-harness-sdk-runtime')
  assert.equal(client.started, true)
  assert.equal(seen.length, 2)
  // 重试后的会话必须可用（回归：失败路径的 kill() 不能把会话永久置为「已关闭」）
  const receipt = await client.prompt('重试成功')
  assert.match(receipt.messageId, /^msg-\d+$/)
})

test('prompt() 在 start() 之前被拒绝', async () => {
  const client = makeClient({ spawnInject: false })
  await assert.rejects(client.prompt('你好'), /SDK 会话尚未初始化/)
  assert.equal(client.started, false)
})

test('prompt() 返回 messageId/sessionId，通知按顺序回调且带上会话上下文', async (t) => {
  const timeline = []
  const client = makeClient({
    onSessionEvent: (event, meta) => timeline.push({ kind: 'event', type: event && event.type, event, meta }),
    onStatus: (status) => timeline.push({ kind: 'status', status: status.status, sessionId: status.sessionId }),
  })
  t.after(async () => {
    await client.shutdown()
  })

  await client.start(CREDS)
  const receipt = await client.prompt('你好')

  assert.match(receipt.messageId, /^msg-\d+$/)
  assert.match(receipt.sessionId, /^session-[0-9a-f]{16}$/)
  assert.equal(client.sessionId, receipt.sessionId)

  const gotIdle = await waitFor(() => timeline.some((e) => e.kind === 'status' && e.status === 'idle'))
  assert.ok(gotIdle, `应收到 idle 状态，实际时间线：${JSON.stringify(timeline)}`)

  assert.deepEqual(timeline[0], { kind: 'status', status: 'running', sessionId: receipt.sessionId })
  assert.deepEqual(
    timeline.filter((e) => e.kind === 'event').map((e) => e.type),
    ['session/title', 'assistant/message', 'turn/end'],
  )
  assert.deepEqual(timeline[timeline.length - 1], { kind: 'status', status: 'idle', sessionId: receipt.sessionId })

  const assistant = timeline.find((e) => e.type === 'assistant/message')
  assert.equal(assistant.event.data.content[0].text, '收到')
  assert.equal(assistant.event.data.content[0].type, 'text')
  assert.equal(typeof assistant.event.seq, 'number')
  assert.equal(assistant.meta.sessionId, receipt.sessionId)

  // 每个 session.event 都带着同一个 sessionId
  for (const entry of timeline.filter((e) => e.kind === 'event')) {
    assert.equal(entry.meta.sessionId, receipt.sessionId)
  }
})

test('并发 prompt 串行执行，各自拿到自己的 messageId', async (t) => {
  const client = makeClient()
  t.after(() => client.kill())
  await client.start(CREDS)

  const [first, second] = await Promise.all([client.prompt('第一条'), client.prompt('第二条')])
  assert.equal(first.messageId, 'msg-1', '先入队的提示应先送达')
  assert.equal(second.messageId, 'msg-2')
  assert.notEqual(first.messageId, second.messageId)
  assert.equal(first.sessionId, second.sessionId)
  assert.equal(client.sessionId, first.sessionId)
})

test('stdout 上的垃圾行不影响后续协议处理', async (t) => {
  const logs = []
  const client = makeClient({ env: { FAKE_SDK_BAD_LINE: '1' }, onLog: (entry) => logs.push(entry) })
  t.after(() => client.kill())

  await client.start(CREDS)
  const receipt = await client.prompt('你好')
  assert.match(receipt.messageId, /^msg-\d+$/)
  assert.ok(
    logs.some((entry) => entry.level === 'warn' && /无法解析/.test(entry.message)),
    `应记录一条「无法解析」的 warn：${JSON.stringify(logs)}`,
  )
})

test('stderr 输出被转发为 onLog warn', async (t) => {
  const logs = []
  const client = makeClient({ env: { FAKE_SDK_STDERR: '1' }, onLog: (entry) => logs.push(entry) })
  t.after(() => client.kill())

  await client.start(CREDS)
  const got = await waitFor(() => logs.some((entry) => entry.level === 'warn' && /fake-sdk-stderr/.test(entry.message)))
  assert.ok(got, `stderr 应被转发：${JSON.stringify(logs)}`)
})

test('initialize 超时给出清晰的中文拒绝', async (t) => {
  const client = makeClient({
    env: { FAKE_SDK_NEVER_READY: '1' },
    requestTimeoutMs: 300,
    shutdownTimeoutMs: 300,
  })
  t.after(() => client.kill())

  const outcome = await settled(client.start(CREDS))
  assert.equal(outcome.ok, false)
  assert.match(outcome.error.message, /initialize/)
  assert.match(outcome.error.message, /超时/)
  assert.match(outcome.error.message, /300ms/)
  assert.equal(client.started, false)
  assert.equal(client.lastError, outcome.error)
})

test('shutdown() 幂等，结束后 alive 为 false 且记录退出日志', async (t) => {
  const logs = []
  const client = makeClient({ onLog: (entry) => logs.push(entry) })
  t.after(() => client.kill())

  await client.start(CREDS)
  const receipt = await client.prompt('你好')
  assert.match(receipt.messageId, /^msg-\d+$/)

  await client.shutdown()
  assert.equal(client.alive, false)
  assert.ok(logs.some((entry) => /已退出/.test(entry.message)), `应记录子进程退出：${JSON.stringify(logs)}`)

  // 第二次 shutdown 直接复用缓存，不抛错
  await client.shutdown()
  await client.shutdown()
  assert.equal(client.alive, false)
})

test('shutdown() 以「会话已关闭」拒绝在途请求', async (t) => {
  const client = makeClient({
    env: { FAKE_SDK_NEVER_READY: '1' },
    requestTimeoutMs: 6000,
    shutdownTimeoutMs: 300,
  })
  t.after(() => client.kill())

  const startPromise = settled(client.start(CREDS))
  await sleep(150) // 等 initialize 真的写出去
  await client.shutdown()

  const outcome = await startPromise
  assert.equal(outcome.ok, false)
  assert.match(outcome.error.message, /会话已关闭/)
  assert.equal(client.alive, false)
})

test('kill() 可以重复调用且不会抛异常', async (t) => {
  const client = makeClient()
  t.after(() => client.kill())
  await client.start(CREDS)

  client.kill()
  assert.doesNotThrow(() => client.kill())
  assert.doesNotThrow(() => client.kill())

  const gone = await waitFor(() => client.alive === false)
  assert.ok(gone, 'kill() 之后子进程应退出')
  // 进程已退出后再次 start() 会重新拉起新进程（握手失败留下的缓存已被清掉）
  await assert.rejects(client.prompt('你好'), /会话已关闭/)
})

test('不用注入 spawnFn 时也能通过 command/args 直连子进程', async (t) => {
  const client = makeClient({
    spawnInject: false,
    args: [FIXTURE, '--profile', 'sdk'],
  })
  t.after(() => client.kill())

  const result = await client.start(CREDS)
  assert.equal(result.serverInfo.name, 'deepseek-harness-sdk-runtime')
  const receipt = await client.prompt('你好')
  assert.match(receipt.sessionId, /^session-[0-9a-f]{16}$/)
  await client.shutdown()
  assert.equal(client.alive, false)
})
