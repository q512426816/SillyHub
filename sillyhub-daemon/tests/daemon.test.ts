/**
 * Daemon 主类集成测试（task-20 TDD RED→GREEN）。
 *
 * 策略：mock 6 个依赖（detector/client/taskRunner/wsClient），断言编排逻辑
 *（调用顺序 / 状态机流转 / 去重 / 优雅退出 / 信号处理），不测真实 HTTP/WS/子进程。
 *
 * 接口对齐：以 src 真实签名为准，**不照搬蓝图假设**。
 *   - HubClient.register({ provider, name, version, ... }) → Record<string, unknown>
 *   - HubClient.heartbeat(rid) / claimLease(leaseId, rid) / startLease(leaseId, token)
 *     / completeLease(leaseId, token, result) / getPendingLeases(rid) / close(): void
 *   - WsClient constructor({ serverUrl, runtimeId, callbacks })，connect(): void（自动重连）
 *   - TaskRunner.runLease(ctx: LeaseCtx): Promise<TaskRunnerResult>
 *     （不是 executeTask(leaseId, token, payload)！蓝图假设过时）
 *   - DetectedAgent { provider, path, status: 'available' | 'unavailable', ... }
 *     （不是 { name, bin_path, available: bool }）
 *   - AgentDetector.detectAgents()（不是 detectAll）
 *
 * @module daemon.test
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { Daemon } from '../src/daemon.js';
import type { DaemonConfig } from '../src/config.js';
import { MSG } from '../src/protocol.js';
import type {
  DetectedAgent,
} from '../src/agent-detector.js';
import type { LeasePayload } from '../src/types.js';
import type {
  WsClientCallbacks,
} from '../src/ws-client.js';

// ── 测试 fixture ──────────────────────────────────────────────────────────────

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

/** 构造 mock DetectedAgent（status 字段，对齐真实 src）。 */
function mockAgent(provider: string, available = true): DetectedAgent {
  return {
    provider,
    path: available ? `/usr/bin/${provider}` : '',
    version: '1.0.0',
    protocol: 'stream_json',
    status: available ? 'available' : 'unavailable',
    versionWarning: null,
  };
}

/** 等待 n 毫秒。 */
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
    // ql-20260617-009：默认 fetch 返回空 bundle（无 workspace 字段）。
    getExecutionContext: vi.fn(async () => ({
      agent_run_id: 'run-default',
      claude_md: '',
    })),
    close: vi.fn(),
  };
}

interface MockDetector {
  detectAgents: ReturnType<typeof vi.fn>;
}

function createMockDetector(agents: DetectedAgent[] = [mockAgent('claude'), mockAgent('codex')]): MockDetector {
  return {
    detectAgents: vi.fn(async () => agents),
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
      patch: 'diff --git',
      filesChanged: 2,
      insertions: 10,
      deletions: 3,
      output: 'done',
      error: '',
      durationMs: 500,
      sessionId: 'sess-1',
      metadata: { session_id: 'sess-1' },
    })),
  };
}

/** mock WsClient 工厂：暴露 callbacks 让测试模拟 server 推消息。 */
function createMockWsClient() {
  let callbacks: WsClientCallbacks = {};
  return {
    // WsClient 构造签名：new WsClient({ serverUrl, runtimeId, callbacks })
    // daemon 内部会调 wsClient.connect() / wsClient.close()
    // 我们提供一个"注入构造器"的形态：mock 对象本身就是 WsClient 实例
    connect: vi.fn(() => {
      callbacks.onConnected?.();
    }),
    close: vi.fn(() => {
      callbacks.onDisconnected?.(1000, 'test_close');
    }),
    send: vi.fn(() => true),
    // 测试辅助：模拟 server 推消息（绕过真实 WS）
    _injectMessage(msg: { type: string; payload: unknown }): void {
      callbacks.onMessage?.(msg as never);
    },
    // 测试辅助：注入 callbacks（daemon.start 时调）
    _setCallbacks(cb: WsClientCallbacks): void {
      callbacks = cb;
    },
  };
}

