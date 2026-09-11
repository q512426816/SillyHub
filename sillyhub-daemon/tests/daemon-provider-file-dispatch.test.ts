// tests/daemon-provider-file-dispatch.test.ts
// change 2026-09-10-multi-provider-injection / task-03（FR-01/FR-02 / D-005 / D-011 /
// D-012 / Grill P2）。锁「两接线点分派 + applyClaudeSettings kind 守卫」：
//
//   1. 分派函数直测（applyProviderFileSettings，provider-file-settings.ts 单点
//      定义——2026-09-11-session-provider-switch-codex-pi task-01 自 task-runner.ts
//      平移）：
//      codex anthropic/openai_chat 形态产物 + env / pi 自定义端点三文件 + env /
//      门槛缺零 mkdir 零 env / pi 官方端点零写盘 / provider absent / claude kind
//      零文件层 env / mkdir·写盘 IO 失败 → 零 env 不抛；
//   2. batch 接线（TaskRunner.runLease + mock spawn）：codex/pi provider_config →
//      spawn opts.env 注入 per-session CODEX_HOME / PI_CODING_AGENT_DIR（目录段 =
//      leaseId）+ 文件落盘；IO 失败 → 跳 env 仍 spawn 仍完成；
//      （task-04 起 runLease 终态 finally 删 per-session 目录——文件断言移入
//      spawn 窗口内做，终态删除断言归 tests/daemon-provider-session-dir-lifecycle.test.ts）
//   3. interactive 接线（Daemon + ws TASK_AVAILABLE 驱动 _startInteractiveSession，
//      模式照搬 daemon-budget-wiring / daemon-interactive-codex）：codex 会话
//      SessionManager.create env.CODEX_HOME 指向 per-session 目录（段 = agent_sessions.id）；
//   4. kind 守卫（Grill P2）：applyClaudeSettings（mock）仅 agent_kind='claude' 或
//      缺省触发——codex/pi kind 不调用（settings_config 不写穿 claude 目录）。
//
// 隔离：vi.stubEnv('SILLYHUB_DAEMON_DIR', tmpRoot)——分派 helper 用 config.ts
// daemonStateDir() 懒求值（每次调用现读 env），per-session codex/pi 目录挂其下，
// 测试零触碰真实 ~/.sillyhub。claude-settings mock 掉（守卫断言只看调用与否，
// 其写盘行为归 tests/claude-settings.test.ts）。

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

// ql 预存债预防（daemon-interactive-codex 先例）：daemon 交互链调真实
// linkSkillsToWorkdir + mkdir 拖慢 create 调用，mock 掉；syncSkills 同源
//（daemon.start 启动同步，mock 掉防真实拷盘噪音）。
vi.mock('../src/skill-manager.js', () => ({
  syncSkills: vi.fn(async () => ({ synced: 0, skipped: true })),
  linkSkillsToWorkdir: vi.fn(async () => ({ linked: 0, skipped: true })),
}));

// kind 守卫断言载体：mock applyClaudeSettings（返回 undefined 可安全 await）。
vi.mock('../src/claude-settings.js', () => ({
  applyClaudeSettings: vi.fn(async () => undefined),
}));

// batch 接线需要拦 spawn（TaskRunner._spawnAndStream）；保留 actual 其余导出。
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
  statSync,
  writeFileSync,
} from 'node:fs';
// vi.mock 已 hoist，import 拿到 mock 版本。
import { applyClaudeSettings } from '../src/claude-settings.js';
import { TaskRunner } from '../src/task-runner.js';
// 2026-09-11-session-provider-switch-codex-pi task-01：分派函数平移至共享模块
//（纯移动自 task-runner.ts，断言与用例零改动）。
import { applyProviderFileSettings } from '../src/provider-file-settings.js';
import { Daemon } from '../src/daemon.js';
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

/** codex anthropic 直连形态（门槛满足：api_key/base_url 至少一项）。 */
function codexAnthropicConfig(): ProviderConfig {
  return {
    agent_kind: 'codex',
    api_key: 'sk-codex-direct',
    base_url: 'https://direct.example/v1',
    model: 'glm-4.7',
  };
}

