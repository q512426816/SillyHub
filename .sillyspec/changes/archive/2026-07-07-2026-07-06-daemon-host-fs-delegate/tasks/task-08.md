---
id: task-08
title: stage_callback 改 HostFsDelegate（run_sync/service.py:913 + change/dispatch.py sync_stage_status 核实，design §12 待核项）（覆盖：FR-03）
author: qinyi
created_at: 2026-07-06 19:28:16
priority: P1
depends_on: [task-05]
blocks: []
requirement_ids: [FR-03]
decision_ids: []
allowed_paths:
  - backend/app/modules/daemon/run_sync/service.py
  - backend/app/modules/change/dispatch.py
provides: []
expects_from:
  task-01:
    - contract: HostFsDelegate
      needs: [stat, read_file]
  task-05:
    - contract: CompleteLeasePathSource
      needs: [path_source]
goal: >
  一句话目标
implementation:
  - "步骤1（含 change/dispatch.py sync_stage_status 核实结论）"
  - "步骤2"
acceptance:
  - "验收1"
verify:
  - "cd backend && uv run pytest app/modules/daemon/run_sync/ app/modules/change/"
constraints:
  - "约束1"
---

## goal

把 stage dispatch 回调链路 `_trigger_stage_completion_callback`（run_sync/service.py:889）触发的宿主 sillyspec.db 访问改走 HostFsDelegate RPC，并落实 design §12 待核项——核实 `change/dispatch.py` 的 `sync_stage_status`（dispatch.py:993）是否同源需改。daemon-client 时回调正常执行、不再报宿主访问错；server-local 行为不变。

## implementation

### 核实结论（design §12 待核项）

**已核实，需改**。`change/dispatch.py` `sync_stage_status`（dispatch.py:993-1271）确为容器内做宿主操作，与 8 处容器越界同源：

- dispatch.py:1027/1028/1071 `db_path.is_file()` / `fallback_db_path.is_file()`
- dispatch.py:1046 `sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)`（读宿主 sillyspec.db）
- dispatch.py:1082 fallback 同样 `sqlite3.connect` 宿主 db
- dispatch.py:1238 `_resolve_db_path` 内 `db_path.exists()`
- `_resolve_db_path` / `_resolve_db_path_fallback`（1204/1258）解析 spec_ws.spec_root / workspace.root_path 为宿主路径，容器不可达

`_trigger_stage_completion_callback`（run_sync/service.py:889-936）本身不碰宿主路径，只调用 `svc.sync_stage_status(...)`（dispatch.py:913）—— 宿主访问实际发生在 `sync_stage_status` 内。故本 task 的容器越界修点落在 dispatch.py，run_sync/service.py 仅透传 path_source 信号。

### 落地步骤

1. **task-05 透传承接**：`_trigger_stage_completion_callback` 入口接收 path_source（来自 complete_lease 经 run_sync 调用栈，task-05 贯穿），传给 `SillySpecStageDispatchService.sync_stage_status(..., path_source)` 新增形参（或经 session/上下文携带，二选一蓝图时取形参显式更可控）。

2. **dispatch.py sync_stage_status 改 HostFsDelegate**：
   - 入口按 `path_source` 分流（D-004）：server-local 走现有 `sqlite3.connect` 本地容器分支，行为不变；daemon-client 走 `HostFsDelegate.read_file(workspace, sillyspec_db_relative_path)` 拿到 db 字节流后写临时文件再 `sqlite3.connect`（或新增 `HostFsDelegate.read_sillyspec_db` 方法，spike-01/task-01 时定；优先复用 read_file 保持接口精简）。
   - `_resolve_db_path` / `_resolve_db_path_fallback`（dispatch.py:1204/1258）daemon-client 分支不再 `is_file()`/`exists()` 探宿主，改 `HostFsDelegate.stat(workspace, db_rel_path)` 判存在；返回「相对 spec_root 的 db 相对路径」给 RPC，不返回容器不可达的绝对路径。
   - fallback db（dispatch.py:1028/1071）同样改 `HostFsDelegate.stat` 判存在。

3. **failure log 兜底**：RPC 失败/超时（D-006）warn 不抛，`StageSyncResult(synced=False, error=...)` 兜底（现有 1036/1054/1099 已是 skipped 路径，复用）；`auto_dispatch_next_step`（dispatch.py:925）照常消费 sync_result，不阻塞 lease completed。

4. **server-local 零回归**：path_source 分流本地分支保留全部现有 sqlite3 直读逻辑、SpecPathResolver 解析、spec_ws.strategy 分支判断（repo-mirrored/platform-managed/fallback），现有测试不挂。

## 验收标准

- daemon-client stage lease complete 时，`_trigger_stage_completion_callback` → `sync_stage_status` 走 HostFsDelegate RPC，不再 `sqlite3.connect` 宿主路径 / `db_path.is_file()` 探宿主；无 FileNotFoundError / 容器越界。
- dispatch.py:993 `sync_stage_status` 签名含 path_source 形参（或等效上下文），run_sync/service.py:913 调用点透传。
- §12 待核项核实结论（需改）已写入本卡 implementation；`_resolve_db_path` / `_resolve_db_path_fallback` / fallback db 三处宿主访问点全改 HostFsDelegate。
- RPC 失败时 `StageSyncResult(synced=False)` 兜底，不阻塞 lease completed（D-006），warn 落 failure log。
- server-local 模式 path_source 分流本地分支，spec_ws.strategy / SpecPathResolver 解析逻辑保留，现有 stage dispatch / reconcile_stale_runs（dispatch.py:411）测试零回归。

## verify

```
cd backend && uv run pytest app/modules/daemon/run_sync/ app/modules/change/
```

补充：跑 `app/modules/daemon/lease/` 完整套件确认 complete_lease → stage_callback 链路 daemon-client/server-local 双路径不回归；grep 确认 dispatch.py 内无裸 `sqlite3.connect(f"file:` / `db_path.is_file()` / `.exists()` 宿主访问残留（NFR-03）。

## constraints

- §12 待核项必须落核实结论（已落：需改）。
- HostFsDelegate 接口方法以 task-01 provides 为准（read_file / stat 为主，是否新增 read_sillyspec_db 由 task-01 蓝图定）。
- RPC 失败 warn 不阻塞 lease（D-006），`StageSyncResult.synced=False` 兜底沿用现有 skipped 路径。
- server-local 零回归（NFR-02）：path_source 分流本地容器分支保留现有 sqlite3 直读 + SpecPathResolver 语义。
- 本 task 不改 reconcile_stale_runs（dispatch.py:411）调用点签名差异（同样调 sync_stage_status），但签名加形参须默认值兼容；如需补 path_source 给 reconcile 路径另开 follow-up，本 task 仅覆盖 complete_lease → stage_callback 主路径。

## provides

（本 task 不对外提供新契约，消费 task-01/task-05 产出）

## expects_from

- **task-01**：HostFsDelegate 契约（`read_file` / `stat` 方法，daemon-client 走 WS RPC / server-local 走本地容器，path_source 分流 D-004）。
- **task-05**：complete_lease 入口 path_source 反查并透传到 stage_callback（`_trigger_stage_completion_callback` 调用栈可见 workspace.path_source 字段）。
