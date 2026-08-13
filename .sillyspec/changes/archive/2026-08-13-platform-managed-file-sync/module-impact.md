---
author: qinyi
created_at: 2026-08-13 17:10:00
---

# 模块影响分析（Module Impact）— 平台管理 spec 文件增量同步

> change: `2026-08-13-platform-managed-file-sync`
> 数据源：`git diff 8164b93c..HEAD`（主仓 commit 0a94b692，16 文件）+ `_module-map.yaml` 模块映射
> 影响类型：逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新摘要 | needs_review |
|---|---|---|---|---|
| backend（spec_workspace 子模块） | 逻辑变更 + 数据结构变更 + 接口变更 + 新增 | `backend/app/modules/spec_workspace/model.py`、`schema.py`、`service.py`、`router.py`、`tests/test_sync_incremental.py` | 新增 `spec_file_manifest` 独立清单表（D-011）+ `apply_ops` 增量应用（add/update/delete/rename + base_version 乐观锁 + 软删 move 备份区 + containment/.runtime 校验 + R-07 兜底）；新增 `POST /spec-workspace/sync-incremental` 端点（conflict 200 透传 server_versions）；旧 tar 落盘失效清单（Q7）。scan_docs 零改动 | false |
| backend（migration） | 数据结构变更 + 新增 | `backend/migrations/versions/20260813160000_create_spec_file_manifest.py` | alembic 建 `spec_file_manifest` 表（ux workspace_id+path 唯一 + ix version 索引），down_revision=20260811150000 实际 head | false |
| backend（openapi） | 配置变更 | `backend/openapi.json` | 新端点 + FileOp/SpecIncrementalSyncRequest/Response schemas 进 OpenAPI（gen:types 产物） | false |
| sillyhub-daemon | 逻辑变更 + 接口变更 + 调用关系变更 | `sillyhub-daemon/src/spec-sync.ts`、`src/hub-client.ts`、`src/api-types.ts` | `postSpecSync` 由整树 tar 改**文件级增量 diff**（本地清单缓存 `~/.sillyhub/daemon/manifests/{ws}.json` 移出 specDir，首同步/404 回退旧 tar，rename 检测，conflict 抛 SpecPushConflict）；`hub-client` 新增 `postSpecSyncIncremental`（JSON POST /api 前缀）；api-types 重新生成 | false |
| sillyhub-daemon（tests） | 新增 + 修改 | `sillyhub-daemon/tests/spec-sync-incremental.test.ts`（新）、`spec-sync.test.ts`、`spec-transport-tar-sync/spec-sync.test.ts`、`task-09-hub-client-spec.test.ts`、`test_init_lease.test.ts` | 增量 diff 12 用例 + 既有 postSpecSync 测试按新行为（增量默认+旧 tar 回退）更新 + hub-client URL 回归锚点 + manifest 缓存隔离 | false |
| frontend | 配置变更 | `frontend/src/lib/api-types.ts` | OpenAPI 类型重新生成（新增 sync-incremental 端点类型），无业务代码改动 | false |

## 未匹配文件

| 文件 | 归属 | 说明 |
|---|---|---|
| `backend/migrations/versions/20260813160000_create_spec_file_manifest.py` | backend 模块 | 已并入 backend 行（migration 目录归 backend 顶层模块） |
| `backend/openapi.json` | backend 模块 | 已并入 backend 行（gen:types 产物） |
| `sillyhub-daemon/src/api-types.ts`、`frontend/src/lib/api-types.ts` | 各自子项目模块 | 已并入对应行（gen:types 产物，含 daemon 预存类型漂移补全） |

## 结论

变更影响面聚焦 backend `spec_workspace`（新增清单表+增量端点）与 `sillyhub-daemon`（增量 diff 客户端），模块边界清晰；frontend 仅类型重新生成零业务改动；`scan_docs`/`change` 等相邻模块零改动（D-011 职责分离）。无 needs_review=true 模块。

## 模块文档同步提示

`sillyhub-daemon.md` 模块卡片仍描述 `postSpecSync` 为「整树回灌」（2026-06-26-daemon-client-spec-sync-fix 时代），本变更已改为增量 diff——archive 第 3 步 sync-module-docs 需同步该卡片（人工备注区保护）。
