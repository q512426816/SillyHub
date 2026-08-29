/**
 * Daemon ↔ Server WebSocket 消息协议常量与 lease 任务状态常量。
 *
 * 所有字符串值**逐字对齐** backend 对端：
 *   - WS 消息类型: backend/app/modules/daemon/protocol.py (DAEMON_MSG_*)
 *   - Lease 状态:  sillyhub-daemon/sillyhub_daemon/protocol.py (STATE_*)
 *   - WS 路径:     sillyhub-daemon/sillyhub_daemon/daemon.py:160
 *   - REST 前缀:   backend/app/modules/daemon/router.py:44 + main.py:237
 *
 * 修改任何常量前必须先改 backend 对端并走契约单测（见 task-04）。design.md G-02 / R-02。
 *
 * @module protocol
 */

import type { ProviderConfig } from './types.js';

// ── WebSocket 消息类型 ───────────────────────────────────────────────────────
// 值形如 `daemon:<action>`，前缀 `daemon:` 不可漏。

/** Server → Daemon 消息类型 + 双向消息（HEARTBEAT 既入又出）。 */
export const MSG = {
  /** Server → Daemon：有 lease 任务可认领（带 runtime_id / task_id / lease_id payload）。 */
  TASK_AVAILABLE: 'daemon:task_available',
  /** 双向心跳：Daemon 上行保活，Server 下行探活。 */
  HEARTBEAT: 'daemon:heartbeat',

  /** Daemon → Server：首次连接注册 runtime（agent_name + capability）。 */
  REGISTER: 'daemon:register',
  /** Daemon → Server：对 Server HEARTBEAT 的应答（含 pending_operations）。 */
  HEARTBEAT_ACK: 'daemon:heartbeat_ack',
  /** Daemon → Server：声明开始认领某 lease（runtime_id + lease_id）。 */
  LEASE_CLAIM: 'daemon:lease_claim',
  /** Daemon → Server：lease 执行正式开始（携带 claim_token）。 */
  LEASE_START: 'daemon:lease_start',
  /** Daemon → Server：lease 执行完成（result: status + patch + stats）。 */
  LEASE_COMPLETE: 'daemon:lease_complete',
  /** Daemon → Server：lease 执行期间增量上报 agent 消息事件。 */
  LEASE_MESSAGES: 'daemon:lease_messages',

  /**
   * Server → Daemon：远程过程调用请求（FR-03 / D-005@v1 / design §7.1）。
   *
   * payload: `{ rpc_id: string, method: string, params: Record<string, unknown> }`。
   * rpc_id 由 backend（task-04）生成，daemon 在 `RPC_RESULT` 中**原样回填**，不自己生成。
   *
   * 与 backend `DAEMON_MSG_RPC = "daemon:rpc"`（task-04 `protocol.py`）逐字对齐——
   * 任一字符漂移即 task-03 契约单测失败（design R-02）。
   */
  RPC: 'daemon:rpc',

  /**
   * Daemon → Server：RPC 结果（成功带 `result` / 失败带 `error`，二者互斥）。
   *
   * payload 成功：`{ rpc_id: string, result: unknown }`。
   * payload 失败：`{ rpc_id: string, error: { code: string, message: string } }`。
   *
   * `error.code` 取值（task-05 file-rpc/ws-client）：
   *   - `forbidden`：path 越界 allowed_roots（FR-04 / D-002）
   *   - `not_found`：path 不存在或不是目录
   *   - `method_not_found`：未注册的 method
   *   - `internal`：其他 fs 错误 / handler 未捕获异常
   *
   * 与 backend `DAEMON_MSG_RPC_RESULT = "daemon:rpc_result"`（task-04）逐字对齐。
   */
  RPC_RESULT: 'daemon:rpc_result',

  // ── 交互式会话控制（task-03，D-002@v3 SDK driver 层） ───────────────────────
  // 覆盖 FR-02（多轮追问）/ FR-04（打断本轮）/ FR-05（结束会话）/ FR-07（权限远程人审）。
  // v3 SDK 语义（非 v2 per-turn spawn + resume）：
  //   - INJECT: inputQueue.push + SDK query(AsyncIterable) 消费下一 turn（spike H2）
  //   - INTERRUPT: ClaudeSdkDriver.interrupt(query) → turn 级中断，result(subtype=error_during_execution)（spike D1）
  //   - END: 清理 SessionStore + backend service.end_session 统一入口
  //   - PERMISSION_*: canUseTool 回调 → WS 往返（spike D2，D-007）
  // 与 backend protocol.py DAEMON_MSG_* 逐字对齐（任一字符漂移即双侧契约单测失败）。

  /**
   * Server → Daemon：注入新 prompt 触发新 turn（FR-02）。
   *
   * v3 SDK 语义：backend 已创建新 AgentRun（status=running），
   * daemon 收到后 SessionManager.inject → inputQueue.push(prompt)，
   * SDK query(AsyncIterable) 消费下一条跑下一 turn（同进程同 session，
   * 第二轮含首轮上下文，spike H2）。payload: SessionInjectPayload。
   */
  SESSION_INJECT: 'daemon:session_inject',

  /**
   * Server → Daemon：打断当前 turn（FR-04）。
   *
   * v3 SDK 语义：daemon 收到后 ClaudeSdkDriver.interrupt(query)，
   * SDK 当前 turn 产 result(subtype=error_during_execution)，当前
   * AgentRun=failed，session 仍 active（spike D1）。仅 turn 级，非 session 级。
   * payload: SessionControlPayload。
   */
  SESSION_INTERRUPT: 'daemon:session_interrupt',

  /**
   * Server → Daemon：结束会话（FR-05）。
   *
   * v3 SDK 语义：如有当前 turn 则先 interrupt，随后清理 SessionStore +
   * backend service.end_session 统一入口更新 agent_sessions.status=ended +
   * daemon_task_leases.status=completed。payload: SessionControlPayload。
   */
  SESSION_END: 'daemon:session_end',

  /**
   * Server → Daemon：恢复已结束/失联的交互式会话（session-history-enhance task-08 / FR-2）。
   *
   * backend（task-07）在用户 reopen 历史会话时下发：daemon 此时该 session 尚未在
   * 内存 SessionStore（已 end 或进程重启），用 payload 里的 agent_session_id 调
   * SessionManager.restoreAndReconnect（driver.start({resume}) 跨进程还原上下文），
   * 随后 markReconnected 切 active → 上报 confirm → backend status=active。
   *
   * payload（snake_case，与 backend DAEMON_MSG_SESSION_RESUME 同名常量逐字对齐）：
   *   { session_id, lease_id, agent_session_id, cwd, provider, runtime_id }
   * daemon 入口归一化为 PersistedSessionRecord（camelCase），与 ql-20260616-006
   * 同风格的 snake/camel 双写归一化（避免 task_no_lease_id 类丢消息）。
   */
  SESSION_RESUME: 'daemon:session_resume',

  /**
   * Daemon → Server：权限审批请求（FR-07 / D-007）。
   *
   * v3 SDK 语义：ClaudeSdkDriver.canUseTool 回调被 SDK 触发时，
   * daemon 不本地自动批准，发本消息 → backend → 前端弹审批卡。
   * payload: PermissionRequestPayload。
   */
  PERMISSION_REQUEST: 'daemon:permission_request',

  /**
   * Server → Daemon：权限审批响应（FR-07 / D-007）。
   *
   * 用户 allow/deny 后 backend 经本消息回传 daemon，daemon resolve
   * canUseTool 回调；5min 未响应 backend 自动发 deny。
   * payload: PermissionResponsePayload。
   */
  PERMISSION_RESPONSE: 'daemon:permission_response',

  /**
   * Server → Daemon：服务端推送 daemon 自更新指令。
   *
   * daemon 收到后调 runDaemonSelfUpdate 下载最新 bundle 替换本地文件，
   * 然后进程退出（由外部 supervisor/install.sh wrapper 重启拉起新版本）。
   *
   * payload: `{ runtime_id?: string, version?: string }`（version 为最新版本号，仅用于日志）。
   */
  SELF_UPDATE: 'daemon:self_update',

  /**
   * Server → Daemon：batch lease 即时取消（change 2026-08-05-daemon-kill-channel-unify
   * task-04 / FR-03 / R-06 / design §5 Phase2 + §7.5）。
   *
   * backend cancel_lease 对 batch lease（kind != interactive）标记 cancelled 后经
   * ws_hub.send_to_runtime 即时 best-effort 推送。daemon 收到后调
   * taskRunner.cancel(leaseId) 复用现有 AbortController → _killChild 即时杀 batch
   * 子进程，不再等心跳周期。发送失败靠现有心跳轮询兜底（task-runner.ts:905 不变，
   * design §9）。payload: LeaseCancelPayload `{ runtime_id, lease_id }`（snake_case，
   * daemon 入口已归一化 leaseId/runtime_id，与 TASK_AVAILABLE 同风格）。
   *
   * 与 backend `DAEMON_MSG_LEASE_CANCEL = "daemon:lease_cancel"`（task-04 protocol.py）
   * 逐字对齐——任一字符漂移即双侧契约单测失败（design R-02）。纯新增消息，旧 daemon
   * 收到走 default 仅 warn（向后兼容，design §9）。双触发幂等（LEASE_CANCEL + 心跳
   * 轮询）由 taskRunner.cancel 内部保证（design §10 R-06）。
   */
  LEASE_CANCEL: 'daemon:lease_cancel',

  /**
   * Server → Daemon：用户对 plan 模式的确认/修订/取消决策（change
   * 2026-08-24-platform-session-feedback-fix task-02 / FR-02 / D-001@v1，
   * verify P0 返工补齐接收端）。
   *
   * backend handle_plan_response 落库 session.config.plan_response 后经
   * ws_hub.send_session_control best-effort 推送。daemon 收到后调
   * ``SessionManager.resolvePlanResponse``：按 run_id 新旧校验后把决策格式化
   * 成用户消息经 inject 注入 InputQueue（当前 turn 在跑则排队到下一 turn），
   * Agent 据此继续执行 / 修订计划 / 终止。
   *
   * payload: PlanResponsePayload（snake_case，与 backend
   * ``DAEMON_MSG_PLAN_RESPONSE = "daemon:plan_response"`` 同名常量逐字对齐）。
   * 纯新增消息，旧 daemon 收到走 default 仅 warn（向后兼容）；daemon 离线时
   * backend delivered=false，决策已落库，重连后可经 UI 重发。
   */
  PLAN_RESPONSE: 'daemon:plan_response',

  /**
   * Server → Daemon：运行中会话的供应商热切换指令（change
   * 2026-08-06-provider-switch-live-session task-06 / FR-04 / D-002@v1 / design §5 Wave2）。
   *
   * backend set/unset_default 经 ws_hub.send_to_runtime 即时推送（best-effort，
   * 失败由心跳轮询兜底，与 LEASE_CANCEL 同模式）。daemon 收到后调
   * ``SessionManager.markPendingSwitch(sessionId, providerConfig)``：
   *   - 空闲 session（status=active 且无在跑 turn）→ 立即 reload（task-08 实现）
   *   - 生成中 turn → 仅覆盖写 ``state.pendingSwitch``，**严格不中断**当前 turn，
   *     turn 收尾（_onResult）检测标记后在 turn 边界完成 reload（D-002@v1 等 turn 边界语义）
   *
   * payload: ``ProviderConfigChangedPayload``（snake_case，与 backend task-02
   * ``DAEMON_MSG_PROVIDER_CONFIG_CHANGED`` 同名常量逐字对齐）。
   * ``provider_config=null`` 表停止 → 回退 daemon 宿主机本机凭证（D-004@v1 第 0 层 env 跳过），
   * daemon 透传 null 给 markPendingSwitch 不拦截。
   *
   * 纯新增消息，旧 daemon 收到走 default 仅 warn（向后兼容 design §9）。
   * 双触发（WS 即时 + 心跳轮询兜底）幂等：markPendingSwitch 覆盖写 pendingSwitch 不累积，
   * reloadWithProvider 内部保证幂等（design R-02 / R-06 同 LEASE_CANCEL）。
   */
  PROVIDER_CONFIG_CHANGED: 'daemon:provider_config_changed',

  /**
   * Server → Daemon：清理本地缓存指令（specs 缓存 / Claude 会话日志 / 备份 / 日志）。
   *
   * daemon 按 cleanup.ts 黑名单删除，未列入清理目标的内容（config.json、locks/、
   * workspaces/、outbox/、runs/ 等）一律保留。fire-and-forget，无需回复。
   *
   * payload: `{}`（当前无参数，后续可扩展 dry_run / keep_recent 等）。
   */
  CLEANUP: 'daemon:cleanup',
} as const;

