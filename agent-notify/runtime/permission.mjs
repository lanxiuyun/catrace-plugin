export function elicitationQuestions(toolInput) {
  if (!toolInput || typeof toolInput !== 'object' || Array.isArray(toolInput)) return []
  const questions = Array.isArray(toolInput.questions) ? toolInput.questions : []
  return questions.filter((item) => item && typeof item.question === 'string' && item.question.trim())
}

export function remapIndexedElicitationAnswers(toolInput, indexedAnswers) {
  const questions = elicitationQuestions(toolInput)
  const source = indexedAnswers && typeof indexedAnswers === 'object' && !Array.isArray(indexedAnswers)
    ? indexedAnswers
    : {}
  const answers = {}
  for (let i = 0; i < questions.length; i++) {
    if (!Object.prototype.hasOwnProperty.call(source, String(i))) continue
    const value = source[String(i)]
    if (typeof value === 'string' && value.trim()) answers[questions[i].question] = value.trim()
  }
  return answers
}

export function validateIndexedElicitationAnswers(toolInput, indexedAnswers) {
  const questions = elicitationQuestions(toolInput)
  if (!questions.length) return { ok: false, reason: 'elicitation has no questions' }
  if (!indexedAnswers || typeof indexedAnswers !== 'object' || Array.isArray(indexedAnswers)) {
    return { ok: false, reason: 'elicitation answers must be an indexed object' }
  }
  const expected = questions.map((_q, index) => String(index))
  const keys = Object.keys(indexedAnswers)
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
    return { ok: false, reason: 'elicitation answers do not match all questions' }
  }
  const answers = remapIndexedElicitationAnswers(toolInput, indexedAnswers)
  if (Object.keys(answers).length !== questions.length) {
    return { ok: false, reason: 'elicitation answers are incomplete' }
  }
  return { ok: true, answers }
}

export function buildElicitationUpdatedInput(toolInput, answers) {
  const input = toolInput && typeof toolInput === 'object' ? toolInput : {}
  const questions = Array.isArray(input.questions) ? input.questions : []
  return { ...input, questions, answers }
}

export function permissionDecisionBody(decision, extra = {}) {
  if (decision === 'allow') {
    const payload = { behavior: 'allow' }
    if (extra.updatedInput) payload.updatedInput = extra.updatedInput
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: payload,
      },
    })
  }
  if (decision === 'deny') {
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'deny' },
      },
    })
  }
  return '{}'
}

export function createPermissionStore({ cors, log, permWaitMs, publishPermission }) {
  /** @type {Map<number, { res: import('node:http').ServerResponse, sessionId: string, timer: NodeJS.Timeout, toolName?: string, toolInput?: unknown }>} */
  const pendingPerm = new Map()
  let permId = 1

  function finishPerm(id, decision, extra = {}) {
    const pending = pendingPerm.get(id)
    if (!pending) return false
    clearTimeout(pending.timer)
    pendingPerm.delete(id)
    const body = permissionDecisionBody(decision, extra)
    try {
      cors(pending.res, 200, body)
    } catch {
      /* already closed */
    }
    return true
  }

  function decidePermission(id, decision, indexedAnswers) {
    const pending = pendingPerm.get(id)
    if (!pending) return { ok: false, error: 'permission request expired' }
    if (decision === 'deny') {
      finishPerm(id, 'deny')
      return { ok: true }
    }
    if (decision !== 'allow') return { ok: false, error: 'invalid decision' }
    const questions = elicitationQuestions(pending.toolInput)
    if (questions.length) {
      const validated = validateIndexedElicitationAnswers(pending.toolInput, indexedAnswers)
      if (!validated.ok) {
        if (log) log('elicitation rejected', { id, reason: validated.reason }, 'warn')
        return { ok: false, error: validated.reason }
      }
      finishPerm(id, 'allow', {
        updatedInput: buildElicitationUpdatedInput(pending.toolInput, validated.answers),
      })
      return { ok: true }
    }
    finishPerm(id, 'allow')
    return { ok: true }
  }

  function handlePermissionDecideHttp(payload, res) {
    if (!payload) {
      cors(res, 400, JSON.stringify({ ok: false, error: 'invalid json' }))
      return
    }
    const id = Number(payload.id)
    const decision = payload.decision
    let answers = payload.answers
    if (typeof answers === 'string') {
      try { answers = JSON.parse(answers) } catch { answers = null }
    }
    if (log) log('permission decide', { id, decision, answerKeys: answers && Object.keys(answers) }, 'info')
    const result = Number.isInteger(id) && id > 0 ? decidePermission(id, decision, answers) : { ok: false, error: 'invalid id' }
    cors(res, result.ok ? 200 : 409, JSON.stringify(result))
  }

  function timeoutSessionPerms(sessionId) {
    for (const [id, p] of pendingPerm) {
      if (p.sessionId === sessionId) finishPerm(id, 'timeout')
    }
  }

  function startPermission(req, res, data) {
    const id = permId++
    const sessionId = data.sessionId
    if (sessionId && sessionId !== 'unknown') timeoutSessionPerms(sessionId)
    const timer = setTimeout(() => finishPerm(id, 'timeout'), permWaitMs)
    pendingPerm.set(id, {
      res,
      sessionId,
      timer,
      toolName: data.permission && data.permission.toolName,
      toolInput: data.permission && data.permission.toolInput,
    })
    publishPermission(id, data)
    return id
  }

  function allocPermId() {
    return permId++
  }

  return {
    pendingPerm,
    finishPerm,
    decidePermission,
    handlePermissionDecideHttp,
    timeoutSessionPerms,
    startPermission,
    allocPermId,
  }
}
