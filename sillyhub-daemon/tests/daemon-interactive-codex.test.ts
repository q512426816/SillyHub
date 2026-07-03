// tests/daemon-interactive-codex.test.ts
// task-06（codex-interactive-session / FR-01/03/05/06, D-001/002/003/007）：
// daemon 接入 provider-specific executable + Codex recovery + session 清理的单测。
//
// 覆盖蓝图 TC1-TC8：
//   TC1  _startInteractiveSession provider='codex' + _agentPaths 有 codex path
//        → SessionManager.create 收到 provider='codex' + codex executable
//   TC2  _startInteractiveSession provider='codex' + _agentPaths 无 codex
//        → 不调 create，logger 记 interactive_codex_executable_not_found（fail lease）
//   TC3  _startInteractiveSession provider='claude'（回归）→ 取 _agentPaths.get('claude')
//   TC4  onTurnMessage / onTurnResult 收 Codex flat message / driver result
//        → 不抛类型错，submitMessages / notifyRunResult 被调
//   TC5  onTurnMessage 收 Claude raw assistant message（回归）→ usage 提取不变
//   TC6  _routeSessionResume provider='codex' + agent_session_id=<threadId>
//        → restoreAndReconnect 被调，record.provider='codex'，不抛 UnsupportedProviderError
//   TC7  _routeSessionResume 缺 agent_session_id → 不调 restoreAndReconnect（D-007 不伪造）
//   TC8  session-store-persistence：Codex record（agentSessionId=threadId + codex path）
//        通过 validateRecord；缺 agentSessionId → 丢弃
//
// 触发模式对齐 spec-transport-tar-sync/daemon-interactive-spec-sync.test.ts：
// ws TASK_AVAILABLE → claimLease → _executeTask → _startInteractiveSession。

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { Daemon } from '../src/daemon.js';
import { MSG } from '../src/protocol.js';
import type { DaemonConfig } from '../src/config.js';
import type { DetectedAgent } from '../src/agent-detector.js';
import type { SessionManager } from '../src/interactive/session-manager.js';
import type { SessionState, PersistedSessionRecord } from '../src/interactive/types.js';
import { JsonSessionPersistence } from '../src/interactive/session-store-persistence.js';

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

function mockAgent(provider: string, path: string, available = true): DetectedAgent {
  return {
    provider,
    path,
    version: '1.0.0',
    protocol: 'stream_json',
    status: available ? 'available' : 'unavailable',
    versionWarning: null,
  };
}

function createMockClient() {
  return {
    register: vi.fn(async () => ({ id: 'srv-rid-1' })),
    heartbeat: vi.fn(async () => ({})),
    markOffline: vi.fn(async () => ({})),
    claimLease: vi.fn(async () => ({ claim_token: 't', payload: {} })),
    startLease: vi.fn(async () => ({})),
    leaseHeartbeat: vi.fn(async () => ({})),
    completeLease: vi.fn(async () => ({})),
    getPendingLeases: vi.fn(async () => []),
    getExecutionContext: vi.fn(async () => ({ agent_run_id: 'run-default', claude_md: '' })),
    notifyRunResult: vi.fn(async () => ({})),
    submitMessages: vi.fn(async () => ({})),
    notifySessionEnd: vi.fn(async () => ({})),
    getSpecBundle: vi.fn(async () => Buffer.alloc(0)),
    postSpecSync: vi.fn(async () => ({ ok: true, reparsed: 0 })),
    syncStatus: vi.fn(async () => ({})),
    recoverSession: vi.fn(async () => ({})),
    confirmReconnected: vi.fn(async () => ({})),
    markRecoveryFailed: vi.fn(async () => ({})),
    close: vi.fn(),
  };
}

function createMockTaskRunner() {
  return { runLease: vi.fn(async () => ({})) };
}

/** mock SessionManager：记录 create/restoreAndReconnect 调用；get 按预置 state 返回。 */
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
    snapshotPersistable: vi.fn(() => []),
    scanOnce: vi.fn(async () => {}),
    restoreAndReconnect: vi.fn(async () => {}),
    markReconnected: vi.fn(async () => {}),
    markRecoveredSessionFailed: vi.fn(async () => {}),
    manualApproval: false,
    getPermissionResolver: vi.fn(() => undefined),
    getPendingInjectCount: vi.fn(() => 0),
    getIdleTimeoutSec: vi.fn(() => 1800),
    refreshClaimToken: vi.fn(async () => {}),
  };
  return sm as unknown as SessionManager;
}

