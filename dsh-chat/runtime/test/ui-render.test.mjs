/**
 * UI 冒烟：在 Node 里用最小 Vue/Naive 桩跑一遍 ui.mjs / settings.mjs 的 setup + render。
 *
 * 目的不是「渲染得像不像」，而是把只能在运行时才炸的合同错误挡在单测里：
 * 导出名写错、解构到不存在的注入成员、render 里引用未定义变量、顶层抛错。
 * （真正的前端验证要连 `pnpm tauri dev`，不在这里做。）
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import test from 'node:test'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..', '..')

function installStubs() {
  const mounted = []
  globalThis.__CATRACE_VUE__ = {
    h: (type, props, children) => ({ type, props: props ?? {}, children: children ?? null }),
    ref: (value) => ({ value }),
    computed: (getter) => ({ get value() { return getter() } }),
    watch: () => () => {},
    markRaw: (value) => value,
    onMounted: (fn) => mounted.push(fn),
    onBeforeUnmount: () => {},
  }
  const naiveNames = [
    'NAlert', 'NButton', 'NDivider', 'NInput', 'NModal', 'NPopconfirm', 'NProgress',
    'NRadioButton', 'NRadioGroup', 'NSelect', 'NSlider', 'NSpace', 'NSwitch', 'NTag', 'NTooltip',
  ]
  globalThis.__CATRACE_NAIVE__ = Object.fromEntries(naiveNames.map((name) => [name, { __naive: name }]))
  globalThis.__CATRACE_NAIVE__.useMessage = () => ({ success: () => {}, error: () => {} })
  globalThis.__CATRACE_NAIVE__.useDialog = () => ({})
  globalThis.__CATRACE_UI__ = { SettingRow: { __ui: 'SettingRow' }, SliderControl: { __ui: 'SliderControl' } }
  globalThis.__CATRACE_CREATE_PLUGIN_API__ = () => ({
    config: { get: async () => ({}), set: async () => {} },
    sidecar: { request: async () => ({}) },
    dialog: { pickFile: async () => null, pickFolder: async () => null },
    path: { get: async () => '', getPluginDir: async () => '' },
    log: { info: async () => {}, warn: async () => {}, error: async () => {} },
  })
  globalThis.document = {
    head: { appendChild: () => {} },
    getElementById: () => null,
    createElement: () => ({ set id(v) {}, set textContent(v) {} }),
  }
  return { mounted }
}

/** 把 h() 出来的树拍平成字符串，便于断言关键字（会下钻 slot 对象与 slot 函数） */
function flatten(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'function') return flatten(node())
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(flatten).join(' ')
  if (typeof node !== 'object') return ''
  const props = node.props ?? {}
  const own = [props.class, props.title, props.placeholder].filter((v) => typeof v === 'string').join(' ')
  const body = 'type' in node ? flatten(node.children) : Object.values(node).map(flatten).join(' ')
  return `${own} ${body}`.trim()
}

async function loadSurface(file) {
  // 每次请求带不同的 query，绕开 ESM 模块缓存（两个表面都要自己那份桩状态）
  const url = `${pathToFileURL(join(ROOT, file)).href}?t=${Date.now()}${Math.random()}`
  return import(url)
}

/**
 * 按宿主的方式加载：宿主会在插件源码前注入一行前奏
 * `const plugin = globalThis.__CATRACE_CREATE_PLUGIN_API__('<id>')`（见 tools/plugin-demo/develop.md）。
 * 想验证"真的能存配置"就必须照这个方式加载，否则模块里的 `plugin` 是未定义。
 */
async function loadWithHostPrelude(file, id) {
  const source = readFileSync(join(ROOT, file), 'utf8')
  const dir = mkdtempSync(join(tmpdir(), 'dsh-chat-plugin-'))
  const target = join(dir, file.split(/[\\/]/).pop())
  writeFileSync(target, `const plugin = globalThis.__CATRACE_CREATE_PLUGIN_API__(${JSON.stringify(id)})\n${source}`, 'utf8')
  return import(`${pathToFileURL(target).href}?t=${Date.now()}${Math.random()}`)
}

/** 收集树里所有 NTag 节点（去装饰标签云） */
function collectTags(node, out = []) {
  if (node === null || node === undefined || node === false) return out
  if (typeof node === 'function') return collectTags(node(), out)
  if (Array.isArray(node)) {
    for (const child of node) collectTags(child, out)
    return out
  }
  if (typeof node !== 'object') return out
  if (node.type && node.type.__naive === 'NTag' && node.props?.checkable) out.push(node)
  if ('type' in node) collectTags(node.children, out)
  else for (const value of Object.values(node)) collectTags(value, out)
  return out
}

