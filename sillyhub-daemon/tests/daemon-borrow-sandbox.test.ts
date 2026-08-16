// tests/daemon-borrow-sandbox.test.ts
// task-09 / D-007@v2（候选 B 主路径）：daemon `_startInteractiveSession` 借用沙箱检测。
//
// 覆盖：
//   1. 借用 lease（root_path = "borrow-sandbox:<slug>" marker）→ daemon 检测 marker，
//      lazy 创建 WorkspaceManager → prepareWorkspace(slug) 生成独立沙箱目录作 cwd，
//      sessionManager.create 收到 cwd=沙箱目录，sessionManager.registerBorrowSandbox
//      被调用登记沙箱（激活按 lease 隔离的只读 policy）；
//   2. 非借用 lease（root_path = 普通路径）→ registerBorrowSandbox 不调用，cwd=rootPath
//      （零回归）；
//   3. 沙箱目录确实在 <workspace_dir>/borrow-sandboxes/<slug> 下（与开发 mirror 隔离）。
//
// 测试范式照抄 daemon-kind-dispatch.test.ts（mock client/taskRunner/sessionManager +
// wsClient._injectMessage 驱动 lease 状态机）。

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
import type { WorkspaceManager } from '../src/workspace.js';

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

function mockAgent(provider: string, path: string): DetectedAgent {
  return {
    provider,
    path,
    version: '1.0.0',
    protocol: 'stream_json',
    status: 'available',
    versionWarning: null,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 轮询等谓词成立（ql-20260816-003：代替固定 sleep——满载下异步链可能 >80ms，
 *  固定 sleep 会在正断言处误判未调；轮询与 B 组 B1/B2/B3/B4 一致）。 */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(5);
  }
}

