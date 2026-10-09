/**
 * sidecar 端到端测试：用真实的 runtime/main.mjs 子进程跑一遍 JSON Lines v1 协议。
 *
 * 夹具：临时 DSH_HOME（sessions/<slug>/<id>/session.v4.jsonl.zstd + projcache + .credentials.yaml），
 * 不依赖本机真实 ~/.dsh，也不会真的拉起 dsh。「真 GUI」用假 host（临时端口 + DSH_GUI_PROBE_* 测试缝）。
 */
import { spawn } from 'node:child_process'
import { appendFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_COOKIE_TTL_MS } from '../lib/dsh-gui.mjs'
import zlib from 'node:zlib'

const here = dirname(fileURLToPath(import.meta.url))
const MAIN = join(here, '..', 'main.mjs')
const FIXTURES = join(here, 'fixtures')

/** 与 dsh-gui 的 cookie 算法对齐：32 字节密钥（base64url） */
const SECRET = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8').toString('base64url')

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

/** 往会话日志追加一帧（模拟 DSH 继续写日志；mtime/size 随之变化触发巡检重解析）。 */
function appendFrame(logPath, events) {
  const text = `${events.map((event) => JSON.stringify(event)).join('\n')}\n`
  appendFileSync(logPath, zlib.zstdCompressSync(Buffer.from(text, 'utf8')))
}

function writeCredentials(home) {
  const yaml = [
    'version: 1',
    'records:',
    '  client-connection/browser-session:',
    '    kind: grant',
    '    payload:',
    '      version: 1',
    `      secret: ${SECRET}`,
    '',
  ].join('\n')
  writeFileSync(join(home, '.credentials.yaml'), yaml, 'utf8')
}

function makeHome({ credentials = false } = {}) {
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
  if (credentials) writeCredentials(home)
  return home
}

/** 读出一张自签 cookie 的有效期（payload 是明文，不用密钥）—— 假 host 用它学真宿主的拒收行为 */
function cookieExpired(rawHeader) {
  const value = String(rawHeader ?? '').split('=').slice(1).join('=')
  const body = value.split('.')[1]
  if (!body) return true
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    return !(payload.issuedAt <= Date.now() && payload.expiresAt > Date.now())
  } catch {
    return true
  }
}

/**
 * 会**像真宿主一样拒收过期 cookie** 的假 host：用于"小窗长开、cookie 过期"的端到端回归。
 * 2026-10-08 线上 bug：代理 11:09 起、cookie 12:09 过期，之后 iframe 就只剩一行
 * `dsh web authentication required`（真宿主 401 的原文）。
 */
async function startExpiryCheckingHost() {
  const seen = []
  const server = http.createServer((req, res) => {
    seen.push({ path: req.url, cookie: req.headers.cookie })
    if (cookieExpired(req.headers.cookie)) {
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('dsh web authentication required; reopen the URL printed by dsh web.\n')
      return
    }
    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<html><head><base href="./"></head><body>app</body></html>')
      return
    }
    if (req.url?.startsWith('/api/')) {
      let text = ''
      req.on('data', (c) => {
        text += c
      })
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ type: 'server-response', rpcId: JSON.parse(text || '{}').rpcId, result: { ok: true, value: { items: [] } } }))
      })
      return
    }
    res.writeHead(404)
    res.end('nope')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, port: server.address().port, seen }
}

/** 假 DSH host：探活（POST /api/session/list 需自签 cookie）+ 一个 HTML 首页。 */
async function startFakeHost() {
  const seen = []
  const server = http.createServer((req, res) => {
    seen.push({ path: req.url, host: req.headers.host, cookie: req.headers.cookie })
    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<html><head><base href="./"><title>fake</title></head><body>app</body></html>')
      return
    }
    if (req.url?.startsWith('/api/')) {
      if (!req.headers.cookie?.startsWith('dsh-auth-')) {
        res.writeHead(401)
        res.end('dsh web authentication required')
        return
      }
      let text = ''
      req.on('data', (c) => {
        text += c
      })
      req.on('end', () => {
        const body = JSON.parse(text || '{}')
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: { items: [] } } }))
      })
      return
    }
    res.writeHead(404)
    res.end('nope')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, port: server.address().port, seen }
}

