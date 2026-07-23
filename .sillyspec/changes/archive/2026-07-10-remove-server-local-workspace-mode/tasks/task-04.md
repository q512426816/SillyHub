---
id: task-04
title: spec_workspace router/service/bootstrap delete server-local branches
title_zh: spec_workspace 删 sync_manual_server_local/_pack_sillyspec_local/import_from_repo 本地分支+daemon_runtime_id fallback+safe.directory
author: qinyi
created_at: 2026-07-10 23:45:39
priority: P0
depends_on: [task-01]
blocks: [task-08, task-13]
requirement_ids: [FR-2, FR-5]
decision_ids: [D-005, D-006]
allowed_paths:
  - backend/app/modules/spec_workspace/router.py
  - backend/app/modules/spec_workspace/service.py
  - backend/app/modules/spec_workspace/bootstrap.py
---

## goal

彻底移除 spec_workspace 三件套（router.py / service.py / bootstrap.py）中的 server-local 代码分支、`daemon_runtime_id` legacy fallback 与容器内 `safe.directory` 逻辑。删 `path_source` 列后这些分支必然断链（`ws.path_source` 读列抛 AttributeError），必须同步清除。变更后该模块**唯一**走 daemon-client 路径（WS RPC `get_spec_bundle` + `kind="spec-sync"` outbox），与变更中心 D-006 降级机制对齐。

覆盖：FR-2（后端 path_source 分流全删）、FR-5（daemon_runtime_id 清除）；依赖 D-005（daemon_runtime_id 列清理）、D-006（存量 server-local 删除）。

## implementation

### router.py
1. **`sync_manual_spec_workspace`(154-241)**：删除 `path_source` 分流，**永远走 daemon-client outbox 分支**（现 196-230 段）。删 `path_source` 变量(180) + `ws.path_source` fallback(193) + server-local 调用块(232-241)。
2. **daemon_runtime_id fallback 清除**：
   - `import_spec_workspace`(128-141)：删 `except` 块回退读 `ws.daemon_runtime_id`(140-141)，保留 `MemberBindingResolver.resolve_member_binding` 主路径；解析失败抛 `DaemonClientNoActiveSession`（不再静默回退 legacy）。
   - `sync_manual_spec_workspace`(186-193)：同理删 except 块读 `ws.daemon_runtime_id`(191)，保留 binding 主路径。
3. **docstring 清理**：`sync_manual_spec_workspace`(159-172) 删 "path_source 分流"/"server-local 分支" 描述；`import_spec_workspace`(110-124) 删 "落 server path 分支"/"workspace.daemon_runtime_id" 文案。

### service.py
1. **删 `sync_manual_server_local`(538-551)**：整个方法删除（server-local 专用入口，router 不再调用）。
2. **删 `_pack_sillyspec_local`(459-498)**：server-local 容器内打包分支，无调用方后删。
3. **删 `_walk_sillyspec_local`(500-524)**：仅被 `_pack_sillyspec_local` 调用的静态辅助，连带删。
4. **`import_from_repo`(194-269)**：删 server-local 分支块(258-269)，删后只剩 daemon-client 分支；同时清除 `ws_path_source = ws.path_source or "server-local"`(229) 与 `ws_daemon_id = daemon_id or ws.daemon_runtime_id`(233) fallback，`daemon_id` 必须由调用方经 binding 解析传入（无 binding 抛错）。
5. **`import_from_repo_sse`(271-387)**：删 `else` server-local 打包分支(336-343) + `ws_path_source`(302)/`ws_daemon_id`(306) fallback，保留 daemon-client RPC 主路径。
6. **`_fetch_spec_bundle_via_rpc`(399-457)**：`resolve_root_path_for_daemon(ws_root_path, ws_path_source)` 去 `path_source` 参数（task-07 重构签名后同步），参数 `ws_path_source` 一并移除。
7. **保留 `_host_fs_delegate`(69-74)**：方法本身仍可用于其他路径，但其注释段(62-68)中 "server-local 分支用 stat/list_dir" 文案更新为 daemon-client 单一路径语义。

