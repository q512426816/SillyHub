// tests/interactive/turn-activity-watchdog.test.ts
// 2026-11-04-turn-activity-watchdog：daemon 轮活动看门狗。
//
// 根因场景（腾讯云生产会话 414bc7d5 + 2026-10-21 宿主冻结/2026-10-26 假活同族）：
// 引擎 turn 中途挂死（已产生过事件后引擎僵死/宿主冻结吞 result）→ daemon 永停
// running、backend run 永停 running（sweep 档4 只管 pending）→ 会话消息全排队、
// 满 5 条 409 永久不可发。活动看门狗测「无活动时长」（事件/心跳续防），超窗
// interrupt 软收敛 + 复位会话态 + 回报该 run 失败。
//
// 用例矩阵：
//   - inject 布防（首轮 + 排队路径均布防/换防，keyed by 新 runId）
//   - 到点触发：interrupt 尝试 + 复位 active + staleRunResetAt + 清
//     pendingInjectCount + 保留 currentRunId + onTurnActivityTimeout 回调
//   - 轮事件/心跳续防：窗口重挂不提前触发
//   - result / 终态 / stop 撤防
//   - 假活保护：currentRunId 已切 / status 非 running（启动看门狗先行）静默跳过
//   - env SILLYHUB_TURN_ACTIVITY_WATCHDOG_MS：0=关闭、非法回落默认、自定义生效

import { describe, it, expect, afterEach, vi } from 'vitest';
import { SessionManager } from '../../src/interactive/session-manager.js';
import { InputQueue } from '../../src/interactive/input-queue.js';
import type { SessionManagerDeps } from '../../src/interactive/types.js';
import type {
  InteractiveDriver,
  InteractiveDriverHandle,
  InteractiveDriverCallbacks,
  InteractiveDriverStartOptions,
  SessionState,
  SessionStatus,
} from '../../src/interactive/types.js';
import { onResult, onMessage } from '../../src/interactive/session-manager/events.js';

/** 活动看门狗 Map 的测试取用口（私有成员 cast，turn-start-watchdog 测试同款）。 */
function activityWatchdogMap(
  sm: SessionManager,
): Map<string, { timer: ReturnType<typeof setTimeout>; runId: string }> {
  return (sm as unknown as { _turnActivityWatchdogs: Map<string, never> })
    ._turnActivityWatchdogs as Map<
    string,
    { timer: ReturnType<typeof setTimeout>; runId: string }
  >;
}

interface Harness {
  sm: SessionManager;
  interruptSpy: ReturnType<typeof vi.fn>;
  consumeCallbacks: { current: InteractiveDriverCallbacks | null };
}

function createSessionManager(
  onTurnActivityTimeout?: SessionManagerDeps['onTurnActivityTimeout'],
): Harness {
  const interruptSpy = vi.fn(async () => false);
  const consumeCallbacks: { current: InteractiveDriverCallbacks | null } = {
    current: null,
  };
  const fakeDriver: InteractiveDriver = {
    provider: 'claude',
    async start() {
      return { provider: 'claude' } as unknown as InteractiveDriverHandle;
    },
    async consume(_handle, callbacks: InteractiveDriverCallbacks) {
      consumeCallbacks.current = callbacks;
      return new Promise<void>(() => {});
    },
    async interrupt() {
      return interruptSpy();
    },
  };
  const deps: SessionManagerDeps = {
    driver: fakeDriver as never,
    drivers: { claude: fakeDriver },
    onTurnResult: vi.fn(),
    onTurnMessage: vi.fn(),
    onSessionEnd: vi.fn(),
    onSessionEvent: vi.fn(),
    onTurnStartTimeout: vi.fn(async () => {}),
    onTurnActivityTimeout,
  };
  return {
    sm: new SessionManager(deps),
    interruptSpy,
    consumeCallbacks,
  };
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
  (sm as unknown as { _store: Map<string, SessionState> })._store.set(
    state.sessionId,
    state,
  );
}

/** mgr core 桥（onMessage/onResult 模块函数第一参数）。 */
function core(sm: SessionManager): never {
  return (sm as unknown as { _core(): never })._core();
}

