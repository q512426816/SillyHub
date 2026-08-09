---
author: qinyi
created_at: 2026-08-09 08:28:57
---
# 提案书（Proposal）

## 动机
`frontend/src/lib/changes.ts` 手写 ~20 个 change/stage 类型，违反 CLAUDE.md 规则 20（前端接口类型必须从后端 OpenAPI `pnpm gen:types` 生成，禁止手写），且已与后端 schema 产生 drift。本次把手写类型迁为 `api-types.ts` 的 `components["schemas"]` alias（与 `agent-profiles.ts`/`api-keys.ts` 同源范式），彻底还债并修复 drift 引入的调用方断裂。

## 关键问题
1. **规则 20 违规 + drift**：手写 `ChangeSummary.created_at` 后端从不返回（phantom，0 调用方）；手写 `FeedbackRequest` 漏了后端 `submit_feedback(*, target_stage=None)` 已支持的 `target_stage`（真 drift，能力缺失）；多处字段 required vs optional 与 schema 不一致。
2. **手写 drift 隐蔽且易错**：手写类型与 `api-types.ts` 并存靠人眼比对，round-1 自审甚至误判 5 个有同名 schema 的类型「无 schema」，证明手写维护成本高、易错。
3. **调用方潜在断裂**：drift 使部分调用方在「类型说有、运行时没有」假设上写代码（如 `reparseResult.warnings.length` 无 guard）。

## 变更范围
- `changes.ts`：11 个 schema faithful/超集类型改 `components["schemas"]` alias + JSDoc 迁移；9 个 schema lossy/loose 类型保留手写并补 shadow schema 注释。
- 调用方：按 typecheck 暴露点补 nullable guard（warnings/current_stage/TransitionDispatchResponse 字段）。

## 不在范围内（显式清单）
- 不改后端（schema.py / openapi.json / api-types.ts 保持现状——它们是正确的源）。
- 不重构 change 模块 UI/交互逻辑，仅类型契约 + 必要 guard。
- 不迁 9 个 lossy 例外类型（迁会降级前端精确类型，见 design §4）。
- 不改其它已 alias 化文件（agent-profiles.ts / api-keys.ts 无 drift）。

## 成功标准（可验证）
- `changes.ts` 中 schema faithful/超集类型全部来自 `components["schemas"]`（grep 无手写结构体定义残留）。
- `pnpm typecheck` + `pnpm test` + `pnpm gen:types:check` 全过。
- phantom `created_at` 消失；`FeedbackRequest.target_stage` 能力补回。
- 9 个 lossy 保留类型注释标 shadow schema 名 + 保留理由。
