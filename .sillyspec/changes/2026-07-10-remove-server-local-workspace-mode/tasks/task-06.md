---
id: task-06
title: Remove agent module server-local branches + daemon_runtime_id legacy routing + signature breakage
title_zh: agent 模块删 server-local 兜底+daemon_runtime_id legacy 路由+path_source 签名断链修复（placement/service/post_scan_validator/context_builder/execution）
author: qinyi
created_at: 2026-07-10 23:45:39
priority: P0
depends_on: [task-01]
blocks: [task-13]
requirement_ids: [FR-2, FR-5]
decision_ids: [D-005, D-007]
allowed_paths:
  - backend/app/modules/agent/placement.py
  - backend/app/modules/agent/service.py
  - backend/app/modules/agent/post_scan_validator.py
  - backend/app/modules/agent/context_builder.py
  - backend/app/modules/agent/execution.py
  - backend/app/modules/agent/router.py  # Step2 符号扫描补漏（build_scan_bundle+resolve_root_path_for_daemon 调用点）
---

## goal

清除 agent 模块全链路的 server-local 分流 + `daemon_runtime_id` legacy 路由 + task-01 DROP
`path_source` 列后的签名断链。这是 design §5 Phase 2 agent 重灾区（首版严重低估，D-007 P1-3 修正）：
五个文件十余处 `workspace.path_source` / `daemon_runtime_id` 读取，DROP 两列后全部 `AttributeError` 或
断链。覆盖 FR-2（path_source 分流全删）/ FR-5（daemon_runtime_id 清除）/ R-07（agent 调度行为零回归）。

> **与 task-07 边界**：context_builder.py 的 `transport_for_path_source`(328) / `resolve_prompt_spec_root`(352) /
> `build_scan_bundle`(404) 三函数的 transport 决策重构由 **task-07** 主导。本任务只动 context_builder.py 中
> **非 transport helper** 的 path_source 残留（`build_scan_bundle` 签名删 path_source 入参那一行协同 task-07，
> 不重复改 transport helper 内部）。execute 阶段两任务同 Wave 2，按行号去重避免冲突。

## implementation

### A. placement.py（backend/app/modules/agent/placement.py）

**A1. `_resolve_dispatch_runtime`(704-891) 删 server-local 兜底 + daemon_runtime_id legacy**：
1. **Branch 0**(735-737)：删 `if workspace_id is None: return await self._get_online_runtime(...)` 整块——
   workspace_id is None 的 server-local 兼容路径（task-03 后 workspace 永远 daemon-client，dispatch 必带 ws_id；
   若确无 ws 上下文应由上层 decide_backend 抛 NoOnlineDaemonError，不再静默走 user 级 fallback）。
2. **Branch 2**(820-846)：删 ws_row 查询的 `SELECT path_source, daemon_runtime_id` + `if path_source !=
   "daemon-client": return ...` server-local 分支 + `if not daemon_runtime_id: raise ...` legacy 数据异常分支
   + Branch 4(848-891) `daemon_runtime_id` 路由整段。无 binding 行的 fallback 现改为：直接抛
   `NoOnlineDaemonError(workspace_id=..., message="工作区未绑定守护进程")`——daemon-client 单一模式下无
   binding 行即未绑定，不再回退全局列。
3. docstring(711-733) 同步删 "server-local compatibility path" / "fall back to legacy Workspace.daemon_runtime_id"
   / "path_source != 'daemon-client' → server-local behavior unchanged" 三段描述。

**A2. `_resolve_decide_runtime`(969-1110) 同构清理**：
4. ws_row 查询(1058-1069) 的 `SELECT path_source, daemon_runtime_id` 改为不查（或删整段 fallback）；
   `if ws_row is None or ws_row["path_source"] != "daemon-client": return _DECIDE_FALLBACK_SENTINEL`(1078) 改为
   binding is None 即抛 NoOnlineDaemonError（与 A1 #2 对齐）。
