export const KNOWN = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'StopFailure',
  'Notification',
  'PermissionRequest',
]

export const DEFAULT_MODE = {
  SessionStart: 'auto',
  UserPromptSubmit: 'auto',
  PreToolUse: 'off',
  PostToolUse: 'off',
  PostToolUseFailure: 'off',
  Stop: 'sticky',
  StopFailure: 'sticky',
  Notification: 'sticky',
  PermissionRequest: 'sticky',
}

export const EVENT_ALIASES = {
  BeforeAgent: 'UserPromptSubmit',
  AfterAgent: 'Stop',
  BeforeTool: 'PreToolUse',
  AfterTool: 'PostToolUse',
}

export const EVENT_BODY = {
  SessionStart: '会话已开始',
  UserPromptSubmit: '正在处理你的请求',
  PreToolUse: '正在调用工具',
  PostToolUse: '工具调用完成',
  PostToolUseFailure: '工具调用失败',
  Stop: '本轮任务已完成，等你继续',
  StopFailure: '执行中断，请查看终端',
  Notification: '需要你回来看一眼',
}

export const PERM_WAIT_MS = 540_000
export const DEDUP_MS = 8000
export const TITLE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const TITLE_MAX_LENGTH = 120
