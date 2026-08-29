// tests/integration/worker-resume.test.ts
// 2026-08-29-batch-session-inherit task-06：worker 掉线→重派→claim resume
// 续会话→损伤降级 daemon 侧全链集成回归（design S3/S4；FR-03/FR-04/FR-05）。
//
// 编排方式：node 环境 + 全 fake（hub client / WS 工厂 / detector / batch
// taskRunner / claude driver），禁真实网络与 SDK——对齐 resilience-scenarios
// .test.ts 集成形态。与既有单测的分工：
//   - daemon-resume-input.test.ts（task-04）：mock SessionManager，只锁
//     claim payload → CreateSessionInput 半链；
//   - session-manager-resume-fallback.test.ts（task-05）：真 SessionManager
//     孤立验证，不进 daemon 编排；
//   - 本文件：Daemon 编排（WS TASK_AVAILABLE → claim → execPayload 归一化 →
//     _startInteractiveSession）直连**真 SessionManager + fake driver**，
//     claim payload → create 入参 → driverOpts.resume → 损伤降级一杆到底。
//
// 覆盖（design 契约表「worker claim（带 resume）」/「worker resume 失败降级」行）：
//   1. claim 含 resume_session_id → _startInteractiveSession → 真
//     SessionManager.create 收到 resume（task-04 全链）；
//   2. create 收到 resume → spec.resume → driver start opts 含 resume
//     （task-05 透传全链）+ 首轮 pendingFirstPrompt 驱动在位；
//   3. driver 抛损伤错误 → 清 resume 同参 fresh 重建（start opts 无 resume 键）
//     + resume_downgraded 日志 + 会话存活（task-05 降级全链）；
//   4. 不含 resume 的 claim（旧 backend）→ create 无 resume → 零行为变化。
//
// @module integration/worker-resume.test
//

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import type { Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { Daemon } from '../../src/daemon.js';
import { SessionManager } from '../../src/interactive/session-manager.js';
import type {
  ClaudeSdkDriver,
  ConsumeCallbacks,
  StartOptions,
} from '../../src/interactive/claude-sdk-driver.js';
import type { DaemonConfig } from '../../src/config.js';
import { MSG } from '../../src/protocol.js';
import type { WsClientCallbacks } from '../../src/ws-client.js';

// ── fixture（mockConfig/ws/detector 照 daemon-resume-input.test.ts，其对
//    _startInteractiveSession 的 cwd 守卫/exe 探测链已验证可行）──────────────

const mockConfig: DaemonConfig = {
  server_url: 'http://127.0.0.1:8000',
  token: 'test-token',
  runtime_id: 'runtime-uuid-worker-resume',
  profile: 'default',
  workspace_dir: '/tmp/ws-worker-resume',
  poll_interval: 0.02,
  heartbeat_interval: 0.02,
  max_concurrent_tasks: 5,
  log_level: 'debug',
  // cwd 守卫终检要求 rootPath 真实存在 + allowed_roots 白名单命中。
  allowed_roots: [tmpdir()],
} as unknown as DaemonConfig;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForSpy(
  spy: { mock: { calls: unknown[][] } },
  { timeout = 3000, interval = 15 }: { timeout?: number; interval?: number } = {},
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (spy.mock.calls.length > 0) return;
    await sleep(interval);
  }
  throw new Error(`waitForSpy: spy 未在 ${timeout}ms 内被调用`);
}

async function waitForCount(
  count: () => number,
  expected: number,
  { timeout = 3000, interval = 15 }: { timeout?: number; interval?: number } = {},
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (count() >= expected) return;
    await sleep(interval);
  }
  throw new Error(`waitForCount: 计数未在 ${timeout}ms 内达到 ${expected}`);
}

// ── fake hub client：claimLease 按 mockResolvedValueOnce 出 backend
//    build_claim_payload（task-03）形态的 claim payload ─────────────────────

