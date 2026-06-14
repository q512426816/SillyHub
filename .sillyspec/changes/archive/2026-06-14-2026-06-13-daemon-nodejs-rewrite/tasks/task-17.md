---
author: qinyi
created_at: 2026-06-14T00:08:01+0800
id: task-17
title: HubClient REST（src/hub-client.ts，lease 生命周期端点，原生 fetch）
priority: P0
estimated_hours: 4
depends_on: [task-03]
blocks: [task-19, task-20, task-22]
allowed_paths:
  - sillyhub-daemon/src/hub-client.ts
---

# task-17 — HubClient REST（src/hub-client.ts，lease 生命周期端点，原生 fetch）

> 变更：`2026-06-13-daemon-nodejs-rewrite` · Wave W3（通信层）。
> Python 源对照：`sillyhub_daemon/client.py`（193 行，`HubClient` class + 8 个 async 方法）。
> 职责：封装 daemon ↔ server 的所有 REST 调用（register / heartbeat / claim / start / lease_heartbeat / submit_messages / complete / get_pending_leases），用 Node 20 原生 `fetch`，**零 HTTP 库依赖**（design.md G-05）。
> 承接风险：**R-02（契约漂移）P0 的 REST 侧验证** —— 端点路径 / method / request body 必须与 backend `router.py` + Python `client.py` 逐字对齐，由契约单测断言（AC-01）。

- Wave：W3（通信层，与 task-18 WsClient 并行，二者均依赖 W2 基础设施 + task-03 常量）
- 依赖：task-03（`src/protocol.ts` 已导出 `REST_PREFIX = '/api/daemon'`、`MSG.*` / `LEASE_STATE.*`）
- 阻塞：
  - task-19（TaskRunner 编排：`claim → start → submit_messages → complete` 链路调用本类）
  - task-20（Daemon 主类：启动 `register` + 定时 `heartbeat` + 断线 `getPendingLeases` 兜底）
  - task-22（测试迁移：`tests/test_client.py` → `tests/hub-client.test.ts` 1:1 迁移）

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 新增 | `sillyhub-daemon/src/hub-client.ts` | 导出 `HubClient` class（8 方法）+ `HubHttpError` 错误类 + 相关 body 类型；仅用 Node 20 原生 `fetch` + `AbortController`，零运行时依赖 |

不新增/不修改其他文件。测试文件（`tests/hub-client.test.ts`）由 task-22 落地，本蓝图第 9 节给出范例代码供其复用。模块文档 `.sillyspec/docs/sillyhub-daemon/modules/client.md` 在 W5 归档时同步更新（归档 skill 负责，本 task 不动）。

## 实现要求

### R1. 构造器（对齐 client.py:31-39）

| 项 | Python | Node |
|---|---|---|
| 构造签名 | `__init__(self, server_url: str, token: str \| None = None)` | `constructor(serverUrl: string, token?: string)` |
| base_url 处理 | `self._base_url = server_url.rstrip("/")` | `this.baseUrl = serverUrl.replace(/\/+$/, '')`（去尾部斜杠） |
| 认证头 | `self._token` 存原始 token，`_auth_headers()` 按需拼 `Authorization: Bearer {token}` | `this.token = token`；`_headers()` 在每请求时拼（无 token 则不带 Authorization 头，与 Python `_auth_headers` 返回 `{}` 一致） |
| timeout | `httpx.AsyncClient(timeout=30.0)` | 每请求 `AbortSignal.timeout(30_000)`（Node 20 内置），**全局不缓存 client 实例**（fetch 无连接池概念，与 httpx.AsyncClient 不同；用 Per-request 模式） |
| trust_env=False | httpx 显式禁用系统代理 | **Node 原生 fetch 默认不读取 `HTTP_PROXY` / `HTTPS_PROXY` 环境变量**（与浏览器 fetch 一致），天然等价 `trust_env=False`；本实现不做任何代理处理（见边界处理 #7） |
| close() | `await self._http.aclose()` | `close()` 是 no-op（fetch 无连接池），保留方法签名仅作 API 兼容，被 TaskRunner/Daemon 调用时无副作用 |

### R2. 六个 lease 生命周期端点（FR-04 核心，对齐 client.py:112-182）

每个方法满足三条铁律：
1. **URL**：`{REST_PREFIX}/leases/{leaseId}/{action}`，用 task-03 的 `REST_PREFIX` 常量拼接（不得硬编码 `/api/daemon`）。
2. **method**：全部 `POST`（Python 全用 `self._http.post`）。
3. **body**：与 Python `json={...}` 字段逐字一致，TS 端 `JSON.stringify`。

