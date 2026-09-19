import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import readline from 'node:readline'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function unusedPort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address()
  await new Promise((resolve) => server.close(resolve))
  return port
}

test('captures the full pid chain before publishing and answering the hook', { timeout: 15_000 }, async () => {
  const port = await unusedPort()
  const child = spawn(process.execPath, [path.join(__dirname, 'main.mjs')], {
    cwd: __dirname,
    env: { ...process.env, CATRACE_AGENT_NOTIFY_PORT: String(port) },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const messages = []
  const lines = readline.createInterface({ input: child.stdout })
  lines.on('line', (line) => {
    try {
      messages.push(JSON.parse(line))
    } catch {
      // Sidecar stdout is JSONL; malformed lines are irrelevant to this assertion.
    }
  })

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('sidecar ready timeout')), 5_000)
      const poll = setInterval(() => {
        if (messages.some((message) => message.op === 'ready')) {
          clearInterval(poll)
          clearTimeout(timer)
          resolve()
        }
      }, 20)
    })

    const sessionId = `focus-chain-test-${Date.now()}`
    const hook = spawn(process.execPath, ['-e', `
      fetch('http://127.0.0.1:${port}/state', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          agentId: 'zcode',
          hook_event_name: 'Stop',
          session_id: ${JSON.stringify(sessionId)},
          cwd: process.cwd(),
          catrace_hook_ppid: process.pid,
        }),
      }).then((response) => {
        process.stdout.write(String(response.status))
      }).catch(() => process.exitCode = 1)
    `], {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const hookPid = hook.pid
    let hookOutput = ''
    hook.stdout.on('data', (chunk) => { hookOutput += chunk })
    const hookCode = await new Promise((resolve) => hook.once('exit', resolve))
    assert.equal(hookCode, 0)
    assert.equal(hookOutput, '200')

    const publishes = messages.filter((message) =>
      message.op === 'publish' && message.event?.payload?.sessionId === sessionId)
    assert.equal(publishes.length, 1)
    const chain = publishes[0].event.payload.entry.pidChain
    assert.ok(chain.length > 1)
    assert.ok(chain.includes(hookPid))
    assert.ok(messages.some((message) =>
      message.op === 'log' && message.message === 'pid chain captured'))
  } finally {
    child.stdin.write(`${JSON.stringify({ op: 'shutdown' })}\n`)
    await new Promise((resolve) => {
      child.once('exit', resolve)
      setTimeout(() => {
        child.kill()
        resolve()
      }, 1_000)
    })
    lines.close()
  }
})
