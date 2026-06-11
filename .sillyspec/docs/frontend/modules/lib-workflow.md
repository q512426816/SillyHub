---
schema_version: 1
doc_type: module-card
module_id: lib-workflow
author: qinyi
created_at: 2026-06-10T16:55:00
---

# lib-workflow

## 定位
Workflow（工作流）API 客户端。封装变更阶段流转、评审、任务状态变更。

## 契约摘要
- `transitionChange(workspaceId, changeId, targetStage)` — 变更阶段流转
- `submitReview(workspaceId, changeId, decision, comment?)` — 提交评审
- `listReviews(workspaceId, changeId)` — 列出评审记录
- `transitionTask(workspaceId, taskId, status)` — 任务状态变更

## 关键逻辑
- 调用 `/api/workspaces/{id}/workflow` 系列端点
- 与 lib-changes 的 transitionChange 功能重叠，workflow 模块可能是旧接口

## 注意事项
- 注意与 lib-changes 中同名函数的区分，workflow 版本的 transitionChange 签名不同

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
