// tests/interactive/session-manager-pending-cleanup.test.ts
// task-09 Step 2：pending 审批退出清理矩阵（FR-07 收敛 / D-007@v1 / AC-09.3~09.6）。
//
// 覆盖 task-09 §5 边界 3/4/5/8：
//   - pending 时 interrupt → cancelAllPending('interrupted')，reject 全部，pendingCount 归零；
//   - pending 时 end → cancelAllPending('ended')，status=ended；
//   - pending 时 fail / onError → cancelAllPending('failed')；
//   - consume for-await 自然结束 → 兜底 cancelAllPending；
//   - cancel 幂等：同 requestId reject 两次不抛；cancelAllPending 后 pendingCount=0；
//   - 多 pending（乱序）一次性 reject；
//   - registry 按 session 隔离：A session 的 cancel 不影响 B session 的 pending。
//
// 重点：SessionManager 的终态路径必须触发 resolver.abortAll，让 SDK canUseTool 回调
// 收到 deny 后退出 await（无 zombie promise）。

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  Query,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { SessionManager } from '../../src/interactive/session-manager.js';
import { PermissionResolver } from '../../src/interactive/permission-resolver.js';
import type {
  ClaudeSdkDriver,
  ConsumeCallbacks,
  StartOptions,
} from '../../src/interactive/claude-sdk-driver.js';

// ── 辅助构造 ─────────────────────────────────────────────────────────────────

function resultInterrupt(): SDKResultMessage {
  return {
    type: 'result',
    subtype: 'error_during_execution',
    is_error: true,
    result: 'interrupted',
    num_turns: 1,
    duration_ms: 1,
    duration_api_ms: 1,
    stop_reason: null,
    total_cost_usd: 0,
    usage: {
      input_tokens: 1,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    modelUsage: {},
    permission_denials: [],
    session_id: 'sdk-sess',
    uuid: 'r-int',
  } as unknown as SDKResultMessage;
}

function resultSuccess(): SDKResultMessage {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'ok',
    num_turns: 1,
    duration_ms: 1,
    duration_api_ms: 1,
    stop_reason: 'end_turn',
    total_cost_usd: 0,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    modelUsage: {},
    permission_denials: [],
    session_id: 'sdk-sess',
    uuid: 'r1',
  } as unknown as SDKResultMessage;
}

interface CapturedDriver {
  driver: ClaudeSdkDriver;
  capturedOptions: StartOptions | null;
  capturedCallbacks: ConsumeCallbacks | null;
  fakeQuery: Query;
  emitResult: (r: SDKResultMessage) => void;
}

function makeMockDriver(): CapturedDriver {
  let capturedOptions: StartOptions | null = null;
  let capturedCallbacks: ConsumeCallbacks | null = null;
  const fakeQuery = { interrupt: vi.fn(async () => {}) } as unknown as Query;
  const driver: ClaudeSdkDriver = {
    start: vi.fn(
      (_input: AsyncIterable<SDKUserMessage>, opts: StartOptions): Query => {
        capturedOptions = opts;
        return fakeQuery;
      },
    ),
    consume: vi.fn(async (_q: Query, cb: ConsumeCallbacks): Promise<void> => {
      capturedCallbacks = cb;
    }),
    interrupt: vi.fn(async (q: Query | null): Promise<boolean> => {
      if (!q) return false;
      await (q.interrupt as () => Promise<void>)();
      return true;
    }),
  } as unknown as ClaudeSdkDriver;
  return {
    driver,
    fakeQuery,
    get capturedOptions() {
      return capturedOptions;
    },
    get capturedCallbacks() {
      return capturedCallbacks;
    },
    emitResult: (r) => capturedCallbacks?.onResult(r),
  };
}

function makeDeps() {
  return {
    onTurnResult: vi.fn(async () => {}),
    onTurnMessage: vi.fn(async () => {}),
    onSessionEnd: vi.fn(async () => {}),
  };
}

