// tests/daemon-session-resume-confirm.test.ts
// task-07（session-reopen-resume / NFR-02）：daemon 侧双向确认契约的完整防回归
// 深化。task-06 已在 daemon-session-resume-route.test.ts 落了 4 个最小行为用例
//（成功 confirm / SessionAlreadyExists / 一般 Error / confirm best-effort），
// 本文件不重复它们，按 task-07.md 四组用例补全强化（断言全部基于 vi.fn 的
// .calls 实参记录，不起真 WS/HTTP）：
//
//   组 1（F1 防回归，核心）：confirmReconnected 真实发出且实参 runtimeId /
//       leaseId 逐字段非 undefined / 非空串 / === payload 值——hub-client
//       `if (!runtimeId) return` 静默 guard（hub-client.ts confirmReconnected）
//       复发时 daemon 传出的实参即 undefined/''，本断言必红。另锁调用链顺序
//       restore → markReconnected → confirm → notifySessionReady。
//   组 2：restoreAndReconnect reject SessionAlreadyExistsError（模拟
//       session-manager 在内部 try 块之前直接 throw）→ markRecoveryFailed
//       恰一次、reason 可辨识（含错误类别 + sessionId）、opts 三段齐全；
//       markReconnected 从未被调（本地从未切 active）。
//   组 3：restoreAndReconnect reject 一般 Error → markRecoveryFailed 立即上报
//       （不等 backend 180s sweeper 兜底）；补 markReconnected 自身抛错的
//       同 catch 收敛分支（daemon.ts _routeSessionResume 的 try 同时包住
//       restoreAndReconnect 与 markReconnected 两个 await）。
//   组 4（best-effort）：confirmReconnected reject → 本地不回滚（restore /
//       markReconnected 不重放）、不误报 markRecoveryFailed、后续 WS 消息
//       仍可正常处理（主循环存活）；markRecoveryFailed 自身 reject 也仅
//       warn 不向上抛（失败上报失败不拖垮 daemon，也不误入成功链）。
//
// 实现依据：src/daemon.ts _routeSessionResume（runtimeId 取自 payload 的
// snake/camel 归一化；成功链 confirm best-effort + notifySessionReady；失败链
// markRecoveryFailed best-effort 后 return）；src/hub-client.ts
// confirmReconnected / markRecoveryFailed 的 `if (!runtimeId) return` 静默 guard
// 正是 F1 要防的缺陷形态。

import { describe, it, expect, afterEach, vi } from 'vitest';
import { Daemon } from '../src/daemon.js';
import { MSG } from '../src/protocol.js';
import type { DaemonConfig } from '../src/config.js';
import type { DetectedAgent } from '../src/agent-detector.js';
import type { SessionManager } from '../src/interactive/session-manager.js';
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

// 与 daemon-session-resume-route.test.ts 同套 helper（本文件独立建，避免
// 跨测试文件 import）。
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

function createMockTaskRunner() {
  return { runLease: vi.fn(async () => ({})) };
}

function createMockSessionManager(): SessionManager {
  return {
    create: vi.fn(async () => {}),
    inject: vi.fn(async () => ({ runId: '' })),
    interrupt: vi.fn(async () => false),
    end: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
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

// _handleWsMessage 是 private；经 unknown 透传调用（同 route 测试）。内部
// SESSION_CONTROL 分支是 void 非阻塞分发，emit 后需等 microtask 落地。
async function emit(daemon: Daemon, msg: {
  type: string;
  payload: unknown;
}): Promise<void> {
  const handle = (
    daemon as unknown as {
      _handleWsMessage: (m: { type: string; payload: unknown }) => Promise<void>;
    }
  )._handleWsMessage.bind(daemon);
  await handle(msg);
}

async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 5));
}

