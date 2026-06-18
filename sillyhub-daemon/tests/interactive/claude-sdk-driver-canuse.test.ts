// tests/interactive/claude-sdk-driver-canuse.test.ts
// task-08 Step 2：ClaudeSdkDriver.canUseTool 远程人审回调接线（经 SessionManager）。
//
// 验证（task-08 §4.2 + §5 边界）：
//   - manualApproval=true：driver.start 收到 canUseTool 回调；SDK 调用时
//     wsClient.send PERMISSION_REQUEST + resolver.register 被调；await 回调
//     注入 allow/deny 后返回对应 decision；
//   - session 非 running turn → 立即 deny，不 send/register；
//   - wsClient.send 返回 false → fail-closed deny；
//   - AbortSignal abort → deny；
//   - manualApproval=false（默认）：driver.start 收到的 opts.canUseTool === undefined。
//
// 通过 SessionManager + mock driver/wsClient 构造回调，验证 task-08 的接线正确性。

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  Query,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { SessionManager } from '../../src/interactive/session-manager.js';
import { PermissionResolver } from '../../src/interactive/permission-resolver.js';
import { MSG } from '../../src/protocol.js';
import type {
  ClaudeSdkDriver,
  ConsumeCallbacks,
  StartOptions,
} from '../../src/interactive/claude-sdk-driver.js';

// ── 辅助构造 ─────────────────────────────────────────────────────────────────

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

function makeWsClient(sendReturn: boolean = true) {
  return {
    send: vi.fn((_msg: { type: string; payload: unknown }) => sendReturn),
  };
}

const BASE_INPUT = {
  sessionId: 'sess-1',
  leaseId: 'lease-1',
  firstPrompt: 'hi',
  firstRunId: 'run-1',
  cwd: 'C:\\work',
  provider: 'claude' as const,
  pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe',
};

// ── 测试 ─────────────────────────────────────────────────────────────────────

