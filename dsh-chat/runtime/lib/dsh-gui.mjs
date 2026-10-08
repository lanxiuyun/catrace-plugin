/**
 * 复用「正在运行的 DSH Desktop」所需的全部事实与算法。
 *
 * 为什么需要这些（都是实测/读码结论，别凭直觉改）：
 *  1. DSH 的 Web GUI 走 `POST /api/<ns>/<method>`，每个方法都要求浏览器会话 cookie；
 *     而唯一能换 cookie 的 `?token=` 在桌面版里拿不到（`cordis.patch.yml` 里 printUrl=false，
 *     token 只在 Host 进程内存里）。桌面构建里唯一可复现的路径是：
 *     **用 `$DSH_HOME/.credentials.yaml` 里 `client-connection/browser-session` 的密钥自签 cookie**。
 *  2. cookie 名与值都绑定 authority（`Host` 的 WHATWG 归一化 host[:port]），
 *     所以端口一变就等于换了一把钥匙 —— 端口必须探测，不能写死。
 *  3. 信任栅栏在鉴权之前：`Host` 必须是回环、`Origin` 要么缺省要么等于 Host、
 *     `sec-fetch-site: cross-site` 一律 403。因此代理必须改写 Host、注入 Cookie、**删掉 Origin**。
 *  4. **cookie 的寿命是我们自己定的**：宿主只校验签名、authority 与"跨度不超过它自己的上限"
 *     （`cookieMaxAgeDays`，桌面恒为默认 30 天），所以 `ttlMs` 由本模块决定 —— 写死 **7 天**
 *     （见 `DEFAULT_COOKIE_TTL_MS`）。
 *     小窗是**常驻卡片**，一旦拿着过期 cookie 去请求，上游一律 401
 *     （`dsh web authentication required; reopen the URL printed by dsh web.`），
 *     iframe 会把那行纯文本当页面显示出来 —— 所以代理必须会换新 cookie，见 `gui-proxy.mjs`。
 *
 * 参考实现（逐字对应）：`@deepseek-ai/dsh-client-connection/lib/index.js` 的
 * `cookieName()` / `signCookie()` / `isAuthenticated()`（源码版 `packages/client/connection/src/browser-auth.ts`）。
 */
import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import http from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 桌面默认端口与冲突时自动 +1..+32 的重试区间 */
export const DESKTOP_DEFAULT_PORT = 43120
export const DESKTOP_MAX_PORT_DRIFT = 32
/**
 * 自签 cookie 的寿命：**写死 7 天**。
 *
 * 宿主只要求"跨度 = expiresAt - issuedAt ≤ 它自己的 cookieMaxAgeDays"（DSH 桌面恒为默认 **30 天**：
 * 桌面版没有这个开关，`~/.dsh/profiles/desktop/cordis.patch.yml` 里也没有），所以 7 天既有余量、
 * 也不必去猜或去探（曾经按"偏好值 + 逐级退让"探过上限，结论是没必要）。
 *
 * 到期也不会坏：反代吃到 401 会换一张新票重放，见 `gui-proxy.mjs`。
 */
export const DEFAULT_COOKIE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const CREDENTIAL_RECORD = 'client-connection/browser-session'

function b64url(input) {
  return Buffer.from(input).toString('base64url')
}

/** 规范化 authority：与 `new URL('http://' + host).host` 等价 */
export function normalizeAuthority(host) {
  return new URL(`http://${host}`).host
}

export function cookieNameFor(authority) {
  return `dsh-auth-${b64url(createHash('sha256').update(authority).digest())}`
}

/**
 * 自签一个 DSH 浏览器会话 cookie。
 * 注意：HMAC 覆盖的是 **base64url 之后的 body 字符串**，不是原始 JSON（最容易写错的地方）。
 * 返回值带上 `issuedAt` / `expiresAt`：反代要靠它决定"是不是该换新的了"。
 */