function createMockClient() {
  return {
    register: vi.fn(async () => ({
      daemon_instance_id: 'srv-inst',
      runtimes: [{ provider: 'claude', runtime_id: 'srv-rid-1' }],
    })),
    heartbeat: vi.fn(async () => ({})),
    markOffline: vi.fn(async () => ({})),
    claimLease: vi.fn(async () => ({
      claim_token: 'token-default',
      payload: { prompt: 'hi', provider: 'claude' },
    })),
    startLease: vi.fn(async () => ({})),
    submitMessages: vi.fn(async () => ({})),
    completeLease: vi.fn(async () => ({})),
    getPendingLeases: vi.fn(async () => []),
    // poll 循环补拉源（可选方法；mock 齐全防每 tick 刷 not a function 噪音）。
    getPendingChangeWrites: vi.fn(async () => []),
    getPendingControls: vi.fn(async () => []),
    ackControls: vi.fn(async () => ({ acked: 0 })),
    getExecutionContext: vi.fn(async () => ({})),
    // create 成功后的 session ready 上报（_startInteractiveSession 尾部调用）。
    notifySessionReady: vi.fn(async () => ({})),
    // create 失败 / 守卫拒绝时的 run failed 回传（降级成功路径不应触发）。
    notifyRunResult: vi.fn(async () => ({})),
    close: vi.fn(),
  };
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

function createMockWsClient() {
  let callbacks: WsClientCallbacks = {};
  return {
    connect: vi.fn(() => {
      callbacks.onConnected?.();
    }),
    close: vi.fn(() => {
      callbacks.onDisconnected?.(1000, 'test_close');
    }),
    send: vi.fn(() => true),
    registerRpcHandler: vi.fn(),
    _injectMessage(msg: { type: string; payload: unknown }): void {
      callbacks.onMessage?.(msg as never);
    },
    _setCallbacks(cb: WsClientCallbacks): void {
      callbacks = cb;
    },
  };
}

// ── fake ClaudeSdkDriver：start 按调用序可编程抛错（照
//    session-manager-resume-fallback.test.ts），记录每次 start opts ─────────

type StartBehavior = Error | undefined;

function makeMockClaudeDriver(startBehaviors: StartBehavior[]) {
  const startCalls: Array<{ opts: StartOptions }> = [];
  const fakeQuery = { interrupt: vi.fn(async () => {}) } as unknown as Query;
  const driver = {
    start: vi.fn(
      (_input: AsyncIterable<SDKUserMessage>, opts: StartOptions): Query => {
        startCalls.push({ opts });
        const behavior = startBehaviors[startCalls.length - 1];
        if (behavior instanceof Error) throw behavior;
        return fakeQuery;
      },
    ),
    consume: vi.fn(async (_q: Query, _cb: ConsumeCallbacks): Promise<void> => {}),
    interrupt: vi.fn(async () => true),
  } as unknown as ClaudeSdkDriver;
  return { driver, startCalls };
}

// ── 编排件：Daemon + 真 SessionManager（fake claude driver 注入 deps.driver
//    兼容入口 → _drivers.claude）+ create spy（call-through 原实现）──────────

function buildWorkerResumeDaemon(opts: { startBehaviors: StartBehavior[] }) {
  const { driver, startCalls } = makeMockClaudeDriver(opts.startBehaviors);
  const sessionManager = new SessionManager({
    driver,
    onTurnResult: vi.fn(async () => {}),
    onTurnMessage: vi.fn(async () => {}),
    onSessionEnd: vi.fn(async () => {}),
  });
  const createSpy = vi.spyOn(sessionManager, 'create');

  const client = createMockClient();
  const wsClientMock = createMockWsClient();
  const wsClientFactory = vi.fn((o: { callbacks: WsClientCallbacks }) => {
    wsClientMock._setCallbacks(o.callbacks);
    return wsClientMock;
  });
  const detector = {
    detectAgents: vi.fn(async () => [
      {
        provider: 'claude',
        path: 'C:\\bin\\claude.exe',
        version: '1.0.0',
        protocol: 'stream_json',
        status: 'available' as const,
        versionWarning: null,
      },
    ]),
  };
  const daemon = new Daemon(
    mockConfig,
    client as never,
    createMockTaskRunner() as never,
    { detector, wsClientFactory, sessionManager } as never,
  );
  return { daemon, client, wsClientMock, sessionManager, createSpy, startCalls };
}

/**
 * 重派 worker 的 claim payload（backend build_claim_payload interactive 分支
 * 输出形态——snake_case 键，resume_session_id 为 task-03 白名单透传键）。
 * `sess` 为平台会话 id（agent_session_id；claim 响应是 execPayload 主源，
 * 须与 WS 注入 payload 的 agentSessionId 一致）。`over` 覆盖任意键——
 * 传 `{ resume_session_id: undefined }` 后展开剔除该键，模拟旧 backend
 * （R4 向后兼容面）。
 */
function workerClaimPayload(
  sess: string,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    kind: 'interactive',
    prompt: '继续实现登录鉴权模块',
    provider: 'claude',
    agent_session_id: sess,
    agent_run_id: `run-${sess}`,
    run_id: `run-${sess}`,
    model: 'sonnet',
    root_path: tmpdir(),
    stage: 'mission_worker',
    worker_depth: 1,
    tool_config: { mode: 'acceptEdits' },
    resume_session_id: 'sdk-resume-001',
  };
  const merged = { ...base, ...over };
  for (const [k, v] of Object.entries(merged)) {
    if (v === undefined) delete merged[k];
  }
  return merged;
}

