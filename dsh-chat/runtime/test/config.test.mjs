/**
 * 配置归一化测试：默认值、钳制、trim、丢未知键、稳定性。
 * 0.3.0 起镜像/SDK 字段全部退场（normalizeConfig 把它们当未知字段丢弃）。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { CROP_MAPPED_KEYS, DEFAULT_CONFIG, SHOW_KEYS, cropFlagsFor, forceLabelsFor, guiSignature, normalizeConfig } from '../lib/config.mjs'

test('默认值符合契约', () => {
  assert.deepEqual(DEFAULT_CONFIG, {
    dshHome: '',
    noticeEnabled: true,
    noticePollMs: 2000,
    autoHideWhenDshActive: true,
    httpPort: 23457,
    guiPort: 23458,
    compactSpacing: false,
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

test('0.2.x/0.3.x 退场键按未知字段丢弃', () => {
  const result = normalizeConfig({
    ...DEFAULT_CONFIG,
    dshCommand: 'dsh',
    profile: 'sdk',
    provider: 'deepseek-account',
    model: 'deepseek-flash',
    reasoningEffort: 'high',
    maxTokens: 8000,
    cwd: 'D:\\x',
    patchFile: 'C:\\p.yml',
    mirrorLimit: 80,
    pollMs: 1000,
    mirrorSessionId: 'session-x',
    followLatest: false,
    noticeExpandMode: 'mirror',
    // 0.3.0 砍掉的「小窗」卡键
    cardTitle: '我的标题',
    autoOpenWindow: true,
    // 0.3.x 砍掉的「完成卡停留时长」：卡片改为一律常驻后没有 auto-hide 可调
    noticeDoneHoldMs: 3000,
    // 0.2.x 的短命键（0.2.0 就没了）
    noticeExpandModeBogus: 1,
  })
  assert.deepEqual(result, { ...DEFAULT_CONFIG }, '所有退场键都必须被丢弃，回默认值')
})

test('紧凑留白：独立开关，进签名（改了要重建反代才生效）', () => {
  assert.equal(DEFAULT_CONFIG.compactSpacing, false, '默认关')
  assert.equal(normalizeConfig({ compactSpacing: true }).compactSpacing, true, '能开')
  assert.equal(normalizeConfig({ compactSpacing: 'yes' }).compactSpacing, false, '非布尔回退默认')
  assert.notEqual(
    guiSignature({ ...DEFAULT_CONFIG, compactSpacing: true }),
    guiSignature(DEFAULT_CONFIG),
    '开了紧凑留白必须改变签名，否则不会重建反代 → 看起来没生效',
  )
})

test('show* ↔ 反代裁剪项：一对一映射，且任一开关都会改变签名', () => {
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
  const base = cropFlagsFor(DEFAULT_CONFIG)
  assert.equal(SHOW_KEYS.length, 11)
  assert.equal(CROP_MAPPED_KEYS.length, 10, 'showHeaderLabels 不是裁剪项（它是"强制显示标签"）')
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
  assert.notEqual(
    guiSignature({ ...DEFAULT_CONFIG, customCss: 'x{}' }),
    guiSignature(DEFAULT_CONFIG),
    'customCss 也要进签名',
  )
})

test('httpPort：0 表示系统分配，越界回退默认', () => {
  assert.equal(normalizeConfig({ httpPort: 0 }).httpPort, 0)
  assert.equal(normalizeConfig({ httpPort: 25000 }).httpPort, 25000)
  assert.equal(normalizeConfig({ httpPort: 65536 }).httpPort, 65535)
  assert.equal(normalizeConfig({ httpPort: -5 }).httpPort, 0)
  assert.equal(normalizeConfig({ httpPort: 'abc' }).httpPort, DEFAULT_CONFIG.httpPort)
  assert.equal(normalizeConfig({ httpPort: 1.7 }).httpPort, 1)
})

test('guiPort：固定端口让 iframe origin 稳定，钳制规则与 httpPort 相同', () => {
  assert.equal(normalizeConfig({ guiPort: 0 }).guiPort, 0)
  assert.equal(normalizeConfig({ guiPort: 30000 }).guiPort, 30000)
  assert.equal(normalizeConfig({ guiPort: 99999 }).guiPort, 65535)
  assert.equal(normalizeConfig({ guiPort: null }).guiPort, DEFAULT_CONFIG.guiPort)
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

test('字符串 trim，可空字段保留空串', () => {
  const result = normalizeConfig({
    dshHome: '  D:\\dsh home  ',
    customCss: '  [class*="_x"] {}  ',
  })
  assert.equal(result.dshHome, 'D:\\dsh home')
  assert.equal(result.customCss, '[class*="_x"] {}')

  // 可空字段允许空串
  const empty = normalizeConfig({ dshHome: '', customCss: '' })
  assert.equal(empty.dshHome, '')
  assert.equal(empty.customCss, '')

  // 非字符串一律回退
  const wrongType = normalizeConfig({ dshHome: 42, customCss: null })
  assert.equal(wrongType.dshHome, '')
  assert.equal(wrongType.customCss, '')
})

test('状态通知配置：轮询间隔钳制，总开关只认真布尔', () => {
  assert.equal(normalizeConfig({ noticePollMs: 1 }).noticePollMs, 500)
  assert.equal(normalizeConfig({ noticePollMs: 500 }).noticePollMs, 500)
  assert.equal(normalizeConfig({ noticePollMs: 1e9 }).noticePollMs, 30000)
  assert.equal(normalizeConfig({ noticePollMs: null }).noticePollMs, 2000)
  assert.equal(normalizeConfig({ noticeEnabled: false }).noticeEnabled, false)
  assert.equal(normalizeConfig({ noticeEnabled: 'off' }).noticeEnabled, true)
})

test('布尔字段只接受真布尔值', () => {
  assert.equal(normalizeConfig({ showRail: true }).showRail, true)
  assert.equal(normalizeConfig({ showHeader: 'true' }).showHeader, false)
  assert.equal(normalizeConfig({ showComposerStatus: true }).showComposerStatus, true)
  assert.equal(normalizeConfig({ showMessageMeta: 0 }).showMessageMeta, false)
  assert.equal(normalizeConfig({ showTabs: true }).showTabs, true)
  assert.equal(normalizeConfig({ showHeaderMore: false }).showHeaderMore, false)
  assert.equal(normalizeConfig({ showHeaderLabels: 1 }).showHeaderLabels, false)
  assert.equal(normalizeConfig({ compactSpacing: true }).compactSpacing, true)
  assert.equal(normalizeConfig({ compactSpacing: 'on' }).compactSpacing, false)
})

test('归一化不改动入参，且返回全新对象', () => {
  const raw = { ...DEFAULT_CONFIG, noticePollMs: 1, nope: 1 }
  const snapshot = JSON.stringify(raw)
  const result = normalizeConfig(raw)
  assert.equal(JSON.stringify(raw), snapshot)
  assert.notEqual(result, raw)
  assert.equal(DEFAULT_CONFIG.noticePollMs, 2000) // 冻结对象未被污染
})
