// tests/daemon-provider-session-dir-lifecycle.test.ts
// change 2026-09-10-multi-provider-injection / task-04（FR-03 / D-009 / D-011）。
// 锁 per-session provider 文件目录全生命周期（D-011：spawn 前创建 → 活跃期热切换
// 重写 → 终态删除）：
//
//   1. interactive 全链：TASK_AVAILABLE 驱动 create（codex 目录落盘 + Map 登记）→
//      PROVIDER_CONFIG_CHANGED 热切换重写（产物更新）→ onSessionEnd（end 路径）
//      → <root>/codex/<sid>/ 与 <root>/pi/<sid>/ 递归删除 + Map 清空；
//   2. SESSION_END WS 路径同收口（真实链 = sessionManager.end → deps.onSessionEnd
//      → daemon.onSessionEnd，mock end 按同契约桥接）；
//   3. batch 收尾：runLease 终态 finally 删 <root>/codex|pi/<leaseId>/（spawn 期间
//      存在、完成后消失；零 provider 任务 no-op 不抛）；
//   4. 清理失败 warn 吞（interactive 终态流 / batch 终态均不被阻断——node:fs/promises
//      rm 按路径注入失败，其余调用透传真实现）；
//   5. daemon 重启孤儿清扫：boot recover 后，不在会话表的 per-session 目录被删、
//      存活会话目录保留；sessionManager 未注入（会话表不可得）→ 跳过仅日志全保留。
//
// 隔离照搬 daemon-provider-file-dispatch.test.ts：vi.stubEnv('SILLYHUB_DAEMON_DIR',
// tmpRoot) 挂 daemonStateDir()，零触碰真实 ~/.sillyhub。

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

// ql 预存债预防（daemon-interactive-codex 先例）：交互链真实 linkSkillsToWorkdir +
// mkdir 拖慢 create 调用，mock 掉；syncSkills 同源（daemon.start 启动同步）。
vi.mock('../src/skill-manager.js', () => ({
  syncSkills: vi.fn(async () => ({ synced: 0, skipped: true })),
  linkSkillsToWorkdir: vi.fn(async () => ({ linked: 0, skipped: true })),
}));

// 清理失败注入载体：默认空数组 = rm 全部透传真实现；测试按路径片段注入失败
//（路径统一正斜杠比对，跨 Windows/POSIX）。
const rmFailState = vi.hoisted(() => ({ failPathFrags: [] as string[] }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const rmMock = (async (path: string, opts?: { recursive?: boolean; force?: boolean }) => {
    const p = String(path).replaceAll('\\', '/');
    if (rmFailState.failPathFrags.some((frag) => p.includes(frag))) {
      throw new Error(`mock rm failure: ${p}`);
    }
    return actual.rm(path, opts);
  }) as typeof actual.rm;
  return { ...actual, rm: rmMock };
});

// batch 接线需要拦 spawn（TaskRunner._spawnAndStream）。
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: vi.fn(() => null as never),
  };
});

import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
// vi.mock 已 hoist，import 拿到 mock 版本。
import { Daemon } from '../src/daemon.js';
import { TaskRunner } from '../src/task-runner.js';
import { MSG } from '../src/protocol.js';
import type { DaemonConfig } from '../src/config.js';
import type { DetectedAgent } from '../src/agent-detector.js';
import type { WsClientCallbacks } from '../src/ws-client.js';
import type { SessionManager } from '../src/interactive/session-manager.js';
import type { SessionState } from '../src/interactive/types.js';
import type { ProviderConfig, LeaseCtx } from '../src/types.js';
import { createFakeChild, waitForSpawn } from './helpers/fake-child.js';

// ── 共用 fixture ──────────────────────────────────────────────────────────────

/** 每用例独立的 daemon 状态根（vi.stubEnv 进 daemonStateDir 懒求值）。 */
let tmpRoot: string;

function stubbedRoot(): string {
  return tmpRoot;
}

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

/** codex anthropic 直连形态（门槛满足）。 */
function codexConfig(apiKey: string, baseUrl: string, model: string): ProviderConfig {
  return { agent_kind: 'codex', api_key: apiKey, base_url: baseUrl, model };
}

