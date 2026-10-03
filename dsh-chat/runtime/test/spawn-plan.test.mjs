/**
 * spawn-plan.test.mjs —— resolveExecutable / buildSpawnPlan / resolveDshCommand 的单元测试。
 * 全部在宿主 fs 上做真实验证，路径用临时目录，不碰仓库文件。
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildSpawnPlan, quoteWin, resolveDshCommand, resolveExecutable } from '../lib/spawn-plan.mjs'

const IS_WIN = process.platform === 'win32'

/** 建一个临时目录（prefix 里带空格时用于验证带空格的路径）。 */
function makeTempDir(prefix = 'dsh-spawn-plan-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

test('resolveExecutable：win32 下按 PATHEXT 解析出 .cmd', (t) => {
  const dir = makeTempDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const cmdPath = path.join(dir, 'dsh.cmd')
  fs.writeFileSync(cmdPath, '@echo off\r\n')

  const env = { PATH: dir, PATHEXT: '.CMD;.EXE' }
  const found = resolveExecutable('dsh', { platform: 'win32', env })
  assert.equal(found, path.resolve(cmdPath))
  assert.ok(fs.existsSync(found))
})

test('resolveExecutable：win32 下按 PATHEXT 顺序解析出 .exe', (t) => {
  const dir = makeTempDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.writeFileSync(path.join(dir, 'tool.exe'), 'not-a-real-pe')

  const env = { PATH: dir, PATHEXT: '.CMD;.EXE' }
  assert.equal(resolveExecutable('tool', { platform: 'win32', env }), path.resolve(dir, 'tool.exe'))
})

test('resolveExecutable：explicit pathExt 覆盖 env.PATHEXT', (t) => {
  const dir = makeTempDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.writeFileSync(path.join(dir, 'thing.bat'), '@echo off\r\n')

  const env = { PATH: dir, PATHEXT: '.EXE' }
  assert.equal(resolveExecutable('thing', { platform: 'win32', env }), null)
  assert.equal(
    resolveExecutable('thing', { platform: 'win32', env, pathExt: '.BAT' }),
    path.resolve(dir, 'thing.bat'),
  )
})

test('resolveExecutable：PATH 里找不到时返回 null（win32 / linux）', (t) => {
  const dir = makeTempDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const env = { PATH: [dir, path.join(dir, 'missing-dir')].join(path.delimiter), PATHEXT: '.CMD' }

  assert.equal(resolveExecutable('definitely-not-here-xyz', { platform: 'win32', env }), null)
  assert.equal(resolveExecutable('definitely-not-here-xyz', { platform: 'linux', env }), null)
  assert.equal(resolveExecutable('', { platform: 'win32', env }), null)
})

test('resolveExecutable：绝对路径存在时原样解析（win32 与 linux 两个平台参数都成立）', (t) => {
  const dir = makeTempDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'dsh.cmd')
  fs.writeFileSync(file, '@echo off\r\n')

  for (const platform of ['win32', 'linux']) {
    assert.equal(resolveExecutable(file, { platform, env: { PATH: '' } }), path.resolve(file))
    assert.equal(resolveExecutable(path.join(dir, 'nope.cmd'), { platform, env: { PATH: '' } }), null)
  }
})

test('resolveExecutable：含路径分隔符但不存在 → null', () => {
  assert.equal(resolveExecutable(path.join(os.tmpdir(), 'no-such-dir-xyz', 'dsh.cmd'), { platform: 'win32' }), null)
})

test('resolveExecutable：只看文件，目录不算', (t) => {
  const dir = makeTempDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  assert.equal(resolveExecutable(dir, { platform: 'win32' }), null)
})

test('buildSpawnPlan：win32 + .cmd → 经 cmd.exe /d /s /c 执行', () => {
  const plan = buildSpawnPlan('dsh.cmd', ['--profile', 'sdk'], { platform: 'win32' })
  assert.match(plan.command, /cmd\.exe$/i)
  assert.deepEqual(plan.args.slice(0, 3), ['/d', '/s', '/c'])
  assert.equal(plan.options.windowsVerbatimArguments, true)
  assert.equal(plan.args.length, 4)
  assert.ok(plan.args[3].includes('dsh.cmd'), `命令行应包含命令：${plan.args[3]}`)
  assert.ok(plan.args[3].includes('--profile'), `命令行应包含参数：${plan.args[3]}`)
  assert.ok(plan.args[3].includes('sdk'))
})

test('buildSpawnPlan：win32 + .bat 也被识别为脚本', () => {
  const plan = buildSpawnPlan('C:\\tools\\build.bat', [], { platform: 'win32' })
  assert.match(plan.command, /cmd\.exe$/i)
  assert.deepEqual(plan.args.slice(0, 3), ['/d', '/s', '/c'])
  assert.equal(plan.options.windowsVerbatimArguments, true)
})

