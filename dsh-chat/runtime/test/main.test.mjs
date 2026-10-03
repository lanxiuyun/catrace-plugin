/**
 * sidecar 端到端测试：用真实的 runtime/main.mjs 子进程跑一遍 JSON Lines v1 协议。
 *
 * 夹具：临时 DSH_HOME（sessions/<slug>/<id>/session.v4.jsonl.zstd + projcache），
 * 不依赖本机真实 ~/.dsh，也不会真的拉起 dsh。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'

const here = dirname(fileURLToPath(import.meta.url))
const MAIN = join(here, '..', 'main.mjs')
const FIXTURES = join(here, 'fixtures')

/** 把一段文本切成若干帧分别压缩再拼接，模拟 DSH 的追加写日志。 */
function multiFrameZstd(text, chunkCount = 3) {
  const lines = text.split('\n').filter((l) => l.trim().length > 0)
  const size = Math.ceil(lines.length / chunkCount)
  const frames = []
  for (let i = 0; i < lines.length; i += size) {
    const part = `${lines.slice(i, i + size).join('\n')}\n`
    frames.push(zlib.zstdCompressSync(Buffer.from(part, 'utf8')))
  }
  return Buffer.concat(frames)
}

function writeSession(home, slug, id, text, { projcache = null } = {}) {
  const dir = join(home, 'sessions', slug, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'session.v4.jsonl.zstd'), multiFrameZstd(text))
  if (projcache) {
    const cacheDir = join(home, 'storages', 'session_projcache', 'sessions')
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(join(cacheDir, `${id}.json`), JSON.stringify(projcache), 'utf8')
  }
  return dir
}

function projcacheOf(id, title, cwd) {
  return {
    version: 7,
    record: {
      identity: { formatVersion: 4, createdAt: 1700000000000, cwd },
      rows: { title: { ver: 1, seq: 2, val: title } },
    },
  }
}

/** 夹具首行是 session 头；把里面的 id 改成与目录名一致（真实 DSH 日志两者永远相同）。 */
function withSessionId(text, id) {
  const lines = text.split('\n')
  lines[0] = lines[0].replace(/"id"\s*:\s*"[^"]*"/, `"id":"${id}"`)
  return lines.join('\n')
}

function makeHome() {
  const home = mkdtempSync(join(tmpdir(), 'dsh-chat-home-'))
  const fixtureA = withSessionId(readFileSync(join(FIXTURES, 'session-a.jsonl'), 'utf8'), 'session-aaa')
  const fixtureB = withSessionId(readFileSync(join(FIXTURES, 'session-b.jsonl'), 'utf8'), 'session-bbb')
  writeSession(home, '--D-workspace-Alpha--', 'session-aaa', fixtureA, {
    projcache: projcacheOf('session-aaa', '第一个会话', 'D:\\workspace\\Alpha'),
  })
  writeSession(home, '--D-workspace-Beta--', 'session-bbb', fixtureB, {
    projcache: projcacheOf('session-bbb', '第二个会话', 'D:\\workspace\\Beta'),
  })
  // 让 session-bbb 更新更晚（latestSession 应指向它）
  const now = Date.now()
  utimesSync(join(home, 'sessions', '--D-workspace-Alpha--', 'session-aaa', 'session.v4.jsonl.zstd'), new Date(now - 60000), new Date(now - 60000))
  utimesSync(join(home, 'sessions', '--D-workspace-Beta--', 'session-bbb', 'session.v4.jsonl.zstd'), new Date(now), new Date(now))
  return home
}

/** 最小 sidecar 协议客户端。 */
function startSidecar() {
  const child = spawn(process.execPath, [MAIN], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  const ops = []
  const waiters = []
  let buffer = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8')
    for (;;) {
      const index = buffer.indexOf('\n')
      if (index < 0) break
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (!line) continue
      const op = JSON.parse(line)
      ops.push(op)
      for (const waiter of [...waiters]) waiter()
    }
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8')
  })

  async function waitFor(predicate, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const found = ops.find(predicate)
      if (found) return found
      if (Date.now() > deadline) {
        throw new Error(`等待 sidecar 输出超时；已收到 ${JSON.stringify(ops.slice(-6))}；stderr=${stderr.slice(0, 400)}`)
      }
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 50)
        waiters.push(() => {
          clearTimeout(timer)
          resolve()
        })
      })
    }
  }

  let nextId = 0
  async function call(method, params = {}) {
    const requestId = `t${++nextId}`
    child.stdin.write(`${JSON.stringify({ v: 1, requestId, method, params })}\n`)
    return waitFor((op) => op.op === 'response' && op.requestId === requestId)
  }

  return {
    child,
    ops,
    waitFor,
    call,
    send: (obj) => child.stdin.write(`${JSON.stringify(obj)}\n`),
    get stderr() {
      return stderr
    },
  }
}

