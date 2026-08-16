// tests/daemon-budget-wiring.test.ts
// task-08 / RS-4 接线验证：daemon `_runLeaseStateMachine` 把 claim payload 的
// budget_tokens（context.py task-07 双写 snake + camel）真正透传到：
//   1. execPayload.budget_tokens（rawExec snake/camel 归一化）
//   2. interactive → SessionManager.create({...,budget_tokens})
//   3. batch → ctx.budget_tokens（task-runner.runLease 读）
//
// 模式照搬 daemon-kind-dispatch.test.ts 的 task-10 profile 字段透传用例
//（lines 757-927）。helper 自包含复制，避免改既有测试文件（task-08 allowed_paths
// = daemon.ts + 可选新测试）。
//
// 配合 tests/task-runner-budget.test.ts + tests/interactive/session-manager-budget.test.ts
// （证明检查点逻辑本身正确），这三组一起证明：claim payload 携带 budget_tokens →
// daemon 透传 → task-runner/session-manager 检查点真正生效（feature 不再 dormant）。

import { describe, it, expect, afterEach, vi } from 'vitest';
import { Daemon } from '../src/daemon.js';
import type { DaemonConfig } from '../src/config.js';
import { MSG } from '../src/protocol.js';
import type { DetectedAgent } from '../src/agent-detector.js';
import type { WsClientCallbacks } from '../src/ws-client.js';
import type { SessionManager } from '../src/interactive/session-manager.js';
import type { SessionState } from '../src/interactive/types.js';

// ── fixture（对齐 daemon-kind-dispatch.test.ts）─────────────────────────────────

const mockConfig: DaemonConfig = {
  server_url: 'http://127.0.0.1:8000',
  token: 'test-token',
  runtime_id: 'runtime-uuid-budget',
  profile: 'default',
  workspace_dir: '/tmp/ws-budget',
  poll_interval: 0.02,
  heartbeat_interval: 0.02,
  max_concurrent_tasks: 5,
  log_level: 'debug',
};

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
  throw new Error(
    `waitForSpy: spy 未在 ${timeout}ms 内被调用`,
  );
}

interface MockClient {
  register: ReturnType<typeof vi.fn>;
  heartbeat: ReturnType<typeof vi.fn>;
  markOffline: ReturnType<typeof vi.fn>;
  claimLease: ReturnType<typeof vi.fn>;
  startLease: ReturnType<typeof vi.fn>;
  submitMessages: ReturnType<typeof vi.fn>;
  completeLease: ReturnType<typeof vi.fn>;
  getPendingLeases: ReturnType<typeof vi.fn>;
  getExecutionContext: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

function createMockClient(): MockClient {
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
    getExecutionContext: vi.fn(async () => ({
      agent_run_id: 'run-default',
      claude_md: '',
    })),
    close: vi.fn(),
  };
}

interface MockTaskRunner {
  runLease: ReturnType<typeof vi.fn>;
}