| TS 方法（camelCase） | Python 方法 | URL 子路径（拼在 REST_PREFIX 后） | request body 字段 |
|---|---|---|---|
| `claimLease(leaseId, runtimeId)` | `claim_lease` | `/leases/{leaseId}/claim` | `{ runtime_id: runtimeId }` |
| `startLease(leaseId, claimToken)` | `start_lease` | `/leases/{leaseId}/start` | `{ claim_token: claimToken }` |
| `leaseHeartbeat(leaseId, claimToken)` | `lease_heartbeat` | `/leases/{leaseId}/heartbeat` | `{ claim_token: claimToken }` |
| `submitMessages(leaseId, claimToken, agentRunId, messages)` | `submit_messages` | `/leases/{leaseId}/messages` | `{ claim_token, agent_run_id, messages }` |
| `completeLease(leaseId, claimToken, result)` | `complete_lease` | `/leases/{leaseId}/complete` | `{ claim_token, result }` |
| `heartbeat(runtimeId)` | `heartbeat` | `/heartbeat`（runtime 心跳，**非 lease 子路径**） | `{ runtime_id: runtimeId }` |

> 注意 body 字段名一律 **snake_case**（`runtime_id` / `claim_token` / `agent_run_id`），与 backend Pydantic 模型对齐（R-02 契约约束）；TS 方法名用 camelCase 是语言习惯，**body 字段名不可 camelCase 化**（否则 backend 反序列化失败）。

### R3. register（对齐 client.py:55-99，复杂 body 拼装）

Python `register` 的 body 拼装逻辑（条件字段）必须 1:1 还原：
- 必填：`name` / `provider` / `version` / `os` / `arch`（Python 总是写入，即使空串）。
- 条件写入：`runtime_id`（仅当 `!== undefined`）、`protocol`（仅当非空串）、`capabilities`（仅当非 null/undefined）。
- Python 还接收 `**kwargs` 透传到 body（client.py:89 `**kwargs`），TS 端用可选 `extra?: Record<string, unknown>` 参数展开进 body（`...extra`），保持扩展性。
- 返回 `resp.json()`（backend 返回 `{ runtime_id }` 等，类型 `Record<string, unknown>`）。

### R4. getPendingLeases（对齐 client.py:186-192，轮询兜底）

- method：`GET`（Python 用 `self._http.get`，**唯一非 POST 的端点**）。
- URL：`{REST_PREFIX}/runtimes/{runtimeId}/pending-leases`。
- 无 body（GET）。
- 返回 `list[dict]` → TS 端 `Promise<Record<string, unknown>[]>`（Python 返回 lease 列表）。

### R5. fetch 调用约定（每个方法共用）

封装私有 `_request<T>(method, path, body?)`：
1. URL = `this.baseUrl + path`（path 已含 REST_PREFIX，避免双斜杠：baseUrl 已去尾斜杠，path 以 `/` 开头）。
2. headers：`{ 'Content-Type': 'application/json' }` + （token 存在时）`{ 'Authorization': 'Bearer {token}' }`。GET 请求也带 Content-Type（与 Python httpx 默认 header 一致，无害）。
3. body：GET 时 `undefined`；POST 时 `JSON.stringify(body)`。
4. signal：`AbortSignal.timeout(30_000)`（Node 20+ 内置；若运行时 < Node 20，task-01 engines 字段已强制 Node ≥ 20）。
5. 调用 `const resp = await fetch(url, { method, headers, body, signal });`
6. **非 2xx**（`!resp.ok`，即 status 不在 [200,300)）：读取 `await resp.text()` 作 body，抛 `HubHttpError`（见下节错误类型）。
7. 成功：`return await resp.json() as T;`（Python `resp.json()` 等价）。

### R6. 错误处理（对齐 client.py 的 `raise_for_status`）

Python `resp.raise_for_status()` 在非 2xx 抛 `httpx.HTTPStatusError`，含 `response.status_code` / `response.text`。Node 端定义结构化错误类：

```ts
export class HubHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly bodyText: string,
    public readonly url: string,
    public readonly method: string,
  ) {
    super(`HTTP ${status} ${method} ${url}: ${bodyText.slice(0, 200)}`);
    this.name = 'HubHttpError';
  }
}
```

