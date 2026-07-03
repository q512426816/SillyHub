/**
 * WebSocket 客户端：daemon → server 实时通道。
 *
 * 1:1 复刻 Python sillyhub_daemon/daemon.py 的 _ws_loop（L219-251）+
 * _handle_ws_message（L253-267）+ _build_ws_url（L148-160）。
 *
 * 职责（单一）：
 *   - 建立 WS 连接（query runtime_id 标识身份，不主动发 register）
 *   - 收发 DaemonMessage（type 来自 task-03 MSG 常量）
 *   - 断线后 5s 固定退避重连（design §9 + FR-03）
 *   - 对外暴露连接状态 + onDisconnected 回调，供 task-20 Daemon 决定是否启动 HTTP 轮询兜底
 *   - task-05（D-005@v1）：承担 `daemon:rpc` 分发——收到 RPC 请求后调注册的 handler，
 *     异步执行后回发 `daemon:rpc_result`。分发层只做 handler 查找/执行/回发，
 *     业务实现（fs 操作）由 file-rpc.ts 提供，保持本模块单一职责。
 *
 * 不做（design 职责分离）：
 *   - 不发 HTTP 请求（轮询归 task-17 HubClient）
 *   - 不内嵌 lease 状态机（归 task-20 Daemon）
 *   - 不解析 task_available payload 的业务含义（仅透传给 onMessage）
 *   - 不内嵌 RPC 业务逻辑（list_dir 等由 file-rpc.ts 实现，本模块仅分发）
 *
 * @module ws-client
 */

import WebSocket from 'ws';
import { MSG, WS_PATH } from './protocol.js';
import type { DaemonMessage } from './types.js';

// ── 常量 ──────────────────────────────────────────────────────────────────────

/** 断线重连退避间隔（毫秒）。design §9 + FR-03：5s，与 Python 版策略一致。 */
export const RECONNECT_INTERVAL_MS = 5_000;

/**
 * 重连退避上限（毫秒）。本 v1 采用固定退避（5s）而非指数退避，
 * 与 Python 单层 asyncio.sleep 语义一致；此常量预留供未来切换指数退避时使用，
 * 当前固定退避场景下等于 RECONNECT_INTERVAL_MS，避免无限增长（边界 §4）。
 */
export const RECONNECT_MAX_INTERVAL_MS = 5_000;

/** 单次 connect 的握手超时（毫秒）。Python open_timeout=10 → 10s。 */
export const CONNECT_TIMEOUT_MS = 10_000;

/** 单次 close 的优雅关闭超时（毫秒）。Python close_timeout=5 → 5s。 */
export const CLOSE_TIMEOUT_MS = 5_000;

// ── 回调接口 ──────────────────────────────────────────────────────────────────

/** WsClient 事件回调。全部可选，缺省为 no-op。 */
export interface WsClientCallbacks {
  /**
   * 收到一条合法 DaemonMessage（已 JSON.parse 成功）。
   * 非法 JSON 在 WsClient 内部 warn 后丢弃，不会调本回调。
   * task-20 Daemon 在此分派 task_available → TaskRunner。
   */
  onMessage?: (msg: DaemonMessage) => void;
  /** WS 连接成功建立（每次重连成功都会触发）。 */
  onConnected?: () => void;
  /**
   * WS 连接断开（close 事件）。task-20 在此启动 HTTP 轮询兜底。
   * @param code    close code（1000 正常 / 1006 异常断开 / 4001 invalid runtime_id 等）
   * @param reason  close reason 字符串
   */
  onDisconnected?: (code: number, reason: string) => void;
  /** WS error 事件（连接失败、握手失败、运行时错误）。仅日志用，不阻塞重连。 */
  onError?: (err: Error) => void;
  /**
   * task-13（2026-07-02-daemon-filesystem-policy / D-004）：收到 POLICY_UPDATE 推送。
   *
   * backend 在 admin 改动 allowed_roots 后实时下发，daemon 据此 sub-second 热更新
   * PolicyCache（无需等下一拍心跳）。version 单调递增，由 daemon 层做去重
   *（PolicyCache.set 内部自管 version，与本回调解耦；旧 version 在 daemon 回调里忽略，R-07）。
   *
   * @param runtimeId     目标 runtime_id
   * @param allowedRoots  新的 allowed_roots（原始字符串数组，规范化由 PolicyCache 负责）
   * @param version       本次推送版本号（单调递增，daemon 据此丢弃乱序旧包）
   */
  onPolicyUpdate?: (
    runtimeId: string,
    allowedRoots: string[],
    version: number,
  ) => void;
}

