---
id: task-04
title: declare-envelope-attribution-fields
title_zh: SessionStreamEnvelope 补归属字段类型声明
author: WhaleFall
created_at: 2026-08-19 18:43:32
priority: P0
depends_on: []
blocks: [task-03, task-11]
requirement_ids: [FR-03, FR-05]
decision_ids: []
allowed_paths:
  - frontend/src/lib/daemon.ts
provides:
  - contract: SessionStreamEnvelope
    fields: [parent_tool_use_id, subagent_type, depth, tool_kind]
expects_from:
goal: >
  为 SessionStreamEnvelope 补声明四个归属字段（可选可空），让 SSE 流中既有的归属数据可被装配器类型化消费，零运行时变化。
implementation:
  - 在 SessionStreamEnvelope（lib/daemon.ts 约 747-791 行，stale 字段后）补声明 parent_tool_use_id、subagent_type、tool_kind（string 可空）与 depth（number 可空），均可选，注释标注 producer 为 backend session channel publish（数据已在流中，本次仅补声明）
  - 注释注明消费方为 session-log-assembler 的 AssemblerLogInput 归一；旧 backend/daemon 不下发时为 undefined，现有 onLog 逻辑不感知新字段、行为不变
acceptance:
  - 仅新增四个可选可空字段声明，SSE 解析、重连、游标等运行时逻辑均原样
  - tsc --noEmit 通过，sessions 页 onLog 等现有引用零改动零行为变化
  - git diff 确认 daemon.ts 改动仅限该字段声明与注释
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 只做类型声明，无序列化、解析、事件处理改动
  - 不动 AgentRunLogEntry（lib/agent.ts 已有归属字段，历史路径类型齐备）
related_tests: []
---
