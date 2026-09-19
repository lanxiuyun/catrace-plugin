function dummyHttpRes() {
  return { writeHead() {}, end() {} }
}

export function publishTestCard(kind, ctx) {
  const cwd = 'C:\\work_sapce\\crazy_label'
  const base = {
    agentId: 'zcode',
    sessionId: `preview:${kind}:${Date.now()}`,
    sessionTitle: '项目要继续开发和迭代ui页面了。',
    projectName: 'crazy_label',
    cwd,
    timestamp: new Date().toISOString(),
    hookPpid: 0,
    raw: { preview: true, kind },
  }
  if (kind === 'working') {
    ctx.publishSession({
      ...base,
      event: 'PreToolUse',
      message: '正在调用工具 Read',
    })
    return kind
  }
  if (kind === 'tool') {
    const id = ctx.allocPermId()
    const toolInput = { file_path: 'src/views/Home.vue', command: 'write file' }
    const data = {
      ...base,
      event: 'PermissionRequest',
      permission: { toolName: 'Write', toolInput },
    }
    const timer = setTimeout(() => ctx.finishPerm(id, 'timeout'), ctx.permWaitMs)
    ctx.pendingPerm.set(id, { res: dummyHttpRes(), sessionId: data.sessionId, timer, toolName: 'Write', toolInput })
    ctx.publishPermission(id, data)
    return kind
  }
  if (kind === 'ask' || kind === 'ask-multi') {
    const id = ctx.allocPermId()
    const questions = [
      {
        question: '三层壳（紫色门户栏 + 项目导航 + 内容区）已落地。下一张新版 UI 页优先改哪一块？',
        options: [
          { label: '图像标注（建议）', description: '进项目后默认页。对齐 mock 的三栏：文件树 / 画布工具 / 右侧属性。不改标注业务逻辑。' },
          { label: '模型训练（超参数页）', description: 'parameter_edit 按 mock 改版式与布局；开训仍跳隐藏路由 training_detail。' },
          { label: '模型测试', description: 'testing_view 按 mock 改布局与控件；保留按项目持久化 UI state。' },
          { label: '先对一下 mock 再定范围', description: '你给 mock 地址/截图，我先对照现状页列出差距清单，再开工。' },
        ],
      },
    ]
    if (kind === 'ask-multi') {
      questions.push({
        question: '这一页的改动范围怎么定？',
        options: [
          { label: '只改布局', description: '不动业务数据流。' },
          { label: '布局 + 交互', description: '包含筛选、抽屉和默认页行为。' },
        ],
      })
    }
    const toolInput = { questions }
    const data = {
      ...base,
      event: 'PermissionRequest',
      permission: { toolName: 'AskUserQuestion', toolInput },
    }
    const timer = setTimeout(() => ctx.finishPerm(id, 'timeout'), ctx.permWaitMs)
    ctx.pendingPerm.set(id, {
      res: dummyHttpRes(),
      sessionId: data.sessionId,
      timer,
      toolName: 'AskUserQuestion',
      toolInput,
    })
    ctx.publishPermission(id, data)
    return kind
  }
  ctx.publishSession({
    ...base,
    event: 'Stop',
    message: '本轮任务已完成，等你继续。这是设置页弹出的预览卡片。',
  })
  return 'stop'
}
