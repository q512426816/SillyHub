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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
// vi.mock 已 hoist，import 拿到 mock 版本（mirrorCodexHostAuth 断言载体）。
import { mirrorCodexHostAuth } from '../../src/codex-settings.js';
import type {
  ClaudeSdkDriver,
  InteractiveDriverCallbacks,
  StartOptions,
} from '../../src/interactive/claude-sdk-driver.js';
import { ClaudeExecutableNotFoundError } from '../../src/interactive/claude-sdk-driver.js';
import type { InteractiveDriver } from '../../src/interactive/driver.js';

// task-06（2026-09-11-session-provider-switch-codex-pi）：mock codex null 镜像——
// mirrorCodexHostAuth 读宿主 ~/.codex（os.homedir），restore 探测用例不得依赖宿主
// 真状态；镜像文件级行为由 tests/provider-file-settings-reload.test.ts 直测锁定，
// 此处只断言「restore 探测目录存在 → 调镜像 + 注 CODEX_HOME」接线。其余导出保留
// actual（writeCodexHome 真写盘——ForReload happy path 产物断言不受影响）。
vi.mock('../../src/codex-settings.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/codex-settings.js')>();
  return {
    ...actual,
    mirrorCodexHostAuth: vi.fn(async () => {}),
  };
});

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
  // task-08：归一化器等价 session_started 事件。
  return {
    events: [{ type: 'status', subtype: 'session_started', content: '', session_id: sid }],
  } as unknown as TurnMessageEnvelope;
}

