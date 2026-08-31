// tests/daemon-inject-drop-report.test.ts
// ql-20260831-005：SESSION_INJECT 四条静默丢弃路径改为立即回报 run failed。
//
// 实机背景（生产 wp 机会话 84cf91ab）：inject 已 delivered 但被
// _routeSessionControl 校验路径丢弃（只 warn 不回报），run 在 backend 挂起
// pending，10 分钟后才被控制指令 GC 用笼统 interactive_inject_send_failed
// 收敛——丢弃原因永远到不了前端。修：丢弃时用 payload 自带的
// run_id/lease_id/claim_token 调 notifyRunResult（P2b 同款
// error_during_execution + is_error + result_summary），summary 落
// output_redacted → SessionRunRead.failure_summary 透出（ql-20260831-004 链）。
//
// ql-20260831-006（quick）：not_found 丢弃前先经 _awaitSessionThenRoute 分离式
// 等待（默认 60s，env SILLYHUB_INJECT_WAIT_SESSION_MS 可调；实机 create 慢启动
// ~31s > 后端 ready 等待 8s，原 3×100ms 重试耗尽即报失败把竞态变成必死）。
// 测试统一把等待窗压到 150ms 控时。
//
// 覆盖：
//   A. session_not_found（等待窗口超时后仍无）→ 上报，summary 含原因
//   B. lease_mismatch → 上报
//   C. missing_fields：prompt 空 + run_id 在 → 上报；run_id 缺 → 不上报（无法定位 run）
//   D. no_manager → 上报
//   E. 正常路径（会话在 + lease 匹配 + 字段齐）→ 走 inject，绝不多报
//   F. payload 缺 claim_token → 跳过上报（过不了 lease 校验），仅 warn
//   G. 会话在等待窗口内晚到（ql-20260831-006）→ 正常 inject，绝不报失败
//   H. 等待中停机（quick 风险审查修 2026-09-01）→ 下一拍轮询即中止，不上报
//      失败（未处理原因是 daemon 退出而非会话未建）、不等满窗口

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Daemon } from '../src/daemon.js';
import { MSG } from '../src/protocol.js';
import type { DaemonConfig } from '../src/config.js';
import type { DetectedAgent } from '../src/agent-detector.js';
import type { SessionManager } from '../src/interactive/session-manager.js';

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
    notifySessionReady: vi.fn(async () => ({})),
    confirmReconnected: vi.fn(async () => ({})),
    markRecoveryFailed: vi.fn(async () => ({})),
  };
}

/** localState：模拟 daemon 本地 SessionStore 的条目（leaseId 用于匹配校验）。 */
function createMockSessionManager(localState?: { leaseId: string }): SessionManager {
  return {
    create: vi.fn(async () => {}),
    inject: vi.fn(async () => ({ runId: 'run-ok' })),
    interrupt: vi.fn(async () => false),
    end: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    get: vi.fn(() =>
      localState
        ? ({ sessionId: 'sess-1', leaseId: localState.leaseId, status: 'active' })
        : undefined,
    ),
    start: vi.fn(() => {}),
    stop: vi.fn(() => {}),
    manualApproval: false,
    getPermissionResolver: vi.fn(() => undefined),
    getPendingInjectCount: vi.fn(() => 0),
    getIdleTimeoutSec: vi.fn(() => 1800),
    restoreAndReconnect: vi.fn(async () => {}),
    markReconnected: vi.fn(async () => {}),
    refreshClaimToken: vi.fn(async () => {}),
    flush: vi.fn(async () => {}),
    snapshotPersistable: vi.fn(() => []),
    scanOnce: vi.fn(async () => {}),
  } as unknown as SessionManager;
}

