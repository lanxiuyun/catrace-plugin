/**
 * DSH GUI 同源反向代理：把正在运行的 DSH host 的 Web GUI **原样**搬到 Catrace 能 iframe 的回环地址上。
 *
 * 为什么必须"同源代理"而不是直接 iframe `http://127.0.0.1:43120`：
 *  - webview 的 cookie 罐里没有 DSH 票据，页内 JS 也写不了 HttpOnly cookie ⇒ 直接 iframe 必 401；
 *  - 唯一能换 cookie 的 `?token=` 在桌面版拿不到（token 只在 Host 进程内存）。
 * 所以由 sidecar 代理：**服务端贴 cookie**，页面与 API 同源，SPA 自己跑起来。
 *
 * 好消息（读码+实测确认）：rc.2 的 SPA **全部用文档相对 URL**（`api/session/list`、WS 走
 * `document.baseURI`），宿主自己会插 `<base href="./">`，所以 HTML **一个字节都不用改写**，
 * 透传即可；只需改写三个头：
 *   Host   → 签发 cookie 的那个 authority（`127.0.0.1:<targetPort>`）
 *   Cookie → 我们自签的 dsh-auth-*（丢弃浏览器带来的）
 *   Origin → 删除（栅栏要求 Origin 缺省或等于 Host；带代理端口会被 403）
 * 另外不能 sandbox iframe（`Origin: null` 直接被判 cross-site 403）。
 *
 * 还有一件事（线上踩过）：自签 cookie 有寿命（7 天），凭据也可能被 DSH 重置。
 * 小窗是常驻卡片 ⇒ 代理**必须自己换 cookie**：吃到 401 就换一张新票并重放。
 * 详见下面 `AUTH_RETRIES` 的注释。
 */
import http from 'node:http'

import { cookieExpiresAt } from './dsh-gui.mjs'

/**
 * 小窗里的「去装饰」CSS。
 *
 * 关键教训（实测）：官方布局是 CSS grid `grid-template-columns: 56px 304px 0px`，
 * 对左栏用 `display:none` 会让**中间列自动落到第一轨（56px）**，输入框瞬间变 22px。
 * 正确做法是保留元素、把轨道归零，并把中间列显式钉在第二轨。
 */
/**
 * 「整理顶栏」：光隐藏元素会让剩下的东西散着（空的标题列把 chips 挤到中间、留一条空隙、行高还撑着）。
 * 这里只做减法与对齐，不改官方结构：
 *  - 标题列不再 flex:1 抢空间（它被我们藏了标题后是空的）；
 *  - 动作图标组自己贴右（多个 auto 外边距会平分空隙，所以只给第一个）；
 *  - 去掉顶栏多余的上下内边距，避免留白。
 */
function tidyHeaderRules({ iconsHidden, hidesSomething }) {
  // 行高一律收紧：官方 _titleRow / _headerLeading 各有 30px min-height，加上上下内边距就是"高头"
  const rules = [
    '[class*="_titleRow"] { min-height: 0 !important; }',
    '[class*="_headerLeading"] { min-height: 0 !important; }',
    '[class*="_header"] { min-height: 0 !important; padding-top: 0.125rem !important; padding-bottom: 0.25rem !important; }',
  ]
  // 只有在"确实藏了东西"时才动布局（空列收窄、图标贴右），避免什么都没藏还改官方排列
  if (hidesSomething) {
    rules.push(
      '[class*="_titleRow"] { align-items: center !important; gap: 0.5rem !important; }',
      '[class*="_titleRow"] [class*="_titleCluster"] { flex: 0 0 auto !important; min-width: 0 !important; }',
    )
    if (iconsHidden) {
      rules.push('[class*="_titleRow"] > [class*="_headerCorner"] { margin-left: auto !important; }')
    } else {
      rules.push(
        '[class*="_titleRow"] > [class*="_headerUtilities"] { margin-left: auto !important; }',
        '[class*="_titleRow"] > [class*="_headerCorner"] { margin-left: 0 !important; }',
      )
    }
  }
  return rules
}

