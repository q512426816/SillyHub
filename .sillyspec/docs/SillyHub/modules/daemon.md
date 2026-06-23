---
schema_version: 1
doc_type: module-card
module_id: daemon
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:33
---
# daemon

## 定位
跨组件「本地执行交互」功能域，由 backend daemon 模块（注册/心跳/租约/会话/WebSocket Hub）与 sillyhub-daemon（Node ESM 进程，承载 claude-agent-sdk 实际执行）共同构成。backend 是调度与状态权威，daemon 进程是执行体，两者经 WebSocket + REST 双向通信，支持批处理 lease 与交互式会话两种执行模式。

## 契约摘要
- backend API（prefix=/daemon）：runtime 注册 `POST /daemon/runtimes`、心跳 `/heartbeat`、租约 lifecycle（claim/start/complete/messages）、交互式 session 端点（`/sessions`、`/sessions/{id}/inject|interrupt|end|reopen|recover|confirm-reconnected|mark-recovery-failed`、`/sessions/{id}/permissions/{rid}/response`、`/sessions/{id}/dialogs`、`/sessions/{id}/stream` SSE、`/sessions/{id}/logs`）。
- backend service：`DaemonService`（runtime/lease 生命周期、`submit_messages`、`close_interactive_run`、`sync_agent_run_status`、`cleanup_stale_runtimes`）；`DaemonLeaseService`（claim_task/heartbeat_lease/expire_overdue_leases/cancel_lease，claim_token 鉴权）；`SessionService`（交互式会话 create_session/inject_session/interrupt_session/end_session/recover_session_after_daemon_restart）。
- `DaemonWsHub`：维护 runtime→WebSocket 映射，提供 `notify_task_available`、`send_session_control`、`send_permission_response`、`send_rpc`（带 rpc_id 关联的 RPC，如 list_dir）、`broadcast`。
- 协议（`protocol.py` 双端对应）：`daemon:task_available / heartbeat / heartbeat_ack / lease_claim / lease_start / lease_complete / lease_messages / rpc / rpc_result / session_inject / session_interrupt / session_end / session_resume / permission_request / permission_response`。Node 端 `MSG`/`LEASE_STATE`/`WS_PATH='/api/daemon/ws'`/`REST_PREFIX='/api/daemon'` 与之对齐。
- Node daemon 进程：`cli.ts`（start/stop/status/logs，PID 文件管理，信号由 Daemon 内部 handler 处理）；`Daemon` 类（detectAgents→register→三循环：lease 领取、ws 心跳、会话控制）；`TaskRunner`（批处理 lease 执行，renderAgentEvent/resolveTimeout/resolveMaxRetries/isSpawnLevelFailure）；`interactive/`（claude-sdk-driver、session-manager、input-queue、permission-resolver、session-store-persistence）；`HubClient`（REST）、`WsClient`（WS + RPC）、`RecoveryCoordinator`（重启后会话收敛）。

## 关键逻辑
```
# 批处理 lease 生命周期（claim_token 鉴权）
DaemonService.create_lease → daemon 领取 → DaemonLeaseService.claim_task(claim_token)
→ TaskRunner 执行 agent → lease_complete → _trigger_stage_completion_callback(agent_run)
# 交互式会话（codex/claude）
SessionService.create_session → DaemonWsHub.send_session_control
→ Node interactive/session-manager 调 claude-agent-sdk → inject/interrupt/end 上行
→ recover_session_after_daemon_restart 在 daemon 重启后收敛 crashed run
# WebSocket RPC（如目录列表）
backend send_rpc(rpc_id) → daemon 执行 → rpc_result(rpc_id) → resolve_rpc
```

## 注意事项
- lease 与 session 是两套执行模型：lease 为无状态批处理（task_id 关联），session 为有状态长交互（有 current_run、turn 冲突 `DaemonSessionTurnConflict`）。
- claim_token 是 lease/session 操作的鉴权凭证，daemon 持有；token 不匹配抛 `LeaseTokenMismatch`。
- daemon 重启后会话收敛是关键不变量：`recover_session_after_daemon_restart` + Node 端 `RecoveryCoordinator` + `confirm-reconnected`/`mark-recovery-failed` 端点配合，避免会话悬挂。
- `/sessions/{id}/end` 端点的 daemon 身份用 runtime 归属校验（非 lease），曾有 404 修复记录，改动需注意归属判定路径。
- 当前活跃变更 `2026-06-23-codex-interactive-session` 在重构交互式会话生命周期，本卡片描述的 session 端点集合会随之演进。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
