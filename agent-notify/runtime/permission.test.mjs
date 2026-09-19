import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildElicitationUpdatedInput,
  elicitationQuestions,
  permissionDecisionBody,
  validateIndexedElicitationAnswers,
} from './permission.mjs'

test('elicitation validation requires indexed answers for every question', () => {
  const toolInput = {
    questions: [
      { question: 'A?' },
      { question: 'B?' },
    ],
  }
  assert.equal(elicitationQuestions(toolInput).length, 2)
  assert.equal(validateIndexedElicitationAnswers(toolInput, { 0: 'x' }).ok, false)
  const ok = validateIndexedElicitationAnswers(toolInput, { 0: 'x', 1: 'y' })
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.answers, { 'A?': 'x', 'B?': 'y' })
  assert.deepEqual(buildElicitationUpdatedInput(toolInput, ok.answers).answers, ok.answers)
})

test('permissionDecisionBody wraps allow/deny', () => {
  assert.match(permissionDecisionBody('allow'), /"behavior":"allow"/)
  assert.match(permissionDecisionBody('deny'), /"behavior":"deny"/)
  assert.equal(permissionDecisionBody('timeout'), '{}')
})
