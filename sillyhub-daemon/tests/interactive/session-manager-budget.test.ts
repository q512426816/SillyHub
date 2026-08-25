// tests/interactive/session-manager-budget.test.ts
// task-08（D-006 / D-009 / FR-05 / FR-07）：interactive session budget 软切断检查点。
//
// 覆盖：
//   (a) 累计器口径 D-009：input_tokens + output_tokens（**不含** cache_read /
//       cache_creation）—— 复用现有 PartialFlushBuffer.sessionInputTokens /
//       sessionOutputTokens。cache 巨大但 input+output 在阈值下 → 不触发。
//   (b) 累计 ≥ budget → 设 overBudget + 经现有 onTurnMessage 回传 budget_exceeded
//       事件（reason + usage.input_tokens + usage.output_tokens），**不**调
//       close / kill / fail（D-006 软切断：当前 turn 已 result 完成）。后续
//       inject → SessionNotActiveError（拒绝启新 turn）。
//   (c) budget_tokens undefined → 检查点短路：无事件、inject 正常、行为零变化（FR-07）。

import { describe, it, expect, vi } from 'vitest';
import type {
  Query,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { SessionManager } from '../../src/interactive/session-manager.js';
import { SessionNotActiveError } from '../../src/interactive/types.js';
import type {
  ClaudeSdkDriver,
  ConsumeCallbacks,
  StartOptions,
} from '../../src/interactive/claude-sdk-driver.js';

// ── 辅助构造（对齐 session-manager-usage-cache.test.ts 同款 mock driver）────────

function makeMockDriver() {
  let capturedCallbacks: ConsumeCallbacks | null = null;
  const fakeQuery = {
    interrupt: vi.fn(async () => {}),
    // close 在 _terminateSession 里调（task-01 close 已接通），此处 spy 以便断言
    // 软切断路径**不**调它（D-006）。
    close: vi.fn(),
  } as unknown as Query;
  const driver = {
    start: vi.fn(
      (_input: AsyncIterable<SDKUserMessage>, _opts: StartOptions): Query =>
        fakeQuery,
    ),
    consume: vi.fn(async (_q: Query, cb: ConsumeCallbacks): Promise<void> => {
      capturedCallbacks = cb;
    }),
    interrupt: vi.fn(async (q: Query | null): Promise<boolean> => {
      if (!q) return false;
      await (q.interrupt as () => Promise<void>)();
      return true;
    }),
  } as unknown as ClaudeSdkDriver;
  return {
    driver,
    fakeQuery,
    emitMessage: (m: SDKMessage) => capturedCallbacks?.onMessage?.(m),
    emitResult: (r: SDKResultMessage) => capturedCallbacks?.onResult(r),
  };
}

function makeDeps() {
  return {
    onTurnResult: vi.fn(
      async (_s: string, _r: string, _res: SDKResultMessage) => {},
    ),
    onTurnMessage: vi.fn(async (_s: string, _r: string, _m: SDKMessage) => {}),
    onSessionEnd: vi.fn(async (_s: string, _st: string) => {}),
  };
}

const BASE_INPUT = {
  sessionId: 'sess-bg',
  leaseId: 'lease-bg',
  firstPrompt: 'hi',
  firstRunId: 'run-1',
  cwd: 'C:\\work',
  provider: 'claude' as const,
  pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe',
};

// stream_event fixture（对齐 session-manager-usage-cache.test.ts）。cache_*
// 全名为 cache_*_input_tokens（与 sdk.d.ts 一致）。
function streamMessageStart(
  cacheRead: number,
  cacheCreation: number,
  inputTokens = 100,
): SDKMessage {
  return {
    type: 'stream_event',
    event: {
      type: 'message_start',
      message: {
        id: 'msg-bg',
        usage: {
          input_tokens: inputTokens,
          cache_read_input_tokens: cacheRead,
          cache_creation_input_tokens: cacheCreation,
        },
      },
    },
  } as unknown as SDKMessage;
}

function streamMessageDelta(
  cacheRead: number,
  cacheCreation: number,
  outputTokens = 50,
): SDKMessage {
  return {
    type: 'stream_event',
    event: {
      type: 'message_delta',
      usage: {
        output_tokens: outputTokens,
        cache_read_input_tokens: cacheRead,
        cache_creation_input_tokens: cacheCreation,
      },
    },
  } as unknown as SDKMessage;
}

function resultSuccess(): SDKResultMessage {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'done',
    num_turns: 1,
    duration_ms: 1,
    duration_api_ms: 1,
    stop_reason: 'end_turn',
    total_cost_usd: 0,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    modelUsage: {},
    permission_denials: [],
    session_id: 'sdk-sess',
    uuid: 'r-bg',
  } as unknown as SDKResultMessage;
}

