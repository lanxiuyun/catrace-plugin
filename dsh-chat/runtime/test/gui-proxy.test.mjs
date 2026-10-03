/**
 * GUI 复用层测试：
 *  - cookie 自签格式（对照 browser-auth.ts 的算法，固定输入 → 固定输出）
 *  - .credentials.yaml 解析
 *  - host 探活（起一个假 host 在临时端口，走真实 HTTP）
 *  - 反代：三个头改写、HTML 注入会话、透传字节、401 透传、WS 升级转发
 */
import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import http from 'node:http'
import test from 'node:test'

import { cookieNameFor, discoverHost, mintAuthCookie, normalizeAuthority, parseBrowserSessionSecret } from '../lib/dsh-gui.mjs'
import { buildCropCss, escapeStyleText, injectIntoHtml, startGuiProxy } from '../lib/gui-proxy.mjs'

const SECRET = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8').toString('base64url') // 32 字节
const AUTHORITY = '127.0.0.1:43120'

test('cookie 名：dsh-auth- + base64url(sha256(authority))', () => {
  const expected = `dsh-auth-${Buffer.from(createHash('sha256').update(AUTHORITY).digest()).toString('base64url')}`
  assert.equal(cookieNameFor(AUTHORITY), expected)
  assert.equal(normalizeAuthority('127.0.0.1:43120'), AUTHORITY)
  // 端口不同 ⇒ cookie 名不同（所以端口必须探测）
  assert.notEqual(cookieNameFor('127.0.0.1:43121'), expected)
})

test('cookie 值：v1.<body>.<hmac(body)>，且 HMAC 覆盖 base64url 后的 body', () => {
  const now = 1_700_000_000_000
  const { name, value, authority } = mintAuthCookie({ secret: SECRET, authority: AUTHORITY, now, ttlMs: 3600_000 })
  assert.equal(authority, AUTHORITY)
  const [version, body, signature] = value.split('.')
  assert.equal(version, 'v1')
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  assert.deepEqual(payload, { version: 1, authority: AUTHORITY, issuedAt: now - 5000, expiresAt: now + 3600_000 })
  const expectedSignature = Buffer.from(createHmac('sha256', Buffer.from(SECRET, 'base64url')).update(body).digest()).toString('base64url')
  assert.equal(signature, expectedSignature, 'HMAC 必须覆盖 base64url 后的 body 字符串')
  assert.equal(name, cookieNameFor(AUTHORITY))
})

test('cookie 签名密钥必须 32 字节', () => {
  assert.throws(() => mintAuthCookie({ secret: Buffer.from('short').toString('base64url'), authority: AUTHORITY }), /32 字节/)
})

test('解析 .credentials.yaml 的 browser-session secret', () => {
  const yaml = [
    'version: 1',
    'records:',
    '  client-connection/browser-session:',
    '    kind: grant',
    '    payload:',
    '      version: 1',
    `      secret: ${SECRET}`,
    '  other/record:',
    '    kind: grant',
    '    payload:',
    '      secret: anothersecretvalue',
    '',
  ].join('\n')
  assert.equal(parseBrowserSessionSecret(yaml), SECRET)
  assert.equal(parseBrowserSessionSecret('version: 1\nrecords: {}\n'), null)
})

