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
//
// task-06（session-reopen-resume / DS-3 / FR-03 / FR-04）追加最小行为用例：
//   - 成功路径 confirmReconnected(sessionId, { leaseId, runtimeId })——runtimeId
//     取自 payload（F1 静默吞解除，不依赖 _recoveryRuntimeBySession 映射）；
//   - 失败路径（restoreAndReconnect 抛错，含 SessionAlreadyExistsError try 前
//     抛出场景）→ markRecoveryFailed(sessionId, reason, { leaseId, runtimeId })；
//   - confirmReconnected 自身抛错 best-effort：不阻塞 markReconnected /
//     notifySessionReady（完整防回归深化归 task-07）。

import { describe, it, expect, afterEach, vi } from 'vitest';
import { Daemon } from '../src/daemon.js';
import { MSG } from '../src/protocol.js';
import type { DaemonConfig } from '../src/config.js';
import type { DetectedAgent } from '../src/agent-detector.js';
import type { SessionManager } from '../src/interactive/session-manager.js';
import type { PersistedSessionRecord } from '../src/interactive/types.js';
import { SessionAlreadyExistsError } from '../src/interactive/types.js';

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
    // task-03（session-reopen-resume）：resume 成功后上报 ready（best-effort）。
    notifySessionReady: vi.fn(async () => ({})),
    // task-06（DS-3 / FR-03 / FR-04）：reopen 双向确认端点（可选方法，mock 补齐
    // 供断言；ClientLike 声明带 ?，真实 HubClient 已实现）。
    confirmReconnected: vi.fn(async () => ({})),
    markRecoveryFailed: vi.fn(async () => ({})),
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

