"""
pywechat-reply sidecar for Catrace.

Talks to the host over stdin/stdout JSON Lines (v1).

Requires:
- pip install pywechat127
- WeChat PC logged in (4.x → pyweixin; 3.9 → pywechat)
"""

import json
import os
import sys
import threading
import time
import traceback
from contextlib import contextmanager
from typing import Any, Dict, List, Optional

PLUGIN_ID = os.environ.get("CATRACE_PLUGIN_ID", "pywechat-reply")
PROTOCOL_VERSION = os.environ.get("CATRACE_PROTOCOL_VERSION", "1")

DEFAULT_CONFIG: Dict[str, Any] = {
    "enabled": True,
    "pollIntervalMs": 8000,
    "replyTimeoutMs": 30000,
    "debug": False,
}

config: Dict[str, Any] = dict(DEFAULT_CONFIG)
messages_api: Any = None
last_message_ids: set = set()
running = True


@contextmanager
def hush_stdout():
    """pyweixin prints to stdout; sidecar stdout is JSONL."""
    old = sys.stdout
    sys.stdout = sys.stderr
    try:
        yield
    finally:
        sys.stdout = old


def log(level: str, message: str, data: Optional[Dict[str, Any]] = None) -> None:
    send({"v": 1, "op": "log", "level": level, "message": message, "data": data or {}})


def send(value: Dict[str, Any]) -> None:
    try:
        sys.stdout.write(json.dumps(value, ensure_ascii=False) + "\n")
        sys.stdout.flush()
    except Exception as e:
        sys.stderr.write(f"sidecar stdout failed: {e}\n")


