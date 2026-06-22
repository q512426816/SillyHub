// tests/interactive/session-manager.partial-dedup.test.ts
// task-11（变更 2026-06-22-agent-run-pipeline-fix Wave1）：partial / 完整 thinking
// 按 segmentId 去重 —— 白盒单测。
//
// 覆盖（task-11 TDD 步骤 1-8 + 回归 9）：
//   - partial flush 的 [THINKING] message 含 metadata.segmentId + metadata.isPartial=true
//   - 完整 assistant message 到达 → emit [THINKING_OVERRIDE] <segmentId> 覆盖信号
//   - 同一 thinking block 的 partial 与完整 message 共享同一 segmentId
//   - 同 message 多个 thinking block（index 0 / 2）segmentId 各自独立
//   - late partial（完整 message 先到，partial 后到）被丢弃（不 flush）
//   - 退化方案：SDK 不给 message.id → segmentId 退化为 turnIndex:thinking
//   - assistant 文本 flush 不带 thinking metadata（不误带 segmentId）
//   - 80字符/120ms flush 阈值不变（PARTIAL_FLUSH_MS 常量回归）
//
// 策略：白盒直接调 SessionManager 的 _bufferPartial / _flushPartial /
// _clearPartialBuffer / _onMessage 私有方法（经 any 桥接），spy deps.onTurnMessage
// 捕获所有 emit。不启动真实 driver，绕过 SDK。

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionManager } from '../../src/interactive/session-manager.js';
import type { SessionState } from '../../src/interactive/types.js';

// ── 测试夹具 ────────────────────────────────────────────────────────────────

const SID = 'sess-test';
const LEASE_ID = 'lease-1';
const RUN_ID = 'run-1';
const CLAIM_TOKEN = 'claim-xxx';

/** 构造一个最小 SessionManager + 注入伪 SessionState（绕过 create/driver）。 */
function makeManager(): {
  sm: SessionManager;
  onTurnMessage: ReturnType<typeof vi.fn>;
  onTurnResult: ReturnType<typeof vi.fn>;
  onSessionEnd: ReturnType<typeof vi.fn>;
  state: SessionState;
} {
  const onTurnMessage = vi.fn().mockResolvedValue(undefined);
  const onTurnResult = vi.fn().mockResolvedValue(undefined);
  const onSessionEnd = vi.fn().mockResolvedValue(undefined);
  const sm = new SessionManager(
    {
      // driver 不实际被调用（测试不走 create/consume）。
      driver: { start: vi.fn(), consume: vi.fn(), interrupt: vi.fn() } as never,
      onTurnMessage,
      onTurnResult,
      onSessionEnd,
    },
    {},
  );
  const state: SessionState = {
    sessionId: SID,
    leaseId: LEASE_ID,
    claimToken: CLAIM_TOKEN,
    status: 'running',
    currentRunId: RUN_ID,
    lastActiveAt: Date.now(),
    cwd: '/tmp',
    provider: 'claude',
    pathToClaudeCodeExecutable: '/tmp/claude',
    inputQueue: { push: vi.fn(), close: vi.fn() } as never,
  };
  // 白盒：直接塞进 _store，跳过 driver.start。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (sm as any)._store.set(SID, state);
  return { sm, onTurnMessage, onTurnResult, onSessionEnd, state };
}

// 白盒桥接私有方法。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const priv = (sm: SessionManager): any => sm as any;

/** 构造 content_block_delta(thinking_delta) stream_event。 */
function thinkingDelta(
  index: number,
  text: string,
  messageId = 'msg-abc',
): Record<string, unknown> {
  return {
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      index,
      delta: { type: 'thinking_delta', thinking: text },
    },
    message: { id: messageId },
  };
}

/** 构造 message_start stream_event（提供 message.id）。 */
function messageStart(messageId: string): Record<string, unknown> {
  return {
    type: 'stream_event',
    event: { type: 'message_start', message: { id: messageId } },
  };
}

/** 构造 content_block_start(thinking) stream_event。 */
function blockStart(index: number): Record<string, unknown> {
  return {
    type: 'stream_event',
    event: { type: 'content_block_start', index, content_block: { type: 'thinking' } },
  };
}

/** 构造完整 assistant message（含若干 thinking block）。 */
function assistantMessage(
  messageId: string,
  thinkingBlocks: Array<{ index: number; text: string }>,
): Record<string, unknown> {
  const content: Array<Record<string, unknown>> = [];
  for (const b of thinkingBlocks) {
    content[b.index] = { type: 'thinking', thinking: b.text };
  }
  // 填补稀疏 hole（若有）以免 JSON 序列化异常。
  for (let i = 0; i < content.length; i++) {
    if (!content[i]) content[i] = { type: 'text', text: '' };
  }
  return {
    type: 'assistant',
    message: { id: messageId, role: 'assistant', content },
  };
}

// ── 测试用例 ────────────────────────────────────────────────────────────────

