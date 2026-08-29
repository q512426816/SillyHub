/**
 * Daemon ↔ SillyHub server REST 客户端。
 *
 * 用 Node 20 原生 fetch（design.md G-05：零 HTTP 库依赖），覆盖：
 *   - register / heartbeat（runtime 生命周期）
 *   - claim / start / leaseHeartbeat / submitMessages / complete（lease 生命周期，FR-04）
 *   - getPendingLeases（WS 断线时的 HTTP 轮询兜底）
 *
 * 端点路径用 task-03 的 REST_PREFIX 常量拼接（R-02 契约约束）。
 * WebSocket 通信不在此类（归 task-18 WsClient）。
 *
 * Python 源对照：sillyhub_daemon/client.py（HubClient class，193 行，8 方法）。
 * 1:1 对齐点：
 *   - 构造器 base_url 去尾斜杠、token 存原始值、_auth_headers 按 token 存在/缺失返回
 *   - 所有方法 POST（除 getPendingLeases 是 GET），raise_for_status → HubHttpError
 *   - body 字段 snake_case（runtime_id / claim_token / agent_run_id）对齐 backend Pydantic
 *   - timeout=30s（Python httpx）→ AbortSignal.timeout(30_000)（Node 20 内置）
 *   - trust_env=False（Python httpx）→ Node fetch 默认不读 HTTP_PROXY，天然等价
 *   - close()（Python aclose）→ fetch 无连接池，此方法 no-op 仅作 API 兼容
 *
 * @module hub-client
 */

import { REST_PREFIX } from './protocol.js';
// 2026-08-29-daemon-platform-resilience task-06：控制指令补拉响应条目类型
//（手写类型过渡，task-11 收口进 api-types 生成物）+ 心跳响应扩展字段类型。
import type { PendingControlCommand, HeartbeatResponse } from './protocol.js';
import type { components } from './api-types.js';
import { DAEMON_VERSION } from './daemon-version.js';
import { BUILD_ID } from './build-id.js';
import type { ExecutionContextPayload } from './types.js';
import type { ModelUsageRow, SessionRecoverStatus } from './daemon.js';
// task-04（FR-01 / D-005@v1）：notifyRunResult payload 的 error 字段类型。
// 与 backend ModelErrorDTO、daemon/src/model-error/types.ts ModelError 三端同构。
import type { ModelError } from './model-error/types.js';

// ── body 类型（字段名 snake_case 对齐 backend Pydantic 模型）──────────────────

/**
 * register 请求体（per-daemon，2026-07-03-daemon-entity-binding design §5.2 / D-006）。
 *
 * daemon 启动一次性上报 daemon_local_id（=本地 config.runtime_id）+ 机器级字段
 * + 探测到的 provider 列表。后端先 upsert daemon_instances，再为每 provider
 * upsert daemon_runtimes，并清理 stale runtime。
 */
export interface RegisterBody {
  /** daemon 本地 uuid（身份，复用）。对应 backend DaemonRegisterRequest.daemon_local_id。 */
  daemon_local_id: string;
  server_url: string;
  hostname: string;
  os?: string;
  arch?: string;
  allowed_roots?: string[];
  /** daemon 自身版本（2026-07-04-daemon-version-management D-001）。 */
  /** daemon_version=语义版本（DAEMON_VERSION），daemon_build_id=git SHA（BUILD_ID）。 */
  /** hub-client 内部填充，调用方无需传；后端写入 daemon_instances.version/build_id。 */
  daemon_version: string;
  daemon_build_id: string;
  /** task-02（FR-01 / D-001@v1）：daemon 进程启动时间（ISO 8601）。hub-client 内部
   * 填充，调用方无需传；null 兼容旧 daemon 不上报路径，后端写入 daemon_instances.started_at。 */
  started_at: string | null;
  /** 探测到的 provider 列表，每项 {provider, version?, status?}。 */
  providers: { provider: string; version?: string; status?: string }[];
}

/** claim_lease 请求体。 */
export interface ClaimLeaseBody {
  runtime_id: string;
}

/** start_lease 请求体。 */
export interface StartLeaseBody {
  claim_token: string;
}

/** lease_heartbeat 请求体。 */
export interface LeaseHeartbeatBody {
  claim_token: string;
}

/** submit_messages 请求体。 */
export interface SubmitMessagesBody {
  claim_token: string;
  agent_run_id: string;
  /**
   * 消息列表。每条是 provider 中立的 dict。
   * 2026-06-24-daemon-network-resilience task-19（FR-08 / D-001@v2）：每条 message
   * 可选携带 `dedup_key`（ResilienceService.submitWithRetry 注入到 message 顶层），
   * backend submit_messages 据此 ON CONFLICT DO NOTHING 幂等去重；旧 daemon 不发
   * 该字段时 backend 当 None（向后兼容，不强约束）。
   */
  messages: Record<string, unknown>[];
}

/** complete_lease 请求体。 */
export interface CompleteLeaseBody {
  claim_token: string;
  result: Record<string, unknown>;
}

/** heartbeat（per-daemon 心跳）请求体。2026-07-03-daemon-entity-binding task-07 / D-006。 */
export interface HeartbeatBody {
  /** daemon 本地 uuid（= daemon_instances.id）。 */
  daemon_local_id: string;
  /** daemon 自身版本（D-001/D-002，register + heartbeat 都带）。hub-client 内部填充。 */
  daemon_version: string;
  daemon_build_id: string;
  /** task-02（FR-01 / D-001@v1）：daemon 进程启动时间（ISO 8601）。hub-client 内部
   * 填充，调用方无需传；null 兼容旧 daemon 不上报路径，后端写入 daemon_instances.started_at。 */
  started_at: string | null;
  /** 各 provider 当前状态，每项 {provider, status}。 */
  providers: { provider: string; status?: string }[];
  /**
   * task-05（2026-08-29-daemon-selfupdate-safety / FR-04 / D-004@v1）：推迟升级
   * 期间心跳透传的 pending 状态。**仅 pending 期携带**——undefined 时本键完全不
   * 出现（禁空对象/null 兜底）：无字段即 backend 清除（daemon_instances.pending_update
   * 置 NULL），与 task-06「无字段=清除」语义对齐，旧 backend 兼容。
   * since 不上报（backend 首次落库盖 since=now，daemon 侧值无意义）。
   */
  pending_update?: HeartbeatPendingUpdate;
}

/**
 * 心跳 pending_update 载荷（task-05 / design S3）：task-03 pending-update.json
 * 记录剥掉 since 后的三字段投影。daemon.ts 组装时转换，hub-client 原样透传。
 */
export interface HeartbeatPendingUpdate {
  /** 推迟原因：'server_command' | 'disk_change'。 */
  reason: string;
  /** 推迟时进程内存中的 BUILD_ID。 */
  current_version: string;
  /** 等待切换到的目标 BUILD_ID。 */
  target_version: string;
}

/**
 * suspend_sessions_batch 请求体（2026-08-29-daemon-platform-resilience task-08 /
 * design A5 / FR-04；backend 端点契约 task-05 定稿）。
 *
 * daemon ``stop()`` 在 markOffline 前上报自身标识；backend 按
 * ``daemon_local_id``（= ``daemon_instances.id``）定位该 daemon 全部 runtime
 * 名下的 active 会话做三步挂起收敛。
 *
 * ql-20260829-003：类型别名收口到 api-types 生成物 SessionSuspendBatchRequest
 * （逐字段同构 daemon_local_id）。
 */
export type SuspendBatchBody = components['schemas']['SessionSuspendBatchRequest'];

/**
 * POST /sessions/suspend-batch 响应（task-05 provides 契约）。
 *
 * ``suspended`` = 实际翻挂起的会话数；``runs_failed`` = 同批收敛 failed 的活跃轮
 * run 数（error_code=daemon_stopped）。重复调用幂等——已挂起会话 no-op 计 0。
 *
 * ql-20260829-003：类型别名收口到 api-types 生成物 SuspendBatchResponse。
 */
export type SuspendBatchResponse = components['schemas']['SuspendBatchResponse'];

// ── session 事件 HTTP 上报（change 2026-08-24-platform-session-feedback-fix / FR-01~03）─

/** Plan 模式进入事件上报体（对齐 backend PlanModeEnteredEvent / task-01 DTO）。 */
export interface NotifyPlanModeEnteredBody {
  session_id: string;
  run_id: string;
  summary: { objective: string; tasks: string[]; design_snippet?: string };
}

/** Bash 执行状态事件上报体（对齐 backend BashStatusEvent / task-01 DTO）。 */
export interface NotifyBashStatusBody {
  session_id: string;
  run_id: string;
  command: string;
  status: 'running' | 'completed' | 'failed';
  exit_code?: number;
  elapsed_ms?: number;
}

/** Bash 输出块事件上报体（对齐 backend BashChunkEvent / task-01 DTO）。 */
export interface NotifyBashChunkBody {
  session_id: string;
  run_id: string;
  command: string;
  channel: 'stdout' | 'stderr';
  content: string;
  is_final: boolean;
}

/**
 * task-02（2026-08-27-background-subagent-progress / design §8）：Agent 任务状态
 * 事件扩展可选字段（契约冻结，snake_case 对齐 backend AgentTaskStatusEvent 新字段）。
 *
 * 全部 optional——旧 daemon 只发 running + task_id/task_name 不受影响（backend 侧
 * 兜底）。`async` 在 TS 是合法属性名，无需 alias（alias 仅 backend Python 侧问题）。
 */
export interface AgentTaskStatusExtraFields {
  /** 关联前端 tool 段 id（tool_use block id；回执兜底路径必发）。 */
  tool_use_id?: string;
  /** 终态摘要 / 进行中摘要（backend 截断 200 字符）。 */
  summary?: string;
  /** task_progress.last_tool_name（「正在做什么」）。 */
  last_tool_name?: string;
  /** 服务端权威时长 ms（usage.duration_ms）。 */
  elapsed_ms?: number;
  /** 累计 tokens（task_progress.usage）。 */
  total_tokens?: number;
  /** 工具调用次数（task_progress.usage）。 */
  tool_uses?: number;
  /** 异步派发标记（回执兜底路径必发；缺省语义=前台）。 */
  async?: boolean;
}

/**
 * Agent 任务状态事件上报体（对齐 backend AgentTaskStatusEvent / task-01 DTO；
 * task-02 扩展字段见 AgentTaskStatusExtraFields，status 增 'stopped'）。
 */
export interface NotifyAgentTaskStatusBody extends AgentTaskStatusExtraFields {
  session_id: string;
  run_id: string;
  task_id: string;
  task_name: string;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  progress?: number;
  message?: string;
}

// ── 增量 spec 同步类型（change 2026-08-13-platform-managed-file-sync / design §7）──
//
// 字段命名与 backend spec_workspace/schema.py 的 FileOp 逐字一致（避免 422）。
// 端点 POST /api/workspaces/{wsId}/spec-workspace/sync-incremental 返回
// { ok, new_versions, conflict, server_versions }（conflict=true 时 HTTP 仍 200，
// daemon 侧据字段提示人工拍板，不抛错）。

/** 单文件增量 op（对齐 backend FileOp）。content 为 base64（add/update 用）。
 * mtime（ms，可选）：ql-20260813-008，宿主真实修改时间。后端落盘作 source_mtime +
 * os.utime，让 changes.updated_at 反映真实活动而非同步时刻。旧 daemon 不传时后端 fallback now。 */
export interface FileOp {
  op: 'add' | 'update' | 'delete' | 'rename';
  path: string;
  new_path?: string | null;
  hash?: string | null;
  content?: string | null;
  base_version: number;
  mtime?: number | null;
}

/** 增量同步响应（对齐 backend SpecIncrementalSyncResponse）。 */
export interface SpecIncrementalSyncResult {
  ok: boolean;
  new_versions: Record<string, number>;
  conflict: boolean;
  server_versions?: Record<string, number> | null;
}

// ── agent 文件制品类型（change 2026-08-23-agent-file-upload-mcp / design §7.1-7.2）──
//
// backend 端点（agent/file_artifacts.py，task-03）响应文件 id 字段名是 id
// （FileUploadResp.id / FileMetaResp.id）；daemon 侧对外统一映射为 file_id
// （agent 工具输出口径，design §7.1），Backend 后缀类型即映射前形态。

