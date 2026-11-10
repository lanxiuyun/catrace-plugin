import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

// Source-backed handler tests only: no DOM, browser, server, network or installed runtime.
function harness(file, plugin = {}, exports = '') {
  plugin = { theme: { css: value => value }, ...plugin }
  const slots = [], pending = [], timers = new Map(), listeners = new Map()
  let cursor = 0, timerId = 0, dirty = false, tree, props = {}
  const changed = (previous, next) => !previous || !next || previous.length !== next.length || next.some((value, i) => !Object.is(value, previous[i]))
  const React = {
    Fragment: 'Fragment',
    createElement(type, properties, ...children) { return { type, props: { ...properties, children: children.flat(Infinity) } } },
    useState(initial) {
      const i = cursor++
      if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial }
      return [slots[i].value, next => { const value = typeof next === 'function' ? next(slots[i].value) : next; if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true } }]
    },
    useRef(initial) { const i = cursor++; if (!slots[i]) slots[i] = { current: initial }; return slots[i] },
    useEffect(callback, deps) {
      const i = cursor++
      if (!slots[i] || changed(slots[i].deps, deps)) {
        const old = slots[i]
        slots[i] = { deps }
        pending.push(() => { old?.cleanup?.(); slots[i].cleanup = callback() })
      }
    },
  }
  React.useLayoutEffect = React.useEffect
  const part = name => Object.fromEntries(['Root', 'Trigger', 'Content', 'Item', 'Title', 'Description', 'Action', 'Cancel'].map(key => [key, `${name}.${key}`]))
  const context = {
    __CATRACE_REACT__: React,
    __CATRACE_RADIX__: { Button: 'Button', TextField: part('TextField'), Switch: 'Switch', Badge: 'Badge', Select: part('Select'), AlertDialog: part('AlertDialog') },
    plugin, console, Date, Set, Uint8Array, crypto: globalThis.crypto,
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id },
    clearTimeout(id) { timers.delete(id) },
    window: { addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name) },
  }
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
  assert.doesNotMatch(source, /__CATRACE_VUE__|__CATRACE_NAIVE__|\$forceUpdate|\$nextTick|\$emit|\bimport\s/)
  const code = source.replace('export default function ', 'function ').replace(/^export \{[^\n]+\}\s*$/gm, '')
  const name = file === './ui.mjs' ? 'SmsforwarderNotifyCard' : 'SmsforwarderNotifySettings'
  runInNewContext(`${code}\nglobalThis.testing = { Component: ${name}${exports ? `, ${exports}` : ''} }`, context)
  function render(next = props) {
    props = next
    for (let iteration = 0; iteration < 30; iteration++) {
      dirty = false; cursor = 0
      tree = context.testing.Component(props)
      const effects = pending.splice(0)
      for (const effect of effects) effect()
      if (!dirty) return tree
    }
    throw new Error('React hook state did not settle')
  }
  return {
    render, context, timers, listeners,
    get tree() { return render() },
    async flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); return render() },
    async tick(delay) { const callbacks = [...timers].filter(([, timer]) => timer.delay === delay); for (const [id, timer] of callbacks) { timers.delete(id); await timer.callback() }; return this.flush() },
    unmount() { for (const slot of slots) slot?.cleanup?.() },
  }
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return []
  return [tree, ...(tree.props?.children || []).flatMap(nodes)]
}
function text(tree) { return typeof tree === 'string' ? tree : tree?.props?.children?.map(text).join('') || '' }
function find(tree, predicate) { const found = nodes(tree).find(predicate); assert.ok(found, 'Expected element not found'); return found }
function click(tree, label) { const node = find(tree, node => ['button', 'Button'].includes(node.type) && text(node) === label); node.props.onClick({ stopPropagation() {}, preventDefault() {} }); return node }
const message = (id, minute = 0) => ({ id, text: `message ${id}`, speaker: 'Alice', receivedAt: 1700000000000 + minute * 60000 })
const eventFor = (messages, extra = {}) => ({ id: 'event', revision: 1, sticky: true, payload: { noticeKind: 'chat', title: 'Chat', appName: 'QQ', packageName: 'com.tencent.mobileqq', threadKey: 'chat:abc', messages, threadCount: messages.length, ...extra }, actions: [{ id: 'block-app' }, { id: 'block-title' }] })