export function mintAuthCookie({ secret, authority, now = Date.now(), ttlMs = DEFAULT_COOKIE_TTL_MS }) {
  const secretBytes = Buffer.from(secret, 'base64url')
  if (secretBytes.length !== 32) throw new Error(`browser-session 密钥必须是 32 字节，实际 ${secretBytes.length}`)
  const canonical = normalizeAuthority(authority)
  const payload = {
    version: 1,
    authority: canonical,
    issuedAt: now - 5000,
    expiresAt: now + ttlMs,
  }
  const body = b64url(JSON.stringify(payload))
  const signature = createHmac('sha256', secretBytes).update(body).digest()
  return {
    name: cookieNameFor(canonical),
    value: `v1.${body}.${b64url(signature)}`,
    authority: canonical,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
  }
}

/**
 * 读出一张自签 cookie 的到期时刻（毫秒）。
 *
 * 为什么不需要密钥：payload 是**明文** base64url（签名只保证不可伪造），
 * 我们只拿它当"该不该换新"的提示，不参与任何鉴权判断，所以不必验签。
 * 解不出来（不是我们的 cookie / 被改坏）就返回 null，调用方按"不刷新"处理。
 */
export function cookieExpiresAt(cookie) {
  const value = typeof cookie === 'string' ? cookie : cookie?.value
  if (!value) return null
  const body = value.split('.')[1]
  if (!body) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    return Number.isSafeInteger(payload?.expiresAt) ? payload.expiresAt : null
  } catch {
    return null
  }
}

/** 从 .credentials.yaml 里取 browser-session 记录（只取出 secret 字段，不做通用 YAML 解析） */
export function parseBrowserSessionSecret(yamlText) {
  const lines = String(yamlText).split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === `${CREDENTIAL_RECORD}:`)
  if (start < 0) return null
  for (let i = start + 1; i < Math.min(start + 12, lines.length); i += 1) {
    if (/^\s{0,2}\S/.test(lines[i])) break // 到下一个顶层记录
    const match = lines[i].match(/^\s+secret:\s*(\S+)\s*$/)
    if (match) return match[1]
  }
  return null
}

export function readBrowserSessionSecret({ dshHome } = {}) {
  const home = dshHome || process.env.DSH_HOME || join(homedir(), '.dsh')
  const file = join(home, '.credentials.yaml')
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return null
  }
  return parseBrowserSessionSecret(text)
}

/** 极简 POST /api：只用于探活（返回 {status, ok, value, error}） */
export function callApi({ port, cookie, method, args = {}, timeoutMs = 5000, host = '127.0.0.1' }) {
  const requestBody = JSON.stringify({
    type: 'client-request',
    rpcId: `probe_${Math.random().toString(36).slice(2)}`,
    method,
    payload: { args },
  })
  return new Promise((resolve) => {
    const req = http.request(
      {
        host,
        port,
        method: 'POST',
        path: `/api/${method}`,
        timeout: timeoutMs,
        headers: {
          Host: cookie.authority ?? `${host}:${port}`,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(requestBody),
          ...(cookie ? { cookie: `${cookie.name}=${cookie.value}` } : {}),
        },
      },
      (res) => {
        let text = ''
        res.on('data', (chunk) => {
          text += chunk
        })
        res.on('end', () => {
          let parsed = null
          try {
            parsed = JSON.parse(text)
          } catch {
            /* 401/403 会是空体或 HTML */
          }
          resolve({
            status: res.statusCode,
            ok: parsed?.result?.ok ?? null,
            value: parsed?.result?.value,
            error: parsed?.result?.error ?? null,
            // 原文留一小段：403 时宿主回的是纯文本 `forbidden`，要靠它区分"准入被拒"和"没这个 host"
            body: text.slice(0, 120),
          })
        })
      },
    )
    req.on('timeout', () => {
      req.destroy()
      resolve({ status: 0, ok: null, value: null, error: { code: 'timeout' } })
    })
    req.on('error', (error) => resolve({ status: 0, ok: null, value: null, error: { code: 'unreachable', message: String(error) } }))
    req.end(requestBody)
  })
}

