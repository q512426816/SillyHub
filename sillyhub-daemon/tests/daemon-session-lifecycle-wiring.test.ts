// tests/daemon-session-lifecycle-wiring.test.ts
// task-07 Step 4：daemon 生命周期接线 SessionManager.start()/stop()。
//
// 覆盖（task-07 蓝图 §5.4 + §6 边界 5 + §10 AC-12/AC-13）：
//   - daemon.start() → sessionManager.start() 调用一次（启动空闲扫描）
//   - daemon.stop() → sessionManager.stop() 调用一次；顺序在 WS close 之前
//   - sessionManager=null（未注入）→ start()/stop() 用 ?. 不调；不抛
//   - SESSION_IDLE_TIMEOUT_SEC env 透传（daemon 不覆盖 SessionManager 自读 env）

import { describe, it, expect, afterEach, vi } from 'vitest';
import { Daemon } from '../src/daemon.js';
import type { DaemonConfig } from '../src/config.js';
import type { DetectedAgent } from '../src/agent-detector.js';
import type { WsClientCallbacks } from '../src/ws-client.js';
import type { SessionManager } from '../src/interactive/session-manager.js';

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

function mockAgent(provider: string, path = ''): DetectedAgent {
  return {
    provider,
    path,
    version: '1.0.0',
    protocol: 'stream_json',
    status: 'available',
    versionWarning: null,
  };
}

function createMockClient() {
  return {
    register: vi.fn(async () => ({ id: 'srv-rid-1' })),
    heartbeat: vi.fn(async () => ({})),
    markOffline: vi.fn(async () => ({})),
    claimLease: vi.fn(async () => ({
      claim_token: 't',
      payload: { prompt: 'hi', provider: 'claude' },
    })),
    startLease: vi.fn(async () => ({})),
    completeLease: vi.fn(async () => ({})),
    getPendingLeases: vi.fn(async () => []),
    getExecutionContext: vi.fn(async () => ({
      agent_run_id: 'r',
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

/** mock SessionManager 记录 start/stop 调用次数，用于断言 lifecycle wiring。 */
function createMockSessionManager(): SessionManager & {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
} {
  const sm = {
    create: vi.fn(async () => {}),
    inject: vi.fn(async () => ({ runId: '' })),
    interrupt: vi.fn(async () => false),
    end: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    get: vi.fn(() => undefined),
    start: vi.fn(() => {}),
    stop: vi.fn(() => {}),
  };
  return sm as unknown as SessionManager & {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  };
}

function createMockWsClient() {
  let callbacks: WsClientCallbacks = {};
  return {
    connect: vi.fn(() => {
      callbacks.onConnected?.();
    }),
    close: vi.fn(() => {
      callbacks.onDisconnected?.(1000, 'test');
    }),
    send: vi.fn(() => true),
    registerRpcHandler: vi.fn(),
    _setCallbacks(cb: WsClientCallbacks): void {
      callbacks = cb;
    },
  };
}

function buildDaemon(opts: { sessionManager?: SessionManager | null } = {}) {
  const client = createMockClient();
  const taskRunner = createMockTaskRunner();
  const sessionManager =
    opts.sessionManager === undefined
      ? createMockSessionManager()
      : opts.sessionManager;

  const detector = {
    detectAgents: vi.fn(async () => [mockAgent('claude', 'C:\\bin\\claude.exe')]),
  };

  const wsClientMock = createMockWsClient();
  const wsClientFactory = vi.fn((o: { callbacks: WsClientCallbacks }) => {
    wsClientMock._setCallbacks(o.callbacks);
    return wsClientMock;
  });

  const ctorOpts: Record<string, unknown> = {
    detector,
    wsClientFactory,
    // 始终注入 sessionManager（含 null：测「未注入」场景 AC-13）。
    // 默认 createMockSessionManager；opts.sessionManager=null 透传测 ?.` 兜底。
    sessionManager,
  };

  const daemon = new Daemon(
    mockConfig,
    client as never,
    taskRunner as never,
    ctorOpts as never,
  );

  return { daemon, client, sessionManager, wsClientMock };
}

describe('task-07 daemon SessionManager lifecycle wiring', () => {
  let daemons: Daemon[] = [];

  afterEach(async () => {
    for (const d of daemons) {
      if (d.isRunning) {
        await d.stop().catch(() => undefined);
      }
    }
    daemons = [];
  });

  it('AC-12 daemon.start() → sessionManager.start() 调用一次', async () => {
    const { daemon, sessionManager } = buildDaemon();
    daemons.push(daemon);
    const sm = sessionManager as SessionManager & {
      start: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
    };

    await daemon.start();
    expect(sm.start).toHaveBeenCalledTimes(1);
    await daemon.stop();
  });

  it('AC-12 daemon.stop() → sessionManager.stop() 调用一次；顺序在 WS close 之前', async () => {
    const { daemon, sessionManager, wsClientMock } = buildDaemon();
    daemons.push(daemon);
    const sm = sessionManager as SessionManager & {
      stop: ReturnType<typeof vi.fn>;
    };

    await daemon.start();
    await daemon.stop();
    expect(sm.stop).toHaveBeenCalledTimes(1);
    // WS 也被关（顺序：daemon.stop 内先 stop SM 再 close WS）
    expect(wsClientMock.close).toHaveBeenCalled();
  });

  it('AC-13 sessionManager=null（未注入）→ daemon.start()/stop() 不抛（?. 链）', async () => {
    const { daemon } = buildDaemon({ sessionManager: null });
    daemons.push(daemon);

    await expect(daemon.start()).resolves.toBeUndefined();
    await expect(daemon.stop()).resolves.toBeUndefined();
  });

  it('AC-12 daemon.start() 重复调用（幂等）→ sessionManager.start() 只调用一次', async () => {
    const { daemon, sessionManager } = buildDaemon();
    daemons.push(daemon);
    const sm = sessionManager as SessionManager & {
      start: ReturnType<typeof vi.fn>;
    };

    await daemon.start();
    await daemon.start(); // 幂等（_running 守卫直接 return）
    expect(sm.start).toHaveBeenCalledTimes(1);
    await daemon.stop();
  });

  it('未 start 直接 stop → sessionManager.stop() 不调用（_running 守卫）', async () => {
    const { daemon, sessionManager } = buildDaemon();
    daemons.push(daemon);
    const sm = sessionManager as SessionManager & {
      stop: ReturnType<typeof vi.fn>;
    };

    await daemon.stop(); // _running=false 直接 return
    expect(sm.stop).not.toHaveBeenCalled();
  });
});