/** pi 自定义端点形态（base_url 非空 + api_key + model 齐）。 */
function piConfig(apiKey: string, baseUrl: string, model: string): ProviderConfig {
  return { agent_kind: 'pi', api_key: apiKey, base_url: baseUrl, model };
}

function fakeState(
  sessionId: string,
  leaseId: string,
  status: SessionState['status'] = 'active',
): Readonly<SessionState> {
  return { sessionId, leaseId, status } as Readonly<SessionState>;
}

/** daemon 私有 Map 读取（终态清空断言用）。 */
function providerDirMap(daemon: Daemon): Map<string, { codexHome?: string; piDir?: string }> {
  return (
    daemon as unknown as {
      _providerFileDirsBySession: Map<string, { codexHome?: string; piDir?: string }>;
    }
  )._providerFileDirsBySession;
}

const mockConfig: DaemonConfig = {
  server_url: 'http://127.0.0.1:8000',
  token: 'test-token',
  runtime_id: 'runtime-uuid-pfdl',
  profile: 'default',
  workspace_dir: '/tmp/ws-pfdl',
  poll_interval: 0.02,
  heartbeat_interval: 0.02,
  max_concurrent_tasks: 5,
  log_level: 'debug',
  allowed_roots: [tmpdir()],
};

function createMockClient() {
  return {
    register: vi.fn(async () => ({
      daemon_instance_id: 'srv-inst',
      runtimes: [{ provider: 'claude', runtime_id: 'srv-rid-1' }],
    })),
    heartbeat: vi.fn(async () => ({})),
    markOffline: vi.fn(async () => ({})),
    claimLease: vi.fn(async () => ({ claim_token: 't', payload: {} })),
    startLease: vi.fn(async () => ({})),
    leaseHeartbeat: vi.fn(async () => ({})),
    completeLease: vi.fn(async () => ({})),
    getPendingLeases: vi.fn(async () => []),
    getPendingChangeWrites: vi.fn(async () => []),
    getExecutionContext: vi.fn(async () => ({ agent_run_id: 'run-default', claude_md: '' })),
    notifyRunResult: vi.fn(async () => ({})),
    submitMessages: vi.fn(async () => ({})),
    notifySessionEnd: vi.fn(async () => ({})),
    notifySessionReady: vi.fn(async () => ({})),
    getSpecBundle: vi.fn(async () => Buffer.alloc(0)),
    postSpecSync: vi.fn(async () => ({ ok: true, reparsed: 0 })),
    syncStatus: vi.fn(async () => ({})),
    recoverSession: vi.fn(async () => ({})),
    confirmReconnected: vi.fn(async () => ({})),
    markRecoveryFailed: vi.fn(async () => ({})),
    refreshClaimToken: vi.fn(async () => ({})),
    close: vi.fn(),
  };
}

/**
 * mock SessionManager：真实链 = end/fail → deps.onSessionEnd → daemon.onSessionEnd。
 * mock end 按 daemon 构造后的 ref 桥接同契约（SESSION_END WS 路径同收口断言用）。
 */
