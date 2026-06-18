// tests/interactive/session-concurrent-inject.test.ts
// task-07 Step 2：并发 inject 排队检测（spike S1，非拒绝）。
//
// 覆盖（task-07 蓝图 §5.2 + §6 边界 2/8 + §10 AC-04/05）：
//   - status=running 时第二条 inject：push 进 InputQueue、pendingInjectCount++、onTurnQueued 回调
//   - **不抛 SessionNotActiveError**（spike S1 不拒绝）
//   - InputQueue 按 FIFO 顺序 yield（p1 → p2），第二条进 turn2
//   - 多次 result 收尾后 pendingInjectCount 归零（min 0，不下溢，边界 8）
//   - onTurnQueued 未注入 → inject 行为不变（只少一次回调），不报错

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
import { InputQueue } from '../../src/interactive/input-queue.js';

// ── fixtures ──────────────────────────────────────────────────────────────────

function resultSuccess(text: string): SDKResultMessage {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: text,
    num_turns: 1,
    duration_ms: 1,
    duration_api_ms: 1,
    stop_reason: 'end_turn',
    total_cost_usd: 0,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    modelUsage: {},
    permission_denials: [],
    session_id: 'sdk-sess',
    uuid: text,
  } as unknown as SDKResultMessage;
}

function makeMockDriver() {
  let capturedCallbacks: ConsumeCallbacks | null = null;
  const fakeQuery = { interrupt: vi.fn(async () => {}) } as unknown as Query;

  const driver: ClaudeSdkDriver = {
    start: vi.fn(
      (_input: AsyncIterable<SDKUserMessage>, _opts: StartOptions): Query => {
        return fakeQuery;
      },
    ),
    consume: vi.fn(async (_q: Query, cb: ConsumeCallbacks): Promise<void> => {
      capturedCallbacks = cb;
      // 不自动 yield；测试按需注入消息。
    }),
    interrupt: vi.fn(async (q: Query | null): Promise<boolean> => {
      if (!q) return false;
      return true;
    }),
  } as unknown as ClaudeSdkDriver;

  return {
    driver,
    fakeQuery,
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
  sessionId: 'sess-1',
  leaseId: 'lease-1',
  firstPrompt: 'hi',
  firstRunId: 'run-1',
  cwd: 'C:\\work',
  provider: 'claude' as const,
  pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe',
};

// ── AC-04：并发 inject 非拒绝 + pendingInjectCount + onTurnQueued ──────────────

describe('task-07 AC-04 并发 inject 非拒绝（spike S1）', () => {
  it('status=running 时第二条 inject：push 进 InputQueue、pendingInjectCount++、onTurnQueued 回调；不抛错', async () => {
    const { driver } = makeMockDriver();
    const deps = {
      ...makeDeps(),
      onTurnQueued: vi.fn(async (_s: string, _r: string, _pos: number) => {}),
    };
    const sm = new SessionManager({
      driver,
      ...deps,
    } as never);
    await sm.create(BASE_INPUT);
    // turn1 仍在跑（无 result）→ status=running
    expect(sm.get('sess-1')!.status).toBe('running');
    expect(sm.getPendingInjectCount('sess-1')).toBe(0);

    // 第一条 inject（turn1 在跑）：push、计数 1、回调
    await sm.inject('sess-1', 'p1', 'run-inj-1');
    expect(sm.getPendingInjectCount('sess-1')).toBe(1);
    expect(deps.onTurnQueued).toHaveBeenCalledWith('sess-1', 'run-inj-1', 1);

    // 第二条并发 inject：push、计数 2、回调
    await sm.inject('sess-1', 'p2', 'run-inj-2');
    expect(sm.getPendingInjectCount('sess-1')).toBe(2);
    expect(deps.onTurnQueued).toHaveBeenCalledWith('sess-1', 'run-inj-2', 2);
    expect(deps.onTurnQueued).toHaveBeenCalledTimes(2);

    // 关键：两次都不抛 SessionNotActiveError（status=active/running 都接受）
    expect(sm.get('sess-1')!.status).toBe('running');
  });

  it('InputQueue 按 FIFO 顺序 yield（p1 → p2），第二条排队到 turn2', async () => {
    // 用真实 InputQueue 验证 push 顺序
    const queue = new InputQueue();
    const order: string[] = [];
    const consumer = (async () => {
      for await (const msg of queue) {
        const content = (msg as SDKUserMessage).message.content;
        order.push(typeof content === 'string' ? content : 'non-string');
        if (order.length >= 2) break;
      }
    })();
    queue.push({
      type: 'user',
      message: { role: 'user', content: 'p1' },
      parent_tool_use_id: null,
    });
    queue.push({
      type: 'user',
      message: { role: 'user', content: 'p2' },
      parent_tool_use_id: null,
    });
    queue.close();
    await consumer;
    expect(order).toEqual(['p1', 'p2']);
  });

  it('onTurnQueued 未注入 → inject 行为不变（只少一次回调），不报错', async () => {
    const { driver } = makeMockDriver();
    const deps = makeDeps(); // 无 onTurnQueued
    const sm = new SessionManager({ driver, ...deps });
    await sm.create(BASE_INPUT);

    // 不抛错；pendingInjectCount 仍计数
    await sm.inject('sess-1', 'p1', 'run-inj-1');
    await sm.inject('sess-1', 'p2', 'run-inj-2');
    expect(sm.getPendingInjectCount('sess-1')).toBe(2);
    expect(sm.get('sess-1')!.status).toBe('running');
  });

  it('session 不存在 → getPendingInjectCount 返回 0（不抛）', () => {
    const { driver } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    expect(sm.getPendingInjectCount('nope')).toBe(0);
  });
});

// ── AC-05：排队计数归零（边界 8 不下溢）──────────────────────────────────────

describe('task-07 AC-05 排队计数归零（边界 8 不下溢）', () => {
  it('多条排队 inject 经多次 result 收尾后 pendingInjectCount 归零', async () => {
    const { driver, emitResult } = makeMockDriver();
    const sm = new SessionManager({
      driver,
      ...makeDeps(),
    });
    await sm.create(BASE_INPUT);
    // turn1 在跑（currentRunId=run-1, status=running）
    await sm.inject('sess-1', 'p1', 'run-inj-1'); // pending=1
    await sm.inject('sess-1', 'p2', 'run-inj-2'); // pending=2
    expect(sm.getPendingInjectCount('sess-1')).toBe(2);

    // turn1 result 收尾（currentRunId 当前是 run-inj-2，因 inject 切换；这里测的是计数递减）
    emitResult(resultSuccess('turn1'));
    expect(sm.getPendingInjectCount('sess-1')).toBe(1);

    // turn2 result 收尾
    emitResult(resultSuccess('turn2'));
    expect(sm.getPendingInjectCount('sess-1')).toBe(0);

    // 再来一条 result（无对应排队 inject）：min 0，不下溢
    emitResult(resultSuccess('turn3'));
    expect(sm.getPendingInjectCount('sess-1')).toBe(0);
  });
});