test('standalone manifest selects React with the requested date version', () => {
  const manifest = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'))
  assert.equal(manifest.uiFramework, 'react')
  assert.equal(manifest.version, '2026.11.09')
  assert.equal(manifest.sidecar.command, 'node')
})

test('chronological chat merge deduplicates without losing older loaded messages or unseen count', () => {
  const h = harness('./ui.mjs', {}, 'initialThread, mergeIncomingThread, threadSlice, pickOtpFromText, shouldShowTimeDivider')
  const api = h.context.testing
  const original = api.initialThread(eventFor([message('b', 2)]).payload)
  const next = api.mergeIncomingThread({ ...original, stick: false }, eventFor([message('b', 2), message('a', 1), message('c', 3)]).payload)
  assert.deepEqual(Array.from(next.messages, item => item.id), ['a', 'b', 'c'])
  assert.equal(next.unseen, 2)
  assert.equal(original.messages.length, 1)
  assert.equal(api.mergeIncomingThread(next, eventFor([message('c', 3)]).payload).messages.length, 3)
  assert.equal(api.pickOtpFromText('验证码', '您的验证码是 １２３４５６'), '123456')
  assert.equal(api.shouldShowTimeDivider(message('c', 3), message('a', 0), 1700000300000), true)
  const slice = api.threadSlice({ ...next, messages: Array.from({ length: 1000 }, (_, i) => message(String(i), i)), stick: true })
  assert.ok(slice.rows.length < 30)
  assert.equal(slice.rows.at(-1).id, '999')
})

test('OTP action, hover progress, close and two-click app/title blocking use React callbacks', async () => {
  const actions = []; let closed = 0
  const h = harness('./ui.mjs')
  const event = { id: 'otp', sticky: false, payload: { title: '登录', body: '验证码123456', appName: 'Test', publishedAt: 'now' }, actions: [{ id: 'copy-otp' }, { id: 'block-app' }, { id: 'block-title' }] }
  h.render({ event, isHovered: true, onAction: id => actions.push(id), onClose: () => closed++ })
  assert.ok(find(h.tree, node => node.props.className === 'bar paused'))
  click(h.tree, '复制验证码')
  assert.deepEqual(actions, ['copy-otp'])
  click(h.tree, '屏蔽此应用'); assert.deepEqual(actions, ['copy-otp'])
  click(h.tree, '确认屏蔽应用？'); assert.deepEqual(actions, ['copy-otp', 'block-app'])
  click(h.tree, '屏蔽这个标题'); await h.tick(5000)
  assert.ok(find(h.tree, node => text(node) === '屏蔽这个标题'))
  const close = find(h.tree, node => node.props['aria-label'] === '关闭通知')
  close.props.onClick({ stopPropagation() {} }); assert.equal(closed, 1)
  h.unmount(); assert.equal(h.timers.size, 0)
})

