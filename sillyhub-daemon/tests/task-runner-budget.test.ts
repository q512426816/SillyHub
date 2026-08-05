// tests/task-runner-budget.test.ts
// task-08（D-006 / D-009 / FR-05 / FR-07）：batch lease budget 累计 + 软切断检查点。
//
// 覆盖：
//   (a) 累计器口径 D-009：input_tokens + output_tokens（**不含** cache_read /
//       cache_creation）—— cache 巨大但 input+output 在阈值下 → 不触发。
//   (b) 超 budget → overBudget：经 submitMessages 回传 budget_exceeded 事件
//       （reason + usage.input_tokens + usage.output_tokens），**不**调 child.kill
//       （D-006 软切断：当前 step 跑完）。
//   (c) budget_tokens undefined → 检查点短路：无事件、无 kill、行为零变化（FR-07）。
//
// 复用 stats-passthrough.test.ts 同款 StreamJsonAdapter + FakeChild 驱动模式。

import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../src/skill-manager.js', () => ({ linkSkillsToWorkdir: vi.fn(async () => ({ linked: 0, skipped: true })) }));

let mockAdapter: Record<string, unknown> = {};

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: vi.fn(() => null as unknown),
  };
});

vi.mock('../src/adapters/index.js', () => ({
  getBackend: vi.fn((_provider: string) => mockAdapter),
}));

import { spawn } from 'node:child_process';
import { TaskRunner, extractBudgetUsageTokens } from '../src/task-runner.js';
import { StreamJsonAdapter } from '../src/adapters/stream-json.js';
import { createFakeChild } from './helpers/fake-child.js';
import type { LeaseCtx } from '../src/types.js';

// ── 测试工具 ────────────────────────────────────────────────────────────────

function makeMockClient(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    startLease: vi.fn().mockResolvedValue({}),
    submitMessages: vi.fn().mockResolvedValue({ status: 'ok' }),
    completeLease: vi.fn().mockResolvedValue({}),
    leaseHeartbeat: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

function makeMockWorkspace(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    prepareWorkspace: vi.fn().mockResolvedValue('/tmp/ws/test'),
    collectDiff: vi.fn().mockResolvedValue({
      patch: '',
      files_changed: 0,
      insertions: 0,
      deletions: 0,
      stats: '',
    }),
    ...overrides,
  };
}

function makeLease(overrides: Partial<LeaseCtx> = {}): LeaseCtx {
  return {
    leaseId: 'lease-bg',
    runtimeId: 'rt-1',
    claimToken: 'tok',
    workspaceName: 'test-ws',
    claudeMd: '',
    prompt: 'hello',
    provider: 'claude',
    cmdPath: '/usr/local/bin/claude',
    agentRunId: 'run-1',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAdapter = {};
});

// ─────────────────────────────────────────────────────────────────────────────
// 纯函数：extractBudgetUsageTokens（D-009 口径：input+output，不含 cache）
// ─────────────────────────────────────────────────────────────────────────────

