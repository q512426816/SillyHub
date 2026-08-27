// tests/interactive/session-manager-turn-usage.test.ts
// task-03（2026-08-27-session-token-usage-fix / design §5 测试节 + §10 R-01/R-05）：
// task-02 turn 级 usage 改动（轮级计数器 / ctx_tokens / 跨轮清零）的守护测试。
//
// 四类断言（plan 全局验收 1）：
//   1. 跨轮清零（FR-02 / D-001@v2）：turn 1 result（_onResult）后 main 桶 turn 级
//      计数器清零、pendingUsage=null（不携带上轮残留）；turn 2 flush usage 的
//      input/output/ctx 从 0 重新累计。
//   2. ctx 三分量且仅 main 桶（FR-01 / D-006）：main 桶 message_start →
//      ctx_tokens = input + cache_read + cache_creation；message_delta 携带 cache
//      更新时差分重算；子桶（parent_tool_use_id 非 main）flush usage 无 ctx_tokens 键。
//   3. 子桶 max 聚合断言口径（R-05 / 复审 N3）：主/子桶各自 flush 消息携带**各自
//      轮级值**——backend submit_messages 对 input/output 仅增不减（max 守卫），
//      轮内 run 实时值 = max(主桶上报, 任一子桶上报)，**非求和**；max 聚合发生在
//      backend 侧，daemon 层只需断言两条 flush 消息的 usage 值正确。
//   4. budget / 会话级零回归（R-01）：多轮 + 子代理场景后 _checkBudgetCutoff 聚合
//      仍基于会话级计数器（跨轮不清零）；turn 边界后 sessionInputTokens 不清零。
//
// 范式：复用 session-manager-usage-cache / budget 的 mock driver + stream_event
// fixture（真实 500ms partial flush 定时器，等待 600ms 观测 flush 出的 usage dict）。
// 子代理消息按 SDKPartialAssistantMessage 形态（sdk.d.ts:3723）带**顶层**
// parent_tool_use_id（_parentKeyOf 读顶层字段分桶）。白盒断言对齐
// session-manager-subagent-shrink.test.ts 的 _partialBuffers 直读范式。

