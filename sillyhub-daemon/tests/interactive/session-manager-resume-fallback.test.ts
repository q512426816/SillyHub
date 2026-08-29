// tests/interactive/session-manager-resume-fallback.test.ts
// task-05（2026-08-29-batch-session-inherit / S4 / FR-04 / D-002@v1）：create 带
// resume 时 SDK 启动即报会话损伤（session not found 等）→ 自动清 resume 以同参
// fresh 重建一次 + resume_downgraded 日志披露（含原 resume id）；降级一次为限
// 不循环；非损伤错误 / 无 resume 不降级走原失败路径。
//
// 策略对齐 session-manager-resume-config-dir.test.ts：mock ClaudeSdkDriver 按
// 调用序可编程抛错（第 N 次 start 抛什么），捕获每次 start opts 断言 resume 键
// 有无；console.warn spy 断言 resume_downgraded 上报与零上报。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Query,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import {
  RESUME_DAMAGE_PATTERNS,
  SessionManager,
} from '../../src/interactive/session-manager.js';
import type {
  ClaudeSdkDriver,
  ConsumeCallbacks,
  StartOptions,
} from '../../src/interactive/claude-sdk-driver.js';

// ── mock driver：start 按调用序可编程抛错，其余返回 fakeQuery ────────────────

/** 第 N 次 start 的行为：Error = 抛出；undefined = 成功返回 fakeQuery。 */
type StartBehavior = Error | undefined;

function makeMockClaudeDriver(startBehaviors: StartBehavior[]) {
  const startCalls: Array<{ opts: StartOptions }> = [];
  const fakeQuery = { interrupt: vi.fn(async () => {}) } as unknown as Query;

  const driver = {
    start: vi.fn(
      (_input: AsyncIterable<SDKUserMessage>, opts: StartOptions): Query => {
        startCalls.push({ opts });
        const behavior = startBehaviors[startCalls.length - 1];
        if (behavior instanceof Error) throw behavior;
        return fakeQuery;
      },
    ),
    consume: vi.fn(async (_q: Query, _cb: ConsumeCallbacks): Promise<void> => {
      // 挂起协程：真实 consume 长生命周期不结束，这里直接返回即可。
    }),
    interrupt: vi.fn(async () => true),
  } as unknown as ClaudeSdkDriver;

  return { driver, startCalls };
}

function makeDeps() {
  return {
    onTurnResult: vi.fn(async () => {}),
    onTurnMessage: vi.fn(async () => {}),
    onSessionEnd: vi.fn(async () => {}),
  };
}

const BASE_INPUT = {
  sessionId: 'sess-fb',
  leaseId: 'lease-fb',
  claimToken: 'claim-fb',
  firstPrompt: 'hi',
  firstRunId: 'run-fb',
  cwd: 'C:\\work',
  provider: 'claude' as const,
  pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe',
};