/** POST /api/agent/file-artifacts 响应原样形态（backend FileUploadResp）。 */
interface FileArtifactUploadBackendResp {
  id: string;
  original_name: string;
  mime_type: string;
  size: number;
  description?: string | null;
}

/** GET /api/agent/file-artifacts files 元素原样形态（backend FileMetaResp）。 */
interface FileArtifactMetaBackendResp {
  id: string;
  original_name: string;
  mime_type: string;
  size: number;
  description?: string | null;
  created_at: string;
}

/** 上传结果（id → file_id 映射后，upload_file 工具输出）。 */
export interface FileArtifactUploadResult {
  file_id: string;
  original_name: string;
  mime_type: string;
  size: number;
  description: string | null;
}

/** 列表结果（list_uploaded_files 工具输出，含 task-03 契约字段 created_at）。 */
export interface FileArtifactListResult {
  files: FileArtifactMeta[];
}

/** 列表元素（FileMetaResp 映射后；description 旧数据为 null）。 */
export interface FileArtifactMeta {
  file_id: string;
  original_name: string;
  mime_type: string;
  size: number;
  description: string | null;
  created_at: string;
}

// ── 错误类型 ──────────────────────────────────────────────────────────────────

/**
 * HTTP 非 2xx 响应抛出。对齐 Python httpx.HTTPStatusError 的信息完备性
 *（status_code + response.text + 请求 URL/method）。
 *
 * 调用方（TaskRunner / Daemon）按 `err.status` 分支处理：
 *   - 401：token 无效，触发重新认证
 *   - 409：lease 已被他人 claim，跳过本 lease
 *   - 5xx：服务器错误，进入重连/失败标记
 *
 * 网络错误（DNS / 连接拒绝 / 超时）**不包装**为本类，透传 fetch 的原始
 * TypeError / DOMException（理由：调用方需区分超时 vs 业务错误，见蓝图 R6）。
 */
export class HubHttpError extends Error {
  constructor(
    /** HTTP 状态码（4xx / 5xx）。 */
    public readonly status: number,
    /** 完整响应体文本（不截断，调用方可 JSON.parse 解析 detail）。 */
    public readonly bodyText: string,
    /** 完整请求 URL。 */
    public readonly url: string,
    /** HTTP method（'GET' / 'POST'）。 */
    public readonly method: string,
  ) {
    // message 里 bodyText 截断到 200 字符仅用于日志可读性
    super(`HTTP ${status} ${method} ${url}: ${bodyText.slice(0, 200)}`);
    this.name = 'HubHttpError';
  }
}

// ── 错误 cause 提取（task-01 / FR-01）──────────────────────────────────────

/**
 * 从网络/HTTP 错误中提取稳定的 cause 信息，供日志展开底层原因。
 *
 * fetch failed（undici `TypeError`）的真实原因（`ECONNREFUSED`/`ENOTFOUND`/
 * `ETIMEDOUT`/证书错误）挂在 `error.cause`，默认序列化只显示 `fetch failed`，
 * 排查困难。本函数把 cause 链压平为 `{ message, code?, status? }`。
 *
 * 规则：
 *   - `HubHttpError` → 返回 `{ message, status }`（业务错误，无 undici code）；
 *   - `TypeError`（fetch failed）→ 读 `error.cause`，cause 是 Error 取
 *     `cause.code ?? cause.name` + `cause.message`；cause 缺失 → `code = err.name`；
 *   - `TimeoutError`/DOMException（AbortSignal.timeout）→ `code = err.name`；
 *   - 非 Error 值 → `message = String(err)`，无 code。
 *
 * 纯函数，只读，不修改入参。task-07 的 error-classify.toCauseInfo 与之等价，
 * 后续可统一，此处先在 hub-client 落地供 task-02 的 warn 展开（避免跨 task 阻塞）。
 */
export interface CauseInfo {
  message: string;
  code?: string;
  status?: number;
}

export function extractCause(err: unknown): CauseInfo {
  if (err instanceof HubHttpError) {
    return { message: err.message, status: err.status };
  }
  const e = err as { message?: string; name?: string; cause?: unknown } | null;
  const message =
    e && typeof e.message === 'string' && e.message ? e.message : String(err);
  const cause = e?.cause as
    | { code?: string; name?: string; message?: string }
    | undefined;
  if (cause && (cause.code || cause.name)) {
    return { message: cause.message ?? message, code: cause.code ?? cause.name };
  }
  return { message, code: e?.name };
}

// ── HubClient ─────────────────────────────────────────────────────────────────

/** 默认请求超时 30 秒，对齐 Python httpx.AsyncClient(timeout=30.0)。 */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * spec 同步上传专用超时 300 秒（ql-20260816-002）。
 *
 * 全量 tar（315+ 文件 / 29MB）backend apply_sync 写盘+reparse 实测 69s，
 * 30s 必假失败（daemon AbortSignal 中止→任务标 failed，服务端实际 200 成功）；
 * 增量 payload 含 base64 文件内容同样偏大。DEFAULT_TIMEOUT_MS 保持 30s
 * 不动（对齐 Python 语义），仅同步上传两方法单独放宽。
 */
const SPEC_SYNC_TIMEOUT_MS = 300_000;

/**
 * agent 文件制品上传专用超时 300 秒（task-05 2026-08-23-agent-file-upload-mcp）。
 *
 * 文件受 backend ``file_max_size_mb`` 上限约束（可达几十 MB），multipart 全量
 * 直传在大文件 + 慢网络下 30s 默认值不够；与 SPEC_SYNC_TIMEOUT_MS 同款放宽
 * 理由（大 payload 单独放宽，DEFAULT_TIMEOUT_MS 保持 30s 不动）。
 */
const FILE_ARTIFACT_TIMEOUT_MS = 300_000;

/**
 * JSON.parse 的 BOM-safe 包装。
 *
 * Node 原生 fetch 的 resp.json() 底层调 JSON.parse，但 JSON.parse 不跳过
 * BOM 字节（U+FEFF）。当上游后端（如 FastAPI）返回带 BOM 的 JSON 时，
 * resp.json() 抛 "Unexpected token '﻿'"。
 *
 * 本函数先读到文本，strip 掉 BOM 再 parse，兼容带/不带 BOM 的响应。
 */
export async function parseJsonFromResponse<T>(resp: Response): Promise<T> {
  const text = await resp.text();
  // U+FEFF 可能以 ﻿（JS 字符串）或 \xEF\xBB\xBF（UTF-8 字节序列解码后）出现。
  // ES2019 的 String.prototype.trimStart 只去 whitespace 不包括 BOM，显式 strip。
  const cleaned = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return JSON.parse(cleaned) as T;
}

/**
 * Auth credentials for daemon → server requests.
 *
 * Either ``token`` (browser-style Bearer JWT, short-lived) or ``apiKey``
 * (long-lived opaque key, sent via ``X-API-Key``). At most one should be
 * set; if both are present, ``apiKey`` wins on the wire (matches the
 * backend ``get_current_principal`` semantics where X-API-Key is the
 * fallback for non-browser callers).
 *
 * task-10（2026-08-22-team-session-unify / FR-04）adds optional ``sessionId``:
 * 主 agent 会话 id（mcp-server.ts 从 env MCP_SESSION_ID 读入），5 个 MCP 端点
 * 请求统一附 ``X-Session-Id`` header——backend 据此解析活跃 mission（懒建兜底）。
 * 缺省（undefined/空）不带该头（缺失不附）。
 */
export interface HubClientAuth {
  token?: string;
  apiKey?: string;
  /** task-10：主 agent 会话 id（X-Session-Id，仅 MCP 5 端点附带）。 */
  sessionId?: string;
}

/**
 * task-10（2026-08-22-team-session-unify / FR-04）：会话上下文请求头名
 * （契约 X_SESSION_ID_HEADER 单一来源；backend 消费方 task-05/06）。
 */
export const X_SESSION_ID_HEADER = 'X-Session-Id';

/**
 * Daemon 与 SillyHub server 之间的 REST 客户端。
 *
 * 无状态瘦客户端：每次请求独立调用原生 fetch（无连接池）。
 * 不缓存 lease 状态（由 TaskRunner 持有 lease 状态机）。
 * 不内置重试（失败即抛，由调用方决策，见蓝图 N-2）。
 */
