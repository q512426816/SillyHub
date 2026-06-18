// tests/interactive/session-manager.test.ts
// task-04 Step 3：SessionManager 生命周期。
// mock ClaudeSdkDriver + mock deps（onTurnResult/onTurnMessage/onSessionEnd）。
//
// 覆盖（蓝图 §4.3 + §5）：
//   - create：建 InputQueue、push 首 msg、status=running、fire consume；重复 sessionId 抛错
//   - inject：active 时 push；ended/failed 抛 SessionNotActiveError
//   - onResult(success)：onTurnResult、status running→active、currentRunId 清空
//   - onResult(interrupt/error)：onTurnResult、status→active（仍可续轮）
//   - interrupt：active no-op false；running 调 driver.interrupt
//   - end：InputQueue.close、status=ended、onSessionEnd；幂等；迟到的 onResult 不重复
//   - fail：status=failed、onSessionEnd(failed)
//   - onMessage system/init → 写 agentSessionId 只写一次
//   - provider 非 claude → UnsupportedProviderError

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  Query,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { SessionManager } from '../../src/interactive/session-manager.js';
import { InputQueue } from '../../src/interactive/input-queue.js';
import {
  SessionNotFoundError,
  SessionAlreadyExistsError,
  SessionNotActiveError,
  UnsupportedProviderError,
} from '../../src/interactive/types.js';
import type {
  ClaudeSdkDriver,
  ConsumeCallbacks,
  StartOptions,
} from '../../src/interactive/claude-sdk-driver.js';

// ── 辅助构造 ───────────────────────────────────────────────────────────────────

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
    usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    modelUsage: {},
    permission_denials: [],
    session_id: 'sdk-sess',
    uuid: 'r1',
  } as unknown as SDKResultMessage;
}

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
    usage: { input_tokens: 1, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
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

function assistantText(t: string): SDKMessage {
  return {
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: t }] },
  } as unknown as SDKMessage;
}

/**
 * mock driver：捕获 start 的 input queue + options；提供 consume 回调手柄，
 * 让测试能注入 SDK 消息（模拟 driver consume 的 onResult/onMessage 调用）。
 */
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
      await (q.interrupt as () => Promise<void>)();
      return true;
    }),
  } as unknown as ClaudeSdkDriver;

  return {
    driver,
    fakeQuery,
    /** 模拟 driver 产出一个 result（触发 onResult）。 */
    emitResult: (r: SDKResultMessage) =>
      capturedCallbacks?.onResult(r),
    emitMessage: (m: SDKMessage) => capturedCallbacks?.onMessage?.(m),
    emitError: (e: unknown) => capturedCallbacks?.onError?.(e),
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

// ── 测试 ───────────────────────────────────────────────────────────────────────

describe('SessionManager.create', () => {
  it('建 InputQueue、push 首 msg、status=running、fire consume', async () => {
    const { driver } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });

    await sm.create(BASE_INPUT);

    expect(driver.start).toHaveBeenCalledTimes(1);
    expect(driver.consume).toHaveBeenCalledTimes(1);
    const state = sm.get('sess-1');
    expect(state).toBeDefined();
    expect(state!.status).toBe('running');
    expect(state!.currentRunId).toBe('run-1');
    expect(state!.leaseId).toBe('lease-1');
    expect(state!.cwd).toBe('C:\\work');
    expect(state!.pathToClaudeCodeExecutable).toBe('C:\\bin\\claude.exe');
  });

  it('重复 sessionId → SessionAlreadyExistsError', async () => {
    const { driver } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    await expect(sm.create(BASE_INPUT)).rejects.toThrow(
      SessionAlreadyExistsError,
    );
  });

  it('provider 非 claude → UnsupportedProviderError', async () => {
    const { driver } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await expect(
      sm.create({ ...BASE_INPUT, provider: 'codex' }),
    ).rejects.toThrow(UnsupportedProviderError);
  });

  it('start 透传 model/allowedTools 到 driver（若提供）', async () => {
    const { driver } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create({
      ...BASE_INPUT,
      model: 'glm-5.2',
      allowedTools: ['Read', 'Bash'],
    });
    const opts = (driver.start as ReturnType<typeof vi.fn>).mock.calls[0]![1];
    expect(opts.model).toBe('glm-5.2');
    expect(opts.allowedTools).toEqual(['Read', 'Bash']);
  });
});

describe('SessionManager.inject', () => {
  it('session 不存在 → SessionNotFoundError', async () => {
    const { driver } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await expect(
      sm.inject('nope', 'prompt', 'run-x'),
    ).rejects.toThrow(SessionNotFoundError);
  });

  it('active 时 push 新 msg，返回 runId', async () => {
    const { driver, emitResult } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    // 首 turn 完成（status: running → active）
    emitResult(resultSuccess('turn1'));
    expect(sm.get('sess-1')!.status).toBe('active');

    const res = await sm.inject('sess-1', 'follow up', 'run-2');
    expect(res.runId).toBe('run-2');
    expect(sm.get('sess-1')!.currentRunId).toBe('run-2');
    expect(sm.get('sess-1')!.status).toBe('running');
  });

  it('ended session → SessionNotActiveError', async () => {
    const { driver } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    await sm.end('sess-1');
    await expect(
      sm.inject('sess-1', 'x', 'run-2'),
    ).rejects.toThrow(SessionNotActiveError);
  });

  it('failed session → SessionNotActiveError', async () => {
    const { driver } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    await sm.fail('sess-1');
    await expect(
      sm.inject('sess-1', 'x', 'run-2'),
    ).rejects.toThrow(SessionNotActiveError);
  });
});

