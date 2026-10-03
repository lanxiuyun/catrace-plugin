/**
 * 官方 GUI 的 class 速查表（给「自定义样式（CSS）」用）。
 *
 * 为什么要这份表：官方 class 是 CSS Module 生成的哈希前缀 + 语义后缀（例如 `uPhUma_titleRow`、
 * `Q7WfXG_dock`），每次构建都会变，所以只能用 `[class*="_titleRow"]` 这种"语义后缀"匹配。
 * 用户想自己改样式时，光给个输入框等于让他猜——这份表就是"能改哪些东西"的索引，
 * 设置页会把它列出来并支持一键插入规则骨架。
 *
 * 表里每一项都经过 360px 实测 DOM 核对（`[class*="_xxx"]` 确实能命中）；名字带 **粗体注意** 的，
 * 说明选择器偏宽、要配合限定条件用。
 */
export const GUI_CLASS_GROUPS = [
  {
    title: '整体布局',
    hint: '官方布局是 CSS grid，隐藏左栏要"轨道归零"而不是 display:none（否则中间列会掉到 56px 轨道）',
    items: [
      { selector: '[class*="_frame"]', desc: 'CSS grid 容器（grid-template-columns: 左栏 中间列 右栏）' },
      { selector: '[class*="_sidebarCol"]', desc: '左栏图标栏那一列（56px）；隐藏要配 _frame 的 grid-template-columns' },
      { selector: '[class*="_centerCol"]', desc: '中间列（对话 + 输入框都在这里）' },
    ],
  },
  {
    title: '官方顶栏',
    hint: '注意 [class*="_header"] 会同时命中 _headerCorner/_headerUtilities/_headerLeading，也会命中消息里文件变更块的 header',
    items: [
      { selector: '[class*="_header"]:has([class*="_tabs"])', desc: '顶栏整条（用 :has 限定，避免误伤消息里的 header）' },
      { selector: '[class*="_headerLeading"]', desc: '顶栏左侧留白区' },
      { selector: '[class*="_titleRow"]', desc: '顶栏那一行（flex：标题列 + chips + 右侧图标）' },
      { selector: '[class*="_titleCluster"]', desc: '标题列（flex:1，会吃掉剩余空间）' },
      { selector: '[class*="_crumb"]', desc: '会话标题' },
      { selector: '[class*="_tabs"]', desc: '「对话 / 轨迹」标签行' },
      { selector: '[class*="_headerActions"]', desc: '「N 个子智能体」「N 个后台任务运行中」chips' },
      { selector: '[class*="_headerUtilities"]', desc: '右侧图标组（文件夹下拉、「…」）' },
      { selector: '[class*="_headerCorner"]', desc: '最右那颗面板开关' },
      { selector: '[class*="_moreButton"]', desc: '「…」按钮本身' },
      { selector: '[class*="_triggerLabel"]', desc: '顶栏 chip 的文字（官方在 ≤460~540px 下用容器查询折叠掉）' },
      { selector: '[class*="_titleRow"] [class*="_label"]', desc: '顶栏里另一类文字标签（智能体预设）；_label 很宽（全页 20+ 处），必须像这样限定作用域' },
    ],
  },
  {
    title: '左栏内部',
    hint: '整条左栏被隐藏时这些都不显示；要单独调就用下面这些语义名',
    items: [
      { selector: '[class*="_logoRow"]', desc: '最上面的 logo 行' },
      { selector: '[class*="_railMark"]', desc: '鲸鱼 logo' },
      { selector: '[class*="_newSession"]', desc: '新建会话按钮' },
      { selector: '[class*="_panelList"]', desc: '面板按钮列表（插件 / 任务看板）' },
      { selector: '[class*="_panelRow"]', desc: '单个面板按钮' },
      { selector: '[class*="_footerActions"]', desc: '左栏底部（设置等）' },
      { selector: '[class*="_iconButton"]', desc: '左栏里的图标按钮（通用）' },
    ],
  },
  {
    title: '对话区与输入框',
    hint: '',
    items: [
      { selector: '[class*="_viewArea"]', desc: '对话滚动区（消息列表）' },
      { selector: '[class*="_scrollBody"]', desc: '对话滚动容器' },
      { selector: '[class*="_composerSeat"]', desc: '输入框整体容器（含下方状态条）' },
      { selector: '[class*="_composerStack"]', desc: '输入框堆叠容器' },
      { selector: '[class*="_input"]', desc: '输入框本体' },
      { selector: '[class*="_placeholder"]', desc: '输入框占位文案「发消息或创建任务…」' },
      { selector: '[class*="_dock"]', desc: '输入框下方状态条（tok/s、缓存命中、费用、上下文）' },
    ],
  },
  {
    title: '消息与费用',
    hint: 'cm-* 是成本插件（cost meter）自己的类名，不带哈希，直接写就行',
    items: [
      { selector: '[class*="_actions"]', desc: '每条消息底部操作行（复制/点赞/分享/时间）' },
      { selector: '[class*="_action"]', desc: '操作行里的单个按钮' },
      { selector: '[class*="_endInfo"]', desc: '消息结束时间' },
      { selector: '.cm-note', desc: '「本轮费用 ≈ ¥…」那一行' },
      { selector: '.cm-stat-dock', desc: '底部费用明细入口' },
      { selector: '.cm-peak-rail', desc: '左栏里的"谷价时段"小标' },
    ],
  },
]

/** 扁平清单（设置页要一行一行渲染） */
export function listGuiClasses() {
  return GUI_CLASS_GROUPS.flatMap((group) =>
    group.items.map((item) => ({ group: group.title, selector: item.selector, desc: item.desc })),
  )
}
