---
id: task-13
author: qinyi
created_at: 2026-08-27 09:36:00
priority: P1
title: 子代理目录/状态栏/会话块异步感知
title_zh: 子代理目录/状态栏/会话块异步感知
depends_on: [task-10, task-11]
blocks: [task-15]
allowed_paths:
  - frontend/src/components/sessions/subagent-catalog.tsx
  - frontend/src/components/daemon/turn-status-bar.tsx
  - frontend/src/components/daemon/turn-segment-views.tsx
provides: []
expects_from:
  - task: task-10
    contract: frontend_dispatch
    fields: [onAgentTaskStatus 扩展字段]
  - task: task-11
    contract: task_segment_metadata
    fields: [taskStatus/taskElapsedMs/taskAsync]
goal: |
  消灭假"已完成/00:00"：目录行、collectSubagents、会话块对异步派发子代理显示"后台运行中+走秒"，终态显示服务端真实时长（FR-07 / D-005@v1）。
implementation: |
  1. turn-status-bar.tsx collectSubagents（:165）：段有 taskAsync 或 taskStatus 元数据时，状态/时长改由元数据驱动（不再 result!==undefined 判 done、不用 endedAt-startedAt 差值）；运行中时长=now-startedAt 走秒（对齐既有 tick 模式）；终态=taskStatus+taskElapsedMs。
  2. subagent-catalog.tsx subagentDuration（:75）：消费 SubagentActivity 新字段（上游 collectSubagents 产出），后台运行中显示走秒、终态显示服务端时长。
  3. turn-segment-views.tsx：块头状态徽标（后台运行中/已完成(真实时长)/失败）+ 活跃块内保留 [TASK_*] 消费后的最新进度行。
  4. 前台（阻塞式）子代理路径零变化（无 taskAsync 元数据时走原推导）。
acceptance: |
  后台异步子代理：块/目录行不再出现"已完成+00:00"；终态到达显示真实时长；前台子代理回归不变。
verify: |
  单测在 task-15；本任务 pnpm exec tsc --noEmit + eslint 三文件。
constraints: |
  SubagentActivity 类型扩展向后兼容（新字段可选）；三主题取色语义阶；不动 session-log-assembler（task-11 已完成）。
---