function makeWsClient() {
  return {
    send: vi.fn((_msg: { type: string; payload: unknown }) => true),
  };
}

function baseInput(sessionId: string, runId: string) {
  return {
    sessionId,
    leaseId: `lease-${sessionId}`,
    firstPrompt: 'hi',
    firstRunId: runId,
    cwd: 'C:\\work',
    provider: 'claude' as const,
    pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe',
  };
}

function makeManualSession(d: CapturedDriver, sessionId: string, runId: string) {
  const wsClient = makeWsClient();
  const resolver = new PermissionResolver();
  const sm = new SessionManager(
    { driver: d.driver, ...makeDeps() },
    {
      manualApproval: true,
      permissionResolver: resolver,
      permissionWsClient: wsClient,
    },
  );
  return { sm, wsClient, resolver, input: baseInput(sessionId, runId) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── 测试 ─────────────────────────────────────────────────────────────────────

describe('PermissionResolver.cancelAllPending 幂等 + pendingCount（AC-09.6）', () => {
  it('空 registry abortAll 返回 0 不抛', () => {
    const r = new PermissionResolver();
    expect(r.abortAll('ended')).toBe(0);
    expect(r.pendingCount).toBe(0);
  });

  it('cancel 幂等：同 requestId 多次 abortAll 不抛，pendingCount 归零', async () => {
    const r = new PermissionResolver();
    const send = vi.fn(() => true);
    const { promise, requestId } = r.register({
      sessionId: 's',
      runId: 'r',
      toolName: 'Write',
      toolInput: { path: '/x' },
      send,
    });
    expect(r.pendingCount).toBe(1);
    // 多次 abortAll 幂等。
    expect(r.abortAll('ended')).toBe(1);
    expect(r.abortAll('ended')).toBe(0); // 已 settle 不计。
    expect(r.abortAll('failed')).toBe(0);
    expect(r.pendingCount).toBe(0);
    // promise 只 settle 一次（deny）。
    const decision = await promise;
    expect(decision.behavior).toBe('deny');
    expect(typeof decision.message).toBe('string');
    void requestId;
  });
});

describe('pending 审批时 interrupt → cancelAllPending（AC-09.3 / 边界 3）', () => {
  it('interrupt 触发 resolver.abortAll("session_interrupted")；pending 回调 deny；pendingCount 归零', async () => {
    const d = makeMockDriver();
    const { sm, wsClient, resolver } = makeManualSession(d, 's1', 'r1');
    await sm.create(baseInput('s1', 'r1'));
    const canUseTool = d.capturedOptions!.canUseTool!;
    // 触发一个 pending 审批（不 resolve，模拟在途）。
    const pending = canUseTool('Bash', { command: 'ls' });
    expect(resolver.pendingCount).toBe(1);

    const interrupted = await sm.interrupt('s1');
    expect(interrupted).toBe(true);
    // resolver.abortAll 被调（interrupt 路径）。
    expect(resolver.pendingCount).toBe(0);

    // pending 回调收到 deny（让 SDK 退出 await，无 zombie）。
    const decision = (await pending) as { behavior: string; message?: string };
    expect(decision.behavior).toBe('deny');
    expect(typeof decision.message).toBe('string');
  });

  it('interrupt 后 SDK 产 result subtype=error_during_execution → onResult 标 run failed，session 回 active', async () => {
    const d = makeMockDriver();
    const deps = makeDeps();
    const wsClient = makeWsClient();
    const resolver = new PermissionResolver();
    const sm = new SessionManager(
      { driver: d.driver, ...deps },
      { manualApproval: true, permissionResolver: resolver, permissionWsClient: wsClient },
    );
    await sm.create(baseInput('s1', 'r1'));
    // pending 审批在途。
    void d.capturedOptions!.canUseTool!('Bash', { command: 'ls' });
    await sm.interrupt('s1');
    // SDK 吐 interrupt result（spike D1）。
    d.emitResult(resultInterrupt());
    // onTurnResult 被调一次（backend 据 is_error 标 failed/interrupted）。
    expect(deps.onTurnResult).toHaveBeenCalledTimes(1);
    // session 回 active（turn 边界已落，spike D1 可续轮）。
    expect(sm.get('s1')!.status).toBe('active');
    // resolver 已清空（pendingCount=0）。
    expect(resolver.pendingCount).toBe(0);
  });
});

describe('pending 审批时 end → cancelAllPending（AC-09.4 / 边界 4）', () => {
  it('end 触发 resolver.abortAll("session_ended")；status=ended；resolver 移除', async () => {
    const d = makeMockDriver();
    const { sm, resolver } = makeManualSession(d, 's1', 'r1');
    await sm.create(baseInput('s1', 'r1'));
    // pending 在途。
    void d.capturedOptions!.canUseTool!('Write', { path: '/x' });
    expect(resolver.pendingCount).toBe(1);

    await sm.end('s1');
    expect(sm.get('s1')!.status).toBe('ended');
    // resolver 从 map 移除（session 已不可 inject）。
    expect(sm.getPermissionResolver('s1')).toBeUndefined();
    // pending 已 reject。
    expect(resolver.pendingCount).toBe(0);
  });

  it('end 后迟到的 permission_response 返回 session_mismatch/unknown（不二次 resolve）', async () => {
    const d = makeMockDriver();
    const wsClient = makeWsClient();
    const resolver = new PermissionResolver();
    const sm = new SessionManager(
      { driver: d.driver, ...makeDeps() },
      { manualApproval: true, permissionResolver: resolver, permissionWsClient: wsClient },
    );
    await sm.create(baseInput('s1', 'r1'));
    const sendCalls = wsClient.send.mock.calls;
    void d.capturedOptions!.canUseTool!('Write', { path: '/x' });
    const requestId = (sendCalls[0]![0].payload as { request_id: string }).request_id;
    await sm.end('s1');
    // resolver 已被 SessionManager 从 _resolversBySession 移除 → getPermissionResolver 返回 undefined。
    expect(sm.getPermissionResolver('s1')).toBeUndefined();
    // 直接对原 resolver 调 resolve（模拟迟到消息）：resolver 内该 requestId 已被 abortAll settle
    //（_settle 幂等）→ 返回 unknown_request（已从 Map 删除）。
    const r2 = resolver.resolve(
      { session_id: 's1', request_id: requestId, decision: 'allow' },
      's1',
    );
    expect(r2).toBe('unknown_request');
  });
});

describe('pending 审批时 fail / onError → cancelAllPending（AC-09.5 / 边界 5）', () => {
  it('fail 触发 resolver.abortAll("session_failed")；status=failed', async () => {
    const d = makeMockDriver();
    const { sm, resolver } = makeManualSession(d, 's1', 'r1');
    await sm.create(baseInput('s1', 'r1'));
    void d.capturedOptions!.canUseTool!('Write', { path: '/x' });
    expect(resolver.pendingCount).toBe(1);

    await sm.fail('s1');
    expect(sm.get('s1')!.status).toBe('failed');
    expect(sm.getPermissionResolver('s1')).toBeUndefined();
    expect(resolver.pendingCount).toBe(0);
  });

  it('driver.consume onError → fail → resolver.abortAll("session_failed")', async () => {
    const d = makeMockDriver();
    const deps = makeDeps();
    const wsClient = makeWsClient();
    const resolver = new PermissionResolver();
    const sm = new SessionManager(
      { driver: d.driver, ...deps },
      { manualApproval: true, permissionResolver: resolver, permissionWsClient: wsClient },
    );
    await sm.create(baseInput('s1', 'r1'));
    void d.capturedOptions!.canUseTool!('Write', { path: '/x' });
    expect(resolver.pendingCount).toBe(1);

    // 模拟 consume 内 onError 回调（query 异常）。
    await d.capturedCallbacks!.onError(new Error('spawn failed'));
    // 给 fail 的 microtask 一个 tick。
    await Promise.resolve();
    await Promise.resolve();
    expect(sm.get('s1')!.status).toBe('failed');
    expect(resolver.pendingCount).toBe(0);
  });
});

describe('pending 审批多并发 + 乱序到达（AC-09.6 / 边界 8）', () => {
  it('同 turn 多 pending（多工具并发审批）各自独立 resolve；cancelAllPending 一次性 reject 全部', async () => {
    const d = makeMockDriver();
    const { sm, wsClient, resolver } = makeManualSession(d, 's1', 'r1');
    await sm.create(baseInput('s1', 'r1'));
    const canUseTool = d.capturedOptions!.canUseTool!;
    const p1 = canUseTool('Bash', { command: 'ls' });
    const p2 = canUseTool('Write', { path: '/a' });
    const p3 = canUseTool('Read', { path: '/b' });
    expect(resolver.pendingCount).toBe(3);

    // 乱序 resolve：p2 先 allow，p1 后 deny，p3 不动。
    const rid2 = (wsClient.send.mock.calls[1]![0].payload as { request_id: string }).request_id;
    const rid1 = (wsClient.send.mock.calls[0]![0].payload as { request_id: string }).request_id;
    resolver.resolve(
      { session_id: 's1', request_id: rid2, decision: 'allow' },
      's1',
    );
    resolver.resolve(
      { session_id: 's1', request_id: rid1, decision: 'deny', message: 'no' },
      's1',
    );
    // p3 仍 pending。
    expect(resolver.pendingCount).toBe(1);

    const d1 = (await p1) as { behavior: string };
    const d2 = (await p2) as { behavior: string };
    expect(d1.behavior).toBe('deny');
    expect(d2.behavior).toBe('allow');

    // cancelAllPending 一次性 reject 剩余（p3）。
    expect(resolver.abortAll('ended')).toBe(1);
    expect(resolver.pendingCount).toBe(0);
    const d3 = (await p3) as { behavior: string };
    expect(d3.behavior).toBe('deny');
  });
});

describe('registry 按 session 隔离（AC-09.6 / 边界 8 后半）', () => {
  it('A session 的 cancel 不影响 B session 的 pending', async () => {
    const d = makeMockDriver();
    const wsClient = makeWsClient();
    // 两个 session 共享同一个 resolver（单例，便于观察）——
    // 但生产路径每个 session 一个 resolver。这里用两个独立 resolver 验证隔离。
    const resolverA = new PermissionResolver();
    const resolverB = new PermissionResolver();
    // 构造两个 SessionManager 实例（模拟多 session 各自独立 resolver）。
    const smA = new SessionManager(
      { driver: d.driver, ...makeDeps() },
      { manualApproval: true, permissionResolver: resolverA, permissionWsClient: wsClient },
    );
    const smB = new SessionManager(
      { driver: d.driver, ...makeDeps() },
      { manualApproval: true, permissionResolver: resolverB, permissionWsClient: wsClient },
    );
    await smA.create(baseInput('A', 'rA'));
    await smB.create(baseInput('B', 'rB'));
    const canUseA = (d.capturedOptions as unknown as StartOptions[] | StartOptions);
    // makeMockDriver 只保留最后一次 capturedOptions，故直接用各 sm 的 resolver.register 验证隔离。
    void resolverA.register({
      sessionId: 'A',
      runId: 'rA',
      toolName: 'Write',
      toolInput: {},
      send: wsClient.send,
    });
    void resolverB.register({
      sessionId: 'B',
      runId: 'rB',
      toolName: 'Write',
      toolInput: {},
      send: wsClient.send,
    });
    expect(resolverA.pendingCount).toBe(1);
    expect(resolverB.pendingCount).toBe(1);
    // end A → 只清 A 的 pending，B 不受影响。
    resolverA.abortAll('session_ended');
    expect(resolverA.pendingCount).toBe(0);
    expect(resolverB.pendingCount).toBe(1);
    void canUseA;
  });
});
