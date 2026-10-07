/**
 * 会话存储发现 / 读取测试。
 *
 * 用 `fs.mkdtempSync` 搭一个形如真实 dsh home 的目录树：
 * - 两个 workspace slug、三个会话（日志用本模块自带的多帧助手压缩写入）
 * - 其中一个带 projcache，另一个是故意损坏的日志（截断的 zstd）
 * 用 mtime 控制顺序（`fs.utimesSync` 显式设置，避免依赖写入时序精度）。
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

import {
  clearSessionCache,
  findSessionDir,
  latestSession,
  listSessions,
  readSession,
  resolveDshHome,
  scanSessionLogs,
} from '../lib/session-store.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixtures = path.join(here, 'fixtures')

const LOG_NAME = 'session.v4.jsonl.zstd'
const SLUG_A = '--D-workspace-Catrace--'
const SLUG_B = '--D-Users-che-Documents-deepseek-harness-default-workspace--'

/** 把明文按若干块切成多帧 zstd（模拟真实日志的 242 帧结构） */
function compressMultiFrame(text, chunkSize = 256) {
  const data = Buffer.from(text, 'utf8')
  const frames = []
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    frames.push(zlib.zstdCompressSync(data.subarray(offset, offset + chunkSize)))
  }
  if (frames.length === 0) frames.push(zlib.zstdCompressSync(Buffer.alloc(0)))
  return Buffer.concat(frames)
}

/** 写一个会话：创建 <home>/sessions/<slug>/<id>/session.v4.jsonl.zstd */
function writeSession(home, slug, id, text, { chunkSize = 256 } = {}) {
  const dir = path.join(home, 'sessions', slug, id)
  fs.mkdirSync(dir, { recursive: true })
  const logPath = path.join(dir, LOG_NAME)
  const buf = compressMultiFrame(text, chunkSize)
  fs.writeFileSync(logPath, buf)
  return { dir, logPath, bytes: buf.length }
}

/** 以固定 mtime 落盘，保证排序断言稳定 */
function setMtime(file, epochMs) {
  const seconds = epochMs / 1000
  fs.utimesSync(file, seconds, seconds)
}

