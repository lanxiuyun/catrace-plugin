import test from 'node:test'
import assert from 'node:assert/strict'
import { piSessionUrl, piNavigation } from './pi-navigation.mjs'
import { normalizePiEvent } from './pi-webhook.mjs'

function event(navigation) {
  return { schemaVersion: 1, source: 'pi', id: 'event', type: 'completed', timestamp: new Date().toISOString(), session: { id: 'session', name: '修复登录问题', navigation }, data: {} }
}

test('Pi named sessions use web deep links without PID capture; terminal fallback uses the sender PID', () => {
  const entry = normalizePiEvent(event({ kind: 'web', url: 'http://localhost:30141/?session=session' }))
  assert.equal(entry.sessionTitle, 'Pi · 修复登录问题')
  assert.equal(entry.hookPpid, 0)
  assert.equal(entry.sessionUrl, 'http://localhost:30141/?session=session')
  const terminal = normalizePiEvent(event({ kind: 'terminal', pid: 123 }))
  assert.equal(terminal.hookPpid, 123)
  assert.equal(terminal.sessionUrl, undefined)
  const unnamed = event(undefined)
  delete unnamed.session.name
  assert.equal(normalizePiEvent(unnamed).sessionTitle, 'Pi · 未命名会话')
})

test('Pi navigation rejects unsafe links, wrong-session links and invalid PIDs', () => {
  for (const url of ['file:///tmp/?session=session', 'javascript:alert(1)', 'http://user:secret@host/?session=session', 'http://host/?session=other', 'http://host/?session=session&cwd=bad', 'http://host/?session=session#bad', 'http://host/?session=session&session=other']) {
    assert.throws(() => piNavigation({ kind: 'web', url }, 'session'))
  }
  for (const pid of [0, -1, '1', 1.5, 2147483648]) assert.throws(() => piNavigation({ kind: 'terminal', pid }, 'session'))
  assert.throws(() => piSessionUrl('https://host/'))
  assert.deepEqual(piNavigation(undefined, 'session'), { hookPpid: 0 })
})
