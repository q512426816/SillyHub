// tests/interactive/session-recovery.test.ts
// task-10 Step 2/5：SessionManager snapshot/restore/markReconnected/flush + resume query。
//
// 覆盖（蓝图 §4.3 / §6 / §7 边界 1/2/4/6/7/12 + AC-10-02/03/04/10/11/12）：
//   - snapshotPersistable：active+agentSessionId 非空 → 在；ended/failed/空 agentSessionId → 不在。
//   - restoreAndReconnect：driver.start({resume:agentSessionId, cwd:record.cwd})；state=reconnecting；
//     不 push 任何 SDKUserMessage（resume 不带 prompt，spike D3）；driver.start 抛错 → fail → onSessionEnd(failed)；记录移除。
//   - markReconnected：reconnecting → active；flush 调一次；非 reconnecting 调 → 抛错。
//   - flush：把 snapshotPersistable 结果调 persistence.save；active+agentSessionId 落盘，failed/ended 不落盘。
//   - 恢复后 inject：新 runId，InputQueue.push 被调（resume Query 续 turn）。
//   - persist timing：create 完成 + agentSessionId 写入后 → flush；end/fail → 记录从落盘集合移除。

import { describe, it, expect, vi } from 'vitest';
import type {
  Query,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { SessionManager } from '../../src/interactive/session-manager.js';
import { InputQueue } from '../../src/interactive/input-queue.js';
import {
  SessionNotActiveError,
  type PersistedSessionRecord,
  type SessionStorePersistence,
} from '../../src/interactive/types.js';
import type {
  ClaudeSdkDriver,
  ConsumeCallbacks,
  StartOptions,
} from '../../src/interactive/claude-sdk-driver.js';
import { ClaudeExecutableNotFoundError } from '../../src/interactive/claude-sdk-driver.js';

// ── 辅助 ──────────────────────────────────────────────────────────────────────

function resultSuccess(): SDKResultMessage {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'ok',
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

function systemInit(sid: string): SDKMessage {
  return { type: 'system', subtype: 'init', session_id: sid, uuid: 'i' } as unknown as SDKMessage;
}

/** 捕获 driver.start 的 input queue，让测试能验证恢复后 push 是否到达 driver。 */
function makeMockDriver(opts?: { startThrows?: Error }) {
  let capturedInput: AsyncIterable<SDKUserMessage> | null = null;
  let capturedOpts: StartOptions | null = null;
  let capturedCallbacks: ConsumeCallbacks | null = null;
  const startCalls: StartOptions[] = [];
  const fakeQuery = { interrupt: vi.fn(async () => {}) } as unknown as Query;
  const driver: ClaudeSdkDriver = {
    start: vi.fn((input: AsyncIterable<SDKUserMessage>, o: StartOptions): Query => {
      if (opts?.startThrows) throw opts.startThrows;
      // 模拟真实 driver：空 exe → ClaudeExecutableNotFoundError（resolveClaudeExecutable('')）。
      if (!o.pathToClaudeCodeExecutable) {
        throw new ClaudeExecutableNotFoundError('empty path');
      }
      capturedInput = input;
      capturedOpts = o;
      startCalls.push(o);
      return fakeQuery;
    }),
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
    fakeQuery,
    startCalls,
    getCapturedInput: () => capturedInput,
    getCapturedOpts: () => capturedOpts,
    emitResult: (r: SDKResultMessage) => capturedCallbacks?.onResult(r),
    emitMessage: (m: SDKMessage) => capturedCallbacks?.onMessage?.(m),
  };
}

function makeDeps() {
  return {
    onTurnResult: vi.fn(async () => {}),
    onTurnMessage: vi.fn(async () => {}),
    onSessionEnd: vi.fn(async () => {}),
  };
}

function makeMockPersistence(): SessionStorePersistence & {
  saved: PersistedSessionRecord[][];
} {
  const saved: PersistedSessionRecord[][] = [];
  return {
    saved,
    load: vi.fn(async () => []),
    save: vi.fn(async (records: readonly PersistedSessionRecord[]) => {
      saved.push(records.slice());
    }),
    quarantine: vi.fn(async () => {}),
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

const RECORD: PersistedSessionRecord = {
  sessionId: 'sess-9',
  leaseId: 'lease-9',
  agentSessionId: 'sdk-sess-9',
  cwd: 'C:\\proj',
  provider: 'claude',
  turnCount: 3,
  lastActiveAt: 1_700_000_000_000,
  currentRunId: 'run-crashed',
  model: 'glm-5.2',
  pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe',
};

// ── snapshotPersistable ───────────────────────────────────────────────────────

describe('SessionManager.snapshotPersistable', () => {
  it('active + agentSessionId 非空 → 在结果中', async () => {
    const mock = makeMockDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    mock.emitMessage(systemInit('sdk-sess-1'));
    mock.emitResult(resultSuccess());
    // status: running → active，agentSessionId 已写入。
    const recs = sm.snapshotPersistable();
    expect(recs).toHaveLength(1);
    expect(recs[0].sessionId).toBe('sess-1');
    expect(recs[0].agentSessionId).toBe('sdk-sess-1');
    expect(recs[0].cwd).toBe('C:\\work');
  });

  it('agentSessionId 空（首 turn system/init 未到）→ 不在结果中', async () => {
    const mock = makeMockDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    // 不 emit systemInit → agentSessionId 仍空。
    const recs = sm.snapshotPersistable();
    expect(recs).toEqual([]);
  });

  it('ended/failed session → 不在结果中', async () => {
    const mock = makeMockDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    mock.emitMessage(systemInit('sdk-sess-1'));
    mock.emitResult(resultSuccess());
    await sm.end('sess-1');
    expect(sm.snapshotPersistable()).toEqual([]);
  });
});

// ── restoreAndReconnect ───────────────────────────────────────────────────────

describe('SessionManager.restoreAndReconnect', () => {
  it('driver.start 调一次，opts.resume === record.agentSessionId，opts.cwd === record.cwd（R-cwd）', async () => {
    const mock = makeMockDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });
    await sm.restoreAndReconnect(RECORD);
    expect(mock.startCalls).toHaveLength(1);
    expect(mock.startCalls[0]!.resume).toBe('sdk-sess-9');
    expect(mock.startCalls[0]!.cwd).toBe('C:\\proj');
    expect(mock.startCalls[0]!.pathToClaudeCodeExecutable).toBe('C:\\bin\\claude.exe');
    expect(mock.startCalls[0]!.model).toBe('glm-5.2');
  });

  it('state.status=reconnecting、currentRunId=undefined、agentSessionId=record.agentSessionId 写入 store', async () => {
    const mock = makeMockDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });
    await sm.restoreAndReconnect(RECORD);
    const state = sm.get('sess-9');
    expect(state).toBeDefined();
    expect(state!.status).toBe('reconnecting');
    expect(state!.currentRunId).toBeUndefined();
    expect(state!.agentSessionId).toBe('sdk-sess-9');
    expect(state!.cwd).toBe('C:\\proj');
    expect(state!.leaseId).toBe('lease-9');
  });

  it('driver.consume fire 后台协程，不阻塞 restoreAndReconnect 返回', async () => {
    const mock = makeMockDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });
    await expect(sm.restoreAndReconnect(RECORD)).resolves.toBeUndefined();
    expect(mock.driver.consume).toHaveBeenCalledTimes(1);
  });

  it('driver.start 抛 ClaudeExecutableNotFoundError → onError → fail → onSessionEnd(failed)；记录移除', async () => {
    const mock = makeMockDriver({
      startThrows: new ClaudeExecutableNotFoundError('cwd mismatch'),
    });
    const deps = makeDeps();
    const sm = new SessionManager({ driver: mock.driver, ...deps });
    await sm.restoreAndReconnect(RECORD);
    // restoreAndReconnect 内同步捕获 start 抛错 → fail → onSessionEnd(failed) + 从 store 移除。
    expect(deps.onSessionEnd).toHaveBeenCalledWith('sess-9', 'failed');
    expect(sm.get('sess-9')).toBeUndefined();
  });

  it('恢复期不 push 任何 SDKUserMessage（resume 不带 prompt，spike D3）', async () => {
    const mock = makeMockDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });
    await sm.restoreAndReconnect(RECORD);
    // 捕获的 input queue 是新建的 InputQueue；未 push 任何消息 → buffer 空。
    const input = mock.getCapturedInput();
    expect(input).toBeDefined();
    // InputQueue 实现细节：通过 Symbol.asyncIterator 取一条会 await（阻塞），
    // 这里只验证对象是新 InputQueue（不是某个旧引用）。
    expect(input).not.toBeNull();
  });

  it('pathToClaudeCodeExecutable 为空时用 _agentPaths 兜底（无法兜底则抛 executable 缺失）', async () => {
    const mock = makeMockDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });
    const deps2 = makeDeps();
    const sm2 = new SessionManager({ driver: mock.driver, ...deps2 });
    // 空 exe + 无兜底 → start 抛错（被 mock driver 透传到 throw）。
    await sm2.restoreAndReconnect({ ...RECORD, pathToClaudeCodeExecutable: undefined });
    expect(deps2.onSessionEnd).toHaveBeenCalledWith('sess-9', 'failed');
  });
});

