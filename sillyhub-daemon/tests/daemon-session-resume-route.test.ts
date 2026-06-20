// tests/daemon-session-resume-route.test.ts
// task-08（session-history-enhance / FR-2 / D-002@v1）：daemon 收 backend
// SESSION_RESUME → _routeSessionControl 走 resume 分支 → SessionManager
// .restoreAndReconnect(record) + markReconnected。
//
// backend（task-07）发 snake_case payload：
//   { session_id, lease_id, agent_session_id, cwd, provider, runtime_id }
// daemon 入口归一化（与 SESSION_INJECT 同风格，ql-20260616-006）后构造
// PersistedSessionRecord（camelCase）调 restoreAndReconnect。
//
// AC（task-08.md）：
//   AC-01 收 SESSION_RESUME → restoreAndReconnect(record)，record 含
//       agentSessionId / cwd / provider / leaseId / sessionId
//   AC-05 payload 缺 agent_session_id → 拒绝（warn，不 resume）
//   AC-06 snake/camel 归一化 → backend snake payload 正确映射 record
//
// 注：SESSION_RESUME 与 INJECT/INTERRUPT/END 不同——收消息时 session 尚未在
// SessionStore（正是来 resume 的），所以 _routeSessionControl 必须在 state
// 存在校验之前分流到 resume 分支。

import { describe, it, expect, afterEach, vi } from 'vitest';
import { Daemon } from '../src/daemon.js';
import { MSG } from '../src/protocol.js';
import type { DaemonConfig } from '../src/config.js';
import type { DetectedAgent } from '../src/agent-detector.js';
import type { SessionManager } from '../src/interactive/session-manager.js';
import type { PersistedSessionRecord } from '../src/interactive/types.js';

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

function createMockClient() {
  return {
    register: vi.fn(async () => ({ id: 'srv-rid-1' })),
    heartbeat: vi.fn(async () => ({})),
    markOffline: vi.fn(async () => ({})),
    claimLease: vi.fn(async () => ({ claim_token: 't', payload: {} })),
    startLease: vi.fn(async () => ({})),
    completeLease: vi.fn(async () => ({})),
    getPendingLeases: vi.fn(async () => []),
    getExecutionContext: vi.fn(async () => ({ agent_run_id: 'r' })),
    close: vi.fn(),
    notifyRunResult: vi.fn(async () => ({})),
    submitMessages: vi.fn(async () => ({})),
    notifySessionEnd: vi.fn(async () => ({})),
  };
}

function createMockTaskRunner() {
  return { runLease: vi.fn(async () => ({})) };
}

/** mock SessionManager：只断言 restoreAndReconnect / markReconnected 调用与字段。 */
function createMockSessionManager(): SessionManager {
  return {
    create: vi.fn(async () => {}),
    inject: vi.fn(async () => ({ runId: '' })),
    interrupt: vi.fn(async () => false),
    end: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    // resume 时 session 尚未在 store → get 返回 undefined（真实情形）。
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
  } as unknown as SessionManager;
}

function buildDaemon(sm: SessionManager | null = createMockSessionManager()): {
  daemon: Daemon;
  sm: SessionManager;
} {
  const detector = { detectAgents: vi.fn(async () => [] as DetectedAgent[]) };
  const daemon = new Daemon(
    mockConfig,
    createMockClient() as never,
    createMockTaskRunner() as never,
    { detector, sessionManager: sm } as never,
  );
  return { daemon, sm: sm as SessionManager };
}

async function emit(daemon: Daemon, msg: {
  type: string;
  payload: unknown;
}): Promise<void> {
  // _handleWsMessage 是 private；通过 unknown 透传调用（同 permission-route 测试）。
  const handle = (
    daemon as unknown as {
      _handleWsMessage: (m: { type: string; payload: unknown }) => Promise<void>;
    }
  )._handleWsMessage.bind(daemon);
  await handle(msg);
}

