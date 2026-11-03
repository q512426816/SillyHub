// tests/daemon-turn-activity-timeout-report.test.ts
// 2026-11-04-turn-activity-watchdog：daemon 桥 onTurnActivityTimeout。
//
// 覆盖（对齐 daemon-interrupt-noop-report.test.ts 的 onTurnStartTimeout 桥用例）：
//   - state 在 → notifyRunResult(status='turn_activity_timeout', is_error=true)
//     调一次（含中文 result_summary）
//   - state 缺失 → warn no-op（不调 notifyRunResult）
//   - sessionManager 未挂 → warn no-op
//   - notifyRunResult 抛错 → warn 不向上抛

import { describe, it, expect, vi } from 'vitest';
import { Daemon } from '../src/daemon.js';
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
): SessionManager {
  const fullState: SessionState | undefined = state
    ? ({
        sessionId: 'sess-1',
        leaseId: 'lease-1',
        claimToken: 'claim-token-1',
        currentRunId: 'run-1',
        status: 'active',
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
    interrupt: vi.fn(async () => false),
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

describe('2026-11-04-turn-activity-watchdog 桥：daemon.onTurnActivityTimeout', () => {
  it('state 在 → notifyRunResult(status=turn_activity_timeout, is_error=true) 一次', async () => {
    const { daemon, client } = buildDaemon(createMockSessionManager({}));

    await daemon.onTurnActivityTimeout('sess-1', 'run-hung');

    expect(client.notifyRunResult).toHaveBeenCalledTimes(1);
    expect(client.notifyRunResult).toHaveBeenCalledWith(
      'lease-1',
      'claim-token-1',
      'run-hung',
      expect.objectContaining({
        status: 'turn_activity_timeout',
        is_error: true,
      }),
    );
    const payload = (client.notifyRunResult as ReturnType<typeof vi.fn>).mock
      .calls[0][3] as { result_summary: string };
    expect(payload.result_summary).toContain('重新发送');
  });

  it('state 缺失（终态清理后迟到触发）→ warn no-op', async () => {
    const { daemon, client } = buildDaemon(createMockSessionManager(undefined));

    await daemon.onTurnActivityTimeout('sess-gone', 'run-hung');

    expect(client.notifyRunResult).not.toHaveBeenCalled();
  });

  it('sessionManager 未挂 → warn no-op', async () => {
    const { daemon, client } = buildDaemon(null);

    await daemon.onTurnActivityTimeout('sess-1', 'run-hung');

    expect(client.notifyRunResult).not.toHaveBeenCalled();
  });

  it('notifyRunResult 抛错 → warn 不向上抛', async () => {
    const { daemon, client } = buildDaemon(createMockSessionManager({}));
    (client.notifyRunResult as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('network down'),
    );

    await expect(
      daemon.onTurnActivityTimeout('sess-1', 'run-hung'),
    ).resolves.toBeUndefined();
  });
});
