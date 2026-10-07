/**
 * 插件合同静态检查：manifest 与 ui/settings/sidecar 的硬约束。
 *
 * 这些约束错了不会在单测里报错，而是到运行时才炸（组件 undefined、Toast 卡片调不通 sidecar、
 * events 白名单漏了导致卡片根本不出现），所以在这里静态锁死。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..', '..')
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'))
const read = (name) => readFileSync(join(ROOT, name), 'utf8')

/** 宿主注入的白名单（见 src/plugins/pluginRuntime.ts） */
const VUE_WHITELIST = ['h', 'ref', 'computed', 'watch', 'markRaw', 'onMounted', 'onBeforeUnmount']
const NAIVE_WHITELIST = [
  'NAlert',
  'NButton',
  'NDivider',
  'NInput',
  'NModal',
  'NPopconfirm',
  'NProgress',
  'NRadioButton',
  'NRadioGroup',
  'NSelect',
  'NSlider',
  'NSpace',
  'NSwitch',
  'NTag',
  'NTooltip',
  'useDialog',
  'useMessage',
]
/** 宿主保留 kind，插件不得占用 */
const RESERVED_KINDS = ['rest', 'water', 'agent', 'permission', 'update', 'rest-timer', 'sdk']

function destructuredFrom(source, globalName) {
  const match = source.match(new RegExp(`const\\s*\\{([^}]*)\\}\\s*=\\s*globalThis\\.${globalName}`))
  if (!match) return []
  return match[1]
    .split(',')
    .map((part) => part.trim().split(':')[0].trim())
    .filter(Boolean)
}

test('manifest：id = 目录名、无保留 kind、events 覆盖发布的事件', () => {
  assert.equal(manifest.id, 'dsh-chat', 'manifest.id 必须等于目录名')
  assert.equal(manifest.enabledByDefault, false, '插件默认不自动启用')
  assert.ok(Array.isArray(manifest.events) && manifest.events.length > 0)

  const kinds = manifest.events.map((entry) => entry.replace(/^kind:/, ''))
  for (const reserved of RESERVED_KINDS) {
    assert.ok(!kinds.includes(reserved), `不得占用保留 kind：${reserved}`)
  }
  assert.ok(manifest.events.includes('dsh-chat.window'), 'events 必须包含卡片事件类型')
  assert.ok(manifest.events.includes('kind:dsh-chat'), 'events 必须包含裸 kind')

  // sidecar 发布的事件必须都在白名单里
  const sidecarSource = read(manifest.sidecar.args[0])
  const published = [...sidecarSource.matchAll(/eventType:\s*'([^']+)'/g)].map((m) => m[1])
  assert.ok(published.length > 0, 'sidecar 应该发布事件')
  for (const eventType of published) {
    assert.ok(manifest.events.includes(eventType), `events 白名单缺少 ${eventType}`)
  }
  const publishedKind = [...sidecarSource.matchAll(/kind:\s*'([^']+)'/g)].map((m) => m[1])
  for (const kind of publishedKind) {
    assert.ok(
      manifest.events.includes(kind) || manifest.events.includes(`kind:${kind}`),
      `events 白名单缺少 kind ${kind}`,
    )
  }
})

test('manifest：声明的脚本都在插件目录内且存在', () => {
  assert.equal(manifest.main, 'ui.mjs')
  assert.equal(manifest.settings, 'settings.mjs')
  assert.equal(manifest.sidecar.command, 'node')
  for (const file of [manifest.main, manifest.settings, ...manifest.sidecar.args]) {
    assert.ok(!file.startsWith('/') && !file.includes('..'), `${file} 必须落在插件目录内`)
    assert.doesNotThrow(() => read(file), `${file} 不存在`)
  }
})

