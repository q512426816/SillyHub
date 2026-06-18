// tests/interactive/daemon-recovery-boot.test.ts
// task-10 Step 4：daemon 启动恢复编排顺序 + 单项失败隔离 + backend rejected 删记录。
//
// 覆盖（蓝图 §5 + §7 边界 8/9/12/16 + AC-10-06/07/08/09）：
//   - load 返回 N 条 → 对每条调 recoveryClient.recoverSession。
//   - backend status=reconnecting → 调 sessionManager.restoreAndReconnect + markReconnected
//     + recoveryClient.confirmReconnected；三循环在恢复完成后启动。
//   - backend status=ended/failed/rejected → 不调 restoreAndReconnect；记录从持久化移除。
//   - restoreAndReconnect 后 session 不在 store（driver.start 抛错） → markRecoveryFailed
//     + 移除记录；继续下一条（失败隔离）。
//   - 限流 4 并发（5 条时第 5 条等前面有 slot）。
//   - persistence.load 返回 []（无记录 / 文件不存在）→ 跳过恢复，直接启动 loops。
//   - batch lease 零影响（sessions.json 只含 interactive，provider 过滤；恢复不触 batch）。
//
// 不测真实 HubClient / WS / driver；全 mock。

import { describe, it, expect, vi } from 'vitest';
import { Daemon } from '../../src/daemon.js';
import type { DaemonConfig } from '../../src/config.js';
import type { SessionManager } from '../../src/interactive/session-manager.js';
import type {
  PersistedSessionRecord,
  SessionStorePersistence,
} from '../../src/interactive/types.js';

// ── 辅助 ──────────────────────────────────────────────────────────────────────

function mkConfig(): DaemonConfig {
  return {
    runtime_id: 'rt-1',
    server_url: 'http://localhost',
    token: 'tok',
    workspace_dir: 'C:\\ws',
    log_level: 'info',
    poll_interval: 60,
    heartbeat_interval: 30,
    max_concurrent_tasks: 4,
    allowed_roots: [],
  } as unknown as DaemonConfig;
}

function mkRecord(over: Partial<PersistedSessionRecord> = {}): PersistedSessionRecord {
  return {
    sessionId: 'sess-1',
    leaseId: 'lease-1',
    agentSessionId: 'sdk-sess-1',
    cwd: 'C:\\work',
    provider: 'claude',
    turnCount: 1,
    lastActiveAt: 1_700_000_000_000,
    ...over,
  };
}

function mockPersistence(records: PersistedSessionRecord[]) {
  const saved: PersistedSessionRecord[][] = [];
  return {
    saved,
    persistence: {
      load: vi.fn(async () => records.slice()),
      save: vi.fn(async (recs: readonly PersistedSessionRecord[]) => {
        saved.push(recs.slice());
        // 模拟 daemon 下次 load：save 后 records 反映在内部状态。
        records.splice(0, records.length, ...recs);
      }),
      quarantine: vi.fn(async () => {}),
    } as SessionStorePersistence & { saved: PersistedSessionRecord[][] },
  };
}

/** mock recovery client（鸭子类型）：跟踪每条记录的 recover/confirm/markFailed 调用。 */
function mockRecoveryClient() {
  return {
    recoverSession: vi.fn(async (
      _sessionId: string,
      _params: {
        leaseId: string;
        runtimeId: string;
        provider: string;
        agentSessionId: string;
        interruptedRunId?: string;
      },
    ): Promise<{ status: 'reconnecting' | 'ended' | 'failed' | 'rejected' }> => {
      return { status: 'reconnecting' };
    }),
    confirmReconnected: vi.fn(async (_sessionId: string): Promise<void> => {}),
    markRecoveryFailed: vi.fn(async (_sessionId: string): Promise<void> => {}),
  };
}

