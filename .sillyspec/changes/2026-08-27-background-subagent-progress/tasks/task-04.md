---
id: task-04
author: qinyi
created_at: 2026-08-27 09:36:00
priority: P1
title: daemon 单测（task_* 映射 / 回执解析 / 行格式 / 节流）
title_zh: daemon 单测（task_* 映射 / 回执解析 / 行格式 / 节流）
depends_on: [task-03]
blocks: []
allowed_paths:
  - sillyhub-daemon/src/interactive/__tests__/task-lifecycle.test.ts
  - sillyhub-daemon/src/interactive/__tests__/task-ack-fallback.test.ts
provides: []
expects_from:
  - task: task-03
    contract: task_log_line_format
    fields: ["[TASK_STARTED/PROGRESS/NOTIFICATION] 前缀与字段", 节流口径]
goal: |
  task-03 行为的 vitest 全覆盖（FR-01/02/03 的 daemon 侧验收）。
implementation: |
  1. task-lifecycle.test.ts：构造伪 SDK 消息序列（task_started→task_progress×N→task_notification）注入 session-manager 消息入口，断言 _emitSessionEvent 载荷序列（status 迁移/字段透传/任务表注册注销）与 onTurnMessage 落行的前缀+JSON 字段。
  2. 节流断言：短间隔多次 task_progress 只落一条 [TASK_PROGRESS]（fake timers），终态行不受节流影响。
  3. task-ack-fallback.test.ts：tool_result 文本含 "Async agent launched successfully … agentId: abcd1234" 时注册 async 任务 + emit running(async=true)；普通 tool_result 不误触发。
  4. task_updated 仅 status/is_backgrounded 变化才 emit。
acceptance: |
  新增用例全绿；覆盖 spike 两种结论路径（发/不发 task_*）。
verify: |
  cd sillyhub-daemon && pnpm vitest run src/interactive/__tests__/task-lifecycle.test.ts src/interactive/__tests__/task-ack-fallback.test.ts。
constraints: |
  不跑全量测试（CLAUDE.md 规则 0）；vitest + fake timers，不起真 CLI；用例命名中文注释说明对应 FR。
---
