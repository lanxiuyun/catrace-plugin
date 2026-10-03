/**
 * sdk-client.mjs —— dsh SDK stdio 协议（换行分隔 JSON-RPC 2.0）的极简客户端。
 *
 * 协议事实（本机实测：`dsh --profile sdk`）：
 *  - 客户端请求：initialize / session/prompt / shutdown
 *  - 服务端通知：session.event / session.status / subagent.started / subagent.finished
 *  - stdout 只承载协议帧，诊断信息走 stderr
 *  - 没有会话列表 / 历史读取 / resume / 审批通道
 *
 * 设计要点：
 *  - UTF-8 分帧用 StringDecoder，容忍分块截断、CRLF、不完整行与垃圾行；
 *  - data 处理器里绝不抛异常（抛出去会变成 uncaughtException）；
 *  - 本模块永不写 stdout（sidecar 的 stdout 是它自己的 JSONL 协议）。
 */
import { spawn as defaultSpawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { buildSpawnPlan, resolveDshCommand } from './spawn-plan.mjs'

/** 会话关闭 / 初始化缺失的固定文案（测试与上层都依赖这些字符串）。 */
const CLOSED_MESSAGE = '会话已关闭'
const NOT_STARTED_MESSAGE = 'SDK 会话尚未初始化'
const STDERR_CHUNK_LIMIT = 2000

/** 造一个带附加字段的 Error（用于保留 JSON-RPC 的 code / data）。 */
function makeError(message, extra = null) {
  const err = new Error(message)
  if (extra && typeof extra === 'object') {
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined) err[key] = value
    }
  }
  return err
}

/** 取一个「不会长期挂住事件循环」的定时器。 */
function setTimer(fn, ms) {
  const timer = setTimeout(fn, ms)
  if (typeof timer.unref === 'function') timer.unref()
  return timer
}

export class DshSdkClient {
  #command
  #args
  #cwd
  #env
  #requestTimeoutMs
  #shutdownTimeoutMs
  #spawnFn
  #onLog
  #onSessionEvent
  #onStatus
  #onSubagentStarted
  #onSubagentFinished

  #child = null
  #decoderOut = null
  #decoderErr = null
  #outBuf = ''
  #pending = new Map()
  #nextId = 1
  #started = false
  #handshake = null
  #startupPromise = null
  #shutdownPromise = null
  #closing = false
  #exited = false
  #sessionId = null
  #lastError = null
  #promptChain = Promise.resolve()

  /**
   * @param {object} options
   * @param {string} [options.command='dsh']  已解析的命令（通常是 resolveDshCommand 的结果）
   * @param {string[]} [options.args]         默认 ['--profile', <profile>, ...(patchFile ? ['--patch', patchFile] : [])]
   * @param {string} [options.profile='sdk']  未显式给 args 时用于拼默认参数
   * @param {string|null} [options.patchFile] 未显式给 args 时用于拼默认参数
   * @param {string} [options.cwd=process.cwd()]
   * @param {Record<string,string>} [options.env] 额外环境变量（合并到 process.env 之上）
   * @param {number} [options.requestTimeoutMs=120000]
   * @param {number} [options.shutdownTimeoutMs=8000]
   * @param {Function} [options.spawnFn]      测试注入（默认 node:child_process.spawn）
   * @param {Function} [options.onLog]
   * @param {Function} [options.onSessionEvent]
   * @param {Function} [options.onStatus]
   * @param {Function} [options.onSubagentStarted]
   * @param {Function} [options.onSubagentFinished]
   */
  constructor(options = {}) {
    const profile = typeof options.profile === 'string' && options.profile.trim() !== '' ? options.profile : 'sdk'
    const patchFile = typeof options.patchFile === 'string' && options.patchFile !== '' ? options.patchFile : null

    this.#command = typeof options.command === 'string' && options.command.trim() !== '' ? options.command : 'dsh'
    this.#args = Array.isArray(options.args)
      ? options.args.map((a) => String(a))
      : ['--profile', profile, ...(patchFile ? ['--patch', patchFile] : [])]
    this.#cwd = typeof options.cwd === 'string' && options.cwd !== '' ? options.cwd : process.cwd()
    this.#env = options.env && typeof options.env === 'object' ? { ...options.env } : {}
    this.#requestTimeoutMs = Number.isFinite(options.requestTimeoutMs) && options.requestTimeoutMs > 0
      ? options.requestTimeoutMs
      : 120000
    this.#shutdownTimeoutMs = Number.isFinite(options.shutdownTimeoutMs) && options.shutdownTimeoutMs > 0
      ? options.shutdownTimeoutMs
      : 8000
    this.#spawnFn = typeof options.spawnFn === 'function' ? options.spawnFn : defaultSpawn
    this.#onLog = typeof options.onLog === 'function' ? options.onLog : () => {}
    this.#onSessionEvent = typeof options.onSessionEvent === 'function' ? options.onSessionEvent : () => {}
    this.#onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {}
    this.#onSubagentStarted = typeof options.onSubagentStarted === 'function' ? options.onSubagentStarted : () => {}
    this.#onSubagentFinished = typeof options.onSubagentFinished === 'function' ? options.onSubagentFinished : () => {}
  }