describe('daemon SESSION_RESUME route（task-08 / session-history-enhance）', () => {
  let daemons: Daemon[] = [];

  afterEach(async () => {
    for (const d of daemons) {
      if (d.isRunning) {
        await d.stop().catch(() => undefined);
      }
    }
    daemons = [];
  });

  it('AC-01/06 snake payload → restoreAndReconnect(record) 字段映射正确', async () => {
    const { daemon, sm } = buildDaemon();
    daemons.push(daemon);

    await emit(daemon, {
      type: MSG.SESSION_RESUME,
      payload: {
        session_id: 'sess-resume-1',
        lease_id: 'lease-resume-1',
        agent_session_id: 'agent-sid-abc',
        cwd: '/tmp/proj',
        provider: 'claude',
        runtime_id: 'runtime-uuid-123',
      },
    });
    // void Promise 分发，等 microtask。
    await new Promise((r) => setTimeout(r, 5));

    expect(sm.restoreAndReconnect).toHaveBeenCalledTimes(1);
    const record = sm.restoreAndReconnect.mock.calls[0]![0] as PersistedSessionRecord;
    expect(record).toMatchObject({
      sessionId: 'sess-resume-1',
      leaseId: 'lease-resume-1',
      agentSessionId: 'agent-sid-abc',
      cwd: '/tmp/proj',
      provider: 'claude',
    });
  });

  it('AC-01 resume 成功后调 markReconnected(sessionId) 切 active', async () => {
    const { daemon, sm } = buildDaemon();
    daemons.push(daemon);

    await emit(daemon, {
      type: MSG.SESSION_RESUME,
      payload: {
        session_id: 'sess-resume-2',
        lease_id: 'lease-resume-2',
        agent_session_id: 'agent-sid-def',
        cwd: '/tmp/p2',
        provider: 'claude',
      },
    });
    await new Promise((r) => setTimeout(r, 5));

    expect(sm.restoreAndReconnect).toHaveBeenCalledTimes(1);
    expect(sm.markReconnected).toHaveBeenCalledTimes(1);
    expect(sm.markReconnected).toHaveBeenCalledWith('sess-resume-2');
  });

  it('AC-05 payload 缺 agent_session_id → 拒绝 resume（不调 restoreAndReconnect）', async () => {
    const { daemon, sm } = buildDaemon();
    daemons.push(daemon);

    await emit(daemon, {
      type: MSG.SESSION_RESUME,
      payload: {
        session_id: 'sess-no-agent-sid',
        lease_id: 'lease-x',
        cwd: '/tmp/p',
        provider: 'claude',
      },
    });
    await new Promise((r) => setTimeout(r, 5));

    expect(sm.restoreAndReconnect).not.toHaveBeenCalled();
    expect(sm.markReconnected).not.toHaveBeenCalled();
  });

  it('AC-05 payload 缺 session_id → 拒绝 resume', async () => {
    const { daemon, sm } = buildDaemon();
    daemons.push(daemon);

    await emit(daemon, {
      type: MSG.SESSION_RESUME,
      payload: {
        lease_id: 'lease-x',
        agent_session_id: 'agent-sid',
        cwd: '/tmp/p',
        provider: 'claude',
      },
    });
    await new Promise((r) => setTimeout(r, 5));

    expect(sm.restoreAndReconnect).not.toHaveBeenCalled();
  });

  it('camelCase payload 兼容（agentSessionId / leaseId 直接传）', async () => {
    const { daemon, sm } = buildDaemon();
    daemons.push(daemon);

    await emit(daemon, {
      type: MSG.SESSION_RESUME,
      payload: {
        sessionId: 'sess-camel',
        leaseId: 'lease-camel',
        agentSessionId: 'agent-sid-camel',
        cwd: '/tmp/camel',
        provider: 'claude',
      },
    });
    await new Promise((r) => setTimeout(r, 5));

    expect(sm.restoreAndReconnect).toHaveBeenCalledTimes(1);
    const record = sm.restoreAndReconnect.mock.calls[0]![0] as PersistedSessionRecord;
    expect(record).toMatchObject({
      sessionId: 'sess-camel',
      leaseId: 'lease-camel',
      agentSessionId: 'agent-sid-camel',
    });
  });

  it('sessionManager=null → 不抛（warn no-op）', async () => {
    const { daemon } = buildDaemon(null);
    daemons.push(daemon);

    await expect(
      emit(daemon, {
        type: MSG.SESSION_RESUME,
        payload: {
          session_id: 's',
          lease_id: 'l',
          agent_session_id: 'a',
          cwd: '/tmp',
          provider: 'claude',
        },
      }),
    ).resolves.toBeUndefined();
  });
});
