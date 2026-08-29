// tests/daemon-stop-suspend.test.ts
// 2026-08-29-daemon-platform-resilience task-08：daemon 优雅停止挂起 + 恢复健壮性。
//
// 覆盖（design A5 / FR-04 + 任务卡 acceptance）：
//   - stop() 顺序：suspendSessions（POST suspend-batch，按 daemon_local_id）在
//     _markRegisteredRuntimesOffline 之前调用。
//   - suspend-batch 调用失败（网络已断 / HTTP 5xx）仅结构化日志降级不阻断 stop
//     收尾（markOffline 照常、stop 不抛错——与强杀等价走 600s offline sweep）。
//   - 旧 mock client 未实现 suspendSessions（ClientLike 可选方法）→ 跳过挂起，
//     stop 正常（现有测试构造点零改动的向后兼容）。
//   - recover HTTP 网络类失败：本地记录保留（boot 收尾合并落盘含该记录，即使
//     终态记录的移除 save 与 SessionManager.flush 只写 snapshot）+ 入退避重试
//     队列；WS onConnected 立即重试一轮成功恢复（recover→restore→
//     markReconnected→confirmReconnected 全链）。
//   - 退避节奏（fake timers）：30s 起步指数翻倍（第 1 次重试 30s、第 2 次 60s）。
//   - 业务终态（ended）删记录且不重试（fake timers 推进 10min 无新 recover 调用）。
//   - 记录超龄 7 天（R6）：boot 时清理（recover 不发、落盘不含该记录）。
//   - stop 收尾：遗留待恢复记录合并落盘（flush 只写 snapshot，不丢保留记录）。
//
// 不测真实 HubClient / WS / driver；全 mock（对齐 daemon.test.ts +
// daemon-recovery-boot.test.ts 既有 harness 形态）。

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Daemon } from '../src/daemon.js';
import type { DaemonConfig } from '../src/config.js';
import type { SessionManager } from '../src/interactive/session-manager.js';
import type {
  PersistedSessionRecord,
  SessionStorePersistence,
} from '../src/interactive/types.js';
import type { WsClientCallbacks } from '../src/ws-client.js';

// ── 辅助 ──────────────────────────────────────────────────────────────────────

function mkConfig(): DaemonConfig {
  return {
    runtime_id: 'rt-uuid-1',
    server_url: 'http://127.0.0.1:8000',
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
    lastActiveAt: Date.now(),
    ...over,
  };
}

/** mock client：可选挂 suspendSessions / markOffline 由用例自行覆写。 */
function mkClient() {
  return {
    register: vi.fn(async (params: { providers?: { provider: string }[] }) => ({
      daemon_instance_id: 'srv-inst-1',
      runtimes: (params.providers ?? []).map((p) => ({
        provider: p.provider,
        runtime_id: 'srv-rt-' + p.provider,
      })),
    })),
    heartbeat: vi.fn(async () => ({})),
    markOffline: vi.fn(async () => ({})),
    suspendSessions: vi.fn(async () => ({ suspended: 2, runs_failed: 1 })),
    claimLease: vi.fn(async () => ({})),
    startLease: vi.fn(async () => ({})),
    completeLease: vi.fn(async () => ({})),
    getPendingLeases: vi.fn(async () => []),
    getExecutionContext: vi.fn(async () => ({})),
    close: vi.fn(),
  };
}

/** 捕获 callbacks 的假 WS 工厂（onConnected 由测试手动触发，不在 connect 时自动连上）。 */
function mkWsFactory() {
  let callbacks: WsClientCallbacks | null = null;
  const ws = {
    connect: vi.fn(),
    close: vi.fn(),
    isConnected: false,
    lastMessageAt: null as number | null,
    connectedAt: null as number | null,
  };
  const factory = vi.fn((opts: { callbacks: WsClientCallbacks }) => {
    callbacks = opts.callbacks;
    return ws;
  });
  return {
    factory,
    ws,
    triggerOnConnected: () => callbacks?.onConnected?.(),
  };
}

