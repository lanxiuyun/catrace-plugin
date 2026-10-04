# 「设置改了没反应 / 插件一重启就还原」= compose() 漏键（同一 bug 踩了三次）

这是 dsh-chat 最高频的困惑源之一。用户三次报上来的说法都不一样，但**根因是同一个**。

## 症状（用户原话）

1. 「为什么修改了之后，还需要将插件重启才可以更改啊？」
2. 「我改完显示的数字之后，还是需要将 plugin disable、enable 重新一遍」
3. 「紧凑留白看来关了，怎么感觉没区别啊。。。而且设置了之后，插件一重启，设置又还原了」

## 根因

`settings.mjs` 的 `compose()` 负责把界面表单组装成要写盘的配置，它的第一行是 `{ ...DEFAULTS }`，
然后**只把登记在名单里的键**写回去：

```js
const out = { ...DEFAULTS }
for (const key of TEXT_KEYS) ...   // 字符串
for (const key of NUM_KEYS) ...    // 数值
for (const key of SHOW_KEYS) ...   // 布尔（只写了显示项！）
```

于是**没出现在任何名单里的键，每次保存都被 `{...DEFAULTS}` 抹回默认值**：

| 第几次 | 被漏掉的键 | 表现 |
|---|---|---|
| 1 | 新增的 `show*` 键 | 标签点了没反应（因为保存时被抹回默认） |
| 2 | `customCss` | 用户写的自定义 CSS 每次保存被清空 → "自定义样式没用" |
| 3 | `compactSpacing` | 开关看着能点，但侧车收到的一直是 `false` ⇒ CSS 根本没注入（"没区别"），重启后显示成关（"还原"） |

**这个 bug 的可怕之处是它的伪装**：症状看起来像"CSS 选择器写错了 / 反代没重建 / 需要重启插件"，
于是容易往那几个方向查半天。**先查保存对象里到底有没有这个键**，是最快的分叉。

## 结构性修法（已落地）

`compose()` 与 `loadConfig()` 都改成**遍历 `DEFAULTS` 全键 + 按默认值类型处理**：

```js
for (const key of Object.keys(DEFAULTS)) {
  const fallback = DEFAULTS[key]
  if (NUM_KEYS.includes(key)) out[key] = clamp(nums.value[key], key)
  else if (typeof fallback === 'boolean') out[key] = Boolean(text.value[key])
  else out[key] = String(text.value[key] ?? fallback).trim()
}
```

**新增配置键不必再登记任何名单**——这正是修法的目的：这类 bug 只要还依赖"人工登记"，就会继续复发。

## 护栏（防第四次）

- `runtime/test/ui-render.test.mjs`
  - **通用**：保存对象必须包含 `DEFAULTS` 的**每一个**键（键集合从 `settings.mjs` 源码解析，新增键自动纳入）；
  - 打开「紧凑留白」后，保存对象里必须是 `true`；
  - 自定义 CSS 必须原样保存。
- `runtime/test/plugin-contract.test.mjs`
  - 静态断言 `settings.mjs` 里必须出现 `for (const key of Object.keys(DEFAULTS))`；
  - DEFAULTS 键集合必须与 `runtime/lib/config.mjs` 的 `DEFAULT_CONFIG` 一致。
- `runtime/test/config.test.mjs`：紧凑留白只接受布尔值，且必须改变 `guiSignature()`（否则不会重建反代）。

## 顺带修掉的测试自身 bug：CRLF 让"剥行尾注释"静默失效

上面那条"默认值必须与 sidecar 一致"的测试要逐行解析 `key: value, // 注释`。原实现用一条正则同时吃值和注释，
且**没有先去掉 `\r`**。Windows 仓库是 CRLF ⇒ `/\/\/.*$/` 匹配失败（`.` 不匹配 `\r`，`$` 就不在末尾）⇒
注释被当成值的一部分，`dshHome` 被解析成 `"'', // 空 = 自动探测"`，测试误报。

修法：**先 `replace(/\r$/, '')` 再剥注释，最后才匹配**。教训：这类"解析源码文本做断言"的测试，
换行符必须在第一步就规范化，否则它失败的方式会很反直觉（看起来像"默认值写错了"）。
