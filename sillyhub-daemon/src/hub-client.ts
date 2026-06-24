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
import type { ExecutionContextPayload } from './types.js';
import type { SessionRecoverStatus } from './daemon.js';

// ── body 类型（字段名 snake_case 对齐 backend Pydantic 模型）──────────────────

/** register 请求体。必填字段总写入（空串也算），条件字段按存在性写入。 */
export interface RegisterBody {
  name: string;
  provider: string;
  version: string;
  os: string;
  arch: string;
  /** 仅当调用方提供 runtimeId 时写入（对齐 Python `if runtime_id is not None`）。 */
  runtime_id?: string;
  /** 仅当非空串时写入（对齐 Python `if protocol:`）。 */
  protocol?: string;
  /** 仅当非 undefined 时写入（对齐 Python `if capabilities:`）。 */
  capabilities?: Record<string, unknown>;
  /** 对应 Python **kwargs 透传字段。 */
  [extra: string]: unknown;
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
  messages: Record<string, unknown>[];
}

/** complete_lease 请求体。 */
export interface CompleteLeaseBody {
  claim_token: string;
  result: Record<string, unknown>;
}

/** heartbeat（runtime 心跳）请求体。 */
export interface HeartbeatBody {
  runtime_id: string;
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
 * Auth credentials for daemon → server requests.
 *
 * Either ``token`` (browser-style Bearer JWT, short-lived) or ``apiKey``
 * (long-lived opaque key, sent via ``X-API-Key``). At most one should be
 * set; if both are present, ``apiKey`` wins on the wire (matches the
 * backend ``get_current_principal`` semantics where X-API-Key is the
 * fallback for non-browser callers).
 */
export interface HubClientAuth {
  token?: string;
  apiKey?: string;
}

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

  /**
   * gap-8.2（design §11）：sessionId → runtimeId 映射。
   *
   * RecoveryCoordinator.confirmReconnected/markRecoveryFailed 接口只传
   * sessionId（daemon.ts:277/279），但 backend recovery 端点要 runtime_id
   * （ownership guard）。recoverSession 时存映射，confirm/markFailed 查表补
   * runtime_id；调用后删除（一次性）。daemon 活着期间映射有效（重启 = 全新
   * 恢复流程，映射重建）。
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
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const resp = await fetch(url, {
      method,
      headers: this._headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      // Node 原生 fetch 默认不读 HTTP_PROXY/HTTPS_PROXY（等价 trust_env=False），
      // 显式不设置 dispatcher 即可。
    });
    if (!resp.ok) {
      const bodyText = await resp.text();
      throw new HubHttpError(resp.status, bodyText, url, method);
    }
    return (await resp.json()) as T;
  }

  // -- Runtime 生命周期（FR-03 / FR-07）--

  /**
   * 注册 daemon runtime。
   *
   * body 条件字段拼装严格对齐 client.py:83-96：
   *   - 必填（总写入，即使空串）：name / provider / version / os / arch
   *   - runtime_id：仅当调用方提供 runtimeId 时写入（Python `if runtime_id is not None`）
   *   - protocol：仅当非空串写入（Python `if protocol:`）
   *   - capabilities：仅当非 undefined 时写入（Python `if capabilities:`）
   *   - extra：展开进 body（对应 Python `**kwargs` 透传，client.py:89）
   *
   * 返回 backend 响应（通常含 `{ runtime_id }`）。
   */
  async register(params: {
    runtimeId?: string;
    name?: string;
    provider?: string;
    version?: string;
    protocol?: string;
    os?: string;
    arch?: string;
    capabilities?: Record<string, unknown>;
    /** 对应 Python **kwargs 透传字段。 */
    extra?: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    const body: RegisterBody = {
      name: params.name ?? '',
      provider: params.provider ?? '',
      version: params.version ?? '',
      os: params.os ?? '',
      arch: params.arch ?? '',
      ...(params.extra ?? {}),
    };
    if (params.runtimeId !== undefined) {
      body.runtime_id = params.runtimeId;
    }
    if (params.protocol) {
      // 非空串才写入（Python `if protocol:`）
      body.protocol = params.protocol;
    }
    if (params.capabilities) {
      // 非 undefined 才写入（Python `if capabilities:`）
      body.capabilities = params.capabilities;
    }
    return this._request<Record<string, unknown>>(
      'POST',
      `${REST_PREFIX}/register`,
      body,
    );
  }

  /**
   * runtime HTTP 心跳（非 lease 心跳）。
   * 端点：POST {REST_PREFIX}/heartbeat，body `{ runtime_id }`。
   */
  async heartbeat(runtimeId: string): Promise<Record<string, unknown>> {
    return this._request<Record<string, unknown>>(
      'POST',
      `${REST_PREFIX}/heartbeat`,
      { runtime_id: runtimeId } satisfies HeartbeatBody,
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
   */
  async completeLease(
    leaseId: string,
    claimToken: string,
    result: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this._request<Record<string, unknown>>(
      'POST',
      `${REST_PREFIX}/leases/${encodeURIComponent(leaseId)}/complete`,
      { claim_token: claimToken, result } satisfies CompleteLeaseBody,
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
   * @param payload  { status, is_error, subtype?, result_summary? }
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
    return (await resp.json()) as Record<string, unknown>;
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

  // ── Daemon-restart session recovery (gap-8.2 / design §11) ───────────────
  // 实现 RecoveryCoordinator（daemon.ts:261）。daemon `_recoverSessionsOnBoot`
  // 调用序：recoverSession →（reconnecting）→ restoreAndReconnect（driver resume）
  // → confirmReconnected / markRecoveryFailed。鉴权：_headers() 的 X-API-Key
  // （backend get_current_principal）。backend 端点 body 要 runtime_id；接口
  // confirm/markFailed 只传 sessionId → 经 `_recoveryRuntimeBySession` 查表。

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
   * runtime_id 经映射查表；无映射（未 recover 过）静默（不误调 backend）。
   */
  async confirmReconnected(sessionId: string): Promise<void> {
    const runtimeId = this._recoveryRuntimeBySession.get(sessionId);
    if (!runtimeId) return;
    await this._request(
      'POST',
      `${REST_PREFIX}/sessions/${encodeURIComponent(sessionId)}/confirm-reconnected`,
      { runtime_id: runtimeId },
    );
    this._recoveryRuntimeBySession.delete(sessionId);
  }

  /**
   * gap-8.2：恢复失败（driver.start 抛错）后向 backend 写 reconnecting → failed。
   * 端点 POST {REST_PREFIX}/sessions/{sessionId}/mark-recovery-failed。
   */
  async markRecoveryFailed(sessionId: string, reason?: string): Promise<void> {
    const runtimeId = this._recoveryRuntimeBySession.get(sessionId);
    if (!runtimeId) return;
    const body: Record<string, unknown> = { runtime_id: runtimeId };
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
  ): Promise<{ ok: boolean; reparsed: number }> {
    const url = `${this.baseUrl}/api/workspaces/${encodeURIComponent(wsId)}/spec-workspace/sync`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-tar',
    };
    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    } else if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: tarBuf,
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    if (!resp.ok) {
      const bodyText = await resp.text();
      throw new HubHttpError(resp.status, bodyText, url, 'POST');
    }
    return (await resp.json()) as { ok: boolean; reparsed: number };
  }
}