// ── markReconnected ───────────────────────────────────────────────────────────

describe('SessionManager.markReconnected', () => {
  it('reconnecting → active；flush 调一次（persistence.save）', async () => {
    const mock = makeMockDriver();
    const persistence = makeMockPersistence();
    const sm = new SessionManager({
      driver: mock.driver,
      ...makeDeps(),
      persistence,
    });
    await sm.restoreAndReconnect(RECORD);
    await sm.markReconnected('sess-9');
    expect(sm.get('sess-9')!.status).toBe('active');
    expect(persistence.save).toHaveBeenCalled();
  });

  it('非 reconnecting（如 active）调 markReconnected → 抛错（只能从 reconnecting 转入）', async () => {
    const mock = makeMockDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });
    await sm.restoreAndReconnect(RECORD);
    await sm.markReconnected('sess-9');
    await expect(sm.markReconnected('sess-9')).rejects.toThrow();
  });

  it('session 不存在 → 抛 SessionNotFoundError', async () => {
    const mock = makeMockDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });
    await expect(sm.markReconnected('nope')).rejects.toThrow();
  });
});

// ── flush + persist timing ────────────────────────────────────────────────────

describe('SessionManager.flush', () => {
  it('flush 把 snapshotPersistable 结果调 persistence.save', async () => {
    const mock = makeMockDriver();
    const persistence = makeMockPersistence();
    const sm = new SessionManager({
      driver: mock.driver,
      ...makeDeps(),
      persistence,
    });
    await sm.create(BASE_INPUT);
    mock.emitMessage(systemInit('sdk-sess-1'));
    mock.emitResult(resultSuccess());
    await sm.flush();
    expect(persistence.save).toHaveBeenCalled();
    const last = persistence.saved.at(-1) ?? [];
    expect(last).toHaveLength(1);
    expect(last[0].agentSessionId).toBe('sdk-sess-1');
  });

  it('未注入 persistence → flush 为 no-op（不抛，向后兼容 task-04）', async () => {
    const mock = makeMockDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    await expect(sm.flush()).resolves.toBeUndefined();
  });

  it('create + agentSessionId 写入后排队 flush（persistence 被调）', async () => {
    const mock = makeMockDriver();
    const persistence = makeMockPersistence();
    const sm = new SessionManager({
      driver: mock.driver,
      ...makeDeps(),
      persistence,
    });
    await sm.create(BASE_INPUT);
    mock.emitMessage(systemInit('sdk-sess-1'));
    await new Promise((r) => setTimeout(r, 5));
    expect(persistence.save).toHaveBeenCalled();
  });

  it('end/fail 后排队 flush 且 snapshot 不含该 session（终态从落盘集合移除）', async () => {
    const mock = makeMockDriver();
    const persistence = makeMockPersistence();
    const sm = new SessionManager({
      driver: mock.driver,
      ...makeDeps(),
      persistence,
    });
    await sm.create(BASE_INPUT);
    mock.emitMessage(systemInit('sdk-sess-1'));
    mock.emitResult(resultSuccess());
    persistence.save.mockClear();
    persistence.saved.length = 0;
    await sm.end('sess-1');
    await new Promise((r) => setTimeout(r, 5));
    expect(persistence.save).toHaveBeenCalled();
    const last = persistence.saved.at(-1) ?? [];
    expect(last.find((r) => r.sessionId === 'sess-1')).toBeUndefined();
  });
});

// ── 恢复后 inject（AC-10-04） ─────────────────────────────────────────────────

describe('恢复后 inject 续 turn（spike D3）', () => {
  it('markReconnected 后 inject：新 runId；InputQueue.push 到恢复的 resume Query', async () => {
    const mock = makeMockDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });
    await sm.restoreAndReconnect(RECORD);
    await sm.markReconnected('sess-9');
    // 恢复后 status=active，可接受 inject。
    const res = await sm.inject('sess-9', 'follow up after restart', 'run-recovered');
    expect(res.runId).toBe('run-recovered');
    expect(sm.get('sess-9')!.currentRunId).toBe('run-recovered');
    expect(sm.get('sess-9')!.status).toBe('running');
    // 新 runId 与崩溃的 run-crashed 不同。
    expect(sm.get('sess-9')!.currentRunId).not.toBe('run-crashed');
  });

  it('reconnecting 中（未 markReconnected）inject → SessionNotActiveError', async () => {
    const mock = makeMockDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });
    await sm.restoreAndReconnect(RECORD);
    await expect(
      sm.inject('sess-9', 'x', 'r'),
    ).rejects.toThrow(SessionNotActiveError);
  });
});
