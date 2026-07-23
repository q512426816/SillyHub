---
id: task-12
title: 前端 change detail 页 gate_status 展示（客观核验中徽标 + 失败摘要 gate_last_errors + SSE 实时更新）
title_zh: 前端 gate_status 展示与 SSE
author: qinyi
created_at: 2026-07-10 14:49:30
priority: P0
depends_on: [task-04, task-09, task-11]
blocks: [task-13]
requirement_ids: [FR-9, FR-10]
decision_ids: []
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx
  - frontend/src/lib/use-agent-run-stream.ts
  - frontend/src/lib/agent-stream.ts
  - frontend/src/lib/changes.ts
  - frontend/src/lib/agent.ts
  - frontend/src/components/agent-run-panel.tsx
---

# TaskCard — task-12 前端 gate_status 展示 + SSE

## 契约

### provides
- `gate_status frontend display`：fields = [gate_badge, gate_errors_summary]

### expects_from
- task-04 `AgentRun.gate_fields`：needs = [gate_status]（pending/running/decided/failed，挂 AgentRun；agent-status 接口透传）
- task-09 `change.stages gate fields`：needs = [gate_last_errors]（last_dispatch 跨 run 持久错误摘要）
- task-11 `gate_status_changed SSE event`：needs = [agent_run_id, gate_status, errors_summary]（复用 agent_run:{id} channel）

## 实现要点

1. **四态徽标渲染**（change detail 页 `page.tsx`，verify stage 当前 last_dispatch）：
   - gate_status `pending` / `running` → 蓝色 spin 徽标「客观核验中…」（`animate-spin` 或 `animate-pulse`）
   - gate_status `decided` + gate_result.exit_code `0` → 绿色「✓ 已通过」
   - gate_status `decided` + exit_code `1`（打回）/ `2`（卡住）→ 红色「✗ 核验失败」
   - gate_status `failed` → 红色「✗ 核验失败」（异常）
   - gate_status 空（brownfield / 非 verify stage）→ 不渲染徽标（fallback 当前行为）
2. **失败摘要展示**：失败态展开渲染 `change.stages[current].last_dispatch.gate_last_errors`（list[str] 截断，每条限长；参考 design §2 errors 可见性）。完整审计落 AgentRunLog 不在此展示。
3. **SSE 实时更新**：`use-agent-run-stream.ts` + `agent-stream.ts` 加 `gate_status_changed` 事件回调链路（对齐现有 `onPermissionRequest` 模式 `agent-stream.ts:181-203`）—— backend publish `agent_run:{id}` channel，EventSource 复用同一连接，hook 暴露 `gateStatus` state，page.tsx 订阅更新徽标。
   - 事件结构（task-11）：`{event:"gate_status_changed", agent_run_id, gate_status, errors_summary}`
   - 不新建 channel、不轮询（design §5.7 推荐方案）
4. **数据源**：初始读 `getAgentStatus`（DispatchResponse）透传的 gate_status / gate_result（task-04）；失败摘要读 `change.stages`（task-09，page 已有 `change.stages as Record<string,any>` 读路径 `page.tsx:566/675`）。SSE 覆盖实时增量。

## acceptance
- [ ] 四态 gate_status 正确渲染（pending/running 转圈、decided+exit0 绿、decided+exit1/2 与 failed 红）
- [ ] 失败态展示 `gate_last_errors` 摘要（截断、中文可读）
- [ ] SSE `gate_status_changed` 实时更新徽标（不刷新页面）
- [ ] 中文文案（CLAUDE.md 规则 11；复用 STATUS_BADGE 风格）
- [ ] brownfield：gate_status 空 / 非 verify stage 不渲染、不崩

## verify
`cd frontend && pnpm test && pnpm typecheck`（前端 vitest 全绿，含 gate_status 徽标 + SSE 更新单测；类型零回归）

## constraints
- 复用现有 agent_run SSE 订阅（不新建 channel）；中文优先
- MarkdownText 若涉 jsdom 测试需 `vi.mock` 成纯文本渲染（参考 `frontend-markdown-text-jsdom-null` 记忆）
- gate_status/gate_last_errors 为可空新字段，类型用 `?? null` 防御（OpenAPI 生成类型 nullable，参考 `frontend-type-migration-landscape`）
- 事件解析复用 `parseSessionPermissionEvent` 的「专用解析 → 专用回调」模式（agent-stream.ts:106-117），不进 `_emitMessage`（无 timestamp 会被丢，见 `_emitMessage:219`）