test('chat paging uses sidecar and falls back to per-thread storage, then cleans resize listeners', async () => {
  const calls = [], copies = [], writes = []
  const plugin = { sidecar: { async request(method, params) { calls.push([method, params]); throw new Error('offline') } }, storage: { async get(key) { if (key === 'chatThreadHeight') return { heights: { 'title:chat': 512 } }; return { messages: [message('old', 1), message('new', 2)] } }, async set(...args) { writes.push(args) } }, clipboard: { async writeText(value) { copies.push(value) } } }
  const h = harness('./ui.mjs', plugin)
  h.render({ event: eventFor([message('new', 2)], { threadCount: 2, hasMore: true }) })
  await h.flush()
  const older = find(h.tree, node => node.props['aria-label'] === '查看更早的消息')
  older.props.onClick({ stopPropagation() {} })
  await h.flush()
  assert.equal(calls[0][0], 'loadThreadPage')
  assert.equal(calls[0][1].beforeId, 'new')
  assert.ok(text(h.tree).includes('message old'))
  const copy = find(h.tree, node => node.props['aria-label'] === '复制这条消息')
  copy.props.onClick({ stopPropagation() {} }); await h.flush()
  assert.equal(copies[0], 'message old')
  const handle = find(h.tree, node => node.props.className === 'thread-resize')
  handle.props.onPointerDown({ button: 0, clientY: 100, preventDefault() {}, stopPropagation() {} })
  h.listeners.get('pointermove')({ clientY: 40 }); h.listeners.get('pointerup')()
  assert.equal(writes[0][0], 'chatThreadHeight')
  assert.equal(writes[0][1].heights['title:chat'], 572)
  h.unmount(); assert.equal(h.listeners.size, 0)
})

test('stale paging response cannot inject messages into a changed conversation', async () => {
  let resolve
  const plugin = { sidecar: { request: () => new Promise(done => { resolve = done }) } }
  const h = harness('./ui.mjs', plugin)
  h.render({ event: eventFor([message('first')], { threadCount: 2, hasMore: true }) })
  find(h.tree, node => node.props['aria-label'] === '查看更早的消息').props.onClick({ stopPropagation() {} })
  h.render({ event: { ...eventFor([message('other')], { threadKey: 'chat:other' }), revision: 2 } })
  resolve({ messages: [message('obsolete')], total: 2, hasMore: false })
  await h.flush()
  assert.ok(text(h.tree).includes('message other'))
  assert.ok(!text(h.tree).includes('message obsolete'))
  h.unmount()
})

test('settings retain tabs, RPC status, connection, filters, chat, tutorial and final autosave', async () => {
  let stored = { enabled: true, token: 'secret', appBlacklist: ['Blocked'], mmsTitleBlacklist: ['短信标题'], filters: [], chatApps: ['QQ'] }
  const calls = [], saves = []
  const plugin = { config: { async get() { return stored }, async set(value) { stored = value; saves.push(value) } }, events: { async publish(value) { calls.push(['publish', value]) } }, sidecar: { async request(method, params) { calls.push([method, params]); return method === 'getWebhookInfo' ? { token: 'secret', webhookUrls: ['http://10.0.0.2:17890/webhook'] } : { running: true, acceptedCount: 2 } } }, clipboard: { async writeText(value) { calls.push(['copy', value]) } } }
  const h = harness('./settings.mjs', plugin)
  h.render(); await h.flush()
  assert.ok(text(h.tree).includes('运行中'))
  click(h.tree, '设置')
  assert.ok(text(h.tree).includes('不看这些应用'))
  assert.ok(text(h.tree).includes('短信标题'))
  const token = find(h.tree, node => node.props['aria-label'] === 'Token')
  token.props.onChange({ target: { value: 'new-secret' } })
  h.render()
  const port = find(h.tree, node => node.props['aria-label'] === 'Webhook 监听端口')
  port.props.onChange({ target: { value: '19000' } })
  h.render()
  click(h.tree, '教程')
  assert.ok(text(h.tree).includes('新建转发规则'))
  assert.ok(text(h.tree).includes('消息模板'))
  h.unmount()
  await h.flush()
  assert.ok(saves.some(value => value.port === 19000 && value.token === 'new-secret'))
  assert.ok(calls.some(([method]) => method === 'setConfig'))
  assert.equal(h.listeners.size, 0)
})

