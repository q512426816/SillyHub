// tests/interactive/session-compact.test.ts
// task-03（2026-09-14-session-ctx-compact / FR-02 + FR-04/05 契约层）：
// session-manager compact 六守卫 + driver 分派 + daemon session_compact RPC handler。
//
// 覆盖（task-03.md acceptance）：
//   - 守卫矩阵（六守卫各一用例）：
//       ① session 不存在 → SessionNotFoundError
//       ② status=running → SessionBusyError（压缩与进行中 turn 并发会交错写上下文）
//       ③ status=reconnecting → SessionNotActiveError
//       ④ status=ended / failed → SessionNotActiveError
//       ⑤ driver 未实现 compact 方法 → throw（D-002 版本错位防御）
//       ⑥ getProviderCaps(provider).compact=false → throw（cursor 等无压缩通道）
//   - 分派断言：driver.compact 收到对应 handle（claude=state.query / codex=
//     state.driverHandle，target 选择照 interruptInternal 先例）；CompactResult
//     原样透传；handle 缺失防御分支抛错。
//   - daemon handler 侧：session_id 非字符串 → throw；_sessionManager=null →
//     throw 'session manager not ready'（backend 收 RemoteError，task-02 映射）；
//     正常路径 CompactResult 作为 RPC result 回传；守卫错误如实上抛不吞。
//
// mock 构造照 tests/interactive/session-interrupt.test.ts 范式（mock driver 不
// spawn 真实进程；daemon 侧照 daemon-notify-session-ready.test.ts 鸭子类型 mock）。

import { describe, it, expect, afterEach, vi } from 'vitest';
import type { Query } from '@anthropic-ai/claude-agent-sdk';
import { SessionManager } from '../../src/interactive/session-manager.js';
import type { ClaudeSdkDriver } from '../../src/interactive/claude-sdk-driver.js';
import type { CompactResult } from '../../src/interactive/driver.js';
import {
  SessionNotFoundError,
  SessionNotActiveError,
  SessionBusyError,
} from '../../src/interactive/types.js';
import { Daemon } from '../../src/daemon.js';
import type { DaemonConfig } from '../../src/config.js';
import type { SessionManager as SessionManagerType } from '../../src/interactive/session-manager.js';

// ── session-manager 侧 fixtures（照 session-interrupt.test.ts）────────────────

type CompactSpy = ReturnType<typeof vi.fn>;

function makeMockDriver(opts: { compact?: CompactSpy } = {}) {
  const fakeQuery = { interrupt: vi.fn(async () => {}) } as unknown as Query;

  const driver = {
    start: vi.fn(() => fakeQuery),
    consume: vi.fn(async () => {}),
    interrupt: vi.fn(async () => true),
    // 缺省不带 compact（⑤ 守卫用例：driver 未实现可选方法=真实 claude/codex
    // driver 在 task-04/05 落地前的形态）。
    ...(opts.compact ? { compact: opts.compact } : {}),
  } as unknown as ClaudeSdkDriver;

  return { driver, fakeQuery };
}

