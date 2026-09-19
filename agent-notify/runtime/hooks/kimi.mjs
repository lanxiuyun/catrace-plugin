import fs from 'node:fs'
import path from 'node:path'
import { SHARED_EVENTS, backup, commandFor, containsMarker, home } from './shared.mjs'

function kimiConfigPaths() {
  const paths = [path.join(home(), '.kimi', 'config.toml')]
  const envHome = process.env.KIMI_CODE_HOME
  const kimiCode = envHome && envHome.trim() ? envHome.trim() : path.join(home(), '.kimi-code')
  paths.push(path.join(kimiCode, 'config.toml'))
  return paths
}

function kimiHasHook(content) {
  return content.includes('[[hooks]]') && containsMarker(content)
}

function stripKimiHooks(content) {
  const lines = content.split(/\r?\n/)
  const out = []
  let removed = 0
  let i = 0
  const isHeader = (l) => {
    const t = l.trim()
    return t.startsWith('[') && t.endsWith(']')
  }
  while (i < lines.length) {
    if (lines[i].trim() === '[[hooks]]') {
      const start = i
      let j = i + 1
      while (j < lines.length && !isHeader(lines[j])) j += 1
      const block = lines.slice(start, j).join('\n')
      if (containsMarker(block)) removed += 1
      else out.push(...lines.slice(start, j))
      i = j
    } else {
      out.push(lines[i])
      i += 1
    }
  }
  return { text: out.join('\n'), removed }
}

function kimiHookBlocks(scriptPath) {
  const command = commandFor(scriptPath, 'kimi').replace(/'/g, '')
  return SHARED_EVENTS
    .map(
      (event) =>
        `[[hooks]]\nevent = "${event}"\ncommand = '${command}'\nmatcher = ""\ntimeout = 30\n`,
    )
    .join('\n')
}

export function kimiPresent() {
  return kimiConfigPaths().some((p) => fs.existsSync(path.dirname(p)))
}

export function installKimi(scriptPath) {
  const targets = kimiConfigPaths().filter((p) => fs.existsSync(path.dirname(p)))
  if (!targets.length) {
    throw new Error('未找到 Kimi 配置目录（~/.kimi 或 ~/.kimi-code）')
  }
  const block = kimiHookBlocks(scriptPath)
  for (const file of targets) {
    backup(file)
    let content = ''
    try {
      content = fs.readFileSync(file, 'utf8')
    } catch {
      content = ''
    }
    const stripped = stripKimiHooks(content).text.trimEnd()
    const next = `${stripped}${stripped ? '\n\n' : ''}${block}\n`
    fs.writeFileSync(file, next, 'utf8')
  }
  return { ok: true, agent: 'kimi', targets }
}

export function uninstallKimi() {
  let removed = 0
  for (const file of kimiConfigPaths()) {
    if (!fs.existsSync(file)) continue
    const content = fs.readFileSync(file, 'utf8')
    const next = stripKimiHooks(content)
    if (next.removed) {
      fs.writeFileSync(file, next.text, 'utf8')
      removed += next.removed
    }
  }
  return { removed }
}

export function isKimiInstalled() {
  return kimiConfigPaths().some((p) => {
    try {
      return kimiHasHook(fs.readFileSync(p, 'utf8'))
    } catch {
      return false
    }
  })
}
