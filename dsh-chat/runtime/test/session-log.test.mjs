/**
 * 会话日志解析测试（夹具驱动）。
 *
 * 夹具是手写的真实形态日志：session-a 只能有 1 条畸形行（无），session-b 恰好 1 条。
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  argsSummary,
  cleanUserText,
  parseSessionLog,
  toTranscript,
} from '../lib/session-log.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixtures = path.join(here, 'fixtures')
const FIXED_NOW = 1900000000000 // 固定 now，避免依赖真实时间

function readFixture(name) {
  return fs.readFileSync(path.join(fixtures, name), 'utf8')
}

/** 用小 limit 调 toTranscript，得到全部条目做断言 */
function allItems(parsed) {
  return toTranscript(parsed, { limit: 1000, now: FIXED_NOW }).items
}

/** 按 kind 过滤 */
function itemsOfKind(parsed, kind) {
  return allItems(parsed).filter((item) => item.kind === kind)
}

test('session-a：头部 / 标题 / 事件数 / 无坏行', () => {
  const parsed = parseSessionLog(readFixture('session-a.jsonl'))
  assert.deepEqual(parsed.header, {
    id: 'session-aaa-1111',
    cwd: 'D:\\workspace\\Catrace',
    createdAt: 1791003000000,
    agentPreset: 'standard',
    delegationDepth: 0,
    isSubagent: false,
  })
  assert.equal(parsed.title, '给 dsh-chat 加上会话镜像')
  assert.equal(parsed.badLines, 0)
  assert.equal(parsed.events.length, 14)
  assert.equal(parsed.events[0].type, 'session')
  // 未知事件类型必须被容忍并保留在事件流里
  assert.ok(parsed.events.some((event) => event.type === 'unknown/experimental-event'))
})

test('session-a：updatedAt 取最后一条事件时间，user/assistant 文本与推理分离', () => {
  const parsed = parseSessionLog(readFixture('session-a.jsonl'))
  const transcript = toTranscript(parsed, { limit: 1000, now: FIXED_NOW })
  assert.equal(transcript.updatedAt, 1791003019000) // 未知事件的时间也算
  assert.equal(transcript.id, 'session-aaa-1111')
  assert.equal(transcript.cwd, 'D:\\workspace\\Catrace')

  const users = itemsOfKind(parsed, 'user')
  assert.equal(users.length, 1)
  assert.equal(users[0].context, false)
  assert.equal(users[0].text, '帮我看看会话日志的 zstd 多帧怎么拆。')
  assert.ok(!users[0].text.includes('system-reminder'))
  assert.equal(users[0].time, 1791003010000)
  assert.equal(users[0].id, 'user-1')

  const assistants = itemsOfKind(parsed, 'assistant')
  assert.equal(assistants.length, 2)
  assert.equal(assistants[0].reasoning, '先确认 Node 内置 zstd 是否可用，再写帧拆分。')
  assert.equal(assistants[0].text, '我先跑一条命令确认环境。')
  assert.equal(assistants[0].id, 'msg-aaa-1')
  assert.ok(!assistants[0].text.includes('先确认'))
})

test('session-a：tool-call 进 tools，tool/result 按 callId 匹配到工具名', () => {
  const parsed = parseSessionLog(readFixture('session-a.jsonl'))
  const [firstAssistant] = itemsOfKind(parsed, 'assistant')
  assert.equal(firstAssistant.tools.length, 1)
  assert.equal(firstAssistant.tools[0].name, 'pwsh')
  assert.equal(firstAssistant.tools[0].id, 'call_1')
  assert.match(firstAssistant.tools[0].argsSummary, /node --version/)
  assert.ok(!firstAssistant.tools[0].argsSummary.includes('\n'))

  const tools = itemsOfKind(parsed, 'tool')
  assert.equal(tools.length, 2)
  assert.equal(tools[0].name, 'pwsh')
  assert.equal(tools[0].ok, true)
  assert.equal(tools[0].text, 'v24.18.0')
  assert.equal(tools[0].id, 'call_1')
  assert.equal(tools[1].name, 'read')
  assert.equal(tools[1].ok, false)
  assert.equal(tools[1].text, 'ENOENT: 文件不存在')
})

test('session-b：仅注入上下文的消息标 context=true 且不混入正文', () => {
  const parsed = parseSessionLog(readFixture('session-b.jsonl'))
  // 最后一个非空 session/title 才是标题
  assert.equal(parsed.title, '整理三点结论')
  assert.equal(parsed.badLines, 1)

  const users = itemsOfKind(parsed, 'user')
  assert.equal(users.length, 2)
  assert.equal(users[0].context, true)
  assert.ok(users[0].text.startsWith('<runtime-context>'))
  assert.ok(users[0].text.length <= 200)
  assert.equal(users[1].context, false)
  assert.equal(users[1].text, '把刚才的结论整理成三点。')
})

test('session-b：未知事件、坏行、缺 name 的 tool/result 都能容忍', () => {
  const parsed = parseSessionLog(readFixture('session-b.jsonl'))
  assert.ok(parsed.events.some((event) => event.type === 'unknown/experimental-thing'))
  assert.equal(parsed.events.filter((event) => event.type === 'agent/inbox/spliced').length, 1)

  const tools = itemsOfKind(parsed, 'tool')
  assert.equal(tools.length, 3)
  assert.equal(tools[0].name, 'pwsh')
  assert.equal(tools[0].ok, true)
  assert.equal(tools[1].ok, false)
  // 没有配套 tool/call 时 name 为 null
  assert.equal(tools[2].name, null)
  assert.equal(tools[2].ok, true)

  const systems = itemsOfKind(parsed, 'system')
  assert.equal(systems.length, 1)
  assert.equal(systems[0].text, '文件列表读取完成。')
})

