// tests/interactive/turn-start-watchdog.test.ts
// 2026-10-21-daemon-zombie-turn FR-01：daemon 轮启动看门狗。
//
// 根因场景（生产会话 49d893ab）：打断 abort 收尾窗口吞没注入消息——inject
// 正常 push + ack，但引擎零事件零 result → daemon 永停 running、backend run
// 永停 pending。看门狗在首轮启动路径布防，到点重置会话态并回调
// deps.onTurnStartTimeout（daemon 桥 notifyRunResult 收敛该 run）。
//
// 用例矩阵：
//   - inject 首轮路径布防（active 会话注入 → 看门狗就位）
//   - 到点触发：状态重置 active + currentRunId 清空 + onTurnStartTimeout 回调
//   - 轮事件撤防：onMessage / onResult 到达 → 看门狗移除，到点不触发
//   - 终态撤防：end() 后看门狗移除
//   - stop() 清全部看门狗
//   - 到点守卫：currentRunId 已切新轮（误报形态）→ 静默跳过不回调
//   - env SILLYHUB_TURN_START_WATCHDOG_MS 窗口覆写生效

import { describe, it, expect, afterEach, vi } from 'vitest';
import { SessionManager } from '../../src/interactive/session-manager.js';
import { InputQueue } from '../../src/interactive/input-queue.js';
import type { SessionManagerDeps } from '../../src/interactive/types.js';
import type {
  InteractiveDriver,
  InteractiveDriverHandle,
  InteractiveDriverCallbacks,
  SessionState,
  SessionStatus,
} from '../../src/interactive/types.js';
import { onResult, onMessage } from '../../src/interactive/session-manager/events.js';

/** 看门狗 Map 的测试取用口（私有成员 cast，busy-check 测试同款注入路径）。 */
function watchdogMap(
  sm: SessionManager,
): Map<string, { timer: ReturnType<typeof setTimeout>; runId: string }> {
  return (sm as unknown as { _turnStartWatchdogs: Map<string, never> })._turnStartWatchdogs as Map<
    string,
    { timer: ReturnType<typeof setTimeout>; runId: string }
  >;
}

function createSessionManager(onTurnStartTimeout?: SessionManagerDeps['onTurnStartTimeout']) {
  const fakeDriver: InteractiveDriver = {
    provider: 'claude',
    async start() {
      return { provider: 'claude' } as unknown as InteractiveDriverHandle;
    },
    async consume(_handle, _callbacks: InteractiveDriverCallbacks) {
      return new Promise<void>(() => {});
    },
    async interrupt() {
      return false;
    },
  };
  const deps: SessionManagerDeps = {
    driver: fakeDriver as never,
    drivers: { claude: fakeDriver },
    onTurnResult: vi.fn(),
    onTurnMessage: vi.fn(),
    onSessionEnd: vi.fn(),
    onSessionEvent: vi.fn(),
    onTurnStartTimeout,
  };
  return new SessionManager(deps);
}

function makeState(sessionId: string, status: SessionStatus): SessionState {
  return {
    sessionId,
    leaseId: `lease-${sessionId}`,
    claimToken: `ct-${sessionId}`,
    inputQueue: new InputQueue(),
    status,
    lastActiveAt: Date.now(),
    cwd: '/tmp/test',
    provider: 'claude',
    pathToClaudeCodeExecutable: '/usr/bin/claude',
    subagentDepth: new Map<string, number>(),
  } as SessionState;
}

function seed(sm: SessionManager, state: SessionState): void {
  (sm as unknown as { _store: Map<string, SessionState> })._store.set(state.sessionId, state);
}

/** mgr core 桥（onMessage/onResult 模块函数第一参数）。 */
function core(sm: SessionManager): never {
  return (sm as unknown as { _core(): never })._core();
}

