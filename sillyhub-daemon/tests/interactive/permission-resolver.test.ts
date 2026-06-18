// tests/interactive/permission-resolver.test.ts
// task-08 Step 1：daemon PermissionResolver（canUseTool 远程人审 pending 注册表）。
//
// 依据：task-08 §4.1 + §5 边界 1/2/3/4/5/7/8/9/10/11/12。
// SDK/WS 一律 mock；时间用 vi.useFakeTimers 推进 5min 兜底定时器。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  PermissionResolver,
  PERMISSION_FALLBACK_TIMEOUT_MS,
} from '../../src/interactive/permission-resolver.js';
import { MSG } from '../../src/protocol.js';

const SESSION_ID = 'sess-1';
const RUN_ID = 'run-1';

function makeSend(returns: boolean = true) {
  return vi.fn((_msg: { type: string; payload: unknown }) => returns);
}

describe('PermissionResolver.register', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('返回 uuid v4 格式 requestId + pending Promise；send 调一次且 payload 正确', () => {
    const resolver = new PermissionResolver();
    const send = makeSend(true);
    const { requestId, promise } = resolver.register({
      sessionId: SESSION_ID,
      runId: RUN_ID,
      toolName: 'Bash',
      toolInput: { command: 'ls' },
      send,
    });

    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(send).toHaveBeenCalledTimes(1);
    const msg = send.mock.calls[0]![0];
    expect(msg.type).toBe(MSG.PERMISSION_REQUEST);
    expect(msg.payload).toMatchObject({
      session_id: SESSION_ID,
      run_id: RUN_ID,
      request_id: requestId,
      tool_name: 'Bash',
      input: { command: 'ls' },
    });
    // pending Promise 未 settle
    let settled = false;
    void promise.then(() => {
      settled = true;
    });
    // 推进 1ms 让 microtask 跑——promise 应仍 pending（未推进到超时）
    vi.advanceTimersByTime(1);
    expect(settled).toBe(false);
    expect(resolver.pendingCount).toBe(1);
  });

  it('两次 register 生成不同 requestId', () => {
    const resolver = new PermissionResolver();
    const send = makeSend(true);
    const a = resolver.register({
      sessionId: SESSION_ID,
      runId: RUN_ID,
      toolName: 'A',
      toolInput: {},
      send,
    });
    const b = resolver.register({
      sessionId: SESSION_ID,
      runId: RUN_ID,
      toolName: 'B',
      toolInput: {},
      send,
    });
    expect(a.requestId).not.toBe(b.requestId);
    expect(resolver.pendingCount).toBe(2);
  });

  it('send 返回 false → promise 立即 settle deny（fail-closed）；pending 不残留', async () => {
    const resolver = new PermissionResolver();
    const send = makeSend(false);
    const { promise } = resolver.register({
      sessionId: SESSION_ID,
      runId: RUN_ID,
      toolName: 'Bash',
      toolInput: {},
      send,
    });
    await vi.advanceTimersByTimeAsync(0); // microtask flush
    const decision = await promise;
    expect(decision.behavior).toBe('deny');
    expect(resolver.pendingCount).toBe(0);
  });
});

