---
id: task-03
title: Remove server-local branching from workspace service/router/skills_view/member_runtimes
title_zh: workspace service+router+skills_view_service+member_runtimes 删 server-local 分流 + daemon_runtime_id 引用 + scan_generate 两步重命名
author: qinyi
created_at: 2026-07-10 23:45:39
priority: P0
depends_on: [task-01]
blocks: [task-08, task-13]
requirement_ids: [FR-1, FR-2, FR-5]
decision_ids: [D-001, D-007]
allowed_paths:
  - backend/app/modules/workspace/service.py
  - backend/app/modules/workspace/router.py
  - backend/app/modules/workspace/skills_view_service.py
  - backend/app/modules/workspace/member_runtimes/resolver.py
  - backend/app/modules/workspace/member_runtimes/queries.py
---

## goal

删除 workspace 模块 5 个文件里所有 `path_source` 分流、`server-local` 本地分支与 `daemon_runtime_id` legacy 引用，把 daemon-client 收为唯一路径。落地 design §5 Phase 1（workspace service/router/skills_view_service/member_runtimes 子集）+ §7 接口契约（scan_generate 两步重命名）。

## implementation

### service.py（主战场）

1. **删 3 个模块级辅助**：`is_daemon_client_path_source`(74-76) / `resolve_root_path_for_server`(79-90) / `resolve_root_path_for_daemon`(93-126) 中针对 server-local 的分支。`is_daemon_client_path_source` 被 skills_view_service 与多模块 import——删前先 grep 调用方：`HostFsDelegate` / `agent/*` 等跨模块引用在 task-05/06 同 Wave 处理，本任务只删 workspace 模块内引用。`resolve_root_path_for_daemon` 被 `agent/execution.py:110` 调用（task-06 修签名），本任务保留函数但删 path_source 参数与 server-local 分支（改单值返回 root_path）。**注意**：若 task-05/06 仍 import `is_daemon_client_path_source`，需协调——按 design §6 该函数属本文件删除，跨模块引用由调用方 Wave 自行重写（永远走 daemon-client 不再分流）。
2. **`create`(147-314)**：删 `if self._is_daemon_client_payload(payload)`(181) 的 if/else 分流，把 daemon-client 分支(183-246) 的 body 提为唯一路径；删 server-local 本地扫描分支(248-314) 全部代码。删 `path_source="daemon-client"`(193) 与 `daemon_runtime_id=payload.daemon_runtime_id`(194) 两行赋值（task-01 已删 model 列）。`_resurrect_soft_deleted`(316-388) 内同步删 `if self._is_daemon_client_payload` 分支(371-378)，server-local 扫描分支(375-378) 删除。
3. **`list_with_owner`(390-476)**：删 `workspace_type` 过滤里 `if workspace_type in ("server-local","daemon-client"): filters.append(col(Workspace.path_source)==...)`(453-457)，保留 `else: col(Workspace.type)==workspace_type` 唯一分支（design FR-1 / R-06：前端筛选项已删 server-local option，后端忽略未知值）。
4. **`scan_generate` 两步重命名**（design §7）：
   - 删现有 `scan_generate`(692-851，server-local 本地版) 整个方法。
   - 将 `scan_generate_daemon_client`(853-946) **改名为 `scan_generate`** 作为唯一入口。
   - 改名后删 `path_source="daemon-client"`(892) / `daemon_runtime_id=daemon_runtime_id`(893) 两行；签名参数 `daemon_runtime_id`(863) 与 log 里 `daemon_runtime_id=str(daemon_runtime_id)`(944) 一并删（task-01 schema 已删字段）。
5. **`_is_daemon_client_payload`(948-956)**：删整个 staticmethod（无 server-local 后无需判分流）。注意 grep 跨模块引用（router.py:129/171 等）需同步改。
6. **`rescan`(489-529) / `activate`(1101-1123) / `_ensure_spec_workspace_from_platform`(1127-1160)**：删三处 `if workspace.path_source == "daemon-client"` 分流的 else 分支，保留 daemon-client 路径为唯一（rescan:498-513 简化为永远 `scan_path = spec_ws.spec_root`；activate:1113-1118 永远走 `_ensure_empty_spec_workspace`；_ensure_spec_workspace_from_platform:1157-1160 永远 return / 跳过本地扫描）。

### router.py

7. **删 `_require_server_local_workspace_admin`(55-72)** 整个函数。
8. **删 3 处调用 + 分流**：
   - `scan_workspace`(107-115)：删 `await _require_server_local_workspace_admin(session, user)`(113)。
   - `scan_generate`(118-158)：删 daemon-client if 分支(128-146) 整块 + `await _require_server_local_workspace_admin`(147) + 旧 server-local `service.scan_generate` 调用(148-154)，改为直接调改名后的 `service.scan_generate`（daemon-client 唯一入口），删 `daemon_id`/`daemon_runtime_id`(140-141) 入参透传（schema 已删字段，payload 改用顶层字段）。
   - `create_workspace`(166-175)：删 `if payload.path_source != "daemon-client"`(171) + 调用(172)。