/** WsClient 构造参数。 */
export interface WsClientOptions {
  /**
   * Server HTTP origin（如 "http://localhost:8000" / "https://hub.example.com"）。
   * 内部转 ws:// 或 wss://（与 Python _build_ws_url 1:1）。
   * 末尾斜杠会被 rstrip。
   */
  serverUrl: string;
  /** 本 daemon runtime 的 UUID（register 后由 task-17 返回）。 */
  runtimeId: string;
  /**
   * 可选 Bearer token，作为子协议头或 query 参数发送。
   * Python 版未传（_ws_loop 不带 Authorization）；本字段预留，默认 undefined → 不附加。
   */
  token?: string;
  /** 事件回调。 */
  callbacks?: WsClientCallbacks;
}

// ── RPC 分发类型（task-05 / D-005@v1）─────────────────────────────────────────

/**
 * RPC handler 签名。由业务层（如 file-rpc.ts 的 listDir）包装后注册到 WsClient。
 *
 * 约定：
 *   - 返回值（任意可 JSON 序列化结构）作为 `RPC_RESULT.result` 回发。
 *   - 抛 `RpcError` → 其 `code` 原样填入 `RPC_RESULT.error.code`。
 *   - 抛普通 `Error` → 统一映射为 `error.code='internal'`（见 `_dispatchRpc`）。
 *
 * 可同步或异步；`_dispatchRpc` 用 `await` 兼容两种。
 */
export type RpcHandler = (
  params: Record<string, unknown>,
) => Promise<unknown> | unknown;

/**
 * WS RPC 错误（带稳定 code，供前端/backend 识别）。
 *
 * 已知 code（与 design §7.1 协议约定一致）：
 *   - `forbidden`：path 越界 allowed_roots（D-002 / FR-04）
 *   - `not_found`：path 不存在或非目录
 *   - `method_not_found`：未注册的 RPC method
 *   - `internal`：权限不足 / 其他 fs 错误 / handler 未捕获异常
 *
 * 抛本类实例的 handler → `_dispatchRpc` 原样回填 code；抛普通 Error → code='internal'。
 */
export class RpcError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

// ── 连接状态机 ────────────────────────────────────────────────────────────────

/** WsClient 状态。状态转换见下方伪代码。 */
export enum WsState {
  /** 初始 / 已 close()，不会自动重连。 */
  Idle = 'idle',
  /** connect() 已调用，握手进行中。 */
  Connecting = 'connecting',
  /** 握手成功，open 事件已触发，可收发消息。 */
  Connected = 'connected',
  /** 断开中（等 close 完成或退避计时器 pending）。 */
  Reconnecting = 'reconnecting',
}

// ── WsClient 主类 ─────────────────────────────────────────────────────────────

export class WsClient {
  private readonly _opts: WsClientOptions;
  private readonly _callbacks: WsClientCallbacks;
  private _ws: WebSocket | null = null;
  private _state: WsState = WsState.Idle;
  /** 是否处于「运行中」语义（已 start 未 stop）。false 时禁止重连（daemon.py:250 if self._running）。 */
  private _running = false;
  /** 重连退避定时器句柄，close() / 新连接成功时清除。 */
  private _reconnectTimer: NodeJS.Timeout | null = null;
  /** connect 握手超时定时器。 */
  private _connectTimer: NodeJS.Timeout | null = null;

  /**
   * task-05：已注册的 RPC method → handler 映射。
   * daemon 在 `_wsLoop` 构造 WsClient 后调 `registerRpcHandler` 注入业务 handler
   *（如 list_dir → listDir）。生产路径每个 method 只注册一次。
   */
  private readonly _rpcHandlers = new Map<string, RpcHandler>();

  constructor(opts: WsClientOptions) {
    this._opts = opts;
    this._callbacks = opts.callbacks ?? {};
  }

  // ── 公共 API ───────────────────────────────────────────────────────────────

  /** 当前连接状态（只读）。 */
  get state(): WsState {
    return this._state;
  }

  /** WS 是否处于 Connected（open）状态。task-20 据此决定是否启动轮询兜底。 */
  get isConnected(): boolean {
    return this._state === WsState.Connected;
  }

  // ── 连接生命周期 ───────────────────────────────────────────────────────────

