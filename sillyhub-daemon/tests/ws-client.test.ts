// tests/ws-client.test.ts
// task-18: WsClient WebSocket 通信层。1:1 复刻 Python sillyhub_daemon/daemon.py
// 的 _ws_loop (L219-251) + _handle_ws_message (L253-267) + _build_ws_url (L148-160)。
// 对照 Python: 重连退避 / open/close timeout / 非法 JSON warn 不抛。
// 用 ws 库内置 WebSocketServer 起本地 mock server，无需真实 backend。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import {
  WsClient,
  WsState,
  RpcError,
  type RpcHandler,
  RECONNECT_BACKOFF_SCHEDULE_MS,
  RECONNECT_JITTER_RATIO,
  CONNECT_TIMEOUT_MS,
  WS_PING_INTERVAL_MS,
  WS_PONG_TIMEOUT_MS,
} from '../src/ws-client.js';
import { MSG, WS_PATH } from '../src/protocol.js';

/**
 * 起一个本地 mock WS server，返回 { server, url, received }。
 * received 收集所有客户端发来的消息（已 JSON.parse）。
 * reqHeaders 收集每次连接的升级请求头（task-02 断言 X-API-Key 用）。
 */
function startMockServer(): Promise<{
  server: WebSocketServer;
  url: string;
  received: unknown[];
  conns: WebSocket[];
  reqHeaders: Record<string, string | string[] | undefined>[];
}> {
  return new Promise((resolve) => {
    const server = new WebSocketServer({ port: 0 });
    const received: unknown[] = [];
    const conns: WebSocket[] = [];
    const reqHeaders: Record<string, string | string[] | undefined>[] = [];
    server.on('connection', (ws, req) => {
      conns.push(ws);
      reqHeaders.push(req.headers);
      ws.on('message', (raw) => {
        try {
          received.push(JSON.parse(raw.toString()));
        } catch {
          received.push(raw.toString());
        }
      });
    });
    // 拿到端口后构造 url。
    server.on('listening', () => {
      const addr = server.address() as { port: number };
      resolve({ server, url: `ws://127.0.0.1:${addr.port}`, received, conns, reqHeaders });
    });
  });
}

describe('WsClient — URL 构造 1:1 对齐 Python _build_ws_url', () => {
  it('http:// → ws://', () => {
    const c = new WsClient({
      serverUrl: 'http://hub.example.com:8000',
      runtimeId: 'r1',
    });
    expect((c as unknown as { _buildWsUrl: () => string })._buildWsUrl()).toBe(
      `ws://hub.example.com:8000${WS_PATH}?daemon_local_id=r1`,
    );
  });
  it('https:// → wss://', () => {
    const c = new WsClient({ serverUrl: 'https://hub.example.com', runtimeId: 'r2' });
    expect((c as unknown as { _buildWsUrl: () => string })._buildWsUrl()).toBe(
      `wss://hub.example.com${WS_PATH}?daemon_local_id=r2`,
    );
  });
  it('末尾斜杠被 rstrip', () => {
    const c = new WsClient({
      serverUrl: 'http://localhost:8000///',
      runtimeId: 'r3',
    });
    expect((c as unknown as { _buildWsUrl: () => string })._buildWsUrl()).toBe(
      `ws://localhost:8000${WS_PATH}?daemon_local_id=r3`,
    );
  });
  it('runtime_id 被 encodeURIComponent', () => {
    const c = new WsClient({ serverUrl: 'http://x', runtimeId: 'a b/c' });
    expect((c as unknown as { _buildWsUrl: () => string })._buildWsUrl()).toContain(
      'daemon_local_id=a%20b%2Fc',
    );
  });
});

