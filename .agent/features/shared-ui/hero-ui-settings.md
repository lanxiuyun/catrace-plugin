# 插件设置页用 HeroUI 组件

宿主自己的界面已经全部是 HeroUI v3；从 2026-11 起，插件导出的设置面板（`settings.mjs`）也统一改用 HeroUI 控件，和宿主插件详情页（久坐提醒那套）保持同一套外观、尺寸与深浅色行为。

## 运行时合同

宿主在导入插件模块前注入同一份运行时，Blob 入口不能 `import` 任何包，只能从全局取：

```js
const { createElement: h, useState, useRef, useEffect } = globalThis.__CATRACE_REACT__
const HeroUI = globalThis.__CATRACE_HEROUI__
const { Button, Chip, Input } = HeroUI
if (typeof h !== 'function' || !Button) throw new Error('Catrace React/HeroUI runtime missing')
```

- `__CATRACE_REACT__`：宿主 React 实例（唯一一份，插件 hook 与宿主共享）。
- `__CATRACE_HEROUI__`：宿主 `@heroui/react` 命名空间。组件样式（`@heroui/styles`）由宿主页面加载，插件不再自带控件皮肤。
- `__CATRACE_RADIX__`：Radix Themes 命名空间，只为还没迁移的旧 UI 保留；新代码不要再用。
- 旧宿主没有 `__CATRACE_HEROUI__` 时，插件应显式抛错（设置面板显示加载失败），不要静默降级成原生控件。

## 用扁平导出，不用复合属性

HeroUI 既有 `Switch`（带 `.Content` / `.Control` / `.Thumb` 静态属性）也有扁平的 `SwitchRoot` / `SwitchContent` / `SwitchControl` / `SwitchThumb`。**插件一律用扁平导出**：

- Blob 模块与插件自身的单测都更容易自包含（stub 成字符串类型即可，不需要构造带静态属性的对象）。
- 复合属性只是扁平组件的包装，渲染结果一致。

## 控件映射

| 旧写法 | 现在用 HeroUI | 说明 |
| --- | --- | --- |
| Radix `TextField.Root` / 原生 `input` | `Input` | 使用 HeroUI 当前默认外观，宽度交给插件 CSS class；独立 Input 用原生 `disabled`，不是 `isDisabled`；提供 `aria-label` 或关联标签 |
| Radix `TextArea` / 原生 `textarea` | `TextArea` | 使用 HeroUI 当前默认外观，按需设置 `rows` |
| 原生 `input[type="number"]` / Radix 数字输入 | `NumberFieldRoot` + `NumberFieldGroup` + `NumberFieldInput` + `NumberFieldDecrementButton` + `NumberFieldIncrementButton` | 使用 HeroUI 当前默认外观，`value` 是数字（`null` 表示空），`onChange` 先判 `Number.isFinite`；左右 −/+ 图标自带，按钮补 `aria-label`；`formatOptions={{useGrouping:false}}` 关掉千分位；宽度至少 9rem，别把中间输入区挤没 |
| 自绘 tab / 旧分段 tab | `TabsRoot` + `TabListContainer` + `TabList` + `Tab`（`TabIndicator` 放 `Tab` 内）+ `TabPanel` | **不能省 `TabListContainer`**：HeroUI 默认的灰色底轨画在它上面，漏了会变成一条铺满的白底 tab；选中态、`aria-label` 与 `role=tab/tabpanel` 由组件自带，不要自绘 tab 皮肤 |
| Radix `Button` / 原生 `button` | `Button` | `size="sm"`；`onClick`、`isDisabled`（不是 `disabled`） |
| Radix `Switch` / 原生 checkbox 开关 | `SwitchRoot` + `SwitchContent` + `SwitchControl` + `SwitchThumb` | `isSelected` / `onChange`，标签用 `Label` 放进 `SwitchContent` |
| Radix `SegmentedControl` | `ToggleButtonGroup` + `ToggleButton`（+ `ToggleButtonGroupSeparator`） | `selectionMode="single"`、`selectedKeys={[value]}`、`onSelectionChange` 收到 `Set`，取第一个 key；**分隔线要放进除第一项外的每个 `ToggleButton` 里**（官方 anatomy），不写的话按钮会糊成一块、和 HeroUI 文档里的样式不一样 |
| 多选开关组 / 可点亮标签 | `ToggleButtonGroup`（`selectionMode="multiple"`）+ `ToggleButton`（+ `ToggleButtonGroupSeparator`） | 一组独立开关不要渲染成一排裸 `ToggleButton`：它们和旁边的操作按钮外观一样，用户分不清「开关」和「按钮」；用组容器 + 分隔线，选中态交给组的 `selectedKeys` 受控 |
| Radix `Select` / 原生 `select` | `SelectRoot` + `SelectTrigger` + `SelectValue` + `SelectIndicator` + `SelectPopover` + `ListBox` + `ListBoxItem` | 使用 HeroUI 当前默认外观，每个 item 给 `id` 与 `textValue` |
| Radix `Slider` | `SliderRoot` + `SliderTrack` + `SliderFill` + `SliderThumb` | `value` 是数字，`onChange` 先判断 `typeof value === 'number'` |
| Radix `Badge` / 原生小胶囊 | `Chip` | `size="sm" variant="soft"`，`color` 取 `default` / `accent` / `success` / `warning` / `danger` |
| 短暂操作反馈 / Toast | `Toast.Provider` + `ToastQueue` | 队列通过 `add({ title?, description?, variant })` 入队；Provider 选择 placement。成功反馈仅在有确认价值时显示，预览成功不重复提示；错误使用 Toast，不用占据设置布局的内嵌 Alert |
| Radix `Checkbox` / 原生多选 | `CheckboxRoot` + `CheckboxContent` + `CheckboxControl` + `CheckboxIndicator` | `isSelected` / `onChange` |

