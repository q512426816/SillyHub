// tests/daemon-interrupt-noop-report.test.ts
// 2026-10-21-daemon-zombie-turn FR-02：interrupt no-op 回传 + FR-01 daemon 桥
// onTurnStartTimeout。
//
// 覆盖：
//   - SESSION_INTERRUPT 且 interrupt() 返回 false（会话在 store 但无 running 轮）
//     + payload 带 run_id → notifyRunResult(error_during_execution) 收敛该 run
//   - interrupt() 返回 true → 维持现状（只 ack，不回报——终态归 SDK result）
//   - payload 无 run_id（旧 backend）→ 仅日志不回报
//   - notifyRunResult 抛错 → warn 不向上抛（backend pending 清扫兜底）
//   - daemon.onTurnStartTimeout（FR-01 桥）：state 在 → notifyRunResult
//     (turn_start_timeout)；state 缺失 → no-op

import { describe, it, expect, afterEach, vi } from 'vitest';
import { Daemon } from '../src/daemon.js';
import { MSG } from '../src/protocol.js';
import type { DaemonConfig } from '../src/config.js';
import type { DetectedAgent } from '../src/agent-detector.js';
import type { SessionManager } from '../src/interactive/session-manager.js';
import type { SessionState } from '../src/interactive/types.js';

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

