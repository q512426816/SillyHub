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
