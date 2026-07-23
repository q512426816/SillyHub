---
id: task-13
title: 后端测试精简 + 全量 pytest 回归
title_zh: 后端测试精简 + 全量 pytest 回归
author: qinyi
created_at: 2026-07-10 23:45:39
priority: P0
depends_on: [task-03,task-04,task-05,task-06,task-07,task-08,task-09]
blocks: [task-15]
requirement_ids: [FR-8, R-01, R-07]
decision_ids: [D-002, D-003, D-007]
allowed_paths:
  - backend/tests/**
---

## goal

移除 server-local (localhost) 工作区模式后，对 backend 测试套件做对应精简：

1. 删除所有 server-local 专属测试 case（整文件删或单 case 删，保留 daemon-client 断言）。
2. 更新 workspace_type / PathSource 筛选类断言（去掉 server-local option）。
3. 测试 fixture / 工厂里 `path_source='server-local'` 默认值改 `daemon-client`（或随 task-01 schema 一并去字段）。
4. 跑全量 pytest + 覆盖率门槛 ≥60%，守住 daemon-client 路径零回归（R-01 HostFsDelegate、R-07 agent/service 重灾区）。

## implementation

### 1. 整文件删除（4 个 server-local 专属测试文件，grep 命中且文件名即声明 server-local）

- `backend/tests/modules/workspace/test_path_source_server.py` — 仅验证 `resolve_root_path_for_server`，函数本身在 task-03 删。
- `backend/tests/modules/workspace/test_schema_path_source.py` — 全文围绕 `PathSourceLiteral` / `path_source` 默认/校验（8 个 test_*），schema 字段在 task-01 删。
- `backend/tests/modules/workspace/test_model_path_source.py` — 验证 `path_source` 列默认值文本，列在 task-01 删。
- `backend/tests/modules/workspace/test_migration_path_source.py` — 验证旧 add-column 迁移，本次是 drop-column 反向迁移，旧测试作废。

### 2. 单 case 精简（保留 daemon-client 断言，仅删 server-local 分支 case）

按 grep 命中点逐文件处理（命中 12 个非专属文件）：

- `tests/modules/agent/test_work_dir_strategy.py` — 删 `test_resolve_work_dir_delegate_server_local_uses_delegate`(245) / `..._not_exists_raises`(271) 两个 case；保留 daemon-client 路径断言。
- `tests/modules/agent/test_context_builder.py` — 删 `test_build_scan_bundle_path_source_server_local_locks_shared`(223)；保留 `test_build_scan_bundle_path_source_daemon_client_locks_tar`(193)（签名去 path_source 参数后改名 / 内联）。
- `tests/modules/workspace/test_component_catalog.py` — 删 `test_list_components_server_local_fallback`(134)；skills_view_service 平铺分支在 task-03 删。
- `tests/modules/agent/test_scan_interactive_dispatch.py` — 删 server-local 兜底 dispatch 断言；保留 daemon-client lease 路径。
- `tests/modules/agent/test_scan_dispatch.py` — 删 server-local 路由 case。
- `tests/modules/workspace/test_scan_generate.py` — 删本地版 `scan_generate`（service.py:692）断言；保留 `scan_generate_daemon_client`（task-03 重命名为 `scan_generate` 后对齐）。
- `tests/modules/workspace/test_member_runtimes.py` — 删 `not_daemon_client` / `daemon_runtime_id` legacy fallback 断言。
- `tests/modules/workspace/test_member_runtimes_model.py` — 删 `daemon_runtime_id` 列引用。
- `tests/modules/workspace/test_my_bindings_batch.py` — 删 `daemon_runtime_id` legacy join 断言。
- `tests/modules/workspace/test_component_catalog.py` — 同上 server-local fallback。
- `tests/modules/daemon/lease/test_complete_lease_stage_writeback.py` — 删 path_source 分流 case（D-003 边界：complete_lease 3 处容器越界 bug **不在此任务**，仅删 path_source 分流断言）。
- `tests/modules/daemon/test_migration_daemon_entity_binding.py` — 删 `daemon_runtime_id` 列回归断言。
- `tests/test_gate_e2e.py` / `tests/e2e/test_three_member_collaboration.py` — fixture 默认值 `path_source='server-local'` 改 `daemon-client`，断言去 path_source 字段；保留 daemon-client 路径的 gate / 多人协作流程断言。

### 3. fixture / 工厂默认值统一

- `tests/conftest.py`（或各模块 conftest）里 workspace 工厂 `path_source` 默认 `'server-local'` 的改 `'daemon-client'`；`daemon_runtime_id` 字段随 task-01 schema 去除后从工厂一并删。
- 凡 `WorkspaceFactory(path_source=...)` / `Workspace(path_source='server-local')` 调用点全部清理（grep `path_source=` 在 tests/ 全量扫）。

### 4. 全量回归

执行 `cd backend && uv run pytest -q --cov=app --cov-fail-under=60`：
- 全绿（无 fail / error）。
- 覆盖率 ≥60% 门槛通过。
- 重点回归模块：`agent/service.py`（R-07 十几处改动）、`daemon/host_fs/delegate.py`（R-01 删 6 `_local_*` + `_run_git_apply`）、`workspace/service.py`、`core/spec_paths.py`。

## 验收标准

- [ ] 4 个 server-local 专属测试文件已删（test_path_source_server / test_schema_path_source / test_model_path_source / test_migration_path_source）。
- [ ] 12 个非专属文件中 server-local case 全部删，daemon-client 断言保留。
- [ ] 测试 fixture / 工厂默认值全部改 daemon-client，无 `path_source='server-local'` 残留。
- [ ] `cd backend && uv run pytest -q --cov=app --cov-fail-under=60` 全绿，覆盖率 ≥60%。
- [ ] 无非 server-local 相关测试被误改（diff 只动 server-local / path_source / daemon_runtime_id 相关行）。
- [ ] grep `server-local` 在 `backend/tests/` 下仅剩 archive / 注释性引用（如有），无活跃断言。

## verify

```bash
cd backend && uv run pytest -q --cov=app --cov-fail-under=60
```

通过即视为本任务验证完成。task-15 会在 Docker 部署 + PG 迁移环境做端到端回归。

## constraints

- **TDD 同步**：测试改动必须与实现 task-03~09 同步进行（实现删一个 server-local 分支，对应测试 case 立即删/改），不得先删测试后补实现或反之。
- **覆盖率门槛 60%**：不得为提高覆盖率而保留已无对应实现的测试；删 server-local case 后若覆盖率掉破 60%，优先补 daemon-client 路径测试，**不是**保留 server-local case 充数。
- **只动 server-local 相关测试**：非 server-local 测试（如纯权限 / 纯 daemon-client 流程）不得修改；若因 schema 去字段（task-01）连带破坏断言，属 task-01 范畴，本任务只补 server-local 侧。
- **D-003 边界**：`complete_lease` 3 处容器越界 bug（apply_patch 500 / post_scan_validation / stage_callback）相关测试**不在本任务**；本任务只删 path_source 分流相关断言。
- **不动生产代码**：本任务 allowed_paths 仅 `backend/tests/**`；若发现实现层遗留 server-local 分支，回退到对应 task-03~09 处理。
