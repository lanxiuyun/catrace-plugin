#!/usr/bin/env node
// Catrace Agent Hook — state notification + permission request handler
// 用法：node catrace-agent-hook.js <event-name>
// 从 stdin 读取 JSON payload，状态事件 POST 到 /state；权限事件 POST 到 /permission 并等待响应。

const http = require("http");

const CATRACE_PORT = 23456;
const STDIN_READ_TIMEOUT_MS = 2000;
const STATE_POST_TIMEOUT_MS = 500;
const PERMISSION_POST_TIMEOUT_MS = 600000;

// 各 agent 事件名归一化到 Claude Code 语义（未列出的事件直接忽略）
const EVENT_ALIASES = {
  // Gemini CLI
  BeforeAgent: "UserPromptSubmit",
  AfterAgent: "Stop",
  BeforeTool: "PreToolUse",
  AfterTool: "PostToolUse",
};

const EVENT_TO_STATE = {
  SessionStart: "idle",
  UserPromptSubmit: "thinking",
  PreToolUse: "working",
  PostToolUse: "working",
  PostToolUseFailure: "error",
  Stop: "attention",
  StopFailure: "error",
  Notification: "notification",
};

function readStdin(timeoutMs) {
  return new Promise((resolve) => {
    let data = "";
    const timer = setTimeout(() => resolve(data), timeoutMs);
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      clearTimeout(timer);
      resolve(data);
    });
    process.stdin.on("error", () => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

function postToCatrace(path, body, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: CATRACE_PORT,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: timeoutMs,
      },
      (res) => {
        let responseData = "";
        res.on("data", (chunk) => {
          responseData += chunk;
        });
        res.on("end", () => resolve(responseData));
      },
    );
    req.on("error", () => resolve(""));
    req.on("timeout", () => {
      req.destroy();
      resolve("");
    });
    req.write(body);
    req.end();
  });
}

async function main() {
  const raw = await readStdin(STDIN_READ_TIMEOUT_MS);
  let payload = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    // stdin 没有内容或不是 JSON，也继续上报（session_id 用 unknown）
  }

  // Claude Code 不会把事件名放在 argv，而是放在 stdin JSON 的 hook_event_name 里；
  // argv[2] 仅作为手动调试时的兜底。Gemini/Kimi 事件名先归一化。
  const rawEvent = process.argv[2] && !process.argv[2].startsWith('--')
    ? process.argv[2]
    : payload.hook_event_name || payload.hookEventName;
  const agentArg = process.argv.find((arg) => arg.startsWith('--agent='));
  const agentId = (agentArg && agentArg.slice('--agent='.length)) || process.env.CATRACE_AGENT_ID || 'unknown';
  const outbound = raw && payload && typeof payload === 'object'
    ? JSON.stringify({ ...payload, agentId })
    : raw;
  const event = EVENT_ALIASES[rawEvent] || rawEvent;

  // 权限请求：阻塞等待 Catrace 用户决策，把响应原样写回 stdout 给 agent
  if (event === "PermissionRequest") {
    const response = await postToCatrace("/permission", outbound, PERMISSION_POST_TIMEOUT_MS);
    if (response) process.stdout.write(`${response.trim()}\n`);
    process.exit(0);
  }

  const state = EVENT_TO_STATE[event];
  if (!state || !raw) process.exit(0);

  await postToCatrace("/state", outbound, STATE_POST_TIMEOUT_MS);
  process.exit(0);
}

main().catch(() => process.exit(0));
