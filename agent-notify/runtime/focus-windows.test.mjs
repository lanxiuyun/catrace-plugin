import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildWindowsFocusScript,
  isFocusableAppWindow,
  normalizePidChain,
  parseWindowsFocusResult,
  selectFocusWindows,
  WS_EX_NOACTIVATE,
  WS_EX_TOOLWINDOW,
  WS_EX_TRANSPARENT,
} from './focus-windows.mjs'

test('normalizes and limits pid chains', () => {
  const input = [0, 7, '8', 7, -1, 1.5, ...Array.from({ length: 30 }, (_, index) => index + 10)]
  const result = normalizePidChain(input)
  assert.deepEqual(result.slice(0, 2), [7, 8])
  assert.equal(result.length, 20)
  assert.equal(new Set(result).size, result.length)
})

test('builds app-first focus script that skips hidden overlays', () => {
  const script = buildWindowsFocusScript([123, 456])
  const appIndex = script.indexOf("$category = 'app'")
  const terminalIndex = script.indexOf("$category = 'terminal'")
  const consoleIndex = script.indexOf("$category = 'console'")

  assert.ok(appIndex > 0)
  assert.ok(terminalIndex > appIndex)
  assert.ok(consoleIndex > terminalIndex)
  assert.match(script, /foreach \(\$window in \$windows\)/)
  assert.match(script, /IsIconic\(hWnd\)/)
  assert.match(script, /ShowWindow\(hWnd, SW_RESTORE\)/)
  assert.doesNotMatch(script, /ShowWindow\(hWnd, 5\)/)
  assert.match(script, /ZCode\|Codex\|Claude\|Code\|Cursor\|Trae\|Windsurf\|Kiro\|ChatGPT/)
  assert.match(script, /OleDdeWndClass/)
  assert.match(script, /CodexComputerUseSwiftOverlay/)
  assert.match(script, /WS_EX_TRANSPARENT/)
  assert.match(script, /ok = \$restored -gt 0/)
})

test('parses the final PowerShell JSON result', () => {
  const result = parseWindowsFocusResult('diagnostic\n{"ok":true,"category":"app","restored":2,"candidates":2}\n')
  assert.deepEqual(result, {
    ok: true,
    category: 'app',
    restored: 2,
    candidates: 2,
  })
})

test('invalid PowerShell output is a safe failure', () => {
  assert.deepEqual(parseWindowsFocusResult('not-json'), {
    ok: false,
    category: 'none',
    restored: 0,
    candidates: 0,
  })
})

const liveCodexDump = [
  {
    name: 'hidden electron ghost',
    hwnd: 0x10B0CE6,
    title: 'ChatGPT',
    className: 'Chrome_WidgetWin_1',
    visible: false,
    iconic: false,
    owner: false,
    exStyle: 0x00200088,
    width: 773,
    height: 1441,
  },
  {
    name: 'computer-use overlay',
    hwnd: 0x7E10E2,
    title: 'ChatGPT is using your computer. Esc to cancel',
    className: 'CodexComputerUseSwiftOverlay',
    visible: false,
    iconic: false,
    owner: false,
    exStyle: 0x082000A8,
    width: 2560,
    height: 1440,
  },
  {
    name: 'visible main window',
    hwnd: 0x481A96,
    title: 'ChatGPT',
    className: 'Chrome_WidgetWin_1',
    visible: true,
    iconic: false,
    owner: false,
    exStyle: 0x00240100,
    width: 1560,
    height: 956,
  },
  {
    name: 'untitled chrome host',
    hwnd: 0xBE1216,
    title: '',
    className: 'Chrome_WidgetWin_0',
    visible: false,
    iconic: false,
    owner: false,
    exStyle: 0x00000100,
    width: 1280,
    height: 677,
  },
]

test('rejects live Codex overlay and hidden ghost windows', () => {
  const overlay = liveCodexDump.find((item) => item.name === 'computer-use overlay')
  const ghost = liveCodexDump.find((item) => item.name === 'hidden electron ghost')
  const main = liveCodexDump.find((item) => item.name === 'visible main window')
  assert.equal(isFocusableAppWindow(overlay), false)
  assert.equal(isFocusableAppWindow(ghost), false)
  assert.equal(isFocusableAppWindow(main), true)
  assert.deepEqual(selectFocusWindows(liveCodexDump).map((item) => item.name), ['visible main window'])
})

test('rejects transparent / tool / noactivate overlays even if already visible', () => {
  assert.equal(isFocusableAppWindow({
    title: 'ChatGPT is using your computer. Esc to cancel',
    className: 'Chrome_WidgetWin_1',
    visible: true,
    iconic: false,
    owner: false,
    exStyle: WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
    width: 2560,
    height: 1440,
  }), false)
})

test('still focuses a minimized app window', () => {
  assert.equal(isFocusableAppWindow({
    title: 'ChatGPT',
    className: 'Chrome_WidgetWin_1',
    visible: false,
    iconic: true,
    owner: false,
    exStyle: 0x00240100,
    width: 160,
    height: 28,
  }), true)
})
