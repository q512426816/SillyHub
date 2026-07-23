---
id: task-05
title: Remove HostFsDelegate server-local branches + _local_* helpers + ws_rpc daemon_runtime_id
title_zh: HostFsDelegate 删 6 个 _local_*+_run_git_apply+run_command server-local 拒绝分支+read_package_json/read_local_yaml 内联分支+ws_rpc daemon_runtime_id+docstring 清理
author: qinyi
created_at: 2026-07-10 23:45:39
priority: P0
depends_on: [task-01]
blocks: [task-09, task-13]
requirement_ids: [FR-3]
decision_ids: [D-002, D-007]
allowed_paths:
  - backend/app/modules/daemon/host_fs/delegate.py
  - backend/app/modules/daemon/host_fs/ws_rpc.py
---

## goal

删除 `HostFsDelegate` 的 server-local 执行分支与全部本地实现，使 9 个 public 方法固定走 daemon WS RPC 委托（8 个走 `_via_rpc_or_degrade` 降级，`run_command` 走 `_via_rpc` fail-loud）。这是 design §5 Phase 2 HostFsDelegate 重灾区的核心删除任务——task-01 DROP `path_source` 列后，delegate.py 内所有 `workspace.path_source` 读取会 `AttributeError`，本任务清除全部断链。覆盖 FR-3 / D-002（daemon 离线复用 degrade）/ D-007（Grill 修正后的精确方法清单）。

## implementation

### delegate.py（backend/app/modules/daemon/host_fs/delegate.py）

**A. 删 6 个 `_local_*` 静态方法 + 1 个孤儿辅助 `_run_git_apply`**（D-007 P0-1 修正清单）：

1. `_local_stat`（line 244-253）— 删整个 `@staticmethod`。
2. `_local_git_apply`（line 375-427）— 删整个 `@staticmethod`。
3. `_run_git_apply`（line 429-449）— 删整个 `@staticmethod`（孤儿辅助，仅被 `_local_git_apply` 调用，同步删）。
4. `_local_git_rev_parse`（line 475-533）— 删整个 `@staticmethod`。
5. `_local_pollution_archive`（line 563-610）— 删整个 `@staticmethod`。
6. `_local_read_json`（line 635-642）— 删整个 `@staticmethod`。
7. `_local_read_yaml`（line 667-675）— 删整个 `@staticmethod`。

**B. public 方法删内联 server-local `Path` 分支，固定走 `_via_rpc_or_degrade`**：

8. `stat`（228-242）：删 line 235 的 `if is_daemon_client_path_source(workspace.path_source):` 分支头 + 删 line 242 `return self._local_stat(path)`，方法体只留 `_via_rpc_or_degrade` 调用。
9. `read_file`（258-272）：删 line 264 `if ...` 分支头 + 删 line 272 `return Path(path).read_text(...)`，保留 `result.get("content","")` 提取。
10. `list_dir`（277-295）：删 line 283 `if ...` 分支头 + 删 line 292-295 `p = Path(path)...` 本地块。
11. `git_apply`（300-373）：删 line 344 `if ...` 分支头 + 删 line 366-373 `out = await self._local_git_apply(...)` 本地块，保留 D-008 dedupe 逻辑 + `_via_rpc_or_degrade` 调用。
12. `git_rev_parse`（454-473）：删 line 464 `if ...` 分支头 + 删 line 473 `return self._local_git_rev_parse(...)`。
13. `pollution_archive`（538-561）：删 line 554 `if ...` 分支头 + 删 line 561 `return self._local_pollution_archive(...)`。
14. `read_package_json`（615-633）：删 line 622 `if ...` 分支头 + 删 line 633 `return self._local_read_json(...)`，方法体固定走 `_via_rpc_or_degrade`（D-007 P0-1：public 方法名是 `read_package_json`，非首版误写的 read_json）。
15. `read_local_yaml`（647-665）：删 line 654 `if ...` 分支头 + 删 line 665 `return self._local_read_yaml(...)`，方法体固定走 `_via_rpc_or_degrade`。

**C. `run_command`（692-760）删 server-local 拒绝分支（D-007 P0-2 修正）**：

16. 删 line 737-747 的整个 `if not is_daemon_client_path_source(workspace.path_source): raise HostFsDelegateError(...)` 块——task-01 DROP `path_source` 列后 line 745 `"path_source": workspace.path_source` 会 `AttributeError`。删后 `_enforce_command_whitelist` 之后直接 `return await self._via_rpc(...)`，gate 失败由 RPC 异常直接暴露（D-002 fail-loud，非 degrade）。

**D. 清理 import + docstring/异常消息陈旧文案**（D-007 P1-4）：

