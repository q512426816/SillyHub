---
id: task-01
title: HostFsDelegate 抽象（path_source 分流：daemon-client → WS RPC / server-local → 本地容器）（覆盖：FR-01, D-001@V1, D-004@V1, D-005@V1）
author: qinyi
created_at: 2026-07-06 19:28:16
priority: P0
depends_on: []
blocks: [task-05, task-06, task-07, task-08, task-09, task-10, task-11, task-12, task-13]
requirement_ids: [FR-01]
decision_ids: [D-001@V1, D-004@V1, D-005@V1]
allowed_paths:
  - backend/app/modules/daemon/host_fs/delegate.py
  - backend/app/modules/daemon/host_fs/__init__.py
provides:
  - contract: HostFsDelegate
    fields: [stat, read_file, list_dir, git_apply, git_rev_parse, pollution_archive, read_package_json, read_local_yaml]
expects_from:
  task-02:
    - contract: HostFsWsRpc
      needs: [send_rpc]
goal: >
  抽象 HostFsDelegate 类收口 8 处散落的宿主文件系统操作，按 path_source 分流 server-local 走本地容器 daemon-client 走 per-daemon WS RPC
implementation:
  - "spike-01 核实 WS 双向能力后，新建 host_fs/__init__.py + delegate.py 定义 HostFsDelegate 类"
  - "__init__(self, session, ws_hub) 持有引用，严格按 design §5.1 落八方法签名一字不改"
  - "每方法统一 if is_daemon_client_path_source 分流：server-local 迁现有 stat/git/read 逻辑字符级保留，daemon-client 占位调 send_rpc 等 task-02 接线"
acceptance:
  - "HostFsDelegate 类定义存在且导出在 host_fs/__init__.py"
  - "八方法签名与 design §5.1 完全一致（参数名+返回类型+顺序）任意一项偏差即不通过"
  - "每方法含 is_daemon_client_path_source 分流，server-local 有本地实现 daemon-client 调 send_rpc mock 验证"
  - "异常类命名 N818 且无中文紧跟 type: ignore，allowed_paths 外零改动仅两个新文件"
verify:
  - "cd backend && uv run pytest app/modules/daemon/host_fs/ -v"
constraints:
  - "server-local 分支必须字符级保留现有行为（NFR-02 零回归）"
  - "daemon-client 分支实际 RPC 联调依赖 task-02，本 task 仅声明 expects_from 不实现 send_rpc 本身"
  - "八方法名严格对齐 design §5.1 不可改名或加减参数（跨任务契约锁死）"
  - "异常按事件命名 N818，禁止 type: ignore 后跟中文"
  - "不改 patch/service.py lease/service.py，复用 workspace/service.py 的 is_daemon_client_path_source helper"
---

## goal

抽象 HostFsDelegate 类，把 8 处散落在 backend 容器里直接做宿主文件系统操作（stat / git apply / read 宿主路径）的代码统一收口到一处。构造时注入 session + ws_hub（task-02 提供的 send_rpc 经 ws_hub 调用），每个方法内部按 `workspace.path_source` 分流：`server-local` 走本地容器实现（迁现有 stat/git/read 逻辑，行为不变 D-004），`daemon-client` 走 per-daemon WS RPC（D-005，本 task 仅声明 expects，实际联调在 W2）。消灭散落的 `if path_source != 'daemon-client'`（D-001），为 W2/W3 所有 consumer 提供单一入口（NFR-03）。

## implementation

