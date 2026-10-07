/**
 * 插件配置的默认值与归一化。
 *
 * 归一化原则：
 * - 未知字段直接丢弃（配置里堆了历史字段也不影响运行——0.2.x 的镜像/SDK 字段就是这样退场的）
 * - 字符串 trim；数字钳制到合法区间
 * - `normalizeConfig(DEFAULT_CONFIG)` 必须稳定：结果与默认值逐键相等
 */

/** 默认配置（冻结，禁止就地修改） */
export const DEFAULT_CONFIG = Object.freeze({
  dshHome: '', // 空 = 自动探测 ~/.dsh
  // 状态通知（通知巡检）：DSH 干活时右下角出可折叠状态卡，正文点击原地展开官方界面
  noticeEnabled: true, // 右下角状态卡总开关
  noticePollMs: 2000, // 巡检轮询会话日志的间隔
  noticeDoneHoldMs: 30000, // 「已完成」卡的停留时长
  httpPort: 23457, // 卡片访问 sidecar 的本机 HTTP 端口；0 = 交给系统分配
  guiPort: 23458, // 「真 GUI」同源反代的端口；固定端口是为了让 iframe 的 origin 稳定（localStorage 状态可复用）
  /**
   * 紧凑留白：把官方留白变量与滚动区/输入框/消息间距收到小窗尺度（详见 gui-proxy.compactSurfaceRules）。
   * 独立开关——官方默认 `--dsh-composer-side-clearance: 16px`，滚动区因此每侧 32px；归零后能多出约 16px/侧宽度。
   */
  compactSpacing: false,
  // 真 GUI 的「显示哪些元素」开关（true = 显示；反代按 !showX 生成去装饰 CSS，详见 gui-proxy.buildCropCss）
  // 官方顶栏默认整条隐藏（标题由卡片那行显示）；showHeader=false 时下面几个顶栏子项无意义
  showRail: false, // 左侧 56px 图标栏
  showHeader: false, // 官方顶栏整条
  showTabs: false, // 顶栏里的「对话 / 轨迹」标签（需 showHeader=true 才有意义）
  showHeaderIcons: false, // 顶栏右侧图标簇整体（文件夹下拉 + 更多操作 + 面板开关）
  showHeaderMore: true, // 该组里的「…」（更多操作）；仅 showHeaderIcons=false 时有意义
  showHeaderPanel: true, // 该组里的面板开关（打开右侧边栏）；同上
  showHeaderTitle: false, // 官方标题（面包屑）——卡片自己那行已经显示会话标题
  showHeaderChips: true, // 顶栏里的「N 个子智能体 / N 个后台任务运行中」
  showComposerStatus: false, // 输入框下方状态条（tok/s、缓存命中、费用、上下文占比）
  showMessageMeta: false, // 每条消息的操作行（复制/点赞/分享/时间）与「本轮费用」
  showHeaderLabels: false, // 强制显示顶栏文字标签（官方在窄宽下会把它们折叠成只剩图标）
  /** 追加到反代注入样式末尾的自定义 CSS（你自己写排版用；`</style>` 会被转义） */
  customCss: '',
})

/**
 * 「显示哪些元素」的键清单（单一真相）。
 * 设置界面按它渲染标签云、`cropFlagsFor()` 按它生成反代裁剪项——
 * 任何一处漏掉某个键都会表现成"设置没用"，所以统一从这里取，并有测试锁住。
 */
export const SHOW_KEYS = [
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
]

/**
 * 其中有"裁剪项"对应的那些（true = 隐藏）：`cropFlagsFor()` 只映射这一组。
 * `showHeaderLabels` 不在其中——它不是"隐藏某元素"，而是"覆盖官方容器查询、强制显示文字标签"，
 * 所以走 `forceLabelsFor()`。
 */
export const CROP_MAPPED_KEYS = [
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
]

/** show* → 反代裁剪项（true = 隐藏），键名与 gui-proxy.buildCropCss 的参数一一对应 */
export function cropFlagsFor(cfg) {
  const source = cfg || {}
  const flags = {}
  for (const key of CROP_MAPPED_KEYS) {
    const bare = key.slice('show'.length) // Rail → rail（首字母小写）
    const flagKey = bare.charAt(0).toLowerCase() + bare.slice(1)
    flags[flagKey] = !source[key]
  }
  return flags
}

/** 是否强制显示顶栏文字标签（官方用容器查询在窄宽下折叠成只剩图标） */
export function forceLabelsFor(cfg) {
  return Boolean((cfg || {}).showHeaderLabels)
}

/** 反代输出的签名：guiPort / 任一 show* / 紧凑留白 / 自定义 CSS 变化都必须变（漏一个 → 改了设置不重建反代 → 看起来"没用"） */
export function guiSignature(cfg) {
  const source = cfg || {}
  return JSON.stringify([
    Number(source.guiPort) || 0,
    ...SHOW_KEYS.map((key) => Boolean(source[key])),
    Boolean(source.compactSpacing),
    String(source.customCss ?? ''),
  ])
}

/** 可空字符串字段：允许空串 */
const OPTIONAL_STRINGS = ['dshHome', 'customCss']
/** 布尔字段：只接受真正的布尔值 */
const BOOLEANS = ['noticeEnabled', 'compactSpacing', ...SHOW_KEYS]

/** 读取并 trim 字符串；非字符串返回 null */
function readString(raw, key) {
  const value = raw?.[key]
  return typeof value === 'string' ? value.trim() : null
}

/** 把数字钳制到 [min, max]；非有限数或非法值返回 fallback */
function clampNumber(raw, key, min, max, fallback) {
  const value = raw?.[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const rounded = Math.trunc(value)
  if (rounded < min) return min
  if (rounded > max) return max
  return rounded
}

/**
 * 归一化配置：丢弃未知字段、trim 字符串、钳制数字。
 *
 * @param {any} raw 原始配置（可能缺字段、可能含脏数据）
 * @returns {typeof DEFAULT_CONFIG} 全新对象（不改动 raw）
 */
export function normalizeConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const config = {}

  for (const key of OPTIONAL_STRINGS) {
    const value = readString(source, key)
    config[key] = value ?? DEFAULT_CONFIG[key]
  }

  for (const key of BOOLEANS) {
    config[key] = typeof source[key] === 'boolean' ? source[key] : DEFAULT_CONFIG[key]
  }

  // 状态通知：轮询间隔 / 完成卡停留时长（宿主 auto_hide 钳制是 3s..10min，这里对齐下限）
  config.noticePollMs = clampNumber(source, 'noticePollMs', 500, 30000, DEFAULT_CONFIG.noticePollMs)
  config.noticeDoneHoldMs = clampNumber(source, 'noticeDoneHoldMs', 3000, 600000, DEFAULT_CONFIG.noticeDoneHoldMs)
  // httpPort：0 合法（系统分配），越界/非法回退默认端口
  config.httpPort = clampNumber(source, 'httpPort', 0, 65535, DEFAULT_CONFIG.httpPort)
  config.guiPort = clampNumber(source, 'guiPort', 0, 65535, DEFAULT_CONFIG.guiPort)

  // 按 DEFAULT_CONFIG 的键序输出，便于快照/比较
  const ordered = {}
  for (const key of Object.keys(DEFAULT_CONFIG)) ordered[key] = config[key]
  return ordered
}
