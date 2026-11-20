import { spawn } from 'node:child_process'

export function npmAvailable() {
  return new Promise((resolve) => {
    // .cmd is not executable by execFile on Windows; only run a fixed, non-user command.
    const child = process.platform === 'win32'
      ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm --version'], { windowsHide: true, stdio: 'ignore' })
      : spawn('npm', ['--version'], { stdio: 'ignore' })
    const timer = setTimeout(() => { child.kill(); resolve(false) }, 4000)
    child.once('error', () => { clearTimeout(timer); resolve(false) })
    child.once('exit', (code) => { clearTimeout(timer); resolve(code === 0) })
  })
}

export async function ensurePiNpm({ checkNpm = npmAvailable } = {}) {
  if (!await checkNpm()) throw new Error('未检测到可用的 npm，请安装 npm 并确保 Catrace 的 PATH 可找到它，然后重启 Catrace 重试；不会下载备用扩展')
}
