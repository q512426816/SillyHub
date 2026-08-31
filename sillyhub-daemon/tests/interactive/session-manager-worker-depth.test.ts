// tests/interactive/session-manager-worker-depth.test.ts
// task-04（2026-08-26-team-subsession-recursion / design §5.C+§5.D / FR-04 / FR-06）：
// worker_depth 透传链承载 + daemon 会话总数闸测试。
//
// 覆盖（TaskCard acceptance）：
//   A. 承载链——create 传 worker_depth → state.worker_depth + MainAgentMcpContext
//      （谓词收到的 ctx 带 worker_depth）；缺省 → 全链 undefined（零回归）；
//   B. 保档（M3）——snapshotPersistable 输出 rec.worker_depth；restoreAndReconnect
//      从 record 保档（state + ctx）；reload（供应商热切换）ctx 补字段；
//   C. 会话总数闸——SILLYHUB_MAX_ACTIVE_SESSIONS（默认 20，0=不限）create 前置
//      计数 _store 活会话（终态 ended/failed 延迟清理条目不计）≥ 上限抛
//      SessionLimitReached；restore 不受限（design §7「会话闸误伤 restore」）。
//
// 注：工具集按 depth 分档（非叶 5 工具 / 叶仅 worker_done）的判定归 task-05——
// 本卡 MainAgentMcpContext 只承载字段，谓词消费以 mock 捕获 ctx 验证可达性。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Query, SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { SessionManager } from '../../src/interactive/session-manager.js';
import type { MainAgentMcpContext } from '../../src/interactive/session-manager.js';
import { SessionLimitReached } from '../../src/interactive/types.js';
import type {
  ClaudeSdkDriver,
  ConsumeCallbacks,
  StartOptions,
} from '../../src/interactive/claude-sdk-driver.js';

// ── mock driver（捕获 start opts + 谓词 ctx，对齐 worker-restricted-mcp 测试）──

function makeMockDriver() {
  let capturedStartOpts: StartOptions | null = null;
  // 多会话场景（snapshot 测试）：每次 consume 的 callbacks 都留档，emitMessage
  // 广播到全部（单会话测试只有一份，行为与 worker-restricted-mcp 的单槽等价）。
  const callbacksList: ConsumeCallbacks[] = [];
  const fakeQuery = { interrupt: vi.fn(async () => {}) } as unknown as Query;

  const driver: ClaudeSdkDriver = {
    start: vi.fn((_input: AsyncIterable<unknown>, opts: StartOptions): Query => {
      capturedStartOpts = opts;
      return fakeQuery;
    }),
    consume: vi.fn(async (_q: Query, cb: ConsumeCallbacks): Promise<void> => {
      callbacksList.push(cb);
    }),
    interrupt: vi.fn(async () => true),
  } as unknown as ClaudeSdkDriver;

  return {
    driver,
    getStartOpts: () => capturedStartOpts,
    emitMessage: (m: SDKMessage) => {
      for (const cb of callbacksList) cb.onMessage?.(m);
    },
    emitResult: (r: SDKResultMessage) => {
      for (const cb of callbacksList) cb.onResult(r);
    },
  };
}

function makeDeps() {
  return {
    onTurnResult: vi.fn(async () => {}),
    onTurnMessage: vi.fn(async () => {}),
    onSessionEnd: vi.fn(async () => {}),
  };
}

/** flush fire-and-forget 协程（对齐 worker-restricted-mcp 测试）。 */
async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

const BASE_INPUT = {
  sessionId: 'sess-depth-1',
  leaseId: 'lease-1',
  claimToken: 'claim-1',
  firstPrompt: '干活',
  firstRunId: 'run-1',
  cwd: 'C:\\work',
  provider: 'claude' as const,
  pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe',
};

// ════════════════════════════════════════════════════════════════════════════
// A/B. worker_depth 承载链 + snapshot 保档
// ════════════════════════════════════════════════════════════════════════════

