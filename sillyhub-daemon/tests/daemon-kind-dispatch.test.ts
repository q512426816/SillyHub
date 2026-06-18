// tests/daemon-kind-dispatch.test.ts
// task-04 Step 4：daemon `_runLeaseStateMachine` 按 lease.kind 分流（D-002@v3）。
//
// 覆盖（蓝图 §4.4 + §5 + AC-05/06/07/08/09/14）：
//   - kind=batch / 缺省 → 现有 runLease + completeLease 路径；sessionManager.create 不调（FR-09）
//   - kind=interactive → sessionManager.create 调用；不调 runLease / startLease / completeLease
//   - kind=interactive 但 executable 缺失（_agentPaths 无 claude）→ onSessionEnd(failed)，不崩
//   - 重复 task_available 同 leaseId → _interactiveSessionsByLease 命中，不重复 create
//   - SESSION_INJECT/INTERRUPT/END 路由：session 存在 + lease 匹配 → 对应方法；lease 不匹配 → warn 不操作
//   - daemon 未注入 sessionManager（过渡期）→ kind=interactive 记 error 不崩
//
// 接口对齐：真实 src daemon.ts Daemon 构造签名（4 参 config/client/taskRunner?/options?），
//   options 增加 sessionManager?。WsClient 真实单 onMessage 回调（无 onControlMessage），
//   SESSION_* 消息经 onMessage → _handleWsMessage → SessionManager 路由。

import { describe, it, expect, afterEach, vi } from 'vitest';
import { Daemon } from '../src/daemon.js';
import type { DaemonConfig } from '../src/config.js';
import { MSG } from '../src/protocol.js';
import type { DetectedAgent } from '../src/agent-detector.js';
import type { WsClientCallbacks } from '../src/ws-client.js';
import type { SessionManager } from '../src/interactive/session-manager.js';
import type { SessionState } from '../src/interactive/types.js';

// ── fixture ──────────────────────────────────────────────────────────────────

const mockConfig: DaemonConfig = {
  server_url: 'http://test:8000',
  token: 'test-token',
  runtime_id: 'runtime-uuid-123',
  profile: 'default',
  workspace_dir: '/tmp/ws',
  poll_interval: 0.02,
  heartbeat_interval: 0.02,
  max_concurrent_tasks: 5,
  log_level: 'debug',
};

