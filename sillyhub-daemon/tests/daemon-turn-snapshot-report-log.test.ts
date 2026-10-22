// tests/daemon-turn-snapshot-report-log.test.ts
// 2026-10-22-daemon-snapshot-report-log（FR-02 / FR-03）：
// 每轮文件变更快照的**上报收口日志** `turn_file_changes_reported`。
//
// 为什么要这条日志：查「历史会话里那一轮为什么没有文件变更卡」时，采集器只有
// `turn_file_changes_collected`（没采到＝没有这一行），上报侧此前只有失败 warn、
// 成功完全静默——无法区分「没采到」与「采到但没落库」。本用例锁死四条出口：
//   delivered（HTTP 2xx）/ failed（reject）/ dropped（session 已收口、无 claimToken
//   且无处入箱、client 缺方法）/ enqueued（无 claimToken 但入箱等重放）。
//
// 断言方式：daemon 的 logger 走 `console.info/warn`（`[daemon.<event>] key=value …`），
// 故 spy console 并按 tag 过滤（与 tests/interactive/turn-file-changes.test.ts 同款）。

import { describe, it, expect, afterEach, vi } from 'vitest';

import { Daemon } from '../src/daemon.js';
import type { DaemonConfig } from '../src/config.js';
import type { DetectedAgent } from '../src/agent-detector.js';
import type { SessionManager } from '../src/interactive/session-manager.js';
import type { SessionState } from '../src/interactive/types.js';
import type { TurnSnapshotReport } from '../src/interactive/turn-file-changes-types.js';

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

const REPORT_TAG = '[daemon.turn_file_changes_reported]';

function makeReport(overrides: Partial<TurnSnapshotReport> = {}): TurnSnapshotReport {
  return {
    sessionId: 'sess-1',
    runId: 'run-1',
    workspaceRoot: '/tmp/ws',
    fileChanges: {
      runId: 'run-1',
      baselineHead: 'head-sha-0',
      collectedAt: '2026-10-22T00:00:00.000Z',
      collectMs: 42,
      status: 'ok',
      files: [
        {
          path: 'frontend/src/a.tsx',
          status: 'modified',
          added: 3,
          deleted: 1,
          attribution: 'edit_patch',
          editToolNames: ['Edit'],
        },
      ],
      concurrentSessionsHint: true,
    },
    ...overrides,
  };
}

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

