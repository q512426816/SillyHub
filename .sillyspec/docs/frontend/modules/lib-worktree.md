---
schema_version: 1
doc_type: module-card
module_id: lib-worktree
author: qinyi
created_at: 2026-08-18 01:45:00
---

# worktree 租约·已删除（lib-worktree）

## 定位
**墓碑卡（死条目）**。`frontend/src/lib/worktree.ts`（60 行的 worktree 租约前端客户端：acquireWorktree / listWorktrees / getWorktree / releaseWorktree / extendWorktree）已于 2026-07-24 commit cbde5217「chore: 清理全仓死代码(backend/frontend/daemon)」整文件删除——同批删除的还有 backend worktree service、前端 lib/tool-gateway.ts 与 lib/git-gateway.ts。删除原因：前端零调用方（used_by 为空），worktree 生命周期由 Agent 后端链路内部管理。_module-map.yaml 中 lib-worktree 仍标 `status: active` 属于扫描残留，下次 scan 应剔除。

## 契约摘要
无。源文件不存在，全部导出符号（acquireWorktree / listWorktrees / getWorktree / releaseWorktree / extendWorktree / WorktreeAcquireRequest / WorktreeLeaseRead 等）在 frontend/src 零命中。

## 关键逻辑
```
（无实现代码）
残留痕迹：api-types.ts 仍含后端 worktree 端点的生成类型
  /api/workspaces/{ws}/worktrees/acquire、/api/worktrees/{lease_id}(/release|/extend)
——后端端点仍在 OpenAPI 中，前端无任何调用方
```

## 注意事项
- 引用本模块前先看此卡：不存在可 import 的代码，直接 import `@/lib/worktree` 会编译失败。
- api-types.ts 里的 worktree operations 类型是 gen:types 从后端 OpenAPI 生成的**被动产物**，不代表前端有客户端；不要据此误判模块存活。
- 若未来需要前端管理 worktree 租约（如租约可视化/手动释放），应重写客户端并复活本卡，而非引用死符号。
- 同批死亡的 lib-tool-gateway / lib-git-gateway（`git cat-file -e` 同样不存在于 HEAD），其卡片由其它代理负责，此处仅记录事实供交叉核对。
- 复核命令（Windows Git Bash）：
  - 存在性：`git cat-file -e HEAD:frontend/src/lib/worktree.ts` → 失败即确认死亡。
  - 死亡记录：`git show cbde5217 --stat | grep worktree` → `frontend/src/lib/worktree.ts | 60 -`（2026-07-24）。
  - 前端零调用：grep `acquireWorktree|listWorktrees|releaseWorktree|extendWorktree` 在 frontend/src 仅 api-types.ts（生成类型）命中。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