尺寸与配色约定和宿主设置页一致：

- 控件默认 `size="sm"`（32px），只有提示条里的行内小动作可以更小。
- `SettingsCardRow.title` 是视觉文字，不会自动关联内部控件；Slider、NumberField、独立 Input 和 ToggleButtonGroup 要显式提供 `aria-label` / `aria-labelledby`。`Input` 的 `disabled` 与 Button / NumberField / Slider 的 `isDisabled` 不能混用，否则会把未知属性传到原生 DOM。
- Input、TextArea、NumberField 与 Select 沿用宿主 HeroUI 当前默认外观，不显式覆写 `variant`；不要在插件里覆写 `--field-*`。
- 蓝色只给可操作 / 当前状态的控件：主操作 `variant="primary"`，普通次操作 `variant="secondary"` / `variant="tertiary"`，危险操作 `variant="danger-soft"`。
- 按钮层级统一：`primary` 只给保存 / 提交类主操作（一屏最多一个）；`secondary` 给会改变状态或数据的动作（安装 Hook、立即拉取、添加、重试）；`tertiary` 给查看 / 预览 / 刷新 / 复制 / 显示隐藏这类辅助动作；`danger-soft` 给破坏性动作（卸载、删除、重置基线、清空）；确认弹窗里的最终确认键用 `danger`。列表行里的状态由 `Chip` 承担，按钮保持安静。

## 分组与行使用宿主公共组件

简单设置页统一使用宿主公共 `globalThis.__CATRACE_SETTINGS_UI__ = { SettingsCard, SettingsCardRow }`：标题和说明放卡片级，设置项用左侧标题、右侧控件的行内布局。宿主负责卡片、行与分隔线的外观；新增简单设置页时沿用此模式，不另造卡片或行布局。

- `SettingsCard` props：`title: string`、`description?: string`、`children`。
- `SettingsCardRow` props：`title: string`、`description?: string`、`control: ReactNode`、`stack?: boolean`、`children?: ReactNode`。控件放 `control`，补充内容放 `children`。
- 标题、说明、卡片背景、行布局与深浅色由宿主管理；插件不依赖宿主 CSS 类名，不再覆写共享组件外观。
- Card 只在连续的 `SettingsCardRow` 之间插入 Separator；原生 note / 预览按钮组保留原生节点，不参与分隔，也不为了分隔线包成 Row。
- 使用该接口要求最新版宿主，缺失 `SettingsCard` / `SettingsCardRow` 时显式抛错，不提供旧宿主兼容。
- 使用 HeroUI Toast 时从 `__CATRACE_HEROUI__` 取 `Toast` / `ToastQueue`，创建队列并在设置组件中渲染 `Toast.Provider`；placement 按产品要求设置（当前 Agent 通知用顶部居中 `top`）。宿主未注入 Toast 合同时显式报错，不实现自绘 toast 或内嵌 Alert 兼容。
- 插件保留业务局部样式（提示音路径、音量、预览组、未检测标记等）；尺寸用 rem，颜色用 `--ct-*` token。原生按钮组等直接内容沿用 Card 内容区默认间距，不额外添加行内 padding；仅在确有布局需要时使用插件前缀 class 做局部排布。
- **不要用 Tailwind utility className**（`flex` / `gap-2` / `w-full` 等）：宿主 Tailwind 只扫描宿主源码，插件里写的工具类不会被生成。
- **不要用 `.card` / `.badge` / `.header` / `.progress-bar` 这种裸类名**：HeroUI 的组件根类就是这些短词，贴在原生 div 上会吃到两套样式。插件自有 class 一律带插件前缀。

