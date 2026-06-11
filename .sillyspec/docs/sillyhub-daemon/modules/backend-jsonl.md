---
schema_version: 1
doc_type: module-card
module_id: backend-jsonl
author: qinyi
created_at: 2026-06-10T16:55:00
---

# backend-jsonl

## 定位
Copilot JSONL 点分事件协议后端。copilot CLI 使用 `--output-format json` 输出换行分隔的 JSON 事件流，每行为 `{"type": "dotted.event.name", "data": {...}}`。

## 契约摘要
- `JsonlBackend(AgentBackend)` — provider="copilot"
- `_JsonlState` — 内部状态累积器：output, session_id, active_model, final_status, final_error, usage
- `build_args(task_prompt, *, model?, session_id?) -> list[str]` — 构建 CLI 参数
- `parse_output(line) -> AgentEvent | None` — 解析单行
- `parse_output_multi(line) -> list[AgentEvent]` — 解析单行返回多事件

## 关键逻辑
```
execute(cmd_path, task_prompt, work_dir, env)
  args = ["-p", prompt, "--output-format", "json", "--allow-all", "--no-ask-user"]
  spawn(cmd_path, args)
  for each stdout line:
    parse_output_multi(line) → events
    accumulate into state.output, emit to on_event callback
  return TaskResult(state.final_status, state.output, ...)

_handle_event(evt_type, data, raw)
  session.start → 记录 session_id, model
  assistant.message_delta → 累加 deltaContent
  assistant.message → 重置 output（去重 delta），提取 reasoning + toolRequests
  assistant.reasoning/reasoning_delta → thinking event
  tool.execution_complete → tool_result event
  result → 设置 final_status
```

## 注意事项
- `assistant.message` 会重置 output 避免与 message_delta 重复计数（参考 copilot.go 逻辑）
- `--allow-all` 和 `--no-ask-user` 标志意味着自动跳过所有权限确认
- `_JsonlState` 在每次 execute 前需 `_reset_state()`
- 事件类型使用点分命名（如 `session.start`, `assistant.message_delta`）

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
