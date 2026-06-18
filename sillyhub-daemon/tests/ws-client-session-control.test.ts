// tests/ws-client-session-control.test.ts
// task-04 Step 5：WsClient 把 SESSION_* 控制消息经 onMessage 透传给 daemon
// （daemon._handleWsMessage 内按 type 路由到 SessionManager）。
//
// 真实 WsClient 只有单个 onMessage 回调（无 onControlMessage）：
//   - MSG.RPC 走 _dispatchRpc 内部分支（不进 onMessage，task-05）
//   - 其余 type（TASK_AVAILABLE / HEARTBEAT_ACK / SESSION_INJECT / SESSION_INTERRUPT /
//     SESSION_END / PERMISSION_*）一律经 onMessage 透传，daemon 侧 switch 分发。
//
// 本测试断言：
//   - SESSION_INJECT/INTERRUPT/END 经 _handleMessage → onMessage 透传（payload 原样）
//   - RPC 消息不进 onMessage（保留 task-05 分支隔离）
//   - TASK_AVAILABLE 仍经 onMessage（回归）
//   - 非法 JSON / 缺 type 仍经 onError（回归）

import { describe, it, expect, beforeEach, vi } from 'vitest';
import WebSocket from 'ws';
import { MSG } from '../src/protocol.js';
import { WsClient } from '../src/ws-client.js';

// ── stub WebSocket：构造时即 open，_handleMessage 经 'message' 事件触发。 ──────
// 用 vi.fn 累积 'open'/'message' handler；_createSocket 注入 stub 后，
// WsClient.connect 会调 stub.on('open'/'message'/...) 注册 handler。

function makeFakeRaw(data: unknown): Buffer {
  return Buffer.from(JSON.stringify(data), 'utf8');
}

function createStubSocket(): {
  socket: Record<string, unknown>;
  emitOpen: () => void;
  emitMessage: (data: Buffer) => void;
} {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  const socket = {
    readyState: WebSocket.OPEN,
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      (handlers[event] ??= []).push(handler);
    }),
    close: vi.fn(() => {}),
    terminate: vi.fn(() => {}),
    send: vi.fn(() => {}),
  };
  return {
    socket,
    emitOpen: () => (handlers['open'] ?? []).forEach((h) => h()),
    emitMessage: (data: Buffer) =>
      (handlers['message'] ?? []).forEach((h) => h(data)),
  };
}

function buildClient(callbacks: {
  onMessage?: (msg: { type: string; payload: unknown }) => void;
  onError?: (err: Error) => void;
}): { client: WsClient; emitMessage: (data: Buffer) => void; emitOpen: () => void } {
  const stub = createStubSocket();
  const client = new WsClient({
    serverUrl: 'http://test:8000',
    runtimeId: 'rt-1',
    callbacks,
  });
  (client as unknown as { _createSocket: () => unknown })._createSocket = () =>
    stub.socket;
  client.connect();
  return { client, emitMessage: stub.emitMessage, emitOpen: stub.emitOpen };
}

describe('WsClient SESSION_* 控制消息透传（task-04）', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('SESSION_INJECT 经 onMessage 透传（payload 原样）', async () => {
    const onMessage = vi.fn();
    const { emitMessage, emitOpen } = buildClient({ onMessage });
    emitOpen();
    await new Promise((r) => setTimeout(r, 5));

    const payload = {
      session_id: 'sess-1',
      lease_id: 'lease-1',
      run_id: 'run-2',
      prompt: 'hi',
    };
    emitMessage(makeFakeRaw({ type: MSG.SESSION_INJECT, payload }));

    expect(onMessage).toHaveBeenCalledOnce();
    const msg = onMessage.mock.calls[0]![0];
    expect(msg.type).toBe(MSG.SESSION_INJECT);
    expect(msg.payload).toEqual(payload);
  });

  it('SESSION_INTERRUPT 经 onMessage 透传', async () => {
    const onMessage = vi.fn();
    const { emitMessage, emitOpen } = buildClient({ onMessage });
    emitOpen();
    await new Promise((r) => setTimeout(r, 5));

    emitMessage(
      makeFakeRaw({
        type: MSG.SESSION_INTERRUPT,
        payload: { session_id: 's', lease_id: 'l' },
      }),
    );
    expect(onMessage).toHaveBeenCalledOnce();
    expect(onMessage.mock.calls[0]![0].type).toBe(MSG.SESSION_INTERRUPT);
  });

  it('SESSION_END 经 onMessage 透传', async () => {
    const onMessage = vi.fn();
    const { emitMessage, emitOpen } = buildClient({ onMessage });
    emitOpen();
    await new Promise((r) => setTimeout(r, 5));

    emitMessage(
      makeFakeRaw({
        type: MSG.SESSION_END,
        payload: { session_id: 's', lease_id: 'l' },
      }),
    );
    expect(onMessage).toHaveBeenCalledOnce();
    expect(onMessage.mock.calls[0]![0].type).toBe(MSG.SESSION_END);
  });

  it('PERMISSION_REQUEST / PERMISSION_RESPONSE 经 onMessage 透传（task-08 用）', async () => {
    const onMessage = vi.fn();
    const { emitMessage, emitOpen } = buildClient({ onMessage });
    emitOpen();
    await new Promise((r) => setTimeout(r, 5));

    emitMessage(makeFakeRaw({ type: MSG.PERMISSION_REQUEST, payload: { a: 1 } }));
    emitMessage(makeFakeRaw({ type: MSG.PERMISSION_RESPONSE, payload: { b: 2 } }));
    expect(onMessage).toHaveBeenCalledTimes(2);
  });

  it('RPC 消息不进 onMessage（保留 task-05 隔离分支）', async () => {
    const onMessage = vi.fn();
    const { emitMessage, emitOpen } = buildClient({ onMessage });
    emitOpen();
    await new Promise((r) => setTimeout(r, 5));

    emitMessage(
      makeFakeRaw({
        type: MSG.RPC,
        payload: { rpc_id: 'r1', method: 'list_dir', params: {} },
      }),
    );
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('TASK_AVAILABLE 仍经 onMessage（回归）', async () => {
    const onMessage = vi.fn();
    const { emitMessage, emitOpen } = buildClient({ onMessage });
    emitOpen();
    await new Promise((r) => setTimeout(r, 5));

    emitMessage(
      makeFakeRaw({
        type: MSG.TASK_AVAILABLE,
        payload: { leaseId: 'l1' },
      }),
    );
    expect(onMessage).toHaveBeenCalledOnce();
    expect(onMessage.mock.calls[0]![0].type).toBe(MSG.TASK_AVAILABLE);
  });

  it('非法 JSON → onError，不进 onMessage（回归）', async () => {
    const onMessage = vi.fn();
    const onError = vi.fn();
    const { emitMessage, emitOpen } = buildClient({ onMessage, onError });
    emitOpen();
    await new Promise((r) => setTimeout(r, 5));

    emitMessage(Buffer.from('not-json{', 'utf8'));
    expect(onMessage).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
  });

  it('缺 type 字段 → onError，不进 onMessage（回归）', async () => {
    const onMessage = vi.fn();
    const onError = vi.fn();
    const { emitMessage, emitOpen } = buildClient({ onMessage, onError });
    emitOpen();
    await new Promise((r) => setTimeout(r, 5));

    emitMessage(makeFakeRaw({ payload: {} }));
    expect(onMessage).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
  });
});
