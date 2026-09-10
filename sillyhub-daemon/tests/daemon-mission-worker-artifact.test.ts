// tests/daemon-mission-worker-artifact.test.ts
// 2026-09-10-review-dispatch-platform-fixes task-03（FR-01 / D-001@v1，design §5.1）：
// daemon.onTurnResult 对 mission_worker 分身（provider 无原生 MCP）成功轮终态
// 兜底代报 worker_done。
//
// 背景：pi/codex/cursor 的 caps.mcp===false（providers.ts PROVIDER_CAPS），物理上
// 无法经 worker_prompt 约定的 worker_done MCP 工具自报，get_worker_result 的
// artifacts 恒空；daemon 在既有 notifyRunResult 终态上报之后，用轮终 assistant
// 全文 fire-and-forget 代报 hubClient.workerDone(undefined, undefined,
// {summary: 全文}, {sessionId: 分身会话})，backend _worker_done_core 沉淀
// kind=summary artifact。
//
// 覆盖（门控矩阵 + 顺序 + 容错）：
//   - mission_worker + pi(mcp=false) + success + 全文非空 → 恰一次代报：
//     前两参 undefined、summary=全文（不截断）、opts.sessionId=分身会话 id、
//     且调用发生在 notifyRunResult 之后（顺序数组断言）
//   - 非 mission_worker（stage 缺省）→ 零调用
//   - claude(mcp=true) → 零调用（自报路径，防 _worker_done_core artifact 双写）
//   - is_error=true → 零调用
//   - result 空串 / 纯空白 / undefined / 非 string → 零调用
//   - workerDone reject（含 HubHttpError 409 形状）→ 仅 warn worker_auto_done_failed，
//     onTurnResult 正常返回不 reject
//   - client 未实现 workerDone（可选成员）→ debug 日志 + 正常返回
//   - 多轮会话：每轮成功各代报一次（backend 可重复置位取最新，daemon 无去重状态）

