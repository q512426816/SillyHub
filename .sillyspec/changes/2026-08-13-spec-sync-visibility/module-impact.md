---
author: qinyi
created_at: 2026-08-13T22:35:00
change: 2026-08-13-spec-sync-visibility
---

# 模块影响分析（Module Impact）— 工作区配置页同步可见性增强

> 基于 design.md 文件变更清单 + plan.md 任务列表，对照 `_module-map.yaml` 模块映射。

## 影响矩阵

| 模块 | 影响类型 | 涉及文件 | 说明 |
|---|---|---|---|
| **backend / daemon 子模块** | 修改 | `backend/app/modules/daemon/model.py` | DaemonChangeWrite 加 files_total/files_processed 列 |
| **backend / daemon 子模块** | 新增 | `backend/migrations/versions/<新>_daemon_change_write_progress.py` | Alembic 迁移（up/down） |
| **backend / daemon 子模块** | 修改 | `backend/app/modules/daemon/schema.py` | 新增 ChangeWriteProgressRequest（不改 ChangeWriteCompleteRequest，D-004） |
| **backend / daemon 子模块** | 修改 | `backend/app/modules/daemon/change_write_router.py` | 新增 PATCH progress 端点（不改 complete ok 分支） |
| **backend / daemon 子模块** | 新增 | `backend/app/modules/daemon/tests/` | progress 端点 status==claimed 校验测试 |
| **backend / spec_workspace 子模块** | 修改 | `backend/app/modules/spec_workspace/service.py` | sync_manual_get_pending 返回加 files_total/files_processed |
| **backend** | 修改 | `backend/openapi.json` | gen:types 同步 schema 变更 |
| **frontend** | 修改 | `frontend/src/lib/spec-workspaces.ts` | PendingSyncItem 整体对齐后端（修既有 schema 漂移）+ 加 files_total/processed |
| **frontend** | 修改 | `frontend/src/lib/api-types.ts` | gen:types 同步 |
| **frontend** | 修改 | `frontend/src/components/workspace-config-card.tsx` | W1 失败透传 + W2 5 按钮 Tooltip/规范对齐 + W3 done 计数 + W4 syncing Progress |
| **frontend** | 修改 | `frontend/src/components/workspace-config-card.test.tsx` | mock 补字段 + 失败原因/进度展示用例 |
| **sillyhub-daemon** | 修改 | `sillyhub-daemon/src/spec-sync.ts` | postSpecSync 加 onProgress 回调 + packSpecDir 加 onWalkComplete 钩子 |
| **sillyhub-daemon** | 修改 | `sillyhub-daemon/src/task-runner.ts` | spec-sync 分支 complete 前 progress 上报 + 接 onProgress |
| **sillyhub-daemon** | 修改 | `sillyhub-daemon/src/hub-client.ts` | 新增 reportChangeWriteProgress 方法（不改 completeChangeWrite） |
| **sillyhub-daemon** | 修改 | `sillyhub-daemon/src/daemon.ts` | RunnerHubClient 接口声明加 reportChangeWriteProgress |
| **sillyhub-daemon** | 修改 | `sillyhub-daemon/tests/spec-sync.test.ts` | onProgress/onWalkComplete 回调测试 |

## 模块依赖关系

- **backend daemon 子模块**（model/schema/router）是基石 → 迁移 + 端点先就位（W3 task-06/11）。
- **sillyhub-daemon** 依赖 backend 端点契约（reportChangeWriteProgress 调 PATCH progress）。
- **frontend** 依赖 backend 返回字段（sync_manual_get_pending 加字段）+ 自身 PendingSyncItem 类型对齐。
- 三模块通过 `sync-manual/pending` 轮询 + `progress` 端点 + `complete-change-write` 回执三个契约耦合。

## 不受影响

- backend 其它子模块（change/worktree/auth/ppm 等）零改动。
- frontend 其它页面（仅 workspace-config-card.tsx + spec-workspaces.ts）。
- sillyhub-daemon 其它模块（仅 spec-sync/task-runner/hub-client/daemon 接口）。
- 同步状态机（pending→claimed→done/failed 不变）。
- main.py（progress 端点经 daemon/router include 自动落位，无需改入口——design 已核实）。

## 文档同步（task-15）

- `.sillyspec/docs/backend/modules/spec_workspace.md`（sync_manual_get_pending 字段变更索引）
- `.sillyspec/docs/backend/modules/daemon.md`（progress 端点 + files_total/processed 列变更索引）
- `.sillyspec/docs/sillyhub-daemon/modules/spec-sync.md`（onProgress/onWalkComplete 回调契约）
