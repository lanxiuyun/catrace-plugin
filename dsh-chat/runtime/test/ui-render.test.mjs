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

test('ui.mjs：能加载、setup 出 render，并在空态渲染出小窗骨架', async () => {
  installStubs()
  const mod = await loadSurface('ui.mjs')
  assert.ok(mod.default, 'ui.mjs 必须默认导出卡片组件')
  assert.equal(mod.Card, mod.default, 'Card 与 default 必须是同一个组件')

  const component = mod.default
  const setupResult = component.setup(
    { event: { title: 'DSH 对话', payload: { limit: 20, pollMs: 2000, httpPort: 23457, httpToken: 'x' } }, isHovered: false },
    { emit: () => {} },
  )
  assert.equal(typeof setupResult, 'function', 'setup 必须返回 render 函数')
  const tree = setupResult()
  const text = flatten(tree)
  assert.match(text, /dsh-chat-card/, '应渲染出 dsh-chat-card 根节点')
  assert.match(text, /发送/, '应有发送按钮')
  assert.match(text, /问问 DSH/, '应有输入框占位文案')
})

test('settings.mjs：点开关后保存对象必须带上这些键（防「设置没用」）', async () => {
  installStubs()
  const saved = []
  const rpc = []
  globalThis.__CATRACE_CREATE_PLUGIN_API__ = () => ({
    config: { get: async () => ({}), set: async (config) => saved.push(config) },
    sidecar: {
      request: async (method, params) => {
        rpc.push({ method, params })
        return {}
      },
    },
    dialog: { pickFile: async () => null, pickFolder: async () => null },
    path: { get: async () => '', getPluginDir: async () => '' },
    log: { info: async () => {}, warn: async () => {}, error: async () => {} },
  })
  // scheduleSave 用 window.setTimeout 做 debounce
  globalThis.window = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id) }

  const mod = await loadWithHostPrelude('settings.mjs', 'dsh-chat')
  const mounted = []
  globalThis.__CATRACE_VUE__.onMounted = (fn) => mounted.push(fn)
  const render = mod.default.setup({}, { emit: () => {} })
  await Promise.allSettled(mounted.map((fn) => fn()))

  // 主组永远渲染；顶栏的两个子组按依赖条件渲染
  const mainTags = collectTags(render())
  const switches = collectSwitches(render())
  assert.ok(mainTags.length >= 4, `主组应有 4 个 chip（实际 ${mainTags.length}）`)
  assert.ok(
    !flatten(render()).includes('对话/轨迹 标签'),
    '「官方顶栏」没点亮时，顶栏子项不应渲染（不是置灰）',
  )
  for (const tag of mainTags) {
    assert.equal(typeof tag.props['onUpdate:checked'], 'function', 'NTag 必须绑定 onUpdate:checked（否则点了不落盘）')
  }
  for (const sw of switches) {
    assert.equal(typeof sw.props['onUpdate:value'], 'function', 'NSwitch 必须绑定 onUpdate:value')
  }

  // 逐步点亮父项，让子组出现，最后把所有 chip 关掉
  const tagByLabel = (label) => collectTags(render()).find((tag) => flatten(tag).includes(label))
  tagByLabel('官方顶栏').props['onUpdate:checked'](true)
  await new Promise((resolve) => setTimeout(resolve, 700))
  assert.ok(flatten(render()).includes('对话/轨迹 标签'), '点亮「官方顶栏」后应出现顶栏子项')

  tagByLabel('顶栏右侧图标').props['onUpdate:checked'](true)
  await new Promise((resolve) => setTimeout(resolve, 700))
  assert.ok(flatten(render()).includes('「…」更多操作'), '点亮「顶栏右侧图标」后应出现它的子项')

  for (const tag of collectTags(render())) tag.props['onUpdate:checked'](false)
  for (const sw of collectSwitches(render())) sw.props['onUpdate:value'](false)
  await new Promise((resolve) => setTimeout(resolve, 900))

  assert.ok(saved.length > 0, '改开关必须触发保存')
  const last = saved.at(-1)
  const expected = [
    'showRail',
    'showHeader',
    'showTabs',
    'showHeaderIcons',
    'showHeaderTitle',
    'showHeaderChips',
    'showComposerStatus',
    'showMessageMeta',
    'showHeaderLabels',
    'showHeaderMore',
    'showHeaderPanel',
  ]
  for (const key of expected) {
    assert.equal(last[key], false, `保存对象必须包含 ${key}（否则 sidecar 会回退默认值 → 设置没用）`)
  }
  assert.equal(typeof last.customCss, 'string', '自定义 CSS 也必须一起保存')

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

test('settings.mjs：能加载、setup 出 render，并渲染出四块设置', async () => {
  installStubs()
  const mod = await loadSurface('settings.mjs')
  const component = mod.default
  assert.ok(component, 'settings.mjs 必须默认导出设置组件')

  const setupResult = component.setup({}, { emit: () => {} })
  assert.equal(typeof setupResult, 'function')
  const text = flatten(setupResult())
  for (const keyword of ['运行状态', '小窗', 'DSH 会话', '对话（向 DSH 提问）', '打开小窗', '跟随最新']) {
    assert.match(text, new RegExp(keyword.replace(/[()（）]/g, '.')), `设置页应包含「${keyword}」`)
  }
  assert.ok(!/NInputNumber/.test(text))
})
