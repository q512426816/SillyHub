#!/usr/bin/env python3
"""Minimal mock OpenAI/Anthropic endpoint for credential-injection spike.

Logs every request (path, method, Authorization prefix, body model field)
to mock-log.jsonl next to this file. Answers 200 with minimally valid JSON
for: /v1/chat/completions, /v1/models, /responses, /v1/messages.
Anything else gets a generic 200 JSON too (still logged).
"""

import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 18999
LOG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mock-log.jsonl")

RESPONSES = {
    "chat/completions": {
        "id": "chatcmpl-mock",
        "object": "chat.completion",
        "created": 0,
        "model": "mock-model",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": "mock says hi"},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
    },
    "models": {
        "object": "list",
        "data": [
            {"id": "mock-model", "object": "model", "created": 0, "owned_by": "mock"},
        ],
    },
    "responses": {
        "id": "resp-mock",
        "object": "response",
        "created_at": 0,
        "status": "completed",
        "model": "mock-model",
        "output": [
            {
                "type": "message",
                "id": "msg-mock",
                "status": "completed",
                "role": "assistant",
                "content": [
                    {"type": "output_text", "text": "mock says hi", "annotations": []}
                ],
            }
        ],
        "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2},
    },
    "messages": {
        "id": "msg-mock",
        "type": "message",
        "role": "assistant",
        "model": "mock-model",
        "content": [{"type": "text", "text": "mock says hi"}],
        "stop_reason": "end_turn",
        "usage": {"input_tokens": 1, "output_tokens": 1},
    },
}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _handle(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        body = {}
        try:
            body = json.loads(raw.decode("utf-8", "replace") or "{}")
        except Exception:
            body = {"_raw": raw.decode("utf-8", "replace")[:2000]}

        auth = self.headers.get("Authorization") or ""
        entry = {
            "ts": time.strftime("%H:%M:%S"),
            "method": self.command,
            "path": self.path,
            "auth_prefix": auth[:20],
            "auth_len": len(auth),
            "model": body.get("model"),
            "body_keys": sorted(body.keys())[:15] if isinstance(body, dict) else None,
            "client": self.headers.get("User-Agent", "")[:60],
            "stream": body.get("stream") if isinstance(body, dict) else None,
        }
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")

        path_l = self.path.lower().split("?")[0].strip("/")
        payload = None
        for key in ("chat/completions", "models", "responses", "messages"):
            if path_l.endswith(key):
                payload = RESPONSES[key]
                break
        if payload is None:
            payload = {"ok": True, "mock": True}

        want_stream = isinstance(body, dict) and body.get("stream")
        if want_stream and payload is RESPONSES["chat/completions"]:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()

            def sse_chunk(payload):
                chunk = ("data: " + json.dumps(payload) + "\n\n").encode()
                self.wfile.write(("%x\r\n" % len(chunk)).encode() + chunk + b"\r\n")

            sse_chunk(
                {
                    "id": "chatcmpl-mock",
                    "object": "chat.completion.chunk",
                    "choices": [
                        {
                            "index": 0,
                            "delta": {"content": "mock says hi"},
                            "finish_reason": None,
                        }
                    ],
                }
            )
            sse_chunk(
                {
                    "id": "chatcmpl-mock",
                    "object": "chat.completion.chunk",
                    "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
                }
            )
            final = b"data: [DONE]\n\n"
            self.wfile.write(("%x\r\n" % len(final)).encode() + final + b"\r\n")
            self.wfile.write(b"0\r\n\r\n")
            return

        if want_stream and payload is RESPONSES["responses"]:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()
            resp = RESPONSES["responses"]

            def sse(event):
                chunk = (
                    "event: "
                    + event
                    + "\ndata: "
                    + json.dumps(event_payload(event))
                    + "\n\n"
                ).encode()
                self.wfile.write(("%x\r\n" % len(chunk)).encode() + chunk + b"\r\n")

            def event_payload(event):
                if event == "response.created":
                    return {
                        "type": event,
                        "response": {"id": resp["id"], "status": "in_progress"},
                    }
                if event == "response.output_item.done":
                    return {
                        "type": event,
                        "output_index": 0,
                        "item": {
                            "type": "message",
                            "id": "msg-mock",
                            "status": "completed",
                            "role": "assistant",
                            "content": [
                                {
                                    "type": "output_text",
                                    "text": "mock says hi",
                                    "annotations": [],
                                }
                            ],
                        },
                    }
                if event == "response.completed":
                    return {"type": event, "response": resp}
                return {"type": event}

            for ev in (
                "response.created",
                "response.output_item.done",
                "response.completed",
            ):
                sse(ev)
            self.wfile.write(b"0\r\n\r\n")
            return

        data = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    do_GET = _handle
    do_POST = _handle
    do_DELETE = _handle

    def log_message(self, *args):  # keep stdout quiet; we log to file
        pass


if __name__ == "__main__":
    print(f"mock listening on 127.0.0.1:{PORT}, log -> {LOG_PATH}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