/** 读内部 store / pendingFirstPrompt（对齐 config-dir 测试的反射口径）。 */
function readInternals(sm: SessionManager, sessionId: string) {
  const store = (sm as unknown as { _store: Map<string, unknown> })._store;
  const pending = (sm as unknown as {
    _pendingFirstPrompt: Map<string, unknown>;
  })._pendingFirstPrompt;
  return {
    state: store.get(sessionId) as { status?: string } | undefined,
    pendingCount: pending.has(sessionId) ? 1 : 0,
  };
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

/** 断言 resume_downgraded 恰好出现 expected 次（零上报断言传 0）。 */
function expectDowngradeLogs(expected: number) {
  const calls = warnSpy.mock.calls.filter(
    (c) => c[0] === '[session-manager] resume_downgraded',
  );
  expect(calls.length).toBe(expected);
  return calls;
}

// ── RESUME_DAMAGE_PATTERNS：单点损伤判定（实现与测试共用导出） ────────────────

describe('task-05: RESUME_DAMAGE_PATTERNS 损伤判定正则', () => {
  it('命中三模式（大小写不敏感）', () => {
    expect(RESUME_DAMAGE_PATTERNS.test('Session not found: abc123')).toBe(true);
    expect(RESUME_DAMAGE_PATTERNS.test('session not found')).toBe(true);
    expect(
      RESUME_DAMAGE_PATTERNS.test('No conversation found with session ID: abc'),
    ).toBe(true);
    expect(RESUME_DAMAGE_PATTERNS.test('unable to resume session abc')).toBe(
      true,
    );
  });

  it('普通启动错误不命中（防误伤）', () => {
    expect(RESUME_DAMAGE_PATTERNS.test('spawn C:\\bin\\claude.exe ENOENT')).toBe(
      false,
    );
    expect(RESUME_DAMAGE_PATTERNS.test('connect ECONNREFUSED 127.0.0.1:80')).toBe(
      false,
    );
    expect(RESUME_DAMAGE_PATTERNS.test('permission denied')).toBe(false);
  });
});

// ── create 带 resume 的损伤自动降级 ──────────────────────────────────────────

describe('task-05: create 带 resume 的损伤自动降级', () => {
  it('损伤错误 → 清 resume fresh 重建成功（第二次 start opts 无 resume 键）+ resume_downgraded 日志', async () => {
    const mock = makeMockClaudeDriver([
      new Error('Session not found: sdk-old-1'),
      undefined, // 第二次（fresh 重建）成功
    ]);
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });

    await sm.create({ ...BASE_INPUT, resume: 'sdk-old-1' });

    // 第一次带 resume 续旧会话，第二次 fresh 重建。
    expect(mock.startCalls.length).toBe(2);
    expect(mock.startCalls[0].opts.resume).toBe('sdk-old-1');
    // 重建 start opts **无 resume 键**（fresh；非 undefined 值残留）。
    expect('resume' in mock.startCalls[1].opts).toBe(false);

    // 披露：恰好一次，含原 resume id。
    const logs = expectDowngradeLogs(1);
    expect(logs[0][1]).toMatchObject({
      sessionId: BASE_INPUT.sessionId,
      resume: 'sdk-old-1',
    });

    // 降级成功：会话存活（status=running），首轮挂起重新登记（旧 timer 已清，
    // 恰一条防首句双提交）。
    const internals = readInternals(sm, BASE_INPUT.sessionId);
    expect(internals.state?.status).toBe('running');
    expect(internals.pendingCount).toBe(1);
  });

  it('损伤文案变体（no conversation found / unable to resume）同样触发降级', async () => {
    const mock = makeMockClaudeDriver([
      new Error('No conversation found with session ID: sdk-old-2'),
      undefined,
    ]);
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });

    await sm.create({ ...BASE_INPUT, resume: 'sdk-old-2' });

    expect(mock.startCalls.length).toBe(2);
    expect('resume' in mock.startCalls[1].opts).toBe(false);
    expectDowngradeLogs(1);
  });

  it('降级重建再失败 → 按普通 create 失败抛出（不二次降级/不循环）', async () => {
    const mock = makeMockClaudeDriver([
      new Error('session not found: sdk-old-3'),
      new Error('unable to resume: rebuild also broken'),
    ]);
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });

    // 第二次失败按普通失败路径抛出（错误透传原始 message）。
    await expect(
      sm.create({ ...BASE_INPUT, resume: 'sdk-old-3' }),
    ).rejects.toThrow('unable to resume: rebuild also broken');

    // 恰好两次 start（首次 + 降级重建一次），无第三次 → 不循环。
    expect(mock.startCalls.length).toBe(2);
    // 降级披露只发生一次（针对首次损伤），重建失败不再报降级。
    expectDowngradeLogs(1);
    // 半建 state 已清理（普通失败路径语义）。
    expect(readInternals(sm, BASE_INPUT.sessionId).state).toBeUndefined();
  });

  it('非损伤错误（ENOENT）→ 不降级直接抛', async () => {
    const mock = makeMockClaudeDriver([
      new Error("spawn C:\\bin\\claude.exe ENOENT"),
    ]);
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });

    await expect(
      sm.create({ ...BASE_INPUT, resume: 'sdk-old-4' }),
    ).rejects.toThrow('ENOENT');

    // 仅一次 start，零降级上报。
    expect(mock.startCalls.length).toBe(1);
    expectDowngradeLogs(0);
  });

  it('不带 resume + 损伤文案错误 → 原路径不降级', async () => {
    const mock = makeMockClaudeDriver([
      new Error('session not found: someone else'),
    ]);
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });

    await expect(sm.create({ ...BASE_INPUT })).rejects.toThrow(
      'session not found',
    );

    expect(mock.startCalls.length).toBe(1);
    expectDowngradeLogs(0);
  });

  it('不带 resume + 普通错误 → 原路径（无降级分支，零回归）', async () => {
    const mock = makeMockClaudeDriver([
      new Error('connect ECONNREFUSED 127.0.0.1:80'),
    ]);
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });

    await expect(sm.create({ ...BASE_INPUT })).rejects.toThrow('ECONNREFUSED');

    expect(mock.startCalls.length).toBe(1);
    expectDowngradeLogs(0);
  });
});

// ── create 透传：resume 进 driverOpts.resume（无损伤时一次即成） ───────────────

describe('task-05: create 透传 input.resume → driverOpts.resume', () => {
  it('resume 正常启动（无错误）→ 第一次 start opts 带 resume 键且值透传', async () => {
    const mock = makeMockClaudeDriver([undefined]);
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });

    await sm.create({ ...BASE_INPUT, resume: 'sdk-healthy' });

    expect(mock.startCalls.length).toBe(1);
    expect(mock.startCalls[0].opts.resume).toBe('sdk-healthy');
    expectDowngradeLogs(0);
  });

  it('不带 resume → start opts 无 resume 键（零回归）', async () => {
    const mock = makeMockClaudeDriver([undefined]);
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });

    await sm.create({ ...BASE_INPUT });

    expect(mock.startCalls.length).toBe(1);
    expect('resume' in mock.startCalls[0].opts).toBe(false);
    expectDowngradeLogs(0);
  });
});