function createMockSessionManager(
  daemonRef: { current: Daemon | null },
  opts: {
    getState?: (sessionId: string) => Readonly<SessionState> | undefined;
  } = {},
): SessionManager & { end: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> } {
  const sm = {
    create: vi.fn(async () => {}),
    inject: vi.fn(async () => ({ runId: '' })),
    interrupt: vi.fn(async () => false),
    // 真实 SessionManager.end 会触发 deps.onSessionEnd(sessionId, 'ended')——
    // mock 桥接 daemon.onSessionEnd（daemonRef 在 buildDaemon 后回填）。
    end: vi.fn(async (sid: string) => {
      await daemonRef.current?.onSessionEnd(sid, 'ended');
    }),
    fail: vi.fn(async () => {}),
    get: vi.fn(
      opts.getState ?? ((_sid: string) => undefined as Readonly<SessionState> | undefined),
    ),
    start: vi.fn(() => {}),
    stop: vi.fn(() => {}),
    flush: vi.fn(async () => {}),
    snapshotPersistable: vi.fn(() => []),
    scanOnce: vi.fn(async () => {}),
    restoreAndReconnect: vi.fn(async () => {}),
    markReconnected: vi.fn(() => {}),
    markRecoveredSessionFailed: vi.fn(async () => {}),
    manualApproval: false,
    getPermissionResolver: vi.fn(() => undefined),
    getPendingInjectCount: vi.fn(() => 0),
    getIdleTimeoutSec: vi.fn(() => 1800),
    refreshClaimToken: vi.fn(async () => ({})),
    markPendingSwitch: vi.fn(),
  };
  return sm as unknown as SessionManager & {
    end: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
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
  sessionManager?: SessionManager | null;
  agents?: DetectedAgent[];
} = {}) {
  const client = createMockClient();
  const daemonRef: { current: Daemon | null } = { current: null };
  const sessionManager =
    opts.sessionManager === undefined
      ? createMockSessionManager(daemonRef)
      : opts.sessionManager;
  const agents =
    opts.agents ?? [mockAgent('claude', '/fake/claude'), mockAgent('codex', '/fake/codex')];
  const detector = { detectAgents: vi.fn(async () => agents) };
  const wsClientMock = createMockWsClient();
  const wsClientFactory = vi.fn((o: { callbacks: WsClientCallbacks }) => {
    wsClientMock._setCallbacks(o.callbacks);
    return wsClientMock;
  });
  const daemon = new Daemon(
    mockConfig,
    client as never,
    { runLease: vi.fn(async () => ({})) } as never,
    { detector, wsClientFactory, sessionManager } as never,
  );
  daemonRef.current = daemon;
  return { daemon, client, sessionManager, wsClientMock };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForCond(
  cond: () => boolean,
  { timeout = 3000, interval = 15 }: { timeout?: number; interval?: number } = {},
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (cond()) return;
    await sleep(interval);
  }
  throw new Error(`waitForCond: 条件在 ${timeout}ms 内未成立`);
}

async function waitForSpy(
  spy: { mock: { calls: unknown[][] } },
  { timeout = 3000, interval = 15 }: { timeout?: number; interval?: number } = {},
): Promise<void> {
  await waitForCond(() => spy.mock.calls.length > 0, { timeout, interval });
}

/** 经 ws TASK_AVAILABLE + claimLease 驱动 _startInteractiveSession（budget-wiring 模式）。 */
function driveInteractiveStart(
  client: ReturnType<typeof createMockClient>,
  wsClientMock: ReturnType<typeof createMockWsClient>,
  p: {
    leaseId: string;
    sessionId: string;
    provider?: string;
    provider_config?: ProviderConfig;
  },
): void {
  const payload: Record<string, unknown> = {
    kind: 'interactive',
    prompt: 'hi',
    provider: p.provider ?? 'claude',
    agent_session_id: p.sessionId,
    agent_run_id: 'run-1',
    root_path: tmpdir(),
    claim_token: 'tok-i',
  };
  if (p.provider_config !== undefined) {
    payload['provider_config'] = p.provider_config;
  }
  client.claimLease.mockResolvedValueOnce({ claim_token: 'tok-i', payload });
  wsClientMock._injectMessage({
    type: MSG.TASK_AVAILABLE,
    payload: {
      leaseId: p.leaseId,
      kind: 'interactive',
      prompt: 'hi',
      agentSessionId: p.sessionId,
      agentRunId: 'run-1',
      rootPath: tmpdir(),
      provider: p.provider ?? 'claude',
    },
  });
}

// batch fixture（task-runner 直测，照搬 daemon-provider-file-dispatch.test.ts）。

function makeLease(overrides: Partial<LeaseCtx> = {}): LeaseCtx {
  return {
    leaseId: 'lease-pfdl',
    runtimeId: 'rt-1',
    claimToken: 'tok',
    workspaceName: 'test-ws',
    claudeMd: '',
    prompt: 'do something',
    provider: 'claude',
    cmdPath: '/usr/local/bin/claude',
    agentRunId: 'run-1',
    ...overrides,
  };
}

