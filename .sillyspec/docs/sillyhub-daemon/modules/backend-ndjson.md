---
schema_version: 1
doc_type: module-card
module_id: backend-ndjson
author: qinyi
created_at: 2026-06-10T16:55:00
---

# backend-ndjson

## 定位
NDJSON streaming 协议后端，服务 opencode / openclaw / pi 三种 provider。这些 CLI 使用 `run --format json` 子命令输出换行分隔的 JSON 事件，每行为 `{"type": "text|tool_use|error|step_start|step_finish", "part": {...}}`。

## 契约摘要
- `NdjsonBackend(AgentBackend)` — provider 运行时确定（opencode/openclaw/pi）
- `_NdjsonState` — 状态累积器：output, session_id, final_status, final_error, usage（含 token 统计）
- `_BINARY_MAP` — provider 到二进制名的映射
- `build_args(task_prompt, *, work_dir?, model?, session_id?) -> list[str]` — 构建 CLI 参数
- `parse_output(line) -> AgentEvent | None` / `parse_output_multi(line) -> list[AgentEvent]`

## 关键逻辑
```
execute(cmd_path, task_prompt, work_dir, env)
  args = ["run", "--format", "json", "--dangerously-skip-permissions", ..., prompt]
  spawn(cmd_path, args, cwd=work_dir, env=env)
  for each stdout line:
    parse_output_multi → events
    accumulate state.output, token usage
  return TaskResult(state.final_status, state.output, ...)

_handle_event(evt_type, part, raw)
  text → 累加 output, emit text event
  tool_use → emit tool_use + tool_result (if completed)
  error → set final_status=failed
  step_start → emit status event
  step_finish → 累加 token usage (input_tokens, output_tokens, cache_*)
```

## 注意事项
- `--dangerously-skip-permissions` 跳过所有权限检查
- `_BINARY_MAP` 确认支持的 provider 名，构造时传不在此列表的 provider 会 ValueError
- `tool_use` 事件在 `state.status == "completed"` 时同时产出 `tool_result` 事件
- token usage 在 `step_finish` 事件中累积，最终存入 `state.usage`

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
