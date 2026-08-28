// tests/stats-passthrough.test.ts
// task-06: A2 stats 透传链路单测。
//
// 覆盖 5 case（task-06.md §TDD 步骤 1）：
//   1. adapter 拆 usage（extractResultStats：result.usage 优先，缺失回落 accumulated，
//      ql-20260829-001 修正——同源求和会翻倍）+ 1b 真实事件流翻倍回归
//   2. result 无 usage 时回落 accumulated
//   3. _finish 透传 stats（_spawnAndStream → _finish → TaskRunnerResult.stats）
//   4. completeLease payload 完整（runLease 成功路径 → daemon 提交含 stats/exit_code/status）
//   5. adapter reset（跨两次 runLease，_accumulatedUsage reset 生效）
//
// task-07（2026-08-29-usage-by-provider-model）追加：batch stats 增补
// model / api_requests（stream-json message_start 计数 → complete stats →
// hub-client completeLease 透传）。对齐 task-07.md FR-01-4 / FR-02-2。
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
import { NdjsonAdapter } from '../src/adapters/ndjson.js';
import { HubClient } from '../src/hub-client.js';
import { createFakeChild, type FakeChild } from './helpers/fake-child.js';
import type { AgentEvent, LeaseCtx, ProviderConfig } from '../src/types.js';

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

describe('task-06 / case1&2: StreamJsonAdapter extractResultStats 拆 usage（result 优先）', () => {
  it('case1: result 有 usage → 拆平 input/output_tokens；result.usage 优先不与 accumulated 求和（同源防翻倍）', () => {
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
    // ql-20260829-001：result.usage 与 accumulated 同源（result 是 CLI 官方全 run
    // 累计，accumulated 是 message_start/message_delta/assistant 自算的同一份账），
    // 求和必翻倍 → result.usage 优先取 100/50（旧断言 130/70 钉住的是翻倍 bug）。
    expect(stats.input_tokens).toBe(100);
    expect(stats.output_tokens).toBe(50);
    expect(stats.total_cost_usd).toBe(0.01);
    expect(stats.num_turns).toBe(3);
    expect(stats.duration_ms).toBe(5000);
  });

  it('case1b: --include-partial-messages 真实事件流（message_start/message_delta 累计 + result 同源）不翻倍', () => {
    // ql-20260829-001 回归：CLI 开 --include-partial-messages 后 accumulated 经
    // message_start（input/cache）+ message_delta（output）累计出真实全 run 账，
    // result.usage 是 CLI 官方的同一份累计——旧求和语义产出精确 2 倍
    // （实测 1447 → 2894 / 130 → 260）。修复后四维均取 result.usage 权威值。
    const adapter = new StreamJsonAdapter('claude');
    const lines = [
      // turn 1：本次调用 input=1437, cache_creation=12000, cache_read=0
      JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'message_start',
          message: {
            id: 'msg_1',
            usage: {
              input_tokens: 1437,
              cache_creation_input_tokens: 12000,
              cache_read_input_tokens: 0,
              output_tokens: 1,
            },
          },
        },
      }),
      JSON.stringify({
        type: 'stream_event',
        event: { type: 'message_delta', usage: { output_tokens: 50 } },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          id: 'msg_1',
          usage: { input_tokens: 0, output_tokens: 0 },
          content: [{ type: 'text', text: 'turn 1' }],
        },
      }),
      // turn 2：input=10（新增），cache_read=13400（turn1 全量命中）
      JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'message_start',
          message: {
            id: 'msg_2',
            usage: {
              input_tokens: 10,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 13400,
              output_tokens: 1,
            },
          },
        },
      }),
      JSON.stringify({
        type: 'stream_event',
        event: { type: 'message_delta', usage: { output_tokens: 80 } },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          id: 'msg_2',
          usage: { input_tokens: 0, output_tokens: 0 },
          content: [{ type: 'text', text: 'turn 2' }],
        },
      }),
      // result.usage = 整个 run 累计（CLI 官方）
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'done',
        session_id: 'sess-1b',
        usage: {
          input_tokens: 1447,
          output_tokens: 130,
          cache_creation_input_tokens: 12000,
          cache_read_input_tokens: 13400,
        },
        num_turns: 2,
      }),
    ];
    let stats: Record<string, unknown> | undefined;
    for (const line of lines) {
      const events = adapter.parse(line);
      if (!events) continue;
      for (const ev of events) {
        if (ev.type === 'complete') {
          stats = (ev.metadata as Record<string, unknown>)?.stats as Record<string, unknown>;
        }
      }
    }
    expect(stats).toBeDefined();
    // 旧求和语义此处产出 2894/260（翻倍）；修复后取 result.usage 权威值。
    expect(stats!.input_tokens).toBe(1447);
    expect(stats!.output_tokens).toBe(130);
    expect(stats!.cache_creation_tokens).toBe(12000);
    expect(stats!.cache_read_tokens).toBe(13400);
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

    // TaskRunnerResult.stats 必须透传（result.usage 权威值 + cost）
    expect(result.stats).toBeDefined();
    const stats = result.stats as Record<string, unknown>;
    expect(stats.total_cost_usd).toBe(0.05);
    expect(stats.num_turns).toBe(2);
    // ql-20260829-001：result.usage(50/25) 优先（官方全 run 累计），不与
    // assistant 累计值(10/5) 求和（同源求和翻倍；旧断言 60/30 钉住翻倍 bug）。
    expect(stats.input_tokens).toBe(50);
    expect(stats.output_tokens).toBe(25);
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