function buildDaemon(
  sm: SessionManager | null,
  client = createMockClient(),
): { daemon: Daemon; sm: SessionManager | null; client: typeof client } {
  const detector = { detectAgents: vi.fn(async () => [] as DetectedAgent[]) };
  const daemon = new Daemon(
    mockConfig,
    client as never,
    { runLease: vi.fn(async () => ({})) } as never,
    { detector, sessionManager: sm } as never,
  );
  // quick 风险审查修（2026-09-01）起 _awaitSessionThenRoute 轮询感知停机
  // （!_running 即中止）。本测试不跑 start() 全链，构造态 _running=false 会被
  // 误判停机——统一置真模拟「运行中的 daemon 收到 inject」这一被测前提
  // （等待路径只存在于运行态；用例 H 自行中途置假驱动停机分支）。
  (daemon as unknown as { _running: boolean })._running = true;
  return { daemon, sm, client };
}

async function emitInject(
  daemon: Daemon,
  payload: Record<string, unknown>,
): Promise<void> {
  const handle = (
    daemon as unknown as {
      _handleWsMessage: (m: { type: string; payload: unknown }) => Promise<void>;
    }
  )._handleWsMessage.bind(daemon);
  await handle({ type: MSG.SESSION_INJECT, payload });
  // void Promise 分发 + not_found 分离等待（测试窗 150ms + 轮询 100ms），等满窗口。
  await new Promise((r) => setTimeout(r, 450));
}

const FULL_PAYLOAD: Record<string, unknown> = {
  session_id: 'sess-1',
  lease_id: 'lease-1',
  run_id: 'run-1',
  prompt: '干活',
  claim_token: 'token-1',
};

// ql-20260831-006：等待窗 env 键；测试统一压到 150ms 控时（默认 60s 会挂死单测）。
const WAIT_ENV = 'SILLYHUB_INJECT_WAIT_SESSION_MS';

