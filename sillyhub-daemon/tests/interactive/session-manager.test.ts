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
import type { SessionState } from '../../src/interactive/types.js';
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

// ── task-12：assistant override 删 partial 端到端去重（对齐 thinking override） ─
//
// 变更 2026-07-30-daemon-heartbeat-dedup-fix task-12 / D-002@v1 / FR-02：daemon
// 端验证「assistant 完整 message 到达 → emit [ASSISTANT_OVERRIDE] <segmentId>」
// 信号，metadata 严禁 thinking:true（B2，否则被 backend thinking override 链路
// 误撤 assistant partial）。对照 thinking override（task-11 已覆盖）保持一致，
// 两者按 kind 分流不串扰。
//
// 策略对齐 session-manager.partial-dedup.test.ts：白盒直接调 SessionManager 的
// _onMessage 私有方法（经 any 桥接），spy deps.onTurnMessage 捕获所有 emit，
// 不启动真实 driver。
//
// segmentId 契约（task-05/06）：partial 端 _resolveSegmentId → `main:mid:idx`
// （parentKey='main' + messageId + content_block_delta.index），完整 message 端
// _extractCompletedSegments text block → `main:mid:i`（同结构），override 才能
// 命中。此处 text_delta 用 index=0（同 message 仅 1 个 text block），故 segmentId
// = main:<mid>:0。

