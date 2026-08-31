// tests/interactive/session-manager-usage-cache.test.ts
// ql-20260710-001-79c5：interactive session-level cache 词元聚合翻倍回归守护。
//
// 根因：cache_*_input_tokens 是**会话级累计快照**（非 per-call 增量），但
// _bufferPartial 把它当 delta 累加；且 message_start 先 `+=` 再把 lastCall reset
// 成 0（而非 startUsage 的值），致 message_delta 首次 delta = callCacheRead - 0 =
// 全量，叠加 message_start 已加的值 → sessionCacheReadTokens 翻倍 → pendingUsage
// 翻倍 → _flushPartial 注入的 usage 翻倍 → onTurnMessage → 前端实时显示翻倍。
//
// 现有 session-manager 全套测试的 cache 字段都是 0（0 翻倍还是 0），盲区未被
// 发现。本测用非 0 cache 的 message_start + message_delta（对齐 Claude 真实事件
// 结构，见 stream-json.test.ts:848）驱动，断言 flush 出去的 usage.cache_*_tokens
// 等于会话级快照值（非 2 倍）。
//
// 影响面：仅前端实时 token 显示（pendingUsage → submitMessages → AgentRunLog
// .metadata.usage → SSE）。AgentRun 终态走 daemon.onTurnResult 直接透传 result
// .usage（daemon.ts:1388-1396，不走 session buf，终态正确，本测不覆盖）。

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

// ── 辅助构造（精简自 session-manager.test.ts，本文件只测 cache 聚合）────────

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
  sessionId: 'sess-1',
  leaseId: 'lease-1',
  firstPrompt: 'hi',
  firstRunId: 'run-1',
  cwd: 'C:\\work',
  provider: 'claude' as const,
  pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe',
};

// stream_event fixture（SDKPartialAssistantMessage 形态，Claude SDK 透传 Anthropic
// 原始 stream event）。cache_*_input_tokens 为全名（与 sdk.d.ts:2913 一致）。
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
        id: 'msg-1',
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
  // ql-20260831-011：可选 cumulative input（GLM 兼容端点形态；官方 Claude
  // message_delta 不带该字段 → 省略即回归官方形态）。
  inputTokens?: number,
): SDKMessage {
  return {
    type: 'stream_event',
    event: {
      type: 'message_delta',
      usage: {
        output_tokens: outputTokens,
        cache_read_input_tokens: cacheRead,
        cache_creation_input_tokens: cacheCreation,
        ...(inputTokens !== undefined ? { input_tokens: inputTokens } : {}),
      },
    },
  } as unknown as SDKMessage;
}

/** 从 onTurnMessage 调用记录里捞出带 usage 的那条（_flushPartial 注入）。 */
function findFlushedUsage(
  calls: unknown[],
): Record<string, number> | undefined {
  const usageCall = calls.find(
    (c) => (c as unknown[])[2] && typeof ((c as unknown[])[2] as { usage?: unknown }).usage === 'object',
  );
  const msg = usageCall ? ((usageCall as unknown[])[2] as { usage?: unknown }) : undefined;
  return msg?.usage as Record<string, number> | undefined;
}