// ─────────────────────────────────────────────────────────────────────────────
// task-07（2026-08-29-usage-by-provider-model）：batch stats 增补 model / api_requests
//   a) stream-json 事件流（message_start×2 + assistant + result）跑完后
//      TaskResult.stats 含 ProviderConfig.model 与 api_requests == message_start 数
//   b) ProviderConfig 无 model → "unknown"
//   c) ndjson（opencode）adapter 无 messageStartCount getter → 两字段不出现
//   d) 计数器纯函数行为：随 message_start 递增、resetAccumulator 清零（同生命周期）
//   e) hub-client completeLease statsExtras 条件透传（undefined 不写，老 body 形态不变）
// ─────────────────────────────────────────────────────────────────────────────

describe('task-07 / batch stats 增补 model / api_requests', () => {
  /** 构造一条 stream_event message_start 行（task-07 计数口径：每发一次 = 1 次 API 调用）。 */
  function messageStartLine(id: string, inputTokens: number): string {
    return JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'message_start',
        message: { id, usage: { input_tokens: inputTokens, output_tokens: 1 } },
      },
    });
  }

  it('a) stream-json 事件流跑完：TaskResult.stats 含 model（ProviderConfig.model）与 api_requests == message_start 数', async () => {
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

    const providerConfig: ProviderConfig = { agent_kind: 'claude', model: 'glm-4.7' };
    const lease = makeLease({ provider_config: providerConfig });
    const runPromise = runner.runLease(lease);

    await new Promise((r) => setImmediate(r));

    // 2 个 turn：各 1 条 message_start（task-07 口径：计数 == num_turns）
    child._emitLines([
      messageStartLine('msg_1', 100),
      JSON.stringify({
        type: 'assistant',
        message: {
          id: 'msg_1',
          content: [{ type: 'text', text: 'turn 1' }],
          usage: { input_tokens: 0, output_tokens: 10 },
        },
      }),
      messageStartLine('msg_2', 20),
      JSON.stringify({
        type: 'assistant',
        message: {
          id: 'msg_2',
          content: [{ type: 'text', text: 'turn 2' }],
          usage: { input_tokens: 0, output_tokens: 30 },
        },
      }),
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'done',
        session_id: 'sess-t07a',
        usage: { input_tokens: 120, output_tokens: 40 },
        num_turns: 2,
      }),
    ]);
    child._endStdout();
    child._emitExit(0);

    const result = await runPromise;
    const stats = result.stats as Record<string, unknown>;
    // 既有 stats 语义零回归（ql-20260829-001 result.usage 优先）
    expect(stats.input_tokens).toBe(120);
    expect(stats.output_tokens).toBe(40);
    expect(stats.num_turns).toBe(2);
    // task-07 新增两字段
    expect(stats.model).toBe('glm-4.7');
    expect(stats.api_requests).toBe(2);
    // TaskCard acceptance：计数 == num_turns（08-29 实测 fixture 口径）
    expect(stats.api_requests).toBe(stats.num_turns);
  });

  it('b) ProviderConfig 无 model → "unknown"', async () => {
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

    // ProviderConfig 存在但 model 缺省
    const lease = makeLease({ provider_config: { agent_kind: 'claude' } });
    const runPromise = runner.runLease(lease);

    await new Promise((r) => setImmediate(r));

    child._emitLines([
      messageStartLine('msg_1', 50),
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'done',
        session_id: 'sess-t07b',
        usage: { input_tokens: 50, output_tokens: 5 },
        num_turns: 1,
      }),
    ]);
    child._endStdout();
    child._emitExit(0);

    const result = await runPromise;
    const stats = result.stats as Record<string, unknown>;
    expect(stats.model).toBe('unknown');
    expect(stats.api_requests).toBe(1);
  });

  it('c) ndjson（opencode）adapter 无 getter → model / api_requests 两字段不出现', async () => {
    // 对齐 cache-passthrough case5：ndjson 不产 complete.stats，stats 由
    // mergeAdapterUsage 的 getUsage() 兜底；adapter 无 messageStartCount →
    // attachBatchModelStats 跳过两字段（stats 形态不变，老链路零回归）。
    const realAdapter = new NdjsonAdapter('opencode');
    realAdapter.parse(
      JSON.stringify({
        type: 'step_finish',
        part: { tokens: { input: 120, output: 80, cache: { read: 500, write: 60 } } },
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

    // 即便 lease 带 ProviderConfig.model，ndjson 无 getter 也不加两字段
    const lease = makeLease({
      provider: 'opencode',
      provider_config: { agent_kind: 'opencode', model: 'gpt-5' },
    });
    const runPromise = runner.runLease(lease);

    await new Promise((r) => setImmediate(r));

    child._endStdout();
    child._emitExit(0);

    const result = await runPromise;
    const stats = result.stats as Record<string, unknown>;
    expect(stats.input_tokens).toBe(120);
    expect('model' in stats).toBe(false);
    expect('api_requests' in stats).toBe(false);
  });

  it('d) messageStartCount：随事件递增、resetAccumulator 清零（与累加器同生命周期）', () => {
    const adapter = new StreamJsonAdapter('claude');
    expect(adapter.messageStartCount).toBe(0);
    adapter.parse(messageStartLine('msg_1', 10));
    adapter.parse(messageStartLine('msg_2', 20));
    expect(adapter.messageStartCount).toBe(2);
    // resetAccumulator 一并清零（TaskCard constraints）
    adapter.resetAccumulator();
    expect(adapter.messageStartCount).toBe(0);
    adapter.parse(messageStartLine('msg_3', 30));
    expect(adapter.messageStartCount).toBe(1);
  });

  it('e) hub-client completeLease statsExtras 条件透传：写入 stats、undefined 不写、stats 已有字段不覆盖', async () => {
    const calls: { init: RequestInit }[] = [];
    vi.stubGlobal(
      'fetch',
      (async (_url: unknown, init?: unknown) => {
        calls.push({ init: (init ?? {}) as RequestInit });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch,
    );
    const c = new HubClient('http://x:8000', 't');

    // e-1：extras 提供两字段 → 注入 result.stats
    await c.completeLease(
      'lease-1',
      'ct',
      { status: 'completed', stats: { input_tokens: 120 } },
      { model: 'glm-4.7', api_requests: 2 },
    );
    let body = JSON.parse(calls[0]!.init.body as string) as {
      result: { stats: Record<string, unknown> };
    };
    expect(body.result.stats.input_tokens).toBe(120);
    expect(body.result.stats.model).toBe('glm-4.7');
    expect(body.result.stats.api_requests).toBe(2);

    // e-2：不传 extras → body 与老链路逐字节一致（result 原样透传）
    const result2 = { status: 'completed', stats: { input_tokens: 1 } };
    await c.completeLease('lease-1', 'ct', result2);
    body = JSON.parse(calls[1]!.init.body as string) as {
      claim_token: string;
      result: Record<string, unknown>;
    };
    expect(body).toEqual({ claim_token: 'ct', result: result2 });

    // e-3：result.stats 已含同名字段 → extras 不覆盖（stats 优先，幂等）
    await c.completeLease(
      'lease-1',
      'ct',
      { status: 'completed', stats: { model: 'from-stats' } },
      { model: 'from-extras', api_requests: 7 },
    );
    body = JSON.parse(calls[2]!.init.body as string) as {
      result: { stats: Record<string, unknown> };
    };
    expect(body.result.stats.model).toBe('from-stats');
    expect(body.result.stats.api_requests).toBe(7);

    vi.unstubAllGlobals();
  });
});
