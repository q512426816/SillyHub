// tests/ws-client-permission-route.test.ts
// task-08 Step 3：daemon 路由 backend PERMISSION_RESPONSE 到 SessionManager 当前
// session 的 resolver.resolve（D-007@v1 第三段链路 daemon 侧收尾）。
//
// 验证（task-08 §4.3 + §5 边界 8/9/10）：
//   - 合法 PERMISSION_RESPONSE → resolver.resolve 被调一次，payload 正确；
//   - payload 非法（缺 request_id/decision 非 allow|deny）→ warn 丢弃，resolver 不调；
//   - session 不存在 → warn，resolver 不调；
//   - resolver 不存在（manual=false）→ no-op；
//   - resolver.resolve 返回 unknown_request/session_mismatch → warn 不抛；
//   - sessionManager=null → warn 不崩（AC-14 兼容）。
//
// 用 mock SessionManager（含 getPermissionResolver 返回 mock resolver），
// 直接调 daemon._handleWsMessage 触发路由分支。

import { describe, it, expect, vi } from 'vitest';
import { Daemon } from '../src/daemon.js';
import type { DaemonConfig } from '../src/config.js';
import type { SessionManager } from '../src/interactive/session-manager.js';
import type { PermissionResolver } from '../src/interactive/permission-resolver.js';
import { MSG } from '../src/protocol.js';

const mockConfig: DaemonConfig = {
  server_url: 'http://test:8000',
  token: 'test-token',
  runtime_id: 'runtime-uuid-123',
  profile: 'default',
  workspace_dir: '/tmp/ws',
  poll_interval: 0.02,
  heartbeat_interval: 0.02,
  max_concurrent_tasks: 5,
  log_level: 'debug',
};

function createMockResolver(): PermissionResolver & {
  resolve: ReturnType<typeof vi.fn>;
} {
  return {
    resolve: vi.fn(() => 'resolved'),
    abortAll: vi.fn(() => 0),
    register: vi.fn(() => ({
      requestId: 'r',
      promise: Promise.resolve({ behavior: 'allow' as const }),
    })),
    pendingCount: 0,
  } as unknown as PermissionResolver & {
    resolve: ReturnType<typeof vi.fn>;
  };
}

function createMockSessionManager(opts: {
  state?: unknown;
  resolver?: PermissionResolver | null;
}): SessionManager {
  return {
    create: vi.fn(async () => {}),
    inject: vi.fn(async () => ({ runId: '' })),
    interrupt: vi.fn(async () => false),
    end: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    get: vi.fn(() => opts.state ?? undefined),
    getPermissionResolver: vi.fn(() => opts.resolver ?? undefined),
    start: vi.fn(() => {}),
    stop: vi.fn(() => {}),
  } as unknown as SessionManager;
}

function createMockClient() {
  return {
    register: vi.fn(async () => ({ id: 'srv-rid-1' })),
    heartbeat: vi.fn(async () => ({})),
    markOffline: vi.fn(async () => ({})),
    claimLease: vi.fn(async () => ({
      claim_token: 't',
      payload: { prompt: 'hi' },
    })),
    startLease: vi.fn(async () => ({})),
    completeLease: vi.fn(async () => ({})),
    getPendingLeases: vi.fn(async () => []),
    getExecutionContext: vi.fn(async () => ({ agent_run_id: 'r' })),
    close: vi.fn(),
  };
}

function buildDaemon(sm: SessionManager | null): Daemon {
  const detector = {
    detectAgents: vi.fn(async () => []),
  };
  return new Daemon(
    mockConfig,
    createMockClient() as never,
    null,
    { detector, sessionManager: sm } as never,
  );
}

async function emit(daemon: Daemon, msg: {
  type: string;
  payload: unknown;
}): Promise<void> {
  // _handleWsMessage 是 private；通过 unknown 透传调用。
  const handle = (
    daemon as unknown as {
      _handleWsMessage: (m: { type: string; payload: unknown }) => Promise<void>;
    }
  )._handleWsMessage.bind(daemon);
  await handle(msg);
}

