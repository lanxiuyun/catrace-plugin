import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createPiReceiver, normalizePiEvent } from './pi-webhook.mjs'

const token = 'b'.repeat(64)
export function event(type = 'completed', session = 'shared-process-session-a') {
  return { schemaVersion: 1, id: randomUUID(), type, timestamp: new Date().toISOString(), source: 'pi', session: { id: session, name: '会话 A' }, data: {} }
}
async function fixture(t, onEvent) {
  const receiver = createPiReceiver({ token, port: 0, onEvent })
  const address = await receiver.start()
  t.after(() => receiver.close())
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
  assert.equal((await fetch(`${url}/health`)).status, 200)
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

test('Pi receiver retries handler failures instead of remembering failed delivery', async (t) => {
  let calls = 0
  const { post } = await fixture(t, () => { if (++calls === 1) throw new Error('failed') })
  const payload = event()
  assert.equal((await post(payload)).status, 500)
  assert.equal((await post(payload)).status, 200)
  assert.equal(calls, 2)
})