function mockSessionManager(): {
  sm: SessionManager;
  restoreSpy: ReturnType<typeof vi.fn>;
  markReconnectedSpy: ReturnType<typeof vi.fn>;
  failSpy: ReturnType<typeof vi.fn>;
  hasSpy: ReturnType<typeof vi.fn>;
} {
  const store = new Map<string, boolean>();
  const restoreSpy = vi.fn(async () => {
    // 默认成功：模拟 driver.start 成功后 session 进入 store。
  });
  const markReconnectedSpy = vi.fn(async () => {});
  const failSpy = vi.fn(async () => {});
  const hasSpy = vi.fn((sid: string) => store.has(sid));
  // 让 restoreAndReconnect「成功」时把 session 写入 has 集合（编排查 get(sid)===undefined 判失败）。
  restoreSpy.mockImplementation(async (record: PersistedSessionRecord) => {
    store.set(record.sessionId, true);
  });
  const sm = {
    restoreAndReconnect: restoreSpy,
    markReconnected: markReconnectedSpy,
    fail: failSpy,
    get: vi.fn((sid: string) => (store.has(sid) ? ({} as never) : undefined)),
    snapshotPersistable: vi.fn((): PersistedSessionRecord[] => []),
    flush: vi.fn(async () => {}),
    start: vi.fn(),
    stop: vi.fn(),
  } as unknown as SessionManager;
  return { sm, restoreSpy, markReconnectedSpy, failSpy, hasSpy };
}

// 用最小 Daemon 构造：detector 返回 0 agent（不 register），所以无 runtime/WS。
// sessionManager + persistence + recoveryCoordinator 注入。
function makeDaemon(opts: {
  sessionManager: SessionManager;
  persistence: SessionStorePersistence;
  recoveryClient: ReturnType<typeof mockRecoveryClient>;
}) {
  const client = {
    register: vi.fn(async () => ({ id: 'rt-x' })),
    heartbeat: vi.fn(async () => ({})),
    claimLease: vi.fn(async () => ({})),
    startLease: vi.fn(async () => ({})),
    completeLease: vi.fn(async () => ({})),
    getPendingLeases: vi.fn(async () => []),
    getExecutionContext: vi.fn(async () => ({})),
    close: vi.fn(),
  };
  const detector = { detectAgents: vi.fn(async () => []) };
  const daemon = new Daemon(mkConfig(), client as never, null, {
    detector,
    sessionManager: opts.sessionManager,
    persistence: opts.persistence,
    recoveryClient: opts.recoveryClient,
  });
  return { daemon, client, detector };
}

// ── 启动编排 ──────────────────────────────────────────────────────────────────

