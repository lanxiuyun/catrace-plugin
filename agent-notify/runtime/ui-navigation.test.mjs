import test from 'node:test'
import assert from 'node:assert/strict'

test('toast navigation uses shell.openExternal without main-window-only sidecar RPC and retains terminal focus behavior', async (t) => {
  const previous = ['__CATRACE_VUE__', '__CATRACE_NAIVE__', 'plugin'].map(key => [key, globalThis[key]])
  t.after(() => { for (const [key, value] of previous) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value } })
  globalThis.__CATRACE_VUE__ = { h: () => {} }
  globalThis.__CATRACE_NAIVE__ = { NButton: {} }
  const calls = []
  globalThis.plugin = {
    sidecar: { request: async () => { assert.fail('Toast cannot use sidecar.request') } },
    shell: { openExternal: async url => { calls.push(['openExternal', url]) } },
    http: { get: async url => { calls.push(url); return { status: 200, body: '{"ok":true}' } } },
  }
  const card = (await import('../ui.mjs')).default
  const run = async entry => {
    const vm = { event: { payload: { entry } }, gotoBusy: false, failed: false, closed: false, gotoFailedMark() { this.failed = true }, $emit(type) { if (type === 'close') this.closed = true } }
    await card.methods.gotoSession.call(vm)
    assert.equal(vm.gotoBusy, false)
    return vm
  }
  const url = 'http://localhost:30141/?session=a'
  assert.equal((await run({ sessionUrl: url })).closed, true)
  assert.deepEqual(calls.pop(), ['openExternal', url])
  assert.equal((await run({ pidChain: [123, 456] })).closed, true)
  assert.match(calls.pop(), /focus\?pids=123%2C456/)
  assert.equal((await run({})).failed, true)
  for (const unsafe of ['file:///tmp/a', 'javascript:alert(1)', 'http://user:secret@localhost/']) {
    assert.equal((await run({ sessionUrl: unsafe })).failed, true)
  }
  assert.equal(calls.length, 0)
  globalThis.plugin.shell.openExternal = async () => { throw new Error('open external URL: denied') }
  const failed = await run({ sessionUrl: url, pidChain: [123] })
  assert.equal(failed.failed, true)
  assert.equal(failed.closed, false)
  assert.equal(calls.length, 0) // Never focus a web server's terminal after a browser error.
})
