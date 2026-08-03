// tests/interactive/session-manager.partial-dedup.test.ts
// task-11（变更 2026-06-22-agent-run-pipeline-fix Wave1）：partial / 完整 thinking
// 按 segmentId 去重 —— 白盒单测。
//
// 覆盖（task-11 TDD 步骤 1-8 + 回归 9）：
//   - partial flush 的 [THINKING] message 含 metadata.segmentId + metadata.isPartial=true
//   - 完整 assistant message 到达 → emit [THINKING_OVERRIDE] <segmentId> 覆盖信号
//   - 同一 thinking block 的 partial 与完整 message 共享同一 segmentId
//   - 同 message 的 thinking block 与 text block 按 type 区分 segmentId，override 分别 emit
//   - late partial（完整 message 先到，partial 后到）被丢弃（不 flush）
//   - 退化方案：SDK 不给 message.id → segmentId 退化为 turnIndex:thinking
//   - assistant 文本 flush 带 segmentId + isPartial，但**不带** thinking:true（task-12 修旧债：task-05 契约让 assistant partial 带 segmentId，旧断言已失效）
//   - 80字符/120ms flush 阈值不变（PARTIAL_FLUSH_MS 常量回归）
//
// 策略：白盒直接调 SessionManager 的 _bufferPartial / _flushPartial /
// _clearPartialBuffer / _onMessage 私有方法（经 any 桥接），spy deps.onTurnMessage
// 捕获所有 emit。不启动真实 driver，绕过 SDK。
//
// 2026-06-28-daemon-subagent-transcript task-03 / D-002@v1 更新：partial 改二级 Map
// 按 parent_tool_use_id 分桶。本文件全部用例为主 agent（parent=null → 'main' 桶），
// segmentId 契约为 `main:${messageId}:${blockType}`（parent 前缀隔离主/子 segment 空间，
// task-13修复后第 3 段用 block type thinking/text 而非 stream index），_partialBuffers
// 访问改二级 .get('main')，_flushPartial 加 parentKey 参数。行为不变（partial/override/
// 去重/late 守卫），仅 segmentId 字符串与 Map 结构跟进新契约。主/子分桶隔离见
// session-manager.partial-bucket.test.ts。

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

/**
 * 构造 content_block_delta(thinking_delta) stream_event。
 *
 * P1 修复：按真实 SDK 形状构造——SDKPartialAssistantMessage（type='stream_event'）
 * 没有「顶层 message 字段」，content_block_delta 事件自身也不带 message.id。
 * message.id 由前序 message_start 事件的 event.message.id 提供（见 messageStart），
 * _bufferPartial 据此写入 buf.currentMessageId，thinking_delta 解析 segmentId 时复用。
 * 旧 helper 凭空加顶层 message:{id} 让真实场景失效的守卫在测试里假绿，已移除。
 */
function thinkingDelta(
  index: number,
  text: string,
): Record<string, unknown> {
  return {
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      index,
      delta: { type: 'thinking_delta', thinking: text },
    },
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

/**
 * P1 回归用：构造「全量真实 SDK 形状」的 SDKPartialAssistantMessage。
 *
 * 与 messageStart/blockStart/thinkingDelta 的最小构造不同——这里带上真实 SDK 必有
 * 的 parent_tool_use_id / uuid / session_id 字段（@anthropic-ai/claude-agent-sdk
 * sdk.d.ts:3720），且 event 内 message.id 只出现在 message_start 的 event.message
 * 里，content_block_delta 的 event 自身绝无 message.id。用最忠实的形状跑 late
 * partial 守卫，确保修复不依赖任何最小 helper 的「巧合」。
 */
let sdkPartialUuidSeq = 0;
function sdkPartial(event: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'stream_event',
    event,
    parent_tool_use_id: null,
    uuid: `real-uuid-${++sdkPartialUuidSeq}`,
    session_id: SID,
  };
}

