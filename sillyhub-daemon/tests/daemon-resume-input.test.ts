// tests/daemon-resume-input.test.ts
// task-04（2026-08-29-batch-session-inherit / D-001@v1）接线验证：daemon
// `_runLeaseStateMachine` → `_startInteractiveSession` 把 claim payload 的
// resume_session_id（backend worker_redisdispatch.py 注入，task-03 白名单透传）
// 经既有归一化区（daemon.ts execPayload 构造：rawExec.resumeSessionId ??
// rawExec.resume_session_id ?? payload.resumeSessionId，不新建第二套）真正透传到：
//   SessionManager.create({..., resume})（CreateSessionInput.resume）
//
// 边界（task-04 卡）：SessionManager.create 内 spec.resume → driverOpts.resume
// 转发归 task-05——本文件只断言 create 入参，不 mock driverOpts。
//
// 模式照搬 tests/daemon-budget-wiring.test.ts（task-08 budget_tokens 透传用例，
// 其又照搬 daemon-kind-dispatch.test.ts）。helper 自包含复制，避免改既有测试文件
//（task-04 allowed_paths = daemon.ts + interactive/types.ts + 本文件）。

import { describe, it, expect, afterEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { Daemon } from '../src/daemon.js';
import type { DaemonConfig } from '../src/config.js';
import { MSG } from '../src/protocol.js';
import type { WsClientCallbacks } from '../src/ws-client.js';
import type { SessionManager } from '../src/interactive/session-manager.js';
import type { SessionState } from '../src/interactive/types.js';

// ── fixture（对齐 daemon-budget-wiring.test.ts）────────────────────────────────

const mockConfig: DaemonConfig = {
  server_url: 'http://127.0.0.1:8000',
  token: 'test-token',
  runtime_id: 'runtime-uuid-resume',
  profile: 'default',
  workspace_dir: '/tmp/ws-resume',
  poll_interval: 0.02,
  heartbeat_interval: 0.02,
  max_concurrent_tasks: 5,
  log_level: 'debug',
  // cwd 守卫终检要求 rootPath 真实存在 + allowed_roots 白名单（见
  // daemon-budget-wiring.test.ts 夹具债注释）：走正常守卫通过路径。
  allowed_roots: [tmpdir()],
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
  throw new Error(`waitForSpy: spy 未在 ${timeout}ms 内被调用`);
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

describe('task-04（2026-08-29-batch-session-inherit）：resume_session_id claim payload → daemon 透传', () => {
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

  it('interactive: claim payload snake_case resume_session_id → CreateSessionInput.resume', async () => {
    const sessionManager = createMockSessionManager();
    const { daemon, client, wsClientMock } = buildDaemon({ sessionManager });
    track(daemon);

    await daemon.start();
    client.claimLease.mockResolvedValueOnce({
      claim_token: 'token-rsm',
      payload: {
        kind: 'interactive',
        prompt: 'hi',
        provider: 'claude',
        agent_session_id: 'sess-rsm',
        agent_run_id: 'run-rsm',
        root_path: tmpdir(),
        // task-03 白名单透传键（backend context.py，snake_case 优先源）
        resume_session_id: 'parent-sess-001',
      },
    });

    wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: {
        leaseId: 'lease-rsm',
        kind: 'interactive',
        prompt: 'hi',
        agentSessionId: 'sess-rsm',
        agentRunId: 'run-rsm',
        rootPath: tmpdir(),
      },
    });
    await waitForSpy(sessionManager.create as unknown as { mock: { calls: unknown[][] } });

    expect(sessionManager.create).toHaveBeenCalledOnce();
    const createArg = (sessionManager.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(createArg.resume).toBe('parent-sess-001');
    await daemon.stop();
  });

  it('interactive: claim payload camelCase resumeSessionId → CreateSessionInput.resume（camel 兜底）', async () => {
    const sessionManager = createMockSessionManager();
    const { daemon, client, wsClientMock } = buildDaemon({ sessionManager });
    track(daemon);

    await daemon.start();
    client.claimLease.mockResolvedValueOnce({
      claim_token: 'token-rsm2',
      payload: {
        kind: 'interactive',
        prompt: 'hi',
        provider: 'claude',
        agent_session_id: 'sess-rsm2',
        agent_run_id: 'run-rsm2',
        root_path: tmpdir(),
        // 仅 camelCase（既有归一化区 rawExec.resumeSessionId 分支兜底）
        resumeSessionId: 'parent-sess-002',
      },
    });

    wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: {
        leaseId: 'lease-rsm2',
        kind: 'interactive',
        prompt: 'hi',
        agentSessionId: 'sess-rsm2',
        agentRunId: 'run-rsm2',
        rootPath: tmpdir(),
      },
    });
    await waitForSpy(sessionManager.create as unknown as { mock: { calls: unknown[][] } });

    const createArg = (sessionManager.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(createArg.resume).toBe('parent-sess-002');
    await daemon.stop();
  });

  it('interactive: claim 无 resume_session_id（旧 backend）→ CreateSessionInput.resume undefined 零行为变化', async () => {
    const sessionManager = createMockSessionManager();
    const { daemon, client, wsClientMock } = buildDaemon({ sessionManager });
    track(daemon);

    await daemon.start();
    client.claimLease.mockResolvedValueOnce({
      claim_token: 'token-rsm3',
      payload: {
        kind: 'interactive',
        prompt: 'hi',
        provider: 'claude',
        agent_session_id: 'sess-rsm3',
        agent_run_id: 'run-rsm3',
        root_path: tmpdir(),
        // 旧 backend：无 resume_session_id / resumeSessionId
      },
    });

    wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: {
        leaseId: 'lease-rsm3',
        kind: 'interactive',
        prompt: 'hi',
        agentSessionId: 'sess-rsm3',
        agentRunId: 'run-rsm3',
        rootPath: tmpdir(),
      },
    });
    await waitForSpy(sessionManager.create as unknown as { mock: { calls: unknown[][] } });

    // 会话创建路径不受影响（create 恰好一次）+ resume 键值为 undefined（不进入
    // resume 分支，行为与现状一致）。
    expect(sessionManager.create).toHaveBeenCalledOnce();
    const createArg = (sessionManager.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(createArg.resume).toBeUndefined();
    // 其余必填链路照常（证明零行为变化不是靠旁路 create 达成）
    expect(createArg.claimToken).toBe('token-rsm3');
    expect(createArg.firstPrompt).toBe('hi');
    await daemon.stop();
  });
});