- 非 2xx 一律抛 `HubHttpError`，调用方（TaskRunner / Daemon）按 `err.status` 分支处理（401 重认证、409 lease 已被认领等，见边界处理）。
- 网络错误（DNS 失败 / 连接拒绝 / 超时）：fetch 直接 reject 原始 `TypeError`（超时是 `DOMException: signal timed out`），**不包装**，让调用方感知底层错误类型（Python httpx 抛 `httpx.ConnectError` / `httpx.TimeoutException`，Node 端用原生 Error 区分）。可在 `_request` 内 catch 后重抛 `HubHttpError`（status = -1）以统一接口，**本蓝图选择不包装**（理由：调用方需区分超时 vs 业务错误，包装后丢失信息；与 Python `raise_for_status` 只处理 HTTP 状态码、网络错误透传的语义一致）。

## 接口定义

`hub-client.ts` 完整骨架（搬砖工补全方法体，签名与 body 结构不得改动）：

```ts
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
 * Python 源对照：sillyhub_daemon/client.py（HubClient class）。
 *
 * @module hub-client
 */

import { REST_PREFIX } from './protocol.js';

// ── body 类型（字段名 snake_case 对齐 backend Pydantic 模型）──────────────────

export interface RegisterBody {
  name: string;
  provider: string;
  version: string;
  os: string;
  arch: string;
  runtime_id?: string;                      // 仅当调用方提供时写入
  protocol?: string;                         // 仅当非空串时写入
  capabilities?: Record<string, unknown>;    // 仅当非 undefined 时写入
  [extra: string]: unknown;                  // 对应 Python **kwargs 透传
}

export interface ClaimLeaseBody {
  runtime_id: string;
}

export interface StartLeaseBody {
  claim_token: string;
}

export interface LeaseHeartbeatBody {
  claim_token: string;
}

export interface SubmitMessagesBody {
  claim_token: string;
  agent_run_id: string;
  messages: Record<string, unknown>[];
}

export interface CompleteLeaseBody {
  claim_token: string;
  result: Record<string, unknown>;
}

export interface HeartbeatBody {
  runtime_id: string;
}

// ── 错误类型 ──────────────────────────────────────────────────────────────────

/**
 * HTTP 非 2xx 响应抛出。对齐 Python httpx.HTTPStatusError 的信息完备性
 *（status_code + response.text + 请求 URL/method）。
 */
export class HubHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly bodyText: string,
    public readonly url: string,
    public readonly method: string,
  ) {
    super(`HTTP ${status} ${method} ${url}: ${bodyText.slice(0, 200)}`);
    this.name = 'HubHttpError';
  }
}

// ── HubClient ─────────────────────────────────────────────────────────────────

/** 默认请求超时 30 秒，对齐 Python httpx.AsyncClient(timeout=30.0)。 */
const DEFAULT_TIMEOUT_MS = 30_000;

export class HubClient {
  private readonly baseUrl: string;
  private readonly token?: string;

  /**
   * @param serverUrl  SillyHub server origin，如 'http://localhost:8000'。尾部斜杠会被去除。
   * @param token      可选 Bearer token；为 undefined 时不发送 Authorization 头（对齐 Python `_auth_headers` 返回 `{}`）。
   */
  constructor(serverUrl: string, token?: string) {
    this.baseUrl = serverUrl.replace(/\/+$/, '');
    this.token = token;
  }

  /** 关闭客户端。fetch 无连接池，此方法为 no-op，仅为 API 兼容保留（对齐 Python `close()`）。 */
  close(): void {
    /* no-op: fetch has no connection pool to close */
  }

  // -- 内部：统一请求入口（对齐 Python 的 self._http.post + raise_for_status）--

  private _headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) {
      h['Authorization'] = `Bearer ${this.token}`;
    }
    return h;
  }

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
   * body 条件字段拼装严格对齐 client.py:83-96（runtime_id 仅当提供、protocol 仅当非空、capabilities 仅当非 undefined）。
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
    if (params.protocol) {            // 非空串才写入（Python `if protocol:`）
      body.protocol = params.protocol;
    }
    if (params.capabilities) {        // 非 undefined 才写入（Python `if capabilities:`）
      body.capabilities = params.capabilities;
    }
    return this._request<Record<string, unknown>>(
      'POST',
      `${REST_PREFIX}/register`,
      body,
    );
  }

  /** runtime HTTP 心跳（非 lease 心跳）。 */
  async heartbeat(runtimeId: string): Promise<Record<string, unknown>> {
    return this._request<Record<string, unknown>>(
      'POST',
      `${REST_PREFIX}/heartbeat`,
      { runtime_id: runtimeId } satisfies HeartbeatBody,
    );
  }

  // -- Lease 生命周期（FR-04 核心）--

  /** 认领 lease，返回含 claim_token 的响应（后续操作需此 token）。 */
  async claimLease(leaseId: string, runtimeId: string): Promise<Record<string, unknown>> {
    return this._request<Record<string, unknown>>(
      'POST',
      `${REST_PREFIX}/leases/${encodeURIComponent(leaseId)}/claim`,
      { runtime_id: runtimeId } satisfies ClaimLeaseBody,
    );
  }

  /** 标记 lease 已开始执行。 */
  async startLease(leaseId: string, claimToken: string): Promise<Record<string, unknown>> {
    return this._request<Record<string, unknown>>(
      'POST',
      `${REST_PREFIX}/leases/${encodeURIComponent(leaseId)}/start`,
      { claim_token: claimToken } satisfies StartLeaseBody,
    );
  }

  /** lease 执行期间的心跳续期。 */
  async leaseHeartbeat(leaseId: string, claimToken: string): Promise<Record<string, unknown>> {
    return this._request<Record<string, unknown>>(
      'POST',
      `${REST_PREFIX}/leases/${encodeURIComponent(leaseId)}/heartbeat`,
      { claim_token: claimToken } satisfies LeaseHeartbeatBody,
    );
  }

  /** 增量上报 agent 执行消息（流式）。 */
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

  /** 完成 lease，提交 result（含 patch / stats / status）。 */
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

  /** 获取 runtime 的待处理 lease 列表（GET，唯一非 POST 端点）。 */
  async getPendingLeases(runtimeId: string): Promise<Record<string, unknown>[]> {
    return this._request<Record<string, unknown>[]>(
      'GET',
      `${REST_PREFIX}/runtimes/${encodeURIComponent(runtimeId)}/pending-leases`,
    );
  }
}
```


