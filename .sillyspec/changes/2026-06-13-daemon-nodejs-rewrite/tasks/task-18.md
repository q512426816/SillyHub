---
author: qinyi
created_at: 2026-06-14T00:08:01+0800
id: task-18
title: WsClient（src/ws-client.ts，5s 重连 + HTTP 轮询兜底，ws 库）
priority: P0
estimated_hours: 4
depends_on: [task-03]
blocks: [task-20, task-22]
allowed_paths:
  - sillyhub-daemon/src/ws-client.ts
---

# task-18 — WsClient（src/ws-client.ts，5s 重连 + HTTP 轮询兜底，ws 库）

> 变更：`2026-06-13-daemon-nodejs-rewrite` · Wave W3 · 通信层 WS 侧。
> 对应 design.md §5.1 通信层（WsClient：ws，心跳 + 重连）、§9「行为不变」（WS 断线 5s 重连 + HTTP 轮询兜底策略保留）、requirements FR-03「5 秒退避重连 + HTTP 轮询兜底，与 Python 版策略一致」、G-02 契约不变、R-02（契约漂移）WS 侧缓解。
> 对应 tasks.md T-W3-18、plan.md 任务总表第 18 行。
> 风险承载：R-02（WS 消息类型漂移，WS 侧靠 task-03 的 MSG 常量 + 本 task 严格 import 不硬编码字符串缓解）、R-（无编号）重连风暴靠退避上限 + 单次连接独占规避。

## 修改文件

| 操作 | 路径 | 说明 |
|------|------|------|
| 新增 | `sillyhub-daemon/src/ws-client.ts` | `WsClient` class + `WsClientOptions` 接口 + `WsClientCallbacks` 回调接口 + 连接状态枚举；仅依赖 `ws` 库与 task-03 的 `MSG` / `WS_PATH` 常量、task-02 的 `DaemonMessage` 类型（type-only import） |

不新增/不修改其他文件。本 task 只产出 `ws-client.ts`；测试文件 `tests/ws-client.test.ts` 归 task-22（测试迁移）落地，本蓝图第 9 节给出完整可运行测试代码供其复用。HTTP 轮询兜底的实际 HTTP 调用归 task-17 HubClient（`pollPendingLeases(runtimeId)`），本 task 只暴露「降级信号」给上层（task-20 Daemon 主类决定何时启动/停止轮询循环），不直接发起 HTTP 请求——理由见边界处理 §5 与非目标。

## 实现要求

### 总则

1:1 复刻 Python `sillyhub_daemon/daemon.py:219-267` 的 WS 行为（`_ws_loop` + `_handle_ws_message` + `_build_ws_url`），把内嵌在 Daemon 类里的 WS 逻辑抽为独立 `WsClient` 模块。**契约不变**（design G-02 / N-01）：URL、消息类型、握手语义、重连退避必须与 Python 版逐字对齐。

### 必读 Python 源（已 Read，撰写本蓝图前确认）

| 来源 | 路径 | 关键行 | 用途 |
|------|------|--------|------|
| daemon Python 端（待重写源） | `sillyhub-daemon/sillyhub_daemon/daemon.py` | `_ws_loop` (L219-251)、`_handle_ws_message` (L253-267)、`_build_ws_url` (L148-160) | WS 主循环 + 消息分发 + URL 构造 |
| client.py（轮询端点源） | `sillyhub-daemon/sillyhub_daemon/client.py` | `get_pending_leases` (L186-192) → REST `GET /api/daemon/runtimes/{runtime_id}/pending-leases` | 轮询兜底实际 HTTP 调用 |
| protocol.py | `sillyhub-daemon/sillyhub_daemon/protocol.py` | `MSG_HEARTBEAT_ACK` / `MSG_TASK_AVAILABLE` | WS 入站消息类型（已 task-03 拷贝） |
| backend 对端（权威基准） | `backend/app/modules/daemon/ws_hub.py` + `router.py` | `router.py:302-356` `/ws` 端点、`ws_hub.py:207-220` `send_heartbeat_ack`、`ws_hub.py:140-180` `notify_task_available` | 验证 WS 协议方向 + 心跳方向 |

### 关键事实校验（撰写本蓝图前已 Read backend 对端确认，避免搬砖工踩坑）

1. **URL 构造**（daemon.py:148-160 `_build_ws_url`）：
   - `http://` → `ws://`，`https://` → `wss://`，其它前缀兜底补 `ws://`。
   - 路径固定 `/api/daemon/ws`（task-03 已拷贝为 `WS_PATH`）。
   - query 参数 `runtime_id=<uuid>`，由调用方传入；本 task 不负责 runtime_id 的合法性校验（backend router.py:318 会用 `uuid.UUID(runtime_id)` 强校验，非法返回 close code `4001`）。