/** WebSocket 消息类型联合（字面量），用于 DaemonMessage.type。 */
export type MsgType = (typeof MSG)[keyof typeof MSG];

// ── 交互式会话 / 权限控制 payload（task-03，与 backend protocol.py 逐字对齐） ──
// 字段名 snake_case 双侧一致；方向：
//   - SessionInjectPayload / SessionControlPayload / PermissionResponsePayload：Server → Daemon
//   - PermissionRequestPayload：Daemon → Server
// UUID 字段在 TS 侧为 string（序列化 UUID），Python 侧为 uuid.UUID（自动解析）。

/**
 * SESSION_INJECT payload（Server → Daemon，FR-02）。
 * 触发 backend 已创建的新 AgentRun 的执行：daemon inputQueue.push 跑下一 turn。
 */
export interface SessionInjectPayload {
  /** 目标会话 ID（agent_sessions.id，UUID 字符串）。 */
  session_id: string;
  /** 该会话绑定的长生命周期 interactive lease ID（校验匹配，防误操作他人 session）。 */
  lease_id: string;
  /** 本次 turn 对应的 AgentRun ID（backend 在 inject 时已创建，status=running）。 */
  run_id: string;
  /** 用户追问文本（非空字符串，协议层只声明 string，非空校验由 backend service 层做）。 */
  prompt: string;
  /**
   * gap-2（D-002@v3 补丁 design §3）：lease 级 claim_token。
   *
   * backend prepare_interactive_dispatch 时生成写入 lease metadata，首 turn +
   * 后续 inject SESSION_INJECT 均携带。daemon 存入 SessionState.claimToken，
   * 供 onTurnMessage → hubClient.submitMessages + gap-3 notifyRunResult 复用
   *（桥接在 task-04 cli.ts 注入）。
   */
  claim_token: string;
  /**
   * 2026-08-20-session-multimodal-attachments task-07（D-1/D-4/D-9）：附件
   * 列表，仅在有附件时携带（无附件路径与旧 payload 逐字节一致；旧 daemon
   * 忽略未知键，协议向后兼容）。
   *
   * 链路判别口径（与 backend assemble_inject_attachments 对齐）：
   * - kind=image + data → 内联多模态（backend 预读 base64，daemon 直接转
   *   SDK ImageBlock / PDF DocumentBlock）；
   * - kind=image 无 data（D-4 帧闸门超限回拉）→ daemon 经
   *   GET /api/daemon/session-attachments/{id}/content 自行拉取后仍转多模态块；
   * - kind=file → 一律落盘 {cwd}/attachments/（D-9 降级的图片/PDF 同走此
   *   链路，media_type 保留原值供回显）。
   */
  attachments?: SessionInjectAttachment[];
}