describe('ql-20260710-001 cache 聚合不翻倍（会话级快照语义）', () => {
  it('message_start + message_delta 带同值 cache → flush usage 等于快照（非 2 倍）', async () => {
    const { driver, emitMessage } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });
    await sm.create(BASE_INPUT);

    // message_start + message_delta 都带 cache_read=300 / cache_creation=200
    //（Claude 真实行为：cache 在 message_start 定，message_delta 携带同值 cumulative 快照）
    emitMessage(streamMessageStart(300, 200));
    emitMessage(streamMessageDelta(300, 200));

    // 等 partial flush 定时器（_bufferPartial 启动 500ms timer）
    await new Promise((r) => setTimeout(r, 600));

    const usage = findFlushedUsage(deps.onTurnMessage.mock.calls);
    expect(usage).toBeDefined();
    // 关键断言：不翻倍。bug 下 cache_read=600 / cache_creation=400。
    expect(usage!.cache_read_tokens).toBe(300);
    expect(usage!.cache_creation_tokens).toBe(200);
    // input/output 是 per-call，delta 累加正确（message_start input + message_delta output）
    expect(usage!.input_tokens).toBe(100);
    expect(usage!.output_tokens).toBe(50);
  });

  it('message_delta cache 增长（300→350）→ session 取最新快照（非累加）', async () => {
    const { driver, emitMessage } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });
    await sm.create(BASE_INPUT);

    emitMessage(streamMessageStart(300, 200));
    // message_delta cache_read 从 300 增长到 350（cumulative 快照更新）
    emitMessage(streamMessageDelta(350, 200));

    await new Promise((r) => setTimeout(r, 600));

    const usage = findFlushedUsage(deps.onTurnMessage.mock.calls);
    expect(usage).toBeDefined();
    // 会话级快照取最新值 350（不是 delta 累加的 300+350=650，也不是 300）
    expect(usage!.cache_read_tokens).toBe(350);
    expect(usage!.cache_creation_tokens).toBe(200);
  });
});

// ql-20260831-011：message_delta 携带 cumulative input_tokens 的差分累加
//（GLM 兼容端点形态——message_start 无 input、delta 带全量；官方 Claude delta
// 不带 input，上述 describe 已覆盖零影响路径）。
describe('ql-20260831-011 message_delta input 差分累加（GLM 兼容端点）', () => {
  it('GLM 形态：message_start 无 input + delta 带 cumulative input 递增 → flush 等于终值（非逐条累加）', async () => {
    const { driver, emitMessage } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });
    await sm.create(BASE_INPUT);

    // message_start 不带 input_tokens（GLM 实证：轮内 ↑0）
    emitMessage(streamMessageStart(300, 200, 0));
    // delta 携带 cumulative input：96000 → 96055（流式期间递增）
    emitMessage(streamMessageDelta(300, 200, 30, 96000));
    emitMessage(streamMessageDelta(300, 200, 50, 96055));

    await new Promise((r) => setTimeout(r, 600));

    const usage = findFlushedUsage(deps.onTurnMessage.mock.calls);
    expect(usage).toBeDefined();
    // 差分累加：0(start) + 96000 + 55 = 96055（bug 下逐条全量累加 = 192055）
    expect(usage!.input_tokens).toBe(96055);
    expect(usage!.output_tokens).toBe(50);
  });

  it('官方形态防重复：message_start 带 input + delta 带同值 cumulative input → 差分 0 不翻倍', async () => {
    const { driver, emitMessage } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });
    await sm.create(BASE_INPUT);

    // start 已计 input=100；delta 携带同值 100（cumulative 含 start 份额）
    emitMessage(streamMessageStart(300, 200, 100));
    emitMessage(streamMessageDelta(300, 200, 50, 100));

    await new Promise((r) => setTimeout(r, 600));

    const usage = findFlushedUsage(deps.onTurnMessage.mock.calls);
    expect(usage).toBeDefined();
    // 差分基线 = start 值 100 → delta 差分 0，总 input 仍 100（不翻倍成 200）
    expect(usage!.input_tokens).toBe(100);
  });

  it('跨 API call：第二轮 message_start 重置差分基线（start 无 input → 基线 0）', async () => {
    const { driver, emitMessage } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });
    await sm.create(BASE_INPUT);

    // 第一轮 call：delta input 到 1000
    emitMessage(streamMessageStart(300, 200, 0));
    emitMessage(streamMessageDelta(300, 200, 20, 1000));
    // 第二轮 call（工具调用后继续）：message_start 无 input 重置基线，
    // delta 携带本轮 cumulative input 500
    emitMessage(streamMessageStart(300, 200, 0));
    emitMessage(streamMessageDelta(300, 200, 30, 500));

    await new Promise((r) => setTimeout(r, 600));

    const usage = findFlushedUsage(deps.onTurnMessage.mock.calls);
    expect(usage).toBeDefined();
    // 轮级累计：1000 + 500 = 1500（若基线未随 start 重置，会丢 500 只剩 1000）
    expect(usage!.input_tokens).toBe(1500);
  });
});
