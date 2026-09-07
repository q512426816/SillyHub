// tests/daemon-spec-prefetch.test.ts
// ql-20260907-010（quick）：spec 拉取工作区级化——心跳驱动后台预取 + single-flight。
//
// 实机背景：spec pull 挂在会话创建关键路径（daemon.ts specStep），47MB 树 /
// ~0.4MB/s 公网链路下每次版本落后都现场下载 40s+（会话 2057cde1 / 834486c1：
// spec_pull_ms 44408 / 42548），且并发会话各拉一份抢同一链路。修法：
//   ① single-flight：同工作区同时只有一个 pullSpecBundle 在飞，并发创建共享；
//   ② 心跳预取：心跳响应 spec_versions（服务器权威版本）比对本地落后且该
//      工作区无活跃会话 → 后台预取，把下载挪出创建关键路径；
//   ③ 活跃会话门控：agent 正在读写 spec 目录时绝不后台动盘。
//
// 覆盖：
//   A. 并发创建同工作区 → getSpecBundle 只调一次（single-flight）
//   B. 心跳对答：本地落后 + 无活跃会话 → 后台预取触发（getSpecBundle 调用）
//   C. 活跃会话门控：该工作区有活跃会话 → 不预取
//   D. 版本不落后（server <= local）→ 不预取
//   E. 旧 backend 无 spec_versions 键 → 不预取（零依赖兼容）
//
// 环境隔离：SILLYHUB_DAEMON_DIR 指向 tmp（daemonStateDir 运行时读 env），
// specs/<ws>/.runtime/spec-version.json 种本地版本；getSpecBundle 用慢 mock
// （150ms）放大并发窗口验证去重。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Daemon } from '../src/daemon.js';
import type { DaemonConfig } from '../src/config.js';
import type { DetectedAgent } from '../src/agent-detector.js';
import type { SessionManager } from '../src/interactive/session-manager.js';
import { readLocalSpecVersion, resolveSpecDir } from '../src/spec-sync.js';

const WS_ID = 'ws-spec-prefetch-test';

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

function createMockClient(opts: { bundleDelayMs?: number } = {}) {
  const bundleDelay = opts.bundleDelayMs ?? 150;
  return {
    register: vi.fn(async () => ({ id: 'srv-rid-1' })),
    heartbeat: vi.fn(async () => ({})),
    markOffline: vi.fn(async () => ({})),
    claimLease: vi.fn(async () => ({ claim_token: 't', payload: {} })),
    startLease: vi.fn(async () => ({})),
    completeLease: vi.fn(async () => ({})),
    getPendingLeases: vi.fn(async () => []),
    getExecutionContext: vi.fn(async () => ({ agent_run_id: 'r' })),
    close: vi.fn(),
    notifyRunResult: vi.fn(async () => ({})),
    submitMessages: vi.fn(async () => ({})),
    notifySessionEnd: vi.fn(async () => ({})),
    notifySessionReady: vi.fn(async () => ({})),
    confirmReconnected: vi.fn(async () => ({})),
    markRecoveryFailed: vi.fn(async () => ({})),
    suspendSessions: vi.fn(async () => ({})),
    postSpecSync: vi.fn(async () => ({ ok: true, reparsed: 0 })),
    // 慢 bundle：放大并发窗口；空 tar（0 字节）extractTar 零条目即成功。
    getSpecBundle: vi.fn(async () => {
      await new Promise((r) => setTimeout(r, bundleDelay));
      return Buffer.alloc(0);
    }),
  };
}

function createMockSessionManager(
  stateMap = new Map<string, Partial<Record<string, unknown>>>(),
): SessionManager {
  const sm = {
    create: vi.fn(async () => {}),
    inject: vi.fn(async () => ({ runId: 'run-ok' })),
    interrupt: vi.fn(async () => false),
    end: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    get: vi.fn((sid: string) => stateMap.get(sid)),
  };
  return sm as unknown as SessionManager;
}