/** 最小 sidecar 协议客户端。env 用于注入 DSH_GUI_PROBE_* 测试缝。 */
function startSidecar({ env = {} } = {}) {
  const child = spawn(process.execPath, [MAIN], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, ...env },
  })
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

test('sidecar 协议：状态 / 生效配置 / 裁剪项 / 速查表 / 会话读取 / 移除的方法', async (t) => {
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
      // 0.2.x 的遗留键：必须被 normalizeConfig 当未知字段丢弃
      dshCommand: 'dsh-command-that-does-not-exist',
      mirrorLimit: 12,
      pollMs: 1000,
      showHeader: true,
      showRail: true,
      showTabs: true,
      compactSpacing: true,
      customCss: '/* marker */',
      // 本测试断言状态通知不抢发布 → 关掉
      noticeEnabled: false,
    },
  })
  await sidecar.waitFor((op) => op.op === 'log' && op.message === '配置已更新')

  const status = await sidecar.call('status')
  assert.equal(status.ok, true, JSON.stringify(status))
  assert.equal(status.result.dshHome, home)
  assert.equal(status.result.zstd, true)
  assert.equal(status.result.contract, 7, '契约版本要报出来（设置页拿它识别旧 sidecar）')
  assert.equal(status.result.config.dshCommand, undefined, '0.2.x 遗留键必须被丢弃')
  // 生效配置必须带全部"显示项"键：设置界面以 status.config 为准（存盘缺键时不会显示成 false）
  const effective = status.result.config
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
    'compactSpacing',
  ]) {
    assert.equal(typeof effective[key], 'boolean', `生效配置缺少布尔键 ${key}`)
  }
  assert.equal(effective.showHeader, true, '传入的 showHeader=true 必须被保留')
  assert.equal(effective.showRail, true)
  assert.equal(effective.showTabs, true, '顶栏细粒度项也要能传进来')
  assert.equal(effective.showComposerStatus, false, '未传的显示项应回落到默认')
  assert.equal(effective.compactSpacing, true, '紧凑留白开关要能传进来')
  assert.equal(effective.customCss, '/* marker */')

  // status.gui：设置页的「GUI 复用状态」行从这里读（以前 settings 只认 status.gui，但 status 不带 → 永远"未启动"）
  assert.ok(status.result.gui && typeof status.result.gui === 'object', 'status 必须带 gui 摘要')
  assert.equal(status.result.gui.ready, false, '还没打开过小窗 ⇒ 未就绪')
  assert.equal(status.result.gui.credentialsFound, false, '没写凭据 ⇒ 读不到')

  // 反代裁剪项与 show* 取反（true = 隐藏）
  const crop = await sidecar.call('guiStatus')
  assert.equal(crop.ok, true, JSON.stringify(crop))
  assert.equal(crop.result.crop.rail, false, 'showRail=true ⇒ 不裁剪左栏')
  assert.equal(crop.result.crop.header, false, 'showHeader=true ⇒ 不整条隐藏顶栏')
  assert.equal(crop.result.crop.tabs, false, 'showTabs=true ⇒ 不裁剪标签页')
  assert.equal(crop.result.crop.composerStatus, true, '默认隐藏输入区状态条')
  assert.equal(crop.result.crop.messageMeta, true, '默认隐藏消息操作行')
  assert.equal(crop.result.compactSpacing, true, '紧凑留白要能在 guiStatus 里查到（排查"设置没生效"用）')

  // 设置页推配置走的是 RPC（宿主的 set_plugin_config 不会推给 sidecar）：
  // 走这条路必须真的改到生效配置与裁剪项，否则就得 disable/enable 插件才生效。
  const pushed = await sidecar.call('applyConfig', {
    config: { dshHome: home, showRail: false, showHeader: false, noticeEnabled: false },
  })
  assert.equal(pushed.ok, true, JSON.stringify(pushed))
  assert.equal(pushed.result.config.showRail, false, 'applyConfig 后生效配置应立即变化')
  const cropAfter = await sidecar.call('guiStatus')
  assert.equal(cropAfter.result.crop.rail, true, 'showRail=false ⇒ 裁剪左栏')
  assert.equal(cropAfter.result.crop.header, true, 'showHeader=false ⇒ 整条隐藏顶栏')
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
  assert.equal(transcript.result.session.id, 'session-bbb', '不点名时读最近活跃会话')
  assert.ok(transcript.result.session.items.length >= 2, JSON.stringify(transcript.result.session.items))

  // 没写凭据：openGui 报"读不到凭据"，而不是挂住或崩溃
  const noCreds = await sidecar.call('openGui', {})
  assert.equal(noCreds.ok, false)
  assert.match(noCreds.error, /credentials\.yaml/)

  // 0.2.x 的镜像/SDK 方法全部退场
  for (const gone of ['setMirror', 'sendPrompt', 'stopChat', 'testDsh']) {
    const removed = await sidecar.call(gone, {})
    assert.equal(removed.ok, false, `${gone} 应已移除`)
    assert.match(removed.error, /未知方法/)
  }

  const unknown = await sidecar.call('nopeMethod', {})
  assert.equal(unknown.ok, false)
  assert.match(unknown.error, /未知方法/)
})