/**
 * 「紧凑留白」：不改官方渲染管线，只把官方留白收到小窗尺度。
 *
 * 依据（都是从官方 CSS 里读出来的硬事实）：
 *  - `.uPhUma_body { --dsh-composer-side-clearance: 16px }`，滚动区/审批卡都是
 *    `padding: 16px calc(var(--dsh-composer-side-clearance) + 16px)` → 每侧 32px。
 *    归零即省 16px/侧（360px 窗口下约 9% 宽度）。
 *  - `--dsh-chat-content-width: var(--dsh-chat-user-width, clamp(680px, …*0.64, 920px))` 最小 680px，
 *    在 360px 里本就不生效；**故意不动它**——它还被宽表格的 `calc((100cqw - content-width)/2)` 用到，
 *    改成百分比会让那条 calc 失效（消息里的宽表格会跑版）。
 */
function compactSurfaceRules() {
  return [
    '[class*="_body"] { --dsh-composer-side-clearance: 0px !important; }',
    // 滚动区侧边留白：32px → 8px（只在对话区里生效，不碰输入框内部那个同名的 _scroll）
    '[class*="_viewArea"] [class*="_scroll"] { padding-left: 0.5rem !important; padding-right: 0.5rem !important; }',
    // 输入框贴边一点
    '[class*="_composerSeat"] { padding-left: 0.25rem !important; padding-right: 0.25rem !important; }',
    // 消息块之间的垂直间距：16px → 10px（360px 高度宝贵）
    '[class*="_body"] { gap: 0.625rem !important; }',
    // 回到底部 / 加载更早那类浮层跟着贴边
    '[class*="_toBottomSlot"] { padding-inline: 0.5rem !important; }',
  ]
}

/**
 * @param {object} flags 每一项 true = 隐藏（由 config 的 cropFlagsFor 取反而来）。
 *   顶栏内部还有细粒度项（tabs/headerIcons/headerMore/headerPanel/headerTitle/headerChips）；
 *   更细的微调走 customCss。
 * @param compactSpacing 紧凑留白（独立开关）：把官方留白收到小窗尺度
 * @param customCss 追加在最后，用户规则要能覆盖上面这些
 */
