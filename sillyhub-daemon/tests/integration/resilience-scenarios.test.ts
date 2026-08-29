// tests/integration/resilience-scenarios.test.ts
// 2026-08-29-daemon-platform-resilience task-11：四场景集成回归（daemon 侧，
// design 全局验收标准；场景④前端部分由 frontend 既有用例重跑覆盖，见任务卡）。
//
// 编排方式：node 环境 + 全 fake（hub client / ws 工厂 / recovery client /
// SessionManager / outbox），禁真实网络——对齐 daemon-stop-suspend.test.ts
// （task-08）与 resilience-service.test.ts（task-07/08）既有 harness 形态。
//
// 覆盖：
//   - 场景① daemon 侧：补拉与 WS 双通道同 command_id 只执行一次（LRU 去重）
//     + 批量 ack（一次 pull 多条 → 单次 ackControls 携带全部 id）；
//     双向竞态（WS 先到再补拉 / 补拉在途 WS 同条到达）均锁定。
//   - 场景③ daemon 侧：stop() 先 suspend-batch 再 markOffline → 重启
//     _recoverSessionsOnBoot（boot 网络失败保留记录）→ WS onConnected 重试 →
//     业务 reconnecting → restoreAndReconnect（fake SessionManager）→
//     markReconnected + confirmReconnected 全链；
//     claimToken 空窗消息入箱（pending_token）→ token 刷新（refresher）后
//     drain 重放。
//
// @module integration/resilience-scenarios.test
//

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Daemon } from '../../src/daemon.js';
import { ControlDispatcher } from '../../src/control-dispatcher.js';
import {
  ResilienceService,
  type SubmitClient,
  type Outbox,
  type OutboxEntry,
  type RetryConfig,
  type ResilienceLogger,
  type Envelope,
} from '../../src/resilience/service.js';
import type { DaemonConfig } from '../../src/config.js';
import type { SessionManager } from '../../src/interactive/session-manager.js';
import type {
  PersistedSessionRecord,
  SessionStorePersistence,
} from '../../src/interactive/types.js';
import type { WsClientCallbacks } from '../../src/ws-client.js';
import type { PendingControlCommand } from '../../src/protocol.js';

// ── 场景③ harness（复用 task-08 daemon-stop-suspend.test.ts 形态）──────────────

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
    suspendSessions: vi.fn(async () => ({ suspended: 1, runs_failed: 1 })),
    claimLease: vi.fn(async () => ({})),
    startLease: vi.fn(async () => ({})),
    completeLease: vi.fn(async () => ({})),
    getPendingLeases: vi.fn(async () => []),
    getExecutionContext: vi.fn(async () => ({})),
    close: vi.fn(),
  };
}

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
      async (): Promise<{ status: 'reconnecting' | 'ended' | 'failed' | 'rejected' }> => ({
        status: 'reconnecting',
      }),
    ),
    confirmReconnected: vi.fn(async (): Promise<void> => {}),
    markRecoveryFailed: vi.fn(async (): Promise<void> => {}),
  };
}

function mkSessionManager(store: {
  snapshot: PersistedSessionRecord[];
  persistence: SessionStorePersistence;
}) {
  const restoreSpy = vi.fn(async () => {});
  const markReconnectedSpy = vi.fn(async () => {});
  const sm = {
    restoreAndReconnect: restoreSpy,
    markReconnected: markReconnectedSpy,
    fail: vi.fn(),
    get: vi.fn(() => undefined),
    snapshotPersistable: vi.fn((): PersistedSessionRecord[] => store.snapshot.slice()),
    flush: vi.fn(async () => {
      await store.persistence.save(store.snapshot.slice());
    }),
    start: vi.fn(),
    stop: vi.fn(),
  } as unknown as SessionManager;
  return { sm, restoreSpy, markReconnectedSpy };
}