export class HubClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly apiKey?: string;
  /** task-10（FR-04）：主 agent 会话 id（MCP 5 端点附 X-Session-Id）。 */
  private readonly sessionId?: string;

  /**
   * gap-8.2（design §11）：sessionId → runtimeId 映射。
   *
   * recover 链路（daemon 重启恢复）专用：RecoveryCoordinator 调用点只传
   * sessionId，backend recovery 端点要 runtime_id（ownership guard）。
   * recoverSession 时存映射，confirm/markFailed 无 opts.runtimeId 时查表补
   * runtime_id；调用后删除（一次性）。daemon 活着期间映射有效（重启 = 全新
   * 恢复流程，映射重建）。reopen 链路（task-06 DS-3）不经 recoverSession，
   * runtimeId 由 _routeSessionResume 从 SESSION_RESUME payload 经 opts
   * 显式透传，不读不写本映射。
   */
  private readonly _recoveryRuntimeBySession = new Map<string, string>();

  /**
   * @param serverUrl SillyHub server origin，如 'http://localhost:8000'。尾部斜杠会被去除。
   * @param authOrToken  两种合法形态（向后兼容）：
   *   - string：旧式 Bearer token，等价于 ``{ token }``；
   *   - ``{ token?, apiKey? }``：新式 options，daemon 长期凭证场景使用 ``{ apiKey }``。
   *   两者都为空（undefined）时请求不带任何鉴权头。
   */
  constructor(serverUrl: string, authOrToken?: string | HubClientAuth) {
    // 去尾部一个或多个斜杠，确保 `${baseUrl}${REST_PREFIX}` 不产生双斜杠。
    // 对齐 Python `server_url.rstrip("/")`（client.py:33）。
    this.baseUrl = serverUrl.replace(/\/+$/, '');
    if (typeof authOrToken === 'string') {
      this.token = authOrToken;
    } else if (authOrToken) {
      this.token = authOrToken.token;
      this.apiKey = authOrToken.apiKey;
      this.sessionId = authOrToken.sessionId;
    }
  }

  /**
   * 关闭客户端。fetch 无连接池，此方法为 no-op，仅为 API 兼容保留
   *（对齐 Python `await self._http.aclose()`，client.py:49-51）。
   * 被 TaskRunner / Daemon 调用时无副作用。
   */
  close(): void {
    /* no-op: fetch has no connection pool to close */
  }

  // -- 内部：统一请求入口（对齐 Python 的 self._http.post + raise_for_status）--

  /**
   * 构造请求头。鉴权优先级：
   *   1. apiKey（X-API-Key，daemon 长期凭证）
   *   2. token（Authorization: Bearer …，浏览器短期 JWT）
   * 两者都缺失时不带鉴权头（对齐 Python `_auth_headers` 返回 `{}`）。
   */
  private _headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      h['X-API-Key'] = this.apiKey;
    } else if (this.token) {
      h['Authorization'] = `Bearer ${this.token}`;
    }
    return h;
  }

  /**
   * task-10（2026-08-22-team-session-unify / FR-04）：MCP 5 端点的会话上下文头。
   * sessionId 存在 → ``{ 'X-Session-Id': ... }``（经 _request extraHeaders 附加）；
   * 缺失 → undefined（不带该头，缺失不附）。
   */
  private _sessionIdHeaders(): Record<string, string> | undefined {
    return this.sessionId ? { [X_SESSION_ID_HEADER]: this.sessionId } : undefined;
  }

  /**
   * task-10（审查 B1）：MCP 端点路径构造——workspace_id/mission_id 可选后的三种形态。
   *
   *   - ws + mid → ``/api/workspaces/{ws}/missions/{mid}/{action}``（既有形态，
   *     显式传参照常透传，越权校验锚——零回归）；
   *   - 仅 mid   → ``/api/missions/{mid}/{action}``（mission 自带 workspace 归属，
   *     backend 按 mission 反解）；
   *   - 均缺省   → ``/api/missions/{action}``（session-scoped：backend 按
   *     X-Session-Id 解析活跃 mission，dispatch 无则懒建）。
   *
   * mission 缺省时 workspaceId 被忽略（懒建 scope 来自会话的工作区绑定，非工具参数，
   * design §5 Phase 1）。session-scoped 路由的 backend 消费方为 task-05/06
   * （并行任务），header 契约（X-Session-Id）以本常量为单一来源。
   */
  private _missionActionPath(
    workspaceId: string | undefined,
    missionId: string | undefined,
    action: string,
  ): string {
    if (missionId === undefined || missionId === '') {
      return `/api/missions/${action}`;
    }
    if (workspaceId === undefined || workspaceId === '') {
      return `/api/missions/${encodeURIComponent(missionId)}/${action}`;
    }
    return `/api/workspaces/${encodeURIComponent(workspaceId)}/missions/${encodeURIComponent(missionId)}/${action}`;
  }

  /**
   * 统一 fetch 入口。
   *
   * 语义对齐 Python `resp = await self._http.post(path, json=body); resp.raise_for_status(); return resp.json()`：
   *   - 非 2xx（!resp.ok）：读完整 body 文本后抛 HubHttpError（含 status/bodyText/url/method）。
   *   - 2xx：解析 JSON 返回。
   *   - 网络错误 / 超时：fetch 直接 reject，**不包装**（透传 TypeError / DOMException）。
   *
   * trust_env=False 等价性：Node 原生 fetch 默认不读 HTTP_PROXY/HTTPS_PROXY 环境变量
   *（undici 需显式 dispatcher 才走代理），与 Python httpx 的 trust_env=False 语义一致，
   * 此处不设置任何 proxy/dispatcher 字段。
   */
  private async _request<T>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const resp = await fetch(url, {
      method,
      headers: { ...this._headers(), ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      // Node 原生 fetch 默认不读 HTTP_PROXY/HTTPS_PROXY（等价 trust_env=False），
      // 显式不设置 dispatcher 即可。
    });
    if (!resp.ok) {
      const bodyText = await resp.text();
      throw new HubHttpError(resp.status, bodyText, url, method);
    }
    return await parseJsonFromResponse<T>(resp);
  }

  // -- Runtime 生命周期（FR-03 / FR-07）--

  /**
   * 注册 daemon（per-daemon，design §5.2 / D-006）。
   *
   * daemon 启动一次性上报 daemon_local_id + 机器级字段 + 探测到的 provider 列表。
   * 后端先 upsert daemon_instances，再为每 provider upsert daemon_runtimes，并清理
   * stale runtime。返回 ``{ daemon_instance_id, runtimes: [{provider, runtime_id}] }``。
   */
  async register(params: {
    daemonLocalId: string;
    serverUrl: string;
    hostname: string;
    os?: string;
    arch?: string;
    allowedRoots?: string[];
    /** task-02：daemon 进程启动时间（epoch ms / Date / 数值）；空填 null（兼容旧 daemon）。 */
    startedAt?: number | Date | null;
    providers: { provider: string; version?: string; status?: string }[];
  }): Promise<Record<string, unknown>> {
    const body: RegisterBody = {
      daemon_local_id: params.daemonLocalId,
      server_url: params.serverUrl,
      hostname: params.hostname,
      daemon_version: DAEMON_VERSION,
      daemon_build_id: BUILD_ID,
      started_at:
        params.startedAt == null
          ? null
          : new Date(params.startedAt).toISOString(),
      providers: params.providers,
    };
    if (params.os) body.os = params.os;
    if (params.arch) body.arch = params.arch;
    if (params.allowedRoots && params.allowedRoots.length > 0) {
      body.allowed_roots = params.allowedRoots;
    }
    return this._request<Record<string, unknown>>(
      'POST',
      `${REST_PREFIX}/register`,
      body,
    );
  }

  /**
   * per-daemon HTTP 心跳（非 lease 心跳）。2026-07-03-daemon-entity-binding task-07 / D-006。
   * 端点：POST {REST_PREFIX}/heartbeat，body `{ daemon_local_id, providers: [{provider, status}] }`。
   * daemon 单条心跳合并上报 daemon_local_id + 各 provider 状态。
   *
   * 2026-08-29-daemon-platform-resilience task-06：响应类型化——backend task-04 起
   * 携带可选 `pending_controls`（该 daemon 全部 runtime 的 pending 控制指令计数，
   * daemon 据此触发控制指令补拉，design A1）。
   */
  async heartbeat(
    daemonLocalId: string,
    providers?: { provider: string; status?: string }[],
    /** task-02：daemon 进程启动时间（epoch ms / Date / 数值）；空填 null（兼容旧 daemon）。 */
    startedAt?: number | Date | null,
    /**
     * task-05（2026-08-29-daemon-selfupdate-safety / FR-04）：推迟升级期间的
     * pending 状态（三字段）。可选且追加末位——undefined 时请求体不含
     * pending_update 键（无字段=backend 清除，禁空对象兜底），既有 3 参调用
     * 请求体逐字段不变（零破坏）。
     */
    pendingUpdate?: HeartbeatPendingUpdate,
  ): Promise<HeartbeatResponse> {
    const body: HeartbeatBody = {
      daemon_local_id: daemonLocalId,
      daemon_version: DAEMON_VERSION,
      daemon_build_id: BUILD_ID,
      started_at: startedAt == null ? null : new Date(startedAt).toISOString(),
      providers: providers ?? [],
    };
    // 仅 pending 期携带：undefined → 键完全不出现（design S3 兼容约束）。
    if (pendingUpdate) body.pending_update = pendingUpdate;
    return this._request<HeartbeatResponse>(
      'POST',
      `${REST_PREFIX}/heartbeat`,
      body,
    );
  }

  /**
   * Mark a runtime offline during graceful daemon shutdown.
   * Endpoint: POST {REST_PREFIX}/runtimes/{runtimeId}/offline.
   */
  async markOffline(runtimeId: string): Promise<Record<string, unknown>> {
    return this._request<Record<string, unknown>>(
      'POST',
      `${REST_PREFIX}/runtimes/${encodeURIComponent(runtimeId)}/offline`,
    );
  }

  /**
   * 优雅停止批量挂起本 daemon 全部 active 会话（2026-08-29-daemon-platform-
   * resilience task-08 / design A5 / FR-04；backend 端点 task-05）。
   *
   * 端点：POST {REST_PREFIX}/sessions/suspend-batch，body `{ daemon_local_id }`。
   * daemon ``stop()`` 在 markOffline **之前**调用；backend 单事务三步收敛：
   * 中断中 run → failed（error_code=daemon_stopped）、session → suspended、
   * 挂起 lease → cancelled（条件 UPDATE 幂等可重入）。
   *
   * **失败语义**（对齐 markOffline）：HTTP 非 2xx → HubHttpError（404 = daemon
   * 实例不存在/越权，resource-hiding）；网络/超时透传 fetch 原始错误。调用方
   * （daemon.stop）仅结构化日志降级不阻断收尾——与强杀等价走 backend 600s
   * offline sweep 兜底收敛 suspended（design A5 已声明的 fallback）。
   */
  async suspendSessions(daemonLocalId: string): Promise<SuspendBatchResponse> {
    return this._request<SuspendBatchResponse>(
      'POST',
      `${REST_PREFIX}/sessions/suspend-batch`,
      { daemon_local_id: daemonLocalId } satisfies SuspendBatchBody,
    );
  }

  // -- Lease 生命周期（FR-04 核心）--

  /**
   * 认领 lease。
   * 端点：POST {REST_PREFIX}/leases/{leaseId}/claim，body `{ runtime_id }`。
   * 返回含 claim_token 的响应（后续操作需此 token）。
   */
  async claimLease(
    leaseId: string,
    runtimeId: string,
  ): Promise<Record<string, unknown>> {
    return this._request<Record<string, unknown>>(
      'POST',
      `${REST_PREFIX}/leases/${encodeURIComponent(leaseId)}/claim`,
      { runtime_id: runtimeId } satisfies ClaimLeaseBody,
    );
  }

  /**
   * 标记 lease 已开始执行。
   * 端点：POST {REST_PREFIX}/leases/{leaseId}/start，body `{ claim_token }`。
   */
  async startLease(
    leaseId: string,
    claimToken: string,
  ): Promise<Record<string, unknown>> {
    return this._request<Record<string, unknown>>(
      'POST',
      `${REST_PREFIX}/leases/${encodeURIComponent(leaseId)}/start`,
      { claim_token: claimToken } satisfies StartLeaseBody,
    );
  }

  /**
   * lease 执行期间的心跳续期。
   * 端点：POST {REST_PREFIX}/leases/{leaseId}/heartbeat，body `{ claim_token }`。
   */
  async leaseHeartbeat(
    leaseId: string,
    claimToken: string,
  ): Promise<Record<string, unknown>> {
    return this._request<Record<string, unknown>>(
      'POST',
      `${REST_PREFIX}/leases/${encodeURIComponent(leaseId)}/heartbeat`,
      { claim_token: claimToken } satisfies LeaseHeartbeatBody,
    );
  }

  /**
   * 增量上报 agent 执行消息（流式）。
   * 端点：POST {REST_PREFIX}/leases/{leaseId}/messages，
   * body `{ claim_token, agent_run_id, messages }`。
   */
  async submitMessages(
    leaseId: string,
    claimToken: string,
    agentRunId: string,
    messages: Record<string, unknown>[],
  ): Promise<Record<string, unknown>> {
    return this._request<Record<string, unknown>>(
      'POST',
      `${REST_PREFIX}/leases/${encodeURIComponent(leaseId)}/messages`,
      {
        claim_token: claimToken,
        agent_run_id: agentRunId,
        messages,
      } satisfies SubmitMessagesBody,
    );
  }

  /**
   * 完成 lease，提交 result（含 patch / stats / status）。
   * 端点：POST {REST_PREFIX}/leases/{leaseId}/complete，
   * body `{ claim_token, result }`。
   *
   * task-07（2026-08-29-usage-by-provider-model / FR-01-4 / FR-02-2）：可选
   * statsExtras 条件注入 result.stats 的 model / api_requests——backend
   * complete_lease 从 stats.model / stats.api_requests 落明细（design §4.1）。
   * undefined 不写：extras 缺省 / 字段 undefined 时 body 与老链路逐字节一致
   *（老 daemon 兼容 N-01）；result.stats 已含同名字段时不覆盖（stats 优先，幂等）。
   * 主数据路径是 task-runner 在 complete stats 组装时直接写入两字段（随
   * result.stats 整体透传），本参数是调用方显式补充通道。不修改调用方传入的
   * result / stats 对象（浅拷贝后写入）。
   */
  async completeLease(
    leaseId: string,
    claimToken: string,
    result: Record<string, unknown>,
    statsExtras?: { model?: string; api_requests?: number },
  ): Promise<Record<string, unknown>> {
    let bodyResult = result;
    if (
      statsExtras !== undefined &&
      (statsExtras.model !== undefined || statsExtras.api_requests !== undefined)
    ) {
      const rawStats = result.stats;
      const stats =
        rawStats && typeof rawStats === 'object' && !Array.isArray(rawStats)
          ? { ...(rawStats as Record<string, unknown>) }
          : {};
      if (statsExtras.model !== undefined && stats.model === undefined) {
        stats.model = statsExtras.model;
      }
      if (
        statsExtras.api_requests !== undefined &&
        stats.api_requests === undefined
      ) {
        stats.api_requests = statsExtras.api_requests;
      }
      bodyResult = { ...result, stats };
    }
    return this._request<Record<string, unknown>>(
      'POST',
      `${REST_PREFIX}/leases/${encodeURIComponent(leaseId)}/complete`,
      { claim_token: claimToken, result: bodyResult } satisfies CompleteLeaseBody,
    );
  }

  // -- 轮询兜底（FR-03：WS 断线时 HTTP 轮询 pending leases）--

  /**
   * 获取 runtime 的待处理 lease 列表。
   * 端点：GET {REST_PREFIX}/runtimes/{runtimeId}/pending-leases（唯一非 POST 端点）。
   * 无 body，返回 lease 列表。
   */
  async getPendingLeases(
    runtimeId: string,
  ): Promise<Record<string, unknown>[]> {
    return this._request<Record<string, unknown>[]>(
      'GET',
      `${REST_PREFIX}/runtimes/${encodeURIComponent(runtimeId)}/pending-leases`,
    );
  }

  // ── 控制指令补拉/回执（2026-08-29-daemon-platform-resilience task-06 / design A2）──

  /**
   * 补拉 runtime 的 pending 控制指令（重连对账 / 心跳 pending_controls>0 触发）。
   *
   * 端点：GET {REST_PREFIX}/runtimes/{runtimeId}/pending-controls。
   * backend task-04 契约：仅返回 status=pending 的指令（delivered 一律不重发，
   * D-006 零重复执行优先），created_at 升序；归属校验同 pending-leases
   *（跨用户与不存在同语义 404 → HubHttpError）。
   *
   * 错误语义同 getPendingLeases：旧 backend 无该端点（404）/ 网络错 → 抛
   * HubHttpError / 原生网络异常，由调用方（daemon 对账）降级 warn 不崩。
   */
  async getPendingControls(
    runtimeId: string,
  ): Promise<PendingControlCommand[]> {
    const resp = await this._request<{ commands?: PendingControlCommand[] }>(
      'GET',
      `${REST_PREFIX}/runtimes/${encodeURIComponent(runtimeId)}/pending-controls`,
    );
    return resp.commands ?? [];
  }

  /**
   * 控制指令消费回执：ids 批量置 acked。
   *
   * 端点：POST {REST_PREFIX}/runtimes/{runtimeId}/controls/ack，body `{ ids }`。
   * ack 语义 = 「daemon 已处理」——消费成功与消费失败的业务性错误同样 ack
   *（防毒丸指令无限重投，错误进 daemon 日志）；backend 对过期/已回执行静默
   * 跳过（幂等）。返回 `{ acked: n }`（实际翻转行数）。
   */
  async ackControls(
    runtimeId: string,
    ids: string[],
  ): Promise<{ acked: number }> {
    return this._request<{ acked: number }>(
      'POST',
      `${REST_PREFIX}/runtimes/${encodeURIComponent(runtimeId)}/controls/ack`,
      { ids },
    );
  }

  /**
   * ql-20260616-006：上报 AgentRun 状态（cancel 检测时报 killed）。
   * 端点：POST {REST_PREFIX}/leases/{leaseId}/sync，body `{ claim_token, status, error? }`。
   */
  async syncStatus(
    leaseId: string,
    claimToken: string,
    status: string,
    error?: string,
  ): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = { claim_token: claimToken, status };
    if (error) body.error = error;
    return this._request<Record<string, unknown>>(
      'POST',
      `${REST_PREFIX}/leases/${encodeURIComponent(leaseId)}/sync`,
      body,
    );
  }

  // ── gap-3 / gap-4 (D-002@v3 patch design §4 / §5)：daemon → server 反向通知 ──

  /**
   * gap-3（design §4）：上报 interactive AgentRun 终态（SDK result）。
   *
   * 端点：POST {REST_PREFIX}/leases/{leaseId}/runs/{runId}/result
   * 鉴权：X-Claim-Token header（lease 级，区别于 sync 的 body claim_token）；
   *       端点本身仍走 _headers() 的 X-API-Key / Bearer（daemon 长期凭证）。
   *
   * 调用链：SessionManager._onResult → deps.onTurnResult → daemon 桥接（task-04）
   * → hubClient.notifyRunResult → backend close_interactive_run。
   *
   * body 字段对齐 backend InteractiveRunResultRequest（snake_case）：
   *   - status: SDK result 顶层状态（'success' | 'error_during_execution' | 其他）
   *   - is_error: SDK result.is_error
   *   - subtype: SDK result.subtype（可选）
   *   - result_summary: 可读摘要（可选，backend redact 后存 output_redacted）
   *
   * **鉴权头拼接**：claimToken 不能进 body（backend 用 Header(alias='X-Claim-Token')
   * 解析），故单独构造 fetch 而非走 _request（_request 只发 _headers() 的标准头）。
   * 复用 _headers() 的基础鉴权（apiKey/Bearer）+ Content-Type，叠加 X-Claim-Token。
   *
   * **失败语义**（对齐 _request）：
   *   - HTTP 非 2xx → HubHttpError（含 status/bodyText/url/method）；
   *   - 404 = lease/run 不存在或 run 未绑定到 lease session（resource-hiding）；
   *   - 401 = X-Claim-Token 不匹配 / api-key 无效；
   *   - 网络/超时 → 透传 fetch 原始错误。
   *
   * @param leaseId  interactive lease.id（SessionState.leaseId）
   * @param claimToken  lease 级 claim_token（SessionState.claimToken）
   * @param runId  当前 turn 的 AgentRun.id（SessionState.currentRunId at result time）
   * @param payload  { status, is_error, subtype?, result_summary?, error? }
   *   - error：task-04 新增。is_error=true 且归类器产出非空 ModelError 时透传，
   *     backend 写入 AgentRun.error_detail（D-005@v1 三端标准协议）；其余不 set。
   */
  async notifyRunResult(
    leaseId: string,
    claimToken: string,
    runId: string,
    payload: {
      status: string;
      is_error: boolean;
      subtype?: string;
      result_summary?: string;
      // SDKResultSuccess 透传字段（interactive usage/cost/duration 修复）。
      total_cost_usd?: number;
      num_turns?: number;
      duration_ms?: number;
      duration_api_ms?: number;
      input_tokens?: number;
      output_tokens?: number;
      // task-16 (2026-06-24-runtime-usage-stats)：cache 两维（短名，对齐 backend
      // _METADATA_FIELDS）。codex/老 Claude CLI 不透传时 undefined → 守卫不 set →
      // backend 收不到该字段 → NULL（D-001@v1）。
      cache_read_tokens?: number;
      cache_creation_tokens?: number;
      // task-06（2026-08-29-usage-by-provider-model / FR-01-3/FR-02-1）：
      // modelUsage 逐模型明细行（daemon._modelUsageRows 拆行）+ run 级 assistant
      // 计数。modelUsage 缺失/空时 daemon 不 set 两字段（老 CLI 兼容，backend
      // None → 明细无行，N-01）。ModelUsageRow wire 形状归 daemon.ts 拥有。
      model_usage?: ModelUsageRow[];
      api_requests?: number;
      // task-04（FR-01 / D-005@v1）：模型层结构化错误。仅 is_error=true 且归类器产出
      // 非空 ModelError 时 set（session-manager turn 收尾归类 + 挂到 result.modelError，
      // daemon 桥接读取注入）；成功路径 / 非模型错误不 set → backend error_detail=NULL（D-008）。
      error?: ModelError;
    },
  ): Promise<Record<string, unknown>> {
    const path = `${REST_PREFIX}/leases/${encodeURIComponent(
      leaseId,
    )}/runs/${encodeURIComponent(runId)}/result`;
    const url = `${this.baseUrl}${path}`;
    // _headers() 已含 Content-Type + apiKey/Bearer；追加 lease 级 claim_token。
    const headers: Record<string, string> = {
      ...this._headers(),
      'X-Claim-Token': claimToken,
    };
    const body: Record<string, unknown> = {
      status: payload.status,
      is_error: payload.is_error,
    };
    if (payload.subtype !== undefined) {
      body.subtype = payload.subtype;
    }
    if (payload.result_summary !== undefined) {
      body.result_summary = payload.result_summary;
    }
    // undefined 字段不写（保留 backend AgentRun 原值，避免覆盖回 None）。
    if (payload.total_cost_usd !== undefined) {
      body.total_cost_usd = payload.total_cost_usd;
    }
    if (payload.num_turns !== undefined) {
      body.num_turns = payload.num_turns;
    }
    if (payload.duration_ms !== undefined) {
      body.duration_ms = payload.duration_ms;
    }
    if (payload.duration_api_ms !== undefined) {
      body.duration_api_ms = payload.duration_api_ms;
    }
    if (payload.input_tokens !== undefined) {
      body.input_tokens = payload.input_tokens;
    }
    if (payload.output_tokens !== undefined) {
      body.output_tokens = payload.output_tokens;
    }
    // task-16：cache 两维守卫（短名）。undefined → 不 set → backend NULL（D-001@v1）。
    // 0 值合法（无缓存命中），用 `!== undefined` 而非 truthy 守卫。
    if (payload.cache_read_tokens !== undefined) {
      body.cache_read_tokens = payload.cache_read_tokens;
    }
    if (payload.cache_creation_tokens !== undefined) {
      body.cache_creation_tokens = payload.cache_creation_tokens;
    }
    // task-06（2026-08-29-usage-by-provider-model / FR-01-3/FR-02-1）：模型明细行
    // 与 run 级调用次数透传。undefined（老 daemon / modelUsage 缺失）→ 不写 →
    // backend InteractiveRunResultRequest None → 明细无行（N-01 兼容）。0 值合法
    //（api_requests=0 诚实上报），用 `!== undefined` 守卫。
    if (payload.model_usage !== undefined) {
      body.model_usage = payload.model_usage;
    }
    if (payload.api_requests !== undefined) {
      body.api_requests = payload.api_requests;
    }
    // task-04：模型层结构化错误守卫。undefined（成功 / 非模型错误，未 set）→ 不写 →
    // backend error_detail 保留 NULL（D-008 成功路径不回归）。非空对象直接透传（与
    // backend ModelErrorDTO 同构：{type,code,message,retryable,hint,raw}）。
    if (payload.error !== undefined) {
      body.error = payload.error;
    }
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    if (!resp.ok) {
      const bodyText = await resp.text();
      throw new HubHttpError(resp.status, bodyText, url, 'POST');
    }
    return await parseJsonFromResponse<Record<string, unknown>>(resp);
  }

  /**
   * gap-4（design §5）：上报 interactive session 终态（end / idle 30min / fail）。
   *
   * 端点：POST {REST_PREFIX}/sessions/{sessionId}/end
   * 鉴权：_headers() 的 X-API-Key（daemon 注册时持有的长期凭证）；backend
   *       get_current_principal 接受 api-key（区别于前端 user JWT）。body 不带
   *       claim_token（session 级收口，api-key 即身份证明）。
   *
   * 调用链：SessionManager.end/fail → deps.onSessionEnd → daemon 桥接（task-04）
   * → hubClient.notifySessionEnd → backend end_session（daemon 入口）。
   *
   * body 字段：
   *   - status: 'ended' | 'failed'（对齐 SessionStatus）
   *   - reason: 可读原因（manual / idle_timeout / driver_error / ...）
   *
   * 与前端 POST /sessions/{id}/end（user JWT）共用 backend 端点路径，但鉴权头
   * 不同：daemon 走 X-API-Key，前端走 Authorization Bearer。backend
   * get_current_principal 双路径兼容。
   *
   * **失败语义**（对齐 _request）：非 2xx → HubHttpError；网络/超时透传。
   * backend 端幂等（已 ended → no-op），daemon 重试安全。
   *
   * @param sessionId  AgentSession.id（SessionState.sessionId）
   * @param status  'ended'（正常收口 / idle）/ 'failed'（driver error）
   * @param reason  可读原因，backend 记入 session_ended SSE event
   */
  async notifySessionEnd(
    sessionId: string,
    status: 'ended' | 'failed',
    reason: string,
  ): Promise<Record<string, unknown>> {
    return this._request<Record<string, unknown>>(
      'POST',
      `${REST_PREFIX}/sessions/${encodeURIComponent(sessionId)}/end`,
      { status, reason },
    );
  }

  /**
   * 2026-08-07-inject-wait-session-ready（FR-01 / D-001@v1）：上报 interactive
   * session ready（daemon create 完成），解除 backend inject 的 ready 等待。
   *
   * 端点：POST {REST_PREFIX}/sessions/{sessionId}/ready（body 空）。
   * 鉴权：_headers() 的 X-API-Key（daemon 长期凭证，与 notifySessionEnd 同款）。
   *
   * 调用链：daemon `_startInteractiveSession` create 成功（fresh）+
   * `restoreAndReconnect` create 成功（recover）→ hubClient.notifySessionReady
   * → backend SessionReadiness.mark_ready → inject_session 的 ready wait 解除
   *（秒级，零阻塞 inject）。调用点（task-02/03）负责确保仅在 create 成功后触发。
   *
   * **best-effort 失败语义**（与 notifySessionEnd/confirmReconnected 不同——后者
   * 失败抛错由调用方处理；本方法失败仅 warn 不抛，不阻塞 daemon 主循环）：
   * ready 上报是 inject 时序优化（A 方案），丢失只会让 backend inject 等 30s
   * 超时 fallback 仍发 SESSION_INJECT（兼容旧 daemon，design R-02），不应让上报
   * 失败拖垮 daemon 会话生命周期；backend 另有 recover mark_ready 双保险（R-03）。
   * 故方法内 try 包 _request，catch 仅 console.warn（事件名蛇形 + sessionId）。
   *
   * @param sessionId  AgentSession.id（SessionState.sessionId）
   */
  async notifySessionReady(sessionId: string): Promise<void> {
    try {
      await this._request(
        'POST',
        `${REST_PREFIX}/sessions/${encodeURIComponent(sessionId)}/ready`,
      );
    } catch (e) {
      // best-effort：ready 上报失败不抛不阻塞；backend 30s 超时 fallback 兼容（R-02）。
      console.warn('session_ready_notify_failed', {
        sessionId,
        error: String(e),
      });
    }
  }

  /**
   * 2026-08-29-daemon-platform-resilience task-07（design A3）：PERMISSION_REQUEST
   * 的 HTTP 上行兜底通道。
   *
   * 端点：POST {REST_PREFIX}/sessions/{sessionId}/permission-requests
   * 鉴权：_headers() 的 X-API-Key（daemon 长期凭证）+ X-Claim-Token（lease 级，
   * 该会话有 claim 语义时 backend 校验，对齐 runs/result 端点惯例）。
   *
   * 调用链：daemon.sendToHub 遇 WS 不通且 msg.type=PERMISSION_REQUEST 时改走本方法
   * → backend handle_permission_request_http 创建待审记录（与 WS 上行同源汇聚：
   * 复用 handle_permission_request 的校验/SSE 广播/dialog 持久化/5min timer）。
   * 人审等待不设时限——backend 5min 超时 + daemon fallback timer 双兜底，
   * 不再 fail-closed deny（断线期间人审挂起等待）。
   *
   * body：PERMISSION_REQUEST payload 原样透传（snake_case，session_id 冗余无害，
   * backend 以 path 为准）。
   *
   * **失败语义**：非 2xx → HubHttpError（403=claim token 不匹配；网络/超时透传）。
   * 调用方（daemon）fire-and-forget 降级 warn——resolve promise 交由
   * PERMISSION_RESPONSE（WS/补拉）或 fallback timer 收口。
   */
  async submitPermissionRequest(
    sessionId: string,
    payload: Record<string, unknown>,
    claimToken?: string,
  ): Promise<Record<string, unknown>> {
    const extraHeaders: Record<string, string> = {};
    if (claimToken) {
      extraHeaders['X-Claim-Token'] = claimToken;
    }
    return this._request<Record<string, unknown>>(
      'POST',
      `${REST_PREFIX}/sessions/${encodeURIComponent(sessionId)}/permission-requests`,
      payload,
      Object.keys(extraHeaders).length > 0 ? extraHeaders : undefined,
    );
  }

  // ── session 反馈事件 HTTP 上报（change 2026-08-24-platform-session-feedback-fix / FR-01~03）─

  /**
   * task-03（FR-01）：上报 Plan 模式进入事件。
   *
   * 端点：POST {REST_PREFIX}/sessions/{sessionId}/plan-mode-entered
   * body（snake_case，对齐 backend PlanModeEnteredEvent / task-01 DTO）：
   *   { session_id, run_id, summary: { objective, tasks, design_snippet? } }
   *
   * 失败语义（对齐 _request）：非 2xx → HubHttpError；网络/超时透传。
   * 调用方（task-04 session-manager 桥接）负责 fire-and-forget 或捕获处理。
   */
  async notifyPlanModeEntered(
    sessionId: string,
    runId: string,
    summary: { objective: string; tasks: string[]; design_snippet?: string },
  ): Promise<Record<string, unknown>> {
    return this._request<Record<string, unknown>>(
      'POST',
      `${REST_PREFIX}/sessions/${encodeURIComponent(sessionId)}/plan-mode-entered`,
      {
        session_id: sessionId,
        run_id: runId,
        summary,
      } satisfies NotifyPlanModeEnteredBody,
    );
  }

  /**
   * task-03（FR-01）：上报 Bash 执行状态事件。
   *
   * 端点：POST {REST_PREFIX}/sessions/{sessionId}/bash-status
   * body（snake_case，对齐 backend BashStatusEvent / task-01 DTO）：
   *   { session_id, run_id, command, status, exit_code?, elapsed_ms? }
   *
   * undefined 字段守卫写入（exit_code / elapsed_ms 缺省时不传 → backend 保留 None）。
   * 失败语义（对齐 _request）：非 2xx → HubHttpError；网络/超时透传。
   */
  async notifyBashStatus(
    sessionId: string,
    runId: string,
    command: string,
    status: 'running' | 'completed' | 'failed',
    exitCode?: number,
    elapsedMs?: number,
  ): Promise<Record<string, unknown>> {
    const body: NotifyBashStatusBody = {
      session_id: sessionId,
      run_id: runId,
      command,
      status,
    };
    if (exitCode !== undefined) body.exit_code = exitCode;
    if (elapsedMs !== undefined) body.elapsed_ms = elapsedMs;
    return this._request<Record<string, unknown>>(
      'POST',
      `${REST_PREFIX}/sessions/${encodeURIComponent(sessionId)}/bash-status`,
      body,
    );
  }

  /**
   * task-03（FR-02）：上报 Bash 实时输出块事件。
   *
   * 端点：POST {REST_PREFIX}/sessions/{sessionId}/bash-chunk
   * body（snake_case，对齐 backend BashChunkEvent / task-01 DTO）：
   *   { session_id, run_id, command, channel, content, is_final }
   *
   * 失败语义（对齐 _request）：非 2xx → HubHttpError；网络/超时透传。
   */
  async notifyBashChunk(
    sessionId: string,
    runId: string,
    command: string,
    channel: 'stdout' | 'stderr',
    content: string,
    isFinal: boolean,
  ): Promise<Record<string, unknown>> {
    return this._request<Record<string, unknown>>(
      'POST',
      `${REST_PREFIX}/sessions/${encodeURIComponent(sessionId)}/bash-chunk`,
      {
        session_id: sessionId,
        run_id: runId,
        command,
        channel,
        content,
        is_final: isFinal,
      } satisfies NotifyBashChunkBody,
    );
  }

  /**
   * task-03（FR-03）：上报 Agent 任务状态事件。
   * task-02（2026-08-27-background-subagent-progress / design §8）扩展：status 增
   * 'stopped'，新增 extra 可选对象透传扩展字段（tool_use_id/summary/last_tool_name/
   * elapsed_ms/total_tokens/tool_uses/async）。旧调用点（只传前 5 参）零改动成立。
   *
   * 端点：POST {REST_PREFIX}/sessions/{sessionId}/agent-task-status
   * body（snake_case，对齐 backend AgentTaskStatusEvent / task-01 DTO + task-02 扩展）：
   *   { session_id, run_id, task_id, task_name, status, progress?, message?,
   *     tool_use_id?, summary?, last_tool_name?, elapsed_ms?, total_tokens?,
   *     tool_uses?, async? }
   *
   * undefined 字段守卫写入（progress / message / extra.* 缺省时不传 → backend
   * 保留 None，向后兼容旧 daemon 上报行为）。
   * 失败语义（对齐 _request）：非 2xx → HubHttpError；网络/超时透传。
   */
  /**
   * ql-20260827-007：向 interactive session 注入一条唤醒消息（后台任务终态自动
   * 汇报）。端点：POST /api/daemon/sessions/{sessionId}/inject，body `{prompt}`；
   * X-API-Key 服务身份鉴权（与 notifyAgentTaskStatus 同款 _headers()）。backend
   * 侧 queue_when_busy=true——主 turn 在跑时排队，空闲即建新 turn 唤醒主代理。
   */
  async injectSessionPrompt(sessionId: string, prompt: string): Promise<Record<string, unknown>> {
    return this._request<Record<string, unknown>>(
      'POST',
      `/api/daemon/sessions/${sessionId}/inject`,
      { prompt },
    );
  }

  async notifyAgentTaskStatus(
    sessionId: string,
    runId: string,
    taskId: string,
    taskName: string,
    status: 'running' | 'completed' | 'failed' | 'stopped',
    progress?: number,
    message?: string,
    extra?: AgentTaskStatusExtraFields,
  ): Promise<Record<string, unknown>> {
    const body: NotifyAgentTaskStatusBody = {
      session_id: sessionId,
      run_id: runId,
      task_id: taskId,
      task_name: taskName,
      status,
    };
    if (progress !== undefined) body.progress = progress;
    if (message !== undefined) body.message = message;
    // task-02 扩展字段守卫写入（undefined 不进 body，向后兼容）
    if (extra?.tool_use_id !== undefined) {
      body.tool_use_id = extra.tool_use_id;
    }
    if (extra?.summary !== undefined) body.summary = extra.summary;
    if (extra?.last_tool_name !== undefined) {
      body.last_tool_name = extra.last_tool_name;
    }
    if (extra?.elapsed_ms !== undefined) body.elapsed_ms = extra.elapsed_ms;
    if (extra?.total_tokens !== undefined) {
      body.total_tokens = extra.total_tokens;
    }
    if (extra?.tool_uses !== undefined) body.tool_uses = extra.tool_uses;
    if (extra?.async !== undefined) body.async = extra.async;
    return this._request<Record<string, unknown>>(
      'POST',
      `${REST_PREFIX}/sessions/${encodeURIComponent(sessionId)}/agent-task-status`,
      body,
    );
  }

  // ── Daemon-restart session recovery (gap-8.2 / design §11) ───────────────
  // 实现 RecoveryCoordinator（daemon.ts:261）。daemon `_recoverSessionsOnBoot`
  // 调用序：recoverSession →（reconnecting）→ restoreAndReconnect（driver resume）
  // → confirmReconnected / markRecoveryFailed。鉴权：_headers() 的 X-API-Key
  //（backend get_current_principal）。backend 端点 body 要 runtime_id；runtimeId
  // 优先取调用方 opts 显式透传（task-06 DS-3 参数透传定案：reopen 路径
  // SESSION_RESUME payload 自带 runtime_id），否则 fallback
  // `_recoveryRuntimeBySession` 查表（recover 链路 recoverSession 时写入）。

  /**
   * gap-8.2：向 backend 收敛崩溃 currentRun + 写 session=reconnecting。
   * 端点 POST {REST_PREFIX}/sessions/{sessionId}/recover。
   * 返回 {status}（reconnecting / ended / failed / rejected），daemon 据此决定
   * 是否 restoreAndReconnect。同时记录 sessionId→runtimeId 供后续 confirm/markFailed。
   */
  async recoverSession(
    sessionId: string,
    params: {
      leaseId: string;
      runtimeId: string;
      provider: string;
      agentSessionId: string;
      interruptedRunId?: string;
    },
  ): Promise<{ status: SessionRecoverStatus }> {
    const body: Record<string, unknown> = {
      runtime_id: params.runtimeId,
      lease_id: params.leaseId,
      provider: params.provider,
      agent_session_id: params.agentSessionId,
    };
    if (params.interruptedRunId !== undefined) {
      body.interrupted_run_id = params.interruptedRunId;
    }
    const resp = await this._request<Record<string, unknown>>(
      'POST',
      `${REST_PREFIX}/sessions/${encodeURIComponent(sessionId)}/recover`,
      body,
    );
    this._recoveryRuntimeBySession.set(sessionId, params.runtimeId);
    return { status: String(resp.status ?? '') as SessionRecoverStatus };
  }

  /**
   * gap-8.2：恢复成功（reconnecting → active）后向 backend 确认。
   * 端点 POST {REST_PREFIX}/sessions/{sessionId}/confirm-reconnected。
   * task-06（DS-3）：opts 可显式透传 runtimeId（reopen 路径取自 SESSION_RESUME
   * payload）与 leaseId（绑定本次 lease，供 backend 防陈旧确认误翻）；缺省时
   * runtimeId fallback 映射查表（recover 链路）。无任何来源（未 recover 过且
   * 未传 opts.runtimeId）静默（不误调 backend）。
   */
  async confirmReconnected(
    sessionId: string,
    opts?: { leaseId?: string; runtimeId?: string },
  ): Promise<void> {
    const runtimeId =
      opts?.runtimeId ?? this._recoveryRuntimeBySession.get(sessionId);
    if (!runtimeId) return;
    const body: Record<string, unknown> = { runtime_id: runtimeId };
    if (opts?.leaseId) body.lease_id = opts.leaseId;
    await this._request(
      'POST',
      `${REST_PREFIX}/sessions/${encodeURIComponent(sessionId)}/confirm-reconnected`,
      body,
    );
    this._recoveryRuntimeBySession.delete(sessionId);
  }

  /**
   * gap-8.2：恢复失败（driver.start 抛错）后向 backend 写 reconnecting → failed。
   * 端点 POST {REST_PREFIX}/sessions/{sessionId}/mark-recovery-failed。
   * task-06（DS-3）：opts 语义同 confirmReconnected（runtimeId 显式透传 +
   * leaseId 绑定；缺省 fallback 映射查表）；无任何来源静默。
   */
  async markRecoveryFailed(
    sessionId: string,
    reason?: string,
    opts?: { leaseId?: string; runtimeId?: string },
  ): Promise<void> {
    const runtimeId =
      opts?.runtimeId ?? this._recoveryRuntimeBySession.get(sessionId);
    if (!runtimeId) return;
    const body: Record<string, unknown> = { runtime_id: runtimeId };
    if (opts?.leaseId) body.lease_id = opts.leaseId;
    if (reason) body.reason = reason;
    await this._request(
      'POST',
      `${REST_PREFIX}/sessions/${encodeURIComponent(sessionId)}/mark-recovery-failed`,
      body,
    );
    this._recoveryRuntimeBySession.delete(sessionId);
  }


  // -- Execution context 拉取（task-05：fetch bundle 上下文）--

  /**
   * 拉取 agent run 的完整执行上下文 bundle（CLAUDE.md / repo / branch / tool_config 等）。
   *
   * 端点：GET /api/agent-runs/{agentRunId}/execution-context（task-02 agent router）。
   *
   * **路径前缀注意**：用 `/api`（agent router 挂载点），**不用** REST_PREFIX（那是
   * `/api/daemon`，daemon module 专用前缀，拼接会变成 `/api/daemon/agent-runs/...` 404）。
   * design §7.1 + task-05 §边界处理 6 明确此约束。
   *
   * **鉴权**：沿用 _headers() 的 Bearer token；无 token 不带 Authorization（与既有方法一致）。
   *
   * **超时**：复用 DEFAULT_TIMEOUT_MS=30_000。
   *
   * **失败语义**：HTTP 非 2xx → 抛 HubHttpError；网络/超时 → 透传 fetch 原始错误
   *（不包装，对齐 _request 既有语义）。调用方（daemon._runLeaseStateMachine）按
   * R-03 捕获后继续降级执行，不中断 lease。
   *
   * @returns ExecutionContextPayload（snake_case 字段与后端 Pydantic 对齐）
   */
  async getExecutionContext(agentRunId: string): Promise<ExecutionContextPayload> {
    return this._request<ExecutionContextPayload>(
      'GET',
      `/api/agent-runs/${encodeURIComponent(agentRunId)}/execution-context`,
    );
  }

  // -- task-09 / D-006@v1：spec 按需 bundle pull / sync push（FR-05）--

  /**
   * 拉取 workspace 的 spec bundle（tar 流）。
   *
   * 端点：GET /api/workspaces/{wsId}/spec-workspace/bundle（task-06）。
   * 响应：200 application/x-tar（服务器 spec_root 整树打包，排除 .runtime）。
   *
   * **路径前缀**：用 `/api`（spec_workspace router 挂载点），不用 REST_PREFIX
   *（那是 /api/daemon，daemon module 专用）。与 getExecutionContext 同样的前缀约束。
   *
   * **二进制响应**：不走 _request（JSON 专用），单独 fetch + arrayBuffer() → Buffer。
   * 鉴权头复用 _headers() 的 Bearer / X-API-Key 优先级（apiKey 胜出），但 Content-Type
   * 不设（GET 无 body），Accept 设 application/x-tar 让 backend 明确期望。
   *
   * **失败语义**（对齐 _request）：
   *   - HTTP 非 2xx → 抛 HubHttpError（含 status/bodyText/url/method）。
   *   - 404 表示 spec_workspace 不存在或 spec_root 尚未 bootstrap（FR-05 首次执行）。
   *   - 网络/超时 → 透传 fetch 原始错误（不包装）。
   *
   * @returns tar 二进制 Buffer（调用方 _extractTar 负责解包到本地路径）
   */
  async getSpecBundle(wsId: string): Promise<Buffer> {
    const url = `${this.baseUrl}/api/workspaces/${encodeURIComponent(wsId)}/spec-workspace/bundle`;
    const headers: Record<string, string> = { Accept: 'application/x-tar' };
    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    } else if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    const resp = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    if (!resp.ok) {
      const bodyText = await resp.text();
      throw new HubHttpError(resp.status, bodyText, url, 'GET');
    }
    const ab = await resp.arrayBuffer();
    return Buffer.from(ab);
  }

  /**
   * 2026-08-20-session-multimodal-attachments task-09：下载会话附件字节。
   * 完全复刻 getSpecBundle 二进制 GET 模式（鉴权/超时/非 2xx HubHttpError）。
   * 端点 GET /api/daemon/session-attachments/<id>/content（归属校验在 backend）。
   */
  async downloadSessionAttachment(attachmentId: string): Promise<Buffer> {
    const url = `${this.baseUrl}/api/daemon/session-attachments/${encodeURIComponent(attachmentId)}/content`;
    const headers: Record<string, string> = { Accept: 'application/octet-stream' };
    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    } else if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    const resp = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    if (!resp.ok) {
      const bodyText = await resp.text();
      throw new HubHttpError(resp.status, bodyText, url, 'GET');
    }
    const ab = await resp.arrayBuffer();
    return Buffer.from(ab);
  }

  /**
   * 回传 daemon 执行后的 spec 整树（tar 流）到服务器。
   *
   * 端点：POST /api/workspaces/{wsId}/spec-workspace/sync（task-06）。
   * 请求：Content-Type: application/x-tar，body=tar Buffer（daemon 本地 spec_root 整树）。
   * 响应：200 { ok: true, reparsed: number }（reparsed = reparse 后 scan_docs 条数）。
   *
   * **路径前缀**：同 getSpecBundle，用 /api。
   *
   * **二进制请求**：不走 _request（它会 JSON.stringify body），单独 fetch，body 直接传
   * Buffer（Node fetch 原生支持 Buffer/Uint8Array 作为 body，自动处理 content-length）。
   * Content-Type 显式设 application/x-tar（覆盖默认 application/json）。
   *
   * **失败语义**（对齐 _request）：
   *   - HTTP 非 2xx → 抛 HubHttpError。
   *   - 413 Payload Too Large → spec 树过大（R-02），调用方应 log + 不中断 agent 结果。
   *   - 网络/超时 → 透传。
   *
   * @param wsId workspace id（与 getSpecBundle 同一个 id）
   * @param tarBuf tar 二进制（由 TaskRunner._packSpecDir 生成）
   * @returns backend 响应 { ok, reparsed }
   */
  async postSpecSync(
    wsId: string,
    tarBuf: Buffer,
    changeWriteId?: string,
  ): Promise<{ ok: boolean; reparsed: number }> {
    const url = `${this.baseUrl}/api/workspaces/${encodeURIComponent(wsId)}/spec-workspace/sync`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-tar',
    };
    if (changeWriteId) {
      headers['X-Change-Write-Id'] = changeWriteId;
    }
    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    } else if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: tarBuf,
      // tar 上传单独放宽（ql-20260816-002）：backend 全量 apply 实测 69s > 30s 默认超时
      signal: AbortSignal.timeout(SPEC_SYNC_TIMEOUT_MS),
    });
    if (!resp.ok) {
      const bodyText = await resp.text();
      throw new HubHttpError(resp.status, bodyText, url, 'POST');
    }
    return await parseJsonFromResponse<{ ok: boolean; reparsed: number }>(resp);
  }

  /**
   * 增量推送 daemon 本地 spec 文件改动到服务器（change 2026-08-13-platform-managed-file-sync；
   * task-01 2026-08-14-change-center-conversation-driven / D-005@v1 加 change_dirs 标注）。
   *
   * 端点：POST /api/workspaces/{wsId}/spec-workspace/sync-incremental（task-04）。
   * 请求：Content-Type: application/json（_request 已设），body
   * `{ ops: FileOp[], change_dirs: string[] }`，ops 字段与 backend schema.py 逐字一致
   * （op/path/new_path/hash/content/base_version）。change_dirs = 本次增量涉及变更目录名集合
   * （spec-sync.ts extractChangeDirs 计算；缺省 [] 兼容旧请求，backend SpecIncrementalSyncRequest
   * 默认 [] 不报错）。
   * 响应：200 `{ ok, new_versions, conflict, server_versions }`。
   *
   * **冲突语义**：backend 对 base_version 过期的 op 返回 conflict=true + server_versions
   * （HTTP 仍 200，design §7）。本方法**不抛错**，由调用方据 ``conflict`` 字段提示人工
   * 拍板；仅 HTTP 非 2xx（422 越界 payload / 404 旧后端无此端点 / 5xx）抛 HubHttpError。
   *
   * @param wsId workspace id
   * @param ops 增量 ops 列表（FileOp）
   * @param changeWriteId 可选透传 X-Change-Write-Id 头（spec-sync-visibility，向后兼容）
   * @param changeDirs 本次涉及变更目录名列表（`changes/<name>/` 与 `changes/archive/<name>/`
   *   前缀分组 key，去重）；缺省 []，旧 daemon 不传时 backend 前缀检测兜底
   * @returns backend 响应 { ok, new_versions, conflict, server_versions }
   */
  async postSpecSyncIncremental(
    wsId: string,
    ops: FileOp[],
    changeWriteId?: string,
    changeDirs: string[] = [],
  ): Promise<SpecIncrementalSyncResult> {
    // ⚠️ URL 必须用 /api 前缀（与旧 postSpecSync 一致），不能用 REST_PREFIX（= /api/daemon）——
    // backend spec_workspace router 挂在 prefix="/api"（main.py include_router），
    // 用 REST_PREFIX 拼出的 /api/daemon/workspaces/... 恒 404 → 增量永远回退旧 tar（QA afb1f508 揪出）。
    // 超时单独放宽（ql-20260816-002）：ops 含 base64 文件内容，payload 大时 30s 不够。
    return this._request<SpecIncrementalSyncResult>(
      'POST',
      `/api/workspaces/${encodeURIComponent(wsId)}/spec-workspace/sync-incremental`,
      { ops, change_dirs: changeDirs },
      changeWriteId ? { 'X-Change-Write-Id': changeWriteId } : undefined,
      SPEC_SYNC_TIMEOUT_MS,
    );
  }

  // -- task-11 / FR-08 / D-004@v1：daemon-client change-write 轻量回执通道 ---------

  /**
   * task-11：拉取 runtime 下所有 pending change-write 任务（FR-08）。
   *
   * 端点：GET {REST_PREFIX}/runtimes/{runtimeId}/pending-change-writes（task-09）。
   * 与 ``getPendingLeases`` 同款 GET（无 body），返回 pending change-write 列表。
   *
   * 响应元素字段（对齐 backend ``ChangeWritePendingItem``，snake_case）：
   *   - task_id / change_key / workspace_id / files[]{path,content} / created_at
   *
   * 失败语义对齐 ``_request``：HTTP 非 2xx → HubHttpError；网络/超时透传 fetch 原始错误。
   */
  async getPendingChangeWrites(
    runtimeId: string,
  ): Promise<Record<string, unknown>[]> {
    return this._request<Record<string, unknown>[]>(
      'GET',
      `${REST_PREFIX}/runtimes/${encodeURIComponent(runtimeId)}/pending-change-writes`,
    );
  }

  /**
   * task-11：抢占一行 pending change-write，换取 claim_token。
   *
   * 端点：POST {REST_PREFIX}/change-writes/{id}/claim（task-09）。
   *
   * **端点签名**：task-09 ``claim_change_write`` 路径参数只有 ``change_write_id``，
   * **无 body**（claim_token 由后端生成、运行时身份经 ``get_current_principal`` 的
   * X-API-Key/Bearer 鉴权头确认，与 lease claim 端点同款）。故本方法不发 body，
   * runtimeId 仅用于日志/调试透传（不进请求）。
   *
   * 响应字段（对齐 backend ``ChangeWriteClaimResponse``）：
   *   - task_id / claim_token / change_key / files[]
   *
   * 失败语义：404（不存在）/ 409（非 pending，已被他人 claim）→ HubHttpError。
   */
  async claimChangeWrite(
    changeWriteId: string,
    _runtimeId?: string,
  ): Promise<Record<string, unknown>> {
    // runtimeId 参数保留用于调用方语义对齐 getPendingChangeWrites/lease 流，
    // 但 task-09 端点不接受 body，故不进请求（参考 hub-client 既有 lease claim 风格）。
    void _runtimeId;
    return this._request<Record<string, unknown>>(
      'POST',
      `${REST_PREFIX}/change-writes/${encodeURIComponent(changeWriteId)}/claim`,
    );
  }

  /**
   * task-11：回执 change-write 执行结果（ok/files 或 error）。
   *
   * 端点：POST {REST_PREFIX}/change-writes/{id}/complete（task-09）。
   *
   * body 字段（对齐 backend ``ChangeWriteCompleteRequest``，snake_case）：
   *   - claim_token：claimChangeWrite 返回的令牌（token 轮转校验）
   *   - ok：true=写成功→done / false=失败→failed
   *   - files[]：实际写入的相对路径清单（ok=true 时回写，可选）
   *   - error：失败原因（ok=false 时，可选）
   *
   * 与 ``completeLease`` 同款 POST + snake_case body 风格。
   *
   * 失败语义：409（非 claimed / token 不匹配）→ HubHttpError。
   *
   * @param payload  ``{ ok, files?, error? }``（claim_token 由本方法注入，调用方不传）
   */
  async completeChangeWrite(
    changeWriteId: string,
    claimToken: string,
    payload: {
      ok: boolean;
      files?: unknown[];
      error?: string;
    },
  ): Promise<Record<string, unknown>> {
    const body: ChangeWriteCompleteBody = {
      claim_token: claimToken,
      ok: payload.ok,
    };
    if (payload.files !== undefined) {
      body.files = payload.files;
    }
    if (payload.error !== undefined) {
      body.error = payload.error;
    }
    return this._request<Record<string, unknown>>(
      'POST',
      `${REST_PREFIX}/change-writes/${encodeURIComponent(changeWriteId)}/complete`,
      body,
    );
  }

  /**
   * ql-20260813-spec-sync-visibility Wave 3 task-08：上报同步进度计数（FR-05/FR-06）。
   *
   * 端点：PATCH /api/daemon/change-writes/{id}/progress。backend status==claimed 校验
   * （BL-3）+ claim_token 匹配；仅写 files_total/files_processed，不改 status（D-004
   * 单一写者——终态仍由 completeChangeWrite 置 done/failed）。daemon spec-sync 分支
   * 在 complete 前上报终态计数 {files_total, files_processed: files_total}。
   */
  async reportChangeWriteProgress(
    changeWriteId: string,
    claimToken: string,
    payload: { files_total?: number; files_processed?: number },
  ): Promise<Record<string, unknown>> {
    const body: ChangeWriteProgressBody = { claim_token: claimToken };
    if (payload.files_total !== undefined) {
      body.files_total = payload.files_total;
    }
    if (payload.files_processed !== undefined) {
      body.files_processed = payload.files_processed;
    }
    return this._request<Record<string, unknown>>(
      'PATCH',
      `${REST_PREFIX}/change-writes/${encodeURIComponent(changeWriteId)}/progress`,
      body,
    );
  }

  // -- task-05 / D-007@v2：team 主 agent MCP 反向通道（daemon MCP server → backend）--
  //
  // 5 endpoint 挂在 agent router（/api 前缀，非 REST_PREFIX=/api/daemon），与
  // getExecutionContext / getSpecBundle 同款用 /api 前缀。backend mcp_tools.py
  // 5 endpoint 均要求 Permission.WORKSPACE_WRITE，鉴权走 _headers() 的 Bearer
  // token（主 agent run 的 user token，非 daemon apiKey）—— backend
  // require_permission(get_current_principal) 解析 Authorization Bearer。
  //
  // **无 X-Claim-Token**：与 notifyRunResult 不同，mcp_tools 5 endpoint 不接受
  // lease 级 claim_token header（无 lease 概念，主 agent run 直接以 user token
  // 鉴权）。TaskCard 提"X-Claim-Token 二级鉴权"是 change-write 范式误植，以
  // backend mcp_tools.py 真实契约为准（D-007@v2 偏离记录）。

  /**
   * task-05：派一个 worker run（D-002@v2）。
   *
   * 端点：POST /api/workspaces/{ws}/missions/{mid}/dispatch_worker
   * body（snake_case，对齐 backend ``DispatchWorkerRequest``）：
   *   { objective, role?, agent_type?, model?, read_only?,
   *     worktree_path?, branch?, worker_prompt? }
   * 响应 201（``WorkerRunResponse``）：{ id, role, objective, status, agent_type,
   *   lease_id?, error_code? }
   *
   * daemon 离线时 backend 仍返回 201 + ``error_code='no_online_daemon'``（run
   * 建 pending），主 agent 可读 status 决定重派——故 2xx 即成功，error_code
   * 透传到响应由调用方判读。
   *
   * task-06（2026-08-08-dispatch-worker-caller-worktree / R-06 / D-009）：路径A
   * 增量可选参 ``worktree_path``/``branch``/``worker_prompt`` 透传 backend。
   * undefined 不写入 body（对齐 notifyRunResult 守卫风格）→ backend None → 走原
   * team 模式自建 worktree / render_worker_prompt 逻辑（零回归）。链路A daemon
   * stdio 与链路B public gateway schema 同构。
   */
  async dispatchWorker(
    workspaceId: string | undefined,
    missionId: string | undefined,
    body: {
      objective: string;
      role?: string;
      agent_type?: string;
      model?: string;
      read_only?: boolean;
      // task-06 路径A：caller-worktree / external 模式增量参（design §7.3）
      worktree_path?: string;
      branch?: string;
      worker_prompt?: string;
      // task-10：跨工作区派发目标工作区 ID（可选，缺省用 anchor）
      target_workspace_id?: string;
    },
  ): Promise<Record<string, unknown>> {
    const payload: Record<string, unknown> = { objective: body.objective };
    if (body.role !== undefined) payload.role = body.role;
    if (body.agent_type !== undefined) payload.agent_type = body.agent_type;
    if (body.model !== undefined) payload.model = body.model;
    if (body.read_only !== undefined) payload.read_only = body.read_only;
    // task-06 路径A：undefined → 不写入 body → backend None → team 模式零回归。
    if (body.worktree_path !== undefined) payload.worktree_path = body.worktree_path;
    if (body.branch !== undefined) payload.branch = body.branch;
    if (body.worker_prompt !== undefined) payload.worker_prompt = body.worker_prompt;
    // task-10：跨工作区派发，undefined → backend None → 缺省用 anchor workspace
    if (body.target_workspace_id !== undefined) payload.target_workspace_id = body.target_workspace_id;
    // task-10（审查 B1）：ws/mid 可选（X-Session-Id 定位 + 懒建兜底），请求附会话头。
    return this._request<Record<string, unknown>>(
      'POST',
      this._missionActionPath(workspaceId, missionId, 'dispatch_worker'),
      payload,
      this._sessionIdHeaders(),
    );
  }

  /**
   * task-05：读单个 worker 的结构化产出（AgentArtifact kind=patch/summary/...）。
   *
   * 端点：GET /api/workspaces/{ws}/missions/{mid}/workers/{wid}/result
   * 响应（``WorkerResultResponse``）：{ worker_id, status, artifacts: [{kind,
   *   content_ref, id}] }
   */
  async getWorkerResult(
    workspaceId: string | undefined,
    missionId: string | undefined,
    workerId: string,
  ): Promise<Record<string, unknown>> {
    // task-10：ws/mid 可选（X-Session-Id 定位），worker_id 必填。
    return this._request<Record<string, unknown>>(
      'GET',
      this._missionActionPath(
        workspaceId,
        missionId,
        `workers/${encodeURIComponent(workerId)}/result`,
      ),
      undefined,
      this._sessionIdHeaders(),
    );
  }

  /**
   * task-05：列 mission 下所有 worker runs 状态（含主 agent run）。
   *
   * 端点：GET /api/workspaces/{ws}/missions/{mid}/workers
   * 响应（``WorkerListResponse``）：{ mission_id, workers: [{id, role?, status,
   *   objective?, total_cost_usd?}] }
   */
  async listWorkers(
    workspaceId: string | undefined,
    missionId: string | undefined,
  ): Promise<Record<string, unknown>> {
    // task-10：ws/mid 可选（X-Session-Id 定位）。
    return this._request<Record<string, unknown>>(
      'GET',
      this._missionActionPath(workspaceId, missionId, 'workers'),
      undefined,
      this._sessionIdHeaders(),
    );
  }

  /**
   * task-05：触发 mission 收敛（复用 FinalizerService + converge 链路）。
   *
   * 端点：POST /api/workspaces/{ws}/missions/{mid}/converge
   * 响应（``ConvergeResponse``）：{ mission_id, status, converged, artifact_id? }
   *
   * 无 body（backend 以 mission 的主 agent run 为锚点触发收敛，参数全在路径）。
   */
  async convergeMission(
    workspaceId: string | undefined,
    missionId: string | undefined,
  ): Promise<Record<string, unknown>> {
    // task-10：ws/mid 可选（converge 按 X-Session-Id 解析 mission，design §5 D-010）。
    return this._request<Record<string, unknown>>(
      'POST',
      this._missionActionPath(workspaceId, missionId, 'converge'),
      undefined,
      this._sessionIdHeaders(),
    );
  }

  /**
   * task-11（2026-08-24-session-team-mission-context / FR-02）：查当前会话团队
   * 任务状态（mission_status 常驻工具的 client 方法，只读）。
   *
   * 端点：GET _missionActionPath(action='status')——ws/mid 缺省时 session-scoped
   * 形态 ``/api/missions/status``（backend task-03 契约，按 ``X-Session-Id`` 定位）；
   * 显式传参走 ``/api/workspaces/{ws}/missions/{mid}/status``（越权校验锚）。
   *
   * 响应（backend ``MissionStatusResponse``）：``{ active, hint?, mission_id?,
   * status?, objective?, anchor_workspace?, scope_workspaces[], workers[],
   * budget_usd? }``。**无活跃 mission 时 200 ``active=false`` + hint**（D-005@v1
   * 优雅返回，不走 404）——2xx 即原样返回，由调用方（工具层）透传不报错。
   *
   * 瘦客户端惯例：不缓存不重试，非 2xx 抛 HubHttpError、网络错误透传 fetch
   * 原始异常（同既有 5 方法）。
   */
  async getMissionStatus(
    workspaceId: string | undefined,
    missionId: string | undefined,
  ): Promise<Record<string, unknown>> {
    return this._request<Record<string, unknown>>(
      'GET',
      this._missionActionPath(workspaceId, missionId, 'status'),
      undefined,
      this._sessionIdHeaders(),
    );
  }

  /**
   * task-06（2026-08-25-team-subsession-governance / FR-03 / D-003@v1，design
   * §5.C.1→§5.C.2）：分身显式完成信号（分身受限 MCP server 的唯一转发方法）。
   *
   * 端点：POST _missionActionPath(action='worker_done')——backend task-07 四路由族
   * 同构（``mcp_tools._worker_done_core``）：
   *   - ws+mid → ``/api/workspaces/{ws}/missions/{mid}/worker_done``
   *   - 仅 mid → ``/api/missions/{mid}/worker_done``
   *   - 均缺省 → ``/api/missions/worker_done``（分身受限 server 缺参调用主形态）
   *
   * body（snake_case，对齐 backend ``WorkerDoneRequest``）：``{ summary,
   * workspace_id?, mission_id? }``。**会话定位由 X-Session-Id 承载**（``auth.sessionId``
   * → ``_sessionIdHeaders``；backend 缺头 400，沿 parent 链爬根解析 mission）；显式
   * ws/mid 同时写进 body 作越权校验锚——仅 workspaceId 缺 missionId 时路径回落
   * header-only 形态（``_missionActionPath`` 忽略 workspaceId），锚必须靠 body 字段
   * 保住（backend ``anchor_workspace_id = workspace_id or payload.workspace_id``）。
   *
   * 响应（``WorkerDoneResponse``）：``{ mission_id, session_id, run_id, artifact_id,
   * worker_done_at, all_workers_done, orchestrator_notified }``。非 2xx 抛
   * HubHttpError（迟到 mission 终态 409 / 非分身会话 422 等，由 mcp-server
   * ``errorContent`` 转结构化回执）；网络/超时透传 fetch 原始异常（同既有方法）。
   */
  async workerDone(
    workspaceId: string | undefined,
    missionId: string | undefined,
    body: { summary: string },
  ): Promise<Record<string, unknown>> {
    const payload: Record<string, unknown> = { summary: body.summary };
    // 显式参数作越权校验锚：undefined / 空串不写入 body（守卫风格，零回归）。
    if (workspaceId !== undefined && workspaceId !== '') {
      payload.workspace_id = workspaceId;
    }
    if (missionId !== undefined && missionId !== '') {
      payload.mission_id = missionId;
    }
    return this._request<Record<string, unknown>>(
      'POST',
      this._missionActionPath(workspaceId, missionId, 'worker_done'),
      payload,
      this._sessionIdHeaders(),
    );
  }

  // -- task-05（2026-08-23-agent-file-upload-mcp / D-005@v1）：agent 文件制品通道 --
  //
  // 端点挂在 agent router（/api 前缀，非 REST_PREFIX=/api/daemon），与 5 个编排
  // MCP 端点同款。backend ``app/modules/agent/file_artifacts.py``（task-03 落地）：
  //   - POST /api/agent/file-artifacts（multipart）：file + description? + run_id?
  //     → 201 FileUploadResp { id, original_name, mime_type, size, description }
  //   - GET /api/agent/file-artifacts?session_id=|run_id=
  //     → { files: [FileMetaResp { id, original_name, mime_type, size, description,
  //       created_at }] }（created_at 倒序）
  //
  // **字段名映射（契约注意）**：backend 响应文件 id 字段名是 ``id``（FileUploadResp.id
  // / FileMetaResp.id），agent 工具输出统一用 ``file_id``（design §7.1 口径）——
  // 映射在本层完成，mcp-server tool handler 直接 okContent 即得 file_id 字段名。

  /**
   * task-05：上传一个 agent 文件制品（multipart 直传，不经 agent 对话上下文）。
   *
   * 端点：POST /api/agent/file-artifacts
   * 场景（design §7.2，二选一）：
   *   - 会话主 agent：HubClientAuth.sessionId → 请求附 ``X-Session-Id`` 头
   *     （backend 据此定位会话活跃 run，owner_type=agent_session）；
   *   - 批任务 worker：params.runId → multipart ``run_id`` 字段（owner_type=agent_run）。
   *
   * **multipart 关键约束**：body 用 Node 20 原生 FormData + Blob 装文件字节，
   * **不设手工 Content-Type**——fetch 自动生成含 boundary 的
   * ``multipart/form-data; boundary=...`` 头；``_headers()`` 的
   * ``application/json`` 绝不能随 multipart body 发（会破坏 boundary，task 约束）。
   * 鉴权头（X-API-Key / Bearer）照 ``_headers()`` 同款优先级单独构造。
   *
   * **超时**：单独放宽到 300s（对齐 SPEC_SYNC_TIMEOUT_MS 先例）——文件受
   * ``file_max_size_mb`` 上限约束可达几十 MB，30s 默认值在大文件 + 慢网络下假失败。
   *
   * 失败语义（对齐 _request）：HTTP 非 2xx（413 超限 / 403 越权 / 422 上下文缺失）
   * → HubHttpError；网络/超时 → 透传 fetch 原始错误。
   *
   * @returns backend FileUploadResp，``id`` 已映射为 ``file_id``（agent 工具口径）
   */
  async uploadFileArtifact(params: {
    /** 文件原始名（multipart filename，落 File.original_name）。 */
    filename: string;
    /** 文件字节（mcp-server 本地读盘所得）。 */
    data: Uint8Array;
    /** 文件 MIME 类型（multipart part Content-Type；缺省 application/octet-stream）。 */
    mimeType?: string;
    /** 可选描述（落 File.description，前端文件卡片展示）。 */
    description?: string;
    /** worker 场景 run id（会话场景缺省，走 X-Session-Id）。 */
    runId?: string;
  }): Promise<FileArtifactUploadResult> {
    const url = `${this.baseUrl}/api/agent/file-artifacts`;
    // FormData（Node 20 原生，undici 提供）：file 用 Blob 装字节 + filename；
    // description/run_id 缺省不 append（backend Form() 默认值兜底：""/None）。
    const form = new FormData();
    form.append(
      'file',
      new Blob([params.data], {
        type: params.mimeType || 'application/octet-stream',
      }),
      params.filename,
    );
    if (params.description !== undefined) {
      form.append('description', params.description);
    }
    if (params.runId !== undefined) {
      form.append('run_id', params.runId);
    }
    // 鉴权头照 _headers() 口径（apiKey 优先），但不带其 Content-Type（见上）。
    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    } else if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    // 会话场景附 X-Session-Id（与 5 个编排 MCP 端点同源，_sessionIdHeaders 单一来源）。
    const sessionHeaders = this._sessionIdHeaders();
    if (sessionHeaders) {
      Object.assign(headers, sessionHeaders);
    }
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: form,
      signal: AbortSignal.timeout(FILE_ARTIFACT_TIMEOUT_MS),
    });
    if (!resp.ok) {
      const bodyText = await resp.text();
      throw new HubHttpError(resp.status, bodyText, url, 'POST');
    }
    const body = await parseJsonFromResponse<FileArtifactUploadBackendResp>(resp);
    return {
      file_id: String(body.id),
      original_name: body.original_name,
      mime_type: body.mime_type,
      size: body.size,
      description: body.description ?? null,
    };
  }

  /**
   * task-05：按会话 / run 列已上传文件制品（list_uploaded_files 工具数据源）。
   *
   * 端点：GET /api/agent/file-artifacts?session_id={id} 或 ?run_id={id}
   * （backend 要求二选一，均无 → 422；调用方按注入上下文 MCP_SESSION_ID /
   * MCP_RUN_ID 决定传哪个）。WORKSPACE_READ 读级鉴权。
   *
   * @returns ``{ files: [FileArtifactMeta] }``，``id`` 已映射为 ``file_id``
   *   （含 description/created_at，task-03 契约字段）
   */
  async listFileArtifacts(params: {
    sessionId?: string;
    runId?: string;
  }): Promise<FileArtifactListResult> {
    const query = new URLSearchParams();
    if (params.sessionId) query.set('session_id', params.sessionId);
    if (params.runId) query.set('run_id', params.runId);
    const qs = query.size > 0 ? `?${query.toString()}` : '';
    const body = await this._request<{ files: FileArtifactMetaBackendResp[] }>(
      'GET',
      `/api/agent/file-artifacts${qs}`,
    );
    return {
      files: body.files.map((f) => ({
        file_id: String(f.id),
        original_name: f.original_name,
        mime_type: f.mime_type,
        size: f.size,
        description: f.description ?? null,
        created_at: f.created_at,
      })),
    };
  }

  /**
   * task-05：落主 agent 决策日志（AgentRunLog channel=tool_call, tool_kind=other）。
   *
   * 端点：POST /api/workspaces/{ws}/missions/{mid}/progress
   * body（snake_case，对齐 backend ``ProgressRequest``）：
   *   { run_id, message, decision? }
   * 响应 201（``ProgressResponse``）：{ run_id, log_id }
   *
   * **run_id 可选（task-10 审查 B1）**：显式传参时透传（越权校验锚）；缺省时
   * 不写入 body，backend 按 ``X-Session-Id`` 解析会话当前主控 run。非 task
   * 描述草案的 ``note``。``decision`` 拼到日志 content 前缀便于筛选。
   */
  async reportProgress(
    workspaceId: string | undefined,
    missionId: string | undefined,
    body: {
      /** task-10（审查 B1）：转可选——缺省时 backend 按 X-Session-Id 解析主控 run。 */
      run_id?: string;
      message: string;
      decision?: string;
    },
  ): Promise<Record<string, unknown>> {
    const payload: Record<string, unknown> = {
      message: body.message,
    };
    // task-10：run_id 守卫（undefined 不写入 body → backend 按会话解析主控 run）。
    if (body.run_id !== undefined) payload.run_id = body.run_id;
    if (body.decision !== undefined) payload.decision = body.decision;
    return this._request<Record<string, unknown>>(
      'POST',
      this._missionActionPath(workspaceId, missionId, 'progress'),
      payload,
      this._sessionIdHeaders(),
    );
  }
}