5. Branch daemon_runtime_id 路由(1081-1110) 删整段；`_DECIDE_FALLBACK_SENTINEL`(29) 若无残留引用则连同
   decide_backend 里的 `if bound_rt is _DECIDE_FALLBACK_SENTINEL: has_runtime = ...` 分支(138-149) 一并删
   （server-local workspace 不再存在，fallback sentinel 失去语义）。

**A3. `decide_backend`(95-157)**：清理 fallback 分支(138-149) 后，`has_runtime = await self._has_online_runtime(user_id)`
   的 user 级在线判定若无其他调用方则保留 `_has_online_runtime` helper 不动（prepare_interactive_dispatch
   经 `_get_online_runtime` 另走路径，不碰）。

### B. service.py（backend/app/modules/agent/service.py）— 重灾区

**B1. `_legacy_root_exists_check`(247-259) 删整个函数**：该函数是 path_source 分流的字面封装
（`if is_daemon_client_path_source(path_source): return False; return not Path(...).exists()`），单一 daemon-client
模式后 production caller 一律注入 delegate（`resolve_work_dir` 的 `delegate.stat` 分支），legacy 兜底无存在意义。
**B2. `resolve_work_dir`(262-344)**：签名删 `path_source: str | None = None`(270)；删 line 320-327 的
`elif _legacy_root_exists_check(workspace_root, path_source): raise ...` 分支（delegate=None 单测兜底路径）。
保留 `delegate` + `workspace` 入参与 line 313-319 的 delegate.stat 校验（daemon-client 核心链路，R-07 零回归）。
docstring(274-306) 删 path_source 段落。
**B3. line 36 import 删 `is_daemon_client_path_source`**（B1 删后无调用方）。
**B4. `_get_workspace_root`(1811-1827) 改签名**：返回类型 `tuple[str, str]` → `str`，函数体末行
`return workspace.root_path, workspace.path_source` 改为 `return workspace.root_path`。docstring 删 path_source
段落。grep 调用方：当前 service.py 内 `_get_workspace_root` 无内部调用者（全部已切 `_get_workspace`），若全模块
无调用方则可一并删函数（grep 核实，外部模块若引用则保留单值签名）。
**B5. stage prompt `--spec-root` 决策(1095-1136)**：删 `stage_ws = await self._session.get(Workspace, workspace_id)`(1126)
   + `stage_path_source = stage_ws.path_source if stage_ws else None`(1127)，`resolve_prompt_spec_root` 调用(1128-1130)
   删 `path_source=stage_path_source` 实参（task-07 改 helper 签名后单参 `resolve_prompt_spec_root(str(workspace_id),
   settings)`）。删注释 1114-1125 path_source 决策段。
**B6. stage dispatch `path_source = workspace.path_source`(1052) + `resolve_work_dir(path_source=...)`(1073) 删**：
   签名删后调用方去实参（B2 配合）。
**B7. scan dispatch `path_source = workspace.path_source if workspace else "server-local"`(1372)**：改为不取
   path_source（workspace 永远 daemon-client）；若 workspace is None 应在更上层抛错（核实调用方）。
**B8. `resolve_root_path_for_server` import + 调用(1411-1413)**：删 `from app.modules.workspace.service import
   resolve_root_path_for_server` + `server_path = resolve_root_path_for_server(root_path, path_source)`。`server_path`
   仅用于错误 details(1419)，改为 details 用 `root_path` 本身或删 server_path 键（task-03 删 workspace service
   的 resolve_root_path_for_server 定义后 import 必断链）。
**B9. `build_scan_bundle` 调用(1466-1475)**：删 `path_source=path_source`(1474) 实参（task-07 改 build_scan_bundle
   签名后无此参数）。

### C. post_scan_validator.py（backend/app/modules/agent/post_scan_validator.py）

**C1. `__init__`(486-522)**：删 `path_source: str = "server-local"`(494) 入参 + `self.path_source = path_source`(521)
   赋值。docstring 删 path_source 分支描述（504-515）。`workspace` 入参保留（daemon-client delegate 必需）。