describe('task-04: worker_depth 承载链（create / snapshot / restore / reload）', () => {
  it('create 传 worker_depth=1 → state.worker_depth + 谓词 ctx 均可达', async () => {
    const mock = makeMockDriver();
    const workerPredicate = vi.fn((_ctx: MainAgentMcpContext) => false);
    const sm = new SessionManager(
      { driver: mock.driver, ...makeDeps() },
      { isWorkerSession: workerPredicate },
    );

    await sm.create({ ...BASE_INPUT, stage: 'mission_worker', worker_depth: 1 });

    // state 承载（snapshot 输入源）
    expect(sm.get(BASE_INPUT.sessionId)?.worker_depth).toBe(1);
    // MainAgentMcpContext 承载（task-05 谓词/provider 消费点）
    expect(workerPredicate).toHaveBeenCalled();
    const ctx = workerPredicate.mock.calls[0][0] as MainAgentMcpContext;
    expect(ctx.worker_depth).toBe(1);
    expect(ctx.stage).toBe('mission_worker');
  });

  it('缺省不传 worker_depth → state / ctx 全链无键（旧 lease 零回归）', async () => {
    const mock = makeMockDriver();
    const workerPredicate = vi.fn((_ctx: MainAgentMcpContext) => false);
    const sm = new SessionManager(
      { driver: mock.driver, ...makeDeps() },
      { isWorkerSession: workerPredicate },
    );

    await sm.create({ ...BASE_INPUT });

    expect(sm.get(BASE_INPUT.sessionId)?.worker_depth).toBeUndefined();
    const ctx = workerPredicate.mock.calls[0][0] as MainAgentMcpContext;
    // create 路逐字对齐 stage 先例（`worker_depth: input.worker_depth`），键恒在、
    // 值 undefined——验收语义是值级 undefined 穿透（snapshot/reload 的条件写才是键级缺席）。
    expect(ctx.worker_depth).toBeUndefined();
  });

  it('snapshotPersistable 输出 rec.worker_depth（非 undefined 才写，0 合法）', async () => {
    const mock = makeMockDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });

    // session 1：带深度（分身层 1）
    await sm.create({ ...BASE_INPUT, stage: 'mission_worker', worker_depth: 1 });
    // session 2：显式 0（合法值，守护用 !== undefined）
    await sm.create({ ...BASE_INPUT, sessionId: 'sess-depth-0', worker_depth: 0 });
    // session 3：缺省（普通会话）
    await sm.create({ ...BASE_INPUT, sessionId: 'sess-depth-x' });
    // agentSessionId 落位（snapshotPersistable 过滤条件：system/init 后才可恢复）
    mock.emitMessage({
      type: 'system',
      subtype: 'init',
      session_id: 'sdk-1',
    } as unknown as SDKMessage);
    await flushMicrotasks();

    const recs = sm.snapshotPersistable();
    expect(recs).toHaveLength(3);
    const byId = new Map(recs.map((r) => [r.sessionId, r]));
    expect(byId.get('sess-depth-1')?.worker_depth).toBe(1);
    expect(byId.get('sess-depth-0')?.worker_depth).toBe(0);
    expect(byId.get('sess-depth-x')).not.toHaveProperty('worker_depth');
  });

  it('restoreAndReconnect 从 record 保档 → state + 谓词 ctx 均恢复（M3 防降级）', async () => {
    const mock = makeMockDriver();
    const workerPredicate = vi.fn((_ctx: MainAgentMcpContext) => false);
    const sm = new SessionManager(
      { driver: mock.driver, ...makeDeps() },
      { isWorkerSession: workerPredicate },
    );

    await sm.restoreAndReconnect({
      sessionId: 'sess-worker-restore',
      leaseId: 'lease-restore',
      agentSessionId: 'sdk-sess-w',
      cwd: 'C:\\work',
      provider: 'claude',
      turnCount: 3,
      lastActiveAt: Date.now(),
      stage: 'mission_worker',
      worker_depth: 2,
    });

    expect(sm.get('sess-worker-restore')?.worker_depth).toBe(2);
    const ctx = workerPredicate.mock.calls[0][0] as MainAgentMcpContext;
    expect(ctx.worker_depth).toBe(2);
    // resume 不受影响（保档不破坏恢复链路既有行为）
    expect(mock.getStartOpts()?.resume).toBe('sdk-sess-w');
  });

  it('reloadWithProvider（供应商热切换重建 query）ctx 补 worker_depth 字段', async () => {
    const { driver, getStartOpts, emitMessage, emitResult } = makeMockDriver();
    const workerPredicate = vi.fn((_ctx: MainAgentMcpContext) => false);
    const sm = new SessionManager(
      { driver, ...makeDeps() },
      { isWorkerSession: workerPredicate },
    );

    await sm.create({
      ...BASE_INPUT,
      sessionId: 'sess-worker-reload',
      stage: 'mission_worker',
      worker_depth: 1,
    });
    emitMessage({
      type: 'system',
      subtype: 'init',
      session_id: 'sdk-sess-reload',
    } as unknown as SDKMessage);
    await flushMicrotasks();
    emitResult({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'done',
      session_id: 'sdk-sess-reload',
    } as unknown as SDKResultMessage);
    await flushMicrotasks();

    await sm.reloadWithProvider('sess-worker-reload', {
      agent_kind: 'claude',
      base_url: 'https://new.example.com',
      api_key: 'sk-new',
      model: 'm1',
    } as never);

    // reload 后 state 保档 + 谓词 ctx（reload 路归一化）仍带深度
    expect(sm.get('sess-worker-reload')?.worker_depth).toBe(1);
    const reloadCtx = (workerPredicate.mock.calls.at(-1)?.[0] ?? {}) as MainAgentMcpContext;
    expect(reloadCtx.worker_depth).toBe(1);
    expect(getStartOpts()).not.toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// C. 会话总数闸（SILLYHUB_MAX_ACTIVE_SESSIONS，design §5.D / FR-06）
// ════════════════════════════════════════════════════════════════════════════

const GATE_ENV = 'SILLYHUB_MAX_ACTIVE_SESSIONS';

describe('task-04: SessionManager 会话总数闸', () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env[GATE_ENV];
    delete process.env[GATE_ENV];
  });
  afterEach(() => {
    if (savedEnv === undefined) delete process.env[GATE_ENV];
    else process.env[GATE_ENV] = savedEnv;
  });

  function makeManager() {
    const mock = makeMockDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });
    return { sm, mock };
  }

  async function createN(sm: SessionManager, n: number, prefix: string): Promise<void> {
    for (let i = 0; i < n; i++) {
      await sm.create({ ...BASE_INPUT, sessionId: `${prefix}-${i}` });
    }
  }

  it('env=2：活会话数达上限 → create 抛 SessionLimitReached（code 稳定）', async () => {
    process.env[GATE_ENV] = '2';
    const { sm } = makeManager();

    await createN(sm, 2, 'gate');
    await expect(
      sm.create({ ...BASE_INPUT, sessionId: 'gate-over' }),
    ).rejects.toMatchObject({
      name: 'SessionLimitReached',
      code: 'SESSION_LIMIT_REACHED',
    });
    // 拒绝后不留孤儿 state
    expect(sm.get('gate-over')).toBeUndefined();
  });

  it('env=0：不限（0=关闭闸）', async () => {
    process.env[GATE_ENV] = '0';
    const { sm } = makeManager();

    await createN(sm, 3, 'unlimit');
    expect(sm.get('unlimit-2')).toBeDefined();
  });

  it('env 未配：默认上限 20（第 21 个拒绝）', async () => {
    const { sm } = makeManager();

    await createN(sm, 20, 'def');
    await expect(sm.create({ ...BASE_INPUT, sessionId: 'def-over' })).rejects.toBeInstanceOf(
      SessionLimitReached,
    );
  });

  it('终态会话不计数：end 后的延迟清理条目不占闸额度', async () => {
    process.env[GATE_ENV] = '2';
    const { sm } = makeManager();

    await createN(sm, 2, 'term');
    await sm.end('term-0'); // 终态条目保留在 _store（延迟清理），status='ended'
    expect(sm.get('term-0')?.status).toBe('ended');

    // 活会话数 = 1（term-1）→ 新 create 应通过
    await expect(
      sm.create({ ...BASE_INPUT, sessionId: 'term-new' }),
    ).resolves.toBeUndefined();
  });

  it('restore 不受限：已达闸上限时 restoreAndReconnect 照常恢复', async () => {
    process.env[GATE_ENV] = '1';
    const { sm } = makeManager();

    await createN(sm, 1, 'cap');
    // 活会话 1/1 已达上限——restore 另一会话不应被闸拒绝
    await expect(
      sm.restoreAndReconnect({
        sessionId: 'cap-restore',
        leaseId: 'lease-r',
        agentSessionId: 'sdk-r',
        cwd: 'C:\\work',
        provider: 'claude',
        turnCount: 1,
        lastActiveAt: Date.now(),
        worker_depth: 1,
      }),
    ).resolves.toBeUndefined();
    expect(sm.get('cap-restore')?.status).toBe('reconnecting');
  });
});