describe('WsClient — 连接生命周期', () => {
  let mock: Awaited<ReturnType<typeof startMockServer>>;
  beforeEach(async () => {
    mock = await startMockServer();
  });
  afterEach(async () => {
    await new Promise<void>((r) => mock.server.close(() => r()));
  });

  it('connect() 后状态 Connected，触发 onConnected', async () => {
    const onConnected = vi.fn();
    const c = new WsClient({
      serverUrl: mock.url.replace('ws://', 'http://'),
      runtimeId: 'r1',
      callbacks: { onConnected },
    });
    c.connect();
    await vi.waitFor(() => expect(c.state).toBe(WsState.Connected));
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(c.isConnected).toBe(true);
    c.close();
  });

  it('收到合法 DaemonMessage → onMessage(msg)', async () => {
    const onMessage = vi.fn();
    const c = new WsClient({
      serverUrl: mock.url.replace('ws://', 'http://'),
      runtimeId: 'r1',
      callbacks: { onMessage },
    });
    c.connect();
    await vi.waitFor(() => expect(c.isConnected).toBe(true));
    // Server 主动 push task_available
    mock.conns[0]?.send(
      JSON.stringify({ type: MSG.TASK_AVAILABLE, payload: { lease_id: 'L1' } }),
    );
    await vi.waitFor(() => expect(onMessage).toHaveBeenCalledTimes(1));
    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'daemon:task_available',
        payload: expect.objectContaining({ lease_id: 'L1' }),
      }),
    );
    c.close();
  });

  // ── perf-remediation task-09 / D-003@v1：lastMessageAt 只读 getter ─────────

  it('task-09: lastMessageAt 初始 null，收到消息后刷新为当前时间（只读）', async () => {
    const c = new WsClient({
      serverUrl: mock.url.replace('ws://', 'http://'),
      runtimeId: 'r1',
    });
    expect(c.lastMessageAt).toBeNull(); // 未连接未收消息
    c.connect();
    await vi.waitFor(() => expect(c.isConnected).toBe(true));
    expect(c.lastMessageAt).toBeNull(); // 连接本身（open 事件）不算消息

    const before = Date.now();
    mock.conns[0]?.send(
      JSON.stringify({ type: MSG.TASK_AVAILABLE, payload: { lease_id: 'L9' } }),
    );
    await vi.waitFor(() => expect(c.lastMessageAt).not.toBeNull());
    const stamped = c.lastMessageAt as number;
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThanOrEqual(Date.now());

    // 第二条消息刷新时间戳（单调不减）
    await new Promise((r) => setTimeout(r, 5));
    mock.conns[0]?.send(
      JSON.stringify({ type: MSG.TASK_AVAILABLE, payload: { lease_id: 'L10' } }),
    );
    await vi.waitFor(() => expect(c.lastMessageAt).toBeGreaterThan(stamped));
    c.close();
  });

  it('task-09: 非法 JSON 消息也刷新 lastMessageAt（链路活着即计入）', async () => {
    const c = new WsClient({
      serverUrl: mock.url.replace('ws://', 'http://'),
      runtimeId: 'r1',
    });
    c.connect();
    await vi.waitFor(() => expect(c.isConnected).toBe(true));
    mock.conns[0]?.send('not-a-json{');
    await vi.waitFor(() => expect(c.lastMessageAt).not.toBeNull());
    c.close();
  });

  it('收到非法 JSON → 不调 onMessage、不断连', async () => {
    const onMessage = vi.fn();
    const onError = vi.fn();
    const c = new WsClient({
      serverUrl: mock.url.replace('ws://', 'http://'),
      runtimeId: 'r1',
      callbacks: { onMessage, onError },
    });
    c.connect();
    await vi.waitFor(() => expect(c.isConnected).toBe(true));
    mock.conns[0]?.send('not-a-json{');
    await new Promise((r) => setTimeout(r, 50));
    expect(onMessage).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(c.isConnected).toBe(true); // 仍连接
    c.close();
  });

  // task-13（2026-07-02-daemon-filesystem-policy / D-004）：POLICY_UPDATE 推送
  // → onPolicyUpdate 回调触发，参数正确；不进 onMessage。
  it('收到 daemon:policy_update → onPolicyUpdate(rid, roots, version) 触发，不进 onMessage', async () => {
    const onMessage = vi.fn();
    const onPolicyUpdate = vi.fn();
    const c = new WsClient({
      serverUrl: mock.url.replace('ws://', 'http://'),
      runtimeId: 'r1',
      callbacks: { onMessage, onPolicyUpdate },
    });
    c.connect();
    await vi.waitFor(() => expect(c.isConnected).toBe(true));
    mock.conns[0]?.send(
      JSON.stringify({
        type: 'daemon:policy_update',
        payload: {
          runtime_id: 'srv-rt-claude',
          allowed_roots: ['/a', '/b'],
          version: 5,
        },
      }),
    );
    await vi.waitFor(() => expect(onPolicyUpdate).toHaveBeenCalledTimes(1));
    expect(onPolicyUpdate).toHaveBeenCalledWith('srv-rt-claude', ['/a', '/b'], 5);
    // 不污染 lease 消息分发
    expect(onMessage).not.toHaveBeenCalled();
    c.close();
  });

  // task-13：payload 字段缺失 / 类型错 → 不崩、不回调（经 onError warn）。
  it('policy_update 缺 runtime_id → 不调 onPolicyUpdate、调 onError', async () => {
    const onPolicyUpdate = vi.fn();
    const onError = vi.fn();
    const c = new WsClient({
      serverUrl: mock.url.replace('ws://', 'http://'),
      runtimeId: 'r1',
      callbacks: { onPolicyUpdate, onError },
    });
    c.connect();
    await vi.waitFor(() => expect(c.isConnected).toBe(true));
    mock.conns[0]?.send(
      JSON.stringify({
        type: 'daemon:policy_update',
        payload: { allowed_roots: ['/a'], version: 1 },
      }),
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(onPolicyUpdate).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(c.isConnected).toBe(true);
    c.close();
  });

  it('policy_update allowed_roots 非数组 → 不调 onPolicyUpdate', async () => {
    const onPolicyUpdate = vi.fn();
    const onError = vi.fn();
    const c = new WsClient({
      serverUrl: mock.url.replace('ws://', 'http://'),
      runtimeId: 'r1',
      callbacks: { onPolicyUpdate, onError },
    });
    c.connect();
    await vi.waitFor(() => expect(c.isConnected).toBe(true));
    mock.conns[0]?.send(
      JSON.stringify({
        type: 'daemon:policy_update',
        payload: { runtime_id: 'r1', allowed_roots: 'not-array', version: 1 },
      }),
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(onPolicyUpdate).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    c.close();
  });

  it('policy_update allowed_roots 含非字符串元素 → 过滤后回调', async () => {
    const onPolicyUpdate = vi.fn();
    const c = new WsClient({
      serverUrl: mock.url.replace('ws://', 'http://'),
      runtimeId: 'r1',
      callbacks: { onPolicyUpdate },
    });
    c.connect();
    await vi.waitFor(() => expect(c.isConnected).toBe(true));
    mock.conns[0]?.send(
      JSON.stringify({
        type: 'daemon:policy_update',
        payload: {
          runtime_id: 'r1',
          allowed_roots: ['/a', 123, '/b', null, { x: 1 }],
          version: 2,
        },
      }),
    );
    await vi.waitFor(() => expect(onPolicyUpdate).toHaveBeenCalledTimes(1));
    expect(onPolicyUpdate).toHaveBeenCalledWith('r1', ['/a', '/b'], 2);
    c.close();
  });

  it('policy_update version 非数字 → 不调 onPolicyUpdate', async () => {
    const onPolicyUpdate = vi.fn();
    const onError = vi.fn();
    const c = new WsClient({
      serverUrl: mock.url.replace('ws://', 'http://'),
      runtimeId: 'r1',
      callbacks: { onPolicyUpdate, onError },
    });
    c.connect();
    await vi.waitFor(() => expect(c.isConnected).toBe(true));
    mock.conns[0]?.send(
      JSON.stringify({
        type: 'daemon:policy_update',
        payload: { runtime_id: 'r1', allowed_roots: ['/a'], version: 'oops' },
      }),
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(onPolicyUpdate).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    c.close();
  });
});

// task-02（security-audit-remediation / FR-01）：WS 升级期鉴权头。
// backend 升级握手要求 X-API-Key（或 Bearer），否则 4001 拒绝——daemon 必须带头。
describe('WsClient — X-API-Key 升级请求头（security-audit-remediation task-02）', () => {
  let mock: Awaited<ReturnType<typeof startMockServer>>;
  beforeEach(async () => {
    mock = await startMockServer();
  });
  afterEach(async () => {
    await new Promise<void>((r) => mock.server.close(() => r()));
  });

  it('apiKey 配置时 → 升级请求头含 X-API-Key 且值为所配 key', async () => {
    const c = new WsClient({
      serverUrl: mock.url.replace('ws://', 'http://'),
      runtimeId: 'r1',
      apiKey: 'hub-secret-key-123',
    });
    c.connect();
    await vi.waitFor(() => expect(c.isConnected).toBe(true));
    expect(mock.reqHeaders.length).toBe(1);
    expect(mock.reqHeaders[0]?.['x-api-key']).toBe('hub-secret-key-123');
    c.close();
  });

  it('无 apiKey → 升级请求头不含 X-API-Key（向后兼容，mock server 可连）', async () => {
    const c = new WsClient({
      serverUrl: mock.url.replace('ws://', 'http://'),
      runtimeId: 'r1',
    });
    c.connect();
    await vi.waitFor(() => expect(c.isConnected).toBe(true));
    expect(mock.reqHeaders.length).toBe(1);
    expect(mock.reqHeaders[0]?.['x-api-key']).toBeUndefined();
    c.close();
  });

  it('apiKey 为空串 → 视为未配置，不发头（避免发空凭证被 backend 拒）', async () => {
    const c = new WsClient({
      serverUrl: mock.url.replace('ws://', 'http://'),
      runtimeId: 'r1',
      apiKey: '',
    });
    c.connect();
    await vi.waitFor(() => expect(c.isConnected).toBe(true));
    expect(mock.reqHeaders[0]?.['x-api-key']).toBeUndefined();
    c.close();
  });
});

// ── 指数退避重连（2026-08-29-daemon-platform-resilience task-06 / design A1）──
// 原「固定 5s（RECONNECT_INTERVAL_MS）」改为退避档位序列 [1,2,4,8,16,30]s 封顶
// + 每档 ±20% jitter；收到任何 WS 消息/pong 档位重置回第 0 档。时序断言用
// jitterFn 注入固定抖动源（()=>0.5 = 无抖动基准值）保持确定性。
describe('WsClient — 指数退避重连（task-06 / design A1）', () => {
  it('档位序列：连续调度延时按 [1,2,4,8,16,30]s 推进并在最后档封顶（jitter 固定中值）', () => {
    const c = new WsClient({
      serverUrl: 'http://x',
      runtimeId: 'r1',
      jitterFn: () => 0.5, // 抖动系数 = 1 + (0.5×2−1)×0.2 = 1.0（无抖动）
    });
    const next = (c as unknown as { _nextReconnectDelayMs: () => number })
      ._nextReconnectDelayMs;
    // 依次取档：1,2,4,8,16,30s，之后驻留 30s。
    const delays = [
      next.call(c),
      next.call(c),
      next.call(c),
      next.call(c),
      next.call(c),
      next.call(c),
      next.call(c),
      next.call(c),
    ];
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
  });

  it('抖动区间：jitter=0 → 0.8 倍基准；jitter=1 → 1.2 倍基准（±20%）', () => {
    const lo = new WsClient({ serverUrl: 'http://x', runtimeId: 'r1', jitterFn: () => 0 });
    const hi = new WsClient({ serverUrl: 'http://x', runtimeId: 'r1', jitterFn: () => 1 });
    const loNext = (lo as unknown as { _nextReconnectDelayMs: () => number })._nextReconnectDelayMs;
    const hiNext = (hi as unknown as { _nextReconnectDelayMs: () => number })._nextReconnectDelayMs;
    // 第 4 档 8000ms 为例：0.8×=6400 / 1.2×=9600。
    loNext.call(lo); loNext.call(lo); loNext.call(lo);
    hiNext.call(hi); hiNext.call(hi); hiNext.call(hi);
    expect(loNext.call(lo)).toBe(6_400);
    expect(hiNext.call(hi)).toBe(9_600);
  });

  it('收到任何 WS 消息 → 档位重置回第 0 档（含非法 JSON——链路活着即证据）', () => {
    const c = new WsClient({
      serverUrl: 'http://x',
      runtimeId: 'r1',
      jitterFn: () => 0.5,
    });
    const hack = c as unknown as {
      _nextReconnectDelayMs: () => number;
      _handleMessage: (data: WebSocket.RawData) => void;
      _reconnectAttempt: number;
    };
    // 推进到第 3 档（8s）。
    hack._nextReconnectDelayMs();
    hack._nextReconnectDelayMs();
    hack._nextReconnectDelayMs();
    expect(hack._reconnectAttempt).toBe(3);
    // 非法 JSON 消息到达 → 重置。
    hack._handleMessage(Buffer.from('not-a-json{'));
    expect(hack._reconnectAttempt).toBe(0);
    expect(hack._nextReconnectDelayMs()).toBe(1_000);
  });

  it('收到 pong → 档位重置回第 0 档', () => {
    const c = new WsClient({ serverUrl: 'http://x', runtimeId: 'r1' });
    const hack = c as unknown as {
      _nextReconnectDelayMs: () => number;
      _handlePong: () => void;
      _reconnectAttempt: number;
    };
    hack._nextReconnectDelayMs();
    hack._nextReconnectDelayMs();
    hack._nextReconnectDelayMs();
    expect(hack._reconnectAttempt).toBe(3);
    hack._handlePong();
    expect(hack._reconnectAttempt).toBe(0);
  });

  it('close() 主动关闭 → 档位归零（新生命周期从第 0 档起）', () => {
    const c = new WsClient({ serverUrl: 'http://x', runtimeId: 'r1' });
    const hack = c as unknown as {
      _nextReconnectDelayMs: () => number;
      _reconnectAttempt: number;
    };
    hack._nextReconnectDelayMs();
    hack._nextReconnectDelayMs();
    c.close();
    expect(hack._reconnectAttempt).toBe(0);
  });

  it('Server 主动 close → 第 0 档退避（1s，jitter 固定中值）后重连成功', async () => {
    const mock = await startMockServer();
    try {
      const onDisconnected = vi.fn();
      const onConnected = vi.fn();
      const c = new WsClient({
        serverUrl: mock.url.replace('ws://', 'http://'),
        runtimeId: 'r1',
        jitterFn: () => 0.5, // 第 0 档 = 1000ms 整
        callbacks: { onDisconnected, onConnected },
      });
      c.connect();
      await vi.waitFor(() => expect(c.isConnected).toBe(true));
      expect(onConnected).toHaveBeenCalledTimes(1);
      // Server 踢连接
      mock.conns[0]?.close(1000, 'test');
      await vi.waitFor(() => expect(onDisconnected).toHaveBeenCalledTimes(1));
      expect(c.state).toBe(WsState.Reconnecting);
      // 真实等待第 0 档 1s 退避 + 重连握手完成。不用 fake timers——connect() 内部
      // new WebSocket 的 TCP 握手是 libuv 异步 IO，fake timers 会冻结事件循环。
      await vi.waitFor(
        () => {
          expect(onConnected).toHaveBeenCalledTimes(2);
        },
        { timeout: 1_000 + 3_000, interval: 50 },
      );
      expect(c.isConnected).toBe(true);
      c.close();
    } finally {
      await new Promise<void>((r) => mock.server.close(() => r()));
    }
  }, 15_000);

  it('连续两次断线且无任何消息 → 第二次退避升到第 1 档（2s，jitter 固定中值）', async () => {
    const mock = await startMockServer();
    try {
      const onConnected = vi.fn();
      const c = new WsClient({
        serverUrl: mock.url.replace('ws://', 'http://'),
        runtimeId: 'r1',
        jitterFn: () => 0.5, // 档位基准值：第 0 档 1s、第 1 档 2s
        callbacks: { onConnected },
      });
      c.connect();
      await vi.waitFor(() => expect(c.isConnected).toBe(true));
      // 第一次断线（连接期间 server 不发任何消息 → 档位不被重置）。
      mock.conns[0]?.close(1000, 'test');
      await vi.waitFor(() => expect(onConnected).toHaveBeenCalledTimes(2), {
        timeout: 1_000 + 3_000,
        interval: 50,
      });
      // 第二次断线：无消息重置 → 退避应升到第 1 档（2s）。判据：1.3s 时（第 0
      // 档已过、第 1 档未到）仍未重连，2s+握手窗口后重连成功。
      const secondCloseAt = Date.now();
      mock.conns[1]?.close(1000, 'test');
      await new Promise((r) => setTimeout(r, 1_300));
      expect(onConnected).toHaveBeenCalledTimes(2); // 未在第 0 档（1s）内重连
      await vi.waitFor(() => expect(onConnected).toHaveBeenCalledTimes(3), {
        timeout: 2_000 + 3_000 - (Date.now() - secondCloseAt),
        interval: 50,
      });
      expect(c.isConnected).toBe(true);
      c.close();
    } finally {
      await new Promise<void>((r) => mock.server.close(() => r()));
    }
  }, 20_000);

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
      // 推进超过整条退避序列之和（含抖动上界）——主动关闭后任何档位都不重连。
      vi.advanceTimersByTime(
        RECONNECT_BACKOFF_SCHEDULE_MS.reduce((a, b) => a + b, 0) * 2,
      );
      expect(onConnected).toHaveBeenCalledTimes(1); // 未重连
      vi.useRealTimers();
    } finally {
      await new Promise<void>((r) => mock.server.close(() => r()));
    }
  });

  it('连接失败（端口无服务）→ 进入 Reconnecting（退避定时器已挂）', async () => {
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

// ── 2026-08-27 网络切换永久假连事故回归 ──────────────────────────────────────
//
// 事故链：旧 socket 迟到的 close 事件（无身份守卫）把 this._ws（已是重连后的
// 新 socket）抹成 null → 新连接 open 后 _startKeepalive 因 _ws=null 静默跳过
// → keepalive 丢失后网络切换的黑洞连接无 ping/pong 检测 → 状态卡 Connected、
// connect() 幂等保护令重连永不发生（HTTP 心跳照常，RPC 全 502）。
describe('WsClient — 网络切换假连回归（2026-08-27）', () => {
  it('旧 socket 迟到的 close 不抹掉新 socket：重连后 Connected/_ws 保持不变', async () => {
    const mock = await startMockServer();
    try {
      const onDisconnected = vi.fn();
      const c = new WsClient({
        serverUrl: mock.url.replace('ws://', 'http://'),
        runtimeId: 'r1',
        callbacks: { onDisconnected },
      });
      c.connect();
      await vi.waitFor(() => expect(c.isConnected).toBe(true));
      const stale = (c as unknown as { _ws: WebSocket })._ws;
      // 服务端异常断开（网络切换形态，1006 无关闭帧）→ 第 0 档退避（1s，jitter
      // 固定中值）后重连出新 socket（task-06 退避语义，原 5s 固定档已废）。
      mock.conns[0]?.terminate();
      await vi.waitFor(() => expect(c.state).toBe(WsState.Reconnecting), {
        timeout: 3_000,
      });
      await vi.waitFor(() => expect(c.isConnected).toBe(true), {
        timeout: 5_000,
        interval: 50,
      });
      const fresh = (c as unknown as { _ws: WebSocket })._ws;
      expect(fresh).not.toBe(stale); // 已换新 socket
      // 旧 socket 迟到的 close 事件（修复前：_handleClose 把 _ws 抹成 null +
      // 停 keepalive → 状态卡 Connected 永不重连；修复后：身份守卫忽略）
      stale.emit('close', 1000, Buffer.from('late'));
      expect((c as unknown as { _ws: WebSocket | null })._ws).toBe(fresh);
      expect(c.isConnected).toBe(true);
      expect(c.state).toBe(WsState.Connected);
      c.close();
    } finally {
      await new Promise<void>((r) => mock.server.close(() => r()));
    }
  }, 15_000);

  it('pong 刷新 lastMessageAt（传输级新鲜度，看门狗判据）+ connectedAt getter', async () => {
    const mock = await startMockServer();
    try {
      const c = new WsClient({
        serverUrl: mock.url.replace('ws://', 'http://'),
        runtimeId: 'r1',
      });
      expect(c.connectedAt).toBeNull(); // 未连接
      c.connect();
      await vi.waitFor(() => expect(c.isConnected).toBe(true));
      expect(c.connectedAt).not.toBeNull(); // open 即锚定
      expect(c.lastMessageAt).toBeNull(); // open 本身不算消息（既有语义保持）
      // 手动发一次 ping（不等 30s keepalive 周期）→ ws server 自动回 pong
      // → _handlePong 计入新鲜度（健康链路应用层空闲也不误判陈旧）。
      (c as unknown as { _ws: WebSocket })._ws.ping();
      await vi.waitFor(() => expect(c.lastMessageAt).not.toBeNull());
      c.close();
      expect(c.connectedAt).toBeNull(); // 主动关闭清锚点
    } finally {
      await new Promise<void>((r) => mock.server.close(() => r()));
    }
  });
});

describe('WsClient — 出站消息', () => {
  it('send() 在 Connected 时序列化 JSON 并发出', async () => {
    const mock = await startMockServer();
    try {
      const c = new WsClient({
        serverUrl: mock.url.replace('ws://', 'http://'),
        runtimeId: 'r1',
      });
      c.connect();
      await vi.waitFor(() => expect(c.isConnected).toBe(true));
      const ok = c.send({ type: MSG.HEARTBEAT_ACK, payload: { runtime_id: 'r1' } });
      expect(ok).toBe(true);
      await vi.waitFor(() => expect(mock.received.length).toBe(1));
      expect(mock.received[0]).toEqual({
        type: 'daemon:heartbeat_ack',
        payload: { runtime_id: 'r1' },
      });
      c.close();
    } finally {
      await new Promise<void>((r) => mock.server.close(() => r()));
    }
  });

  it('send() 未连接时返回 false，不抛', () => {
    const c = new WsClient({ serverUrl: 'http://x', runtimeId: 'r1' });
    expect(c.send({ type: MSG.HEARTBEAT_ACK, payload: {} })).toBe(false);
  });

  it('sendHeartbeatAck() 自动填 runtime_id', async () => {
    const mock = await startMockServer();
    try {
      const c = new WsClient({
        serverUrl: mock.url.replace('ws://', 'http://'),
        runtimeId: 'rid-42',
      });
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

describe('WsClient — 常量与设计对齐', () => {
  // task-06（design A1）：固定 5s（RECONNECT_INTERVAL_MS）已废，改退避档位序列。
  it('RECONNECT_BACKOFF_SCHEDULE_MS === [1,2,4,8,16,30]s（design A1 档位表）', () => {
    expect(RECONNECT_BACKOFF_SCHEDULE_MS).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 30_000,
    ]);
  });
  it('RECONNECT_JITTER_RATIO === 0.2（每档 ±20% 抖动）', () => {
    expect(RECONNECT_JITTER_RATIO).toBe(0.2);
  });
  it('CONNECT_TIMEOUT_MS === 10000（握手超时不动，task-06 constraints）', () => {
    expect(CONNECT_TIMEOUT_MS).toBe(10_000);
  });
});

// ── task-05：WS RPC 分发（daemon:rpc → handler → daemon:rpc_result）──────────
// 用例 T14~T21 对齐 task-05.md §7.2。rpc_id 由 backend 生成、daemon 透传。

describe('WsClient — RPC 分发（task-05）', () => {
  let mock: Awaited<ReturnType<typeof startMockServer>>;

  beforeEach(async () => {
    mock = await startMockServer();
  });
  afterEach(async () => {
    await new Promise<void>((r) => mock.server.close(() => r()));
  });

  /** 构造一个已连接的 WsClient 并返回（测试内自行 close）。 */
  async function connectClient(
    callbacks: { onError?: (e: Error) => void } = {},
  ): Promise<WsClient> {
    const c = new WsClient({
      serverUrl: mock.url.replace('ws://', 'http://'),
      runtimeId: 'r1',
      callbacks,
    });
    c.connect();
    await vi.waitFor(() => expect(c.isConnected).toBe(true));
    return c;
  }

  /** Server → Client 推一条 daemon:rpc。 */
  function pushRpc(
    rpcId: string,
    method: string,
    params: Record<string, unknown>,
  ): void {
    const ws = mock.conns[0];
    if (!ws) throw new Error('no active conn');
    ws.send(JSON.stringify({ type: MSG.RPC, payload: { rpc_id: rpcId, method, params } }));
  }

  it('T14: 注册 handler 并收到 daemon:rpc → 回 daemon:rpc_result（rpc_id 回填 + result 透传）', async () => {
    const c = await connectClient();
    const handler: RpcHandler = vi.fn(async () => ({ entries: [{ name: 'a', type: 'dir' }] }));
    c.registerRpcHandler('list_dir', handler);

    pushRpc('rpc-1', 'list_dir', { path: '/x' });
    await vi.waitFor(() => expect(mock.received.length).toBe(1));

    const out = mock.received[0] as { type: string; payload: Record<string, unknown> };
    expect(out.type).toBe(MSG.RPC_RESULT);
    expect(out.payload.rpc_id).toBe('rpc-1');
    expect(out.payload.result).toEqual({ entries: [{ name: 'a', type: 'dir' }] });
    expect(out.payload.error).toBeUndefined();
    expect(handler).toHaveBeenCalledWith({ path: '/x' });
    c.close();
  });

  it('T15: handler 抛 RpcError → RPC_RESULT.error.code 为该 code', async () => {
    const c = await connectClient();
    c.registerRpcHandler('list_dir', async () => {
      throw new RpcError('forbidden', 'path outside allowed_roots');
    });

    pushRpc('rpc-2', 'list_dir', { path: '/etc' });
    await vi.waitFor(() => expect(mock.received.length).toBe(1));
    const out = mock.received[0] as { payload: { error: { code: string; message: string } } };
    expect(out.payload.error.code).toBe('forbidden');
    expect(out.payload.error.message).toMatch(/outside allowed_roots/);
    c.close();
  });

  it('T16: handler 抛普通 Error → error.code="internal"', async () => {
    const c = await connectClient();
    c.registerRpcHandler('list_dir', async () => {
      throw new Error('boom');
    });

    pushRpc('rpc-3', 'list_dir', { path: '/x' });
    await vi.waitFor(() => expect(mock.received.length).toBe(1));
    const out = mock.received[0] as { payload: { error: { code: string; message: string } } };
    expect(out.payload.error.code).toBe('internal');
    expect(out.payload.error.message).toBe('boom');
    c.close();
  });

  it('T17: 未注册 method → error.code="method_not_found"', async () => {
    const c = await connectClient();
    pushRpc('rpc-4', 'read_file', { path: '/x' });
    await vi.waitFor(() => expect(mock.received.length).toBe(1));
    const out = mock.received[0] as { payload: { error: { code: string; message: string } } };
    expect(out.payload.error.code).toBe('method_not_found');
    expect(out.payload.error.message).toMatch(/read_file/);
    c.close();
  });

  it('T18: rpc_id 缺失 → 丢弃，不调 send，触发 onError warn', async () => {
    const onError = vi.fn();
    const c = await connectClient({ onError });
    const ws = mock.conns[0]!;
    // 无 rpc_id
    ws.send(JSON.stringify({ type: MSG.RPC, payload: { method: 'list_dir', params: {} } }));
    await new Promise((r) => setTimeout(r, 80));
    expect(mock.received.length).toBe(0);
    expect(onError).toHaveBeenCalled();
    c.close();
  });

  it('T19: handler 接收 params（含缺失 path 字段场景由业务层处理）', async () => {
    const c = await connectClient();
    const seen: Record<string, unknown>[] = [];
    c.registerRpcHandler('list_dir', async (params) => {
      seen.push(params);
      return { entries: [] };
    });
    pushRpc('rpc-5', 'list_dir', {}); // 无 path
    await vi.waitFor(() => expect(mock.received.length).toBe(1));
    expect(seen[0]).toEqual({});
    const out = mock.received[0] as { payload: { result: unknown } };
    expect(out.payload.result).toEqual({ entries: [] });
    c.close();
  });

  it('T20: 并发 2 条 RPC，各自回填对应 rpc_id（不阻塞）', async () => {
    const c = await connectClient();
    let resolveA!: () => void;
    let resolveB!: () => void;
    const pA = new Promise<void>((r) => (resolveA = r));
    const pB = new Promise<void>((r) => (resolveB = r));
    c.registerRpcHandler('list_dir', async (params) => {
      if (params.path === '/a') {
        await pA;
        return { entries: [{ name: 'a', type: 'dir' }] };
      }
      await pB;
      return { entries: [{ name: 'b', type: 'dir' }] };
    });

    pushRpc('rpc-a', 'list_dir', { path: '/a' });
    pushRpc('rpc-b', 'list_dir', { path: '/b' });
    await new Promise((r) => setTimeout(r, 30));
    // 两条都 inflight，尚未回发
    expect(mock.received.length).toBe(0);
    // 先放 B（验证不按发送顺序、各自独立）
    resolveB();
    await vi.waitFor(() => expect(mock.received.length).toBe(1));
    let outB = mock.received[0] as { payload: { rpc_id: string; result: unknown } };
    expect(outB.payload.rpc_id).toBe('rpc-b');
    resolveA();
    await vi.waitFor(() => expect(mock.received.length).toBe(2));
    const outA = mock.received[1] as { payload: { rpc_id: string; result: unknown } };
    expect(outA.payload.rpc_id).toBe('rpc-a');
    c.close();
  });

  it('T21: 同名 method 重复注册 → 后者生效，首次触发 onError warn', async () => {
    const onError = vi.fn();
    const c = await connectClient({ onError });
    const h1: RpcHandler = vi.fn(async () => ({ from: 'h1' }));
    const h2: RpcHandler = vi.fn(async () => ({ from: 'h2' }));
    c.registerRpcHandler('list_dir', h1);
    c.registerRpcHandler('list_dir', h2); // 触发 warn
    expect(onError).toHaveBeenCalledTimes(1);

    pushRpc('rpc-6', 'list_dir', { path: '/x' });
    await vi.waitFor(() => expect(mock.received.length).toBe(1));
    expect(h2).toHaveBeenCalledOnce();
    expect(h1).not.toHaveBeenCalled();
    const out = mock.received[0] as { payload: { result: { from: string } } };
    expect(out.payload.result.from).toBe('h2');
    c.close();
  });

  it('daemon:rpc 不进 onMessage（独立分支，不影响现有消息分发）', async () => {
    const onMessage = vi.fn();
    const c = new WsClient({
      serverUrl: mock.url.replace('ws://', 'http://'),
      runtimeId: 'r1',
      callbacks: { onMessage },
    });
    c.connect();
    await vi.waitFor(() => expect(c.isConnected).toBe(true));

    pushRpc('rpc-7', 'unknown_method', {});
    await vi.waitFor(() => expect(mock.received.length).toBe(1));
    // RPC 走独立分支，不调 onMessage
    expect(onMessage).not.toHaveBeenCalled();
    c.close();
  });

  it('RPC_RESULT 出站消息 type 字面量为 "daemon:rpc_result"', async () => {
    const c = await connectClient();
    c.registerRpcHandler('ping', async () => 'pong');
    pushRpc('rpc-8', 'ping', {});
    await vi.waitFor(() => expect(mock.received.length).toBe(1));
    const out = mock.received[0] as { type: string };
    expect(out.type).toBe('daemon:rpc_result');
    c.close();
  });
});

// keepalive（ping/pong）：npm ws 库默认不发 ping，经 docker NAT 的连接静止时
// 被中间网络层掐断（实测每 5-10min 一次），import 的 get_spec_bundle RPC 打包
// ~16s 无数据流动撞进断连窗口 → mid-rpc cancel（HTTP_504_DAEMON_RUNTIME_OFFLINE）。
// 周期 ping 保活 + pong 超时 terminate 让断连从「被动撞窗口」收敛到「主动检测重连」。
describe('WsClient — WS keepalive（ping/pong，防网络层 idle 断连）', () => {
  it('常量对齐：WS_PING_INTERVAL_MS=30000 / WS_PONG_TIMEOUT_MS=10000', () => {
    expect(WS_PING_INTERVAL_MS).toBe(30_000);
    expect(WS_PONG_TIMEOUT_MS).toBe(10_000);
  });

  it('_handleOpen 启动 keepalive（_pingTimer 非 null）；close() 清理', async () => {
    const mock = await startMockServer();
    try {
      const c = new WsClient({
        serverUrl: mock.url.replace('ws://', 'http://'),
        runtimeId: 'r1',
      });
      c.connect();
      await vi.waitFor(() => expect(c.isConnected).toBe(true));
      expect(
        (c as unknown as { _pingTimer: unknown })._pingTimer,
      ).not.toBeNull();
      c.close();
      expect(
        (c as unknown as { _pingTimer: unknown })._pingTimer,
      ).toBeNull();
    } finally {
      await new Promise<void>((r) => mock.server.close(() => r()));
    }
  });

  it('_sendPing 发 ping 后，pong 超时未收 → terminate', () => {
    const c = new WsClient({ serverUrl: 'http://x', runtimeId: 'r1' });
    let pingCalls = 0;
    let termCalls = 0;
    // 注入 fake _ws：可控 ping / terminate，绕过真实 server 自动回 pong。
    const fakeWs = {
      readyState: WebSocket.OPEN,
      ping: () => {
        pingCalls += 1;
      },
      terminate: () => {
        termCalls += 1;
      },
    };
    (c as unknown as { _ws: unknown })._ws = fakeWs;
    vi.useFakeTimers();
    try {
      (c as unknown as { _sendPing: () => void })._sendPing();
      expect(pingCalls).toBe(1);
      // 不触发 _handlePong → 推进 pong 超时，terminate 被调
      vi.advanceTimersByTime(WS_PONG_TIMEOUT_MS);
      expect(termCalls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('_sendPing 发 ping 后收到 _handlePong → pong 超时已清，不 terminate', () => {
    const c = new WsClient({ serverUrl: 'http://x', runtimeId: 'r1' });
    let termCalls = 0;
    const fakeWs = {
      readyState: WebSocket.OPEN,
      ping: () => undefined,
      terminate: () => {
        termCalls += 1;
      },
    };
    (c as unknown as { _ws: unknown })._ws = fakeWs;
    vi.useFakeTimers();
    try {
      (c as unknown as { _sendPing: () => void })._sendPing();
      (c as unknown as { _handlePong: () => void })._handlePong();
      vi.advanceTimersByTime(WS_PONG_TIMEOUT_MS + 1000);
      expect(termCalls).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('close() 清 _pingTimer 与 _pongTimer', async () => {
    const mock = await startMockServer();
    try {
      const c = new WsClient({
        serverUrl: mock.url.replace('ws://', 'http://'),
        runtimeId: 'r1',
      });
      c.connect();
      await vi.waitFor(() => expect(c.isConnected).toBe(true));
      const hack = c as unknown as {
        _pingTimer: NodeJS.Timeout | null;
        _pongTimer: NodeJS.Timeout | null;
      };
      // _startKeepalive 已设 _pingTimer；手动挂一个 _pongTimer 模拟刚发完 ping。
      expect(hack._pingTimer).not.toBeNull();
      hack._pongTimer = setTimeout(() => undefined, 10_000);
      c.close();
      expect(hack._pingTimer).toBeNull();
      expect(hack._pongTimer).toBeNull();
    } finally {
      await new Promise<void>((r) => mock.server.close(() => r()));
    }
  });
});
