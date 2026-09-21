import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeSoundConfig, resolveSoundPlay } from './sound.mjs'

test('defaults to builtin volume 1', () => {
  assert.deepEqual(normalizeSoundConfig({}), {
    soundMode: 'builtin',
    soundPath: '',
    soundVolume: 1,
  })
})

test('rejects unknown modes and clamps volume', () => {
  assert.equal(normalizeSoundConfig({ soundMode: 'loud', soundVolume: 9 }).soundMode, 'builtin')
  assert.equal(normalizeSoundConfig({ soundVolume: -1 }).soundVolume, 0)
  assert.equal(normalizeSoundConfig({ soundVolume: 0.42 }).soundVolume, 0.42)
})

test('partial updates keep existing sound settings', () => {
  const current = { soundMode: 'custom', soundPath: 'D:\\a.wav', soundVolume: 0.3 }
  assert.deepEqual(normalizeSoundConfig({ autoHideSeconds: 12 }, current), current)
  assert.equal(normalizeSoundConfig({ soundMode: 'muted' }, current).soundMode, 'muted')
  assert.equal(normalizeSoundConfig({ soundMode: 'muted' }, current).soundPath, 'D:\\a.wav')
})

test('muted and empty custom path do not play', () => {
  assert.equal(resolveSoundPlay({ soundMode: 'muted' }, '/plugins/agent-notify'), null)
  assert.equal(resolveSoundPlay({ soundMode: 'custom', soundPath: '  ' }, '/plugins/agent-notify'), null)
})

test('builtin uses packaged wav; custom uses absolute path', () => {
  assert.deepEqual(resolveSoundPlay({ soundMode: 'builtin', soundVolume: 0.5 }, 'C:\\app\\plugins\\agent-notify'), {
    path: 'C:\\app\\plugins\\agent-notify/assets/agent-notify.wav',
    volume: 0.5,
  })
  assert.deepEqual(resolveSoundPlay({
    soundMode: 'custom',
    soundPath: 'D:\\ding.mp3',
    soundVolume: 0.8,
  }, '/plugins/agent-notify'), {
    path: 'D:\\ding.mp3',
    volume: 0.8,
  })
})