describe('task-08 / extractBudgetUsageTokens（D-009 口径）', () => {
  it('input + output 求和（基础）', () => {
    expect(
      extractBudgetUsageTokens({ input_tokens: 60, output_tokens: 40 }),
    ).toBe(100);
  });

  it('cache_read / cache_creation **不计入**（D-009 硬约束）', () => {
    expect(
      extractBudgetUsageTokens({
        input_tokens: 10,
        output_tokens: 5,
        cache_read_tokens: 999_999,
        cache_creation_tokens: 999_999,
      }),
    ).toBe(15);
  });

  it('undefined / 缺字段 → 0', () => {
    expect(extractBudgetUsageTokens(undefined)).toBe(0);
    expect(extractBudgetUsageTokens({})).toBe(0);
  });

  it('非数字 / NaN → 按字段 0（防脏 stats 误触发）', () => {
    expect(
      extractBudgetUsageTokens({
        input_tokens: 'oops' as unknown as number,
        output_tokens: NaN,
      }),
    ).toBe(0);
  });

  it('0 值合法（不丢）', () => {
    expect(extractBudgetUsageTokens({ input_tokens: 0, output_tokens: 0 })).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 集成：runLease 软切断路径
// ─────────────────────────────────────────────────────────────────────────────

describe('task-08 / budget 软切断（batch runLease 集成）', () => {
  beforeEach(() => {
    // 真实 adapter：让 parse 完整跑过，stats 走 extractResultStats 累加。
    mockAdapter = new StreamJsonAdapter('claude');
  });

  it('case(b): 超 budget → 发 budget_exceeded + 不调 child.kill（D-006）', async () => {
    const client = makeMockClient();
    const workspace = makeMockWorkspace();
    const credential = { get: vi.fn(() => undefined), buildEnv: vi.fn(() => ({})) };
    const runner = new TaskRunner(
      client as never,
      workspace as never,
      credential as never,
    );

    const child = createFakeChild();
    const killSpy = vi.spyOn(child, 'kill');
    vi.mocked(spawn).mockReturnValue(child as never);

    // budget=100。assistant usage 60/30 + result usage 50/40 = input 110 / output 70 = 180 ≥ 100。
    const lease = makeLease({ budget_tokens: 100 });
    const runPromise = runner.runLease(lease);

    await new Promise((r) => setImmediate(r));

    child._emitLines([
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'working' }],
          usage: { input_tokens: 60, output_tokens: 30 },
        },
      }),
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'done',
        session_id: 'sess-bg',
        usage: { input_tokens: 50, output_tokens: 40 },
      }),
    ]);
    child._endStdout();
    child._emitExit(0);

    const result = await runPromise;

    // budget_exceeded 经 submitMessages 回传。
    const submitCalls = (client.submitMessages as ReturnType<typeof vi.fn>).mock.calls;
    const budgetCall = submitCalls.find((call: unknown[]) => {
      const msgs = call[3] as Record<string, unknown>[] | undefined;
      return Array.isArray(msgs) && msgs.some(
        (m) => m.reason === 'budget_exceeded',
      );
    });
    expect(budgetCall).toBeDefined();
    const budgetMsg = (budgetCall![3] as Record<string, unknown>[]).find(
      (m) => m.reason === 'budget_exceeded',
    )!;
    expect(budgetMsg.usage).toEqual({
      input_tokens: 110, // 60 + 50
      output_tokens: 70, // 30 + 40
    });
    expect(budgetMsg.budget_tokens).toBe(100);

    // D-006 软切断：当前 step 自然跑完（status=completed，未硬 kill）。
    expect(killSpy).not.toHaveBeenCalled();
    expect(result.status).toBe('completed');
    killSpy.mockRestore();
  });

  it('case(a): cache 巨大但 input+output 在阈值下 → 不触发（D-009 口径）', async () => {
    const client = makeMockClient();
    const workspace = makeMockWorkspace();
    const credential = { get: vi.fn(() => undefined), buildEnv: vi.fn(() => ({})) };
    const runner = new TaskRunner(
      client as never,
      workspace as never,
      credential as never,
    );

    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    // budget=1000。input+output = 60+30 = 90（远低）；cache_read 巨大但**不计入**。
    const lease = makeLease({ budget_tokens: 1000 });
    const runPromise = runner.runLease(lease);

    await new Promise((r) => setImmediate(r));

    child._emitLines([
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'working' }],
          usage: {
            input_tokens: 60,
            output_tokens: 30,
            cache_read_input_tokens: 999_999,
            cache_creation_input_tokens: 999_999,
          },
        },
      }),
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'done',
        session_id: 'sess-bg2',
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 999_999,
          cache_creation_input_tokens: 999_999,
        },
      }),
    ]);
    child._endStdout();
    child._emitExit(0);

    await runPromise;

    // 无 budget_exceeded 事件。
    const submitCalls = (client.submitMessages as ReturnType<typeof vi.fn>).mock.calls;
    const hasBudgetCall = submitCalls.some((call: unknown[]) => {
      const msgs = call[3] as Record<string, unknown>[] | undefined;
      return Array.isArray(msgs) && msgs.some((m) => m.reason === 'budget_exceeded');
    });
    expect(hasBudgetCall).toBe(false);
  });

  it('case(c): budget_tokens undefined → 检查点短路（FR-07 零回归）', async () => {
    const client = makeMockClient();
    const workspace = makeMockWorkspace();
    const credential = { get: vi.fn(() => undefined), buildEnv: vi.fn(() => ({})) };
    const runner = new TaskRunner(
      client as never,
      workspace as never,
      credential as never,
    );

    const child = createFakeChild();
    const killSpy = vi.spyOn(child, 'kill');
    vi.mocked(spawn).mockReturnValue(child as never);

    // 无 budget_tokens（undefined）。usage 巨大也不触发。
    const lease = makeLease();
    expect(lease.budget_tokens).toBeUndefined();
    const runPromise = runner.runLease(lease);

    await new Promise((r) => setImmediate(r));

    child._emitLines([
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'working' }],
          usage: { input_tokens: 99_999, output_tokens: 99_999 },
        },
      }),
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'done',
        session_id: 'sess-bg3',
        usage: { input_tokens: 99_999, output_tokens: 99_999 },
      }),
    ]);
    child._endStdout();
    child._emitExit(0);

    const result = await runPromise;

    const submitCalls = (client.submitMessages as ReturnType<typeof vi.fn>).mock.calls;
    const hasBudgetCall = submitCalls.some((call: unknown[]) => {
      const msgs = call[3] as Record<string, unknown>[] | undefined;
      return Array.isArray(msgs) && msgs.some((m) => m.reason === 'budget_exceeded');
    });
    expect(hasBudgetCall).toBe(false);
    expect(killSpy).not.toHaveBeenCalled();
    expect(result.status).toBe('completed');
    killSpy.mockRestore();
  });

  it('事件幂等：单次 runLease 仅发一次 budget_exceeded', async () => {
    const client = makeMockClient();
    const workspace = makeMockWorkspace();
    const credential = { get: vi.fn(() => undefined), buildEnv: vi.fn(() => ({})) };
    const runner = new TaskRunner(
      client as never,
      workspace as never,
      credential as never,
    );

    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    // budget=10；多个 result 行均超 → 只发一次。
    const lease = makeLease({ budget_tokens: 10 });
    const runPromise = runner.runLease(lease);

    await new Promise((r) => setImmediate(r));

    const resultLine = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'done',
      session_id: 'sess-bg-idem',
      usage: { input_tokens: 100, output_tokens: 100 },
    });
    child._emitLines([resultLine, resultLine, resultLine]);
    child._endStdout();
    child._emitExit(0);

    await runPromise;

    const submitCalls = (client.submitMessages as ReturnType<typeof vi.fn>).mock.calls;
    const budgetCalls = submitCalls.filter((call: unknown[]) => {
      const msgs = call[3] as Record<string, unknown>[] | undefined;
      return Array.isArray(msgs) && msgs.some((m) => m.reason === 'budget_exceeded');
    });
    expect(budgetCalls.length).toBe(1);
  });
});
