// tests/interactive/session-thinking-level.test.ts
// task-03（2026-09-14-session-thinking-level / FR-02 + FR-03 创建链 daemon 段）：
// session-manager 思考档位 get 轻守卫 / set 六守卫+词表 + driver 分派 +
// daemon 两 RPC handler + execPayload 归一化 + 创建链 driverOpts 透传。
//
// 覆盖（task-03.md acceptance）：
//   - set 六守卫矩阵（照 compact.ts 先例，D-002 仅空闲切换）：
//       ⓪ level 词表外（isValidPlatformLevel 七档单源，防御性双保险）
//       ① session 不存在 → SessionNotFoundError
//       ② status=running → SessionBusyError（切换与进行中 turn 并发会交错写引擎态）
//       ③ status=reconnecting → SessionNotActiveError
//       ④ status=ended / failed → SessionNotActiveError
//       ⑤ driver 未实现 setThinkingLevel 方法 → throw（caps=true 但版本错位防御）
//       ⑥ getProviderCaps(provider).thinking_level=false → throw（cursor 无通道）
//   - get 轻守卫（R-04 切换后查询刷新依赖——running 期间可查不打断在跑轮）：
//       ① session 不存在 → SessionNotFoundError
//       ② status=ended / failed → SessionNotActiveError（终态拒绝；running /
//          reconnecting 放行——查询无副作用）
//       ③ driver 未实现 getThinkingLevels → throw
//       ④ caps.thinking_level=false → throw
//   - 分派断言：driver.getThinkingLevels 收到 (handle, state.model)（Grill P1-5
//     传参断言）+ ThinkingLevels 原样透传；driver.setThinkingLevel 收到**平台档位
//     串原样**（引擎映射归 driver，task-04）+ ThinkingLevelResult（含 ok=false）
//     原样透传；handle 缺失防御分支抛错。
//   - 创建链：CreateSessionInput.thinkingLevel → driver.start 收到的 driverOpts
//     .thinkingLevel（_buildDriverOptions 调用点直挂，plan-review P1-4）；未传
//     → 无键零回归。
//   - daemon handler 侧：session_id 非字符串 → throw；set 的 level 非字符串/词表
//     外 → throw；_sessionManager=null → throw 'session manager not ready'
//     （backend 收 RemoteError，task-05 映射）；正常路径 result 对象回传；守卫
//     错误如实上抛不吞。
//   - execPayload 归一化：rawExec.thinkingLevel / rawExec.thinking_level /
//     payload.thinkingLevel 三源回退（Grill P0-1）+ 旧 backend 无键 → undefined。
//
// mock 构造照 tests/interactive/session-compact.test.ts（session-manager 侧）与
// tests/daemon-resume-input.test.ts（daemon TASK_AVAILABLE 全链路侧）范式。