**C2. `validate`(524-545)**：删 `if self._is_daemon_client(): return await self._validate_daemon_client(...)`
   分支头(543-544) + `return await asyncio.to_thread(self._validate_server_local, ...)`(545)，方法体直接
   `return await self._validate_daemon_client(agent_output, agent_exit_code)`。
**C3. `_is_daemon_client`(547-552) 删整个方法**（validate 已无分支）。
**C4. `_validate_server_local`(554-643) 删整个方法**：server-local 原生 subprocess/shutil 实现整块删除。
   （注意：`_get_source_commit` / `_archive_and_clean_pollution` / `_check_source_pollution` 等模块级 helper
   若仅被 _validate_server_local 调用则一并删；若被 _validate_daemon_client 的 `asyncio.to_thread` 包装调用
   则保留——grep 核实。`_check_log_patterns` / `_check_output_paths` / `_check_manifest_exists` /
   `_determine_status` 被 daemon-client 分支复用，保留。）
**C5. `_validate_daemon_client`(691-806)**：保留（daemon-client 唯一路径）。删 `metadata["path_source"] =
   "daemon-client"`(787) + log `path_source="daemon-client"`(803) 字面量；docstring(696-710) 删 "server-local
   字节级不变" 类比（无对照）。

### D. context_builder.py（backend/app/modules/agent/context_builder.py）— 仅非 transport helper

**D1. `build_scan_bundle`(404-468) 签名删 `path_source: str | None = None`(412)**（与 task-07 协同，task-07
   负责函数体内 `resolve_prompt_spec_root` / `resolve_root_path_for_daemon` 调用的 path_source 实参删）。
   本任务只删签名入参 + docstring(413-435) 的 path_source 段。
**D2. 不碰** `transport_for_path_source`(328) / `resolve_prompt_spec_root`(352)（task-07 主导）。

### E. execution.py（backend/app/modules/agent/execution.py）

**E1. line 109-113 `resolve_root_path_for_daemon(ws.root_path, ws.path_source)` 签名断链**：task-03 改
   `resolve_root_path_for_daemon` 签名为单参（删 path_source）后此处必断链。改为
   `resolve_root_path_for_daemon(ws.root_path)`。import(38) 不变（函数名未改）。

### F. router.py（backend/app/modules/agent/router.py）— Step2 符号扫描补漏

**F1. line 226-236 `build_scan_bundle` 调用**：删 `path_source=ws_row.path_source if ws_row else None`(236) 实参（task-07 改 build_scan_bundle 签名后无此参数）。
**F2. line 263-270 path_source 分支**：删 `path_source = ws_row.path_source if ws_row else "server-local"`(268) + `if path_source == "daemon-client":`(270) 分支头；spec_root 赋值永远走 daemon-client 分支（task-07 resolve_prompt_spec_root 改单参后直接调）。
**F3. line 298 `resolve_root_path_for_daemon(ws_row.root_path, ws_row.path_source)`**：改单参 `resolve_root_path_for_daemon(ws_row.root_path)`（task-03 签名）。
**F4. 注释清理**：233/263/267/301 path_source 决策注释删。

## 验收标准

- placement.py 不再含 `workspace.path_source` / `daemon_runtime_id` / `_DECIDE_FALLBACK_SENTINEL` 读取
  （grep `path_source|daemon_runtime_id|_DECIDE_FALLBACK_SENTINEL` 零命中含 docstring）。
- placement.py 的 `_resolve_dispatch_runtime` / `_resolve_decide_runtime` 无 binding 行时抛
  NoOnlineDaemonError（不再回退 user 级 _get_online_runtime / 全局 daemon_runtime_id 列）。
- service.py 不再含 `_legacy_root_exists_check` 定义与调用；`resolve_work_dir` 签名无 `path_source`。
- service.py `_get_workspace_root` 返回 `str`（单值）或函数已删（grep 调用方核实）。
- service.py 不再含 `resolve_root_path_for_server` import / `is_daemon_client_path_source` import / `path_source`
  字面量读取（stage prompt + scan dispatch + build_scan_bundle 调用全清）。
- post_scan_validator.py 不再含 `_is_daemon_client` / `_validate_server_local` / `path_source` 入参；`validate`
  永远走 `_validate_daemon_client`。