/** pi 自定义端点形态（base_url 非空 + api_key + model 齐）。 */
function piCustomConfig(): ProviderConfig {
  return {
    agent_kind: 'pi',
    api_key: 'sk-pi-custom',
    base_url: 'https://pi.example/v1',
    model: 'kimi-k2',
  };
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  tmpRoot = mkdtempSync(join(tmpdir(), 'pfd-'));
  vi.stubEnv('SILLYHUB_DAEMON_DIR', tmpRoot);
  vi.mocked(spawn).mockReturnValue(null as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(tmpRoot, { recursive: true, force: true });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── 1. 分派函数直测 ───────────────────────────────────────────────────────────

describe('applyProviderFileSettings：kind 分派 + per-session 目录布局（D-011）', () => {
  it('codex anthropic 形态：写 auth.json+config.toml → {CODEX_HOME: <root>/codex/<sessionKey>}', async () => {
    const env = await applyProviderFileSettings({
      sessionKey: 'sess-u1',
      provider: codexAnthropicConfig(),
      daemonApiKey: null,
    });

    const codexHome = join(stubbedRoot(), 'codex', 'sess-u1');
    expect(env).toEqual({ CODEX_HOME: codexHome });
    // 产物 1：auth.json（per-form key = provider.api_key）。
    const auth = readJson(join(codexHome, 'auth.json'));
    expect(auth['OPENAI_API_KEY']).toBe('sk-codex-direct');
    // 产物 2：config.toml（wire_api=responses 唯一值 + 托管 provider 表）。
    const toml = readFileSync(join(codexHome, 'config.toml'), 'utf-8');
    expect(toml).toContain('base_url = "https://direct.example/v1"');
    expect(toml).toContain('model = "glm-4.7"');
    expect(toml).toContain('model_provider = "sillyhub"');
    expect(toml).toContain('wire_api = "responses"');
  });

  it('codex openai_chat 形态：auth key=daemonApiKey + litellm 通道字段（master key 不出 backend）', async () => {
    const env = await applyProviderFileSettings({
      sessionKey: 'sess-u2',
      provider: {
        agent_kind: 'codex',
        api_format: 'openai_chat',
        litellm_base_url: 'http://hub.test/api/daemon/llm-proxy',
        litellm_model_name: 'usr-1-2',
      },
      daemonApiKey: 'daemon-master-key',
    });

    const codexHome = join(stubbedRoot(), 'codex', 'sess-u2');
    expect(env).toEqual({ CODEX_HOME: codexHome });
    const auth = readJson(join(codexHome, 'auth.json'));
    expect(auth['OPENAI_API_KEY']).toBe('daemon-master-key');
    const toml = readFileSync(join(codexHome, 'config.toml'), 'utf-8');
    expect(toml).toContain('base_url = "http://hub.test/api/daemon/llm-proxy"');
    expect(toml).toContain('model = "usr-1-2"');
  });

  it('codex 门槛缺（anthropic 形态 api_key/base_url 全空）→ 零 mkdir 零写入零 env', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const env = await applyProviderFileSettings({
      sessionKey: 'sess-u3',
      provider: { agent_kind: 'codex' },
      daemonApiKey: null,
    });

    expect(env).toEqual({});
    expect(existsSync(join(stubbedRoot(), 'codex'))).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      'provider_file_dispatch_codex_skipped_missing_fields',
      expect.objectContaining({ session_key: 'sess-u3' }),
    );
  });

  it('pi 自定义端点：写三文件 → {PI_CODING_AGENT_DIR: <root>/pi/<sessionKey>}', async () => {
    const env = await applyProviderFileSettings({
      sessionKey: 'sess-p1',
      provider: piCustomConfig(),
      daemonApiKey: null,
    });

    const piDir = join(stubbedRoot(), 'pi', 'sess-p1');
    expect(env).toEqual({ PI_CODING_AGENT_DIR: piDir });
    const auth = readJson(join(piDir, 'auth.json'));
    expect(auth['sillyhub']).toEqual({ type: 'api_key', key: 'sk-pi-custom' });
    const models = readJson(join(piDir, 'models.json'));
    const providers = models['providers'] as Record<string, Record<string, unknown>>;
    expect(providers['sillyhub']?.['api']).toBe('anthropic-messages');
    expect(providers['sillyhub']?.['baseUrl']).toBe('https://pi.example/v1');
    const settings = readJson(join(piDir, 'settings.json'));
    expect(settings['defaultProvider']).toBe('sillyhub');
    expect(settings['defaultModel']).toBe('kimi-k2');
  });

  it('pi 官方端点（base_url 空）→ 零写盘零 env（env 层负责，D-008 分层）', async () => {
    const env = await applyProviderFileSettings({
      sessionKey: 'sess-p2',
      provider: { agent_kind: 'pi', api_key: 'sk-pi-official', model: 'm1' },
      daemonApiKey: null,
    });

    expect(env).toEqual({});
    expect(existsSync(join(stubbedRoot(), 'pi'))).toBe(false);
  });

  it('provider_config 整体 absent（null/undefined）→ 不写不注入（D-012 边界）', async () => {
    expect(
      await applyProviderFileSettings({ sessionKey: 's', provider: null, daemonApiKey: null }),
    ).toEqual({});
    expect(
      await applyProviderFileSettings({ sessionKey: 's', provider: undefined, daemonApiKey: null }),
    ).toEqual({});
  });

  it('claude / 缺省 kind → 无文件层 env、无 codex/pi 目录', async () => {
    for (const provider of [
      { agent_kind: 'claude', api_key: 'k', base_url: 'u' },
      { api_key: 'k', base_url: 'u' },
    ] as ProviderConfig[]) {
      const env = await applyProviderFileSettings({
        sessionKey: 'sess-c',
        provider,
        daemonApiKey: null,
      });
      expect(env).toEqual({});
    }
    expect(existsSync(join(stubbedRoot(), 'codex'))).toBe(false);
    expect(existsSync(join(stubbedRoot(), 'pi'))).toBe(false);
  });

  it('mkdir IO 失败（codex 路径被同名文件占用）→ 记 error 返回 {} 不抛', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    writeFileSync(join(stubbedRoot(), 'codex'), 'not-a-dir');

    const env = await applyProviderFileSettings({
      sessionKey: 'sess-io1',
      provider: codexAnthropicConfig(),
      daemonApiKey: null,
    });

    expect(env).toEqual({});
    expect(errSpy).toHaveBeenCalledWith(
      'provider_file_dispatch_codex_failed',
      expect.objectContaining({ session_key: 'sess-io1' }),
    );
  });

  it('写盘 IO 失败（writePiDir reject：auth.json 被同名目录占用）→ 跳过 env 不抛（失败语义唯一化）', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // 目录已建 + auth.json 是目录 → writeFile EISDIR → writePiDir reject。
    mkdirSync(join(stubbedRoot(), 'pi', 'sess-io2', 'auth.json'), { recursive: true });

    const env = await applyProviderFileSettings({
      sessionKey: 'sess-io2',
      provider: piCustomConfig(),
      daemonApiKey: null,
    });

    expect(env).toEqual({});
    expect(errSpy).toHaveBeenCalledWith(
      'provider_file_dispatch_pi_failed',
      expect.objectContaining({ session_key: 'sess-io2' }),
    );
  });
});