describe('daemon SESSION_INJECT 丢弃即回报（ql-20260831-005/006）', () => {
  let daemons: Daemon[] = [];

  beforeEach(() => {
    process.env[WAIT_ENV] = '150';
  });

  afterEach(async () => {
    for (const d of daemons) {
      if (d.isRunning) {
        await d.stop().catch(() => undefined);
      }
    }
    daemons = [];
    delete process.env[WAIT_ENV];
  });

  it('A. session_not_found（等待窗口超时后仍无本地状态）→ notifyRunResult 失败带原因', async () => {
    const { daemon, client } = buildDaemon(createMockSessionManager(undefined));
    daemons.push(daemon);

    await emitInject(daemon, FULL_PAYLOAD);

    expect(client.notifyRunResult).toHaveBeenCalledTimes(1);
    const [leaseId, claimToken, runId, payload] = client.notifyRunResult.mock.calls[0]!;
    expect(leaseId).toBe('lease-1');
    expect(claimToken).toBe('token-1');
    expect(runId).toBe('run-1');
    expect(payload).toMatchObject({ status: 'error_during_execution', is_error: true });
    expect(payload.result_summary as string).toContain('本地无该会话状态');
  });

  it('B. lease_mismatch → notifyRunResult 失败带原因', async () => {
    // 本地会话 lease 是 lease-9，指令带 lease-1 → 不匹配。
    const { daemon, client } = buildDaemon(createMockSessionManager({ leaseId: 'lease-9' }));
    daemons.push(daemon);

    await emitInject(daemon, FULL_PAYLOAD);

    expect(client.notifyRunResult).toHaveBeenCalledTimes(1);
    const payload = client.notifyRunResult.mock.calls[0]![3];
    expect(payload.result_summary as string).toContain('lease 不一致');
  });

  it('C. missing_fields：run_id 在 + prompt 空 → 上报；run_id 缺 → 不上报', async () => {
    // C1：prompt 空、run_id 在 → 可定位 run，上报。
    const c1 = buildDaemon(createMockSessionManager({ leaseId: 'lease-1' }));
    daemons.push(c1.daemon);
    await emitInject(c1.daemon, { ...FULL_PAYLOAD, prompt: '' });
    expect(c1.client.notifyRunResult).toHaveBeenCalledTimes(1);
    expect(
      c1.client.notifyRunResult.mock.calls[0]![3].result_summary as string,
    ).toContain('缺少必要字段');

    // C2：run_id 缺 → 无法定位 run，维持纯 warn（GC 兜底仍在）。
    const c2 = buildDaemon(createMockSessionManager({ leaseId: 'lease-1' }));
    daemons.push(c2.daemon);
    await emitInject(c2.daemon, { ...FULL_PAYLOAD, run_id: '', prompt: '' });
    expect(c2.client.notifyRunResult).not.toHaveBeenCalled();
  });

  it('D. no_manager → notifyRunResult 失败带原因', async () => {
    const { daemon, client } = buildDaemon(null);
    daemons.push(daemon);

    await emitInject(daemon, FULL_PAYLOAD);

    expect(client.notifyRunResult).toHaveBeenCalledTimes(1);
    const payload = client.notifyRunResult.mock.calls[0]![3];
    expect(payload.result_summary as string).toContain('会话管理器未初始化');
  });

  it('E. 正常路径（会话在 + lease 匹配 + 字段齐）→ inject 执行，绝不多报', async () => {
    const sm = createMockSessionManager({ leaseId: 'lease-1' });
    const { daemon, client } = buildDaemon(sm);
    daemons.push(daemon);

    await emitInject(daemon, FULL_PAYLOAD);

    expect(sm.inject).toHaveBeenCalledTimes(1);
    expect(client.notifyRunResult).not.toHaveBeenCalled();
  });

  it('F. payload 缺 claim_token → 跳过上报（过不了 lease 校验），仅 warn', async () => {
    const { daemon, client } = buildDaemon(createMockSessionManager(undefined));
    daemons.push(daemon);

    const { claim_token: _omit, ...noToken } = FULL_PAYLOAD;
    await emitInject(daemon, noToken);

    expect(client.notifyRunResult).not.toHaveBeenCalled();
  });

  it('G. 会话在等待窗口内晚到（ql-20260831-006 慢启动竞态）→ 正常 inject，绝不报失败', async () => {
    // 复现实机形状：inject 到达时 store 无会话（create 未完成），~200ms 后会话
    // 出现（原 3×100ms 重试窗口耗尽必丢弃 + 上报失败；现等待窗内接住）。
    process.env[WAIT_ENV] = '600';
    const appearAt = Date.now() + 200;
    const sm = createMockSessionManager({ leaseId: 'lease-1' });
    (sm.get as ReturnType<typeof vi.fn>).mockImplementation(() =>
      Date.now() >= appearAt
        ? { sessionId: 'sess-1', leaseId: 'lease-1', status: 'active' }
        : undefined,
    );
    const { daemon, client } = buildDaemon(sm);
    daemons.push(daemon);

    await emitInject(daemon, FULL_PAYLOAD);

    expect(sm.inject).toHaveBeenCalledTimes(1);
    expect(client.notifyRunResult).not.toHaveBeenCalled();
  });

  it('H. 等待中停机（quick 风险审查修）→ 轮询感知 _running=false 即中止，不上报、不等满窗口', async () => {
    // 窗口拉到 5s：若轮询不感知停机，本用例要么等满 5s、要么上报失败（均错）。
    // 修复后 120ms 处置 _running=false，下一拍 100ms 轮询即中止——emitInject
    // 自带 450ms 收敛等待，总耗时应远小于窗口。
    process.env[WAIT_ENV] = '5000';
    const sm = createMockSessionManager(undefined);
    const { daemon, client } = buildDaemon(sm);
    daemons.push(daemon);

    // buildDaemon 已置运行态；120ms 处模拟 stop() 第一拍置 _running=false。
    const internal = daemon as unknown as { _running: boolean };
    setTimeout(() => {
      internal._running = false;
    }, 120);

    const t0 = Date.now();
    await emitInject(daemon, FULL_PAYLOAD);
    const elapsed = Date.now() - t0;

    expect(client.notifyRunResult).not.toHaveBeenCalled();
    expect(elapsed).toBeLessThan(2000);
  });
});