## 边界处理

1. **非 2xx HTTP 响应**：`resp.ok === false`（status 不在 [200,300)）时，先 `await resp.text()` 读完整 body 文本，再抛 `HubHttpError(status, bodyText, url, method)`。读 body 是必要的——backend 错误响应体含 `{ detail: '...' }`（FastAPI 默认），调用方可通过 `err.bodyText` 解析具体原因（如 `claim_token invalid` / `lease already completed`）。**不得在抛错前忽略 body**（Python `raise_for_status` 也保留 response 引用供读取）。body 文本可能很大，`HubHttpError.message` 里 `slice(0, 200)` 截断仅用于日志可读性，原始 `bodyText` 字段保留全量。

2. **lease 已被他人 claim（409 Conflict）**：`claimLease` 调用返回 409 时，`HubHttpError.status === 409`。调用方（TaskRunner）应捕获并视为「该 lease 已被其他 runtime 抢占，跳过本 lease」（与 Python 端行为一致：`raise_for_status` 抛错后上层 `except HTTPStatusError` 判 409 跳过）。本类**不内置重试**（见非目标 N-2），由调用方决策。

3. **token 无效 / 过期（401 Unauthorized）**：`HubHttpError.status === 401`。调用方（Daemon）应触发重新加载 config（task-08）或退出。本类**不做自动刷新 token**（Python 版也无此逻辑，token 是 daemon 启动时一次性注入）。若 token 为 undefined（未配置），构造时 `Authorization` 头不发，backend 会直接返回 401，行为与 Python `_auth_headers` 返回 `{}` 一致。

4. **网络错误（DNS / 连接拒绝）**：fetch 抛 `TypeError: fetch failed`（含 `cause`）。本类**不包装**（见 R6 理由），透传给调用方。TaskRunner 应 catch 后标记 lease 失败（`completeLease` with `result.status = 'failed'`）；Daemon 应进入 5s 重连循环（FR-03）。

5. **请求超时（30s）**：`AbortSignal.timeout(30_000)` 触发后 fetch reject `DOMException`（`name: 'TimeoutError'`）。超时典型发生在 `submitMessages` 上传大 messages 数组或 `register` 时 backend 慢。调用方应区分：超时（`err.name === 'TimeoutError'`）vs HTTP 业务错误（`err instanceof HubHttpError`）。**不得调大超时**（与 Python `timeout=30.0` 一致，design.md N-06 不做性能优化）。

6. **响应 JSON 损坏**：`await resp.json()` 若 body 不是合法 JSON（如 backend 返回空 body 或 HTML 错误页），抛 `SyntaxError: Unexpected token`。本类**不 catch**（透传），但调用方需感知此可能（极端情况：backend 反代层 502 返回 HTML）。可在 `_request` 末尾加 `try { return await resp.json() } catch { return {} as T }` 兜底——**本蓝图选择不兜底**（理由：损坏 JSON 是 backend 异常信号，吞掉会掩盖问题；让调用方拿到 SyntaxError 更利于排障）。

