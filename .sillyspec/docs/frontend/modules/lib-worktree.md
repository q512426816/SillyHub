---
schema_version: 1
doc_type: module-card
module_id: lib-worktree
author: qinyi
created_at: 2026-06-10T16:55:00
---

# lib-worktree

## 定位
Worktree（工作树）API 客户端。管理 Git worktree 租约。

## 契约摘要
- `acquireWorktree(workspaceId, data)` — 获取 worktree 租约
- `listWorktrees(workspaceId)` — 列出 worktree 租约
- `getWorktree(leaseId)` — 获取单个租约
- `releaseWorktree(leaseId)` — 释放租约
- `extendWorktree(leaseId, data)` — 延长租约
- 类型：WorktreeLeaseList、WorktreeLeaseRead

## 关键逻辑
- worktree 用于 Agent 运行时的隔离工作空间
- 租约机制防止并发冲突
- getWorktree/releaseWorktree/extendWorktree 使用 leaseId 而非 workspaceId

## 注意事项
- 无特殊注意点

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
