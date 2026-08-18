---
schema_version: 1
doc_type: module-card
module_id: protocol
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 消息协议常量字典（protocol）

## 定位
daemon ↔ backend WebSocket 消息协议常量与 lease 状态常量（`src/protocol.ts`）。
集中所有消息类型字面量（`daemon:<action>` 前缀）、lease 状态机、WS/REST 端点路径
及 session/permission 各 payload 结构体。纯定义层无 I/O，是 daemon / ws-client /
interactive 共享的「契约字典」，与 backend `protocol.py` 的 `DAEMON_MSG_*` / `STATE_*`
逐字对齐。

## 契约摘要
- `MSG`（const）/ `MsgType`（19 种值联合）：
  - runtime 生命周期：`REGISTER`、`HEARTBEAT`（双向）、`HEARTBEAT_ACK`。
  - lease：`TASK_AVAILABLE`（S→D）、`LEASE_CLAIM` / `LEASE_START` / `LEASE_COMPLETE` /
    `LEASE_MESSAGES`（D→S）、`LEASE_CANCEL`（S→D，batch lease 即时取消）。
  - RPC：`RPC`（S→D，rpc_id 由 backend 生成）、`RPC_RESULT`（D→S，成功带 result /
    失败带 error 二者互斥；error.code ∈ forbidden/not_found/method_not_found/internal）。
  - 交互式会话：`SESSION_INJECT`（注入 prompt 跑新 turn）、`SESSION_INTERRUPT`
    （仅 turn 级中断）、`SESSION_END`（终结 session+lease）、`SESSION_RESUME`
    （跨进程还原历史会话）、`PERMISSION_REQUEST`（D→S）、`PERMISSION_RESPONSE`
    （S→D，5min 超时 backend 自动 deny）。
  - 控制：`SELF_UPDATE`（daemon 自更新后退场）、`PROVIDER_CONFIG_CHANGED`
    （会话供应商热切换，provider_config=null 表停止回退本机凭证）。
- `LEASE_STATE` / `LeaseState` 5 态：`pending | running | completed | failed | cancelled`。
- 端点：`WS_PATH = '/api/daemon/ws'`（runtime_id 由 WsClient 拼 query）；
  `REST_PREFIX = '/api/daemon'`。
- Payload：`SessionInjectPayload`（session_id/lease_id/run_id/prompt/claim_token）、
  `SessionControlPayload`（session_id/lease_id，INTERRUPT/END 共用）、
  `ProviderConfigChangedPayload`（session_id + provider_config: ProviderConfig|null，
  null 表停止回退本机凭证 D-004@v1）、`PermissionRequestPayload`（session_id/
  run_id/request_id/tool_name/input/tool_use_id? + 可选 dialog_kind/dialog_payload——
  onUserDialog AskUserQuestion 扩展，旧 backend 不识别时按普通 allow/deny 兼容）、
  `PermissionResponsePayload`（request_id 原样回填 + decision 'allow'|'deny' +
  message? + 可选 dialog_result，daemon 透传 SDK UserDialogResult）。
- 其余 payload 形态（注释约定，无独立 interface 导出）：RPC `{ rpc_id, method,
  params }`；HEARTBEAT_ACK 含 pending_operations；LEASE_CANCEL `{ runtime_id,
  lease_id }`；SELF_UPDATE `{ runtime_id?, version? }`（version 仅日志用）；
  SESSION_RESUME `{ session_id, lease_id, agent_session_id, cwd, provider,
  runtime_id }`（daemon 侧归一化为 PersistedSessionRecord）。

## 关键逻辑
```
// 纯常量与类型层，无运行时逻辑
MSG.LEASE_CANCEL = 'daemon:lease_cancel'          # 复用 AbortController → _killChild
MSG.PROVIDER_CONFIG_CHANGED = 'daemon:provider_config_changed'
LEASE_STATE = { PENDING:'pending', RUNNING:'running', COMPLETED:'completed',
                FAILED:'failed', CANCELLED:'cancelled' }
```

## 注意事项
- **改动纪律**：任何字面量必须先改 backend 对端（protocol.py / router.py），任一
  字符漂移即双侧契约单测失败（design R-02）。
- 新增消息对旧 daemon 的兼容靠 daemon 侧 default 分支仅 warn（LEASE_CANCEL /
  PROVIDER_CONFIG_CHANGED 均此模式）；WS 即时推送是 best-effort，失败由心跳轮询兜底。
- payload 字段 snake_case 与 backend Pydantic 对齐；daemon 入口做 snake/camel
  双写归一化（防 task_no_lease_id 类丢消息）。
- 与 types.ts 互相 import（protocol↔types 循环引用，实测存在，types 侧为
  type-only）；SessionInjectPayload.claim_token 是 lease 级令牌（gap-2），供
  submitMessages / notifyRunResult 复用。
- LEASE_CANCEL 与心跳轮询双触发幂等由 taskRunner.cancel 内部保证（design R-06）。
- 语义边界：SESSION_INTERRUPT 仅 turn 级（SDK 产 result subtype=
  error_during_execution，session 仍 active），SESSION_END 才终结 session+lease；
  PROVIDER_CONFIG_CHANGED 生成中 turn 只覆盖写 pendingSwitch 不中断，turn 边界
  完成切换（D-002@v1 等 turn 边界语义）。
- UUID 字段 TS 侧 string、Python 侧 uuid.UUID（自动解析）；每次新增消息先补双侧
  契约单测再动 daemon 消费代码。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
