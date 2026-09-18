import assert from 'node:assert/strict'
import test from 'node:test'
import { cacheKey, cardBody, cardTitle, cleanTitle, normalizeHookData, projectName } from './hook-data.mjs'
import { EVENT_BODY } from './constants.mjs'

test('normalizeHookData maps Gemini aliases and common fields', () => {
  const data = normalizeHookData({
    hook_event_name: 'AfterAgent',
    session_id: 's1',
    cwd: 'C:\\work_sapce\\Catrace',
    lastAssistantMessage: 'done',
    catrace_hook_ppid: 42,
  }, 'gemini')
  assert.equal(data.event, 'Stop')
  assert.equal(data.sessionId, 's1')
  assert.equal(data.projectName, 'Catrace')
  assert.equal(data.message, 'done')
  assert.equal(data.hookPpid, 42)
  assert.equal(data.agentId, 'gemini')
})

test('normalizeHookData keeps PermissionRequest tool fields', () => {
  const data = normalizeHookData({
    hook_event_name: 'PermissionRequest',
    sessionId: 's2',
    toolName: 'AskUserQuestion',
    tool_input: { questions: [{ question: 'ok?' }] },
  }, 'zcode')
  assert.equal(data.event, 'PermissionRequest')
  assert.equal(data.permission.toolName, 'AskUserQuestion')
  assert.equal(data.permission.toolInput.questions[0].question, 'ok?')
})

test('card helpers fall back to event body', () => {
  assert.equal(projectName('C:/a/b'), 'b')
  assert.equal(cacheKey('zcode', 'abc'), 'zcode:abc')
  assert.equal(cleanTitle('  hello   world  '), 'hello world')
  assert.equal(cardTitle({ sessionTitle: 'named' }), 'named')
  assert.equal(cardBody({ event: 'Stop' }, EVENT_BODY), EVENT_BODY.Stop)
})
