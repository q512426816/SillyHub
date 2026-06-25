# fixtures

本目录存放各协议 backend 的真实 stdout 样本，供 adapter 测试复用。

## 目录结构

- `stream-json/` — claude / gemini / cursor（src/adapters/stream-json.ts）
- `json-rpc/`   — codex / hermes / kimi / kiro（src/adapters/json-rpc.ts）
- `jsonl/`      — copilot（src/adapters/jsonl.ts）
- `ndjson/`     — opencode / openclaw（src/adapters/ndjson.ts）
- `pi-json/`    — pi（src/adapters/pi-json.ts）
- `text/`       — antigravity（src/adapters/text.ts）

## 命名约定

`<provider>-<scenario>.<ext>`

- provider：claude / gemini / codex / copilot / opencode / antigravity ...
- scenario：system-init / assistant-text / assistant-thinking / tool-use /
            tool-result / result-error / full-session / empty ...
- ext：.jsonl（每行一 JSON）/ .txt（纯文本行）/ .jsonrpc（每行一 JSON-RPC 消息）

示例：

- stream-json/claude-assistant-text.jsonl
- json-rpc/codex-full-session.jsonrpc
- text/antigravity-plain.txt

## 提取来源

fixture 内容从 Python 测试的 inline 样本提取（task-06~10 各自执行）：

- stream-json ← tests/test_stream_json_backend.py（json.dumps({...})）
- json-rpc    ← tests/test_json_rpc.py（_build_response / _build_notification）
- jsonl       ← tests/test_jsonl_backend.py（_build_line({...})）
- ndjson      ← tests/test_ndjson_backend.py（_build_line({...})）
- text        ← tests/test_text_backend.py（纯文本字符串）

## 换行约定

**fixture 文件必须以 LF（\n）保存**，禁止 CRLF。`loadLines` 只按 `\n` 切分，
CRLF 来源样本会残留 `\r` 导致 adapter 解析异常；提取落盘阶段需统一转 LF。

## 加载方式

通过 tests/helpers.ts：

```ts
import { loadLines } from '../helpers';
const lines = loadLines('stream-json/claude-assistant-text.jsonl');
```