import { describe, it, expect, afterEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import type { Query } from '@anthropic-ai/claude-agent-sdk';
import { SessionManager } from '../../src/interactive/session-manager.js';
import type { ClaudeSdkDriver } from '../../src/interactive/claude-sdk-driver.js';
import type {
  ThinkingLevelResult,
  ThinkingLevels,
} from '../../src/interactive/driver.js';
import {
  SessionNotFoundError,
  SessionNotActiveError,
  SessionBusyError,
} from '../../src/interactive/types.js';
import { Daemon } from '../../src/daemon.js';
import type { DaemonConfig } from '../../src/config.js';
import type { SessionManager as SessionManagerType } from '../../src/interactive/session-manager.js';
import { MSG } from '../../src/protocol.js';
import type { WsClientCallbacks } from '../../src/ws-client.js';

// ── session-manager 侧 fixtures（照 session-compact.test.ts）────────────────

function makeMockDriver(
  opts: {
    getThinkingLevels?: ReturnType<typeof vi.fn>;
    setThinkingLevel?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const fakeQuery = { interrupt: vi.fn(async () => {}) } as unknown as Query;

  const driver = {
    start: vi.fn(() => fakeQuery),
    consume: vi.fn(async () => {}),
    interrupt: vi.fn(async () => true),
    // 缺省不带两方法（⑤ 守卫用例：driver 未实现可选方法 = 真实 claude/codex/pi
    // driver 在 task-04 落地前的形态；cursor 永不实现）。
    ...(opts.getThinkingLevels
      ? { getThinkingLevels: opts.getThinkingLevels }
      : {}),
    ...(opts.setThinkingLevel
      ? { setThinkingLevel: opts.setThinkingLevel }
      : {}),
  } as unknown as ClaudeSdkDriver;

  return { driver, fakeQuery };
}

function makeDeps() {
  return {
    onTurnResult: vi.fn(async () => {}),
    onTurnMessage: vi.fn(async () => {}),
    onSessionEnd: vi.fn(async () => {}),
  };
}

const BASE_INPUT = {
  sessionId: 'sess-1',
  leaseId: 'lease-1',
  firstPrompt: 'hi',
  firstRunId: 'run-1',
  cwd: 'C:\\work',
  provider: 'claude' as const,
  pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe',
};

/** 直改 store 内 state（照 session-interrupt.test.ts:225 直接改私有字段的先例）。 */
function mutateState(
  sm: SessionManager,
  sessionId: string,
  patch: Record<string, unknown>,
): void {
  Object.assign(sm.get(sessionId) as object, patch);
}

// ── setThinkingLevel 六守卫矩阵（D-002 仅空闲切换）──────────────────────────

describe('task-03 setThinkingLevel 守卫矩阵（照 compact 六守卫先例 throw）', () => {
  it('⓪ level 词表外（大小写敏感精确匹配）→ throw，不分派 driver', async () => {
    const setSpy = vi.fn(async () => ({ ok: true }));
    const { driver } = makeMockDriver({ setThinkingLevel: setSpy });
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    mutateState(sm, 'sess-1', { status: 'active' });
    await expect(sm.setThinkingLevel('sess-1', 'HIGH')).rejects.toThrow(
      /invalid thinking level/,
    );
    await expect(sm.setThinkingLevel('sess-1', 'ultra')).rejects.toThrow(
      /invalid thinking level/,
    );
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('① session 不存在 → SessionNotFoundError', async () => {
    const { driver } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await expect(sm.setThinkingLevel('nope', 'high')).rejects.toThrow(
      SessionNotFoundError,
    );
  });

  it('② status=running（turn 进行中）→ SessionBusyError（稍后重试语义）', async () => {
    const setSpy = vi.fn(async () => ({ ok: true }));
    const { driver } = makeMockDriver({ setThinkingLevel: setSpy });
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    // create 后首 turn 在跑（session-interrupt.test.ts:121 同口径）。
    expect(sm.get('sess-1')!.status).toBe('running');
    await expect(sm.setThinkingLevel('sess-1', 'high')).rejects.toThrow(
      SessionBusyError,
    );
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('③ status=reconnecting → SessionNotActiveError', async () => {
    const setSpy = vi.fn(async () => ({ ok: true }));
    const { driver } = makeMockDriver({ setThinkingLevel: setSpy });
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    mutateState(sm, 'sess-1', { status: 'reconnecting' });
    await expect(sm.setThinkingLevel('sess-1', 'high')).rejects.toThrow(
      SessionNotActiveError,
    );
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('④ status=ended → SessionNotActiveError', async () => {
    const { driver } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    mutateState(sm, 'sess-1', { status: 'ended' });
    await expect(sm.setThinkingLevel('sess-1', 'high')).rejects.toThrow(
      SessionNotActiveError,
    );
  });

  it('④ status=failed → SessionNotActiveError', async () => {
    const { driver } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    mutateState(sm, 'sess-1', { status: 'failed' });
    await expect(sm.setThinkingLevel('sess-1', 'high')).rejects.toThrow(
      SessionNotActiveError,
    );
  });

  it('⑤ driver 未实现 setThinkingLevel 方法 → throw（caps=true 但版本错位，D-002 双保险）', async () => {
    const { driver } = makeMockDriver(); // claude caps.thinking_level=true，但 mock 无方法
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    mutateState(sm, 'sess-1', { status: 'active' });
    await expect(sm.setThinkingLevel('sess-1', 'high')).rejects.toThrow(
      /setThinkingLevel not supported by driver/,
    );
  });

  it('⑥ getProviderCaps(provider).thinking_level=false（cursor）→ throw，即使 driver 有方法', async () => {
    const setSpy = vi.fn(async () => ({ ok: true }));
    const { driver } = makeMockDriver({ setThinkingLevel: setSpy });
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    // provider 改 cursor（PROVIDER_CAPS.cursor.thinking_level=false），driver 归属随 state。
    mutateState(sm, 'sess-1', { status: 'active', provider: 'cursor' });
    await expect(sm.setThinkingLevel('sess-1', 'high')).rejects.toThrow(
      /setThinkingLevel not supported for provider: cursor/,
    );
    expect(setSpy).not.toHaveBeenCalled();
  });
});

// ── getThinkingLevels 轻守卫（running 期间可查，R-04）───────────────────────

describe('task-03 getThinkingLevels 轻守卫（仅终态拒绝）', () => {
  it('① session 不存在 → SessionNotFoundError', async () => {
    const { driver } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await expect(sm.getThinkingLevels('nope')).rejects.toThrow(
      SessionNotFoundError,
    );
  });

  it('② status=ended → SessionNotActiveError', async () => {
    const { driver } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    mutateState(sm, 'sess-1', { status: 'ended' });
    await expect(sm.getThinkingLevels('sess-1')).rejects.toThrow(
      SessionNotActiveError,
    );
  });

  it('② status=failed → SessionNotActiveError', async () => {
    const { driver } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    mutateState(sm, 'sess-1', { status: 'failed' });
    await expect(sm.getThinkingLevels('sess-1')).rejects.toThrow(
      SessionNotActiveError,
    );
  });

  it('③ driver 未实现 getThinkingLevels 方法 → throw（caps=true 但版本错位）', async () => {
    const { driver } = makeMockDriver(); // claude caps.thinking_level=true，但 mock 无方法
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    mutateState(sm, 'sess-1', { status: 'active' });
    await expect(sm.getThinkingLevels('sess-1')).rejects.toThrow(
      /getThinkingLevels not supported by driver/,
    );
  });

  it('④ getProviderCaps(provider).thinking_level=false（cursor）→ throw，即使 driver 有方法', async () => {
    const getSpy = vi.fn(
      async () => ({ levels: ['off', 'high'], current: 'high' }),
    );
    const { driver } = makeMockDriver({ getThinkingLevels: getSpy });
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    mutateState(sm, 'sess-1', { status: 'active', provider: 'cursor' });
    await expect(sm.getThinkingLevels('sess-1')).rejects.toThrow(
      /getThinkingLevels not supported for provider: cursor/,
    );
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('running 期间可查（R-04 切换后查询刷新依赖，不打断在跑轮）', async () => {
    const expected: ThinkingLevels = {
      levels: ['low', 'medium', 'high'],
      current: 'medium',
    };
    const getSpy = vi.fn(async () => expected);
    const { driver } = makeMockDriver({ getThinkingLevels: getSpy });
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    // create 后首 turn 在跑（status=running）——轻守卫放行，不抛 Busy。
    expect(sm.get('sess-1')!.status).toBe('running');
    await expect(sm.getThinkingLevels('sess-1')).resolves.toEqual(expected);
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it('reconnecting 放行（查询无副作用；handle 恰在重建期失效时驱动错误原样上抛）', async () => {
    const expected: ThinkingLevels = { levels: ['high'] };
    const getSpy = vi.fn(async () => expected);
    const { driver } = makeMockDriver({ getThinkingLevels: getSpy });
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    mutateState(sm, 'sess-1', { status: 'reconnecting' });
    await expect(sm.getThinkingLevels('sess-1')).resolves.toEqual(expected);
  });
});

// ── 分派：handle / state.model 传参 + 结果原样透传 ──────────────────────────

describe('task-03 分派：driver 两方法收到 (handle, model / 平台档位串) + 结果透传', () => {
  it('claude 会话 get → driver.getThinkingLevels 收到 (state.query, state.model)（Grill P1-5）', async () => {
    const expected: ThinkingLevels = {
      levels: ['low', 'medium', 'high', 'xhigh', 'max'],
      current: undefined,
    };
    const getSpy = vi.fn(async () => expected);
    const { driver, fakeQuery } = makeMockDriver({ getThinkingLevels: getSpy });
    const sm = new SessionManager({ driver, ...makeDeps() });
    // state.model 由 create 从 CreateSessionInput.model 写入（task-03 补建承载）。
    await sm.create({ ...BASE_INPUT, model: 'claude-sonnet-4-6' });
    mutateState(sm, 'sess-1', { status: 'active' });

    const res = await sm.getThinkingLevels('sess-1');
    expect(getSpy).toHaveBeenCalledTimes(1);
    // handle 选择照 interruptInternal/compact 先例：claude → state.query；
    // model 传参供 claude supportedModels 按当前模型过滤。
    expect(getSpy).toHaveBeenCalledWith(fakeQuery, 'claude-sonnet-4-6');
    expect(res).toEqual(expected);
  });

  it('codex 会话 get → handle=state.driverHandle，model 随 state 透传', async () => {
    const expected: ThinkingLevels = {
      levels: ['minimal', 'low', 'medium', 'high', 'xhigh'],
    };
    const getSpy = vi.fn(async () => expected);
    const { driver } = makeMockDriver({ getThinkingLevels: getSpy });
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    const fakeHandle = { provider: 'codex' as const };
    mutateState(sm, 'sess-1', {
      status: 'active',
      provider: 'codex',
      driverHandle: fakeHandle,
      model: 'gpt-5.1-codex',
    });

    const res = await sm.getThinkingLevels('sess-1');
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).toHaveBeenCalledWith(fakeHandle, 'gpt-5.1-codex');
    expect(res).toEqual(expected);
  });

  it('state.model 未回填（早期会话）→ get 分派 model=undefined（driver 回退默认档表，R-03）', async () => {
    const getSpy = vi.fn(async () => ({ levels: ['low', 'high'] }));
    const { driver, fakeQuery } = makeMockDriver({ getThinkingLevels: getSpy });
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    mutateState(sm, 'sess-1', { status: 'active' });
    await sm.getThinkingLevels('sess-1');
    expect(getSpy).toHaveBeenCalledWith(fakeQuery, undefined);
  });

  it('set → driver.setThinkingLevel 收到平台档位串原样（引擎映射归 driver，task-04）', async () => {
    const expected: ThinkingLevelResult = { ok: true };
    const setSpy = vi.fn(async () => expected);
    const { driver, fakeQuery } = makeMockDriver({ setThinkingLevel: setSpy });
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    mutateState(sm, 'sess-1', { status: 'active' });

    const res = await sm.setThinkingLevel('sess-1', 'xhigh');
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith(fakeQuery, 'xhigh');
    expect(res).toEqual(expected);
  });

  it('set 驱动侧失败 {ok:false} → 原样透传不转译（照 compact 先例）', async () => {
    const expected: ThinkingLevelResult = { ok: false, error: 'rpc timeout' };
    const setSpy = vi.fn(async () => expected);
    const { driver } = makeMockDriver({ setThinkingLevel: setSpy });
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    mutateState(sm, 'sess-1', { status: 'active' });
    await expect(sm.setThinkingLevel('sess-1', 'high')).resolves.toEqual(
      expected,
    );
  });

  it('handle 缺失（provider 互斥字段未填）→ 防御性 throw（不向 driver 传空）', async () => {
    const getSpy = vi.fn(async () => ({ levels: ['low'] }));
    const setSpy = vi.fn(async () => ({ ok: true }));
    const { driver } = makeMockDriver({
      getThinkingLevels: getSpy,
      setThinkingLevel: setSpy,
    });
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    // codex 会话但 driverHandle 未填（互斥字段缺失 = 内部不变量破坏）。
    mutateState(sm, 'sess-1', { status: 'active', provider: 'codex' });
    await expect(sm.getThinkingLevels('sess-1')).rejects.toThrow(
      /getThinkingLevels handle unavailable/,
    );
    await expect(sm.setThinkingLevel('sess-1', 'high')).rejects.toThrow(
      /setThinkingLevel handle unavailable/,
    );
    expect(getSpy).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
  });
});

// ── 创建链：CreateSessionInput.thinkingLevel → driverOpts.thinkingLevel ─────

describe('task-03 创建链：input.thinkingLevel → driver.start 的 driverOpts', () => {
  it('传入 thinkingLevel → driverOpts.thinkingLevel 直达 driver（model 同款邻位）', async () => {
    const { driver } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create({
      ...BASE_INPUT,
      model: 'claude-sonnet-4-6',
      thinkingLevel: 'high',
    });
    expect(driver.start).toHaveBeenCalledTimes(1);
    const startOpts = (driver.start as ReturnType<typeof vi.fn>).mock
      .calls[0]![1] as Record<string, unknown>;
    expect(startOpts.thinkingLevel).toBe('high');
    // model 同款邻位键照常（证明 thinkingLevel 不是靠旁路替换 spec 达成）。
    expect(startOpts.model).toBe('claude-sonnet-4-6');
  });

  it('未传 thinkingLevel（旧 backend / 普通会话）→ driverOpts 无键（零回归）', async () => {
    const { driver } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    const startOpts = (driver.start as ReturnType<typeof vi.fn>).mock
      .calls[0]![1] as Record<string, unknown>;
    expect(startOpts.thinkingLevel).toBeUndefined();
  });
});

// ── daemon 两 RPC handler 侧（照 session-compact.test.ts mock 范式）─────────

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

/** 直调私有 _registerSessionThinkingLevelRpcHandler 捕获两 handler（不 start daemon）。 */
function captureThinkingLevelHandlers(
  daemon: Daemon,
): {
  get: (params: Record<string, unknown>) => Promise<unknown>;
  set: (params: Record<string, unknown>) => Promise<unknown>;
} {
  const reg = vi.fn();
  (
    daemon as unknown as {
      _registerSessionThinkingLevelRpcHandler(ws: unknown): void;
    }
  )._registerSessionThinkingLevelRpcHandler({ registerRpcHandler: reg });
  const getCall = reg.mock.calls.find(([m]) => m === 'session_get_thinking_levels');
  const setCall = reg.mock.calls.find(([m]) => m === 'session_set_thinking_level');
  expect(getCall).toBeDefined();
  expect(setCall).toBeDefined();
  return {
    get: getCall![1] as (params: Record<string, unknown>) => Promise<unknown>,
    set: setCall![1] as (params: Record<string, unknown>) => Promise<unknown>,
  };
}

function buildDaemon(sessionManager?: SessionManagerType): Daemon {
  const client = {
    register: vi.fn(async () => ({})),
    heartbeat: vi.fn(async () => ({})),
    close: vi.fn(),
  };
  const taskRunner = { runLease: vi.fn(async () => ({ success: true })) };
  const detector = { detectAgents: vi.fn(async () => []) };
  return new Daemon(
    mockConfig,
    client as never,
    taskRunner as never,
    { detector, sessionManager } as never,
  );
}

/** mock SessionManager（含两 facade vi.fn，照 daemon-notify 先例鸭子类型）。 */
function createMockSessionManager(impl?: {
  getImpl?: ReturnType<typeof vi.fn>;
  setImpl?: ReturnType<typeof vi.fn>;
}): SessionManagerType {
  return {
    create: vi.fn(async () => {}),
    inject: vi.fn(async () => ({ runId: '' })),
    interrupt: vi.fn(async () => false),
    compact: vi.fn(async () => ({ ok: true })),
    getThinkingLevels: impl?.getImpl ?? vi.fn(async () => ({ levels: ['high'] })),
    setThinkingLevel: impl?.setImpl ?? vi.fn(async () => ({ ok: true })),
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
  } as unknown as SessionManagerType;
}

describe('task-03 daemon session_get/set_thinking_level RPC handler', () => {
  let daemons: Daemon[] = [];

  afterEach(async () => {
    for (const d of daemons) {
      if (d.isRunning) await d.stop().catch(() => undefined);
    }
    daemons = [];
  });

  it('get：params.session_id 非字符串 → throw（不静默空串）', async () => {
    const daemon = buildDaemon(createMockSessionManager());
    daemons.push(daemon);
    const handler = captureThinkingLevelHandlers(daemon).get;
    await expect(handler({})).rejects.toThrow(/session_id required/);
    await expect(handler({ session_id: 123 })).rejects.toThrow(
      /session_id required/,
    );
  });

  it('set：params.level 非字符串 / 词表外 → throw（平台七档单源校验）', async () => {
    const daemon = buildDaemon(createMockSessionManager());
    daemons.push(daemon);
    const handler = captureThinkingLevelHandlers(daemon).set;
    await expect(
      handler({ session_id: 'sess-1', level: 123 }),
    ).rejects.toThrow(/invalid thinking level/);
    await expect(handler({ session_id: 'sess-1' })).rejects.toThrow(
      /invalid thinking level/,
    );
    await expect(
      handler({ session_id: 'sess-1', level: 'HIGH' }),
    ).rejects.toThrow(/invalid thinking level/);
    await expect(
      handler({ session_id: 'sess-1', level: 'turbo' }),
    ).rejects.toThrow(/invalid thinking level/);
  });

  it('get/set：_sessionManager=null（未注入）→ throw session manager not ready（backend 收 RemoteError）', async () => {
    const daemon = buildDaemon(undefined);
    daemons.push(daemon);
    const { get, set } = captureThinkingLevelHandlers(daemon);
    await expect(get({ session_id: 'sess-1' })).rejects.toThrow(
      /session manager not ready/,
    );
    await expect(
      set({ session_id: 'sess-1', level: 'high' }),
    ).rejects.toThrow(/session manager not ready/);
  });

  it('get 正常路径 → sessionManager.getThinkingLevels(sessionId) 被调 + ThinkingLevels 回传', async () => {
    const expected: ThinkingLevels = {
      levels: ['low', 'medium', 'high'],
      current: 'medium',
    };
    const getImpl = vi.fn(async () => expected);
    const sm = createMockSessionManager({ getImpl });
    const daemon = buildDaemon(sm);
    daemons.push(daemon);
    const handler = captureThinkingLevelHandlers(daemon).get;

    await expect(handler({ session_id: 'sess-rpc-1' })).resolves.toEqual(
      expected,
    );
    expect(getImpl).toHaveBeenCalledTimes(1);
    expect(getImpl).toHaveBeenCalledWith('sess-rpc-1');
  });

  it('set 正常路径 → sessionManager.setThinkingLevel(sessionId, level) 被调 + ThinkingLevelResult 回传', async () => {
    const expected: ThinkingLevelResult = { ok: false, error: 'not supported' };
    const setImpl = vi.fn(async () => expected);
    const sm = createMockSessionManager({ setImpl });
    const daemon = buildDaemon(sm);
    daemons.push(daemon);
    const handler = captureThinkingLevelHandlers(daemon).set;

    // ok=false 也原样回传（驱动侧失败不转译；映射责任在 backend task-05）。
    await expect(
      handler({ session_id: 'sess-rpc-1', level: 'medium' }),
    ).resolves.toEqual(expected);
    expect(setImpl).toHaveBeenCalledTimes(1);
    expect(setImpl).toHaveBeenCalledWith('sess-rpc-1', 'medium');
  });

  it('守卫/驱动错误如实上抛不吞（映射责任在 backend task-05）', async () => {
    const getImpl = vi.fn(async () => {
      throw new SessionNotFoundError('sess-gone');
    });
    const sm = createMockSessionManager({ getImpl });
    const daemon = buildDaemon(sm);
    daemons.push(daemon);
    const handler = captureThinkingLevelHandlers(daemon).get;
    await expect(handler({ session_id: 'sess-gone' })).rejects.toThrow(
      SessionNotFoundError,
    );
  });
});

// ── execPayload 归一化（Grill P0-1 三源回退；照 daemon-resume-input.test.ts）──

const wiringConfig: DaemonConfig = {
  ...mockConfig,
  runtime_id: 'runtime-uuid-tl',
  workspace_dir: '/tmp/ws-tl',
  // cwd 守卫终检要求 rootPath 真实存在 + allowed_roots 白名单（见
  // daemon-resume-input.test.ts 夹具债注释）：走正常守卫通过路径。
  allowed_roots: [tmpdir()],
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForSpy(
  spy: { mock: { calls: unknown[][] } },
  { timeout = 3000, interval = 15 }: { timeout?: number; interval?: number } = {},
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (spy.mock.calls.length > 0) return;
    await sleep(interval);
  }
  throw new Error(`waitForSpy: spy 未在 ${timeout}ms 内被调用`);
}

/** daemon TASK_AVAILABLE 全链路 harness（照 daemon-resume-input.test.ts）。 */
function buildWiringDaemon(opts: { sessionManager: SessionManagerType }) {
  const client = {
    register: vi.fn(async () => ({
      daemon_instance_id: 'srv-inst',
      runtimes: [{ provider: 'claude', runtime_id: 'srv-rid-1' }],
    })),
    heartbeat: vi.fn(async () => ({})),
    markOffline: vi.fn(async () => ({})),
    claimLease: vi.fn(async () => ({
      claim_token: 'token-default',
      payload: { prompt: 'hi', provider: 'claude' },
    })),
    startLease: vi.fn(async () => ({})),
    submitMessages: vi.fn(async () => ({})),
    completeLease: vi.fn(async () => ({})),
    getPendingLeases: vi.fn(async () => []),
    getExecutionContext: vi.fn(async () => ({
      agent_run_id: 'run-default',
      claude_md: '',
    })),
    close: vi.fn(),
  };
  const taskRunner = {
    runLease: vi.fn(async () => ({ success: true })),
  };
  const detector = {
    detectAgents: vi.fn(async () => [
      {
        provider: 'claude',
        path: 'C:\\bin\\claude.exe',
        version: '1.0.0',
        protocol: 'stream_json',
        status: 'available' as const,
        versionWarning: null,
      },
    ]),
  };

  let callbacks: WsClientCallbacks = {};
  const wsClientMock = {
    connect: vi.fn(() => {
      callbacks.onConnected?.();
    }),
    close: vi.fn(() => {
      callbacks.onDisconnected?.(1000, 'test_close');
    }),
    send: vi.fn(() => true),
    registerRpcHandler: vi.fn(),
    _injectMessage(msg: { type: string; payload: unknown }): void {
      callbacks.onMessage?.(msg as never);
    },
    _setCallbacks(cb: WsClientCallbacks): void {
      callbacks = cb;
    },
  };
  const wsClientFactory = vi.fn((o: { callbacks: WsClientCallbacks }) => {
    wsClientMock._setCallbacks(o.callbacks);
    return wsClientMock;
  });

  const daemon = new Daemon(
    wiringConfig,
    client as never,
    taskRunner as never,
    {
      detector,
      wsClientFactory,
      sessionManager: opts.sessionManager,
    } as never,
  );
  return { daemon, client, wsClientMock };
}

/** TASK_AVAILABLE 注入（claim payload 由用例先行 mockResolvedValueOnce 定制）。 */
function injectTaskAvailable(
  wsClientMock: ReturnType<typeof buildWiringDaemon>['wsClientMock'],
  extra: Record<string, unknown> = {},
): void {
  wsClientMock._injectMessage({
    type: MSG.TASK_AVAILABLE,
    payload: {
      leaseId: 'lease-tl',
      kind: 'interactive',
      prompt: 'hi',
      agentSessionId: 'sess-tl',
      agentRunId: 'run-tl',
      rootPath: tmpdir(),
      ...extra,
    },
  });
}

describe('task-03 execPayload 归一化：thinkingLevel 三源回退（Grill P0-1）', () => {
  let daemons: Daemon[] = [];

  afterEach(async () => {
    for (const d of daemons) {
      if (d.isRunning) await d.stop().catch(() => undefined);
    }
    daemons = [];
  });

  it('claim payload snake_case thinking_level → CreateSessionInput.thinkingLevel', async () => {
    const sm = createMockSessionManager();
    const { daemon, client, wsClientMock } = buildWiringDaemon({ sessionManager: sm });
    daemons.push(daemon);

    await daemon.start();
    client.claimLease.mockResolvedValueOnce({
      claim_token: 'token-tl1',
      payload: {
        kind: 'interactive',
        prompt: 'hi',
        provider: 'claude',
        agent_session_id: 'sess-tl',
        agent_run_id: 'run-tl',
        root_path: tmpdir(),
        // backend context.py 白名单透传键（snake_case 优先源，model 先例同款）。
        thinking_level: 'high',
      },
    });
    injectTaskAvailable(wsClientMock);
    await waitForSpy(sm.create as unknown as { mock: { calls: unknown[][] } });

    expect(sm.create).toHaveBeenCalledOnce();
    const createArg = (sm.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(createArg.thinkingLevel).toBe('high');
    await daemon.stop();
  });

  it('claim payload camelCase thinkingLevel → CreateSessionInput.thinkingLevel（camel 兜底）', async () => {
    const sm = createMockSessionManager();
    const { daemon, client, wsClientMock } = buildWiringDaemon({ sessionManager: sm });
    daemons.push(daemon);

    await daemon.start();
    client.claimLease.mockResolvedValueOnce({
      claim_token: 'token-tl2',
      payload: {
        kind: 'interactive',
        prompt: 'hi',
        provider: 'claude',
        agent_session_id: 'sess-tl',
        agent_run_id: 'run-tl',
        root_path: tmpdir(),
        // 仅 camelCase（归一化区 rawExec.thinkingLevel 分支兜底）。
        thinkingLevel: 'xhigh',
      },
    });
    injectTaskAvailable(wsClientMock);
    await waitForSpy(sm.create as unknown as { mock: { calls: unknown[][] } });

    const createArg = (sm.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(createArg.thinkingLevel).toBe('xhigh');
    await daemon.stop();
  });

  it('claim 无键 → TASK_AVAILABLE payload.thinkingLevel 第三源兜底', async () => {
    const sm = createMockSessionManager();
    const { daemon, client, wsClientMock } = buildWiringDaemon({ sessionManager: sm });
    daemons.push(daemon);

    await daemon.start();
    // claim payload 无 thinking 键（模拟仅初始 lease payload 携带的防御兜底源）。
    client.claimLease.mockResolvedValueOnce({
      claim_token: 'token-tl3',
      payload: {
        kind: 'interactive',
        prompt: 'hi',
        provider: 'claude',
        agent_session_id: 'sess-tl',
        agent_run_id: 'run-tl',
        root_path: tmpdir(),
      },
    });
    // 第三源：_runLeaseStateMachine 的初始 payload（TASK_AVAILABLE 消息体）。
    injectTaskAvailable(wsClientMock, { thinkingLevel: 'max' });
    await waitForSpy(sm.create as unknown as { mock: { calls: unknown[][] } });

    const createArg = (sm.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(createArg.thinkingLevel).toBe('max');
    await daemon.stop();
  });

  it('旧 backend 无键（claim 与 payload 均无）→ thinkingLevel undefined 零行为变化', async () => {
    const sm = createMockSessionManager();
    const { daemon, client, wsClientMock } = buildWiringDaemon({ sessionManager: sm });
    daemons.push(daemon);

    await daemon.start();
    client.claimLease.mockResolvedValueOnce({
      claim_token: 'token-tl4',
      payload: {
        kind: 'interactive',
        prompt: 'hi',
        provider: 'claude',
        agent_session_id: 'sess-tl',
        agent_run_id: 'run-tl',
        root_path: tmpdir(),
        // 旧 backend：无 thinkingLevel / thinking_level。
      },
    });
    injectTaskAvailable(wsClientMock);
    await waitForSpy(sm.create as unknown as { mock: { calls: unknown[][] } });

    // 会话创建路径不受影响（create 恰好一次）+ thinkingLevel 键值为 undefined
    //（不携带档位，引擎默认，零回归）。
    expect(sm.create).toHaveBeenCalledOnce();
    const createArg = (sm.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(createArg.thinkingLevel).toBeUndefined();
    // 其余必填链路照常（证明零行为变化不是靠旁路 create 达成）。
    expect(createArg.claimToken).toBe('token-tl4');
    expect(createArg.firstPrompt).toBe('hi');
    await daemon.stop();
  });
});
