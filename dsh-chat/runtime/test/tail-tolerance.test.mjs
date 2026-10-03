/**
 * 回归：DSH 正在写日志时（尾部有半个 zstd 帧）必须仍能读出已落盘内容。
 *
 * 这是「小窗镜像正在跑的会话」的核心前提——严格解压会让每一轮轮询都读到 null。
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import zlib from 'node:zlib'

import { decodeZstdDetailed, decompressZstd } from '../lib/zstd-frames.mjs'
import { clearSessionCache, readSession } from '../lib/session-store.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(here, 'fixtures')

/** 逐行切块压缩再拼接，得到 DSH 那种多帧日志。 */
function multiFrame(text, chunkSize = 3) {
  const lines = text.split('\n').filter((l) => l.trim().length > 0)
  const frames = []
  for (let i = 0; i < lines.length; i += chunkSize) {
    frames.push(zlib.zstdCompressSync(Buffer.from(`${lines.slice(i, i + chunkSize).join('\n')}\n`, 'utf8')))
  }
  return Buffer.concat(frames)
}

function writeHome(logBuffer) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-chat-tail-'))
  const dir = join(home, 'sessions', '--D-workspace-Alpha--', 'session-tail')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'session.v4.jsonl.zstd'), logBuffer)
  return home
}

test('多帧日志尾部被截断：容忍模式仍返回已解压内容', () => {
  const text = readFileSync(join(FIXTURES, 'session-a.jsonl'), 'utf8')
  const full = multiFrame(text)
  const clean = decodeZstdDetailed(full, { tolerant: true })
  assert.equal(clean.tailTruncated, false)
  assert.ok(clean.decodedFrames > 1)

  for (const cut of [1, 17, 200]) {
    const damaged = full.subarray(0, full.length - cut)
    const tolerant = decodeZstdDetailed(damaged, { tolerant: true })
    assert.equal(tolerant.tailTruncated, true, `cut=${cut} 应标记尾部未解压`)
    assert.ok(tolerant.decodedFrames > 0)
    assert.ok(tolerant.text.includes('"type":"session"'), `cut=${cut} 应保留已落盘内容`)
    // 严格模式必须仍然报错，别把容错变成默认行为
    assert.throws(() => decompressZstd(damaged), /zstd/)
  }
})

test('readSession：尾部半个帧时照常返回消息，并标记 tailTruncated', () => {
  const text = readFileSync(join(FIXTURES, 'session-a.jsonl'), 'utf8')
  const full = multiFrame(text)
  const home = writeHome(full.subarray(0, full.length - 9))
  try {
    const transcript = readSession({ dshHome: home, id: 'session-tail', limit: 20, maxText: 400 })
    assert.ok(transcript, '截断尾部不应让整个会话读不出来')
    assert.equal(transcript.tailTruncated, true)
    assert.ok(transcript.items.length >= 2, JSON.stringify(transcript.items))
  } finally {
    clearSessionCache()
    rmSync(home, { recursive: true, force: true })
  }
})

test('readSession：完整日志 tailTruncated=false；纯垃圾文件返回 null', () => {
  const text = readFileSync(join(FIXTURES, 'session-a.jsonl'), 'utf8')
  const home = writeHome(multiFrame(text))
  const garbageHome = writeHome(Buffer.from('not a zstd file at all'))
  try {
    const transcript = readSession({ dshHome: home, id: 'session-tail', limit: 20 })
    assert.equal(transcript.tailTruncated, false)

    assert.equal(readSession({ dshHome: garbageHome, id: 'session-tail', limit: 20 }), null)
    assert.equal(readSession({ dshHome: home, id: 'no-such-session' }), null)
  } finally {
    clearSessionCache()
    rmSync(home, { recursive: true, force: true })
    rmSync(garbageHome, { recursive: true, force: true })
  }
})

test('readSession：只有一个未完成帧的日志（刚创建）返回 null 而不是崩溃', () => {
  const oneFrame = zlib.zstdCompressSync(Buffer.from('{"type":"session","version":4,"id":"x"}\n', 'utf8'))
  const home = writeHome(oneFrame.subarray(0, Math.max(1, oneFrame.length - 5)))
  try {
    assert.equal(readSession({ dshHome: home, id: 'session-tail', limit: 20 }), null)
  } finally {
    clearSessionCache()
    rmSync(home, { recursive: true, force: true })
  }
})
