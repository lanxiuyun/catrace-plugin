"""
pywechat-reply sidecar for Catrace.

This process is spawned by Catrace when the plugin is enabled. It talks to the
host over stdin/stdout using JSON Lines (v1 protocol).

Responsibilities:
- Poll WeChat PC client for new messages via pywechat.
- Publish Catrace events for each new message.
- Receive reply actions from Catrace and send messages back via pywechat.

Note:
- pywechat is NOT bundled with this plugin. Install it separately:
      pip install pywechat
  or follow the project README at https://github.com/Hello-Mr-Crab/pywechat
- WeChat PC client must be running and logged in.
- UI automation is fragile: WeChat updates can break selectors.
"""

import json
import os
import sys
import threading
import time
import traceback
from typing import Any, Dict, List, Optional

# ---------------------------------------------------------------------------
# Plugin identity (injected by host; keep a fallback for standalone testing)
# ---------------------------------------------------------------------------
PLUGIN_ID = os.environ.get("CATRACE_PLUGIN_ID", "pywechat-reply")
PROTOCOL_VERSION = os.environ.get("CATRACE_PROTOCOL_VERSION", "1")

# ---------------------------------------------------------------------------
# Configuration defaults
# ---------------------------------------------------------------------------
DEFAULT_CONFIG: Dict[str, Any] = {
    "enabled": True,
    "pollIntervalMs": 3000,
    "replyTimeoutMs": 30000,
    "debug": False,
}

config: Dict[str, Any] = dict(DEFAULT_CONFIG)

# ---------------------------------------------------------------------------
# Runtime state
# ---------------------------------------------------------------------------
wechat: Any = None  # pywechat handle, lazily initialized
last_message_ids: set = set()  # crude deduplication cache
running = True


def log(level: str, message: str, data: Optional[Dict[str, Any]] = None) -> None:
    send({"v": 1, "op": "log", "level": level, "message": message, "data": data or {}})


def send(value: Dict[str, Any]) -> None:
    """Write one JSON Lines message to stdout."""
    try:
        sys.stdout.write(json.dumps(value, ensure_ascii=False) + "\n")
        sys.stdout.flush()
    except Exception as e:
        # If stdout is broken, we cannot recover.
        sys.stderr.write(f"sidecar stdout failed: {e}\n")


def publish_message(chat_name: str, sender: str, body: str, msg_id: str) -> None:
    """Publish a single WeChat message into Catrace Event Bus."""
    send({
        "v": 1,
        "op": "publish",
        "event": {
            "eventType": "pywechat-reply.message",
            "kind": "pywechat-reply",
            "title": chat_name,
            "body": body,
            "level": "info",
            "sticky": False,
            "dedupeKey": f"pywechat-reply:{msg_id}",
            "actions": [
                {"id": "reply", "label": "回复"},
                {"id": "dismiss", "label": "忽略"},
            ],
            "payload": {
                "chatName": chat_name,
                "sender": sender,
                "messageId": msg_id,
                "pluginId": PLUGIN_ID,
            },
        },
    })


def try_init_wechat() -> bool:
    """Lazily import pywechat and attach to the running WeChat window.

    Returns True on success. On failure, logs a warning and returns False so
    polling can retry later (e.g. after the user opens WeChat).
    """
    global wechat
    if wechat is not None:
        return True

    try:
        # pywechat's import path and class name vary by version.
        # Adjust these imports after installing the exact package you use.
        from pywechat import WeChat  # type: ignore
        wechat = WeChat()
        log("info", "pywechat connected to WeChat PC client")
        return True
    except Exception as e:
        log("warn", "failed to initialize pywechat", {
            "error": str(e),
            "trace": traceback.format_exc(limit=3) if config.get("debug") else None,
        })
        return False