function mockAgent(provider: string, path = '', available = true): DetectedAgent {
  return {
    provider,
    path,
    version: '1.0.0',
    protocol: 'stream_json',
    status: available ? 'available' : 'unavailable',
    versionWarning: null,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
    register: vi.fn(async () => ({ id: 'srv-rid-1' })),
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

/** mock SessionManager：记录 create/inject/interrupt/end/get 调用；可配置 get 返回 state。 */
function createMockSessionManager(stateMap = new Map<string, Partial<SessionState>>()): SessionManager {
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

/**
 * 构造 Daemon + 捕获 wsClient callbacks。
 * options.sessionManager 可注入；options.agentPath 控制 _agentPaths.get('claude') 的返回。
 */
function buildDaemon(opts: {
  client?: MockClient;
  taskRunner?: MockTaskRunner | null;
  sessionManager?: SessionManager | null;
  agentPath?: string; // 注册时填入 _agentPaths['claude']
  config?: Partial<DaemonConfig>;
}) {
  const client = opts.client ?? createMockClient();
  const taskRunner =
    opts.taskRunner === undefined ? createMockTaskRunner() : opts.taskRunner;
  // 用 === undefined 判断：null 要能透传（测「未注入 sessionManager」场景，AC-14）。
  const sessionManager =
    opts.sessionManager === undefined
      ? createMockSessionManager()
      : opts.sessionManager;
  const agentPath = opts.agentPath ?? 'C:\\bin\\claude.exe';
  const config = { ...mockConfig, ...(opts.config ?? {}) };

  const detector = {
    detectAgents: vi.fn(async () => [
      mockAgent('claude', agentPath, true),
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
  // 只在显式传 sessionManager 时注入（含 null：测「未注入」场景）。
  if (opts.sessionManager !== undefined) {
    ctorOpts.sessionManager = sessionManager;
  }

  const daemon = new Daemon(
    config,
    client as never,
    taskRunner as never,
    ctorOpts as never,
  );

  return {
    daemon,
    client,
    taskRunner,
    sessionManager,
    detector,
    wsClientMock,
    wsClientFactory,
    config,
  };
}

// ── 测试 ──────────────────────────────────────────────────────────────────────

describe('daemon lease.kind 分流（D-002@v3）', () => {
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

  it('AC-05: kind=batch → runLease + completeLease；sessionManager.create 不调', async () => {
    const { daemon, client, taskRunner, sessionManager, wsClientMock } = buildDaemon({});
    track(daemon);

    await daemon.start();
    client.claimLease.mockResolvedValueOnce({
      claim_token: 'token-b',
      payload: { kind: 'batch', prompt: 'do', provider: 'claude' },
    });

    wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: { leaseId: 'lease-batch', kind: 'batch', prompt: 'do' },
    });
    await sleep(50);

    expect(taskRunner.runLease).toHaveBeenCalledOnce();
    expect(client.completeLease).toHaveBeenCalledOnce();
    expect(sessionManager.create).not.toHaveBeenCalled();
    await daemon.stop();
  });

  it('AC-05: kind 缺省（无 kind 字段）→ 按 batch 走 TaskRunner', async () => {
    const { daemon, client, taskRunner, sessionManager, wsClientMock } = buildDaemon({});
    track(daemon);

    await daemon.start();
    client.claimLease.mockResolvedValueOnce({
      claim_token: 'token-x',
      payload: { prompt: 'do', provider: 'claude' }, // 无 kind
    });

    wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: { leaseId: 'lease-none', prompt: 'do' },
    });
    await sleep(50);

    expect(taskRunner.runLease).toHaveBeenCalledOnce();
    expect(sessionManager.create).not.toHaveBeenCalled();
    await daemon.stop();
  });

  it('AC-05: kind 未知（如 "foo"）→ 按 batch 兼容（D-002@v3 §9）', async () => {
    const { daemon, client, taskRunner, sessionManager, wsClientMock } = buildDaemon({});
    track(daemon);

    await daemon.start();
    client.claimLease.mockResolvedValueOnce({
      claim_token: 'token-f',
      payload: { kind: 'foo', prompt: 'do' },
    });

    wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: { leaseId: 'lease-foo', kind: 'foo', prompt: 'do' },
    });
    await sleep(50);

    expect(taskRunner.runLease).toHaveBeenCalledOnce();
    expect(sessionManager.create).not.toHaveBeenCalled();
    await daemon.stop();
  });

  it('AC-06: kind=interactive → sessionManager.create 调用；不调 runLease/startLease/completeLease', async () => {
    const sessionManager = createMockSessionManager();
    const { daemon, client, taskRunner, wsClientMock } = buildDaemon({
      sessionManager,
    });
    track(daemon);

    await daemon.start();
    client.claimLease.mockResolvedValueOnce({
      claim_token: 'token-i',
      payload: {
        kind: 'interactive',
        prompt: 'hi',
        provider: 'claude',
        agent_session_id: 'sess-1',
        agent_run_id: 'run-1',
        root_path: 'C:\\work',
      },
    });

    wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: {
        leaseId: 'lease-int',
        kind: 'interactive',
        prompt: 'hi',
        agentSessionId: 'sess-1',
        agentRunId: 'run-1',
        rootPath: 'C:\\work',
      },
    });
    await sleep(50);

    expect(sessionManager.create).toHaveBeenCalledOnce();
    const createArg = (sessionManager.create as ReturnType<typeof vi.fn>).mock
      .calls[0]![0];
    expect(createArg).toMatchObject({
      sessionId: 'sess-1',
      leaseId: 'lease-int',
      firstPrompt: 'hi',
      firstRunId: 'run-1',
      cwd: 'C:\\work',
      provider: 'claude',
    });
    expect(createArg.pathToClaudeCodeExecutable).toBe('C:\\bin\\claude.exe');

    // interactive 不走 batch 收尾
    expect(taskRunner.runLease).not.toHaveBeenCalled();
    expect(client.startLease).not.toHaveBeenCalled();
    expect(client.completeLease).not.toHaveBeenCalled();
    await daemon.stop();
  });

  it('AC-07: kind=interactive 但 _agentPaths 无 claude → onSessionEnd(failed)，日志 CLAUDE_EXECUTABLE_NOT_FOUND，不崩', async () => {
    const sessionManager = createMockSessionManager();
    // SessionManager.create 抛 ClaudeExecutableNotFoundError（模拟 driver.start 内拒）
    sessionManager.create = vi.fn(async () => {
      const err = new Error(
        'claude executable not found: empty path (CLAUDE_EXECUTABLE_NOT_FOUND)',
      );
      (err as Error & { code: string }).code = 'CLAUDE_EXECUTABLE_NOT_FOUND';
      throw err;
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // detector 不提供 claude path（available 但 path 空 → daemon._agentPaths 无 claude）
    const { daemon, client, taskRunner, wsClientMock } = buildDaemon({
      sessionManager,
      agentPath: '',
    });
    track(daemon);

    await daemon.start();
    client.claimLease.mockResolvedValueOnce({
      claim_token: 'token-i',
      payload: {
        kind: 'interactive',
        prompt: 'hi',
        agent_session_id: 'sess-1',
        agent_run_id: 'run-1',
        root_path: 'C:\\work',
      },
    });

    wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: {
        leaseId: 'lease-int',
        kind: 'interactive',
        prompt: 'hi',
        agentSessionId: 'sess-1',
        agentRunId: 'run-1',
        rootPath: 'C:\\work',
      },
    });
    await sleep(50);

    // daemon 内 _startInteractiveSession 检测到无 path → 不调 create，调 onSessionEnd(failed)
    expect(sessionManager.create).not.toHaveBeenCalled();
    expect(taskRunner.runLease).not.toHaveBeenCalled();
    // 日志含 CLAUDE_EXECUTABLE_NOT_FOUND（无论 create 路径还是预检路径）
    const logged = errorSpy.mock.calls
      .map((c) => String(c.map(String)))
      .join(' ');
    expect(logged).toContain('CLAUDE_EXECUTABLE_NOT_FOUND');
    errorSpy.mockRestore();
    await daemon.stop();
  });

  it('AC-09: 重复 task_available 同 leaseId（interactive）→ 第二次不重复 create', async () => {
    const sessionManager = createMockSessionManager();
    const { daemon, client, wsClientMock } = buildDaemon({ sessionManager });
    track(daemon);

    await daemon.start();
    client.claimLease.mockResolvedValue({
      claim_token: 'token-i',
      payload: {
        kind: 'interactive',
        prompt: 'hi',
        agent_session_id: 'sess-1',
        agent_run_id: 'run-1',
        root_path: 'C:\\work',
      },
    });

    // 第一次
    wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: {
        leaseId: 'lease-int',
        kind: 'interactive',
        prompt: 'hi',
        agentSessionId: 'sess-1',
        agentRunId: 'run-1',
        rootPath: 'C:\\work',
      },
    });
    await sleep(30);
    // 第二次同 leaseId
    wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: {
        leaseId: 'lease-int',
        kind: 'interactive',
        prompt: 'hi',
        agentSessionId: 'sess-1',
        agentRunId: 'run-1',
        rootPath: 'C:\\work',
      },
    });
    await sleep(30);

    expect(sessionManager.create).toHaveBeenCalledOnce();
    await daemon.stop();
  });

  it('AC-14: daemon 未注入 sessionManager（过渡期）+ kind=interactive → 记 error 不崩，batch 不受影响', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // 显式传 null：未注入 sessionManager
    const { daemon, client, taskRunner, wsClientMock } = buildDaemon({
      sessionManager: null,
    });
    track(daemon);

    await daemon.start();
    client.claimLease.mockResolvedValueOnce({
      claim_token: 'token-i',
      payload: {
        kind: 'interactive',
        prompt: 'hi',
        agent_session_id: 'sess-1',
        agent_run_id: 'run-1',
        root_path: 'C:\\work',
      },
    });

    wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: {
        leaseId: 'lease-int',
        kind: 'interactive',
        prompt: 'hi',
        agentSessionId: 'sess-1',
        agentRunId: 'run-1',
        rootPath: 'C:\\work',
      },
    });
    await sleep(50);

    // 不崩 + 不调 runLease
    expect(daemon.isRunning).toBe(true);
    expect(taskRunner.runLease).not.toHaveBeenCalled();
    const logged = errorSpy.mock.calls.map((c) => String(c.map(String))).join(' ');
    expect(logged.toLowerCase()).toMatch(/session_manager|interactive/);
    errorSpy.mockRestore();
    await daemon.stop();
  });

  // ── SESSION_* 路由（AC-08）─────────────────────────────────────────────────────

  it('AC-08: SESSION_INJECT 路由到 sessionManager.inject（lease 匹配）', async () => {
    const stateMap = new Map<string, Partial<SessionState>>([
      ['sess-1', { sessionId: 'sess-1', leaseId: 'lease-int', status: 'active' }],
    ]);
    const sessionManager = createMockSessionManager(stateMap);
    sessionManager.inject = vi.fn(async () => ({ runId: 'run-2' }));
    const { daemon, wsClientMock } = buildDaemon({ sessionManager });
    track(daemon);

    await daemon.start();
    wsClientMock._injectMessage({
      type: MSG.SESSION_INJECT,
      payload: {
        session_id: 'sess-1',
        lease_id: 'lease-int',
        run_id: 'run-2',
        prompt: 'follow up',
      },
    });
    await sleep(30);

    expect(sessionManager.inject).toHaveBeenCalledWith('sess-1', 'follow up', 'run-2');
    await daemon.stop();
  });

  it('AC-08: SESSION_INTERRUPT 路由到 sessionManager.interrupt', async () => {
    const stateMap = new Map<string, Partial<SessionState>>([
      ['sess-1', { sessionId: 'sess-1', leaseId: 'lease-int', status: 'running' }],
    ]);
    const sessionManager = createMockSessionManager(stateMap);
    sessionManager.interrupt = vi.fn(async () => true);
    const { daemon, wsClientMock } = buildDaemon({ sessionManager });
    track(daemon);

    await daemon.start();
    wsClientMock._injectMessage({
      type: MSG.SESSION_INTERRUPT,
      payload: { session_id: 'sess-1', lease_id: 'lease-int' },
    });
    await sleep(30);

    expect(sessionManager.interrupt).toHaveBeenCalledWith('sess-1');
    await daemon.stop();
  });

  it('AC-08: SESSION_END 路由到 sessionManager.end', async () => {
    const stateMap = new Map<string, Partial<SessionState>>([
      ['sess-1', { sessionId: 'sess-1', leaseId: 'lease-int', status: 'running' }],
    ]);
    const sessionManager = createMockSessionManager(stateMap);
    sessionManager.end = vi.fn(async () => {});
    const { daemon, wsClientMock } = buildDaemon({ sessionManager });
    track(daemon);

    await daemon.start();
    wsClientMock._injectMessage({
      type: MSG.SESSION_END,
      payload: { session_id: 'sess-1', lease_id: 'lease-int' },
    });
    await sleep(30);

    expect(sessionManager.end).toHaveBeenCalledWith('sess-1');
    await daemon.stop();
  });

  it('AC-08: SESSION_INJECT lease_id 不匹配 → warn 不操作', async () => {
    const stateMap = new Map<string, Partial<SessionState>>([
      ['sess-1', { sessionId: 'sess-1', leaseId: 'lease-int', status: 'active' }],
    ]);
    const sessionManager = createMockSessionManager(stateMap);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { daemon, wsClientMock } = buildDaemon({ sessionManager });
    track(daemon);

    await daemon.start();
    wsClientMock._injectMessage({
      type: MSG.SESSION_INJECT,
      payload: {
        session_id: 'sess-1',
        lease_id: 'lease-OTHER', // 不匹配
        run_id: 'run-2',
        prompt: 'x',
      },
    });
    await sleep(30);

    expect(sessionManager.inject).not.toHaveBeenCalled();
    const logged = warnSpy.mock.calls.map((c) => String(c.map(String))).join(' ');
    expect(logged.toLowerCase()).toMatch(/lease/);
    warnSpy.mockRestore();
    await daemon.stop();
  });

  it('AC-08: SESSION_INJECT session 不存在 → warn 不操作（不抛）', async () => {
    const sessionManager = createMockSessionManager(new Map());
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { daemon, wsClientMock } = buildDaemon({ sessionManager });
    track(daemon);

    await daemon.start();
    wsClientMock._injectMessage({
      type: MSG.SESSION_INJECT,
      payload: {
        session_id: 'unknown',
        lease_id: 'lease-int',
        run_id: 'run-2',
        prompt: 'x',
      },
    });
    await sleep(30);

    expect(sessionManager.inject).not.toHaveBeenCalled();
    warnSpy.mockRestore();
    await daemon.stop();
  });

  it('AC-08: SESSION_* 未注入 sessionManager → warn 不崩', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { daemon, wsClientMock } = buildDaemon({ sessionManager: null });
    track(daemon);

    await daemon.start();
    expect(() => {
      wsClientMock._injectMessage({
        type: MSG.SESSION_END,
        payload: { session_id: 'sess-1', lease_id: 'lease-int' },
      });
    }).not.toThrow();
    await sleep(30);
    warnSpy.mockRestore();
    await daemon.stop();
  });
});
