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
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Daemon } from '../src/daemon.js';
import type { DaemonConfig } from '../src/config.js';
import { MSG } from '../src/protocol.js';
import type { DetectedAgent } from '../src/agent-detector.js';
import type { WsClientCallbacks } from '../src/ws-client.js';
import type { SessionManager } from '../src/interactive/session-manager.js';
import type { SessionState } from '../src/interactive/types.js';

// ── fixture ──────────────────────────────────────────────────────────────────

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
  // task-07 夹具债修复（2026-08-28-fix-cross-machine-worker-dispatch）：daemon 认领段
  // cwd 守卫对 workspace 绑定会话（rootPath 非空非借用 marker）做 allowed_roots
  // 白名单终检 + 存在性终检——夹具 rootPath 由假路径 'C:\work' 改用真实存在的
  // tmpdir() 并补白名单，interactive 用例走正常守卫通过路径（断言意图不变）。
  allowed_roots: [tmpdir()],
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

/**
 * 轮询等待 vi.fn spy 被调用（替代固定 sleep(N)）。
 *
 * 固定 sleep(50) 在满载 fork 池（8 fork × 多文件并发）下偶发饥饿——daemon 的
 * WS→claim→_runLeaseStateMachine→_startInteractiveSession→sessionManager.create
 * 异步链需多次 event loop tick，高并发下 50ms 内未跑完 → "create called 0 times"
 * 假阴性（隔离/单文件均秒过，见 vitest.config.ts 注释）。轮询直到 spy 被调（上限
 * 3s）消除竞态：快时 15ms 命中，满载时耐心等到链路完成，不再依赖拍脑袋的固定值。
 *
 * 仅用于「期望被调用」的正向断言；负向断言（not.toHaveBeenCalled）仍用 sleep
 * 给足窗口再确认未触发。
 */
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
    `waitForSpy: spy 未在 ${timeout}ms 内被调用（竞态修复兜底，见 vitest.config.ts 并发说明）`,
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
  credentialManager?: { get: (k: string) => string | undefined; buildEnv: (c: Record<string, unknown>) => Record<string, string> };
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
  if (opts.credentialManager !== undefined) {
    ctorOpts.credentialManager = opts.credentialManager;
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
        root_path: tmpdir(),
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
        rootPath: tmpdir(),
      },
    });
    await waitForSpy(sessionManager.create as unknown as { mock: { calls: unknown[][] } });

    expect(sessionManager.create).toHaveBeenCalledOnce();
    const createArg = (sessionManager.create as ReturnType<typeof vi.fn>).mock
      .calls[0]![0];
    expect(createArg).toMatchObject({
      sessionId: 'sess-1',
      leaseId: 'lease-int',
      firstPrompt: 'hi',
      firstRunId: 'run-1',
      cwd: tmpdir(),
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
        root_path: tmpdir(),
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
        rootPath: tmpdir(),
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
        root_path: tmpdir(),
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
        rootPath: tmpdir(),
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
        rootPath: tmpdir(),
      },
    });
    await waitForSpy(sessionManager.create as unknown as { mock: { calls: unknown[][] } });

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
        root_path: tmpdir(),
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
        rootPath: tmpdir(),
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

  // ── gap-8：interactive cwd 创建 + 凭证 env 注入 ──────────────────────────────

  it('gap-8: interactive 无 rootPath 时 cwd 回落 workspace_dir 并被自动创建（修复 SDK spawn 因 cwd 不存在秒挂）', async () => {
    const wsDir = join(tmpdir(), `silly-gap8-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    expect(existsSync(wsDir)).toBe(false);

    const sessionManager = createMockSessionManager();
    const { daemon, client, wsClientMock } = buildDaemon({
      sessionManager,
      config: { workspace_dir: wsDir },
    });
    track(daemon);

    try {
      await daemon.start();
      client.claimLease.mockResolvedValueOnce({
        claim_token: 'token-i',
        // 注意：interactive lease 不带 root_path（daemon-client 会话无 workspace）
        payload: {
          kind: 'interactive',
          prompt: 'hi',
          provider: 'claude',
          agent_session_id: 'sess-1',
          agent_run_id: 'run-1',
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
        },
      });
      await waitForSpy(sessionManager.create as unknown as { mock: { calls: unknown[][] } });

      // cwd 已被 mkdir 创建
      expect(existsSync(wsDir)).toBe(true);
      // create 收到的 cwd 即 workspace_dir
      const createArg = (sessionManager.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(createArg.cwd).toBe(wsDir);
      await daemon.stop();
    } finally {
      rmSync(wsDir, { recursive: true, force: true });
    }
  });

  it('gap-8: 注入 credentialManager 时 create 收到 buildSpawnEnv 构造的 env（凭证 parity）', async () => {
    const sessionManager = createMockSessionManager();
    const credentialManager = {
      get: vi.fn(() => undefined),
      buildEnv: vi.fn(() => ({ SILLY_TEST_TOKEN: 'xyz' })),
    };
    const { daemon, client, wsClientMock } = buildDaemon({
      sessionManager,
      credentialManager,
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
        root_path: tmpdir(),
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
        rootPath: tmpdir(),
      },
    });
    await waitForSpy(sessionManager.create as unknown as { mock: { calls: unknown[][] } });

    expect(sessionManager.create).toHaveBeenCalledOnce();
    const createArg = (sessionManager.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(createArg.env).toBeDefined();
    // buildSpawnEnv 层1 注入 credential.buildEnv 的结果
    expect(createArg.env.SILLY_TEST_TOKEN).toBe('xyz');
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

    // 2026-08-20-session-multimodal-attachments 后 inject 固定 5 参（无附件时
    // attachments/downloadAttachment 为 undefined），断言需带全。
    expect(sessionManager.inject).toHaveBeenCalledWith(
      'sess-1',
      'follow up',
      'run-2',
      undefined,
      undefined,
    );
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

  // ── task-10：AgentProfile 三字段 execPayload → CreateSessionInput 透传 ──────────

  it('task-10: interactive claim payload（camelCase）profile 字段 → CreateSessionInput 透传', async () => {
    const sessionManager = createMockSessionManager();
    const { daemon, client, wsClientMock } = buildDaemon({ sessionManager });
    track(daemon);

    await daemon.start();
    client.claimLease.mockResolvedValueOnce({
      claim_token: 'token-pf',
      payload: {
        kind: 'interactive',
        prompt: 'hi',
        provider: 'claude',
        agent_session_id: 'sess-pf',
        agent_run_id: 'run-pf',
        root_path: tmpdir(),
        // task-07 双写 camelCase（优先源）
        mcpRefs: ['mcp-a', 'mcp-b'],
        skillRefs: ['skill-x'],
        effectiveAllowedRoots: ['C:\\work', 'C:\\repo'],
      },
    });

    wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: {
        leaseId: 'lease-pf',
        kind: 'interactive',
        prompt: 'hi',
        agentSessionId: 'sess-pf',
        agentRunId: 'run-pf',
        rootPath: tmpdir(),
      },
    });
    await waitForSpy(sessionManager.create as unknown as { mock: { calls: unknown[][] } });

    expect(sessionManager.create).toHaveBeenCalledOnce();
    const createArg = (sessionManager.create as ReturnType<typeof vi.fn>).mock
      .calls[0]![0];
    // 三字段逐字透传（camelCase 源）
    expect(createArg.mcpRefs).toEqual(['mcp-a', 'mcp-b']);
    expect(createArg.skillRefs).toEqual(['skill-x']);
    expect(createArg.effectiveAllowedRoots).toEqual(['C:\\work', 'C:\\repo']);
    await daemon.stop();
  });

  it('task-10: interactive claim payload（snake_case 兜底）profile 字段 → CreateSessionInput 透传', async () => {
    const sessionManager = createMockSessionManager();
    const { daemon, client, wsClientMock } = buildDaemon({ sessionManager });
    track(daemon);

    await daemon.start();
    client.claimLease.mockResolvedValueOnce({
      claim_token: 'token-pf2',
      payload: {
        kind: 'interactive',
        prompt: 'hi',
        provider: 'claude',
        agent_session_id: 'sess-pf2',
        agent_run_id: 'run-pf2',
        root_path: tmpdir(),
        // 仅 snake_case（兼容 backend 旧/变体写法）
        mcp_refs: ['mcp-s'],
        skill_refs: ['skill-s'],
        effective_allowed_roots: ['C:\\sandbox'],
      },
    });

    wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: {
        leaseId: 'lease-pf2',
        kind: 'interactive',
        prompt: 'hi',
        agentSessionId: 'sess-pf2',
        agentRunId: 'run-pf2',
        rootPath: tmpdir(),
      },
    });
    await waitForSpy(sessionManager.create as unknown as { mock: { calls: unknown[][] } });

    expect(sessionManager.create).toHaveBeenCalledOnce();
    const createArg = (sessionManager.create as ReturnType<typeof vi.fn>).mock
      .calls[0]![0];
    expect(createArg.mcpRefs).toEqual(['mcp-s']);
    expect(createArg.skillRefs).toEqual(['skill-s']);
    expect(createArg.effectiveAllowedRoots).toEqual(['C:\\sandbox']);
    await daemon.stop();
  });

  it('task-10: interactive claim 无 profile 字段 → CreateSessionInput 三字段 undefined（FR-15 零回归）', async () => {
    const sessionManager = createMockSessionManager();
    const { daemon, client, wsClientMock } = buildDaemon({ sessionManager });
    track(daemon);

    await daemon.start();
    client.claimLease.mockResolvedValueOnce({
      claim_token: 'token-pf3',
      payload: {
        kind: 'interactive',
        prompt: 'hi',
        provider: 'claude',
        agent_session_id: 'sess-pf3',
        agent_run_id: 'run-pf3',
        root_path: tmpdir(),
      },
    });

    wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: {
        leaseId: 'lease-pf3',
        kind: 'interactive',
        prompt: 'hi',
        agentSessionId: 'sess-pf3',
        agentRunId: 'run-pf3',
        rootPath: tmpdir(),
      },
    });
    await waitForSpy(sessionManager.create as unknown as { mock: { calls: unknown[][] } });

    expect(sessionManager.create).toHaveBeenCalledOnce();
    const createArg = (sessionManager.create as ReturnType<typeof vi.fn>).mock
      .calls[0]![0];
    expect(createArg.mcpRefs).toBeUndefined();
    expect(createArg.skillRefs).toBeUndefined();
    expect(createArg.effectiveAllowedRoots).toBeUndefined();
    await daemon.stop();
  });

  it('task-10: batch claim payload（camelCase）profile 字段 → ctx 透传 runLease', async () => {
    const sessionManager = createMockSessionManager();
    const taskRunner = createMockTaskRunner();
    const { daemon, client, taskRunner: trRef, wsClientMock } = buildDaemon({
      sessionManager,
      taskRunner,
    });
    track(daemon);

    await daemon.start();
    client.claimLease.mockResolvedValueOnce({
      claim_token: 'token-batch',
      payload: {
        kind: 'batch',
        prompt: 'do',
        provider: 'claude',
        agent_run_id: 'run-batch',
        mcpRefs: ['mcp-b1'],
        skillRefs: ['skill-b1'],
        effectiveAllowedRoots: ['C:\\batch'],
      },
    });

    wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: {
        leaseId: 'lease-batch',
        kind: 'batch',
        prompt: 'do',
        agentRunId: 'run-batch',
      },
    });
    await waitForSpy(trRef.runLease as unknown as { mock: { calls: unknown[][] } });

    expect(trRef.runLease).toHaveBeenCalledOnce();
    const ctxArg = (trRef.runLease as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(ctxArg.mcpRefs).toEqual(['mcp-b1']);
    expect(ctxArg.skillRefs).toEqual(['skill-b1']);
    expect(ctxArg.effectiveAllowedRoots).toEqual(['C:\\batch']);
    expect(sessionManager.create).not.toHaveBeenCalled();
    await daemon.stop();
  });
});