7. **fetch 默认代理行为（trust_env 语义）**：Python httpx 的 `trust_env=False` 显式禁用读取 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` 环境变量，确保 daemon 直连本地 server。**Node 20 原生 fetch（undici 实现）默认不读取这些环境变量**（与浏览器 fetch 语义一致；undici 需显式设置 `dispatcher` 或用 `ProxyAgent` 才走代理）。因此本实现**无需任何额外代码**即可等价 `trust_env=False`。边界：若未来部署环境通过 `globalThis.fetch = undiciFetch` 注入了带代理的 fetch，需额外文档说明；本 task 不处理（YAGNI，当前无此部署场景）。

8. **leaseId / runtimeId 含特殊字符**：URL 路径段用 `encodeURIComponent` 编码（防止 `/` / `?` / `#` 破坏路径）。正常 leaseId 是 UUID（无特殊字符），但编码是防御性最佳实践（Python httpx 自动编码 URL，Node fetch 不自动编码路径段）。

9. **baseUrl 尾部斜杠**：构造器 `replace(/\/+$/, '')` 去除尾部一个或多个斜杠，确保 `${baseUrl}${REST_PREFIX}`（`REST_PREFIX` 以 `/` 开头）不会产生双斜杠（`http://x:8000//api/daemon`）。Python httpx 的 `base_url` 内置此处理，Node 需手动。

## 非目标

- **N-1（不做 WebSocket）**：WS 通信（task_available / lease_claim / lease_complete 等消息推送）归 task-18 WsClient（用 `ws` 库）。本类只管 REST，WS 与 REST 是两条独立通道（Python 版亦是：`client.py` 管 REST、`daemon.py` 管 WS）。
- **N-2（不做重试 / 指数退避）**：每个方法失败即抛错，**不自动重试**（对齐 Python `raise_for_status` 直接抛）。重试逻辑（如 `claimLease` 失败重试）归调用方 TaskRunner / Daemon 决策，避免在客户端层隐藏网络抖动。
- **N-3（不引入 HTTP 库）**：禁止 `axios` / `got` / `node-fetch` / `undici` 显式 import（design.md G-05）。只用 Node 20 全局 `fetch`。`AbortSignal.timeout` 是 Node 20 内置，无需 import。
- **N-4（不缓存 lease / 不维护状态）**：本类是无状态瘦客户端，每次请求独立（fetch 无连接池）。不缓存 `claim_token`（由调用方 TaskRunner 持有 lease 状态机）。`close()` 是 no-op。
- **N-5（不做请求/响应拦截器）**：不实现 axios 风格的 interceptor 链。日志（如请求耗时）归调用方或 future task（task-20 Daemon 可包装本类加日志）。
- **N-6（不做 mock server 集成测试）**：本类单测用 fetch mock（vi.stubGlobal 或手写 stub），不启动真实 backend（真实 backend 冒烟归 W5 task-21）。
- **N-7（不改 backend 端点）**：backend `router.py` 的 REST 端点路径 / method / payload 完全不动（design.md N-01）。本类严格适配现有契约。

## 参考

- **Python 源（权威基准）**：`sillyhub-daemon/sillyhub_daemon/client.py`（HubClient class，193 行，8 方法）—— 本蓝图撰写前已 Read 全文
- **协议常量**：`sillyhub-daemon/src/protocol.ts`（task-03 产出，导出 `REST_PREFIX = '/api/daemon'`）
- **backend 对端 REST 路由**：`backend/app/modules/daemon/router.py`（`APIRouter(prefix="/daemon")` + `main.py:237` `include_router(prefix="/api")` = `/api/daemon`；各端点装饰器 `@router.post('/register')` / `@router.post('/leases/{lease_id}/claim')` 等）
- **模块文档**：`.sillyspec/docs/sillyhub-daemon/modules/client.md`（契约摘要：8 方法签名 + 注意事项 trust_env=False）
- **变更设计**：`.sillyspec/changes/2026-06-13-daemon-nodejs-rewrite/design.md` §5.1（通信层：HubClient(REST,fetch)）、§7（接口定义参考）、G-02（契约不变）、G-05（零/少依赖）、R-02（WS/REST 契约漂移 P0）、N-01（不改 backend）
- **变更需求**：`.sillyspec/changes/2026-06-13-daemon-nodejs-rewrite/requirements.md` FR-04（lease 生命周期）、FR-03（通信契约对齐）

