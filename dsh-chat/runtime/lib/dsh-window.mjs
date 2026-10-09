/**
 * 「前台窗口是不是 DSH」——给「你在 DSH 里时不弹小窗」用。
 *
 * 为什么走这条路（而不是去读 DSH 内部状态）：
 *  - 不需要任何平台 API、不需要读 DSH 的未公开存储 → 跨平台、也不怕 DSH 改版；
 *  - 条件是**会自己解除的**：你一切走（前台不再是 DSH），该显示的卡自然回来。
 *    这是与"按会话屏蔽"的本质区别 —— 那种条件不会自己变，会表现成"卡片再也不弹"。
 *
 * 判据（只做字符串匹配，纯函数、好测）：
 *  - **进程名**：`DSH Desktop`（Windows 桌面版实测；macOS 上是 `.app` 可执行文件名，同一套模式兜住）；
 *  - **窗口标题含 `DeepSeek Harness`**：
 *      · DSH 桌面版窗口标题 = `DeepSeek Harness Desktop`（桌面壳写死，不跟 document.title 走）；
 *      · 浏览器标题 = `"<当前标签页标题> - Google Chrome"`，DSH 网页自己的 `<title>` 是
 *        `DeepSeek Harness`（打开会话后还会变成 `"<会话标题> — DeepSeek Harness"`）
 *        → 所以"浏览器正开着 DSH 那个标签页"也能命中；DSH 在后台标签页时标题不是它，**正确地不命中**。
 *
 * 有意不做的：**终端里跑的 dsh CLI**。前台只会看到 `WindowsTerminal.exe` / `Code.exe` / `pwsh.exe`，
 * 光凭进程名判不出来；要判得准得看窗口标题或进程树（终端里 dsh 开在别的标签页也会误判）。本期不做。
 */
import { basename } from 'node:path'

/** 进程名（Windows/macOS 可执行文件名）：DSH 桌面版 */
export const DSH_APP_PATTERN = /^DSH Desktop(\.exe)?$/i
/** 窗口标题：DSH 网页/桌面版都带这个名字 */
export const DSH_TITLE_PATTERN = /DeepSeek Harness/i

/**
 * 判断一次前台窗口快照是不是 DSH。
 *
 * @param {{app?: string|null, title?: string|null}|null|undefined} snapshot 宿主 `activity.get` 的 app/title
 * @returns {{dsh: boolean, reason: 'app'|'title'|'none', app: string, title: string}}
 *   `reason` 只为排查方便（日志里写清是"进程名命中"还是"标题命中"）
 */
export function isDshForeground(snapshot) {
  const app = typeof snapshot?.app === 'string' ? snapshot.app.trim() : ''
  const title = typeof snapshot?.title === 'string' ? snapshot.title.trim() : ''
  // 进程名允许带扩展名，也可能只有名字：两种都比一次
  const appName = app ? basename(app) : ''
  if (appName && (DSH_APP_PATTERN.test(appName) || DSH_APP_PATTERN.test(app))) {
    return { dsh: true, reason: 'app', app, title }
  }
  if (title && DSH_TITLE_PATTERN.test(title)) {
    return { dsh: true, reason: 'title', app, title }
  }
  return { dsh: false, reason: 'none', app, title }
}