describe('PermissionResolver.resolve', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('合法 allow payload → promise settle allow；pending 清空', async () => {
    const resolver = new PermissionResolver();
    const send = makeSend(true);
    const { requestId, promise } = resolver.register({
      sessionId: SESSION_ID,
      runId: RUN_ID,
      toolName: 'Bash',
      toolInput: {},
      send,
    });
    const result = resolver.resolve(
      {
        session_id: SESSION_ID,
        request_id: requestId,
        decision: 'allow',
      },
      SESSION_ID,
    );
    expect(result).toBe('resolved');
    const decision = await promise;
    expect(decision).toEqual({ behavior: 'allow' });
    expect(resolver.pendingCount).toBe(0);
  });

  it('deny + message → promise settle deny with message', async () => {
    const resolver = new PermissionResolver();
    const send = makeSend(true);
    const { requestId, promise } = resolver.register({
      sessionId: SESSION_ID,
      runId: RUN_ID,
      toolName: 'Write',
      toolInput: {},
      send,
    });
    resolver.resolve(
      {
        session_id: SESSION_ID,
        request_id: requestId,
        decision: 'deny',
        message: 'user rejected',
      },
      SESSION_ID,
    );
    const decision = await promise;
    expect(decision).toEqual({
      behavior: 'deny',
      message: 'user rejected',
    });
  });

  it('重复 resolve → 第二次返回 unknown_request（只 settle 一次）', async () => {
    const resolver = new PermissionResolver();
    const send = makeSend(true);
    const { requestId, promise } = resolver.register({
      sessionId: SESSION_ID,
      runId: RUN_ID,
      toolName: 'Bash',
      toolInput: {},
      send,
    });
    const first = resolver.resolve(
      { session_id: SESSION_ID, request_id: requestId, decision: 'allow' },
      SESSION_ID,
    );
    const second = resolver.resolve(
      { session_id: SESSION_ID, request_id: requestId, decision: 'deny' },
      SESSION_ID,
    );
    expect(first).toBe('resolved');
    expect(second).toBe('unknown_request');
    const decision = await promise;
    expect(decision.behavior).toBe('allow'); // 第一次生效
  });

  it('session_id 不匹配 → session_mismatch；entry 不消费', () => {
    const resolver = new PermissionResolver();
    const send = makeSend(true);
    const { requestId } = resolver.register({
      sessionId: SESSION_ID,
      runId: RUN_ID,
      toolName: 'Bash',
      toolInput: {},
      send,
    });
    const result = resolver.resolve(
      {
        session_id: 'other-session',
        request_id: requestId,
        decision: 'allow',
      },
      SESSION_ID,
    );
    expect(result).toBe('session_mismatch');
    expect(resolver.pendingCount).toBe(1); // 仍 pending
  });

  it('未知 request_id → unknown_request', () => {
    const resolver = new PermissionResolver();
    const result = resolver.resolve(
      {
        session_id: SESSION_ID,
        request_id: 'never-registered',
        decision: 'allow',
      },
      SESSION_ID,
    );
    expect(result).toBe('unknown_request');
  });
});

describe('PermissionResolver.abortAll', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('所有未决 promise settle deny with reason；清空；幂等', async () => {
    const resolver = new PermissionResolver();
    const send = makeSend(true);
    const a = resolver.register({
      sessionId: SESSION_ID,
      runId: RUN_ID,
      toolName: 'A',
      toolInput: {},
      send,
    });
    const b = resolver.register({
      sessionId: SESSION_ID,
      runId: RUN_ID,
      toolName: 'B',
      toolInput: {},
      send,
    });
    const count = resolver.abortAll('session_ended');
    expect(count).toBe(2);
    await vi.advanceTimersByTimeAsync(0);
    const [da, db] = await Promise.all([a.promise, b.promise]);
    expect(da.behavior).toBe('deny');
    expect(db.behavior).toBe('deny');
    expect(resolver.pendingCount).toBe(0);

    // 幂等
    const count2 = resolver.abortAll('again');
    expect(count2).toBe(0);
  });

  it('abortAll 后定时器已清（推进到原超时点不再有副作用）', () => {
    const resolver = new PermissionResolver();
    const send = makeSend(true);
    resolver.register({
      sessionId: SESSION_ID,
      runId: RUN_ID,
      toolName: 'A',
      toolInput: {},
      send,
    });
    resolver.abortAll('done');
    // 推进到 5min+ 后不应抛错（定时器已被 clearTimeout）
    expect(() =>
      vi.advanceTimersByTime(PERMISSION_FALLBACK_TIMEOUT_MS + 1000),
    ).not.toThrow();
  });
});