// ── 审计修复回归（2026-08-26）：F1 env 空串 / F3 budget Map 泄漏 ──

describe("审计 F1/F3 回归", () => {
  it("F1：SILLYHUB_MAX_ACTIVE_SESSIONS 空串回落默认 20（不被 Number('')===0 解析为不限）", async () => {
    process.env.SILLYHUB_MAX_ACTIVE_SESSIONS = "";
    const mock = makeMockDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });

    // 空串 → 默认 20：第 21 个 create 拒绝（若被解析为 0=不限则会成功——回归锚）
    for (let i = 0; i < 20; i++) {
      await sm.create({ ...BASE_INPUT, sessionId: `f1-${i}` });
    }
    await expect(
      sm.create({ ...BASE_INPUT, sessionId: "f1-over" }),
    ).rejects.toBeInstanceOf(SessionLimitReached);
  });

  it("F3：无 partial buffer 的会话 end 后 budget Map 条目同样被回收", async () => {
    const { SessionManager } = await import("../../src/interactive/session-manager.js");
    const mgr = new SessionManager({ isWorkerSession: () => false });
    mgr["_sessionBudgetTokens"].set("sess-f3", 1000);
    mgr["_overBudgetSessions"].add("sess-f3");
    // 无 partial buffer 的会话直接销毁
    mgr["_destroyPartialBuffer"]("sess-f3");
    expect(mgr["_sessionBudgetTokens"].has("sess-f3")).toBe(false);
    expect(mgr["_overBudgetSessions"].has("sess-f3")).toBe(false);
  });
});


