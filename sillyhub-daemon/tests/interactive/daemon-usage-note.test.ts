// tests/interactive/daemon-usage-note.test.ts
// 2026-10-10-usage-note-to-daemon-log：daemon.onTurnResult 的用量归属标注两态——
// 本 run 收口时会话仍有存活后台任务 → 不再向会话消息流发 [USAGE_NOTE] 行（每轮
// 必触发、用户侧纯噪音），改为 daemon 结构化日志 run_cost_may_include_bg_tasks
// （含本轮 cost 差分；SDK 会话级累计快照差分的归属误导仅日志留痕，不改数值）；
// 注册表空 → 无行无日志。
//
// harness 模板沿用 tests/daemon-interactive-bridge.test.ts（mock client/SessionManager
// + Daemon 构造，仅断言桥接行为）；日志断言经 vi.spyOn(console, 'info')——daemon
// createLogger 的 info 落 console.info，args[0] 为 `[daemon.<事件名>]`、其余为
// `key=value` 片段，按事件名过滤（构造期还有其它 info 日志）。

import { describe, it, expect, vi, afterEach } from 'vitest';
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

function hasUsageNoteLine(client: ReturnType<typeof createMockClient>): boolean {
  return client.submitMessages.mock.calls.some(([, , , msgs]) =>
    (msgs as Record<string, unknown>[]).some(
      (m) => typeof m['content'] === 'string' && (m['content'] as string).startsWith('[USAGE_NOTE]'),
    ),
  );
}

function noteLogCalls(infoSpy: ReturnType<typeof spyConsoleInfo>): unknown[][] {
  return infoSpy.mock.calls.filter((c) => c[0] === '[daemon.run_cost_may_include_bg_tasks]');
}

function spyConsoleInfo() {
  return vi.spyOn(console, 'info').mockImplementation(() => {});
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('onTurnResult 用量归属标注（run_cost_may_include_bg_tasks 日志）', () => {
  it('hasLive=true → 无 [USAGE_NOTE] 消息流行，改发结构化日志（挂收口 session/run + cost 差分）', async () => {
    const infoSpy = spyConsoleInfo();
    const sm = createMockSessionManager({}, true);
    const { daemon, client } = buildDaemon(sm);
    const result = resultSuccess();
    result['total_cost_usd'] = 24.1;
    await daemon.onTurnResult('sess-1', 'run-1', result as never);
    expect(hasUsageNoteLine(client)).toBe(false);
    const logs = noteLogCalls(infoSpy);
    expect(logs.length).toBe(1);
    const parts = (logs[0]!.slice(1) as string[]).join(' ');
    expect(parts).toContain('session_id=sess-1');
    expect(parts).toContain('run_id=run-1');
    expect(parts).toContain('cost_delta_usd=24.1');
  });

  it('hasLive=true 且 total_cost_usd 缺失 → 日志 cost_delta_usd=null，终态照常上报', async () => {
    const infoSpy = spyConsoleInfo();
    const sm = createMockSessionManager({}, true);
    const { daemon, client } = buildDaemon(sm);
    const result = resultSuccess();
    delete result['total_cost_usd'];
    await daemon.onTurnResult('sess-1', 'run-1', result as never);
    const logs = noteLogCalls(infoSpy);
    expect(logs.length).toBe(1);
    const parts = (logs[0]!.slice(1) as string[]).join(' ');
    expect(parts).toContain('cost_delta_usd=null');
    expect(client.notifyRunResult).toHaveBeenCalledTimes(1);
  });

  it('hasLive=false → 无 [USAGE_NOTE] 行且无该日志（行为与现状一致）', async () => {
    const infoSpy = spyConsoleInfo();
    const sm = createMockSessionManager({}, false);
    const { daemon, client } = buildDaemon(sm);
    await daemon.onTurnResult('sess-1', 'run-1', resultSuccess() as never);
    expect(hasUsageNoteLine(client)).toBe(false);
    expect(noteLogCalls(infoSpy).length).toBe(0);
  });
});
