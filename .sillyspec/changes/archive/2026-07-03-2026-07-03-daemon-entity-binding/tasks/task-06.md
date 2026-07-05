---
id: task-06
title: WS Hub 改 per-daemon（连接键 daemon_instance_id + 握手带 daemon_local_id）
author: qinyi
created_at: 2026-07-03 11:30:00
priority: P0
depends_on: [task-01]
blocks: [task-07, task-14]
allowed_paths: [backend/app/modules/daemon/ws_hub.py, backend/app/modules/daemon/router.py, backend/app/modules/daemon/protocol.py, backend/app/modules/daemon/session/service.py]
---
## goal
> DaemonWsHub._connections 键从 runtime_id 改 daemon_instance_id，全方法签名改 daemon_id，WS 握手带 daemon_local_id，payload 内 runtime_id 标识 provider 会话。
## implementation
- ws_hub.py `_connections: dict[uuid.UUID, WebSocket]` 键语义从 runtime_id → daemon_instance_id。
- 全方法签名 `runtime_id` → `daemon_id`：connect/disconnect/send_to_runtime/notify_task_available/send_wakeup/send_heartbeat_ack/send_session_control/send_permission_response/send_self_update/send_rpc/is_connected/connected_runtime_ids（后者改 connected_daemon_ids）。
- protocol.py 握手 message 字段从 runtime_id 改 daemon_local_id（design §5.3）。
- daemon/router.py ws 握手端点收 daemon_local_id，查 daemon_instances.id 注册连接（同 daemon_id 双连接 → 驱逐旧连接 code=4000 replaced，design §9.3）。
- payload 内保留 runtime_id（标识具体 provider 会话，如 session_control 针对哪个 provider）；WS receive loop 校验 payload.runtime_id 属于 connection.daemon_id（design §10 风险对策）。
- daemon/session/service.py（10+ 处 send_session_control）调用参数 runtime_id → daemon_id（WS Hub 签名改后连锁适配；payload 内 runtime_id 标识 provider session）。
## acceptance
- WS Hub 连接数 = 在线 daemon 实体数，不再 × provider（验收 5）。
- 同 daemon_id 重连 → 旧连接被替换（code=4000）；不同 daemon 各一条独立连接。
- session_control/permission_response/rpc 等按 daemon_id 路由，payload.runtime_id 正确分发到对应 provider 会话。
## verify
- `cd backend && uv run pytest app/modules/daemon -k "ws_hub or ws_handshake or connect"`
## constraints
- 严格依据 design §5.3 + §9.3 WS 生命周期契约 + decisions D-006（per-daemon WS）。
- WS breaking 兼容（D-007）：旧 daemon 握手仍带 runtime_id → 新 backend 期望 daemon_local_id → 握手失败关闭，日志提示升级 daemon。
- payload.runtime_id 与 connection.daemon_id 不一致（脏数据）→ drop message + warn 日志，不抛异常（design §10）。
- 不动 daemon_task_leases / daemon_change_writes 的 runtime_id FK（D-003）；change-write 端点走 HTTP 轮询，WS breaking 不影响（design §6 X-003）。