import { describe, it, expect, vi } from 'vitest';
import type {
  Query,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { SessionManager } from '../../src/interactive/session-manager.js';
import type {
  ClaudeSdkDriver,
  ConsumeCallbacks,
  StartOptions,
} from '../../src/interactive/claude-sdk-driver.js';

const SID = 'sess-turn';

// ── 辅助构造（对齐 session-manager-budget.test.ts 同款 mock driver）──────────

function makeMockDriver() {
  let capturedCallbacks: ConsumeCallbacks | null = null;
  const fakeQuery = { interrupt: vi.fn(async () => {}) } as unknown as Query;
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
  sessionId: SID,
  leaseId: 'lease-turn',
  firstPrompt: 'hi',
  firstRunId: 'run-1',
  cwd: 'C:\\work',
  provider: 'claude' as const,
  pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe',
};

// stream_event fixture（对齐 usage-cache / budget 同款）。parent 非空 = 子代理
// 消息（SDKPartialAssistantMessage 顶层 parent_tool_use_id，sdk.d.ts:3723）。
function streamMessageStart(
  cacheRead: number,
  cacheCreation: number,
  inputTokens = 100,
  parent: string | null = null,
): SDKMessage {
  return {
    type: 'stream_event',
    ...(parent ? { parent_tool_use_id: parent } : {}),
    event: {
      type: 'message_start',
      message: {
        id: `msg-${parent ?? 'main'}`,
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
  parent: string | null = null,
): SDKMessage {
  return {
    type: 'stream_event',
    ...(parent ? { parent_tool_use_id: parent } : {}),
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
    uuid: 'r-turn',
  } as unknown as SDKResultMessage;
}

/** 等 partial flush 定时器（PARTIAL_FLUSH_MS=500，对齐 usage-cache 测试等 600ms）。 */
const waitForFlush = (): Promise<void> =>
  new Promise((r) => setTimeout(r, 600));

/** 等 _onResult 异步收尾一拍（对齐 budget 测试的 setImmediate 范式）。 */
const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

/**
 * 捞出指定 runId 的 flush usage dict 列表（_flushPartial 注入到 flat 消息顶层
 * usage）。排除 budget_exceeded 事件——它也带 usage 但非 flush 产物。
 */
function usageFlushesForRun(
  calls: unknown[],
  runId: string,
): Array<Record<string, number>> {
  const out: Array<Record<string, number>> = [];
  for (const c of calls) {
    const args = c as unknown[];
    if (args[1] !== runId) continue;
    const msg = args[2] as { usage?: unknown; reason?: string } | undefined;
    if (!msg || msg.reason === 'budget_exceeded') continue;
    if (msg.usage && typeof msg.usage === 'object') {
      out.push(msg.usage as Record<string, number>);
    }
  }
  return out;
}

/** 捞出 budget_exceeded 事件（对齐 budget 测试）。 */
function findBudgetExceeded(
  calls: unknown[],
): { usage?: Record<string, number> } | undefined {
  for (const c of calls) {
    const msg = (c as unknown[])[2] as
      | { reason?: string; usage?: Record<string, number> }
      | undefined;
    if (msg?.reason === 'budget_exceeded') return msg;
  }
  return undefined;
}

// 白盒：main partial 桶（对齐 subagent-shrink 测试的 _partialBuffers 直读范式）。
interface MainBucketLike {
  turnInputTokens: number;
  turnOutputTokens: number;
  lastCallCtxTokens: number;
  pendingUsage: Record<string, number> | null;
  sessionInputTokens: number;
  sessionOutputTokens: number;
}
function mainBucketOf(sm: SessionManager): MainBucketLike | undefined {
  const internal = sm as unknown as {
    _partialBuffers: Map<string, Map<string, MainBucketLike>>;
  };
  return internal._partialBuffers.get(SID)?.get('main');
}

// ── 断言 1：turn 级计数跨轮清零（FR-02 / D-001@v2）──────────────────────────

describe('task-03 断言 1：turn 级计数跨轮清零（FR-02 / D-001@v2）', () => {
  it('turn 1 result 后 main 桶 turn 级计数清零 + pendingUsage=null；会话级计数器保留（两套计数器物理分离）', async () => {
    const { driver, emitMessage, emitResult } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });
    await sm.create(BASE_INPUT);

    emitMessage(streamMessageStart(5000, 200, 100));
    emitMessage(streamMessageDelta(5000, 200, 50));
    await waitForFlush();

    // 前置确认 turn 1 轮内已累计（flush usage 为轮级值）。
    const t1 = usageFlushesForRun(deps.onTurnMessage.mock.calls, 'run-1');
    expect(t1).toHaveLength(1);
    expect(t1[0]).toMatchObject({
      input_tokens: 100,
      output_tokens: 50,
      ctx_tokens: 5300,
    });

    emitResult(resultSuccess());
    await tick();

    const main = mainBucketOf(sm);
    expect(main).toBeDefined();
    // turn 级清零 + pendingUsage=null（不携带上轮残留，防旧值注入新 run）。
    expect(main!.turnInputTokens).toBe(0);
    expect(main!.turnOutputTokens).toBe(0);
    expect(main!.lastCallCtxTokens).toBe(0);
    expect(main!.pendingUsage).toBeNull();
    // 会话级计数器跨轮**不清零**（budget 数据源，R-01）。
    expect(main!.sessionInputTokens).toBe(100);
    expect(main!.sessionOutputTokens).toBe(50);
  });

  it('turn 2 flush usage 从 0 重新累计（input/output/ctx 均无上轮残留）', async () => {
    const { driver, emitMessage, emitResult } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });
    await sm.create(BASE_INPUT);

    // turn 1（run-1）：input=100 / output=50 / ctx=5300，flush 后 turn 收尾。
    emitMessage(streamMessageStart(5000, 200, 100));
    emitMessage(streamMessageDelta(5000, 200, 50));
    await waitForFlush();
    emitResult(resultSuccess());
    await tick();

    // 新 turn（inject 换 run-2）：从 0 重新累计。
    await sm.inject(SID, 'next', 'run-2');
    emitMessage(streamMessageStart(100, 10, 30));
    emitMessage(streamMessageDelta(100, 10, 20));
    await waitForFlush();

    const t2 = usageFlushesForRun(deps.onTurnMessage.mock.calls, 'run-2');
    expect(t2).toHaveLength(1);
    // 30 / 20 / 140（=30+100+10）——非会话累计口径的 130 / 70 / 5440。
    expect(t2[0]).toMatchObject({
      input_tokens: 30,
      output_tokens: 20,
      ctx_tokens: 140,
    });
    expect(t2[0].input_tokens).not.toBe(130);
    expect(t2[0].ctx_tokens).not.toBe(5300 + 140);
  });
});