  /** initialize 是否成功。 */
  get started() {
    return this.#started
  }

  /** 子进程是否仍存活。 */
  get alive() {
    const child = this.#child
    if (!child || this.#exited) return false
    return child.exitCode === null && child.signalCode === null
  }

  /** 本客户端创建的会话 id（prompt 之前为 null）。 */
  get sessionId() {
    return this.#sessionId
  }

  /** 最近一次错误对象或 null。 */
  get lastError() {
    return this.#lastError
  }

  /**
   * 启动子进程并完成 initialize。已启动时直接返回缓存的握手结果（幂等）。
   * @returns {Promise<object>} initialize 的结果对象
   */
  async start({ provider, model, reasoningEffort, maxTokens, cwd } = {}) {
    if (this.#started) return this.#handshake
    if (this.#startupPromise) return this.#startupPromise

    this.#startupPromise = this.#doStart({ provider, model, reasoningEffort, maxTokens, cwd }).catch((err) => {
      // 握手失败：清掉缓存的 promise，允许上层修正配置后重试（子进程已在 #doStart 里清掉）。
      this.#startupPromise = null
      throw err
    })
    return this.#startupPromise
  }

  async #doStart({ provider, model, reasoningEffort, maxTokens, cwd }) {
    if (typeof provider !== 'string' || provider.trim() === '') {
      throw makeError('provider 必须是非空字符串（如 deepseek-account）')
    }
    if (typeof model !== 'string' || model.trim() === '') {
      throw makeError('model 必须是非空字符串（如 deepseek-flash）')
    }
    const params = {
      cwd: path.resolve(typeof cwd === 'string' && cwd !== '' ? cwd : this.#cwd),
      provider,
      model,
    }
    if (reasoningEffort !== undefined && reasoningEffort !== null) {
      if (typeof reasoningEffort !== 'string' || reasoningEffort.trim() === '') {
        throw makeError('reasoningEffort 必须是非空字符串')
      }
      params.reasoningEffort = reasoningEffort
    }
    if (maxTokens !== undefined && maxTokens !== null) {
      if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0) {
        throw makeError('maxTokens 必须是正整数')
      }
      params.maxTokens = maxTokens
    }

    this.#spawnChild()
    try {
      const result = await this.#request('initialize', params)
      this.#started = true
      this.#handshake = result
      this.#log('info', 'dsh SDK 握手完成')
      return result
    } catch (err) {
      this.#lastError = err
      // 初始化失败时把子进程收掉，避免留下一个没人管的 dsh 进程。
      this.kill()
      throw err
    }
  }

  /**
   * 发送一条文本提示；首次调用时自动生成 sessionId（'session-' + 16 位随机 hex）。
   * 多次并发调用会串行排队，各自拿到自己的 messageId。
   * @returns {Promise<{messageId: string, sessionId: string}>}
   */
  async prompt(text, { sessionId } = {}) {
    if (!this.#started) throw makeError(NOT_STARTED_MESSAGE)
    if (this.#closing) throw makeError(CLOSED_MESSAGE)

    const content = typeof text === 'string' ? text : String(text ?? '')
    const run = () => this.#doPrompt(content, sessionId)
    // 串行化：上一次失败也让后面的继续排队（用 run 兜住 rejected 分支）。
    const next = this.#promptChain.then(run, run)
    this.#promptChain = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  async #doPrompt(content, sessionId) {
    if (!this.#sessionId) {
      this.#sessionId = typeof sessionId === 'string' && sessionId !== '' ? sessionId : this.#newSessionId()
    }
    const sid = typeof sessionId === 'string' && sessionId !== '' ? sessionId : this.#sessionId
    const result = await this.#request('session/prompt', {
      sessionId: sid,
      contentBlocks: [{ type: 'text', text: content }],
    })
    return { messageId: result ? result.messageId : undefined, sessionId: sid }
  }