/** task-11：complete_change_write 请求体（snake_case 对齐 backend Pydantic）。 */
interface ChangeWriteCompleteBody {
  claim_token: string;
  ok: boolean;
  files?: unknown;
  error?: string;
}

/** ql-20260813-spec-sync-visibility task-08：progress 上报请求体。 */
interface ChangeWriteProgressBody {
  claim_token: string;
  files_total?: number;
  files_processed?: number;
}

// ── task-08 / D-017：MCP whitelist 拉取（profile 子集层配套）─────────────────

/**
 * task-08（D-017）：从 backend 拉 MCP server 白名单（server 名列表）。
 *
 * 调 `GET /api/platform-settings/mcp-whitelist`（backend
 * ``settings/router.py:215`` ``get_mcp_whitelist``，返回顶层 JSON 字符串数组）。
 * 网络/非 200/解析失败 → 返回 null（调用方决定回落策略，对齐
 * ``fetchPlatformMcpConfig`` 的 null 语义）。
 *
 * **与 fetchPlatformMcpConfig 同源**（design §9）：同 base url 拼接、同 Bearer
 * 鉴权头、同 fetch 范式、同 null-on-failure 语义。fetchPlatformMcpConfig 定义在
 * ``mcp-config.ts``（拉平台默认 MCP 配置对象），本函数拉白名单字符串数组——两者
 * 配合构成 daemon 端 MCP 配置拉取全套（profile.mcp_refs 子集过滤在
 * ``mergeMcpConfigs`` 内做）。
 *
 * **鉴权**：backend ``get_mcp_whitelist`` 要 ``SettingsAdminUser``。daemon 经
 * ``token``（Bearer JWT）请求——对应 admin 用户发起的 daemon 配置场景。
 * apiKey（X-API-Key）路径的 admin 权限校验由 backend ``get_current_principal``
 * 处理，本函数只发 ``Authorization: Bearer``（与 fetchPlatformMcpConfig 一致）；
 * 调用方（task-09/10）负责传对的凭证。
 *
 * @param serverUrl  backend 根 URL（如 'http://localhost:8000'）
 * @param token      daemon Bearer token（与 fetchPlatformMcpConfig 同源；null 不带鉴权头）
 * @param logger     可选日志回调（失败时 warn），签名兼容 mcp-config.ts McpConfigLogger
 * @returns 白名单 server 名数组；fetch 失败/响应非数组 → null
 */
export async function fetchMcpWhitelist(
  serverUrl: string,
  token: string | null,
  logger?: (
    level: 'debug' | 'info' | 'warn' | 'error',
    msg: string,
    data?: Record<string, unknown>,
  ) => void,
): Promise<string[] | null> {
  const url = `${serverUrl.replace(/\/$/, '')}/api/platform-settings/mcp-whitelist`;
  try {
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      logger?.('warn', 'mcp_whitelist_fetch_failed', { url, status: resp.status });
      return null;
    }
    // backend 返回顶层 JSON 数组（list[str]），非 { ... } 包裹。
    const body = await parseJsonFromResponse<unknown>(resp);
    if (Array.isArray(body)) {
      // 防御：过滤非字符串元素（backend 契约是 list[str]，但容错）
      return body.filter((x): x is string => typeof x === 'string');
    }
    logger?.('warn', 'mcp_whitelist_unexpected_shape', { url, bodyType: typeof body });
    return null;
  } catch (e) {
    logger?.('warn', 'mcp_whitelist_fetch_unreachable', { url, error: String(e) });
    return null;
  }
}
