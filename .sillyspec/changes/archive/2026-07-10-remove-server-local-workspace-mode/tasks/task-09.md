---
id: task-09
title: daemon run_sync/runtime + knowledge + scan_docs 删 path_source/daemon_runtime_id
title_zh: daemon run_sync/runtime + knowledge + scan_docs 删除 path_source/daemon_runtime_id 分流
author: qinyi
created_at: 2026-07-10 23:45:39
priority: P0
depends_on: [task-05]
blocks: [task-13]
requirement_ids: [FR-2, FR-5]
decision_ids: [D-003, D-007]
allowed_paths:
  - backend/app/modules/daemon/run_sync/service.py
  - backend/app/modules/daemon/runtime/service.py
  - backend/app/modules/knowledge/service.py
  - backend/app/modules/scan_docs/service.py
  - backend/app/modules/daemon/lease/context.py  # Step2 符号扫描补漏（3处 resolve_root_path_for_daemon + transport_for_path_source）
  - backend/app/modules/daemon/lease/service.py  # Wave3 补漏（complete_lease path_source 解析+透传）
  - backend/app/modules/daemon/service.py  # Wave3 补漏（facade _apply_patch_to_worktree path_source 透传）
---

## goal

删除 daemon/run_sync/service、daemon/runtime/service、knowledge/service、scan_docs/service 四个文件中残留的 `path_source` 分流与 `daemon_runtime_id` legacy 引用，使所有工作区强制走单一 daemon-client 路径。其中 daemon/runtime/service.py:724-731 的 `UPDATE workspaces SET daemon_runtime_id=None` 是 DROP 列后 100% 运行时崩溃的 P0 阻断点，必须删除。

## implementation

### 1. daemon/runtime/service.py（P0 阻断点，D-007 P0-4）

删除 `delete_runtime` 方法中 line 719-731 的 legacy 清理块：注释段（解释 legacy `workspaces.daemon_runtime_id` 列）+ `update(Workspace).where(col(Workspace.daemon_runtime_id) == runtime_id, ...).values(daemon_runtime_id=None)` 整段 SQL。删除后保留 `await self._session.delete(runtime)` + `commit()`。列 DROP 后此 UPDATE 必触发 `UndefinedColumn`/`AttributeError`，属 D-007 P0-4 必删项。同步删 `Workspace` 顶部 import 若仅此处引用（否则保留）。注意：上面 in-flight RESTRICT 检查（inflight_leases/inflight_writes）属 daemon-entity-binding 正交逻辑，保留不删。**另：line 82 `is_daemon_client = is_daemon_client_path_source(workspace.path_source)` 删**（is_daemon_client_path_source 函数 task-03 删后断链），`is_daemon_client` 局部变量改为永远 True 或按调用方调整（grep `is_daemon_client` 在本文件下游使用点同步）。

### 2. daemon/run_sync/service.py（line 1428-1454，D-003 边界属本次）

`_trigger_post_scan_validation`（或同类回调）中：
- 删 line 1428-1430 注释段（task-07 daemon-client 分流说明 + server-local 兜底说明）。
- 删 line 1431-1444 整个 `if path_source == "daemon-client" and self._facade is not None:` 分流块（delegate/workspace 解析仅在 daemon-client 分支执行）。改为无条件解析 delegate + workspace（复用 task-05 已固定的 `_via_rpc_or_degrade` 路径），异常仍按现 warning 降级到 delegate=None。
- 删 line 1452 `path_source=path_source or "server-local"`（PostScanValidator 入参），PostScanValidator 在 task-06 已删 path_source 参数，此处直接去掉关键字参数；workspace 参数保留透传。
- 函数签名中 `path_source` 形参若仅用于此分支，一并清除（调用方同步改）；若调用方仍传则忽略。

**D-003 边界**：本次只删此 path_source 分流；complete_lease 收尾侧 apply_patch 500 / post_scan_validation 容器越界 / stage_callback 3 处 bug 属独立 container-overreach 变更，不在本任务范围。

### 3. knowledge/service.py（line 12, 32-46）