export function buildCropCss({
  rail = true,
  header = true,
  tabs = true,
  headerIcons = true,
  headerMore = false,
  headerPanel = false,
  headerTitle = true,
  headerChips = false,
  composerStatus = true,
  messageMeta = true,
  forceLabels = false,
  tidy = true,
  compactSpacing = false,
  customCss = '',
} = {}) {
  const rules = []
  if (rail) {
    rules.push(
      '[class*="_sidebarCol"] { grid-column: 1 !important; visibility: hidden !important; overflow: hidden !important; }',
      '[class*="_centerCol"] { grid-column: 2 !important; }',
      '[class*="_frame"] { grid-template-columns: 0 minmax(0, 1fr) 0 !important; }',
    )
  }
  if (header) {
    // 整条官方顶栏隐藏。用 :has 限定"含标签页的那条 header"，避免误伤消息里的 _header（文件变更块）。
    // 为什么不做"只藏子元素"：标题/图标藏掉后，剩下的 chips 在 360px 下会塌成一个孤零零的图标，
    // 而顶栏容器仍撑着高度 → 顶部出现一条又高又空的带子（实测，比整条隐藏更难看）。
    // 想自己配就把 showHeader 关掉，用下面几个细粒度开关 + tidy。
    rules.push('[class*="_header"]:has([class*="_tabs"]) { display: none !important; }')
  } else {
    const hideAll = tabs && headerIcons && headerTitle && headerChips
    if (hideAll) {
      // 顶栏里的东西全被藏了：整条一起藏，别留一条空行
      rules.push('[class*="_header"]:has([class*="_tabs"]) { display: none !important; }')
    } else {
      if (tabs) rules.push('[class*="_tabs"] { display: none !important; }')
      if (headerIcons) {
        rules.push('[class*="_headerUtilities"], [class*="_headerCorner"] { display: none !important; }')
      } else {
        // 图标簇显示时，还能单独去掉里面的「…」和面板开关（保留文件夹下拉）
        if (headerMore) rules.push('[class*="_moreButton"] { display: none !important; }')
        if (headerPanel) rules.push('[class*="_headerCorner"] { display: none !important; }')
      }
      if (headerTitle) rules.push('[class*="_header"] [class*="_crumb"] { display: none !important; }')
      if (headerChips) rules.push('[class*="_headerActions"] { display: none !important; }')
      // 只有"确实藏了东西"才整理布局；但行高一律收紧（官方顶栏本来就偏高）
      const hidesSomething = tabs || headerIcons || headerMore || headerPanel || headerTitle || headerChips
      if (tidy) rules.push(...tidyHeaderRules({ iconsHidden: headerIcons, hidesSomething }))
    }
  }
  if (composerStatus) rules.push('[class*="_dock"], .cm-stat-dock { display: none !important; }')
  if (compactSpacing) rules.push(...compactSurfaceRules())
  if (forceLabels) {
    // 官方用容器查询在窄宽下把顶栏文字标签折叠成只剩图标（实测原文）：
    //   智能体团队  @container (width<=480px){ .vhh34W_triggerLabel{display:none} }
    //   权限预设    @container (width<=460px){ .T8U3jW_trigger:has(...) .T8U3jW_triggerLabel{display:none} }
    //   智能体预设  @container (width<=540px){ .uglhVW_label{display:none} }
    // 这些 display:none 都没有 !important，所以一条 !important 就能盖回来（顺序无关）。
    rules.push(
      '[class*="_titleRow"] [class*="_triggerLabel"], [class*="_titleRow"] [class*="_label"] { display: inline-flex !important; }',
    )
  }
  if (messageMeta) {
    // 每条消息的「复制 / 点赞 / 点踩 / 分享 + 时间」行，以及「本轮费用」行。
    // 注意 [class*="_actions"] 区分大小写，只命中 jo426G_actions，不会打到 headerActions。
    rules.push('[class*="_actions"] { display: none !important; }', '.cm-note { display: none !important; }')
  }
  // 自定义 CSS 放最后：用户自己的规则要能覆盖上面这些
  const extra = String(customCss || '').trim()
  if (extra) rules.push(extra)
  return rules.join('\n')
}

/** 注入到页面里的样式：自定义 CSS 里的 `</style` 必须转义，否则能提前闭合标签 */
export function escapeStyleText(css) {
  return String(css ?? '').replace(/<\/style/gi, '<\\/style')
}

/** 逐跳头，不能转发 */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
])

/**
 * cookie 换新策略 —— 小窗"开久了变成一行 401 纯文本"的正面修法（2026-10-08 线上 bug）。
 *
 * 事实：自签 cookie 的寿命由我们定（`dsh-gui.mjs` 的 `DEFAULT_COOKIE_TTL_MS`，写死 7 天），
 * 而小窗是**常驻卡片**：票一过期，代理还是拿那张旧票去请求，上游一律回
 * `401 dsh web authentication required; reopen the URL printed by dsh web.`，
 * iframe 就把这行纯文本当页面显示出来，而且**永远不会自己好**（健康检查只探本机端口，不看上游）。
 *
 * 修法只有一道闸：**吃到 401 就换一张新票并重放**（凭据被 DSH 重置也走这条），最多 `maxAuthRetries` 次；
 * 换不到就把上游那行原文透传，绝不打转。只对**没有请求体**的请求重放 ——
 * 重试要重放 body，绝不能把上传悄悄丢掉。
 *
 * 为什么**不做"到期前主动换票"**：票有 7 天寿命、宿主上限 30 天，主动换只是把每 7 天一次的
 * "401→换票→重放"从 1 个额外往返省成 0，代价却是一套到期判断 + 每个请求都读一次票的到期时间。
 * 不划算，删了（2026-10-08 用户确认）。
 */
const AUTH_RETRIES = 2
/** 401 的响应体只留这么多（官方就一行纯文本）；超了只透传响应头，别把小窗内存吃掉 */
const AUTH_BODY_LIMIT = 64 * 1024

