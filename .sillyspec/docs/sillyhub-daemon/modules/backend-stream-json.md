---
schema_version: 1
doc_type: module-card
module_id: backend-stream-json
author: qinyi
created_at: 2026-06-10T16:55:00
---

# backend-stream-json

## 定位
NDJSON stream-json 协议后端，服务 claude / gemini / cursor 三种 provider。spawn agent CLI 并传入 `--output-format stream-json`，逐行解析 stdout JSON 消息。支持 control_request 自动应答（如 permission prompt）。

## 契约摘要
- `StreamJsonBackend(AgentBackend)` — provider="stream_json"
- `execute(cmd_path, task_prompt, work_dir, env?, **kwargs) -> TaskResult` — 完整执行流程
- `parse_output(line, *, _stdin?, _stdin_task?) -> AgentEvent | None` — 解析单行 JSON
- 支持的消息类型：assistant, user, system, result, control_request

## 关键逻辑
```
execute(cmd_path, task_prompt, work_dir, env)
  args = ["--output-format", "stream-json", ...]
  proc = spawn(cmd_path + args, cwd=work_dir, env=env)
  write prompt to stdin (async task)
  read stdout line-by-line with timeout:
    parse_output(line) → AgentEvent → accumulate output
    handle control_request → auto-respond via stdin
  collect session_id, status, error from result/system events
  return TaskResult(status, output, error, duration_ms, session_id, events)
```

## 注意事项
- 默认执行超时 `_EXECUTE_TIMEOUT = 10s`，需根据实际任务调整
- stdin 写入使用独立 async task 避免死锁，并保持 stdin 打开以支持 control_response
- stderr 在后台持续读取防止管道阻塞
- `_last_result_info` 是实例级临时状态，用于跨行传递 result 元数据
- 解析逻辑区分 assistant content block 类型：text / tool_use / tool_result / thinking

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