describe('task-11: partial/完整 thinking 按 segmentId 去重', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('partial flush 的 [THINKING] 携带 metadata.segmentId + isPartial', async () => {
    const { sm, onTurnMessage, state } = makeManager();
    const p = priv(sm);

    // message_start 携带 message.id。
    p._onMessage(state, messageStart('msg-abc'));
    // content_block_start(index=0, thinking)。
    p._onMessage(state, blockStart(0));
    // thinking_delta 累积（>80 字符触发 flush 阈值——但 _bufferPartial 只启动 timer，
    // flush 由 _flushPartial 触发；此处手动 flush 立即验证 metadata）。
    p._onMessage(state, thinkingDelta(0, 'x'.repeat(90), 'msg-abc'));

    // 手动 flush（绕过 timer 等待）。
    await p._flushPartial(SID);

    expect(onTurnMessage).toHaveBeenCalledTimes(1);
    const emitted = onTurnMessage.mock.calls[0][2] as Record<string, unknown>;
    expect(emitted.event_type).toBe('text');
    expect(emitted.content).toMatch(/^\[THINKING\] /);
    // 关键断言：segmentId = `${messageId}:${index}`，isPartial=true。
    const meta = (emitted.metadata ?? {}) as Record<string, unknown>;
    expect(meta.segmentId).toBe('msg-abc:0');
    expect(meta.thinking).toBe(true);
    expect(meta.isPartial).toBe(true);
  });

  it('完整 assistant message 到达 → emit [THINKING_OVERRIDE] <segmentId>', async () => {
    const { sm, onTurnMessage, state } = makeManager();
    const p = priv(sm);

    // 1. partial flush 一条 thinking（segmentId = msg-abc:0）。
    p._onMessage(state, messageStart('msg-abc'));
    p._onMessage(state, blockStart(0));
    p._onMessage(state, thinkingDelta(0, 'x'.repeat(90), 'msg-abc'));
    await p._flushPartial(SID);
    expect(onTurnMessage).toHaveBeenCalledTimes(1);

    // 2. 完整 assistant message 到达（含 thinking block index=0 全文）。
    await p._onMessage(
      state,
      assistantMessage('msg-abc', [{ index: 0, text: '完整思考内容' }]),
    );

    // 完整 message 会被 _onMessage 转发给 onTurnMessage（1 条）+ override 信号（1 条）。
    // 至少 emit 了 [THINKING_OVERRIDE] msg-abc:0。
    const calls = onTurnMessage.mock.calls.map((c) => c[2]) as Array<
      Record<string, unknown>
    >;
    const override = calls.find(
      (m) =>
        typeof m.content === 'string' &&
        m.content.startsWith('[THINKING_OVERRIDE]'),
    );
    expect(override, 'expected [THINKING_OVERRIDE] signal').toBeDefined();
    expect(override!.content).toBe('[THINKING_OVERRIDE] msg-abc:0');
    const meta = (override!.metadata ?? {}) as Record<string, unknown>;
    expect(meta.segmentId).toBe('msg-abc:0');
    expect(meta.stale).toBe(true);
    expect(meta.thinking).toBe(true);

    // completedSegments 已记录。
    const buf = p._partialBuffers.get(SID);
    expect(buf.completedSegments.has('msg-abc:0')).toBe(true);
  });

  it('多 thinking block：segmentId 各自独立，override 分别 emit', async () => {
    const { sm, onTurnMessage, state } = makeManager();
    const p = priv(sm);

    p._onMessage(state, messageStart('msg-multi'));
    // 两个 thinking block：index=0 和 index=2（中间夹 tool_use 用 index=1）。
    p._onMessage(state, blockStart(0));
    p._onMessage(state, thinkingDelta(0, 'x'.repeat(90), 'msg-multi'));
    await p._flushPartial(SID);
    p._onMessage(state, blockStart(2));
    p._onMessage(state, thinkingDelta(2, 'y'.repeat(90), 'msg-multi'));
    await p._flushPartial(SID);

    // 完整 message 含两个 thinking block。
    await p._onMessage(
      state,
      assistantMessage('msg-multi', [
        { index: 0, text: 'block0 全文' },
        { index: 2, text: 'block2 全文' },
      ]),
    );

    const calls = onTurnMessage.mock.calls.map((c) => c[2]) as Array<
      Record<string, unknown>
    >;
    const overrides = calls
      .filter(
        (m) =>
          typeof m.content === 'string' &&
          m.content.startsWith('[THINKING_OVERRIDE]'),
      )
      .map((m) => m.content as string)
      .sort();
    expect(overrides).toEqual([
      '[THINKING_OVERRIDE] msg-multi:0',
      '[THINKING_OVERRIDE] msg-multi:2',
    ]);
  });

  it('late partial：完整 message 先到，同 segment partial 后到被丢弃', async () => {
    const { sm, onTurnMessage, state } = makeManager();
    const p = priv(sm);

    // 1. 先 flush 一条 partial（segmentId = msg-late:0）。
    p._onMessage(state, messageStart('msg-late'));
    p._onMessage(state, blockStart(0));
    p._onMessage(state, thinkingDelta(0, 'x'.repeat(90), 'msg-late'));
    await p._flushPartial(SID);

    // 2. 完整 message 到达（标记 completedSegments）。
    await p._onMessage(
      state,
      assistantMessage('msg-late', [{ index: 0, text: '完整' }]),
    );

    const callsBefore = onTurnMessage.mock.calls.length;

    // 3. 网络重排：late thinking_delta 到达（同 segmentId）。
    p._onMessage(state, thinkingDelta(0, '迟到的增量', 'msg-late'));
    await p._flushPartial(SID);

    // late partial 被丢弃，没有新 emit（只可能有残留 timer 空 flush no-op）。
    const callsAfter = onTurnMessage.mock.calls.length;
    expect(callsAfter).toBe(callsBefore);
  });

  it('退化方案：SDK 不给 message.id → segmentId 退化为 turnIndex:thinking', async () => {
    const { sm, onTurnMessage, state } = makeManager();
    const p = priv(sm);

    // message_start 不带 message.id（模拟 SDK 不提供）。
    p._onMessage(state, {
      type: 'stream_event',
      event: { type: 'message_start', message: {} },
    });
    p._onMessage(state, blockStart(0));
    // thinkingDelta 也不带 message.id（退化）。
    p._onMessage(state, {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'z'.repeat(90) },
      },
    });
    await p._flushPartial(SID);

    const emitted = onTurnMessage.mock.calls[0][2] as Record<string, unknown>;
    const meta = (emitted.metadata ?? {}) as Record<string, unknown>;
    // 退化：turnIndex:thinking（turnIndex 来自 currentRunId，这里是 'run-1'）。
    expect(meta.segmentId).toBe('run-1:thinking');
    expect(meta.isPartial).toBe(true);
  });

  it('assistant 文本 flush 不携带 thinking/segmentId metadata', async () => {
    const { sm, onTurnMessage, state } = makeManager();
    const p = priv(sm);

    p._onMessage(state, messageStart('msg-text'));
    // text_delta（非 thinking）。
    p._onMessage(state, {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'text_delta', text: 'a'.repeat(90) },
      },
    });
    await p._flushPartial(SID);

    const calls = onTurnMessage.mock.calls.map((c) => c[2]) as Array<
      Record<string, unknown>
    >;
    const assistant = calls.find(
      (m) => typeof m.content === 'string' && m.content.startsWith('[ASSISTANT]'),
    );
    expect(assistant, 'expected [ASSISTANT] flush').toBeDefined();
    // assistant 文本不应带 thinking/segmentId/isPartial。
    const meta = (assistant!.metadata ?? {}) as Record<string, unknown>;
    expect(meta.thinking).toBeUndefined();
    expect(meta.segmentId).toBeUndefined();
    expect(meta.isPartial).toBeUndefined();
  });

  it('turn 边界重置：completedSegments 在 _onResult（turn 结束）后清空', async () => {
    const { sm, onTurnResult, state } = makeManager();
    const p = priv(sm);

    p._onMessage(state, messageStart('msg-reset'));
    p._onMessage(state, blockStart(0));
    p._onMessage(state, thinkingDelta(0, 'x'.repeat(90), 'msg-reset'));
    await p._flushPartial(SID);
    await p._onMessage(
      state,
      assistantMessage('msg-reset', [{ index: 0, text: '完整' }]),
    );

    // 完整 message 后 completedSegments 非空（late partial 守卫生效）。
    const bufMid = p._partialBuffers.get(SID);
    expect(bufMid.completedSegments.has('msg-reset:0')).toBe(true);

    // turn 结束（_onResult）后清空。
    await p._onResult(state, { type: 'result', subtype: 'success' });
    const bufAfter = p._partialBuffers.get(SID);
    expect(bufAfter.completedSegments.size).toBe(0);
  });

  it('PARTIAL_FLUSH_MS 常量保持 500（实时性回归）', () => {
    expect(SessionManager.PARTIAL_FLUSH_MS).toBe(500);
  });

  it('原有 _clearPartialBuffer 清 buffer 行为保留（无 completed 时仅清 timer/buffer）', async () => {
    const { sm, onTurnMessage, state } = makeManager();
    const p = priv(sm);

    // partial 累积但未 flush。
    p._onMessage(state, messageStart('msg-orig'));
    p._onMessage(state, blockStart(0));
    p._onMessage(state, thinkingDelta(0, '未flush的增量', 'msg-orig'));
    const callsBefore = onTurnMessage.mock.calls.length;

    // 完整 message 到达，但 buffer 里只有未 flush 的内容（flushedSegments 为空）。
    await p._onMessage(
      state,
      assistantMessage('msg-orig', [{ index: 0, text: '完整' }]),
    );

    // 只转发完整 message（1 条），不 emit override（无已 flush 的 partial）。
    const delta = onTurnMessage.mock.calls.length - callsBefore;
    expect(delta).toBe(1); // 仅完整 assistant 转发
    const buf = p._partialBuffers.get(SID);
    expect(buf.thinking).toBe(''); // buffer 已清
    expect(buf.timer).toBeNull();
  });
});