function buildDaemon(opts: {
  records: PersistedSessionRecord[];
  recoveryClient: ReturnType<typeof mkRecoveryClient>;
  client?: ReturnType<typeof mkClient>;
}) {
  const client = opts.client ?? mkClient();
  const ws = mkWsFactory();
  const detector = {
    detectAgents: vi.fn(async () => [
      { provider: 'claude', path: 'C:\\bin\\claude.exe', status: 'available' },
    ]),
  };
  const persistenceCtx = mkPersistence(opts.records);
  const smCtx = mkSessionManager({
    snapshot: [],
    persistence: persistenceCtx.persistence,
  });
  const options: Record<string, unknown> = {
    detector,
    wsClientFactory: ws.factory,
    sessionManager: smCtx.sm,
    persistence: persistenceCtx.persistence,
    recoveryClient: opts.recoveryClient,
  };
  const daemon = new Daemon(mkConfig(), client as never, null, options as never);
  return { daemon, client, ws, persistence: persistenceCtx, sm: smCtx };
}

// ── 场景①：补拉与 WS 双通道同 command_id 只执行一次 + 批量 ack ────────────────

/** fake hub client：getPendingControls 返回预置 pending 列表，ackControls 记录。 */
function mkControlSource(pending: PendingControlCommand[]) {
  const ackCalls: string[][] = [];
  return {
    source: {
      getPendingControls: vi.fn(async () => pending.slice()),
      ackControls: vi.fn(async (_rid: string, ids: string[]) => {
        ackCalls.push(ids.slice());
        return { acked: ids.length };
      }),
    },
    ackCalls,
  };
}

function mkCommand(id: string, payload: Record<string, unknown> = {}): PendingControlCommand {
  return {
    id,
    kind: 'session_inject',
    payload: { command_id: id, ...payload },
    created_at: new Date().toISOString(),
  };
}

describe('场景① daemon 侧：控制指令双通道零重复执行 + 批量 ack', () => {
  it('WS 先到、补拉返回同条（ack 未达）→ 只执行一次；同趟新指令批量 ack', async () => {
    const cmdA = mkCommand('cmd-a', { session_id: 'sess-1', prompt: '你好' });
    const cmdB = mkCommand('cmd-b', { session_id: 'sess-1', prompt: '第二条' });
    const { source, ackCalls } = mkControlSource([cmdA, cmdB]);
    const handler = vi.fn(async () => {});
    const dispatcher = new ControlDispatcher({
      handlers: { session_inject: handler },
      source,
      logger: null,
    });

    // 通道一：WS 推送同条指令到达（backend 已 delivered 但 ack 未回，竞态窗口）。
    const wsOutcome = await dispatcher.consume('session_inject', cmdA.payload, {
      commandId: 'cmd-a',
      runtimeId: 'rt-1',
    });
    expect(wsOutcome).toBe('handled');
    expect(handler).toHaveBeenCalledTimes(1);

    // 通道二：重连补拉（backend 端 ack 未达 → cmd-a 仍 pending，与 cmd-b 同趟返回）。
    const summary = await dispatcher.pullAndConsume('rt-1');

    // 零重复执行：cmd-a 已在去重窗内（duplicate 不执行），只有 cmd-b 真正执行。
    expect(summary).toEqual({ pulled: 2, consumed: 1, acked: 2 });
    expect(handler).toHaveBeenCalledTimes(2); // cmd-a（WS）+ cmd-b（补拉），各一次
    expect(handler).toHaveBeenNthCalledWith(1, cmdA.payload);
    expect(handler).toHaveBeenNthCalledWith(2, cmdB.payload);
    // 批量 ack：一次 POST 携带全部两条 id（含 duplicate 重新排队回执的 cmd-a）。
    expect(ackCalls).toEqual([['cmd-a', 'cmd-b']]);
    // 回执清空：零丢失收口。
    expect(dispatcher.pendingAckCount).toBe(0);
  });

  it('补拉先消费、WS 同条后到 → duplicate 拦截不重放；回执重新排队下趟收敛', async () => {
    const cmdA = mkCommand('cmd-a');
    const { source, ackCalls } = mkControlSource([cmdA]);
    const handler = vi.fn(async () => {});
    const dispatcher = new ControlDispatcher({
      handlers: { session_inject: handler },
      source,
      logger: null,
    });

    // 通道一：补拉（WS 断线窗口 backend 保持 pending 的指令）。
    const first = await dispatcher.pullAndConsume('rt-1');
    expect(first).toEqual({ pulled: 1, consumed: 1, acked: 1 });
    expect(handler).toHaveBeenCalledTimes(1);

    // 通道二：补拉在途时 backend WS 推送同条到达（payload 尾部带同一 command_id）。
    const wsOutcome = await dispatcher.consume('session_inject', cmdA.payload, {
      commandId: 'cmd-a',
      runtimeId: 'rt-1',
    });

    expect(wsOutcome).toBe('duplicate');
    expect(handler).toHaveBeenCalledTimes(1); // 不二次执行
    // duplicate 重新排队回执：下一趟补拉捎带（backend ack 幂等，重发无害）。
    expect(dispatcher.pendingAckCount).toBe(1);
    const second = await dispatcher.pullAndConsume('rt-1');
    expect(second.acked).toBe(1);
    expect(ackCalls).toEqual([['cmd-a'], ['cmd-a']]);
    expect(dispatcher.pendingAckCount).toBe(0);
  });
});