  /**
   * 建立 WS 连接（首次 + 每次重连均调本方法）。
   * 不抛——所有失败经 onError 回调 + 状态机驱动重连。
   */
  connect(): void {
    // 幂等保护：已 Connecting / Connected 时直接返回（避免重连风暴，边界 §6）。
    if (this._state === WsState.Connecting || this._state === WsState.Connected) {
      return;
    }
    this._running = true;
    this._state = WsState.Connecting;

    const url = this._buildWsUrl();
    let ws: WebSocket;
    try {
      ws = this._createSocket(url);
    } catch (err) {
      // 同步构造失败（如 URL 非法）——等同 error 事件，进入重连。
      this._handleError(err instanceof Error ? err : new Error(String(err)));
      this._scheduleReconnect();
      return;
    }
    this._ws = ws;

    // 握手超时（Python open_timeout=10）。
    this._connectTimer = setTimeout(() => {
      if (this._state === WsState.Connecting) {
        this._handleError(
          new Error(`ws connect timeout after ${CONNECT_TIMEOUT_MS}ms`),
        );
        try {
          ws.terminate();
        } catch {
          /* noop */
        }
      }
    }, CONNECT_TIMEOUT_MS);

    ws.on('open', () => this._handleOpen());
    ws.on('message', (data: WebSocket.RawData) => this._handleMessage(data));
    ws.on('close', (code: number, reason: Buffer) =>
      this._handleClose(code, reason.toString()),
    );
    ws.on('error', (err: Error) => this._handleError(err));
  }

  /**
   * 主动关闭连接，停止重连。幂等（多次调用不抛）。
   * 对应 Python stop() → asyncio 任务 cancel → websockets 连接关闭。
   */
  close(): void {
    this._running = false;
    this._clearReconnectTimer();
    this._clearConnectTimer();
    if (this._ws) {
      try {
        this._ws.close(1000, 'client_shutdown');
      } catch {
        /* noop */
      }
      // 5s 内未真正 close 则强制 terminate（Python close_timeout=5）。
      const ws = this._ws;
      const forceTimer = setTimeout(() => {
        if (
          ws.readyState === WebSocket.CLOSING ||
          ws.readyState === WebSocket.OPEN
        ) {
          try {
            ws.terminate();
          } catch {
            /* noop */
          }
        }
      }, CLOSE_TIMEOUT_MS);
      forceTimer.unref?.();
      this._ws = null;
    }
    this._state = WsState.Idle;
  }

  // ── 出站消息 ───────────────────────────────────────────────────────────────

