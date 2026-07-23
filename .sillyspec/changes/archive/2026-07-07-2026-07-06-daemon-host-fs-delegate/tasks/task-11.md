---
id: task-11
title: import_from_repo / _sse 重构（spec_workspace/service.py:229）（覆盖：FR-04）
author: qinyi
created_at: 2026-07-06 19:28:16
priority: P1
depends_on: [task-01]
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-001@V1, D-004@V1]
allowed_paths:
  - backend/app/modules/spec_workspace/service.py
provides: []
expects_from:
  task-01:
    - contract: HostFsDelegate
      needs: [stat, read_file, list_dir]
goal: >
  把 import_from_repo 与 import_from_repo_sse 中两处并列的 path_source 分流内聚到 HostFsDelegate（stat/read_file/list_dir 三原语），重构后宿主侧 .sillyspec 目录的存在性判断、遍历、读取统一走 delegate，backend 容器不再裸调 Path(server_path)，service.py 内不再散落 path_source if。
implementation:
  - "核实 service.py 仅 229/372 两处 path_source 分流（grep 已确认无第三处），import_from_repo 与 _sse 同构共用前置+落盘"
  - "server-local 分支原语化：Path(server_path)/.sillyspec→is_dir→rglob→tarfile.open 替换为 HostFsDelegate.stat/list_dir/read_file，tar 组装仍留在 backend 容器内"
  - "分流内聚：构造 delegate = HostFsDelegate.for_workspace(...)，两处 if 折叠为 delegate 单调用，resolve_root_path_for_* 下沉到 delegate"
  - "daemon-client 分支不动协议：get_spec_bundle 整树打包 RPC 作为 delegate 内部分流保留，错误码透传链与四个 AppError code 原样搬迁"
  - "_sse keepalive 模式不动：asyncio.ensure_future + wait({rpc_task}, timeout=5.0) + yield keepalive 循环保持原样，delegate 调用为普通 await"
  - "logging 不变：spec_workspace.import_from_repo 日志条目字段（spec_workspace_id/workspace_id/path_source/tar_bytes/reparsed）保留"
acceptance:
  - "daemon-client workspace 调 import_from_repo 经 HostFsDelegate → get_spec_bundle RPC → apply_sync 落盘，spec_workspace.test_import_from_repo_daemon_client* 零回归"
  - "server-local workspace 调 import_from_repo 经 HostFsDelegate → stat/list_dir/read_file 本地容器分支 → tar 组装 → apply_sync，test_import_from_repo_server_local* 零回归"
  - "import_from_repo_sse 6 阶段事件序列 + 错误事件透传 + 每 5s keepalive 注释行全部不变，现有 SSE 测试零回归"
  - "grep path_source service.py 仅剩日志/注释引用（业务分流 if 下沉 delegate），grep resolve_root_path_for service.py 无残留"
  - "daemon-client 模式下 backend 容器不出现 Path(server_path) / spec_source.is_dir() / rglob 调用（NFR-03 容器零宿主访问）"
verify:
  - "cd backend && uv run pytest app/modules/spec_workspace/ -q"
  - "grep -rn \"path_source != ['\\\"]daemon-client['\\\"]\" backend/app（应无散落 if 残留）"
  - "grep -n Path(server_path) backend/app/modules/spec_workspace/service.py（应无宿主路径裸访问）"
constraints:
  - "_sse keepalive / asyncio.ensure_future 模式不动（ql-20260706-003 修过 Next.js rewrite proxy idle timeout，回归红线）"
  - "零回归：仅重构宿主访问 + 分流内聚，不改 import/apply_sync/reparse 业务语义、错误码体系、SSE 事件协议、日志字段"
  - "仅改 backend/app/modules/spec_workspace/service.py 单文件（allowed_paths 收口），HostFsDelegate 抽象/host_fs handler/ws_rpc 在 task-01/02/03 实现"
  - "server-local 模式行为不变（D-004）：本地容器分支 stat/read/list 用 Path 直读不走 WS RPC"
  - "daemon-client 分支 get_spec_bundle 整树打包 RPC 是已落地能力，不替换为逐文件 read_file 重新打包以避免协议变更和回归面扩大"
  - "brownfield 兼容：sync_manual_server_local（service.py:513）随动零回归，无需单独改"
---

## goal

把 `SpecWorkspaceService.import_from_repo`（service.py:180）与 `import_from_repo_sse`（service.py:331）中两处并列的 `if ws_path_source == "daemon-client" ... else ...` 分流，内聚到 task-01 提供的 `HostFsDelegate`（stat/read_file/list_dir 三原语）。重构后宿主侧 `.sillyspec` 目录的存在性判断（`is_dir`）、遍历（`rglob`）、读取（`tar.add`）统一走 delegate，backend 容器不再裸调 `Path(server_path)` 也不在 `service.py` 内散落 `path_source` if。daemon-client 分支现有的 `hub.send_rpc("get_spec_bundle")` 整树打包 RPC 路径是已落地的等价能力，本 task 不改其协议，仅作为 daemon-client 模式 HostFsDelegate 内部分流保留（D-004 server-local 走本地容器原语，行为不变）。

## implementation