function buildDaemon(client: ReturnType<typeof createMockClient>, sm: SessionManager) {
  const detector = {
    detectAgents: vi.fn(async () => [
      {
        provider: 'claude',
        path: 'C:\\bin\\claude.exe',
        version: '1.0.0',
        protocol: 'stream_json',
        status: 'available',
        versionWarning: null,
      } satisfies DetectedAgent,
    ]),
  };
  const daemon = new Daemon(
    mockConfig,
    client as never,
    { runLease: vi.fn(async () => ({})) } as never,
    { detector, sessionManager: sm } as never,
  );
  // _agentPaths 在 start() 的 detectAgents 才填充；本测试不跑 start 全链
  //（避免真实 WsClient 连接），直填等价值（对齐 inject-drop 测试直置 _running
  // 的同款前提注入惯例）。
  (daemon as unknown as { _agentPaths: Map<string, string> })._agentPaths.set(
    'claude',
    'C:\\bin\\claude.exe',
  );
  return daemon;
}

/** 种本地 spec 缓存版本：specs/<ws>/.runtime/spec-version.json。 */
async function seedLocalSpecVersion(version: number, syncedAt?: string): Promise<void> {
  const statePath = join(resolveSpecDir(WS_ID), '.runtime', 'spec-version.json');
  await mkdir(join(resolveSpecDir(WS_ID), '.runtime'), { recursive: true });
  await writeFile(
    statePath,
    JSON.stringify({ spec_version: version, ...(syncedAt ? { synced_at: syncedAt } : {}) }),
    'utf-8',
  );
}

/** 直调 _startInteractiveSession（私有）：tar 模式 + 指定 lease 版本。 */
function startSession(
  daemon: Daemon,
  opts: { leaseId: string; sessionId: string; latestSpecVersion?: number },
): Promise<void> {
  const call = (
    daemon as unknown as {
      _startInteractiveSession: (
        leaseId: string,
        payload: Record<string, unknown>,
      ) => Promise<void>;
    }
  )._startInteractiveSession.bind(daemon);
  return call(opts.leaseId, {
    kind: 'interactive',
    prompt: 'hi',
    provider: 'claude',
    agentSessionId: opts.sessionId,
    agentRunId: `${opts.sessionId}-run`,
    rootPath: tmpdir(),
    claimToken: 'token-1',
    transport: 'tar',
    workspaceId: WS_ID,
    latestSpecVersion: opts.latestSpecVersion ?? 6,
  });
}

/** 单发心跳（私有 _sendHeartbeatOnce；预置已注册 provider + 运行态）。 */
async function sendHeartbeatOnce(
  daemon: Daemon,
  resp: Record<string, unknown>,
): Promise<boolean> {
  const internal = daemon as unknown as {
    _registeredRuntimes: Map<string, string>;
    _running: boolean;
    _sendHeartbeatOnce: () => Promise<boolean>;
  };
  internal._registeredRuntimes.set('claude', 'srv-rid-1');
  // 运行态门控：spec 缓存上报/预取只在 _running 时生效（对齐 inject-drop 测试
  // 直置 _running 的前提注入惯例——等待路径/心跳行为只存在于运行态）。
  internal._running = true;
  internal._sendHeartbeatOnce = internal._sendHeartbeatOnce.bind(daemon);
  // heartbeat mock 返回固定响应（spec_versions 由用例给定）。
  return internal._sendHeartbeatOnce();
}

/** 轮询等待断言成立（上限 3s，对齐 kind-dispatch waitForSpy 惯例；支持异步条件）。 */
async function waitUntil(
  fn: () => boolean | Promise<boolean>,
  timeoutMs = 3000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error('waitUntil: 条件在超时内未成立');
}