function createMockSessionManager(state: Partial<SessionState> | undefined): SessionManager {
  const fullState = state
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
    get: vi.fn((() => fullState) as never),
    create: vi.fn(async () => {}),
    inject: vi.fn(async () => ({ runId: '' })),
    interrupt: vi.fn(async () => false),
    end: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    start: vi.fn(() => {}),
    stop: vi.fn(() => {}),
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

function buildDaemon(sm: SessionManager) {
  const client = createMockClient();
  const taskRunner = { runLease: vi.fn(async () => ({})) };
  const daemon = new Daemon(mockConfig, client as never, taskRunner as never, {
    sessionManager: sm,
    detector: { detectAgents: vi.fn(async () => [] as DetectedAgent[]) },
  });
  return { daemon, client };
}

/** 直调私有 _onTurnSnapshot（测试驱动口，interrupt-noop-report 同款 cast 模式）。 */
function reportSnapshot(daemon: Daemon, report: TurnSnapshotReport): void {
  (
    daemon as unknown as { _onTurnSnapshot(r: TurnSnapshotReport): void }
  )._onTurnSnapshot(report);
}

/** 注入 resilience（仅 enqueued 用例需要）。 */
function injectResilience(daemon: Daemon, enqueue: () => Promise<void>): void {
  (daemon as unknown as { _resilience: unknown })._resilience = {
    enqueueRunResult: vi.fn(enqueue),
  };
}

/** 抓取本次调用的上报收口日志行（tag + 字段拼接后的整行）。 */
function captureReportLogs(spy: ReturnType<typeof vi.spyOn>): string[] {
  return spy.mock.calls
    .filter((call) => call[0] === REPORT_TAG)
    .map((call) => [call[0], ...call.slice(1)].map(String).join(' '));
}

/** 等一轮微任务（.then/.catch 回调落日志）。 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('2026-10-22-daemon-snapshot-report-log：快照上报收口日志', () => {
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

  it('上报成功 → info 级 outcome=delivered，带 status/file_count/collect_ms/elapsed_ms', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { daemon } = track(buildDaemon(createMockSessionManager({})));

    reportSnapshot(daemon, makeReport());
    await flush();

    const lines = captureReportLogs(infoSpy);
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line).toContain('outcome=delivered');
    expect(line).toContain('run_id=run-1');
    expect(line).toContain('session_id=sess-1');
    expect(line).toContain('status=ok');
    expect(line).toContain('file_count=1');
    expect(line).toContain('collect_ms=42');
    expect(line).toContain('elapsed_ms=');
    expect(line).not.toContain('drop_reason=');
  });

  it('notifyRunResult reject → warn 级 outcome=failed 且带 error（不向上抛）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { daemon, client } = track(buildDaemon(createMockSessionManager({})));
    client.notifyRunResult.mockRejectedValueOnce(new Error('HTTP 500 boom'));

    expect(() => reportSnapshot(daemon, makeReport())).not.toThrow();
    await flush();

    const lines = captureReportLogs(warnSpy);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('outcome=failed');
    expect(lines[0]).toContain('error=');
    expect(lines[0]).toContain('boom');
  });

  it('会话已收口 → warn 级 outcome=dropped + drop_reason=session_not_found', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { daemon, client } = track(buildDaemon(createMockSessionManager(undefined)));

    reportSnapshot(daemon, makeReport());
    await flush();

    expect(client.notifyRunResult).not.toHaveBeenCalled();
    const lines = captureReportLogs(warnSpy);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('outcome=dropped');
    expect(lines[0]).toContain('drop_reason=session_not_found');
  });

  it('无 claimToken 且无 resilience → warn 级 outcome=dropped + drop_reason=no_claim_token', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { daemon, client } = track(buildDaemon(createMockSessionManager({ claimToken: '' })));

    reportSnapshot(daemon, makeReport({ runId: 'run-2' }));
    await flush();

    expect(client.notifyRunResult).not.toHaveBeenCalled();
    const lines = captureReportLogs(warnSpy);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('outcome=dropped');
    expect(lines[0]).toContain('drop_reason=no_claim_token');
    expect(lines[0]).toContain('run_id=run-2');
  });

  it('无 claimToken 但有 resilience → 入箱落定后 info 级 outcome=enqueued（等重放，不算丢）', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { daemon } = track(buildDaemon(createMockSessionManager({ claimToken: '' })));
    injectResilience(daemon, async () => {});

    reportSnapshot(daemon, makeReport({ runId: 'run-3' }));
    // 入箱是异步的：落定前不应有日志（评审 P2-2：先记 enqueued 会把入箱失败吞成成功）。
    expect(captureReportLogs(infoSpy)).toHaveLength(0);
    await flush();

    const lines = captureReportLogs(infoSpy);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('outcome=enqueued');
    expect(lines[0]).toContain('run_id=run-3');
  });

  it('异步入箱 reject → warn 级 outcome=dropped + drop_reason=enqueue_failed，绝不误记 enqueued', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { daemon } = track(buildDaemon(createMockSessionManager({ claimToken: '' })));
    injectResilience(daemon, async () => {
      throw new Error('outbox full');
    });

    reportSnapshot(daemon, makeReport({ runId: 'run-4' }));
    await flush();

    const lines = captureReportLogs(warnSpy);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('outcome=dropped');
    expect(lines[0]).toContain('drop_reason=enqueue_failed');
    expect(lines[0]).toContain('outbox full');
    // 同一轮不得再出现 enqueued（两条日志会误导成「已入箱待重放」）。
    expect(captureReportLogs(infoSpy)).toHaveLength(0);
  });

  it('同步抛的入箱（旧实现/替身）→ 同样计 dropped/enqueue_failed', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { daemon } = track(buildDaemon(createMockSessionManager({ claimToken: '' })));
    (daemon as unknown as { _resilience: unknown })._resilience = {
      enqueueRunResult: vi.fn(() => {
        throw new Error('sync boom');
      }),
    };

    reportSnapshot(daemon, makeReport({ runId: 'run-5' }));
    await flush();

    const lines = captureReportLogs(warnSpy);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('outcome=dropped');
    expect(lines[0]).toContain('drop_reason=enqueue_failed');
  });

  it('一轮一条可配对的 reported 行：不同 runId 各自成行，可按 run_id 与 collected 对齐', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { daemon } = track(buildDaemon(createMockSessionManager({})));

    reportSnapshot(daemon, makeReport({ runId: 'run-a' }));
    reportSnapshot(daemon, makeReport({ runId: 'run-b' }));
    await flush();

    const lines = captureReportLogs(infoSpy);
    expect(lines).toHaveLength(2);
    // 配对键：daemon 侧 run_id= <RunId>，与采集器 sample 里的 runId 同值（camelCase
    // 只差命名风格，值一致即可 grep 对齐）；两条各自只带自己的 runId。
    const byRun = new Map(
      lines.map((line) => [/run_id=(\S+)/.exec(line)?.[1] ?? '', line] as const),
    );
    expect([...byRun.keys()].sort()).toEqual(['run-a', 'run-b']);
    expect(byRun.get('run-a')).not.toContain('run-b');
  });
});