/** 收集树里所有 NSwitch 节点（用于模拟用户点开关） */
function collectSwitches(node, out = []) {
  if (node === null || node === undefined || node === false) return out
  if (typeof node === 'function') return collectSwitches(node(), out)
  if (Array.isArray(node)) {
    for (const child of node) collectSwitches(child, out)
    return out
  }
  if (typeof node !== 'object') return out
  if (node.type && node.type.__naive === 'NSwitch') out.push(node)
  if ('type' in node) collectSwitches(node.children, out)
  else for (const value of Object.values(node)) collectSwitches(value, out)
  return out
}

/** 收集树里任意一种 naive 组件节点 */
function collectNaive(node, name, out = []) {
  if (node === null || node === undefined || node === false) return out
  if (typeof node === 'function') return collectNaive(node(), name, out)
  if (Array.isArray(node)) {
    for (const child of node) collectNaive(child, name, out)
    return out
  }
  if (typeof node !== 'object') return out
  if (node.type && node.type.__naive === name) out.push(node)
  // 注意：递归必须把 name 传下去（漏传会让深层节点永远搜不到——CSS 输入框就藏在 details 折叠里）
  if ('type' in node) collectNaive(node.children, name, out)
  else for (const value of Object.values(node)) collectNaive(value, name, out)
  return out
}

/** 从 settings.mjs 源码里解析 DEFAULTS 的键集合（用来自动覆盖"以后新增的键"） */
function parseDefaultsKeys(source) {
  const block = source.replace(/\r/g, '').match(/const DEFAULTS = \{([\s\S]*?)\n\}/)
  if (!block) return []
  return block[1]
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').match(/^\s*([A-Za-z][A-Za-z0-9]*):/))
    .filter(Boolean)
    .map((match) => match[1])
}

test('ui.mjs：窗口卡无 guiUrl 时渲染旧版镜像卡的"请重开"提示', async () => {
  installStubs()
  const mod = await loadSurface('ui.mjs')
  assert.ok(mod.default, 'ui.mjs 必须默认导出卡片组件')
  assert.equal(mod.Card, mod.default, 'Card 与 default 必须是同一个组件')

  const component = mod.default
  const setupResult = component.setup(
    { event: { title: 'DSH 对话', payload: { httpPort: 23457, httpToken: 'x' } }, isHovered: false },
    { emit: () => {} },
  )
  assert.equal(typeof setupResult, 'function', 'setup 必须返回 render 函数')
  const text = flatten(setupResult())
  assert.match(text, /dsh-chat-card/, '应渲染出 dsh-chat-card 根节点')
  assert.match(text, /镜像模式已经移除/, '0.2.x 的旧镜像卡事件要给出明确提示，而不是白屏')
  assert.match(text, /展开官方界面/, '提示里要给出下一步动作')
  assert.ok(!text.includes('问问 DSH'), '镜像输入框已随 SDK 链路移除')
  assert.ok(!text.includes('iframe'), '没有 guiUrl 就不该渲染 iframe')
})

test('ui.mjs：真 GUI 窗口卡渲染 iframe，状态通知卡渲染折叠条', async () => {
  installStubs()
  const mod = await loadSurface('ui.mjs')
  const component = mod.default

  // 窗口卡：payload 带 guiUrl → iframe 指向同源反代
  const guiSetup = component.setup(
    {
      event: {
        title: '第二个会话',
        payload: { guiUrl: 'http://127.0.0.1:23458/?dshw-session=s1', guiTitle: '第二个会话', guiSessionId: 's1' },
      },
      isHovered: false,
    },
    { emit: () => {} },
  )
  const guiTree = guiSetup()
  assert.match(flatten(guiTree), /第二个会话/, '卡片顶栏要显示会话标题')
  assert.match(JSON.stringify(guiTree), /'iframe'|iframe/, '应渲染 iframe')
  assert.match(JSON.stringify(guiTree), /dshw-session=s1/, 'iframe src 要指向反代')

  // 状态通知卡：正文点击打开小窗，没有对话输入框
  const noticeEvent = {
    event_type: 'dsh-chat.notice',
    title: '整理三点结论',
    payload: {
      notice: true,
      sessionId: 's1',
      status: 'running',
      preview: '最新的输出文本',
      httpPort: 23457,
      httpToken: 'x',
    },
  }
  const noticeSetup = component.setup({ event: noticeEvent, isHovered: false }, { emit: () => {} })
  assert.equal(typeof noticeSetup, 'function', '状态卡也要 setup 出 render 函数')
  const text = flatten(noticeSetup())
  assert.match(text, /dsh-chat-notice/, '应渲染 dsh-chat-notice 根节点')
  assert.match(text, /整理三点结论/, '折叠条要显示会话标题')
  assert.match(text, /进行中/, '要显示状态 chip')
  assert.match(text, /is-running/, '进行中状态要标记为 running，供顶部流动色条启用动画')
  assert.match(text, /dsh-chat-notice__statusline/, '状态边框层应随通知卡渲染')
  assert.match(text, /最新的输出文本/, '要显示最新输出预览')
  assert.ok(!text.includes('发送'), '状态卡不该有对话输入框')

  const errorEvent = { ...noticeEvent, payload: { ...noticeEvent.payload, status: 'error' } }
  const errorSetup = component.setup({ event: errorEvent, isHovered: false }, { emit: () => {} })
  const errorTree = errorSetup()
  assert.match(flatten(errorTree), /is-error/, 'error 必须映射到红色错误状态类')
  assert.match(flatten(errorTree), /处理失败/, 'error 状态应显示失败标签')
})