test('sidecar 协议：状态 / 会话列表 / 转录 / 镜像 / 小窗发布 / 错误路径', async (t) => {
  const home = makeHome()
  const sidecar = startSidecar()
  t.after(() => {
    sidecar.child.kill()
    rmSync(home, { recursive: true, force: true })
  })

  await sidecar.waitFor((op) => op.op === 'ready', 20000)

  sidecar.send({
    op: 'config',
    config: {
      dshHome: home,
      dshCommand: 'dsh-command-that-does-not-exist',
      mirrorLimit: 12,
      pollMs: 1000,
      showTabs: true,
    },
  })
  await sidecar.waitFor((op) => op.op === 'log' && op.message === '配置已更新')

  const status = await sidecar.call('status')
  assert.equal(status.ok, true, JSON.stringify(status))
  assert.equal(status.result.dshHome, home)
  assert.equal(status.result.sessionCount, 2, JSON.stringify(status.result))
  assert.equal(status.result.zstd, true)
  assert.equal(status.result.mirrorSessionId, 'session-bbb', '默认镜像最近活跃会话')

  // 生效配置必须带全部"显示项"键：设置界面以 status.config 为准（存盘缺键时不会显示成 false）
  const effective = status.result.config
  assert.ok(effective && typeof effective === 'object', 'status 必须返回生效配置')
  for (const key of [
    'showRail',
    'showHeader',
    'showTabs',
    'showHeaderIcons',
    'showHeaderMore',
    'showHeaderPanel',
    'showHeaderTitle',
    'showHeaderChips',
    'showComposerStatus',
    'showMessageMeta',
    'showHeaderLabels',
  ]) {
    assert.equal(typeof effective[key], 'boolean', `生效配置缺少布尔键 ${key}`)
  }
  assert.equal(typeof effective.customCss, 'string', '生效配置要带自定义 CSS')
  assert.equal(effective.showTabs, true, '传入的 showTabs=true 必须被保留')
  assert.equal(effective.showRail, false, '未传的显示项应回落到默认（左栏默认隐藏）')
  assert.equal(effective.showHeaderChips, true, 'chips 默认显示')
  // 反代裁剪项与 show* 取反（true = 隐藏）
  const crop = await sidecar.call('guiStatus')
  assert.equal(crop.ok, true, JSON.stringify(crop))
  assert.equal(crop.result.crop.tabs, false, 'showTabs=true ⇒ 不裁剪标签页')
  assert.equal(crop.result.crop.rail, true, 'showRail=false ⇒ 裁剪左栏')

  // 设置页推配置走的是 RPC（宿主的 set_plugin_config 不会推给 sidecar）：
  // 走这条路必须真的改到生效配置与裁剪项，否则就得 disable/enable 插件才生效。
  const pushed = await sidecar.call('applyConfig', {
    config: { dshHome: home, dshCommand: 'dsh-command-that-does-not-exist', showRail: true, showHeader: true },
  })
  assert.equal(pushed.ok, true, JSON.stringify(pushed))
  assert.equal(pushed.result.config.showRail, true, 'applyConfig 后生效配置应立即变化')
  const cropAfter = await sidecar.call('guiStatus')
  assert.equal(cropAfter.result.crop.rail, false, 'showRail=true ⇒ 不再裁剪左栏')
  assert.equal(cropAfter.result.crop.header, false, 'showHeader=true ⇒ 不再整条隐藏顶栏')
  const badPush = await sidecar.call('applyConfig', {})
  assert.equal(badPush.ok, false, 'applyConfig 缺 config 时应报错')

  // class 速查表：设置页要拿它渲染"可改的 class"
  const classes = await sidecar.call('guiClasses')
  assert.equal(classes.ok, true, JSON.stringify(classes))
  assert.ok(Array.isArray(classes.result.flat) && classes.result.flat.length >= 30, '速查表应有 30+ 项')
  assert.ok(Array.isArray(classes.result.groups) && classes.result.groups.length >= 4, '速查表应有分组')
  const sample = classes.result.flat[0]
  assert.ok(sample.selector && sample.desc && sample.group, '速查项要有选择器/说明/分组')

  const list = await sidecar.call('listSessions', { limit: 10 })
  assert.equal(list.ok, true)
  assert.equal(list.result.sessions.length, 2)
  assert.equal(list.result.sessions[0].id, 'session-bbb', '按更新时间倒序')
  assert.equal(list.result.sessions[0].title, '第二个会话', '标题来自 projcache')

  const transcript = await sidecar.call('readSession', {})
  assert.equal(transcript.ok, true, JSON.stringify(transcript))
  assert.equal(transcript.result.session.id, 'session-bbb')
  assert.ok(transcript.result.session.items.length >= 2, JSON.stringify(transcript.result.session.items))

  const pinned = await sidecar.call('setMirror', { sessionId: 'session-aaa' })
  assert.equal(pinned.ok, true)
  assert.equal(pinned.result.pinned, true)
  const pinnedRead = await sidecar.call('readSession', {})
  assert.equal(pinnedRead.result.session.id, 'session-aaa')

  const missing = await sidecar.call('setMirror', { sessionId: 'session-nope' })
  assert.equal(missing.ok, false)
  assert.match(missing.error, /找不到会话/)

  const opened = await sidecar.call('openWindow', {})
  assert.equal(opened.ok, true)
  const published = await sidecar.waitFor((op) => op.op === 'publish')
  assert.equal(published.event.eventType, 'dsh-chat.window')
  assert.equal(published.event.kind, 'dsh-chat')
  assert.equal(published.event.sticky, true)
  assert.equal(published.event.dedupeKey, 'dsh-chat.window')
  assert.equal(published.event.payload.mirrorSessionId, 'session-aaa')

  const empty = await sidecar.call('sendPrompt', { text: '   ' })
  assert.equal(empty.ok, false)
  assert.match(empty.error, /不能为空/)

  const unknown = await sidecar.call('nopeMethod', {})
  assert.equal(unknown.ok, false)
  assert.match(unknown.error, /未知方法/)

  const prompt = await sidecar.call('sendPrompt', { text: '你好' })
  assert.equal(prompt.ok, false, 'dsh 命令不存在时必须失败而不是挂住')
})

