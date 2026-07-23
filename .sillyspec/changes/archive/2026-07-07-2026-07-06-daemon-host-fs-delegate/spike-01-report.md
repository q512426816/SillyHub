---
author: qinyi
created_at: 2026-07-06 20:45:00
---

# spike-01 报告：per-daemon WS 双向 RPC 能力 + file-rpc 复用核实

> 对应 plan.md spike-01 / D-007@V1。结论决定 task-02/03 实现路径。
> 实际源码核实于 execute Step 2（符号影响面扫描），本报告正式落档。

## 验证内容

1. daemon-entity-binding per-daemon WS（DaemonWsHub）当前是否支持「请求/响应」匹配（backend 发 RPC → daemon 响应回 backend）。
2. 现有 `sillyhub-daemon/src/file-rpc.ts` 是否可直接复用/扩展为 host_fs handler。

## 结论：路径 A（复用现有 RPC，无需自建框架）

现有双向 RPC 已完备，无需自建框架。task-02 仅做 backend 薄封装 + 30s 超时；task-03 新建 host-fs-handler.ts 复用 file-rpc.ts 辅助函数。`sillyhub-daemon/src/ws-rpc.ts` **不新建**（design §6 的「新增/修改」项在此修正为「不新增」）。

## 证据（源码核实，行号基于 base bb41759e）

### backend 侧（`backend/app/modules/daemon/ws_hub.py`）

- `RPC_DEFAULT_TIMEOUT = 10.0`（L39）：host_fs 走 30s 需显式传 `timeout=30.0`。
- `async def send_rpc(daemon_id, method, params, *, timeout=RPC_DEFAULT_TIMEOUT)`（L372-456）：已生成 `rpc_id`（uuid4）、注册 `_pending_rpcs[rpc_id]` future、发 `daemon:rpc` 消息、`asyncio.wait_for` 等回响。
- `async def resolve_rpc(rpc_id, payload)`（L458-481）：由 WS 接收循环在 `daemon:rpc_result` 到达时调用，完成 future。
- 异常体系完备：`DaemonRpcTimeout` / `DaemonRpcRemoteError` / `DaemonRuntimeOffline` / `DaemonRpcConflict`（timeout/remote_error/offline/disconnect 全路径）。
- disconnect 触发 `cancel_all_pending`：rpc_id 单次用（uuid4），无重发歧义。

### daemon 侧（`sillyhub-daemon/src/ws-client.ts`）

- `registerRpcHandler(method, handler)`（L333-339）：注册业务 handler 到 `_rpcHandlers` map。
- `_dispatchRpc(msg)`（L484-520）：取 handler → await → 回发 `MSG.RPC_RESULT` 带原 `rpc_id`；handler 抛 RpcError 原样回填 code，抛普通 Error 映射 `internal`。
- `_sendRpcResult(rpcId, result, error)`（L528-538）：回填 rpc_id。
- WS 接收循环 L402 `if (msg.type === MSG.RPC) void this._dispatchRpc(msg)`：fire-and-forget，不阻塞主循环。
- 已注册 handler：`list_dir`（file-rpc.ts:listDir）+ `get_spec_bundle`（daemon.ts:2044-2092，`_registerListDirRpcHandler` @ :2057 / `_registerGetSpecBundleRpcHandler` @ :2077）。`host_fs.*` 可直接挂入此注册表。

### file-rpc.ts 复用判定

- `assertWithinAllowedRoots(path, roots)`（L70）：白名单校验，host_fs handler 直接复用做越界守卫。
- `listDir(path, ...) -> ListDirResult`（L125）：已实现 + 有测试，HostFsDelegate.list_dir 直接 re-export，零行为变更（task-03 constraints 第 6 条）。
- `toRpcError(e, where) -> RpcError`（L196）：fs 错误码 → RpcError 映射，host_fs handler 复用做错误结构化。

## 协议形态决策

现有 `daemon:rpc` envelope 是嵌套形态：`{type:"daemon:rpc", payload:{rpc_id, method, params}}`，与 design §7 顶层扁平 `{type, method, workspace_id, daemon_id, args, rpc_id}` **字段名不同**。

按 D-005「复用 per-daemon WS 不增 HTTP server」+ spike「复用优先」原则，**采用 envelope 嵌套形态**：

- `workspace_id` / `daemon_id` 落在 `params` 内（method-specific 业务参数）。
- `method` 取 `host_fs.git_apply` / `host_fs.stat` / 等命名空间前缀（避免与 `list_dir`/`get_spec_bundle` 撞名）。
- design §7 扁平形态作为概念对齐，不作为字面对字段实现要求（task-02 蓝图已标注此偏差，待 design 修订同步）。

## 对 task-02 / task-03 的影响

- **task-02**：仅新建 backend `host_fs/ws_rpc.py` 薄封装（`send_host_fs_rpc` 复用 `ws_hub.send_rpc` + `timeout=30.0`）；**不新建 ws-rpc.ts**；`ws_hub.py` / `ws-client.ts` 零改动。
- **task-03**：新建 `host-fs-handler.ts`（复用 file-rpc.ts 的 `assertWithinAllowedRoots` / `toRpcError` / `listDir`）+ `daemon.ts` 加 `_registerHostFsRpcHandler(ws)` 注册八方法（method 带 `host_fs.` 前缀，在 :2044 旁）。

## 风险

- 30s 超时需显式传（默认 10s 不够 git apply 大 patch）—— task-02 落地 `HOST_FS_RPC_TIMEOUT` 常量。
- design §7 与实际 envelope 形态偏差，待 design 修订同步（本报告 + task-02 蓝图已标注）。