test('session-b：limit 保留最新 N 条并置 hasMore', () => {
  const parsed = parseSessionLog(readFixture('session-b.jsonl'))
  const full = toTranscript(parsed, { limit: 1000, now: FIXED_NOW })
  assert.equal(full.items.length, 8) // 2 user + 2 assistant + 3 tool + 1 system
  assert.equal(full.messageCount, 8)
  assert.equal(full.hasMore, false)
  assert.equal(full.isSubagent, false)
  assert.equal(full.delegationDepth, 0)

  const subagent = parseSessionLog(JSON.stringify({ type: 'session', id: 'child', delegationDepth: 1 }))
  const childTranscript = toTranscript(subagent, { limit: 10, now: FIXED_NOW })
  assert.equal(childTranscript.isSubagent, true)
  assert.equal(childTranscript.delegationDepth, 1)

  const tail = toTranscript(parsed, { limit: 3, now: FIXED_NOW })
  assert.equal(tail.items.length, 3)
  assert.equal(tail.messageCount, 8)
  assert.equal(tail.hasMore, true)
  assert.deepEqual(
    tail.items.map((item) => item.kind),
    full.items.slice(-3).map((item) => item.kind),
  )
  assert.equal(tail.items[2].text, full.items[7].text)
})

test('maxText 截断并追加中文标记', () => {
  const parsed = parseSessionLog(readFixture('session-b.jsonl'))
  const [firstAssistant] = toTranscript(parsed, { limit: 1000, maxText: 10, now: FIXED_NOW }).items.filter(
    (item) => item.kind === 'assistant',
  )
  const fullText = '整理如下：一、帧要自己拆；二、解压逐帧做；三、坏文件跳过。'
  assert.ok(firstAssistant.text.endsWith(`…（已截断，共 ${fullText.length} 字符）`))
  assert.equal(firstAssistant.text.slice(0, 10), fullText.slice(0, 10))
  // reasoning 同样受 maxText 约束
  assert.ok(firstAssistant.reasoning.endsWith('字符）'))
})

test('缺失 time 时沿用上一条时间；完全缺失则为 0', () => {
  const text = [
    JSON.stringify({ type: 'session', version: 4, id: 's-x', cwd: '', createdAt: 1 }),
    JSON.stringify({ type: 'user/message', seq: 1, data: { content: [{ type: 'text', text: 'hi' }] } }),
    JSON.stringify({ type: 'user/message', seq: 2, time: 500, data: { content: [{ type: 'text', text: 'again' }] } }),
  ].join('\n')
  const transcript = toTranscript(parseSessionLog(text), { now: FIXED_NOW })
  assert.equal(transcript.items[0].time, 0)
  assert.equal(transcript.items[1].time, 500)
  assert.equal(transcript.createdAt, 1)
})

test('空文本 / 畸形输入不抛错', () => {
  const empty = parseSessionLog('')
  assert.equal(empty.header, null)
  assert.equal(empty.title, null)
  assert.equal(empty.events.length, 0)
  assert.equal(empty.badLines, 0)

  const junk = parseSessionLog('not json\n{"type":"session"}\nnull\n123\n')
  assert.equal(junk.badLines, 3)
  assert.equal(junk.header.id, null)
  assert.equal(junk.header.createdAt, null)

  const transcript = toTranscript(undefined)
  assert.equal(transcript.messageCount, 0)
  assert.deepEqual(transcript.items, [])
  assert.equal(transcript.hasMore, false)
  assert.ok(Number.isFinite(transcript.updatedAt))
})

test('cleanUserText：真人文本拼接、reminder 退化为 context', () => {
  const mixed = cleanUserText([
    { type: 'text', text: '第一段' },
    { type: 'text', text: '<system-reminder>提醒</system-reminder>' },
    { type: 'text', text: '第二段' },
  ])
  assert.equal(mixed.context, false)
  assert.equal(mixed.text, '第一段\n\n第二段')

  const onlyReminder = cleanUserText([{ type: 'text', text: '<system-reminder>只剩提醒</system-reminder>' }])
  assert.equal(onlyReminder.context, true)
  assert.equal(onlyReminder.text, '')
  assert.equal(onlyReminder.reminder, '<system-reminder>只剩提醒</system-reminder>')

  const parent = cleanUserText([{ type: 'text', text: 'Your parent agent id is "abc"' }])
  assert.equal(parent.context, true)

  assert.deepEqual(cleanUserText(undefined), { text: '', context: true, reminder: null })
})

test('argsSummary：压缩空白、支持对象、按上限截断', () => {
  assert.equal(argsSummary('{\n  "command": "Get-Location"\n}'), '{ "command": "Get-Location" }')
  assert.equal(argsSummary({ a: 1 }), '{"a":1}')
  assert.equal(argsSummary('x'.repeat(300), 10), 'x'.repeat(10))
  assert.equal(argsSummary(null), '')
  assert.ok(argsSummary('y'.repeat(500)).length <= 160)
})
