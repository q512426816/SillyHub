---
schema_version: 1
doc_type: module-card
module_id: protocol
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:10:13
---
# protocol

## 定位
daemon ↔ backend 通信协议的常量与消息载荷类型定义层。集中所有 WebSocket 消息类型（`daemon:<action>` 前缀）、lease 状态机字面量、WS 路径与 REST 前缀，以及 session/permission 各 payload 结构体。是 daemon、ws-client、interactive 共享的"契约字典"，避免字面量散落。与 backend `protocol.py` 逐字对齐（`DAEMON_MSG_*`、`STATE_*`）。

## 契约摘要
- `MSG`（const 对象）/ `MsgType`（值联合）：所有 WS 消息 action 字面量。
  - runtime 生命周期：REGISTER、HEARTBEAT/HEARTBEAT_ACK、MARK_OFFLINE。
  - lease：TASK_AVAILABLE、LEASE_CLAIM、LEASE_START、LEASE_COMPLETE、LEASE_MESSAGES。
  - RPC：RPC（双向）、RPC_RESULT。
  - session：SESSION_INJECT、SESSION_INTERRUPT、SESSION_END、SESSION_RESUME。
  - permission：PERMISSION_REQUEST、PERMISSION_RESPONSE。
- `LEASE_STATE` / `LeaseState`：`pending|running|completed|failed|cancelled`。
- `WS_PATH = '/api/daemon/ws'`；`REST_PREFIX = '/api/daemon'`。
- Payload interface：SessionInjectPayload、SessionControlPayload、PermissionRequestPayload、PermissionResponsePayload（字段 snake_case 对齐 backend Pydantic）。

## 关键逻辑
```
// 纯常量与类型层，无运行时逻辑
MSG.SESSION_INJECT     = 'daemon:session_inject'
MSG.PERMISSION_REQUEST = 'daemon:permission_request'
LEASE_STATE = { PENDING:'pending', RUNNING:'running', COMPLETED:'completed',
                FAILED:'failed', CANCELLED:'cancelled' }
// RPC_RESULT payload 成功 {rpc_id, result} / 失败 {rpc_id, error:{code,message}}
```

## 注意事项
- 所有 action 字面量前缀 `daemon:` 不可漏，改动任一字面量必须同步 backend `protocol.py` 的 `DAEMON_MSG_*`，否则 WS 路由失配。
- session 三类控制（INJECT/INTERRUPT/END）+ PERMISSION_* 是 interactive 会话的核心通道，配合 SessionManager/ClaudeSdkDriver 消费。
- payload 字段用 snake_case（runtime_id/claim_token/agent_run_id），与 backend Pydantic 模型一致；daemon 内部转 camelCase 由 daemon.ts 归一化。
- 本模块零依赖、纯定义，不含任何 I/O。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