/** 逐跳头 / 反 framing 头剥掉，其余原样透传；顺带标出是不是 HTML（要注入的那一类） */
function filterResponseHeaders(rawHeaders) {
  const headers = {}
  let isHtml = false
  for (const [key, value] of Object.entries(rawHeaders)) {
    const lower = key.toLowerCase()
    if (HOP_BY_HOP.has(lower)) continue
    // 防御性剥掉反 framing 头（宿主当前不发，剥了无害）
    if (lower === 'x-frame-options') continue
    if (lower === 'content-security-policy' && /frame-ancestors/i.test(String(value))) continue
    headers[key] = value
    if (lower === 'content-type' && /text\/html/i.test(String(value))) isHtml = true
  }
  return { headers, isHtml }
}

/** 读完一个上游响应体（有上限）；用于"不要丢掉 401 那行话术"的场景 */
function drainBody(stream, limit) {
  return new Promise((resolve) => {
    const chunks = []
    let size = 0
    stream.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        chunks.length = 0
        return
      }
      chunks.push(chunk)
    })
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.on('error', () => resolve(Buffer.alloc(0)))
  })
}

/** 没有请求体才允许"换 cookie 后重试"（要重放的 body 绝不能丢，所以带 body 的一律不重试） */
function isBodyless(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return true
  if (req.headers['transfer-encoding']) return false
  return !Number(req.headers['content-length'] ?? 0)
}

/**
 * 我们自己的注入：会话预选（必须在应用 bundle 之前跑，bundle 是 type=module 所以 head 里的 classic script 一定更早）。
 *
 * 注意：**不要**在这里做"自愈"（补写 + 合成 storage 事件 + 重载）。实测过一版：
 * 当官方客户端自身把这次 retain 立刻 release 掉（`selection.set({})` → 落到「选择工作区」）时，
 * 补写/重载都无效，只会多刷几条 `Session reference "…" is released` 并重载页面打扰用户。
 * 详见 .agent/features/dsh-chat/README.md 的「已知隐患」。
 */
function injectionScript({ sessionId, storageKey }) {
  if (!sessionId) return ''
  const raw = JSON.stringify({ sessionId })
  return `<script>(function(){try{localStorage.setItem(${JSON.stringify(storageKey)},${JSON.stringify(
    raw,
  )});window.__CATRACE_DSH_GUI_SESSION__=${JSON.stringify(sessionId)}}catch(e){}})()</script>`
}

function injectionStyle(cssText) {
  if (!cssText) return ''
  return `<style id="catrace-dsh-gui-crop">${escapeStyleText(cssText)}</style>`
}

function externalLinksScript(externalLinkUrl) {
  if (!externalLinkUrl) return ''
  // WebView 的 window.open 不是系统默认行为；把点击 URL 送给 sidecar，由宿主 shell.open_url 调系统浏览器。
  return `<script>(function(){var endpoint=${JSON.stringify(externalLinkUrl)};document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href]');if(!a)return;var u;try{u=new URL(a.href,location.href)}catch(_){return}if((u.protocol==='http:'||u.protocol==='https:')&&u.origin!==location.origin){e.preventDefault();e.stopImmediatePropagation();fetch(endpoint+'&url='+encodeURIComponent(u.href),{method:'GET',mode:'no-cors',keepalive:true}).catch(function(){})}},true)})()</script>`
}

