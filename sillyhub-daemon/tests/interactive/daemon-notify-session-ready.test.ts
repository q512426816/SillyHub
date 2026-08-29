// tests/interactive/daemon-notify-session-ready.test.ts
// task-11（2026-08-07-inject-wait-session-ready / FR-05）：daemon notifySessionReady
// 上报单测——验证 fresh create 与 recover（SESSION_RESUME）完成时正确上报 ready，
// 且 best-effort 上报失败不阻塞 daemon 主流程；失败路径不上报。
//
// 覆盖（task-11.md acceptance + design Phase 1）：
//   - fresh create（_startInteractiveSession）：create 成功 → notifySessionReady
//     被调一次且 sessionId 正确。
//   - recover（_routeSessionResume）：markReconnected 成功 → notifySessionReady
//     被调一次且 sessionId 正确。
//   - best-effort：mock notifySessionReady reject/throw → daemon 主流程仍 resolve，
//     不向上抛（fresh 路径由 create try/catch 收敛；recover 路径由 WS dispatch
//     void .catch 收敛）。
//   - 失败路径：create 抛错 / restoreAndReconnect 抛错 → notifySessionReady 不被调。
//
// 复用现有 mock 范式（constraints: 鸭子类型 mock client + mock SessionManager，全 mock）：
//   - fresh create 路径参照 daemon-kind-dispatch.test.ts（daemon.start() + WS
//     TASK_AVAILABLE 注入 + claimLease mock 触发 _startInteractiveSession）。
//   - recover 路径参照 daemon-session-resume-route.test.ts（直接 _handleWsMessage
//     注入 SESSION_RESUME，触发 _routeSessionResume → restoreAndReconnect +
//     markReconnected → notifySessionReady）。
//
// 全 mock 不连真实 backend（不发 HTTP/WS）；mock driver（不 spawn 真实 claude）。