function mkPersistence(records: PersistedSessionRecord[]) {
  const saved: PersistedSessionRecord[][] = [];
  const persistence = {
    saved,
    load: vi.fn(async () => records.slice()),
    save: vi.fn(async (recs: readonly PersistedSessionRecord[]) => {
      saved.push(recs.slice());
      // 模拟真实文件：save 后下次 load 反映最新状态。
      records.splice(0, records.length, ...recs);
    }),
    quarantine: vi.fn(async () => {}),
  };
  return {
    persistence: persistence as SessionStorePersistence & {
      saved: PersistedSessionRecord[][];
    },
    saved,
  };
}

function mkRecoveryClient() {
  return {
    recoverSession: vi.fn(
      async (
        _sessionId: string,
        _params: {
          leaseId: string;
          runtimeId: string;
          provider: string;
          agentSessionId: string;
          interruptedRunId?: string;
        },
      ): Promise<{ status: 'reconnecting' | 'ended' | 'failed' | 'rejected' }> => ({
        status: 'reconnecting',
      }),
    ),
    confirmReconnected: vi.fn(async (_sessionId: string): Promise<void> => {}),
    markRecoveryFailed: vi.fn(async (_sessionId: string): Promise<void> => {}),
  };
}

/**
 * mock SessionManager：snapshotPersistable 返回可变 storeSnapshot（默认 []，
 * 模拟「未恢复/已移除的记录不在 store」）；flush 与真实实现一致——把
 * snapshotPersistable() 结果交给 persistence.save（保真复现「flush 只写 snapshot
 * 会冲掉保留记录」的丢档窗口，task-08 合并落盘正是对冲它）。
 */
function mkSessionManager(store: {
  snapshot: PersistedSessionRecord[];
  persistence: SessionStorePersistence;
}) {
  const restoreSpy = vi.fn(async () => {});
  const markReconnectedSpy = vi.fn(async () => {});
  const failSpy = vi.fn(async () => {});
  const sm = {
    restoreAndReconnect: restoreSpy,
    markReconnected: markReconnectedSpy,
    fail: failSpy,
    get: vi.fn(() => undefined),
    snapshotPersistable: vi.fn((): PersistedSessionRecord[] => store.snapshot.slice()),
    flush: vi.fn(async () => {
      await store.persistence.save(store.snapshot.slice());
    }),
    start: vi.fn(),
    stop: vi.fn(),
  } as unknown as SessionManager;
  return { sm, restoreSpy, markReconnectedSpy, failSpy };
}

/** 组合 harness：detector 含 1 个 available claude（注册 + WS + markOffline 就绪）。 */
function buildDaemon(opts: {
  withRecovery?: {
    records: PersistedSessionRecord[];
    recoveryClient: ReturnType<typeof mkRecoveryClient>;
  };
  client?: ReturnType<typeof mkClient>;
}) {
  const client = opts.client ?? mkClient();
  const ws = mkWsFactory();
  const detector = {
    detectAgents: vi.fn(async () => [
      { provider: 'claude', path: 'C:\\bin\\claude.exe', status: 'available' },
    ]),
  };
  const options: Record<string, unknown> = {
    detector,
    wsClientFactory: ws.factory,
  };
  let persistenceCtx: ReturnType<typeof mkPersistence> | null = null;
  let smCtx: ReturnType<typeof mkSessionManager> | null = null;
  if (opts.withRecovery) {
    persistenceCtx = mkPersistence(opts.withRecovery.records);
    smCtx = mkSessionManager({
      snapshot: [],
      persistence: persistenceCtx.persistence,
    });
    options.sessionManager = smCtx.sm;
    options.persistence = persistenceCtx.persistence;
    options.recoveryClient = opts.withRecovery.recoveryClient;
  }
  const daemon = new Daemon(mkConfig(), client as never, null, options as never);
  return { daemon, client, ws, detector, persistence: persistenceCtx, sm: smCtx };
}

// ── stop()：优雅停止挂起（design A5 / FR-04）─────────────────────────────────