describe('2026-10-21-daemon-zombie-turn FR-01：轮启动看门狗', () => {
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.SILLYHUB_TURN_START_WATCHDOG_MS;
  });

  it('inject 首轮路径布防：active 会话注入后看门狗就位（默认 90s 窗口）', async () => {
    vi.useFakeTimers();
    const sm = createSessionManager();
    seed(sm, makeState('sess-1', 'active'));

    await sm.inject('sess-1', 'hello', 'run-9');

    const w = watchdogMap(sm).get('sess-1');
    expect(w).toBeDefined();
    expect(w!.runId).toBe('run-9');
    // 布防不提前触发
    await vi.advanceTimersByTimeAsync(89_999);
    expect(sm.get('sess-1')!.status).toBe('running');
  });

  it('到点触发：重置 active + 保留 currentRunId 作迟到归属锚 + onTurnStartTimeout 回调（主事故路径）', async () => {
    vi.useFakeTimers();
    const onTurnStartTimeout = vi.fn(async () => {});
    const sm = createSessionManager(onTurnStartTimeout);
    seed(sm, makeState('sess-1', 'active'));

    await sm.inject('sess-1', '[后台任务通知] …', 'run-zombie');
    await vi.advanceTimersByTimeAsync(90_000);

    const state = sm.get('sess-1')!;
    expect(state.status).toBe('active');
    // P2 缓解：保留旧 runId——迟到 result 归属到已收敛为 failed 的旧轮（幂等），
    // 不被误记到用户重发后的新轮；下次 inject 无条件覆盖。
    expect(state.currentRunId).toBe('run-zombie');
    expect(onTurnStartTimeout).toHaveBeenCalledTimes(1);
    expect(onTurnStartTimeout).toHaveBeenCalledWith('sess-1', 'run-zombie');
    // 触发后看门狗条目已清
    expect(watchdogMap(sm).has('sess-1')).toBe(false);
  });

  it('轮事件撤防：onMessage 到达（轮已启动）→ 到点不触发', async () => {
    vi.useFakeTimers();
    const onTurnStartTimeout = vi.fn(async () => {});
    const sm = createSessionManager(onTurnStartTimeout);
    const state = makeState('sess-1', 'active');
    seed(sm, state);

    await sm.inject('sess-1', 'hello', 'run-9');
    await onMessage(core(sm), state, { events: [] });
    expect(watchdogMap(sm).has('sess-1')).toBe(false);

    await vi.advanceTimersByTimeAsync(90_000);
    expect(onTurnStartTimeout).not.toHaveBeenCalled();
    // 轮生命周期不受影响（仍 running，终态归 onResult）
    expect(sm.get('sess-1')!.status).toBe('running');
  });

  it('轮事件撤防：onResult 到达 → 到点不触发', async () => {
    vi.useFakeTimers();
    const onTurnStartTimeout = vi.fn(async () => {});
    const sm = createSessionManager(onTurnStartTimeout);
    const state = makeState('sess-1', 'active');
    seed(sm, state);

    await sm.inject('sess-1', 'hello', 'run-9');
    await onResult(core(sm), state, { subtype: 'success', is_error: false } as never);
    expect(watchdogMap(sm).has('sess-1')).toBe(false);

    await vi.advanceTimersByTimeAsync(90_000);
    expect(onTurnStartTimeout).not.toHaveBeenCalled();
  });

  it('终态撤防：end() 后看门狗移除', async () => {
    vi.useFakeTimers();
    const onTurnStartTimeout = vi.fn(async () => {});
    const sm = createSessionManager(onTurnStartTimeout);
    seed(sm, makeState('sess-1', 'active'));

    await sm.inject('sess-1', 'hello', 'run-9');
    await sm.end('sess-1');
    expect(watchdogMap(sm).has('sess-1')).toBe(false);

    await vi.advanceTimersByTimeAsync(90_000);
    expect(onTurnStartTimeout).not.toHaveBeenCalled();
  });

  it('stop() 清全部看门狗（退出途中不 fire）', async () => {
    vi.useFakeTimers();
    const onTurnStartTimeout = vi.fn(async () => {});
    const sm = createSessionManager(onTurnStartTimeout);
    seed(sm, makeState('sess-1', 'active'));

    await sm.inject('sess-1', 'hello', 'run-9');
    sm.stop();
    expect(watchdogMap(sm).size).toBe(0);

    await vi.advanceTimersByTimeAsync(90_000);
    expect(onTurnStartTimeout).not.toHaveBeenCalled();
  });

  it('到点守卫：currentRunId 已切新轮 → 静默跳过不回调（误报保护）', async () => {
    vi.useFakeTimers();
    const onTurnStartTimeout = vi.fn(async () => {});
    const sm = createSessionManager(onTurnStartTimeout);
    const state = makeState('sess-1', 'active');
    seed(sm, state);

    await sm.inject('sess-1', 'hello', 'run-old');
    // 模拟误报形态：布防轮已不是当前轮（新 inject 已切换 currentRunId）
    state.currentRunId = 'run-new';
    await vi.advanceTimersByTimeAsync(90_000);

    expect(onTurnStartTimeout).not.toHaveBeenCalled();
    // 状态不被误动（新轮语义保留）
    expect(sm.get('sess-1')!.currentRunId).toBe('run-new');
  });

  it('env SILLYHUB_TURN_START_WATCHDOG_MS 覆写窗口生效', async () => {
    vi.useFakeTimers();
    process.env.SILLYHUB_TURN_START_WATCHDOG_MS = '1500';
    const onTurnStartTimeout = vi.fn(async () => {});
    const sm = createSessionManager(onTurnStartTimeout);
    seed(sm, makeState('sess-1', 'active'));

    await sm.inject('sess-1', 'hello', 'run-9');
    await vi.advanceTimersByTimeAsync(1_499);
    expect(onTurnStartTimeout).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onTurnStartTimeout).toHaveBeenCalledTimes(1);
  });

  it('回调未注入（旧装配形态）：到点仍重置本地态、不抛错', async () => {
    vi.useFakeTimers();
    const sm = createSessionManager(undefined);
    seed(sm, makeState('sess-1', 'active'));

    await sm.inject('sess-1', 'hello', 'run-9');
    await vi.advanceTimersByTimeAsync(90_000);

    expect(sm.get('sess-1')!.status).toBe('active');
    // P2 缓解：currentRunId 保留（迟到归属锚，见上）。
    expect(sm.get('sess-1')!.currentRunId).toBe('run-9');
  });

  // ── 2026-10-23-watchdog-steering-guard：忙轮 steering 误杀回归 ──────────────
  // 事故 run 3d3b0bae（会话 5fb28b2e）：backend mid-turn steering 复用活跃 run
  // 的 run_id；inject 的 >60s stale-reset 只看上次 inject 时间，把仍在产事件的
  // 活轮翻 active 并给同一 run 布防看门狗，模型 API 卡顿后 90s 到点误判 failed。
  // 以下用例锁定三条前置守卫：同 runId 不 stale/不布防、事件新鲜不 stale、
  // 已观测 run 不布防；同时保留真僵尸轮（新 runId 零事件）触发路径。

  it('事故序列：首轮启动→事件→同 runId steering→静默 90s 不误杀', async () => {
    vi.useFakeTimers();
    const onTurnStartTimeout = vi.fn(async () => {});
    const sm = createSessionManager(onTurnStartTimeout);
    const state = makeState('sess-1', 'active');
    seed(sm, state);

    await sm.inject('sess-1', 'first', 'run-A');
    expect(watchdogMap(sm).has('sess-1')).toBe(true);

    // 引擎产生任意轮事件：撤防 + 记录已启动 run。
    await onMessage(core(sm), state, { events: [] });
    expect(watchdogMap(sm).has('sess-1')).toBe(false);
    expect(state.observedRunIds?.has('run-A')).toBe(true);

    // 轮跑过 60s 后追加 steering（同 runId）：不得 stale-reset、不得重新布防。
    await vi.advanceTimersByTimeAsync(120_000);
    await sm.inject('sess-1', 'steer', 'run-A');
    expect(watchdogMap(sm).has('sess-1')).toBe(false);

    // 即使之后静默 90s（模型卡顿形态），也不得把活轮判死。
    await vi.advanceTimersByTimeAsync(90_000);
    expect(onTurnStartTimeout).not.toHaveBeenCalled();
  });

  it('mid-turn steering（同 runId）不 stale-reset、不布防看门狗', async () => {
    vi.useFakeTimers();
    const onTurnStartTimeout = vi.fn(async () => {});
    const sm = createSessionManager(onTurnStartTimeout);
    const state = makeState('sess-1', 'running');
    state.currentRunId = 'run-active';
    state.lastActiveAt = Date.now() - 120_000;
    state.lastTurnEventAt = Date.now() - 120_000;
    seed(sm, state);

    await sm.inject('sess-1', 'steer', 'run-active');

    const after = sm.get('sess-1')!;
    expect(after.status).toBe('running');
    expect(after.currentRunId).toBe('run-active');
    // 同 runId 是追加输入，不是新轮启动：不得写 stale 宽限、不得布防。
    expect(after.staleRunResetAt).toBeUndefined();
    expect(watchdogMap(sm).has('sess-1')).toBe(false);
    expect(sm.getPendingInjectCount('sess-1')).toBe(1);

    await vi.advanceTimersByTimeAsync(90_000);
    expect(onTurnStartTimeout).not.toHaveBeenCalled();
  });

  it('轮内事件新鲜时 inject 不触发 stale-reset（FR-02）', async () => {
    const onTurnStartTimeout = vi.fn(async () => {});
    const sm = createSessionManager(onTurnStartTimeout);
    const state = makeState('sess-1', 'running');
    state.currentRunId = 'run-old';
    state.lastActiveAt = Date.now() - 120_000;
    // 5 秒前还有轮内事件：引擎没静默，不得按「上次 inject 时间」误翻。
    state.lastTurnEventAt = Date.now() - 5_000;
    seed(sm, state);

    await sm.inject('sess-1', 'queued', 'run-new');

    const after = sm.get('sess-1')!;
    expect(after.status).toBe('running');
    expect(after.staleRunResetAt).toBeUndefined();
    // 前一 turn 未 result：排队语义，不布防。
    expect(watchdogMap(sm).has('sess-1')).toBe(false);
  });

  it('onMessage 刷新最后事件时间并记录 observedRunIds（FR-02/FR-03）', async () => {
    const sm = createSessionManager();
    const state = makeState('sess-1', 'running');
    state.currentRunId = 'run-9';
    state.lastTurnEventAt = 1;
    seed(sm, state);

    const before = Date.now();
    await onMessage(core(sm), state, { events: [] });

    expect(state.lastTurnEventAt).toBeGreaterThanOrEqual(before);
    expect(state.observedRunIds?.has('run-9')).toBe(true);
  });

  it('已观测事件的 run 不再布防看门狗（FR-03）', async () => {
    vi.useFakeTimers();
    const onTurnStartTimeout = vi.fn(async () => {});
    const sm = createSessionManager(onTurnStartTimeout);
    const state = makeState('sess-1', 'active');
    state.observedRunIds = new Set(['run-seen']);
    seed(sm, state);

    await sm.inject('sess-1', 'replay', 'run-seen');

    expect(watchdogMap(sm).has('sess-1')).toBe(false);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(onTurnStartTimeout).not.toHaveBeenCalled();
  });

  it('新 runId 零事件仍触发（真僵尸轮不回归，FR-03/FR-04）', async () => {
    vi.useFakeTimers();
    const onTurnStartTimeout = vi.fn(async () => {});
    const sm = createSessionManager(onTurnStartTimeout);
    const state = makeState('sess-1', 'active');
    state.observedRunIds = new Set(['run-old']);
    seed(sm, state);

    await sm.inject('sess-1', '[后台任务通知] …', 'run-zombie');
    await vi.advanceTimersByTimeAsync(90_000);

    expect(onTurnStartTimeout).toHaveBeenCalledTimes(1);
    expect(onTurnStartTimeout).toHaveBeenCalledWith('sess-1', 'run-zombie');
  });
});