test('ui/settings：只用注入的白名单，且不 import 宿主模块', () => {
  for (const file of ['ui.mjs', 'settings.mjs']) {
    const source = read(file)
    assert.ok(!/^\s*import\s/m.test(source), `${file} 不得使用 import（宿主用 blob 加载，裸导入会失败）`)
    assert.ok(!/from\s+['"]vue['"]/.test(source), `${file} 不得 import vue`)
    assert.ok(!/from\s+['"]naive-ui['"]/.test(source), `${file} 不得 import naive-ui`)
    assert.ok(!/template:\s*`/.test(source), `${file} 不得使用模板字符串 SFC`)

    for (const name of destructuredFrom(source, '__CATRACE_VUE__')) {
      assert.ok(VUE_WHITELIST.includes(name), `${file} 用了未注入的 Vue API：${name}`)
    }
    for (const name of destructuredFrom(source, '__CATRACE_NAIVE__')) {
      assert.ok(NAIVE_WHITELIST.includes(name), `${file} 用了白名单外的 Naive 组件：${name}`)
    }
    for (const name of destructuredFrom(source, '__CATRACE_UI__')) {
      assert.ok(['SettingRow', 'SliderControl'].includes(name), `${file} 用了未知的 __CATRACE_UI__ 成员：${name}`)
    }
  }
})

test('ui.mjs：卡片合同（props / emits / 导出）', () => {
  const source = read('ui.mjs')
  assert.match(source, /props:\s*\{[\s\S]*?event:[\s\S]*?isHovered:[\s\S]*?\}/, '缺少 event / isHovered props')
  assert.match(source, /emits:\s*\[\s*'close'\s*,\s*'action'\s*\]/, 'emits 必须是 close / action')
  assert.match(source, /export default\s+DshChatWindowCard/, '必须默认导出卡片组件')
  assert.match(source, /export const Card\s*=\s*DshChatWindowCard/, '必须同时导出 Card')
  assert.match(source, /dsh-chat-card/, '样式类名要有插件前缀')
})

test('ui.mjs：Toast 窗不许调 plugin.sidecar.request（宿主只放行 main 窗）', () => {
  // 注释里提到这个方法名是允许的（说明为什么不能用），所以先去掉注释再查
  const source = read('ui.mjs')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  assert.ok(
    !/plugin\s*\.\s*sidecar\s*\.\s*request/.test(source),
    'Toast 卡片不能调 sidecar.request（plugin_sidecar.rs 只允许 main 窗），请走本机 HTTP 桥',
  )
  assert.match(source, /fetch\(/, '卡片应通过 fetch 访问 sidecar 的本机 HTTP 桥')
})

test('小窗卡片：走 standalone 外壳，且宽度不超过宿主 22.5rem 卡槽', () => {
  const main = read('runtime/main.mjs')
  assert.match(
    main,
    /toastStyle:\s*'standalone'/,
    '发布小窗事件必须带 payload.toastStyle = "standalone"，否则会被套进宿主默认白卡（padding + 圆角）',
  )

  const ui = read('ui.mjs')
  const rootRule = ui.match(/\.dsh-chat-card \{[\s\S]*?\n\}/)
  assert.ok(rootRule, 'ui.mjs 应有 .dsh-chat-card 根规则')
  assert.match(rootRule[0], /width: 100%/, '卡片要撑满卡槽（宿主 .toast-card 固定 22.5rem，.toast-stack overflow-x: hidden）')
  assert.match(rootRule[0], /box-sizing: border-box/, '撑满卡槽时必须 border-box，否则 padding 会撑出卡槽')
  assert.ok(
    !/width:\s*2[3-9](\.\d+)?rem/.test(rootRule[0]),
    '卡片不得宽于宿主 22.5rem 卡槽，否则右边会被裁掉',
  )
})

test('输入必须双向绑定，否则「设置完全没办法调整」', () => {
  const settings = read('settings.mjs')
  const inputCount = (settings.match(/h\(NInput/g) || []).length
  const updateCount = (settings.match(/'onUpdate:value'/g) || []).length
  const valueCount = (settings.match(/^\s*value:/gm) || []).length
  // 0.3.0 起字面 h(NInput 只有 3 处（textInput / numberInput / CSS textarea），都走 helper 复用
  assert.ok(inputCount >= 3, `settings.mjs 应有多处 NInput（实测 ${inputCount}）`)
  // 受控 NInput 只给 value、不接 onUpdate:value → 打字不落（历史上真踩过）
  assert.ok(
    updateCount >= inputCount,
    `每个 NInput 都要接 onUpdate:value（NInput ${inputCount} 个 / update ${updateCount} 处）`,
  )
  assert.ok(valueCount >= inputCount, `每个 NInput 都要绑定 value（NInput ${inputCount} 个 / value ${valueCount} 处）`)
  // 数值字段要防打字中途被改写：字符串暂存 + 失焦/保存时钳制
  assert.match(settings, /function clamp\(/, '数值要有钳制函数')
  assert.match(settings, /onBlur/, '数值输入应在失焦时钳制落盘')
  assert.match(settings, /scheduleSave|saveNow/, '改动要落盘到 plugin.config')
})

test('默认值必须与 sidecar 的 lib/config.mjs 一致（防两处漂移）', () => {
  const libSource = read('runtime/lib/config.mjs')
  const block = libSource.match(/DEFAULT_CONFIG = Object\.freeze\(\{([\s\S]*?)\}\)/)
  assert.ok(block, '没解析到 lib/config.mjs 的 DEFAULT_CONFIG')
  /**
   * 逐行解析 `key: value, // 注释`。两个坑都踩过：
   * ① 一条正则同时吃值+注释时，惰性匹配会把注释吞进值里；
   * ② 仓库是 CRLF，行尾 `\r` 会让 `/\/\/.*$/` 匹配失败（`.` 不匹配 `\r`，`$` 就不在末尾）。
   * 所以：先去掉 `\r`，再剥注释，最后才匹配。
   */
  const parseDefaults = (text) => {
    const out = {}
    for (const rawLine of text.split('\n')) {
      const line = rawLine.replace(/\r$/, '').replace(/\/\/.*$/, '')
      const match = line.match(/^\s*([A-Za-z][A-Za-z0-9]*):\s*(.+?)\s*,?\s*$/)
      if (!match) continue
      out[match[1]] = match[2].trim().replace(/,$/, '')
    }
    return out
  }
  const fromLib = parseDefaults(block[1])
  const settingsSource = read('settings.mjs')
  const settingsBlock = settingsSource.match(/const DEFAULTS = \{([\s\S]*?)\n\}/)
  assert.ok(settingsBlock, '没解析到 settings.mjs 的 DEFAULTS')
  const fromSettings = parseDefaults(settingsBlock[1])
  assert.deepEqual(
    Object.keys(fromSettings).sort(),
    Object.keys(fromLib).sort(),
    'settings.mjs 的 DEFAULTS 键集合必须与 lib/config.mjs 一致',
  )
  for (const [key, rawLib] of Object.entries(fromLib)) {
    const normalized = (value) => value.replace(/'/g, '"').replace(/^"(.*)"$/, '$1')
    assert.equal(
      normalized(fromSettings[key]),
      normalized(rawLib),
      `默认值不一致：${key}（settings=${fromSettings[key]} vs lib=${rawLib}）`,
    )
  }
})

test('文本容器一律禁用横向滚动 + 允许断词', () => {
  for (const file of ['ui.mjs', 'settings.mjs']) {
    const source = read(file)
    assert.ok(!/(^|[^-])overflow-x:\s*(auto|scroll)/.test(source), `${file} 不应出现横向滚动容器`)
    assert.match(source, /overflow-wrap:\s*anywhere|word-break:\s*break-word/, `${file} 长文本必须可断词`)
  }
  // 0.3.0 起 ui.mjs 没有自滚动容器了（消息流被 iframe 取代，滚动发生在官方页面里），
  // settings 的长清单（class 速查）也随页面滚动，所以不再强制要求纵向滚动容器。
})

test('真 GUI 模式：iframe 不许 sandbox，且只走 sidecar 的同源反代', () => {
  const ui = read('ui.mjs')
  assert.match(ui, /guiUrl/, 'ui.mjs 应支持 payload.guiUrl 的 iframe 模式')
  assert.match(ui, /'iframe'/, '应渲染 iframe')
  const iframeBlock = ui.match(/h\('iframe',\s*\{[\s\S]*?\}\)/)
  assert.ok(iframeBlock, '找不到 iframe 的定义')
  // 注释里会解释"为什么不加 sandbox"，所以先剥注释再查
  const iframeCode = iframeBlock[0].replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.ok(
    !/sandbox/.test(iframeCode),
    'iframe 不能加 sandbox：sandbox 会让页面成为 opaque origin，DSH 的信任栅栏直接 403',
  )

  const main = read('runtime/main.mjs')
  assert.match(main, /startGuiProxy/, 'sidecar 应起同源反代')
  assert.match(main, /readBrowserSessionSecret/, 'sidecar 应从 .credentials.yaml 读密钥自签 cookie')
  assert.match(main, /discoverHost/, 'sidecar 应探测正在运行的 DSH host（端口会漂移）')
  // 官方顶栏被去装饰隐藏后，卡片顶部必须显示"会话标题"，而不是裸 session id
  assert.match(main, /guiTitle/, 'openGui 的 payload 要带会话标题')
  assert.match(ui, /guiTitle/, '卡片顶栏要用 guiTitle（拿不到才退回 id）')
})

test('改设置不该要求用户重启插件', () => {
  const settings = read('settings.mjs')
  const ui = read('ui.mjs')
  // 设置页保存后必须把配置推给 sidecar（宿主的 set_plugin_config 不会推）
  assert.match(settings, /call\('applyConfig'/, '设置页保存后必须把配置推给 sidecar（否则要 disable/enable 插件）')
  // 0.3.0 起没有「打开小窗」按钮与自动重开：外观/端口改动靠"下次展开重新取 GUI 地址"生效。
  // 因此 ui.mjs 收起时必须丢弃 iframe 地址，否则下次展开拿到的还是已被 sidecar 关掉的旧反代。
  assert.match(
    ui,
    /function collapse\(\)[\s\S]{0,320}guiUrl\.value = ''/,
    '收起时要清 iframe 地址，保证下次展开重新 /gui 拿新配置的界面',
  )
  assert.ok(!/reopenGuiSoon/.test(settings), '不要再引入自动重开小窗（没有窗口卡要管理了，弹窗会打扰）')
})

test('sidecar：HTTP 桥必须校验 token，且只绑回环', () => {
  const source = read('runtime/main.mjs')
  assert.match(source, /httpToken/, '必须生成一次性 token')
  assert.match(source, /token 不匹配/, '必须拒绝 token 不匹配的请求')
  assert.match(source, /127\.0\.0\.1/, '只允许绑定回环地址')
  assert.match(source, /x-dsh-chat-token|X-Dsh-Chat-Token/, 'token 应支持请求头传递')
  assert.ok(!/\b0\.0\.0\.0\b/.test(source), '不得绑定 0.0.0.0')
})

test('设置页：所有布尔开关必须"能存也能读"（漏了就等于「设置没用」）', () => {
  const settings = read('settings.mjs')
  // 1) 保存路径必须**遍历 DEFAULTS 全键**（而不是逐个登记）：漏键 = 每次保存被抹回默认值
  assert.match(
    settings,
    /for \(const key of Object\.keys\(DEFAULTS\)\)/,
    'compose() 必须遍历 DEFAULTS 全键（曾经只写 SHOW_KEYS → 没登记的键被丢掉）',
  )
  // 2) 加载路径要以 sidecar 的生效配置为准（存盘缺键时不能显示成关），同样遍历全键
  assert.match(settings, /call\('status'\)[\s\S]{0,120}config/, 'loadConfig 应读取 sidecar 的生效配置')
  assert.match(settings, /for \(const key of Object\.keys\(DEFAULTS\)\)/, '加载路径同样要遍历全键回填')
  // 3) 改完要看到效果：外观改动在下次展开时生效（卡片正文有这句说明），不再是自动重开
  assert.match(settings, /下次展开状态卡时生效/, '外观改动要说明"下次展开生效"（否则用户以为设置没用）')
  assert.match(read('ui.mjs'), /展开状态卡时生效|guiUrl\.value = ''/, 'ui.mjs 收起要清 iframe 地址，保证下次展开生效')
  // 4) 用标签云呈现：点亮 = 显示，悬停有说明
  assert.match(settings, /checkable: true/, '显示项应做成可点标签（checkable）')
  assert.match(settings, /'onUpdate:checked'/, '标签必须绑定 onUpdate:checked')
  assert.match(settings, /NTooltip/, '标签要有 hover 说明')
  // tooltip 必须限宽换行：说明是长句，不限宽会拉成一条横线撑出窗口被裁（用户实测截图）
  assert.match(settings, /contentStyle: \{ maxWidth/, 'chip 的 tooltip 要限宽并允许换行')
  const main = read('runtime/main.mjs')
  assert.match(main, /cropFlagsFor\(config\)/, 'sidecar 必须用 config 模块的 cropFlagsFor 生成裁剪项（单一真相）')
  // 宿主不会把新配置推给运行中的 sidecar，所以设置页必须自己 push
  assert.match(main, /applyConfig: methodApplyConfig/, 'sidecar 必须提供 applyConfig RPC')
  assert.match(settings, /call\('applyConfig'/, '设置页保存后必须把配置推给 sidecar（否则要 disable/enable 插件）')
  // 5) 每个显示项都要真的出现在标签清单里（顶层 4 项 + 顶栏内部 7 项）
  for (const key of [
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
  ]) {
    assert.match(settings, new RegExp(`key: '${key}'`), `设置页标签清单缺少 ${key}`)
  }
  // 紧凑留白：独立开关（配置 + 界面 + 传给反代）
  assert.match(main, /compactSpacing: config\.compactSpacing/, 'sidecar 必须把紧凑留白传给 buildCropCss')
  assert.match(main, /forceLabels: forceLabelsFor\(config\)/, 'sidecar 必须把"强制文字标签"传给 buildCropCss')
  assert.match(settings, /switchInput\('compactSpacing'\)/, '设置页要有紧凑留白开关')
  assert.match(settings, /'紧凑留白'/, '开关要有名字')
  assert.match(settings, /compactSpacing:\s*false/, 'settings.mjs 的 DEFAULTS 里要有 compactSpacing（否则保存时被丢）')
  // 自定义 CSS：用户要能自己写排版（收在默认折叠的 details 里）
  assert.match(settings, /customCss/, '设置页应提供自定义 CSS 输入')
  assert.match(main, /customCss: config\.customCss/, 'sidecar 必须把自定义 CSS 注入到反代页面')
  assert.match(settings, /'自定义样式（CSS）与 class 速查'/, 'CSS 区要收进默认折叠')
  // 外观卡版式（用户确认过的设计稿）
  assert.match(settings, /'小窗外观'/, '卡片标题应为「小窗外观」')
  assert.ok(!/└/.test(settings), '不要用 └ 前缀凑层级（用分组小标题）')
  assert.ok(!/\*\*点亮/.test(settings), '说明文案里不要出现 markdown 星号（宿主不渲染 markdown）')
  assert.match(settings, /dsh-chat-settings__chip/, 'chip 描边要用自己的 CSS 类（checkable 的 NTag 会忽略 bordered）')
  assert.match(settings, /dsh-chat-settings__block/, '全宽块要自造（自定义 CSS 区用）')
  // 行排版自造（field）：宿主 SettingRow 只保证 ≈4rem 右侧余量，desc 一长就把输入框压成「23…」（实测截图）
  assert.match(settings, /dsh-chat-settings__field/, '输入/标签行要用自造的 field 排版（说明整行在下）')
  assert.ok(!/h\(SettingRow/.test(settings), '不要再用宿主 SettingRow（窄面板会把固定宽度的控件压扁）')
  // 保存要有脏检查：onBlur 会触发保存，无实际改动不能落盘、不能弹「已保存」
  assert.match(settings, /savedJson/, '保存路径要有"上次落盘快照"的脏检查')
  assert.match(settings, /全部显示/, '应有「全部显示」快捷按钮')
  assert.match(settings, /恢复推荐/, '应有「恢复推荐」快捷按钮')
  assert.match(settings, /插入示例/, '自定义 CSS 区应有「插入示例」')
  assert.match(settings, /清空/, '自定义 CSS 区应有「清空」')
  // 曾经踩过的两个坑，钉死：
  // 1) `.dsh-chat-settings__tags` 被写了两遍，后一条 gap:0 盖掉前一条 → chip 之间没间距
  const tagsRules = settings.match(/\.dsh-chat-settings__tags\s*\{[^}]*\}/g) || []
  assert.equal(tagsRules.length, 1, `__tags 规则只能有一条（实际 ${tagsRules.length} 条，多出来的会互相覆盖）`)
  assert.match(tagsRules[0], /gap:\s*0\.5rem/, 'chip 之间必须有间距')
  // 2) naive-ui 没有 NInput.Textarea（多行必须 type:'textarea'），否则会掉进兜底分支丢 placeholder
  assert.ok(!/h\(NInput\.Textarea/.test(settings), '不要用 NInput.Textarea（naive-ui 里不存在）')
  assert.match(settings, /type:\s*'textarea'/, '多行输入用 NInput + type: textarea')
  // 3) 未选中的 chip 必须有可见描边（checkable 的 NTag 会忽略 bordered，得自己画）
  assert.match(settings, /\.dsh-chat-settings__chip:not\(\.is-on\)\s*\{[^}]*border:\s*1px solid/, '未选中 chip 要有自己的描边')
  assert.match(settings, /\.dsh-chat-settings__chip:not\(\.is-on\)\s*\{[^}]*background:/, '未选中 chip 要有底色（否则看起来像纯文字）')
  // 4) class 速查表：不给清单用户不知道改什么
  assert.match(main, /guiClasses: methodGuiClasses/, 'sidecar 必须提供 class 速查 RPC')
  assert.match(settings, /call\('guiClasses'\)/, '设置页应拉取 class 速查表')
  assert.match(settings, /classCheatSheet/, '设置页应渲染 class 速查表')
  assert.match(settings, /官方 class 带哈希前缀/, '速查表要有"为什么用语义后缀匹配"的说明')
  assert.match(settings, /smallButton\('插入'/, '速查表每行要能一键插入规则骨架')
  // 5) 契约版本自检：两边常量必须一致，且侧车要在 status 里报出来
  const versionOf = (text, file) => {
    const m = text.match(/CONTRACT_VERSION\s*=\s*(\d+)/)
    assert.ok(m, `${file} 缺少 CONTRACT_VERSION`)
    return m[1]
  }
  assert.equal(
    versionOf(settings, 'settings.mjs'),
    versionOf(main, 'runtime/main.mjs'),
    'settings.mjs 与 runtime/main.mjs 的 CONTRACT_VERSION 必须一致',
  )
  assert.match(main, /contract:\s*CONTRACT_VERSION/, 'sidecar 的 status 必须报出契约版本')
  assert.match(settings, /staleSidecar/, '设置页要能提示"侧车在跑旧代码"')
  assert.match(settings, /速查表没加载出来/, '速查表取不到数据时要说明原因（不要静默什么都不显示）')
})