/**
 * 构造测试用 Daemon 实例。options.wsClientFactory 是测试专用的注入点：
 * daemon 在 _wsLoop 时调它（new WsClient(opts)），测试用 factory 接管创建并捕获 callbacks。
 */
function buildDaemon(opts: {
  client?: MockClient;
  detector?: MockDetector;
  taskRunner?: MockTaskRunner | null;
  config?: Partial<DaemonConfig>;
}) {
  const client = opts.client ?? createMockClient();
  const detector = opts.detector ?? createMockDetector();
  // 用 === undefined 判断：null 要能传透（测无 taskRunner 场景）
  const taskRunner = opts.taskRunner === undefined ? createMockTaskRunner() : opts.taskRunner;
  const config = { ...mockConfig, ...(opts.config ?? {}) };

  // 捕获 wsClient + 它的 callbacks，供测试 inject 消息。
  // daemon 调 factory({ serverUrl, runtimeId, callbacks }) 时，把 callbacks 透传给 mock。
  // 真实 WsClient 构造签名：new WsClient({ serverUrl, runtimeId, callbacks })。
  const wsClientMock = createMockWsClient();
  const wsClientFactory = vi.fn((opts2: { callbacks: WsClientCallbacks }) => {
    wsClientMock._setCallbacks(opts2.callbacks);
    return wsClientMock;
  });

  const daemon = new Daemon(config, client as never, taskRunner as never, {
    detector: detector as never,
    wsClientFactory: wsClientFactory as never,
  });

  return { daemon, client, detector, taskRunner, wsClientMock, wsClientFactory, config };
}

// ── 测试用例 ──────────────────────────────────────────────────────────────────