function injectIntoHtml(html, { sessionId, storageKey, cssText, externalLinkUrl }) {
  const markup = `${injectionStyle(cssText)}${injectionScript({ sessionId, storageKey })}${externalLinksScript(externalLinkUrl)}`
  if (!markup) return html
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${markup}</head>`)
  return `${markup}${html}`
}

/**
 * 起一个把 `<targetPort>` 的 DSH GUI 代理到本机 `<port>` 的服务器。
 *
 * @param refreshCookie 可选：`() => Promise<{name,value}|null>`，换一张新的自签 cookie。
 *   给了它，代理才具备"吃到 401 换票重放"的能力（见文件里 `AUTH_RETRIES` 的注释）。
 * @returns {Promise<{port:number, url:string, cookieRefreshes:()=>number, close:()=>Promise<void>}>}
 */
export async function startGuiProxy({
  targetPort,
  authority,
  cookie,
  port = 0,
  sessionId = '',
  storageKey = 'dsh.sessions.current',
  cssText = '',
  log = () => {},
  externalLinkUrl = '',
  refreshCookie = null,
  maxAuthRetries = AUTH_RETRIES,
} = {}) {
  let currentCookie = cookie
  let cookieRefreshes = 0
  let renewing = null

  /**
   * 换一张新 cookie：读凭据、签名、宿主不在线都可能失败。
   * **任何失败都不挡请求**（继续用旧的，让上游照常回 401，界面上的话术比"卡死"有用）。
   * 并发请求只换一次（`renewing` 去重），换不出**不同**的 cookie 就当作没换（避免 401 打转）。
   *
   * @param attempt 这是本次请求的第几次重试（0 = 第一次 401）。只作诊断信息透传给回调。
   */
  function renewCookie(reason, attempt = 0) {
    if (typeof refreshCookie !== 'function') return Promise.resolve(false)
    if (renewing) return renewing
    renewing = (async () => {
      try {
        const next = await refreshCookie({ reason, attempt, authority, targetPort, previous: currentCookie })
        if (!next || !next.name || !next.value || next.value === currentCookie?.value) return false
        currentCookie = next
        cookieRefreshes += 1
        log('info', 'GUI 代理：已更换浏览器会话 cookie', { reason, target: authority, expiresAt: cookieExpiresAt(next) })
        return true
      } catch (error) {
        log('warn', 'GUI 代理：更换 cookie 失败', { reason, error: String(error) })
        return false
      }
    })().finally(() => {
      renewing = null
    })
    return renewing
  }

  /**
   * 按字符串剥掉我们自己的 `dshw-session` 参数，其余字节保真。
   *
   * 关键：**不能**用 new URL / searchParams 重写查询串 —— 客户端的插件 bundle URL 形如
   * `/plugins/??@scope/a/client.js,@scope/b/client.js&rev=hash`，URLSearchParams 一轮往返会把
   * `@` `,` `??` 重新编码，导致模块加载全 404（实测踩过）。
   */
  function classifyRequest(rawUrl) {
    const url = String(rawUrl || '/')
    const queryIndex = url.indexOf('?')
    const rawPath = queryIndex < 0 ? url : url.slice(0, queryIndex)
    const rawQuery = queryIndex < 0 ? '' : url.slice(queryIndex + 1)

    let requestSessionId = sessionId
    let upstreamQuery = rawQuery
    if (rawQuery) {
      const kept = []
      for (const part of rawQuery.split('&')) {
        if (part === 'dshw-session') {
          requestSessionId = sessionId
          continue
        }
        if (part.startsWith('dshw-session=')) {
          try {
            requestSessionId = decodeURIComponent(part.slice('dshw-session='.length)) || sessionId
          } catch {
            /* 保持默认 */
          }
          continue
        }
        kept.push(part)
      }
      upstreamQuery = kept.join('&')
    }
    return { rawPath, requestSessionId, upstreamPath: upstreamQuery ? `${rawPath}?${upstreamQuery}` : rawPath }
  }

  /** 转发头：Host → 签发 cookie 的 authority、Cookie → 我们自签的、Origin 删掉；其余原样 */
  function upstreamHeaders(reqHeaders) {
    const headers = {}
    for (const [key, value] of Object.entries(reqHeaders)) {
      const lower = key.toLowerCase()
      if (HOP_BY_HOP.has(lower)) continue
      if (lower === 'host' || lower === 'cookie' || lower === 'origin') continue
      headers[key] = value
    }
    headers.host = authority
    headers.cookie = `${currentCookie.name}=${currentCookie.value}`
    return headers
  }

  /** 回给浏览器：HTML 走注入，其余字节流式透传 */
  function respond(upstreamRes, res, requestSessionId) {
    const { headers: responseHeaders, isHtml } = filterResponseHeaders(upstreamRes.headers)
    if (isHtml) {
      const chunks = []
      upstreamRes.on('data', (chunk) => chunks.push(chunk))
      upstreamRes.on('end', () => {
        // 会话预选脚本 + （可选）去装饰 CSS 都在首屏注入，不改动官方任何文件
        const html = injectIntoHtml(Buffer.concat(chunks).toString('utf8'), {
          sessionId: requestSessionId,
          storageKey,
          cssText,
          externalLinkUrl,
        })
        const body = Buffer.from(html, 'utf8')
        delete responseHeaders['content-length']
        responseHeaders['content-length'] = String(body.length)
        res.writeHead(upstreamRes.statusCode || 200, responseHeaders)
        res.end(body)
      })
      upstreamRes.on('error', () => res.destroy())
      return
    }
    res.writeHead(upstreamRes.statusCode || 200, responseHeaders)
    upstreamRes.pipe(res)
  }

  async function handleRequest(req, res, attempt) {
    const { rawPath, requestSessionId, upstreamPath } = classifyRequest(req.url)

    // 自带健康检查（不转发），卡片/设置页用它判断代理是否活着
    if (rawPath === '/catrace-gui-health') {
      const body = Buffer.from(
        JSON.stringify({
          ok: true,
          targetPort,
          authority,
          sessionId: requestSessionId,
          cookieExpiresAt: cookieExpiresAt(currentCookie),
          cookieRefreshes,
        }),
        'utf8',
      )
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length })
      res.end(body)
      return
    }

    const bodyless = isBodyless(req)
    const upstream = http.request(
      {
        host: '127.0.0.1',
        port: targetPort,
        method: req.method,
        path: upstreamPath,
        headers: upstreamHeaders(req.headers),
      },
      (upstreamRes) => {
        // 401 且还能再换一次 cookie：把这一行话术读下来（换不到时要原样回吐），换新后重放
        if (upstreamRes.statusCode === 401 && bodyless && attempt < maxAuthRetries && typeof refreshCookie === 'function') {
          const { headers: failHeaders } = filterResponseHeaders(upstreamRes.headers)
          drainBody(upstreamRes, AUTH_BODY_LIMIT).then(async (failBody) => {
            if (await renewCookie('401', attempt)) {
              await handleRequest(req, res, attempt + 1)
              return
            }
            delete failHeaders['content-length']
            failHeaders['content-length'] = String(failBody.length)
            res.writeHead(401, failHeaders)
            res.end(failBody)
          })
          return
        }
        respond(upstreamRes, res, requestSessionId)
      },
    )
    upstream.on('error', (error) => {
      log('warn', 'GUI 代理请求上游失败', { path: upstreamPath, error: String(error) })
      if (!res.headersSent) {
        const body = Buffer.from(JSON.stringify({ error: `DSH host unreachable: ${String(error)}` }), 'utf8')
        res.writeHead(502, { 'content-type': 'application/json', 'content-length': body.length })
        res.end(body)
      } else {
        res.destroy()
      }
    })
    // 有 body 的一律流式转发（重试要重放 body，所以这一类不参与换 cookie 重试）
    if (bodyless) upstream.end()
    else req.pipe(upstream)
  }

  const server = http.createServer((req, res) => {
    handleRequest(req, res, 0).catch((error) => {
      log('warn', 'GUI 代理处理请求失败', { path: req.url, error: String(error) })
      if (!res.headersSent) {
        const body = Buffer.from(JSON.stringify({ error: `proxy failure: ${String(error)}` }), 'utf8')
        res.writeHead(502, { 'content-type': 'application/json', 'content-length': body.length })
        res.end(body)
      } else {
        res.destroy()
      }
    })
  })

  // 升级后的 socket 不受 closeAllConnections() 管辖，必须自己记账并在 close() 时销毁，
  // 否则插件停用后连接会泄漏（也会让 server.close() 永不回调）。
  const liveSockets = new Set()
  server.on('connection', (socket) => {
    liveSockets.add(socket)
    socket.on('close', () => liveSockets.delete(socket))
  })

  async function handleUpgrade(req, socket, head, attempt) {
    const headers = {}
    for (const [key, value] of Object.entries(req.headers)) {
      const lower = key.toLowerCase()
      // 注意：upgrade 分支**不能**剥掉 connection/upgrade —— 少了它们上游只会当普通请求回一个响应，
      // 握手根本不成立（这是被测试抓到的真 bug）。只剥其余逐跳头。
      if (HOP_BY_HOP.has(lower) && lower !== 'connection' && lower !== 'upgrade') continue
      if (lower === 'host' || lower === 'cookie' || lower === 'origin') continue
      headers[key] = value
    }
    headers.host = authority
    headers.cookie = `${currentCookie.name}=${currentCookie.value}`

    const upstream = http.request({ host: '127.0.0.1', port: targetPort, method: req.method, path: req.url, headers })
    upstream.on('upgrade', (upstreamRes, upstreamSocket, upstreamHead) => {
      const lines = [`HTTP/1.1 ${upstreamRes.statusCode} ${upstreamRes.statusMessage}`]
      for (const [key, value] of Object.entries(upstreamRes.headers)) {
        if (Array.isArray(value)) for (const item of value) lines.push(`${key}: ${item}`)
        else if (value !== undefined) lines.push(`${key}: ${value}`)
      }
      socket.write(`${lines.join('\r\n')}\r\n\r\n`)
      if (upstreamHead?.length) socket.write(upstreamHead)
      if (head?.length) upstreamSocket.write(head)
      upstreamSocket.pipe(socket)
      socket.pipe(upstreamSocket)
      const destroy = () => {
        upstreamSocket.destroy()
        socket.destroy()
      }
      socket.on('error', destroy)
      socket.on('close', () => upstreamSocket.destroy())
      upstreamSocket.on('error', destroy)
    })
    upstream.on('response', (upstreamRes) => {
      // WS 也会因为 cookie 过期被挡（长驻页面的重连最常撞上）：换一张 cookie 再握一次手
      if (upstreamRes.statusCode === 401 && attempt < maxAuthRetries && typeof refreshCookie === 'function') {
        upstreamRes.resume()
        void renewCookie('401-ws', attempt).then((renewed) => {
          if (renewed) {
            void handleUpgrade(req, socket, head, attempt + 1).catch(() => socket.destroy())
            return
          }
          log('warn', 'GUI 代理 WS 升级被拒（cookie 换不到）', { path: req.url, status: 401 })
          socket.write('HTTP/1.1 401 Unauthorized\r\nconnection: close\r\n\r\n')
          socket.end()
        })
        return
      }
      // 上游拒绝升级（401/403）：把原始响应回吐，便于诊断
      log('warn', 'GUI 代理 WS 升级被拒', { path: req.url, status: upstreamRes.statusCode })
      socket.write(`HTTP/1.1 ${upstreamRes.statusCode} ${upstreamRes.statusMessage}\r\nconnection: close\r\n\r\n`)
      upstreamRes.pipe(socket)
    })
    upstream.on('error', () => socket.destroy())
    upstream.end()
  }

  // WebSocket（/api/remote.mux 等）：必须走 upgrade 分支，raw 转发
  server.on('upgrade', (req, socket, head) => {
    handleUpgrade(req, socket, head, 0).catch((error) => {
      log('warn', 'GUI 代理处理升级失败', { path: req.url, error: String(error) })
      socket.destroy()
    })
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  const actualPort = server.address().port
  log('info', 'DSH GUI 代理已就绪', { url: `http://127.0.0.1:${actualPort}/`, targetPort, sessionId })

  return {
    port: actualPort,
    url: `http://127.0.0.1:${actualPort}/`,
    /** 换过几次 cookie：设置页/排查"小窗开了很久"时用得上 */
    cookieRefreshes: () => cookieRefreshes,
    close: () =>
      new Promise((resolve) => {
        for (const socket of liveSockets) {
          try {
            socket.destroy()
          } catch {
            /* 忽略 */
          }
        }
        liveSockets.clear()
        try {
          server.closeAllConnections?.()
        } catch {
          /* 忽略 */
        }
        server.close(() => resolve())
      }),
  }
}

export { injectIntoHtml, HOP_BY_HOP }