/**
 * 找到一个「活着且能认证」的 DSH host：从 43120 起按桌面自身的 +1..+32 漂移区间逐个探活。
 * 每个端口都要用**该端口对应的 authority** 重新签 cookie（cookie 绑定 authority）。
 *
 * 票寿命就是 `DEFAULT_COOKIE_TTL_MS`（写死 7 天），不做任何"问宿主上限"的探测：
 * 宿主上限恒为 30 天，7 天不会越界；真到期了由反代在吃到 401 时换票重放。
 *
 * @param diag 可选：把每个端口的探测结果收进来，供调用方给出**能执行的**失败原因（而不是一律"没找到 host"）。
 * @param ttlMs 可选：覆盖票寿命（默认不用；测试用毫秒级寿命把"过期→换票"跑成确定性用例）。
 * @returns `{port, authority, cookie, ttlMs, sessions}`；`ttlMs` 是这张票实际用的寿命。
 */
export async function discoverHost({ secret, from = DESKTOP_DEFAULT_PORT, drift = DESKTOP_MAX_PORT_DRIFT, now = Date.now(), diag, ttlMs } = {}) {
  const ticketTtlMs = ttlMs === undefined ? DEFAULT_COOKIE_TTL_MS : ttlMs
  for (let port = from; port <= from + drift; port += 1) {
    const authority = `127.0.0.1:${port}`
    const cookie = mintAuthCookie({ secret, authority, now, ttlMs: ticketTtlMs })
    const probe = await callApi({ port, cookie, method: 'session/list', args: { _request: {} } })
    if (Array.isArray(diag)) diag.push({ port, status: probe.status, body: probe.body ?? '' })
    if (probe.status === 200 && probe.ok === true) {
      return {
        port,
        authority,
        cookie,
        ttlMs: ticketTtlMs,
        sessions: probe.value?.items?.length ?? 0,
      }
    }
  }
  return null
}

/**
 * 把 discoverHost 的探测记录翻译成**能执行的**失败原因。
 *
 * 背景（DSH 桌面版新增的准入栅栏，`desktop-browser-access`）：
 * 每个 Desktop 代次会随机生成一个 32 字节 token，只交给 Electron 渲染器的网络会话（请求头
 * `x-dsh-desktop-renderer`）。其它进程（包括本插件的反代）拿不到这个 token，
 * 于是被 `rejectBrowserRequest()` 以 **403 纯文本 `forbidden`** 拒掉——
 * 唯一出路是用户在桌面版里开启「允许在浏览器中打开」。
 */
export function describeDiscoveryFailure(diag = []) {
  const entries = Array.isArray(diag) ? diag : []
  if (entries.some((e) => e.status === 403)) {
    return 'DSH 桌面版拒绝了非渲染器请求（403 forbidden）：这是桌面版的准入栅栏。请在 DSH 桌面版 →「设置浏览器访问」→ 打开「允许在浏览器中打开」（设备范围选"只有这台电脑上的浏览器"）；提示里说明浏览器访问仅在兼容模式下可用，可能要把该 Profile 切成兼容模式。'
  }
  if (entries.some((e) => e.status === 401)) {
    return '凭据被拒（401）：~/.dsh/.credentials.yaml 里的会话密钥与宿主当前用的不一致（DSH 重置过凭据，或本插件读的不是同一个 DSH 数据目录）。请确认插件设置里的 DSH 数据目录，必要时在 DSH 桌面版重新执行一次「在浏览器中打开」刷新凭据，然后重试。'
  }
  if (entries.length > 0 && entries.every((e) => e.status === 0)) {
    return '没找到正在运行的 DSH host（默认 43120，含 +32 漂移）；请确认 DSH Desktop 在运行'
  }
  return '没找到可用的 DSH host（默认 43120，含 +32 漂移）；请确认 DSH Desktop 在运行，并已开启「允许在浏览器中打开」'
}