/**
 * SESSION_INJECT attachments 列表项（snake_case 对齐协议层逐字对齐惯例）。
 * consumed by task-09（daemon.ts WS 路由 → SessionManager.inject）。
 */
export interface SessionInjectAttachment {
  /** SessionAttachment 行 id（回拉端点路径段）。 */
  id: string;
  /** DB 原始 kind（image|file；D-9 降级的图片/PDF 保留原 kind，供回显）。 */
  kind: 'image' | 'file';
  /** MIME（降级图片/PDF 保留原 media_type，供前端回显缩略图）。 */
  media_type: string;
  /** 展示名（prompt 清单原文件名注记用；落盘为内容寻址 {sha256}.{ext}，展示名不进路径）。 */
  name: string;
  /** 字节数（展示/日志用）。 */
  bytes: number;
  /**
   * 消费链路（backend 全权决策，daemon 不做媒体类型推断）：
   * block=转多模态块（image/* → ImageBlock、application/pdf → DocumentBlock；
   * data 空时先经 content 端点回拉）；disk=下载落盘 cwd/attachments/。
   */
  deliver: 'block' | 'disk';
  /** 内联 base64（deliver=block 且未触发 D-4 回拉时非空）。 */
  data?: string;
  /** 回拉/落盘模式对象键（daemon 实际拉取走 content 端点，此键仅日志）。 */
  object_key?: string;
}