describe('2026-11-04-turn-activity-watchdog：轮活动看门狗', () => {
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.SILLYHUB_TURN_ACTIVITY_WATCHDOG_MS;
  });

  it('inject 布防：首轮路径（默认 30min 窗，keyed by 本 runId）', async () => {
    vi.useFakeTimers();
    const { sm } = createSessionManager();
    seed(sm, makeState('sess-1', 'active'));

    await sm.inject('sess-1', 'hello', 'run-9');

    const w = activityWatchdogMap(sm).get('sess-1');
    expect(w).toBeDefined();
    expect(w!.runId).toBe('run-9');
    // 布防不提前触发（89s < 90s 启动看门狗 < 30min 活动窗，均不触发）。
    await vi.advanceTimersByTimeAsync(89_999);
    expect(sm.get('sess-1')!.status).toBe('running');
  });

  it('inject 布防：排队路径（前轮未 result）换防 keyed by 新 runId', async () => {
    vi.useFakeTimers();
    const { sm } = createSessionManager();
    const state = makeState('sess-1', 'running');
    state.currentRunId = 'run-old';
    state.lastActiveAt = Date.now();
    state.lastTurnEventAt = Date.now();
    seed(sm, state);

    await sm.inject('sess-1', 'queued', 'run-new');

    const w = activityWatchdogMap(sm).get('sess-1');
    expect(w).toBeDefined();
    expect(w!.runId).toBe('run-new');
  });

  it('到点触发主路径：interrupt 尝试 + 复位 active + staleRunResetAt + 清 pendingInjectCount + 保留 currentRunId + 回调一次', async () => {
    vi.useFakeTimers();
    const onTurnActivityTimeout = vi.fn(async () => {});
    const { sm, interruptSpy } = createSessionManager(onTurnActivityTimeout);
    const state = makeState('sess-1', 'active');
    seed(sm, state);

    await sm.inject('sess-1', 'hello', 'run-1');
    // 轮中途挂死形态：先产生过事件（撤启动看门狗），随后彻底静默 30min。
    await onMessage(core(sm), state, { events: [] });
    core(sm)._pendingInjectCount.set('sess-1', 2);

    await vi.advanceTimersByTimeAsync(30 * 60_000 + 1);

    const after = sm.get('sess-1')!;
    expect(after.status).toBe('active');
    expect(after.staleRunResetAt).toBeDefined();
    expect(sm.getPendingInjectCount('sess-1')).toBe(0);
    // P2 缓解（对齐启动看门狗）：保留旧 runId 作迟到 result 幂等归属锚。
    expect(after.currentRunId).toBe('run-1');
    expect(interruptSpy).toHaveBeenCalledTimes(1);
    expect(onTurnActivityTimeout).toHaveBeenCalledTimes(1);
    expect(onTurnActivityTimeout).toHaveBeenCalledWith('sess-1', 'run-1');
    expect(activityWatchdogMap(sm).has('sess-1')).toBe(false);
  });

  it('轮事件续防：onMessage 到达窗口重挂，事件前静默不计入', async () => {
    vi.useFakeTimers();
    const onTurnActivityTimeout = vi.fn(async () => {});
    const { sm } = createSessionManager(onTurnActivityTimeout);
    const state = makeState('sess-1', 'active');
    seed(sm, state);

    await sm.inject('sess-1', 'hello', 'run-1');
    // 首事件撤启动看门狗（t=0），活动窗从此刻起算。
    await onMessage(core(sm), state, { events: [] });
    await vi.advanceTimersByTimeAsync(29 * 60_000);
    // 29min 静默后一条事件到达：窗口从现在起重挂。
    await onMessage(core(sm), state, { events: [] });
    await vi.advanceTimersByTimeAsync(29 * 60_000);
    expect(onTurnActivityTimeout).not.toHaveBeenCalled();
    // 再静默满 30min 才触发。
    await vi.advanceTimersByTimeAsync(60_000 + 1);
    expect(onTurnActivityTimeout).toHaveBeenCalledTimes(1);
  });

  it('心跳续防：onHeartbeat 到达窗口重挂（生成期引擎活证据）', async () => {
    vi.useFakeTimers();
    const onTurnActivityTimeout = vi.fn(async () => {});
    const { sm, consumeCallbacks } = createSessionManager(onTurnActivityTimeout);

    // create 走真 _runConsume：fake driver consume 捕获 callbacks。
    await sm.create({
      sessionId: 'sess-hb',
      leaseId: 'lease-hb',
      firstPrompt: 'hi',
      firstRunId: 'run-hb',
      cwd: '/tmp/test',
      provider: 'claude',
      pathToClaudeCodeExecutable: '/usr/bin/claude',
      stage: 'orchestrator',
    });
    expect(consumeCallbacks.current).not.toBeNull();

    await vi.advanceTimersByTimeAsync(29 * 60_000);
    consumeCallbacks.current!.onHeartbeat!({
      kind: 'generating',
      est_chars: 10,
      precision: 'estimated',
      source: 'claude_input_json_delta',
    });
    await vi.advanceTimersByTimeAsync(29 * 60_000);
    expect(onTurnActivityTimeout).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000 + 1);
    expect(onTurnActivityTimeout).toHaveBeenCalledTimes(1);
    expect(onTurnActivityTimeout).toHaveBeenCalledWith('sess-hb', 'run-hb');
  });

  it('result 撤防：onResult 到达 → 到点不触发', async () => {
    vi.useFakeTimers();
    const onTurnActivityTimeout = vi.fn(async () => {});
    const { sm } = createSessionManager(onTurnActivityTimeout);
    const state = makeState('sess-1', 'active');
    seed(sm, state);

    await sm.inject('sess-1', 'hello', 'run-9');
    await onResult(core(sm), state, {
      subtype: 'success',
      is_error: false,
    } as never);
    expect(activityWatchdogMap(sm).has('sess-1')).toBe(false);

    await vi.advanceTimersByTimeAsync(30 * 60_000 + 1);
    expect(onTurnActivityTimeout).not.toHaveBeenCalled();
  });

  it('终态撤防：end() 后看门狗移除', async () => {
    vi.useFakeTimers();
    const onTurnActivityTimeout = vi.fn(async () => {});
    const { sm } = createSessionManager(onTurnActivityTimeout);
    seed(sm, makeState('sess-1', 'active'));

    await sm.inject('sess-1', 'hello', 'run-9');
    await sm.end('sess-1');
    expect(activityWatchdogMap(sm).has('sess-1')).toBe(false);

    await vi.advanceTimersByTimeAsync(30 * 60_000 + 1);
    expect(onTurnActivityTimeout).not.toHaveBeenCalled();
  });

  it('stop() 清全部活动看门狗（退出途中不 fire）', async () => {
    vi.useFakeTimers();
    const onTurnActivityTimeout = vi.fn(async () => {});
    const { sm } = createSessionManager(onTurnActivityTimeout);
    seed(sm, makeState('sess-1', 'active'));

    await sm.inject('sess-1', 'hello', 'run-9');
    sm.stop();
    expect(activityWatchdogMap(sm).size).toBe(0);

    await vi.advanceTimersByTimeAsync(30 * 60_000 + 1);
    expect(onTurnActivityTimeout).not.toHaveBeenCalled();
  });

  it('假活保护：currentRunId 已切新轮 → 静默跳过不回调不改状态', async () => {
    vi.useFakeTimers();
    const onTurnActivityTimeout = vi.fn(async () => {});
    const { sm } = createSessionManager(onTurnActivityTimeout);
    const state = makeState('sess-1', 'active');
    seed(sm, state);

    await sm.inject('sess-1', 'hello', 'run-old');
    state.currentRunId = 'run-new';
    await vi.advanceTimersByTimeAsync(30 * 60_000 + 1);

    expect(onTurnActivityTimeout).not.toHaveBeenCalled();
    expect(sm.get('sess-1')!.currentRunId).toBe('run-new');
    expect(sm.get('sess-1')!.status).toBe('running');
  });

  it('与启动看门狗并存：启动看门狗先行触发（status 复位 active）后本看门狗静默跳过', async () => {
    vi.useFakeTimers();
    const onTurnActivityTimeout = vi.fn(async () => {});
    const onTurnStartTimeout = vi.fn(async () => {});
    const interruptSpy = vi.fn(async () => false);
    const fakeDriver: InteractiveDriver = {
      provider: 'claude',
      async start() {
        return { provider: 'claude' } as unknown as InteractiveDriverHandle;
      },
      async consume() {
        return new Promise<void>(() => {});
      },
      async interrupt() {
        return interruptSpy();
      },
    };
    const sm = new SessionManager({
      driver: fakeDriver as never,
      drivers: { claude: fakeDriver },
      onTurnResult: vi.fn(),
      onTurnMessage: vi.fn(),
      onSessionEnd: vi.fn(),
      onSessionEvent: vi.fn(),
      onTurnStartTimeout,
      onTurnActivityTimeout,
    } as SessionManagerDeps);
    seed(sm, makeState('sess-1', 'active'));

    await sm.inject('sess-1', 'hello', 'run-9');
    // 90s：首轮启动看门狗触发（零事件形态），复位 active + 回报 start_timeout。
    await vi.advanceTimersByTimeAsync(90_000);
    expect(onTurnStartTimeout).toHaveBeenCalledTimes(1);
    expect(sm.get('sess-1')!.status).toBe('active');

    // 30min：活动看门狗到点，status 已非 running → 静默跳过，不重复回报。
    await vi.advanceTimersByTimeAsync(30 * 60_000 + 1);
    expect(onTurnActivityTimeout).not.toHaveBeenCalled();
  });

  it('stale-reset 撤防：inject 60s stale 翻 active 后按新 run 重新布防', async () => {
    vi.useFakeTimers();
    const { sm } = createSessionManager();
    const state = makeState('sess-1', 'running');
    state.currentRunId = 'run-stale';
    state.lastActiveAt = Date.now() - 120_000;
    state.lastTurnEventAt = Date.now() - 120_000;
    seed(sm, state);

    await sm.inject('sess-1', 'fresh', 'run-fresh');

    // stale 翻 active 后本条 inject 重新布防，keyed by 新 run。
    const w = activityWatchdogMap(sm).get('sess-1');
    expect(w).toBeDefined();
    expect(w!.runId).toBe('run-fresh');
  });

  it('env 0=显式关闭：布防 no-op，到点永不触发', async () => {
    vi.useFakeTimers();
    process.env.SILLYHUB_TURN_ACTIVITY_WATCHDOG_MS = '0';
    const onTurnActivityTimeout = vi.fn(async () => {});
    const { sm } = createSessionManager(onTurnActivityTimeout);
    const state = makeState('sess-1', 'active');
    seed(sm, state);

    await sm.inject('sess-1', 'hello', 'run-9');
    expect(activityWatchdogMap(sm).size).toBe(0);
    // 事件撤启动看门狗后长静默：无任何看门狗触碰会话态。
    await onMessage(core(sm), state, { events: [] });

    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
    expect(onTurnActivityTimeout).not.toHaveBeenCalled();
    expect(sm.get('sess-1')!.status).toBe('running');
  });

  it('env 非法/负数回落默认 30min', async () => {
    vi.useFakeTimers();
    process.env.SILLYHUB_TURN_ACTIVITY_WATCHDOG_MS = 'abc';
    const onTurnActivityTimeout = vi.fn(async () => {});
    const { sm } = createSessionManager(onTurnActivityTimeout);
    const state = makeState('sess-1', 'active');
    seed(sm, state);

    await sm.inject('sess-1', 'hello', 'run-9');
    // 首事件撤启动看门狗，活动窗（非法 env → 默认 30min）从此起算。
    await onMessage(core(sm), state, { events: [] });
    await vi.advanceTimersByTimeAsync(29 * 60_000);
    expect(sm.get('sess-1')!.status).toBe('running');
    // 负数 env 同样回落默认：续防窗口仍为 30min 量级。
    process.env.SILLYHUB_TURN_ACTIVITY_WATCHDOG_MS = '-5';
    await onMessage(core(sm), state, { events: [] });
    await vi.advanceTimersByTimeAsync(29 * 60_000);
    expect(onTurnActivityTimeout).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000 + 1);
    expect(onTurnActivityTimeout).toHaveBeenCalledTimes(1);
  });

  it('env 自定义窗口生效', async () => {
    vi.useFakeTimers();
    process.env.SILLYHUB_TURN_ACTIVITY_WATCHDOG_MS = '1500';
    const onTurnActivityTimeout = vi.fn(async () => {});
    const { sm } = createSessionManager(onTurnActivityTimeout);
    seed(sm, makeState('sess-1', 'active'));

    await sm.inject('sess-1', 'hello', 'run-9');
    await vi.advanceTimersByTimeAsync(1_499);
    expect(onTurnActivityTimeout).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onTurnActivityTimeout).toHaveBeenCalledTimes(1);
  });

  it('回调未注入（旧装配形态）：到点仍 interrupt + 重置本地态、不抛错', async () => {
    vi.useFakeTimers();
    const { sm } = createSessionManager(undefined);
    seed(sm, makeState('sess-1', 'active'));

    await sm.inject('sess-1', 'hello', 'run-9');
    await vi.advanceTimersByTimeAsync(30 * 60_000 + 1);

    expect(sm.get('sess-1')!.status).toBe('active');
    expect(sm.get('sess-1')!.currentRunId).toBe('run-9');
  });
});