// ── 断言 2：ctx 三分量计算且仅 main 桶（FR-01 / D-006）──────────────────────

describe('task-03 断言 2：ctx 三分量计算且仅 main 桶（FR-01 / D-006）', () => {
  it('main 桶 message_start（input=100, cache_read=5000, cache_creation=200）→ flush usage ctx_tokens=5300', async () => {
    const { driver, emitMessage } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });
    await sm.create(BASE_INPUT);

    emitMessage(streamMessageStart(5000, 200, 100));
    emitMessage(streamMessageDelta(5000, 200, 50));
    await waitForFlush();

    const usages = usageFlushesForRun(deps.onTurnMessage.mock.calls, 'run-1');
    expect(usages).toHaveLength(1);
    // 三分量和：100 + 5000 + 200 = 5300。
    expect(usages[0].ctx_tokens).toBe(5300);
    // cache 维持快照语义（replace，非累计——零回归于 usage-cache 测试口径）。
    expect(usages[0].cache_read_tokens).toBe(5000);
    expect(usages[0].cache_creation_tokens).toBe(200);
  });

  it('delta 携带 cache 更新（5000→5100）→ ctx 差分重算（5300→5400）', async () => {
    const { driver, emitMessage } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });
    await sm.create(BASE_INPUT);

    emitMessage(streamMessageStart(5000, 200, 100));
    emitMessage(streamMessageDelta(5100, 200, 50));
    await waitForFlush();

    const usages = usageFlushesForRun(deps.onTurnMessage.mock.calls, 'run-1');
    expect(usages).toHaveLength(1);
    // delta 不带 input_tokens，ctx 以「上次值 ± cache 差量」重算：
    // 5300 - 5000 - 200 + 5100 + 200 = 5400。
    expect(usages[0].ctx_tokens).toBe(5400);
    expect(usages[0].cache_read_tokens).toBe(5100);
  });

  it('子桶（parent_tool_use_id=tu-1）同样消息 → flush usage 无 ctx_tokens 键', async () => {
    const { driver, emitMessage } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });
    await sm.create(BASE_INPUT);

    emitMessage(streamMessageStart(5000, 200, 100, 'tu-1'));
    emitMessage(streamMessageDelta(5000, 200, 50, 'tu-1'));
    await waitForFlush();

    // 本用例只驱动子桶 → run-1 的 usage flush 即子桶产物。
    const usages = usageFlushesForRun(deps.onTurnMessage.mock.calls, 'run-1');
    expect(usages).toHaveLength(1);
    // 子桶轮级 input/output 照常累计并上报（R-05：子代理计费量经各自桶 flush）。
    expect(usages[0].input_tokens).toBe(100);
    expect(usages[0].output_tokens).toBe(50);
    // D-006：ctx_tokens 仅 main 桶携带，子桶 pendingUsage 不含该键。
    expect('ctx_tokens' in usages[0]).toBe(false);
    expect(usages[0].ctx_tokens).toBeUndefined();
  });
});

// ── 断言 3：子桶 max 聚合断言口径（R-05 / 复审 N3）──────────────────────────

