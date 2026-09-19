import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildWindowsFocusScript,
  normalizePidChain,
  parseWindowsFocusResult,
} from './focus-windows.mjs'

test('normalizes and limits pid chains', () => {
  const input = [0, 7, '8', 7, -1, 1.5, ...Array.from({ length: 30 }, (_, index) => index + 10)]
  const result = normalizePidChain(input)
  assert.deepEqual(result.slice(0, 2), [7, 8])
  assert.equal(result.length, 20)
  assert.equal(new Set(result).size, result.length)
})

test('builds app-first focus script that restores every selected window', () => {
  const script = buildWindowsFocusScript([123, 456])
  const appIndex = script.indexOf("$category = 'app'")
  const terminalIndex = script.indexOf("$category = 'terminal'")
  const consoleIndex = script.indexOf("$category = 'console'")

  assert.ok(appIndex > 0)
  assert.ok(terminalIndex > appIndex)
  assert.ok(consoleIndex > terminalIndex)
  assert.match(script, /foreach \(\$window in \$windows\)/)
  assert.match(script, /ShowWindow\(hWnd, 5\)/)
  assert.match(script, /ShowWindow\(hWnd, 9\)/)
  assert.match(script, /ZCode\|Codex\|Claude\|Code/)
  assert.match(script, /OleDdeWndClass/)
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
