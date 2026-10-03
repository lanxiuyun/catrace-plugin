/**
 * class 速查表测试：
 *  - 结构合法（选择器形如 [class*="_x"] 或 .cm-*，无重复）
 *  - **不许和实现漂移**：buildCropCss 用到的每个语义后缀都必须能在速查表里找到
 *    （否则用户照着表改样式，却看不到我们实际在用的那个元素）
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { GUI_CLASS_GROUPS, listGuiClasses } from '../lib/gui-classes.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..', '..')

test('速查表：结构合法、选择器不重复', () => {
  const flat = listGuiClasses()
  assert.ok(flat.length >= 30, `速查表太少了（${flat.length} 项）`)
  // 允许三种形态：.cm-xxx / [class*="_x"] / [class*="_x"]:has([class*="_y"]) / [class*="_x"] [class*="_y"]
  const shape =
    /^(\.cm-[\w-]+|\[class\*="_[A-Za-z][\w-]*"\](?::has\(\[class\*="_[A-Za-z][\w-]*"\]\))?(?:\s+\[class\*="_[A-Za-z][\w-]*"\])?)$/
  for (const item of flat) {
    assert.ok(shape.test(item.selector), `选择器不合规：${item.selector}`)
    assert.ok(item.desc && item.desc.length >= 4, `${item.selector} 缺少说明`)
    assert.ok(item.group, `${item.selector} 缺少分组`)
  }
  const selectors = flat.map((item) => item.selector)
  assert.equal(new Set(selectors).size, selectors.length, '选择器不能重复')
  assert.ok(GUI_CLASS_GROUPS.length >= 4, '分组太少')
})

test('速查表不许与实现漂移：crop/覆盖用到的语义后缀都要在表里', () => {
  const proxy = readFileSync(join(ROOT, 'runtime', 'lib', 'gui-proxy.mjs'), 'utf8')
  // 只取 buildCropCss 里用到的 [class*="_xxx"] 语义名
  const used = new Set([...proxy.matchAll(/\[class\*="_([A-Za-z][\w-]*)"/g)].map((m) => m[1]))
  assert.ok(used.size >= 8, `buildCropCss 里应至少用到 8 个语义名（实际 ${used.size}）`)
  const catalog = new Set()
  for (const item of listGuiClasses()) {
    // 一个选择器里可能有两段（如 `[class*="_titleRow"] [class*="_label"]`），全都要收
    for (const m of item.selector.matchAll(/\[class\*="_([A-Za-z][\w-]*)"/g)) catalog.add(m[1])
  }
  const missing = [...used].filter((name) => !catalog.has(name))
  assert.deepEqual(missing, [], `这些在实现里用到、但速查表没列：${missing.join(', ')}`)
})
