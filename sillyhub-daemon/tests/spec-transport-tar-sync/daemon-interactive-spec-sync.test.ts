// tests/spec-transport-tar-sync/daemon-interactive-spec-sync.test.ts
// task-09（2026-06-23-spec-transport-tar-sync）B 组：daemon.ts interactive 接入集成测试。
//
// 守护 task-06 的 spec 同步 interactive 路径接入点（D-007@v1 / X-001 修正核心）：
//   - _startInteractiveSession tar 模式在 _sessionManager.create 之前 await pullSpecBundle（R-07 时序）
//   - onSessionEnd 在 notifySessionEnd 之后调 _postInteractiveSpecSync → postSpecSync（R-07 时序）
//   - R-03 容错：pull 5xx / sync 失败仅 warn，不阻塞 session 启动 / 不阻塞终态上报
//   - D-004 shared 模式零触发：不 pull、不 sync
//   - onSessionEnd 幂等（_interactiveSpecSyncCtx finally delete，二次进入查不到 ctx return）
//   - sessionManager null 安全（AC-14 过渡期）
//
// 铁律：
//   - vi.mock spec-sync.ts：B 组只验 daemon 调用契约（utility 内部行为是 A 组 spec-sync.test.ts 职责）
//   - mock SessionManager（create/get/end/fail）+ mock client（getSpecBundle/postSpecSync/notifySessionEnd）
//   - 不真实网络、不真实 driver spawn
//   - 时序断言用「手动控制 Promise」（B1）+「spy 顺序数组」（B5），不依赖 setTimeout 竞态
//
// 对照蓝图 task-09.md §4.2 B1-B10 + §9 AC-6~AC-12, AC-24。

import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { Daemon } from '../../src/daemon.js';
import type { DaemonConfig } from '../../src/config.js';
import { MSG } from '../../src/protocol.js';
import type { DetectedAgent } from '../../src/agent-detector.js';
import type { WsClientCallbacks } from '../../src/ws-client.js';
import type { SessionManager } from '../../src/interactive/session-manager.js';
import type { SessionState } from '../../src/interactive/types.js';

// ── vi.mock spec-sync.ts：替换为 spy（B 组只验 daemon 调用契约）────────────────
// pullSpecBundle 默认 resolve 到 '/fake/spec/dir'（非 null），让 daemon 走 set ctx 路径。
// 各用例按需 vi.mocked(...).mockResolvedValueOnce / mockRejectedValueOnce 覆盖。
// task-06：新增 syncSpecTreeIfNeeded mock——daemon onSessionEnd / onTurnResult 终态点改调它，
// mock 内部转调 postSpecSync（ctx-guarded），保持既有 B5/B6/B9 的 postSpecSync 断言语义。
const specSyncMocks = vi.hoisted(() => ({
  pullSpecBundle: vi.fn(),
  postSpecSync: vi.fn(),
  resolveSpecDir: vi.fn((ws: string) => `/fake/spec/dir/${ws}`),
  syncSpecTreeIfNeeded: vi.fn(
    async (ctx: { workspaceId: string } | null | undefined, _client: unknown) => {
      // 对齐真函数语义：ctx 为空 no-op；否则转调 postSpecSync（mock）。
      if (!ctx) return;
      const ws = ctx.workspaceId;
      const specRoot = `/fake/spec/dir/${ws}`;
      // 复用真 postSpecSync mock 的行为（resolveDir mock 给固定路径）
      await specSyncMocks.postSpecSync(_client, ws, specRoot);
    },
  ),
}));
vi.mock('../../src/spec-sync.js', () => ({
  pullSpecBundle: specSyncMocks.pullSpecBundle,
  postSpecSync: specSyncMocks.postSpecSync,
  resolveSpecDir: specSyncMocks.resolveSpecDir,
  syncSpecTreeIfNeeded: specSyncMocks.syncSpecTreeIfNeeded,
}));
// 显式 import 触发 mock（虽然本测试主要用 specSyncMocks 引用，import 保证 daemon 内部
// `from './spec-sync.js'` 解析到同一 mock 实例）。
await import('../../src/spec-sync.js');