describe('Daemon', () => {
  let daemons: Daemon[] = [];

  afterEach(async () => {
    // 清理所有未停止的 daemon（防 fake timer / 循环泄漏）
    for (const d of daemons) {
      if (d.isRunning) {
        await d.stop().catch(() => undefined);
      }
    }
    daemons = [];
    vi.useRealTimers();
  });

  function track<T extends Daemon>(d: T): T {
    daemons.push(d);
    return d;
  }

  // AC-01: start 探测 agent 并逐个 register
  it('AC-01: start 探测 agent 并逐个 register，填入 _registeredRuntimes', async () => {
    const { daemon, client, detector } = buildDaemon({});
    track(daemon);

    await daemon.start();

    expect(detector.detectAgents).toHaveBeenCalledOnce();
    expect(client.register).toHaveBeenCalledTimes(2);
    // register 用 provider 字段（agent.provider，对齐真实 DetectedAgent）
    expect(client.register).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'claude',
    }));
    expect(client.register).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'codex',
    }));
    // 等一拍心跳（heartbeat 对每个 registered rid 调一次）
    await sleep(60);
    expect(client.heartbeat).toHaveBeenCalled();
    await daemon.stop();
  });

  it('AC-01b: 单个 agent register 失败不中断其余', async () => {
    const client = createMockClient();
    client.register
      .mockRejectedValueOnce(new Error('net err'))
      .mockResolvedValueOnce({ id: 'srv-2' });
    const { daemon } = buildDaemon({ client });
    track(daemon);

    await daemon.start();
    expect(client.register).toHaveBeenCalledTimes(2);
    await daemon.stop();
  });

  it('AC-01c: 无 available agent 时仍启动三循环（Python 行为对齐）', async () => {
    const detector = createMockDetector([
      mockAgent('claude', false),
      mockAgent('codex', false),
    ]);
    const client = createMockClient();
    const { daemon } = buildDaemon({ client, detector });
    track(daemon);

    await daemon.start();
    expect(client.register).not.toHaveBeenCalled();
    // 三循环仍跑，只是 registered runtimes 为空 → 心跳循环空遍历
    await sleep(60);
    expect(client.heartbeat).not.toHaveBeenCalled(); // 空 map，不调
    await daemon.stop();
  });

  // AC-02: 三循环启动
  it('AC-02: start 后心跳与轮询循环运行（调用次数递增）', async () => {
    const client = createMockClient();
    const taskRunner = createMockTaskRunner();
    const { daemon } = buildDaemon({ client, taskRunner });
    track(daemon);

    await daemon.start();
    await sleep(100);
    expect(client.heartbeat.mock.calls.length).toBeGreaterThan(0);
    expect(client.getPendingLeases.mock.calls.length).toBeGreaterThan(0);
    await daemon.stop();
  });

  it('AC-02b: 无 taskRunner 时 poll 循环跳过 getPendingLeases', async () => {
    const client = createMockClient();
    const { daemon } = buildDaemon({ client, taskRunner: null });
    track(daemon);

    await daemon.start();
    await sleep(100);
    expect(client.getPendingLeases).not.toHaveBeenCalled();
    await daemon.stop();
  });

  // AC-03: WS task_available → claim → start → run → complete 全链
  it('AC-03: WS 推 task_available 触发 claim→start→runLease→complete 全链', async () => {
    const client = createMockClient();
    client.claimLease.mockResolvedValueOnce({
      claim_token: 'token-lease-1',
      payload: { prompt: 'do task', provider: 'claude' },
    });
    const taskRunner = createMockTaskRunner();
    const { daemon, wsClientMock, wsClientFactory } = buildDaemon({
      client,
      taskRunner,
    });
    track(daemon);

    await daemon.start();
    // 触发 wsLoop（factory 已被调用，模拟 server 推消息）
    expect(wsClientFactory).toHaveBeenCalled();

    wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: {
        leaseId: 'lease-1',
        runtimeId: 'srv-rid-1',
        prompt: 'do task',
      },
    });

    // 等异步 _executeTask 完成
    await sleep(50);

    expect(client.claimLease).toHaveBeenCalledWith('lease-1', 'srv-rid-1');
    expect(client.startLease).toHaveBeenCalledWith('lease-1', 'token-lease-1');
    // runLease 收到 LeaseCtx（含 leaseId + claimToken + prompt 等字段）
    expect(taskRunner.runLease).toHaveBeenCalledOnce();
    const ctxArg = taskRunner.runLease.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(ctxArg).toMatchObject({
      leaseId: 'lease-1',
      claimToken: 'token-lease-1',
      prompt: 'do task',
    });
    // complete 用 snake_case 字段（对齐 server complete_lease Pydantic 模型，
    // daemon 把 camelCase TaskRunnerResult 映射成 snake_case）
    expect(client.completeLease).toHaveBeenCalledWith(
      'lease-1',
      'token-lease-1',
      expect.objectContaining({
        success: true,
        patch: 'diff --git',
        files_changed: 2,
        session_id: 'sess-1',
      }),
    );
    await daemon.stop();
  });

  it('AC-03b: task_available 无 taskRunner 时仅 warn 不崩', async () => {
    const client = createMockClient();
    const { daemon, wsClientMock } = buildDaemon({
      client,
      taskRunner: null,
    });
    track(daemon);

    await daemon.start();
    expect(() =>
      wsClientMock._injectMessage({
        type: MSG.TASK_AVAILABLE,
        payload: { leaseId: 'x' },
      }),
    ).not.toThrow();
    await sleep(20);
    expect(client.claimLease).not.toHaveBeenCalled();
    await daemon.stop();
  });

  it('AC-03c: poll 拿到 pending lease 触发 claim→start→run→complete', async () => {
    const client = createMockClient();
    client.claimLease.mockResolvedValue({
      claim_token: 'token-poll-1',
      payload: { prompt: 'poll task' },
    });
    // 真实场景：claim 后 server 不再把该 lease 列在 pending 中。
    // mock 行为：第一次返回 lease，之后返回空（防 poll 多轮重复触发）。
    let polledOnce = false;
    client.getPendingLeases.mockImplementation(async () => {
      if (polledOnce) return [];
      polledOnce = true;
      return [
        { lease_id: 'poll-1', agent_run_id: 'ar-1', prompt: 'p1', provider: 'claude' },
      ];
    });
    const taskRunner = createMockTaskRunner();
    const { daemon } = buildDaemon({ client, taskRunner });
    track(daemon);

    await daemon.start();
    await sleep(100);

    expect(client.claimLease).toHaveBeenCalledWith('poll-1', 'srv-rid-1');
    expect(taskRunner.runLease).toHaveBeenCalledOnce();
    expect(client.completeLease).toHaveBeenCalled();
    await daemon.stop();
  });

  // AC-04: 并发 lease 去重
  it('AC-04: WS 连续推同一 lease_id，runLease 只调一次', async () => {
    const client = createMockClient();
    client.claimLease.mockResolvedValue({
      claim_token: 't-x',
      payload: {},
    });
    const taskRunner = createMockTaskRunner();
    taskRunner.runLease.mockImplementation(async () => {
      await sleep(30);
      return {
        success: true,
        exitCode: 0,
        status: 'completed' as const,
        patch: '',
        filesChanged: 0,
        insertions: 0,
        deletions: 0,
        output: '',
        error: '',
        durationMs: 30,
        sessionId: '',
        metadata: {},
      };
    });
    const { daemon, wsClientMock } = buildDaemon({ client, taskRunner });
    track(daemon);

    await daemon.start();

    wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: { leaseId: 'lease-x' },
    });
    wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: { leaseId: 'lease-x' },
    });

    await sleep(80);
    expect(taskRunner.runLease).toHaveBeenCalledTimes(1);
    await daemon.stop();
  });

  it('AC-04b: 超出 max_concurrent_tasks 时丢弃新 lease', async () => {
    const client = createMockClient();
    client.claimLease.mockResolvedValue({ claim_token: 't', payload: {} });
    const taskRunner = createMockTaskRunner();
    taskRunner.runLease.mockImplementation(async () => {
      await sleep(60);
      return {
        success: true,
        exitCode: 0,
        status: 'completed' as const,
        patch: '',
        filesChanged: 0,
        insertions: 0,
        deletions: 0,
        output: '',
        error: '',
        durationMs: 60,
        sessionId: '',
        metadata: {},
      };
    });
    const { daemon, wsClientMock } = buildDaemon({
      client,
      taskRunner,
      config: { max_concurrent_tasks: 1 },
    });
    track(daemon);

    await daemon.start();

    wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: { leaseId: 'l1' },
    });
    wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: { leaseId: 'l2' }, // 被丢弃
    });

    await sleep(100);
    expect(taskRunner.runLease).toHaveBeenCalledTimes(1);
    await daemon.stop();
  });

  // AC-05: stop 优雅取消
  it('AC-05: stop 后 isRunning=false，三循环停止，client/ws close 被调', async () => {
    const client = createMockClient();
    const taskRunner = createMockTaskRunner();
    const { daemon, wsClientMock } = buildDaemon({ client, taskRunner });
    track(daemon);

    await daemon.start();
    await sleep(40);
    const hbBefore = client.heartbeat.mock.calls.length;
    await daemon.stop();

    expect(daemon.isRunning).toBe(false);
    expect(client.close).toHaveBeenCalledOnce();
    expect(wsClientMock.close).toHaveBeenCalledOnce();
    // 等一拍，心跳不再递增
    await sleep(50);
    expect(client.heartbeat.mock.calls.length).toBe(hbBefore);
  });

  it('AC-05b: stop 幂等（连续调多次不报错）', async () => {
    const { daemon } = buildDaemon({});
    track(daemon);
    await daemon.start();
    await daemon.stop();
    await expect(daemon.stop()).resolves.not.toThrow();
  });

  it('AC-05d: stop 将已注册的 server runtime id 标记为离线', async () => {
    const client = createMockClient();
    client.register
      .mockResolvedValueOnce({ id: 'srv-claude' })
      .mockResolvedValueOnce({ id: 'srv-codex' });
    const { daemon } = buildDaemon({ client });
    track(daemon);

    await daemon.start();
    await daemon.stop();

    expect(client.markOffline).toHaveBeenCalledTimes(2);
    expect(client.markOffline).toHaveBeenCalledWith('srv-claude');
    expect(client.markOffline).toHaveBeenCalledWith('srv-codex');
    expect(client.markOffline).not.toHaveBeenCalledWith(mockConfig.runtime_id);
  });

  it('AC-05c: start 幂等（已 running 时直接 return）', async () => {
    const { daemon, detector } = buildDaemon({});
    track(daemon);
    await daemon.start();
    await daemon.start();
    expect(detector.detectAgents).toHaveBeenCalledOnce();
    await daemon.stop();
  });

  // AC-06: 信号处理（通过直接调内部 handler 测试，不真发信号）
  it('AC-06: SIGTERM handler 触发 stop', async () => {
    const client = createMockClient();
    const { daemon } = buildDaemon({ client });
    track(daemon);

    await daemon.start();
    // 直接模拟 process emit SIGTERM（handler 内部调 stop）
    process.emit('SIGTERM', 'SIGTERM');
    // 给 stop 异步流程跑完
    await sleep(50);
    expect(daemon.isRunning).toBe(false);
    expect(client.close).toHaveBeenCalled();
  });

  it('AC-06b: stop 注销信号 handler（不重复触发）', async () => {
    const { daemon } = buildDaemon({});
    track(daemon);
    await daemon.start();
    await daemon.stop();
    // 再 emit SIGTERM，不应有副作用（handler 已注销）
    const listenersBefore = process.listenerCount('SIGTERM');
    process.emit('SIGTERM', 'SIGTERM');
    await sleep(20);
    const listenersAfter = process.listenerCount('SIGTERM');
    expect(listenersAfter).toBe(listenersBefore);
  });

  // AC-07: lease 状态机 - claim_resp.payload 嵌套 vs 平铺
  it('AC-07a: claim_resp.payload 嵌套形态被正确传给 runLease', async () => {
    const client = createMockClient();
    client.claimLease.mockResolvedValueOnce({
      claim_token: 't1',
      payload: {
        prompt: 'nested',
        provider: 'codex',
        workspaceName: 'ws',
      },
    });
    const taskRunner = createMockTaskRunner();
    const { daemon, wsClientMock } = buildDaemon({ client, taskRunner });
    track(daemon);

    await daemon.start();
    wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: { leaseId: 'L1' },
    });
    await sleep(50);
    expect(taskRunner.runLease).toHaveBeenCalledOnce();
    const ctx = taskRunner.runLease.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(ctx).toMatchObject({
      leaseId: 'L1',
      claimToken: 't1',
      prompt: 'nested',
      provider: 'codex',
      workspaceName: 'ws',
    });
    await daemon.stop();
  });

  it('AC-07b: claim_resp 平铺形态（无 payload 字段）兼容', async () => {
    const client = createMockClient();
    client.claimLease.mockResolvedValueOnce({
      claim_token: 't2',
      prompt: 'flat',
      provider: 'claude',
    });
    const taskRunner = createMockTaskRunner();
    const { daemon, wsClientMock } = buildDaemon({ client, taskRunner });
    track(daemon);

    await daemon.start();
    wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: { leaseId: 'L2', prompt: 'original' },
    });
    await sleep(50);
    expect(taskRunner.runLease).toHaveBeenCalledOnce();
    const ctx = taskRunner.runLease.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(ctx).toMatchObject({
      leaseId: 'L2',
      claimToken: 't2',
      prompt: 'flat',
    });
    await daemon.stop();
  });

  // ql-20260617-009：execution-context 返回的 workspace_slug/root_path 透传到 ctx
  it('AC-07f: execution-context 的 workspace_slug/root_path 透传到 LeaseCtx', async () => {
    const client = createMockClient();
    client.claimLease.mockResolvedValueOnce({
      claim_token: 't-rootpath',
      payload: { agentRunId: 'run-1', provider: 'claude' },
    });
    client.getExecutionContext.mockResolvedValueOnce({
      agent_run_id: 'run-1',
      claude_md: '# bundle',
      workspace_slug: 'sillyhub',
      root_path: 'C:/Users/qinyi/IdeaProjects/multi-agent-platform',
    });
    const taskRunner = createMockTaskRunner();
    const { daemon, wsClientMock } = buildDaemon({ client, taskRunner });
    track(daemon);

    await daemon.start();
    wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: { leaseId: 'Lroot', provider: 'claude' },
    });
    await sleep(60);
    expect(taskRunner.runLease).toHaveBeenCalledOnce();
    const ctx = taskRunner.runLease.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(ctx).toMatchObject({
      workspaceSlug: 'sillyhub',
      rootPath: 'C:/Users/qinyi/IdeaProjects/multi-agent-platform',
    });
    await daemon.stop();
  });

  it('AC-07c: claimLease 失败不调 startLease/runLease/complete', async () => {
    const client = createMockClient();
    client.claimLease.mockRejectedValueOnce(new Error('409 conflict'));
    const taskRunner = createMockTaskRunner();
    const { daemon, wsClientMock } = buildDaemon({ client, taskRunner });
    track(daemon);

    await daemon.start();
    wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: { leaseId: 'L3' },
    });
    await sleep(40);
    expect(client.startLease).not.toHaveBeenCalled();
    expect(taskRunner.runLease).not.toHaveBeenCalled();
    expect(client.completeLease).not.toHaveBeenCalled();
    await daemon.stop();
  });

  it('AC-07d: startLease 失败时不调 runLease（提前 return）', async () => {
    const client = createMockClient();
    client.claimLease.mockResolvedValueOnce({ claim_token: 'ts', payload: {} });
    client.startLease.mockRejectedValueOnce(new Error('500'));
    const taskRunner = createMockTaskRunner();
    const { daemon, wsClientMock } = buildDaemon({ client, taskRunner });
    track(daemon);

    await daemon.start();
    wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: { leaseId: 'L4' },
    });
    await sleep(40);
    expect(taskRunner.runLease).not.toHaveBeenCalled();
    await daemon.stop();
  });

  it('AC-07e: completeLease 失败不崩主循环（lease 已跑完）', async () => {
    const client = createMockClient();
    client.claimLease.mockResolvedValue({ claim_token: 'tc', payload: {} });
    client.completeLease.mockRejectedValue(new Error('net err'));
    const taskRunner = createMockTaskRunner();
    const { daemon, wsClientMock } = buildDaemon({ client, taskRunner });
    track(daemon);

    await daemon.start();
    wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: { leaseId: 'L5' },
    });
    await sleep(40);
    // runLease 仍跑完，complete 失败但 daemon 仍 running
    expect(taskRunner.runLease).toHaveBeenCalledOnce();
    expect(daemon.isRunning).toBe(true);
    await daemon.stop();
  });

  // AC-08: WS 消息分发
  it('AC-08: HEARTBEAT_ACK 消息仅 debug 不触发副作用', async () => {
    const client = createMockClient();
    const { daemon, wsClientMock } = buildDaemon({ client });
    track(daemon);

    await daemon.start();
    expect(() =>
      wsClientMock._injectMessage({
        type: MSG.HEARTBEAT_ACK,
        payload: { runtime_id: 'srv-rid-1' },
      }),
    ).not.toThrow();
    await sleep(20);
    expect(client.claimLease).not.toHaveBeenCalled();
    await daemon.stop();
  });

  it('AC-08b: 未知 WS 消息类型仅 warn 不抛异常', async () => {
    const { daemon, wsClientMock } = buildDaemon({});
    track(daemon);
    await daemon.start();
    expect(() =>
      wsClientMock._injectMessage({
        type: 'daemon:unknown_xyz',
        payload: {},
      }),
    ).not.toThrow();
    await daemon.stop();
  });

  it('AC-08c: task_available 缺 leaseId 仅 warn 不崩', async () => {
    const client = createMockClient();
    const taskRunner = createMockTaskRunner();
    const { daemon, wsClientMock } = buildDaemon({ client, taskRunner });
    track(daemon);
    await daemon.start();
    expect(() =>
      wsClientMock._injectMessage({
        type: MSG.TASK_AVAILABLE,
        payload: {},
      }),
    ).not.toThrow();
    await sleep(30);
    expect(client.claimLease).not.toHaveBeenCalled();
    await daemon.stop();
  });

  // ql-20260616-006：backend WS 发 snake_case，daemon 兼容读取
  it('ql-20260616-006：task_available 收到 snake_case (lease_id/runtime_id) 也能正常 claim', async () => {
    const client = createMockClient();
    client.claimLease.mockResolvedValueOnce({
      claim_token: 'tok-snake',
      payload: { prompt: 'hello', provider: 'claude' },
    });
    client.startLease.mockResolvedValueOnce({});
    client.completeLease.mockResolvedValueOnce({});
    const taskRunner = createMockTaskRunner();
    taskRunner.runLease.mockResolvedValueOnce({
      ok: true,
      patch: '',
      stats: {},
      status: 'completed',
    });
    const { daemon, wsClientMock } = buildDaemon({ client, taskRunner });
    track(daemon);
    await daemon.start();

    // 模拟 backend WS 真实发送的 snake_case payload
    wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: {
        runtime_id: 'srv-rid-snake',
        task_id: null,
        lease_id: 'lease-snake-001',
      },
    });
    await sleep(60);

    expect(client.claimLease).toHaveBeenCalledTimes(1);
    expect(client.claimLease).toHaveBeenCalledWith('lease-snake-001', 'srv-rid-snake');
    await daemon.stop();
  });

  // AC-09: AbortController 中断
  it('AC-09: stop 时 AbortController 触发 abortableSleep 立即退出', async () => {
    const client = createMockClient();
    const cfg: Partial<DaemonConfig> = {
      heartbeat_interval: 10, // 长 sleep
      poll_interval: 10,
    };
    const { daemon } = buildDaemon({ client, config: cfg });
    track(daemon);

    await daemon.start();
    await sleep(20);
    const t0 = Date.now();
    await daemon.stop();
    const elapsed = Date.now() - t0;
    // stop 应在 10s sleep 走完之前就退出（AbortController 立即触发）
    expect(elapsed).toBeLessThan(2000);
  });

  // AC-10: 心跳容错（对齐 Python test_heartbeat_survives_errors）
  it('AC-10: 单个 rid heartbeat 抛错 → 循环不崩，后续心跳继续', async () => {
    const client = createMockClient();
    // 前 2 次 heartbeat 抛错，第 3 次起正常
    client.heartbeat
      .mockRejectedValueOnce(new Error('net timeout'))
      .mockRejectedValueOnce(new Error('conn refused'));
      // 后续默认 mockResolvedValue({})
    const { daemon } = buildDaemon({ client });
    track(daemon);

    await daemon.start();
    // 等足够多拍让心跳跑 3+ 次（20ms 间隔）
    await sleep(120);
    await daemon.stop();

    // 心跳被调 3+ 次（前 2 次失败未中断循环）
    expect(client.heartbeat.mock.calls.length).toBeGreaterThanOrEqual(3);
    // daemon 仍正常 stop（未崩）
    expect(daemon.isRunning).toBe(false);
  });

  // AC-11: 心跳只用 registered runtimes（对齐 Python test_heartbeat_only_uses_registered_runtimes）
  it('AC-11: 心跳遍历 _registeredRuntimes 的 server id，不含 config.runtime_id', async () => {
    const client = createMockClient();
    // register 返回固定 server id（区别于 config.runtime_id）
    client.register.mockResolvedValue({ id: 'srv-allocated-rid' });
    const { daemon } = buildDaemon({ client });
    track(daemon);

    await daemon.start();
    await sleep(80);
    await daemon.stop();

    // 心跳调用的 rid 全部是 server 分配的 'srv-allocated-rid'，不含 config 的 'runtime-uuid-123'
    const heartbeatedRids = client.heartbeat.mock.calls.map((c) => c[0] as string);
    expect(heartbeatedRids.length).toBeGreaterThan(0);
    for (const rid of heartbeatedRids) {
      expect(rid).toBe('srv-allocated-rid');
      expect(rid).not.toBe('runtime-uuid-123');
    }
  });
});