describe('daemon _routePermissionResponse（task-08 / D-007@v1）', () => {
  it('合法 allow response → resolver.resolve 被调，payload 正确', async () => {
    const resolver = createMockResolver();
    const sm = createMockSessionManager({
      state: { sessionId: 'sess-1', status: 'running' },
      resolver,
    });
    const daemon = buildDaemon(sm);
    await emit(daemon, {
      type: MSG.PERMISSION_RESPONSE,
      payload: {
        session_id: 'sess-1',
        request_id: 'req-1',
        decision: 'allow',
      },
    });
    // 异步 _routePermissionResponse 经 void Promise；等 microtask。
    await new Promise((r) => setTimeout(r, 5));
    expect(resolver.resolve).toHaveBeenCalledTimes(1);
    const args = resolver.resolve.mock.calls[0]!;
    expect(args[0]).toMatchObject({
      session_id: 'sess-1',
      request_id: 'req-1',
      decision: 'allow',
    });
    expect(args[1]).toBe('sess-1');
  });

  it('deny + message → resolver.resolve 被调，message 透传', async () => {
    const resolver = createMockResolver();
    const sm = createMockSessionManager({
      state: { sessionId: 'sess-1' },
      resolver,
    });
    const daemon = buildDaemon(sm);
    await emit(daemon, {
      type: MSG.PERMISSION_RESPONSE,
      payload: {
        session_id: 'sess-1',
        request_id: 'req-2',
        decision: 'deny',
        message: 'no',
      },
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(resolver.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        request_id: 'req-2',
        decision: 'deny',
        message: 'no',
      }),
      'sess-1',
    );
  });

  it('payload 非法（缺 request_id）→ resolver 不调', async () => {
    const resolver = createMockResolver();
    const sm = createMockSessionManager({ state: { sessionId: 's' }, resolver });
    const daemon = buildDaemon(sm);
    await emit(daemon, {
      type: MSG.PERMISSION_RESPONSE,
      payload: { session_id: 's', decision: 'allow' },
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it('decision 非 allow|deny → resolver 不调', async () => {
    const resolver = createMockResolver();
    const sm = createMockSessionManager({ state: { sessionId: 's' }, resolver });
    const daemon = buildDaemon(sm);
    await emit(daemon, {
      type: MSG.PERMISSION_RESPONSE,
      payload: { session_id: 's', request_id: 'r', decision: 'maybe' },
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it('session 不存在 → resolver 不调（迟到 response）', async () => {
    const resolver = createMockResolver();
    const sm = createMockSessionManager({ state: undefined, resolver });
    const daemon = buildDaemon(sm);
    await emit(daemon, {
      type: MSG.PERMISSION_RESPONSE,
      payload: { session_id: 'gone', request_id: 'r', decision: 'allow' },
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it('resolver 不存在（manual=false）→ no-op，不抛', async () => {
    const sm = createMockSessionManager({
      state: { sessionId: 's' },
      resolver: null,
    });
    const daemon = buildDaemon(sm);
    await expect(
      emit(daemon, {
        type: MSG.PERMISSION_RESPONSE,
        payload: { session_id: 's', request_id: 'r', decision: 'allow' },
      }),
    ).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 5));
  });

  it('resolver.resolve 返回 unknown_request → 不抛', async () => {
    const resolver = createMockResolver();
    resolver.resolve.mockReturnValue('unknown_request');
    const sm = createMockSessionManager({ state: { sessionId: 's' }, resolver });
    const daemon = buildDaemon(sm);
    await expect(
      emit(daemon, {
        type: MSG.PERMISSION_RESPONSE,
        payload: { session_id: 's', request_id: 'r', decision: 'allow' },
      }),
    ).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 5));
    expect(resolver.resolve).toHaveBeenCalled();
  });

  it('sessionManager=null → 不崩（AC-14 兼容）', async () => {
    const daemon = buildDaemon(null);
    await expect(
      emit(daemon, {
        type: MSG.PERMISSION_RESPONSE,
        payload: { session_id: 's', request_id: 'r', decision: 'allow' },
      }),
    ).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 5));
  });
});