import { describe, it, expect, afterEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { Daemon } from '../../src/daemon.js';
import { MSG } from '../../src/protocol.js';
import type { DaemonConfig } from '../../src/config.js';
import type { DetectedAgent } from '../../src/agent-detector.js';
import type { WsClientCallbacks } from '../../src/ws-client.js';
import type { SessionManager } from '../../src/interactive/session-manager.js';

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
  // cwd 守卫对 workspace 绑定会话做 allowed_roots 白名单终检——夹具 cwd 已是真实
  // tmpdir()（interactiveClaimPayload），补白名单即走正常守卫通过路径。
  allowed_roots: [tmpdir()],
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

/**
 * 轮询等待 vi.fn spy 被调用（替代固定 sleep，消除满载 fork 池竞态）。
 * 复用 daemon-kind-dispatch.test.ts 同款 helper：WS→claim→_runLeaseStateMachine
 * →_startInteractiveSession→sessionManager.create 异步链需多次 event loop tick。
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
  notifyRunResult: ReturnType<typeof vi.fn>;
  notifySessionEnd: ReturnType<typeof vi.fn>;
  notifySessionReady: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

/**
 * mock hubClient（鸭子类型 ClientLike）：含 notifySessionReady mock fn。
 * notifyReadyImpl 允许覆盖（测 best-effort reject 场景）。
 */
function createMockClient(notifyReadyImpl?: ReturnType<typeof vi.fn>): MockClient {
  return {
    register: vi.fn(async () => ({
      daemon_instance_id: 'srv-inst',
      runtimes: [{ provider: 'claude', runtime_id: 'srv-rid-1' }],
    })),
    heartbeat: vi.fn(async () => ({})),
    markOffline: vi.fn(async () => ({})),
    claimLease: vi.fn(async () => ({ claim_token: 't', payload: {} })),
    startLease: vi.fn(async () => ({})),
    submitMessages: vi.fn(async () => ({})),
    completeLease: vi.fn(async () => ({})),
    getPendingLeases: vi.fn(async () => []),
    getExecutionContext: vi.fn(async () => ({ agent_run_id: 'r', claude_md: '' })),
    notifyRunResult: vi.fn(async () => ({})),
    notifySessionEnd: vi.fn(async () => ({})),
    notifySessionReady: notifyReadyImpl ?? vi.fn(async () => {}),
    close: vi.fn(),
  };
}

/** mock SessionManager：create / restoreAndReconnect / markReconnected 等均 vi.fn。 */
function createMockSessionManager(): SessionManager {
  return {
    create: vi.fn(async () => {}),
    inject: vi.fn(async () => ({ runId: '' })),
    interrupt: vi.fn(async () => false),
    end: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    // resume 时 session 尚未在 store → get 返回 undefined（真实情形）。
    get: vi.fn(() => undefined),
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
 * fresh create 路径需 wsClientFactory + 非 null taskRunner（TASK_AVAILABLE 守卫
 * 检查 _taskRunner 真假，:2495）；interactive 路径本身不调 runLease。
 */
function buildDaemon(opts: {
  client?: MockClient;
  sessionManager?: SessionManager;
  agentPath?: string;
} = {}) {
  const client = opts.client ?? createMockClient();
  const sessionManager = opts.sessionManager ?? createMockSessionManager();
  const agentPath = opts.agentPath ?? 'C:\\bin\\claude.exe';
  // 非 null 占位：TASK_AVAILABLE 守卫需要 _taskRunner 真（interactive 不调 runLease）。
  const taskRunner = { runLease: vi.fn(async () => ({ success: true })) };

  const detector = {
    detectAgents: vi.fn(async () => [mockAgent('claude', agentPath)]),
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

/**
 * 直调 _handleWsMessage（private）注入 WS 消息（recover 路径用，同
 * daemon-session-resume-route.test.ts 的 emit helper）。不需要 daemon.start()，
 * _routeSessionResume 只依赖构造时注入的 _sessionManager + _client。
 */
async function emit(
  daemon: Daemon,
  msg: { type: string; payload: unknown },
): Promise<void> {
  const handle = (
    daemon as unknown as {
      _handleWsMessage: (m: { type: string; payload: unknown }) => Promise<void>;
    }
  )._handleWsMessage.bind(daemon);
  await handle(msg);
}

/** fresh create interactive lease 的标准 claim 响应 + WS payload（cwd 用 tmpdir 跨平台）。 */
function interactiveClaimPayload(sessionId: string, runId: string, leaseId: string) {
  const cwd = tmpdir();
  return {
    claimResp: {
      claim_token: `token-${sessionId}`,
      payload: {
        kind: 'interactive' as const,
        prompt: 'hi',
        provider: 'claude',
        agent_session_id: sessionId,
        agent_run_id: runId,
        root_path: cwd,
      },
    },
    wsPayload: {
      leaseId,
      kind: 'interactive' as const,
      prompt: 'hi',
      agentSessionId: sessionId,
      agentRunId: runId,
      rootPath: cwd,
    },
  };
}

// ── 测试 ──────────────────────────────────────────────────────────────────────

describe('daemon notifySessionReady 上报（task-11 / FR-05）', () => {
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

  // ── fresh create 路径（_startInteractiveSession）───────────────────────────

  describe('fresh create 路径（_startInteractiveSession create 成功后上报）', () => {
    it('create 成功 → notifySessionReady 调一次 + sessionId 正确', async () => {
      const client = createMockClient();
      const sessionManager = createMockSessionManager();
      const { daemon, wsClientMock } = buildDaemon({ client, sessionManager });
      track(daemon);

      await daemon.start();
      const { claimResp, wsPayload } = interactiveClaimPayload(
        'sess-fresh-1',
        'run-1',
        'lease-fresh-1',
      );
      client.claimLease.mockResolvedValueOnce(claimResp);

      wsClientMock._injectMessage({ type: MSG.TASK_AVAILABLE, payload: wsPayload });
      // 等 create 成功 → notifySessionReady 触发（异步链多 tick）。
      await waitForSpy(
        client.notifySessionReady as unknown as { mock: { calls: unknown[][] } },
      );

      expect(sessionManager.create).toHaveBeenCalledOnce();
      expect(client.notifySessionReady).toHaveBeenCalledOnce();
      expect(client.notifySessionReady).toHaveBeenCalledWith('sess-fresh-1');
      await daemon.stop();
    });

    it('best-effort: notifySessionReady reject → daemon 主流程不崩（create try/catch 收敛）', async () => {
      // notifySessionReady reject → _startInteractiveSession 内 create 同 try/catch
      //（:3341 catch）收敛为 error 日志，方法 resolve；daemon 继续运行不抛。
      const client = createMockClient(
        vi.fn(async () => {
          throw new Error('ready POST network down');
        }),
      );
      const sessionManager = createMockSessionManager();
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { daemon, wsClientMock } = buildDaemon({ client, sessionManager });
      track(daemon);

      await daemon.start();
      const { claimResp, wsPayload } = interactiveClaimPayload(
        'sess-be-fresh-1',
        'run-be-1',
        'lease-be-fresh-1',
      );
      client.claimLease.mockResolvedValueOnce(claimResp);

      wsClientMock._injectMessage({ type: MSG.TASK_AVAILABLE, payload: wsPayload });
      // 等 create 先跑完（notifySessionReady 在 create 后）。
      await waitForSpy(
        sessionManager.create as unknown as { mock: { calls: unknown[][] } },
      );
      // 给 notifySessionReady reject + catch 收敛留窗口。
      await sleep(50);

      // daemon 仍 running（主循环不受 ready 上报失败影响）。
      expect(daemon.isRunning).toBe(true);
      // create 已成功执行（ready 失败不阻止 create 本身）。
      expect(sessionManager.create).toHaveBeenCalledOnce();
      // notifySessionReady 确实被调（只是 reject 了）。
      expect(client.notifySessionReady).toHaveBeenCalledWith('sess-be-fresh-1');
      await daemon.stop();
      errorSpy.mockRestore();
    });

    it('create 抛错 → notifySessionReady 不调（失败不上报）', async () => {
      const client = createMockClient();
      const sessionManager = createMockSessionManager();
      // create 抛错（executable wrapper 解析失败等）。
      (sessionManager.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('ClaudeExecutableNotFoundError: wrapper parse failed'),
      );
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { daemon, wsClientMock } = buildDaemon({ client, sessionManager });
      track(daemon);

      await daemon.start();
      const { claimResp, wsPayload } = interactiveClaimPayload(
        'sess-fail-fresh-1',
        'run-fail-1',
        'lease-fail-fresh-1',
      );
      client.claimLease.mockResolvedValueOnce(claimResp);

      wsClientMock._injectMessage({ type: MSG.TASK_AVAILABLE, payload: wsPayload });
      await waitForSpy(
        sessionManager.create as unknown as { mock: { calls: unknown[][] } },
      );
      // 给 catch 收敛留窗口，确认 notifySessionReady 不被调。
      await sleep(50);

      expect(sessionManager.create).toHaveBeenCalledOnce();
      // 失败路径不上报 ready（backend 由 DaemonRuntimeOffline 兜底）。
      expect(client.notifySessionReady).not.toHaveBeenCalled();
      await daemon.stop();
      errorSpy.mockRestore();
    });

    it('create 抛错 → notifyRunResult 回传 failed（P2b/daemon H4：run 不再永久 pending）', async () => {
      // 2026-08-24 会话审查 P2b：interactive lease lease_expires_at=NULL + WS 不失活
      // 时 backend 永不收 failed → run 永远 pending。create 失败必须主动回传。
      const client = createMockClient();
      const sessionManager = createMockSessionManager();
      (sessionManager.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('ClaudeExecutableNotFoundError: wrapper parse failed'),
      );
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { daemon, wsClientMock } = buildDaemon({ client, sessionManager });
      track(daemon);

      await daemon.start();
      const { claimResp, wsPayload } = interactiveClaimPayload(
        'sess-fail-report-1',
        'run-fail-report-1',
        'lease-fail-report-1',
      );
      client.claimLease.mockResolvedValueOnce(claimResp);

      wsClientMock._injectMessage({ type: MSG.TASK_AVAILABLE, payload: wsPayload });
      await waitForSpy(
        client.notifyRunResult as unknown as { mock: { calls: unknown[][] } },
      );

      expect(client.notifyRunResult).toHaveBeenCalledTimes(1);
      const call = (
        client.notifyRunResult as unknown as { mock: { calls: unknown[][] } }
      ).mock.calls[0]!;
      const [, , runId, body] = call as [string, string, string, Record<string, unknown>];
      expect(runId).toBe('run-fail-report-1');
      expect(body.status).toBe('error_during_execution');
      expect(body.is_error).toBe(true);
      expect(String(body.result_summary)).toContain('create failed');
      await daemon.stop();
      errorSpy.mockRestore();
    });
  });

  // ── recover 路径（SESSION_RESUME → _routeSessionResume）─────────────────────

  describe('recover 路径（_routeSessionResume markReconnected 后上报）', () => {
    it('SESSION_RESUME 成功（markReconnected 后）→ notifySessionReady 调一次 + sessionId 正确', async () => {
      const client = createMockClient();
      const sessionManager = createMockSessionManager();
      const { daemon } = buildDaemon({ client, sessionManager });
      track(daemon);

      await emit(daemon, {
        type: MSG.SESSION_RESUME,
        payload: {
          session_id: 'sess-recover-1',
          lease_id: 'lease-recover-1',
          agent_session_id: 'agent-sid-recover-1',
          cwd: tmpdir(),
          provider: 'claude',
        },
      });
      // void Promise 分发，等 microtask 跑完 restore + markReconnected + notify。
      await sleep(30);

      expect(sessionManager.restoreAndReconnect).toHaveBeenCalledOnce();
      expect(sessionManager.markReconnected).toHaveBeenCalledWith('sess-recover-1');
      expect(client.notifySessionReady).toHaveBeenCalledOnce();
      expect(client.notifySessionReady).toHaveBeenCalledWith('sess-recover-1');
    });

    it('best-effort: notifySessionReady reject → daemon 不崩（WS dispatch void .catch 收敛）', async () => {
      // notifySessionReady reject → _routeSessionResume 无 try/catch → 传播到
      // _handleWsMessage 的 `void _routeSessionControl(...).catch(e => error)`
      //（:2564）→ 记 error 不崩，emit 本身 resolve（void fire-and-forget）。
      const client = createMockClient(
        vi.fn(async () => {
          throw new Error('ready POST network down');
        }),
      );
      const sessionManager = createMockSessionManager();
      const { daemon } = buildDaemon({ client, sessionManager });
      track(daemon);
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // emit 走 _handleWsMessage → void dispatch → emit 立即 resolve。
      await expect(
        emit(daemon, {
          type: MSG.SESSION_RESUME,
          payload: {
            session_id: 'sess-be-rec-1',
            lease_id: 'lease-be-rec-1',
            agent_session_id: 'agent-sid-be-rec-1',
            cwd: tmpdir(),
            provider: 'claude',
          },
        }),
      ).resolves.toBeUndefined();
      // 等 void Promise 的 .catch 跑完。
      await sleep(50);

      // recover 主流程不受 ready 上报失败影响：restore + markReconnected 已执行。
      expect(sessionManager.restoreAndReconnect).toHaveBeenCalledOnce();
      expect(sessionManager.markReconnected).toHaveBeenCalledOnce();
      // notifySessionReady 确实被调（只是 reject 了）。
      expect(client.notifySessionReady).toHaveBeenCalledWith('sess-be-rec-1');
      errorSpy.mockRestore();
    });

    it('restoreAndReconnect 抛错 → notifySessionReady 不调（失败不上报）', async () => {
      const client = createMockClient();
      const sessionManager = createMockSessionManager();
      // restoreAndReconnect 抛错（driver.start 同步失败：cwd 不匹配等）。
      (
        sessionManager.restoreAndReconnect as ReturnType<typeof vi.fn>
      ).mockRejectedValueOnce(new Error('driver.start sync failed: cwd mismatch'));
      const { daemon } = buildDaemon({ client, sessionManager });
      track(daemon);
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // _routeSessionResume 无 try/catch → 抛到 _handleWsMessage void .catch。
      // emit 本身 resolve（void fire-and-forget），不向上抛。
      await expect(
        emit(daemon, {
          type: MSG.SESSION_RESUME,
          payload: {
            session_id: 'sess-fail-rec-1',
            lease_id: 'lease-fail-rec-1',
            agent_session_id: 'agent-sid-fail-rec-1',
            cwd: tmpdir(),
            provider: 'claude',
          },
        }),
      ).resolves.toBeUndefined();
      await sleep(30);

      expect(sessionManager.restoreAndReconnect).toHaveBeenCalledOnce();
      // 抛错短路：markReconnected 不调。
      expect(sessionManager.markReconnected).not.toHaveBeenCalled();
      // 失败不上报。
      expect(client.notifySessionReady).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });
});