17. 顶部 import 清理：删 `shutil`（仅 `_local_pollution_archive` 用）、`subprocess`（仅 `_local_git_rev_parse`/`_run_git_apply` 用）、`json`（仅 `_local_read_json` 用）、`Path`（仅 server-local 分支用）；保留 `yaml`（如 `read_local_yaml` 仍引用则核实，若也只服务 `_local_read_yaml` 则一并删）。逐个 grep 核实残留引用再删。
18. 删 `from app.modules.workspace.service import is_daemon_client_path_source`（line 61，全部调用点已删）。
19. 类/方法 docstring 清理：line 1-34 模块 docstring 删 "server-local: local-container implementation..." 整段描述 + "branches on `workspace.path_source`" 改为单一 daemon-client；line 152-164 类 docstring 同理删 server-local 描述；各方法 docstring（stat 228-234 / read_file 258-263 / list_dir 277-282 / git_apply 300-323 / git_rev_parse 454-463 / pollution_archive 538-553 / read_package_json 615-621 / read_local_yaml 647-653 / run_command 702-734）删 "server-local:" 段落，只留 daemon-client 描述。
20. 异常消息清理：line 862-863 `HostFsDelegateUnavailable` 消息 "neither member binding nor daemon_runtime_id resolves..." 改为 "workspace has no bound daemon instance (member binding resolves no daemon_instances.id)"；line 203 docstring 注释 "the runtime id stored in `workspace.daemon_runtime_id`" 段落删 legacy 描述。

### ws_rpc.py（backend/app/modules/daemon/host_fs/ws_rpc.py）

21. line 160-164 `HostFsWsRpc.send_rpc` docstring：删 "task-01 passes ``str`` ids ... ``str(workspace.daemon_runtime_id)``" 句，改为 "task-01 passes ``str(workspace.id)`` / ``str(daemon_id)``"（`daemon_id` 现由 resolver 给出 daemon_instances.id，非 runtime_id）。

## 验收标准

- delegate.py 不再含 `_local_stat` / `_local_git_apply` / `_local_run_git_apply` / `_local_git_rev_parse` / `_local_pollution_archive` / `_local_read_json` / `_local_read_yaml` 七个方法定义。
- delegate.py 不再含 `is_daemon_client_path_source` 调用与 import。
- delegate.py 不再含 `workspace.path_source` 任何读取（grep `path_source` 零命中，含 docstring/异常 details）。
- `run_command` body 顺序为 `_enforce_command_whitelist` → `_via_rpc`（无 server-local raise 分支）。
- 8 个 public 方法（stat/read_file/list_dir/git_apply/git_rev_parse/pollution_archive/read_package_json/read_local_yaml）方法体唯一 RPC 调用为 `_via_rpc_or_degrade`。
- `shutil`/`subprocess`/`json`/`Path` 四 import 若无残留引用则全部删除（grep 核实）。
- ws_rpc.py docstring 不再含 `workspace.daemon_runtime_id` 字样。
- 两文件可被 Python import 无 SyntaxError / NameError。

## verify

```bash
cd backend

# 1. 类型检查（本任务两文件）
uv run mypy app/modules/daemon/host_fs/delegate.py app/modules/daemon/host_fs/ws_rpc.py

# 2. host_fs 模块单测全绿（含 HostFsDelegate contract + run_command 白名单 + ws_rpc mock 测试）
uv run pytest app/modules/daemon/host_fs -q

# 3. grep 零残留（本任务两文件）
uv run python -c "import pathlib; t=pathlib.Path('app/modules/daemon/host_fs/delegate.py').read_text()+pathlib.Path('app/modules/daemon/host_fs/ws_rpc.py').read_text(); assert '_local_stat' not in t and '_local_git_apply' not in t and '_run_git_apply' not in t and '_local_git_rev_parse' not in t and '_local_pollution_archive' not in t and '_local_read_json' not in t and '_local_read_yaml' not in t and 'is_daemon_client_path_source' not in t and 'workspace.path_source' not in t and 'daemon_runtime_id' not in t, 'residue found'; print('clean')"
```

注：全量 `uv run pytest` 此时**必失败**（下游 run_sync/runtime 等模块 task-09 才修，仍引用 path_source），本任务只跑 host_fs 模块测试 + mypy + grep。全量绿在 task-13 守。

## constraints

- **纯删除**，不新增 public 方法/参数/签名（design §7：public 方法签名不变，内部固定走 RPC）。
- **run_command 删 server-local 分支 ≠ 保持不变**（D-007 P0-2 修正首版误判）：line 737-747 必删，否则 DROP `path_source` 列后 line 745 读列 `AttributeError` 使 gate 任务 100% 崩。
- **daemon 离线走现有 D-006 降级不新增降级路径**（D-006 / NFR-1）：8 个 public 方法复用 `_via_rpc_or_degrade`，`run_command` 复用 `_via_rpc`（gate fail-loud 由 task 调用方 catch 置 `gate_status=failed`）。
- **run_command 走 `_via_rpc` 不走 `_via_rpc_or_degrade`**（D-002）：gate 决策必须暴露 RPC 失败而非静默降级，否则 gate 永远假绿。
- **不碰** `_via_rpc` / `_via_rpc_or_degrade` / `_enforce_command_whitelist` / `_applied_patch_ids` / `_WsRpcLike` / `HostFsDelegateError` / `HostFsDelegateUnavailable` / `_RPC_DEGRADED_EXC` / `_DaemonIdResolver` 的实现（这些是 daemon-client 链路本身，本次只删 server-local 侧）。
- **不碰** `complete_lease` 侧 3 处容器越界 bug（apply_patch 500 / post_scan_validation / stage_callback）——属独立 container-overreach 变更（D-003 边界）。
- **不写测试新逻辑**：host_fs 现有单测（test_delegate_*）中 server-local case 由 task-13 统一精简，本任务只确保 daemon-client case 仍绿。
- import 清理逐个 grep 核实，严禁误删仍被 daemon-client 链路引用的模块（`yaml` 需确认 `read_local_yaml` RPC 路径是否还用）。
