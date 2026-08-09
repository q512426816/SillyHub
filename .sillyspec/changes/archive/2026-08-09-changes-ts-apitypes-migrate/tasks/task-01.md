---
id: task-01
title: changes.ts 类型段重构（11 alias + 9 shadow 注释 + JSDoc + 删 phantom + 补 target_stage）
title_zh: changes.ts 类型段重构（11 类型迁 alias + 9 保留类型补 shadow 注释 + JSDoc 迁移）
author: qinyi
created_at: 2026-08-09 08:48:57
priority: P0
depends_on: []
blocks: [task-02]
requirement_ids: [FR-01, FR-02, FR-04, NFR-01]
decision_ids: [D-002@v1, D-003@v1, D-004@v2]
low_risk: true
allowed_paths:
  - frontend/src/lib/changes.ts
provides: []
expects_from: []
goal: >
  把 changes.ts 中 11 个 schema faithful/超集类型改为 components["schemas"] alias（删 phantom
  created_at、补 FeedbackRequest.target_stage、CreateChangeResponse 名映射 ChangeCreateResponse），
  9 个 lossy/无-schema 类型保留手写并补 shadow 注释，JSDoc 迁 alias 上方。消除规则 20 债 + drift。
implementation:
  - 顶部加 `import type { components } from "./api-types";`（同 agent-profiles.ts/api-keys.ts 范式）
  - 11 类型改 alias（design §3 表）：ChangeSummary/ChangeRead/ChangeList/ChangeWarning/ChangeReparseStats/ChangeReparseResponse/ArchiveCheckItem/ArchiveGateResponse/CreateChangeResponse(→schema ChangeCreateResponse)/FeedbackRequest/TransitionDispatchResponse；删手写结构体改 `export type X = components["schemas"]["Y"];`
  - 9 保留类型（DispatchResponse/TransitionRequest/TransitionResponse/VerifyGateResponse/HumanGate/ReviewResponse/ReviewEntry/DispatchResult/ProxyCreateChangeInput）结构不动，声明上方加 JSDoc——有 schema 的 4 个（DispatchResponse/TransitionRequest/TransitionResponse/VerifyGateResponse）标 `shadow schema: <name>`+loose 点+调用方依赖（D-004@v2），无 schema 的 5 个标「无 openapi schema，前端本地契约」
  - 有价值 JSDoc（pending_review 四取值 / source 三取值 / 6 检查项名 / category A/B/C/D）挂到对应 alias 上方（NFR-01）
  - ⚠️ DispatchResponse 不迁（schema last_dispatch/dispatch_result 是 loose dict 会丢 DispatchResult 精确结构），保留手写 + shadow 注释
acceptance:
  - grep changes.ts 11 迁移类型均为 `= components["schemas"][...]` 形式，无手写 `{ ... }` 残留
  - ChangeSummary alias 无 created_at（phantom 删除）
  - FeedbackRequest alias 含 target_stage（drift 修复）
  - CreateChangeResponse = components["schemas"]["ChangeCreateResponse"]（名映射）
  - DispatchResponse 保持手写（未迁）+ shadow schema 注释
  - 9 保留类型各有 shadow schema / 本地契约 JSDoc 注释
verify:
  - cd frontend && pnpm typecheck（收集 changes.ts 相关 error；调用方 error 清单交 task-02）
  - grep 自查 11 alias + 9 注释齐全
constraints:
  - 不改后端（schema.py / openapi.json / api-types.ts —— 它们是正确源）
  - 不改 9 保留类型的结构（仅加注释）
  - 不改 changes.ts 函数体（仅类型定义段）
  - CreateChangeResponse 调用方用名不变（alias 桥接）
related_tests: []
---