function makeDeps() {
  return {
    onTurnResult: vi.fn(async () => {}),
    onTurnMessage: vi.fn(async () => {}),
    onSessionEnd: vi.fn(async () => {}),
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

/** 直改 store 内 state（照 session-interrupt.test.ts:225 直接改私有字段的先例）。 */
function mutateState(
  sm: SessionManager,
  sessionId: string,
  patch: Record<string, unknown>,
): void {
  Object.assign(sm.get(sessionId) as object, patch);
}

// ── 守卫矩阵 ──────────────────────────────────────────────────────────────────

describe('task-03 守卫矩阵：compact 六守卫拒绝形态（照 turn-control inject 先例 throw）', () => {
  it('① session 不存在 → SessionNotFoundError', async () => {
    const { driver } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await expect(sm.compact('nope')).rejects.toThrow(SessionNotFoundError);
  });

  it('② status=running（turn 进行中）→ SessionBusyError（稍后重试语义）', async () => {
    const { driver } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    // create 后首 turn 在跑（session-interrupt.test.ts:121 同口径）。
    expect(sm.get('sess-1')!.status).toBe('running');
    await expect(sm.compact('sess-1')).rejects.toThrow(SessionBusyError);
    expect(driver.interrupt).not.toHaveBeenCalled();
  });

  it('③ status=reconnecting → SessionNotActiveError', async () => {
    const { driver } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    mutateState(sm, 'sess-1', { status: 'reconnecting' });
    await expect(sm.compact('sess-1')).rejects.toThrow(SessionNotActiveError);
  });

  it('④ status=ended → SessionNotActiveError', async () => {
    const { driver } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    mutateState(sm, 'sess-1', { status: 'ended' });
    await expect(sm.compact('sess-1')).rejects.toThrow(SessionNotActiveError);
  });

  it('④ status=failed → SessionNotActiveError', async () => {
    const { driver } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    mutateState(sm, 'sess-1', { status: 'failed' });
    await expect(sm.compact('sess-1')).rejects.toThrow(SessionNotActiveError);
  });

  it('⑤ driver 未实现 compact 方法 → throw（caps=true 但版本错位，D-002 双保险）', async () => {
    const { driver } = makeMockDriver(); // claude caps.compact=true，但 mock 无方法
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    mutateState(sm, 'sess-1', { status: 'active' });
    await expect(sm.compact('sess-1')).rejects.toThrow(
      /compact not supported by driver/,
    );
  });

  it('⑥ getProviderCaps(provider).compact=false（cursor）→ throw，即使 driver 有方法', async () => {
    const compactSpy = vi.fn(async () => ({ ok: true }));
    const { driver } = makeMockDriver({ compact: compactSpy });
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    // provider 改 cursor（PROVIDER_CAPS.cursor.compact=false），driver 归属随 state。
    mutateState(sm, 'sess-1', { status: 'active', provider: 'cursor' });
    await expect(sm.compact('sess-1')).rejects.toThrow(
      /compact not supported for provider: cursor/,
    );
    expect(compactSpy).not.toHaveBeenCalled();
  });
});

// ── 分派：driver.compact 收到对应 handle + CompactResult 透传 ────────────────

describe('task-03 分派：driver.compact(handle) + CompactResult 原样透传', () => {
  it('claude 会话 → handle=state.query（SDK Query），结果透传', async () => {
    const expected: CompactResult = {
      ok: true,
      tokensBefore: 1234,
      estimatedTokensAfter: 300,
    };
    const compactSpy = vi.fn(async () => expected);
    const { driver, fakeQuery } = makeMockDriver({ compact: compactSpy });
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    mutateState(sm, 'sess-1', { status: 'active' });

    const res = await sm.compact('sess-1');
    expect(compactSpy).toHaveBeenCalledTimes(1);
    // target 选择照 interruptInternal 先例：claude → state.query。
    expect(compactSpy).toHaveBeenCalledWith(fakeQuery);
    expect(res).toEqual(expected);
  });

  it('codex 会话 → handle=state.driverHandle，结果透传', async () => {
    const expected: CompactResult = { ok: true }; // codex 受理无数字（契约可选）
    const compactSpy = vi.fn(async () => expected);
    const { driver } = makeMockDriver({ compact: compactSpy });
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    const fakeHandle = { provider: 'codex' as const };
    mutateState(sm, 'sess-1', {
      status: 'active',
      provider: 'codex',
      driverHandle: fakeHandle,
    });

    const res = await sm.compact('sess-1');
    expect(compactSpy).toHaveBeenCalledTimes(1);
    expect(compactSpy).toHaveBeenCalledWith(fakeHandle);
    expect(res).toEqual(expected);
  });

  it('handle 缺失（provider 互斥字段未填）→ 防御性 throw（不向 driver 传空）', async () => {
    const compactSpy = vi.fn(async () => ({ ok: true }));
    const { driver } = makeMockDriver({ compact: compactSpy });
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    // codex 会话但 driverHandle 未填（互斥字段缺失 = 内部不变量破坏）。
    mutateState(sm, 'sess-1', { status: 'active', provider: 'codex' });
    await expect(sm.compact('sess-1')).rejects.toThrow(
      /compact handle unavailable/,
    );
    expect(compactSpy).not.toHaveBeenCalled();
  });

  it('driver.compact 返回 ok=false（驱动侧失败）→ 原样透传不转译', async () => {
    const expected: CompactResult = { ok: false, error: 'rpc timeout' };
    const compactSpy = vi.fn(async () => expected);
    const { driver } = makeMockDriver({ compact: compactSpy });
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    mutateState(sm, 'sess-1', { status: 'active' });
    await expect(sm.compact('sess-1')).resolves.toEqual(expected);
  });
});

// ── daemon handler 侧（照 daemon-notify-session-ready.test.ts mock 范式）─────

const mockConfig: DaemonConfig = {
  server_url: 'http://127.0.0.1:8000',
  token: 'test-token',
  runtime_id: 'runtime-uuid-123',
  profile: 'default',
  workspace_dir: '/tmp/ws',
  poll_interval: 0.02,
  heartbeat_interval: 0.02,
  max_concurrent_tasks: 5,
  log_level: 'debug',
};

/** 直调私有 _registerSessionCompactRpcHandler 捕获 handler（不 start daemon）。 */
function captureSessionCompactHandler(
  daemon: Daemon,
): (params: Record<string, unknown>) => Promise<unknown> {
  const reg = vi.fn();
  (
    daemon as unknown as {
      _registerSessionCompactRpcHandler(ws: unknown): void;
    }
  )._registerSessionCompactRpcHandler({ registerRpcHandler: reg });
  const call = reg.mock.calls.find(([m]) => m === 'session_compact');
  expect(call).toBeDefined();
  return call![1] as (params: Record<string, unknown>) => Promise<unknown>;
}

function buildDaemon(sessionManager?: SessionManagerType): Daemon {
  const client = {
    register: vi.fn(async () => ({})),
    heartbeat: vi.fn(async () => ({})),
    close: vi.fn(),
  };
  const taskRunner = { runLease: vi.fn(async () => ({ success: true })) };
  const detector = { detectAgents: vi.fn(async () => []) };
  return new Daemon(
    mockConfig,
    client as never,
    taskRunner as never,
    { detector, sessionManager } as never,
  );
}

/** mock SessionManager（含 compact vi.fn，照 daemon-notify 先例鸭子类型）。 */
function createMockSessionManager(impl?: CompactSpy): SessionManagerType {
  return {
    create: vi.fn(async () => {}),
    inject: vi.fn(async () => ({ runId: '' })),
    interrupt: vi.fn(async () => false),
    compact: impl ?? vi.fn(async () => ({ ok: true })),
    end: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    get: vi.fn(() => undefined),
    start: vi.fn(() => {}),
    stop: vi.fn(() => {}),
    manualApproval: false,
    getPermissionResolver: vi.fn(() => undefined),
    getPendingInjectCount: vi.fn(() => 0),
    getIdleTimeoutSec: vi.fn(() => 1800),
    restoreAndReconnect: vi.fn(async () => {}),
    markReconnected: vi.fn(async () => {}),
    flush: vi.fn(async () => {}),
    snapshotPersistable: vi.fn(() => []),
    scanOnce: vi.fn(async () => {}),
  } as unknown as SessionManagerType;
}

describe('task-03 daemon session_compact RPC handler', () => {
  let daemons: Daemon[] = [];

  afterEach(async () => {
    for (const d of daemons) {
      if (d.isRunning) await d.stop().catch(() => undefined);
    }
    daemons = [];
  });

  it('params.session_id 非字符串 → throw（不静默空串）', async () => {
    const daemon = buildDaemon(createMockSessionManager());
    daemons.push(daemon);
    const handler = captureSessionCompactHandler(daemon);
    await expect(handler({})).rejects.toThrow(/session_id required/);
    await expect(handler({ session_id: 123 })).rejects.toThrow(
      /session_id required/,
    );
  });

  it('_sessionManager=null（未注入）→ throw session manager not ready（backend 收 RemoteError）', async () => {
    const daemon = buildDaemon(undefined);
    daemons.push(daemon);
    const handler = captureSessionCompactHandler(daemon);
    await expect(handler({ session_id: 'sess-1' })).rejects.toThrow(
      /session manager not ready/,
    );
  });

  it('正常路径 → sessionManager.compact(sessionId) 被调 + CompactResult 作为 RPC result 回传', async () => {
    const expected: CompactResult = {
      ok: true,
      tokensBefore: 100,
      estimatedTokensAfter: 40,
    };
    const compactImpl = vi.fn(async () => expected);
    const sm = createMockSessionManager(compactImpl);
    const daemon = buildDaemon(sm);
    daemons.push(daemon);
    const handler = captureSessionCompactHandler(daemon);

    await expect(handler({ session_id: 'sess-rpc-1' })).resolves.toEqual(expected);
    expect(compactImpl).toHaveBeenCalledTimes(1);
    expect(compactImpl).toHaveBeenCalledWith('sess-rpc-1');
  });

  it('守卫/驱动错误如实上抛不吞（映射责任在 backend task-02）', async () => {
    const compactImpl = vi.fn(async () => {
      throw new SessionNotFoundError('sess-gone');
    });
    const sm = createMockSessionManager(compactImpl);
    const daemon = buildDaemon(sm);
    daemons.push(daemon);
    const handler = captureSessionCompactHandler(daemon);
    await expect(handler({ session_id: 'sess-gone' })).rejects.toThrow(
      SessionNotFoundError,
    );
  });
});
