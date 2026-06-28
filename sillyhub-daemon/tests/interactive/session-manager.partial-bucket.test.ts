// tests/interactive/session-manager.partial-bucket.test.ts
// 2026-06-28-daemon-subagent-transcript task-03 / D-002@v1（R-02 P0）：
// partial buffer 按 parent_tool_use_id 分桶隔离 —— 白盒单测。
//
// 覆盖：
//   - _parentKeyOf：主 agent/无字段/空串 → 'main'；子代理 → tool_use_id
//   - 主/子 partial 各自进独立桶（二级 Map），thinking 不互混
//   - D-002 核心：子代理完整 assistant message 只清子桶，主 agent partial 保留
//   - segmentId parent 前缀：主/子同 messageId:index 不撞 id
//   - 主/子 partial flush 分别 emit，segmentId 各带 parent 前缀
//   - _destroyPartialBuffer 销毁整 session 所有桶 + timer
//   - 多层子代理（子→孙）各进独立桶
//
// 主 agent 单代理字节等价回归见 session-manager.partial-dedup.test.ts。

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionManager } from '../../src/interactive/session-manager.js';
import type { SessionState } from '../../src/interactive/types.js';

const SID = 'sess-bucket';
const RUN_ID = 'run-1';

/** 构造最小 SessionManager + 注入伪 SessionState（含 task-02 的 subagentDepth）。 */
function makeManager(): {
  sm: SessionManager;
  onTurnMessage: ReturnType<typeof vi.fn>;
  state: SessionState;
} {
  const onTurnMessage = vi.fn().mockResolvedValue(undefined);
  const sm = new SessionManager(
    {
      // driver 不实际被调用（测试不走 create/consume）。
      driver: { start: vi.fn(), consume: vi.fn(), interrupt: vi.fn() } as never,
      onTurnMessage,
      onTurnResult: vi.fn().mockResolvedValue(undefined),
      onSessionEnd: vi.fn().mockResolvedValue(undefined),
    },
    {},
  );
  const state = {
    sessionId: SID,
    leaseId: 'lease-1',
    claimToken: 'claim-x',
    status: 'running',
    currentRunId: RUN_ID,
    lastActiveAt: Date.now(),
    cwd: '/tmp',
    provider: 'claude',
    pathToClaudeCodeExecutable: '/tmp/claude',
    inputQueue: { push: vi.fn(), close: vi.fn() } as never,
    subagentDepth: new Map<string, number>(),
  } as unknown as SessionState;
  // 白盒：直接塞进 _store，跳过 driver.start。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (sm as any)._store.set(SID, state);
  return { sm, onTurnMessage, state };
}

// 白盒桥接私有方法。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const priv = (sm: SessionManager): any => sm as any;

/** message_start（带 parent_tool_use_id）。null=主 agent，非空=子代理 tool_use_id。 */
function messageStart(
  parentToolUseId: string | null,
  messageId: string,
): Record<string, unknown> {
  return {
    type: 'stream_event',
    parent_tool_use_id: parentToolUseId,
    uuid: `ms-${messageId}-${parentToolUseId ?? 'main'}`,
    session_id: SID,
    event: { type: 'message_start', message: { id: messageId } },
  };
}

/** thinking_delta（带 parent_tool_use_id）。 */
function thinkingDelta(
  parentToolUseId: string | null,
  index: number,
  text: string,
): Record<string, unknown> {
  return {
    type: 'stream_event',
    parent_tool_use_id: parentToolUseId,
    uuid: `td-${parentToolUseId ?? 'main'}-${index}-${text.length}`,
    session_id: SID,
    event: {
      type: 'content_block_delta',
      index,
      delta: { type: 'thinking_delta', thinking: text },
    },
  };
}

/** 完整 assistant message（带 parent_tool_use_id + thinking block）。 */
function assistantMessage(
  parentToolUseId: string | null,
  messageId: string,
  thinking: string,
): Record<string, unknown> {
  return {
    type: 'assistant',
    parent_tool_use_id: parentToolUseId,
    uuid: `asst-${messageId}`,
    session_id: SID,
    message: {
      id: messageId,
      role: 'assistant',
      content: [{ type: 'thinking', thinking }],
    },
  };
}

