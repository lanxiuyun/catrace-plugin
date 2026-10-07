/**
 * zstd 多帧拆分与解压。
 *
 * DSH 的会话日志 `<sessionId>/session.v4.jsonl.zstd` 是**多个 zstd 帧首尾相接**的
 * 连续文件（实测单个 2.1MB 的文件里有 242 个帧）。Node 内置的
 * `zlib.zstdDecompressSync` 只解第一帧，所以必须自己按帧边界切开，再逐帧解压后拼接。
 *
 * 本模块只依赖 Node 内置模块，零第三方依赖。
 */

import zlib from 'node:zlib'

/** zstd 普通帧的 magic number（小端 0xFD2FB528） */
const MAGIC = 0xfd2fb528

/** 可跳过帧（skippable frame）magic 的高 28 位：0x184D2A5? */
const SKIPPABLE_MAGIC_MASK = 0xfffffff0
const SKIPPABLE_MAGIC_BASE = 0x184d2a50

/** 解密不支持的 Node 版本提示文案 */
const ZSTD_UNSUPPORTED = '需要 Node >= 22.15 才支持 zstd 解压'

/** 帧头中 dictFlag -> 字典 id 字节数 */
const DICT_ID_SIZES = [0, 1, 2, 4]
/** 帧头中 fcsFlag -> frame content size 字节数 */
const FCS_SIZES = [0, 2, 4, 8]

/**
 * 读取一个帧的内容尺寸字段长度。
 * 单段（singleSegment）且 fcsFlag === 0 时强制 1 字节，否则按 fcsFlag 查表。
 */
function fcsSizeBytes(fcsFlag, singleSegment) {
  if (singleSegment && fcsFlag === 0) return 1
  return FCS_SIZES[fcsFlag]
}

/**
 * 跳过紧跟帧头的数据块区，返回 checksum 之前的位置。
 * 块头 3 字节：bit0 = last，bit1-2 = type，bit3+ = size。
 */
function skipBlocks(buf, pos) {
  let p = pos
  for (;;) {
    if (p + 3 > buf.length) throw new Error(`zstd 块头越界 at ${p}`)
    const header = buf.readUIntLE(p, 3)
    const last = header & 1
    const type = (header >> 1) & 3
    const size = header >>> 3
    p += 3
    if (type === 1) {
      // RLE 块：载荷只有 1 字节
      p += 1
    } else if (type !== 3) {
      // Raw(0) / Compressed(2)：载荷 size 字节；Reserved(3) 无载荷
      p += size
    }
    if (last) break
  }
  return p
}

/**
 * 解析从 `offset` 开始的**一个**帧，返回它在缓冲区里的区间。
 * 帧头坏 / 帧体越界都会抛错（调用方决定是容忍还是上抛）。
 *
 * @param {Buffer} buf
 * @param {number} offset
 * @returns {{start:number,end:number,skippable:boolean}}
 */
function nextFrame(buf, offset) {
  const magic = buf.readUInt32LE(offset)
  if ((magic & SKIPPABLE_MAGIC_MASK) === SKIPPABLE_MAGIC_BASE) {
    // 可跳过帧：magic(4) + size(4) + payload(size)
    if (offset + 8 > buf.length) throw new Error(`zstd 可跳过帧头不完整 at ${offset}`)
    const size = buf.readUInt32LE(offset + 4)
    return { start: offset, end: offset + 8 + size, skippable: true }
  }
  if (magic !== MAGIC) throw new Error(`bad zstd magic at ${offset}`)
  let p = offset + 4
  const fhd = buf.readUInt8(p)
  p += 1
  const fcsFlag = fhd >> 6
  const singleSegment = (fhd >> 5) & 1
  const checksum = (fhd >> 2) & 1
  const dictFlag = fhd & 3
  if (!singleSegment) p += 1 // window descriptor
  p += DICT_ID_SIZES[dictFlag]
  p += fcsSizeBytes(fcsFlag, singleSegment)
  if (p > buf.length) throw new Error(`zstd 帧头越界 at ${offset}`)
  p = skipBlocks(buf, p)
  if (checksum) p += 4
  if (p > buf.length) throw new Error(`zstd 帧越界 at ${offset}`)
  return { start: offset, end: p, skippable: false }
}

/**
 * 把一个"多帧拼接"的 zstd 缓冲区拆分成帧区间列表。
 *
 * @param {Buffer} buf
 * @returns {Array<{start:number,end:number,skippable:boolean}>} 按文件顺序排列，end 为开区间
 */
export function splitZstdFrames(buf) {
  const frames = []
  let offset = 0
  while (offset + 4 <= buf.length) {
    const frame = nextFrame(buf, offset)
    frames.push(frame)
    offset = frame.end
  }
  return frames
}

/**
 * 解压"多帧拼接"的 zstd 缓冲区，返回所有非可跳过帧解压结果拼接后的 Buffer。
 *
 * @param {Buffer} buf
 * @param {{tolerant?:boolean}} [options]
 *   tolerant=false（默认）：任何帧异常都抛错；
 *   tolerant=true：DSH 正在写日志时尾部常留半个帧，此时只解压到最后一个完整帧，
 *                   返回已解压内容并给出 tailTruncated 标记（见 decodeZstdDetailed）。
 * @returns {Buffer}
 */
export function decompressZstd(buf, options = {}) {
  const detailed = decodeZstdDetailed(buf, options)
  if (detailed.error !== null && !detailed.tolerant) throw new Error(detailed.error)
  return detailed.buffer
}

/**
 * 带诊断信息的解压：多帧日志可以边写边读。
 *
 * @param {Buffer} buf
 * @param {{tolerant?:boolean}} [options]
 * @returns {{buffer:Buffer,text:string,frames:number,decodedFrames:number,tailTruncated:boolean,error:string|null,tolerant:boolean}}
 */
export function decodeZstdDetailed(buf, { tolerant = false } = {}) {
  const result = {
    buffer: Buffer.alloc(0),
    text: '',
    frames: 0,
    decodedFrames: 0,
    tailTruncated: false,
    error: null,
    tolerant,
  }
  if (typeof zlib.zstdDecompressSync !== 'function') {
    result.error = ZSTD_UNSUPPORTED
    if (!tolerant) return result
    return result
  }
  const chunks = []
  let offset = 0
  let frames = 0
  let decodedFrames = 0
  while (offset + 4 <= buf.length) {
    let frame
    try {
      frame = nextFrame(buf, offset)
    } catch (error) {
      const message = error?.message ?? String(error)
      // 帧头/帧体越界：正在写入的日志尾部常态。容忍模式下保留已解压内容。
      if (tolerant) {
        result.tailTruncated = true
        result.error = message
        break
      }
      result.error = message
      return result
    }
    frames += 1
    if (!frame.skippable) {
      try {
        chunks.push(zlib.zstdDecompressSync(buf.subarray(frame.start, frame.end)))
        decodedFrames += 1
      } catch (error) {
        const message = `zstd 帧解压失败 [${frame.start},${frame.end})：${error?.message ?? error}`
        if (tolerant) {
          result.tailTruncated = true
          result.error = message
          break
        }
        result.error = message
        return result
      }
    }
    offset = frame.end
  }
  if (offset < buf.length) result.tailTruncated = true
  result.frames = frames
  result.decodedFrames = decodedFrames
  result.buffer = Buffer.concat(chunks)
  result.text = result.buffer.toString('utf8')
  return result
}
