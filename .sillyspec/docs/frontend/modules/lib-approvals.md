---
schema_version: 1
doc_type: module-card
module_id: lib-approvals
author: qinyi
created_at: 2026-06-10T16:55:00
---

# lib-approvals

## 定位
Approval（审批）API 客户端。

## 契约摘要
- `listPendingApprovals(workspaceId)` — 列出待审批
- `listApprovalHistory(workspaceId)` — 列出审批历史
- `approveRequest(workspaceId, requestId)` — 批准
- `rejectRequest(workspaceId, requestId)` — 驳回

## 关键逻辑
- 调用 `/api/workspaces/{id}/approvals` 系列端点
- 简单的 CRUD 式审批管理

## 注意事项
- 无特殊注意点

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
