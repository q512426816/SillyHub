---
schema_version: 1
doc_type: module-card
module_id: lib-worktree
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:02:25
---
# lib-worktree

## 定位
Git worktree（工作树）租约管理的前端 API 客户端。worktree 是 Agent 运行时的隔离工作副本，通过租约（lease）机制串起"申请—使用—续期—释放"的生命周期，避免并发冲突。是 `lib-git-gateway`/`lib-tool-gateway` 的前置依赖。

## 契约摘要
| 函数 | 语义 | HTTP |
|---|---|---|
| `acquireWorktree(workspaceId, input)` | 申请一个 worktree 租约 | POST `/api/workspaces/{ws}/worktrees/acquire` |
| `listWorktrees(workspaceId)` | 列出工作空间的租约 | GET `/api/workspaces/{ws}/worktrees` |
| `getWorktree(leaseId)` | 取单个租约详情 | GET `/api/worktrees/{leaseId}` |
| `releaseWorktree(leaseId)` | 释放租约 | POST `/api/worktrees/{leaseId}/release` |
| `extendWorktree(leaseId, input)` | 延长租约有效期 | POST `/api/worktrees/{leaseId}/extend` |

类型：
- `WorktreeAcquireRequest`：`component_id?/change_id?/task_id?/git_identity_id?/ttl_seconds?`（用于绑定租约归属与存活时长）。
- `WorktreeLeaseRead`：`id/workspace_id/component_id/change_id/task_id/user_id/run_id/git_identity_id/path/branch_name/status/locked_at/released_at/expires_at`。
- `WorktreeLeaseList`：`{ items; total }`。
- `WorktreeExtendRequest`：`{ additional_seconds }`。

## 关键逻辑
```
acquire 时通过 component_id/change_id/task_id 绑定上下文，后端据此选分支/路径
租约有 expires_at，到期前需 extend 续期，否则后端自动回收
release 显式释放，置 released_at 并改 status
```

## 注意事项
- 两套 URL 前缀：acquire/list 带 workspaceId（`/api/workspaces/{ws}/worktrees`），get/release/extend 只用 leaseId（`/api/worktrees/{leaseId}`）。
- `branch_name`/`path` 由后端生成，前端只读。
- `run_id` 关联触发该租约的 Agent 运行；`git_identity_id` 关联提交身份。
- `_module-map` 标注 used_by 为空，主要为 Agent 后端链路使用。
- 仅依赖 `lib-api`。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