import { describe, it, expect, afterEach, vi } from 'vitest';
import { Daemon } from '../src/daemon.js';
import { HubHttpError } from '../src/hub-client.js';
import type { DaemonConfig } from '../src/config.js';
import type { DetectedAgent } from '../src/agent-detector.js';
import type { SessionManager } from '../src/interactive/session-manager.js';
import type { SessionState } from '../src/interactive/types.js';
import type { SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';

const mockConfig: DaemonConfig = {
  server_url: 'http://127.0.0.1:8000',
  token: 'test-token',
  runtime_id: 'runtime-uuid-123',
  profile: 'default',
  workspace_dir: '/tmp/ws',
  poll_interval: 0.02,
  heartbeat_interval: 0.02,
  max_concurrent_tasks: 5,
  log_level: 'debug',
};

/** mock client：桥接端点 + task-03 的 workerDone（可注入实现/整体省略）。 */
function createMockClient(
  workerDoneImpl?:
    | ((...args: unknown[]) => Promise<Record<string, unknown>>)
    | 'omit',
) {
  const client = {
    register: vi.fn(async () => ({ id: 'srv-rid-1' })),
    heartbeat: vi.fn(async () => ({})),
    markOffline: vi.fn(async () => ({})),
    claimLease: vi.fn(async () => ({ claim_token: 't', payload: {} })),
    startLease: vi.fn(async () => ({})),
    completeLease: vi.fn(async () => ({})),
    getPendingLeases: vi.fn(async () => []),
    getExecutionContext: vi.fn(async () => ({ agent_run_id: 'r' })),
    close: vi.fn(),
    notifyRunResult: vi.fn(async () => ({})),
    submitMessages: vi.fn(async () => ({})),
    notifySessionEnd: vi.fn(async () => ({})),
  } as Record<string, ReturnType<typeof vi.fn>>;
  if (workerDoneImpl !== 'omit') {
    client['workerDone'] = vi.fn(
      workerDoneImpl ?? (async () => ({})),
    ) as unknown as ReturnType<typeof vi.fn>;
  }
  return client;
}

function createMockTaskRunner() {
  return {
    runLease: vi.fn(async () => ({
      success: true,
      exitCode: 0,
      status: 'completed',
      patch: '',
      filesChanged: 0,
      insertions: 0,
      deletions: 0,
      output: 'ok',
      error: '',
      durationMs: 10,
      sessionId: '',
      metadata: {},
    })),
  };
}

/**
 * mock SessionManager：get 返回注入 state（形态对齐 daemon-interactive-bridge
 * 测试）。state.provider / state.stage 是 task-03 门控输入。
 */
function createMockSessionManager(state?: Partial<SessionState>): SessionManager {
  const fullState: SessionState | undefined = state
    ? ({
        sessionId: 'sess-mw-1',
        leaseId: 'lease-mw-1',
        claimToken: 'claim-token-mw-1',
        currentRunId: 'run-mw-1',
        status: 'running',
        lastActiveAt: Date.now(),
        cwd: '/tmp',
        provider: 'pi',
        pathToClaudeCodeExecutable: '/bin/pi',
        inputQueue: { push() {}, close() {} } as never,
        ...state,
      } as SessionState)
    : undefined;
  return {
    create: vi.fn(async () => {}),
    inject: vi.fn(async () => ({ runId: '' })),
    interrupt: vi.fn(async () => false),
    end: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    get: vi.fn((() => fullState) as never),
    start: vi.fn(() => {}),
    stop: vi.fn(() => {}),
    manualApproval: false,
    getPermissionResolver: vi.fn(() => undefined),
    getPendingInjectCount: vi.fn(() => 0),
    getIdleTimeoutSec: vi.fn(() => 1800),
    restoreAndReconnect: vi.fn(async () => {}),
    markReconnected: vi.fn(async () => {}),
    flush: vi.fn(async () => {}),
    snapshotPersistable: vi.fn(() => []),
    scanOnce: vi.fn(async () => {}),
  } as unknown as SessionManager;
}

interface Harness {
  daemon: Daemon;
  client: Record<string, ReturnType<typeof vi.fn>>;
  order: string[];
}

/** 组装 Daemon + order 数组（notifyRunResult / workerDone 调用时各 push 一条）。 */
function buildHarness(
  state?: Partial<SessionState>,
  workerDoneImpl?:
    | ((...args: unknown[]) => Promise<Record<string, unknown>>)
    | 'omit',
): Harness {
  const client = createMockClient(workerDoneImpl);
  const order: string[] = [];
  const workerDoneImplFn = workerDoneImpl ?? (async () => ({}));
  client['notifyRunResult'].mockImplementation(async () => {
    order.push('notifyRunResult');
    return {};
  });
  // 包一层记录顺序，不覆盖注入的 reject 实现（容错用例依赖原始 impl 抛错）。
  client['workerDone']?.mockImplementation(async (...args: unknown[]) => {
    order.push('workerDone');
    return workerDoneImplFn(...args);
  });
  const daemon = new Daemon(
    mockConfig,
    client as never,
    createMockTaskRunner() as never,
    {
      sessionManager: createMockSessionManager(state),
      detector: {
        detectAgents: vi.fn(async () => [] as DetectedAgent[]),
      },
    },
  );
  return { daemon, client, order };
}

/** 冲掉 fire-and-forget 的 .catch 微任务（warn 断言前必须 flush）。 */
const flushMicrotasks = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/** 静音 daemon createLogger 的 console 输出；返回 warn/log 两个 spy 供断言。 */
function spyConsole(): {
  warn: ReturnType<typeof vi.spyOn>;
  log: ReturnType<typeof vi.spyOn>;
  restore: () => void;
} {
  const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  return {
    warn,
    log,
    restore: () => {
      info.mockRestore();
      error.mockRestore();
      warn.mockRestore();
      log.mockRestore();
    },
  };
}

/** mission_worker + pi 成功轮 result（>500 字全文，区别于 result_summary 的 500 截断）。 */
const FULL_TEXT = `轮终结论：任务完成。${'详细产出内容。'.repeat(80)}`;
const successResult = (result: unknown): SDKResultMessage =>
  ({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result,
  }) as unknown as SDKResultMessage;

describe('task-03：onTurnResult mission_worker 兜底代报 worker_done', () => {
  let daemons: Daemon[] = [];
  const consoles: ReturnType<typeof spyConsole>[] = [];

  afterEach(async () => {
    for (const d of daemons) {
      if (d.isRunning) {
        await d.stop().catch(() => undefined);
      }
    }
    daemons = [];
    for (const c of consoles) c.restore();
    consoles.length = 0;
  });

  function track(spies: ReturnType<typeof spyConsole>): ReturnType<typeof spyConsole> {
    consoles.push(spies);
    return spies;
  }

  it('mission_worker + pi(mcp=false) + success + 全文非空 → 恰一次代报（参数=全文+sessionId，顺序在 notifyRunResult 之后）', async () => {
    track(spyConsole());
    const { daemon, client, order } = buildHarness({
      stage: 'mission_worker',
      provider: 'pi',
    });
    daemons.push(daemon);

    await daemon.onTurnResult('sess-mw-1', 'run-mw-1', successResult(FULL_TEXT));
    await flushMicrotasks();

    // 恰一次；前两参 undefined（backend 沿 X-Session-Id 爬 parent 链解析）；
    // summary=轮终全文（不截断——520 字全文，result_summary 才有 500 截断）；
    // opts.sessionId=分身会话 id。
    expect(client['workerDone']).toHaveBeenCalledTimes(1);
    expect(client['workerDone']).toHaveBeenCalledWith(
      undefined,
      undefined,
      { summary: FULL_TEXT },
      { sessionId: 'sess-mw-1' },
    );
    const summary = (client['workerDone'].mock.calls[0]![2] as { summary: string })
      .summary;
    expect(summary.length).toBeGreaterThan(500);
    expect(summary).toBe(FULL_TEXT);

    // Grill B-02：终态先落库（notifyRunResult）、唤醒随后（workerDone）。
    expect(order).toEqual(['notifyRunResult', 'workerDone']);
    // 既有终态上报链不受影响（仍恰一次）。
    expect(client['notifyRunResult']).toHaveBeenCalledTimes(1);
  });

  it('非 mission_worker（stage 缺省，普通/主控会话）→ 零代报', async () => {
    track(spyConsole());
    const { daemon, client } = buildHarness({ provider: 'pi' }); // 无 stage
    daemons.push(daemon);

    await daemon.onTurnResult('sess-mw-1', 'run-mw-1', successResult(FULL_TEXT));
    await flushMicrotasks();

    expect(client['workerDone']).not.toHaveBeenCalled();
    expect(client['notifyRunResult']).toHaveBeenCalledTimes(1);
  });

  it('claude（mcp=true，worker_prompt 自报路径）→ 零代报（防 _worker_done_core artifact 双写）', async () => {
    track(spyConsole());
    const { daemon, client } = buildHarness({
      stage: 'mission_worker',
      provider: 'claude',
    });
    daemons.push(daemon);

    await daemon.onTurnResult('sess-mw-1', 'run-mw-1', successResult(FULL_TEXT));
    await flushMicrotasks();

    expect(client['workerDone']).not.toHaveBeenCalled();
  });

  it('is_error=true → 零代报', async () => {
    track(spyConsole());
    const { daemon, client } = buildHarness({
      stage: 'mission_worker',
      provider: 'pi',
    });
    daemons.push(daemon);

    const result = {
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      result: FULL_TEXT,
    } as unknown as SDKResultMessage;
    await daemon.onTurnResult('sess-mw-1', 'run-mw-1', result);
    await flushMicrotasks();

    expect(client['workerDone']).not.toHaveBeenCalled();
    expect(client['notifyRunResult']).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['空串', ''],
    ['纯空白', '   \n\t '],
    ['undefined', undefined],
    ['非 string（object）', { text: '不是纯文本' }],
  ])('result=%s → 零代报', async (_label, badResult) => {
    track(spyConsole());
    const { daemon, client } = buildHarness({
      stage: 'mission_worker',
      provider: 'pi',
    });
    daemons.push(daemon);

    await daemon.onTurnResult('sess-mw-1', 'run-mw-1', successResult(badResult));
    await flushMicrotasks();

    expect(client['workerDone']).not.toHaveBeenCalled();
  });

  it('workerDone reject HubHttpError(409 迟到收敛) → 仅 warn worker_auto_done_failed，onTurnResult 不 reject', async () => {
    const spies = track(spyConsole());
    const { daemon, client } = buildHarness(
      { stage: 'mission_worker', provider: 'pi' },
      async () => {
        throw new HubHttpError(
          409,
          '{"detail":"mission already converged"}',
          'http://127.0.0.1:8000/api/missions/x/workers/y/worker_done',
          'POST',
        );
      },
    );
    daemons.push(daemon);

    await expect(
      daemon.onTurnResult('sess-mw-1', 'run-mw-1', successResult(FULL_TEXT)),
    ).resolves.toBeUndefined();
    await flushMicrotasks();

    expect(client['workerDone']).toHaveBeenCalledTimes(1);
    expect(spies.warn).toHaveBeenCalled();
    const warnArgs = spies.warn.mock.calls.find((c) =>
      String(c[0]).includes('worker_auto_done_failed'),
    );
    expect(warnArgs).toBeDefined();
    // 结构化日志：事件名蛇形 + session_id 记录（error 文本含 HTTP 409）。
    expect(String(warnArgs![1])).toContain('session_id=sess-mw-1');
    expect(
      spies.warn.mock.calls
        .map((c) => c.join(' '))
        .join('\n'),
    ).toContain('409');
  });

  it('workerDone reject 普通网络错误 → 同样仅 warn 收敛不 reject', async () => {
    const spies = track(spyConsole());
    const { daemon } = buildHarness(
      { stage: 'mission_worker', provider: 'pi' },
      async () => {
        throw new Error('fetch failed: ECONNREFUSED');
      },
    );
    daemons.push(daemon);

    await expect(
      daemon.onTurnResult('sess-mw-1', 'run-mw-1', successResult(FULL_TEXT)),
    ).resolves.toBeUndefined();
    await flushMicrotasks();

    expect(
      spies.warn.mock.calls.some((c) => String(c[0]).includes('worker_auto_done_failed')),
    ).toBe(true);
  });

  it('client 未实现 workerDone（可选成员）→ debug 日志 + onTurnResult 正常返回', async () => {
    const spies = track(spyConsole());
    const { daemon, client } = buildHarness(
      { stage: 'mission_worker', provider: 'pi' },
      'omit',
    );
    daemons.push(daemon);

    await expect(
      daemon.onTurnResult('sess-mw-1', 'run-mw-1', successResult(FULL_TEXT)),
    ).resolves.toBeUndefined();
    await flushMicrotasks();

    expect(client['workerDone']).toBeUndefined();
    expect(client['notifyRunResult']).toHaveBeenCalledTimes(1);
    // debug 级（createLogger debug → console.log），不 warn 不 error。
    expect(
      spies.log.mock.calls.some((c) =>
        String(c[0]).includes('worker_auto_done_unavailable'),
      ),
    ).toBe(true);
    expect(
      spies.warn.mock.calls.some((c) =>
        String(c[0]).includes('worker_auto_done'),
      ),
    ).toBe(false);
  });

  it('多轮会话：每轮成功各代报一次，参数取各自轮终全文（无去重状态）', async () => {
    track(spyConsole());
    const { daemon, client } = buildHarness({
      stage: 'mission_worker',
      provider: 'pi',
    });
    daemons.push(daemon);

    const round1 = '第一轮结论：调研完成，产出 A 方案。';
    const round2 = '第二轮结论：按 A 方案完成实现并自测通过。';
    await daemon.onTurnResult('sess-mw-1', 'run-mw-1', successResult(round1));
    await daemon.onTurnResult('sess-mw-1', 'run-mw-2', successResult(round2));
    await flushMicrotasks();

    expect(client['workerDone']).toHaveBeenCalledTimes(2);
    expect(client['workerDone']).toHaveBeenNthCalledWith(
      1,
      undefined,
      undefined,
      { summary: round1 },
      { sessionId: 'sess-mw-1' },
    );
    expect(client['workerDone']).toHaveBeenNthCalledWith(
      2,
      undefined,
      undefined,
      { summary: round2 },
      { sessionId: 'sess-mw-1' },
    );
  });
});
