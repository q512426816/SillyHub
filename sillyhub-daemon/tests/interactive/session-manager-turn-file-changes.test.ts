/**
 * session-manager × turn-file-changes 接线测试
 *（2026-10-20-session-page-dsh-alignment / 线 C 1b / D-023@v1 / task-09）。
 *
 * 只验接线时序与出口，不验采集算法（采集面在 turn-file-changes.test.ts 用真 git 仓
 * 覆盖）。手法：`vi.mock` 采集模块（保留其余导出真身），把
 * `collectTurnFileChanges` 换成**受控 deferred**——
 *   1. 断言 `_onResult` **不 await 采集**：终态回调先于采集完成就返回（若 await 了，
 *      `Promise.race` 会撞 300ms 超时臂而失败）；
 *   2. 断言 E1 轮首基线 / 工具调用路径累加器真的传给了采集器；
 *   3. 断言 E4 按 runId 覆盖上报 + `getTurnFileChanges` 可读；
 *   4. 断言 reporter 抛错 / 采集 reject 都不回灌轮终态链路。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';

/** 受控采集状态（vi.mock 工厂里只能引用 `vi.hoisted` 的值）。 */
const hoisted = vi.hoisted(() => {
  const calls: Record<string, unknown>[] = [];
  const pending: Array<{
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
  }> = [];
  return { calls, pending };
});

vi.mock('../../src/interactive/turn-file-changes.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/interactive/turn-file-changes.js')>();
  return {
    ...actual,
    readBaselineHead: vi.fn(async () => 'head-sha-0'),
    collectTurnFileChanges: vi.fn((input: Record<string, unknown>) => {
      hoisted.calls.push(input);
      return new Promise((resolve, reject) => {
        hoisted.pending.push({ resolve, reject });
      });
    }),
  };
});

import { SessionManager } from '../../src/interactive/session-manager.js';
import type {
  InteractiveDriverCallbacks,
  TurnMessageEnvelope,
} from '../../src/interactive/driver.js';
import type { ClaudeSdkDriver } from '../../src/interactive/claude-sdk-driver.js';
import type {
  TurnFileChangesSnapshot,
  TurnSnapshotReport,
} from '../../src/interactive/turn-file-changes-types.js';

/* ── 夹具 ────────────────────────────────────────────────────────────────── */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
    usage: { input_tokens: 1, output_tokens: 1 },
    modelUsage: {},
    permission_denials: [],
    session_id: 'sdk-sess',
    uuid: 'r1',
  } as unknown as SDKResultMessage;
}

function makeMockDriver() {
  let captured: InteractiveDriverCallbacks | null = null;
  const driver = {
    start: vi.fn(async () => ({ interrupt: vi.fn(async () => {}) })),
    consume: vi.fn(async (_handle: unknown, cb: InteractiveDriverCallbacks) => {
      captured = cb; // 不自动 yield：测试按需注入
    }),
    interrupt: vi.fn(async () => true),
  } as unknown as ClaudeSdkDriver;
  return {
    driver,
    emitResult: (r: SDKResultMessage) => captured?.onTurnResult?.(r),
    emitMessage: (m: TurnMessageEnvelope) => captured?.onTurnMessage?.(m),
  };
}

function makeDeps() {
  return {
    onTurnResult: vi.fn(async () => {}),
    onTurnMessage: vi.fn(async () => {}),
    onSessionEnd: vi.fn(async () => {}),
  };
}

const BASE_INPUT = {
  sessionId: 'sess-tfc',
  leaseId: 'lease-tfc',
  firstPrompt: 'hi',
  firstRunId: 'run-1',
  cwd: 'C:\\work',
  provider: 'claude' as const,
  pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe',
};

/** 一份形状合法的快照桩（采集器被 mock，内容不重要，形状要对）。 */
function snapshotStub(
  overrides: Partial<TurnFileChangesSnapshot> = {},
): TurnFileChangesSnapshot {
  return {
    runId: 'run-1',
    baselineHead: 'head-sha-0',
    collectedAt: new Date().toISOString(),
    collectMs: 12,
    status: 'ok',
    files: [
      {
        path: 'src/a.ts',
        status: 'modified',
        added: 3,
        deleted: 1,
        attribution: 'edit_patch',
        editToolNames: ['Edit'],
        source: 'git',
      },
    ],
    concurrentSessionsHint: true,
    ...overrides,
  };
}

