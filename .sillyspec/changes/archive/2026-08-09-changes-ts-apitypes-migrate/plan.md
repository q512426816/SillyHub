---
author: qinyi
created_at: 2026-08-09 08:48:57
plan_level: light
---

# 轻量计划（Light Plan）：changes.ts 手写类型迁 api-types（消除 drift）

## 来源
brainstorm design.md（round-2 独立 Grill pass）：把 `changes.ts` 手写类型迁 `components["schemas"]` alias，消除规则 20 债 + drift（phantom `ChangeSummary.created_at` / `FeedbackRequest` 漏 `target_stage` / 多处 required-vs-optional）。

## 范围
- `frontend/src/lib/changes.ts`（11 类型 alias 化 + 9 类型 shadow 注释 + JSDoc 迁移）
- `frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx`（ChangeReparseResponse.warnings 调用方，`setWarnings(resp.warnings)` 补 `?? []`）
- `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx`（current_stage + TransitionDispatchResponse 字段 optional guard）
- typecheck 暴露的其它 changes/ 调用方（按错误清单补 guard；注：tasks/page.tsx 用 TaskReparseResponse 不受影响，scan-docs/sillyspec-step-progress 已确认无关）

## Tasks
- [x] task-01: changes.ts 类型段重构（11 类型 alias 化 + 9 shadow 注释 + JSDoc + 删 phantom created_at + 补 FeedbackRequest.target_stage）（覆盖：FR-01, FR-02, FR-04, NFR-01, D-002@v1, D-003@v1, D-004@v2）
- [x] task-02: 调用方 drift guard（按 typecheck 暴露点补 warnings/current_stage/TransitionDispatchResponse 字段 guard）（覆盖：FR-03；depends_on task-01）

## 验收
- `cd frontend && pnpm typecheck`（tsc --noEmit）0 error
- `cd frontend && pnpm test`（vitest run）全过
- `cd frontend && pnpm gen:types:check`（regen + git diff --exit-code api-types.ts）无 diff（证未改后端）
- grep changes.ts：12 迁移类型无手写结构体残留；ChangeSummary 无 created_at；FeedbackRequest alias 含 target_stage
- 9 保留类型各有 shadow schema / 本地契约注释

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | （流程） | 走完整 plan/execute/verify |
| D-002@v1 | task-01 | 11 alias + JSDoc 迁移 |
| D-003@v1 | task-01 | CreateChangeResponse 名映射 ChangeCreateResponse |
| D-004@v2 | task-01 | 9 类型保留 + shadow 注释 |