function createMockWsClient() {
  let callbacks: Record<string, ((...args: unknown[]) => void) | undefined> = {};
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
    _setCallbacks(cb: Record<string, ((...args: unknown[]) => void) | undefined>): void {
      callbacks = cb;
    },
  };
}

interface BuildOpts {
  sessionManager?: SessionManager | null;
  /** detector 返回的 agent 列表（provider + path）。默认仅 claude。 */
  agents?: DetectedAgent[];
}

function buildDaemon(opts: BuildOpts = {}) {
  const sessionManager =
    opts.sessionManager === undefined
      ? createMockSessionManager()
      : opts.sessionManager;
  const agents = opts.agents ?? [mockAgent('claude', '/fake/claude', true)];
  const detector = { detectAgents: vi.fn(async () => agents) };
  const wsClientMock = createMockWsClient();
  const wsClientFactory = vi.fn((o: { callbacks: unknown }) => {
    wsClientMock._setCallbacks(o.callbacks as never);
    return wsClientMock;
  });
  const ctorOpts: Record<string, unknown> = { detector, wsClientFactory };
  if (opts.sessionManager !== undefined) {
    ctorOpts.sessionManager = sessionManager;
  }
  const daemon = new Daemon(
    mockConfig,
    createMockClient() as never,
    createMockTaskRunner() as never,
    ctorOpts as never,
  );
  return { daemon, sessionManager, wsClientMock };
}

/**
 * 经 ws TASK_AVAILABLE + claimLease 驱动 _startInteractiveSession。
 * 对齐 spec-transport-tar-sync 测试模式。
 */
function driveInteractiveStart(
  daemon: Daemon,
  client: ReturnType<typeof createMockClient>,
  wsClientMock: ReturnType<typeof createMockWsClient>,
  p: {
    leaseId: string;
    sessionId?: string;
    runId?: string;
    prompt?: string;
    provider?: string;
    rootPath?: string;
  },
): void {
  const sessionId = p.sessionId ?? 'sess-1';
  const runId = p.runId ?? 'run-1';
  const provider = p.provider ?? 'claude';
  const payload: Record<string, unknown> = {
    kind: 'interactive',
    prompt: p.prompt ?? 'hi',
    provider,
    agent_session_id: sessionId,
    agent_run_id: runId,
    root_path: p.rootPath ?? '/tmp/work',
    claim_token: 'tok-i',
  };
  client.claimLease.mockResolvedValueOnce({ claim_token: 'tok-i', payload });
  wsClientMock._injectMessage({
    type: MSG.TASK_AVAILABLE,
    payload: {
      leaseId: p.leaseId,
      kind: 'interactive',
      prompt: p.prompt ?? 'hi',
      agentSessionId: sessionId,
      agentRunId: runId,
      rootPath: p.rootPath ?? '/tmp/work',
      provider,
    },
  });
}

