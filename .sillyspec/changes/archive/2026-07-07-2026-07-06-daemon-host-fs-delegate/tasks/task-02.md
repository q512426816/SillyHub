---
id: task-02
title: WS RPC 请求/响应匹配（backend host_fs/ws_rpc.py + daemon ws-rpc 扩展，spike-01 决定是否含框架自建）（覆盖：FR-02, D-005@V1, D-007@V1）
author: qinyi
created_at: 2026-07-06 19:28:16
priority: P0
depends_on: [task-01]
blocks: [task-03, task-04]
requirement_ids: [FR-02]
decision_ids: [D-005@V1, D-007@V1]
allowed_paths:
  - backend/app/modules/daemon/host_fs/ws_rpc.py
  - sillyhub-daemon/src/ws-rpc.ts
  - sillyhub-daemon/src/ws-client.ts

provides:
  - contract: HostFsWsRpc
    fields: [send_rpc, rpc_id]
expects_from: {}   # task-02 定义协议，不消费 task-03 实现
goal: >
  实现 backend → daemon 的 host_fs WS RPC 请求/响应匹配（rpc_id 配对），让 task-01 的 HostFsDelegate daemon-client 分支有一条可直接调用的薄封装。spike-01 前置核实现有 DaemonWsHub.send_rpc + WsClient._dispatchRpc 是否够用：若够用则本 task 仅做薄包装 + 30s 超时；若不足则补框架。
implementation:
  - "新增 backend/app/modules/daemon/host_fs/ws_rpc.py（薄封装，复用现有 DaemonWsHub.send_rpc）：定义 send_host_fs_rpc(ws_hub, daemon_id, method, workspace_id, args, timeout=30.0)，params 内打包 workspace_id 与 args，method 取 host_fs.<op> 命名空间前缀，返回 daemon result dict 或抛 DaemonRpcRemoteError/Timeout/Offline"
  - "30s 超时硬编码（D-006 容错要求，task-04 统一超时/幂等策略时再抽常量，本 task 先 30.0 字面值）"
  - "不新建 ws-rpc.ts 模块（spike-01 判定复用 WsClient.registerRpcHandler 即可，task-03 在 host-fs-handler.ts 内调 ws.registerRpcHandler 直接连入）"
  - "不修改 ws_hub.py / ws-client.ts 核心路径（rpc_id 匹配已完备）；如 spike-01 落档后发现缺口，在 ws-client.ts 的 _dispatchRpc/_sendRpcResult 补字段（allowed_paths 已含 ws-client.ts 作为兜底）"
  - "协议字段对齐 design §7 概念（method/workspace_id/daemon_id/args/rpc_id ↔ result/error），但实体走 daemon:rpc envelope（params 内带 workspace_id）"
acceptance:
  - "send_host_fs_rpc 发出 daemon:rpc，daemon handler 回 daemon:rpc_result，rpc_id 唯一（uuid4）且与现有 list_dir 并存无冲突"
  - "超时 30s 触发 DaemonRpcTimeout（不复用 10s 默认）；offline/remote_error 透传现有异常类"
  - "backend cd backend && uv run pytest app/modules/daemon/host_fs/ 全绿（含 send_host_fs_rpc 成功/超时/offline/remote_error 四路径，仿 test_ws_rpc.py mock ws + resolve_rpc 风格）"
  - "daemon tsc 通过（cd sillyhub-daemon && pnpm exec tsc --noEmit，本 task 若不新建 ws-rpc.ts 则 ws-client.ts 零改动应直接通过）"
  - "spike-01 报告落档（spike-report.md 或 design §7 注释），明确：复用现有 RPC + 30s 超时 + envelope 形态（params 内带 workspace_id）三项决策"
verify:
  - "cd sillyhub-daemon && pnpm exec tsc --noEmit && pnpm test"
  - "cd backend && uv run pytest app/modules/daemon/host_fs/ -q"
  - "抽样回归 uv run pytest app/modules/daemon/tests/test_ws_rpc.py -q（确认现有 list_dir RPC 链路未受影响）"