function makeBatchClient(): Record<string, unknown> {
  return {
    startLease: vi.fn().mockResolvedValue({}),
    submitMessages: vi.fn().mockResolvedValue({ status: 'ok' }),
    completeLease: vi.fn().mockResolvedValue({}),
    leaseHeartbeat: vi.fn().mockResolvedValue({}),
  };
}

function makeBatchWorkspace(): Record<string, unknown> {
  return {
    prepareWorkspace: vi.fn().mockResolvedValue('/tmp/workspace'),
    collectDiff: vi.fn().mockResolvedValue({
      patch: '',
      files_changed: 0,
      insertions: 0,
      deletions: 0,
      stats: '0 files changed',
    }),
  };
}

function makeBatchCred(): Record<string, unknown> {
  return {
    get: vi.fn(() => undefined),
    buildEnv: vi.fn().mockReturnValue({}),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  rmFailState.failPathFrags = [];
  tmpRoot = mkdtempSync(join(tmpdir(), 'pfdl-'));
  vi.stubEnv('SILLYHUB_DAEMON_DIR', tmpRoot);
  vi.mocked(spawn).mockReturnValue(null as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(tmpRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ── 1. interactive 全链：创建 → 热切换重写 → 会话结束删除 ───────────────────────

describe('interactive 全链（D-011）：创建 → 热切换重写 → onSessionEnd 删除', () => {
  it('codex 会话：spawn 前创建 → PROVIDER_CONFIG_CHANGED 重写 → end 后两目录递归删 + Map 清空', async () => {
    const daemonRef: { current: Daemon | null } = { current: null };
    const sm = createMockSessionManager(daemonRef, {
      getState: (sid) => fakeState(sid, 'lease-lc'),
    });
    const built = buildDaemon({ sessionManager: sm });
    daemonRef.current = built.daemon;
    await built.daemon.start();

    // ① 创建：spawn 前写盘 + Map 登记。
    driveInteractiveStart(built.client, built.wsClientMock, {
      leaseId: 'lease-lc',
      sessionId: 'sess-lc',
      provider: 'codex',
      provider_config: codexConfig('sk-lc-old', 'https://old.example/v1', 'glm-old'),
    });
    await waitForSpy(sm.create as unknown as { mock: { calls: unknown[][] } });
    const codexHome = join(stubbedRoot(), 'codex', 'sess-lc');
    await waitForCond(() => existsSync(join(codexHome, 'config.toml')));
    expect(readFileSync(join(codexHome, 'auth.json'), 'utf-8')).toContain('sk-lc-old');
    expect(providerDirMap(built.daemon).get('sess-lc')).toEqual({ codexHome });

    // ② 热切换重写：产物更新为新供应商。
    built.wsClientMock._injectMessage({
      type: MSG.PROVIDER_CONFIG_CHANGED,
      payload: {
        session_id: 'sess-lc',
        provider_config: codexConfig('sk-lc-new', 'https://new.example/v1', 'glm-new'),
      },
    });
    await waitForCond(() =>
      readFileSync(join(codexHome, 'auth.json'), 'utf-8').includes('sk-lc-new'),
    );
    expect(readFileSync(join(codexHome, 'config.toml'), 'utf-8')).toContain(
      'https://new.example/v1',
    );

    // ③ 会话结束（end 路径统一收口）：codex + pi 两个确定性路径递归删 + Map 清空。
    await built.daemon.onSessionEnd('sess-lc', 'ended');
    expect(existsSync(codexHome)).toBe(false);
    expect(existsSync(join(stubbedRoot(), 'pi', 'sess-lc'))).toBe(false);
    expect(providerDirMap(built.daemon).has('sess-lc')).toBe(false);
    // 终态上报不受清理影响。
    expect(built.client.notifySessionEnd).toHaveBeenCalledWith('sess-lc', 'ended', 'manual');
    await built.daemon.stop();
  });

  it('fail 路径同样收口（onSessionEnd(failed) → 目录删除）', async () => {
    const built = buildDaemon();
    const piDir = join(stubbedRoot(), 'pi', 'sess-f');
    mkdirSync(piDir, { recursive: true });
    writeFileSync(join(piDir, 'settings.json'), '{}');

    await built.daemon.onSessionEnd('sess-f', 'failed');
    expect(existsSync(piDir)).toBe(false);
    expect(existsSync(join(stubbedRoot(), 'codex', 'sess-f'))).toBe(false);
    expect(built.client.notifySessionEnd).toHaveBeenCalledWith('sess-f', 'failed', 'driver_error');
    await built.daemon.stop();
  });
});

// ── 2. SESSION_END WS 路径同收口 ────────────────────────────────────────────────

describe('SESSION_END WS 路径：sessionManager.end → onSessionEnd → 目录删除', () => {
  it('inject SESSION_END（session_id+lease_id 匹配）→ per-session 目录被删', async () => {
    const daemonRef: { current: Daemon | null } = { current: null };
    const sm = createMockSessionManager(daemonRef, {
      getState: (sid) => fakeState(sid, 'lease-se'),
    });
    const built = buildDaemon({ sessionManager: sm });
    daemonRef.current = built.daemon;
    await built.daemon.start();

    const codexHome = join(stubbedRoot(), 'codex', 'sess-se');
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(join(codexHome, 'auth.json'), '{}');

    built.wsClientMock._injectMessage({
      type: MSG.SESSION_END,
      payload: { session_id: 'sess-se', lease_id: 'lease-se' },
    });
    await waitForCond(() => sm.end.mock.calls.length > 0);
    // end 桥接的 onSessionEnd 已同步 await 完成后目录即删。
    await waitForCond(() => !existsSync(codexHome));
    expect(existsSync(codexHome)).toBe(false);
    await built.daemon.stop();
  });
});

// ── 3. batch 收尾（TaskRunner.runLease finally）─────────────────────────────────

describe('batch 收尾：runLease 终态删 <root>/codex|pi/<leaseId>/', () => {
  it('codex lease：spawn 期间目录在，runLease 完成后被递归删', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new TaskRunner(
      makeBatchClient() as never,
      makeBatchWorkspace() as never,
      makeBatchCred() as never,
    );

    const codexHome = join(stubbedRoot(), 'codex', 'lease-pfdl');
    const p = runner.runLease(
      makeLease({ provider_config: codexConfig('sk-b1', 'https://b.example/v1', 'm1') }),
    );
    await waitForSpawn();
    // spawn 时目录已写盘（env 注入证据，task-03 已锁；此处只证「曾经存在」）。
    expect(existsSync(join(codexHome, 'auth.json'))).toBe(true);
    child._emitExit(0);
    const result = await p;

    expect(result.success).toBe(true);
    expect(existsSync(codexHome)).toBe(false);
    expect(existsSync(join(stubbedRoot(), 'pi', 'lease-pfdl'))).toBe(false);
  });

  it('pi lease 同理：完成后 <root>/pi/<leaseId>/ 被删', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new TaskRunner(
      makeBatchClient() as never,
      makeBatchWorkspace() as never,
      makeBatchCred() as never,
    );

    const piDir = join(stubbedRoot(), 'pi', 'lease-pfdl');
    const p = runner.runLease(
      makeLease({ provider_config: piConfig('sk-b2', 'https://p.example/v1', 'm2') }),
    );
    await waitForSpawn();
    expect(existsSync(join(piDir, 'settings.json'))).toBe(true);
    child._emitExit(0);
    const result = await p;

    expect(result.success).toBe(true);
    expect(existsSync(piDir)).toBe(false);
  });

  it('零 provider 任务（claude/absent）→ 收尾 no-op 不抛', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new TaskRunner(
      makeBatchClient() as never,
      makeBatchWorkspace() as never,
      makeBatchCred() as never,
    );

    const p = runner.runLease(makeLease());
    await waitForSpawn();
    child._emitExit(0);
    const result = await p;

    expect(result.success).toBe(true);
    expect(existsSync(join(stubbedRoot(), 'codex'))).toBe(false);
    expect(existsSync(join(stubbedRoot(), 'pi'))).toBe(false);
  });
});

// ── 4. 清理失败 warn 吞（不阻断终态流）─────────────────────────────────────────

describe('清理失败 → warn 吞，不阻断终态流', () => {
  it('interactive：rm 失败 → onSessionEnd 照常完成 + notifySessionEnd 已上报 + warn 日志', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const built = buildDaemon();
    const codexHome = join(stubbedRoot(), 'codex', 'sess-fl');
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(join(codexHome, 'auth.json'), '{}');
    // 注入：仅 codex 目录 rm 失败（pi 路径透传真实现，force no-op）。
    rmFailState.failPathFrags = ['/codex/sess-fl'];

    await expect(built.daemon.onSessionEnd('sess-fl', 'ended')).resolves.toBeUndefined();

    expect(built.client.notifySessionEnd).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls.some((c) => c[0] === '[daemon.provider_file_dir_cleanup_failed]')).toBe(true);
    // 失败目录残留（下次启动孤儿清扫兜底），Map 条目仍清（会话已终态）。
    expect(existsSync(codexHome)).toBe(true);
    expect(providerDirMap(built.daemon).has('sess-fl')).toBe(false);
    await built.daemon.stop();
  });

  it('batch：rm 失败 → runLease 仍 completed + warn 不抛', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new TaskRunner(
      makeBatchClient() as never,
      makeBatchWorkspace() as never,
      makeBatchCred() as never,
    );
    rmFailState.failPathFrags = ['/codex/lease-pfdl'];

    const p = runner.runLease(
      makeLease({ provider_config: codexConfig('sk-b3', 'https://b3.example/v1', 'm3') }),
    );
    await waitForSpawn();
    child._emitExit(0);
    const result = await p;

    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
    expect(
      warnSpy.mock.calls.some((c) => c[0] === 'task_runner: provider_file_dir_cleanup_failed'),
    ).toBe(true);
  });
});