describe('PermissionResolver AbortSignal 透传', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('signal 已 aborted → register 立即 deny', async () => {
    const resolver = new PermissionResolver();
    const send = makeSend(true);
    const ac = new AbortController();
    ac.abort();
    const { promise } = resolver.register({
      sessionId: SESSION_ID,
      runId: RUN_ID,
      toolName: 'Bash',
      toolInput: {},
      signal: ac.signal,
      send,
    });
    await vi.advanceTimersByTimeAsync(0);
    const decision = await promise;
    expect(decision.behavior).toBe('deny');
    expect(resolver.pendingCount).toBe(0);
  });

  it('signal 后续 abort → 立即 deny + listener 移除（entry 清理）', async () => {
    const resolver = new PermissionResolver();
    const send = makeSend(true);
    const ac = new AbortController();
    const { promise } = resolver.register({
      sessionId: SESSION_ID,
      runId: RUN_ID,
      toolName: 'Bash',
      toolInput: {},
      signal: ac.signal,
      send,
    });
    expect(resolver.pendingCount).toBe(1);
    ac.abort('interrupt');
    await vi.advanceTimersByTimeAsync(0);
    const decision = await promise;
    expect(decision.behavior).toBe('deny');
    expect(resolver.pendingCount).toBe(0);
  });
});

describe('PermissionResolver 5min 兜底定时器（AC-08.4 daemon 双保险）', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('推进到 PERMISSION_FALLBACK_TIMEOUT_MS → promise settle deny + 清理', async () => {
    const resolver = new PermissionResolver();
    const send = makeSend(true);
    const { promise } = resolver.register({
      sessionId: SESSION_ID,
      runId: RUN_ID,
      toolName: 'Bash',
      toolInput: {},
      send,
    });
    // 推进 5min+5s 容差
    await vi.advanceTimersByTimeAsync(PERMISSION_FALLBACK_TIMEOUT_MS);
    const decision = await promise;
    expect(decision.behavior).toBe('deny');
    expect(resolver.pendingCount).toBe(0);
  });

  it('backend response 在兜底定时器前到达 → settle allow；定时器被清', async () => {
    const resolver = new PermissionResolver();
    const send = makeSend(true);
    const { requestId, promise } = resolver.register({
      sessionId: SESSION_ID,
      runId: RUN_ID,
      toolName: 'Bash',
      toolInput: {},
      send,
    });
    // 推进到一半，backend 仍 allow
    await vi.advanceTimersByTimeAsync(60_000);
    resolver.resolve(
      { session_id: SESSION_ID, request_id: requestId, decision: 'allow' },
      SESSION_ID,
    );
    const decision = await promise;
    expect(decision.behavior).toBe('allow');
    // 再推进到原超时点，不应抛错（定时器已清）
    expect(() =>
      vi.advanceTimersByTime(PERMISSION_FALLBACK_TIMEOUT_MS),
    ).not.toThrow();
  });
});

describe('PermissionResolver 并发多 entry 互不影响（AC-08.6）', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('三个 entry，分别 allow/deny/abortAll，互不影响', async () => {
    const resolver = new PermissionResolver();
    const send = makeSend(true);
    const a = resolver.register({
      sessionId: SESSION_ID,
      runId: RUN_ID,
      toolName: 'A',
      toolInput: {},
      send,
    });
    const b = resolver.register({
      sessionId: SESSION_ID,
      runId: RUN_ID,
      toolName: 'B',
      toolInput: {},
      send,
    });
    const c = resolver.register({
      sessionId: SESSION_ID,
      runId: RUN_ID,
      toolName: 'C',
      toolInput: {},
      send,
    });
    resolver.resolve(
      { session_id: SESSION_ID, request_id: a.requestId, decision: 'allow' },
      SESSION_ID,
    );
    resolver.resolve(
      {
        session_id: SESSION_ID,
        request_id: b.requestId,
        decision: 'deny',
        message: 'no',
      },
      SESSION_ID,
    );
    // c 不动 → abortAll
    resolver.abortAll('turn_done');

    const [da, db, dc] = await Promise.all([a.promise, b.promise, c.promise]);
    expect(da.behavior).toBe('allow');
    expect(db.behavior).toBe('deny');
    expect(dc.behavior).toBe('deny');
  });
});