function createMockClient() {
  return {
    register: vi.fn(async () => ({
      daemon_instance_id: 'srv-inst',
      runtimes: [{ provider: 'claude', runtime_id: 'srv-rid-1' }],
    })),
    heartbeat: vi.fn(async () => ({})),
    markOffline: vi.fn(async () => ({})),
    claimLease: vi.fn(async () => ({
      claim_token: 'token-borrow',
      payload: { prompt: 'hi', provider: 'claude' },
    })),
    startLease: vi.fn(async () => ({})),
    submitMessages: vi.fn(async () => ({})),
    completeLease: vi.fn(async () => ({})),
    getPendingLeases: vi.fn(async () => []),
    getExecutionContext: vi.fn(async () => ({ agent_run_id: 'r' })),
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

/**
 * mock SessionManager：记录 create + registerBorrowSandbox 调用。
 * registerBorrowSandbox 是 task-09 新增 public 方法，daemon _startInteractiveSession
 * 检测 marker 后调用。
 */
function createMockSessionManager(): SessionManager & {
  registerBorrowSandbox: ReturnType<typeof vi.fn>;
} {
  const sm = {
    create: vi.fn(async () => {}),
    inject: vi.fn(async () => ({ runId: '' })),
    interrupt: vi.fn(async () => false),
    end: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    get: vi.fn((_sid: string) => undefined as Readonly<SessionState> | undefined),
    registerBorrowSandbox: vi.fn(),
  };
  return sm as unknown as SessionManager & {
    registerBorrowSandbox: ReturnType<typeof vi.fn>;
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

function buildDaemon(opts: {
  sessionManager: SessionManager;
  workspaceDir: string;
  borrowWorkspaceManager?: WorkspaceManager | null;
}) {
  const client = createMockClient();
  const taskRunner = createMockTaskRunner();
  const detector = {
    detectAgents: vi.fn(async () => [mockAgent('claude', 'C:\\bin\\claude.exe')]),
  };
  const wsClientMock = createMockWsClient();
  const wsClientFactory = vi.fn((o: { callbacks: WsClientCallbacks }) => {
    wsClientMock._setCallbacks(o.callbacks);
    return wsClientMock;
  });
  const config = { ...mockConfig, workspace_dir: opts.workspaceDir };

  const ctorOpts: Record<string, unknown> = {
    detector,
    wsClientFactory,
    sessionManager: opts.sessionManager,
  };
  if (opts.borrowWorkspaceManager !== undefined) {
    ctorOpts.borrowWorkspaceManager = opts.borrowWorkspaceManager;
  }

  const daemon = new Daemon(
    config,
    client as never,
    taskRunner as never,
    ctorOpts as never,
  );
  return { daemon, client, taskRunner, sessionManager: opts.sessionManager, wsClientMock };
}

describe('task-09 daemon 借用沙箱检测（_startInteractiveSession）', () => {
  let daemons: Daemon[] = [];
  let tmpDirs: string[] = [];

  afterEach(async () => {
    for (const d of daemons) {
      if (d.isRunning) {
        await d.stop().catch(() => undefined);
      }
    }
    daemons = [];
    for (const dir of tmpDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs = [];
  });

  function mkTmpDir(prefix: string): string {
    const dir = join(
      tmpdir(),
      `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    tmpDirs.push(dir);
    return dir;
  }

  it('借用 lease（rootPath=borrow-sandbox:<slug>）→ 沙箱创建 + cwd=沙箱 + registerBorrowSandbox 登记', async () => {
    const wsDir = mkTmpDir('silly-borrow-ws');
    const sessionManager = createMockSessionManager();
    const { daemon, client, wsClientMock } = buildDaemon({
      sessionManager,
      workspaceDir: wsDir,
    });
    daemons.push(daemon);

    await daemon.start();
    const slug = 'borrow-actor1-run1';
    client.claimLease.mockResolvedValueOnce({
      claim_token: 'token-borrow',
      payload: {
        kind: 'interactive',
        prompt: '帮我读源码出方案',
        provider: 'claude',
        agent_session_id: 'sess-borrow-1',
        agent_run_id: 'run-borrow-1',
        root_path: `borrow-sandbox:${slug}`,
      },
    });

    wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: {
        leaseId: 'lease-borrow-1',
        kind: 'interactive',
        prompt: '帮我读源码出方案',
        agentSessionId: 'sess-borrow-1',
        agentRunId: 'run-borrow-1',
        rootPath: `borrow-sandbox:${slug}`,
      },
    });
    await waitFor(() => (sessionManager.create as ReturnType<typeof vi.fn>).mock.calls.length > 0);

    // 1. create 被调用，cwd = 沙箱目录（不是 marker 字符串）。
    expect(sessionManager.create).toHaveBeenCalledOnce();
    const createArg = (sessionManager.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(typeof createArg.cwd).toBe('string');
    expect(createArg.cwd).not.toContain('borrow-sandbox:');
    expect(createArg.cwd).toContain(slug);

    // 2. 沙箱目录真实创建在 <workspace_dir>/borrow-sandboxes/<slug> 下。
    const expectedSandboxBase = join(wsDir, 'borrow-sandboxes');
    expect(createArg.cwd.startsWith(expectedSandboxBase)).toBe(true);
    expect(existsSync(createArg.cwd)).toBe(true);

    // 3. registerBorrowSandbox 被调用，登记 (sessionId, 沙箱目录)。
    expect(sessionManager.registerBorrowSandbox).toHaveBeenCalledOnce();
    expect(sessionManager.registerBorrowSandbox).toHaveBeenCalledWith(
      'sess-borrow-1',
      createArg.cwd,
    );
    await daemon.stop();
  });

  it('非借用 lease（rootPath=普通路径）→ registerBorrowSandbox 不调用，cwd=rootPath（零回归）', async () => {
    const wsDir = mkTmpDir('silly-borrow-noborrow');
    const sessionManager = createMockSessionManager();
    const { daemon, client, wsClientMock } = buildDaemon({
      sessionManager,
      workspaceDir: wsDir,
    });
    daemons.push(daemon);

    await daemon.start();
    client.claimLease.mockResolvedValueOnce({
      claim_token: 'token-normal',
      payload: {
        kind: 'interactive',
        prompt: '正常开发任务',
        provider: 'claude',
        agent_session_id: 'sess-dev-1',
        agent_run_id: 'run-dev-1',
        root_path: wsDir, // 普通真实路径，非 marker
      },
    });

    wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: {
        leaseId: 'lease-dev-1',
        kind: 'interactive',
        prompt: '正常开发任务',
        agentSessionId: 'sess-dev-1',
        agentRunId: 'run-dev-1',
        rootPath: wsDir,
      },
    });
    await waitFor(() => (sessionManager.create as ReturnType<typeof vi.fn>).mock.calls.length > 0);

    expect(sessionManager.create).toHaveBeenCalledOnce();
    const createArg = (sessionManager.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    // cwd = 普通路径（非沙箱）。
    expect(createArg.cwd).toBe(wsDir);
    // registerBorrowSandbox 不调用（非借用零回归）。
    expect(sessionManager.registerBorrowSandbox).not.toHaveBeenCalled();
    // borrow-sandboxes 目录不应被创建（lazy construct 不触发）。
    expect(existsSync(join(wsDir, 'borrow-sandboxes'))).toBe(false);
    await daemon.stop();
  });

  it('注入 borrowWorkspaceManager（测试可注入）→ 用注入实例的 prepareWorkspace 结果作 cwd', async () => {
    const wsDir = mkTmpDir('silly-borrow-injected');
    const sessionManager = createMockSessionManager();
    const injectedSandbox = mkTmpDir('silly-borrow-injected-sandbox');
    // 注入一个 mock WorkspaceManager，prepareWorkspace 返回固定沙箱路径。
    const borrowWsManager = {
      prepareWorkspace: vi.fn(async () => injectedSandbox),
    } as unknown as WorkspaceManager;
    const { daemon, client, wsClientMock } = buildDaemon({
      sessionManager,
      workspaceDir: wsDir,
      borrowWorkspaceManager: borrowWsManager,
    });
    daemons.push(daemon);

    await daemon.start();
    client.claimLease.mockResolvedValueOnce({
      claim_token: 'token-inj',
      payload: {
        kind: 'interactive',
        prompt: 'hi',
        provider: 'claude',
        agent_session_id: 'sess-inj-1',
        agent_run_id: 'run-inj-1',
        root_path: 'borrow-sandbox:borrow-x-y',
      },
    });

    wsClientMock._injectMessage({
      type: MSG.TASK_AVAILABLE,
      payload: {
        leaseId: 'lease-inj-1',
        kind: 'interactive',
        prompt: 'hi',
        agentSessionId: 'sess-inj-1',
        agentRunId: 'run-inj-1',
        rootPath: 'borrow-sandbox:borrow-x-y',
      },
    });
    // 流程是 prepareWorkspace → create：等 create（链末端）即保证 prepareWorkspace 已发生。
    await waitFor(() => (sessionManager.create as ReturnType<typeof vi.fn>).mock.calls.length > 0);

    // 注入实例的 prepareWorkspace 被调用，slug 提取正确（去掉 marker 前缀）。
    expect(borrowWsManager.prepareWorkspace).toHaveBeenCalledWith('borrow-x-y');
    const createArg = (sessionManager.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(createArg.cwd).toBe(injectedSandbox);
    expect(sessionManager.registerBorrowSandbox).toHaveBeenCalledWith(
      'sess-inj-1',
      injectedSandbox,
    );
    await daemon.stop();
  });
});
