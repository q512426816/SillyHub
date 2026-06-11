---
schema_version: 1
doc_type: module-card
module_id: backend-text
author: qinyi
created_at: 2026-06-10T16:55:00
---

# backend-text

## 定位
纯文本 stdout 协议后端，服务 antigravity (agy) provider。最简单的后端——stdout 每行就是纯文本输出，无结构化事件。每行非空输出转为一个 `AgentEvent(event_type="text")`。

## 契约摘要
- `TextBackend(AgentBackend)` — provider="antigravity", binary_name="agy"
- `_TextState` — 状态累积器：output, final_status, final_error
- `build_args(task_prompt, *, model?, work_dir?, session_id?) -> list[str]` — 构建 agy CLI 参数
- `parse_line(line) -> AgentEvent | None` — 同步解析（每行非空即为 text event）
- `parse_output(line) -> AgentEvent | None` — 异步包装，满足 ABC 接口

## 关键逻辑
```
execute(cmd_path, task_prompt, work_dir, env, *, timeout?, model?, session_id?)
  binary = cmd_path || "agy"
  args = ["-p", prompt, "--dangerously-skip-permissions", ...]
  spawn(binary, args, cwd=work_dir, env=env)
  for each stdout line:
    parse_line(line) → AgentEvent(text) → accumulate state.output
  await proc.wait()
  return TaskResult(state.final_status, state.output, ...)
```

## 注意事项
- 本后端无 tool_use/tool_result/thinking 事件，仅 text 和 error
- 无内置超时机制（execute 方法接受 timeout 参数但未实现）
- stdout 逐行累加时用 `\n` 分隔，最终 output 是完整文本
- 使用 `shutil.which` 检查 binary 是否存在，不存在直接返回 failed
- agent-detector 中 antigravity 的 bin 名为 "agy"（非 "antigravity"）

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