## TDD 步骤

> 测试文件路径：`sillyhub-daemon/tests/hub-client.test.ts`（归 task-22 落地）。本蓝图给出完整可运行测试代码（fetch mock 用 `vi.stubGlobal`）。

**目标**：对每个方法断言三件事——(1) 请求 URL 正确（含 REST_PREFIX + leaseId 路径段）；(2) 请求 method + body 字段（snake_case）正确；(3) 响应 JSON 正确解析返回；外加错误分支（非 2xx 抛 HubHttpError、404/409/401 分支）。

**RED 阶段 — 先写契约单测（fetch 全局 mock）**：

```ts
// tests/hub-client.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HubClient, HubHttpError } from '../src/hub-client';
import { REST_PREFIX } from '../src/protocol';

// fetch mock 工具：记录最后一次调用的 (url, init)，并返回可控 Response
let lastCall: { url: string; init: RequestInit } | null = null;
function mockFetchOk(body: unknown, status = 200): typeof fetch {
  return (async (url: any, init?: any) => {
    lastCall = { url: typeof url === 'string' ? url : url.toString(), init: init ?? {} };
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}
function mockFetchStatus(status: number, bodyText: string): typeof fetch {
  return (async (url: any, init?: any) => {
    lastCall = { url: typeof url === 'string' ? url : url.toString(), init: init ?? {} };
    return new Response(bodyText, { status });
  }) as typeof fetch;
}

beforeEach(() => {
  lastCall = null;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HubClient 构造器', () => {
  it('去除尾部斜杠', async () => {
    vi.stubGlobal('fetch', mockFetchOk({ ok: true }));
    const c = new HubClient('http://x:8000///', 'tok');
    await c.heartbeat('rt-1');
    expect(lastCall!.url.startsWith('http://x:8000/api/daemon')).toBe(true);
    expect(lastCall!.url.includes('//api')).toBe(false);
  });

  it('无 token 时不发 Authorization 头', async () => {
    vi.stubGlobal('fetch', mockFetchOk({}));
    const c = new HubClient('http://x:8000');
    await c.heartbeat('rt-1');
    const headers = lastCall!.init.headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('有 token 时发 Bearer 头', async () => {
    vi.stubGlobal('fetch', mockFetchOk({}));
    const c = new HubClient('http://x:8000', 'mytoken');
    await c.heartbeat('rt-1');
    const headers = lastCall!.init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer mytoken');
  });
});

describe('HubClient — 6 个 lease 端点 URL/method/body 契约（AC-01 核心）', () => {
  beforeEach(() => vi.stubGlobal('fetch', mockFetchOk({ ok: true })));

  it('claimLease: POST /leases/{id}/claim body {runtime_id}', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.claimLease('lease-123', 'rt-1');
    expect(lastCall!.url).toBe(`http://x:8000${REST_PREFIX}/leases/lease-123/claim`);
    expect(lastCall!.init.method).toBe('POST');
    expect(JSON.parse(lastCall!.init.body as string)).toEqual({ runtime_id: 'rt-1' });
  });

  it('startLease: POST /leases/{id}/start body {claim_token}', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.startLease('lease-1', 'ctoken');
    expect(lastCall!.url).toBe(`http://x:8000${REST_PREFIX}/leases/lease-1/start`);
    expect(JSON.parse(lastCall!.init.body as string)).toEqual({ claim_token: 'ctoken' });
  });

  it('leaseHeartbeat: POST /leases/{id}/heartbeat body {claim_token}', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.leaseHeartbeat('lease-1', 'ctoken');
    expect(lastCall!.url).toBe(`http://x:8000${REST_PREFIX}/leases/lease-1/heartbeat`);
    expect(JSON.parse(lastCall!.init.body as string)).toEqual({ claim_token: 'ctoken' });
  });

  it('submitMessages: POST /leases/{id}/messages body {claim_token, agent_run_id, messages}', async () => {
    const c = new HubClient('http://x:8000', 't');
    const msgs = [{ type: 'text', content: 'hi' }];
    await c.submitMessages('lease-1', 'ctoken', 'run-9', msgs);
    expect(lastCall!.url).toBe(`http://x:8000${REST_PREFIX}/leases/lease-1/messages`);
    expect(JSON.parse(lastCall!.init.body as string)).toEqual({
      claim_token: 'ctoken',
      agent_run_id: 'run-9',
      messages: msgs,
    });
  });

  it('completeLease: POST /leases/{id}/complete body {claim_token, result}', async () => {
    const c = new HubClient('http://x:8000', 't');
    const result = { status: 'completed', patch: 'diff --git ...' };
    await c.completeLease('lease-1', 'ctoken', result);
    expect(lastCall!.url).toBe(`http://x:8000${REST_PREFIX}/leases/lease-1/complete`);
    expect(JSON.parse(lastCall!.init.body as string)).toEqual({
      claim_token: 'ctoken',
      result,
    });
  });

  it('heartbeat(runtime): POST /heartbeat body {runtime_id}（非 lease 子路径）', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.heartbeat('rt-1');
    expect(lastCall!.url).toBe(`http://x:8000${REST_PREFIX}/heartbeat`);
    expect(JSON.parse(lastCall!.init.body as string)).toEqual({ runtime_id: 'rt-1' });
  });
});