2. **握手方向（重要修正）**：Python daemon `_ws_loop` **不在 WS 连接建立后主动发 register 消息**。runtime 注册通过 REST `POST /api/daemon/register`（task-17 HubClient 负责）独立完成，WS 连接仅靠 query 参数 `runtime_id` 标识身份，backend 在 HTTP upgrade 阶段（`router.py:324 websocket.accept()` + `hub.connect(rid, websocket)`）建立映射。**搬砖工不要在 `connect()` 成功后发 `MSG.REGISTER`**——这与 Python 行为不符，且 backend `/ws` 端点对入站 `register` 消息无处理逻辑（router.py:340-345 只识别 `heartbeat`，其它落 `ws_unknown_message_type` warning）。
3. **心跳方向（重要修正）**：协议上 `daemon:heartbeat` 由 **Daemon 主动发**，Server 收到后回 `daemon:heartbeat_ack`（router.py:340-344 + ws_hub.py:207-220）。但 Python `_handle_ws_message`（daemon.py:253-267）只处理 `MSG_TASK_AVAILABLE` 与 `MSG_HEARTBEAT_ACK`，Python `_ws_loop` **没有定时主动发 heartbeat 的逻辑**——Python 的保活完全依赖底层 `websockets` 库的协议级 ping/pong + HTTP 心跳循环（`_heartbeat_loop` daemon.py:164-179 是独立 REST 心跳，不走 WS）。
   - **本 task 决策**：与 Python 1:1 对齐，**WsClient 不主动定时发 WS heartbeat**；如果 backend 在 `/ws` 端点上主动发 `daemon:heartbeat` 探活，WsClient 收到后回 `daemon:heartbeat_ack`（即 WS 心跳由 Server 主动触发，Daemon 被动应答）。`WsClient.sendHeartbeatAck()` 方法保留供此场景调用，但不由 WsClient 内部定时器自动触发——避免引入 Python 版不存在的行为（design G-01 功能等价）。
4. **重连退避**：Python daemon.py:251 是 `asyncio.sleep(10)`。**但 design §9「行为不变」+ FR-03 + §7.1 架构图均明确写「5s 重连」**——本 task 以规格（design + requirements）为契约基准，采用 **5 秒固定退避**（不指数退避，与 Python 单层 sleep 语义一致；详见边界处理 §4 退避上限）。规格与 Python 源的 10s 偏差属「Python 实现滞后于规格」，搬砖工按规格 5s 实现，本蓝图在 §11 偏差登记中记录。
5. **HTTP 轮询兜底触发条件**：Python `_poll_loop`（daemon.py:183-215）是**独立并行循环**，每 `poll_interval` 秒无条件轮询一次，与 WS 是否在线**解耦**。任务描述要求「WS 连续失败 N 次降级到 REST 轮询」——这是对 Python 行为的**合理增强**（避免 WS 健康时空跑轮询）。本 task 采取折中：WsClient **对外暴露 `isConnected()` + `onDisconnected` 回调**，由 task-20 Daemon 主类决定「WS 在线时跳过轮询、WS 断开时启动轮询」的策略；WsClient 本身不内嵌轮询循环、不发起 HTTP 请求（保持职责单一，HTTP 归 task-17）。

### 5 大实现点（对应任务描述 1-6）

1. **`export class WsClient`** + 构造接收 `WsClientOptions`（server_url、runtime_id、可选 token、可选退避参数）+ `WsClientCallbacks`（onMessage / onConnected / onDisconnected / onError）。回调全部可选，缺省为 no-op。
2. **`connect()`**：用 `ws` 库 `new WebSocket(url)` 建立连接；URL 由私有 `_buildWsUrl()` 生成（逻辑与 daemon.py:148-160 1:1）。挂 `open` / `message` / `close` / `error` 监听器；不主动发 register（见校验 §2）。
3. **消息收发**：
   - 入站（Server → Daemon）：`message` 事件 → `JSON.parse` → 调 `onMessage(msg)`；解析失败按 daemon.py:241-245 仅 warn 不抛、不断连。
   - 出站（Daemon → Server）：暴露 `send(msg: DaemonMessage)` / `sendHeartbeatAck(payload?)` 便捷方法；内部校验 `ws.readyState === WebSocket.OPEN`，未连接时丢弃并 warn（不抛、不缓冲——Python 无缓冲语义）。
4. **`startReconnect()` / 自动重连**：`close` 事件触发后，若 `running === true` 且非主动 `close()` 调用，启动 `setTimeout(connect, 5000)`；连接失败（`error` 后 `close`）走同一路径。固定 5s，退避上限见边界 §4。
5. **HTTP 轮询降级信号**：暴露 `readonly isConnected: boolean` + `onDisconnected` 回调；由 task-20 Daemon 在 `onDisconnected` 触发时启动 `setInterval(poll, pollInterval)`，在 `onConnected` 触发时清除此 interval。**WsClient 不内嵌 HTTP 调用**（非目标 §1）。
6. **`close()`**：置 `running = false`，清重连定时器，调 `ws.close(1000, 'client_shutdown')`；幂等（多次调用不抛）。