test('真 GUI：cookie 过期后小窗照样能开（反代自己换 cookie，不会变成一行 401）', async (t) => {
  const host = await startExpiryCheckingHost()
  const home = makeHome({ credentials: true })
  // DSH_GUI_COOKIE_TTL_MS=1000 把 cookie 寿命压到 1 秒（生产是 1 小时），好在测试里等到它过期
  const sidecar = startSidecar({
    env: { DSH_GUI_PROBE_FROM: String(host.port), DSH_GUI_PROBE_DRIFT: '0', DSH_GUI_COOKIE_TTL_MS: '1000' },
  })
  t.after(async () => {
    sidecar.child.kill()
    rmSync(home, { recursive: true, force: true })
    host.server.close()
  })

  await sidecar.waitFor((op) => op.op === 'ready', 20000)
  sidecar.send({ op: 'config', config: { dshHome: home, guiPort: 0, noticeEnabled: false } })
  await sidecar.waitFor((op) => op.op === 'log' && op.message === '配置已更新')
  const opened = await sidecar.call('openGui', {})
  assert.equal(opened.ok, true, JSON.stringify(opened))

  // 等到那张 cookie 过期：修好之前，接下来任何一次请求都会拿到宿主的 401 纯文本
  await new Promise((resolve) => setTimeout(resolve, 1200))

  const page = await fetch(opened.result.guiUrl)
  const html = await page.text()
  assert.equal(page.status, 200, `cookie 过期后反代必须自己换新；实际 ${page.status} ${html.slice(0, 80)}`)
  assert.match(html, /catrace-dsh-gui-crop/, '换 cookie 后仍要正常注入')
  assert.ok(!/authentication required/.test(html), '绝不能把宿主的 401 话术当页面显示')

  const after = await sidecar.call('status')
  assert.ok(after.result.gui.cookieRefreshes >= 1, `状态里应能看到反代换过 cookie；实际 ${JSON.stringify(after.result.gui)}`)
})