/** 读真 SessionManager 内部 store / pendingFirstPrompt（反射口径，对齐 task-05 单测）。 */
function readInternals(sm: SessionManager, sessionId: string) {
  const store = (sm as unknown as { _store: Map<string, { status?: string }> })._store;
  const pending = (sm as unknown as {
    _pendingFirstPrompt: Map<string, unknown>;
  })._pendingFirstPrompt;
  return {
    state: store.get(sessionId),
    pendingCount: pending.has(sessionId) ? 1 : 0,
  };
}

let warnSpy: ReturnType<typeof vi.spyOn>;

/** 断言 resume_downgraded 恰好出现 expected 次（零上报断言传 0）。 */
function expectDowngradeLogs(expected: number) {
  const calls = warnSpy.mock.calls.filter(
    (c) => c[0] === '[session-manager] resume_downgraded',
  );
  expect(calls.length).toBe(expected);
  return calls;
}

describe('task-06 worker resume 全链：claim payload → daemon 编排 → 真 SessionManager → fake driver', () => {
  let daemons: Daemon[] = [];

  beforeEach(() => {
    // resume_downgraded 披露走 console.warn（D-003 最小闭环），spy 顺手静音。
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    for (const d of daemons) {
      if (d.isRunning) {
        await d.stop().catch(() => undefined);
      }
    }
    daemons = [];
    warnSpy.mockRestore();
    vi.restoreAllMocks();
  });

  function track<T extends Daemon>(d: T): T {
    daemons.push(d);
    return d;
  }

  it('claim 含 resume_session_id → _startInteractiveSession → 真 SessionManager.create 收到 resume（task-04 全链）', async () => {
    const ctx = buildWorkerResumeDaemon({ startBehaviors: [undefined] });
    track(ctx.daemon);

    await ctx.daemon.start();
    ctx.client.claimLease.mockResolvedValueOnce({
      claim_token: 'token-wr-1',
      payload: workerClaimPayload('sess-worker-1'),
    });

    ctx.wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: {
        leaseId: 'lease-wr-1',
        kind: 'interactive',
        prompt: '继续实现登录鉴权模块',
        agentSessionId: 'sess-worker-1',
        agentRunId: 'run-worker-1',
        rootPath: tmpdir(),
      },
    });
    await waitForSpy(ctx.createSpy);

    // create 恰一次；CreateSessionInput.resume = claim payload 的
    // resume_session_id（snake_case 经 execPayload 归一化区透传）。
    expect(ctx.createSpy).toHaveBeenCalledOnce();
    const createArg = ctx.createSpy.mock.calls[0]![0] as { resume?: string };
    expect(createArg.resume).toBe('sdk-resume-001');
    // daemon 编排其余必填链路照常（证明 resume 透传不是旁路达成）。
    expect(createArg.claimToken).toBe('token-wr-1');
    expect(createArg.firstPrompt).toContain('登录鉴权');
    await ctx.daemon.stop();
    daemons = [];
  });

  it('create 收到 resume → spec.resume → driver start opts 含 resume（task-05 透传全链）+ 首轮 pendingFirstPrompt 在位', async () => {
    const ctx = buildWorkerResumeDaemon({ startBehaviors: [undefined] });
    track(ctx.daemon);

    await ctx.daemon.start();
    ctx.client.claimLease.mockResolvedValueOnce({
      claim_token: 'token-wr-2',
      payload: workerClaimPayload('sess-worker-2', {
        resume_session_id: 'sdk-resume-002',
      }),
    });

    ctx.wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: {
        leaseId: 'lease-wr-2',
        kind: 'interactive',
        prompt: '继续实现登录鉴权模块',
        agentSessionId: 'sess-worker-2',
        agentRunId: 'run-worker-2',
        rootPath: tmpdir(),
      },
    });
    await waitForSpy(ctx.createSpy);
    await waitForCount(() => ctx.startCalls.length, 1);

    // 一跳直达 driver：create 的 resume 经 spec.resume 既有链进 driverOpts.resume。
    expect(ctx.startCalls.length).toBe(1);
    expect(ctx.startCalls[0]!.opts.resume).toBe('sdk-resume-002');
    // 续会话成功（无损伤）：会话存活 + 首轮由 pendingFirstPrompt 等 inject /
    // 10s fallback 驱动的机制在位（恰一条，S3 设计定论）。
    const internals = readInternals(ctx.sessionManager, 'sess-worker-2');
    expect(internals.state?.status).toBe('running');
    expect(internals.pendingCount).toBe(1);
    expectDowngradeLogs(0);
    await ctx.daemon.stop();
    daemons = [];
  });

  it('driver 抛损伤错误 → 清 resume 同参 fresh 重建 start opts 无 resume + resume_downgraded 日志 + 会话存活（task-05 降级全链）', async () => {
    const ctx = buildWorkerResumeDaemon({
      startBehaviors: [
        new Error('Session not found: sdk-resume-001'), // 首跳（带 resume）损伤
        undefined, // 降级 fresh 重建成功
      ],
    });
    track(ctx.daemon);

    await ctx.daemon.start();
    ctx.client.claimLease.mockResolvedValueOnce({
      claim_token: 'token-wr-3',
      payload: workerClaimPayload('sess-worker-3'),
    });

    ctx.wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: {
        leaseId: 'lease-wr-3',
        kind: 'interactive',
        prompt: '继续实现登录鉴权模块',
        agentSessionId: 'sess-worker-3',
        agentRunId: 'run-worker-3',
        rootPath: tmpdir(),
      },
    });
    await waitForCount(() => ctx.startCalls.length, 2);

    // 首跳带 resume 续旧会话；降级重建 start opts 无 resume 键（fresh，非
    // undefined 值残留）。
    expect(ctx.startCalls[0]!.opts.resume).toBe('sdk-resume-001');
    expect('resume' in ctx.startCalls[1]!.opts).toBe(false);
    // 披露：恰好一次 resume_downgraded，含原 resume id（D-003 最小闭环）。
    const logs = expectDowngradeLogs(1);
    expect(logs[0]![1]).toMatchObject({
      sessionId: 'sess-worker-3',
      resume: 'sdk-resume-001',
    });
    // 降级成功：会话存活（非 create 失败路径），首轮挂起恰一条（旧 timer 已清，
    // 防首句双提交）；daemon 不走 create-failed 回传（run 不误报 failed）。
    const internals = readInternals(ctx.sessionManager, 'sess-worker-3');
    expect(internals.state?.status).toBe('running');
    expect(internals.pendingCount).toBe(1);
    expect(ctx.client.notifyRunResult).not.toHaveBeenCalled();
    expect(ctx.client.notifySessionReady).toHaveBeenCalledOnce();
    await ctx.daemon.stop();
    daemons = [];
  });

  it('claim 不含 resume（旧 backend）→ create 无 resume → 零行为变化（R4 兼容全链）', async () => {
    const ctx = buildWorkerResumeDaemon({ startBehaviors: [undefined] });
    track(ctx.daemon);

    await ctx.daemon.start();
    // 旧 backend：claim payload 无 resume_session_id 键（undefined 经展开剔除）。
    ctx.client.claimLease.mockResolvedValueOnce({
      claim_token: 'token-wr-4',
      payload: workerClaimPayload('sess-worker-4', {
        resume_session_id: undefined,
      }),
    });

    ctx.wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: {
        leaseId: 'lease-wr-4',
        kind: 'interactive',
        prompt: '继续实现登录鉴权模块',
        agentSessionId: 'sess-worker-4',
        agentRunId: 'run-worker-4',
        rootPath: tmpdir(),
      },
    });
    await waitForSpy(ctx.createSpy);
    await waitForCount(() => ctx.startCalls.length, 1);

    // create 恰一次且 resume undefined；driver 一跳 start opts 无 resume 键
    // （全新会话原路径，非降级）。
    expect(ctx.createSpy).toHaveBeenCalledOnce();
    const createArg = ctx.createSpy.mock.calls[0]![0] as { resume?: string };
    expect(createArg.resume).toBeUndefined();
    expect(ctx.startCalls.length).toBe(1);
    expect('resume' in ctx.startCalls[0]!.opts).toBe(false);
    expectDowngradeLogs(0);
    // 零行为变化不是旁路：会话照常建活 + ready 上报照常。
    const internals = readInternals(ctx.sessionManager, 'sess-worker-4');
    expect(internals.state?.status).toBe('running');
    expect(ctx.client.notifySessionReady).toHaveBeenCalledOnce();
    await ctx.daemon.stop();
    daemons = [];
  });
});
