---
schema_version: 1
doc_type: module-card
module_id: ws-client
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 平台 WebSocket 通道（ws-client）

## 定位
daemon → 平台 backend 的 WebSocket 传输层（`src/ws-client.ts`，Python
`_ws_loop` / `_handle_ws_message` / `_build_ws_url` 1:1 复刻并扩展）。
封装连接生命周期、应用层 keepalive、固定 5s 重连、消息收发，内嵌三条独立分发
分支（lease 消息 / daemon:rpc / policy_update）。只做收发与分发，不含业务：
fs 类 RPC（list_dir 等）由 daemon 把 file-rpc 的 handler 注册进来。

## 契约摘要
- 常量：`RECONNECT_INTERVAL_MS=5000`（固定退避，非指数）、
  `CONNECT_TIMEOUT_MS=10000`、`CLOSE_TIMEOUT_MS=5000`、
  `WS_PING_INTERVAL_MS=30000`、`WS_PONG_TIMEOUT_MS=10000`。
- `WsClientOptions`：`serverUrl`（http origin，内部转 ws/wss，尾斜杠剥掉）/
  `runtimeId`（本 daemon 的 UUID 身份）/ `token?`（Bearer 预留，daemon 形态不用）/
  `apiKey?`（hub API key → X-API-Key 头）/ `callbacks?`。
- `WsClientCallbacks`（全可选）：
  - `onMessage(msg)`——合法 DaemonMessage 才进（非法 JSON 内部 warn 丢弃）；
  - `onConnected()`——每次重连成功都触发；
  - `onDisconnected(code, reason)`——daemon 在此启动 HTTP 轮询兜底
    （code 1000 正常 / 1006 异常 / 4001 invalid runtime_id 等）；
  - `onError(err)`——仅日志用，不阻塞重连；
  - `onPolicyUpdate(runtimeId, allowedRoots, version)`——策略热更新推送。
- `WsClient`：`connect()`（幂等）/ `close()`（幂等，close(1000) + 5s 强杀）/
  `send(msg): boolean` / `sendHeartbeatAck(payload?)` /
  `registerRpcHandler(method, handler)` / `state` / `isConnected` /
  `lastMessageAt`（epoch ms 或 null）。
- `RpcHandler`（同步/异步皆可，返回值作 RPC_RESULT.result）；
  `RpcError(code, message)`——稳定 code：forbidden / not_found /
  method_not_found / internal；`WsState` 枚举（Idle/Connecting/Connected/Reconnecting）。

## 关键逻辑
```
建连: url = serverUrl(http→ws, https→wss) + /api/daemon/ws + ?daemon_local_id=<runtimeId>
      apiKey 存在 → new WebSocket(url, {headers:{'X-API-Key':apiKey}})
      （backend 升级握手校验该头，缺失 4001 拒）；未配置不传 headers（mock 可连）
_handleMessage: 入口即记 lastMessageAt（非法 JSON 也证明链路活）→
      parse 失败/缺 type 仅 warn 不断连 → type=RPC 走 _dispatchRpc 独立分支；
      'daemon:policy_update' 走 _handlePolicyUpdate 独立分支；其余才进 onMessage
keepalive: 每 30s ws.ping()，10s 未收 pong → terminate → 既有 close→重连路径
重连: close 后 _running=true → 定时固定 5s 再 connect（幂等防重连风暴）
_dispatchRpc: rpc_id 缺失→丢弃(backend 侧 future 超时→504)；未注册 method→
  method_not_found；RpcError→原 code 回填；普通 Error/reject 任意值→internal；
  全部异常内部消化，绝不冒泡到 WS 接收路径
```

## 注意事项
- **身份与鉴权**：runtimeId 以 `daemon_local_id` 查询参数标识（连接即注册，
  不主动发 register）；apiKey 经升级请求头 X-API-Key 携带，仅进请求头不落日志。
- **keepalive 是补坑产物**：npm ws 库默认不发 ping（Python websockets 默认 20s），
  漏配时经 docker NAT 的链路被中间层按 idle 掐断（实测每 5-10min 一次），大 RPC
  （get_spec_bundle 打包 ~16s 无数据流）撞进断连窗口即 mid-rpc cancel
  （HTTP_504_DAEMON_RUNTIME_OFFLINE）；30s ping 把断连从「被动撞窗口」收敛到
  「keepalive 周期保活」。
- `lastMessageAt`（perf-remediation task-09 / D-003@v1 假活检测）：daemon
  _pollLoop 据此门控——isConnected 且距今 <90s 时跳过 lease HTTP 轮询
  （TASK_AVAILABLE 推送兜底）；只读 getter，不暴露可写状态。
- policy_update 的消息 type 用字符串字面量 `'daemon:policy_update'` 而非 MSG
  常量（protocol.ts 未加该常量），与 backend protocol.py 逐字对齐，任一字符
  漂移即推送断链；payload 守卫（runtime_id 非空 / allowed_roots 是数组且过滤
  非串元素、空数组合法=清空策略 / version 有限数）失败即丢弃 + onError，
  version 去重与 PolicyCache 写入归 daemon 层回调。
- `send` 未连接（readyState≠OPEN）返回 false 丢弃，不缓冲不抛（对齐 Python
  无缓冲语义）；`_running=false` 时禁止重连（close 后停在 Idle）。
- 同名 RPC method 重复注册：后者覆盖 + 经 onError 发 warn（生产每 method 只
  注册一次）；`_sendRpcResult` 的 result 与 error 互斥（error 非空不写 result）。
- 所有定时器 unref（进程退出不阻塞）；`_createSocket`/`_buildWsUrl` 为
  protected，测试可 stub；error 后不直接改 state——error 必然跟 close，
  由 _handleClose 统一驱动状态机。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