test('settings.mjs：点开关后保存对象必须带上这些键（防「设置没用」）', async () => {
  const stubs = installStubs()
  const saved = []
  const rpc = []
  globalThis.__CATRACE_CREATE_PLUGIN_API__ = () => ({
    config: { get: async () => ({}), set: async (config) => saved.push(config) },
    sidecar: {
      request: async (method, params) => {
        rpc.push({ method, params })
        return { config: {}, flat: [] }
      },
    },
    dialog: { pickFile: async () => null, pickFolder: async () => null },
    path: { get: async () => '', getPluginDir: async () => '' },
    log: { info: async () => {}, warn: async () => {}, error: async () => {} },
  })
  // scheduleSave 用 window.setTimeout 做 debounce
  // 轮询用假的 setInterval（真定时器会让测试进程挂着不退出；轮询本身不是这里要测的东西）
  globalThis.window = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    setInterval: () => 0,
    clearInterval: () => {},
  }

  const mod = await loadWithHostPrelude('settings.mjs', 'dsh-chat')
  // 注意：模块在 import 那一刻就解构了 __CATRACE_VUE__.onMounted，
  // 所以必须用 installStubs 收集的那份（import 之后再往 globalThis 上赋同名函数是不生效的）
  const render = mod.default.setup({}, { emit: () => {} })
  // mounted 抛错必须让测试红：allSettled 会吞掉 rejection（loaded 未定义那类 bug 就这么漏过）
  const mountedResults = await Promise.allSettled(stubs.mounted.map((fn) => fn()))
  const mountedErrors = mountedResults.filter((r) => r.status === 'rejected')
  assert.equal(mountedErrors.length, 0, `onMounted 抛错：${mountedErrors.map((r) => String(r.reason)).join('; ')}`)

  // 外观卡的顶层 4 个 chip（顶栏子项在父项点亮后才渲染）+ 2 个开关（状态通知卡头 / 紧凑留白）
  const tags = collectTags(render())
  const switches = collectSwitches(render())
  assert.equal(tags.length, 4, `顶层应有 4 个 chip（实际 ${tags.length}）`)
  assert.equal(switches.length, 2, `应有 2 个 NSwitch（实际 ${switches.length}）`)
  for (const tag of tags) {
    assert.equal(typeof tag.props['onUpdate:checked'], 'function', 'NTag 必须绑定 onUpdate:checked（否则点了不落盘）')
  }
  for (const sw of switches) {
    assert.equal(typeof sw.props['onUpdate:value'], 'function', 'NSwitch 必须绑定 onUpdate:value')
  }

  // 父项点亮后才出现子项（不是置灰）：顶栏内部 → 图标内部，两级
  const tagByLabel = (label) => collectTags(render()).find((tag) => flatten(tag).includes(label))
  assert.ok(!flatten(render()).includes('对话/轨迹 标签'), '「官方顶栏」没点亮时，顶栏子项不应渲染')
  tagByLabel('官方顶栏').props['onUpdate:checked'](true)
  assert.ok(flatten(render()).includes('对话/轨迹 标签'), '点亮「官方顶栏」后应出现顶栏子项')
  assert.ok(!flatten(render()).includes('「…」更多操作'), '「顶栏右侧图标」没点亮时，图标子项不该渲染')
  tagByLabel('顶栏右侧图标').props['onUpdate:checked'](true)
  assert.ok(flatten(render()).includes('「…」更多操作'), '点亮「顶栏右侧图标」后应出现它的子项')
  assert.equal(collectTags(render()).length, 11, '父项全亮时应看到全部 11 个 chip')

  // 全部关掉：保存对象必须把 false 落盘（漏键 = sidecar 回退默认值 → 设置没用）
  for (const tag of collectTags(render())) tag.props['onUpdate:checked'](false)
  for (const sw of collectSwitches(render())) sw.props['onUpdate:value'](false)

  // 自定义 CSS：输入框收在默认折叠的 details 里，但必须存在且能存
  const cssInput = collectNaive(render(), 'NInput').find((input) => input.props?.type === 'textarea')
  assert.ok(cssInput, '自定义 CSS 输入框必须在（折叠在 details 里也算）')
  cssInput.props['onUpdate:value']('/* marker */')

  await new Promise((resolve) => setTimeout(resolve, 900))

  assert.ok(saved.length > 0, '改开关必须触发保存')
  const last = saved.at(-1)
  const expected = [
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
    'noticeEnabled',
  ]
  for (const key of expected) {
    assert.equal(last[key], false, `保存对象必须包含 ${key}=false（否则 sidecar 会回退默认值 → 设置没用）`)
  }
  assert.equal(last.customCss, '/* marker */', '自定义 CSS 必须一起保存')
  // 通用护栏：保存对象必须覆盖 DEFAULTS 的所有键。以后新增键若忘了在 compose() 里处理，这条会立刻失败。
  const defaultsKeys = parseDefaultsKeys(readFileSync(join(ROOT, 'settings.mjs'), 'utf8'))
  assert.ok(defaultsKeys.length >= 10, `没解析到 DEFAULTS 键（拿到 ${defaultsKeys.length} 个）`)
  for (const key of defaultsKeys) {
    assert.ok(key in last, `保存对象缺键 ${key}：每次保存都会被抹回默认值 → 用户看到「设置没用/重启还原」`)
  }

  // 无改动不落盘：同样的值再走一遍保存路径（模拟 onBlur：输入框点进去再点走）
  const savedCountAfterChange = saved.length
  cssInput.props['onUpdate:value']('/* marker */')
  await new Promise((resolve) => setTimeout(resolve, 900))
  assert.equal(
    saved.length,
    savedCountAfterChange,
    '没有实际改动时不该再落盘（onBlur 误触发 saveNow 也不能写盘/弹「已保存」）',
  )

  // 关键：宿主不会把新配置推给正在运行的 sidecar（只在启动时发一次），
  // 所以设置页必须自己 push 一次 applyConfig，否则改设置要 disable/enable 插件才生效。
  const pushed = rpc.filter((entry) => entry.method === 'applyConfig')
  assert.ok(pushed.length > 0, '保存后必须调用 sidecar 的 applyConfig 推送新配置')
  const lastPush = pushed.at(-1).params?.config
  assert.ok(lastPush, 'applyConfig 必须带 config')
  for (const key of expected) {
    assert.equal(lastPush[key], false, `推给 sidecar 的配置必须带 ${key}`)
  }
})