test('真 GUI 小窗：openGui 发布 iframe 卡（默认最近活跃会话），guiUrl 经反代拿到注入后的官方页面', async (t) => {
  const host = await startFakeHost()
  const home = makeHome({ credentials: true })
  const sidecar = startSidecar({ env: { DSH_GUI_PROBE_FROM: String(host.port), DSH_GUI_PROBE_DRIFT: '0' } })
  t.after(async () => {
    sidecar.child.kill()
    rmSync(home, { recursive: true, force: true })
    host.server.close()
  })

  await sidecar.waitFor((op) => op.op === 'ready', 20000)
  sidecar.send({ op: 'config', config: { dshHome: home, guiPort: 0, noticeEnabled: false } })
  await sidecar.waitFor((op) => op.op === 'log' && op.message === '配置已更新')

  const ready = await sidecar.call('status')
  assert.equal(ready.result.gui.credentialsFound, true, '凭据要被读到')
  assert.equal(ready.result.gui.ready, false, '还没开过小窗')

  const opened = await sidecar.call('openGui', {})
  assert.equal(opened.ok, true, JSON.stringify(opened))
  assert.equal(opened.result.sessionId, 'session-bbb', '不点名 sessionId 时打开最近活跃会话')

  const published = await sidecar.waitFor((op) => op.op === 'publish' && op.event?.eventType === 'dsh-chat.window')
  assert.equal(published.event.kind, 'dsh-chat')
  assert.equal(published.event.sticky, true)
  assert.equal(published.event.dedupeKey, 'dsh-chat.window')
  assert.equal(published.event.payload.sessionId, 'session-bbb')
  assert.equal(published.event.payload.guiSessionId, 'session-bbb')
  // guiTitle 来自会话日志（readSession），不是 projcache 的列表标题
  assert.equal(published.event.payload.guiTitle, '整理三点结论', '卡片顶栏要显示会话标题')
  assert.equal(published.event.payload.toastStyle, 'standalone')
  assert.match(published.event.payload.guiUrl, /^http:\/\/127\.0\.0\.1:\d+\/\?dshw-session=session-bbb$/)
  assert.ok(Number.isInteger(published.event.payload.httpPort) && published.event.payload.httpPort > 0)
  assert.ok(typeof published.event.payload.httpToken === 'string')

  // guiUrl 经反代取回官方首页：会话预选 + 去装饰 CSS 都注入了
  const page = await fetch(published.event.payload.guiUrl)
  const html = await page.text()
  assert.equal(page.status, 200)
  assert.match(html, /localStorage\.setItem\("dsh\.sessions\.current"/)
  assert.match(html, /"session-bbb"/)
  assert.match(html, /catrace-dsh-gui-crop/, '去装饰 CSS 要注入')
  assert.match(html, /grid-template-columns: 0 minmax\(0, 1fr\) 0/, '左栏轨道归零要在注入的 CSS 里')

  // 状态卡让位记账：openGui 后该会话进入 openWindows（巡检发布静默），由巡检测试覆盖
  const after = await sidecar.call('status')
  assert.equal(after.result.gui.ready, true, '开过一次后 GUI 应就绪')
  assert.equal(after.result.gui.lastSessionId, 'session-bbb')
  // 票寿命写死 7 天（不探测宿主上限：桌面恒为 30 天）
  assert.equal(after.result.gui.cookieTtlMs, DEFAULT_COOKIE_TTL_MS, '票寿命应是写死的 7 天')
})

test('本机 HTTP 桥：鉴权 / health / 会话 / window / 移除的路由 / 错误码', async (t) => {
  const host = await startFakeHost()
  const home = makeHome({ credentials: true })
  const sidecar = startSidecar({ env: { DSH_GUI_PROBE_FROM: String(host.port), DSH_GUI_PROBE_DRIFT: '0' } })
  t.after(async () => {
    sidecar.child.kill()
    rmSync(home, { recursive: true, force: true })
    host.server.close()
  })

  await sidecar.waitFor((op) => op.op === 'ready', 20000)
  sidecar.send({ op: 'config', config: { dshHome: home, httpPort: 0, guiPort: 0, noticeEnabled: false } })
  const listening = await sidecar.waitFor(
    (op) => op.op === 'log' && op.message === '本机 HTTP 已就绪',
    20000,
  )
  const port = listening.data.port
  assert.ok(Number.isInteger(port) && port > 0, `端口应已分配：${JSON.stringify(listening)}`)

  // 没有 token：403；token 随小窗事件 payload 下发
  const denied = await fetch(`http://127.0.0.1:${port}/health`)
  assert.equal(denied.status, 403)
  const opened = await sidecar.call('openGui', {})
  assert.equal(opened.ok, true, JSON.stringify(opened))
  const published = await sidecar.waitFor((op) => op.op === 'publish' && op.event?.eventType === 'dsh-chat.window')
  const token = published.event.payload.httpToken
  assert.ok(typeof token === 'string' && token.length >= 16)
  assert.equal(published.event.payload.httpPort, port)

  const health = await fetch(`http://127.0.0.1:${port}/health?token=${token}`)
  assert.equal(health.status, 200)
  const healthBody = await health.json()
  assert.equal(healthBody.ok, true)
  assert.ok(!healthBody.result.routes.includes('/prompt'), '/prompt 已随 SDK 链路移除')
  assert.ok(!healthBody.result.routes.includes('/mirror'), '/mirror 已随镜像卡移除')

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

  // /window 一律开官方 GUI（旧调用方带的 mode 参数直接忽略）
  const windowRes = await fetch(`http://127.0.0.1:${port}/window`, {
    method: 'POST',
    headers: { 'X-Dsh-Chat-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: 'session-aaa', mode: 'gui' }),
  })
  const windowBody = await windowRes.json()
  assert.equal(windowRes.status, 200)
  assert.equal(windowBody.result.sessionId, 'session-aaa')
  const secondWindow = sidecar.ops.filter((op) => op.op === 'publish' && op.event?.eventType === 'dsh-chat.window').at(-1)
  assert.equal(secondWindow.event.payload.guiSessionId, 'session-aaa')

  const viewRes = await fetch(`http://127.0.0.1:${port}/notice/view`, {
    method: 'POST',
    headers: { 'X-Dsh-Chat-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: 'session-aaa', expanded: false }),
  })
  assert.equal(viewRes.status, 200)

  const notFound = await fetch(`http://127.0.0.1:${port}/nope?token=${token}`)
  assert.equal(notFound.status, 404)
  const removed = await fetch(`http://127.0.0.1:${port}/prompt?token=${token}`, {
    method: 'POST',
    headers: { 'X-Dsh-Chat-Token': token, 'Content-Type': 'application/json' },
    body: '{}',
  })
  assert.equal(removed.status, 404, '/prompt 路由应已移除')
  const wrongMethod = await fetch(`http://127.0.0.1:${port}/status?token=${token}`, { method: 'POST' })
  assert.equal(wrongMethod.status, 405)
})

test('状态通知巡检：回合流转出卡 / 审批自动展开成真 GUI 小窗 / 小窗让位与弹回 / 测试卡', async (t) => {
  const host = await startFakeHost()
  const home = makeHome({ credentials: true })
  const sidecar = startSidecar({ env: { DSH_GUI_PROBE_FROM: String(host.port), DSH_GUI_PROBE_DRIFT: '0' } })
  t.after(async () => {
    sidecar.child.kill()
    rmSync(home, { recursive: true, force: true })
    host.server.close()
  })

  await sidecar.waitFor((op) => op.op === 'ready', 20000)
  sidecar.send({
    op: 'config',
    config: { dshHome: home, httpPort: 0, guiPort: 0, noticeEnabled: true, noticePollMs: 500, noticeDoneHoldMs: 3000 },
  })
  await sidecar.waitFor((op) => op.op === 'log' && op.message === '状态通知巡检已启动')

  // 夹具现状：session-aaa 已完结（首见不补卡）；session-bbb 停在 turn2 进行中且日志新鲜 → 补一张「进行中」
  const running = await sidecar.waitFor(
    (op) => op.op === 'publish' && op.event?.dedupeKey === 'dsh-chat.notice:session-bbb',
  )
  assert.equal(running.event.eventType, 'dsh-chat.notice')
  assert.equal(running.event.payload.notice, true)
  assert.equal(running.event.payload.status, 'running')
  assert.equal(running.event.sticky, true)
  assert.equal(running.event.payload.preview, '三点整理完。')
  assert.equal(running.event.title, '整理三点结论')
  assert.equal(running.event.payload.cwd, 'D:\\Users\\che\\Documents\\deepseek-harness-default-workspace', 'cwd 要进 payload（卡片的项目路径行）')
  assert.equal(running.event.payload.auto_hide_ms, undefined, '进行中卡是 sticky，不带 auto_hide')
  assert.equal(typeof running.event.payload.httpToken, 'string', '状态卡要带 HTTP 桥口令（展开用）')

  // 完结且不新鲜的会话首见不出卡
  await new Promise((resolve) => setTimeout(resolve, 1200))
  assert.ok(
    !sidecar.ops.some((op) => op.op === 'publish' && op.event?.dedupeKey === 'dsh-chat.notice:session-aaa'),
    '已完结且不新鲜的会话不应出卡',
  )

  const logB = join(home, 'sessions', '--D-workspace-Beta--', 'session-bbb', 'session.v4.jsonl.zstd')

  // 审批：asked → 「等你审批」卡（autoExpand 标记 → 卡片自己原地展开官方界面，不再另开一张窗）
  appendFrame(logB, [{ type: 'approval/asked', seq: 33, time: Date.now(), data: { id: 'apm-1' } }])
  const waiting = await sidecar.waitFor(
    (op) => op.op === 'publish' && op.event?.dedupeKey === 'dsh-chat.notice:session-bbb' && op.event?.payload?.status === 'waiting',
  )
  assert.equal(waiting.event.payload.autoExpand, true, '等你审批要带 autoExpand（卡片原地展开）')
  assert.equal(waiting.event.level, 'warning')

  // 卡片展开上报 /notice/view：sidecar 原地补发同键卡；此后完成卡转 sticky（用户正在看，不自动收）
  const bridgePort = waiting.event.payload.httpPort
  const bridgeToken = waiting.event.payload.httpToken
  assert.ok(Number.isInteger(bridgePort) && bridgePort > 0, 'waiting 卡要带 HTTP 桥端口（展开用）')
  const view = (expanded) =>
    fetch(`http://127.0.0.1:${bridgePort}/notice/view`, {
      method: 'POST',
      headers: { 'X-Dsh-Chat-Token': bridgeToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session-bbb', expanded }),
    })

  const expandRes = await view(true)
  assert.equal(expandRes.status, 200)
  await sidecar.waitFor(
    (op) =>
      op.op === 'publish' &&
      op.event?.dedupeKey === 'dsh-chat.notice:session-bbb' &&
      op.event?.payload?.status === 'waiting' &&
      op.event?.payload?.at > waiting.event.payload.at,
  )

  appendFrame(logB, [{ type: 'approval/decided', seq: 34, time: Date.now(), data: { id: 'apm-1', outcome: 'allowed-once' } }])
  appendFrame(logB, [{ type: 'turn/end', seq: 40, time: Date.now(), data: { turn: 2, reason: { kind: 'completed' } } }])
  await new Promise((resolve) => setTimeout(resolve, 1200))
  const doneWhileExpanded = sidecar.ops.filter(
    (op) => op.op === 'publish' && op.event?.dedupeKey === 'dsh-chat.notice:session-bbb' && op.event?.payload?.status === 'done',
  )
  assert.equal(doneWhileExpanded.length, 1, '展开期间完成照常刷新（同键原地更新）')
  assert.equal(doneWhileExpanded[0].event.sticky, true, '展开中完成卡是 sticky（用户正在看）')
  assert.equal(doneWhileExpanded[0].event.payload.auto_hide_ms, undefined, '展开中完成不自动收')

  // 收起 → 按当前状态补发，恢复 auto_hide 计时
  const collapseRes = await view(false)
  assert.equal(collapseRes.status, 200)
  const backDone = await sidecar.waitFor(
    (op) =>
      op.op === 'publish' &&
      op.event?.dedupeKey === 'dsh-chat.notice:session-bbb' &&
      op.event?.payload?.status === 'done' &&
      op.event?.payload?.at > doneWhileExpanded[0].event.payload.at,
  )
  assert.equal(backDone.event.sticky, false)
  assert.equal(backDone.event.payload.auto_hide_ms, 3000, '收起后恢复自动收计时')

  // × 关卡 → 本轮静默，不再发布
  const countBeforeX = sidecar.ops.filter(
    (op) => op.op === 'publish' && String(op.event?.dedupeKey ?? '').startsWith('dsh-chat.notice:session-bbb'),
  ).length
  sidecar.send({
    op: 'resolved',
    eventId: backDone.event.id,
    resolutionKind: 'dismissed',
    payload: { notice: true, sessionId: 'session-bbb' },
  })
  await new Promise((resolve) => setTimeout(resolve, 1200))
  const countAfterX = sidecar.ops.filter(
    (op) => op.op === 'publish' && String(op.event?.dedupeKey ?? '').startsWith('dsh-chat.notice:session-bbb'),
  ).length
  assert.equal(countAfterX, countBeforeX, '× 之后没有新事件就不该再发布')

  // 新回合开始 → 静默解除，重新出「进行中」
  appendFrame(logB, [
    { type: 'turn/start', seq: 41, time: Date.now(), data: { turn: 3 } },
    {
      type: 'user/message',
      seq: 42,
      time: Date.now(),
      data: { content: [{ type: 'text', text: '继续，把测试补完。' }], source: { kind: 'user' }, role: 'user', id: 'user-bbb-9' },
      surfaceOp: 'append',
    },
  ])
  const rerun = await sidecar.waitFor(
    (op) =>
      op.op === 'publish' &&
      op.event?.dedupeKey === 'dsh-chat.notice:session-bbb' &&
      op.event?.payload?.status === 'running' &&
      op.event?.payload?.at > backDone.event.payload.at,
  )
  assert.equal(rerun.event.sticky, true)

  // 设置页的测试卡与巡检状态
  const demo = await sidecar.call('noticeDemo', { status: 'done' })
  assert.equal(demo.ok, true, JSON.stringify(demo))
  const demoPublish = await sidecar.waitFor(
    (op) => op.op === 'publish' && op.event?.dedupeKey === 'dsh-chat.notice:notice-demo',
  )
  assert.equal(demoPublish.event.payload.status, 'done')
  assert.equal(demoPublish.event.payload.auto_hide_ms, 3000)

  const errorDemo = await sidecar.call('noticeDemo', { status: 'error' })
  assert.equal(errorDemo.ok, true, JSON.stringify(errorDemo))
  const errorPublish = await sidecar.waitFor(
    (op) => op.op === 'publish' && op.event?.dedupeKey === 'dsh-chat.notice:notice-demo' && op.event?.payload?.status === 'error',
  )
  assert.equal(errorPublish.event.payload.statusLabel, '处理失败')
  assert.equal(errorPublish.event.level, 'error')
  assert.equal(errorPublish.event.sticky, false)
  assert.equal(errorPublish.event.payload.auto_hide_ms, 3000)

  const noticeStatus = await sidecar.call('noticeStatus')
  assert.equal(noticeStatus.ok, true, JSON.stringify(noticeStatus))
  assert.equal(noticeStatus.result.loopRunning, true)
  assert.ok(noticeStatus.result.sessions.some((s) => s.id === 'session-bbb'), '巡检状态要列出跟踪中的会话')
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