/**
 * SESSION_INTERRUPT / SESSION_END 公共 payload（Server → Daemon，FR-04 / FR-05）。
 * interrupt 仅 turn 级；end 终止 session + lease。
 */
export interface SessionControlPayload {
  session_id: string;
  lease_id: string;
}

/**
 * PLAN_RESPONSE payload（Server → Daemon，FR-02 / D-001@v1，
 * 2026-08-24-platform-session-feedback-fix task-02）。
 *
 * 用户在 Web 端 PlanApprovalCard 选择 confirm/revise/cancel 后，backend
 * handle_plan_response 落库 session.config.plan_response 并经 WS Hub 推送。
 * daemon 调 ``SessionManager.resolvePlanResponse`` 把决策注入 turn。
 * 字段 snake_case 与 backend handle_plan_response 发送 payload 逐字对齐。
 */
export interface PlanResponsePayload {
  /** 目标会话 ID（agent_sessions.id，UUID 字符串）。 */
  session_id: string;
  /** 触发 plan_mode_entered 的 AgentRun ID（daemon 侧做新旧校验）。 */
  run_id: string;
  /** 用户决策：confirm=确认执行 / revise=要求修改 / cancel=取消。 */
  decision: 'confirm' | 'revise' | 'cancel';
  /** revise/cancel 时的用户反馈文本（backend 强制非空；confirm 时 null/缺省）。 */
  feedback?: string | null;
  /** 发送方 runtime ID（backend 侧路由用，daemon 仅日志透传）。 */
  runtime_id?: string;
}