describe('SessionManager manualApproval=false（默认，AC-08.13）', () => {
  it('driver.start 收到的 opts.canUseTool === undefined（SDK 内置策略不变）', async () => {
    const d = makeMockDriver();
    const sm = new SessionManager({ driver: d.driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    expect(d.capturedOptions).not.toBeNull();
    expect((d.capturedOptions as StartOptions).canUseTool).toBeUndefined();
    expect(sm.manualApproval).toBe(false);
    expect(sm.getPermissionResolver('sess-1')).toBeUndefined();
  });
});

describe('SessionManager manualApproval=true（AC-08.1/08.2/08.3）', () => {
  it('driver.start 收到 canUseTool 回调；SDK 调用时 send PERMISSION_REQUEST + resolver.register', async () => {
    const d = makeMockDriver();
    const wsClient = makeWsClient(true);
    const sm = new SessionManager(
      { driver: d.driver, ...makeDeps() },
      {
        manualApproval: true,
        permissionResolver: new PermissionResolver(),
        permissionWsClient: wsClient,
      },
    );
    await sm.create(BASE_INPUT);
    expect(d.capturedOptions).not.toBeNull();
    const canUseTool = (d.capturedOptions as StartOptions).canUseTool;
    expect(typeof canUseTool).toBe('function');
    expect(sm.getPermissionResolver('sess-1')).toBeInstanceOf(PermissionResolver);

    // 模拟 SDK 调 canUseTool('Bash', {command:'ls'}, {signal})
    const ac = new AbortController();
    const pending = (canUseTool as (
      toolName: string,
      input: unknown,
      options?: { signal?: AbortSignal },
    ) => Promise<unknown>)('Bash', { command: 'ls' }, { signal: ac.signal });

    // send 被调一次，payload 是 PERMISSION_REQUEST + 正确字段
    expect(wsClient.send).toHaveBeenCalledTimes(1);
    const sent = wsClient.send.mock.calls[0]![0];
    expect(sent.type).toBe(MSG.PERMISSION_REQUEST);
    expect(sent.payload).toMatchObject({
      session_id: 'sess-1',
      run_id: 'run-1',
      tool_name: 'Bash',
      input: { command: 'ls' },
    });
    const requestId = (sent.payload as { request_id: string }).request_id;
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    // 模拟 backend allow → resolver.resolve → 回调返回 allow
    sm.getPermissionResolver('sess-1')!.resolve(
      { session_id: 'sess-1', request_id: requestId, decision: 'allow' },
      'sess-1',
    );
    const decision = await pending;
    expect(decision).toEqual({ behavior: 'allow' });
  });

  it('用户 deny + message → 回调返回 {behavior:deny, message}', async () => {
    const d = makeMockDriver();
    const wsClient = makeWsClient(true);
    const sm = new SessionManager(
      { driver: d.driver, ...makeDeps() },
      {
        manualApproval: true,
        permissionResolver: new PermissionResolver(),
        permissionWsClient: wsClient,
      },
    );
    await sm.create(BASE_INPUT);
    const canUseTool = (d.capturedOptions as StartOptions).canUseTool!;
    const pending = canUseTool('Write', { path: '/etc/x' });
    const requestId = (
      wsClient.send.mock.calls[0]![0].payload as { request_id: string }
    ).request_id;
    sm.getPermissionResolver('sess-1')!.resolve(
      {
        session_id: 'sess-1',
        request_id: requestId,
        decision: 'deny',
        message: 'user rejected',
      },
      'sess-1',
    );
    const decision = await pending;
    expect(decision).toEqual({ behavior: 'deny', message: 'user rejected' });
  });

  it('session 非 running turn（status=active，已 result）→ 立即 deny，不 send/register', async () => {
    const d = makeMockDriver();
    const wsClient = makeWsClient(true);
    const sm = new SessionManager(
      { driver: d.driver, ...makeDeps() },
      {
        manualApproval: true,
        permissionResolver: new PermissionResolver(),
        permissionWsClient: wsClient,
      },
    );
    await sm.create(BASE_INPUT);
    // turn result → status active
    d.emitResult(resultSuccess());
    expect(sm.get('sess-1')!.status).toBe('active');
    wsClient.send.mockClear();

    const canUseTool = (d.capturedOptions as StartOptions).canUseTool!;
    const decision = await canUseTool('Bash', { command: 'ls' });
    expect(decision.behavior).toBe('deny');
    expect(wsClient.send).not.toHaveBeenCalled();
  });

  it('wsClient.send 返回 false → 回调立即 fail-closed deny（AC-08.11）', async () => {
    const d = makeMockDriver();
    const wsClient = makeWsClient(false); // send 失败
    const sm = new SessionManager(
      { driver: d.driver, ...makeDeps() },
      {
        manualApproval: true,
        permissionResolver: new PermissionResolver(),
        permissionWsClient: wsClient,
      },
    );
    await sm.create(BASE_INPUT);
    const canUseTool = (d.capturedOptions as StartOptions).canUseTool!;
    const decision = await canUseTool('Bash', { command: 'ls' });
    expect(decision.behavior).toBe('deny');
  });

  it('AbortSignal abort → 回调 deny（AC-08.5）', async () => {
    const d = makeMockDriver();
    const wsClient = makeWsClient(true);
    const sm = new SessionManager(
      { driver: d.driver, ...makeDeps() },
      {
        manualApproval: true,
        permissionResolver: new PermissionResolver(),
        permissionWsClient: wsClient,
      },
    );
    await sm.create(BASE_INPUT);
    const canUseTool = (d.capturedOptions as StartOptions).canUseTool!;
    const ac = new AbortController();
    const pending = canUseTool('Bash', { command: 'ls' }, { signal: ac.signal });
    // 模拟 SDK interrupt abort
    ac.abort();
    const decision = await pending;
    expect(decision.behavior).toBe('deny');
  });
});

describe('SessionManager manualApproval=true 生命周期收敛', () => {
  it('end → resolver.abortAll（pending 回调 deny）+ resolver 移除', async () => {
    const d = makeMockDriver();
    const wsClient = makeWsClient(true);
    const resolver = new PermissionResolver();
    const abortSpy = vi.spyOn(resolver, 'abortAll');
    const sm = new SessionManager(
      { driver: d.driver, ...makeDeps() },
      {
        manualApproval: true,
        permissionResolver: resolver,
        permissionWsClient: wsClient,
      },
    );
    await sm.create(BASE_INPUT);
    expect(sm.getPermissionResolver('sess-1')).toBe(resolver);
    await sm.end('sess-1');
    expect(abortSpy).toHaveBeenCalledWith('session_ended');
    expect(sm.getPermissionResolver('sess-1')).toBeUndefined();
  });

  it('fail → resolver.abortAll("session_failed")', async () => {
    const d = makeMockDriver();
    const wsClient = makeWsClient(true);
    const resolver = new PermissionResolver();
    const abortSpy = vi.spyOn(resolver, 'abortAll');
    const sm = new SessionManager(
      { driver: d.driver, ...makeDeps() },
      {
        manualApproval: true,
        permissionResolver: resolver,
        permissionWsClient: wsClient,
      },
    );
    await sm.create(BASE_INPUT);
    await sm.fail('sess-1');
    expect(abortSpy).toHaveBeenCalledWith('session_failed');
  });

  it('interrupt → resolver.abortAll("session_interrupted")（AC-08.7）', async () => {
    const d = makeMockDriver();
    const wsClient = makeWsClient(true);
    const resolver = new PermissionResolver();
    const abortSpy = vi.spyOn(resolver, 'abortAll');
    const sm = new SessionManager(
      { driver: d.driver, ...makeDeps() },
      {
        manualApproval: true,
        permissionResolver: resolver,
        permissionWsClient: wsClient,
      },
    );
    await sm.create(BASE_INPUT);
    await sm.interrupt('sess-1');
    expect(abortSpy).toHaveBeenCalledWith('session_interrupted');
  });

  it('result 完成 → resolver.abortAll("turn_completed")（AC-08.8），resolver 不删', async () => {
    const d = makeMockDriver();
    const wsClient = makeWsClient(true);
    const resolver = new PermissionResolver();
    const abortSpy = vi.spyOn(resolver, 'abortAll');
    const sm = new SessionManager(
      { driver: d.driver, ...makeDeps() },
      {
        manualApproval: true,
        permissionResolver: resolver,
        permissionWsClient: wsClient,
      },
    );
    await sm.create(BASE_INPUT);
    d.emitResult(resultSuccess());
    expect(abortSpy).toHaveBeenCalledWith('turn_completed');
    // resolver 仍存在（session active，可续 turn）
    expect(sm.getPermissionResolver('sess-1')).toBe(resolver);
  });
});