describe('task-03 / D-002: partial 按 parent_tool_use_id 分桶隔离', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('_parentKeyOf: 主/无字段/空串 → main，子代理 → tool_use_id', () => {
    const { sm } = makeManager();
    const p = priv(sm);
    expect(p._parentKeyOf({ parent_tool_use_id: null })).toBe('main');
    expect(p._parentKeyOf({ parent_tool_use_id: 'tool_1' })).toBe('tool_1');
    expect(p._parentKeyOf({})).toBe('main'); // SDKThinkingTokensMessage 无该字段
    expect(p._parentKeyOf({ parent_tool_use_id: '' })).toBe('main'); // 空串退化
  });

  it('主/子 partial 各进独立桶，thinking 不互混', () => {
    const { sm, state } = makeManager();
    const p = priv(sm);
    p._onMessage(state, messageStart(null, 'msg-main'));
    p._onMessage(state, thinkingDelta(null, 0, '主思考'));
    p._onMessage(state, messageStart('tool_1', 'msg-sub'));
    p._onMessage(state, thinkingDelta('tool_1', 0, '子思考'));

    const sessionMap = p._partialBuffers.get(SID);
    expect(sessionMap.size).toBe(2);
    expect(sessionMap.get('main').parentKey).toBe('main');
    expect(sessionMap.get('main').thinking).toBe('主思考');
    expect(sessionMap.get('tool_1').parentKey).toBe('tool_1');
    expect(sessionMap.get('tool_1').thinking).toBe('子思考');
  });

  it('D-002 隔离：子代理完整 message 只清子桶，主 agent partial 保留', async () => {
    const { sm, state } = makeManager();
    const p = priv(sm);
    // 主 + 子 partial 累积
    p._onMessage(state, messageStart(null, 'msg-main'));
    p._onMessage(state, thinkingDelta(null, 0, '主思考'));
    p._onMessage(state, messageStart('tool_1', 'msg-sub'));
    p._onMessage(state, thinkingDelta('tool_1', 0, '子思考'));

    // 子代理完整 assistant message 到达
    await p._onMessage(state, assistantMessage('tool_1', 'msg-sub', '子完整思考'));

    const sessionMap = p._partialBuffers.get(SID);
    // R-02 核心：主桶 thinking 保留（未被子代理完整 message 清），timer 仍在
    expect(sessionMap.get('main').thinking).toBe('主思考');
    expect(sessionMap.get('main').timer).not.toBeNull();
    // 子桶被清，timer 清空，completedSegments 记录子 segment（late 守卫）
    expect(sessionMap.get('tool_1').thinking).toBe('');
    expect(sessionMap.get('tool_1').timer).toBeNull();
    expect(
      sessionMap.get('tool_1').completedSegments.has('tool_1:msg-sub:0'),
    ).toBe(true);
  });

  it('segmentId 隔离：主/子同 messageId:index 不撞 id', () => {
    const { sm, state } = makeManager();
    const p = priv(sm);
    p._onMessage(state, messageStart(null, 'shared'));
    p._onMessage(state, messageStart('tool_1', 'shared'));
    const sessionMap = p._partialBuffers.get(SID);
    const mainSeg = p._resolveSegmentId(state, sessionMap.get('main'), 0);
    const subSeg = p._resolveSegmentId(state, sessionMap.get('tool_1'), 0);
    expect(mainSeg).toBe('main:shared:0');
    expect(subSeg).toBe('tool_1:shared:0');
    expect(mainSeg).not.toBe(subSeg);
  });

  it('主/子 partial flush 分别 emit，segmentId 各带 parent 前缀', async () => {
    const { sm, onTurnMessage, state } = makeManager();
    const p = priv(sm);
    // 主 partial flush
    p._onMessage(state, messageStart(null, 'msg-main'));
    p._onMessage(state, thinkingDelta(null, 0, '主思考'));
    await p._flushPartial(SID, 'main');
    // 子 partial flush
    p._onMessage(state, messageStart('tool_1', 'msg-sub'));
    p._onMessage(state, thinkingDelta('tool_1', 0, '子思考'));
    await p._flushPartial(SID, 'tool_1');

    const calls = onTurnMessage.mock.calls.map((c) => c[2]) as Array<
      Record<string, unknown>
    >;
    expect(calls).toHaveLength(2);
    expect(calls[0].content).toBe('[THINKING] 主思考');
    expect(calls[1].content).toBe('[THINKING] 子思考');
    const mainMeta = (calls[0].metadata ?? {}) as Record<string, unknown>;
    const subMeta = (calls[1].metadata ?? {}) as Record<string, unknown>;
    expect(mainMeta.segmentId).toBe('main:msg-main:0');
    expect(subMeta.segmentId).toBe('tool_1:msg-sub:0');
  });

  it('_destroyPartialBuffer 销毁整 session 所有桶 + timer', () => {
    const { sm, state } = makeManager();
    const p = priv(sm);
    // bufferPartial 启动各自桶的 timer
    p._onMessage(state, thinkingDelta(null, 0, '主'));
    p._onMessage(state, thinkingDelta('tool_1', 0, '子'));
    const sessionMap = p._partialBuffers.get(SID);
    expect(sessionMap.size).toBe(2);
    expect(sessionMap.get('main').timer).not.toBeNull();
    expect(sessionMap.get('tool_1').timer).not.toBeNull();
    p._destroyPartialBuffer(SID);
    expect(p._partialBuffers.has(SID)).toBe(false);
  });

  it('多层子代理（子→孙）各进独立桶', () => {
    const { sm, state } = makeManager();
    const p = priv(sm);
    p._onMessage(state, messageStart(null, 'm0'));
    p._onMessage(state, thinkingDelta(null, 0, '主'));
    p._onMessage(state, messageStart('tool_1', 'm1')); // 子（parent=tool_1）
    p._onMessage(state, thinkingDelta('tool_1', 0, '子'));
    p._onMessage(state, messageStart('tool_2', 'm2')); // 孙（parent=tool_2）
    p._onMessage(state, thinkingDelta('tool_2', 0, '孙'));
    const sessionMap = p._partialBuffers.get(SID);
    expect(sessionMap.size).toBe(3);
    expect(sessionMap.get('main').thinking).toBe('主');
    expect(sessionMap.get('tool_1').thinking).toBe('子');
    expect(sessionMap.get('tool_2').thinking).toBe('孙');
  });
});

