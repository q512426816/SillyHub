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
 *
 * 不做（design 职责分离）：
 *   - 不发 HTTP 请求（轮询归 task-17 HubClient）
 *   - 不内嵌 lease 状态机（归 task-20 Daemon）
 *   - 不解析 task_available payload 的业务含义（仅透传给 onMessage）
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
    this._callbacks.onMessage?.(msg);
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