describe('HubClient — register 条件 body 拼装（对齐 client.py:83-96）', () => {
  beforeEach(() => vi.stubGlobal('fetch', mockFetchOk({ runtime_id: 'rt-new' })));

  it('必填字段总写入（即使空串）+ 条件字段省略', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.register({ name: 'host1', provider: 'claude', version: '2.1.0', os: 'darwin', arch: 'arm64' });
    const body = JSON.parse(lastCall!.init.body as string);
    expect(body).toEqual({
      name: 'host1', provider: 'claude', version: '2.1.0', os: 'darwin', arch: 'arm64',
    });
    expect(body.runtime_id).toBeUndefined();
    expect(body.protocol).toBeUndefined();
    expect(body.capabilities).toBeUndefined();
  });

  it('runtimeId 提供时写入；protocol 非空写入；capabilities 提供写入', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.register({
      name: 'h', provider: 'p', version: 'v', os: 'o', arch: 'a',
      runtimeId: 'rt-1', protocol: 'stream_json', capabilities: { tools: true },
    });
    const body = JSON.parse(lastCall!.init.body as string);
    expect(body.runtime_id).toBe('rt-1');
    expect(body.protocol).toBe('stream_json');
    expect(body.capabilities).toEqual({ tools: true });
  });

  it('protocol 空串不写入（对齐 Python `if protocol:`）', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.register({ name: 'h', protocol: '' });
    const body = JSON.parse(lastCall!.init.body as string);
    expect(body.protocol).toBeUndefined();
  });
});

describe('HubClient — getPendingLeases（GET，唯一非 POST）', () => {
  it('GET /runtimes/{id}/pending-leases 返回数组', async () => {
    vi.stubGlobal('fetch', mockFetchOk([{ lease_id: 'l1' }, { lease_id: 'l2' }]));
    const c = new HubClient('http://x:8000', 't');
    const list = await c.getPendingLeases('rt-1');
    expect(lastCall!.url).toBe(`http://x:8000${REST_PREFIX}/runtimes/rt-1/pending-leases`);
    expect(lastCall!.init.method).toBe('GET');
    expect(lastCall!.init.body).toBeUndefined();
    expect(list).toEqual([{ lease_id: 'l1' }, { lease_id: 'l2' }]);
  });
});

describe('HubClient — 错误处理（AC-03）', () => {
  it('非 2xx 抛 HubHttpError 含 status/bodyText/url/method', async () => {
    vi.stubGlobal('fetch', mockFetchStatus(409, '{"detail":"lease already claimed"}'));
    const c = new HubClient('http://x:8000', 't');
    await expect(c.claimLease('l1', 'rt-1')).rejects.toMatchObject({
      name: 'HubHttpError',
      status: 409,
      bodyText: '{"detail":"lease already claimed"}',
      method: 'POST',
    });
  });

  it('401 token 无效可被 status 区分', async () => {
    vi.stubGlobal('fetch', mockFetchStatus(401, '{"detail":"unauthorized"}'));
    const c = new HubClient('http://x:8000', 'bad');
    await expect(c.heartbeat('rt-1')).rejects.toMatchObject({ status: 401 });
  });

  it('500 服务器错误', async () => {
    vi.stubGlobal('fetch', mockFetchStatus(500, 'internal error'));
    const c = new HubClient('http://x:8000', 't');
    await expect(c.completeLease('l1', 'ct', {})).rejects.toMatchObject({ status: 500 });
  });

  it('网络错误透传（fetch reject TypeError，不包装）', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('fetch failed'); });
    const c = new HubClient('http://x:8000', 't');
    await expect(c.heartbeat('rt-1')).rejects.toThrow(TypeError);
  });
});

