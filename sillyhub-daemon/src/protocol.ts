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
} as const;

/** WebSocket 消息类型联合（字面量），用于 DaemonMessage.type。 */
export type MsgType = (typeof MSG)[keyof typeof MSG];

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