test('filter controls validate regex, persist scopes, toggle rules and remove app/title entries', async () => {
  let stored = { token: 'secret', appBlacklist: ['Blocked'], appBlacklistPaused: ['Blocked'], mmsTitleBlacklist: ['短信标题'], filters: [] }
  const plugin = { config: { async get() { return stored }, async set(next) { stored = next } }, events: {} }
  const h = harness('./settings.mjs', plugin)
  h.render(); await h.flush(); click(h.tree, '设置')
  const change = (label, value) => { find(h.tree, node => node.props['aria-label'] === label).props.onChange({ target: { value } }); h.render() }
  change('过滤关键词或正则', 'spam')
  change('过滤规则应用范围', 'QQ')
  click(h.tree, '添加到规则列表'); await h.tick(400)
  assert.equal(stored.filters[0].value, 'spam')
  assert.equal(stored.filters[0].appContains, 'QQ')
  const ruleSwitch = find(h.tree, node => node.type === 'Switch' && String(node.props['aria-label']).startsWith('启用 不看'))
  ruleSwitch.props.onCheckedChange(false); await h.tick(400)
  assert.equal(stored.filters[0].enabled, false)
  find(h.tree, node => node.props['aria-label'] === '移除 Blocked').props.onClick(); await h.tick(400)
  assert.equal(stored.appBlacklist.length, 0)
  assert.equal(stored.appBlacklistPaused.length, 0)
  find(h.tree, node => node.props['aria-label'] === '移除 短信标题 · 锁屏短信').props.onClick(); await h.tick(400)
  assert.equal(stored.mmsTitleBlacklist.length, 0)
  const selects = nodes(h.tree).filter(node => node.type === 'Select.Root')
  selects[2].props.onValueChange('regex'); h.render()
  change('过滤关键词或正则', '[')
  click(h.tree, '添加到规则列表'); await h.tick(400)
  assert.equal(stored.filters.length, 1)
  assert.ok(text(h.tree).includes('正则无效'))
  h.unmount()
})

test('unmount flush preserves host disable and nested rule activation', async () => {
  let stored = { enabled: true, token: 'saved', filters: [{ id: 'rule', field: 'title', match: 'contains', value: 'spam', enabled: false }] }
  const writes = [], rpc = []
  const plugin = {
    config: { async get() { return stored }, async set(value) { writes.push(value); const enabled = Object.hasOwn(value, 'enabled') ? value.enabled : stored.enabled; stored = { ...value, enabled } } },
    events: {},
    sidecar: { async request(method) { rpc.push(method); return method === 'getWebhookInfo' ? { token: 'generated-live' } : { running: true } } },
  }
  const h = harness('./settings.mjs', plugin)
  h.render(); await h.flush(); click(h.tree, '设置')
  // Initialization's generated Token persistence must also omit host activation.
  assert.ok(writes.length > 0)
  assert.ok(writes.every(value => !Object.hasOwn(value, 'enabled')))
  find(h.tree, node => node.props['aria-label'] === 'Token').props.onChange({ target: { value: 'pending-edit' } })
  h.render(); stored = { ...stored, enabled: false }
  const previousRpcCount = rpc.length
  h.unmount(); await h.flush()
  assert.equal(stored.enabled, false)
  assert.equal(stored.token, 'pending-edit')
  assert.equal(stored.filters[0].enabled, false)
  assert.ok(writes.every(value => !Object.hasOwn(value, 'enabled')))
  assert.equal(rpc.length, previousRpcCount)
})

test('cross-window blacklist refresh preserves in-progress connection drafts', async () => {
  let stored = { token: 'old', appBlacklist: [] }
  const plugin = { config: { async get() { return stored }, async set(value) { stored = value } }, events: {} }
  const h = harness('./settings.mjs', plugin)
  h.render(); await h.flush(); click(h.tree, '设置')
  find(h.tree, node => node.props['aria-label'] === 'Token').props.onChange({ target: { value: 'draft' } })
  stored = { token: 'old', appBlacklist: ['Blocked from Toast'] }
  await h.listeners.get('catrace:plugin-config-changed')({ detail: { pluginId: 'smsforwarder-notify' } })
  assert.equal(find(h.tree, node => node.props['aria-label'] === 'Token').props.value, 'draft')
  assert.ok(text(h.tree).includes('Blocked from Toast'))
  h.unmount()
})