function buildDaemon(
  sm: SessionManager | null = createMockSessionManager(),
  client: ReturnType<typeof createMockClient> = createMockClient(),
): {
  daemon: Daemon;
  sm: SessionManager;
  client: ReturnType<typeof createMockClient>;
} {
  const detector = { detectAgents: vi.fn(async () => [] as DetectedAgent[]) };
  const daemon = new Daemon(
    mockConfig,
    client as never,
    createMockTaskRunner() as never,
    { detector, sessionManager: sm } as never,
  );
  return { daemon, sm: sm as SessionManager, client };
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

describe('daemon SESSION_RESUME 双向确认（task-06 / session-reopen-resume / DS-3）', () => {
  let daemons: Daemon[] = [];

  afterEach(async () => {
    for (const d of daemons) {
      if (d.isRunning) {
        await d.stop().catch(() => undefined);
      }
    }
    daemons = [];
  });

  it('成功路径：confirmReconnected(sessionId, { leaseId, runtimeId })，runtimeId 取自 payload（F1）', async () => {
    const { daemon, sm, client } = buildDaemon();
    daemons.push(daemon);

    await emit(daemon, {
      type: MSG.SESSION_RESUME,
      payload: {
        session_id: 'sess-confirm-1',
        lease_id: 'lease-confirm-1',
        agent_session_id: 'agent-sid-confirm',
        cwd: '/tmp/p',
        provider: 'claude',
        runtime_id: 'runtime-from-payload',
      },
    });
    await new Promise((r) => setTimeout(r, 5));

    // FR-03：恢复成功必须真实发出 confirm（携 payload 的 leaseId/runtimeId，
    // 不依赖 _recoveryRuntimeBySession 映射——reopen 路径从未写映射）。
    expect(client.confirmReconnected).toHaveBeenCalledTimes(1);
    expect(client.confirmReconnected).toHaveBeenCalledWith('sess-confirm-1', {
      leaseId: 'lease-confirm-1',
      runtimeId: 'runtime-from-payload',
    });
    // 失败端点不应被触碰。
    expect(client.markRecoveryFailed).not.toHaveBeenCalled();
    // notifySessionReady 保持在其后（仍执行，不被 confirm 阻断）。
    expect(client.notifySessionReady).toHaveBeenCalledWith('sess-confirm-1');
    expect(
      client.confirmReconnected.mock.invocationCallOrder[0]!,
    ).toBeLessThan(client.notifySessionReady.mock.invocationCallOrder[0]!);
    expect(sm.markReconnected).toHaveBeenCalledWith('sess-confirm-1');
  });

  it('restoreAndReconnect 抛 SessionAlreadyExistsError（try 前抛出）→ markRecoveryFailed 携 reason 与 opts', async () => {
    const sm = createMockSessionManager();
    (sm.restoreAndReconnect as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new SessionAlreadyExistsError('sess-dup'),
    );
    const { daemon, client } = buildDaemon(sm);
    daemons.push(daemon);

    await expect(
      emit(daemon, {
        type: MSG.SESSION_RESUME,
        payload: {
          session_id: 'sess-dup',
          lease_id: 'lease-dup',
          agent_session_id: 'agent-sid-dup',
          cwd: '/tmp/dup',
          provider: 'claude',
          runtime_id: 'runtime-dup',
        },
      }),
    ).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 5));

    // FR-04：恢复失败立即向 backend 写 failed（不等 sweeper 兜底）。
    expect(client.markRecoveryFailed).toHaveBeenCalledTimes(1);
    const [sid, reason, opts] = client.markRecoveryFailed.mock.calls[0]!;
    expect(sid).toBe('sess-dup');
    expect(String(reason)).toContain('sess-dup');
    expect(opts).toEqual({ leaseId: 'lease-dup', runtimeId: 'runtime-dup' });
    // 失败路径不再走成功链（不 confirm、不 ready 上报）。
    expect(client.confirmReconnected).not.toHaveBeenCalled();
    expect(client.notifySessionReady).not.toHaveBeenCalled();
  });

  it('restoreAndReconnect 抛普通错误 → markRecoveryFailed 携 reason 与 opts（不向上抛）', async () => {
    const sm = createMockSessionManager();
    (sm.restoreAndReconnect as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('driver.start failed: SDK jsonl missing'),
    );
    const { daemon, client } = buildDaemon(sm);
    daemons.push(daemon);

    await expect(
      emit(daemon, {
        type: MSG.SESSION_RESUME,
        payload: {
          session_id: 'sess-boom',
          lease_id: 'lease-boom',
          agent_session_id: 'agent-sid-boom',
          cwd: '/tmp/boom',
          provider: 'claude',
          runtime_id: 'runtime-boom',
        },
      }),
    ).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 5));

    expect(client.markRecoveryFailed).toHaveBeenCalledTimes(1);
    const [sid, reason, opts] = client.markRecoveryFailed.mock.calls[0]!;
    expect(sid).toBe('sess-boom');
    expect(String(reason)).toContain('driver.start failed');
    expect(opts).toEqual({ leaseId: 'lease-boom', runtimeId: 'runtime-boom' });
  });

  it('confirmReconnected 抛错 → best-effort 不阻塞（markReconnected / notifySessionReady 仍执行）', async () => {
    const client = createMockClient();
    client.confirmReconnected.mockRejectedValueOnce(new Error('backend 502'));
    const { daemon, sm } = buildDaemon(createMockSessionManager(), client);
    daemons.push(daemon);

    await expect(
      emit(daemon, {
        type: MSG.SESSION_RESUME,
        payload: {
          session_id: 'sess-502',
          lease_id: 'lease-502',
          agent_session_id: 'agent-sid-502',
          cwd: '/tmp/502',
          provider: 'claude',
          runtime_id: 'runtime-502',
        },
      }),
    ).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 5));

    // confirm HTTP 失败仅 warn：本地已恢复 active 不回滚，ready 上报继续
    //（backend 180s sweeper 兜底收敛）。
    expect(client.confirmReconnected).toHaveBeenCalledTimes(1);
    expect(sm.markReconnected).toHaveBeenCalledWith('sess-502');
    expect(client.notifySessionReady).toHaveBeenCalledWith('sess-502');
    expect(client.markRecoveryFailed).not.toHaveBeenCalled();
  });
});

