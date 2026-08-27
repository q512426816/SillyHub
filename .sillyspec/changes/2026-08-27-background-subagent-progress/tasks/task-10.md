---
id: task-10
author: qinyi
created_at: 2026-08-27 09:36:00
priority: P1
title: 前端事件类型与 SSE 分发（lib/daemon.ts）
title_zh: 前端事件类型与 SSE 分发（lib/daemon.ts）
depends_on: [task-09]
blocks: [task-12, task-13]
allowed_paths:
  - frontend/src/lib/daemon.ts
provides:
  - contract: frontend_dispatch
    fields: [onAgentTaskStatus 回调携带 status 四值/tool_use_id/summary/last_tool_name/elapsed_ms/total_tokens/tool_uses/async]
expects_from:
  - task: task-09
    contract: api_types_regenerated
    fields: [事件类型字段]
goal: |
  SSE 通道到前端回调的扩展字段全量透传（FR-04 前端半）。
implementation: |
  1. daemon.ts AgentTaskStatusEvent 接口（:1022 起）对齐新 schema（或直接引用 api-types 生成类型，按文件现状惯例）；更新 :1059 预留注释为已接线说明。
  2. SSE 分发 switch（:1331 case "agent_task_status"）把新字段并入 onAgentTaskStatus 回调参数。
  3. 保持白名单（:1290 附近的 run 附加白名单）不变（agent_task_status 已在白名单）。
acceptance: |
  事件到达时回调收到全部扩展字段；类型与 api-types 一致（tsc 绿）；旧字段消费方不受影响。
verify: |
  cd frontend && pnpm exec tsc --noEmit；grep 确认 case 分支字段集合与卡片一致。
constraints: |
  不在 lib 层做 UI 语义（状态机在组件层）；fetch-sse 统一入口不变（knowledge：SSE 消费铁律）。
---