def publish_message(chat_name: str, sender: str, body: str, msg_id: str) -> None:
    send({
        "v": 1,
        "op": "publish",
        "event": {
            "eventType": "pywechat-reply.message",
            "kind": "pywechat-reply",
            "title": chat_name,
            "body": body,
            "level": "info",
            "sticky": True,
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


def patch_pyweixin_tabbar() -> None:
    """Current WeChat 4 tabbar auto_id is `main_tabbar`, not `MainView.main_tabbar`."""
    import re as _re

    import pyweixin.utils as wx_utils  # type: ignore
    import pyweixin.WeChatAuto as wx_auto  # type: ignore
    from pyweixin.Config import GlobalConfig  # type: ignore
    from pyweixin.WeChatTools import Navigator  # type: ignore

    def get_new_message_num(main_window=None, is_maximize=None, close_weixin=None):
        if is_maximize is None:
            is_maximize = GlobalConfig.is_maximize
        if close_weixin is None:
            close_weixin = GlobalConfig.close_weixin
        if main_window is None:
            main_window = Navigator.open_weixin(is_maximize=is_maximize)
        weixin_button = None
        for auto_id in ("main_tabbar", "MainView.main_tabbar"):
            try:
                bar = main_window.child_window(auto_id=auto_id, control_type="ToolBar")
                kids = bar.children()
                if kids:
                    weixin_button = kids[0]
                    break
            except Exception:
                continue
        if weixin_button is None:
            bars = main_window.descendants(control_type="ToolBar")
            for bar in bars:
                cls = bar.element_info.class_name or ""
                if "MainTabBar" in cls:
                    kids = bar.children()
                    if kids:
                        weixin_button = kids[0]
                        break
        if weixin_button is None:
            raise RuntimeError("WeChat main_tabbar not found")
        full_desc = weixin_button.element_info.element.GetCurrentPropertyValue(30159)
        new_message_num = _re.search(r"\d+", full_desc or "")
        if close_weixin:
            main_window.close()
        return int(new_message_num.group(0)) if new_message_num else 0

    wx_utils.get_new_message_num = get_new_message_num
    wx_auto.get_new_message_num = get_new_message_num


def try_init_wechat() -> bool:
    global messages_api
    if messages_api is not None:
        return True

    try:
        with hush_stdout():
            from pyweixin import Messages  # type: ignore
            from pyweixin.Config import GlobalConfig  # type: ignore
            GlobalConfig.close_weixin = False
            GlobalConfig.is_maximize = False
            patch_pyweixin_tabbar()
            messages_api = Messages
        log("info", "using pyweixin (WeChat 4.x / pywechat127)")
        return True
    except Exception as e4:
        log("warn", "pyweixin unavailable, trying pywechat 3.9", {"error": str(e4)})

    try:
        with hush_stdout():
            from pywechat import Messages  # type: ignore
            from pywechat.Config import GlobalConfig  # type: ignore
            GlobalConfig.close_weixin = False
            messages_api = Messages
        log("info", "using pywechat (WeChat 3.9)")
        return True
    except Exception as e:
        log("warn", "failed to initialize pywechat127", {
            "error": str(e),
            "trace": traceback.format_exc(limit=3) if config.get("debug") else None,
        })
        return False


def fetch_latest_messages() -> List[Dict[str, str]]:
    if not try_init_wechat():
        return []

    messages: List[Dict[str, str]] = []
    try:
        with hush_stdout():
            raw = messages_api.check_new_messages(close_weixin=False, is_maximize=False)
        if not raw:
            return []
        if not isinstance(raw, dict):
            log("warn", "check_new_messages unexpected type", {"type": type(raw).__name__})
            return []
        for friend, items in raw.items():
            chat_name = str(friend or "").strip() or "微信"
            rows = items if isinstance(items, list) else []
            for row in rows:
                if not isinstance(row, dict):
                    continue
                sender = str(row.get("消息发送人") or chat_name)
                body = str(row.get("消息内容") or "").strip()
                mtype = str(row.get("消息类型") or "")
                if not body:
                    continue
                msg_id = f"{chat_name}:{sender}:{mtype}:{body}"
                messages.append({
                    "chatName": chat_name,
                    "sender": sender,
                    "body": body,
                    "id": msg_id,
                })
    except Exception as e:
        log("warn", "pywechat fetch failed", {
            "error": str(e),
            "trace": traceback.format_exc(limit=3) if config.get("debug") else None,
        })
        # Keep the imported API; only UI lookup failed this round.
    return messages


def messages_api_reset() -> None:
    global messages_api
    messages_api = None


def send_reply(chat_name: str, text: str) -> Dict[str, Any]:
    text = (text or "").strip()
    if not text:
        return {"ok": False, "error": "empty reply"}
    if not try_init_wechat():
        return {"ok": False, "error": "WeChat client not available"}
    try:
        with hush_stdout():
            messages_api.send_messages_to_friend(
                friend=chat_name,
                messages=[text],
                close_weixin=False,
                is_maximize=False,
            )
        log("info", "pywechat send ok", {"chatName": chat_name, "textLength": len(text)})
        return {"ok": True}
    except Exception as e:
        log("warn", "pywechat send failed", {
            "error": str(e),
            "trace": traceback.format_exc(limit=3) if config.get("debug") else None,
        })
        messages_api_reset()
        return {"ok": False, "error": str(e)}


def handle_host_message(message: Dict[str, Any]) -> None:
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
            log("info", "config updated", {
                "config": {k: v for k, v in config.items() if k != "token"},
            })
        return

    if op == "resolved":
        event_payload = message.get("payload") or {}
        resolution_payload = message.get("resolutionPayload") or {}
        action_id = message.get("actionId")
        chat_name = event_payload.get("chatName")
        if action_id == "reply" and chat_name:
            text = ""
            if isinstance(resolution_payload, dict):
                text = str(resolution_payload.get("text") or "")
            result = send_reply(str(chat_name), text)
            request_id = message.get("requestId")
            if request_id:
                send({"v": 1, "op": "response", "requestId": request_id, **result})
        return

    log("warn", "unknown host message", {"op": op})


def poll_once() -> None:
    if not config.get("enabled", True):
        return
    messages = fetch_latest_messages()
    for msg in messages:
        msg_id = msg.get("id", "")
        if msg_id and msg_id in last_message_ids:
            continue
        if msg_id:
            last_message_ids.add(msg_id)
            if len(last_message_ids) > 200:
                last_message_ids.clear()
        publish_message(
            chat_name=msg.get("chatName", "微信"),
            sender=msg.get("sender", ""),
            body=msg.get("body", ""),
            msg_id=msg_id or f"{time.time()}",
        )


def stdin_reader() -> None:
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
    send({"v": 1, "op": "ready"})
    log("info", "pywechat-reply sidecar ready", {
        "pluginId": PLUGIN_ID,
        "protocol": PROTOCOL_VERSION,
    })
    reader = threading.Thread(target=stdin_reader, daemon=True)
    reader.start()
    while running:
        try:
            poll_once()
        except Exception as e:
            log("error", "poll loop crashed", {
                "error": str(e),
                "trace": traceback.format_exc(limit=3) if config.get("debug") else None,
            })
        time.sleep(config.get("pollIntervalMs", 8000) / 1000.0)
    log("info", "sidecar exiting")


if __name__ == "__main__":
    main()