/** 写 projcache（明文 JSON） */
function writeProjcache(home, raw) {
  const dir = path.join(home, 'storages', 'session_projcache', 'sessions')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${raw.id}.json`), JSON.stringify(raw.body, null, 2), 'utf8')
}

/** 读取 fixtures 里的手写日志 */
function fixtureText(name) {
  return fs.readFileSync(path.join(fixtures, name), 'utf8')
}

// ---- 搭测试用 dsh home ------------------------------------------------------

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-chat-store-'))
const T1 = 1791000000000 // 最早
const T2 = 1791001000000 // 次早
const T3 = 1791002000000 // 最新

const sessionA = writeSession(home, SLUG_A, 'session-aaa-1111', fixtureText('session-a.jsonl'))
const sessionB = writeSession(home, SLUG_B, 'session-bbb-2222', fixtureText('session-b.jsonl'))
// 第三个会话：目录名与内部 session id 不一致，且没有 projcache、没有 session/title
const noTitleLog = [
  JSON.stringify({
    type: 'session',
    version: 4,
    id: 'session-ccc-3333',
    createdAt: 1791000500000,
    cwd: 'D:\\workspace\\Other',
    agentPreset: 'standard',
  }),
  JSON.stringify({
    type: 'user/message',
    seq: 5,
    time: 1791000501000,
    data: {
      content: [{ type: 'text', text: '这是一条没有标题事件、用来验证标题回退链的足够长的用户消息，超过六十个字符的部分应当被截断掉，好让断言更有意义。' }],
      source: { kind: 'user' },
      role: 'user',
      id: 'user-ccc-1',
    },
  }),
].join('\n')
const dirC = path.join(home, 'sessions', SLUG_A, 'dir-with-other-name')
fs.mkdirSync(dirC, { recursive: true })
fs.writeFileSync(path.join(dirC, LOG_NAME), compressMultiFrame(noTitleLog))
// 第四个会话：故意损坏的日志（合法 magic + 截断内容）
const corruptDir = path.join(home, 'sessions', SLUG_B, 'session-corrupt-9999')
fs.mkdirSync(corruptDir, { recursive: true })
const goodFrame = zlib.zstdCompressSync(Buffer.from('一段内容\n'.repeat(50), 'utf8'))
fs.writeFileSync(path.join(corruptDir, LOG_NAME), goodFrame.subarray(0, Math.max(6, goodFrame.length - 5)))
// 第五个会话：连文件都没有的目录（必须被跳过）
fs.mkdirSync(path.join(home, 'sessions', SLUG_A, 'session-empty-dir'), { recursive: true })

setMtime(sessionA.logPath, T1)
setMtime(sessionB.logPath, T2)
setMtime(path.join(dirC, LOG_NAME), T3)
setMtime(path.join(corruptDir, LOG_NAME), T1 + 500000)

writeProjcache(home, {
  id: 'session-aaa-1111',
  body: {
    version: 7,
    record: {
      identity: { formatVersion: 4, createdAt: 1791003000000, cwd: 'D:\\workspace\\Catrace' },
      rows: {
        title: { ver: 1, seq: 2, val: 'projcache 里的标题' },
        titleInput: { ver: 3, seq: 2, val: { first: '首条输入', count: 0, lastSeq: null } },
        costUsage: { ver: 10, seq: 2, val: { provider: 'deepseek', model: 'default' } },
      },
    },
  },
})

after(() => {
  clearSessionCache()
  fs.rmSync(home, { recursive: true, force: true })
})

// ---- resolveDshHome ---------------------------------------------------------

test('resolveDshHome：configured > DSH_HOME > ~/.dsh', () => {
  const env = { DSH_HOME: 'D:\\env-home' }
  assert.equal(resolveDshHome({ configured: '  D:\\cfg  ', env, homedir: 'C:\\Users\\x' }), 'D:\\cfg')
  assert.equal(resolveDshHome({ configured: '', env, homedir: 'C:\\Users\\x' }), 'D:\\env-home')
  assert.equal(resolveDshHome({ configured: '   ', env: {}, homedir: path.join('C:', 'Users', 'x') }),
    path.join('C:', 'Users', 'x', '.dsh'))
  assert.equal(resolveDshHome(), resolveDshHome({ env: process.env }))
})

test('resolveDshHome：configured 为空白或非字符串时不生效', () => {
  assert.equal(resolveDshHome({ configured: 42, env: { DSH_HOME: '/tmp/dsh' } }), '/tmp/dsh')
})

// ---- listSessions ----------------------------------------------------------

test('listSessions：按 mtime 降序，缺文件目录被跳过，缺根目录返回 []', () => {
  const list = listSessions({ dshHome: home })
  assert.deepEqual(list.map((s) => s.id), [
    'dir-with-other-name',
    'session-bbb-2222',
    'session-corrupt-9999',
    'session-aaa-1111',
  ])
  // 损坏会话仍会出现在列表里（列表只读元数据 / 不解压内容），但 readSession 拿不到内容
  assert.ok(!list.some((s) => s.id === 'session-empty-dir'))
  assert.equal(list.find((s) => s.id === 'session-corrupt-9999').title, null)

  const latest = list[0]
  assert.equal(latest.slug, SLUG_A)
  assert.equal(latest.dir, dirC)
  assert.equal(latest.logPath, path.join(dirC, LOG_NAME))
  assert.equal(latest.updatedAt, T3)
  assert.equal(latest.sizeBytes, fs.statSync(latest.logPath).size)
  assert.equal(latest.hasProjcache, false)
  assert.equal(latest.title, null)
  assert.equal(latest.cwd, null)

  const first = list[3]
  assert.equal(first.hasProjcache, true)
  assert.equal(first.title, 'projcache 里的标题')
  assert.equal(first.cwd, 'D:\\workspace\\Catrace')
  assert.equal(first.createdAt, 1791003000000)

  assert.deepEqual(listSessions({ dshHome: path.join(home, 'not-exist') }), [])
  assert.equal(listSessions({ dshHome: home, limit: 1 }).length, 1)
})

test('listSessions：readTitles=false 时不读 projcache', () => {
  const [session] = listSessions({ dshHome: home, limit: 1, readTitles: false })
  assert.equal(session.title, null)
  assert.equal(session.cwd, null)
  assert.equal(session.hasProjcache, false)

  const plain = listSessions({ dshHome: home, readTitles: false }).find((s) => s.id === 'session-aaa-1111')
  assert.equal(plain.title, null)
  assert.equal(plain.updatedAt, T1)
})

test('scanSessionLogs：只认 session.v4.jsonl.zstd', () => {
  const found = scanSessionLogs(home)
  assert.equal(found.length, 4) // a / b / dir-with-other-name / corrupt
  assert.ok(found.every((entry) => entry.logPath.endsWith(LOG_NAME)))
})

// ---- readSession -----------------------------------------------------------

test('readSession：日志里有 session/title 时优先于 projcache 标题', () => {
  // session-aaa 的日志标题是「给 dsh-chat 加上会话镜像」，projcache 标题是「projcache 里的标题」
  assert.equal(readSession({ dshHome: home, id: 'session-aaa-1111' }).title, '给 dsh-chat 加上会话镜像')
})

test('readSession：日志无标题时回退到 projcache 标题', () => {
  const id = 'session-pjc-5555'
  const dir = path.join(home, 'sessions', SLUG_B, id)
  fs.mkdirSync(dir, { recursive: true })
  const pjcLogPath = path.join(dir, LOG_NAME)
  fs.writeFileSync(
    pjcLogPath,
    compressMultiFrame(
      [
        JSON.stringify({ type: 'session', version: 4, id, createdAt: 1791000100000, cwd: 'D:\\from-log' }),
        JSON.stringify({ type: 'user/message', seq: 1, time: 1791000101000, data: { content: [{ type: 'text', text: '只有正文没有标题' }] } }),
      ].join('\n'),
    ),
  )
  writeProjcache(home, {
    id,
    body: {
      version: 7,
      record: {
        identity: { formatVersion: 4, createdAt: 1791000200000, cwd: 'D:\\from-projcache' },
        rows: { title: { ver: 1, seq: 2, val: 'projcache 兜底标题' }, titleInput: { ver: 3, seq: 2, val: { first: null, count: 0, lastSeq: null } } },
      },
    },
  })
  const transcript = readSession({ dshHome: home, id })
  assert.equal(transcript.title, 'projcache 兜底标题')
  assert.equal(transcript.cwd, 'D:\\from-log') // 日志头部 cwd 优先
  assert.equal(transcript.createdAt, 1791000100000)
  // 固定 mtime，避免影响后续 listSessions / latestSession 的排序断言
  setMtime(pjcLogPath, T1 - 200000)
})

test('readSession：多帧日志完整解压成消息列表', () => {
  clearSessionCache()
  const transcript = readSession({ dshHome: home, id: 'session-aaa-1111' })
  assert.equal(transcript.id, 'session-aaa-1111')
  assert.equal(transcript.title, '给 dsh-chat 加上会话镜像')
  assert.equal(transcript.cwd, 'D:\\workspace\\Catrace')
  assert.equal(transcript.messageCount, 5) // 1 user + 2 assistant + 2 tool
  assert.equal(transcript.items.length, 5)
  assert.equal(transcript.items[0].kind, 'user')
  assert.equal(transcript.items[0].text, '帮我看看会话日志的 zstd 多帧怎么拆。')
  assert.equal(transcript.items.filter((item) => item.kind === 'tool').length, 2)
  assert.equal(transcript.hasMore, false)
})

test('readSession：limit 生效并置 hasMore', () => {
  const transcript = readSession({ dshHome: home, id: 'session-bbb-2222', limit: 2 })
  assert.equal(transcript.items.length, 2)
  assert.equal(transcript.messageCount, 8)
  assert.equal(transcript.hasMore, true)
})

test('readSession：多帧日志里的坏行被容忍，其它行照常出现', () => {
  const transcript = readSession({ dshHome: home, id: 'session-bbb-2222' })
  assert.equal(transcript.messageCount, 8)
  // 最后一条是"没有配套 tool/call"的 tool/result（畸形行在它之后）
  assert.equal(transcript.items.at(-1).kind, 'tool')
  assert.equal(transcript.items.at(-1).name, null)
})

test('readSession：标题回退链（日志标题 -> projcache -> 首条用户文本 -> id）', () => {
  // session-b 无 projcache，用日志内的 session/title
  assert.equal(readSession({ dshHome: home, id: 'session-bbb-2222' }).title, '整理三点结论')
  // dir-with-other-name 既无 projcache 也无 session/title -> 首条用户文本前缀（<= 60 字）
  const fallback = readSession({ dshHome: home, id: 'dir-with-other-name' })
  assert.ok(fallback.title.startsWith('这是一条没有标题事件'))
  assert.ok(fallback.title.length <= 60)
  assert.ok(fallback.title.length > 0)
  // 目录名与会话 id 不一致时，也能按日志头部 id 定位
  assert.equal(findSessionDir({ dshHome: home, id: 'session-ccc-3333' }), dirC)
})

test('readSession：损坏日志返回 null 而不是抛错', () => {
  assert.equal(readSession({ dshHome: home, id: 'session-corrupt-9999' }), null)
  assert.equal(readSession({ dshHome: home, id: 'session-empty-dir' }), null)
  assert.equal(readSession({ dshHome: home, id: 'session-not-exist' }), null)
  assert.equal(readSession({ dshHome: home }), null)
  assert.equal(readSession(), null)
})

test('readSession：mtime+size 未变时命中缓存，不再解压', () => {
  clearSessionCache()
  const original = zlib.zstdDecompressSync
  let calls = 0
  zlib.zstdDecompressSync = (...args) => {
    calls += 1
    return original.apply(zlib, args)
  }
  try {
    const first = readSession({ dshHome: home, id: 'session-aaa-1111' })
    const callsAfterFirst = calls
    assert.ok(callsAfterFirst > 1) // 多帧 -> 多次解压
    const second = readSession({ dshHome: home, id: 'session-aaa-1111' })
    assert.equal(calls, callsAfterFirst) // 命中缓存：零新增解压
    assert.deepEqual(second.items, first.items)
  } finally {
    zlib.zstdDecompressSync = original
  }
})

test('readSession：日志内容变化后缓存失效', () => {
  clearSessionCache()
  const dir = path.join(home, 'sessions', SLUG_A, 'session-cache-7777')
  fs.mkdirSync(dir, { recursive: true })
  const logPath = path.join(dir, LOG_NAME)
  const build = (text) =>
    [
      JSON.stringify({ type: 'session', version: 4, id: 'session-cache-7777', createdAt: 1, cwd: 'D:\\x' }),
      JSON.stringify({ type: 'user/message', seq: 1, time: 10, data: { content: [{ type: 'text', text }] } }),
    ].join('\n')
  fs.writeFileSync(logPath, compressMultiFrame(build('旧内容')))
  assert.equal(readSession({ dshHome: home, id: 'session-cache-7777' }).items[0].text, '旧内容')
  fs.writeFileSync(logPath, compressMultiFrame(build('新内容，长度不同')))
  assert.equal(readSession({ dshHome: home, id: 'session-cache-7777' }).items[0].text, '新内容，长度不同')
  // 固定 mtime，避免影响后续 listSessions / latestSession 的排序断言
  setMtime(logPath, T1 - 100000)
})

// ---- findSessionDir / latestSession ---------------------------------------

test('findSessionDir：按目录名优先，找不到返回 null', () => {
  assert.equal(findSessionDir({ dshHome: home, id: 'session-aaa-1111' }),
    path.join(home, 'sessions', SLUG_A, 'session-aaa-1111'))
  assert.equal(findSessionDir({ dshHome: home, id: 'session-bbb-2222' }),
    path.join(home, 'sessions', SLUG_B, 'session-bbb-2222'))
  assert.equal(findSessionDir({ dshHome: home, id: 'nope' }), null)
  assert.equal(findSessionDir({ dshHome: home, id: '' }), null)
  assert.equal(findSessionDir({ dshHome: home }), null)
  // 损坏会话目录仍能被定位（定位只看目录，不解压）
  assert.equal(findSessionDir({ dshHome: home, id: 'session-corrupt-9999' }), corruptDir)
})

test('latestSession：返回更新最勤的一条', () => {
  const latest = latestSession({ dshHome: home })
  assert.equal(latest.id, 'dir-with-other-name')
  assert.equal(latest.updatedAt, T3)
  assert.equal(latestSession({ dshHome: path.join(home, 'nope') }), null)
})
