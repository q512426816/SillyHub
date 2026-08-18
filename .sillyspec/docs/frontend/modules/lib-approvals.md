---
schema_version: 1
doc_type: module-card
module_id: lib-approvals
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 高风险审批客户端（lib-approvals）

## 定位
工作空间级「高风险操作审批」的前端 API 客户端（`frontend/src/lib/approvals.ts`，58 行）。查阅 Agent/任务触发的高危动作（commit/branch/target）待审批请求并执行批准/驳回，对应后端 `/api/workspaces/{id}/approvals` 端点族。审批页 `/workspaces/[id]/approvals` 的数据层。

## 契约摘要
| 函数 | 语义 | HTTP |
|---|---|---|
| `listPendingApprovals(workspaceId)` | 待审批请求列表 | GET `/api/workspaces/{ws}/approvals/pending` |
| `listApprovalHistory(workspaceId)` | 已处理历史（含 approver/resolved_at） | GET `/api/workspaces/{ws}/approvals/history` |
| `approveRequest(workspaceId, requestId)` | 批准 | POST `/api/workspaces/{ws}/approvals/{rid}/approve` |
| `rejectRequest(workspaceId, requestId)` | 驳回 | POST `/api/workspaces/{ws}/approvals/{rid}/reject` |

类型（本文件手写）：`RiskLevel`（low/medium/high/extreme）、`ApprovalStatus`（pending/approved/rejected）、`ApprovalRequest`（`run_id`/`task_id`/`task_key`/`agent_name`/`risk_level`/`tool_name`/`branch`/`target`/`commit_message` 等）、`ApprovalHistoryEntry extends ApprovalRequest`（+ `approver`/`resolved_at`）。

## 关键逻辑
```
approve/reject 均为 POST 无 body，路径参数定位 requestId，返回更新后的 ApprovalRequest
history 返回类型继承 pending 项，额外 approver + resolved_at
```

## 注意事项
- 审批请求由后端在 Agent 执行高危工具时自动创建，前端只做「查阅 + 审批」，不构造请求。
- approve/reject 后需重新拉取 pending/history 刷新视图（本模块无缓存）。
- 注意区分：这是**工具级**高危操作审批（daemon 会话权限体系）；SillySpec 变更阶段评审走 `lib-changes.submitStageReview`，两套审批语义不同。
- 与运行中会话的实时权限卡片（`permission_request` SSE 事件，见 `lib-agent-stream` / `components-permissions`）也是不同链路：本模块是持久化的审批记录 CRUD。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
