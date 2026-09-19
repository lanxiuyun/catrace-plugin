import fs from 'node:fs'
import path from 'node:path'
import { EVENT_ALIASES, TITLE_CACHE_TTL_MS, TITLE_MAX_LENGTH } from './constants.mjs'

export function projectName(cwd) {
  if (!cwd) return ''
  const parts = String(cwd).replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || ''
}

export function firstString(...values) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() || ''
}

export function cacheKey(agentId, sessionId) {
  return `${agentId || 'unknown'}:${sessionId || 'unknown'}`
}

export function cleanTitle(value, maxLength = TITLE_MAX_LENGTH) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}

export function createTitleCache({ cachePath, log } = {}) {
  const titleCache = new Map()

  function loadTitleCache() {
    try {
      const raw = JSON.parse(fs.readFileSync(cachePath, 'utf8'))
      const now = Date.now()
      for (const [key, value] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
        if (value && typeof value.title === 'string' && now - Number(value.ts || 0) < TITLE_CACHE_TTL_MS) {
          titleCache.set(key, { title: value.title, ts: Number(value.ts), pinned: value.pinned === true })
        }
      }
    } catch {
      /* cache is optional */
    }
  }

  function saveTitleCache() {
    try {
      const now = Date.now()
      const out = {}
      for (const [key, value] of titleCache) {
        if (now - value.ts < TITLE_CACHE_TTL_MS) out[key] = value
      }
      fs.mkdirSync(path.dirname(cachePath), { recursive: true })
      fs.writeFileSync(cachePath, `${JSON.stringify(out, null, 2)}\n`, 'utf8')
    } catch (error) {
      if (log) log('save title cache failed', { error: String(error) }, 'warn')
    }
  }

  // 会话标题优先级：payload.session_title（--name、/rename 或宿主自动命名，pinned，
  // 不被 prompt 覆盖）> 缓存 > UserPromptSubmit 首条 prompt 填空（非 pinned，定名后
  // 不随后续 prompt 变化）。不读 transcript：各家落盘滞后，ZCode 的 transcript_path
  // 还是一次性临时目录，metadata.json 永远不在旁边。
  function deriveSessionTitle(payload, agentId, sessionId, event) {
    const key = cacheKey(agentId, sessionId)
    const explicit = cleanTitle(payload.session_title || payload.sessionTitle)
    if (explicit) {
      const cached = titleCache.get(key)
      if (!cached || !cached.pinned || cached.title !== explicit) {
        titleCache.set(key, { title: explicit, ts: Date.now(), pinned: true })
        saveTitleCache()
      }
      return explicit
    }
    const cached = titleCache.get(key)
    if (cached && Date.now() - cached.ts < TITLE_CACHE_TTL_MS) return cached.title
    if (event === 'UserPromptSubmit') {
      const fromPrompt = cleanTitle(payload.prompt)
      if (fromPrompt) {
        titleCache.set(key, { title: fromPrompt, ts: Date.now(), pinned: false })
        saveTitleCache()
        return fromPrompt
      }
    }
    return ''
  }

  return { loadTitleCache, deriveSessionTitle }
}

export function normalizeHookData(raw, agentId = 'unknown', deriveSessionTitle = () => '') {
  const rawEvent = raw.event || raw.hook_event_name || raw.hookEventName || ''
  const event = EVENT_ALIASES[rawEvent] || rawEvent
  const sessionId = firstString(raw.session_id, raw.sessionId) || 'unknown'
  const cwd = firstString(raw.cwd, raw.working_directory)
  const sessionTitle = deriveSessionTitle(raw, agentId, sessionId, event)
  let message = firstString(
    raw.last_assistant_message,
    raw.lastAssistantMessage,
    raw.responsePreview,
    raw.response_preview,
    raw.responseText,
    raw.response_text,
    raw.prompt,
  )
  // UserPromptSubmit 的标题就是 prompt 摘要时，正文不再回显同一句
  if (event === 'UserPromptSubmit' && message && cleanTitle(message) === sessionTitle) message = ''
  const normalizedAgentId = agentId !== 'unknown' ? agentId : raw.agentId || 'unknown'
  return {
    agentId: normalizedAgentId,
    event,
    sessionId,
    sessionTitle,
    projectName: projectName(cwd),
    cwd,
    timestamp: firstString(raw.timestamp, raw.created_at) || new Date().toISOString(),
    message,
    hookPpid: Number(raw.catrace_hook_ppid ?? raw.hook_ppid) || 0,
    permission: event === 'PermissionRequest' ? {
      toolName: firstString(raw.tool_name, raw.toolName, raw.name) || '工具调用',
      toolInput: raw.tool_input ?? raw.toolInput,
    } : undefined,
    raw,
  }
}

export function cardTitle(entry) {
  const named = entry.sessionTitle && String(entry.sessionTitle).trim()
  if (named) return named
  return entry.projectName || projectName(entry.cwd) || 'AI 助手'
}

export function cardBody(entry, eventBody = {}) {
  return entry.message || eventBody[entry.event] || '状态已更新'
}
