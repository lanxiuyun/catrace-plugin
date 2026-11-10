import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve() }
const deferred = () => {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

// Exercise the real React module with only hooks and plugin I/O mocked. No browser,
// AppData, network, sidecar, Store file, or actual plugin enable command is used.
function mountSettings(pluginId) {
  const slots = []
  let cursor = 0
  let effects = []
  let tree
  let holdWrites = false
  const gate = deferred()
  const writes = []
  const disk = { enabled: true, nested: { enabled: true }, pollIntervalMs: 8000 }
  const react = {
    createElement(type, props, ...children) {
      return { type, props: props || {}, children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false) }
    },
    useState(initial) {
      const index = cursor++
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial }
      return [slots[index].value, (next) => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next }]
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial } },
    useEffect(effect, deps) {
      const index = cursor++
      const previous = slots[index]
      if (!previous || !deps || deps.some((value, i) => value !== previous.deps[i])) {
        slots[index] = { deps }
        effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = effect() })
      }
    },
    useImperativeHandle(ref, create) { if (ref) ref.current = create() },
  }
  const api = {
    theme: { css: (text) => text },
    config: {
      get: async () => structuredClone(disk),
      set: async (value) => {
        const pending = structuredClone(value)
        writes.push(pending)
        if (holdWrites) await gate.promise
        // Model the host's preserve-enabled rule when a business payload omits it.
        const enabled = Object.hasOwn(pending, 'enabled') ? pending.enabled : disk.enabled
        Object.assign(disk, pending, { enabled })
      },
    },
    sidecar: { request: async () => ({ board: [] }) },
    events: { publish: async () => {} },
    setEnabled: async (enabled) => { disk.enabled = enabled },
  }
  const context = {
    console, plugin: api,
    __CATRACE_REACT__: react,
    __CATRACE_RADIX__: { Button: 'Radix.Button', TextField: { Root: 'Radix.TextField' }, Switch: 'Radix.Switch' },
    document: { getElementById: () => ({}), createElement: () => ({}), head: { appendChild() {} } },
    window: { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} },
  }
  const source = readFileSync(new URL(`../${pluginId}/settings.mjs`, import.meta.url), 'utf8')
  const componentName = /export default function (\w+)/.exec(source)[1]
  runInNewContext(source.replace('export default function ', 'function ') + `\nglobalThis.Component = ${componentName}`, context)
  const render = () => {
    cursor = 0
    tree = context.Component()
    const pending = effects; effects = []
    for (const effect of pending) effect()
  }
  const nodes = (node = tree) => node && typeof node === 'object' ? [node, ...node.children.flatMap((child) => nodes(child))] : []
  const text = (node) => typeof node === 'string' ? node : node?.children?.map(text).join('') || ''
  return {
    disk, writes, render,
    beginWrite() {
      holdWrites = true
      if (pluginId === 'wecom-todo') {
        nodes().find((node) => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: false } })
      } else {
        const label = pluginId === 'napcat-qq' ? '保存' : '保存配置'
        void nodes().find((node) => node.type === 'Radix.Button' && text(node) === label).props.onClick()
      }
    },
    finish: () => gate.resolve(),
    unmount() { for (const slot of slots) slot?.cleanup?.() },
  }
}

for (const pluginId of ['napcat-qq', 'pywechat-reply', 'wecom-todo']) {
  test(`${pluginId}: pending business save cannot re-enable a plugin disabled before unmount`, async () => {
    const instance = mountSettings(pluginId)
    instance.render()
    await flush()
    instance.render()
    const priorWrites = instance.writes.length
    instance.beginWrite()
    assert.equal(instance.writes.length, priorWrites + 1)
    const payload = instance.writes.at(-1)
    instance.disk.enabled = false // The host switch persists disable while this save waits.
    instance.unmount()
    instance.finish()
    await flush()
    assert.equal(instance.disk.enabled, false)
    assert.equal(Object.hasOwn(payload, 'enabled'), false)
    if (pluginId === 'pywechat-reply') assert.equal(payload.nested.enabled, true)
  })
}