async function flush(): Promise<void> {
  // 让 fire-and-forget 链（resolveBaselineHead / collect.then / report）走到位。
  await sleep(0);
  await sleep(0);
}

beforeEach(() => {
  hoisted.calls.length = 0;
  hoisted.pending.length = 0;
});

/* ── 1. 终态不被采集阻塞（E2 顺序红线）────────────────────────────────────── */

describe('session-manager × turn-file-changes：轮终态不被采集阻塞', () => {
  it('_onResult 在采集完成前就返回；采集完成后才上报（fire-and-forget）', async () => {
    const { driver, emitResult } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    const reports: TurnSnapshotReport[] = [];
    sm.setTurnSnapshotReporter((r) => {
      reports.push(r);
    });

    await sm.create(BASE_INPUT);
    await flush(); // E1 基线解析（mock：head-sha-0）

    const started = Date.now();
    // 采集被 deferred 挂住：若 _onResult await 了它，这里必然撞 300ms 超时臂。
    const winner = await Promise.race([
      (emitResult(resultSuccess('turn-1')) as Promise<void>).then(() => 'done'),
      sleep(300).then(() => 'timeout'),
    ]);
    const elapsed = Date.now() - started;

    expect(winner).toBe('done');
    expect(elapsed).toBeLessThan(300);
    // 采集已启动（fire-and-forget），但尚未完成 → 上报还没发生。
    expect(hoisted.calls).toHaveLength(1);
    expect(hoisted.pending).toHaveLength(1);
    expect(reports).toHaveLength(0);
    expect(sm.getTurnFileChanges('run-1')).toBeUndefined();

    // 采集完成 → 一次上报 + 覆盖写缓存。
    const snap = snapshotStub();
    hoisted.pending[0]!.resolve(snap);
    await flush();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ sessionId: 'sess-tfc', runId: 'run-1' });
    expect(reports[0]!.fileChanges).toEqual(snap);
    expect(sm.getTurnFileChanges('run-1')).toEqual(snap);
  });

  it('采集 reject 不影响轮终态：终态照常、无上报、无未处理拒绝', async () => {
    const { driver, emitResult } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    const reporter = vi.fn();
    sm.setTurnSnapshotReporter(reporter);

    await sm.create(BASE_INPUT);
    await flush();
    const winner = await Promise.race([
      (emitResult(resultSuccess('turn-1')) as Promise<void>).then(() => 'done'),
      sleep(300).then(() => 'timeout'),
    ]);
    expect(winner).toBe('done');
    hoisted.pending[0]!.reject(new Error('git exploded'));
    await flush();
    expect(reporter).not.toHaveBeenCalled();
    expect(sm.getTurnFileChanges('run-1')).toBeUndefined();
  });
});

/* ── 2. E1 基线 + 工具调用路径累加 ────────────────────────────────────────── */