// ── 2. batch 接线（TaskRunner.runLease）────────────────────────────────────────

function makeLease(overrides: Partial<LeaseCtx> = {}): LeaseCtx {
  return {
    leaseId: 'lease-pfd',
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

function makeClient(): Record<string, unknown> {
  return {
    startLease: vi.fn().mockResolvedValue({}),
    submitMessages: vi.fn().mockResolvedValue({ status: 'ok' }),
    completeLease: vi.fn().mockResolvedValue({}),
    leaseHeartbeat: vi.fn().mockResolvedValue({}),
  };
}

function makeWorkspace(): Record<string, unknown> {
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

function makeCred(): Record<string, unknown> {
  return {
    get: vi.fn(() => undefined),
    buildEnv: vi.fn().mockReturnValue({}),
  };
}

describe('batch 接线：runLease → per-session 写盘 + spawn env 注入（目录段=leaseId）', () => {
  it('codex provider_config → spawn env.CODEX_HOME 指向 <root>/codex/<leaseId>，文件已写', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new TaskRunner(
      makeClient() as never,
      makeWorkspace() as never,
      makeCred() as never,
    );

    const codexHome = join(stubbedRoot(), 'codex', 'lease-pfd');
    const p = runner.runLease(makeLease({ provider_config: codexAnthropicConfig() }));
    await waitForSpawn();
    // task-04（D-011 收尾）：文件断言移入 spawn 窗口——runLease 终态 finally 会删
    // per-session 目录（终态后 existsSync 恒 false，生命周期断言见
    // daemon-provider-session-dir-lifecycle.test.ts）。
    expect(existsSync(join(codexHome, 'auth.json'))).toBe(true);
    expect(existsSync(join(codexHome, 'config.toml'))).toBe(true);
    child._emitExit(0);
    const result = await p;

    const spawnCall = vi.mocked(spawn).mock.calls[0]!;
    const opts = spawnCall[2] as { env: NodeJS.ProcessEnv };
    expect(opts.env['CODEX_HOME']).toBe(codexHome);
    expect(opts.env['PI_CODING_AGENT_DIR']).toBeUndefined();
    // 失败语义：写盘失败跳 env 才跳 env——本例写盘成功，任务照常完成。
    expect(result.success).toBe(true);
    // kind 守卫（Grill P2）：codex kind 不调 applyClaudeSettings。
    expect(applyClaudeSettings).not.toHaveBeenCalled();
  });

  it('pi 自定义端点 provider_config → spawn env.PI_CODING_AGENT_DIR + 三文件 + kind 守卫', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new TaskRunner(
      makeClient() as never,
      makeWorkspace() as never,
      makeCred() as never,
    );

    const piDir = join(stubbedRoot(), 'pi', 'lease-pfd');
    const p = runner.runLease(makeLease({ provider_config: piCustomConfig() }));
    await waitForSpawn();
    // task-04（D-011 收尾）：同上——文件断言移入 spawn 窗口（终态 finally 删目录）。
    expect(existsSync(join(piDir, 'auth.json'))).toBe(true);
    expect(existsSync(join(piDir, 'models.json'))).toBe(true);
    expect(existsSync(join(piDir, 'settings.json'))).toBe(true);
    child._emitExit(0);
    await p;

    const spawnCall = vi.mocked(spawn).mock.calls[0]!;
    const opts = spawnCall[2] as { env: NodeJS.ProcessEnv };
    expect(opts.env['PI_CODING_AGENT_DIR']).toBe(piDir);
    expect(opts.env['CODEX_HOME']).toBeUndefined();
    expect(applyClaudeSettings).not.toHaveBeenCalled();
  });

  it('claude kind → applyClaudeSettings 被调 + 无文件层 env（守卫正向）', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new TaskRunner(
      makeClient() as never,
      makeWorkspace() as never,
      makeCred() as never,
    );
    const pc: ProviderConfig = {
      agent_kind: 'claude',
      api_key: 'sk-claude',
      settings_config: { model: 'claude-sonnet-4' },
    };

    const p = runner.runLease(makeLease({ provider_config: pc }));
    await waitForSpawn();
    child._emitExit(0);
    await p;

    expect(applyClaudeSettings).toHaveBeenCalledTimes(1);
    expect(applyClaudeSettings).toHaveBeenCalledWith(pc);
    const spawnCall = vi.mocked(spawn).mock.calls[0]!;
    const opts = spawnCall[2] as { env: NodeJS.ProcessEnv };
    expect(opts.env['CODEX_HOME']).toBeUndefined();
    expect(opts.env['PI_CODING_AGENT_DIR']).toBeUndefined();
  });

  it('provider_config absent → applyClaudeSettings 照旧被调（null 语义，零回归）', async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new TaskRunner(
      makeClient() as never,
      makeWorkspace() as never,
      makeCred() as never,
    );

    const p = runner.runLease(makeLease());
    await waitForSpawn();
    child._emitExit(0);
    await p;

    expect(applyClaudeSettings).toHaveBeenCalledTimes(1);
    expect(applyClaudeSettings).toHaveBeenCalledWith(undefined);
    expect(existsSync(join(stubbedRoot(), 'codex'))).toBe(false);
    expect(existsSync(join(stubbedRoot(), 'pi'))).toBe(false);
  });

  it('写盘 IO 失败 → 跳过 CODEX_HOME env 仍 spawn 仍完成（失败语义唯一化）', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // codex 目录段被同名文件占用 → mkdir 失败 → 零 env。
    writeFileSync(join(stubbedRoot(), 'codex'), 'not-a-dir');
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new TaskRunner(
      makeClient() as never,
      makeWorkspace() as never,
      makeCred() as never,
    );

    const p = runner.runLease(makeLease({ provider_config: codexAnthropicConfig() }));
    await waitForSpawn();
    child._emitExit(0);
    const result = await p;

    const spawnCall = vi.mocked(spawn).mock.calls[0]!;
    const opts = spawnCall[2] as { env: NodeJS.ProcessEnv };
    expect(opts.env['CODEX_HOME']).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
  });
});

