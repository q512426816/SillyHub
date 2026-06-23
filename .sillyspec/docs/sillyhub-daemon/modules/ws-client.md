---
schema_version: 1
doc_type: module-card
module_id: ws-client
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:10:50
---
# ws-client

## 定位
daemon ↔ backend 的 WebSocket 传输层（`src/ws-client.ts`）。封装连接生命周期、心跳、自动重连、消息收发，并内嵌 RPC 分发（task-05 / D-005@v1）。只负责收发与分发，不内嵌 fs 业务逻辑（listDir 等业务层由 daemon 包装成 RpcHandler 注册进来）。

## 契约摘要
- 常量：`RECONNECT_INTERVAL_MS=5000`、`RECONNECT_MAX_INTERVAL_MS=5000`、`CONNECT_TIMEOUT_MS=10000`、`CLOSE_TIMEOUT_MS=5000`。
- `WsClientCallbacks`（onMessage/onConnected/onDisconnected/onError）。
- `WsClientOptions`（runtimeId/url/token 等 + callbacks）。
- `RpcHandler = (params) => unknown | Promise<unknown>`。
- `RpcError(code, message)` ——带稳定 code 的 Error（forbidden/not_found/method_not_found/internal）。
- `WsState` 枚举（Idle/Connecting/Connected/Reconnecting）。
- `WsClient`：`connect()`/`close()`/`send(msg): boolean`/`sendHeartbeatAck()`/`registerRpcHandler(method, handler)`/`state`/`isConnected`。

## 关键逻辑
```
connect: 幂等（Connecting/Connected 直接返回）；_running=true；建 socket；
  开 CONNECT_TIMEOUT 握手定时器；绑定 open/message/close/error
close: _running=false；清定时器；ws.close(1000)；CLOSE_TIMEOUT 后强制 terminate
send: readyState!==OPEN → 返回 false 丢弃（不缓冲不抛）；否则 JSON.stringify 发出
_handleMessage: JSON.parse → msg.type 非字符串 warn 不断连；
  type===RPC → _dispatchRpc（独立分支，不污染 lease 分发）；否则 onMessage
_dispatchRpc: 取 rpc_id/method/params；
  rpc_id 缺失 → 丢弃 warn；method 未注册 → 回 method_not_found；
  handler 抛 RpcError → 原码回填；抛普通 Error → internal；任何异常内部消化不冒泡
重连: close 后若 _running=true → 定时 RECONNECT_INTERVAL_MS 重连
```

## 注意事项
- **RPC 与 lease 分发隔离**：daemon:rpc 走 `_dispatchRpc` 独立分支，不进 onMessage（不污染现有 lease 消息分发）。
- `rpc_id` 是回填唯一依据，缺失无法回发 → 丢弃（backend 那侧 future 超时 → 504）。
- send 未连接直接丢弃不缓冲（对齐 Python 无缓冲语义）；非法 JSON 仅 warn 不断连。
- 同名 RPC method 重复注册：后者覆盖前者 + 经 onError 发 warn（便于测试断言）。
- `_running` 语义：已 start 未 stop；false 时禁止重连（对齐 Python `if self._running`）。
- URL 构造 1:1 对齐 Python _build_ws_url：http→ws、https→wss、其它兜底补 ws://。
- 业务层（file-rpc 的 listDir）由 daemon 在 `_wsLoop` 构造 WsClient 后调 registerRpcHandler 注入，ws-client 自身不含 fs 逻辑。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
