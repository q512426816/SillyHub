// tests/interactive/session-interrupt.test.ts
// task-07 Step 1：interrupt turn 级联调（spike D1）。
//
// 覆盖（task-07 蓝图 §5.1 + §6 边界 1/13 + §10 AC-01/02/03）：
//   - status=running 时 interrupt → driver.interrupt(query) 调用一次、返回 true
//   - SDK 吐 result(subtype=error_during_execution) → _onResult 收尾：
//       onTurnResult(sessionId, runId, result) 调用一次
//       status 回 active、currentRunId 清空、agentSessionId 保留、lastActiveAt 更新
//   - 收尾后下个 inject 可续轮（不抛 SessionNotActiveError，spike D1 续轮语义）
//   - interrupt 对 status=active session → no-op 返回 false；不调 driver.interrupt（边界 1）
//   - interrupt 对不存在 session → false（边界）
//   - interrupt 时 state.query=undefined → driver.interrupt(null) 返回 false → SessionManager 返回 false（边界 13）
//   - driver.interrupt 返回 false（q null/已结束）→ SessionManager 不改 status、不调 onTurnResult（保守）

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

function resultInterrupt(): SDKResultMessage {
  return {
    type: 'result',
    subtype: 'error_during_execution',
    is_error: true,
    num_turns: 1,
    duration_ms: 1,
    duration_api_ms: 1,
    stop_reason: null,
    total_cost_usd: 0,
    usage: {
      input_tokens: 1,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    modelUsage: {},
    permission_denials: [],
    errors: ['interrupted'],
    session_id: 'sdk-sess',
    uuid: 'ri',
  } as unknown as SDKResultMessage;
}

function systemInit(sessionId: string): SDKMessage {
  return {
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    uuid: 'init',
  } as unknown as SDKMessage;
}

function makeMockDriver(opts: { interruptReturn?: boolean } = {}) {
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
    }),
    interrupt: vi.fn(async (q: Query | null): Promise<boolean> => {
      if (!q) return false;
      await (q.interrupt as () => Promise<void>)();
      return opts.interruptReturn ?? true;
    }),
  } as unknown as ClaudeSdkDriver;

  return {
    driver,
    fakeQuery,
    emitResult: (r: SDKResultMessage) => capturedCallbacks?.onResult(r),
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

// ── AC-01：interrupt turn 级完整联调 ─────────────────────────────────────────

describe('task-07 AC-01 interrupt turn 级联调（spike D1）', () => {
  it('running → interrupt → driver.interrupt 调用一次、返回 true；status 仍 running（等 result）', async () => {
    const { driver, fakeQuery } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);

    expect(sm.get('sess-1')!.status).toBe('running');
    const ok = await sm.interrupt('sess-1');
    expect(ok).toBe(true);
    expect(driver.interrupt).toHaveBeenCalledTimes(1);
    expect(driver.interrupt).toHaveBeenCalledWith(fakeQuery);
    // spike D1：interrupt 本身不改 status；等 SDK 吐 result 才收敛
    expect(sm.get('sess-1')!.status).toBe('running');
  });

  it('SDK 吐 result(error_during_execution) → onTurnResult 标 failed(interrupted)；status 回 active；currentRunId 清空；agentSessionId 保留', async () => {
    const { driver, emitResult, emitMessage } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });
    await sm.create(BASE_INPUT);
    // 模拟 SDK init 写入 agentSessionId（验证 interrupt 收尾后保留）
    emitMessage(systemInit('sdk-session-uuid'));
    expect(sm.get('sess-1')!.agentSessionId).toBe('sdk-session-uuid');

    const before = sm.get('sess-1')!.lastActiveAt;
    await new Promise((r) => setTimeout(r, 5));

    // 用户 interrupt
    await sm.interrupt('sess-1');
    // SDK 吐 interrupted result（spike D1）
    emitResult(resultInterrupt());

    // backend onTurnResult 收到 result（backend 据 is_error/subtype 标 failed(interrupted)）
    expect(deps.onTurnResult).toHaveBeenCalledTimes(1);
    expect(deps.onTurnResult).toHaveBeenCalledWith(
      'sess-1',
      'run-1',
      expect.objectContaining({
        subtype: 'error_during_execution',
        is_error: true,
      }),
    );
    // turn 收尾：status 回 active，currentRunId 清空
    expect(sm.get('sess-1')!.status).toBe('active');
    expect(sm.get('sess-1')!.currentRunId).toBeUndefined();
    // agentSessionId 保留（resume/续轮仍可用）
    expect(sm.get('sess-1')!.agentSessionId).toBe('sdk-session-uuid');
    // lastActiveAt 更新（_onResult 算活动）
    expect(sm.get('sess-1')!.lastActiveAt).toBeGreaterThan(before);
  });

  it('interrupt 收尾后下个 inject 可续轮（spike D1 续轮语义，不抛 SessionNotActiveError）', async () => {
    const { driver, emitResult } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    await sm.interrupt('sess-1');
    emitResult(resultInterrupt());
    expect(sm.get('sess-1')!.status).toBe('active');

    // 续轮 inject：不应抛 SessionNotActiveError
    const res = await sm.inject('sess-1', 'next turn after interrupt', 'run-2');
    expect(res.runId).toBe('run-2');
    expect(sm.get('sess-1')!.status).toBe('running');
    expect(sm.get('sess-1')!.currentRunId).toBe('run-2');
  });

  it('无需重新 spawn：续轮的 query 句柄仍是原 fakeQuery（同 driver.start 实例）', async () => {
    const { driver, emitResult } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    expect(driver.start).toHaveBeenCalledTimes(1);
    await sm.interrupt('sess-1');
    emitResult(resultInterrupt());
    await sm.inject('sess-1', 'follow up', 'run-2');
    // 续轮不重新 start
    expect(driver.start).toHaveBeenCalledTimes(1);
  });
});

