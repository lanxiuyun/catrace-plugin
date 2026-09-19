import { execFile } from 'node:child_process'

const PID_CHAIN_MAX_DEPTH = 20
const PID_CHAIN_MAX_CACHED = 500
const PID_CHAIN_FAIL_TTL_MS = 30_000
const PID_CHAIN_SNAPSHOT_TIMEOUT_MS = 3_000

function execFileText(file, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true, encoding: 'utf8' }, (err, stdout) => {
      resolve(err ? '' : String(stdout))
    })
  })
}

export async function processParentMap() {
  const parents = new Map()
  let out
  if (process.platform === 'win32') {
    out = await execFileText(
      'powershell.exe',
      [
        '-NoProfile', '-NonInteractive', '-Command',
        'Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId | ForEach-Object { "{0} {1}" -f $_.ProcessId, $_.ParentProcessId }',
      ],
      PID_CHAIN_SNAPSHOT_TIMEOUT_MS,
    )
  } else {
    out = await execFileText('ps', ['-axo', 'pid=,ppid='], 4_000)
  }
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(line)
    if (m) parents.set(Number(m[1]), Number(m[2]))
  }
  return parents
}

export async function capturePidChain(hookPpid) {
  if (!hookPpid || hookPpid <= 1) return []
  const parents = await processParentMap()
  const chain = []
  let pid = hookPpid
  while (pid > 1 && !chain.includes(pid) && chain.length < PID_CHAIN_MAX_DEPTH) {
    chain.push(pid)
    pid = parents.get(pid) || 0
  }
  return chain
}

export function createPidChainCache() {
  /** @type {Map<string, number[]>} `agentId:sessionId` -> 进程链（由内向外） */
  const pidChainCache = new Map()
  const pidChainInflight = new Map()
  const pidChainFailAt = new Map()

  async function ensurePidChain(key, hookPpid) {
    const cached = pidChainCache.get(key)
    if (cached) return cached
    const failedAt = pidChainFailAt.get(key)
    if (failedAt && Date.now() - failedAt < PID_CHAIN_FAIL_TTL_MS) return []
    const pending = pidChainInflight.get(key)
    if (pending) return pending
    const task = capturePidChain(hookPpid)
      .then((chain) => {
        if (chain.length) {
          if (pidChainCache.size >= PID_CHAIN_MAX_CACHED) {
            for (const stale of [...pidChainCache.keys()].slice(0, PID_CHAIN_MAX_CACHED / 2)) {
              pidChainCache.delete(stale)
            }
          }
          pidChainCache.set(key, chain)
        } else {
          pidChainFailAt.set(key, Date.now())
        }
        return chain
      })
      .finally(() => pidChainInflight.delete(key))
    pidChainInflight.set(key, task)
    return task
  }

  return { ensurePidChain }
}
