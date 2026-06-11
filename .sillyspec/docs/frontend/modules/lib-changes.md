---
schema_version: 1
doc_type: module-card
module_id: lib-changes
author: qinyi
created_at: 2026-06-10T16:55:00
---

# lib-changes

## 定位
Change（变更）API 客户端。是前端最大的 lib 模块之一，覆盖变更全生命周期管理。

## 契约摘要
- CRUD: `listChanges`、`getChange`、`createChange`
- 文档: `getChangeDocuments`、`getChangeDocumentContent`
- 解析: `reparseChanges`
- 审批: `getChangeApproval`、`approveChange`、`rejectChange`
- 流转: `transitionChange(workspaceId, changeId, targetStage, reason?)`
- 执行: `executeChange(workspaceId, changeKey)` — 创建 AgentRun 并后台执行
- 反馈: `submitFeedback(workspaceId, changeId, category, text)`
- 归档门禁: `checkArchiveGate(workspaceId, changeId)`
- Agent 状态: `getAgentStatus`、`triggerDispatch`
- 人工审批: `proposalReview`、`planReview`、`humanTest`、`archiveConfirm`

## 关键逻辑
- transitionChange 返回 TransitionResponse，包含变更数据和 Agent dispatch 结果
- 反馈提交会触发后端自动决定返工目标阶段
- 人工审批接口（proposalReview/planReview/humanTest/archiveConfirm）对应 SillySpec 流程中的 4 个审批节点

## 注意事项
- 此模块接口数量多（20+），修改时注意后端 schema 同步
- HumanGate 类型定义了 7 种人工门禁状态

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