// ql-20260827-014（reopen 丢供应商凭证修复）：SESSION_RESUME 随带的会话级
// provider_config 必须透传进 record.providerConfig——restoreAndReconnect 由此
// 重建供应商 env（buildSpawnEnv 第 0 层）。缺该透传时恢复出的 SDK 子进程无
// 凭证（隔离 CLAUDE_CONFIG_DIR 无本机 OAuth 兜底）→ "Not logged in" 秒退 →
// daemon 上报 end → 会话秒回 ended（生产实证：每次重开约 2s 死亡循环）。
describe('daemon SESSION_RESUME 供应商凭证透传（ql-20260827-014）', () => {
  let daemons: Daemon[] = [];

  afterEach(async () => {
    for (const d of daemons) {
      if (d.isRunning) {
        await d.stop().catch(() => undefined);
      }
    }
    daemons = [];
  });

  const providerConfig = {
    agent_kind: 'claude',
    base_url: 'https://open.bigmodel.cn/api/anthropic',
    api_key: 'sk-reopen-key',
    api_format: 'anthropic',
  };

  it('snake provider_config → record.providerConfig 原样透传', async () => {
    const { daemon, sm } = buildDaemon();
    daemons.push(daemon);

    await emit(daemon, {
      type: MSG.SESSION_RESUME,
      payload: {
        session_id: 'sess-prov-1',
        lease_id: 'lease-prov-1',
        agent_session_id: 'agent-sid-prov',
        cwd: '/tmp/prov',
        provider: 'claude',
        runtime_id: 'runtime-prov',
        provider_config: providerConfig,
      },
    });
    await new Promise((r) => setTimeout(r, 5));

    expect(sm.restoreAndReconnect).toHaveBeenCalledTimes(1);
    const record = sm.restoreAndReconnect.mock.calls[0]![0] as PersistedSessionRecord;
    expect(record.providerConfig).toEqual(providerConfig);
  });

  it('camel providerConfig 兼容（双读归一）', async () => {
    const { daemon, sm } = buildDaemon();
    daemons.push(daemon);

    await emit(daemon, {
      type: MSG.SESSION_RESUME,
      payload: {
        session_id: 'sess-prov-2',
        lease_id: 'lease-prov-2',
        agent_session_id: 'agent-sid-prov2',
        cwd: '/tmp/prov2',
        provider: 'claude',
        providerConfig: providerConfig,
      },
    });
    await new Promise((r) => setTimeout(r, 5));

    const record = sm.restoreAndReconnect.mock.calls[0]![0] as PersistedSessionRecord;
    expect(record.providerConfig).toEqual(providerConfig);
  });

  it('payload 不带凭证键 → record.providerConfig 保持 undefined（本机凭证链零回归）', async () => {
    const { daemon, sm } = buildDaemon();
    daemons.push(daemon);

    await emit(daemon, {
      type: MSG.SESSION_RESUME,
      payload: {
        session_id: 'sess-prov-3',
        lease_id: 'lease-prov-3',
        agent_session_id: 'agent-sid-prov3',
        cwd: '/tmp/prov3',
        provider: 'claude',
      },
    });
    await new Promise((r) => setTimeout(r, 5));

    const record = sm.restoreAndReconnect.mock.calls[0]![0] as PersistedSessionRecord;
    expect(record.providerConfig).toBeUndefined();
  });
});