1. **调用点核实**：本文件仅 service.py:229 / 372 两处 `if ws_path_source == "daemon-client"`（grep `path_source` 已确认，无第三处）。import_from_repo（229）与 _sse（372）共用前置 + 落盘，分流结构同构。
2. **server-local 分支原语化**：把 `Path(server_path) / ".sillyspec"` → `is_dir()` → `rglob("*")` → `tarfile.open` 这串容器内宿主访问，替换为 `HostFsDelegate`：
   - `stat(workspace, ".sillyspec")` 判 `is_dir`（替代 `spec_source.is_dir()`，service.py:306/440）；
   - `list_dir(workspace, ".sillyspec", recursive=True)` 取条目（替代 `rglob("*")`，service.py:314/449，注意排除 `.runtime` 段的逻辑保留在 backend 侧，不依赖 daemon 知道 `.runtime` 语义）；
   - `read_file(workspace, rel)` 逐文件读字节（替代 `tar.add(str(path), ...)`，service.py:318/453）；
   - tar 打包动作仍在 backend 容器内完成（用 delegate 取回的字节流组装 tar），不新增"daemon 打包"RPC（保留现有 `get_spec_bundle` 作为 daemon-client 模式 delegate 内部分流）。
3. **分流内聚**：在 service.py 顶部或方法内构造一次 `delegate = HostFsDelegate.for_workspace(ws, session=self._session, ws_hub=get_daemon_ws_hub())`，两处 `if` 折叠为 delegate 单调用；`resolve_root_path_for_server` / `resolve_root_path_for_daemon` 的路径解析下沉到 delegate 内部（service.py 不再 import）。
4. **daemon-client 分支不动协议**：`hub.send_rpc(ws_daemon_id, "get_spec_bundle", {"root_path": daemon_root}, timeout=60.0)`（service.py:249/388）作为 HostFsDelegate daemon-client 分支的实现细节保留，错误码透传链（DaemonRuntimeOffline/DaemonRpcTimeout/DaemonRpcConflict 透传 + DaemonRpcRemoteError 重映射 forbidden→403 / 其他→502，service.py:255-275）原样搬到 delegate。`SPEC_IMPORT_RPC_FAILED` / `SPEC_IMPORT_EMPTY_BUNDLE` / `SPEC_IMPORT_PATH_UNRESOLVED` / `SPEC_IMPORT_NO_SILLYSPEC_DIR` 四个 AppError code 不变。
5. **_sse keepalive 模式不动**：`asyncio.ensure_future` + `asyncio.wait({rpc_task}, timeout=5.0)` + `yield ": keepalive\n\n"` 循环（service.py:387-400 / 462-491）保持原样（ql-20260706-003 修过 idle timeout，回归红线）。delegate 调用是普通 await，不破坏 SSE 生成器的协程结构；若 delegate 内部仍需长 RPC，keepalive 由 _sse 外层循环包住（与现状同）。
6. **logging 不变**：`spec_workspace.import_from_repo` 日志条目（service.py:285/321）字段（spec_workspace_id/workspace_id/path_source/tar_bytes/reparsed）保留。

## 验收标准

- daemon-client workspace 调 import_from_repo：经 HostFsDelegate → 内部 `get_spec_bundle` RPC → apply_sync 落盘，行为与重构前一致（`spec_workspace.test_import_from_repo_daemon_client*` 系列测试零回归）。
- server-local workspace 调 import_from_repo：经 HostFsDelegate → stat/list_dir/read_file 原语本地容器分支 → tar 组装 → apply_sync，行为一致（`spec_workspace.test_import_from_repo_server_local*` 零回归）。
- `import_from_repo_sse` 6 阶段事件序列（packing→packed→applying→reparsing_docs→reparsing_changes→done）+ 错误事件（code/message 透传）+ 每 5s keepalive 注释行全部不变；现有 SSE 测试零回归。
- `grep -n "path_source" backend/app/modules/spec_workspace/service.py` 仅剩日志/注释引用（业务分流 if 消失，下沉 delegate）；`grep -n "resolve_root_path_for" backend/app/modules/spec_workspace/service.py` 无残留（下沉 delegate）。
- daemon-client 模式下 backend 容器不出现 `Path(server_path)` / `spec_source.is_dir()` / `rglob` 调用（NFR-03 容器零宿主访问）。

## verify

```bash
cd backend && uv run pytest app/modules/spec_workspace/ -q
```

附加 grep 验证（全局验收 NFR-03 条目）：

```bash
grep -rn "path_source != ['\"]daemon-client['\"]" backend/app   # 应无散落 if 残留
grep -n  "Path(server_path)" backend/app/modules/spec_workspace/service.py  # 应无宿主路径裸访问
```

## constraints

- **_sse keepalive / asyncio.ensure_future 模式不动**（ql-20260706-003 修过 Next.js rewrite proxy idle timeout，回归红线）；delegate 调用是 await，不替换 ensure_future/wait 循环结构。
- **零回归**：仅重构宿主访问 + 分流内聚，不改 import/apply_sync/reparse 的业务语义、错误码体系、SSE 事件协议、日志字段。
- **仅改 backend/app/modules/spec_workspace/service.py 单文件**（allowed_paths 收口）；HostFsDelegate 抽象本身、daemon host_fs handler、ws_rpc 在 task-01/02/03 实现，本 task 只消费 `stat/read_file/list_dir` 三原语 + 现有 `get_spec_bundle` RPC 透传。
- **server-local 模式行为不变**（D-004）：本地容器分支 stat/read/list 用 `Path` 直读，不走 WS RPC；与 daemon-client 分支的差异收敛在 delegate 内部，service.py 层无 if。
- daemon-client 分支的 `get_spec_bundle` 整树打包 RPC 是已落地能力（2026-06-30 实现），本 task 不替换为"逐文件 read_file RPC 重新打包"——避免无谓协议变更和回归面扩大；read_file/list_dir 原语服务 server-local 分支的统一抽象，daemon-client 仍走打包 RPC。
- **brownfield 兼容**：`sync_manual_server_local`（service.py:513，复用 import_from_repo）随动零回归，无需单独改。