def fetch_latest_messages() -> List[Dict[str, str]]:
    """Fetch recent unread messages from WeChat via pywechat.

    This is intentionally left as a thin wrapper: pywechat APIs differ across
    versions. Implement the concrete calls here once you know your installed
    version. The returned list item must contain:
        - chatName: str   (chat window/session name)
        - sender: str     (contact name, may equal chatName for 1:1 chats)
        - body: str       (message text)
        - id: str         (stable-ish id for deduplication)
    """
    if not try_init_wechat():
        return []

    messages: List[Dict[str, str]] = []
    try:
        # -------------------------------------------------------------------
        # TODO: replace this block with real pywechat calls.
        #
        # Example shape (depends on pywechat version):
        #   sessions = wechat.get_chat_list()
        #   for session in sessions:
        #       if session.unread_count > 0:
        #           msgs = wechat.get_messages(session.name, limit=session.unread_count)
        #           for m in msgs:
        #               messages.append({
        #                   "chatName": session.name,
        #                   "sender": m.sender,
        #                   "body": m.content,
        #                   "id": f"{session.name}:{m.sender}:{m.time}:{m.content}",
        #               })
        # -------------------------------------------------------------------
        log("info", "fetch_latest_messages called (pywechat integration stub)")
    except Exception as e:
        log("warn", "pywechat fetch failed", {
            "error": str(e),
            "trace": traceback.format_exc(limit=3) if config.get("debug") else None,
        })
        # Reset handle so next poll retries connection.
        wechat = None

    return messages


def send_reply(chat_name: str, text: str) -> Dict[str, Any]:
    """Send a text message to the given chat via pywechat.

    Returns a result dict for the sidecar response op.
    """
    if not try_init_wechat():
        return {"ok": False, "error": "WeChat client not available"}

    try:
        # -------------------------------------------------------------------
        # TODO: replace with real pywechat send call.
        #
        # Example shape:
        #   wechat.open_chat(chat_name)
        #   wechat.send_text(text)
        # -------------------------------------------------------------------
        log("info", "send_reply called (pywechat integration stub)", {
            "chatName": chat_name,
            "text": text,
        })
        return {"ok": True}
    except Exception as e:
        log("warn", "pywechat send failed", {
            "error": str(e),
            "trace": traceback.format_exc(limit=3) if config.get("debug") else None,
        })
        return {"ok": False, "error": str(e)}


def handle_host_message(message: Dict[str, Any]) -> None:
    """Process one message from Catrace host."""
    op = message.get("op")

    if op == "shutdown":
        log("info", "graceful shutdown requested")
        global running
        running = False
        return

    if op == "config":
        global config
        incoming = message.get("config", {})
        if isinstance(incoming, dict):
            config.update(incoming)
            log("info", "config updated", {"config": {k: v for k, v in config.items() if k != "token"}})
        return

    if op == "resolved":
        event_payload = message.get("payload") or {}
        resolution_payload = message.get("resolutionPayload") or {}
        action_id = message.get("actionId")
        chat_name = event_payload.get("chatName")

        if action_id == "reply" and chat_name:
            text = resolution_payload.get("text") or ""
            result = send_reply(chat_name, text)
            send({"v": 1, "op": "response", "requestId": message.get("requestId"), **result})
        return

    # Unknown op: log and ignore.
    log("warn", "unknown host message", {"op": op})


def poll_once() -> None:
    """Single polling iteration: fetch messages and publish new ones."""
    if not config.get("enabled", True):
        return

    messages = fetch_latest_messages()
    for msg in messages:
        msg_id = msg.get("id", "")
        if msg_id and msg_id in last_message_ids:
            continue
        if msg_id:
            last_message_ids.add(msg_id)
            # Keep cache bounded.
            if len(last_message_ids) > 200:
                last_message_ids.clear()
        publish_message(
            chat_name=msg.get("chatName", "微信"),
            sender=msg.get("sender", ""),
            body=msg.get("body", ""),
            msg_id=msg_id or f"{time.time()}",
        )


def stdin_reader() -> None:
    """Read JSON Lines from stdin on a background thread."""
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            log("warn", "invalid JSON from host", {"line": line[:200]})
            continue
        handle_host_message(message)


def main() -> None:
    # Announce readiness.
    send({"v": 1, "op": "ready"})
    log("info", "pywechat-reply sidecar ready", {
        "pluginId": PLUGIN_ID,
        "protocol": PROTOCOL_VERSION,
    })

    # Start stdin listener so host can send config/reply/shutdown anytime.
    reader = threading.Thread(target=stdin_reader, daemon=True)
    reader.start()

    # Polling loop.
    while running:
        try:
            poll_once()
        except Exception as e:
            log("error", "poll loop crashed", {
                "error": str(e),
                "trace": traceback.format_exc(limit=3) if config.get("debug") else None,
            })
        time.sleep(config.get("pollIntervalMs", 3000) / 1000.0)

    log("info", "sidecar exiting")


if __name__ == "__main__":
    main()