## 示例

```js
const { createElement: h, useState } = globalThis.__CATRACE_REACT__
const { Button, Chip, Input, ToggleButton, ToggleButtonGroup, Toast, ToastQueue } = globalThis.__CATRACE_HEROUI__
const { SettingsCard, SettingsCardRow } = globalThis.__CATRACE_SETTINGS_UI__

function segments(label, value, options, onChange, isDisabled) {
  return h(ToggleButtonGroup, {
    'aria-label': label,
    size: 'sm',
    selectionMode: 'single',
    disallowEmptySelection: true,
    selectedKeys: [value],
    isDisabled,
    onSelectionChange(keys) {
      const next = keys instanceof Set ? [...keys][0] : Array.isArray(keys) ? keys[0] : keys
      if (next != null) onChange(String(next))
    },
  }, ...options.map(([id, label]) => h(ToggleButton, { id, key: id }, label)))
}

const feedbackQueue = new ToastQueue({ maxVisibleToasts: 3 })
h(Toast.Provider, { placement: 'top', queue: feedbackQueue })
const notify = (title, description, variant = 'default') => feedbackQueue.add({ title, description, variant })

h(SettingsCard, { title: '通知设置' },
  h(SettingsCardRow, { title: '自动消失时间（秒）', control: h(NumberFieldRoot, {
    className: 'my-plugin-num', value: seconds,
    minValue: 3, maxValue: 600, step: 1, formatOptions: { useGrouping: false },
    isDisabled: !ready, 'aria-label': '自动消失时间',
    onChange: (next) => { if (Number.isFinite(next) && next >= 3 && next <= 600) updateSeconds(Math.round(next)) },
  },
    h(NumberFieldGroup, null,
      h(NumberFieldDecrementButton, { 'aria-label': '减少' }),
      h(NumberFieldInput, null),
      h(NumberFieldIncrementButton, { 'aria-label': '增加' }))) }),
  // Card 内的按钮组直接使用内容区默认间距，不额外加 padding。
  h('div', { className: 'my-plugin-actions' },
    h(Chip, { size: 'sm', variant: 'soft', color: 'success' }, '已安装'),
    h(Button, { size: 'sm', variant: 'primary', onClick: save }, '保存')))
```

## 验证

- 宿主仓库有真实 React SSR + HeroUI 的合同测试：`CATRACE_PLUGIN_SOURCE=<插件仓库路径>` 下跑 `node --test scripts/test-react-plugin-packages.mjs`，会导入并渲染全部 15 个插件的 ui/settings。Agent 额外覆盖自定义音频条件分支的标签、禁用属性及控制台诊断；SSR 不执行挂载 effects，不能把“SSR 没告警”当成完整界面无警告的证明。
- 插件自己的 Node 单测把 `__CATRACE_HEROUI__` stub 成字符串组件类型（如 `{ Button: 'HeroButton', ToggleButtonGroup: 'HeroToggleButtonGroup', Toast: { Provider: 'HeroToastProvider' }, ToastQueue }`），断言继续按组件类型找节点。使用共享设置组件时同时 stub `__CATRACE_SETTINGS_UI__`，保留 Row 的 `control` 槽渲染，验证分组顺序、行结构及原生备注 / 预览组边界；Toast 测试断言 Provider placement 与队列消息；真实 Separator / Toast 视觉行为由宿主合同测试覆盖。
- 不在插件里启动 dev server、不修改用户 AppData 里已安装的插件目录。