// ── 3. interactive 接线（Daemon + ws TASK_AVAILABLE）───────────────────────────

const mockConfig: DaemonConfig = {
  server_url: 'http://127.0.0.1:8000',
  token: 'test-token',
  runtime_id: 'runtime-uuid-pfd',
  profile: 'default',
  workspace_dir: '/tmp/ws-pfd',
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

function createMockSessionManager(): SessionManager {
  const sm = {
    create: vi.fn(async () => {}),
    inject: vi.fn(async () => ({ runId: '' })),
    interrupt: vi.fn(async () => false),
    end: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    get: vi.fn(
      (_sid: string) => undefined as Readonly<SessionState> | undefined,
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
    refreshClaimToken: vi.fn(async () => {}),
    markPendingSwitch: vi.fn(),
  };
  return sm as unknown as SessionManager & { create: ReturnType<typeof vi.fn> };
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

function buildDaemon(opts: { agents?: DetectedAgent[] } = {}) {
  const client = createMockClient();
  const sessionManager = createMockSessionManager();
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
  return { daemon, client, sessionManager, wsClientMock };
}

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

describe('interactive 接线：_startInteractiveSession → per-session 写盘 + create env（目录段=agent_sessions.id）', () => {
  let daemons: Daemon[] = [];

  afterEach(async () => {
    for (const d of daemons) {
      if (d.isRunning) {
        await d.stop().catch(() => undefined);
      }
    }
    daemons = [];
  });

  it('codex 会话：create env.CODEX_HOME 指向 <root>/codex/<sessionId>，文件已写', async () => {
    const { daemon, client, sessionManager, wsClientMock } = buildDaemon();
    daemons.push(daemon);
    await daemon.start();

    driveInteractiveStart(client, wsClientMock, {
      leaseId: 'lease-cx',
      sessionId: 'sess-cx1',
      provider: 'codex',
      provider_config: codexAnthropicConfig(),
    });
    await waitForSpy(sessionManager.create as unknown as { mock: { calls: unknown[][] } });

    const createArg = (sessionManager.create as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      env: NodeJS.ProcessEnv;
    };
    const codexHome = join(stubbedRoot(), 'codex', 'sess-cx1');
    expect(createArg.env['CODEX_HOME']).toBe(codexHome);
    expect(existsSync(join(codexHome, 'auth.json'))).toBe(true);
    expect(existsSync(join(codexHome, 'config.toml'))).toBe(true);
    // kind 守卫（Grill P2）：codex kind 不调 applyClaudeSettings。
    expect(applyClaudeSettings).not.toHaveBeenCalled();
    await daemon.stop();
  });

  it('pi 自定义端点：create env.PI_CODING_AGENT_DIR + 三文件 + kind 守卫', async () => {
    const { daemon, client, sessionManager, wsClientMock } = buildDaemon();
    daemons.push(daemon);
    await daemon.start();

    driveInteractiveStart(client, wsClientMock, {
      leaseId: 'lease-pi',
      sessionId: 'sess-pi1',
      provider: 'claude',
      provider_config: piCustomConfig(),
    });
    await waitForSpy(sessionManager.create as unknown as { mock: { calls: unknown[][] } });

    const createArg = (sessionManager.create as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      env: NodeJS.ProcessEnv;
    };
    const piDir = join(stubbedRoot(), 'pi', 'sess-pi1');
    expect(createArg.env['PI_CODING_AGENT_DIR']).toBe(piDir);
    expect(statSync(join(piDir, 'settings.json')).isFile()).toBe(true);
    expect(applyClaudeSettings).not.toHaveBeenCalled();
    await daemon.stop();
  });

  it('claude kind / provider_config absent：applyClaudeSettings 照旧（守卫正向 + 零回归）', async () => {
    const { daemon, client, sessionManager, wsClientMock } = buildDaemon();
    daemons.push(daemon);
    await daemon.start();

    const pc: ProviderConfig = {
      agent_kind: 'claude',
      api_key: 'sk-claude',
      settings_config: { model: 'claude-sonnet-4' },
    };
    driveInteractiveStart(client, wsClientMock, {
      leaseId: 'lease-cl',
      sessionId: 'sess-cl1',
      provider: 'claude',
      provider_config: pc,
    });
    await waitForSpy(sessionManager.create as unknown as { mock: { calls: unknown[][] } });

    expect(applyClaudeSettings).toHaveBeenCalledTimes(1);
    expect(applyClaudeSettings).toHaveBeenCalledWith(pc);
    const createArg = (sessionManager.create as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      env: NodeJS.ProcessEnv;
    };
    expect(createArg.env['CODEX_HOME']).toBeUndefined();
    expect(createArg.env['PI_CODING_AGENT_DIR']).toBeUndefined();
    await daemon.stop();
  });
});
