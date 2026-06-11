---
schema_version: 1
doc_type: module-card
module_id: daemon
author: qinyi
created_at: 2026-06-10T16:55:00
---

# daemon

## 定位
核心守护进程管理。编排 daemon 完整生命周期：启动 -> 检测 agent -> 注册到 server -> 启动三个后台循环（WebSocket / heartbeat / poll）。负责接收 server 推送的 task_available 消息，驱动 lease claim -> start -> execute -> complete 全流程。

## 契约摘要
- `Daemon(config, client, task_runner?)` — 初始化
- `start()` — 启动：检测 agent -> 注册每个 -> 启动三个循环
- `stop()` — 优雅关闭：取消所有 task -> 等待完成 -> 关闭 HTTP client
- `is_running -> bool` — 运行状态查询

## 关键逻辑
```
start()
  1. AgentDetector.detect_all() → available_agents
  2. for each agent: client.register(runtime_id="{base_id}--{name}", provider, version, protocol)
     → _registered_runtimes[name] = runtime_id
  3. _fire(_heartbeat_loop())  # 每 heartbeat_interval 发心跳
  4. _fire(_poll_loop())       # 每 poll_interval 轮询（目前 no-op）
  5. _fire(_ws_loop())         # WebSocket 长连接，自动重连

_execute_task(payload)
  claim_lease → start_lease → task_runner.execute_task → complete_lease
```

## 注意事项
- 每个 agent 独立注册为 `"{base_runtime_id}--{agent_name}"` 格式的 runtime
- WebSocket 自动重连间隔 5 秒，URL 由 server_url 自动推导（http->ws, https->wss）
- `_poll_loop` 当前是 no-op placeholder，等待 server 端 `/tasks/pending` API
- `_fire()` 创建的 asyncio.Task 被收集到 `_tasks` set，stop 时统一 cancel
- `_handle_ws_message` 仅处理 `MSG_TASK_AVAILABLE` 和 `MSG_HEARTBEAT_ACK`
- 依赖：agent-detector, client, config, protocol

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