// ── fixture（对齐 daemon-kind-dispatch.test.ts 的 mock 模式）─────────────────

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
  getSpecBundle: ReturnType<typeof vi.fn>;
  postSpecSync: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

function createMockClient(overrides: Partial<MockClient> = {}): MockClient {
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
    notifyRunResult: vi.fn(async () => ({})),
    notifySessionEnd: vi.fn(async () => ({})),
    getSpecBundle: vi.fn(async () => Buffer.alloc(0)),
    postSpecSync: vi.fn(async () => ({ ok: true, reparsed: 0 })),
    close: vi.fn(),
    ...overrides,
  };
}

/** mock SessionManager：记录 create/end/fail/get 调用；get 按预先 set 的 state 返回。 */
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
    start: vi.fn(() => {}),
    stop: vi.fn(() => {}),
    flush: vi.fn(async () => {}),
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

interface BuildOpts {
  client?: MockClient;
  sessionManager?: SessionManager | null;
  agentPath?: string;
  config?: Partial<DaemonConfig>;
}

function buildDaemon(opts: BuildOpts) {
  const client = opts.client ?? createMockClient();
  // 用 === undefined 判断：null 要能透传（测「未注入 sessionManager」场景，AC-14）。
  const sessionManager =
    opts.sessionManager === undefined
      ? createMockSessionManager()
      : opts.sessionManager;
  const agentPath = opts.agentPath ?? 'C:\\bin\\claude.exe';
  const config = { ...mockConfig, ...(opts.config ?? {}) };

  const detector = {
    detectAgents: vi.fn(async () => [mockAgent('claude', agentPath, true)]),
  };
  const wsClientMock = createMockWsClient();
  const wsClientFactory = vi.fn((o: { callbacks: WsClientCallbacks }) => {
    wsClientMock._setCallbacks(o.callbacks);
    return wsClientMock;
  });

  const ctorOpts: Record<string, unknown> = { detector, wsClientFactory };
  if (opts.sessionManager !== undefined) {
    ctorOpts.sessionManager = sessionManager;
  }

  // 注入 mock taskRunner：ws TASK_AVAILABLE 路径在 daemon.ts:1511 检查 `!_taskRunner`
  // 提前返回（interactive 不用 taskRunner，但触发 _executeTask 需 taskRunner 非 null）。
  const taskRunner = createMockTaskRunner();
  const daemon = new Daemon(
    config,
    client as never,
    taskRunner as never,
    ctorOpts as never,
  );

  return { daemon, client, sessionManager, taskRunner, detector, wsClientMock, config };
}

/**
 * 经 ws TASK_AVAILABLE 消息驱动 _startInteractiveSession（对齐 daemon-kind-dispatch.test.ts 模式）。
 * transport/workspaceId 通过 claimLease 的 payload 透传（daemon 从 execPayload 读取）。
 */