describe('task-12: assistant override emit [ASSISTANT_OVERRIDE] 删 partial', () => {
  const SID_OVR = 'sess-override';
  const RUN_ID_OVR = 'run-override';

  /** 白盒夹具：构造 SessionManager + 注入伪 SessionState（绕过 create/driver）。 */
  function makeOverrideManager(): {
    sm: SessionManager;
    onTurnMessage: ReturnType<typeof vi.fn>;
    state: SessionState;
  } {
    const onTurnMessage = vi.fn().mockResolvedValue(undefined);
    const onTurnResult = vi.fn().mockResolvedValue(undefined);
    const onSessionEnd = vi.fn().mockResolvedValue(undefined);
    const sm = new SessionManager(
      {
        driver: { start: vi.fn(), consume: vi.fn(), interrupt: vi.fn() } as never,
        onTurnMessage,
        onTurnResult,
        onSessionEnd,
      },
      {},
    );
    const state: SessionState = {
      sessionId: SID_OVR,
      leaseId: 'lease-x',
      claimToken: 'claim-x',
      status: 'running',
      currentRunId: RUN_ID_OVR,
      lastActiveAt: Date.now(),
      cwd: '/tmp',
      provider: 'claude',
      pathToClaudeCodeExecutable: '/tmp/claude',
      inputQueue: { push: vi.fn(), close: vi.fn() } as never,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sm as any)._store.set(SID_OVR, state);
    return { sm, onTurnMessage, state };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const priv = (sm: SessionManager): any => sm as any;

  function msgStart(mid: string): Record<string, unknown> {
    return {
      type: 'stream_event',
      event: { type: 'message_start', message: { id: mid } },
    };
  }

  function textDelta(index: number, text: string): Record<string, unknown> {
    return {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index,
        delta: { type: 'text_delta', text },
      },
    };
  }

  /** 完整 assistant message（含一个 text block）。 */
  function completeAssistant(
    mid: string,
    text: string,
    blockIndex = 0,
  ): Record<string, unknown> {
    const content: Array<Record<string, unknown>> = [];
    content[blockIndex] = { type: 'text', text };
    for (let i = 0; i < content.length; i++) {
      if (!content[i]) content[i] = { type: 'text', text: '' };
    }
    return {
      type: 'assistant',
      message: { id: mid, role: 'assistant', content },
    };
  }

  it('完整 assistant message 到达 → emit [ASSISTANT_OVERRIDE] <segmentId>，metadata 不含 thinking:true（B2）', async () => {
    const { sm, onTurnMessage, state } = makeOverrideManager();
    const p = priv(sm);
    const MID = 'msg-asst-1';

    // 1. partial flush 一条 assistant text（segmentId = main:msg-asst-1:text，task-13修复后第 3 段为 block type）。
    p._onMessage(state, msgStart(MID));
    p._onMessage(state, textDelta(0, 'x'.repeat(90))); // >80 字符触发 flush 阈值
    await p._flushPartial(SID_OVR, 'main');
    expect(onTurnMessage).toHaveBeenCalledTimes(1);
    const partialMeta = (onTurnMessage.mock.calls[0][2].metadata ?? {}) as Record<
      string,
      unknown
    >;
    expect(partialMeta.segmentId).toBe('main:msg-asst-1:text');
    expect(partialMeta.isPartial).toBe(true);

    // 2. 完整 assistant message 到达（含同 text block 全文）。
    await p._onMessage(state, completeAssistant(MID, '完整 assistant 回复'));

    // 至少 emit 了 [ASSISTANT_OVERRIDE] main:msg-asst-1:text。
    const calls = onTurnMessage.mock.calls.map((c) => c[2]) as Array<
      Record<string, unknown>
    >;
    const override = calls.find(
      (m) =>
        typeof m.content === 'string' &&
        m.content.startsWith('[ASSISTANT_OVERRIDE]'),
    );
    expect(override, 'expected [ASSISTANT_OVERRIDE] signal').toBeDefined();
    expect(override!.content).toBe('[ASSISTANT_OVERRIDE] main:msg-asst-1:text');
    const meta = (override!.metadata ?? {}) as Record<string, unknown>;
    expect(meta.segmentId).toBe('main:msg-asst-1:text');
    expect(meta.stale).toBe(true);
    // B2 关键断言：assistant override metadata 绝不带 thinking:true。
    expect(meta.thinking).toBeUndefined();

    // 不串扰：不应 emit [THINKING_OVERRIDE]（本场景无 thinking block）。
    const thinkingOverride = calls.find(
      (m) =>
        typeof m.content === 'string' &&
        m.content.startsWith('[THINKING_OVERRIDE]'),
    );
    expect(thinkingOverride).toBeUndefined();

    // completedSegments 已记录该 segment（兜底 late partial 守卫）。
    const buf = p._partialBuffers.get(SID_OVR).get('main');
    expect(buf.completedSegments.has('main:msg-asst-1:text')).toBe(true);
  });

  it('thinking override 仍 emit [THINKING_OVERRIDE] 不串扰 assistant 信号', async () => {
    // 同 message 内含 thinking block（index=0）+ text block（index=1），
    // 分别 flush partial 后完整 message 到达，应各自 emit 对应 override。
    const { sm, onTurnMessage, state } = makeOverrideManager();
    const p = priv(sm);
    const MID = 'msg-mix';

    // partial：thinking（index=0）+ assistant text（index=1）。
    p._onMessage(state, msgStart(MID));
    p._onMessage(state, {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 't'.repeat(90) },
      },
    });
    await p._flushPartial(SID_OVR, 'main');
    p._onMessage(state, textDelta(1, 'a'.repeat(90)));
    await p._flushPartial(SID_OVR, 'main');

    // 完整 message 含两个 block（thinking index=0 + text index=1）。
    const content: Array<Record<string, unknown>> = [
      { type: 'thinking', thinking: '完整思考' },
      { type: 'text', text: '完整回复' },
    ];
    await p._onMessage(state, {
      type: 'assistant',
      message: { id: MID, role: 'assistant', content },
    });

    const calls = onTurnMessage.mock.calls.map((c) => c[2]) as Array<
      Record<string, unknown>
    >;
    const assistantOvr = calls
      .filter(
        (m) =>
          typeof m.content === 'string' &&
          m.content.startsWith('[ASSISTANT_OVERRIDE]'),
      )
      .map((m) => m.content as string);
    const thinkingOvr = calls
      .filter(
        (m) =>
          typeof m.content === 'string' &&
          m.content.startsWith('[THINKING_OVERRIDE]'),
      )
      .map((m) => m.content as string);

    // 按 kind 分流：thinking block（index=0）→ [THINKING_OVERRIDE]；
    // text block（index=1）→ [ASSISTANT_OVERRIDE]。两者 segmentId 按 block type
    // 区分（task-13修复：第 3 段用 type），各自独立，不串扰。
    expect(thinkingOvr).toContain('[THINKING_OVERRIDE] main:msg-mix:thinking');
    expect(assistantOvr).toContain('[ASSISTANT_OVERRIDE] main:msg-mix:text');

    // thinking override metadata 带 thinking:true；assistant override 不带。
    const thinkMeta = (calls.find(
      (m) => m.content === '[THINKING_OVERRIDE] main:msg-mix:thinking',
    )!.metadata ?? {}) as Record<string, unknown>;
    const asstMeta = (calls.find(
      (m) => m.content === '[ASSISTANT_OVERRIDE] main:msg-mix:text',
    )!.metadata ?? {}) as Record<string, unknown>;
    expect(thinkMeta.thinking).toBe(true);
    expect(asstMeta.thinking).toBeUndefined();
  });
});