/** 假 DSH host：只实现探活与一个 HTML 首页 + 一个 WS 升级 */
function startFakeHost() {
  const seen = []
  const server = http.createServer((req, res) => {
    seen.push({ path: req.url, host: req.headers.host, cookie: req.headers.cookie, origin: req.headers.origin })
    if (req.url === '/') {
      const html = '<html><head><base href="./"><title>fake</title></head><body>app</body></html>'
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(html)
      return
    }
    if (req.url === '/asset.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' })
      res.end('console.log(1)')
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
        res.end(JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: { items: [], echoed: body.method } } }))
      })
      return
    }
    res.writeHead(404)
    res.end('nope')
  })
  server.on('upgrade', (req, socket) => {
    seen.push({ upgrade: req.url, host: req.headers.host, cookie: req.headers.cookie, origin: req.headers.origin })
    if (!req.headers.cookie?.startsWith('dsh-auth-')) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nconnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\nsec-websocket-accept: ${accept}\r\n\r\n`)
    socket.on('data', (chunk) => socket.write(chunk))
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, seen }))
  })
}

test('discoverHost：在漂移区间里认出假 host；cookie 用该端口的 authority 签', async (t) => {
  const host = await startFakeHost()
  t.after(() => host.server.close())
  const found = await discoverHost({ secret: SECRET, from: host.port, drift: 0 })
  assert.ok(found, '应能发现假 host')
  assert.equal(found.port, host.port)
  assert.equal(found.authority, `127.0.0.1:${host.port}`)
  assert.equal(found.cookie.name, cookieNameFor(`127.0.0.1:${host.port}`))
  const probe = host.seen.find((s) => s.path === '/api/session/list')
  assert.equal(probe.host, `127.0.0.1:${host.port}`)
  assert.ok(probe.cookie.startsWith('dsh-auth-'))
  assert.equal(probe.origin, undefined, '探活请求不能带 Origin')
})

test('discoverHost：没有 host 时返回 null（不抛错）', async () => {
  const found = await discoverHost({ secret: SECRET, from: 1, drift: 0 })
  assert.equal(found, null)
})

test('反代：改写 Host/Cookie/删 Origin、注入会话、透传字节、401 透传', async (t) => {
  const host = await startFakeHost()
  const cookie = mintAuthCookie({ secret: SECRET, authority: `127.0.0.1:${host.port}` })
  const proxy = await startGuiProxy({
    targetPort: host.port,
    authority: `127.0.0.1:${host.port}`,
    cookie,
    sessionId: 'session-abc',
  })
  t.after(async () => {
    await proxy.close()
    host.server.close()
  })

  // 1) 首页：注入会话预选脚本
  const home = await fetch(`${proxy.url}?dshw-session=session-abc`, { headers: { Origin: 'http://127.0.0.1:9999' } })
  const html = await home.text()
  assert.equal(home.status, 200)
  assert.match(html, /localStorage\.setItem\("dsh\.sessions\.current"/, '应注入会话预选脚本')
  assert.match(html, /"session-abc"/)
  assert.match(html, /<base href="\.\/">/, '原 HTML 的 base 必须原样保留')

  const homeSeen = host.seen.filter((s) => s.path === '/' || s.path === '/?x').at(-1)
  assert.equal(homeSeen.host, `127.0.0.1:${host.port}`, 'Host 必须改写成目标 authority')
  assert.ok(homeSeen.cookie.startsWith('dsh-auth-'), '必须注入自签 cookie')
  assert.equal(homeSeen.origin, undefined, 'Origin 必须删掉（否则栅栏 403）')

  // 2) 静态资源：字节透传
  const asset = await fetch(`${proxy.url}asset.js`)
  assert.equal(await asset.text(), 'console.log(1)')

  // 3) /api：带 cookie 透传（假 host 认 cookie 才 200）
  const apiRes = await fetch(`${proxy.url}api/session/list`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'r1', method: 'session/list', payload: { args: { _request: {} } } }),
  })
  const apiBody = await apiRes.json()
  assert.equal(apiRes.status, 200)
  assert.equal(apiBody.result.ok, true)
  assert.equal(apiBody.result.value.echoed, 'session/list')

  // 4) 健康检查是我们自己答的
  const health = await (await fetch(`${proxy.url}catrace-gui-health`)).json()
  assert.equal(health.ok, true)
  assert.equal(health.sessionId, 'session-abc')
})

test('去装饰 CSS：左栏"轨道归零"；顶栏默认整条隐藏，关掉后才走细粒度开关', () => {
  const css = buildCropCss({})
  // 左栏：必须归零 grid 轨道，绝不能 display:none
  assert.match(css, /\[class\*="_frame"\]\s*\{[^}]*grid-template-columns:\s*0 minmax\(0, 1fr\) 0/, '必须把 grid 轨道归零')
  assert.match(css, /\[class\*="_sidebarCol"\]\s*\{[^}]*grid-column:\s*1/, '左栏要留在第一轨')
  assert.match(css, /\[class\*="_centerCol"\]\s*\{[^}]*grid-column:\s*2/, '中间列要显式钉在第二轨')
  assert.ok(!/\[class\*="_sidebarCol"\][^}]*display:\s*none/.test(css), '左栏绝不能用 display:none')
  // 默认：整条官方顶栏隐藏，且必须用 :has 限定"含标签页的那条"（避免误伤消息里的 _header）
  assert.match(css, /\[class\*="_header"\]:has\(\[class\*="_tabs"\]\)/, '默认应整条隐藏官方顶栏')
  // 关掉整条隐藏后，细粒度开关才生效
  const granular = buildCropCss({ header: false })
  assert.match(granular, /\[class\*="_tabs"\]\s*\{[^}]*display:\s*none/, '细粒度：应隐藏对话/轨迹标签')
  assert.match(granular, /\[class\*="_headerUtilities"\]/, '细粒度：应隐藏右侧图标簇')
  assert.match(granular, /\[class\*="_headerCorner"\]/, '细粒度：应隐藏最右角标按钮')
  assert.match(granular, /\[class\*="_header"\]\s*\[class\*="_crumb"\]/, '细粒度：官方标题限定在 header 内隐藏')
  assert.ok(!/\[class\*="_headerActions"\]/.test(granular), '细粒度默认保留「子智能体/后台任务」chips')
  assert.match(
    buildCropCss({ header: false, tabs: false, headerIcons: false, headerTitle: false, headerChips: true }),
    /\[class\*="_headerActions"\]/,
    '细粒度 headerChips=true 时才隐藏 chips',
  )
  // header=false 时，细粒度开关必须真的改变输出
  assert.ok(buildCropCss({ header: false, tabs: false }).length < granular.length, 'tabs=false 应少掉规则')
  // 顶栏子项全被藏 → 整条一起藏（别留一条空行）
  const allHidden = buildCropCss({ header: false, tabs: true, headerIcons: true, headerTitle: true, headerChips: true })
  assert.match(allHidden, /\[class\*="_header"\]:has\(\[class\*="_tabs"\]\)\s*\{[^}]*display:\s*none/, '顶栏内容全藏时应整条隐藏')
  assert.ok(!/tidy|_titleCluster/.test(allHidden), '整条隐藏时不需要再整理内部布局')
  // 「整理顶栏」：部分隐藏时要做对齐/收边距，否则会散着、留空隙
  const tidy = buildCropCss({ header: false, tabs: true, headerTitle: true, headerChips: false, headerIcons: false })
  assert.match(tidy, /\[class\*="_titleRow"\]\s*\{[^}]*align-items:\s*center/, '应统一行内对齐')
  assert.match(tidy, /\[class\*="_titleCluster"\]\s*\{[^}]*flex:\s*0 0 auto/, '空的标题列不该再抢空间')
  assert.match(tidy, /\[class\*="_header"\]\s*\{[^}]*padding-top/, '应收紧顶栏上下留白')
  assert.match(tidy, /\[class\*="_headerUtilities"\]\s*\{[^}]*margin-left:\s*auto/, '动作图标组应自己贴右')
  assert.match(tidy, /\[class\*="_headerCorner"\]\s*\{[^}]*margin-left:\s*0/, '多个 auto 外边距会平分空隙，所以只给第一个')
  // 图标组整体隐藏时，改由 corner 贴右
  const tidyNoIcons = buildCropCss({ header: false, headerIcons: true, headerChips: false })
  assert.match(tidyNoIcons, /\[class\*="_headerCorner"\]\s*\{[^}]*margin-left:\s*auto/, '图标组隐藏时应让 corner 贴右')
  // 行高收紧是无条件生效的（官方顶栏本来就偏高）；但"空列收窄/贴右"只在确实藏了东西时才加
  const nothingHidden = buildCropCss({
    header: false,
    tabs: false,
    headerIcons: false,
    headerMore: false,
    headerPanel: false,
    headerTitle: false,
    headerChips: false,
    composerStatus: false,
    messageMeta: false,
    rail: false,
  })
  assert.match(nothingHidden, /\[class\*="_titleRow"\]\s*\{[^}]*min-height:\s*0/, '行高收紧应始终注入')
  assert.ok(!/flex:\s*0 0 auto/.test(nothingHidden), '什么都没藏时不要改官方排列')
  assert.ok(!/display:\s*none/.test(nothingHidden), '什么都没藏时不该有任何隐藏规则')
  assert.equal(
    buildCropCss({
      header: false,
      tidy: false,
      tabs: true,
      headerIcons: false,
      headerTitle: false,
      headerChips: false,
      rail: false,
      composerStatus: false,
      messageMeta: false,
    }),
    '[class*="_tabs"] { display: none !important; }',
    'tidy=false 时不注入整理规则',
  )
  // 只藏「…」和面板开关：保留文件夹下拉
  const iconsOnly = buildCropCss({ header: false, headerIcons: false, headerMore: true, headerPanel: true })
  assert.match(iconsOnly, /\[class\*="_moreButton"\]\s*\{[^}]*display:\s*none/, '「…」应可单独隐藏')
  assert.match(iconsOnly, /\[class\*="_headerCorner"\]\s*\{[^}]*display:\s*none/, '面板开关应可单独隐藏')
  assert.ok(!/\[class\*="_headerUtilities"\]\s*\{[^}]*display:\s*none/.test(iconsOnly), '不应把整个图标簇（含文件夹下拉）藏掉')
  // 自定义 CSS：追加在最后，且转义 </style
  const custom = buildCropCss({ customCss: '[class*="_headerCorner"] { display: none !important; }' })
  assert.ok(custom.trimEnd().endsWith('[class*="_headerCorner"] { display: none !important; }'), '自定义 CSS 要排在最后（能覆盖我们的规则）')
  assert.match(escapeStyleText('/* </style> */'), /<\\\/style/, '自定义 CSS 里的 </style 必须转义')
  const html = injectIntoHtml('<html><head><title>t</title></head><body></body></html>', {
    sessionId: 's1',
    storageKey: 'k',
    cssText: 'a{}</style><script>alert(1)</script>',
  })
  assert.ok(html.includes('a{}<\\/style>'), '自定义 CSS 里的 </style 应被转义')
  assert.ok(!html.includes('a{}</style>'), '自定义 CSS 不得原样闭合 style 标签')
  // 其余装饰
  assert.match(css, /\[class\*="_dock"\]/, '应隐藏输入区状态条')
  assert.match(css, /\[class\*="_actions"\]/, '应隐藏消息操作行')
  assert.match(css, /\.cm-note/, '应隐藏"本轮费用"行')
  // 强制显示顶栏文字标签：官方容器查询没有 !important，所以用一条 !important 盖回来
  assert.ok(!/forceLabels|_triggerLabel/.test(buildCropCss({})), '默认不注入"强制显示标签"规则')
  const labelsCss = buildCropCss({ forceLabels: true })
  assert.match(labelsCss, /\[class\*="_titleRow"\] \[class\*="_triggerLabel"\]/, 'forceLabels 应覆盖顶栏标签')
  assert.match(labelsCss, /!important/, '必须带 !important 才能盖过官方容器查询')
  // 各项独立可控 + 全关为空
  for (const key of ['rail', 'composerStatus', 'messageMeta']) {
    assert.ok(buildCropCss({ [key]: false }).length < css.length, `${key}=false 时应少掉对应规则`)
  }
  // header 开关：关掉整条隐藏后，细粒度全关 ⇒ 只剩 rail/状态条/消息行那几条
  const granularAllOff = buildCropCss({ header: false, tabs: false, headerIcons: false, headerTitle: false })
  assert.ok(granularAllOff.length < granular.length, '细粒度全关应比默认细粒度更短')
  // 全都显示时：不应有任何隐藏规则；只允许"收紧行高"这一件事（官方顶栏本来就偏高）
  const allVisible = buildCropCss({
    rail: false,
    header: false,
    tabs: false,
    headerIcons: false,
    headerMore: false,
    headerPanel: false,
    headerTitle: false,
    headerChips: false,
    composerStatus: false,
    messageMeta: false,
  })
  assert.ok(!/display:\s*none/.test(allVisible), '全都显示时不应有任何隐藏规则')
  assert.ok(!/flex:\s*0 0 auto/.test(allVisible), '全都显示时不要改官方排列')
  assert.match(allVisible, /min-height:\s*0/, '行高收紧应始终生效')
})

test('反代：注入去装饰 CSS 与会话预选（首屏 HTML）', async (t) => {
  const host = await startFakeHost()
  const cookie = mintAuthCookie({ secret: SECRET, authority: `127.0.0.1:${host.port}` })
  const proxy = await startGuiProxy({
    targetPort: host.port,
    authority: `127.0.0.1:${host.port}`,
    cookie,
    cssText: buildCropCss({}),
  })
  t.after(async () => {
    await proxy.close()
    host.server.close()
  })
  const html = await (await fetch(`${proxy.url}?dshw-session=session-xyz`)).text()
  assert.match(html, /catrace-dsh-gui-crop/, '应注入裁剪样式')
  assert.match(html, /grid-template-columns: 0 minmax\(0, 1fr\) 0/, '裁剪样式要含轨道归零')
  assert.match(html, /"session-xyz"/, '应注入会话预选')
  assert.match(html, /<base href="\.\/">/, '官方 base 必须原样保留')
})

test('反代：查询串按字节透传（插件 bundle 的 ??a,b&rev= 不能被重新编码）', async (t) => {
  const host = await startFakeHost()
  const cookie = mintAuthCookie({ secret: SECRET, authority: `127.0.0.1:${host.port}` })
  const proxy = await startGuiProxy({ targetPort: host.port, authority: `127.0.0.1:${host.port}`, cookie })
  t.after(async () => {
    await proxy.close()
    host.server.close()
  })
  const bundlePath = '/plugins/??@deepseek-ai/dsh-client-modules/client.js&rev=e94eab90c02a'
  const res = await fetch(`http://127.0.0.1:${proxy.port}${bundlePath}`)
  assert.equal(res.status, 404, '假 host 对这个路径回 404，说明请求确实到达了上游')
  const seen = host.seen.at(-1)
  assert.equal(seen.path, bundlePath, '上游收到的路径必须与请求逐字节一致（@ , ?? 都不能被编码）')
})