## 接口定义

`ws-client.ts` 完整代码（搬砖工直接拷贝保存；只允许在「实现要求」与「边界处理」明示的范围内调整，不得改 URL / 重连间隔 / 消息类型字符串——这些值由 task-03 常量 + Python 源锁定）：

```ts
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
import { MSG, WS_PATH } from './protocol';
import type { DaemonMessage } from './types';

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

  /** 当前 ws 实例（仅供测试 stub 注入用，业务代码不应直接访问）。 */
  protected get socket(): WebSocket | null {
    return this._ws;
  }

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
        this._handleError(new Error(`ws connect timeout after ${CONNECT_TIMEOUT_MS}ms`));
        try { ws.terminate(); } catch { /* noop */ }
      }
    }, CONNECT_TIMEOUT_MS);

    ws.on('open', () => this._handleOpen());
    ws.on('message', (data: WebSocket.RawData) => this._handleMessage(data));
    ws.on('close', (code, reason) => this._handleClose(code, reason.toString()));
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
      setTimeout(() => {
        if (ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.OPEN) {
          try { ws.terminate(); } catch { /* noop */ }
        }
      }, CLOSE_TIMEOUT_MS).unref?.();
      this._ws = null;
    }
    this._state = WsState.Idle;
  }

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

  /** 创建底层 WebSocket（抽为 protected 便于测试 stub，见 TDD §9）。 */
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
    const raw = typeof data === 'string' ? data : Buffer.isBuffer(data)
      ? data.toString('utf8')
      : Array.isArray(data)
        ? Buffer.concat(data as Buffer[]).toString('utf8')
        : String(data);
    let msg: DaemonMessage;
    try {
      msg = JSON.parse(raw) as DaemonMessage;
    } catch {
      // daemon.py:241-245：非法 JSON 仅 warn，不断连。
      this._handleError(new Error(`ws invalid json (truncated=${raw.slice(0, 200)})`));
      return;
    }
    if (typeof msg?.type !== 'string') {
      this._handleError(new Error(`ws message missing type field: ${raw.slice(0, 200)}`));
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
```

### 重连状态机伪代码

```
[Idle]
  │ connect()
  ▼
[Connecting] ──open──▶ [Connected] ──close(running=true)──▶ [Reconnecting]
  │                       │                                       │
  │ error                 │ error                                 │ 5s timer
  │ (then close)          │ (then close)                          ▼
  ▼                       ▼                                    connect()
[Reconnecting] ◀────── [Reconnecting]
  │
  │ close() (running=false)
  ▼
[Idle]
```

- 进入 `Connected` 后清握手超时定时器。
- 进入 `Reconnecting` 后启动 5s 退避（固定，非指数）。
- `_running === false`（已 close()）时，任何 close 事件都直接进 `Idle`，不再重连。
- `connect()` 在 `Connecting` / `Connected` 状态下幂等返回（防重连风暴）。

## 边界处理

1. **连接被拒绝（ECONNREFUSED / 503 / 4001 invalid runtime_id）**：
   - `error` 事件 → `onError` 回调（仅日志，不抛）→ `close` 事件 → `_scheduleReconnect()`。
   - backend router.py:321 对非法 `runtime_id` 返回 close code `4001`：本 task **不特殊处理 4001**（与 Python 一致，Python 对所有 close 一视同仁走 10s 退避）。若上层（task-20）检测到 4001 想停止重连，可在 `onDisconnected(code===4001)` 回调里调 `wsClient.close()`。
   - 503 / 网络不可达：等同 ECONNREFUSED，走重连；HTTP 轮询兜底由 task-20 在 `onDisconnected` 触发后启动。
2. **握手超时（open_timeout）**：`connect()` 后启动 10s 握手定时器（`CONNECT_TIMEOUT_MS`），超时调 `ws.terminate()` 强断 → 触发 `close` → 重连。对应 Python `websockets.connect(open_timeout=10)`。
3. **消息非 JSON / 缺 type 字段**：`_handleMessage` 内 `JSON.parse` 失败或缺 `type` 字段时，调 `onError`（warn 级）并**丢弃该消息**，不调 `onMessage`、不断连。对应 daemon.py:241-245 `daemon.ws_invalid_message`。
4. **重连风暴（退避上限）**：
   - v1 采用**固定 5s 退避**（非指数），上限即 `RECONNECT_MAX_INTERVAL_MS = 5000`，永不增长。
   - `_scheduleReconnect()` 幂等：若已有 pending 重连 timer，直接返回不重复调度。
   - `connect()` 在 `Connecting` / `Connected` 状态下幂等返回，不重复 `new WebSocket`。
   - Server 持续 close（如 backend 重启循环）→ 每 5s 一次重连尝试，最坏频率 0.2 次/秒，对 backend 无压力。
