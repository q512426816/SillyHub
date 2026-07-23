---
id: task-08
title: change/dispatch + change/service + change_writer/service + change_writer/proxy + daemon-patch/service delete path_source branches
title_zh: change/dispatch+change/service+change_writer/service+change_writer/proxy+daemon-patch/service 删 path_source 分流+daemon_runtime_id
author: qinyi
created_at: 2026-07-10 23:45:39
priority: P0
depends_on: [task-03, task-04]
blocks: [task-13]
requirement_ids: [FR-2, FR-5]
decision_ids: [D-005, D-006]
allowed_paths:
  - backend/app/modules/change/dispatch.py
  - backend/app/modules/change/service.py
  - backend/app/modules/change_writer/service.py
  - backend/app/modules/change_writer/proxy.py
  - backend/app/modules/daemon/patch/service.py
---

## goal

彻底移除 change / change_writer / daemon-patch 三模块共 5 文件中的 `path_source` 分流与 `daemon_runtime_id` legacy 读取。task-01 删 `Workspace.path_source` / `daemon_runtime_id` 列后，`is_daemon_client_path_source(workspace.path_source)` 与 `workspace.daemon_runtime_id` 必然抛 `AttributeError`（dispatch.py:1554 / service.py:343,965 / change_writer/service.py:106,385 / daemon-patch/service.py:107），必须同步清除。变更后 stage sync 永远走 `_sync_stage_status_daemon_client`（经 HostFsDelegate RPC 读 sillyspec.db），patch apply 永远走 `_apply_via_host_fs_delegate`（WS RPC 委托 daemon 在宿主 apply），change write 永远经 `proxy_create_change`（lease-polling 代写队列下发 daemon）。

覆盖：FR-2（后端 path_source 分流全删）、FR-5（daemon_runtime_id 清除）；依赖 D-005（daemon_runtime_id 列清理）、D-006（daemon-client 降级复用）。

## implementation

### change/dispatch.py
1. **`sync_stage_status`(1514-1555) 删 path_source 分流**：删除 `is_daemon_client_path_source(path_source)` 判断(1554-1555)，**永远走 `_sync_stage_status_daemon_client`**。删 `path_source: str | None = None` 入参(1520-1521) 与 docstring 的 path_source 说明(1530-1534)；保留 `_resolve_db_path` / `_resolve_db_path_fallback` / `_sync_stage_status_daemon_client` 三方法（仍是 daemon-client 分支的实现，删 path_source 分流后 `_sync_stage_status_daemon_client` 成唯一路径）。**保留 server-local `_resolve_db_path` / `_resolve_db_path_fallback` 不删**——被 `_resolve_db_rel_candidates`(daemon-client 分支内部)间接复用，仅删顶层分流入口。
2. **docstring 清理**：`sync_stage_status` docstring(1514-1543) 删 "task-08 透传的 path_source"/"server-local sqlite3.connect 本地容器分支"描述；`_get_host_fs_delegate`(1246-1263) docstring 删 "仅 daemon-client path_source 调用（sync_stage_status 分流）"为 "sync_stage_status 调用"。
3. **调用方同步**：grep `sync_stage_status(` 调用点（run_sync/service.py 等），删透传的 `path_source=` 参数（task-09 处理 run_sync 侧，本任务只改 dispatch.py 签名 + 文件内调用）。

### change/service.py
1. **`write_file`(335-358) 删 path_source 分流**：删 `from app.modules.workspace.service import is_daemon_client_path_source`(335) 与 `if is_daemon_client_path_source(workspace.path_source):`(343) 判断，**永远走 `_enqueue_edit_write`**（daemon-client outbox 入队，runtime 由 `resolve_runtime_for_writeback` 现算）。返回值固定 `{"status": "pending", "task_id": task_id}`（删 `"done"` 分支）。docstring(303-317) 删 server-local/daemon-client 分流描述。
2. **`reparse`(961-966) 删 path_source 分流**：删 `from app.modules.workspace.service import is_daemon_client_path_source`(961) 与 `platform_managed = is_daemon_client_path_source(workspace.path_source)`(965)，`parse_workspace` 调用固定 `platform_managed=True`（daemon-client 同步产出扁平布局，无 `.sillyspec` 包裹）。docstring(963-964) 删 "server-local 仍包裹" 描述。
3. **`_enqueue_edit_write` 保留**：runtime_id 早已改由 `resolve_runtime_for_writeback`(392) 现算（不再直读 `workspace.daemon_runtime_id`），无 path_source/daemon_runtime_id 读取点，不动。

### change_writer/service.py
1. **`create_change`(106-122) 删 path_source 分流**：删 `if is_daemon_client_path_source(workspace.path_source):`(106-121) 判断块，`lease_id is None` 分支**永远走 `proxy_create_change`**（runtime 现算 + lease-polling 代写）。保留 `lease_id is not None` 的 worktree 直写分支(90-97)（execute agent worktree lease 路径）。docstring(58-70) 删 server-local/repo-native 分流描述。
2. **`_repo_dir_for_workspace`(385-390) 删 path_source 分流**：删 `if is_daemon_client_path_source(workspace.path_source): raise ChangeWriteError`(385-389)，方法简化为 `return Path(_rewrite_path(workspace.root_path))`（worktree lease 路径专用，不再守 server-local）。docstring(384) 更新。
3. **导入清理**：`from app.modules.workspace.service import _rewrite_path, is_daemon_client_path_source`(29) 删 `is_daemon_client_path_source`（若仍被 `_repo_dir_for_workspace` 之外引用则保留，grep 确认）。