/**
 * PROVIDER_CONFIG_CHANGED payload（Server → Daemon，FR-04 / D-002@v1 / design §5 Wave2）。
 *
 * 触发 daemon ``SessionManager.markPendingSwitch(sessionId, providerConfig)``：
 * 空闲 session 立即 reload；生成中 turn 仅覆盖写 ``state.pendingSwitch`` 不中断，
 * turn 收尾受控切换（design G1/G2）。字段 snake_case 与 backend task-02
 * ``DAEMON_MSG_PROVIDER_CONFIG_CHANGED`` payload 逐字对齐（任一字符漂移即契约单测失败）。
 *
 * ``provider_config=null`` 表停止（用户 unset_default）→ daemon 透传 null，
 * reloadWithProvider 第 0 层 env 跳过 → 回退宿主机本机凭证（D-004@v1）。
 * daemon 入口 snake/camel 双写归一化（同 SESSION_INJECT 风格，ql-20260616-006）。
 */
export interface ProviderConfigChangedPayload {
  /** 目标会话 ID（agent_sessions.id，UUID 字符串）。 */
  session_id: string;
  /** 新供应商配置；null 表示停止（回退本机凭证，D-004@v1）。 */
  provider_config: ProviderConfig | null;
}

/**
 * PERMISSION_REQUEST payload（Daemon → Server，FR-07 / D-007）。
 * canUseTool 回调触发，backend 转发前端弹审批卡。
 */
