import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { installPi, uninstallPi, piStatus, piAgentDir, loadPiToken, PI_TARGET, PI_CONTROL_EVENTS, PI_EVENTS } from './pi-config.mjs'

const token = 'a'.repeat(64)
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catrace-pi-config-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const write = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value))
  const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))
  return { dir, write, read }
}

test('Pi install is idempotent, preserves other config, defaults to private payloads', (t) => {
  const { dir, write, read } = fixture(t)
  const other = { name: 'other', url: 'https://example.com/hook', events: ['completed'], headers: { Authorization: '${MY_TOKEN}' } }
  write('settings.json', { theme: 'dark', packages: ['npm:other'] })
  write('webhook.json', { retries: 4, webhooks: [other] })
  installPi({ dir, token })
  installPi({ dir, token })
  assert.deepEqual(read('settings.json'), { theme: 'dark', packages: ['npm:other', 'npm:pi-webhook'] })
  const config = read('webhook.json')
  assert.equal(config.retries, 4)
  assert.deepEqual(config.webhooks[0], other)
  const target = config.webhooks[1]
  assert.equal(target.name, PI_TARGET)
  assert.equal(target.headers.Authorization, `Bearer ${token}`)
  assert.equal(target.includeMessage, false)
  assert.equal(target.includeCwd, false)
  assert.deepEqual(target.events, PI_EVENTS)
  assert.equal(piStatus({ dir }).installed, true)
  assert.ok(fs.existsSync(path.join(dir, 'settings.json.catrace.bak')))
  assert.ok(fs.existsSync(path.join(dir, 'webhook.json.catrace.bak')))
})

test('Pi subscriptions retain control events; uninstall retains package and other targets', (t) => {
  const { dir, read } = fixture(t)
  installPi({ dir, token, events: [], includeMessage: true })
  assert.deepEqual(read('webhook.json').webhooks[0].events, PI_CONTROL_EVENTS)
  assert.equal(read('webhook.json').webhooks[0].includeMessage, true)
  assert.equal(uninstallPi({ dir }).removed, 1)
  assert.equal(uninstallPi({ dir }).removed, 0)
  assert.deepEqual(read('webhook.json').webhooks, [])
  assert.deepEqual(read('settings.json').packages, ['npm:pi-webhook'])
  assert.equal(piStatus({ dir }).installed, false)
})

test('Pi rejects malformed files, invalid schemas and globally disabled config without modification', (t) => {
  const { dir, write } = fixture(t)
  for (const config of [null, [], { webhooks: 'bad' }, { enabled: false, webhooks: [] }, { unexpected: true, webhooks: [] }, { webhooks: [{ name: 'bad', url: 'file:///etc/passwd', events: [] }] }]) {
    write('webhook.json', config)
    const before = fs.readFileSync(path.join(dir, 'webhook.json'), 'utf8')
    assert.throws(() => installPi({ dir, token }))
    assert.equal(fs.readFileSync(path.join(dir, 'webhook.json'), 'utf8'), before)
    assert.equal(fs.existsSync(path.join(dir, 'settings.json')), false)
  }
  fs.writeFileSync(path.join(dir, 'webhook.json'), '{broken')
  assert.throws(() => installPi({ dir, token }), /未修改配置/)
  assert.ok(piStatus({ dir }).error)
})

test('Pi preserves user-configured package sources and rejects extension filters', (t) => {
  const { dir, write, read } = fixture(t)
  const local = path.join(dir, 'local-webhook')
  fs.mkdirSync(local)
  fs.writeFileSync(path.join(local, 'package.json'), JSON.stringify({ name: 'pi-webhook' }))
  for (const source of ['git:github.com/YHQY-Dev/pi-webhook', './local-webhook']) {
    write('settings.json', { packages: [source] })
    installPi({ dir, token })
    assert.deepEqual(read('settings.json').packages, [source])
  }
  write('settings.json', { packages: ['npm:other', { source: 'npm:pi-webhook@0.1.0', skills: [] }] })
  installPi({ dir, token })
  assert.deepEqual(read('settings.json').packages, ['npm:other', { source: 'npm:pi-webhook@0.1.0', skills: [] }])
  write('settings.json', { packages: [{ source: 'npm:pi-webhook', extensions: [] }] })
  assert.throws(() => installPi({ dir, token }), /扩展过滤/)
})

test('Pi rejects full target list and invalid events; token persists without silent rotation', (t) => {
  const { dir, write } = fixture(t)
  write('webhook.json', { webhooks: Array.from({ length: 16 }, (_, i) => ({ name: `t${i}`, url: 'http://localhost/', events: [] })) })
  assert.throws(() => installPi({ dir, token }), /16/)
  assert.equal(fs.existsSync(path.join(dir, 'settings.json')), false)
  assert.throws(() => installPi({ dir, token, events: ['bad'] }), /事件/)
  const file = path.join(dir, 'cache', 'token')
  const first = loadPiToken(file)
  assert.equal(first.length, 64)
  assert.equal(loadPiToken(file), first)
  fs.writeFileSync(file, 'broken')
  assert.throws(() => loadPiToken(file), /损坏/)
})

test('Pi honors PI_CODING_AGENT_DIR', (t) => {
  const before = process.env.PI_CODING_AGENT_DIR
  t.after(() => { if (before === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = before })
  process.env.PI_CODING_AGENT_DIR = path.join(os.tmpdir(), 'custom-pi-agent')
  assert.equal(piAgentDir(), path.resolve(process.env.PI_CODING_AGENT_DIR))
})
