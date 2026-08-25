// tests/interactive/session-manager-terminal-notify-order.test.ts
// ql-20260825-f6#4：end 与在飞 _onResult 并发时的终态通知顺序。
//
// 修复前：_onResult 同步段先置 active/清 runId 后才 await onTurnResult；该窗口内
// end() → _terminateSession → onSessionEnd，backend 收到 run result 与 session end
// 的顺序不保证（可能 end 先到）。
// 修复后：per-session 终态通知串行链（对齐 _reloadChains 实现模式）——同会话的
// end 通知 await 在飞 turn result 之后，backend 侧恒 result → end。
//
// 另回归：end 完全先于 result 到达 → result 早退（不双发终态）；空链时 onTurnResult
// 保持同步直调时序（既有 emitResult 同步断言依赖）。

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

// ── fixtures ──────────────────────────────────────────────────────────────────

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
      input_tokens: 1,
      output_tokens: 1,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    modelUsage: {},
    permission_denials: [],
    session_id: 'sdk-sess',
    uuid: 'u1',
  } as unknown as SDKResultMessage;
}

function makeMockDriver() {
  let capturedCallbacks: ConsumeCallbacks | null = null;
  const fakeQuery = { interrupt: vi.fn(async () => {}) } as unknown as Query;
  const driver: ClaudeSdkDriver = {
    start: vi.fn(
      (_input: AsyncIterable<SDKUserMessage>, _opts: StartOptions): Query =>
        fakeQuery,
    ),
    consume: vi.fn(async (_q: Query, cb: ConsumeCallbacks): Promise<void> => {
      capturedCallbacks = cb;
    }),
    interrupt: vi.fn(async (_q: Query | null): Promise<boolean> => true),
  } as unknown as ClaudeSdkDriver;
  return {
    driver,
    emitResult: (r: SDKResultMessage) => capturedCallbacks?.onResult(r),
  };
}

const BASE_INPUT = {
  sessionId: 'sess-order',
  leaseId: 'lease-1',
  firstPrompt: 'hi',
  firstRunId: 'run-1',
  cwd: 'C:\\work',
  provider: 'claude' as const,
  pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe',
};

/** 微任务冲刷（链 fn / settle 传播各需一跳）。 */
const flushMicro = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
};

// ── 核心顺序：在飞 turn result 期间 end ───────────────────────────────────────

describe('终态通知串行链：在飞 onTurnResult 期间 end（ql-20260825-f6#4）', () => {
  it('onTurnResult 延迟 resolve 期间调 end() → backend 侧顺序恒 result → end', async () => {
    const { driver, emitResult } = makeMockDriver();
    const order: string[] = [];
    let releaseTurnResult!: () => void;
    const deps = {
      onTurnResult: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            releaseTurnResult = resolve;
          }),
      ),
      onTurnMessage: vi.fn(async (_s: string, _r: string, _m: SDKMessage) => {}),
      onSessionEnd: vi.fn(async (_s: string, _st: string) => {
        order.push('end');
      }),
    };
    const sm = new SessionManager({ driver, ...deps });
    await sm.create(BASE_INPUT);
    expect(sm.get('sess-order')!.status).toBe('running');

    // turn result 到达：onTurnResult 在飞（不 resolve）。
    emitResult(resultSuccess());
    expect(deps.onTurnResult).toHaveBeenCalledTimes(1);
    order.push('result-called');
    // status 已同步翻 active（turn 边界语义保留）。
    expect(sm.get('sess-order')!.status).toBe('active');

    // 在飞窗口内 end()：同步收口步（status=ended / queue close）立即生效，
    // 但 onSessionEnd 必须排在 turn result 之后（串行链）。
    const endPromise = sm.end('sess-order');
    expect(sm.get('sess-order')!.status).toBe('ended');
    await flushMicro();
    expect(deps.onSessionEnd).not.toHaveBeenCalled(); // 关键：等待在飞 result

    // 放行 turn result → 链推进 → end 通知发出。
    releaseTurnResult();
    await endPromise;
    expect(deps.onSessionEnd).toHaveBeenCalledTimes(1);
    expect(deps.onSessionEnd).toHaveBeenCalledWith('sess-order', 'ended');
    expect(order).toEqual(['result-called', 'end']);
  });

  it('fail() 同样串行：driver_error 路径 end 通知也在在飞 result 之后', async () => {
    const { driver, emitResult } = makeMockDriver();
    let releaseTurnResult!: () => void;
    const order: string[] = [];
    const deps = {
      onTurnResult: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            releaseTurnResult = resolve;
          }),
      ),
      onTurnMessage: vi.fn(async () => {}),
      onSessionEnd: vi.fn(async (_s: string, st: string) => {
        order.push(`end:${st}`);
      }),
    };
    const sm = new SessionManager({ driver, ...deps });
    await sm.create(BASE_INPUT);
    emitResult(resultSuccess());
    expect(deps.onTurnResult).toHaveBeenCalledTimes(1);

    const failPromise = sm.fail('sess-order');
    await flushMicro();
    expect(deps.onSessionEnd).not.toHaveBeenCalled();
    releaseTurnResult();
    await failPromise;
    expect(order).toEqual(['end:failed']);
  });
});