function createMockTaskRunner(): MockTaskRunner {
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

function createMockSessionManager(
  stateMap = new Map<string, Partial<SessionState>>(),
): SessionManager {
  const sm = {
    create: vi.fn(async () => {}),
    inject: vi.fn(async () => ({ runId: '' })),
    interrupt: vi.fn(async () => false),
    end: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    get: vi.fn((sid: string) => stateMap.get(sid) as Readonly<SessionState> | undefined),
  };
  return sm as unknown as SessionManager;
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

function buildDaemon(opts: {
  client?: MockClient;
  taskRunner?: MockTaskRunner | null;
  sessionManager?: SessionManager | null;
  agentPath?: string;
}) {
  const client = opts.client ?? createMockClient();
  const taskRunner =
    opts.taskRunner === undefined ? createMockTaskRunner() : opts.taskRunner;
  const sessionManager =
    opts.sessionManager === undefined
      ? createMockSessionManager()
      : opts.sessionManager;
  const agentPath = opts.agentPath ?? 'C:\\bin\\claude.exe';

  const detector = {
    detectAgents: vi.fn(async () => [
      {
        provider: 'claude',
        path: agentPath,
        version: '1.0.0',
        protocol: 'stream_json',
        status: 'available' as const,
        versionWarning: null,
      },
    ]),
  };

  const wsClientMock = createMockWsClient();
  const wsClientFactory = vi.fn((o: { callbacks: WsClientCallbacks }) => {
    wsClientMock._setCallbacks(o.callbacks);
    return wsClientMock;
  });

  const ctorOpts: Record<string, unknown> = {
    detector,
    wsClientFactory,
  };
  if (opts.sessionManager !== undefined) {
    ctorOpts.sessionManager = sessionManager;
  }

  const daemon = new Daemon(
    mockConfig,
    client as never,
    taskRunner as never,
    ctorOpts as never,
  );

  return { daemon, client, taskRunner, sessionManager, wsClientMock };
}

// ── 测试 ──────────────────────────────────────────────────────────────────────

describe('task-08 / RS-4：budget_tokens claim payload → daemon 透传', () => {
  let daemons: Daemon[] = [];

  afterEach(async () => {
    for (const d of daemons) {
      if (d.isRunning) {
        await d.stop().catch(() => undefined);
      }
    }
    daemons = [];
  });

  function track<T extends Daemon>(d: T): T {
    daemons.push(d);
    return d;
  }

  it('interactive: claim payload snake_case budget_tokens → CreateSessionInput.budget_tokens', async () => {
    const sessionManager = createMockSessionManager();
    const { daemon, client, wsClientMock } = buildDaemon({ sessionManager });
    track(daemon);

    await daemon.start();
    client.claimLease.mockResolvedValueOnce({
      claim_token: 'token-bgt',
      payload: {
        kind: 'interactive',
        prompt: 'hi',
        provider: 'claude',
        agent_session_id: 'sess-bgt',
        agent_run_id: 'run-bgt',
        root_path: 'C:\\work',
        // context.py task-07 双写 snake_case（优先源，与 types.ts LeaseCtx.budget_tokens 一致）
        budget_tokens: 5000,
      },
    });

    wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: {
        leaseId: 'lease-bgt',
        kind: 'interactive',
        prompt: 'hi',
        agentSessionId: 'sess-bgt',
        agentRunId: 'run-bgt',
        rootPath: 'C:\\work',
      },
    });
    await waitForSpy(sessionManager.create as unknown as { mock: { calls: unknown[][] } });

    expect(sessionManager.create).toHaveBeenCalledOnce();
    const createArg = (sessionManager.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(createArg.budget_tokens).toBe(5000);
    await daemon.stop();
  });

  it('interactive: claim payload camelCase budgetTokens → CreateSessionInput.budget_tokens（camel 兜底）', async () => {
    const sessionManager = createMockSessionManager();
    const { daemon, client, wsClientMock } = buildDaemon({ sessionManager });
    track(daemon);

    await daemon.start();
    client.claimLease.mockResolvedValueOnce({
      claim_token: 'token-bgt2',
      payload: {
        kind: 'interactive',
        prompt: 'hi',
        provider: 'claude',
        agent_session_id: 'sess-bgt2',
        agent_run_id: 'run-bgt2',
        root_path: 'C:\\work',
        // 仅 camelCase（兼容双写的 camel 兜底分支）
        budgetTokens: 1234,
      },
    });

    wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: {
        leaseId: 'lease-bgt2',
        kind: 'interactive',
        prompt: 'hi',
        agentSessionId: 'sess-bgt2',
        agentRunId: 'run-bgt2',
        rootPath: 'C:\\work',
      },
    });
    await waitForSpy(sessionManager.create as unknown as { mock: { calls: unknown[][] } });

    const createArg = (sessionManager.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(createArg.budget_tokens).toBe(1234);
    await daemon.stop();
  });

  it('interactive: claim 无 budget_tokens → CreateSessionInput.budget_tokens undefined（FR-07 零回归）', async () => {
    const sessionManager = createMockSessionManager();
    const { daemon, client, wsClientMock } = buildDaemon({ sessionManager });
    track(daemon);

    await daemon.start();
    client.claimLease.mockResolvedValueOnce({
      claim_token: 'token-bgt3',
      payload: {
        kind: 'interactive',
        prompt: 'hi',
        provider: 'claude',
        agent_session_id: 'sess-bgt3',
        agent_run_id: 'run-bgt3',
        root_path: 'C:\\work',
        // 无 budget_tokens / budgetTokens
      },
    });

    wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: {
        leaseId: 'lease-bgt3',
        kind: 'interactive',
        prompt: 'hi',
        agentSessionId: 'sess-bgt3',
        agentRunId: 'run-bgt3',
        rootPath: 'C:\\work',
      },
    });
    await waitForSpy(sessionManager.create as unknown as { mock: { calls: unknown[][] } });

    const createArg = (sessionManager.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(createArg.budget_tokens).toBeUndefined();
    await daemon.stop();
  });

  it('batch: claim payload snake_case budget_tokens → ctx.budget_tokens（runLease 读）', async () => {
    const sessionManager = createMockSessionManager();
    const taskRunner = createMockTaskRunner();
    const { daemon, client, taskRunner: trRef, wsClientMock } = buildDaemon({
      sessionManager,
      taskRunner,
    });
    track(daemon);

    await daemon.start();
    client.claimLease.mockResolvedValueOnce({
      claim_token: 'token-bgtbatch',
      payload: {
        kind: 'batch',
        prompt: 'do',
        provider: 'claude',
        agent_run_id: 'run-bgtbatch',
        budget_tokens: 9999,
      },
    });

    wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: {
        leaseId: 'lease-bgtbatch',
        kind: 'batch',
        prompt: 'do',
        agentRunId: 'run-bgtbatch',
      },
    });
    await waitForSpy(trRef.runLease as unknown as { mock: { calls: unknown[][] } });

    expect(trRef.runLease).toHaveBeenCalledOnce();
    const ctxArg = (trRef.runLease as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(ctxArg.budget_tokens).toBe(9999);
    // batch 路径不应误触发 SessionManager.create
    expect(sessionManager.create).not.toHaveBeenCalled();
    await daemon.stop();
  });

  it('batch: claim 无 budget_tokens → ctx.budget_tokens undefined（FR-07 零回归）', async () => {
    const sessionManager = createMockSessionManager();
    const taskRunner = createMockTaskRunner();
    const { daemon, client, taskRunner: trRef, wsClientMock } = buildDaemon({
      sessionManager,
      taskRunner,
    });
    track(daemon);

    await daemon.start();
    client.claimLease.mockResolvedValueOnce({
      claim_token: 'token-bgtbatch2',
      payload: {
        kind: 'batch',
        prompt: 'do',
        provider: 'claude',
        agent_run_id: 'run-bgtbatch2',
      },
    });

    wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: {
        leaseId: 'lease-bgtbatch2',
        kind: 'batch',
        prompt: 'do',
        agentRunId: 'run-bgtbatch2',
      },
    });
    await waitForSpy(trRef.runLease as unknown as { mock: { calls: unknown[][] } });

    const ctxArg = (trRef.runLease as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(ctxArg.budget_tokens).toBeUndefined();
    await daemon.stop();
  });
});
