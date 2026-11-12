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
| Radix `TextField.Root` / 原生 `input` | `Input` | `variant="secondary"`，宽度交给插件 CSS class |
| Radix `TextArea` / 原生 `textarea` | `TextArea` | `variant="secondary"` + `rows` |
| 原生 `input[type="number"]` / Radix 数字输入 | `NumberFieldRoot` + `NumberFieldGroup` + `NumberFieldInput` + `NumberFieldDecrementButton` + `NumberFieldIncrementButton` | `variant="secondary"`；`value` 是数字（`null` 表示空），`onChange` 先判 `Number.isFinite`；左右 −/+ 图标自带，按钮补 `aria-label`；`formatOptions={{useGrouping:false}}` 关掉千分位；宽度至少 9rem，别把中间输入区挤没 |
| 自绘 tab / 旧分段 tab | `TabsRoot` + `TabListContainer` + `TabList` + `Tab`（`TabIndicator` 放 `Tab` 内）+ `TabPanel` | **不能省 `TabListContainer`**：HeroUI 默认的灰色底轨画在它上面，漏了会变成一条铺满的白底 tab；选中态、`aria-label` 与 `role=tab/tabpanel` 由组件自带，不要自绘 tab 皮肤 |
| Radix `Button` / 原生 `button` | `Button` | `size="sm"`；`onClick`、`isDisabled`（不是 `disabled`） |
| Radix `Switch` / 原生 checkbox 开关 | `SwitchRoot` + `SwitchContent` + `SwitchControl` + `SwitchThumb` | `isSelected` / `onChange`，标签用 `Label` 放进 `SwitchContent` |
| Radix `SegmentedControl` | `ToggleButtonGroup` + `ToggleButton`（+ `ToggleButtonGroupSeparator`） | `selectionMode="single"`、`selectedKeys={[value]}`、`onSelectionChange` 收到 `Set`，取第一个 key；**分隔线要放进除第一项外的每个 `ToggleButton` 里**（官方 anatomy），不写的话按钮会糊成一块、和 HeroUI 文档里的样式不一样 |
| 多选开关组 / 可点亮标签 | `ToggleButtonGroup`（`selectionMode="multiple"`）+ `ToggleButton`（+ `ToggleButtonGroupSeparator`） | 一组独立开关不要渲染成一排裸 `ToggleButton`：它们和旁边的操作按钮外观一样，用户分不清「开关」和「按钮」；用组容器 + 分隔线，选中态交给组的 `selectedKeys` 受控 |
| Radix `Select` / 原生 `select` | `SelectRoot` + `SelectTrigger` + `SelectValue` + `SelectIndicator` + `SelectPopover` + `ListBox` + `ListBoxItem` | `variant="secondary"`；每个 item 给 `id` 与 `textValue` |
| Radix `Slider` | `SliderRoot` + `SliderTrack` + `SliderFill` + `SliderThumb` | `value` 是数字，`onChange` 先判断 `typeof value === 'number'` |
| Radix `Badge` / 原生小胶囊 | `Chip` | `size="sm" variant="soft"`，`color` 取 `default` / `accent` / `success` / `warning` / `danger` |
| 自绘提示条 `.alert` / `.callout` | `AlertRoot` + `AlertIndicator` + `AlertContent` + `AlertDescription` | `status` 取 `default` / `accent` / `success` / `warning` / `danger`；错误提示保留 `role="alert"` |
| Radix `Checkbox` / 原生多选 | `CheckboxRoot` + `CheckboxContent` + `CheckboxControl` + `CheckboxIndicator` | `isSelected` / `onChange` |

尺寸与配色约定和宿主设置页一致：

- 控件默认 `size="sm"`（32px），只有提示条里的行内小动作可以更小。
- 单行输入、多行输入、下拉统一 `variant="secondary"`（白卡上有浅灰底，深色下自动适配）；不要在插件里覆写 `--field-*`。
- 蓝色只给可操作 / 当前状态的控件：主操作 `variant="primary"`，普通次操作 `variant="secondary"` / `variant="tertiary"`，危险操作 `variant="danger-soft"`。
- 按钮层级统一：`primary` 只给保存 / 提交类主操作（一屏最多一个）；`secondary` 给会改变状态或数据的动作（安装 Hook、立即拉取、添加、重试）；`tertiary` 给查看 / 预览 / 刷新 / 复制 / 显示隐藏这类辅助动作；`danger-soft` 给破坏性动作（卸载、删除、重置基线、清空）；确认弹窗里的最终确认键用 `danger`。列表行里的状态由 `Chip` 承担，按钮保持安静。

## 布局仍然归插件

HeroUI 只接管**控件**；卡片、分组标题、行距仍由插件自己的 CSS 负责，避免插件之间互相依赖宿主的类名：

- 分组标题：`.8125rem/700`、`color: var(--ct-text-muted)`，白色卡片用 `var(--ct-surface)` + `1px var(--ct-border-card)` + `1rem` 圆角，和宿主详情页同语言。
- 尺寸用 rem；颜色用 `--ct-*` token，深浅色自动跟随。
- **不要用 Tailwind utility className**（`flex` / `gap-2` / `w-full` 等）：宿主 Tailwind 只扫描宿主源码，插件里写的工具类不会被生成。
- **不要用 `.card` / `.badge` / `.header` / `.progress-bar` 这种裸类名**：HeroUI 的组件根类就是这些短词，贴在原生 div 上会吃到两套样式。插件自有 class 一律带插件前缀。

## 示例

```js
const { createElement: h, useState } = globalThis.__CATRACE_REACT__
const { Button, Chip, Input, ToggleButton, ToggleButtonGroup } = globalThis.__CATRACE_HEROUI__

function segments(value, options, onChange, isDisabled) {
  return h(ToggleButtonGroup, {
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

h('div', { className: 'my-plugin-row' },
  h('span', { className: 'my-plugin-row-label' }, '自动消失时间（秒）'),
  h(NumberFieldRoot, {
    variant: 'secondary', className: 'my-plugin-num', value: seconds,
    minValue: 3, maxValue: 600, step: 1, formatOptions: { useGrouping: false },
    isDisabled: !ready, 'aria-label': '自动消失时间',
    onChange: (next) => { if (Number.isFinite(next) && next >= 3 && next <= 600) updateSeconds(Math.round(next)) },
  },
    h(NumberFieldGroup, null,
      h(NumberFieldDecrementButton, { 'aria-label': '减少' }),
      h(NumberFieldInput, null),
      h(NumberFieldIncrementButton, { 'aria-label': '增加' }))),
  h(Chip, { size: 'sm', variant: 'soft', color: 'success' }, '已安装'),
  h(Button, { size: 'sm', variant: 'primary', onClick: save }, '保存'))
```

## 验证

- 宿主仓库有真实 React SSR + HeroUI 的合同测试：`CATRACE_PLUGIN_SOURCE=<插件仓库路径>` 下跑 `node --test scripts/test-react-plugin-packages.mjs`，会导入并渲染全部 15 个插件的 ui/settings。
- 插件自己的 Node 单测把 `__CATRACE_HEROUI__` stub 成字符串组件类型（如 `{ Button: 'HeroButton', ToggleButtonGroup: 'HeroToggleButtonGroup' }`），断言继续按组件类型找节点。
- 不在插件里启动 dev server、不修改用户 AppData 里已安装的插件目录。
