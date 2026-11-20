import test from 'node:test'
import assert from 'node:assert/strict'
import { ensurePiNpm } from './pi-package.mjs'

test('npm present permits configuration without downloading or invoking install', async (t) => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('unexpected download'))
  let calls = 0
  assert.equal(await ensurePiNpm({ checkNpm: async () => { calls++; return true } }), undefined)
  assert.equal(calls, 1)
})

test('npm absent fails explicitly without any download fallback', async (t) => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('unexpected download fallback'))
  await assert.rejects(() => ensurePiNpm({ checkNpm: async () => false }), /未检测到可用的 npm.*PATH.*不会下载备用扩展/)
})