### change_writer/proxy.py
1. **module docstring(1-17) 清理**：删 "校验 runtime（workspace.daemon_runtime_id == runtime_id 且 status='online'）"(7) 描述——runtime 早已改由 `resolve_runtime_for_writeback` 现算（D-001@v1，proxy.py:200），docstring 残留 `workspace.daemon_runtime_id` 文案需清零。proxy.py 无实际 `workspace.daemon_runtime_id` 读取点（2026-07-05-daemon-client-change-binding-fix 已清除），仅 docstring 文案债。
2. **`_runtime_heartbeat_is_fresh`**(44-54) 不动：runtime_id 由 binding 现算传入，不读 workspace 列。

### daemon/patch/service.py
1. **`apply_patch_to_worktree`(57-176) 删 path_source 分流**：删 `path_source: str | None = None` 入参(62) + `if is_daemon_client_path_source(path_source):`(107-114) 判断，**永远走 `_apply_via_host_fs_delegate`**（WS RPC 委托 daemon 在宿主 apply）。删 server-local 容器内 `git apply` 分支（116-176 段：`workdir = Path(workspace.root_path)`(117) + `_run_git_apply` 调用 + `--3way` 逻辑）。docstring(64-85) 删 server-local 分支描述。
2. **`_run_git_apply`(252-269) 连带删**：server-local 专用辅助（仅被 apply_patch_to_worktree server-local 分支调用），删后无调用方，连带删；同时删 `import asyncio`(10) / `from pathlib import Path`(11)（若仅被 `_run_git_apply` 使用，grep 确认）。
3. **导入清理**：`from app.modules.workspace.service import is_daemon_client_path_source`(23) 删除。
4. **调用方同步**：grep `apply_patch_to_worktree(` 调用点（lease/service.py 等），删透传的 `path_source=` 参数。

## 验收标准

- dispatch.py `sync_stage_status` 无 `path_source` 入参、无 `is_daemon_client_path_source(path_source)` 判断；`_sync_stage_status_daemon_client` 为唯一 stage sync 路径。
- service.py `write_file` 无 `is_daemon_client_path_source` 判断、返回值固定 pending；`reparse` 固定 `platform_managed=True`。
- change_writer/service.py `create_change` 的 `lease_id is None` 分支永远走 `proxy_create_change`；`_repo_dir_for_workspace` 无 path_source 守卫。
- change_writer/proxy.py docstring 无 `workspace.daemon_runtime_id` 字样。
- daemon/patch/service.py `apply_patch_to_worktree` 无 `path_source` 入参、无 server-local `git apply` 分支、无 `_run_git_apply` 方法定义、无 `is_daemon_client_path_source` 导入。
- grep 5 文件无 `is_daemon_client_path_source` / `workspace.path_source` / `workspace.daemon_runtime_id` / `server-local`（注释与 docstring 亦清零）。

## verify

```bash
cd backend && uv run pytest app/modules/change app/modules/change_writer app/modules/daemon/patch -q
cd backend && uv run mypy app/modules/change app/modules/change_writer app/modules/daemon/patch
```

预期：change / change_writer / daemon-patch 三模块测试全绿（test_dispatch / test_service / test_change_writer_service / test_change_writer_proxy / test_patch_service），mypy 无新增 error。若 mypy 报 `workspace.path_source` / `workspace.daemon_runtime_id` 不存在属预期（task-01 已删列），本任务正是清除这些读取点。

## constraints

- **依赖 task-03**：`is_daemon_client_path_source` 定义在 workspace/service.py，task-03 删除该函数并统一 daemon-client 单一路径；本任务删所有调用点，须 task-03 先定型 `is_daemon_client_path_source` 的移除决策（否则调用点悬空）。
- **依赖 task-04**：`resolve_runtime_for_writeback` 与 binding 解析链路由 task-04/spec_workspace 侧同步清理 daemon_runtime_id fallback，本任务的 `_enqueue_edit_write` / `proxy_create_change` 复用同一 resolver，须协调。
- **阻塞 task-13**（测试精简）：本任务删 server-local 分支后，对应测试 case（dispatch sync_stage_status server-local / patch server-local git apply / write_file "done" 分支）由 task-13 一并清理。
- **跨任务签名耦合**：`sync_stage_status` / `apply_patch_to_worktree` 去 `path_source` 参数后，调用方（run_sync/service.py、lease/service.py）须同步删透传——run_sync 侧由 task-09 处理，lease/service.py 若有 `path_source=` 透传属本任务范围外（需 grep 确认调用方清单，超出 allowed_paths 则记入 task-09 或 quick 修）。
- **不改 daemon-client 行为**：`_sync_stage_status_daemon_client` / `_apply_via_host_fs_delegate` / `proxy_create_change` 三条 daemon-client 主路径保持原样，D-006 降级语义零回归（RPC 失败兜底 StageSyncResult(synced=False) / PatchConflictError / DaemonClientNoActiveSession）。
- allowed_paths 严格限定 5 文件；`is_daemon_client_path_source` 定义移除（task-03）、`resolve_root_path_for_daemon` 签名重构（task-07）、run_sync path_source 分流（task-09）由对应任务处理。