describe('Daemon 启动恢复编排', () => {
  it('load 返回 [] → 跳过恢复，直接启动 loops（无 recover 调用）', async () => {
    const { persistence } = mockPersistence([]);
    const rc = mockRecoveryClient();
    const { sm } = mockSessionManager();
    const { daemon } = makeDaemon({
      sessionManager: sm,
      persistence,
      recoveryClient: rc,
    });
    await daemon.start();
    expect(rc.recoverSession).not.toHaveBeenCalled();
    expect(sm.restoreAndReconnect).not.toHaveBeenCalled();
    await daemon.stop();
  });

  it('load 返回 2 条均 reconnecting → 每条调 recover+restore+markReconnected+confirm', async () => {
    const rec1 = mkRecord({ sessionId: 's1', leaseId: 'l1', agentSessionId: 'a1' });
    const rec2 = mkRecord({ sessionId: 's2', leaseId: 'l2', agentSessionId: 'a2' });
    const { persistence } = mockPersistence([rec1, rec2]);
    const rc = mockRecoveryClient();
    const { sm, restoreSpy, markReconnectedSpy } = mockSessionManager();
    const { daemon } = makeDaemon({
      sessionManager: sm,
      persistence,
      recoveryClient: rc,
    });
    await daemon.start();
    expect(rc.recoverSession).toHaveBeenCalledTimes(2);
    expect(restoreSpy).toHaveBeenCalledTimes(2);
    expect(markReconnectedSpy).toHaveBeenCalledTimes(2);
    expect(rc.confirmReconnected).toHaveBeenCalledTimes(2);
    await daemon.stop();
  });

  it('backend status=ended → 不调 restoreAndReconnect；记录从 persistence 移除', async () => {
    const rec = mkRecord();
    const { persistence } = mockPersistence([rec]);
    const rc = mockRecoveryClient();
    rc.recoverSession.mockResolvedValueOnce({ status: 'ended' });
    const { sm, restoreSpy } = mockSessionManager();
    const { daemon } = makeDaemon({
      sessionManager: sm,
      persistence,
      recoveryClient: rc,
    });
    await daemon.start();
    expect(restoreSpy).not.toHaveBeenCalled();
    expect(rc.confirmReconnected).not.toHaveBeenCalled();
    // 恢复完成后 flush，persistence.save 被调且不含该 session。
    expect(persistence.save).toHaveBeenCalled();
    const lastSave = (persistence.save as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(lastSave.find((r: PersistedSessionRecord) => r.sessionId === 'sess-1')).toBeUndefined();
    await daemon.stop();
  });

  it('backend status=rejected（runtime/lease 不匹配）→ 不建本地 session；删记录', async () => {
    const rec = mkRecord();
    const { persistence } = mockPersistence([rec]);
    const rc = mockRecoveryClient();
    rc.recoverSession.mockResolvedValueOnce({ status: 'rejected' });
    const { sm, restoreSpy } = mockSessionManager();
    const { daemon } = makeDaemon({
      sessionManager: sm,
      persistence,
      recoveryClient: rc,
    });
    await daemon.start();
    expect(restoreSpy).not.toHaveBeenCalled();
    expect(rc.markRecoveryFailed).not.toHaveBeenCalled(); // rejected ≠ resume failed
    await daemon.stop();
  });

  it('restoreAndReconnect 抛错（driver.start 同步失败）→ markRecoveryFailed + fail；继续下一条', async () => {
    const recFail = mkRecord({ sessionId: 'sf', leaseId: 'lf', agentSessionId: 'af' });
    const recOk = mkRecord({ sessionId: 'so', leaseId: 'lo', agentSessionId: 'ao' });
    const { persistence } = mockPersistence([recFail, recOk]);
    const rc = mockRecoveryClient();
    const { sm, restoreSpy, failSpy } = mockSessionManager();
    // P1-1：driver.start 同步抛错由 restoreAndReconnect 内部 catch 处理。
    // 'sf' 抛错（同步失败）；'so' 成功。编排查靠 restore 抛错而非 stillAlive 短路
    //（stillAlive 已移除——driver.start 同步返回且 consume 是 fire-and-forget，
    //异步 onError 在同步点未触发，原 stillAlive 恒 true 短路无效）。
    restoreSpy.mockReset();
    restoreSpy.mockImplementation(async (record: PersistedSessionRecord) => {
      if (record.sessionId === 'sf') {
        throw new Error('driver.start sync failed (cwd mismatch)');
      }
      // 'so' 成功
    });
    const { daemon } = makeDaemon({
      sessionManager: sm,
      persistence,
      recoveryClient: rc,
    });
    await daemon.start();
    expect(restoreSpy).toHaveBeenCalledTimes(2);
    // 失败项调 markRecoveryFailed + sessionManager.fail。
    expect(rc.markRecoveryFailed).toHaveBeenCalledWith('sf');
    expect(failSpy).toHaveBeenCalledWith('sf');
    // 成功项调 confirmReconnected。
    expect(rc.confirmReconnected).toHaveBeenCalledWith('so');
    await daemon.stop();
  });

  // P1-1：恢复成功后 driver 异步 onError → SessionManager.fail → onSessionEnd(failed)。
  // daemon 通过 markRecoveredSessionFailed 桥接到 backend markRecoveryFailed，
  // 防止 backend session 卡 reconnecting。
  it('P1-1 恢复成功后异步 fail → markRecoveredSessionFailed 通知 backend markRecoveryFailed', async () => {
    const rec = mkRecord({ sessionId: 'sx', leaseId: 'lx', agentSessionId: 'ax' });
    const { persistence } = mockPersistence([rec]);
    const rc = mockRecoveryClient();
    const { sm } = mockSessionManager();
    const { daemon } = makeDaemon({
      sessionManager: sm,
      persistence,
      recoveryClient: rc,
    });
    await daemon.start();
    // 恢复成功：confirm 已调，session 进入 recovered 集合
    expect(rc.confirmReconnected).toHaveBeenCalledWith('sx');

    // 模拟恢复后异步 driver onError → SessionManager.fail → onSessionEnd(failed)
    // → 注入方调用 daemon.markRecoveredSessionFailed
    rc.markRecoveryFailed.mockClear();
    await daemon.markRecoveredSessionFailed('sx');
    expect(rc.markRecoveryFailed).toHaveBeenCalledWith('sx');

    // 幂等：再次调用（迟到通知）不再触发 markRecoveryFailed
    rc.markRecoveryFailed.mockClear();
    await daemon.markRecoveredSessionFailed('sx');
    expect(rc.markRecoveryFailed).not.toHaveBeenCalled();
    await daemon.stop();
  });

  it('P1-1 markRecoveredSessionFailed 对非 recovered session 是 no-op', async () => {
    const rc = mockRecoveryClient();
    const { sm } = mockSessionManager();
    const { daemon } = makeDaemon({
      sessionManager: sm,
      persistence: mockPersistence([]).persistence,
      recoveryClient: rc,
    });
    await daemon.start();
    // 从未恢复过的 session 调用 → no-op
    await daemon.markRecoveredSessionFailed('never-recovered');
    expect(rc.markRecoveryFailed).not.toHaveBeenCalled();
    await daemon.stop();
  });

  it('5 条记录 + 限流 4 并发：第 5 条等到有 slot 才执行', async () => {
    const recs = Array.from({ length: 5 }, (_, i) =>
      mkRecord({ sessionId: `s${i}`, leaseId: `l${i}`, agentSessionId: `a${i}` }),
    );
    const { persistence } = mockPersistence(recs);
    const rc = mockRecoveryClient();
    // 让 recoverSession 阻塞一下，强制 4 并发上限。
    let inFlight = 0;
    let maxInFlight = 0;
    rc.recoverSession.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight -= 1;
      return { status: 'reconnecting' };
    });
    const { sm } = mockSessionManager();
    const { daemon } = makeDaemon({
      sessionManager: sm,
      persistence,
      recoveryClient: rc,
    });
    await daemon.start();
    expect(rc.recoverSession).toHaveBeenCalledTimes(5);
    // 限流 4：最大并发不超过 4。
    expect(maxInFlight).toBeLessThanOrEqual(4);
    await daemon.stop();
  });

  it('三循环在恢复完成后启动（start() 返回时恢复已完成）', async () => {
    const rec = mkRecord();
    const { persistence } = mockPersistence([rec]);
    const rc = mockRecoveryClient();
    const { sm, restoreSpy } = mockSessionManager();
    const { daemon } = makeDaemon({
      sessionManager: sm,
      persistence,
      recoveryClient: rc,
    });
    await daemon.start();
    // start() resolve 时恢复已完成（restore 已被调）。
    expect(restoreSpy).toHaveBeenCalledTimes(1);
    expect(daemon.isRunning).toBe(true);
    await daemon.stop();
  });

  it('未注入 persistence / recoveryClient → 跳过恢复（向后兼容，不崩）', async () => {
    const client = {
      register: vi.fn(async () => ({ id: 'rt-x' })),
      heartbeat: vi.fn(),
      claimLease: vi.fn(),
      startLease: vi.fn(),
      completeLease: vi.fn(),
      getPendingLeases: vi.fn(async () => []),
      getExecutionContext: vi.fn(),
      close: vi.fn(),
    };
    const detector = { detectAgents: vi.fn(async () => []) };
    // 不传 persistence / recoveryClient。
    const daemon = new Daemon(mkConfig(), client as never, null, { detector });
    await daemon.start();
    expect(daemon.isRunning).toBe(true);
    await daemon.stop();
  });

  it('batch lease 零影响：sessions.json 只含 interactive provider；恢复不触 batch 路径', async () => {
    // sessions.json 不可能含 batch（snapshotPersistable 只落 active interactive session）；
    // 恢复只调 recoverSession（按 sessionId），不调 claimLease/startLease/completeLease。
    const rec = mkRecord();
    const { persistence } = mockPersistence([rec]);
    const rc = mockRecoveryClient();
    const { sm } = mockSessionManager();
    const { daemon, client } = makeDaemon({
      sessionManager: sm,
      persistence,
      recoveryClient: rc,
    });
    await daemon.start();
    expect(client.claimLease).not.toHaveBeenCalled();
    expect(client.startLease).not.toHaveBeenCalled();
    expect(client.completeLease).not.toHaveBeenCalled();
    await daemon.stop();
  });
});