/** P1 回归用：全量真实 SDK 形状的 SDKAssistantMessage（含 uuid/session_id）。 */
function sdkAssistantMessage(
  messageId: string,
  thinkingBlocks: Array<{ index: number; text: string }>,
): Record<string, unknown> {
  const content: Array<Record<string, unknown>> = [];
  for (const b of thinkingBlocks) {
    content[b.index] = { type: 'thinking', thinking: b.text };
  }
  for (let i = 0; i < content.length; i++) {
    if (!content[i]) content[i] = { type: 'text', text: '' };
  }
  return {
    type: 'assistant',
    message: { id: messageId, role: 'assistant', content },
    parent_tool_use_id: null,
    uuid: `asst-uuid-${++sdkPartialUuidSeq}`,
    session_id: SID,
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
    p._onMessage(state, thinkingDelta(0, 'x'.repeat(90)));

    // 手动 flush（绕过 timer 等待）。
    await p._flushPartial(SID, 'main');

    expect(onTurnMessage).toHaveBeenCalledTimes(1);
    const emitted = onTurnMessage.mock.calls[0][2] as Record<string, unknown>;
    expect(emitted.event_type).toBe('text');
    expect(emitted.content).toMatch(/^\[THINKING\] /);
    // 关键断言：segmentId = `${parentKey}:${messageId}:${blockType}`，isPartial=true。
    // task-13修复：第 3 段用 block type（thinking），不再用 stream index。
    const meta = (emitted.metadata ?? {}) as Record<string, unknown>;
    expect(meta.segmentId).toBe('main:msg-abc:thinking');
    expect(meta.thinking).toBe(true);
    expect(meta.isPartial).toBe(true);
  });

  it('完整 assistant message 到达 → emit [THINKING_OVERRIDE] <segmentId>', async () => {
    const { sm, onTurnMessage, state } = makeManager();
    const p = priv(sm);

    // 1. partial flush 一条 thinking（segmentId = main:msg-abc:thinking）。
    p._onMessage(state, messageStart('msg-abc'));
    p._onMessage(state, blockStart(0));
    p._onMessage(state, thinkingDelta(0, 'x'.repeat(90)));
    await p._flushPartial(SID, 'main');
    expect(onTurnMessage).toHaveBeenCalledTimes(1);

    // 2. 完整 assistant message 到达（含 thinking block index=0 全文）。
    await p._onMessage(
      state,
      assistantMessage('msg-abc', [{ index: 0, text: '完整思考内容' }]),
    );

    // 完整 message 会被 _onMessage 转发给 onTurnMessage（1 条）+ override 信号（1 条）。
    // 至少 emit 了 [THINKING_OVERRIDE] main:msg-abc:thinking。
    const calls = onTurnMessage.mock.calls.map((c) => c[2]) as Array<
      Record<string, unknown>
    >;
    const override = calls.find(
      (m) =>
        typeof m.content === 'string' &&
        m.content.startsWith('[THINKING_OVERRIDE]'),
    );
    expect(override, 'expected [THINKING_OVERRIDE] signal').toBeDefined();
    expect(override!.content).toBe('[THINKING_OVERRIDE] main:msg-abc:thinking');
    const meta = (override!.metadata ?? {}) as Record<string, unknown>;
    expect(meta.segmentId).toBe('main:msg-abc:thinking');
    expect(meta.stale).toBe(true);
    expect(meta.thinking).toBe(true);

    // completedSegments 已记录。
    const buf = p._partialBuffers.get(SID).get('main');
    expect(buf.completedSegments.has('main:msg-abc:thinking')).toBe(true);
  });

  it('thinking + text block：segmentId 按 type 区分，override 分别 emit', async () => {
    // task-13修复后 segmentId 第 3 段是 block type（thinking/text）而非 stream index。
    // 同 type 的多 block（如两条 thinking）会共享 segmentId（精度损失，设计接受）；
    // 但 thinking 与 text 因 type 不同 → segmentId 必不同 → override 各自独立 emit。
    // 本用例改用 thinking + text 验证「不同 type block 互不串扰」这一新契约核心。
    const { sm, onTurnMessage, state } = makeManager();
    const p = priv(sm);

    p._onMessage(state, messageStart('msg-multi'));
    // thinking block（index=0）partial flush。
    p._onMessage(state, blockStart(0));
    p._onMessage(state, thinkingDelta(0, 'x'.repeat(90)));
    await p._flushPartial(SID, 'main');
    // text block（index=1）partial flush。
    p._onMessage(state, {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'text_delta', text: 'a'.repeat(90) },
      },
    });
    await p._flushPartial(SID, 'main');

    // 完整 message 含 thinking block（index=0）+ text block（index=1）。
    await p._onMessage(state, {
      type: 'assistant',
      message: {
        id: 'msg-multi',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'block0 全文' },
          { type: 'text', text: 'block1 全文' },
        ],
      },
    });

    const calls = onTurnMessage.mock.calls.map((c) => c[2]) as Array<
      Record<string, unknown>
    >;
    const overrides = calls
      .filter(
        (m) =>
          typeof m.content === 'string' &&
          (m.content.startsWith('[THINKING_OVERRIDE]') ||
            m.content.startsWith('[ASSISTANT_OVERRIDE]')),
      )
      .map((m) => m.content as string)
      .sort();
    // thinking block → [THINKING_OVERRIDE] main:msg-multi:thinking；
    // text block    → [ASSISTANT_OVERRIDE] main:msg-multi:text。type 不同，互不串扰。
    expect(overrides).toEqual([
      '[ASSISTANT_OVERRIDE] main:msg-multi:text',
      '[THINKING_OVERRIDE] main:msg-multi:thinking',
    ]);
  });

  it('late partial：完整 message 先到，同 segment partial 后到被丢弃', async () => {
    const { sm, onTurnMessage, state } = makeManager();
    const p = priv(sm);

    // 1. 先 flush 一条 partial（segmentId = main:msg-late:thinking）。
    p._onMessage(state, messageStart('msg-late'));
    p._onMessage(state, blockStart(0));
    p._onMessage(state, thinkingDelta(0, 'x'.repeat(90)));
    await p._flushPartial(SID, 'main');

    // 2. 完整 message 到达（标记 completedSegments）。
    await p._onMessage(
      state,
      assistantMessage('msg-late', [{ index: 0, text: '完整' }]),
    );

    const callsBefore = onTurnMessage.mock.calls.length;

    // 3. 网络重排：late thinking_delta 到达（同 segmentId）。
    p._onMessage(state, thinkingDelta(0, '迟到的增量'));
    await p._flushPartial(SID, 'main');

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
    await p._flushPartial(SID, 'main');

    const emitted = onTurnMessage.mock.calls[0][2] as Record<string, unknown>;
    const meta = (emitted.metadata ?? {}) as Record<string, unknown>;
    // 退化：turnIndex:thinking（turnIndex 来自 currentRunId，这里是 'run-1'）。
    expect(meta.segmentId).toBe('main:run-1:thinking');
    expect(meta.isPartial).toBe(true);
  });

  // task-12 修旧债：task-05 契约变化——assistant partial flush 现在主动带
  // segmentId + isPartial（对齐 thinking partial），让完整 message 到达时
  // _emitOverrideSignals（task-07）能 emit [ASSISTANT_OVERRIDE] 命中并撤回本
  // partial 行（消除 #35 双发）。旧断言「不带 segmentId/isPartial」是 task-05
  // 落地前的契约，现已失效；本用例改为期望 assistant flush 带 segmentId +
  // isPartial，但仍**不带 thinking:true**（B2：assistant 不是 thinking，
  // 否则被 backend thinking override 链路误撤）。这是断言跟上契约变化，非
  // 改测试凑过（CLAUDE.md #9）。
  it('assistant 文本 flush 带 segmentId + isPartial，不带 thinking', async () => {
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
    await p._flushPartial(SID, 'main');

    const calls = onTurnMessage.mock.calls.map((c) => c[2]) as Array<
      Record<string, unknown>
    >;
    const assistant = calls.find(
      (m) => typeof m.content === 'string' && m.content.startsWith('[ASSISTANT]'),
    );
    expect(assistant, 'expected [ASSISTANT] flush').toBeDefined();
    // task-05 契约：assistant flush 带 segmentId（main:msg-text:text，task-13修复后第 3 段为
    // block type）+ isPartial。
    const meta = (assistant!.metadata ?? {}) as Record<string, unknown>;
    expect(meta.segmentId).toBe('main:msg-text:text');
    expect(meta.isPartial).toBe(true);
    // B2：assistant partial 绝不带 thinking:true（否则被 thinking override 误撤）。
    expect(meta.thinking).toBeUndefined();
  });

  it('turn 边界重置：completedSegments 在 _onResult（turn 结束）后清空', async () => {
    const { sm, onTurnResult, state } = makeManager();
    const p = priv(sm);

    p._onMessage(state, messageStart('msg-reset'));
    p._onMessage(state, blockStart(0));
    p._onMessage(state, thinkingDelta(0, 'x'.repeat(90)));
    await p._flushPartial(SID, 'main');
    await p._onMessage(
      state,
      assistantMessage('msg-reset', [{ index: 0, text: '完整' }]),
    );

    // 完整 message 后 completedSegments 非空（late partial 守卫生效）。
    const bufMid = p._partialBuffers.get(SID).get('main');
    expect(bufMid.completedSegments.has('main:msg-reset:thinking')).toBe(true);

    // turn 结束（_onResult）后清空。
    await p._onResult(state, { type: 'result', subtype: 'success' });
    const bufAfter = p._partialBuffers.get(SID).get('main');
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
    p._onMessage(state, thinkingDelta(0, '未flush的增量'));
    const callsBefore = onTurnMessage.mock.calls.length;

    // 完整 message 到达，但 buffer 里只有未 flush 的内容（flushedSegments 为空）。
    await p._onMessage(
      state,
      assistantMessage('msg-orig', [{ index: 0, text: '完整' }]),
    );

    // 只转发完整 message（1 条），不 emit override（无已 flush 的 partial）。
    const delta = onTurnMessage.mock.calls.length - callsBefore;
    expect(delta).toBe(1); // 仅完整 assistant 转发
    const buf = p._partialBuffers.get(SID).get('main');
    expect(buf.thinking).toBe(''); // buffer 已清
    expect(buf.timer).toBeNull();
  });
});
