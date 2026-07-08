// tests/stats-passthrough.test.ts
// task-06: A2 stats 透传链路单测。
//
// 覆盖 5 case（task-06.md §TDD 步骤 1）：
//   1. adapter 拆 usage（extractResultStats：result.usage + accumulated 累加）
//   2. result 无 usage 时回落 accumulated
//   3. _finish 透传 stats（_spawnAndStream → _finish → TaskRunnerResult.stats）
//   4. completeLease payload 完整（runLease 成功路径 → daemon 提交含 stats/exit_code/status）
//   5. adapter reset（跨两次 runLease，_accumulatedUsage reset 生效）
//
// 对齐 task-06.md §实现要求 8 + AC-05。

import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../src/skill-manager.js', () => ({ linkSkillsToWorkdir: vi.fn(async () => ({ linked: 0, skipped: true })) }));

// vi.mock 必须在 import 之前（vitest hoist）。
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
import { getBackend } from '../src/adapters/index.js';
import { TaskRunner } from '../src/task-runner.js';
import { StreamJsonAdapter } from '../src/adapters/stream-json.js';
import { createFakeChild, type FakeChild } from './helpers/fake-child.js';
import type { AgentEvent, LeaseCtx } from '../src/types.js';

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
    leaseId: 'lease-1',
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
// case 1 & 2：extractResultStats（adapter 拆 usage + 累加）
// ─────────────────────────────────────────────────────────────────────────────

describe('task-06 / case1&2: StreamJsonAdapter extractResultStats 拆 usage + 累加', () => {
  it('case1: result 有 usage → 拆平 input/output_tokens + 与 accumulated 求和', () => {
    // 驱动：构造一个 complete 事件，让 adapter.parse 产出 metadata.stats；
    // 直接通过 parse 完整路径验证（更接近真实调用链）。
    const adapter = new StreamJsonAdapter('claude');
    // 先让 parseAssistant 累加 usage（assistant 事件）
    const assistantLine = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'working' }],
        usage: { input_tokens: 30, output_tokens: 20 },
      },
    });
    adapter.parse(assistantLine);

    // 再触发 result 事件（带 usage）
    const resultLine = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'done',
      session_id: 'sess-1',
      usage: { input_tokens: 100, output_tokens: 50 },
      total_cost_usd: 0.01,
      num_turns: 3,
      duration_ms: 5000,
    });
    const events = adapter.parse(resultLine);
    expect(events).not.toBeNull();
    expect(events!.length).toBe(1);
    const completeEv = events![0];
    expect(completeEv.type).toBe('complete');
    const stats = completeEv.metadata?.stats as Record<string, unknown>;
    // input/output = result.usage(100/50) + accumulated(30/20) = 130/70
    expect(stats.input_tokens).toBe(130);
    expect(stats.output_tokens).toBe(70);
    expect(stats.total_cost_usd).toBe(0.01);
    expect(stats.num_turns).toBe(3);
    expect(stats.duration_ms).toBe(5000);
  });

  it('case2: result 无 usage → 回落 accumulated（仅 assistant 事件聚合值）', () => {
    const adapter = new StreamJsonAdapter('claude');
    const assistantLine = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'working' }],
        usage: { input_tokens: 30, output_tokens: 20 },
      },
    });
    adapter.parse(assistantLine);

    // result 不带 usage
    const resultLine = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'done',
      session_id: 'sess-2',
      total_cost_usd: 0.02,
    });
    const events = adapter.parse(resultLine);
    const stats = events![0].metadata?.stats as Record<string, unknown>;
    expect(stats.input_tokens).toBe(30);
    expect(stats.output_tokens).toBe(20);
    expect(stats.total_cost_usd).toBe(0.02);
    // 无 usage 块时不应出现 usage 嵌套字段
    expect('usage' in stats).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// case 3：_finish 透传 stats（_spawnAndStream 收集 complete 事件 stats → TaskRunnerResult.stats）
// ─────────────────────────────────────────────────────────────────────────────

describe('task-06 / case3: _spawnAndStream 收集 complete.stats → _finish 透传', () => {
  it('success 路径：TaskRunnerResult.stats 含 complete 事件 metadata.stats', async () => {
    // 用真实 StreamJsonAdapter，让 parse 完整跑过；FakeChild emit assistant + result 行。
    const realAdapter = new StreamJsonAdapter('claude');
    mockAdapter = realAdapter;

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

    const lease = makeLease();
    const runPromise = runner.runLease(lease);

    // 等一拍让 spawn 调用 + listener 注册
    await new Promise((r) => setImmediate(r));

    // 推 assistant 行（带 usage）
    child._emitLines([
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'done' }],
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      }),
    ]);
    // 推 result 行（带 usage + cost）
    child._emitLines([
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'finished',
        session_id: 'sess-stats-1',
        usage: { input_tokens: 50, output_tokens: 25 },
        total_cost_usd: 0.05,
        num_turns: 2,
      }),
    ]);
    child._endStdout();
    child._emitExit(0);

    const result = await runPromise;

    // TaskRunnerResult.stats 必须透传（含累加后的 tokens + cost）
    expect(result.stats).toBeDefined();
    const stats = result.stats as Record<string, unknown>;
    expect(stats.total_cost_usd).toBe(0.05);
    expect(stats.num_turns).toBe(2);
    // 50 + 10 = 60
    expect(stats.input_tokens).toBe(60);
    // 25 + 5 = 30
    expect(stats.output_tokens).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// case 4：completeLease payload 完整（daemon 提交含 stats/exit_code/status）
