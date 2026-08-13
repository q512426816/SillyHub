---
author: qinyi
created_at: 2026-08-13 14:43:03
---

# 任务清单 — 平台管理 spec 文件增量同步

> 初步任务清单，plan 阶段将细化为 `plan.md`（Wave/Task/依赖/验收）。
> 对应需求见 `requirements.md`（FR-01~FR-07），设计见 `design.md`。

## Wave 1 · 后端：独立清单表 + 增量端点（核心）

- task-01 [FR-03] 新建 `spec_file_manifest` 表（path/content_hash/version/exists）+ migration（不复用 scan_documents，D-011）。
- task-02 [FR-01/02/03] `spec_workspace/schema.py` 增量 DTO（FileOp/Request/Response）。
- task-03 [FR-01/02/04/05/06] `spec_workspace/service.py` 新增 `apply_ops`（add/update/delete/rename + 软删 move 出 spec_root + base_version 校验 + .runtime 拒），写 spec_file_manifest。
- task-04 [FR-02] `spec_workspace/router.py` 新增 `POST /spec-workspace/sync-incremental` 端点（base_version 过期 409 + 返回服务器版）；旧 tar push 后失效 spec_file_manifest version（兼容 Q7）。

## Wave 2 · 后端测试 + daemon 客户端（依赖 Wave 1）

- task-05 [测试] `spec_workspace/tests/test_sync_incremental.py`：各 op / base_version 409 / 软删备份 / `.runtime` 拒。
- task-06 [FR-01/02/03] `spec-sync.ts` `postSpecSync` 内部改增量 diff（本地 hash → 变化 ops）+ 本地清单缓存（`~/.sillyhub/daemon/manifests/<ws>.json`，移出 specDir 不被 pull 清）。
- task-07 [FR-01/02] `hub-client.ts` 新增 `postSpecSyncIncremental`（JSON payload）。

## Wave 3 · daemon 测试 + 兼容收尾（依赖 Wave 2）

- task-08 [测试] `sillyhub-daemon/tests/`：diff 客户端测试（本地 hash → 变化 ops；首同步走旧 tar；增量不可用回退）。
- task-09 [FR-07] 兼容收尾：旧 tar 端点保留核验、单成员快速路径、`.runtime` 垃圾行清洗（可选）。

## 依赖

- Wave 2 依赖 Wave 1（增量端点就绪）。
- Wave 3 依赖 Wave 2（daemon 客户端就绪）。
- task-09 依赖 task-05（兼容收尾在测试后）。