### bootstrap.py
1. **`preflight_workspace_code_root`(656-685)**：删 `resolve_root_path_for_server` 调用(676-685)与 `path_source` 参数(661)，方法固定走 delegate（daemon-client 经 RPC，不再做 host→container 路径改写）。
2. **`_run_preflight`(688-749)**：删尾部 `safe.directory` 块(732-747)——注释(732-733)明说"仅 server-local 容器有意义"，删 server-local 后纯死代码。同时删 `is_daemon_client_path_source` 导入(734)与 `if not is_daemon_client_path_source(...)` 判断(736)。
3. **`_execute_bootstrap_agent_run`(344-629)**：删 `path_source=workspace.path_source` 透传，两处：
   - `preflight_workspace_code_root(workspace, code_root, _delegate, path_source=workspace.path_source)`(426-428) → 去掉 `path_source` 参数。
   - `build_scan_bundle(..., path_source=workspace.path_source)`(480-489) → 去掉 `path_source` 参数（task-06/task-07 同步改 `build_scan_bundle` 签名）。

## 验收标准

- router.py `sync_manual_spec_workspace` 无 `path_source` 变量、无 `ws.path_source` 读取、无 server-local 调用块；daemon-client outbox 分支为唯一路径。
- router.py `import_spec_workspace` 无 `ws.daemon_runtime_id` fallback；binding 解析失败抛 `DaemonClientNoActiveSession`。
- service.py 无 `sync_manual_server_local` / `_pack_sillyspec_local` / `_walk_sillyspec_local` 方法定义；`import_from_repo` / `import_from_repo_sse` 无 `ws.path_source` / `ws.daemon_runtime_id` 读取、无 server-local 分支块。
- bootstrap.py `preflight_workspace_code_root` 无 `path_source` 参数、无 `resolve_root_path_for_server` 调用；`_run_preflight` 无 `safe.directory` 块、无 `is_daemon_client_path_source` 导入；`_execute_bootstrap_agent_run` 无 `workspace.path_source` 读取。
- grep `spec_workspace/` 三文件无 `server-local` / `path_source` / `daemon_runtime_id` 字样（注释与 docstring 亦清零）。

## verify

```bash
cd backend && uv run pytest app/modules/spec_workspace -q
cd backend && uv run mypy app/modules/spec_workspace
```

预期：spec_workspace 模块测试全绿（test_router / test_service / test_bootstrap），mypy 类型检查无新增 error。若 mypy 报 `workspace.path_source` / `workspace.daemon_runtime_id` 不存在属预期（task-01 已删列），本任务正是清除这些读取点。

## constraints

- **依赖 task-01**：`Workspace.path_source` / `daemon_runtime_id` 列由 task-01 删除，本任务清除所有读取点；若先于 task-01 执行会导致读取点残留 + mypy 误报。
- **阻塞 task-08**（change/dispatch 分流清除）：`_fetch_spec_bundle_via_rpc` 签名变更（去 `path_source`）与 task-08 的 `resolve_root_path_for_daemon` 调用方同步相关，须先定型。
- **阻塞 task-13**（测试精简）：本任务删 `sync_manual_server_local` / `_pack_sillyspec_local` 后，对应测试 case 由 task-13 一并清理。
- **跨任务签名耦合**：`build_scan_bundle` 去参数由 task-06 实现，`resolve_root_path_for_daemon` 签名重构由 task-07 实现——execute 时若 task-06/07 未同步，`path_source=` 透传会临时断链，需同一 Wave 内协调。
- **不改 daemon-client 行为**：outbox 分支(196-230) + `resolve_runtime_for_writeback` 调用保持原样，D-006 降级语义零回归。
- allowed_paths 严格限定三文件；其他模块（workspace/service.py 的 `resolve_root_path_for_server` 定义、`is_daemon_client_path_source`）由对应 task-03/07 处理，本任务仅删 spec_workspace 侧的引用。