/** 从 onTurnMessage 调用记录里捞出 budget_exceeded 那条（顶层 reason 命中）。 */
function findBudgetExceeded(
  calls: unknown[],
): { reason?: string; usage?: Record<string, number>; budget_tokens?: number } | undefined {
  for (const c of calls) {
    const args = c as unknown[];
    const msg = args[2] as
      | { reason?: string; usage?: Record<string, number>; budget_tokens?: number }
      | undefined;
    if (msg?.reason === 'budget_exceeded') {
      return msg;
    }
  }
  return undefined;
}

describe('task-08 / interactive budget 软切断（D-006 / D-009）', () => {
  it('case(b): 累计 input+output ≥ budget → 发 budget_exceeded + 不调 close/kill（D-006）', async () => {
    const { driver, fakeQuery, emitMessage, emitResult } = makeMockDriver();
    const closeSpy = (fakeQuery as unknown as { close: ReturnType<typeof vi.fn> }).close;
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });

    // budget=120。message_start input=100 + message_delta output=50 = 150 ≥ 120。
    await sm.create({ ...BASE_INPUT, budget_tokens: 120 });

    // cache_* 不影响：设很大也不进累计（D-009）。
    emitMessage(streamMessageStart(999_999, 999_999, 100));
    emitMessage(streamMessageDelta(999_999, 999_999, 50));

    // 触发 turn result → _onResult → _checkBudgetCutoff
    emitResult(resultSuccess());

    // 给 onTurnMessage 微任务一拍（fire-and-forget 包装）。
    await new Promise((r) => setImmediate(r));

    expect(sm.isOverBudget('sess-bg')).toBe(true);

    const ev = findBudgetExceeded(deps.onTurnMessage.mock.calls);
    expect(ev).toBeDefined();
    expect(ev!.usage).toEqual({ input_tokens: 100, output_tokens: 50 });
    expect(ev!.budget_tokens).toBe(120);

    // D-006：软切断**不**调 close/kill。当前 turn 已 result 完成，driver 不被终止。
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('case(b)-续：overBudget 后 inject → SessionNotActiveError（拒绝启新 turn）', async () => {
    const { driver, emitMessage, emitResult } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });

    await sm.create({ ...BASE_INPUT, budget_tokens: 50 });
    emitMessage(streamMessageStart(0, 0, 100));
    emitMessage(streamMessageDelta(0, 0, 50));
    emitResult(resultSuccess());
    await new Promise((r) => setImmediate(r));

    expect(sm.isOverBudget('sess-bg')).toBe(true);
    // 后续 inject 应被拒（软切断：不启新 turn）。
    await expect(sm.inject('sess-bg', 'next', 'run-2')).rejects.toThrow(
      SessionNotActiveError,
    );
  });

  it('case(a): cache 巨大但 input+output 在阈值下 → 不触发（D-009 口径）', async () => {
    const { driver, emitMessage, emitResult } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });

    // budget=1000。input+output = 100+50 = 150（远低）；cache 巨大但**不计入**。
    await sm.create({ ...BASE_INPUT, budget_tokens: 1000 });
    emitMessage(streamMessageStart(999_999, 999_999, 100));
    emitMessage(streamMessageDelta(999_999, 999_999, 50));
    emitResult(resultSuccess());
    await new Promise((r) => setImmediate(r));

    expect(sm.isOverBudget('sess-bg')).toBe(false);
    const ev = findBudgetExceeded(deps.onTurnMessage.mock.calls);
    expect(ev).toBeUndefined();
  });

  it('case(c): budget_tokens undefined → 检查点短路（FR-07 零回归）', async () => {
    const { driver, emitMessage, emitResult } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });

    // 未配置 budget。usage 巨大也不触发。
    await sm.create({ ...BASE_INPUT });
    emitMessage(streamMessageStart(0, 0, 99_999));
    emitMessage(streamMessageDelta(0, 0, 99_999));
    emitResult(resultSuccess());
    await new Promise((r) => setImmediate(r));

    expect(sm.isOverBudget('sess-bg')).toBe(false);
    const ev = findBudgetExceeded(deps.onTurnMessage.mock.calls);
    expect(ev).toBeUndefined();
    // inject 仍可正常排队（未触发软切断）。
    await expect(sm.inject('sess-bg', 'next', 'run-2')).resolves.toEqual({
      runId: 'run-2',
    });
  });

  it('事件幂等：同一 session 多 turn 超 budget 仅发一次 budget_exceeded', async () => {
    const { driver, emitMessage, emitResult } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });

    // budget=50；首 turn input=100/output=50 已超；二 turn 再涨也不重发。
    await sm.create({ ...BASE_INPUT, budget_tokens: 50 });
    emitMessage(streamMessageStart(0, 0, 100));
    emitMessage(streamMessageDelta(0, 0, 50));
    emitResult(resultSuccess());
    await new Promise((r) => setImmediate(r));

    expect(sm.isOverBudget('sess-bg')).toBe(true);

    // 第二 turn（inject 被拒，但强行再触发 result 模拟迟到消息也不重发）。
    emitResult(resultSuccess());
    await new Promise((r) => setImmediate(r));

    const budgetCalls = deps.onTurnMessage.mock.calls.filter((c: unknown[]) => {
      const msg = c[2] as { reason?: string } | undefined;
      return msg?.reason === 'budget_exceeded';
    });
    expect(budgetCalls.length).toBe(1);
  });

  it('setBudgetTokens 显式注入（daemon 未透传时补登记 / 测试驱动）', async () => {
    const { driver, emitMessage, emitResult } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });

    // create 时未带 budget；后续显式补登记。
    await sm.create({ ...BASE_INPUT });
    sm.setBudgetTokens('sess-bg', 80);
    emitMessage(streamMessageStart(0, 0, 60));
    emitMessage(streamMessageDelta(0, 0, 30));
    emitResult(resultSuccess());
    await new Promise((r) => setImmediate(r));

    expect(sm.isOverBudget('sess-bg')).toBe(true);
  });

  it('setBudgetTokens 非法值（≤0 / NaN / undefined）→ 短路（FR-07）', async () => {
    const { driver, emitMessage, emitResult } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });

    await sm.create({ ...BASE_INPUT });
    sm.setBudgetTokens('sess-bg', 0);
    sm.setBudgetTokens('sess-bg', NaN);
    sm.setBudgetTokens('sess-bg', undefined);
    emitMessage(streamMessageStart(0, 0, 99_999));
    emitMessage(streamMessageDelta(0, 0, 99_999));
    emitResult(resultSuccess());
    await new Promise((r) => setImmediate(r));

    expect(sm.isOverBudget('sess-bg')).toBe(false);
  });

  it('子代理（parentKey 非 main）token 也计入累计（跨桶求和）', async () => {
    const { driver, emitMessage, emitResult } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });

    // budget=200。主 agent input=100/output=30；子代理 input=50/output=30；
    // 合计 130+80=210 ≥ 200。
    await sm.create({ ...BASE_INPUT, budget_tokens: 200 });

    // 主 agent message_start（input=100）+ message_delta（output=30）
    emitMessage(streamMessageStart(0, 0, 100));
    emitMessage(streamMessageDelta(0, 0, 30));

    // 子代理 message_start（parent_tool_use_id 场景，input=50）+ delta（output=30）。
    // _parentKeyOf 对 stream_event 取 event.parent_tool_use_id（子代理）。
    emitMessage({
      type: 'stream_event',
      event: {
        type: 'message_start',
        parent_tool_use_id: 'tu-1',
        message: {
          id: 'msg-sub',
          usage: { input_tokens: 50 },
        },
      },
    } as unknown as SDKMessage);
    emitMessage({
      type: 'stream_event',
      event: {
        type: 'message_delta',
        parent_tool_use_id: 'tu-1',
        usage: { output_tokens: 30 },
      },
    } as unknown as SDKMessage);

    emitResult(resultSuccess());
    await new Promise((r) => setImmediate(r));

    expect(sm.isOverBudget('sess-bg')).toBe(true);
    const ev = findBudgetExceeded(deps.onTurnMessage.mock.calls);
    expect(ev).toBeDefined();
    // 主 100+50 = 150；子 30+30 = 60；合计 210（≥200）。
    expect(ev!.usage).toEqual({ input_tokens: 150, output_tokens: 60 });
  });
});