export interface PermissionRequestPayload {
  session_id: string;
  /** 当前 turn 的 AgentRun ID（定位审批上下文）。 */
  run_id: string;
  /** 审批请求唯一标识（daemon 生成，response 原样回填做关联）。 */
  request_id: string;
  /** SDK 传来的工具名（如 Write/Bash）。 */
  tool_name: string;
  /** 工具调用输入（工具参数 JSON，原样转发）。 */
  input: Record<string, unknown>;
  /** 工具调用 ID（可选，SDK tool_use_id，便于追溯）。 */
  tool_use_id?: string;
  /**
   * onUserDialog 扩展（可选）：SDK UserDialogRequest.dialogKind。
   *
   * 当本字段存在时，表示该 PERMISSION_REQUEST 来自 SDK onUserDialog 回调
   *（AskUserQuestion 的真实路由路径，非 canUseTool），backend/前端据此渲染
   * 对话卡并收集用户选择的答案。向后兼容：旧 backend 不识别此字段时按普通
   * 工具审批处理（allow/deny），daemon 侧 allow 且无 dialog_result 时回 null。
   */
  dialog_kind?: string;
  /**
   * onUserDialog 扩展（可选）：SDK UserDialogRequest.payload（如 AskUserQuestion
   * 的 {questions: [...]}）。原样转发给前端渲染。
   */
  dialog_payload?: Record<string, unknown>;
}

/**
 * PERMISSION_RESPONSE payload（Server → Daemon，FR-07 / D-007）。
 * 用户 allow/deny 或 5min 超时 deny（由 backend 发）。
 */
export interface PermissionResponsePayload {
  session_id: string;
  /** 关联 PERMISSION_REQUEST.request_id（原样回填）。 */
  request_id: string;
  /** 'allow' | 'deny'（deny 映射 SDK canUseTool deny behavior）。 */
  decision: 'allow' | 'deny';
  /** deny 时的原因（可选，透传给模型）。 */
  message?: string;
  /**
   * onUserDialog 扩展（可选）：前端用户在对话卡上选择/填写的答案。
   *
   * 仅当对应的 PERMISSION_REQUEST 带 dialog_kind（来自 onUserDialog 回调）时
   * 才有意义。daemon 收到后透传给 SDK UserDialogResult.result（behavior=
   * 'completed'）。allow 但缺 dialog_result 时 daemon 回 result=null。
   * 向后兼容：旧 daemon 不读此字段，按普通 allow 处理。
   */
  dialog_result?: unknown;
}

// ── 控制指令 kind 词表（2026-08-29-daemon-platform-resilience task-06）──────────
//
// 与 backend `backend/app/modules/daemon/control_commands.py` 的
// KIND_SESSION_INJECT / … / KIND_PROVIDER_CONFIG_CHANGED 六个常量逐字对齐
//（backend task-04 词表，design A2 控制指令表 `kind` 列）。WS 控制消息与
// HTTP 补拉消息共用同一路由（daemon control-dispatcher.ts），key 即本词表值。
//
// 注：PLAN_RESPONSE 不在本词表——backend ControlCommandService 未收录 plan
// 下发点（enqueue_and_push 调用点仅 session 七处 / permission 三处 /
// provider_switch 一处），plan_response WS 消息继续走 daemon.ts 既有直连路由。

