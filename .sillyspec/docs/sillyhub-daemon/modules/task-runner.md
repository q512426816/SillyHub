---
schema_version: 1
doc_type: module-card
module_id: task-runner
author: qinyi
created_at: 2026-06-10T16:55:00
---

# task-runner

## 定位
任务执行引擎。接收已 claim 的 lease 和执行 payload，编排完整的任务生命周期：准备 workspace -> 写 CLAUDE.md -> 渲染凭据 -> 选择后端 -> 执行 agent -> 收集 diff -> 返回结构化结果。

## 契约摘要
- `TaskResult` — 执行结果数据类：success, exit_code, patch, files_changed, insertions, deletions, output, error, duration_ms, metadata
- `TaskRunner(client, workspace_manager, credential_manager)` — 初始化
- `execute_task(lease_id, claim_token, payload) -> TaskResult` — 核心入口，完整执行流程
- `track(task_id, task)` / `untrack(task_id)` / `cancel_task(task_id)` — 后台任务追踪
- `active_task_count` — 当前运行中的任务数

## 关键逻辑
```
execute_task(lease_id, claim_token, payload)
  1. prepare_workspace(name, repo_url, branch)
  2. write CLAUDE.md to work_dir/.claude/CLAUDE.md
  3. credential_manager.build_env(tool_config) → extra_env
  4. get_backend(provider) → backend_cls → backend instance
  5. backend.execute(cmd_path, prompt, work_dir, env, on_event=callback)
     on_event: AgentEvent → submit_messages to server
  6. workspace.collect_diff(work_dir) → {patch, files_changed, ...}
  7. return TaskResult(success, patch, output, error, duration_ms, ...)

_event_to_message(event)
  AgentEvent → dict (filter out empty content/tool_name/status)
```

## 注意事项
- output 截断限制 `_MAX_OUTPUT = 10000` 字符，error 限制 `_MAX_ERROR = 5000` 字符
- diff 收集失败不标记整个任务失败（non-fatal）
- on_event 回调在 agent 执行过程中实时向 server 推送消息，网络异常只 warning 不中断
- 依赖：backends(工厂)、client(HTTP)、credential(渲染)、workspace(git)
- 被 cli 和 daemon 使用

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