async function emit(daemon: Daemon, msg: { type: string; payload: unknown }): Promise<void> {
  const handle = (
    daemon as unknown as {
      _handleWsMessage: (m: { type: string; payload: unknown }) => Promise<void>;
    }
  )._handleWsMessage.bind(daemon);
  await handle(msg);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('task-06: daemon Codex interactive 接入', () => {
  let daemons: Daemon[] = [];

  afterEach(async () => {
    for (const d of daemons) {
      if (d.isRunning) {
        await d.stop().catch(() => undefined);
      }
    }
    daemons = [];
  });

  // ── TC1: provider='codex' + 有 codex path → create 收 codex executable ──────
  it('TC1: codex provider + _agentPaths 有 codex → create(provider=codex, codex path)', async () => {
    const sessionManager = createMockSessionManager();
    const { daemon, wsClientMock } = buildDaemon({
      sessionManager,
      agents: [
        mockAgent('claude', '/fake/claude', true),
        mockAgent('codex', '/fake/codex', true),
      ],
    });
    daemons.push(daemon);
    await daemon.start();
    // 把 mock client 注入（buildDaemon 用默认 client，这里通过 daemon 内部 _client 触发 claimLease）
    const client = createMockClient();
    (daemon as unknown as { _client: unknown })._client = client as never;

    driveInteractiveStart(daemon, client, wsClientMock, {
      leaseId: 'lease-c1',
      sessionId: 'sess-c1',
      runId: 'run-c1',
      provider: 'codex',
    });
    await sleep(30);

    expect(sessionManager.create).toHaveBeenCalledTimes(1);
    const createInput = sessionManager.create.mock.calls[0]![0] as {
      provider: string;
      pathToClaudeCodeExecutable: string;
      sessionId: string;
    };
    expect(createInput.provider).toBe('codex');
    // executable 按 provider 取 _agentPaths.get('codex') = '/fake/codex'
    expect(createInput.pathToClaudeCodeExecutable).toBe('/fake/codex');
    expect(createInput.sessionId).toBe('sess-c1');
  });

  // ── TC2: codex provider + 无 codex path → 不调 create，fail lease ──────────
  it('TC2: codex provider + _agentPaths 无 codex → 不调 create（fail lease）', async () => {
    const sessionManager = createMockSessionManager();
    const { daemon, wsClientMock } = buildDaemon({
      sessionManager,
      // 只探测到 claude，无 codex
      agents: [mockAgent('claude', '/fake/claude', true)],
    });
    daemons.push(daemon);
    await daemon.start();
    const client = createMockClient();
    (daemon as unknown as { _client: unknown })._client = client as never;

    driveInteractiveStart(daemon, client, wsClientMock, {
      leaseId: 'lease-c2',
      sessionId: 'sess-c2',
      runId: 'run-c2',
      provider: 'codex',
    });
    await sleep(30);

    // 不调 create（fail lease，backend 据 lease 超时收 failed）
    expect(sessionManager.create).not.toHaveBeenCalled();
  });

  // ── TC3: provider='claude' 回归 → 取 _agentPaths.get('claude') ──────────────
  it('TC3: claude provider（回归）→ create(provider=claude, claude path)', async () => {
    const sessionManager = createMockSessionManager();
    const { daemon, wsClientMock } = buildDaemon({
      sessionManager,
      agents: [
        mockAgent('claude', '/fake/claude', true),
        mockAgent('codex', '/fake/codex', true),
      ],
    });
    daemons.push(daemon);
    await daemon.start();
    const client = createMockClient();
    (daemon as unknown as { _client: unknown })._client = client as never;

    driveInteractiveStart(daemon, client, wsClientMock, {
      leaseId: 'lease-c3',
      sessionId: 'sess-c3',
      runId: 'run-c3',
      provider: 'claude',
    });
    await sleep(30);

    expect(sessionManager.create).toHaveBeenCalledTimes(1);
    const createInput = sessionManager.create.mock.calls[0]![0] as {
      provider: string;
      pathToClaudeCodeExecutable: string;
    };
    expect(createInput.provider).toBe('claude');
    expect(createInput.pathToClaudeCodeExecutable).toBe('/fake/claude');
  });

  // ── TC3b: provider 缺省 → 归一为 claude（保守，不因未知崩溃） ───────────────
  it('TC3b: provider 缺省 → 归一 claude，取 claude executable', async () => {
    const sessionManager = createMockSessionManager();
    const { daemon, wsClientMock } = buildDaemon({
      sessionManager,
      agents: [mockAgent('claude', '/fake/claude', true)],
    });
    daemons.push(daemon);
    await daemon.start();
    const client = createMockClient();
    (daemon as unknown as { _client: unknown })._client = client as never;

    driveInteractiveStart(daemon, client, wsClientMock, {
      leaseId: 'lease-c3b',
      sessionId: 'sess-c3b',
      runId: 'run-c3b',
      // provider 缺省
    });
    await sleep(30);

    expect(sessionManager.create).toHaveBeenCalledTimes(1);
    const createInput = sessionManager.create.mock.calls[0]![0] as {
      provider: string;
      pathToClaudeCodeExecutable: string;
    };
    expect(createInput.provider).toBe('claude');
    expect(createInput.pathToClaudeCodeExecutable).toBe('/fake/claude');
  });

  // ── TC4: Codex flat message / driver result → submitMessages / notifyRunResult ─
  it('TC4: onTurnMessage 收 Codex flat message → submitMessages 透传（不抛类型错）', async () => {
    const stateMap = new Map<string, Partial<SessionState>>([
      [
        'sess-codex',
        {
          leaseId: 'lease-c4',
          claimToken: 'tok-c4',
          provider: 'codex',
        },
      ],
    ]);
    const sessionManager = createMockSessionManager(stateMap);
    const { daemon } = buildDaemon({ sessionManager });
    daemons.push(daemon);
    const client = createMockClient();
    (daemon as unknown as { _client: unknown })._client = client as never;

    // Codex flat message（D-004 契约：{event_type, content, metadata, session_id}）
    const codexFlatMsg = {
      event_type: 'text',
      content: 'hello from codex',
      metadata: {},
      session_id: 'thread-abc',
    };
    await daemon.onTurnMessage('sess-codex', 'run-c4', codexFlatMsg as never);

    expect(client.submitMessages).toHaveBeenCalledTimes(1);
    const submitArgs = client.submitMessages.mock.calls[0];
    expect(submitArgs[0]).toBe('lease-c4');
    expect(submitArgs[1]).toBe('tok-c4');
    expect(submitArgs[2]).toBe('run-c4');
    // 透传的 message 保留 event_type + session_id
    const forwarded = (submitArgs[3] as unknown[])[0] as Record<string, unknown>;
    expect(forwarded.event_type).toBe('text');
    expect(forwarded.session_id).toBe('thread-abc');
  });

  it('TC4b: onTurnMessage 收 Codex thread_started flat → submitMessages 透传（Reverse Sync 载体）', async () => {
    const stateMap = new Map<string, Partial<SessionState>>([
      [
        'sess-codex2',
        {
          leaseId: 'lease-c4b',
          claimToken: 'tok-c4b',
          provider: 'codex',
        },
      ],
    ]);
    const sessionManager = createMockSessionManager(stateMap);
    const { daemon } = buildDaemon({ sessionManager });
    daemons.push(daemon);
    const client = createMockClient();
    (daemon as unknown as { _client: unknown })._client = client as never;

    // thread_started flat message（task-04 L128-130：driver 额外发，让 backend 对齐 agent_session_id）
    const threadStartedMsg = {
      event_type: 'text',
      content: '',
      metadata: { subtype: 'thread_started' },
      session_id: 'thread-xyz',
    };
    await daemon.onTurnMessage('sess-codex2', 'run-c4b', threadStartedMsg as never);

    expect(client.submitMessages).toHaveBeenCalledTimes(1);
    const forwarded = (
      client.submitMessages.mock.calls[0][3] as unknown[]
    )[0] as Record<string, unknown>;
    // session_id=threadId 原样透传，backend submit_messages 据此写 AgentRun.session_id
    expect(forwarded.session_id).toBe('thread-xyz');
    expect((forwarded.metadata as Record<string, unknown>).subtype).toBe('thread_started');
  });

  it('TC4c: onTurnResult 收 Codex driver result（flat，无 type）→ notifyRunResult 透传', async () => {
    const stateMap = new Map<string, Partial<SessionState>>([
      [
        'sess-codex3',
        { leaseId: 'lease-c4c', claimToken: 'tok-c4c', provider: 'codex' },
      ],
    ]);
    const sessionManager = createMockSessionManager(stateMap);
    const { daemon } = buildDaemon({ sessionManager });
    daemons.push(daemon);
    const client = createMockClient();
    (daemon as unknown as { _client: unknown })._client = client as never;

    // Codex driver result（flat：subtype/is_error，无 type='result'）
    const codexResult = {
      subtype: 'success',
      is_error: false,
      total_cost_usd: 0.01,
      usage: { input_tokens: 100, output_tokens: 50 },
    };
    await daemon.onTurnResult('sess-codex3', 'run-c4c', codexResult as never);

    expect(client.notifyRunResult).toHaveBeenCalledTimes(1);
    const payload = client.notifyRunResult.mock.calls[0][3] as Record<string, unknown>;
    expect(payload.subtype).toBe('success');
    expect(payload.is_error).toBe(false);
    expect(payload.total_cost_usd).toBe(0.01);
    expect(payload.input_tokens).toBe(100);
  });

  // ── TC5: Claude raw assistant message 回归 → usage 提取不变 ─────────────────
  it('TC5: onTurnMessage 收 Claude assistant message → usage 提取到顶层（回归）', async () => {
    const stateMap = new Map<string, Partial<SessionState>>([
      [
        'sess-claude',
        { leaseId: 'lease-c5', claimToken: 'tok-c5', provider: 'claude' },
      ],
    ]);
    const sessionManager = createMockSessionManager(stateMap);
    const { daemon } = buildDaemon({ sessionManager });
    daemons.push(daemon);
    const client = createMockClient();
    (daemon as unknown as { _client: unknown })._client = client as never;

    const claudeAssistantMsg = {
      type: 'assistant',
      message: {
        id: 'msg-1',
        usage: { input_tokens: 200, output_tokens: 80 },
        content: [{ type: 'text', text: 'hi' }],
      },
    };
    await daemon.onTurnMessage('sess-claude', 'run-c5', claudeAssistantMsg as never);

    expect(client.submitMessages).toHaveBeenCalledTimes(1);
    const forwarded = (
      client.submitMessages.mock.calls[0][3] as unknown[]
    )[0] as Record<string, unknown>;
    // usage 从 message.usage 提到顶层（backend submit_messages 读顶层 usage）
    expect((forwarded.usage as Record<string, unknown>).input_tokens).toBe(200);
    expect((forwarded.usage as Record<string, unknown>).output_tokens).toBe(80);
  });

  // ── TC6: _routeSessionResume provider='codex' + agent_session_id → restoreAndReconnect ─
  it('TC6: SESSION_RESUME provider=codex + agent_session_id → restoreAndReconnect(provider=codex)', async () => {
    const sessionManager = createMockSessionManager();
    // 注入 codex agent 让 _agentPaths.get('codex') 有值（reopen 需 exe path，
    // 否则 restoreAndReconnect 内 Codex driver start() 抛 CodexExecutableNotFoundError）。
    const { daemon } = buildDaemon({
      sessionManager,
      agents: [mockAgent('codex', '/fake/codex', true)],
    });
    daemons.push(daemon);
    // start 触发 detector → register → _agentPaths.set('codex','/fake/codex')。
    await daemon.start();
    await sleep(20);

    await emit(daemon, {
      type: MSG.SESSION_RESUME,
      payload: {
        session_id: 'sess-resume-codex',
        lease_id: 'lease-resume-codex',
        agent_session_id: 'thread-codex-1',
        cwd: '/tmp/proj',
        provider: 'codex',
      },
    });
    await sleep(10);

    expect(sessionManager.restoreAndReconnect).toHaveBeenCalledTimes(1);
    const record = sessionManager.restoreAndReconnect.mock.calls[0]![0] as PersistedSessionRecord;
    expect(record.provider).toBe('codex');
    expect(record.agentSessionId).toBe('thread-codex-1');
    expect(record.sessionId).toBe('sess-resume-codex');
    // codex reopen 必须带 exe path（_agentPaths.get('codex')），两个兼容字段都填。
    expect(record.pathToAgentExecutable).toBe('/fake/codex');
    expect(record.pathToClaudeCodeExecutable).toBe('/fake/codex');
    // markReconnected 切 active
    expect(sessionManager.markReconnected).toHaveBeenCalledWith('sess-resume-codex');
  });

  // ── TC7: _routeSessionResume 缺 agent_session_id → 不伪造（D-007）────────────
  it('TC7: SESSION_RESUME 缺 agent_session_id → 不调 restoreAndReconnect（D-007）', async () => {
    const sessionManager = createMockSessionManager();
    const { daemon } = buildDaemon({ sessionManager });
    daemons.push(daemon);

    await emit(daemon, {
      type: MSG.SESSION_RESUME,
      payload: {
        session_id: 'sess-resume-nothread',
        lease_id: 'lease-resume-nothread',
        // 缺 agent_session_id
        cwd: '/tmp/proj',
        provider: 'codex',
      },
    });
    await sleep(10);

    // 缺 threadId → 拒绝 resume，不伪造新 thread
    expect(sessionManager.restoreAndReconnect).not.toHaveBeenCalled();
    expect(sessionManager.markReconnected).not.toHaveBeenCalled();
  });

  // ── TC6b: provider 未知 → 原样透传（ql-20260703-001 normalizeProvider）────────
  it('TC6b: SESSION_RESUME provider 未知 → 原样交 restoreAndReconnect（不再误归 claude）', async () => {
    const sessionManager = createMockSessionManager();
    const { daemon } = buildDaemon({ sessionManager });
    daemons.push(daemon);

    await emit(daemon, {
      type: MSG.SESSION_RESUME,
      payload: {
        session_id: 'sess-resume-unknown',
        lease_id: 'lease-resume-unknown',
        agent_session_id: 'sid-1',
        cwd: '/tmp/proj',
        provider: 'some-unknown-provider',
      },
    });
    await sleep(10);

    expect(sessionManager.restoreAndReconnect).toHaveBeenCalledTimes(1);
    const record = sessionManager.restoreAndReconnect.mock.calls[0]![0] as PersistedSessionRecord;
    // ql-20260703-001：normalizeProvider 替代粗暴三元（=== 'codex' ? 'codex' : 'claude'），
    // 未知 provider 原样透传——不再误归 'claude'（避免 opencode/cursor/openclaw 被误用
    // claude driver）。不崩溃；未知值由 SessionManager._getDriver 的
    // UnsupportedProviderError 兜底，比 silently 用错 driver 更安全。
    expect(record.provider).toBe('some-unknown-provider');
  });
});

// ── TC8: session-store-persistence Codex record 校验 ──────────────────────────
describe('task-06: session-store-persistence Codex record（D-007）', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sillyhub-persist-codex-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function makePersistence(): JsonSessionPersistence {
    return new JsonSessionPersistence(join(tmpDir, 'sessions.json'));
  }

  it('TC8a: Codex record（agentSessionId=threadId + codex path）→ load 通过', async () => {
    const persist = makePersistence();
    const record: PersistedSessionRecord = {
      sessionId: 'sess-codex-persist',
      leaseId: 'lease-codex-persist',
      agentSessionId: 'thread-persist-1',
      cwd: '/tmp/proj',
      provider: 'codex',
      turnCount: 3,
      lastActiveAt: Date.now(),
      pathToAgentExecutable: '/fake/codex',
    };
    await persist.save([record]);
    const loaded = await persist.load();

    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({
      provider: 'codex',
      agentSessionId: 'thread-persist-1',
      pathToAgentExecutable: '/fake/codex',
    });
  });

  it('TC8b: Codex record 缺 agentSessionId（threadId）→ load 丢弃（D-007 不伪造）', async () => {
    const persist = makePersistence();
    // 手写文件绕过 save 的类型校验，模拟历史损坏数据（agentSessionId 空）
    const fs = await import('node:fs/promises');
    await fs.writeFile(
      join(tmpDir, 'sessions.json'),
      JSON.stringify({
        version: 1,
        savedAt: new Date().toISOString(),
        sessions: [
          {
            sessionId: 'sess-bad',
            leaseId: 'lease-bad',
            // agentSessionId 缺失（空）→ 不可恢复
            agentSessionId: '',
            cwd: '/tmp/proj',
            provider: 'codex',
            turnCount: 0,
            lastActiveAt: Date.now(),
          },
        ],
      }),
      'utf8',
    );
    const loaded = await persist.load();

    // 缺 threadId 的 record 被丢弃，不复活、不伪造新 thread
    expect(loaded).toHaveLength(0);
  });

  it('TC8c: Codex record 同时带 pathToClaudeCodeExecutable（兼容名）→ 保留', async () => {
    const persist = makePersistence();
    const record: PersistedSessionRecord = {
      sessionId: 'sess-codex-compat',
      leaseId: 'lease-compat',
      agentSessionId: 'thread-compat',
      cwd: '/tmp/proj',
      provider: 'codex',
      turnCount: 0,
      lastActiveAt: Date.now(),
      // 旧字段名（对 codex 即 codex path，兼容语义）
      pathToClaudeCodeExecutable: '/fake/codex-legacy',
    };
    await persist.save([record]);
    const loaded = await persist.load();

    expect(loaded).toHaveLength(1);
    expect(loaded[0].pathToClaudeCodeExecutable).toBe('/fake/codex-legacy');
  });
});