5. **WS/轮询切换竞态**：
   - WsClient **不直接发起 HTTP 轮询**（职责单一，非目标 §1）；只暴露 `onConnected` / `onDisconnected` 回调。
   - task-20 Daemon 在 `onDisconnected` 启动 `setInterval(poll)`、在 `onConnected` 清除该 interval。**潜在竞态**：重连成功 `onConnected` 触发瞬间，上一个轮询 interval 可能已发出一次 poll——本 task 决策**容忍**（poll 幂等：重复拉 pending leases 不会副作用，task-19 TaskRunner 对同一 lease_id 重复执行靠 claim 互斥阻断）。本 task 在 `WsClientCallbacks.onConnected` 注释中明示「上层负责停轮询」。
6. **runtime_id 缺失 / 非法格式**：
   - 构造时 `runtimeId` 为空字符串 → `_buildWsUrl` 仍生成 `?runtime_id=`（空值），backend router.py:318 `uuid.UUID('')` 抛 ValueError → close code 4001 → 重连 → 再次 4001 → 每 5s 一次无效重连。
   - **本 task 不做参数校验**（YAGNI）：runtime_id 由 task-17 register 返回（合法 UUID），task-20 Daemon 在 register 成功后才调 `new WsClient`，保证 runtime_id 合法。若上层误传空值，靠 4001 重连循环 + 日志告警暴露问题，不在 WsClient 内重复校验。
7. **服务器 503 / 502 / 临时不可用**：
   - backend 启动中 / 重启中：WS upgrade 阶段返回 503 → ws 库触发 `error` + `close`（code 1006）→ `_scheduleReconnect` → 5s 后重试。
   - 上层 task-20 在 `onDisconnected` 启动 HTTP 轮询兜底，poll 端点同样 503 时由 task-17 HubClient 抛错（task-17 处理）；本 task 不感知。
8. **进程退出（SIGINT/SIGTERM）时未关闭 ws**：
   - 重连 timer 调用 `.unref?.()`，允许进程在无其它活跃 handle 时直接退出（不阻塞）。
   - 但 ws 实例本身未 unref——本 task 不处理信号（CLI task-21 负责信号 → `daemon.stop()` → `wsClient.close()`）；若信号未捕获导致进程硬退出，OS 自动回收 socket，无资源泄漏风险。
9. **重连过程中收到旧 ws 的延迟 message**：旧 ws 实例 `close` 后 `_ws = null`，新 ws 实例为新引用；若旧 ws 因 TCP 缓冲在 close 后仍触发一次 `message`，本 task 已在 `ws.on('message')` 监听器内通过闭包绑定旧实例——`_handleMessage` 仍会执行，可能调一次 `onMessage`。本 task 容忍此延迟消息（task_available 重复由 task-19 claim 互斥兜底；backend ws_hub.py:154 自带 dedup window 128）。
10. **token 传递（认证）**：v1 `token` 字段预留但 `_createSocket` 不附加（与 Python `_ws_loop` 一致——Python 未带 Authorization）。backend router.py:313 注释提到「HTTP upgrade 阶段通过 Authorization 或 token query 参数认证」，但当前 backend 实现未强制（`daemon_websocket` 无 auth dep）。本 task 跟随 Python 行为，**不传 token**；若未来 backend 启用 WS 鉴权，再扩展 `_createSocket` 加 headers/query。

## 非目标

1. **不内嵌 HTTP 轮询循环、不发 HTTP 请求**：轮询的 HTTP 调用归 task-17 HubClient（`pollPendingLeases(runtimeId)`），轮询循环的启停策略归 task-20 Daemon（在 `onConnected`/`onDisconnected` 回调里 `setInterval`/`clearInterval`）。本 task 只暴露连接状态信号。理由：保持 WsClient 职责单一（只管 WS），HTTP 逻辑归一处（task-17），便于测试 mock。
2. **不做 lease 状态机**：收到 `task_available` 后的 claim/start/complete 流程归 task-19 TaskRunner + task-20 Daemon。本 task 收到任何 DaemonMessage 都仅透传给 `onMessage`，不解析业务语义。
3. **不引入 socket.io / 自定义协议**：用原生 `ws` 库 + 裸 JSON 帧，与 backend FastAPI `WebSocket` 端点 1:1（backend 也是裸 WebSocket，非 socket.io）。
4. **不做 TLS 证书定制**：`wss://` 由 Node 默认 TLS 验证；不自定义 ca/cert/key（YAGNI，本项目未上线，自签证书场景由部署侧 `NODE_EXTRA_CA_CERTS` 环境变量处理，不在代码内）。
5. **不实现指数退避**：v1 固定 5s，与 Python 单层 sleep 一致；`RECONNECT_MAX_INTERVAL_MS` 常量预留但当前等于 5s，不主动切换指数退避（避免引入 Python 版不存在的行为）。
6. **不做 WS 心跳主动发送**：Python `_ws_loop` 无主动发 `daemon:heartbeat` 的定时器；本 task 跟随 Python 行为。`sendHeartbeatAck()` 方法保留但**不由 WsClient 内部定时器自动调用**（仅当未来 backend 在 `/ws` 端点主动发 `daemon:heartbeat` 探活、且确认 Python 也应答后，才在 task-20 内加定时器调本方法）。
7. **不做连接级消息缓冲 / 重放**：断线期间未发出的 `send()` 调用直接丢弃（返回 false）；不缓冲、不重放（Python 无此语义，且 lease 生命周期靠 claim 互斥保证幂等）。
8. **不处理 `daemon:register` 的 WS 握手**：runtime 注册通过 REST（task-17）独立完成，WS 仅靠 query runtime_id 标识（见实现要点 §2 校验）。
9. **不写测试文件本体**：`tests/ws-client.test.ts` 归 task-22（测试迁移）落地；本蓝图第 9 节给出完整测试代码供其复用。

