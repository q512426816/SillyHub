---
author: qinyi
created_at: 2026-08-11T12:42:00+08:00
---

# 模块影响分析（Module Impact）— 变更中心详情页展示结构重做

## 变更概述

纯前端展示层重构：变更中心详情页（`page.tsx`）从 1119 行单体瘦身为 484 行编排层，拆出 8 个展示组件（CollapsibleCard / ChangeFilesCard / ChangeSessionsCard / ChangeReviewHistoryCard / ChangeStageHeader / ChangeTaskBoardCard / ChangeStageActions / ChangeAgentRunLog）+ 8 测试文件。主线/次线分离（左主右辅两栏 grid），删除僵尸区块（审批状态 / 审查记录旧实现 listReviews）、死代码（handleExecute / handleTransition）、未用状态（archiveGate）。审核历史改读真实 `stages.review_history`。AI 操作入口收口到 ChangeStageActions，消除双入口。

零后端 / API / DTO / daemon / session-lease 改动。

## 真实变更文件（20 个，git diff tracked + 新增 untracked，以真实为准）

**新增**（changes/detail/ 展示组件 + 测试，主仓 untracked→staged）：
- `frontend/src/components/changes/detail/collapsible-card.tsx`
- `frontend/src/components/changes/detail/change-files-card.tsx`
- `frontend/src/components/changes/detail/change-sessions-card.tsx`
- `frontend/src/components/changes/detail/change-review-history-card.tsx`（含 normalizeReviewHistory 导出）
- `frontend/src/components/changes/detail/change-stage-header.tsx`（含 WORKFLOW_STAGES / WORKFLOW_STAGE_LABELS 导出）
- `frontend/src/components/changes/detail/change-task-board-card.tsx`
- `frontend/src/components/changes/detail/change-stage-actions.tsx`
- `frontend/src/components/changes/detail/change-agent-run-log.tsx`
- `frontend/src/components/changes/detail/__tests__/collapsible-card.test.tsx`（3 测试）
- `frontend/src/components/changes/detail/__tests__/change-files-card.test.tsx`（1 测试）
- `frontend/src/components/changes/detail/__tests__/change-sessions-card.test.tsx`（2 测试）
- `frontend/src/components/changes/detail/__tests__/change-review-history-card.test.tsx`（8 测试）
- `frontend/src/components/changes/detail/__tests__/change-stage-header.test.tsx`（7 测试）
- `frontend/src/components/changes/detail/__tests__/change-task-board-card.test.tsx`（3 测试）
- `frontend/src/components/changes/detail/__tests__/change-stage-actions.test.tsx`（9 测试）
- `frontend/src/components/changes/detail/__tests__/change-agent-run-log.test.tsx`（7 测试）

**修改**（tracked，git diff HEAD 可见）：
- `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx`（1119→484 行编排层瘦身）
- `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx`（重写指向 ChangeStageActions，3136ms→80ms）

**变更文档**（.sillyspec/changes/<change>/，brainstorm 产出 + execute/verify 迭加）：
- `design.md` / `proposal.md` / `requirements.md` / `tasks.md` / `decisions.md` / `plan.md` / `prototype-change-detail-layout.html` / `tasks/task-01..08.md` / `verify-result.md` / `module-impact.md`

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|---|---|---|---|---|
| frontend | 内部重构（展示层） | `changes/[cid]/page.tsx` + `components/changes/detail/*`（8 组件 + 8 测试）+ `page-team-toggle.test.tsx` | 详情页拆分为 8 展示组件 + 编排层；主线/次线两栏；删僵尸区块 + 死代码；审核历史改读 review_history；AI 入口收口消双入口。黑盒复用 AgentRunPanel/SillySpecStepProgress/TeamProgress/ChangeFileTree/ChangeSessionSection/StageTeamConfig 不改其内部。40 组件测试 + 8 迁移测试，全量 1386 零回归。 | false |

## 未匹配文件

| 文件 | 原因 |
|---|---|
| `.sillyspec/changes/2026-08-11-change-detail-layout-rework/*`（文档） | SillySpec 变更包文档，随 archive 移入 `changes/archive/`，非业务模块文件 |

## 三重交叉验证

- **声明范围**（design.md §6 文件清单）：8 组件 + page.tsx + 测试。✅ 与实际一致。
- **实际改动**（git diff）：20 文件（16 新增 detail + 2 修改 app + 2 文档同步，不含 sillyspec 变更包文档）。✅
- **模块归属**：全部命中 `frontend` 模块（_module-map.yaml `frontend: { path: "frontend/" }`）。✅ 零跨模块。

## 风险判级

- design.md frontmatter `risk_level: unit-sufficient`（纯前端展示重构，关键词 daemon/backend/session/lease 为展示概念非运行时修改）。
- 无需真实 daemon↔backend 集成证据；vitest 1386 + tsc 严格 + eslint 充分覆盖。