test('settings.mjs：能加载、setup 出 render，并渲染出四块设置（会话/对话卡已移除）', async () => {
  installStubs()
  const mod = await loadSurface('settings.mjs')
  const component = mod.default
  assert.ok(component, 'settings.mjs 必须默认导出设置组件')

  const setupResult = component.setup({}, { emit: () => {} })
  assert.equal(typeof setupResult, 'function')
  const text = flatten(setupResult())
  for (const keyword of ['运行状态', '小窗外观', '状态通知', '测试卡', '状态卡端口', '小窗页面端口', 'DSH 数据目录', '运行环境']) {
    assert.match(text, new RegExp(keyword), `设置页应包含「${keyword}」`)
  }
  // 「小窗」整卡（打开按钮 / 标题 / 启用即弹出）已并入运行状态；会话/对话卡、紧凑留白开关也不再出现
  // 「官方界面」状态行是 debug 信息（失败时卡片自己和「最近一次错误」都会说），不该占设置页版面
  // 端口/目录一律用"用它的东西"命名（状态卡端口 / 小窗页面端口 / DSH 数据目录），旧的行话名不许回潮
  // 「后台服务」行也删了：能看到这个页面就说明它在运行，恒真的状态行没有信息量
  for (const gone of ['对话（向 DSH 提问）', 'DSH 会话', '跟随最新', '固定到镜像卡', '展开默认', '显示条数', '轮询间隔', '打开小窗', '小窗标题', '启用即弹出', 'GUI 复用状态', '已连上 DSH', '连接失败', '还没展开过状态卡', '本机服务', '本机端口', '官方界面端口', 'DSH 主目录', '巡检间隔', '后台服务']) {
    assert.ok(!text.includes(gone), `已砍掉的界面不应再出现：「${gone}」`)
  }
})