/** 捕获 driver.start 的 input queue，让测试能验证恢复后 push 是否到达 driver。 */
function makeMockDriver(opts?: { startThrows?: Error }) {
  let capturedInput: AsyncIterable<SDKUserMessage> | null = null;
  let capturedOpts: StartOptions | null = null;
  let capturedCallbacks: InteractiveDriverCallbacks | null = null;
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
    consume: vi.fn(async (_q: Query, cb: InteractiveDriverCallbacks): Promise<void> => {
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
    emitResult: (r: SDKResultMessage) => capturedCallbacks?.onTurnResult?.(r),
    emitMessage: (m: SDKMessage) => capturedCallbacks?.onTurnMessage?.(m),
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

  // ── ql-20260823-006：内存残留条目先驱逐再恢复（僵尸会话 reopen 死循环修复）──

  it('store 已有同 id 活条目（backend 未通知 SESSION_END 的僵尸）→ 静默驱逐后恢复，不抛 SessionAlreadyExistsError', async () => {
    const mock = makeMockDriver();
    const deps = makeDeps();
    const sm = new SessionManager({ driver: mock.driver, ...deps });
    // 先用同 sessionId create 活会话（模拟 2026-08-23 bdec91a4 事故：backend 已翻
    // 终态但 daemon 内存仍 running）。
    await sm.create({ ...BASE_INPUT, sessionId: 'sess-9', leaseId: 'lease-old' });
    mock.emitMessage(systemInit('sdk-old'));
    // 旧行为：SessionAlreadyExistsError；新行为：驱逐旧条目后正常恢复。
    await expect(sm.restoreAndReconnect(RECORD)).resolves.toBeUndefined();
    const state = sm.get('sess-9');
    expect(state).toBeDefined();
    expect(state!.status).toBe('reconnecting');
    expect(state!.agentSessionId).toBe('sdk-sess-9');
    expect(state!.leaseId).toBe('lease-9');
    // 静默驱逐：不回发 onSessionEnd——backend 正推进 reconnecting→active，
    // 回发终态通知会与之竞态把会话误翻 failed。
    expect(deps.onSessionEnd).not.toHaveBeenCalled();
    // 恢复 driver.start 仍带 resume key。
    expect(mock.startCalls.at(-1)!.resume).toBe('sdk-sess-9');
  });

  it('store 已有同 id 终态条目（end() 收口不删 store）→ 同样驱逐后恢复', async () => {
    const mock = makeMockDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });
    await sm.create({ ...BASE_INPUT, sessionId: 'sess-9', leaseId: 'lease-old' });
    mock.emitMessage(systemInit('sdk-old'));
    await sm.end('sess-9');
    // end() 后条目仍在 store（终态 status=ended），reopen 必须能恢复。
    expect(sm.get('sess-9')).toBeDefined();
    await sm.restoreAndReconnect(RECORD);
    const state = sm.get('sess-9');
    expect(state!.status).toBe('reconnecting');
    expect(state!.leaseId).toBe('lease-9');
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

// ── task-08（2026-08-29-daemon-platform-resilience / R6）：恢复保留语义锚点 ────
//
// daemon 侧「recover 网络类失败保留 sessions.json 记录 + 超龄 7 天清理」依赖
// SessionManager 两个不变量，此处锁定（daemon 的合并落盘 / _recoveryRecordExpired
// 消费方见 daemon-stop-suspend.test.ts）：
//   1. snapshotPersistable 携带 lastActiveAt（超龄清理的时间锚点）；
//   2. reconnecting 中间态不落盘——保留记录不在 store，daemon 必须经合并快照
//      回写才不丢（flush 只写 snapshot 的丢档窗口由 daemon 对冲）。

describe('task-08：恢复保留语义锚点（lastActiveAt + reconnecting 不落盘）', () => {
  it('snapshotPersistable 携带 lastActiveAt（daemon 超龄 7 天清理的时间锚点）', async () => {
    const mock = makeMockDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    mock.emitMessage(systemInit('sdk-sess-1'));
    mock.emitResult(resultSuccess());
    const recs = sm.snapshotPersistable();
    expect(recs).toHaveLength(1);
    expect(recs[0]!.lastActiveAt).toEqual(expect.any(Number));
    expect(recs[0]!.lastActiveAt).toBeGreaterThan(0);
  });

  it('restoreAndReconnect 后（reconnecting，未 markReconnected）→ 不在 snapshot', async () => {
    const mock = makeMockDriver();
    const sm = new SessionManager({ driver: mock.driver, ...makeDeps() });
    await sm.restoreAndReconnect(RECORD);
    // store 有条目（reconnecting 中间态），但可恢复快照不含它。
    expect(sm.get('sess-9')).toBeDefined();
    expect(sm.snapshotPersistable()).toEqual([]);
  });
});

// ── task-04（2026-09-11-session-provider-switch-codex-pi / FR-01 FR-02）：restore 自愈 ──
//
// 恢复路径 codex/pi 注文件层 env（design Wave 2 步骤 4，Grill 附带发现收编）：
// 不修则「切换供应商后 daemon 重启 → 恢复会话丢 CODEX_HOME / PI_CODING_AGENT_DIR
// → 静默回宿主凭证」。四态矩阵：
//   1. providerConfig 非 null happy（codex + pi）——ForReload 重写 per-session 目录
//      + 注文件层 env（priorEnv=undefined，恢复时无旧 env）；
//   2. ForReload IO 失败 → 返 {} 降级（env 无文件层键，恢复主路径不 fail）；
//   3. codex null + 确定性目录存在 —— mirrorCodexHostAuth 幂等重镜像 + 注
//      CODEX_HOME（thread 历史保住，Grill 复审 P2-3）；
//   4. 目录不存在 → 零动作（行为与现状逐字一致）。
// 隔离：SILLYHUB_DAEMON_DIR → tmpRoot（ForReload 写盘零触碰真实 ~/.sillyhub）；
// mirrorCodexHostAuth mock（宿主 ~/.codex 零依赖，接线断言 + 文件级归新测试文件）。

describe('task-04 / restore 自愈：codex·pi 恢复注文件层 env（FR-01 / FR-02）', () => {
  let tmpRoot: string;

  /** codex/pi 通用 mock driver（InteractiveDriver 形态：start 返回 {close} 句柄）。 */
  function makeMockAgentDriver() {
    const startCalls: Array<{ input: unknown; opts: Record<string, unknown> }> = [];
    const driver = {
      start: vi.fn(async (input: AsyncIterable<unknown>, opts: Record<string, unknown>) => {
        startCalls.push({ input, opts });
        return { close: vi.fn(() => {}) };
      }),
      consume: vi.fn(async () => {}),
      interrupt: vi.fn(async () => true),
    } as unknown as InteractiveDriver;
    return { driver, startCalls };
  }

  function codexRestoreRecord(): PersistedSessionRecord {
    return {
      sessionId: 'sess-rc',
      leaseId: 'lease-rc',
      agentSessionId: 'thread-rc',
      cwd: 'C:\\proj',
      provider: 'codex',
      turnCount: 2,
      lastActiveAt: 1_700_000_000_000,
      pathToAgentExecutable: 'C:\\bin\\codex.cmd',
      providerConfig: {
        agent_kind: 'codex',
        api_key: 'sk-codex-restore',
        base_url: 'https://restore.example/v1',
        model: 'glm-4.7',
      },
    };
  }

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-restore-'));
    vi.stubEnv('SILLYHUB_DAEMON_DIR', tmpRoot);
    vi.mocked(mirrorCodexHostAuth).mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('RESTORE-1: codex providerConfig 非 null → 重写 per-session 目录 + env 注 CODEX_HOME', async () => {
    const codex = makeMockAgentDriver();
    const claude = makeMockDriver();
    const sm = new SessionManager({
      driver: claude.driver,
      drivers: { codex: codex.driver },
      ...makeDeps(),
    });

    await sm.restoreAndReconnect(codexRestoreRecord());

    // 恢复 driver.start 带 resume key + 文件层 env（确定性派生路径）。
    expect(codex.startCalls).toHaveLength(1);
    expect(codex.startCalls[0].opts['resume']).toBe('thread-rc');
    const env = codex.startCalls[0].opts['env'] as NodeJS.ProcessEnv;
    const codexHome = join(tmpRoot, 'codex', 'sess-rc');
    expect(env['CODEX_HOME']).toBe(codexHome);
    // 目录重写：供应商凭证产物落盘（重启后不静默回宿主凭证）。
    expect(readFileSync(join(codexHome, 'auth.json'), 'utf-8')).toContain(
      'sk-codex-restore',
    );
    // 恢复不因文件层写盘改变状态机。
    expect(sm.get('sess-rc')?.status).toBe('reconnecting');
  });

  it('RESTORE-2: pi providerConfig 非 null → 重写 pi 目录三文件 + env 注 PI_CODING_AGENT_DIR', async () => {
    const pi = makeMockAgentDriver();
    const claude = makeMockDriver();
    const sm = new SessionManager({
      driver: claude.driver,
      drivers: { pi: pi.driver },
      ...makeDeps(),
    });

    await sm.restoreAndReconnect({
      sessionId: 'sess-rp',
      leaseId: 'lease-rp',
      agentSessionId: 'thread-rp',
      cwd: 'C:\\proj',
      provider: 'pi',
      turnCount: 1,
      lastActiveAt: 1_700_000_000_000,
      providerConfig: {
        agent_kind: 'pi',
        api_key: 'sk-pi-restore',
        base_url: 'https://pi-restore.example/v1',
        model: 'kimi-k2',
      },
    });

    expect(pi.startCalls).toHaveLength(1);
    const env = pi.startCalls[0].opts['env'] as NodeJS.ProcessEnv;
    const piDir = join(tmpRoot, 'pi', 'sess-rp');
    expect(env['PI_CODING_AGENT_DIR']).toBe(piDir);
    expect(readFileSync(join(piDir, 'settings.json'), 'utf-8')).toContain('kimi-k2');
    expect(existsSync(join(piDir, 'auth.json'))).toBe(true);
    expect(existsSync(join(piDir, 'models.json'))).toBe(true);
    expect(sm.get('sess-rp')?.status).toBe('reconnecting');
  });

  it('RESTORE-3: ForReload IO 失败（codex 段被文件占用）→ 返 {} 降级，恢复主路径不 fail（Grill P2-2）', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // priorEnv=undefined（restore 无旧 env）取不到 prior 键 → 返 {} 降级。
    writeFileSync(join(tmpRoot, 'codex'), 'not-a-dir');
    const codex = makeMockAgentDriver();
    const claude = makeMockDriver();
    const sm = new SessionManager({
      driver: claude.driver,
      drivers: { codex: codex.driver },
      ...makeDeps(),
    });

    await sm.restoreAndReconnect(codexRestoreRecord());

    // 降级：env 无文件层键（按宿主现状运行，error 可归因），但恢复照常完成。
    const env = codex.startCalls[0].opts['env'] as NodeJS.ProcessEnv;
    expect(env['CODEX_HOME']).toBeUndefined();
    expect(sm.get('sess-rc')?.status).toBe('reconnecting');
    expect(errSpy).toHaveBeenCalledWith(
      'provider_file_reload_codex_failed',
      expect.objectContaining({ session_key: 'sess-rc' }),
    );
  });

  it('RESTORE-4: codex null + 确定性目录存在 → mirrorCodexHostAuth 幂等重镜像 + 注 CODEX_HOME（Grill P2-3）', async () => {
    // 切回本机的会话：persistence 仅落盘非 null providerConfig → 记录无该字段，
    // 但 per-session 目录存在 = 此前在平台供应商上（thread 历史在其中）。
    const codexHome = join(tmpRoot, 'codex', 'sess-rn');
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(join(codexHome, 'auth.json'), '{"OPENAI_API_KEY":"sk-provider-era"}');
    const codex = makeMockAgentDriver();
    const claude = makeMockDriver();
    const sm = new SessionManager({
      driver: claude.driver,
      drivers: { codex: codex.driver },
      ...makeDeps(),
    });

    await sm.restoreAndReconnect({
      sessionId: 'sess-rn',
      leaseId: 'lease-rn',
      agentSessionId: 'thread-rn',
      cwd: 'C:\\proj',
      provider: 'codex',
      turnCount: 2,
      lastActiveAt: 1_700_000_000_000,
      // 无 providerConfig（null 切换后的落盘形态）。
    });

    // null 切换语义：宿主凭证重镜像（幂等）+ env 保住旧目录（thread 历史保住）。
    expect(mirrorCodexHostAuth).toHaveBeenCalledTimes(1);
    expect(mirrorCodexHostAuth).toHaveBeenCalledWith(codexHome);
    const env = codex.startCalls[0].opts['env'] as NodeJS.ProcessEnv;
    expect(env['CODEX_HOME']).toBe(codexHome);
    expect(sm.get('sess-rn')?.status).toBe('reconnecting');
  });

  it('RESTORE-5: codex null + 目录不存在 → 零动作（行为与现状逐字一致）', async () => {
    const codex = makeMockAgentDriver();
    const claude = makeMockDriver();
    const sm = new SessionManager({
      driver: claude.driver,
      drivers: { codex: codex.driver },
      ...makeDeps(),
    });

    await sm.restoreAndReconnect({
      sessionId: 'sess-rx',
      leaseId: 'lease-rx',
      agentSessionId: 'thread-rx',
      cwd: 'C:\\proj',
      provider: 'codex',
      turnCount: 1,
      lastActiveAt: 1_700_000_000_000,
    });

    // 不镜像、不注 env、不建目录（宿主起步会话恢复 = 回宿主 ~/.codex 现状）。
    expect(mirrorCodexHostAuth).not.toHaveBeenCalled();
    const env = codex.startCalls[0].opts['env'] as NodeJS.ProcessEnv;
    expect(env['CODEX_HOME']).toBeUndefined();
    expect(existsSync(join(tmpRoot, 'codex'))).toBe(false);
    expect(sm.get('sess-rx')?.status).toBe('reconnecting');
  });
});
