---
author: qinyi
created_at: 2026-10-13T13:00:00+08:00
---
# 任务清单（Tasks）

- [x] task-01: daemon 执行器——sillyspec-manager.ts 新增 `runSyncChange(change, workspaceId)`：`_sillyspecStatusRoots` 查根（无根结构化 no_workspace_root）→ cwd=主仓根串行 execFile `sillyspec platform sync --change X` → `sillyspec platform sync-docs --change X`（各 120s 超时）→ 聚合 `{ok,actions[{cmd,code,ms}]}` / `{ok:false,reason,failed_cmd,stderr_tail}` 结构化回执 [target: sillyhub-daemon/src/sillyspec-manager.ts] (depends_on: 无)
- [x] task-02: daemon RPC 注册——daemon.ts `SillySpecCommandExecutor` 接口加 `runSyncChange`；`_registerHostFsRpcHandler` 同款注册 `sillyspec_sync_change` handler：change 过 SAFE_CHANGE_NAME_RE（拒穿越）+ workspace_id 过 isWorkspaceIdShape → 防抖（模块级 Map：15s TTL 惰性清理 + 1000 条硬帽 + in-flight 去重，命中回 skipped）→ 调执行器回结构化 result（不 reject） [target: sillyhub-daemon/src/daemon.ts] (depends_on: task-01)
- [x] task-03: daemon 测试——vitest 覆盖：参数清洗拒穿越/非法 UUID、15s 防抖 skipped、in-flight skipped、无根映射 no_workspace_root、两条命令按序串行、CLI 非零退出 cli_failed 结构、硬帽淘汰 [target: NEW:sillyhub-daemon/tests/sillyspec-sync-change-rpc.test.ts] (depends_on: task-01, task-02)
- [x] task-04: backend 同步前置——change/router.py `list_change_files` 前插 `_sync_change_via_daemon`：resolve_member_binding_or_none（未绑定 skip）→ query_daemon_online_by_id（离线 skip）→ hub.send_rpc('sillyspec_sync_change', timeout=15) 整体 try/except（DaemonRuntimeOffline/DaemonRpcTimeout/DaemonRpcRemoteError 四路 log.info 静默降级）；service.list_files 零改动 [target: backend/app/modules/change/router.py] (depends_on: 无)
- [x] task-05: backend 测试——pytest（mock send_rpc/binding/online）：在线触发成功后才 list、未绑定/离线/超时/远端错误四路降级均正常返回、change_key+workspace_id 透传正确；既有 test_files_router.py 回归全绿 [target: NEW:backend/app/modules/change/tests/test_files_refresh_sync.py] (depends_on: task-04)
- [x] task-06: 收账——daemon tsc --noEmit + backend ruff/mypy 聚焦检查 + 两仓新增测试全绿 + 对照 design.md 文件变更清单核验无漂移 [target: sillyhub-daemon/src/sillyspec-manager.ts, sillyhub-daemon/src/daemon.ts, backend/app/modules/change/router.py] (depends_on: task-03, task-05)
