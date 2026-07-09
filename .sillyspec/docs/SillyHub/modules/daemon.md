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
- `DaemonWsHub`：维护 runtime→WebSocket 映射，提供 `notify_task_available`、`send_session_control`、`send_permission_response`、`send_rpc`（带 rpc_id 关联的 RPC，如 list_dir、list_roots）、`broadcast`。
- 协议（`protocol.py` 双端对应）：`daemon:task_available / heartbeat / heartbeat_ack / lease_claim / lease_start / lease_complete / lease_messages / rpc / rpc_result / session_inject / session_interrupt / session_end / session_resume / permission_request / permission_response`。Node 端 `MSG`/`LEASE_STATE`/`WS_PATH='/api/daemon/ws'`/`REST_PREFIX='/api/daemon'` 与之对齐。
- Node daemon 进程：`cli.ts`（start/stop/status/logs，PID 文件管理，信号由 Daemon 内部 handler 处理）；`Daemon` 类（detectAgents→register→三循环：lease 领取、ws 心跳、会话控制）；`TaskRunner`（批处理 lease 执行，renderAgentEvent/resolveTimeout/resolveMaxRetries/isSpawnLevelFailure）；`interactive/`（claude-sdk-driver、session-manager、input-queue、permission-resolver、session-store-persistence、write-guard）；`HubClient`（REST）、`WsClient`（WS + RPC）、`RecoveryCoordinator`（重启后会话收敛）。

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
- allowed_roots 写白名单：interactive 会话经 session-manager 的 canUseTool 包装器注入 write-guard（`isWriteWithinAllowedRoots`），把显式写（Write/Edit/MultiEdit）与 Bash 间接写（重定向 `>`/`>>`、cp/mv/install、tee、mkdir、touch）限制在 daemon config.allowed_roots 内，读自由；batch（lease）模式走 `--settings` permission 注入。`isPathUnderAnyRoot` 做边界敏感前缀比较时，盘符根（`D:\`）与 Unix 根（`/`）经 pathResolve 后已含尾部 sep，前缀不可再补 sep，否则产生双反斜杠/双斜杠前缀误判越界（ql-20260702-007）。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->

## 变更索引
- ql-20260702-007-f1a8 | 修复 isPathUnderAnyRoot 盘符根/Unix 根路径前缀比较（root 已含尾 sep 不再补，消除配 D 盘做 allowed_root 仍误 deny）
- ql-20260703-001-7e3a | session-manager Bash tool 跨 shell 提取遗漏修复（合并 bash+powershell+cmd 三提取取并集，PowerShell Set-Content 经 Bash tool 绕过 PolicyEngine 的真机 bug）
- ql-20260703-002-c2d4 | runtimeIdProvider 用 config.runtime_id（非注册 runtime）致 PolicyCache 永久 miss，配 allowed_roots 后 interactive session 仍 deny（改 daemon.resolveRuntimeId(provider)）
- ql-20260703-003-f9d7 | 审计页免 wid 路由——后端加 GET /daemon/runtimes/{rid}/policy-audit + 前端 usePolicyAuditByRuntime（前端审计页不再要求 ?wid）
- ql-20260706-003-8a3f | runtimes 页可写目录配置不回显修复（daemon-entity-binding 上提 allowed_roots 到 daemon_instances 后，router._runtime_read instance 分支只填 daemon_version/build_id 漏填 allowed_roots + PUT /allowed-roots 端点 model_validate 不传 instance；统一 _runtime_read 填充 instance.allowed_roots + PUT 复用 _runtime_read）
- 2026-07-07-daemon-machine-runtime-hierarchy | /runtimes 页改 Machine→Runtime 两级手风琴（前端 page 重构）；后端新增 GET/PATCH/POST /api/daemon/machines 机器级聚合读 + 别名 + self-update（runtime/service.list_machines/update_machine_alias/_get_owned_instance，N+1 规避 runtimes_by_instance，self-update 复用既有 daemon:self_update WS 消息仅改路由键 instance_id，0 改表 0 破坏既有契约 §14 生命周期豁免）
- 2026-07-09-remote-folder-picker | 远程目录浏览器：daemon 新增 `list_roots` RPC（磁盘根列举 Win 盘符/Unix `/`，src/roots-rpc.ts）+ 删 `browse_folder` handler（PowerShell Shell.BrowseForFolder）；backend 加 `POST /runtimes/{id}/list-roots` 代理 + 删 browse-folder 端点；前端 `RemoteFolderPicker` 自治组件复用（listRoots+listDir 懒加载+手输校验+错误降级）