describe('SessionManager onResult（spike D4 边界）', () => {
  it('result(success) → onTurnResult(sessionId, currentRunId, result)；status running→active；currentRunId 清空', async () => {
    const { driver, emitResult } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });
    await sm.create(BASE_INPUT);

    const before = sm.get('sess-1')!.lastActiveAt;
    await new Promise((r) => setTimeout(r, 5));
    emitResult(resultSuccess('done'));

    expect(deps.onTurnResult).toHaveBeenCalledWith(
      'sess-1',
      'run-1',
      expect.objectContaining({ result: 'done' }),
    );
    expect(sm.get('sess-1')!.status).toBe('active');
    expect(sm.get('sess-1')!.currentRunId).toBeUndefined();
    expect(sm.get('sess-1')!.lastActiveAt).toBeGreaterThan(before);
  });

  it('result(error_during_execution interrupt) → onTurnResult；status→active（仍可续轮）', async () => {
    const { driver, emitResult } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });
    await sm.create(BASE_INPUT);

    emitResult(resultInterrupt());

    expect(deps.onTurnResult).toHaveBeenCalledTimes(1);
    expect(sm.get('sess-1')!.status).toBe('active');
    expect(sm.get('sess-1')!.currentRunId).toBeUndefined();
    // agentSessionId 若已写入则保留
  });

  it('session=ended 时迟到 onResult 不再调 onTurnResult（幂等）', async () => {
    const { driver, emitResult } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });
    await sm.create(BASE_INPUT);
    await sm.end('sess-1');
    deps.onTurnResult.mockClear();
    emitResult(resultSuccess('late'));
    expect(deps.onTurnResult).not.toHaveBeenCalled();
  });
});

describe('SessionManager onMessage（system/init 写 agentSessionId）', () => {
  it('system/init 消息写入 state.agentSessionId', async () => {
    const { driver, emitMessage } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });
    await sm.create(BASE_INPUT);

    emitMessage(systemInit('sdk-session-uuid'));

    expect(sm.get('sess-1')!.agentSessionId).toBe('sdk-session-uuid');
    // system/init 也应转发 onTurnMessage（让 backend 记录 init 上下文）
    expect(deps.onTurnMessage).toHaveBeenCalled();
  });

  it('agentSessionId 只写一次（后续 init 不覆盖）', async () => {
    const { driver, emitMessage } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    emitMessage(systemInit('first'));
    emitMessage(systemInit('second'));
    expect(sm.get('sess-1')!.agentSessionId).toBe('first');
  });

  it('assistant 消息只走 onTurnMessage，不写 agentSessionId', async () => {
    const { driver, emitMessage } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });
    await sm.create(BASE_INPUT);
    emitMessage(assistantText('hello'));
    expect(sm.get('sess-1')!.agentSessionId).toBeUndefined();
    expect(deps.onTurnMessage).toHaveBeenCalledWith(
      'sess-1',
      'run-1',
      expect.objectContaining({ type: 'assistant' }),
    );
  });
});

describe('SessionManager.interrupt（spike D1 turn 级）', () => {
  it('status=running → 调 driver.interrupt(query)', async () => {
    const { driver, fakeQuery } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    const ok = await sm.interrupt('sess-1');
    expect(ok).toBe(true);
    expect(driver.interrupt).toHaveBeenCalledWith(fakeQuery);
  });

  it('status=active（无 running turn）→ no-op false', async () => {
    const { driver, emitResult } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    emitResult(resultSuccess('done')); // → active
    const ok = await sm.interrupt('sess-1');
    expect(ok).toBe(false);
  });

  it('session 不存在 → no-op false（不抛）', async () => {
    const { driver } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    const ok = await sm.interrupt('nope');
    expect(ok).toBe(false);
  });
});

describe('SessionManager.end', () => {
  it('end → InputQueue.close、status=ended、onSessionEnd(ended) 调一次', async () => {
    const { driver } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });
    await sm.create(BASE_INPUT);
    await sm.end('sess-1');
    expect(sm.get('sess-1')!.status).toBe('ended');
    expect(deps.onSessionEnd).toHaveBeenCalledWith('sess-1', 'ended');
    expect(deps.onSessionEnd).toHaveBeenCalledTimes(1);
  });

  it('重复 end 幂等（不重复调 onSessionEnd）', async () => {
    const { driver } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });
    await sm.create(BASE_INPUT);
    await sm.end('sess-1');
    deps.onSessionEnd.mockClear();
    await sm.end('sess-1');
    expect(deps.onSessionEnd).not.toHaveBeenCalled();
  });

  it('session 不存在 → no-op（不抛）', async () => {
    const { driver } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await expect(sm.end('nope')).resolves.toBeUndefined();
  });
});

describe('SessionManager.fail', () => {
  it('fail → status=failed、onSessionEnd(failed)', async () => {
    const { driver } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });
    await sm.create(BASE_INPUT);
    await sm.fail('sess-1');
    expect(sm.get('sess-1')!.status).toBe('failed');
    expect(deps.onSessionEnd).toHaveBeenCalledWith('sess-1', 'failed');
  });

  it('driver onError → SessionManager.fail（spike S2 边界 2）', async () => {
    const { driver, emitError } = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver, ...deps });
    await sm.create(BASE_INPUT);
    emitError(new Error('spawn EINVAL'));
    // fail 是异步 onSessionEnd；等 microtask
    await new Promise((r) => setTimeout(r, 5));
    expect(sm.get('sess-1')!.status).toBe('failed');
    expect(deps.onSessionEnd).toHaveBeenCalledWith('sess-1', 'failed');
  });
});
