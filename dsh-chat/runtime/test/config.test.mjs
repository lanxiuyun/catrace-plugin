/**
 * 配置归一化测试：默认值、钳制、枚举回退、trim、丢未知键、稳定性。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_CONFIG, normalizeConfig } from '../lib/config.mjs'

test('默认值符合契约', () => {
  assert.deepEqual(DEFAULT_CONFIG, {
    dshHome: '',
    dshCommand: 'dsh',
    profile: 'sdk',
    provider: 'deepseek-account',
    model: 'deepseek-flash',
    reasoningEffort: 'high',
    maxTokens: 0,
    cwd: '',
    patchFile: '',
    mirrorLimit: 40,
    pollMs: 2000,
    mirrorSessionId: '',
    followLatest: true,
    cardTitle: 'DSH 对话',
    autoOpenWindow: false,
    httpPort: 23457,
    guiPort: 23458,
    showRail: false,
    showHeader: false,
    showTabs: false,
    showHeaderIcons: false,
    showHeaderMore: true,
    showHeaderPanel: true,
    showHeaderTitle: false,
    showHeaderChips: true,
    showComposerStatus: false,
    showMessageMeta: false,
    showHeaderLabels: false,
    customCss: '',
  })
  assert.ok(Object.isFrozen(DEFAULT_CONFIG))
})

test('show* ↔ 反代裁剪项：一对一映射，且任一开关都会改变签名', async () => {
  const { SHOW_KEYS, CROP_MAPPED_KEYS, cropFlagsFor, forceLabelsFor, guiSignature } = await import('../lib/config.mjs')
  const flagNames = [
    'rail',
    'header',
    'tabs',
    'headerIcons',
    'headerMore',
    'headerPanel',
    'headerTitle',
    'headerChips',
    'composerStatus',
    'messageMeta',
  ]
  assert.equal(SHOW_KEYS.length, 11)
  assert.equal(CROP_MAPPED_KEYS.length, 10, 'showHeaderLabels 不是裁剪项（它是"强制显示标签"）')
  const base = cropFlagsFor(DEFAULT_CONFIG)
  assert.deepEqual(Object.keys(base).sort(), [...flagNames].sort(), '键名必须与 buildCropCss 的参数一一对应')
  for (const key of SHOW_KEYS) {
    assert.equal(typeof DEFAULT_CONFIG[key], 'boolean', `DEFAULT_CONFIG 缺少 ${key}`)
  }
  // 取反关系：display=true ⇒ crop=false
  assert.equal(base.rail, true, '默认隐藏左栏 ⇒ crop.rail=true')
  assert.equal(base.headerChips, false, '默认显示 chips ⇒ crop.headerChips=false')
  assert.equal(forceLabelsFor(DEFAULT_CONFIG), false, '默认不强制显示顶栏文字标签')
  assert.equal(forceLabelsFor({ showHeaderLabels: true }), true, 'showHeaderLabels=true ⇒ 强制显示文字标签')
  // 每个开关都必须影响签名（漏一个 → 改了设置不重建反代 → "设置没用"）
  const signatures = new Set()
  for (const key of SHOW_KEYS) {
    const flipped = { ...DEFAULT_CONFIG, [key]: !DEFAULT_CONFIG[key] }
    const sig = guiSignature(flipped)
    assert.notEqual(sig, guiSignature(DEFAULT_CONFIG), `${key} 变化必须改变签名`)
    signatures.add(sig)
    if (CROP_MAPPED_KEYS.includes(key)) {
      const bare = key.slice(4)
      const flagKey = bare.charAt(0).toLowerCase() + bare.slice(1)
      assert.notEqual(cropFlagsFor(flipped)[flagKey], base[flagKey], `${key} 变化必须翻转对应裁剪项`)
    }
  }
  assert.equal(signatures.size, SHOW_KEYS.length, '每个开关的签名都应唯一')
  assert.notEqual(guiSignature({ ...DEFAULT_CONFIG, guiPort: 1 }), guiSignature(DEFAULT_CONFIG), 'guiPort 也要进签名')
})

test('httpPort：0 表示系统分配，越界回退默认', () => {
  assert.equal(normalizeConfig({ httpPort: 0 }).httpPort, 0)
  assert.equal(normalizeConfig({ httpPort: 25000 }).httpPort, 25000)
  assert.equal(normalizeConfig({ httpPort: 65536 }).httpPort, 65535)
  assert.equal(normalizeConfig({ httpPort: -5 }).httpPort, 0)
  assert.equal(normalizeConfig({ httpPort: 'abc' }).httpPort, DEFAULT_CONFIG.httpPort)
  assert.equal(normalizeConfig({ httpPort: 1.7 }).httpPort, 1)
})

test('normalizeConfig(DEFAULT_CONFIG) 稳定且不确定为空', () => {
  const once = normalizeConfig(DEFAULT_CONFIG)
  assert.deepEqual(once, { ...DEFAULT_CONFIG })
  assert.deepEqual(normalizeConfig(once), once)
})

test('空输入 / 非对象输入得到默认值', () => {
  assert.deepEqual(normalizeConfig({}), { ...DEFAULT_CONFIG })
  assert.deepEqual(normalizeConfig(undefined), { ...DEFAULT_CONFIG })
  assert.deepEqual(normalizeConfig(null), { ...DEFAULT_CONFIG })
  // 数组按对象读字段，等价于空对象
  assert.deepEqual(normalizeConfig([]), { ...DEFAULT_CONFIG })
})

test('未知字段被丢弃', () => {
  const result = normalizeConfig({ ...DEFAULT_CONFIG, nope: 1, windowSize: 'big', __proto__x: true })
  assert.deepEqual(Object.keys(result).sort(), Object.keys(DEFAULT_CONFIG).sort())
  assert.equal('nope' in result, false)
  assert.equal(result.windowSize, undefined)
})

test('字符串 trim，必填字段空串回退默认，可空字段保留空串', () => {
  const result = normalizeConfig({
    dshCommand: '  C:\\Program Files\\dsh\\dsh.cmd  ',
    profile: '   ',
    provider: '',
    model: '  deepseek-reasoner ',
    dshHome: '  D:\\dsh home  ',
    cwd: '   D:\\workspace\\Catrace ',
    patchFile: ' C:\\tmp\\p.json ',
    mirrorSessionId: ' session-x ',
    cardTitle: '  我的对话  ',
  })
  assert.equal(result.dshCommand, 'C:\\Program Files\\dsh\\dsh.cmd')
  assert.equal(result.profile, 'sdk') // 空 -> 默认
  assert.equal(result.provider, 'deepseek-account') // 空 -> 默认
  assert.equal(result.model, 'deepseek-reasoner')
  assert.equal(result.dshHome, 'D:\\dsh home')
  assert.equal(result.cwd, 'D:\\workspace\\Catrace')
  assert.equal(result.patchFile, 'C:\\tmp\\p.json')
  assert.equal(result.mirrorSessionId, 'session-x')
  assert.equal(result.cardTitle, '我的对话')

  // 可空字段允许空串
  const empty = normalizeConfig({ dshHome: '', cwd: '', patchFile: '' })
  assert.equal(empty.dshHome, '')
  assert.equal(empty.cwd, '')
  assert.equal(empty.patchFile, '')

  // 非字符串一律回退
  const wrongType = normalizeConfig({ dshCommand: 42, model: null, cardTitle: false })
  assert.equal(wrongType.dshCommand, 'dsh')
  assert.equal(wrongType.model, 'deepseek-flash')
  assert.equal(wrongType.cardTitle, 'DSH 对话')
})

test('数字字段钳制在合法区间', () => {
  assert.equal(normalizeConfig({ mirrorLimit: 1 }).mirrorLimit, 6)
  assert.equal(normalizeConfig({ mirrorLimit: 5 }).mirrorLimit, 6)
  assert.equal(normalizeConfig({ mirrorLimit: 6 }).mirrorLimit, 6)
  assert.equal(normalizeConfig({ mirrorLimit: 200 }).mirrorLimit, 200)
  assert.equal(normalizeConfig({ mirrorLimit: 9999 }).mirrorLimit, 200)
  assert.equal(normalizeConfig({ mirrorLimit: 'abc' }).mirrorLimit, 40)
  assert.equal(normalizeConfig({ mirrorLimit: NaN }).mirrorLimit, 40)
  assert.equal(normalizeConfig({ mirrorLimit: 12.9 }).mirrorLimit, 12)

  assert.equal(normalizeConfig({ pollMs: 1 }).pollMs, 500)
  assert.equal(normalizeConfig({ pollMs: 500 }).pollMs, 500)
  assert.equal(normalizeConfig({ pollMs: 30000 }).pollMs, 30000)
  assert.equal(normalizeConfig({ pollMs: 1e9 }).pollMs, 30000)
  assert.equal(normalizeConfig({ pollMs: null }).pollMs, 2000)
})

test('maxTokens：0 或 1..200000，非法归 0', () => {
  assert.equal(normalizeConfig({ maxTokens: 0 }).maxTokens, 0)
  assert.equal(normalizeConfig({ maxTokens: 1 }).maxTokens, 1)
  assert.equal(normalizeConfig({ maxTokens: 200000 }).maxTokens, 200000)
  assert.equal(normalizeConfig({ maxTokens: 200001 }).maxTokens, 200000)
  assert.equal(normalizeConfig({ maxTokens: -5 }).maxTokens, 0)
  assert.equal(normalizeConfig({ maxTokens: '8000' }).maxTokens, 0)
  assert.equal(normalizeConfig({ maxTokens: Infinity }).maxTokens, 0)
})

test('reasoningEffort：只接受空串/枚举，其他回退默认', () => {
  assert.equal(normalizeConfig({ reasoningEffort: '' }).reasoningEffort, '')
  assert.equal(normalizeConfig({ reasoningEffort: 'low' }).reasoningEffort, 'low')
  assert.equal(normalizeConfig({ reasoningEffort: 'medium' }).reasoningEffort, 'medium')
  assert.equal(normalizeConfig({ reasoningEffort: ' high ' }).reasoningEffort, 'high')
  assert.equal(normalizeConfig({ reasoningEffort: 'HIGH' }).reasoningEffort, 'high')
  assert.equal(normalizeConfig({ reasoningEffort: 'ultra' }).reasoningEffort, 'high')
  assert.equal(normalizeConfig({ reasoningEffort: 3 }).reasoningEffort, 'high')
})

test('布尔字段只接受真布尔值', () => {
  assert.equal(normalizeConfig({ followLatest: false }).followLatest, false)
  assert.equal(normalizeConfig({ followLatest: true }).followLatest, true)
  assert.equal(normalizeConfig({ autoOpenWindow: true }).autoOpenWindow, true)
  assert.equal(normalizeConfig({ autoOpenWindow: false }).autoOpenWindow, false)
  assert.equal(normalizeConfig({ followLatest: 'false' }).followLatest, true)
  assert.equal(normalizeConfig({ autoOpenWindow: 1 }).autoOpenWindow, false)
})

test('归一化不改动入参，且返回全新对象', () => {
  const raw = { ...DEFAULT_CONFIG, mirrorLimit: 999, nope: 1 }
  const snapshot = JSON.stringify(raw)
  const result = normalizeConfig(raw)
  assert.equal(JSON.stringify(raw), snapshot)
  assert.notEqual(result, raw)
  assert.equal(DEFAULT_CONFIG.mirrorLimit, 40) // 冻结对象未被污染
})