## 参考

- **daemon Python 端（核心，待重写源）**：
  - `sillyhub-daemon/sillyhub_daemon/daemon.py:219-251` `_ws_loop`（重连主循环、`asyncio.sleep(10)` 退避、open_timeout=10/close_timeout=5）
  - `sillyhub-daemon/sillyhub_daemon/daemon.py:253-267` `_handle_ws_message`（task_available / heartbeat_ack 分派）
  - `sillyhub-daemon/sillyhub_daemon/daemon.py:148-160` `_build_ws_url`（http→ws / https→wss 转换 + query runtime_id）
  - `sillyhub-daemon/sillyhub_daemon/daemon.py:183-215` `_poll_loop`（轮询兜底，独立并行循环——本 task 对外暴露信号让 task-20 复刻此策略）
- **轮询端点源**：`sillyhub-daemon/sillyhub_daemon/client.py:186-192` `get_pending_leases` → REST `GET /api/daemon/runtimes/{runtime_id}/pending-leases`
- **协议常量**：`sillyhub-daemon/sillyhub_daemon/protocol.py` `MSG_HEARTBEAT_ACK` / `MSG_TASK_AVAILABLE` / `MSG_HEARTBEAT`（已 task-03 拷贝为 `MSG.HEARTBEAT_ACK` / `MSG.TASK_AVAILABLE` / `MSG.HEARTBEAT`）
- **backend 对端（权威基准）**：
  - `backend/app/modules/daemon/router.py:302-356` `/ws` 端点（query runtime_id 校验 → close 4001、accept、收 heartbeat 回 heartbeat_ack、未知 type warn）
  - `backend/app/modules/daemon/ws_hub.py:207-220` `send_heartbeat_ack`（Server → Daemon 方向）
  - `backend/app/modules/daemon/ws_hub.py:140-180` `notify_task_available`（含 dedup window 128，影响边界 §9 重复消息容忍）
  - `backend/app/modules/daemon/ws_hub.py:43-67` `connect`（重复 runtime_id 踢旧连接 close 4000）
- **依赖任务产物**：
  - `task-03` → `sillyhub-daemon/src/protocol.ts`（`MSG` / `WS_PATH` 常量，本 task 必须 import 不硬编码）
  - `task-02` → `sillyhub-daemon/src/types.ts`（`DaemonMessage` 类型，type-only import）
  - `task-01` → `sillyhub-daemon/package.json`（`ws` + `@types/ws` 已声明）
- **后续消费任务**：
  - `task-20` Daemon 主类：实例化 WsClient、在 `onMessage` 分派 task_available、在 `onDisconnected`/`onConnected` 启停 HTTP 轮询兜底
  - `task-22` 测试迁移：落地 `tests/ws-client.test.ts`（本蓝图 §9 给出代码）
- **变更设计**：
  - `.sillyspec/changes/2026-06-13-daemon-nodejs-rewrite/design.md` §5.1 通信层（WsClient：ws，心跳 + 重连）、§7.4 protocol.ts 蓝图、§9「行为不变：WS 断线 5s 重连 + HTTP 轮询兜底策略保留」、R-02（契约漂移，WS 侧）
- **变更需求**：`.sillyspec/changes/2026-06-13-daemon-nodejs-rewrite/requirements.md` FR-03（5s 退避重连 + HTTP 轮询兜底，与 Python 版策略一致）、G-02 契约不变
- **模块文档**：`.sillyspec/docs/sillyhub-daemon/modules/daemon.md`（如存在，daemon 主类生命周期摘要）

## TDD 步骤