describe('HubClient — trust_env=false 语义（AC-04）', () => {
  it('fetch 调用 init 不含 dispatcher/proxy 字段（依赖 Node 默认不走 HTTP_PROXY）', async () => {
    vi.stubGlobal('fetch', mockFetchOk({}));
    const c = new HubClient('http://x:8000', 't');
    await c.heartbeat('rt-1');
    expect(lastCall!.init.dispatcher).toBeUndefined();
    expect((lastCall!.init as any).agent).toBeUndefined();
  });
});
```

**GREEN 阶段 — 实现最小可过**：将第 5 节「接口定义」中的 `hub-client.ts` 代码原样写入 `sillyhub-daemon/src/hub-client.ts`，运行 `pnpm test tests/hub-client.test.ts` 全绿。

**REFACTOR 阶段**：
- 检查 `_request<T>` 是否复用于全部 8 方法（避免每个方法重复 fetch + raise_for_status 样板）。
- 确认 body 字段全部 snake_case（`runtime_id` / `claim_token` / `agent_run_id`），无 camelCase 泄漏。
- 确认 `REST_PREFIX` 来自 `import` 而非硬编码（`grep -n "'/api/daemon'" src/hub-client.ts` 应无匹配，注释除外）。

## 验收标准

| ID | 验收项 | 验证方法 | 通过标准 |
|----|--------|----------|----------|
| AC-01 | 6 lease 端点 + register + heartbeat + getPendingLeases 的 URL/method/body 与 Python client.py 1:1 | 运行 `tests/hub-client.test.ts`，对照 Python `client.py:55-192` 逐方法核对 lastCall.url / lastCall.init.method / JSON.parse(lastCall.init.body) | 9 个方法全覆盖：claim=POST `/leases/{id}/claim` body `{runtime_id}`、start=POST `/leases/{id}/start` body `{claim_token}`、leaseHeartbeat=POST `/leases/{id}/heartbeat` body `{claim_token}`、submitMessages=POST `/leases/{id}/messages` body `{claim_token, agent_run_id, messages}`、complete=POST `/leases/{id}/complete` body `{claim_token, result}`、heartbeat=POST `/heartbeat` body `{runtime_id}`、register=POST `/register` body 含条件字段、getPendingLeases=GET `/runtimes/{id}/pending-leases` 无 body。所有 body 字段名 snake_case |
| AC-02 | Authorization Bearer token 头正确 | 构造 `new HubClient(url, 'tok')` 调任意方法，断言 `lastCall.init.headers['Authorization'] === 'Bearer tok'`；构造 `new HubClient(url)` 无 token，断言 headers 无 Authorization 键 | 两分支均通过（对齐 Python `_auth_headers` token 存在/不存在两种返回） |
| AC-03 | 非 2xx 抛结构化 HubHttpError | mock fetch 返回 409 / 401 / 500 / 502，断言 reject 的 error `instanceof HubHttpError` 且 `status` / `bodyText` / `url` / `method` 字段完整可读；网络错误（fetch reject TypeError）透传不包装 | 4 个 status 分支 + 1 个网络错误分支全通过 |
| AC-04 | trust_env=false 语义等价 | 断言 fetch 调用的 init 不含 `dispatcher` / `agent` / proxy 相关字段；在注释中明确说明「Node 原生 fetch 默认不读 HTTP_PROXY 环境变量，等价 Python httpx trust_env=False」 | 代码无 proxy 设置 + 注释说明存在 + 测试断言 init.dispatcher === undefined |
| AC-05 | 用原生 fetch，零 HTTP 库依赖 | `grep -rE "from\s+['\"](axios|got|node-fetch|undici|superagent|request)['\"]" src/hub-client.ts`；检查 package.json dependencies 不含上述库（task-01 已限定） | 零匹配；`hub-client.ts` 仅 `import { REST_PREFIX } from './protocol.js'` 一个 import |
| AC-06 | vitest 单测全绿 | 在 `sillyhub-daemon/` 执行 `pnpm test tests/hub-client.test.ts`（或 `pnpm test` 全量） | 全部 describe block 通过：构造器 3 + lease 端点 6 + register 3 + getPendingLeases 1 + 错误 4 + trust_env 1 = 18 个 it 断言全绿 |
| AC-07 | TypeScript strict 编译零错误 | 在 `sillyhub-daemon/` 执行 `pnpm tsc --noEmit`（task-01 tsconfig.json strict 模式） | 退出码 0，无 error / 无 warning；`satisfies` 类型断言（`satisfies ClaimLeaseBody` 等）编译期校验 body 结构正确 |
