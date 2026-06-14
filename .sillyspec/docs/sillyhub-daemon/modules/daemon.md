---
schema_version: 1
doc_type: module-card
module_id: daemon
author: qinyi
created_at: 2026-06-10T16:55:00
---

# daemon

## 定位
核心守护进程管理。编排 daemon 完整生命周期：启动 → 检测 agent → 注册到 server → 启动心跳与 WebSocket 监听循环。负责接收 server 推送的 task_available 消息，驱动 lease claim → start → execute → complete 全流程。WebSocket 逻辑已拆出独立模块 ws-client，本模块通过回调消费消息。

## 契约摘要
- `DaemonOptions` — 构造参数：config / client / taskRunner
- `Daemon(options)` — 初始化
- `start(): Promise<void>` — 启动：检测 agent → 注册每个 → 启动心跳循环与 WS 客户端
- `stop(): Promise<void>` — 优雅关闭：取消所有 task → 等待完成 → 关闭 WS 与 HTTP client
- `isRunning: boolean` — 运行状态查询（getter）

## 关键逻辑
```
start()
  1. AgentDetector.detectAll() → availableAgents
  2. for each agent: client.register({ runtimeId: `${baseId}--${name}`, provider, version, protocol })
     → registeredRuntimes[name] = runtimeId
  3. 启动心跳循环：每 heartbeatInterval 发 client.heartbeat
  4. new WsClient(url, callbacks)
       onTaskAvailable → _executeTask(payload)
       onHeartbeatAck / onClose / onError
       wsClient.start()  // 内含 5s 自动重连 + HTTP 轮询兜底

_executeTask(payload)
  claimLease → startLease → taskRunner.executeTask → completeLease
```

## 注意事项
- 每个 agent 独立注册为 `"{base_runtime_id}--{agent_name}"` 格式的 runtime
- WebSocket 自动重连逻辑下沉到 ws-client（间隔 5 秒，URL 由 server_url 推导 http→ws / https→wss）
- `_handleWsMessage` 仅处理 `MSG.taskAvailable` 和 `MSG.heartbeatAck`
- Node 版用 `setInterval` / `AbortController` 替代 asyncio.Task，stop 时统一清理
- 对外 REST/WS 消息与 lease 状态机与 Python 版完全相同（G-02 不变）
- 依赖：agent-detector, client, config, protocol, ws-client

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