- context_builder.py `build_scan_bundle` 签名无 `path_source`（transport helper 三函数由 task-07 守）。
- execution.py `resolve_root_path_for_daemon` 调用为单参。
- 五文件可被 Python import 无 SyntaxError / NameError / AttributeError。

## verify

```bash
cd backend

# 1. 类型检查（本任务五文件，签名断链 mypy 会抓）
uv run mypy app/modules/agent/placement.py app/modules/agent/service.py app/modules/agent/post_scan_validator.py app/modules/agent/context_builder.py app/modules/agent/execution.py

# 2. agent 模块全量单测（R-07 调度行为零回归）
uv run pytest app/modules/agent -q

# 3. grep 零残留（本任务五文件，测试与 archive 除外）
uv run python -c "import pathlib; t=''.join(pathlib.Path(f'app/modules/agent/{m}').read_text() for m in ['placement.py','service.py','post_scan_validator.py','context_builder.py','execution.py']); assert '_legacy_root_exists_check' not in t and '_validate_server_local' not in t and '_is_daemon_client' not in t and 'workspace.path_source' not in t and 'daemon_runtime_id' not in t and 'resolve_root_path_for_server' not in t and '_DECIDE_FALLBACK_SENTINEL' not in t and 'path_source = workspace' not in t, 'residue found'; print('clean')"
```

注：全量 `uv run pytest` 此时**必失败**（下游 run_sync/runtime/change 等模块 task-08/09 才修，仍引用
path_source），本任务只跑 agent 模块 + mypy + grep。全量绿在 task-13 守。task-07 同 Wave 改 context_builder
transport helper，若并行 execute 需协调 context_builder.py 行级冲突（D 区已标边界）。

## constraints

- **纯删除 + 签名修复**，不新增 public 方法/参数/签名（design §7：`_get_workspace_root` 签名从 tuple 改单值
  是 task-01 DROP 列后的强制修复，非新增能力）。
- **agent 调度行为零回归（R-07）**：daemon-client 工作区的 dispatch / decide / scan dispatch / stage
  dispatch / interactive dispatch 链路行为字节级不变——删除的是 server-local 分支，daemon-client 主路径
  （delegate.stat + delegate RPC + NoOnlineDaemonError 抛错）保留。
- **不碰** `prepare_interactive_dispatch` / `prepare_scan_interactive_dispatch` / `notify_interactive_dispatch` /
  `dispatch_to_daemon` 的 lease INSERT + WS wakeup 逻辑（daemon-client 核心生命周期，design §7.5 声明不变）。
- **不碰** `NoOnlineDaemonError` / `ExecutionBackend` / `_query_daemon_online_by_id` / `_query_runtime_by_daemon_and_provider`
  / `_get_daemon_enabled_providers` / `_get_online_runtime` / `_query_online` / `_has_online_runtime` /
  `_query_online_by_id` 的实现（daemon-client 路由辅助，本次只删它们的 server-local 调用方分支）。
- **不碰** HostFsDelegate（task-05 主导）；不碰 core/spec_paths.py（task-07 核实，预期零改动）；
  不碰 workspace service 的 `resolve_root_path_for_daemon` / `resolve_root_path_for_server` 定义（task-03 主导）。
- **context_builder.py 边界**：只删 `build_scan_bundle` 签名 path_source 入参 + docstring；transport helper
  三函数（`transport_for_path_source` / `resolve_prompt_spec_root` / `build_scan_bundle` 函数体内的 transport
  调用）由 task-07 主导，本任务不重复改。
- **不写测试新逻辑**：agent 模块现有单测中 server-local case 由 task-13 统一精简，本任务只确保 daemon-client
  case 仍绿。
- post_scan_validator.py 的模块级 helper（`_get_source_commit` / `_archive_and_clean_pollution` /
  `_check_source_pollution` / `_check_local_config`）删除前 grep 核实：仅被 `_validate_server_local` 调用则删，
  被 `_validate_daemon_client` 的 `asyncio.to_thread` 包装调用则保留。