1. 新建 `backend/app/modules/daemon/host_fs/__init__.py`（导出 `HostFsDelegate`）+ `delegate.py`。
2. `class HostFsDelegate`：`__init__(self, session: AsyncSession, ws_hub)` 持有引用；session 用于反查 workspace（consumer 已传 workspace 对象时无需查 DB，但留 session 供 stage_callback 等需补查场景）。
3. 严格按 design §5.1 落八方法签名：`async def stat(self, workspace, path) -> dict`（`{exists, is_dir, size}`）、`read_file(...) -> str`、`list_dir(...) -> list[str]`、`git_apply(self, workspace, patch_data, use_3way) -> dict`（`{ok, conflict_detail}`）、`git_rev_parse(self, workspace, ref) -> str | None`、`pollution_archive(self, workspace, source_root) -> dict`、`read_package_json(self, workspace) -> dict | None`、`read_local_yaml(self, workspace) -> dict | None`。八方法名一字不改（W2/W3 consumer + plan 跨任务契约表依赖）。
4. 每方法统一分流骨架：`if is_daemon_client_path_source(workspace.path_source): return await self._via_rpc(...)`（调 task-02 的 send_rpc，本 task 用 `self._ws_rpc.send_rpc(...)` 占位，task-02 落地后接线）`else: return await self._local(...)`。spike-01 核实 WS 双向能力后，本步骤的 send_rpc 占位与 task-02 的接线才有可靠前置依据。
5. server-local 本地分支迁移现有实现参照 `agent/service.py:265`（`Path(workspace.root_path)` + `path.exists()` / `.is_dir()`）和 `patch/service.py:144-161`（`asyncio.create_subprocess_exec("git", ...)`）的写法——原行为字符级保留（NFR-02 零回归）。
6. daemon-client 分支占位实现：`raise HostFsDelegateUnavailable("ws_rpc not wired (task-02 pending)")`（异常名按 N818），等 task-02 落地后改 `await self._ws_rpc.send_rpc(method, workspace, args)`。本 task 的单测对 daemon-client 分支只断言「调到 send_rpc mock」不断言真实 RPC 结果。

## 验收标准

- [ ] `HostFsDelegate` 类定义存在且导出在 `host_fs/__init__.py`。
- [ ] 八方法签名与 design §5.1 完全一致（参数名 + 返回类型 + 顺序），任意一项偏差即不通过。
- [ ] 每方法含 `if is_daemon_client_path_source(workspace.path_source)` 分流，server-local 分支有本地实现，daemon-client 分支调 `send_rpc`（mock 验证调用方法名 + args 透传）。
- [ ] server-local 分支行为与现状字符级一致：`stat` 返回 `{exists,is_dir,size}`、`read_file` 读文件内容、`git_apply` 走 subprocess exec 且返回 `{ok,conflict_detail}`（参照 patch/service.py 现有 subprocess 写法）。
- [ ] daemon-client 分支调 send_rpc mock 时传 `workspace.id` + `workspace.daemon_id` + 方法名 + args（协议字段对齐 design §7）。
- [ ] 异常类命名 N818（如 `HostFsDelegateUnavailable`、`HostFsDelegateError`），无中文紧跟 `# type: ignore`。
- [ ] `allowed_paths` 外零改动（仅 delegate.py + __init__.py 两个新文件）。

## verify

`cd backend && uv run pytest app/modules/daemon/host_fs/ -v`

单测覆盖：双路径（server-local 真实本地临时目录 / daemon-client send_rpc mock）× 八方法，验证分流正确 + server-local 行为不变 + daemon-client 调到 send_rpc 传对字段。

## constraints

- server-local 分支必须字符级保留现有行为（NFR-02 brownfield 零回归——现有 dispatch / scan / patch 测试不能因迁移而退化）。
- daemon-client 分支实际 RPC 联调依赖 task-02 的 `HostFsWsRpc.send_rpc`，本 task 仅声明 `expects_from`，不实现 send_rpc 本身（否则与 task-02 边界越界）。
- 八方法名严格对齐 design §5.1，不可改名/加减参数（W2 task-06~08 + W3 task-09~13 全部 consumer 依赖，跨任务契约表锁死）。
- 异常按事件命名（N818），禁止 `# type: ignore` 后跟中文（mypy syntax 报错）。
- 不改 patch/service.py、lease/service.py（本 task 只建抽象，迁移 consumer 在 task-06/07/08/09~13）。
- 复用 workspace/service.py 已有 `is_daemon_client_path_source` helper，不另造判断函数。