// ── AC-02：interrupt 无 running turn（active）no-op ───────────────────────────

describe('task-07 AC-02 interrupt 无 running turn no-op', () => {
  it('status=active → interrupt 返回 false；不调 driver.interrupt；status 保持 active', async () => {
    const { driver, emitResult } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    emitResult(resultInterrupt()); // turn 收尾 → active

    const ok = await sm.interrupt('sess-1');
    expect(ok).toBe(false);
    expect(driver.interrupt).not.toHaveBeenCalled();
    expect(sm.get('sess-1')!.status).toBe('active');
  });
});

// ── AC-03：interrupt 不存在 session / query undefined ─────────────────────────

describe('task-07 AC-03 interrupt 不存在 session / query undefined', () => {
  it('interrupt 不存在 session → false（不抛）', async () => {
    const { driver } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    const ok = await sm.interrupt('nope');
    expect(ok).toBe(false);
    expect(driver.interrupt).not.toHaveBeenCalled();
  });

  it('interrupt 时 state.query=undefined → driver.interrupt(null) 返回 false → SessionManager 返回 false（边界 13）', async () => {
    const { driver } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    // 手动清空 query（模拟 driver.start 异常后 state.query 未赋值的极端情形）
    const state = sm.get('sess-1') as unknown as { query?: Query | undefined };
    state.query = undefined;

    const ok = await sm.interrupt('sess-1');
    expect(ok).toBe(false);
    expect(driver.interrupt).toHaveBeenCalledWith(null);
    // 保守：不改 status、不调 onTurnResult（不在 SessionManager 层标 failed）
    expect(sm.get('sess-1')!.status).toBe('running');
  });

  it('driver.interrupt 返回 false（q null/已结束）→ SessionManager 不改 status、不调 onTurnResult', async () => {
    const { driver } = makeMockDriver({ interruptReturn: false });
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });
    await sm.create(BASE_INPUT);

    const ok = await sm.interrupt('sess-1');
    expect(ok).toBe(false);
    expect(deps.onTurnResult).not.toHaveBeenCalled();
    // status 仍 running（保守，等真实 result）
    expect(sm.get('sess-1')!.status).toBe('running');
  });
});

// ── 边界 7：interrupt 后 SDK 未吐 result（保守不改 status）────────────────────

describe('task-07 边界 7 interrupt 后 SDK 未吐 result（异常路径）', () => {
  it('driver.interrupt 返回 true 但 SDK 迟迟不吐 result → status 仍 running（不强制改 status）', async () => {
    const { driver } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);

    await sm.interrupt('sess-1');
    // SDK 未吐 result（异常路径）：status 仍 running
    expect(sm.get('sess-1')!.status).toBe('running');
    expect(sm.get('sess-1')!.currentRunId).toBe('run-1');
  });
});
