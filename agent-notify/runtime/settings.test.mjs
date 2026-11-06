import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

function walk(node) {
  if (node == null || typeof node !== 'object') return [node]
  if (Array.isArray(node)) return node.flatMap(walk)
  const children = typeof node.children?.default === 'function' ? node.children.default() : node.children
  return [node, ...walk(children)]
}
function text(node) { return walk(node).filter((item) => typeof item === 'string').join(' ') }

test('settings lists Pi with other Agents, one Hook button and shared event policy', async (t) => {
  const globals = ['__CATRACE_VUE__', '__CATRACE_NAIVE__', 'plugin', 'document']
  const saved = Object.fromEntries(globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  t.after(() => { for (const key of globals) { if (saved[key]) Object.defineProperty(globalThis, key, saved[key]); else delete globalThis[key] } })
  let mounted
  let unmount
  let installed = false
  let polls = 0
  const requests = []
  const notices = []
  const configs = []
  let failInstall = false
  globalThis.__CATRACE_VUE__ = {
    h: (type, props, children) => ({ type, props: props || {}, children }),
    ref: (value) => ({ value }),
    computed: (get) => ({ get value() { return get() } }),
    onMounted: (callback) => { mounted = callback },
    onBeforeUnmount: (callback) => { unmount = callback },
  }
  const components = ['NButton', 'NInput', 'NInputNumber', 'NRadioButton', 'NRadioGroup', 'NSlider', 'NTag']
  globalThis.__CATRACE_NAIVE__ = Object.fromEntries(components.map((name) => [name, { name }]))
  globalThis.__CATRACE_NAIVE__.useMessage = () => ({ success: (msg) => notices.push(msg), error: (msg) => notices.push(msg) })
  globalThis.document = { getElementById: () => true }
  globalThis.plugin = {
    config: { get: async () => ({}), set: async (config) => configs.push(config) },
    sidecar: { request: async (method, params) => {
      requests.push({ method, params })
      if (method === 'listAgents') return { result: [{ id: 'claude', detected: true, installed: true }, { id: 'pi', detected: true, installed }] }
      if (method === 'install') return failInstall ? { ok: false, error: 'Pi receiver 未就绪' } : { ok: true, result: { running: true } }
      if (method === 'piInstallStatus') { polls++; installed = true; return { result: { running: false, result: { installed: true } } } }
      if (method === 'uninstall') installed = false
      return { ok: true, result: {} }
    } },
  }
  const source = await fs.readFile(new URL('../settings.mjs', import.meta.url), 'utf8')
  const component = (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).default
  const render = component.setup()
  await mounted()
  const sections = () => render().children
  assert.equal(text(sections()[0]).startsWith('Agent 联动'), true)
  assert.equal(text(render()).includes('Pi / pi-web 联动'), false)
  assert.equal(text(render()).includes('发送工作目录'), false)
  assert.equal(text(render()).includes('任务取消'), false)
  const piRow = () => walk(sections()[0]).find((node) => node?.props?.key === 'pi')
  const button = () => walk(piRow()).find((node) => node?.type?.name === 'NButton')
  assert.equal(text(piRow()).includes('Pi'), true)
  assert.equal(text(render()).includes('pi-web'), false)
  assert.equal(walk(piRow()).filter((node) => node?.type?.name === 'NButton').length, 1)
  assert.equal(text(button()), '安装 Hook')
  await button().props.onClick()
  assert.equal(polls, 1)
  assert.equal(text(button()), '卸载 Hook')
  assert.ok(notices.some((notice) => notice.includes('重启 Pi 生效')))
  const policy = sections().find((section) => text(section).startsWith('事件通知策略'))
  const failureRow = walk(policy).find((node) => node?.props?.key === 'PostToolUseFailure')
  await walk(failureRow).find((node) => node?.type?.name === 'NRadioGroup').props.onUpdateValue('auto')
  assert.equal(configs.at(-1).eventModes.PostToolUseFailure, 'auto')
  assert.equal(requests.at(-1).method, 'setConfig')
  assert.equal(requests.some(({ method }) => method === 'configurePi' || method === 'piStatus'), false)
  await button().props.onClick()
  assert.equal(text(button()), '安装 Hook')
  failInstall = true
  await button().props.onClick()
  assert.equal(polls, 1)
  assert.equal(notices.at(-1), 'Pi receiver 未就绪')
  unmount()
})
