---
id: task-11
author: qinyi
created_at: 2026-08-27 09:36:00
priority: P1
title: assembler [TASK_*] 行解析为段元数据
title_zh: assembler [TASK_*] 行解析为段元数据
depends_on: [task-03]
blocks: [task-13, task-15]
allowed_paths:
  - frontend/src/components/daemon/session-log-assembler.ts
provides:
  - contract: task_segment_metadata
    fields: [段元数据 taskStatus(running/completed/failed/stopped), taskElapsedMs, taskAsync, taskSummary, taskToolName]
expects_from:
  - task: task-03
    contract: task_log_line_format
    fields: ["[TASK_*] 前缀与 JSON 字段"]
goal: |
  日志回放路径：把 [TASK_*] 行解析为所在子代理块的段元数据，刷新/历史回看重建状态（FR-03/07 前端半）。
implementation: |
  1. assembler 识别 stdout 行前缀 [TASK_STARTED]/[TASK_PROGRESS]/[TASK_NOTIFICATION]（与 [TOOL_USE]/[SYSTEM:] 前缀方言同级解析），JSON.parse 容错（坏行降级为普通文本，R-07）。
  2. 按 parent_tool_use_id 路由到对应 tool 段（复用既有归属路由），写入段元数据：taskStatus/taskElapsedMs/taskAsync/taskSummary/taskToolName；TASK_NOTIFICATION 为终态覆盖。
  3. [TASK_*] 行本身不渲染为正文文本（消费后折叠），保留在段元数据。
  4. 无 [TASK_*] 前缀历史行走原路径零回归。
acceptance: |
  含 [TASK_*] 行的历史日志组装后：async 段状态 running、终态段 completed + taskElapsedMs；无前缀日志输出与改造前一致（快照对比）。
verify: |
  单测在 task-15；本任务 pnpm exec tsc --noEmit + 既有 session-log-assembler 测试回归绿。
constraints: |
  不改 tool_use/tool_result 配对逻辑；解析失败不抛错（降级文本）。
---