describe('daemon spec 拉取工作区级化（ql-20260907-010）', () => {
  let tmpHome: string;
  let origDir: string | undefined;

  beforeEach(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), 'spec-prefetch-'));
    origDir = process.env.SILLYHUB_DAEMON_DIR;
    process.env.SILLYHUB_DAEMON_DIR = tmpHome;
    await seedLocalSpecVersion(5, new Date().toISOString());
  });
  afterEach(async () => {
    if (origDir === undefined) delete process.env.SILLYHUB_DAEMON_DIR;
    else process.env.SILLYHUB_DAEMON_DIR = origDir;
    await rm(tmpHome, { recursive: true, force: true });
  });

  it('A. 并发创建同工作区 → single-flight：getSpecBundle 只调一次', async () => {
    const client = createMockClient();
    const sm = createMockSessionManager();
    const daemon = buildDaemon(client, sm);

    // 两个会话同时创建（不同 lease，同工作区）：本地 v5 / lease v6 → 都走 pull，
    // single-flight 合并为一次下载。
    await Promise.all([
      startSession(daemon, { leaseId: 'lease-a', sessionId: 'sess-a' }),
      startSession(daemon, { leaseId: 'lease-b', sessionId: 'sess-b' }),
    ]);

    expect(client.getSpecBundle).toHaveBeenCalledTimes(1);
    expect(sm.create).toHaveBeenCalledTimes(2);
    expect(await readLocalSpecVersion(resolveSpecDir(WS_ID))).toBe(6);
  });

  it('B. 心跳对答：本地 5 / 服务器 9 + 无活跃会话 → 后台预取触发', async () => {
    const client = createMockClient();
    client.heartbeat.mockResolvedValue({ spec_versions: { [WS_ID]: 9 } });
    const sm = createMockSessionManager();
    const daemon = buildDaemon(client, sm);

    // 未跑 start()：_sendHeartbeatOnce 直调（构造态即可），响应触发预取。
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    await sendHeartbeatOnce(daemon, {});
    await waitUntil(() => client.getSpecBundle.mock.calls.length > 0);

    expect(client.getSpecBundle).toHaveBeenCalledTimes(1);
    // 预取完成后本地版本对齐服务器权威版本（下个会话创建即跳过 pull）。
    await waitUntil(
      async () => (await readLocalSpecVersion(resolveSpecDir(WS_ID))) === 9,
    );
    infoSpy.mockRestore();
  });

  it('C. 活跃会话门控：该工作区有活跃会话 → 心跳不后台预取', async () => {
    const client = createMockClient();
    client.heartbeat.mockResolvedValue({ spec_versions: { [WS_ID]: 9 } });
    const stateMap = new Map<string, Partial<Record<string, unknown>>>();
    stateMap.set('sess-live', { sessionId: 'sess-live', leaseId: 'lease-live', status: 'running' });
    const sm = createMockSessionManager(stateMap);
    const daemon = buildDaemon(client, sm);

    // 记账：sess-live 活跃于该工作区（store 中也存在）。
    const note = (
      daemon as unknown as {
        _noteSessionActive: (sid: string, wsId: string | undefined) => void;
      }
    )._noteSessionActive.bind(daemon);
    note('sess-live', WS_ID);

    await sendHeartbeatOnce(daemon, {});
    // 给足预取窗口（bundle mock 150ms）再确认未触发。
    await new Promise((r) => setTimeout(r, 300));

    expect(client.getSpecBundle).not.toHaveBeenCalled();
  });

  it('D. 版本不落后（server=5 == local）→ 不预取', async () => {
    const client = createMockClient();
    client.heartbeat.mockResolvedValue({ spec_versions: { [WS_ID]: 5 } });
    const daemon = buildDaemon(client, createMockSessionManager());

    await sendHeartbeatOnce(daemon, {});
    await new Promise((r) => setTimeout(r, 300));

    expect(client.getSpecBundle).not.toHaveBeenCalled();
  });

  it('E. 旧 backend 无 spec_versions 键 → 不预取（零依赖兼容）', async () => {
    const client = createMockClient();
    // heartbeat mock 缺省返回 {}（无 spec_versions）。
    const daemon = buildDaemon(client, createMockSessionManager());

    await sendHeartbeatOnce(daemon, {});
    await new Promise((r) => setTimeout(r, 300));

    expect(client.getSpecBundle).not.toHaveBeenCalled();
  });
});