  /**
   * 发送一条 DaemonMessage（已序列化为 JSON 字符串）。
   * 未连接时丢弃并 warn，不抛、不缓冲（Python 无缓冲语义）。
   */
  send(msg: DaemonMessage): boolean {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      this._ws.send(JSON.stringify(msg));
      return true;
    } catch (err) {
      this._handleError(err instanceof Error ? err : new Error(String(err)));
      return false;
    }
  }

  /** 便捷：回 heartbeat_ack（被动应答 Server 的 heartbeat 探活）。 */
  sendHeartbeatAck(payload: Record<string, unknown> = {}): boolean {
    return this.send({
      type: MSG.HEARTBEAT_ACK,
      payload: { runtime_id: this._opts.runtimeId, ...payload },
    });
  }

  // ── RPC handler 注册（task-05 / D-005@v1）────────────────────────────────

  /**
   * 注册一个 RPC method handler（daemon 在 `_wsLoop` 构造 WsClient 后调用）。
   *
   * 同名 method 重复注册：后者覆盖前者 + 经 `onError` 发 warn
   *（便于测试覆盖断言；生产路径每个 method 只注册一次）。
   *
   * @param method  RPC 方法名（如 `'list_dir'`），与 backend `daemon:rpc.payload.method` 比对。
   * @param handler RPC handler；收 `params`，返回 result 或抛 RpcError/Error。
   */
  registerRpcHandler(method: string, handler: RpcHandler): void {
    if (this._rpcHandlers.has(method)) {
      // 覆盖前发 warn（task-05 T21 断言 onError 被调一次）。
      this._handleError(new Error(`rpc handler overwritten: ${method}`));
    }
    this._rpcHandlers.set(method, handler);
  }

  // ── 内部方法 ───────────────────────────────────────────────────────────────

  /**
   * 构造 WS URL。1:1 对齐 Python daemon.py:148-160 _build_ws_url。
   * http→ws, https→wss, 其它兜底补 ws://。
   */
  protected _buildWsUrl(): string {
    const base = this._opts.serverUrl.replace(/\/+$/, '');
    let wsBase: string;
    if (base.startsWith('https://')) {
      wsBase = 'wss://' + base.slice('https://'.length);
    } else if (base.startsWith('http://')) {
      wsBase = 'ws://' + base.slice('http://'.length);
    } else {
      wsBase = 'ws://' + base;
    }
    const query = `runtime_id=${encodeURIComponent(this._opts.runtimeId)}`;
    return `${wsBase}${WS_PATH}?${query}`;
  }

  /** 创建底层 WebSocket（抽为 protected 便于测试 stub）。 */
  protected _createSocket(url: string): WebSocket {
    // token 通过子协议或 headers 传——v1 不传（与 Python 一致），预留扩展点。
    return new WebSocket(url);
  }

  private _handleOpen(): void {
    this._clearConnectTimer();
    this._state = WsState.Connected;
    this._callbacks.onConnected?.();
  }

  private _handleMessage(data: WebSocket.RawData): void {
    // ws 库 message 事件 payload：Buffer / Buffer[] / ArrayBuffer。统一转 string。
    const raw =
      typeof data === 'string'
        ? data
        : Buffer.isBuffer(data)
          ? data.toString('utf8')
          : Array.isArray(data)
            ? Buffer.concat(data as Buffer[]).toString('utf8')
            : String(data);
    let msg: DaemonMessage;
    try {
      msg = JSON.parse(raw) as DaemonMessage;
    } catch {
      // daemon.py:241-245：非法 JSON 仅 warn，不断连。
      this._handleError(
        new Error(`ws invalid json (truncated=${raw.slice(0, 200)})`),
      );
      return;
    }
    if (typeof msg?.type !== 'string') {
      this._handleError(
        new Error(`ws message missing type field: ${raw.slice(0, 200)}`),
      );
      return;
    }
    // task-05：RPC 请求走独立分支，不进 onMessage（不污染现有 lease 消息分发）。
    // void 异步分发——不阻塞 WS 接收下一条；任何异常在 _dispatchRpc 内消化，绝不冒泡。
    if (msg.type === MSG.RPC) {
      void this._dispatchRpc(msg);
      return;
    }
    // task-13（D-004）：POLICY_UPDATE 走独立分支，解析 payload 后调 onPolicyUpdate，
    // 不进 onMessage（不污染 lease 消息分发）。daemon 层在回调里做 version 去重 +
    // 写 PolicyCache。
    //
    // 注意：消息 type 用字符串字面量 `"daemon:policy_update"` 而非 MSG 常量——
    // protocol.ts 受 task-13 allowed_paths 限制未加 POLICY_UPDATE 常量；本字面量
    // 与 backend protocol.py `DAEMON_MSG_POLICY_UPDATE = "daemon:policy_update"`
    // 逐字对齐（任一字符漂移即推送链路断）。
    //
    // 取 msg.type 为 string 再比较：DaemonMessage.type 是 MsgType 联合字面量
    //（不含 policy_update），直接字面量比较会被 TS 判为无重叠（TS2367）。
    const msgType: string = msg.type;
    if (msgType === 'daemon:policy_update') {
      this._handlePolicyUpdate(msg);
      return;
    }
    this._callbacks.onMessage?.(msg);
  }

  /**
   * 解析 POLICY_UPDATE 消息并触发 onPolicyUpdate 回调（task-13 / D-004）。
   *
   * payload 字段判空守卫（design §7.2 PolicyUpdatePayload）：
   *   - runtime_id：非空 string，否则丢弃 + onError warn；
   *   - allowed_roots：string[]，过滤非字符串元素；空数组合法（admin 清空策略）；
   *   - version：number（单调递增），NaN/非 number 视为无效丢弃。
   *
   * 仅做解析 + 回调透传——version 去重 / PolicyCache 写入在 daemon 层回调里完成
   *（与 PolicyCache.set 内部 version 解耦）。
   */
  private _handlePolicyUpdate(msg: DaemonMessage): void {
    const payload = (msg.payload ?? {}) as {
      runtime_id?: unknown;
      allowed_roots?: unknown;
      version?: unknown;
    };
    const runtimeId =
      typeof payload.runtime_id === 'string' ? payload.runtime_id : '';
    if (!runtimeId) {
      this._handleError(
        new Error('policy_update missing runtime_id, dropping'),
      );
      return;
    }
    if (!Array.isArray(payload.allowed_roots)) {
      this._handleError(
        new Error(`policy_update allowed_roots not array: ${runtimeId}`),
      );
      return;
    }
    const allowedRoots = payload.allowed_roots.filter(
      (p): p is string => typeof p === 'string',
    );
    const version =
      typeof payload.version === 'number' && Number.isFinite(payload.version)
        ? payload.version
        : NaN;
    if (Number.isNaN(version)) {
      this._handleError(
        new Error(`policy_update invalid version: ${runtimeId}`),
      );
      return;
    }
    this._callbacks.onPolicyUpdate?.(runtimeId, allowedRoots, version);
  }

  /**
   * 分发一条 `daemon:rpc` 消息：取 handler → 执行 → 回发 `daemon:rpc_result`。
   *
   * 边界（task-05 §6）：
   *   - rpc_id 缺失/空串：无法回填，丢弃 + warn（backend 那侧 future 超时 → 504）。
   *   - 未注册 method：回 `error.code='method_not_found'`。
   *   - handler 抛 RpcError：原 code 回发。
   *   - handler 抛普通 Error：code='internal' + 原 message。
   *   - handler reject 任何值（含非 Error）：统一 internal + 字符串化 message。
   *
   * 任何异常都在本方法内 try/catch 消化，**绝不向上冒泡到 WS 接收路径**（design §4.1 3）。
   */
  private async _dispatchRpc(msg: DaemonMessage): Promise<void> {
    const payload = (msg.payload ?? {}) as {
      rpc_id?: unknown;
      method?: unknown;
      params?: unknown;
    };
    const rpcId = typeof payload.rpc_id === 'string' ? payload.rpc_id : '';
    const method = typeof payload.method === 'string' ? payload.method : '';
    const params: Record<string, unknown> =
      payload.params && typeof payload.params === 'object'
        ? (payload.params as Record<string, unknown>)
        : {};

    // rpc_id 是回填的唯一依据；缺失无法回发，丢弃（B7）。
    if (!rpcId) {
      this._handleError(new Error('rpc missing rpc_id, dropping'));
      return;
    }

    const handler = this._rpcHandlers.get(method);
    if (!handler) {
      this._sendRpcResult(rpcId, undefined, {
        code: 'method_not_found',
        message: `unknown rpc method: ${method}`,
      });
      return;
    }

    try {
      const result = await handler(params);
      this._sendRpcResult(rpcId, result, undefined);
    } catch (e) {
      const code = e instanceof RpcError ? e.code : 'internal';
      const message = e instanceof Error ? e.message : String(e);
      this._sendRpcResult(rpcId, undefined, { code, message });
    }
  }

  /**
   * 回发一条 `daemon:rpc_result`。`result` 与 `error` 互斥
   *（`error` 非空时不写 `result`，对齐 design §7.1 协议约定）。
   *
   * 复用现有 `send()`：未连接时 send 返回 false 并丢弃（不抛、不缓冲）。
   */
  private _sendRpcResult(
    rpcId: string,
    result: unknown,
    error?: { code: string; message: string },
  ): void {
    const out: DaemonMessage = {
      type: MSG.RPC_RESULT,
      payload: error ? { rpc_id: rpcId, error } : { rpc_id: rpcId, result },
    };
    this.send(out);
  }

  private _handleClose(code: number, reason: string): void {
    this._clearConnectTimer();
    this._ws = null;
    this._callbacks.onDisconnected?.(code, reason);
    if (this._running) {
      this._scheduleReconnect();
    } else {
      this._state = WsState.Idle;
    }
  }

  private _handleError(err: Error): void {
    this._callbacks.onError?.(err);
    // 不直接改 state——error 后必然跟 close，由 _handleClose 统一处理状态机。
  }

  /**
   * 启动 5s 固定退避重连（design §9 + FR-03）。
   * 幂等：已有 pending timer 时不重复调度（边界 §6 防重连风暴）。
   */
  private _scheduleReconnect(): void {
    if (this._reconnectTimer) {
      return;
    }
    this._state = WsState.Reconnecting;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this.connect();
    }, RECONNECT_INTERVAL_MS);
    // 进程退出时不阻塞（unref 仅 Node 有效）。
    this._reconnectTimer.unref?.();
  }

  private _clearReconnectTimer(): void {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  private _clearConnectTimer(): void {
    if (this._connectTimer) {
      clearTimeout(this._connectTimer);
      this._connectTimer = null;
    }
  }
}