// FR-01（2026-11-02-daemon-resume-gate-fix）：恢复不续命——reopen 记录的
// lastActiveAt 三级取值（payload 显式值 → 本地 sessions.json 记录原值 →
// Date.now() 兜底）。恒写 now 会把断网恢复风暴全量 reopen 的会话集体顶成
// 「30 分钟内活跃」，被 create 前置会话闸误拒新建（2026-11-02 46≥20 实证
// SESSION_LIMIT_REACHED）；boot 恢复路径（restoreAndReconnect）本就保留
// record.lastActiveAt，本行为与其对齐。
describe('daemon SESSION_RESUME 恢复不续命 lastActiveAt（FR-01 / 2026-11-02-daemon-resume-gate-fix）', () => {
  let daemons: Daemon[] = [];

  afterEach(async () => {
    for (const d of daemons) {
      if (d.isRunning) {
        await d.stop().catch(() => undefined);
      }
    }
    daemons = [];
  });

  function createFakePersistence(records: unknown[]) {
    return {
      load: vi.fn(async () => records),
      save: vi.fn(async () => {}),
    };
  }

  function buildDaemonWithPersistence(
    persistence: ReturnType<typeof createFakePersistence>,
  ): {
    daemon: Daemon;
    sm: SessionManager;
    client: ReturnType<typeof createMockClient>;
    persistence: ReturnType<typeof createFakePersistence>;
  } {
    const detector = { detectAgents: vi.fn(async () => [] as DetectedAgent[]) };
    const client = createMockClient();
    const sm = createMockSessionManager();
    const daemon = new Daemon(
      mockConfig,
      client as never,
      createMockTaskRunner() as never,
      { detector, sessionManager: sm, persistence } as never,
    );
    return { daemon, sm: sm as SessionManager, client, persistence };
  }

  it('本地持久化记录存在 → record.lastActiveAt 保留原值（恢复不续命）', async () => {
    // 2023-11 的真实历史活跃，远早于当下——若实现仍恒写 Date.now() 即红。
    const preserved = 1700000000000;
    const persistence = createFakePersistence([
      {
        sessionId: 'sess-preserve',
        leaseId: 'lease-old',
        agentSessionId: 'agent-sid-preserve',
        cwd: '/tmp/preserve',
        provider: 'claude',
        turnCount: 3,
        lastActiveAt: preserved,
      },
    ]);
    const { daemon, sm } = buildDaemonWithPersistence(persistence);
    daemons.push(daemon);

    await emit(daemon, {
      type: MSG.SESSION_RESUME,
      payload: {
        session_id: 'sess-preserve',
        lease_id: 'lease-new',
        agent_session_id: 'agent-sid-preserve',
        cwd: '/tmp/preserve',
        provider: 'claude',
      },
    });
    await new Promise((r) => setTimeout(r, 5));

    expect(sm.restoreAndReconnect).toHaveBeenCalledTimes(1);
    const record = sm.restoreAndReconnect.mock.calls[0]![0] as PersistedSessionRecord;
    expect(record.lastActiveAt).toBe(preserved);
    expect(record.lastActiveAt).toBeLessThan(Date.now() - 60_000);
  });

  it('payload 显式 last_active_at 优先于本地记录（协议前向兼容位）', async () => {
    const payloadTs = 1750000000000;
    const localTs = 1700000000000;
    const persistence = createFakePersistence([
      {
        sessionId: 'sess-payload-ts',
        leaseId: 'lease-old-ts',
        agentSessionId: 'agent-sid-ts',
        cwd: '/tmp/ts',
        provider: 'claude',
        turnCount: 1,
        lastActiveAt: localTs,
      },
    ]);
    const { daemon, sm } = buildDaemonWithPersistence(persistence);
    daemons.push(daemon);

    await emit(daemon, {
      type: MSG.SESSION_RESUME,
      payload: {
        session_id: 'sess-payload-ts',
        lease_id: 'lease-new-ts',
        agent_session_id: 'agent-sid-ts',
        cwd: '/tmp/ts',
        provider: 'claude',
        last_active_at: payloadTs,
      },
    });
    await new Promise((r) => setTimeout(r, 5));

    const record = sm.restoreAndReconnect.mock.calls[0]![0] as PersistedSessionRecord;
    expect(record.lastActiveAt).toBe(payloadTs);
  });

  it('无本地记录且 payload 未带 → 兜底 Date.now()（现状维持）', async () => {
    const persistence = createFakePersistence([]);
    const { daemon, sm } = buildDaemonWithPersistence(persistence);
    daemons.push(daemon);

    const before = Date.now();
    await emit(daemon, {
      type: MSG.SESSION_RESUME,
      payload: {
        session_id: 'sess-no-record',
        lease_id: 'lease-no-record',
        agent_session_id: 'agent-sid-nr',
        cwd: '/tmp/nr',
        provider: 'claude',
      },
    });
    await new Promise((r) => setTimeout(r, 5));

    const record = sm.restoreAndReconnect.mock.calls[0]![0] as PersistedSessionRecord;
    expect(record.lastActiveAt).toBeGreaterThanOrEqual(before);
    expect(record.lastActiveAt).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('persistence.load 抛错 → 兜底 Date.now() 且 resume 不中断', async () => {
    const persistence = createFakePersistence([]);
    persistence.load = vi.fn(async () => {
      throw new Error('corrupt sessions.json');
    });
    const { daemon, sm } = buildDaemonWithPersistence(persistence);
    daemons.push(daemon);

    const before = Date.now();
    await emit(daemon, {
      type: MSG.SESSION_RESUME,
      payload: {
        session_id: 'sess-load-boom',
        lease_id: 'lease-load-boom',
        agent_session_id: 'agent-sid-lb',
        cwd: '/tmp/lb',
        provider: 'claude',
      },
    });
    await new Promise((r) => setTimeout(r, 5));

    expect(sm.restoreAndReconnect).toHaveBeenCalledTimes(1);
    const record = sm.restoreAndReconnect.mock.calls[0]![0] as PersistedSessionRecord;
    expect(record.lastActiveAt).toBeGreaterThanOrEqual(before);
  });
});
