/**
 * 「前台窗口是不是 DSH」判据的单测。
 * 这些样例都是从本机实测/官方源码里抄回来的真实形态，不是编的：
 *  - 桌面版窗口标题 `DeepSeek Harness Desktop`（桌面壳 windowTitle 写死，实测）；
 *  - 浏览器标题 `"<标签页标题> - Google Chrome"`（实测）；
 *  - 网页 `<title>` = `DeepSeek Harness`，开会话后变 `"<会话标题> — DeepSeek Harness"`
 *    （`dsh-client-ui-layout`：`document.title = title === undefined ? productTitle : \`${title} — ${productTitle}\``）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isDshForeground } from '../lib/dsh-window.mjs'

test('DSH 桌面版：进程名命中（含 .exe / 完整路径）', () => {
  const plain = isDshForeground({ app: 'DSH Desktop', title: 'DeepSeek Harness Desktop' })
  assert.equal(plain.dsh, true)
  assert.equal(plain.reason, 'app', '进程名命中优先，日志里能看出是哪条规则')
  assert.equal(isDshForeground({ app: 'DSH Desktop.exe' }).dsh, true)
  assert.equal(isDshForeground({ app: 'C:\\Program Files\\DSH Desktop\\DSH Desktop.exe' }).dsh, true)
  assert.equal(isDshForeground({ app: 'dsh desktop' }).dsh, true, '大小写不敏感（macOS 上写法可能不同）')
})

test('浏览器开着 DSH 标签页：标题命中', () => {
  const withSession = isDshForeground({
    app: 'chrome',
    title: '修登录页 — DeepSeek Harness - Google Chrome',
  })
  assert.equal(withSession.dsh, true)
  assert.equal(withSession.reason, 'title')
  // 没有会话名时的裸标题也要命中
  assert.equal(isDshForeground({ app: 'msedge', title: 'DeepSeek Harness - Microsoft Edge' }).dsh, true)
  assert.equal(isDshForeground({ app: 'unknown', title: 'deepseek harness' }).dsh, true, '大小写不敏感')
})

test('浏览器开着别的标签页 → 不算（DSH 在后台标签页时标题不是它）', () => {
  assert.equal(isDshForeground({ app: 'chrome', title: 'P6_哔哩哔哩_bilibili - Google Chrome' }).dsh, false)
  assert.equal(isDshForeground({ app: 'firefox', title: 'GitHub - Mozilla Firefox' }).dsh, false)
})

test('终端里的 dsh CLI 本期有意不认（判据会误伤别的标签页）', () => {
  assert.equal(isDshForeground({ app: 'WindowsTerminal.exe', title: 'dsh — Catrace' }).dsh, false)
  assert.equal(isDshForeground({ app: 'Code.exe', title: 'catrace — bash — dsh' }).dsh, false)
})

test('别的编辑器窗口标题里出现 DSH 字母也不该命中', () => {
  const editor = isDshForeground({ app: 'Code.exe', title: 'dsh-window.mjs - Catrace - Visual Studio Code' })
  assert.equal(editor.dsh, false, '只认 “DeepSeek Harness” 这个全名，不认零散的 dsh')
})

test('读不到 / 空值 / 脏值：一律 false，不抛', () => {
  assert.equal(isDshForeground(null).dsh, false)
  assert.equal(isDshForeground(undefined).dsh, false)
  assert.equal(isDshForeground({}).dsh, false)
  assert.equal(isDshForeground({ app: '', title: '' }).dsh, false)
  assert.equal(isDshForeground({ app: 42, title: null }).dsh, false)
  assert.equal(isDshForeground({ app: '  ', title: '   ' }).dsh, false)
  assert.equal(isDshForeground({ app: 'unknown', title: '' }).reason, 'none')
})