describe('task-08：daemon 优雅停止挂起（suspend-batch）', () => {
  let holder: Daemon | null = null;

  afterEach(async () => {
    if (holder?.isRunning) {
      await holder.stop().catch(() => undefined);
    }
    holder = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('stop() 先 suspendSessions（daemon_local_id）再 markOffline（顺序锁定）', async () => {
    const calls: string[] = [];
    const client = mkClient();
    client.suspendSessions = vi.fn(async () => {
      calls.push('suspend');
      return { suspended: 2, runs_failed: 1 };
    });
    client.markOffline = vi.fn(async () => {
      calls.push('markOffline');
      return {};
    });
    const { daemon } = buildDaemon({ client });
    holder = daemon;
    await daemon.start();
    await daemon.stop();
    // suspend 在 markOffline 之前；body 按 daemon_local_id（= config.runtime_id）。
    expect(calls).toEqual(['suspend', 'markOffline']);
    expect(client.suspendSessions).toHaveBeenCalledTimes(1);
    expect(client.suspendSessions).toHaveBeenCalledWith('rt-uuid-1');
    expect(client.markOffline).toHaveBeenCalledWith('srv-rt-claude');
  });

  it('suspend-batch 失败（网络已断 / 5xx）仅日志降级：markOffline 照常、stop 不抛错', async () => {
    const client = mkClient();
    client.suspendSessions = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const { daemon } = buildDaemon({ client });
    holder = daemon;
    await daemon.start();
    await expect(daemon.stop()).resolves.toBeUndefined();
    // 降级不阻断收尾：offline 标记与 client 关闭照常完成。
    expect(client.suspendSessions).toHaveBeenCalledTimes(1);
    expect(client.markOffline).toHaveBeenCalledWith('srv-rt-claude');
    expect(client.close).toHaveBeenCalled();
  });

  it('旧 client 未实现 suspendSessions（可选方法）→ 跳过挂起，stop 正常', async () => {
    const client = mkClient();
    delete (client as { suspendSessions?: unknown }).suspendSessions;
    const { daemon } = buildDaemon({ client });
    holder = daemon;
    await daemon.start();
    await expect(daemon.stop()).resolves.toBeUndefined();
    expect(client.markOffline).toHaveBeenCalledWith('srv-rt-claude');
  });

  it('stop 收尾：遗留待恢复记录（网络失败入队）合并落盘，不被 flush 只写 snapshot 冲掉', async () => {
    const rec = mkRecord({ sessionId: 's-keep' });
    const rc = mkRecoveryClient();
    rc.recoverSession.mockRejectedValueOnce(new TypeError('fetch failed'));
    const { daemon, persistence } = buildDaemon({
      withRecovery: { records: [rec], recoveryClient: rc },
    });
    holder = daemon;
    await daemon.start();
    // boot 网络失败：记录保留（已在下方 boot 用例覆盖），未到 30s 退避即停止。
    await daemon.stop();
    holder = null;
    // flush（只写 store snapshot=[]）之后仍有一笔含保留记录的合并 save。
    const last = persistence?.saved.at(-1) ?? [];
    expect(last.find((r) => r.sessionId === 's-keep')).toBeDefined();
  });
});

// ── 恢复健壮性：网络类失败保留 + 重试（design A5 / FR-04 / R6）────────────────

describe('task-08：recover 网络类失败保留记录 + 退避重试', () => {
  let holder: Daemon | null = null;

  afterEach(async () => {
    if (holder?.isRunning) {
      await holder.stop().catch(() => undefined);
    }
    holder = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('boot 网络失败：记录保留落盘（含终态记录移除与 flush 冲刷后），restore 未调', async () => {
    const recKeep = mkRecord({ sessionId: 's-keep' });
    const recEnd = mkRecord({ sessionId: 's-end' });
    const rc = mkRecoveryClient();
    // s-keep 网络失败；s-end 业务终态（ended 删记录）。
    rc.recoverSession.mockImplementation(async (sid: string) => {
      if (sid === 's-keep') throw new TypeError('fetch failed');
      return { status: 'ended' };
    });
    const { daemon, persistence, sm } = buildDaemon({
      withRecovery: { records: [recKeep, recEnd], recoveryClient: rc },
    });
    holder = daemon;
    await daemon.start();
    // s-keep：网络失败不入 store、不 restore；s-end：终态不 restore。
    expect(sm?.restoreSpy).not.toHaveBeenCalled();
    expect(rc.recoverSession).toHaveBeenCalledTimes(2);
    // 保留语义：终态记录的移除 save 与 boot 收尾 flush（只写 snapshot=[]）之后，
    // 最终落盘仍含 s-keep、不含 s-end（合并回写对冲丢档窗口）。
    const last = persistence?.saved.at(-1) ?? [];
    expect(last.find((r) => r.sessionId === 's-keep')).toBeDefined();
    expect(last.find((r) => r.sessionId === 's-end')).toBeUndefined();
  });

  it('WS onConnected 立即重试一轮：第 2 次 recover 成功 → restore+markReconnected+confirm 全链', async () => {
    const rec = mkRecord();
    const rc = mkRecoveryClient();
    rc.recoverSession.mockRejectedValueOnce(new TypeError('fetch failed'));
    const { daemon, ws, sm } = buildDaemon({
      withRecovery: { records: [rec], recoveryClient: rc },
    });
    holder = daemon;
    await daemon.start();
    expect(rc.recoverSession).toHaveBeenCalledTimes(1);
    expect(sm?.restoreSpy).not.toHaveBeenCalled();
    // WS 重连成功（backend 可达信号）→ 不等 30s 退避立即重试一轮。
    ws.triggerOnConnected();
    await vi.waitFor(() =>
      expect(rc.recoverSession).toHaveBeenCalledTimes(2),
    );
    await vi.waitFor(() =>
      expect(sm?.markReconnectedSpy).toHaveBeenCalledWith('sess-1'),
    );
    expect(rc.confirmReconnected).toHaveBeenCalledWith('sess-1');
    expect(sm?.restoreSpy).toHaveBeenCalledWith(rec);
  });

  it('退避节奏（fake timers）：30s 首试、60s 次试（指数翻倍，封顶前）', async () => {
    vi.useFakeTimers();
    const rec = mkRecord();
    const rc = mkRecoveryClient();
    rc.recoverSession.mockRejectedValue(new TypeError('fetch failed'));
    const { daemon } = buildDaemon({
      withRecovery: { records: [rec], recoveryClient: rc },
    });
    holder = daemon;
    await daemon.start();
    // boot 第 1 次尝试失败入队。
    expect(rc.recoverSession).toHaveBeenCalledTimes(1);
    // 30s 后第 2 次（首次退避 = RECOVERY_RETRY_BASE_MS）。
    await vi.advanceTimersByTimeAsync(30_000);
    expect(rc.recoverSession).toHaveBeenCalledTimes(2);
    // 第 2 次失败退避翻倍 60s：窗口内（59.999s）不触发。
    await vi.advanceTimersByTimeAsync(59_999);
    expect(rc.recoverSession).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(rc.recoverSession).toHaveBeenCalledTimes(3);
    await daemon.stop();
    holder = null;
  });

  it('业务终态（ended）删记录且不重试：推进 10min 无新 recover 调用', async () => {
    vi.useFakeTimers();
    const rec = mkRecord();
    const rc = mkRecoveryClient();
    rc.recoverSession.mockResolvedValue({ status: 'ended' });
    const { daemon, persistence } = buildDaemon({
      withRecovery: { records: [rec], recoveryClient: rc },
    });
    holder = daemon;
    await daemon.start();
    expect(rc.recoverSession).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(rc.recoverSession).toHaveBeenCalledTimes(1);
    // 记录已删：落盘不含该 session。
    const last = persistence?.saved.at(-1) ?? [];
    expect(last.find((r) => r.sessionId === 'sess-1')).toBeUndefined();
    await daemon.stop();
    holder = null;
  });

  it('记录超龄 7 天（R6）：boot 清理——recover 不发、落盘移除', async () => {
    const stale = mkRecord({
      sessionId: 's-stale',
      lastActiveAt: Date.now() - 8 * 24 * 60 * 60_000,
    });
    const rc = mkRecoveryClient();
    const { daemon, persistence } = buildDaemon({
      withRecovery: { records: [stale], recoveryClient: rc },
    });
    holder = daemon;
    await daemon.start();
    // 超龄记录不尝试恢复（backend suspended 24h GC 已收敛 failed）。
    expect(rc.recoverSession).not.toHaveBeenCalled();
    const last = persistence?.saved.at(-1) ?? [];
    expect(last.find((r) => r.sessionId === 's-stale')).toBeUndefined();
  });
});