constraints:
  - "复用优先（spike-01 已确认现有 rpc_id 匹配机制完备）：本 task 不新建框架，仅做 backend 薄封装 + 30s 超时；ws-rpc.ts 不新建。spike-01 若改判为需自建，本 task 含框架搭建（W1 +1 工作量）—— 目前源码核实为路径 A（复用）"
  - "协议字段偏差需落档：design §7 扁平 envelope 与现有 daemon:rpc 嵌套形态不一致，本 task 走嵌套（params 带 workspace_id）+ spike 报告标注，待 design 修订同步"
  - "不引入新 HTTP server（D-005），不修改 WS 路由 router.py 接收循环（rpc_result 已 wire 到 resolve_rpc）"
  - "30s 超时细节归 task-04（D-006 异步容错统一策略），本 task 仅硬编码 30.0 落地"
---

## goal

实现 backend → daemon 的 host_fs WS RPC 请求/响应匹配（rpc_id 配对），让 task-01 的 HostFsDelegate daemon-client 分支有一条可直接调用的薄封装。spike-01 核实现有 `DaemonWsHub.send_rpc` + `WsClient._dispatchRpc` 是否够用：若够用则本 task **仅做薄包装 + 30s 超时**，不重复造轮子；若不足则在本 task 内补框架（W1 +1 工作量）。

## spike-01 核实结论（源码已读，待 spike 报告正式落档）

- **现有双向 RPC 已完备，无需自建框架**（spike-01 通过判定，路径 A）。
- backend `app/modules/daemon/ws_hub.py`：
  - `send_rpc(daemon_id, method, params, *, timeout=RPC_DEFAULT_TIMEOUT)` 已生成 `rpc_id`、注册 `_pending_rpcs[rpc_id]` future、发 `daemon:rpc`、`asyncio.wait_for` 等回响（L372-456）。
  - `resolve_rpc(rpc_id, payload)`（L458-481）由 WS 接收循环在 `daemon:rpc_result` 到达时调用（`router.py:1788`），完成 future；timeout/remote_error/offline/disconnect 全路径已有异常类（`DaemonRpcTimeout/RemoteError/Offline/Conflict`）。
  - 默认 `RPC_DEFAULT_TIMEOUT = 10.0`（L39），host_fs 走 30s 需 `timeout=30.0` 显式传。
- daemon `sillyhub-daemon/src/ws-client.ts`：
  - `registerRpcHandler(method, handler)`（L333-339）已注册 `list_dir` / `get_spec_bundle`（`daemon.ts:2044-2082`），`_dispatchRpc`（L484-520）路由 RPC → handler → `_sendRpcResult`（L528-538）回填 `rpc_id`。`host_fs.*` 可直接挂入此注册表。
- **协议字段判定**：现有 `daemon:rpc` envelope 是 `{type:"daemon:rpc", payload:{rpc_id, method, params}}`，与 design §7 顶层 `type/method/workspace_id/daemon_id/args/rpc_id` **字段名不同**（设计 §7 写的是 envelope 扁平形态）。按 D-005「复用 per-daemon WS 不增 HTTP server」+ spike-01「复用优先」原则，**采用 envelope 形态**：workspace_id/daemon_id 落在 `params` 内，method 取 `host_fs.git_apply` / `host_fs.stat` / 等命名空间前缀。design §7 的扁平形态作为概念对齐，不作为字面对字段实现要求（本 task 在蓝图标注此偏差，供 spike 报告 + design 修订确认）。
- **因此 `sillyhub-daemon/src/ws-rpc.ts` 不新建**（设计 §6 写的「新增/修改」，spike 判定为「不新增」），ws-client.ts 不需改（注册表机制已支持任意 method）。本 task 落地以 backend `ws_rpc.py` 为主。

## implementation