// ── 边界回归 ──────────────────────────────────────────────────────────────────

describe('终态通知串行链边界回归（ql-20260825-f6#4）', () => {
  it('end 完全先于 result 到达 → _onResult 早退，不出现 end 之后的 result（边界 8 幂等）', async () => {
    const { driver, emitResult } = makeMockDriver();
    const deps = {
      onTurnResult: vi.fn(async () => {}),
      onTurnMessage: vi.fn(async () => {}),
      onSessionEnd: vi.fn(async () => {}),
    };
    const sm = new SessionManager({ driver, ...deps });
    await sm.create(BASE_INPUT);
    await sm.end('sess-order');
    expect(deps.onSessionEnd).toHaveBeenCalledTimes(1);

    // 迟到的 result：session 已 ended → 早退，不双发终态。
    emitResult(resultSuccess());
    await flushMicro();
    expect(deps.onTurnResult).not.toHaveBeenCalled();
    expect(deps.onSessionEnd).toHaveBeenCalledTimes(1);
  });

  it('空链时 onTurnResult 同步直调（emitResult 后无需 await 即可见，既有时序零回归）', async () => {
    const { driver, emitResult } = makeMockDriver();
    const deps = {
      onTurnResult: vi.fn(async () => {}),
      onTurnMessage: vi.fn(async () => {}),
      onSessionEnd: vi.fn(async () => {}),
    };
    const sm = new SessionManager({ driver, ...deps });
    await sm.create(BASE_INPUT);
    emitResult(resultSuccess());
    // 同步断言（不 await）：空链直调保留改造前时序。
    expect(deps.onTurnResult).toHaveBeenCalledTimes(1);
    expect(sm.get('sess-order')!.status).toBe('active');
  });

  it('onTurnResult reject 语义保留：链不吞错，_onResult 向上抛', async () => {
    const { driver, emitResult } = makeMockDriver();
    const deps = {
      onTurnResult: vi.fn(async () => {
        throw new Error('backend down');
      }),
      onTurnMessage: vi.fn(async () => {}),
      onSessionEnd: vi.fn(async () => {}),
    };
    const sm = new SessionManager({ driver, ...deps });
    await sm.create(BASE_INPUT);
    // consume 的 onResult wrapper 是 void fire-and-forget；此处捕获防 unhandled。
    const caught = emitResult(resultSuccess());
    await expect(caught).rejects.toThrow('backend down');
    // 链自愈：后续 end 通知不被卡死（不等待已 reject 的 run）。
    await sm.end('sess-order');
    expect(deps.onSessionEnd).toHaveBeenCalledWith('sess-order', 'ended');
  });
});
