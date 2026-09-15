// tests/interactive/daemon-usage-note.test.ts
// 2026-09-15-background-task-permission-lockout（task-10 / FR-04）：daemon.onTurnResult
// 的 [USAGE_NOTE] 标注行两态——本 run 收口时会话仍有存活后台任务 → 追加一行
// stdout 标注（后台任务消耗会按快照差分记给本 run）；注册表空 → 不追加。
//
// harness 模板沿用 tests/daemon-interactive-bridge.test.ts（mock client/SessionManager
// + Daemon 构造，仅断言桥接行为）。

import { describe, it, expect, vi } from 'vitest';
import { Daemon } from '../../src/daemon.js';
import type { DaemonConfig } from '../../src/config.js';
import type { SessionManager } from '../src/interactive/session-manager.js';
import type { SessionState } from '../src/interactive/types.js';
import type { DetectedAgent } from '../../src/agent-detector.js';

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
  state: Partial<SessionState>,
  hasLive: boolean,
): SessionManager {
  const fullState = {
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
  } as SessionState;
  return {
    create: vi.fn(async () => {}),
    inject: vi.fn(async () => ({ runId: '' })),
    interrupt: vi.fn(async () => false),
    end: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    get: vi.fn((() => fullState) as never),
    hasLiveBackgroundTasks: vi.fn((() => hasLive) as never),
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

function buildDaemon(sm: SessionManager): { daemon: Daemon; client: ReturnType<typeof createMockClient> } {
  const client = createMockClient();
  const daemon = new Daemon(mockConfig, client as never, { runLease: vi.fn() } as never, {
    sessionManager: sm,
    detector: { detectAgents: vi.fn(async () => [] as DetectedAgent[]) },
  });
  return { daemon, client };
}

function resultSuccess(): Record<string, unknown> {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'ok',
    num_turns: 1,
    duration_ms: 1,
    duration_api_ms: 1,
    total_cost_usd: 0,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    session_id: 'sdk-sess',
  };
}

describe('onTurnResult [USAGE_NOTE] 标注行（FR-04）', () => {
  it('hasLiveBackgroundTasks=true → submitMessages 追加一条 [USAGE_NOTE] stdout 行（挂收口 runId）', async () => {
    const sm = createMockSessionManager({}, true);
    const { daemon, client } = buildDaemon(sm);
    await daemon.onTurnResult('sess-1', 'run-1', resultSuccess() as never);
    // submitMessages(leaseId, claimToken, runId, [msg])——USAGE_NOTE 行挂收口 runId。
    const noteCalls = client.submitMessages.mock.calls.filter(([, , , msgs]) =>
      (msgs as Record<string, unknown>[]).some(
        (m) => typeof m['content'] === 'string' && (m['content'] as string).startsWith('[USAGE_NOTE]'),
      ),
    );
    expect(noteCalls.length).toBeGreaterThanOrEqual(1);
    const [, , rid, msgs] = noteCalls[0]! as unknown as [
      string,
      string,
      string,
      Record<string, unknown>[],
    ];
    expect(rid).toBe('run-1'); // 挂正在收口的 run
    const line = msgs.find(
      (m) => typeof m['content'] === 'string' && (m['content'] as string).startsWith('[USAGE_NOTE]'),
    )!;
    expect(line['channel']).toBe('stdout');
    expect(line['content']).toContain('后台任务消耗');
  });

  it('hasLiveBackgroundTasks=false → 无 [USAGE_NOTE] 行（行为与现状一致）', async () => {
    const sm = createMockSessionManager({}, false);
    const { daemon, client } = buildDaemon(sm);
    await daemon.onTurnResult('sess-1', 'run-1', resultSuccess() as never);
    const hasNote = client.submitMessages.mock.calls.some(([, , , msgs]) =>
      (msgs as Record<string, unknown>[]).some(
        (m) => typeof m['content'] === 'string' && (m['content'] as string).startsWith('[USAGE_NOTE]'),
      ),
    );
    expect(hasNote).toBe(false);
  });
});