function driveInteractiveStart(
  wsClientMock: ReturnType<typeof createMockWsClient>,
  client: MockClient,
  p: {
    leaseId: string;
    sessionId?: string;
    runId?: string;
    transport?: string;
    workspaceId?: string;
    workspace_id?: string;
    prompt?: string;
    provider?: string;
    rootPath?: string;
  },
): void {
  const sessionId = p.sessionId ?? 'sess-1';
  const runId = p.runId ?? 'run-1';
  const leaseId = p.leaseId;
  // claimLease 返回 payload：daemon 从这里读 transport/workspaceId（_executeTask 归一化）。
  const payload: Record<string, unknown> = {
    kind: 'interactive',
    prompt: p.prompt ?? 'hi',
    provider: p.provider ?? 'claude',
    agent_session_id: sessionId,
    agent_run_id: runId,
    root_path: p.rootPath ?? 'C:\\work',
    claim_token: 'tok-i',
  };
  if (p.transport !== undefined) {
    payload.transport = p.transport;
    payload.transportMode = p.transport;
  }
  if (p.workspaceId !== undefined) payload.workspaceId = p.workspaceId;
  if (p.workspace_id !== undefined) payload.workspace_id = p.workspace_id;

  client.claimLease.mockResolvedValueOnce({
    claim_token: 'tok-i',
    payload,
  });
  // ws TASK_AVAILABLE payload：execPayload = {...wsPayload, ...归一化字段}，
  // transport/workspaceId 必须在 ws payload 里（归一化列表未显式含 transport）。
  const wsPayload: Record<string, unknown> = {
    leaseId,
    kind: 'interactive',
    prompt: p.prompt ?? 'hi',
    agentSessionId: sessionId,
    agentRunId: runId,
    rootPath: p.rootPath ?? 'C:\\work',
  };
  if (p.transport !== undefined) {
    wsPayload.transport = p.transport;
    wsPayload.transportMode = p.transport;
  }
  if (p.workspaceId !== undefined) wsPayload.workspaceId = p.workspaceId;
  if (p.workspace_id !== undefined) wsPayload.workspace_id = p.workspace_id;

  wsClientMock._injectMessage({
    type: MSG.TASK_AVAILABLE,
    payload: wsPayload,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // 恢复 spec-sync mock 默认行为（成功返回路径 + 成功 sync）
  specSyncMocks.pullSpecBundle.mockResolvedValue('/fake/spec/dir');
  specSyncMocks.postSpecSync.mockResolvedValue({ ok: true, reparsed: 0 });
  specSyncMocks.resolveSpecDir.mockImplementation((ws: string) => `/fake/spec/dir/${ws}`);
  // task-06：恢复 syncSpecTreeIfNeeded 默认实现（vi.clearAllMocks 会清掉 mockImplementation，
  // 需重置为 ctx-guarded 转调 postSpecSync 的语义，否则 onSessionEnd/onTurnResult 路径不触发 postSpecSync）。
  specSyncMocks.syncSpecTreeIfNeeded.mockImplementation(
    async (ctx: { workspaceId: string } | null | undefined, client: unknown) => {
      if (!ctx) return;
      await specSyncMocks.postSpecSync(client, ctx.workspaceId, `/fake/spec/dir/${ctx.workspaceId}`);
    },
  );
});

describe('task-09 B 组：daemon interactive spec-sync 接入（D-007@v1）', () => {
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

  // ── B1: tar 模式 pull 触发 + 时序（R-07）───────────────────────────────────
  it('B1: tar 模式 _startInteractiveSession 调 pullSpecBundle，且 await 先于 _sessionManager.create', async () => {
    const sessionManager = createMockSessionManager();
    const { daemon, client, wsClientMock } = buildDaemon({ sessionManager });
    track(daemon);
    await daemon.start();

    // 手动控制 pullSpecBundle 的 Promise：未 resolve 前 create 不应被调。
    let pullResolve!: (v: string | null) => void;
    const pullPromise = new Promise<string | null>((resolve) => {
      pullResolve = resolve;
    });
    specSyncMocks.pullSpecBundle.mockReturnValueOnce(pullPromise);

    driveInteractiveStart(wsClientMock, client, {
      leaseId: 'lease-b1',
      sessionId: 'sess-b1',
      transport: 'tar',
      workspaceId: 'ws-b1',
    });

    // 等待 ws 消息进入 _executeTask（claimLease resolve 后）。
    // 给 claimLease + 归一化链一点时间，但 pullPromise 未 resolve。
    await sleep(60);

    // 时序断言（R-07）：pull await 未完成 → create 不应被调
    expect(specSyncMocks.pullSpecBundle).toHaveBeenCalledTimes(1);
    expect(specSyncMocks.pullSpecBundle).toHaveBeenCalledWith(expect.anything(), 'ws-b1', expect.anything());
    expect(sessionManager.create).not.toHaveBeenCalled();

    // resolve pull → daemon 继续 await → 调 create
    pullResolve('/fake/spec/dir');
    // 轮询等 create 被调（microtask + setTimeout 混合）
    for (let i = 0; i < 200; i++) {
      if (vi.mocked(sessionManager.create).mock.calls.length > 0) break;
      await sleep(5);
    }
    expect(sessionManager.create).toHaveBeenCalledTimes(1);
    const createArg = vi.mocked(sessionManager.create).mock.calls[0]![0] as Record<string, unknown>;
    expect(createArg.sessionId).toBe('sess-b1');

    await daemon.stop();
  });

  // ── B2: shared 模式不 pull（D-004 零触发守护）──────────────────────────────
  it('B2: shared 模式（或缺省 transport）→ pullSpecBundle 未被调（D-004）', async () => {
    const sessionManager = createMockSessionManager();
    const { daemon, client, wsClientMock } = buildDaemon({ sessionManager });
    track(daemon);
    await daemon.start();

    driveInteractiveStart(wsClientMock, client, {
      leaseId: 'lease-b2',
      sessionId: 'sess-b2',
      transport: 'shared', // 显式 shared
      workspaceId: 'ws-b2',
    });
    await sleep(60);

    expect(specSyncMocks.pullSpecBundle).not.toHaveBeenCalled();
    expect(sessionManager.create).toHaveBeenCalledTimes(1);
    await daemon.stop();
  });

  // ── B3: pull 404 容错不阻塞 session 启动（utility 404 返回非 null → set ctx）──
  it('B3: pullSpecBundle resolve 非 null（404 已被 utility 容错）→ set specSyncCtx + create 成功', async () => {
    // 模拟 utility 404 容错后的行为：返回路径非 null（daemon 此时不知道是 404，按成功 set ctx）
    specSyncMocks.pullSpecBundle.mockResolvedValueOnce('/fake/spec/dir/404-empty');
    const sessionManager = createMockSessionManager();
    const { daemon, client, wsClientMock } = buildDaemon({ sessionManager });
    track(daemon);
    await daemon.start();

    driveInteractiveStart(wsClientMock, client, {
      leaseId: 'lease-b3',
      sessionId: 'sess-b3',
      transport: 'tar',
      workspaceId: 'ws-b3',
    });
    // 等 create 被调
    for (let i = 0; i < 200; i++) {
      if (vi.mocked(sessionManager.create).mock.calls.length > 0) break;
      await sleep(5);
    }
    expect(specSyncMocks.pullSpecBundle).toHaveBeenCalledWith(expect.anything(), 'ws-b3', expect.anything());
    expect(sessionManager.create).toHaveBeenCalledTimes(1);
    await daemon.stop();
  });

  // ── B4: pull 5xx 不阻塞 session 启动（R-03）────────────────────────────────
  it('B4: pullSpecBundle reject（5xx）→ daemon catch warn → _sessionManager.create 仍被调', async () => {
    specSyncMocks.pullSpecBundle.mockRejectedValueOnce({ status: 500, message: 'server err' });
    const sessionManager = createMockSessionManager();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { daemon, client, wsClientMock } = buildDaemon({ sessionManager });
    track(daemon);
    await daemon.start();

    driveInteractiveStart(wsClientMock, client, {
      leaseId: 'lease-b4',
      sessionId: 'sess-b4',
      transport: 'tar',
      workspaceId: 'ws-b4',
    });
    for (let i = 0; i < 200; i++) {
      if (vi.mocked(sessionManager.create).mock.calls.length > 0) break;
      await sleep(5);
    }
    // R-03：pull 失败仅 warn，create 仍被调（不阻塞 session 启动）
    expect(sessionManager.create).toHaveBeenCalledTimes(1);
    // 日志含 interactive_spec_pull_failed（daemon catch warn 分支）
    const warnCalls = warnSpy.mock.calls.map((c) => JSON.stringify(c)).join('\n');
    expect(warnCalls).toContain('interactive_spec_pull_failed');
    warnSpy.mockRestore();
    await daemon.stop();
  });

  // ── B5: tar 模式 sync 触发 + 时序（postSpecSync 在 notifySessionEnd 之后）────
  it('B5: onSessionEnd tar 模式 → postSpecSync 在 notifySessionEnd 之后（R-07）', async () => {
    const sessionId = 'sess-b5';
    const leaseId = 'lease-b5';
    const stateMap = new Map<string, Partial<SessionState>>();
    stateMap.set(sessionId, { leaseId } as Partial<SessionState>);
    const sessionManager = createMockSessionManager(stateMap);
    const { daemon, client } = buildDaemon({ sessionManager });
    track(daemon);

    // 先 pull 成功（登记 ctx），不经过 ws（直接调内部方法触发 pull + set ctx）
    // 用 daemon as any 访问 _interactiveSpecSyncCtx 模拟 pull 后的登记
    //（pull 登记逻辑：this._interactiveSpecSyncCtx.set(leaseId, {workspaceId})）
    const daemonAny = daemon as unknown as {
      _interactiveSpecSyncCtx: Map<string, { workspaceId: string }>;
    };
    daemonAny._interactiveSpecSyncCtx.set(leaseId, { workspaceId: 'ws-b5' });

    // 用 spy 顺序数组断言时序：记录 notifySessionEnd 与 postSpecSync 的调用顺序
    const callOrder: string[] = [];
    vi.mocked(client.notifySessionEnd).mockImplementation(async () => {
      callOrder.push('notifySessionEnd');
    });
    specSyncMocks.postSpecSync.mockImplementation(async () => {
      callOrder.push('postSpecSync');
      return { ok: true, reparsed: 0 };
    });

    await daemon.onSessionEnd(sessionId, 'ended');

    expect(client.notifySessionEnd).toHaveBeenCalledTimes(1);
    expect(specSyncMocks.postSpecSync).toHaveBeenCalledTimes(1);
    expect(specSyncMocks.postSpecSync).toHaveBeenCalledWith(expect.anything(), 'ws-b5', expect.any(String));
    // R-07 时序断言：notifySessionEnd 索引 < postSpecSync 索引
    const notifyIdx = callOrder.indexOf('notifySessionEnd');
    const syncIdx = callOrder.indexOf('postSpecSync');
    expect(notifyIdx).toBeGreaterThanOrEqual(0);
    expect(syncIdx).toBeGreaterThanOrEqual(0);
    expect(notifyIdx).toBeLessThan(syncIdx);
  });

  // ── B6: sync 失败不阻塞终态上报（R-03）─────────────────────────────────────
  it('B6: postSpecSync reject → notifySessionEnd 仍被调（且先于 sync）、onSessionEnd 不抛', async () => {
    const sessionId = 'sess-b6';
    const leaseId = 'lease-b6';
    const stateMap = new Map<string, Partial<SessionState>>();
    stateMap.set(sessionId, { leaseId } as Partial<SessionState>);
    const sessionManager = createMockSessionManager(stateMap);
    const { daemon, client } = buildDaemon({ sessionManager });
    track(daemon);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const daemonAny = daemon as unknown as {
      _interactiveSpecSyncCtx: Map<string, { workspaceId: string }>;
    };
    daemonAny._interactiveSpecSyncCtx.set(leaseId, { workspaceId: 'ws-b6' });

    const callOrder: string[] = [];
    vi.mocked(client.notifySessionEnd).mockImplementation(async () => {
      callOrder.push('notifySessionEnd');
    });
    specSyncMocks.postSpecSync.mockRejectedValue({ status: 500, message: 'sync boom' });

    // R-03：onSessionEnd 不应抛错（sync 失败被 catch）
    await expect(daemon.onSessionEnd(sessionId, 'ended')).resolves.toBeUndefined();

    // notifySessionEnd 已被调（先于 sync）
    expect(client.notifySessionEnd).toHaveBeenCalledTimes(1);
    expect(specSyncMocks.postSpecSync).toHaveBeenCalledTimes(1);
    const notifyIdx = callOrder.indexOf('notifySessionEnd');
    expect(notifyIdx).toBeGreaterThanOrEqual(0);
    // 日志含 interactive_spec_sync_failed
    const warnCalls = warnSpy.mock.calls.map((c) => JSON.stringify(c)).join('\n');
    expect(warnCalls).toContain('interactive_spec_sync_failed');
    warnSpy.mockRestore();
  });

  // ── B7: shared 模式不 sync（D-004 零触发守护）──────────────────────────────
  it('B7: 非 tar 模式（specSyncCtx 未登记）onSessionEnd → postSpecSync 未被调（D-004）', async () => {
    const sessionId = 'sess-b7';
    const leaseId = 'lease-b7';
    const stateMap = new Map<string, Partial<SessionState>>();
    stateMap.set(sessionId, { leaseId } as Partial<SessionState>);
    const sessionManager = createMockSessionManager(stateMap);
    const { daemon, client } = buildDaemon({ sessionManager });
    track(daemon);

    // 不 set _interactiveSpecSyncCtx（模拟 shared 模式 pull 未登记）
    await daemon.onSessionEnd(sessionId, 'ended');

    expect(client.notifySessionEnd).toHaveBeenCalledTimes(1); // 终态上报照常
    expect(specSyncMocks.postSpecSync).not.toHaveBeenCalled();
  });

  // ── B8: transport=tar 但 workspaceId 缺失 → 跳过 pull + warn ──────────────
  it('B8: transport=tar 但无 workspaceId → pullSpecBundle 未调、log 含 interactive_spec_pull_no_workspace', async () => {
    const sessionManager = createMockSessionManager();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { daemon, client, wsClientMock } = buildDaemon({ sessionManager });
    track(daemon);
    await daemon.start();

    driveInteractiveStart(wsClientMock, client, {
      leaseId: 'lease-b8',
      sessionId: 'sess-b8',
      transport: 'tar',
      // 不传 workspaceId
    });
    for (let i = 0; i < 200; i++) {
      if (vi.mocked(sessionManager.create).mock.calls.length > 0) break;
      await sleep(5);
    }
    expect(specSyncMocks.pullSpecBundle).not.toHaveBeenCalled();
    const warnCalls = warnSpy.mock.calls.map((c) => JSON.stringify(c)).join('\n');
    expect(warnCalls).toContain('interactive_spec_pull_no_workspace');
    // session 仍启动（不阻塞）
    expect(sessionManager.create).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
    await daemon.stop();
  });

  // ── B9: onSessionEnd 幂等（postSpecSync 只调一次）─────────────────────────
  it('B9: 同一 sessionId 二次 onSessionEnd → postSpecSync 只被调一次（specSyncCtx 已 delete）', async () => {
    const sessionId = 'sess-b9';
    const leaseId = 'lease-b9';
    const stateMap = new Map<string, Partial<SessionState>>();
    stateMap.set(sessionId, { leaseId } as Partial<SessionState>);
    const sessionManager = createMockSessionManager(stateMap);
    const { daemon } = buildDaemon({ sessionManager });
    track(daemon);

    const daemonAny = daemon as unknown as {
      _interactiveSpecSyncCtx: Map<string, { workspaceId: string }>;
    };
    daemonAny._interactiveSpecSyncCtx.set(leaseId, { workspaceId: 'ws-b9' });

    await daemon.onSessionEnd(sessionId, 'ended');
    await daemon.onSessionEnd(sessionId, 'ended'); // 二次

    // finally delete → 二次查不到 ctx return → postSpecSync 只调一次
    expect(specSyncMocks.postSpecSync).toHaveBeenCalledTimes(1);
    // notifySessionEnd 不受 ctx 影响，两次都调（daemon 转发不幂等；幂等指 sync 部分）
    expect((daemonAny._interactiveSpecSyncCtx).size).toBe(0);
  });

  // ── B10: sessionManager null 安全（AC-14 过渡期）──────────────────────────
  it('B10: 未注入 SessionManager → onSessionEnd 不抛错、postSpecSync 未调（AC-14）', async () => {
    // sessionManager 传 null（显式构造「未注入」场景）
    const { daemon, client } = buildDaemon({ sessionManager: null });
    track(daemon);

    // onSessionEnd 不应抛（_postInteractiveSpecSync 内 `if (!this._sessionManager) return`）
    await expect(daemon.onSessionEnd('sess-b10', 'ended')).resolves.toBeUndefined();
    // notifySessionEnd 仍调（onSessionEnd 前段不依赖 sessionManager）
    expect(client.notifySessionEnd).toHaveBeenCalledTimes(1);
    expect(specSyncMocks.postSpecSync).not.toHaveBeenCalled();
  });

  // ── task-06 C 组：scan run 终态（onTurnResult）触发 spec 树回灌（FR-05 / D-002@v1）─
  // scan/stage 跑在长生命周期 interactive session（scan 期 session 永不 end），
  // 故 scan 终态必须独立于 session-end 触发 sync。此处直接调 daemon.onTurnResult 模拟终态。

  it('task-06 C1: onTurnResult 终态 → 触发 syncSpecTreeIfNeeded 一次（specSyncCtx 已登记）', async () => {
    const sessionId = 'sess-c1';
    const leaseId = 'lease-c1';
    const runId = 'run-c1';
    const stateMap = new Map<string, Partial<SessionState>>();
    stateMap.set(sessionId, {
      leaseId,
      claimToken: 'tok-c1',
    } as Partial<SessionState>);
    const sessionManager = createMockSessionManager(stateMap);
    const { daemon, client } = buildDaemon({ sessionManager });
    track(daemon);

    // 登记 specSyncCtx（模拟 scan/stage interactive pull 后的 set）
    const daemonAny = daemon as unknown as {
      _interactiveSpecSyncCtx: Map<string, { workspaceId: string }>;
    };
    daemonAny._interactiveSpecSyncCtx.set(leaseId, { workspaceId: 'ws-c1' });

    // 最小 result stub（onTurnResult 内 duck-typing 读 subtype/is_error/usage）
    const result = { subtype: 'success', is_error: false } as never;

    await daemon.onTurnResult(sessionId, runId, result);

    // notifyRunResult 已调（终态上报）
    expect(client.notifyRunResult).toHaveBeenCalledTimes(1);
    // task-06：syncSpecTreeIfNeeded 被调一次（终态点回灌），内部转调 postSpecSync
    expect(specSyncMocks.syncSpecTreeIfNeeded).toHaveBeenCalledTimes(1);
    expect(specSyncMocks.postSpecSync).toHaveBeenCalledTimes(1);
    // ctx.workspaceId 透传正确
    const syncCall = vi.mocked(specSyncMocks.syncSpecTreeIfNeeded).mock.calls[0]!;
    expect(syncCall[0]).toEqual({ workspaceId: 'ws-c1' });
    // 终态点不 delete ctx（留给 onSessionEnd 兜底）
    expect(daemonAny._interactiveSpecSyncCtx.has(leaseId)).toBe(true);
  });

  it('task-06 C2: onTurnResult 终态 → notifyRunResult 失败仍触发 sync（sync 独立于 run 上报）', async () => {
    const sessionId = 'sess-c2';
    const leaseId = 'lease-c2';
    const stateMap = new Map<string, Partial<SessionState>>();
    stateMap.set(sessionId, { leaseId, claimToken: 'tok-c2' } as Partial<SessionState>);
    const sessionManager = createMockSessionManager(stateMap);
    const { daemon, client } = buildDaemon({ sessionManager });
    track(daemon);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const daemonAny = daemon as unknown as {
      _interactiveSpecSyncCtx: Map<string, { workspaceId: string }>;
    };
    daemonAny._interactiveSpecSyncCtx.set(leaseId, { workspaceId: 'ws-c2' });

    // notifyRunResult 抛错（backend 500），onTurnResult 内 catch warn，但终态点 sync 仍执行
    client.notifyRunResult.mockRejectedValueOnce({ status: 500, message: 'boom' });

    await expect(
      daemon.onTurnResult(sessionId, 'run-c2', { subtype: 'success' } as never),
    ).resolves.toBeUndefined();

    expect(client.notifyRunResult).toHaveBeenCalledTimes(1);
    // 即便 notifyRunResult 失败，终态点 sync 仍触发（独立于 run 上报）
    expect(specSyncMocks.syncSpecTreeIfNeeded).toHaveBeenCalledTimes(1);
    expect(specSyncMocks.postSpecSync).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('task-06 C3: quick-chat/shared（无 specSyncCtx）→ onTurnResult 终态 syncSpecTreeIfNeeded no-op', async () => {
    const sessionId = 'sess-c3';
    const leaseId = 'lease-c3';
    const stateMap = new Map<string, Partial<SessionState>>();
    stateMap.set(sessionId, { leaseId, claimToken: 'tok-c3' } as Partial<SessionState>);
    const sessionManager = createMockSessionManager(stateMap);
    const { daemon } = buildDaemon({ sessionManager });
    track(daemon);

    // 不 set _interactiveSpecSyncCtx（模拟 quick-chat/shared）
    await daemon.onTurnResult(sessionId, 'run-c3', { subtype: 'success' } as never);

    // syncSpecTreeIfNeeded 被调（daemon 仍调用），但 ctx 为 null → postSpecSync 不调
    expect(specSyncMocks.syncSpecTreeIfNeeded).toHaveBeenCalledTimes(1);
    const syncCall = vi.mocked(specSyncMocks.syncSpecTreeIfNeeded).mock.calls[0]!;
    expect(syncCall[0]).toBeNull();
    expect(specSyncMocks.postSpecSync).not.toHaveBeenCalled();
  });

  it('task-06 C4: double-sync 幂等——onTurnResult 终态 + 后续 onSessionEnd，均无异常、各触发一次', async () => {
    const sessionId = 'sess-c4';
    const leaseId = 'lease-c4';
    const stateMap = new Map<string, Partial<SessionState>>();
    stateMap.set(sessionId, { leaseId, claimToken: 'tok-c4' } as Partial<SessionState>);
    const sessionManager = createMockSessionManager(stateMap);
    const { daemon, client } = buildDaemon({ sessionManager });
    track(daemon);

    const daemonAny = daemon as unknown as {
      _interactiveSpecSyncCtx: Map<string, { workspaceId: string }>;
    };
    daemonAny._interactiveSpecSyncCtx.set(leaseId, { workspaceId: 'ws-c4' });

    // ① scan 终态点（onTurnResult）触发一次 sync
    await daemon.onTurnResult(sessionId, 'run-c4', { subtype: 'success' } as never);
    expect(specSyncMocks.postSpecSync).toHaveBeenCalledTimes(1);
    // 终态点不 delete ctx
    expect(daemonAny._interactiveSpecSyncCtx.has(leaseId)).toBe(true);

    // ② 后续 session end 兜底再触发一次（double-sync，幂等无害）
    await daemon.onSessionEnd(sessionId, 'ended');
    // 终态点 1 次 + session end 1 次 = 2 次
    expect(specSyncMocks.postSpecSync).toHaveBeenCalledTimes(2);
    expect(client.notifySessionEnd).toHaveBeenCalledTimes(1);
    // session end finally delete ctx
    expect(daemonAny._interactiveSpecSyncCtx.has(leaseId)).toBe(false);
  });
});