  #newSessionId() {
    return `session-${randomBytes(8).toString('hex')}`
  }

  /** 优雅关闭：先发 shutdown 请求（忽略失败），再等待退出，超时后 kill。幂等。 */
  async shutdown() {
    if (this.#shutdownPromise) return this.#shutdownPromise
    this.#shutdownPromise = this.#doShutdown().catch((err) => {
      this.#log('warn', `关闭 SDK 会话时出错：${err && err.message ? err.message : String(err)}`)
    })
    return this.#shutdownPromise
  }

  async #doShutdown() {
    this.#closing = true
    // 先按契约拒绝所有在途请求（shutdown 自身请求稍后单独发出）。
    this.#rejectAllPending(CLOSED_MESSAGE)

    const child = this.#child
    if (!child || this.#exited) return

    try {
      await this.#request('shutdown', {}, { timeoutMs: this.#shutdownTimeoutMs })
    } catch (err) {
      this.#log('warn', `shutdown 请求未成功：${err && err.message ? err.message : String(err)}`)
    }

    if (!(await this.#waitForExit(this.#shutdownTimeoutMs))) {
      this.#log('warn', `shutdown 超时（${this.#shutdownTimeoutMs}ms），强制终止子进程`)
      try {
        child.kill()
      } catch (err) {
        this.#log('warn', `终止子进程失败：${err && err.message ? err.message : String(err)}`)
      }
      await this.#waitForExit(2000)
    }
  }

  /** 不打招呼直接终止进程（用户「停止」按钮 / 插件禁用兜底）。可重复调用。 */
  kill() {
    this.#closing = true
    const child = this.#child
    this.#rejectAllPending(CLOSED_MESSAGE)
    if (!child || this.#exited || child.killed) return
    try {
      const ok = child.kill()
      this.#log('info', ok ? '已向 dsh 子进程发送终止信号' : '终止信号未生效（进程可能已退出）')
    } catch (err) {
      this.#log('warn', `kill 失败：${err && err.message ? err.message : String(err)}`)
    }
  }

  // ---------------------------------------------------------------- 子进程

  #spawnChild() {
    const env = { ...process.env, ...this.#env }
    const resolved = resolveDshCommand(this.#command, { platform: process.platform, env })
    const plan = buildSpawnPlan(resolved, this.#args, { platform: process.platform })
    const spawnFn = this.#spawnFn

    this.#log('info', `启动 dsh SDK 子进程：${plan.command} ${plan.args.join(' ')}`)
    const child = spawnFn(plan.command, plan.args, {
      ...plan.options,
      cwd: this.#cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })

    this.#child = child
    this.#exited = false
    // 新子进程意味着重新开工：上一次失败时 kill() 留下的 #closing 必须复位，
    // 否则重试成功后 prompt() 会被误判为「会话已关闭」。
    this.#closing = false
    this.#decoderOut = new StringDecoder('utf8')
    this.#decoderErr = new StringDecoder('utf8')
    this.#outBuf = ''

    if (child.stdout) child.stdout.on('data', (chunk) => this.#onStdoutChunk(chunk))
    if (child.stderr) child.stderr.on('data', (chunk) => this.#onStderrChunk(chunk))
    if (child.stdin) {
      child.stdin.on('error', (err) => {
        this.#log('warn', `stdin 写入失败：${err && err.message ? err.message : String(err)}`)
      })
    }
    child.on('error', (err) => this.#onChildError(err))
    child.on('exit', (code, signal) => this.#onChildExit(code, signal))
  }

  #onChildError(err) {
    this.#exited = true
    this.#lastError = err
    const detail = err && err.message ? err.message : String(err)
    this.#log('warn', `dsh 子进程启动失败：${detail}`)
    this.#rejectAllPending(makeError(`SDK 子进程不可用：${detail}`))
  }

  #onChildExit(code, signal) {
    this.#exited = true
    const detail = `SDK 子进程已退出（code=${code === null ? 'null' : code}, signal=${signal || 'none'}）`
    this.#log('warn', detail)
    this.#rejectAllPending(detail)
  }

  /** 等待子进程退出；已退出立即返回 true。 */
  #waitForExit(timeoutMs) {
    const child = this.#child
    if (!child || this.#exited || child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)

    return new Promise((resolve) => {
      let settled = false
      let timer = null
      const onExit = () => finish(true)
      const finish = (ok) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        child.removeListener('exit', onExit)
        resolve(ok)
      }
      timer = setTimer(() => finish(false), timeoutMs)
      child.once('exit', onExit)
    })
  }

  // ---------------------------------------------------------------- stdout 分帧

  #onStdoutChunk(chunk) {
    try {
      this.#outBuf += this.#decoderOut.write(chunk)
      let index = this.#outBuf.indexOf('\n')
      while (index !== -1) {
        const raw = this.#outBuf.slice(0, index)
        this.#outBuf = this.#outBuf.slice(index + 1)
        const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
        if (line.trim() !== '') this.#handleLine(line)
        index = this.#outBuf.indexOf('\n')
      }
    } catch (err) {
      // data 处理器里绝不外抛：外抛会变成 uncaughtException 直接崩掉 sidecar。
      this.#log('warn', `处理 stdout 数据失败：${err && err.message ? err.message : String(err)}`)
    }
  }

  #onStderrChunk(chunk) {
    try {
      const text = this.#decoderErr ? this.#decoderErr.write(chunk) : String(chunk)
      const trimmed = text.replace(/\r/g, '').trim()
      if (trimmed === '') return
      this.#log('warn', trimmed.length > STDERR_CHUNK_LIMIT ? `${trimmed.slice(0, STDERR_CHUNK_LIMIT)}…` : trimmed)
    } catch (err) {
      this.#log('warn', `处理 stderr 数据失败：${err && err.message ? err.message : String(err)}`)
    }
  }

  #handleLine(line) {
    let frame
    try {
      frame = JSON.parse(line)
    } catch {
      this.#log('warn', '忽略无法解析的 stdout 行', { line: line.slice(0, 400) })
      return
    }
    if (!frame || typeof frame !== 'object') {
      this.#log('warn', '忽略非对象的协议帧', { line: line.slice(0, 400) })
      return
    }

    const hasId = frame.id !== undefined && frame.id !== null
    // 响应帧：有 id 且没有 method
    if (hasId && typeof frame.method !== 'string') {
      const pending = this.#pending.get(frame.id)
      if (!pending) {
        this.#log('warn', `收到未知 id 的响应帧：${String(frame.id)}`)
        return
      }
      this.#pending.delete(frame.id)
      if (pending.timer) clearTimeout(pending.timer)

      if (frame.error) {
        const code = frame.error.code
        const message = frame.error.message || '未知错误'
        const err = makeError(`JSON-RPC 错误（${pending.method}）：${code === undefined ? '' : `${code} `}${message}`, {
          code,
          data: frame.error.data,
        })
        this.#lastError = err
        pending.reject(err)
      } else {
        pending.resolve(frame.result === undefined ? {} : frame.result)
      }
      return
    }

    if (typeof frame.method === 'string') {
      if (hasId) {
        // 服务端反向请求：本协议没有审批通道，不支持就直接忽略（不写 stdout）。
        this.#log('warn', `忽略不支持的服务端请求：${frame.method}`)
        return
      }
      this.#handleNotification(frame.method, frame.params !== undefined ? frame.params : frame)
      return
    }

    this.#log('warn', '忽略无法识别的协议帧', { line: line.slice(0, 400) })
  }

  #handleNotification(method, params) {
    try {
      switch (method) {
        case 'session.event':
          this.#onSessionEvent(params ? params.event : undefined, { sessionId: params ? params.sessionId : undefined })
          break
        case 'session.status':
          this.#onStatus({ sessionId: params ? params.sessionId : undefined, status: params ? params.status : undefined })
          break
        case 'subagent.started':
          this.#onSubagentStarted({
            parentSessionId: params ? params.parentSessionId : undefined,
            childSessionId: params ? params.childSessionId : undefined,
          })
          break
        case 'subagent.finished':
          this.#onSubagentFinished(params || {})
          break
        default:
          this.#log('info', `忽略未处理的通知：${method}`)
          break
      }
    } catch (err) {
      this.#log('warn', `通知回调抛出异常（${method}）：${err && err.message ? err.message : String(err)}`)
    }
  }

  // ---------------------------------------------------------------- 请求 / 生命周期

  #request(method, params, { timeoutMs = this.#requestTimeoutMs } = {}) {
    return new Promise((resolve, reject) => {
      const child = this.#child
      if (!child || !child.stdin || this.#exited) {
        const err = makeError('SDK 子进程不可用（尚未启动或已退出）')
        this.#lastError = err
        reject(err)
        return
      }

      const id = this.#nextId++
      const timer = setTimer(() => {
        this.#pending.delete(id)
        const err = makeError(`请求 ${method} 超时（${timeoutMs}ms）`)
        this.#lastError = err
        reject(err)
      }, timeoutMs)

      this.#pending.set(id, { resolve, reject, timer, method })

      const payload = `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`
      try {
        child.stdin.write(payload)
      } catch (err) {
        this.#pending.delete(id)
        clearTimeout(timer)
        this.#lastError = err
        reject(err)
      }
    })
  }

  #rejectAllPending(reason) {
    if (this.#pending.size === 0) return
    const entries = [...this.#pending.entries()]
    this.#pending.clear()
    for (const [, pending] of entries) {
      if (pending.timer) clearTimeout(pending.timer)
      const err = reason instanceof Error ? reason : makeError(reason)
      try {
        pending.reject(err)
      } catch {
        // reject 不会抛，这里只是兜底
      }
    }
  }

  #log(level, message, data) {
    try {
      this.#onLog(data === undefined ? { level, message } : { level, message, data })
    } catch {
      // 日志回调自身的异常不影响协议处理
    }
  }
}

export default DshSdkClient