// ── ql-20260825-002：deferred first prompt（首句双提交修复）─────────────────────

describe('SessionManager deferred first prompt（ql-20260825-002）', () => {
  /** spy 拦截 inputQueue.push（driver 未真实消费，push 是可控观测点）。 */
  function makePushSpy(sm: SessionManager, sessionId: string): string[] {
    const state = sm.get(sessionId)!;
    const pushedTexts: string[] = [];
    const orig = state.inputQueue.push.bind(state.inputQueue);
    state.inputQueue.push = ((msg: { type: 'user'; text: string }) => {
      pushedTexts.push(msg.text);
      return orig(msg);
    }) as typeof state.inputQueue.push;
    return pushedTexts;
  }

  it('create 后 firstPrompt 不入队；首条 inject 消费 pending（无双提交）', async () => {
    const { driver } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    const pushed = makePushSpy(sm, 'sess-1');

    // create 后 firstPrompt 未入队（deferred——pending 等待 SESSION_INJECT）。
    expect(pushed).toEqual([]);
    expect(sm.get('sess-1')!.currentRunId).toBe('run-1');

    // 首条 inject（权威首句）到达 → 消费 pending，只入队一次。
    await sm.inject('sess-1', '看下附件', 'run-2');
    expect(pushed).toEqual(['看下附件']);
    expect(sm.get('sess-1')!.currentRunId).toBe('run-2');
  });

  it('inject 消费后 fallback timer 已清（超时不再补发 firstPrompt）', async () => {
    vi.useFakeTimers();
    try {
      const { driver } = makeMockDriver();
      const sm = new SessionManager({ driver, ...makeDeps() });
      await sm.create(BASE_INPUT);
      const pushed = makePushSpy(sm, 'sess-1');
      await sm.inject('sess-1', '权威首句', 'run-2');
      expect(pushed).toHaveLength(1);

      // 前进超 fallback 时限：timer 已清，不补发 metadata prompt。
      await vi.advanceTimersByTimeAsync(11_000);
      expect(pushed).toHaveLength(1);
      expect(pushed[0]).toBe('权威首句');
    } finally {
      vi.useRealTimers();
    }
  });

  it('SESSION_INJECT 超时未达 → fallback 提交 metadata firstPrompt', async () => {
    vi.useFakeTimers();
    try {
      const { driver } = makeMockDriver();
      const sm = new SessionManager({ driver, ...makeDeps() });
      await sm.create(BASE_INPUT);
      const pushed = makePushSpy(sm, 'sess-1');
      expect(pushed).toEqual([]);

      await vi.advanceTimersByTimeAsync(11_000);
      expect(pushed).toEqual(['hi']); // metadata firstPrompt fallback
    } finally {
      vi.useRealTimers();
    }
  });

  it('end 清理 pending timer（终态会话不再 fallback 提交）', async () => {
    vi.useFakeTimers();
    try {
      const { driver } = makeMockDriver();
      const sm = new SessionManager({ driver, ...makeDeps() });
      await sm.create(BASE_INPUT);
      const pushed = makePushSpy(sm, 'sess-1');
      await sm.end('sess-1');

      await vi.advanceTimersByTimeAsync(11_000);
      // end 清 timer + 终态守卫双重保险：无任何 push。
      expect(pushed).toEqual([]);
      expect(sm.get('sess-1')!.status).toBe('ended');
    } finally {
      vi.useRealTimers();
    }
  });
});