测试文件路径：`sillyhub-daemon/tests/ws-client.test.ts`（归 task-22 脚手架创建，本 task 实现完成后即可立即编写并运行）。本蓝图给出完整可运行测试代码。

**测试策略**：用 `ws` 库内置的 `WebSocketServer` 起一个本地 mock server（无需真实 backend），覆盖连接/重连/轮询信号/心跳应答/边界。契约断言（消息类型字符串）通过断言 `MSG` 常量间接覆盖（直接常量断言已在 task-03 单测中完成，本 task 不重复）。

**RED 阶段 — 先写测试**：

```ts
// tests/ws-client.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import { WsClient, WsState, RECONNECT_INTERVAL_MS, CONNECT_TIMEOUT_MS } from '../src/ws-client';
import { MSG, WS_PATH } from '../src/protocol';

/**
 * 起一个本地 mock WS server，返回 { server, url, received }。
 * received 收集所有客户端发来的消息（已 JSON.parse）。
 */
function startMockServer(): Promise<{
  server: WebSocketServer;
  url: string;
  received: unknown[];
  conns: WebSocket[];
}> {
  return new Promise((resolve) => {
    const server = new WebSocketServer({ port: 0 });
    const received: unknown[] = [];
    const conns: WebSocket[] = [];
    server.on('connection', (ws, req) => {
      conns.push(ws);
      ws.on('message', (raw) => {
        try { received.push(JSON.parse(raw.toString())); } catch { received.push(raw.toString()); }
      });
    });
    // 拿到端口后构造 url。
    server.on('listening', () => {
      const port = (server.address() as { port: number }).port;
      resolve({ server, url: `ws://127.0.0.1:${port}`, received, conns });
    });
  });
}

describe('WsClient — URL 构造 1:1 对齐 Python _build_ws_url', () => {
  it('http:// → ws://', () => {
    const c = new WsClient({ serverUrl: 'http://hub.example.com:8000', runtimeId: 'r1' });
    expect((c as unknown as { _buildWsUrl: () => string })._buildWsUrl())
      .toBe(`ws://hub.example.com:8000${WS_PATH}?runtime_id=r1`);
  });
  it('https:// → wss://', () => {
    const c = new WsClient({ serverUrl: 'https://hub.example.com', runtimeId: 'r2' });
    expect((c as unknown as { _buildWsUrl: () => string })._buildWsUrl())
      .toBe(`wss://hub.example.com${WS_PATH}?runtime_id=r2`);
  });
  it('末尾斜杠被 rstrip', () => {
    const c = new WsClient({ serverUrl: 'http://localhost:8000///', runtimeId: 'r3' });
    expect((c as unknown as { _buildWsUrl: () => string })._buildWsUrl())
      .toBe(`ws://localhost:8000${WS_PATH}?runtime_id=r3`);
  });
  it('runtime_id 被 encodeURIComponent', () => {
    const c = new WsClient({ serverUrl: 'http://x', runtimeId: 'a b/c' });
    expect((c as unknown as { _buildWsUrl: () => string })._buildWsUrl())
      .toContain('runtime_id=a%20b%2Fc');
  });
});

describe('WsClient — 连接生命周期', () => {
  let mock: Awaited<ReturnType<typeof startMockServer>>;
  beforeEach(async () => { mock = await startMockServer(); });
  afterEach(async () => {
    await new Promise<void>((r) => mock.server.close(() => r()));
  });

  it('connect() 后状态 Connected，触发 onConnected', async () => {
    const onConnected = vi.fn();
    const c = new WsClient({ serverUrl: mock.url.replace('ws://', 'http://'), runtimeId: 'r1', callbacks: { onConnected } });
    c.connect();
    await vi.waitFor(() => expect(c.state).toBe(WsState.Connected));
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(c.isConnected).toBe(true);
    c.close();
  });

  it('收到合法 DaemonMessage → onMessage(msg)', async () => {
    const onMessage = vi.fn();
    const c = new WsClient({ serverUrl: mock.url.replace('ws://', 'http://'), runtimeId: 'r1', callbacks: { onMessage } });
    c.connect();
    await vi.waitFor(() => expect(c.isConnected).toBe(true));
    // Server 主动 push task_available
    mock.conns[0]?.send(JSON.stringify({ type: MSG.TASK_AVAILABLE, payload: { lease_id: 'L1' } }));
    await vi.waitFor(() => expect(onMessage).toHaveBeenCalledTimes(1));
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'daemon:task_available',
      payload: expect.objectContaining({ lease_id: 'L1' }),
    }));
    c.close();
  });

  it('收到非法 JSON → 不调 onMessage、不断连', async () => {
    const onMessage = vi.fn();
    const onError = vi.fn();
    const c = new WsClient({ serverUrl: mock.url.replace('ws://', 'http://'), runtimeId: 'r1', callbacks: { onMessage, onError } });
    c.connect();
    await vi.waitFor(() => expect(c.isConnected).toBe(true));
    mock.conns[0]?.send('not-a-json{');
    await new Promise((r) => setTimeout(r, 50));
    expect(onMessage).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(c.isConnected).toBe(true); // 仍连接
    c.close();
  });
});