function createMockSessionManager(
  state: Partial<SessionState> | undefined,
  interruptResult: boolean,
): SessionManager {
  const fullState: SessionState | undefined = state
    ? ({
        sessionId: 'sess-1',
        leaseId: 'lease-1',
        claimToken: 'claim-token-1',
        currentRunId: 'run-1',
        status: 'running',
        lastActiveAt: Date.now(),
        cwd: '/tmp',
        provider: 'claude',
        pathToClaudeCodeExecutable: '/bin/claude',
        inputQueue: { push() {}, close() {} } as never,
        ...state,
      } as SessionState)
    : undefined;
  return {
    create: vi.fn(async () => {}),
    inject: vi.fn(async () => ({ runId: '' })),
    interrupt: vi.fn(async () => interruptResult),
    end: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    get: vi.fn((() => fullState) as never),
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

function buildDaemon(sm: SessionManager | null) {
  const client = createMockClient();
  const taskRunner = {
    runLease: vi.fn(async () => ({
      success: true,
      exitCode: 0,
      status: 'completed',
      patch: '',
      filesChanged: 0,
      insertions: 0,
      deletions: 0,
      output: 'ok',
      error: '',
      durationMs: 10,
      sessionId: '',
      metadata: {},
    })),
  };
  const daemon = new Daemon(mockConfig, client as never, taskRunner as never, {
    sessionManager: sm,
    detector: { detectAgents: vi.fn(async () => [] as DetectedAgent[]) },
  });
  return { daemon, client };
}

/** 直调私有 _routeSessionControl（测试驱动口，bridge 测试同款 cast 模式）。 */
function routeControl(
  daemon: Daemon,
  msgType: string,
  raw: Record<string, unknown>,
): Promise<void> {
  return (
    daemon as unknown as {
      _routeSessionControl(t: string, r: Record<string, unknown>): Promise<void>;
    }
  )._routeSessionControl(msgType, raw);
}

describe('2026-10-21-daemon-zombie-turn FR-02：interrupt no-op 回传', () => {
  let daemons: Daemon[] = [];

  afterEach(async () => {
    for (const d of daemons) {
      await (d as unknown as { stop(): Promise<void> | void }).stop?.();
    }
    daemons = [];
    vi.restoreAllMocks();
  });

  function track<T extends { daemon: Daemon }>(built: T): T {
    daemons.push(built.daemon);
    return built;
  }

  it('interrupt() false + payload 带 run_id → notifyRunResult 收敛该 run（主事故路径）', async () => {
    const { daemon, client } = track(
      buildDaemon(createMockSessionManager({ status: 'active', currentRunId: undefined }, false)),
    );

    await routeControl(daemon, MSG.SESSION_INTERRUPT, {
      session_id: 'sess-1',
      lease_id: 'lease-1',
      runtime_id: 'runtime-uuid-123',
      run_id: 'run-zombie',
    });

    expect(client.notifyRunResult).toHaveBeenCalledTimes(1);
    const [leaseId, claimToken, runId, payload] = client.notifyRunResult.mock.calls[0] as [
      string,
      string,
      string,
      { status: string; is_error: boolean; result_summary: string },
    ];
    expect(leaseId).toBe('lease-1');
    expect(claimToken).toBe('claim-token-1');
    expect(runId).toBe('run-zombie');
    expect(payload.status).toBe('error_during_execution');
    expect(payload.is_error).toBe(true);
    expect(payload.result_summary).toContain('无进行中的轮次');
  });

  it('interrupt() true → 维持现状不回报（终态归 SDK result 驱动）', async () => {
    const { daemon, client } = track(
      buildDaemon(createMockSessionManager({ status: 'running', currentRunId: 'run-1' }, true)),
    );

    await routeControl(daemon, MSG.SESSION_INTERRUPT, {
      session_id: 'sess-1',
      lease_id: 'lease-1',
      runtime_id: 'runtime-uuid-123',
      run_id: 'run-1',
    });

    expect(client.notifyRunResult).not.toHaveBeenCalled();
  });

  it('payload 无 run_id（旧 backend）→ 仅日志不回报', async () => {
    const { daemon, client } = track(
      buildDaemon(createMockSessionManager({ status: 'active', currentRunId: undefined }, false)),
    );

    await routeControl(daemon, MSG.SESSION_INTERRUPT, {
      session_id: 'sess-1',
      lease_id: 'lease-1',
      runtime_id: 'runtime-uuid-123',
    });

    expect(client.notifyRunResult).not.toHaveBeenCalled();
  });

  it('notifyRunResult 抛错 → warn 不向上抛（backend pending 清扫兜底）', async () => {
    const sm = createMockSessionManager({ status: 'active', currentRunId: undefined }, false);
    const built = buildDaemon(sm);
    built.client.notifyRunResult = vi.fn(async () => {
      throw new Error('network down');
    });
    track(built);

    await expect(
      routeControl(built.daemon, MSG.SESSION_INTERRUPT, {
        session_id: 'sess-1',
        lease_id: 'lease-1',
        runtime_id: 'runtime-uuid-123',
        run_id: 'run-zombie',
      }),
    ).resolves.toBeUndefined();
  });

  it('camelCase runId 双读同效（协议字段名漂移防御）', async () => {
    const { daemon, client } = track(
      buildDaemon(createMockSessionManager({ status: 'active', currentRunId: undefined }, false)),
    );

    await routeControl(daemon, MSG.SESSION_INTERRUPT, {
      session_id: 'sess-1',
      lease_id: 'lease-1',
      runtime_id: 'runtime-uuid-123',
      runId: 'run-zombie',
    });

    expect(client.notifyRunResult).toHaveBeenCalledTimes(1);
    expect((client.notifyRunResult.mock.calls[0] as unknown[])[2]).toBe('run-zombie');
  });
});

describe('2026-10-21-daemon-zombie-turn FR-01 桥：daemon.onTurnStartTimeout', () => {
  it('state 在 → notifyRunResult(turn_start_timeout) 收敛该 run', async () => {
    const { daemon, client } = buildDaemon(
      createMockSessionManager({ status: 'active', currentRunId: undefined }, false),
    );

    await daemon.onTurnStartTimeout('sess-1', 'run-zombie');

    expect(client.notifyRunResult).toHaveBeenCalledTimes(1);
    const [leaseId, claimToken, runId, payload] = client.notifyRunResult.mock.calls[0] as [
      string,
      string,
      string,
      { status: string; is_error: boolean; result_summary: string },
    ];
    expect(leaseId).toBe('lease-1');
    expect(claimToken).toBe('claim-token-1');
    expect(runId).toBe('run-zombie');
    expect(payload.status).toBe('turn_start_timeout');
    expect(payload.is_error).toBe(true);
    expect(payload.result_summary).toContain('重新发送');
  });

  it('state 缺失（终态清理后迟到触发）→ no-op 不上报', async () => {
    const { daemon, client } = buildDaemon(createMockSessionManager(undefined, false));

    await daemon.onTurnStartTimeout('sess-gone', 'run-zombie');

    expect(client.notifyRunResult).not.toHaveBeenCalled();
  });
});