describe('daemon SESSION_RESUME 双向确认深化（task-07 / NFR-02）', () => {
  let daemons: Daemon[] = [];

  afterEach(async () => {
    for (const d of daemons) {
      if (d.isRunning) {
        await d.stop().catch(() => undefined);
      }
    }
    daemons = [];
  });

  // ── 组 1（F1 防回归，核心）───────────────────────────────────────────────

  it('F1：confirm 真实发出一次，实参 sessionId/leaseId/runtimeId 逐字段 === payload 且非 undefined/非空串，全链有序', async () => {
    const { daemon, sm, client } = buildDaemon();
    daemons.push(daemon);

    // payload 的 runtime_id 故意不同于 daemon 自身 config.runtime_id——
    // 锁死「来源必须是 SESSION_RESUME payload」，防止回归成读 config /
    // _recoveryRuntimeBySession 映射（reopen 路径从未写该映射）。
    await emit(daemon, {
      type: MSG.SESSION_RESUME,
      payload: {
        session_id: 'sess-f1',
        lease_id: 'lease-f1',
        agent_session_id: 'agent-sid-f1',
        cwd: '/tmp/f1',
        provider: 'claude',
        runtime_id: 'rt-payload-9',
      },
    });
    await settle();

    // 真实发出：恰一次（不重复发、不丢发）。
    expect(client.confirmReconnected.mock.calls.length).toBe(1);

    // 逐字段断言实参（不用 toMatchObject——undefined/'' 混入必须当场红）。
    const [sid, opts] = client.confirmReconnected.mock.calls[0]!;
    expect(sid).toBe('sess-f1');
    expect(typeof sid).toBe('string');
    expect(sid.length).toBeGreaterThan(0);
    expect(opts?.leaseId).toBeDefined();
    expect(typeof opts?.leaseId).toBe('string');
    expect(opts?.leaseId).not.toBe('');
    expect(opts?.leaseId).toBe('lease-f1');
    // F1 核心：runtimeId 非 undefined / 非空串 / === payload.runtime_id。
    // hub-client `if (!runtimeId) return` 静默 guard 复发（daemon 传出
    // undefined）时这里必红。
    expect(opts?.runtimeId).toBeDefined();
    expect(typeof opts?.runtimeId).toBe('string');
    expect(opts?.runtimeId).not.toBe('');
    expect(opts?.runtimeId).toBe('rt-payload-9');
    expect(opts?.runtimeId).not.toBe(mockConfig.runtime_id);

    // 失败端点不触碰。
    expect(client.markRecoveryFailed).not.toHaveBeenCalled();

    // 全链顺序：restore → markReconnected（本地切 active）→ confirm（backend
    // 翻 active）→ notifySessionReady。invocationCallOrder 是全局单调计数，
    // 跨 mock 可比。
    expect(
      (sm.restoreAndReconnect as ReturnType<typeof vi.fn>).mock
        .invocationCallOrder[0]!,
    ).toBeLessThan(sm.markReconnected.mock.invocationCallOrder[0]!);
    expect(sm.markReconnected.mock.invocationCallOrder[0]!).toBeLessThan(
      client.confirmReconnected.mock.invocationCallOrder[0]!,
    );
    expect(client.confirmReconnected.mock.invocationCallOrder[0]!).toBeLessThan(
      client.notifySessionReady.mock.invocationCallOrder[0]!,
    );
  });

  it('F1：camelCase payload（runtimeId/leaseId）→ confirm 实参同样非空且映射正确', async () => {
    const { daemon, client } = buildDaemon();
    daemons.push(daemon);

    await emit(daemon, {
      type: MSG.SESSION_RESUME,
      payload: {
        sessionId: 'sess-f1-camel',
        leaseId: 'lease-f1-camel',
        agentSessionId: 'agent-sid-camel',
        cwd: '/tmp/camel',
        provider: 'claude',
        runtimeId: 'rt-camel-7',
      },
    });
    await settle();

    expect(client.confirmReconnected.mock.calls.length).toBe(1);
    const [sid, opts] = client.confirmReconnected.mock.calls[0]!;
    expect(sid).toBe('sess-f1-camel');
    expect(opts?.leaseId).toBe('lease-f1-camel');
    expect(opts?.leaseId).not.toBe('');
    expect(opts?.runtimeId).toBe('rt-camel-7');
    expect(opts?.runtimeId).toBeDefined();
    expect(opts?.runtimeId).not.toBe('');
    expect(client.markRecoveryFailed).not.toHaveBeenCalled();
  });

  // ── 组 2（SessionAlreadyExistsError）────────────────────────────────────

  it('SessionAlreadyExistsError（session-manager try 前抛出）→ markRecoveryFailed 恰一次，reason 含错误类别与 sessionId，markReconnected 从未被调', async () => {
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
          runtime_id: 'rt-dup',
        },
      }),
    ).resolves.toBeUndefined();
    await settle();

    // 恢复尝试发生过（恰一次，不重试风暴）。
    expect(sm.restoreAndReconnect).toHaveBeenCalledTimes(1);
    // SessionAlreadyExistsError 在 session-manager 内部 try 块之前抛出——
    // 本地从未切 active。
    expect(sm.markReconnected).not.toHaveBeenCalled();

    // 失败上报：恰一次，三段实参齐全。
    expect(client.markRecoveryFailed.mock.calls.length).toBe(1);
    const [sid, reason, opts] = client.markRecoveryFailed.mock.calls[0]!;
    expect(sid).toBe('sess-dup');
    // reason 可辨识：非空字符串 + 含错误类别标记 + 含 sessionId。
    expect(typeof reason).toBe('string');
    expect(reason).toBeTruthy();
    expect(String(reason)).toContain('SESSION_ALREADY_EXISTS');
    expect(String(reason)).toContain('sess-dup');
    expect(opts?.leaseId).toBeDefined();
    expect(opts?.leaseId).not.toBe('');
    expect(opts?.leaseId).toBe('lease-dup');
    expect(opts?.runtimeId).toBeDefined();
    expect(opts?.runtimeId).not.toBe('');
    expect(opts?.runtimeId).toBe('rt-dup');

    // 失败分支不落入成功链。
    expect(client.confirmReconnected).not.toHaveBeenCalled();
    expect(client.notifySessionReady).not.toHaveBeenCalled();
  });

  // ── 组 3（一般 Error → 立即 markRecoveryFailed）─────────────────────────

  it('restoreAndReconnect 抛一般 Error → markRecoveryFailed 立即携原始 reason 上报，markReconnected/confirm/ready 均不执行', async () => {
    const sm = createMockSessionManager();
    (sm.restoreAndReconnect as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('codex app-server handshake timeout'),
    );
    const { daemon, client } = buildDaemon(sm);
    daemons.push(daemon);

    await expect(
      emit(daemon, {
        type: MSG.SESSION_RESUME,
        payload: {
          session_id: 'sess-generic',
          lease_id: 'lease-generic',
          agent_session_id: 'agent-sid-generic',
          cwd: '/tmp/generic',
          provider: 'codex',
          runtime_id: 'rt-generic',
        },
      }),
    ).resolves.toBeUndefined();
    await settle();

    expect(sm.restoreAndReconnect).toHaveBeenCalledTimes(1);
    // 本地未切 active——不存在「本地 active 而 backend failed」的分裂窗口。
    expect(sm.markReconnected).not.toHaveBeenCalled();

    expect(client.markRecoveryFailed.mock.calls.length).toBe(1);
    const [sid, reason, opts] = client.markRecoveryFailed.mock.calls[0]!;
    expect(sid).toBe('sess-generic');
    expect(typeof reason).toBe('string');
    expect(String(reason)).toContain('codex app-server handshake timeout');
    expect(opts).toEqual({
      leaseId: 'lease-generic',
      runtimeId: 'rt-generic',
    });

    expect(client.confirmReconnected).not.toHaveBeenCalled();
    expect(client.notifySessionReady).not.toHaveBeenCalled();
  });

  it('restoreAndReconnect 成功但 markReconnected 抛错 → 同一 catch 收敛：markRecoveryFailed 携该 reason，不 confirm 不 ready', async () => {
    const sm = createMockSessionManager();
    (sm.markReconnected as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('markReconnected: session state missing'),
    );
    const { daemon, client } = buildDaemon(sm);
    daemons.push(daemon);

    await expect(
      emit(daemon, {
        type: MSG.SESSION_RESUME,
        payload: {
          session_id: 'sess-half',
          lease_id: 'lease-half',
          agent_session_id: 'agent-sid-half',
          cwd: '/tmp/half',
          provider: 'claude',
          runtime_id: 'rt-half',
        },
      }),
    ).resolves.toBeUndefined();
    await settle();

    expect(sm.restoreAndReconnect).toHaveBeenCalledTimes(1);
    expect(sm.markReconnected).toHaveBeenCalledTimes(1);

    // 恢复半途（本地切 active 失败）也必须立即置 backend failed。
    expect(client.markRecoveryFailed.mock.calls.length).toBe(1);
    const [sid, reason, opts] = client.markRecoveryFailed.mock.calls[0]!;
    expect(sid).toBe('sess-half');
    expect(String(reason)).toContain('markReconnected: session state missing');
    expect(opts).toEqual({ leaseId: 'lease-half', runtimeId: 'rt-half' });

    expect(client.confirmReconnected).not.toHaveBeenCalled();
    expect(client.notifySessionReady).not.toHaveBeenCalled();
  });

  // ── 组 4（best-effort：confirm 失败不回滚、不崩主循环）──────────────────

  it('confirmReconnected reject → 不回滚不重放不误报：restore/markReconnected 保持恰一次且有序，后续 SESSION_RESUME 仍可正常处理', async () => {
    const client = createMockClient();
    // mockRejectedValueOnce 只影响第一次——第二次 confirm 成功，用于验证
    // 主循环存活后的完整成功链。
    client.confirmReconnected.mockRejectedValueOnce(new Error('backend 503'));
    const { daemon, sm } = buildDaemon(createMockSessionManager(), client);
    daemons.push(daemon);

    const payload = {
      session_id: 'sess-best-effort',
      lease_id: 'lease-best-effort',
      agent_session_id: 'agent-sid-be',
      cwd: '/tmp/be',
      provider: 'claude',
      runtime_id: 'rt-be',
    };

    // 第一次 resume：confirm HTTP 失败。
    await expect(emit(daemon, { type: MSG.SESSION_RESUME, payload })).resolves
      .toBeUndefined();
    await settle();

    // 本地已恢复 active 不回滚、不重放（无重试循环）。
    expect(sm.restoreAndReconnect).toHaveBeenCalledTimes(1);
    expect(sm.markReconnected).toHaveBeenCalledTimes(1);
    // 本地切 active 先于 confirm 尝试（顺序证明 confirm 失败无法抢占本地状态）。
    expect(sm.markReconnected.mock.invocationCallOrder[0]!).toBeLessThan(
      client.confirmReconnected.mock.invocationCallOrder[0]!,
    );
    // ready 上报仍在 confirm 之后继续执行（backend 180s sweeper 兜底语义）。
    expect(client.notifySessionReady).toHaveBeenCalledTimes(1);
    expect(client.confirmReconnected.mock.invocationCallOrder[0]!).toBeLessThan(
      client.notifySessionReady.mock.invocationCallOrder[0]!,
    );
    // confirm 失败 ≠ 恢复失败：不误报 markRecoveryFailed。
    expect(client.markRecoveryFailed).not.toHaveBeenCalled();

    // 主循环存活：同 session 第二次 SESSION_RESUME 仍走完整成功链。
    await expect(emit(daemon, { type: MSG.SESSION_RESUME, payload })).resolves
      .toBeUndefined();
    await settle();
    expect(sm.restoreAndReconnect).toHaveBeenCalledTimes(2);
    expect(sm.markReconnected).toHaveBeenCalledTimes(2);
    expect(client.confirmReconnected).toHaveBeenCalledTimes(2);
    expect(client.notifySessionReady).toHaveBeenCalledTimes(2);
    expect(client.markRecoveryFailed).not.toHaveBeenCalled();
  });

  it('markRecoveryFailed reject（失败上报自身 HTTP 失败）→ 仅 warn 不向上抛，且不误入成功链（不 confirm 不 ready）', async () => {
    const sm = createMockSessionManager();
    (sm.restoreAndReconnect as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('driver.start failed'),
    );
    const client = createMockClient();
    client.markRecoveryFailed.mockRejectedValueOnce(
      new Error('mark-recovery-failed 500'),
    );
    const { daemon } = buildDaemon(sm, client);
    daemons.push(daemon);

    await expect(
      emit(daemon, {
        type: MSG.SESSION_RESUME,
        payload: {
          session_id: 'sess-report-down',
          lease_id: 'lease-report-down',
          agent_session_id: 'agent-sid-rd',
          cwd: '/tmp/rd',
          provider: 'claude',
          runtime_id: 'rt-rd',
        },
      }),
    ).resolves.toBeUndefined();
    await settle();

    // 上报尝试发生过（恰一次），其自身失败被 daemon 内层 catch 收敛为 warn，
    // 不向上抛、不重试。
    expect(client.markRecoveryFailed.mock.calls.length).toBe(1);
    // 失败分支不因「上报失败」而继续走成功链。
    expect(client.confirmReconnected).not.toHaveBeenCalled();
    expect(client.notifySessionReady).not.toHaveBeenCalled();
  });
});
