---
author: WhaleFall
created_at: 2026-06-04 10:50:53
task: task-12
title: 前端类型 + review API 调用
wave: W5
priority: P0
estimate: 1h
depends_on: [task-02]
---

# task-12: 前端类型 + review API 调用

## 目标

在前端 API 客户端中增加 human_gate 类型和 3 个 review API 调用函数。

## 不在范围

- 不修改页面组件（task-13）
- 不修改 create-change 表单（task-14）

## 输入

- `frontend/src/lib/change.ts`

## 产出

- `frontend/src/lib/change.ts`（改）

## 实现步骤

1. 在 `change.ts` 中增加类型：
   ```typescript
   export type HumanGate =
     | "none"
     | "need_requirement_input"
     | "need_proposal_review"
     | "need_plan_review"
     | "need_human_test"
     | "need_archive_confirm"
     | "blocked";
   ```
2. 在 ChangeRead/ChangeSummary 类型中增加 `human_gate: HumanGate`
3. 新增 3 个 API 调用函数：
   - `proposalReview(wsId, changeId, { decision, comment })`
   - `planReview(wsId, changeId, { decision, comment })`
   - `humanTest(wsId, changeId, { result, comment })`

## 验收标准

- [ ] ChangeRead 类型包含 human_gate
- [ ] 3 个 review API 函数可调用
- [ ] TypeScript 无类型错误

## 风险

无

## DoD

- [ ] 代码修改完成
- [ ] pnpm typecheck 通过
