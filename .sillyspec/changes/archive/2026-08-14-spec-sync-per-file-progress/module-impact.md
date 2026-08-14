---
author: qinyi
created_at: 2026-08-14T03:05:00
change: 2026-08-14-spec-sync-per-file-progress
---

# 模块影响分析（Module Impact）— spec-sync 逐文件级进度

## 影响矩阵

| 模块 | 影响类型 | 涉及文件 | 说明 |
|---|---|---|---|
| **sillyhub-daemon / spec-sync** | 修改 | `sillyhub-daemon/src/hub-client.ts` | postSpecSync/postSpecSyncIncremental 加 X-Change-Write-Id 请求头 |
| **sillyhub-daemon / spec-sync** | 修改 | `sillyhub-daemon/src/spec-sync.ts` | postSpecSync 接收 changeWriteId 参数透传 |
| **sillyhub-daemon / spec-sync** | 修改 | `sillyhub-daemon/src/task-runner.ts` | spec-sync 分支传 taskId + 移除 P1 processed 终态上报（D-004@V2 避免双写） |
| **backend / spec_workspace** | 修改 | `backend/app/modules/spec_workspace/router.py` | sync/sync-incremental 解析 X-Change-Write-Id 头 |
| **backend / spec_workspace** | 修改 | `backend/app/modules/spec_workspace/service.py` | apply_sync/apply_ops 循环内独立 session 回写 files_processed+=1 |

## 模块依赖关系

- **daemon hub-client** 产出 X-Change-Write-Id 头 → backend router 解析 → service 循环内回写。
- 复用 P1 的 files_total/files_processed 列（无新 schema）。

## 不受影响

- progress 端点 / DaemonChangeWrite model / 迁移（P1 已就位，复用）。
- 前端（P1 Progress 条已就位）。
- daemon outbox 状态机（不变）。

## 文档同步（task-05）

- `.sillyspec/docs/backend/modules/spec_workspace.md`（apply 循环内 processed 回写约定）
- `.sillyspec/docs/sillyhub-daemon/modules/spec-sync.md`（X-Change-Write-Id 头约定 + D-004@V2 processed 写者转移）