// ── 5. daemon 重启孤儿清扫 ──────────────────────────────────────────────────────

describe('daemon 重启孤儿清扫：boot recover 后比对会话表', () => {
  it('不在会话表的 per-session 目录被删，存活会话目录保留', async () => {
    // 预置：孤儿两个（含 batch leaseId 残留形态）+ 存活会话目录一个。
    mkdirSync(join(stubbedRoot(), 'codex', 'orphan-a'), { recursive: true });
    writeFileSync(join(stubbedRoot(), 'codex', 'orphan-a', 'auth.json'), '{}');
    mkdirSync(join(stubbedRoot(), 'codex', 'live-sess'), { recursive: true });
    writeFileSync(join(stubbedRoot(), 'codex', 'live-sess', 'auth.json'), '{}');
    mkdirSync(join(stubbedRoot(), 'pi', 'orphan-b'), { recursive: true });

    const daemonRef: { current: Daemon | null } = { current: null };
    const sm = createMockSessionManager(daemonRef, {
      getState: (sid) => (sid === 'live-sess' ? fakeState(sid, 'lease-live') : undefined),
    });
    const built = buildDaemon({ sessionManager: sm });
    daemonRef.current = built.daemon;
    await built.daemon.start(); // 启动即清扫（start 内 await）

    expect(existsSync(join(stubbedRoot(), 'codex', 'orphan-a'))).toBe(false);
    expect(existsSync(join(stubbedRoot(), 'pi', 'orphan-b'))).toBe(false);
    expect(existsSync(join(stubbedRoot(), 'codex', 'live-sess', 'auth.json'))).toBe(true);
    await built.daemon.stop();
  });

  it('sessionManager 未注入（会话表不可得）→ 跳过清扫全保留（宁留勿删）', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    mkdirSync(join(stubbedRoot(), 'codex', 'orphan-c'), { recursive: true });

    const built = buildDaemon({ sessionManager: null });
    await built.daemon.start();

    expect(existsSync(join(stubbedRoot(), 'codex', 'orphan-c'))).toBe(true);
    expect(
      infoSpy.mock.calls.some((c) => c[0] === '[daemon.provider_file_dir_sweep_skipped_no_manager]'),
    ).toBe(true);
    await built.daemon.stop();
  });
});
