---
author: WhaleFall
created_at: 2026-06-04 13:44:54
---

# Requirements: 修正 Agent 驱动变更中心流程闭环

## 角色

| 角色 | 说明 |
|------|------|
| 开发者 | 通过前端 UI 提交需求、确认文档/计划、执行人工测试 |
| Agent | 自动执行 SillySpec 阶段（brainstorm/propose/plan/execute/verify/quick/archive） |
| 系统管理员 | 可强制推进任意阶段，绕过 gate 限制 |

## 功能需求

### FR-01: Gate 时机修正 — transition 时 gate=none

Given 一个 Change 处于 draft 阶段
When 调用 `transition(target_stage="brainstorm")`
Then `current_stage=brainstorm, human_gate=none`（不是 need_requirement_input）

Given 一个 Change 处于 brainstorm 阶段，Agent 已完成 propose
When `complete_stage(stage="propose")` 被调用
Then `human_gate=need_proposal_review`

Given 一个 Change 处于 propose 阶段，Agent 已完成 plan
When `complete_stage(stage="plan")` 被调用
Then `human_gate=need_plan_review`

Given 一个 Change 处于 execute 阶段，Agent 已完成 verify
When `complete_stage(stage="verify", result="passed")` 被调用
Then `human_gate=need_human_test`

### FR-02: complete_stage 统一入口

Given Agent 完成任意阶段
When 系统调用 `complete_stage(workspace_id, change_id, stage, result)`
Then 根据 stage 和 result 执行对应后续动作（设 gate / transition / dispatch），不再散落在 transition / auto_dispatch / human_test 各自判断

Given brainstorm 完成，result="clear"
When `complete_stage(stage="brainstorm", result="clear")` 被调用
Then `current_stage=propose, human_gate=none`，并 dispatch propose Agent

Given brainstorm 完成，result="ambiguous"
When `complete_stage(stage="brainstorm", result="ambiguous")` 被调用
Then `human_gate=need_requirement_input`

Given execute 完成
When `complete_stage(stage="execute")` 被调用
Then `current_stage=verify, human_gate=none`，并 dispatch verify Agent

### FR-03: rerun_stage 同阶段重跑

Given 一个 Change 处于 propose 阶段，`human_gate=need_proposal_review`
When `proposal_review(decision="revise", comment="四件套缺少边界条件")` 被调用
Then `human_gate=none`，重新 dispatch propose Agent，不触发 InvalidTransition

Given 一个 Change 处于 plan 阶段，`human_gate=need_plan_review`
When `plan_review(decision="replan", comment="任务拆分过粗")` 被调用
Then `human_gate=none`，重新 dispatch plan Agent，不触发 InvalidTransition

### FR-04: verify→propose 回退边

Given 一个 Change 处于 verify 阶段，`human_gate=need_human_test`
When `human_test(result="doc_mismatch", comment="API 文档与实际不一致")` 被调用
Then `current_stage=propose, human_gate=none`，并 dispatch propose Agent

### FR-05: proposal-review 修正

Given 一个 Change 处于 propose 阶段，`human_gate=need_proposal_review`
When `proposal_review(decision="approve")` 被调用
Then `current_stage=plan, human_gate=none`，并 dispatch plan Agent

When `proposal_review(decision="unclear", comment="需求边界不清晰")` 被调用
Then `current_stage=brainstorm, human_gate=none`，并 dispatch brainstorm Agent

Given 任意 proposal_review 调用
When 执行完成
Then `change.stages["review_history"]` 记录 `{decision, comment, user_id, submitted_at, from_stage, target_action}`

### FR-06: plan-review 修正

Given 一个 Change 处于 plan 阶段，`human_gate=need_plan_review`
When `plan_review(decision="approve")` 被调用
Then `current_stage=execute, human_gate=none`，并 dispatch execute Agent

When `plan_review(decision="back_to_propose")` 被调用
Then `current_stage=propose, human_gate=none`，并 dispatch propose Agent

When `plan_review(decision="back_to_brainstorm")` 被调用
Then `current_stage=brainstorm, human_gate=none`，并 dispatch brainstorm Agent

### FR-07: human-test 修正

Given 一个 Change 处于 verify 阶段，`human_gate=need_human_test`
When `human_test(result="pass")` 被调用
Then `current_stage=archive, human_gate=need_archive_confirm`，**不** dispatch archive Agent

When `human_test(result="bug", comment="列表分页显示错误")` 被调用
Then `current_stage=quick, human_gate=none`，并 dispatch quick Agent

When `human_test(result="doc_mismatch")` 被调用
Then `current_stage=propose, human_gate=none`，并 dispatch propose Agent

### FR-08: archive-confirm API

Given 一个 Change 处于 archive 阶段，`human_gate=need_archive_confirm`
When `POST /api/workspaces/{ws_id}/changes/{id}/archive-confirm` 被调用
Then `human_gate=none`，dispatch archive Agent

Given 一个 Change 不处于 archive+need_archive_confirm
When 调用 archive-confirm
Then 返回 400 错误

Given archive Agent 执行完成
When `complete_stage(stage="archive")` 被调用
Then `current_stage=archived, human_gate=none, location=archive, archived_at=now`

### FR-09: 前端 Gate 面板 comment

Given 详情页显示 Gate 面板（任意 gate）
When 用户看到操作按钮
Then 每个面板都有一个 textarea 用于输入意见

Given revise / unclear / replan / bug / doc_mismatch 操作
When comment 为空
Then 按钮禁用或提交时提示"请填写意见"

Given approve / pass / archive-confirm 操作
When comment 为空
Then 允许提交（comment 可选）

### FR-10: 归档确认按钮修正

Given 详情页显示 `need_archive_confirm` Gate 面板
When 用户点击"确认归档"
Then 调用 `archiveConfirm(workspaceId, changeId, comment)` API，不调用 `humanTest(pass)`

### FR-11: 清理旧 UI 残留

Given 变更详情页代码
When 搜索 `ready_for_dev` / `accepted` / `executeChange` / `handleArchive` / `submitFeedback` / `submitReview`
Then 无匹配引用

## 非功能需求

- **兼容性**：已有数据库数据（旧 stage 值）不受影响，migration 已在 agent-driven-change-center 中完成
- **可回退**：所有改动在后端 service 层，API 签名不变（只改内部逻辑），前端只改 Gate 面板组件
- **可测试**：每个 FR 都有对应的 pytest 测试用例覆盖