/** 控制指令 kind（Server → Daemon 可靠投递消息的分类键）。 */
export const CONTROL_KIND = {
  /** 注入 prompt 触发新 turn（对应 WS SESSION_INJECT）。 */
  SESSION_INJECT: 'session_inject',
  /** 打断当前 turn（对应 WS SESSION_INTERRUPT）。 */
  SESSION_INTERRUPT: 'session_interrupt',
  /** 结束会话（对应 WS SESSION_END）。 */
  SESSION_END: 'session_end',
  /** reopen 恢复会话（对应 WS SESSION_RESUME）。 */
  SESSION_RESUME: 'session_resume',
  /** 权限审批结果（对应 WS PERMISSION_RESPONSE）。 */
  PERMISSION_RESPONSE: 'permission_response',
  /** 供应商热切换（对应 WS PROVIDER_CONFIG_CHANGED）。 */
  PROVIDER_CONFIG_CHANGED: 'provider_config_changed',
} as const;

/** 控制指令 kind 联合（字面量）。 */
export type ControlCommandKind = (typeof CONTROL_KIND)[keyof typeof CONTROL_KIND];

/**
 * GET pending-controls 响应条目（task-04 契约 / design A2 接口定义）。
 *
 * 仅 status=pending 的指令（delivered 一律不重发，D-006），created_at 升序。
 * 手写本地类型——task-11 已再生成 api-types（生成物含同构形状），此处于
 * protocol 层保留显式契约定义供 dispatcher 消费，可与生成物并存。
 */
export interface PendingControlCommand {
  /** 指令 id（即 command_id，daemon 侧幂等去重键）。 */
  id: string;
  /** 控制指令 kind（CONTROL_KIND 词表之一；daemon 侧宽容 string）。 */
  kind: string;
  /** 与既有 WS 消息 payload 同构（尾部注入可选 command_id）。 */
  payload: Record<string, unknown> | null;
  /** 创建时间（ISO 字符串；仅日志/观测用，daemon 不做过期判断——backend GC 收口）。 */
  created_at: string;
}

/**
 * 心跳响应（task-04 起扩展 `pending_controls` 可选字段，design A1 对账触发器）。
 *
 * 旧 backend 无该字段 → undefined，daemon 视为 0（向后兼容）。其余字段
 *（allowed_roots / runtimes 等）经 Record<string, unknown> 透传给既有消费方。
 */
export interface HeartbeatResponse extends Record<string, unknown> {
  /** 该 daemon 全部 runtime 的 pending 控制指令计数；>0 触发控制指令补拉。 */
  pending_controls?: number;
}

// ── Lease 任务状态 ────────────────────────────────────────────────────────────
// 与 backend lease 状态机字符串值一一对应。

/** Lease 生命周期状态。 */
export const LEASE_STATE = {
  /** 待认领：lease 已创建，等待 daemon LEASE_CLAIM。 */
  PENDING: 'pending',
  /** 执行中：LEASE_START 已发，daemon 正在跑 agent。 */
  RUNNING: 'running',
  /** 成功：LEASE_COMPLETE result.status === completed。 */
  COMPLETED: 'completed',
  /** 失败：LEASE_COMPLETE result.status === failed 或执行抛错。 */
  FAILED: 'failed',
  /** 取消：用户主动 cancel 或 lease 过期。 */
  CANCELLED: 'cancelled',
} as const;

/** Lease 状态联合（字面量），用于 TaskResult.status / lease.status 字段。 */
export type LeaseState = (typeof LEASE_STATE)[keyof typeof LEASE_STATE];

// ── 端点路径 ──────────────────────────────────────────────────────────────────

/**
 * WebSocket 端点路径（不含 origin / query）。
 * 完整 URL 形如：`{wsBase}/api/daemon/ws?runtime_id={runtime_id}`。
 * query 参数 `runtime_id` 由调用方拼接（task-18 WsClient._buildWsUrl）。
 */
export const WS_PATH = '/api/daemon/ws';

/**
 * REST API 路径前缀（不含 origin）。
 * 端点形如：`{restPrefix}/register`、`{restPrefix}/leases/{id}/claim`。
 * task-17 HubClient 在此前缀后拼具体子路径。
 */
export const REST_PREFIX = '/api/daemon';