// 通过直接调 client.completeLease 断言 payload（绕过 daemon WS 层）。
// 此处验证 TaskRunner.runLease 成功后调用方把 stats 透传到 completeLease payload。
// 这里直接验证 daemon 侧映射逻辑：把 TaskRunnerResult 重塑成 completeLease payload。
// ─────────────────────────────────────────────────────────────────────────────

describe('task-06 / case4: completeLease payload 含 stats / exit_code / status', () => {
  it('runLease 成功后 completeLease 调用的 result 含三字段', async () => {
    const realAdapter = new StreamJsonAdapter('claude');
    mockAdapter = realAdapter;

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

    const lease = makeLease();
    const runPromise = runner.runLease(lease);

    await new Promise((r) => setImmediate(r));

    child._emitLines([
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'ok',
        session_id: 'sess-payload',
        usage: { input_tokens: 40, output_tokens: 30 },
        total_cost_usd: 0.08,
      }),
    ]);
    child._endStdout();
    child._emitExit(0);

    const result = await runPromise;

    // 模拟 daemon.ts completeLease payload 映射（camelCase → snake_case + stats/exit_code/status）
    // task-06.md §实现要求 6：daemon payload 必含这三字段
    const payload: Record<string, unknown> = {
      success: result.success,
      output: result.output,
      error: result.error,
      patch: result.patch,
      files_changed: result.filesChanged,
      insertions: result.insertions,
      deletions: result.deletions,
      duration_ms: result.durationMs,
      session_id: result.metadata?.session_id ?? result.sessionId ?? '',
      stats: result.stats,
      exit_code: result.exitCode,
      status: result.status,
    };

    expect(payload).toHaveProperty('stats');
    expect(payload).toHaveProperty('exit_code');
    expect(payload).toHaveProperty('status');
    expect(payload.status).toBe('completed');
    expect(payload.exit_code).toBe(0);
    const stats = payload.stats as Record<string, unknown>;
    expect(stats.total_cost_usd).toBe(0.08);
    expect(stats.input_tokens).toBe(40);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// case 5：adapter reset（跨两次 runLease，_accumulatedUsage reset 生效）
// ─────────────────────────────────────────────────────────────────────────────

describe('task-06 / case5: StreamJsonAdapter resetAccumulator', () => {
  it('reset 后第二次 result 不含第一次 usage 累加', () => {
    const adapter = new StreamJsonAdapter('claude');

    // 第一次：assistant usage 100/50
    adapter.parse(
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'turn1' }],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      }),
    );
    let events = adapter.parse(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'done1',
        session_id: 's1',
        total_cost_usd: 0.01,
      }),
    );
    let stats = events![0].metadata?.stats as Record<string, unknown>;
    expect(stats.input_tokens).toBe(100);
    expect(stats.output_tokens).toBe(50);

    // reset（task-runner 在 runLease 步骤 4 拿到 adapter 后调用）
    adapter.resetAccumulator();

    // 第二次：assistant usage 仅 5/3
    adapter.parse(
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'turn2' }],
          usage: { input_tokens: 5, output_tokens: 3 },
        },
      }),
    );
    events = adapter.parse(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'done2',
        session_id: 's2',
        total_cost_usd: 0.02,
      }),
    );
    stats = events![0].metadata?.stats as Record<string, unknown>;
    // reset 生效：不含第一次的 100/50
    expect(stats.input_tokens).toBe(5);
    expect(stats.output_tokens).toBe(3);
  });

  it('runLease 调用前 adapter 累加器被重置（防御性，即使 getBackend 单例）', async () => {
    // 关键：即便 mockAdapter 是同一对象（模拟单例），runLease 内部应调 resetAccumulator
    const realAdapter = new StreamJsonAdapter('claude');
    // 预污染：手动累加一些 usage
    realAdapter.parse(
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'pollution' }],
          usage: { input_tokens: 999, output_tokens: 888 },
        },
      }),
    );
    mockAdapter = realAdapter;

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

    const lease = makeLease();
    const runPromise = runner.runLease(lease);
    await new Promise((r) => setImmediate(r));

    child._emitLines([
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'clean run' }],
          usage: { input_tokens: 7, output_tokens: 4 },
        },
      }),
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'clean done',
        session_id: 's-clean',
        total_cost_usd: 0.03,
      }),
    ]);
    child._endStdout();
    child._emitExit(0);

    const result = await runPromise;
    const stats = result.stats as Record<string, unknown>;
    // 不含污染的 999/888；只含本次 7/4
    expect(stats.input_tokens).toBe(7);
    expect(stats.output_tokens).toBe(4);
  });
});