9. **`workspace:admin` 权限枚举保留**（D-001）：`Permission.WORKSPACE_ADMIN` 在 `permissions.py:53` 与前端菜单 `menu-permissions.ts:72` 不动，仅删运行时门禁函数。删除 router 顶部的 `PermissionDenied` / `has_permission` import 若变为未使用。

### skills_view_service.py

10. **删 server-local 平铺列目录分支**：
    - `list_skills`(136-173)：删 `if is_daemon_client_path_source(ws.path_source)`(153) 的 else 分支(155-156 本地 `skills_dir.iterdir()`)，保留 RPC `delegate.list_dir` 唯一路径；内层 skill 分支(162-170) 同步删 else(167-170 `_list_files_local`)，保留 `_list_files_rpc`。
    - `get_mcp_config`(175-217)：删 else 分支(197-203 本地 `mcp_path.is_file()` / `read_text`)，保留 RPC `delegate.stat`/`read_file` 唯一路径。
    - `_resolver_for`(75-110)：删 `is_daemon_client` 判定(93) 与 `elif spec_ws.strategy != "repo-native"`(100)/`elif workspace.root_path`(102) 的 server-local 分支，固定走 daemon-client 分支（root = spec_ws.spec_root，platform_managed=True）。
    - **删 import**：`is_daemon_client_path_source`(33) 从 service import 移除；`_list_files_local`(221-236) 整个 staticmethod 删除（无调用方）。`_make_host_fs_delegate` docstring 里"server-local 分支用"文案清理。

### member_runtimes/resolver.py

11. **`resolve_runtime_for_writeback`(59-205)**：删 Step 2 legacy fallback 段(152-205) 全部——含 `SELECT path_source, daemon_runtime_id FROM workspaces`(160)、`path_source != "daemon-client"` 兜底报错(174-179 `_raise_no_session reason="not_daemon_client"`)、`daemon_runtime_id` 解析与 `_query_online_runtime_by_id` 调用(181-205)。无 binding 行时直接 `_raise_no_session(reason="not_bound")`（design D-005：daemon_runtime_id legacy 清除，不再回退）。
12. **删 `_query_online_runtime_by_id`(208-238)** 整个辅助函数（仅 Step 2 调用，随之死代码）。更新 docstring(63-83) 去除"Step 2 legacy fallback"描述。

### member_runtimes/queries.py

13. **`resolve_daemon_instance_for_workspace`(115-188)**：删 Step 2 legacy fallback 段(163-179)——`JOIN daemon_runtimes dr ON dr.id = w.daemon_runtime_id`(167-172) 整块删除。保留 Step 1 member binding 查询为唯一来源；更新 docstring(119-143) 去除"legacy 回退"段，无 binding 返 None。

## 验收标准

- `is_daemon_client_path_source` / `resolve_root_path_for_server` / `_is_daemon_client_payload` / `_require_server_local_workspace_admin` / `_list_files_local` / `_query_online_runtime_by_id` 6 个符号在本 5 文件内 grep 零命中。
- `scan_generate` 是 service 唯一 scan-generate 入口（`scan_generate_daemon_client` 已改名消失）。
- `path_source` / `daemon_runtime_id` 字面量在本 5 文件 grep 零命中（注释除外，应一并清理）。
- `workspace:admin` 权限枚举与菜单绑定未被触碰（D-001）。
- router 的 scan/scan-generate/create 三端点不再有任何 server-local 分流或本地路径校验。

## verify

```bash
cd backend && uv run pytest app/modules/workspace -q
cd backend && uv run mypy app/modules/workspace
```

额外：`grep -rn "is_daemon_client_path_source\|resolve_root_path_for_server\|_is_daemon_client_payload\|_require_server_local_workspace_admin" backend/app/modules/workspace` 应零命中。跨模块引用（HostFsDelegate/agent/spec_workspace 等）由 task-04/05/06/07 同 Wave 处理，本任务不负责但 mypy 会暴露跨文件 import 断链——若 mypy 报跨模块 `is_daemon_client_path_source` 未定义，说明调用方 task 尚未完成，按依赖顺序（task-01 已完成 → task-03）本任务先落地，跨模块断链在对应 task 修。

## constraints

- **不删** `workspace:admin` 权限枚举 / 菜单绑定 / 角色赋权（D-001，仅删运行时门禁函数）。
- **不动** `daemon_runtime_id` model 列本身（task-01 已删 model + ix 索引）；本任务只删 service/router/resolver/queries 里对该列的**代码引用**。
- **不改** daemon 生命周期事件契约（claim/start/complete lease、session create/end）——design §7.5 声明现有契约不变。
- **scan_generate 改名后**调用方（router scan_generate 端点）参数透传需同步调整：daemon-client 唯一入口后不再传 `daemon_runtime_id`，daemon_id 仍传（stable 绑定键，task-10/11 补遗）。
- **`_rewrite_path`(50-71)** 保留——server-local 删除后该函数仍用于 host_path_prefix/container_path_prefix 容器路径改写（非 path_source 分流），不属本次范围。
- 改 router 必须跑 `test_router`（不只 test_service）——参见 memory「backend-router-change-run-router-tests」：router 参数顺序 SyntaxError 重建容器才暴露。