describe('WsClient — 5s 重连退避（FR-03）', () => {
  it('Server 主动 close → 5s 后重连成功', async () => {
    const mock = await startMockServer();
    try {
      const onDisconnected = vi.fn();
      const onConnected = vi.fn();
      const c = new WsClient({
        serverUrl: mock.url.replace('ws://', 'http://'),
        runtimeId: 'r1',
        callbacks: { onDisconnected, onConnected },
      });
      c.connect();
      await vi.waitFor(() => expect(c.isConnected).toBe(true));
      expect(onConnected).toHaveBeenCalledTimes(1);
      // Server 踢连接
      mock.conns[0]?.close(1000, 'test');
      await vi.waitFor(() => expect(onDisconnected).toHaveBeenCalledTimes(1));
      expect(c.state).toBe(WsState.Reconnecting);
      // 用 fake timers 避免真等 5s
      vi.useFakeTimers();
      vi.advanceTimersByTime(RECONNECT_INTERVAL_MS);
      await vi.waitFor(() => expect(c.isConnected).toBe(true));
      expect(onConnected).toHaveBeenCalledTimes(2); // 重连后再次触发
      vi.useRealTimers();
      c.close();
    } finally {
      await new Promise<void>((r) => mock.server.close(() => r()));
    }
  });

  it('close() 后 running=false → 不重连', async () => {
    const mock = await startMockServer();
    try {
      const onConnected = vi.fn();
      const c = new WsClient({
        serverUrl: mock.url.replace('ws://', 'http://'),
        runtimeId: 'r1',
        callbacks: { onConnected },
      });
      c.connect();
      await vi.waitFor(() => expect(c.isConnected).toBe(true));
      c.close();
      expect(c.state).toBe(WsState.Idle);
      vi.useFakeTimers();
      vi.advanceTimersByTime(RECONNECT_INTERVAL_MS * 3);
      expect(onConnected).toHaveBeenCalledTimes(1); // 未重连
      vi.useRealTimers();
    } finally {
      await new Promise<void>((r) => mock.server.close(() => r()));
    }
  });

  it('连接失败（端口无服务）→ 5s 后重试', async () => {
    const onError = vi.fn();
    const c = new WsClient({
      serverUrl: 'http://127.0.0.1:1', // 1 号端口几乎肯定无服务
      runtimeId: 'r1',
      callbacks: { onError },
    });
    c.connect();
    await vi.waitFor(() => expect(onError).toHaveBeenCalled(), { timeout: 1000 });
    expect(c.state).toBe(WsState.Reconnecting);
    c.close();
  });
});

describe('WsClient — 出站消息', () => {
  it('send() 在 Connected 时序列化 JSON 并发出', async () => {
    const mock = await startMockServer();
    try {
      const c = new WsClient({ serverUrl: mock.url.replace('ws://', 'http://'), runtimeId: 'r1' });
      c.connect();
      await vi.waitFor(() => expect(c.isConnected).toBe(true));
      const ok = c.send({ type: MSG.HEARTBEAT_ACK, payload: { runtime_id: 'r1' } });
      expect(ok).toBe(true);
      await vi.waitFor(() => expect(mock.received.length).toBe(1));
      expect(mock.received[0]).toEqual({ type: 'daemon:heartbeat_ack', payload: { runtime_id: 'r1' } });
      c.close();
    } finally {
      await new Promise<void>((r) => mock.server.close(() => r()));
    }
  });

  it('send() 未连接时返回 false，不抛', () => {
    const c = new WsClient({ serverUrl: 'http://x', runtimeId: 'r1' });
    expect(c.send({ type: MSG.HEARTBEAT_ACK })).toBe(false);
  });

  it('sendHeartbeatAck() 自动填 runtime_id', async () => {
    const mock = await startMockServer();
    try {
      const c = new WsClient({ serverUrl: mock.url.replace('ws://', 'http://'), runtimeId: 'rid-42' });
      c.connect();
      await vi.waitFor(() => expect(c.isConnected).toBe(true));
      c.sendHeartbeatAck({ extra: 1 });
      await vi.waitFor(() => expect(mock.received.length).toBe(1));
      expect(mock.received[0]).toEqual({
        type: 'daemon:heartbeat_ack',
        payload: { runtime_id: 'rid-42', extra: 1 },
      });
      c.close();
    } finally {
      await new Promise<void>((r) => mock.server.close(() => r()));
    }
  });
});

