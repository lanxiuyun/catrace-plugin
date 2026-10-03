/**
 * zstd 多帧拆分 / 解压测试。
 *
 * 用 `zlib.zstdCompressSync` 在内存里现场构造多帧缓冲区（和 DSH 真实日志同构），
 * 不依赖任何外部测试夹具文件。
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import zlib from 'node:zlib'

import { decompressZstd, splitZstdFrames } from '../lib/zstd-frames.mjs'

/** 构造一个可跳过帧（magic 0x184D2A50 + 4 字节长度 + 载荷） */
function buildSkippableFrame(payload) {
  const head = Buffer.alloc(8)
  head.writeUInt32LE(0x184d2a50, 0)
  head.writeUInt32LE(payload.length, 4)
  return Buffer.concat([head, payload])
}

/** 断言当前 Node 支持 zstd 解压（Node >= 22.15） */
function requireZstd() {
  assert.equal(
    typeof zlib.zstdDecompressSync,
    'function',
    '当前 Node 不支持 zstd 解压，请使用 Node >= 22.15',
  )
}

test('单个帧：拆分出 1 个普通帧且能原样解压', () => {
  requireZstd()
  const source = Buffer.from('你好，zstd！\n', 'utf8')
  const frame = zlib.zstdCompressSync(source)

  const frames = splitZstdFrames(frame)
  assert.equal(frames.length, 1)
  assert.equal(frames[0].start, 0)
  assert.equal(frames[0].end, frame.length)
  assert.equal(frames[0].skippable, false)
  assert.equal(decompressZstd(frame).toString('utf8'), '你好，zstd！\n')
})

test('多帧拼接：解压结果是各段明文直接拼接（DSH 日志场景）', () => {
  requireZstd()
  const parts = ['第一帧\n', '第二帧的更多内容\n', '第三帧']
  const multi = Buffer.concat(parts.map((part) => zlib.zstdCompressSync(Buffer.from(part, 'utf8'))))

  const frames = splitZstdFrames(multi)
  assert.equal(frames.length, 3)
  // 帧区间必须严丝合缝、互不重叠
  assert.equal(frames[0].start, 0)
  for (let i = 1; i < frames.length; i += 1) {
    assert.equal(frames[i].start, frames[i - 1].end)
  }
  assert.equal(frames[2].end, multi.length)
  assert.equal(decompressZstd(multi).toString('utf8'), parts.join(''))

  // 单独解第一帧只能拿到第一段明文（这正是不能用整体解压的原因）
  const firstOnly = zlib.zstdDecompressSync(multi)
  assert.equal(firstOnly.toString('utf8'), parts[0])
})

test('可跳过帧：识别为 skippable 且不参与解压', () => {
  requireZstd()
  const payload = Buffer.from('{"note":"metadata"}', 'utf8')
  const skippable = buildSkippableFrame(payload)
  const data = Buffer.from('正文\n', 'utf8')
  const buf = Buffer.concat([skippable, zlib.zstdCompressSync(data)])

  const frames = splitZstdFrames(buf)
  assert.equal(frames.length, 2)
  assert.deepEqual(frames[0], { start: 0, end: skippable.length, skippable: true })
  assert.equal(frames[1].skippable, false)
  assert.equal(decompressZstd(buf).toString('utf8'), '正文\n')
})

test('magic 非法时抛出明确错误', () => {
  const bad = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])
  assert.throws(() => splitZstdFrames(bad), /bad zstd magic at 0/)
})

test('尾部被截断：要么抛错要么忽略残尾，绝不挂死', () => {
  requireZstd()
  const frame = zlib.zstdCompressSync(Buffer.from('一段足够长的内容，用来产生真实的数据块。\n', 'utf8'))
  const truncated = frame.subarray(0, frame.length - 2)

  let result = null
  let error = null
  try {
    result = decompressZstd(truncated)
  } catch (err) {
    error = err
  }
  assert.ok(error !== null || result !== null, '必须抛错或给出结果')
  if (result !== null) assert.ok(result.length <= frame.length)
})

test('空缓冲区返回空结果', () => {
  assert.deepEqual(splitZstdFrames(Buffer.alloc(0)), [])
  assert.equal(decompressZstd(Buffer.alloc(0)).length, 0)
})