test('本机 HTTP 桥：鉴权 / health / 会话 / 镜像 / 错误码', async (t) => {
  const home = makeHome()
  const sidecar = startSidecar()
  t.after(() => {
    sidecar.child.kill()
    rmSync(home, { recursive: true, force: true })
  })

  await sidecar.waitFor((op) => op.op === 'ready', 20000)
  sidecar.send({ op: 'config', config: { dshHome: home, httpPort: 0 } })
  const listening = await sidecar.waitFor(
    (op) => op.op === 'log' && op.message === '本机 HTTP 已就绪',
    20000,
  )
  const port = listening.data.port
  assert.ok(Number.isInteger(port) && port > 0, `端口应已分配：${JSON.stringify(listening)}`)

  // 没有 token：403
  const denied = await fetch(`http://127.0.0.1:${port}/health`)
  assert.equal(denied.status, 403)

  // token 随小窗事件 payload 下发（卡片就是这么拿到的）
  const opened = await sidecar.call('openWindow', {})
  assert.equal(opened.ok, true)
  const published = await sidecar.waitFor((op) => op.op === 'publish')
  const token = published.event.payload.httpToken
  assert.ok(typeof token === 'string' && token.length >= 16)
  assert.equal(published.event.payload.httpPort, port)

  const health = await fetch(`http://127.0.0.1:${port}/health?token=${token}`)
  assert.equal(health.status, 200)
  const healthBody = await health.json()
  assert.equal(healthBody.ok, true)
  assert.ok(healthBody.result.routes.includes('/prompt'))

  const sessionsRes = await fetch(`http://127.0.0.1:${port}/sessions?limit=5`, {
    headers: { 'X-Dsh-Chat-Token': token },
  })
  const sessionsBody = await sessionsRes.json()
  assert.equal(sessionsBody.result.sessions.length, 2)

  const sessionRes = await fetch(`http://127.0.0.1:${port}/session?id=session-aaa&limit=20`, {
    headers: { 'X-Dsh-Chat-Token': token },
  })
  const sessionBody = await sessionRes.json()
  assert.equal(sessionBody.result.session.id, 'session-aaa')
  assert.ok(sessionBody.result.session.items.length >= 2)

  const mirrorRes = await fetch(`http://127.0.0.1:${port}/mirror`, {
    method: 'POST',
    headers: { 'X-Dsh-Chat-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: 'session-aaa' }),
  })
  const mirrorBody = await mirrorRes.json()
  assert.equal(mirrorBody.result.pinned, true)

  const emptyPrompt = await fetch(`http://127.0.0.1:${port}/prompt`, {
    method: 'POST',
    headers: { 'X-Dsh-Chat-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '' }),
  })
  assert.equal(emptyPrompt.status, 400)
  assert.match((await emptyPrompt.json()).error, /不能为空/)

  const notFound = await fetch(`http://127.0.0.1:${port}/nope?token=${token}`)
  assert.equal(notFound.status, 404)

  const wrongMethod = await fetch(`http://127.0.0.1:${port}/prompt?token=${token}`)
  assert.equal(wrongMethod.status, 405)
})

test('sidecar 协议：shutdown 会退出进程', async (t) => {
  const home = makeHome()
  const sidecar = startSidecar()
  t.after(() => {
    sidecar.child.kill()
    rmSync(home, { recursive: true, force: true })
  })
  await sidecar.waitFor((op) => op.op === 'ready', 20000)
  sidecar.send({ op: 'config', config: { dshHome: home } })
  await sidecar.waitFor((op) => op.op === 'log' && op.message === '配置已更新')

  const exitCode = await new Promise((resolve) => {
    sidecar.child.on('exit', (code) => resolve(code))
    sidecar.send({ op: 'shutdown' })
    setTimeout(() => resolve('timeout'), 15000)
  })
  assert.notEqual(exitCode, 'timeout', 'shutdown 后进程应自行退出')
})