describe('WsClient — 常量与 Python 对齐', () => {
  it('RECONNECT_INTERVAL_MS === 5000（FR-03 / design §9）', () => {
    expect(RECONNECT_INTERVAL_MS).toBe(5_000);
  });
  it('CONNECT_TIMEOUT_MS === 10000（Python open_timeout=10）', () => {
    expect(CONNECT_TIMEOUT_MS).toBe(10_000);
  });
});
```

**GREEN 阶段 — 实现到测试全过**：将本蓝图第 6 节「接口定义」中的 `ws-client.ts` 代码原样写入 `sillyhub-daemon/src/ws-client.ts`，运行 `pnpm test tests/ws-client.test.ts` 全绿。

**REFACTOR 阶段**：检查项——
- 状态机转换是否有遗漏（如 `Connecting → Reconnecting` 直接跳过 `Connected` 的路径，发生在握手超时时）。
- 定时器是否都加了 `.unref?.()`（防进程挂死）。
- `close()` 幂等性（连续调 3 次不抛）。
- 错误日志是否带足够上下文（runtime_id、url、code、reason）。

## 验收标准

| ID | 验收项 | 验证方法 | 通过标准 |
|----|--------|----------|----------|
| AC-01 | 连接 URL 与 Python `_build_ws_url` 1:1 | Read `sillyhub-daemon/sillyhub_daemon/daemon.py:148-160`，对 `http://`/`https://`/无前缀/末尾斜杠 四种输入分别比对 Python 输出与 `WsClient._buildWsUrl()` 输出 | 4/4 case 字符串全等（含 `WS_PATH=/api/daemon/ws` 拼接、query `runtime_id=` + encodeURIComponent） |
| AC-02 | 不主动发 register（与 Python 一致） | grep `ws-client.ts`，确认 `connect()` / `_handleOpen()` 内**无** `send({ type: MSG.REGISTER })` 调用；单测 `tests/ws-client.test.ts` 中 `连接生命周期` describe 下无 register 发送断言 | 零匹配；register 仅作为 task-17 REST 端点的职责 |
| AC-03 | 5s 固定退避重连（FR-03 / design §9） | 单测 `5s 重连退避` describe：Server close 后用 `vi.useFakeTimers()` + `vi.advanceTimersByTime(5000)` 验证重连触发；断言 `RECONNECT_INTERVAL_MS === 5000` | 重连在 5000ms±1 边界触发；常量断言通过；非指数（连续 3 次 close 间隔均为 5000ms） |
| AC-04 | HTTP 轮询兜底信号正确暴露 | grep `ws-client.ts`，确认导出 `WsClientCallbacks.onConnected` + `onDisconnected` + `WsClient.isConnected` getter；单测验证 close 时 `onDisconnected(code, reason)` 被调用、重连成功时 `onConnected` 被调用 | 三个符号均导出；单测断言回调时序正确（断 → onDisconnected → 5s → onConnected） |
| AC-05 | 握手超时 10s（Python `open_timeout=10`） | 单测：stub `_createSocket` 返回一个永不触发 `open` 的伪 ws，断言 10s 后触发 `onError` + 进入 Reconnecting；断言 `CONNECT_TIMEOUT_MS === 10000` | 超时路径覆盖；常量断言通过 |
| AC-06 | 用 `ws` 库（非 socket.io / 非原生 WebSocket） | grep `ws-client.ts` 顶部 `import WebSocket from 'ws'`；确认无 `import { io } from 'socket.io'`、无 `new WebSocket(url)`（浏览器全局）调用 | 唯一 WS 实现 source 是 `ws` 库 |
| AC-07 | 消息类型字符串零硬编码 | grep `ws-client.ts`，确认所有 `type: 'daemon:...'` 字面量均来自 `MSG.*` 常量；唯一允许的字符串是 `MSG.HEARTBEAT_ACK` 在 `sendHeartbeatAck` 内 | 零裸字符串字面量（`type:` 后必须跟 `MSG.` 前缀） |
| AC-08 | vitest 全绿 | 在 `sillyhub-daemon/` 执行 `pnpm test tests/ws-client.test.ts` | 5 个 describe block 全部 it 通过，断言数 ≥ 20 条 |
| AC-09 | tsc 零错误（strict） | 在 `sillyhub-daemon/` 执行 `pnpm tsc --noEmit`（task-01 tsconfig strict 模式） | 退出码 0，无 error / 无 warning |
| AC-10 | 非法 JSON 不断连（daemon.py:241-245 行为） | 单测 `收到非法 JSON → 不调 onMessage、不断连`：Server 发 `'not-a-json{'`，断言 `onError` 调用 1 次、`onMessage` 调用 0 次、`isConnected === true` | 三项断言全通过 |
| AC-11 | close() 幂等 + 停止重连 | 单测 `close() 后 running=false → 不重连`：close 后 `advanceTimersByTime(15000)`，断言 `onConnected` 未再次触发、`state === Idle` | 重连计数不增长；状态停在 Idle |
