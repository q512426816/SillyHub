// tests/daemon-mcp-user-id-wiring.test.ts
// task-06（2026-09-10-mcp-central-registry / D-008@v2 / FR-05）接线验证：
// daemon `_runLeaseStateMachine` 把 claim payload 的 user_id/userId（context.py
// task-06 双写 snake + camel）归一化为 execPayload.userId，且 `_startInteractiveSession`
// 的 MCP 三件套预取（mcpStep）调 `fetchMcpBundle` 时把它作为 user_id 查询参数
// 发给 `GET /api/daemon/mcp/config`（backend 按 platform ∪ user 渲染，D-010 lease
// 归属强校验）。
//
// 模式照搬 daemon-budget-wiring.test.ts（helper 自包含复制；断言点换成 global
// fetch 的 URL）。URL 级断言放本文件（端到端 wiring）；URL 组装单测在
// mcp-config.test.ts 的 task-06 describe（三态）。

import { describe, it, expect, afterEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { Daemon } from '../src/daemon.js';
import type { DaemonConfig } from '../src/config.js';
import { MSG } from '../src/protocol.js';
import type { WsClientCallbacks } from '../src/ws-client.js';
import type { SessionManager } from '../src/interactive/session-manager.js';

// ── fixture（对齐 daemon-budget-wiring.test.ts）─────────────────────────────────

const mockConfig: DaemonConfig = {
  server_url: 'http://127.0.0.1:8000',
  token: 'test-token',
  runtime_id: 'runtime-uuid-mcpuid',
  profile: 'default',
  workspace_dir: '/tmp/ws-mcpuid',
  poll_interval: 0.02,
  heartbeat_interval: 0.02,
  max_concurrent_tasks: 5,
  log_level: 'debug',
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

/** 等待 fetch spy 出现命中 MCP 端点的调用（版本检查等先发请求会先入队）。 */
async function waitForMcpFetchCall(
  fetchSpy: { mock: { calls: unknown[][] } },
  { timeout = 3000, interval = 15 }: { timeout?: number; interval?: number } = {},
): Promise<string> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const hit = fetchSpy.mock.calls
      .map((c) => String(c[0]))
      .find((u) => u.includes('/api/daemon/mcp/config'));
    if (hit) return hit;
    await sleep(interval);
  }
  throw new Error('waitForMcpFetchCall: MCP 端点 fetch 未在时限内发生');
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

function createMockSessionManager(): SessionManager {
  const sm = {
    create: vi.fn(async () => {}),
    inject: vi.fn(async () => ({ runId: '' })),
    interrupt: vi.fn(async () => false),
    end: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    get: vi.fn(() => undefined),
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

function buildDaemon() {
  const client = createMockClient();
  const taskRunner = createMockTaskRunner();
  const sessionManager = createMockSessionManager();

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

  const wsClientMock = createMockWsClient();
  const wsClientFactory = vi.fn((o: { callbacks: WsClientCallbacks }) => {
    wsClientMock._setCallbacks(o.callbacks);
    return wsClientMock;
  });

  const daemon = new Daemon(
    mockConfig,
    client as never,
    taskRunner as never,
    { detector, wsClientFactory, sessionManager } as never,
  );

  return { daemon, client, sessionManager, wsClientMock };
}

// MCP 三件套预取成功响应（fetchMcpBundle 消费的三键形状）。
const okBundleBody = {
  platform_default: { mcpServers: { web: { command: 'w', args: [] } } },
  whitelist: ['web'],
  workspace: { mcpServers: {} },
};

// ── 测试 ──────────────────────────────────────────────────────────────────────

describe('task-06 / D-008@v2：claim payload user_id → MCP 预取查询参数', () => {
  let daemons: Daemon[] = [];

  afterEach(async () => {
    for (const d of daemons) {
      if (d.isRunning) {
        await d.stop().catch(() => undefined);
      }
    }
    daemons = [];
    vi.restoreAllMocks();
  });

  function track<T extends Daemon>(d: T): T {
    daemons.push(d);
    return d;
  }

  it('interactive: claim payload user_id（snake）→ 预取 URL 含 user_id（workspace 会话）', async () => {
    const { daemon, client, wsClientMock } = buildDaemon();
    track(daemon);
    // 每次调用返回全新 Response（daemon 启动期多个消费方共享 global fetch，
    // mockResolvedValue 单实例会在首个消费者读 body 后报 Body already read）。
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response(JSON.stringify(okBundleBody), { status: 200 }));

    await daemon.start();
    client.claimLease.mockResolvedValueOnce({
      claim_token: 'token-uid1',
      payload: {
        kind: 'interactive',
        prompt: 'hi',
        provider: 'claude',
        agent_session_id: 'sess-uid1',
        agent_run_id: 'run-uid1',
        root_path: tmpdir(),
        workspace_id: 'ws-uid-1',
        // context.py task-06 双写 snake_case（优先源）
        user_id: 'user-aaaa-1111',
      },
    });

    wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: {
        leaseId: 'lease-uid1',
        kind: 'interactive',
        prompt: 'hi',
        agentSessionId: 'sess-uid1',
        agentRunId: 'run-uid1',
        rootPath: tmpdir(),
      },
    });
    const calledUrl = await waitForMcpFetchCall(fetchSpy);
    expect(calledUrl).toContain('/api/daemon/mcp/config?');
    expect(calledUrl).toContain('workspace_id=ws-uid-1');
    expect(calledUrl).toContain('user_id=user-aaaa-1111');
    await daemon.stop();
  });

  it('interactive: claim payload userId（camel）→ camel 兜底同样透传', async () => {
    const { daemon, client, wsClientMock } = buildDaemon();
    track(daemon);
    // 每次调用返回全新 Response（daemon 启动期多个消费方共享 global fetch，
    // mockResolvedValue 单实例会在首个消费者读 body 后报 Body already read）。
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response(JSON.stringify(okBundleBody), { status: 200 }));

    await daemon.start();
    client.claimLease.mockResolvedValueOnce({
      claim_token: 'token-uid2',
      payload: {
        kind: 'interactive',
        prompt: 'hi',
        provider: 'claude',
        agent_session_id: 'sess-uid2',
        agent_run_id: 'run-uid2',
        root_path: tmpdir(),
        workspace_id: 'ws-uid-2',
        // 仅 camelCase（兼容双写的 camel 兜底分支）
        userId: 'user-bbbb-2222',
      },
    });

    wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: {
        leaseId: 'lease-uid2',
        kind: 'interactive',
        prompt: 'hi',
        agentSessionId: 'sess-uid2',
        agentRunId: 'run-uid2',
        rootPath: tmpdir(),
      },
    });
    const calledUrl = await waitForMcpFetchCall(fetchSpy);
    expect(calledUrl).toContain('user_id=user-bbbb-2222');
    await daemon.stop();
  });

  it('interactive: claim 无 user_id → 预取 URL 不含 user_id（platform only，向后兼容）', async () => {
    const { daemon, client, wsClientMock } = buildDaemon();
    track(daemon);
    // 每次调用返回全新 Response（daemon 启动期多个消费方共享 global fetch，
    // mockResolvedValue 单实例会在首个消费者读 body 后报 Body already read）。
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response(JSON.stringify(okBundleBody), { status: 200 }));

    await daemon.start();
    client.claimLease.mockResolvedValueOnce({
      claim_token: 'token-uid3',
      payload: {
        kind: 'interactive',
        prompt: 'hi',
        provider: 'claude',
        agent_session_id: 'sess-uid3',
        agent_run_id: 'run-uid3',
        root_path: tmpdir(),
        workspace_id: 'ws-uid-3',
        // 无 user_id / userId（旧 backend）
      },
    });

    wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: {
        leaseId: 'lease-uid3',
        kind: 'interactive',
        prompt: 'hi',
        agentSessionId: 'sess-uid3',
        agentRunId: 'run-uid3',
        rootPath: tmpdir(),
      },
    });
    const calledUrl = await waitForMcpFetchCall(fetchSpy);
    expect(calledUrl).toContain('workspace_id=ws-uid-3');
    expect(calledUrl).not.toContain('user_id=');
    await daemon.stop();
  });
});