1. **新增 `backend/app/modules/daemon/host_fs/ws_rpc.py`**（薄封装，复用现有 `DaemonWsHub.send_rpc`）：
   - `async def send_host_fs_rpc(ws_hub, daemon_id, method, workspace_id, args, *, timeout=30.0) -> dict`：
     - 入参：`daemon_id`（路由 key，per-daemon WS，D-005）、`method`（如 `'host_fs.git_apply'`，命名空间前缀避免与 `list_dir`/`get_spec_bundle` 撞名）、`workspace_id` + `args`（method-specific 业务参数，如 patch_data/use_3way）打包成 `params`。
     - 内部调 `await ws_hub.send_rpc(daemon_id, method='host_fs.<op>', params={'workspace_id': str(workspace_id), **args}, timeout=30.0)`。
     - 返回 daemon `result` dict（success）或抛 `DaemonRpcRemoteError/Timeout/Offline`（task-04 在 HostFsDelegate 层兜底转 warn，不阻塞 complete_lease，D-006）。
   - **30s 超时硬编码**（D-006 容错要求，task-04 统一超时/幂等策略时再抽常量；本 task 先 30.0 字面值）。
   - **不新建 ws-rpc.ts 模块**（spike-01 判定复用 WsClient.registerRpcHandler 即可，task-03 在 host-fs-handler.ts 内调 `ws.registerRpcHandler('host_fs.git_apply', ...)` 直接连入）。
2. **不修改 ws_hub.py / ws-client.ts 核心路径**（rpc_id 匹配已完备）。如 spike-01 落档后发现缺口，本 task 在 ws-client.ts 的 `_dispatchRpc`/`_sendRpcResult` 补字段（allowed_paths 已含 ws-client.ts 作为兜底）。
3. 协议字段对齐 design §7 概念（method/workspace_id/daemon_id/args/rpc_id ↔ result/error），但实体走 `daemon:rpc` envelope（如上判定）。

## 验收标准

- `send_host_fs_rpc` 发出 `daemon:rpc`，daemon handler 回 `daemon:rpc_result`，rpc_id 唯一（uuid4）且与现有 `list_dir` 并存无冲突。
- 超时 30s 触发 `DaemonRpcTimeout`（不复用 10s 默认）；offline/remote_error 透传现有异常类。
- backend `cd backend && uv run pytest app/modules/daemon/host_fs/` 全绿（含 send_host_fs_rpc 成功/超时/offline/remote_error 四路径，仿 `test_ws_rpc.py` mock ws + resolve_rpc 风格）。
- daemon tsc 通过（`cd sillyhub-daemon && pnpm exec tsc --noEmit`，本 task 若不新建 ws-rpc.ts 则 ws-client.ts 零改动应直接通过）。
- spike-01 报告落档（spike-report.md 或 design §7 注释），明确：复用现有 RPC + 30s 超时 + envelope 形态（params 内带 workspace_id）三项决策。

## verify

- `cd sillyhub-daemon && pnpm exec tsc --noEmit && pnpm test`
- `cd backend && uv run pytest app/modules/daemon/host_fs/ -q`
- 抽样回归 `uv run pytest app/modules/daemon/tests/test_ws_rpc.py -q`（确认现有 list_dir RPC 链路未受影响）

## constraints

- **复用优先**（spike-01 已确认现有 rpc_id 匹配机制完备）：本 task **不新建框架**，仅做 backend 薄封装 + 30s 超时；ws-rpc.ts 不新建。spike-01 若改判为需自建，本 task 含框架搭建（W1 +1 工作量）——目前源码核实为路径 A（复用）。
- **协议字段偏差需落档**：design §7 扁平 envelope 与现有 `daemon:rpc` 嵌套形态不一致，本 task 走嵌套（params 带 workspace_id）+ spike 报告标注，待 design 修订同步。
- **不引入新 HTTP server**（D-005），不修改 WS 路由 router.py 接收循环（rpc_result 已 wire 到 resolve_rpc）。
- 30s 超时细节归 task-04（D-006 异步容错统一策略），本 task 仅硬编码 30.0 落地。