// ── 场景③：daemon 重启会话恢复全链 ────────────────────────────────────────────

describe('场景③ daemon 侧：stop 挂起 → 重启恢复 → restore → confirm 全链', () => {
  let holder: Daemon | null = null;

  afterEach(async () => {
    if (holder?.isRunning) {
      await holder.stop().catch(() => undefined);
    }
    holder = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('stop() 先 suspend-batch 再 markOffline；重启后网络失败保留 → 重试 → restore+confirm', async () => {
    // ── 第一次运行：优雅停止（suspend-batch 先于 markOffline，design A5）──
    const stopOrder: string[] = [];
    const client1 = mkClient();
    client1.suspendSessions = vi.fn(async () => {
      stopOrder.push('suspend');
      return { suspended: 1, runs_failed: 1 };
    });
    client1.markOffline = vi.fn(async () => {
      stopOrder.push('markOffline');
      return {};
    });
    const rec = mkRecord();
    const rc1 = mkRecoveryClient();
    // 第一次运行无遗留记录（sessions.json 该会话记录在运行期写入，stop 时保留）。
    const first = buildDaemon({ records: [], recoveryClient: rc1, client: client1 });
    holder = first.daemon;
    await first.daemon.start();
    await first.daemon.stop();
    holder = null;
    expect(stopOrder).toEqual(['suspend', 'markOffline']);
    expect(client1.suspendSessions).toHaveBeenCalledWith('rt-uuid-1');

    // ── 第二次运行（模拟重启）：boot recover 网络失败保留记录 → WS 重连重试
    //    → 业务 reconnecting → restore（fake SessionManager）→ confirm 全链 ──
    const restartedRecord = mkRecord(); // 重启后从 sessions.json 读回的记录
    const rc2 = mkRecoveryClient();
    rc2.recoverSession.mockRejectedValueOnce(new TypeError('fetch failed'));
    const second = buildDaemon({ records: [restartedRecord], recoveryClient: rc2 });
    holder = second.daemon;
    await second.daemon.start();

    // boot 第一次 recover：网络失败 → 记录保留（不删、不 restore）。
    expect(rc2.recoverSession).toHaveBeenCalledTimes(1);
    expect(second.sm.restoreSpy).not.toHaveBeenCalled();
    const afterFail = second.persistence.saved.at(-1) ?? [];
    expect(afterFail.find((r) => r.sessionId === 'sess-1')).toBeDefined();

    // WS 重连成功（backend 可达信号）→ 立即重试一轮：业务返回 reconnecting。
    second.ws.triggerOnConnected();
    await vi.waitFor(() =>
      expect(rc2.recoverSession).toHaveBeenCalledTimes(2),
    );
    expect(rc2.recoverSession).toHaveBeenNthCalledWith(2, 'sess-1', {
      leaseId: 'lease-1',
      runtimeId: 'srv-rt-claude',
      provider: 'claude',
      agentSessionId: 'sdk-sess-1',
      interruptedRunId: undefined,
    });

    // restoreAndReconnect（fake SessionManager）成功 → markReconnected + confirm。
    await vi.waitFor(() =>
      expect(second.sm.markReconnectedSpy).toHaveBeenCalledWith('sess-1'),
    );
    expect(second.sm.restoreSpy).toHaveBeenCalledWith(restartedRecord);
    expect(rc2.confirmReconnected).toHaveBeenCalledWith('sess-1');
    await second.daemon.stop();
    holder = null;
  });
});

// ── 场景③（续）：claimToken 空窗消息入箱 → token 刷新后重放 ────────────────────

/** 内存 outbox（实现 Outbox 接口的最小内存版，drain 编排用）。 */
function mkMemoryOutbox() {
  const pending = new Map<string, OutboxEntry[]>();
  const outbox: Outbox & { snapshot(): OutboxEntry[] } = {
    enqueue: vi.fn(async (entry: OutboxEntry) => {
      const list = pending.get(entry.runId) ?? [];
      list.push(entry);
      pending.set(entry.runId, list);
    }),
    markDelivered: vi.fn(async (runId: string, dedupKeys: string[]) => {
      const list = pending.get(runId) ?? [];
      pending.set(
        runId,
        list.filter(
          (e) => !e.envelopes.some((env) => dedupKeys.includes(env.dedup_key)),
        ),
      );
    }),
    pendingByRun: vi.fn((runId: string) => (pending.get(runId) ?? []).slice()),
    runs: vi.fn(() =>
      [...pending.entries()].filter(([, list]) => list.length > 0).map(([k]) => k),
    ),
    load: vi.fn(async () => undefined),
    snapshot: () => [...pending.values()].flat(),
  };
  return outbox;
}

/** 瞬时重试配置：baseDelay=0 → real timer 下重试几乎瞬时（既有先例）。 */
const fastRetry: RetryConfig = {
  maxAttempts: 2,
  baseDelayMs: 0,
  backoffFactor: 2,
  jitter: 0,
};

function noopLogger(): ResilienceLogger {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

describe('场景③ daemon 侧：claimToken 空窗消息入箱 → token 刷新后重放', () => {
  it('恢复空窗（无 token）消息 pending_token 入箱；SESSION_INJECT 刷新后 drain 用新 token 重放', async () => {
    const submit = vi.fn(async () => {
      throw new TypeError('fetch failed'); // 空窗期网络未恢复
    });
    const client: SubmitClient = { submitMessages: submit };
    const outbox = mkMemoryOutbox();
    const svc = new ResilienceService(client, outbox, fastRetry, noopLogger());
    const envelopes: Envelope[] = [
      { message: { seq: 0 }, dedup_key: 'dk-0' },
      { message: { seq: 1 }, dedup_key: 'dk-1' },
    ];

    // daemon onTurnMessage 遇 no_claim_token：不再丢弃，pending_token 入箱。
    await svc.enqueuePendingToken('lease-1', 'run-1', envelopes);
    expect(outbox.runs()).toEqual(['run-1']);
    expect(outbox.snapshot()[0]?.pending_token).toBe(true);

    // 空窗期 drain：refresher 拿不到 token（SESSION_INJECT 未到）→ 回落 entry
    // 原值（空串）重试；网络不通（可重试失败用尽）→ entry 保留不丢弃。
    svc.setClaimTokenRefresher(async () => null);
    await svc.drainOutbox();
    expect(outbox.runs()).toEqual(['run-1']);
    expect(submit).toHaveBeenCalledTimes(2); // fastRetry.maxAttempts=2 次尝试均失败
    const gapToken = (submit.mock.calls[0] as [string, string, string])[1];
    expect(gapToken).toBe(''); // 空窗期回落空串原值（backend dedup/终态规则兜底）

    // SESSION_INJECT 到达：claim_token 刷新（refresher 返回新 token）+ 网络恢复
    // → drain 重放成功、按 dedup_key 收口。
    svc.setClaimTokenRefresher(async () => 'tok-refreshed');
    submit.mockClear();
    submit.mockImplementation(async () => ({}));
    await svc.drainOutbox();

    expect(submit).toHaveBeenCalledTimes(1);
    const [leaseId, token, runId, messages] = submit.mock.calls[0] as [
      string,
      string,
      string,
      Record<string, unknown>[],
    ];
    expect(leaseId).toBe('lease-1');
    expect(token).toBe('tok-refreshed'); // 刷新后的 token 重放（非空串原值）
    expect(runId).toBe('run-1');
    expect(messages).toEqual([
      { seq: 0, dedup_key: 'dk-0' },
      { seq: 1, dedup_key: 'dk-1' },
    ]);
    expect(outbox.runs()).toEqual([]); // markDelivered 收口，零丢失
  });
});
