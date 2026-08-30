// tests/interactive/session-manager-terminal-usage.test.ts
// ql-20260831-002：_onResult 轮末补发未 flush 的 pendingUsage（_flushTerminalUsage）
// 的守护测试。
//
// 缺口背景（实证 agent_runs.ctx_tokens 大量交替 NULL）：result 与最后一次
// message_delta 常落在同一 500ms flush 窗口内，轮边界清零（pendingUsage=null）
// 会把整轮最后一次 usage 更新（含 ctx_tokens）静默丢弃——短/快速轮必丢，前端
// 环分子取「最新非 null」滞后。
//
// 断言：
//   1. 快速轮（无 waitForFlush 直接 result）→ 轮末补发 usage-only 消息
//      （content 空 + 顶层 usage），且顺序在 onTurnResult **之前**；
//   2. 已 flush 同值（定时器已发）→ 轮末不重复补发；
//   3. 子桶轮末同样补发（input/output），仍无 ctx_tokens 键（D-006 口径不变）；
//   4. 补发后轮边界清零照旧（pendingUsage=null，无跨轮残留）。
//
// 范式复用 session-manager-turn-usage.test.ts 的 mock driver / stream_event
// fixture / usageFlushesForRun 提取器。

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

const SID = 'sess-term-usage';

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
  leaseId: 'lease-term',
  firstPrompt: 'hi',
  firstRunId: 'run-1',
  cwd: 'C:\\work',
  provider: 'claude' as const,
  pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe',
};

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
    uuid: 'r-term',
  } as unknown as SDKResultMessage;
}

/** 等 partial flush 定时器（PARTIAL_FLUSH_MS=500）。 */
const waitForFlush = (): Promise<void> =>
  new Promise((r) => setTimeout(r, 600));

/** 等 _onResult 异步收尾一拍。 */
const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

interface FlushEntry {
  usage: Record<string, number>;
  content: unknown;
  callOrder: number;
}

/** 捞出指定 runId 的 usage 消息（flush + 轮末补发；排除 budget 事件）。 */
function usageMessagesForRun(
  deps: ReturnType<typeof makeDeps>,
  runId: string,
): FlushEntry[] {
  const out: FlushEntry[] = [];
  for (const c of deps.onTurnMessage.mock.calls as unknown[][]) {
    if (c[1] !== runId) continue;
    const msg = c[2] as { usage?: unknown; reason?: string; content?: unknown };
    if (!msg || msg.reason === 'budget_exceeded') continue;
    if (msg.usage && typeof msg.usage === 'object') {
      out.push({
        usage: msg.usage as Record<string, number>,
        content: msg.content,
        callOrder: c[2] === msg ? (c as unknown[]).length : 0,
      });
    }
  }
  return out;
}

// 白盒：main partial 桶。
interface MainBucketLike {
  pendingUsage: Record<string, number> | null;
}
function mainBucketOf(sm: SessionManager): MainBucketLike | undefined {
  const internal = sm as unknown as {
    _partialBuffers: Map<string, Map<string, MainBucketLike>>;
  };
  return internal._partialBuffers.get(SID)?.get('main');
}

describe('ql-20260831-002：_onResult 轮末补发未 flush 的 pendingUsage', () => {
  it('快速轮（未满 500ms flush 窗口）→ 轮末补发 usage-only 消息（ctx_tokens 不丢）且先于 onTurnResult', async () => {
    const { driver, emitMessage, emitResult } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });
    await sm.create(BASE_INPUT);

    // 轮内最后一次 usage 更新后**立即** result（同一 flush 窗口内——修复前丢失）。
    emitMessage(streamMessageStart(5000, 200, 100));
    emitMessage(streamMessageDelta(5000, 200, 50));
    emitResult(resultSuccess());
    await tick();

    const usages = usageMessagesForRun(deps, 'run-1');
    expect(usages).toHaveLength(1);
    expect(usages[0].usage).toMatchObject({
      input_tokens: 100,
      output_tokens: 50,
      ctx_tokens: 5300,
    });
    // usage-only：content 空串（backend 只提取 usage 不落日志行）。
    expect(usages[0].content).toBe('');

    // 顺序：补发消息在 onTurnResult 之前（backend 侧消息→result 顺序）。
    const msgOrder = deps.onTurnMessage.mock.invocationCallOrder[0];
    const resultOrder = deps.onTurnResult.mock.invocationCallOrder[0];
    expect(msgOrder).toBeDefined();
    expect(resultOrder).toBeDefined();
    expect(msgOrder!).toBeLessThan(resultOrder!);

    // 补发后轮边界清零照旧（无跨轮残留）。
    expect(mainBucketOf(sm)!.pendingUsage).toBeNull();
  });

  it('已 flush 同值（定时器已发）→ 轮末不重复补发', async () => {
    const { driver, emitMessage, emitResult } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });
    await sm.create(BASE_INPUT);

    emitMessage(streamMessageStart(5000, 200, 100));
    emitMessage(streamMessageDelta(5000, 200, 50));
    await waitForFlush(); // 定时 flush 已携带该值
    const flushed = usageMessagesForRun(deps, 'run-1');
    expect(flushed).toHaveLength(1);

    emitResult(resultSuccess());
    await tick();

    // 轮末无第二条（同值去重）。
    expect(usageMessagesForRun(deps, 'run-1')).toHaveLength(1);
    expect(mainBucketOf(sm)!.pendingUsage).toBeNull();
  });

  it('子桶轮末同样补发（input/output），仍无 ctx_tokens 键（D-006）', async () => {
    const { driver, emitMessage, emitResult } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });
    await sm.create(BASE_INPUT);

    emitMessage(streamMessageStart(1000, 0, 300, 'tu-1'));
    emitMessage(streamMessageDelta(1000, 0, 120, 'tu-1'));
    emitResult(resultSuccess());
    await tick();

    const usages = usageMessagesForRun(deps, 'run-1');
    expect(usages).toHaveLength(1);
    expect(usages[0].usage).toMatchObject({ input_tokens: 300, output_tokens: 120 });
    expect('ctx_tokens' in usages[0].usage).toBe(false);
  });

  it('无 pendingUsage（整轮无 usage 事件）→ 轮末零补发零 onTurnMessage', async () => {
    const { driver, emitResult } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });
    await sm.create(BASE_INPUT);

    emitResult(resultSuccess());
    await tick();

    expect(deps.onTurnMessage).not.toHaveBeenCalled();
    expect(deps.onTurnResult).toHaveBeenCalledTimes(1);
  });
});
