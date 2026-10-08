/**
 * GUI 复用层测试：
 *  - cookie 自签格式（对照 browser-auth.ts 的算法，固定输入 → 固定输出）
 *  - .credentials.yaml 解析
 *  - host 探活（起一个假 host 在临时端口，走真实 HTTP）
 *  - 反代：三个头改写、HTML 注入会话、透传字节、401 透传、WS 升级转发
 *  - cookie 换新：吃到 401 换票重放、换不到就透传原文、带 body 不重放、WS 重握
 */
import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import http from 'node:http'
import test from 'node:test'

import { DEFAULT_COOKIE_TTL_MS, cookieExpiresAt, cookieNameFor, describeDiscoveryFailure, discoverHost, mintAuthCookie, normalizeAuthority, parseBrowserSessionSecret } from '../lib/dsh-gui.mjs'
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

test('cookie 到期时刻：反代不验签也能读出来（payload 是明文，只当"该不该换新"的提示）', () => {
  const now = 1_700_000_000_000
  const cookie = mintAuthCookie({ secret: SECRET, authority: AUTHORITY, now, ttlMs: 60_000 })
  assert.equal(cookie.issuedAt, now - 5000, 'mintAuthCookie 要把 issuedAt/expiresAt 一并交出来')
  assert.equal(cookie.expiresAt, now + 60_000)
  assert.equal(cookieExpiresAt(cookie), now + 60_000)
  assert.equal(cookieExpiresAt(cookie.value), now + 60_000, '传裸值也要能读')
  assert.equal(cookieExpiresAt(null), null)
  assert.equal(cookieExpiresAt('v1.@@not-base64@@.sig'), null, '解不出来就返回 null（调用方按"不刷新"处理）')
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

test('403 准入栅栏：要认出这是"桌面版拒了非渲染器请求"，而不是"没找到 host"', async (t) => {
  // 复刻桌面端的 rejectBrowserRequest：纯文本 forbidden + nosniff
  const server = http.createServer((req, res) => {
    res.statusCode = 403
    res.setHeader('content-type', 'text/plain; charset=utf-8')
    res.setHeader('x-content-type-options', 'nosniff')
    res.end('forbidden')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  t.after(() => server.close())

  const diag = []
  const found = await discoverHost({ secret: SECRET, from: port, drift: 0, diag })
  assert.equal(found, null, '403 不算找到 host')
  assert.equal(diag.length, 1)
  assert.equal(diag[0].status, 403)
  assert.match(diag[0].body, /forbidden/)

  const message = describeDiscoveryFailure(diag)
  assert.match(message, /允许在浏览器中打开/, '必须给出可执行的补救动作')
  assert.match(message, /设置浏览器访问/, '要点名设置项')
  assert.ok(!/没找到正在运行的 DSH host/.test(message), '别把准入问题说成"没找到 host"')
})

test('探测失败原因：403 / 401 / 连不上 分别给不同的话术', () => {
  assert.match(describeDiscoveryFailure([{ status: 403 }]), /403 forbidden/)
  assert.match(describeDiscoveryFailure([{ status: 401 }]), /凭据被拒/)
  assert.match(describeDiscoveryFailure([{ status: 0 }]), /确认 DSH Desktop 在运行/)
  assert.match(describeDiscoveryFailure([]), /允许在浏览器中打开/)
  assert.match(
    describeDiscoveryFailure([{ status: 0 }, { status: 0 }, { status: 403 }]),
    /403 forbidden/,
    '混合结果里只要出现过 403，就按准入问题报',
  )
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

test('紧凑留白：默认不注入，开了才收紧官方留白', () => {
  const off = buildCropCss({})
  assert.ok(!/clearance/.test(off), '默认不该动官方留白变量')
  const on = buildCropCss({ compactSpacing: true })
  // 官方默认 --dsh-composer-side-clearance: 16px，滚动区每侧因此是 32px；归零省 16px/侧
  assert.match(on, /--dsh-composer-side-clearance:\s*0px/, '应把官方留白变量归零')
  assert.match(on, /\[class\*="_viewArea"\] \[class\*="_scroll"\]\s*\{[^}]*padding-left/, '应收紧对话区滚动内边距')
  assert.match(on, /\[class\*="_composerSeat"\]\s*\{[^}]*padding-left/, '应让输入框贴边')
  assert.match(on, /\[class\*="_body"\]\s*\{[^}]*gap:/, '应收紧消息块间距')
  // 故意不动 --dsh-chat-content-width：最小 680px 在 360px 里不生效，且被宽表格 calc 用到，改成百分比会跑版
  assert.ok(!/--dsh-chat-content-width/.test(on), '不要动 content-width（有跑版风险）')
  assert.ok(
    buildCropCss({ compactSpacing: true, customCss: 'x{}' }).trimEnd().endsWith('x{}'),
    '自定义 CSS 必须仍排在最后',
  )
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

/**
 * 只认「不是这一张」的假 host：用来演"cookie 过期 / 凭据轮换后被 401，换新后放行"。
 * `accept(rawCookieHeader)` 拿到的是原始 `name=value` 串。
 */
function startAuthHost({ accept }) {
  const seen = []
  const server = http.createServer((req, res) => {
    seen.push({ path: req.url, cookie: req.headers.cookie })
    if (!accept(req.headers.cookie)) {
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
  server.on('upgrade', (req, socket) => {
    seen.push({ upgrade: req.url, cookie: req.headers.cookie })
    if (!accept(req.headers.cookie)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nconnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    const handshake = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\nsec-websocket-accept: ${handshake}\r\n\r\n`)
    socket.on('data', (chunk) => socket.write(chunk))
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, seen }))
  })
}

/** 裸 WebSocket 握手（不依赖 ws 包） */
function wsHandshake(port, path) {
  const key = Buffer.from('0123456789abcdef').toString('base64')
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path,
      headers: { connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-key': key, 'sec-websocket-version': '13', Origin: 'http://127.0.0.1:9999' },
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
}

const rawCookie = (cookie) => `${cookie.name}=${cookie.value}`

/** 票在签名里声明的跨度：`expiresAt - issuedAt` = ttl + 5s（issuedAt 提前 5 秒给时钟回拨留余量） */
const spanOf = (cookie) => cookieExpiresAt(cookie) - cookie.issuedAt

test('discoverHost：票寿命写死 7 天（不探测宿主上限，桌面恒为 30 天 > 7 天）', async (t) => {
  const host = await startFakeHost()
  t.after(() => host.server.close())

  const found = await discoverHost({ secret: SECRET, from: host.port, drift: 0 })
  assert.ok(found, '应能发现假 host')
  assert.equal(found.ttlMs, DEFAULT_COOKIE_TTL_MS)
  assert.equal(DEFAULT_COOKIE_TTL_MS, 7 * 24 * 60 * 60 * 1000, '票寿命写死 7 天')
  assert.equal(spanOf(found.cookie), DEFAULT_COOKIE_TTL_MS + 5000)
  assert.equal(host.seen.filter((s) => s.path === '/api/session/list').length, 1, '只该有那一次探活，不额外问上限')
})

test('discoverHost：显式给了 ttlMs 就用它（测试缝：毫秒级寿命才能把"过期→换票"跑成确定性用例）', async (t) => {
  const host = await startFakeHost()
  t.after(() => host.server.close())

  const found = await discoverHost({ secret: SECRET, from: host.port, drift: 0, ttlMs: 1234 })
  assert.equal(found.ttlMs, 1234)
  assert.equal(spanOf(found.cookie), 1234 + 5000)
})

test('反代：吃到 401 会换 cookie 重放一次（票过期 / 凭据轮换都走这条）', async (t) => {
  const rejected = mintAuthCookie({ secret: SECRET, authority: AUTHORITY, ttlMs: 3600_000 })
  const host = await startAuthHost({ accept: (raw) => !String(raw ?? '').includes(rejected.value) })
  const accepted = mintAuthCookie({ secret: SECRET, authority: `127.0.0.1:${host.port}`, ttlMs: 3600_000 })
  let refreshes = 0
  const proxy = await startGuiProxy({
    targetPort: host.port,
    authority: `127.0.0.1:${host.port}`,
    cookie: rejected,
    refreshCookie: () => {
      refreshes += 1
      return accepted
    },
  })
  t.after(async () => {
    await proxy.close()
    host.server.close()
  })

  const home = await fetch(proxy.url)
  assert.equal(home.status, 200, '401 → 换 cookie → 重放，浏览器不该看到那行 401 纯文本')
  assert.equal(refreshes, 1)
  assert.equal(host.seen.length, 2, '上游应收到两次：被拒的一次 + 换 cookie 后的重放')
  assert.match(String(host.seen[0].cookie), /dsh-auth-/, '第一次带的是旧 cookie')
  assert.ok(String(host.seen[1].cookie).includes(accepted.value), '第二次必须带换来的新 cookie')
})

test('反代：换不到新 cookie 时，把上游的 401 原文透传（别吞掉话术、也别死循环）', async (t) => {
  const rejected = mintAuthCookie({ secret: SECRET, authority: AUTHORITY, ttlMs: 3600_000 })
  const host = await startAuthHost({ accept: () => false })
  let refreshes = 0
  const proxy = await startGuiProxy({
    targetPort: host.port,
    authority: `127.0.0.1:${host.port}`,
    cookie: rejected,
    maxAuthRetries: 1,
    // 每次都签一张"新"的（值确实不同），但宿主一张都不认 —— 演"凭据彻底不对"
    refreshCookie: () => {
      refreshes += 1
      return mintAuthCookie({ secret: SECRET, authority: `127.0.0.1:${host.port}`, ttlMs: 3600_000, now: Date.now() + refreshes })
    },
  })
  t.after(async () => {
    await proxy.close()
    host.server.close()
  })

  const home = await fetch(proxy.url)
  assert.equal(home.status, 401)
  assert.match(await home.text(), /dsh web authentication required/, '原文要透传，用户/日志才看得出是 DSH 的鉴权话术')
  assert.equal(refreshes, 1, 'maxAuthRetries=1 ⇒ 只换一次')
  assert.equal(host.seen.length, 2, '重试次数必须有上限，不能 401 打转')
})

test('反代：没给 refreshCookie 时行为与从前一致（401 直接透传、不重试）', async (t) => {
  const host = await startAuthHost({ accept: () => false })
  const proxy = await startGuiProxy({ targetPort: host.port, authority: `127.0.0.1:${host.port}`, cookie: mintAuthCookie({ secret: SECRET, authority: AUTHORITY }) })
  t.after(async () => {
    await proxy.close()
    host.server.close()
  })
  const home = await fetch(proxy.url)
  assert.equal(home.status, 401)
  assert.equal(host.seen.length, 1, '没有换 cookie 的能力就不该重放')
})

test('反代：带 body 的请求不吃"换 cookie 重放"（绝不能把上传/表单悄悄丢掉）', async (t) => {
  const host = await startAuthHost({ accept: () => false })
  let refreshes = 0
  const proxy = await startGuiProxy({
    targetPort: host.port,
    authority: `127.0.0.1:${host.port}`,
    cookie: mintAuthCookie({ secret: SECRET, authority: AUTHORITY }),
    refreshCookie: () => {
      refreshes += 1
      return mintAuthCookie({ secret: SECRET, authority: `127.0.0.1:${host.port}` })
    },
  })
  t.after(async () => {
    await proxy.close()
    host.server.close()
  })

  const res = await fetch(`${proxy.url}api/session/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'r1', prompt: 'x'.repeat(64) }),
  })
  assert.equal(res.status, 401)
  assert.equal(refreshes, 0, '带 body 的请求不重放（重放要重读 body，风险大于收益）')
  assert.equal(host.seen.length, 1)
})

test('反代：WS 升级吃到 401 也会换 cookie 重握一次', async (t) => {
  const rejected = mintAuthCookie({ secret: SECRET, authority: AUTHORITY, ttlMs: 3600_000 })
  const host = await startAuthHost({ accept: (raw) => !String(raw ?? '').includes(rejected.value) })
  const accepted = mintAuthCookie({ secret: SECRET, authority: `127.0.0.1:${host.port}`, ttlMs: 3600_000 })
  const proxy = await startGuiProxy({
    targetPort: host.port,
    authority: `127.0.0.1:${host.port}`,
    cookie: rejected,
    refreshCookie: () => accepted,
  })
  t.after(async () => {
    await proxy.close()
    host.server.close()
  })

  const result = await wsHandshake(proxy.port, '/api/remote.mux')
  assert.equal(result.status, 101, '换 cookie 后重握必须成功')
  const upgrades = host.seen.filter((s) => s.upgrade)
  assert.equal(upgrades.length, 2, '上游应收到两次握手：被拒的一次 + 换 cookie 后的重试')
  assert.ok(String(upgrades[1].cookie).includes(accepted.value), '重试要带上新 cookie')
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
  const result = await wsHandshake(proxy.port, '/api/remote.mux')

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