// ── P0 修复回归（2026-08-26，会话 2eac7c91）：恢复的历史 idle 会话不占闸额度 ──

describe('审计 P0：会话闸只计真活跃会话', () => {
  it('20 个长期 idle 的恢复态会话不占额度——新 create 正常通过（旧实现 SESSION_LIMIT_REACHED）', async () => {
    const mock = makeMockDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });
    // 直塞 _store：20 个 active 但 lastActiveAt 是 2 小时前（restore 恢复的僵尸态）
    const old = Date.now() - 2 * 60 * 60 * 1000;
    for (let i = 0; i < 20; i++) {
      const st = {
        sessionId: `idle-${i}`,
        leaseId: `l-${i}`,
        provider: 'claude',
        cwd: '/tmp',
        status: 'active',
        lastActiveAt: old,
      } as never;
      sm['_store'].set(`idle-${i}`, st);
    }
    // 默认闸 20：旧实现计数 20 → 拒；新实现真活跃 0 → 通过
    await sm.create({ ...BASE_INPUT, sessionId: 'fresh-1' });
    expect(sm.get('fresh-1')).toBeDefined();
  });

  it('20 个近期活跃会话仍触发闸（防进程风暴语义保留）', async () => {
    const mock = makeMockDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });
    const now = Date.now();
    for (let i = 0; i < 20; i++) {
      sm['_store'].set(`hot-${i}`, {
        sessionId: `hot-${i}`,
        leaseId: `l2-${i}`,
        provider: 'claude',
        cwd: '/tmp',
        status: 'active',
        lastActiveAt: now - 60_000,
      } as never);
    }
    await expect(
      sm.create({ ...BASE_INPUT, sessionId: 'fresh-2' }),
    ).rejects.toMatchObject({ name: 'SessionLimitReached' });
  });

  it('running turn 会话即使 lastActiveAt 陈旧也计入（进行中必有进程）', async () => {
    const mock = makeMockDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });
    const old = Date.now() - 2 * 60 * 60 * 1000;
    for (let i = 0; i < 20; i++) {
      sm['_store'].set(`run-${i}`, {
        sessionId: `run-${i}`,
        leaseId: `l3-${i}`,
        provider: 'claude',
        cwd: '/tmp',
        status: i === 0 ? 'running' : 'active',
        lastActiveAt: old,
      } as never);
    }
    // 只有 1 个 running：其余 idle active 不计 → 通过
    await sm.create({ ...BASE_INPUT, sessionId: 'fresh-3' });
    expect(sm.get('fresh-3')).toBeDefined();
  });

  // ql-20260831-003-3c87（实机会话 b8a2a9c2 实证 21 active >= 20 max）：上方用例
  // 直塞 _store 造僵尸态，绕过了真实恢复链——markReconnected 把恢复会话的
  // lastActiveAt 刷成 Date.now()，P0 的「30 分钟窗口」口径被恢复动作自己击穿，
  // daemon 重启后 30 分钟内满额必拒新会话。本用例走完整链验证不再刷新。
  it('markReconnected 不刷新 lastActiveAt——重启恢复满额后新 create 仍通过', async () => {
    const mock = makeMockDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });
    const old = Date.now() - 2 * 60 * 60 * 1000;
    // 真实恢复链：restoreAndReconnect（保档 record.lastActiveAt）→ markReconnected（切 active）
    for (let i = 0; i < 20; i++) {
      await sm.restoreAndReconnect({
        sessionId: `rc-${i}`,
        leaseId: `l4-${i}`,
        agentSessionId: `sdk-${i}`,
        cwd: 'C:\\work',
        provider: 'claude',
        turnCount: 0,
        lastActiveAt: old,
      });
      await sm.markReconnected(`rc-${i}`);
      expect(sm.get(`rc-${i}`)?.status).toBe('active');
      // 核心断言：恢复是系统动作非用户活动，活跃时间保留盘上原值
      expect(sm.get(`rc-${i}`)?.lastActiveAt).toBe(old);
    }
    // 20 个恢复会话全部 active 但活跃时间在 30 分钟窗口外 → 默认闸 20 仍放行
    await sm.create({ ...BASE_INPUT, sessionId: 'rc-new' });
    expect(sm.get('rc-new')).toBeDefined();
  });
});