describe('task-03 断言 3：子桶 max 聚合断言口径（R-05 / 复审 N3）', () => {
  it('主/子桶各自 flush 携带各自轮级值（backend max 聚合 → 轮内 run 实时值 ≥ max(主,子)，非求和）', async () => {
    const { driver, emitMessage } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });
    await sm.create(BASE_INPUT);

    // 主桶轮级 input=100/output=50；子桶（tu-1）轮级 input=300/output=120（Y>X）。
    emitMessage(streamMessageStart(0, 0, 100));
    emitMessage(streamMessageDelta(0, 0, 50));
    emitMessage(streamMessageStart(0, 0, 300, 'tu-1'));
    emitMessage(streamMessageDelta(0, 0, 120, 'tu-1'));
    await waitForFlush();

    const usages = usageFlushesForRun(deps.onTurnMessage.mock.calls, 'run-1');
    expect(usages).toHaveLength(2);

    const mainFlush = usages.find((u) => u.input_tokens === 100);
    const subFlush = usages.find((u) => u.input_tokens === 300);
    expect(mainFlush).toBeDefined();
    expect(subFlush).toBeDefined();
    // 各自携带各自桶的轮级值（主桶 ctx 照常携带；子桶无 ctx 键，D-006）。
    expect(mainFlush).toMatchObject({
      input_tokens: 100,
      output_tokens: 50,
      ctx_tokens: 100,
    });
    expect(subFlush).toMatchObject({ input_tokens: 300, output_tokens: 120 });
    expect('ctx_tokens' in subFlush!).toBe(false);
    // 非求和口径：任何 flush 都不得出现 400/170（主+子求和值）。
    for (const u of usages) {
      expect(u.input_tokens).not.toBe(400);
      expect(u.output_tokens).not.toBe(170);
    }
    // R-05 语义说明（backend 侧 max 守卫，daemon 不在此层聚合）：backend
    // submit_messages 对同一 run 的 input/output 仅增不减（max），故轮内 run
    // 实时值 = max(主桶上报 100, 子桶上报 300) = 300 ≥ max(主,任一子)。daemon
    // 层的契约即上面两条 flush 消息各自正确——max 聚合由 backend pytest 覆盖。
  });
});

// ── 断言 4：budget / 会话级零回归（R-01）────────────────────────────────────

describe('task-03 断言 4：budget / 会话级零回归（R-01）', () => {
  it('跨 2 轮 + 子代理后 budget 聚合 = 会话累计（跨轮不清零）；turn 边界后 sessionInputTokens 不清零', async () => {
    const { driver, emitMessage, emitResult } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });

    // budget=400：turn 1 主桶 150 不足；turn 2 追加主 160 + 子 160 → 470 ≥ 400。
    await sm.create({ ...BASE_INPUT, budget_tokens: 400 });

    // turn 1（run-1）：主桶 input=100 / output=50。
    emitMessage(streamMessageStart(0, 0, 100));
    emitMessage(streamMessageDelta(0, 0, 50));
    await waitForFlush();
    const t1 = usageFlushesForRun(deps.onTurnMessage.mock.calls, 'run-1');
    expect(t1).toHaveLength(1);
    expect(t1[0]).toMatchObject({ input_tokens: 100, output_tokens: 50 });

    emitResult(resultSuccess());
    await tick();

    // 针对性断言（R-01）：turn 边界清零的是**轮级**计数器，会话级计数器保留
    //（若误清 sessionInputTokens，下轮 budget 聚合即漏计）。
    const main = mainBucketOf(sm);
    expect(main!.turnInputTokens).toBe(0);
    expect(main!.sessionInputTokens).toBe(100);
    expect(sm.isOverBudget(SID)).toBe(false); // 150 < 400

    // turn 2（run-2）：主桶 input=120/output=40 + 子桶 tu-1 input=100/output=60。
    await sm.inject(SID, 'next', 'run-2');
    emitMessage(streamMessageStart(0, 0, 120));
    emitMessage(streamMessageDelta(0, 0, 40));
    emitMessage(streamMessageStart(0, 0, 100, 'tu-1'));
    emitMessage(streamMessageDelta(0, 0, 60, 'tu-1'));
    await waitForFlush();

    // 对照：flush 上报仍是**轮级**值（各自桶本轮 120/40 与 100/60，非会话累计）。
    const t2 = usageFlushesForRun(deps.onTurnMessage.mock.calls, 'run-2');
    expect(t2).toHaveLength(2);
    expect(t2.find((u) => u.input_tokens === 120)).toMatchObject({
      output_tokens: 40,
    });
    expect(t2.find((u) => u.input_tokens === 100)).toMatchObject({
      output_tokens: 60,
    });

    emitResult(resultSuccess());
    await tick();

    // budget 聚合 = 会话级累计（跨 2 轮 + 主/子桶，_checkBudgetCutoff 在 shrink
    // 前跨桶求和）：input=100+120+100=320，output=50+40+60=150，合计 470 ≥ 400。
    expect(sm.isOverBudget(SID)).toBe(true);
    const ev = findBudgetExceeded(deps.onTurnMessage.mock.calls);
    expect(ev).toBeDefined();
    expect(ev!.usage).toEqual({ input_tokens: 320, output_tokens: 150 });
    // 折算后 main 承接子桶会话级计数（_shrinkSubagentBuffers，budget 数据源不回退）。
    expect(mainBucketOf(sm)!.sessionInputTokens).toBe(320);
  });
});