test('buildSpawnPlan：win32 + 绝对 .exe 保持真实 spawn（不套 cmd）', () => {
  const exe = 'C:\\Program Files\\nodejs\\node.exe'
  const plan = buildSpawnPlan(exe, ['a b'], { platform: 'win32' })
  assert.equal(plan.command, exe)
  assert.deepEqual(plan.args, ['a b'])
  assert.deepEqual(plan.options, {})
  assert.equal('shell' in plan.options, false)
})

test('buildSpawnPlan：非 Windows 平台原样返回，不改命令与参数', () => {
  const plan = buildSpawnPlan('dsh', ['--profile', 'sdk'], { platform: 'linux' })
  assert.deepEqual(plan, { command: 'dsh', args: ['--profile', 'sdk'], options: {} })
  const plan2 = buildSpawnPlan('dsh.cmd', ['--profile', 'sdk'], { platform: 'darwin' })
  assert.deepEqual(plan2, { command: 'dsh.cmd', args: ['--profile', 'sdk'], options: {} })
})

test('spawn 计划永不设置 shell: true', () => {
  const plans = [
    buildSpawnPlan('dsh.cmd', ['--profile', 'sdk'], { platform: 'win32' }),
    buildSpawnPlan('C:\\Program Files\\nodejs\\node.exe', ['a b'], { platform: 'win32' }),
    buildSpawnPlan('dsh', ['--profile', 'sdk'], { platform: 'linux' }),
    buildSpawnPlan('dsh', [], { platform: 'win32' }),
  ]
  for (const plan of plans) {
    assert.equal(plan.options.shell, undefined)
    assert.notEqual(plan.options.shell, true)
  }
})

test('quoteWin：按需加引号，内部双引号转义为 \\"', () => {
  assert.equal(quoteWin('plain'), 'plain')
  assert.equal(quoteWin('a b'), '"a b"')
  assert.equal(quoteWin('a"b'), '"a\\"b"')
  assert.equal(quoteWin('a&b'), '"a&b"')
  assert.equal(quoteWin(''), '""')
  assert.equal(quoteWin('C:\\dir\\x.cmd'), 'C:\\dir\\x.cmd')
})

test('resolveDshCommand：解析到真实路径 / 找不到时原样返回', (t) => {
  const dir = makeTempDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const cmdPath = path.join(dir, 'dsh.cmd')
  fs.writeFileSync(cmdPath, '@echo off\r\n')
  const env = { PATH: dir, PATHEXT: '.CMD;.EXE' }

  assert.equal(resolveDshCommand('dsh', { platform: 'win32', env }), path.resolve(cmdPath))
  assert.equal(resolveDshCommand(cmdPath, { platform: 'win32', env: { PATH: '' } }), path.resolve(cmdPath))
  assert.equal(resolveDshCommand('totally-missing-xyz', { platform: 'win32', env }), 'totally-missing-xyz')
  // 空配置回落到默认命令名 'dsh'
  assert.equal(resolveDshCommand('   ', { platform: 'win32', env }), path.resolve(cmdPath))
})

test(
  'Windows 冒烟：真的能 spawn 一个「路径含空格的 .cmd」并拿到参数',
  { skip: IS_WIN ? false : '仅在 Windows 上运行' },
  async (t) => {
    const dir = makeTempDir('dsh plan ')
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
    assert.ok(dir.includes(' '), '临时目录名应包含空格以覆盖引号逻辑')

    const scriptPath = path.join(dir, 'probe script.cmd')
    fs.writeFileSync(scriptPath, '@echo off\r\necho GOT:%1\r\n')

    const probe = buildSpawnPlan(scriptPath, ['hello world'], { platform: 'win32' })
    let child = null
    t.after(() => {
      try {
        if (child) child.kill()
      } catch {
        // 已退出
      }
    })

    child = spawn(probe.command, probe.args, { ...probe.options, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => {
      out += d
    })
    child.stderr.on('data', (d) => {
      err += d
    })

    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        try {
          child.kill()
        } catch {
          // 忽略
        }
        reject(new Error(`probe .cmd 超时未退出；stdout=${out} stderr=${err}`))
      }, 5000)
      child.on('error', (e) => {
        clearTimeout(timer)
        reject(e)
      })
      child.on('exit', (c) => {
        clearTimeout(timer)
        resolve(c)
      })
    })

    assert.equal(code, 0, `probe .cmd 退出码应为 0，stderr=${err}`)
    assert.ok(out.includes('hello world'), `应收到被正确转义的参数，实际输出：${out}`)
  },
)
