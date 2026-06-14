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
  RECONNECT_INTERVAL_MS,
  CONNECT_TIMEOUT_MS,
} from '../src/ws-client.js';
import { MSG, WS_PATH } from '../src/protocol.js';

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
    server.on('connection', (ws) => {
      conns.push(ws);
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
      resolve({ server, url: `ws://127.0.0.1:${addr.port}`, received, conns });
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
      `ws://hub.example.com:8000${WS_PATH}?runtime_id=r1`,
    );
  });
  it('https:// → wss://', () => {
    const c = new WsClient({ serverUrl: 'https://hub.example.com', runtimeId: 'r2' });
    expect((c as unknown as { _buildWsUrl: () => string })._buildWsUrl()).toBe(
      `wss://hub.example.com${WS_PATH}?runtime_id=r2`,
    );
  });
  it('末尾斜杠被 rstrip', () => {
    const c = new WsClient({
      serverUrl: 'http://localhost:8000///',
      runtimeId: 'r3',
    });
    expect((c as unknown as { _buildWsUrl: () => string })._buildWsUrl()).toBe(
      `ws://localhost:8000${WS_PATH}?runtime_id=r3`,
    );
  });
  it('runtime_id 被 encodeURIComponent', () => {
    const c = new WsClient({ serverUrl: 'http://x', runtimeId: 'a b/c' });
    expect((c as unknown as { _buildWsUrl: () => string })._buildWsUrl()).toContain(
      'runtime_id=a%20b%2Fc',
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
      // 真实等待 5s 退避 + 重连握手完成（RECONNECT_INTERVAL_MS=5000）。
      // 不用 fake timers——connect() 内部 new WebSocket 的 TCP 握手是 libuv 异步 IO，
      // fake timers 会冻结事件循环导致握手回调不触发。
      await vi.waitFor(
        () => {
          expect(onConnected).toHaveBeenCalledTimes(2);
        },
        { timeout: RECONNECT_INTERVAL_MS + 3_000, interval: 100 },
      );
      expect(c.isConnected).toBe(true);
      c.close();
    } finally {
      await new Promise<void>((r) => mock.server.close(() => r()));
    }
  }, 15_000);

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

describe('WsClient — 常量与 Python 对齐', () => {
  it('RECONNECT_INTERVAL_MS === 5000（FR-03 / design §9）', () => {
    expect(RECONNECT_INTERVAL_MS).toBe(5_000);
  });
  it('CONNECT_TIMEOUT_MS === 10000（Python open_timeout=10）', () => {
    expect(CONNECT_TIMEOUT_MS).toBe(10_000);
  });
});