- line 12：删 `is_daemon_client_path_source` import（workspace.service 已删该函数，task-03）。
- line 32-46：`_spec_content_root` 删 `if is_daemon_client_path_source(workspace.path_source):` 分支判断。统一走 daemon-client 逻辑：永远尝试读 SpecWorkspaceService 的 `spec_root`（platform-managed 扁平布局），失败兜底 `Path(workspace.root_path) / ".sillyspec"`。docstring 删除 server-local / repo-native 描述。

### 4. scan_docs/service.py（line 156-168）

`reparse` 方法：删 line 164-168 `is_daemon_client_path_source` import + `platform_managed = is_daemon_client_path_source(workspace.path_source)` 赋值。`platform_managed` 永远为 True（daemon-client 扁平布局），删变量后 `parse_docs_tree(sillyspec_root, platform_managed=True)` / `parse_component(..., platform_managed=True)` 直接传 True。line 156 初始值 `platform_managed = False` 同步删。注释段（D-005@v1 mode 看 path_source）一并清理。

### 5. daemon/lease/context.py（Step2 符号扫描补漏）

- **line 20/24 import**：`transport_for_path_source`（task-07 改/删后适配）+ `resolve_root_path_for_daemon`（task-03 改单参后调用同步）。
- **line 126-137 path_source 读取**：删 `path_source: str | None = None`(133) + `path_source = ws_row.path_source`(137)——workspace 永远 daemon-client。
- **line 165 `resolve_root_path_for_daemon(payload["root_path"], path_source)`**：改单参 `resolve_root_path_for_daemon(payload["root_path"])`。
- **line 168-169 `transport_for_path_source(path_source)`**：与 task-07 协同——task-07 重构 transport helper 后改用 `settings.spec_transport` 或 task-07 提供的 daemon-client 单一 transport 函数。
- **line 246 `resolve_root_path_for_daemon(_init_root, _ws_row.path_source)`**：改单参。
- **line 331-338 `ws_path_source` + `resolve_root_path_for_daemon(lease_meta["root_path"], ws_path_source)`**：删 ws_path_source 读取(332-336) + resolve_root_path_for_daemon 改单参(338)；注释 331 清理。

## 验收标准

- 四文件 grep `path_source` / `server-local` / `daemon_runtime_id` / `is_daemon_client_path_source` 清零（注释文案同步清理）。
- daemon/runtime/service.py 不再有任何 `Workspace.daemon_runtime_id` 引用。
- PostScanValidator 调用不再透传 `path_source` 关键字（与 task-06 签名一致）。
- 无 import 残留死符号（is_daemon_client_path_source 删后 knowledge/scan_docs 不再 import）。
- 不误删 in-flight RESTRICT 检查（daemon-entity-binding 正交逻辑保留）。
- 不触碰 complete_lease 侧 3 处容器越界 bug（D-003 边界）。

## verify

```
cd backend && uv run pytest app/modules/daemon/run_sync app/modules/daemon/runtime app/modules/knowledge app/modules/scan_docs -q && uv run mypy
```

补：grep 确认清零——`grep -rn "path_source\|server-local\|daemon_runtime_id\|is_daemon_client_path_source" app/modules/daemon/run_sync/service.py app/modules/daemon/runtime/service.py app/modules/knowledge/service.py app/modules/scan_docs/service.py`（仅允许 docstring 历史档引用，运行时代码零容忍）。

## constraints

- runtime:724-731 是 P0 阻断点，DROP `daemon_runtime_id` 列后此 UPDATE 100% 崩（PG UndefinedColumn / SQLite OperationalError），必须删，不删则 task-02 迁移 apply 后所有 daemon runtime 删除请求 500。
- D-003 边界严守：run_sync path_source 分流属本次必删（断链）；complete_lease 侧 3 处容器越界 bug 不在范围。
- daemon-client 离线复用 task-05 的 `_via_rpc_or_degrade` 降级（D-002），不新引入异常路径。
- `_spec_content_root` 统一走 spec_root 后仍保留 try/except 兜底（spec_workspace 无数据时回退 root_path/.sillyspec，零回归）。
- 只改 allowed_paths 四文件，不跨模块（agent/post_scan_validator 在 task-06，workspace/service 在 task-03）。