describe('task-12 / D-003 init 守卫 + D-007 depth 多层注入', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('D-003: 子代理 system/init（parent_tool_use_id 非空）不覆盖主 session agentSessionId', async () => {
    const { sm, state } = makeManager();
    const p = priv(sm);
    // 主 session init → 设 agentSessionId（resume key）
    await p._onMessage(state, {
      type: 'system',
      subtype: 'init',
      session_id: 'main-agent-session',
    });
    expect(state.agentSessionId).toBe('main-agent-session');
    // 子代理 init（parent_tool_use_id 非空）不得覆盖主 session 的 agentSessionId
    await p._onMessage(state, {
      type: 'system',
      subtype: 'init',
      session_id: 'sub-agent-session',
      parent_tool_use_id: 'toolu_sub_1',
    });
    expect(state.agentSessionId).toBe('main-agent-session');
  });

  it('D-007: depth 多层——主 0 / 子 1 / 孙 2，tool_use blocks 预登记', async () => {
    const { sm, state } = makeManager();
    const p = priv(sm);
    // 主 agent assistant（parent=null）含 tool_use → msg.depth=0 + 预登记子 tool=1
    await p._onMessage(state, {
      type: 'assistant',
      message: {
        id: 'msg-main',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_sub', name: 'Task', input: {} }],
      },
    });
    expect(state.subagentDepth.get('toolu_sub')).toBe(1);

    // 子代理 message（parent=toolu_sub）→ msg.depth=1
    const subMsg = {
      type: 'assistant',
      parent_tool_use_id: 'toolu_sub',
      message: {
        id: 'msg-sub',
        role: 'assistant',
        content: [{ type: 'text', text: '子代理回复' }],
      },
    } as Record<string, unknown>;
    await p._onMessage(state, subMsg);
    expect(subMsg['depth']).toBe(1);

    // 子代理派生孙（tool_use id=toolu_grand，parent=toolu_sub depth=1）→ 预登记孙=2
    await p._onMessage(state, {
      type: 'assistant',
      parent_tool_use_id: 'toolu_sub',
      message: {
        id: 'msg-sub-2',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_grand', name: 'Task', input: {} }],
      },
    });
    expect(state.subagentDepth.get('toolu_grand')).toBe(2);

    // 孙代理 message（parent=toolu_grand）→ msg.depth=2
    const grandMsg = {
      type: 'assistant',
      parent_tool_use_id: 'toolu_grand',
      message: {
        id: 'msg-grand',
        role: 'assistant',
        content: [{ type: 'text', text: '孙代理回复' }],
      },
    } as Record<string, unknown>;
    await p._onMessage(state, grandMsg);
    expect(grandMsg['depth']).toBe(2);
  });

  it('D-007 退化: parent 未预登记 → depth=1（R-04 最常见假设）', async () => {
    const { sm, state } = makeManager();
    const p = priv(sm);
    // 子代理 message 但父 tool_use 未先到（时序异常）→ 退化 1
    const orphanMsg = {
      type: 'assistant',
      parent_tool_use_id: 'toolu_unknown',
      message: { id: 'm', role: 'assistant', content: [{ type: 'text', text: 'x' }] },
    } as Record<string, unknown>;
    await p._onMessage(state, orphanMsg);
    expect(orphanMsg['depth']).toBe(1);
  });
});
