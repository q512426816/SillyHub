---
schema_version: 1
doc_type: module-card
module_id: ws-client
author: qinyi
created_at: 2026-06-14T10:40:45+08:00
---

# ws-client

## 定位
WebSocket 客户端，从 Python 版 `daemon.py` 内联的 WS 循环拆出的独立模块。基于 `ws` 库建立与 SillyHub server 的长连接，处理注册 → 心跳 → task_available 消息分发 → 断线 5 秒自动重连。WS 不可用时降级为 HTTP 轮询兜底。daemon 持有一个 WsClient 实例并通过回调消费消息。

## 契约摘要
- `WsState` — 连接状态字面量联合：`connecting | connected | reconnecting | closed`
- `WsClientCallbacks` — 回调接口
  - `onTaskAvailable?(payload: LeasePayload): void`
  - `onHeartbeatAck?(): void`
  - `onClose?(code, reason): void`
  - `onError?(err: Error): void`
  - `onStateChange?(state: WsState): void`
- `WsClientOptions` — 构造参数：`url`（http(s) 会自动转 ws(s)）、`runtimeId`、`callbacks`、`serverUrl`（HTTP 轮询兜底用）
- `WsClient` — 客户端类
  - `start(): Promise<void>` — 建立连接并启动心跳与重连守卫
  - `stop(): Promise<void>` — 主动关闭并停止重连
  - `send(type: string, payload?: unknown): void` — 发送消息（注册 / heartbeat_ack / lease_*）
- 重连常量
  - `RECONNECT_INTERVAL_MS = 5000` — 初始重连间隔
  - `RECONNECT_MAX_INTERVAL_MS` — 退避上限
  - `CONNECT_TIMEOUT_MS = 10000` — 建连超时
  - `CLOSE_TIMEOUT_MS = 5000` — 关闭超时

## 关键逻辑
```
start()
  ws = new WebSocket(deriveWsUrl(serverUrl))  // http→ws, https→wss
  send(MSG.register, { runtimeId, agents })
  on("open") → state=connected, 启动心跳定时器
  on("message") → parse →
    MSG.task_available → callbacks.onTaskAvailable(payload)
    MSG.heartbeat       → 回 heartbeat_ack
  on("close"/"error") → state=reconnecting → 5s 后重连
                         WS 持续失败 → 切换 HTTP 轮询兜底
```

## 注意事项
- URL 推导：`serverUrl` 的 `http://` → `ws://`、`https://` → `wss://`，路径拼接 `WS_PATH`
- 连接超时 10 秒（`CONNECT_TIMEOUT_MS`），关闭超时 5 秒（`CLOSE_TIMEOUT_MS`）
- 重连初始间隔 5 秒（`RECONNECT_INTERVAL_MS`），带退避但不超过 `RECONNECT_MAX_INTERVAL_MS`
- 消息类型与 server 端 `backend/app/modules/daemon/protocol.py` 必须一致（G-02 不变）
- 不在本模块处理 lease claim/start/complete——这些是 daemon 收到 task_available 后通过 REST 走 HubClient 完成
- 依赖 protocol 模块（MSG 常量）
- 被 daemon 模块使用

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
