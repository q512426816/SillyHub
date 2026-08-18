---
schema_version: 1
doc_type: module-card
module_id: lib-git-gateway
author: qinyi
created_at: 2026-08-18 01:45:00
---

# Git 操作网关·已删除（lib-git-gateway）

## 定位
**墓碑卡（tombstone）**：本模块的源文件已删除，卡片仅记录删除事实与语义去向，供排查与索引清理用。

- 删除事件：commit `cbde5217`（2026-07-24，「chore: 清理全仓死代码(backend/frontend/daemon)」），`frontend/src/lib/git-gateway.ts`（23 行）作为整文件死代码删除；同批删除的还有 frontend 的 `worktree.ts` / `tool-gateway.ts` 两个无人调用的 lib。
- 删除前形态：单函数 `executeGitOperation(leaseId, input)`，POST `/api/worktrees/{leaseId}/git`——在已获取的 worktree 租约内执行受控 git 命令，返回 `result_code` 与脱敏输出 `redacted_output`。
- 删除依据：全仓无页面/组件/模块引用（used_by 为空，frontend/src 全量 grep `executeGitOperation|git-gateway` 零命中）；删除时 backend 2940 passed / frontend vitest 全过，纯删除无行为/API 变更。

## 契约摘要
当前为空模块：无源文件、无导出、无调用方。`_module-map.yaml` 仍将其列为 active 属**死条目**，status/paths 待下次 scan 清理。

## 关键逻辑
（已删除，无逻辑可记。）

## 注意事项
- **语义去向：纯删除、无后继**。前端不存在任何「在 worktree 租约内执行 git 命令」的入口；git 相关的活代码只有 `lib/git-identities.ts`（身份凭据管理，独立端点 `/api/git/*`，后端 schema 在 `backend/app/modules/git`，与租约域无关）。
- 同批删除的 `worktree.ts` / `tool-gateway.ts` 至今未恢复（2026-08-18 glob 仍不存在）；`_module-map.yaml` 对 lib-worktree / lib-tool-gateway / 本模块三者的 active 标记均为死条目，待 scan 清理。
- 后端 `/api/worktrees/{leaseId}/git` 端点当前是否存在未核实；若要恢复「受控 git 操作网关」能力应按新需求重新立项，不要按旧卡描述 resurrect 本文件。
- 排查 `/api/worktrees/{leaseId}/git` 调用链时：前端侧已断开，勿在本模块找调用点。
- git log 快速定位：`git log --diff-filter=D -- frontend/src/lib/git-gateway.ts` 唯一命中 `cbde5217`。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
