---
schema_version: 1
doc_type: module-card
module_id: lib-approvals
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:02:25
---
# lib-approvals

## 定位
工作空间级"高风险操作审批"的前端 API 客户端。用于查阅 Agent/任务触发的高危动作（如 commit/branch/target）的待审批请求，并执行批准或驳回。对应后端 `/api/workspaces/{id}/approvals` 端点族。

## 契约摘要
全部基于 `apiFetch`，工作空间域。

| 函数 | 语义 | HTTP |
|---|---|---|
| `listPendingApprovals(workspaceId)` | 取该工作空间待审批请求列表 | GET `/api/workspaces/{ws}/approvals/pending` |
| `listApprovalHistory(workspaceId)` | 取已处理审批历史（含 approver/resolved_at） | GET `/api/workspaces/{ws}/approvals/history` |
| `approveRequest(workspaceId, requestId)` | 批准某请求 | POST `/api/workspaces/{ws}/approvals/{rid}/approve` |
| `rejectRequest(workspaceId, requestId)` | 驳回某请求 | POST `/api/workspaces/{ws}/approvals/{rid}/reject` |

核心类型：`RiskLevel`（low/medium/high/extreme）、`ApprovalStatus`（pending/approved/rejected）、`ApprovalRequest`、`ApprovalHistoryEntry extends ApprovalRequest`。

`ApprovalRequest` 关键字段：`run_id`/`task_id`/`task_key`（来源）、`agent_name`、`risk_level`、`tool_name`、`branch`/`target`/`commit_message`（待审批的具体动作）。

## 关键逻辑
```
approve/reject 均为 POST，无 body，路径参数定位 requestId
history 返回类型继承自 pending，额外 approver + resolved_at
```

## 注意事项
- 审批请求由后端在 Agent 执行高危工具时自动创建，前端只做"查阅 + 审批"，不构造请求。
- approve/reject 调用后后端会更新 status，前端需重新拉取 pending 或 history 刷新视图。
- 仅依赖 `lib-api`，无缓存。
- `ApprovalStatus` 枚举与后端约定一致，UI 文案需另行映射（见 `lib-utils` 的 `APPROVAL_STATUS_LABELS`）。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