// ── ql-20260825-f3#7：create 失败路径对称清理 _sessionBudgetTokens ──────────────

describe('ql-20260825-f3#7：create 失败回收 budget 登记', () => {
  it('driver.start 抛错 → _sessionBudgetTokens / _overBudgetSessions 条目删除', async () => {
    // start 必抛的 mock driver（executable 缺失等 create 失败场景）。
    const driver = {
      start: vi.fn(() => {
        throw new Error('spawn failed');
      }),
      consume: vi.fn(async () => {}),
      interrupt: vi.fn(async () => false),
    } as unknown as ClaudeSdkDriver;
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });

    await expect(
      sm.create({ ...BASE_INPUT, budget_tokens: 1000 }),
    ).rejects.toThrow('spawn failed');

    // 白盒断言：budget 软切断登记不残留（修复前 _sessionBudgetTokens 只增不减）。
    const internal = sm as unknown as {
      _sessionBudgetTokens: Map<string, number>;
      _overBudgetSessions: Set<string>;
    };
    expect(internal._sessionBudgetTokens.has('sess-bg')).toBe(false);
    expect(internal._overBudgetSessions.has('sess-bg')).toBe(false);
    // store 也已回滚（既有行为）。
    expect(sm.get('sess-bg')).toBeUndefined();
  });
});
