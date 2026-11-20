import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import http from 'node:http'
import { createPiHandler, normalizePiEvent } from './pi-webhook.mjs'

const token = 'b'.repeat(64)
export function event(type = 'completed', session = 'shared-process-session-a') {
  return { schemaVersion: 1, id: randomUUID(), type, timestamp: new Date().toISOString(), source: 'pi', session: { id: session, name: '会话 A' }, data: {} }
}
async function fixture(t, onEvent) {
  const handler = createPiHandler({ token, onEvent })
  const server = http.createServer(handler.handle)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  t.after(() => new Promise(resolve => { handler.clear(); server.close(resolve); server.closeAllConnections() }))
  const url = `http://127.0.0.1:${address.port}`
  const post = (payload, headers = {}, route = '/pi') => fetch(`${url}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...headers }, body: typeof payload === 'string' ? payload : JSON.stringify(payload) })
  return { url, post }
}

test('Pi schema maps final errors/cancellation/waiting without remote approval; sessions are namespaced', () => {
  for (const [type, mapped] of Object.entries({ completed: 'Stop', error: 'StopFailure', cancelled: '', waiting: 'Notification', tool_error: 'PostToolUseFailure', started: 'UserPromptSubmit', session_started: 'SessionStart' })) {
    const raw = event(type)
    const entry = normalizePiEvent(raw)
    assert.equal(entry.event, mapped)
    assert.equal(entry.agentId, 'pi')
    assert.equal(entry.sessionId, `pi:${raw.session.id}`)
    assert.equal(entry.raw, raw)
    assert.equal(entry.permission, undefined)
    assert.equal(entry.hookPpid, 0)
  }
  assert.notEqual(normalizePiEvent(event('completed', 'a')).sessionId, normalizePiEvent(event('completed', 'b')).sessionId)
  const raw = event()
  delete raw.session.name
  raw.session.cwd = 'D:/project'
  raw.data.message = 'x'.repeat(3000)
  const entry = normalizePiEvent(raw)
  assert.equal(entry.projectName, 'project')
  assert.equal(entry.message.length, 2000)
  assert.match(entry.sessionTitle, /^Pi · /)
})

test('Pi receiver enforces auth, JSON, routes, schema and rejects browser origin', async (t) => {
  let calls = 0
  const { post, url } = await fixture(t, () => { calls++ })
  assert.equal((await fetch(`${url}/health`)).status, 404)
  assert.equal((await post(event(), {}, '/')).status, 404)
  assert.equal((await post(event(), {}, '/pi?x=1')).status, 404)
  const preflight = await fetch(`${url}/pi`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } })
  assert.equal(preflight.status, 404)
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), null)
  assert.equal((await post(event(), { Authorization: '' })).status, 401)
  assert.equal((await post(event(), { Origin: 'https://evil.example' })).status, 401)
  assert.equal((await post(event(), { 'Content-Type': 'text/plain' })).status, 415)
  assert.equal((await post(event(), {}, '/permission')).status, 404)
  assert.equal((await post('{')).status, 400)
  for (const change of [{ schemaVersion: 2 }, { source: 'other' }, { id: '' }, { session: { id: '' } }, { timestamp: 'bad' }, { type: 'PermissionRequest' }, { data: null }, { data: { message: {} } }]) {
    assert.equal((await post({ ...event(), ...change })).status, 400)
  }
  const response = await post(event())
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null)
  assert.equal(calls, 1)
})

test('Pi receiver bounds request bodies', async (t) => {
  const { post } = await fixture(t, () => assert.fail('oversized body was processed'))
  assert.equal((await post({ ...event(), data: { message: 'x'.repeat(70 * 1024) } })).status, 413)
})

test('Pi receiver deduplicates concurrent retries, not separate sessions or new event IDs', async (t) => {
  let calls = 0
  const { post } = await fixture(t, async () => { calls++; await new Promise((resolve) => setTimeout(resolve, 20)) })
  const payload = event()
  const responses = await Promise.all([post(payload), post(payload), post(payload)])
  assert.ok(responses.every((response) => response.status === 200))
  await post(payload)
  assert.equal(calls, 1)
  await post({ ...payload, session: { id: 'other-session' } })
  await post(event())
  assert.equal(calls, 3)
})

test('Pi concurrency is capped per route and capacity recovers after delivery', async (t) => {
  let release
  const barrier = new Promise(resolve => { release = resolve })
  let entered = 0
  const { post } = await fixture(t, async () => { entered++; await barrier })
  const pending = Array.from({ length: 32 }, () => post(event()))
  try {
    for (let i = 0; entered < 32 && i < 200; i++) await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(entered, 32)
    assert.equal((await post(event())).status, 503)
  } finally { release() }
  assert.ok((await Promise.all(pending)).every(res => res.status === 200))
  assert.equal((await post(event())).status, 200)
})

test('Pi read timeout is route-local and does not shorten shared legacy requests', { timeout: 15000 }, async (t) => {
  const handler = createPiHandler({ token, onEvent: () => assert.fail('incomplete body processed') })
  const server = http.createServer((req, res) => {
    if (req.url === '/pi') return handler.handle(req, res)
    setTimeout(() => res.end('legacy finished'), 5300)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }))
  const port = server.address().port
  const legacy = fetch(`http://127.0.0.1:${port}/permission`).then(res => res.text())
  const status = await new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: '/pi', method: 'POST', headers: {
      'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Content-Length': 100,
    } }, res => { res.resume(); resolve(res.statusCode) })
    req.on('error', reject)
    req.write('{') // Never finish the Pi body; the legacy request must still complete.
  })
  assert.equal(status, 408)
  assert.equal(await legacy, 'legacy finished')
})

test('Pi receiver retries handler failures instead of remembering failed delivery', async (t) => {
  let calls = 0
  const { post } = await fixture(t, () => { if (++calls === 1) throw new Error('failed') })
  const payload = event()
  assert.equal((await post(payload)).status, 500)
  assert.equal((await post(payload)).status, 200)
  assert.equal(calls, 2)
})
