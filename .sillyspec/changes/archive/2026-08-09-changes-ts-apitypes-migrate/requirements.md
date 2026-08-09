---
author: qinyi
created_at: 2026-08-09 08:28:57
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 开发者 | 维护 change 模块前端类型，依赖 api-types 与后端 schema 一致 |
| 规则 20 | CLAUDE.md 硬约束：前端接口类型必须 `pnpm gen:types` 生成，禁手写 |

## 功能需求

### FR-01: schema faithful/超集类型迁 alias
覆盖决策：D-002@v1, D-003@v1, D-004@v2
Given `changes.ts` 中 11 个 schema faithful/超集类型（ChangeSummary / ChangeRead / ChangeList / ChangeWarning / ChangeReparseStats / ChangeReparseResponse / ArchiveCheckItem / ArchiveGateResponse / CreateChangeResponse / FeedbackRequest / TransitionDispatchResponse）
When 改为 `components["schemas"]["X"]` alias（CreateChangeResponse 名映射 ChangeCreateResponse）
Then grep `changes.ts` 无对应手写结构体定义残留；类型与后端 schema 一致。

### FR-02: schema lossy 类型保留手写 + shadow 注释
覆盖决策：D-004@v2
Given 9 个 schema lossy/loose 或无 schema 类型（DispatchResponse / TransitionRequest / TransitionResponse / VerifyGateResponse / HumanGate / ReviewResponse / ReviewEntry / DispatchResult / ProxyCreateChangeInput）
When 保留手写
Then 有 shadow schema 的 3 个（TransitionRequest/TransitionResponse/VerifyGateResponse）注释标 schema 名 + 保留理由（loose 点 + 调用方依赖）；无 schema 的 5 个保持现状。

### FR-03: 调用方 drift guard 修复
覆盖决策：D-002@v1
Given 迁移后部分字段变 optional（reparseResult.warnings / current_stage / TransitionDispatchResponse.agent_run_id 等）
When 调用方访问这些字段
Then 按 typecheck 暴露点补 `?.` / `??` guard；`tasks/page.tsx:165` warnings.length 补 `?.`。

### FR-04: 移除 phantom + 补回 drift 能力
Given 手写 ChangeSummary.created_at 是 phantom（0 调用方）；手写 FeedbackRequest 漏 target_stage
When ChangeSummary 迁 schema alias；FeedbackRequest 迁 schema alias
Then created_at 消失（0 调用方无影响）；submitFeedback 入参可选增 targetStage，body 可选带 target_stage（后端已支持）。

## 非功能需求
- 兼容性：不改后端；调用方运行时行为不变（runtime 字段早就是 undefined/optional，仅类型变严）。
- 可回退：纯前端类型重构，git revert 干净。
- 可测试：`pnpm typecheck` + `pnpm test` + `pnpm gen:types:check` 全过。
- 规范遵循：规则 20（gen:types 生成，禁手写）；规则 12（UI/文档中文）。

## 决策覆盖矩阵
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | （流程） | scale=large 走完整四件套 |
| D-002@v1 | FR-01, FR-03 | 方案 A 全量迁 + JSDoc |
| D-003@v1 | FR-01 | CreateChangeResponse 名映射 |
| D-004@v2 | FR-01, FR-02 | lossy 例外判据（supersede D-004@v1） |