describe('session-manager × turn-file-changes：E1 基线与工具调用路径累加', () => {
  it('轮首基线（readBaselineHead）与本轮 Edit 路径一起传给采集器', async () => {
    const { driver, emitResult, emitMessage } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    await flush();

    // 本轮工具调用：Edit 命中路径（归因来源）+ Bash 无路径键（不产生条目）
    await emitMessage({
      events: [
        { type: 'tool_use', tool_name: 'Edit', content: JSON.stringify({ file_path: 'src/a.ts' }) },
        { type: 'tool_use', tool_name: 'Bash', content: JSON.stringify({ command: 'ls' }) },
        { type: 'text', content: 'done' },
      ],
    });
    await (emitResult(resultSuccess('turn-1')) as Promise<void>);
    await flush();

    expect(hoisted.calls).toHaveLength(1);
    expect(hoisted.calls[0]).toMatchObject({
      runId: 'run-1',
      workspaceRoot: 'C:\\work',
      baselineHead: 'head-sha-0',
      toolCallPaths: [{ path: 'src/a.ts', toolName: 'Edit' }],
    });
    expect(typeof hoisted.calls[0]!['turnStartedAtMs']).toBe('number');
  });

  it('同一文件同一工具重复调用保留重复项（编辑次数口径，2026-10-22-file-changes-card-fix）', async () => {
    const { driver, emitResult, emitMessage } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    await flush();

    await emitMessage({
      events: [
        { type: 'tool_use', tool_name: 'Edit', content: JSON.stringify({ file_path: 'src/a.ts' }) },
        { type: 'tool_use', tool_name: 'Edit', content: JSON.stringify({ file_path: 'src/a.ts' }) },
      ],
    });
    await (emitResult(resultSuccess('turn-1')) as Promise<void>);
    await flush();

    expect(hoisted.calls).toHaveLength(1);
    expect(hoisted.calls[0]).toMatchObject({
      toolCallPaths: [
        { path: 'src/a.ts', toolName: 'Edit' },
        { path: 'src/a.ts', toolName: 'Edit' },
      ],
    });
  });

  it('inject 的后续轮重新记基线（runId 不同 → 各自一次采集）', async () => {
    const { driver, emitResult } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create(BASE_INPUT);
    await flush();
    await (emitResult(resultSuccess('turn-1')) as Promise<void>);

    await sm.inject('sess-tfc', 'next', 'run-2');
    await flush();
    await (emitResult(resultSuccess('turn-2')) as Promise<void>);
    await flush();

    expect(hoisted.calls.map((c) => c['runId'])).toEqual(['run-1', 'run-2']);
  });
});

/* ── 3. E4 上报：capability 语义 + 覆盖写 + reporter 容错 ─────────────────── */

describe('session-manager × turn-file-changes：上报出口', () => {
  it('unavailable 快照也上报（不静默丢弃 → backend 才能给 tool_only 降级）', async () => {
    const { driver, emitResult } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    const reports: TurnSnapshotReport[] = [];
    sm.setTurnSnapshotReporter((r) => {
      reports.push(r);
    });
    await sm.create(BASE_INPUT);
    await flush();
    await (emitResult(resultSuccess('turn-1')) as Promise<void>);
    hoisted.pending[0]!.resolve(
      snapshotStub({
        status: 'unavailable',
        reason: 'not_a_repo',
        baselineHead: null,
        files: [],
      }),
    );
    await flush();
    expect(reports).toHaveLength(1);
    expect(reports[0]!.fileChanges).toMatchObject({
      status: 'unavailable',
      reason: 'not_a_repo',
      files: [],
    });
  });

  it('reporter 同步抛错 / 未注入都不影响缓存（上报面 best-effort）', async () => {
    const { driver, emitResult } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    sm.setTurnSnapshotReporter(() => {
      throw new Error('reporter blew up');
    });
    await sm.create(BASE_INPUT);
    await flush();
    await (emitResult(resultSuccess('turn-1')) as Promise<void>);
    const snap = snapshotStub();
    hoisted.pending[0]!.resolve(snap);
    await flush();
    // 不抛穿 + 缓存仍然写入
    expect(sm.getTurnFileChanges('run-1')).toEqual(snap);

    // 未注入 reporter：再次上报只写缓存（不抛）
    const reportsBefore = hoisted.calls.length;
    sm.setTurnSnapshotReporter(null);
    await (emitResult(resultSuccess('turn-2')) as Promise<void>);
    await flush();
    expect(hoisted.calls.length).toBe(reportsBefore);
  });

  it('同一 runId 二次上报按覆盖写取最后一次（幂等语义，禁追加）', async () => {
    const { driver } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    const reports: TurnSnapshotReport[] = [];
    sm.setTurnSnapshotReporter((r) => {
      reports.push(r);
    });
    await sm.create(BASE_INPUT);
    await flush();

    const report = (status: TurnFileChangesSnapshot['status']): TurnSnapshotReport => ({
      sessionId: 'sess-tfc',
      runId: 'run-1',
      workspaceRoot: 'C:\\work',
      fileChanges: snapshotStub({ status }),
    });
    type Internals = {
      _reportTurnSnapshot(report: TurnSnapshotReport): void;
    };
    (sm as unknown as Internals)._reportTurnSnapshot(report('ok'));
    (sm as unknown as Internals)._reportTurnSnapshot(report('partial'));
    expect(reports).toHaveLength(2);
    expect(sm.getTurnFileChanges('run-1')?.status).toBe('partial'); // 后者覆盖前者
  });
});
