import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import readline from 'node:readline'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { installPi } from './pi-config.mjs'

async function freePort() {
  const server = net.createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}
async function until(fn) {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    const value = await fn()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('Timed out waiting for sidecar')
}

test('sidecar Pi end-to-end: multi-session cards, retry IDs, resume/close cleanup, privacy and legacy receiver', { timeout: 20000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'catrace-pi-sidecar-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const runtime = path.join(root, 'runtime')
  await fs.cp(path.dirname(fileURLToPath(import.meta.url)), runtime, { recursive: true, filter: (file) => !file.includes(`${path.sep}cache`) && !file.endsWith('.test.mjs') })
  const agentDir = path.join(root, 'pi-agent')
  const port = await freePort()
  const child = spawn(process.execPath, [path.join(runtime, 'main.mjs')], {
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, CATRACE_AGENT_NOTIFY_PORT: String(port) },
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  })
  t.after(async () => {
    if (child.exitCode !== null) return
    const exited = new Promise((resolve) => child.once('exit', resolve))
    child.stdin.write(`${JSON.stringify({ op: 'shutdown' })}\n`)
    const timer = setTimeout(() => child.kill(), 1000)
    await exited
    clearTimeout(timer)
  })
  const messages = []
  const delayedPublishes = []
  let holdPublishAck = false
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line)
    messages.push(message)
    if (message.op === 'publish' && message.requestId) {
      if (holdPublishAck) delayedPublishes.push(message)
      else child.stdin.write(`${JSON.stringify({ op: 'response', requestId: message.requestId, ok: true, result: { eventId: `host-${message.requestId}` } })}\n`)
    }
  })
  child.stderr.resume()
  async function rpc(method, params = {}) {
    const requestId = randomUUID()
    child.stdin.write(`${JSON.stringify({ op: 'request', requestId, method, params })}\n`)
    return until(() => messages.find((message) => message.op === 'response' && message.requestId === requestId))
  }
  await until(() => messages.find((message) => message.message === 'Pi webhook route ready'))
  const token = (await fs.readFile(path.join(runtime, 'cache', 'pi-webhook.token'), 'utf8')).trim()
  installPi({ dir: agentDir, port, token })
  const status = (await rpc('piStatus')).result
  assert.equal(status.url, `http://127.0.0.1:${port}/pi`)
  assert.equal(status.installed, true)
  assert.equal(messages.filter(message => message.message === 'listening').length, 1)
  const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json()
  assert.ok(health.routes.includes('/pi'))
  const bad = await fetch(`http://127.0.0.1:${port}/pi`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  assert.equal(bad.status, 401)
  assert.equal(bad.headers.get('Access-Control-Allow-Origin'), null)
  const options = await fetch(`http://127.0.0.1:${port}/pi`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } })
  assert.equal(options.status, 404)
  assert.equal(options.headers.get('Access-Control-Allow-Origin'), null)
  assert.equal(status.receiverReady, true)
  assert.equal(JSON.stringify(status).includes(token), false)
  const published = () => messages.filter((message) => message.op === 'publish')
  async function post(type, id = 'a', eventId = randomUUID()) {
    const payload = { schemaVersion: 1, source: 'pi', id: eventId, type, timestamp: new Date().toISOString(), session: { id, name: `Session ${id}`, navigation: { kind: 'web', url: `http://127.0.0.1:30141/?session=${encodeURIComponent(id)}` } }, data: {} }
    const response = await fetch(`http://127.0.0.1:${port}/pi`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) })
    assert.equal(response.status, 200)
    await new Promise((resolve) => setTimeout(resolve, 30))
    return payload
  }
  const completed = await post('completed')
  await post('completed', 'a', completed.id)
  assert.equal(published().length, 1)
  assert.equal(published()[0].event.payload.entry.event, 'Stop')
  assert.equal(published()[0].event.payload.entry.cwd, '')
  assert.equal(published()[0].event.payload.entry.sessionTitle, 'Pi · Session a')
  assert.equal(published()[0].event.payload.entry.sessionUrl, 'http://127.0.0.1:30141/?session=a')
  await post('waiting', 'b')
  assert.equal(published()[1].event.payload.sessionId, 'pi:b')
  assert.equal(published()[1].event.eventType, 'agent-notify.state')
  assert.equal(published()[1].event.actions.some((action) => action.id.startsWith('allow:')), false)
  await post('resumed', 'b')
  assert.equal(published().length, 2)
  assert.ok(messages.some((message) => message.op === 'resolve' && message.eventId === 'host-publish-2'))
  await post('session_closed', 'a')
  assert.ok(messages.some((message) => message.op === 'resolve' && message.eventId === 'host-publish-1'))
  const beforeCancel = published().length
  await post('cancelled', 'c')
  assert.equal(published().length, beforeCancel)
  await post('waiting', 'c')
  const waitingCard = published().at(-1)
  await post('cancelled', 'c')
  assert.equal(published().length, beforeCancel + 1)
  assert.ok(messages.some((message) => message.op === 'resolve' && message.eventId === `host-${waitingCard.requestId}`))
  const legacy = await fetch(`http://127.0.0.1:${port}/state`, { method: 'POST', body: JSON.stringify({ event: 'Stop', agentId: 'claude', session_id: 'legacy-session' }) })
  assert.equal(legacy.status, 200)
  await until(() => published().some((message) => message.event.payload.entry.agentId === 'claude'))
  const beforePolicyTest = published().length
  await rpc('setConfig', { eventModes: { PostToolUseFailure: 'off', Stop: 'off' } })
  await post('tool_error', 'policy')
  await post('completed', 'policy')
  assert.equal(published().length, beforePolicyTest)
  await rpc('setConfig', { eventModes: { PostToolUseFailure: 'auto' } })
  await post('tool_error', 'policy')
  assert.equal(published().length, beforePolicyTest + 1)
  assert.equal(published().at(-1).event.payload.entry.event, 'PostToolUseFailure')
  holdPublishAck = true
  await post('waiting', 'race')
  await post('resumed', 'race')
  assert.equal(delayedPublishes.length, 1)
  child.stdin.write(`${JSON.stringify({ op: 'response', requestId: delayedPublishes[0].requestId, ok: true, result: { eventId: 'late-host-card' } })}\n`)
  await until(() => messages.some((message) => message.op === 'resolve' && message.eventId === 'late-host-card'))
  assert.equal(JSON.stringify(messages).includes(token), false)
  assert.ok((await rpc('piStatus')).result.lastEventAt)
})