test('反代：带 dshw-session 时照样字节透传其余查询串', async (t) => {
  const host = await startFakeHost()
  const cookie = mintAuthCookie({ secret: SECRET, authority: `127.0.0.1:${host.port}` })
  const proxy = await startGuiProxy({ targetPort: host.port, authority: `127.0.0.1:${host.port}`, cookie })
  t.after(async () => {
    await proxy.close()
    host.server.close()
  })
  await fetch(`http://127.0.0.1:${proxy.port}/plugins/x/client.js?rev=abc&dshw-session=session-1&v=2`)
  assert.equal(host.seen.at(-1).path, '/plugins/x/client.js?rev=abc&v=2', '只应剥掉 dshw-session，其余原样')
})

test('反代：WS 升级按同样规则转发（带 cookie、无 Origin）', async (t) => {
  const host = await startFakeHost()
  const cookie = mintAuthCookie({ secret: SECRET, authority: `127.0.0.1:${host.port}` })
  const proxy = await startGuiProxy({ targetPort: host.port, authority: `127.0.0.1:${host.port}`, cookie })
  t.after(async () => {
    await proxy.close()
    host.server.close()
  })

  // 裸 WebSocket 握手（不依赖 ws 包）：只验证 upgrade 分支把三个头处理对了、并回到 101
  const key = Buffer.from('0123456789abcdef').toString('base64')
  const result = await new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: proxy.port,
      path: '/api/remote.mux',
      headers: {
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-key': key,
        'sec-websocket-version': '13',
        Origin: 'http://127.0.0.1:9999',
      },
    })
    const timer = setTimeout(() => reject(new Error('WS 升级超时')), 5000)
    req.on('upgrade', (res, socket) => {
      clearTimeout(timer)
      const headers = res.headers
      socket.destroy()
      resolve({ status: res.statusCode, headers })
    })
    req.on('response', (res) => {
      clearTimeout(timer)
      resolve({ status: res.statusCode, headers: res.headers, rejected: true })
    })
    req.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    req.end()
  })

  assert.notEqual(result.status, 401, '代理必须带上 cookie，否则假 host 会 401')
  assert.notEqual(result.status, 403)
  const upgradeSeen = host.seen.find((s) => s.upgrade === '/api/remote.mux')
  assert.ok(upgradeSeen, '上游应收到 upgrade')
  assert.ok(upgradeSeen.cookie.startsWith('dsh-auth-'), '升级请求必须注入 cookie')
  assert.equal(upgradeSeen.origin, undefined, '升级请求也必须删 Origin')
  assert.equal(upgradeSeen.host, `127.0.0.1:${host.port}`, '升级请求的 Host 要改写')
  if (result.status === 101) {
    assert.ok(result.headers['sec-websocket-accept'], '101 必须带 sec-websocket-accept')
  }
})
