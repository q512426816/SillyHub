// tests/interactive/session-manager-subagent-shrink.test.ts
// ql-20260825-f6#2：turn 收尾收缩子代理 partial 桶 + subagentDepth。
//
// 修复前：_getOrCreateBuffer 每个子代理 parentKey 懒建桶、subagentDepth.set 跨 turn
// 不清 → 主 agent 长会话（lease 永不过期）每 spawn 一个子代理多一个桶 + 一条 depth，
// 数月线性膨胀。
// 修复后：_onResult 收尾（_checkBudgetCutoff 之后）把子桶 input/output 累计折算进
// 'main' 后删桶 + 清空 subagentDepth；turn 进行中不误删；终态仍走 _destroyPartialBuffer。
//
// 策略：白盒（对齐 session-manager.partial-bucket.test.ts 同款 _store 注入）。

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionManager } from '../../src/interactive/session-manager.js';
import type { SessionState } from '../../src/interactive/types.js';

const SID = 'sess-shrink';
const RUN_ID = 'run-1';

/** 构造最小 SessionManager + 注入伪 SessionState（含 task-02 的 subagentDepth）。 */
function makeManager(): {
  sm: SessionManager;
  onTurnMessage: ReturnType<typeof vi.fn>;
  onTurnResult: ReturnType<typeof vi.fn>;
  state: SessionState;
} {
  const onTurnMessage = vi.fn().mockResolvedValue(undefined);
  const onTurnResult = vi.fn().mockResolvedValue(undefined);
  const sm = new SessionManager(
    {
      driver: { start: vi.fn(), consume: vi.fn(), interrupt: vi.fn() } as never,
      onTurnMessage,
      onTurnResult,
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
  return { sm, onTurnMessage, onTurnResult, state };
}

// 白盒桥接私有方法。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const priv = (sm: SessionManager): any => sm as any;

/** message_start（带 usage，喂 session 级 input token 累计）。 */
function messageStartWithInput(
  parentToolUseId: string | null,
  messageId: string,
  inputTokens: number,
): Record<string, unknown> {
  return {
    type: 'stream_event',
    parent_tool_use_id: parentToolUseId,
    uuid: `ms-${messageId}`,
    session_id: SID,
    event: {
      type: 'message_start',
      message: { id: messageId, usage: { input_tokens: inputTokens } },
    },
  };
}

/** thinking_delta（触发桶懒建 + timer）。 */
function thinkingDelta(
  parentToolUseId: string | null,
  index: number,
  text: string,
): Record<string, unknown> {
  return {
    type: 'stream_event',
    parent_tool_use_id: parentToolUseId,
    uuid: `td-${parentToolUseId ?? 'main'}-${index}`,
    session_id: SID,
    event: {
      type: 'content_block_delta',
      index,
      delta: { type: 'thinking_delta', thinking: text },
    },
  };
}

/** 主 agent assistant 含 Task tool_use（登记 subagentDepth）。 */
function mainAssistantWithTaskUse(tId: string): Record<string, unknown> {
  return {
    type: 'assistant',
    message: {
      id: 'msg-main-tool',
      role: 'assistant',
      content: [{ type: 'tool_use', id: tId, name: 'Task', input: {} }],
    },
  };
}

/** turn result（spike D4：干净 turn 边界）。 */
function turnResult(): Record<string, unknown> {
  return { type: 'result', subtype: 'success', result: 'done', is_error: false };
}

describe('turn 收尾收缩子代理桶 + subagentDepth（ql-20260825-f6#2）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('turn 完成（含子代理 tool_result 语义的消息流）后：子桶删除、depth 清空、main 保留', async () => {
    const { sm, state } = makeManager();
    const p = priv(sm);
    // 主 + 子 partial（主 50 input、子 60 input）+ depth 登记（子→1、孙→2）。
    p._onMessage(state, messageStartWithInput(null, 'm-main', 50));
    p._onMessage(state, thinkingDelta(null, 0, '主思考'));
    await p._onMessage(state, mainAssistantWithTaskUse('tool_1'));
    p._onMessage(state, messageStartWithInput('tool_1', 'm-sub', 60));
    p._onMessage(state, thinkingDelta('tool_1', 0, '子思考'));
    expect(state.subagentDepth.get('tool_1')).toBe(1);

    const sessionMap = p._partialBuffers.get(SID);
    expect(sessionMap.size).toBe(2);

    // turn result 收尾（本轮子代理已全部结束——tool_result 已含在 SDK result 边界前）。
    await p._onResult(state, turnResult());

    const after = p._partialBuffers.get(SID);
    expect(after.size).toBe(1); // 仅剩 main
    expect(after.has('main')).toBe(true);
    expect(after.has('tool_1')).toBe(false);
    // 折算：main 承接 50 + 60 = 110（预算聚合跨桶求和的语义保留）。
    expect(after.get('main').sessionInputTokens).toBe(110);
    // depth 整轮清空。
    expect(state.subagentDepth.size).toBe(0);
    // turn 边界语义保留：status→active、currentRunId 清空。
    expect(state.status).toBe('active');
    expect(state.currentRunId).toBeUndefined();
  });

  it('子桶带 live timer 时收尾：timer 被清、桶删除，late fire 不炸（_flushPartial 早退）', async () => {
    const { sm, state, onTurnMessage } = makeManager();
    const p = priv(sm);
    p._onMessage(state, thinkingDelta(null, 0, '主'));
    p._onMessage(state, thinkingDelta('tool_1', 0, '子'));
    const sessionMap = p._partialBuffers.get(SID);
    expect(sessionMap.get('tool_1').timer).not.toBeNull();

    await p._onResult(state, turnResult());
    expect(sessionMap.has('tool_1')).toBe(false);

    // timer 已被 clearTimeout：推进时钟不触发 flush（无新增 onTurnMessage 调用）。
    onTurnMessage.mockClear();
    vi.advanceTimersByTime(1000);
    expect(onTurnMessage).not.toHaveBeenCalled();
  });

  it('turn 进行中（未 result）不误删：桶与 depth 保留', async () => {
    const { sm, state } = makeManager();
    const p = priv(sm);
    p._onMessage(state, messageStartWithInput(null, 'm-main', 10));
    p._onMessage(state, thinkingDelta(null, 0, '主'));
    await p._onMessage(state, mainAssistantWithTaskUse('tool_1'));
    p._onMessage(state, messageStartWithInput('tool_1', 'm-sub', 20));
    p._onMessage(state, thinkingDelta('tool_1', 0, '子'));
    // 子代理再派生孙（depth=2）——均在 turn 进行中。
    await p._onMessage(state, {
      type: 'assistant',
      parent_tool_use_id: 'tool_1',
      message: {
        id: 'msg-sub-tool',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool_2', name: 'Task', input: {} }],
      },
    });
    p._onMessage(state, messageStartWithInput('tool_2', 'm-grand', 30));
    p._onMessage(state, thinkingDelta('tool_2', 0, '孙'));

    const sessionMap = p._partialBuffers.get(SID);
    expect(sessionMap.size).toBe(3); // main + 子 + 孙 全保留
    expect(state.subagentDepth.get('tool_2')).toBe(2);
  });

  it('折算保预算语义：main+子 累计过阈值 → _onResult 收尾仍触发 budget 软切断', async () => {
    const { sm, state, onTurnMessage } = makeManager();
    const p = priv(sm);
    // 白盒注入 budget=100；main 50 + 子 60 = 110 ≥ 100。
    p._sessionBudgetTokens.set(SID, 100);
    p._onMessage(state, messageStartWithInput(null, 'm-main', 50));
    await p._onMessage(state, mainAssistantWithTaskUse('tool_1'));
    p._onMessage(state, messageStartWithInput('tool_1', 'm-sub', 60));

    await p._onResult(state, turnResult());
    // 收缩发生在 _checkBudgetCutoff 之后且先折算 → 阈值判定不丢子代理 token。
    expect(p._overBudgetSessions.has(SID)).toBe(true);
    const budgetMsg = onTurnMessage.mock.calls
      .map((c: unknown[]) => c[2] as Record<string, unknown>)
      .find((m) => m['reason'] === 'budget_exceeded');
    expect(budgetMsg).toBeDefined();
    expect(budgetMsg?.['usage']).toEqual({ input_tokens: 110, output_tokens: 0 });
    // 收缩后 main 持有合并累计：下轮聚合不回退。
    expect(p._partialBuffers.get(SID).get('main').sessionInputTokens).toBe(110);
  });

  it('无子代理桶时收尾：仅清 depth（幂等 no-op，main 计数不动）', async () => {
    const { sm, state } = makeManager();
    const p = priv(sm);
    p._onMessage(state, messageStartWithInput(null, 'm-main', 42));
    state.subagentDepth.set('stale-tool', 1); // 模拟历史登记残留
    await p._onResult(state, turnResult());
    const sessionMap = p._partialBuffers.get(SID);
    expect(sessionMap.size).toBe(1);
    expect(sessionMap.get('main').sessionInputTokens).toBe(42);
    expect(state.subagentDepth.size).toBe(0);
  });
});
