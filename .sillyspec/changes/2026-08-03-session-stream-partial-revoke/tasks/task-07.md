---
id: task-07
title: runtime-session-helpers.tsx logsToTurns 类型对齐（envelope 新字段），渲染逻辑不变（历史数据干净不加撤回）
title_zh: 历史回看类型对齐 envelope 新字段
author: WhaleFall
created_at: 2026-08-03 10:23:11
priority: P0
depends_on: [task-04]
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-003@v1]
allowed_paths:
  - frontend/src/components/daemon/runtime-session-helpers.tsx
provides: []
expects_from:
  - contract: SessionStreamEnvelope.segment_id / stale（task-04，仅类型对齐，logsToTurns 实际不消费）
goal: >
  logsToTurns 历史回看路径类型对齐 envelope 新字段（task-04 加的 segment_id/stale），渲染逻辑保持不变——历史数据本就干净不加撤回。
implementation:
  - 确认 logsToTurns（:174）消费的是 AgentRunLogEntry（来自 @/lib/agent，GET /sessions/{id}/logs 返回），其 DTO 不含 segment_id（design §2.4 / D-003：本轮不加该字段）。故 logsToTurns 函数体无需读 segment_id，渲染分支（reply/thinking/tool_use/tool_result/stderr）原样保留。
  - 若 logsToTurns 或同文件 SessionHistoryView 内部有类型断言依赖 SessionStreamEnvelope（检查 import：当前文件 import 的是 AgentRunLogEntry / AgentSessionRead / DaemonRuntimeRead，未直接 import SessionStreamEnvelope）—— 无则无需改类型，仅确认 task-04 新字段不引发 tsc 报错（SessionStreamEnvelope 字段增多不影响本文件）。
  - 跑 tsc --noEmit 验证 task-04 加字段后本文件无类型回归（envelope 新字段对不消费它的代码透明）。
  - 不加任何撤回逻辑：历史路径数据干净（override 不落库 task-02 / partial 已 DELETE task-14），logsToTurns 输出仍是完整全文。
acceptance:
  - logsToTurns 渲染结果与改前完全一致（历史回显正常，design §3 非目标 / FR-06）。
  - tsc --noEmit 通过（task-04 envelope 加字段不引发本文件类型错误）。
  - AgentRunLogEntry DTO 不被改动（不加 segment_id 字段，design §2.4 / §3）。
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test src/components/daemon/__tests__/interactive-session-panel.test.tsx
  - cd frontend && pnpm exec eslint src/components/daemon/runtime-session-helpers.tsx
constraints:
  - D-003：AgentRunLogEntry DTO 不加 segment_id 字段（design §2.4 / §3 非目标），envelope 新字段（segment_id/stale）仅实时 SSE 通道有，历史 GET 不返回。
  - 不加撤回逻辑：历史数据本就干净（partial 已 DELETE、override 不落库），渲染不变（design §2.4 / §3）。
  - 本任务本质是「类型对齐 + 回归确认」，若无 tsc 报错则代码改动应为零或极少（仅注释/类型断言微调），避免过度修改。
---
