// tests/cli-session-manager-injection.test.ts
// Wave2 task-04（gap-1）：cli.startAction 注入 SessionManager（deps 闭包延迟绑定 daemon）。
//
// 覆盖（design §2 + §6 + R1 循环引用）：
//   - startAction 构造 Daemon 时传入 options.sessionManager（SessionManager 实例，非 null）
//   - SessionManager 的 deps 含 driver（ClaudeSdkDriver 实例）+ onTurnResult/onTurnMessage/onSessionEnd
//   - deps 回调为 function（闭包延迟绑定 daemon，daemon 构造后可调）
//   - deps.onTurnResult/onTurnMessage/onSessionEnd 调用 forward 到 daemon 对应方法
//   - batch 零回归（taskRunner 仍注入）
//
// 策略：vi.mock 替换 Daemon / SessionManager / ClaudeSdkDriver / HubClient / TaskRunner
// / WorkspaceManager / CredentialManager，避免触发真实 daemon 三循环（startAction 内
// while daemon.isRunning 死循环）+ 真实 SDK。mock Daemon isRunning=false 让 startAction
// 立即返回，捕获 options.sessionManager 与 deps 回调。

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { resolve } from 'node:path';
import { makeTmpDir, cleanupDir } from './helpers.js';

// ── 捕获桩：vi.mock 在 import 前注册（hoist）─────────────────────────────────

const captured: {
  daemonCtorArgs: {
    config: unknown;
    client: unknown;
    taskRunner: unknown;
    options: Record<string, unknown> | undefined;
  } | null;
  sessionManagerInstances: Array<{
    deps: Record<string, unknown>;
    opts: Record<string, unknown> | undefined;
  }>;
  driverInstances: unknown[];
  daemonOnTurnResultCalls: Array<unknown[]>;
  daemonOnTurnMessageCalls: Array<unknown[]>;
  daemonOnSessionEndCalls: Array<unknown[]>;
} = {
  daemonCtorArgs: null,
  sessionManagerInstances: [],
  driverInstances: [],
  daemonOnTurnResultCalls: [],
  daemonOnTurnMessageCalls: [],
  daemonOnSessionEndCalls: [],
};

// 每个 test 前 reset
function resetCaptured(): void {
  captured.daemonCtorArgs = null;
  captured.sessionManagerInstances = [];
  captured.driverInstances = [];
  captured.daemonOnTurnResultCalls = [];
  captured.daemonOnTurnMessageCalls = [];
  captured.daemonOnSessionEndCalls = [];
}

// Daemon mock：构造时 capture args + isRunning=false 让 startAction while 立即退出。
// 不依赖 vi.fn().mockImplementation（restoreAllMocks 后实现可能被清）——
// 直接给构造器函数，每次 new 返回稳定带方法的实例。
vi.mock('../src/daemon.js', () => {
  class DaemonMock {
    constructor(config, client, taskRunner, options) {
      captured.daemonCtorArgs = { config, client, taskRunner, options };
    }
    isRunning = false;
    async start() {}
    async stop() {}
    async onTurnResult(...args) {
      captured.daemonOnTurnResultCalls.push(args);
    }
    async onTurnMessage(...args) {
      captured.daemonOnTurnMessageCalls.push(args);
    }
    async onSessionEnd(...args) {
      captured.daemonOnSessionEndCalls.push(args);
    }
  }
  return { Daemon: DaemonMock };
});

// SessionManager mock：构造时 capture deps。
vi.mock('../src/interactive/session-manager.js', () => {
  class SessionManagerMock {
    constructor(deps, opts) {
      captured.sessionManagerInstances.push({ deps, opts });
      this.deps = deps;
    }
    async create() {}
    async inject() {
      return { runId: '' };
    }
    async interrupt() {
      return false;
    }
    async end() {}
    async fail() {}
    get() {
      return undefined;
    }
    start() {}
    stop() {}
  }
  return { SessionManager: SessionManagerMock };
});

// ClaudeSdkDriver mock：构造时 capture 实例（验证 deps.driver 是其实例）。
vi.mock('../src/interactive/claude-sdk-driver.js', () => {
  class ClaudeSdkDriverMock {
    constructor() {
      captured.driverInstances.push(this);
    }
    start() {
      return {};
    }
    async consume() {}
    async interrupt() {
      return false;
    }
  }
  return { ClaudeSdkDriver: ClaudeSdkDriverMock };
});

// HubClient / TaskRunner / WorkspaceManager / CredentialManager / config 轻量 mock。
vi.mock('../src/hub-client.js', () => ({
  HubClient: vi.fn().mockImplementation(() => ({ close: vi.fn() })),
}));
vi.mock('../src/task-runner.js', () => ({
  TaskRunner: vi.fn().mockImplementation(() => ({ runLease: vi.fn() })),
}));
vi.mock('../src/workspace.js', () => ({
  WorkspaceManager: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('../src/credential.js', () => ({
  CredentialManager: vi.fn().mockImplementation(() => ({})),
}));

// 写 PID 文件 + 配置加载 mock（避免真文件 IO + 持久化）
vi.mock('../src/config.js', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    loadConfig: vi.fn(async () => ({
      server_url: 'http://127.0.0.1:8000',
      token: 'test-token',
      api_key: null,
      runtime_id: 'runtime-uuid',
      profile: 'default',
      workspace_dir: '/tmp/ws',
      poll_interval: 1,
      heartbeat_interval: 1,
      max_concurrent_tasks: 5,
      log_level: 'info',
    })),
    saveConfig: vi.fn(async () => {}),
    DEFAULT_CONFIG_DIR: '/tmp/test-cli-injection',
    DEFAULT_CONFIG_PATH: '/tmp/test-cli-injection/config.json',
  };
});

// 动态 import cli（vi.mock 已 hoist）
let cli: typeof import('../src/cli.js');

beforeAll(async () => {
  cli = await import('../src/cli.js');
});

describe('Wave2 task-04 gap-1 cli.startAction 注入 SessionManager', () => {
  let tmpDir = '';
  let _origArgv: string[];
  let _origExit: typeof process.exit;

  beforeEach(async () => {
    tmpDir = await makeTmpDir('cli-injection');
    resetCaptured();
    _origArgv = process.argv;
    _origExit = process.exit;
    // cli.ts 顶层 void main() 读 argv；设空 argv 避免触发 action
    process.argv = ['node', 'sillyhub-daemon'];
    process.exit = ((code?: number) => {
      void code;
      return undefined as never;
    }) as never;
  });

  afterEach(async () => {
    process.argv = _origArgv;
    process.exit = _origExit;
    vi.restoreAllMocks();
    if (tmpDir) {
      await cleanupDir(tmpDir);
    }
  });

  it('startAction 构造 ClaudeSdkDriver + SessionManager + Daemon（组装顺序正确）', async () => {
    // startAction 调 daemon.start() + while daemon.isRunning（mock isRunning=false 立即退出）
    const code = await cli.startAction({ token: 'test-token' });
    expect(code).toBe(0);

    expect(captured.daemonCtorArgs).not.toBeNull();
    expect(captured.sessionManagerInstances).toHaveLength(1);
    expect(captured.driverInstances).toHaveLength(1);
  });

  it('Daemon 构造 options.sessionManager 是 SessionManager 实例（注入成功）', async () => {
    await cli.startAction({ token: 'test-token' });

    const ctorArgs = captured.daemonCtorArgs;
    expect(ctorArgs).not.toBeNull();
    expect(ctorArgs!.options).toBeDefined();
    const sm = ctorArgs!.options!.sessionManager;
    expect(sm).toBeDefined();
    expect(sm).not.toBeNull();
    // sessionManager 实例来自 SessionManager mock 构造
    expect(captured.sessionManagerInstances).toHaveLength(1);
  });

  it('SessionManager deps.driver 是 ClaudeSdkDriver 实例', async () => {
    await cli.startAction({ token: 'test-token' });

    expect(captured.sessionManagerInstances).toHaveLength(1);
    expect(captured.driverInstances).toHaveLength(1);
    const deps = captured.sessionManagerInstances[0]!.deps;
    expect(deps.driver).toBe(captured.driverInstances[0]);
  });

  it('SessionManager deps 含 onTurnResult / onTurnMessage / onSessionEnd 三个函数', async () => {
    await cli.startAction({ token: 'test-token' });

    const deps = captured.sessionManagerInstances[0]!.deps;
    expect(typeof deps.onTurnResult).toBe('function');
    expect(typeof deps.onTurnMessage).toBe('function');
    expect(typeof deps.onSessionEnd).toBe('function');
  });

  it('deps.onTurnResult 是闭包，调用时 forward 到 daemon.onTurnResult（延迟绑定生效）', async () => {
    await cli.startAction({ token: 'test-token' });

    const deps = captured.sessionManagerInstances[0]!.deps;
    const fakeResult = { type: 'result', subtype: 'success', is_error: false };
    // 触发闭包（此时 daemon 已构造，闭包内 daemon.onTurnResult 应可达）
    await (deps.onTurnResult as (a: string, b: string, c: unknown) => Promise<void>)(
      'sess-1',
      'run-1',
      fakeResult,
    );

    expect(captured.daemonOnTurnResultCalls).toHaveLength(1);
    expect(captured.daemonOnTurnResultCalls[0]).toEqual(['sess-1', 'run-1', fakeResult]);
  });

  it('deps.onTurnMessage forward 到 daemon.onTurnMessage', async () => {
    await cli.startAction({ token: 'test-token' });

    const deps = captured.sessionManagerInstances[0]!.deps;
    const fakeMsg = { type: 'assistant' };
    await (deps.onTurnMessage as (a: string, b: string, c: unknown) => Promise<void>)(
      'sess-1',
      'run-1',
      fakeMsg,
    );

    expect(captured.daemonOnTurnMessageCalls).toHaveLength(1);
    expect(captured.daemonOnTurnMessageCalls[0]).toEqual(['sess-1', 'run-1', fakeMsg]);
  });

  it('deps.onSessionEnd forward 到 daemon.onSessionEnd', async () => {
    await cli.startAction({ token: 'test-token' });

    const deps = captured.sessionManagerInstances[0]!.deps;
    await (deps.onSessionEnd as (a: string, b: string) => Promise<void>)('sess-1', 'ended');

    expect(captured.daemonOnSessionEndCalls).toHaveLength(1);
    expect(captured.daemonOnSessionEndCalls[0]).toEqual(['sess-1', 'ended']);
  });

  it('batch 零回归：Daemon 构造仍传 taskRunner（第三参）', async () => {
    await cli.startAction({ token: 'test-token' });

    const ctorArgs = captured.daemonCtorArgs;
    expect(ctorArgs).not.toBeNull();
    expect(ctorArgs!.taskRunner).toBeDefined();
    expect(ctorArgs!.taskRunner).not.toBeNull();
  });

  it('SessionManager 构造传 opts.manualApproval=true + permissionWsClient（scan 真阻塞能力就绪）', async () => {
    await cli.startAction({ token: 'test-token' });
    const opts = captured.sessionManagerInstances[0]!.opts;
    expect(opts).toBeDefined();
    expect(opts!.manualApproval).toBe(true);
    expect(opts!.permissionWsClient).toBeDefined();
    // permissionWsClient.send 是闭包（延迟绑定 daemon.sendToHub），构造时即函数。
    expect(typeof opts!.permissionWsClient!.send).toBe('function');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// task-09（2026-08-22-team-session-unify / design §5 Phase 2 / D-002@v2）：
// isMainAgentSession 谓词真值表——Claude 会话常驻注入 + mission_worker 分身排除。
//
// 谓词语义（cli.ts startAction 注入，读捕获的 SessionManager opts）：
//   provider=claude 且 stage ∈ {undefined/null/''，'orchestrator'} → true 注入 5 工具
//   （普通 Claude 会话常驻注入；存量 external 主控 stage='orchestrator' 照常注入）
//   provider=claude 且 stage='mission_worker'（backend execution.py MISSION_WORKER_STAGE
//   常量派发）→ false 不注入（防分身递归派发，审查 CC-12）
//   provider=codex 一律 false（D-003@v1，团队需要 Claude 引擎）
// ════════════════════════════════════════════════════════════════════════════

/** 谓词入参的最小上下文（MainAgentMcpContext 的判定相关字段子集）。 */
type PredicateCtx = {
  sessionId: string;
  leaseId: string;
  provider: 'claude' | 'codex';
  cwd: string;
  stage?: string;
};

function makeCtx(provider: 'claude' | 'codex', stage?: string | null): PredicateCtx {
  const ctx: PredicateCtx = {
    sessionId: 'sess-1',
    leaseId: 'lease-1',
    provider,
    cwd: '/tmp/ws',
  };
  if (stage !== undefined) {
    // null 属防御分支（类型为 stage?: string，经 cast 覆盖归一化前脏值）。
    ctx.stage = stage as string;
  }
  return ctx;
}

describe('task-09 isMainAgentSession 谓词真值表（claude 常驻注入 + mission_worker 排除）', () => {
  let tmpDir = '';
  let _origArgv: string[];
  let _origExit: typeof process.exit;

  beforeEach(async () => {
    tmpDir = await makeTmpDir('cli-injection-predicate');
    resetCaptured();
    _origArgv = process.argv;
    _origExit = process.exit;
    process.argv = ['node', 'sillyhub-daemon'];
    process.exit = ((code?: number) => {
      void code;
      return undefined as never;
    }) as never;
  });

  afterEach(async () => {
    process.argv = _origArgv;
    process.exit = _origExit;
    vi.restoreAllMocks();
    if (tmpDir) {
      await cleanupDir(tmpDir);
    }
  });

  /** startAction 后取捕获的谓词（每 case 重新构造，避免跨 case 共享闭包状态）。 */
  async function getPredicate(): Promise<(ctx: PredicateCtx) => boolean> {
    await cli.startAction({ token: 'test-token' });
    const opts = captured.sessionManagerInstances[0]!.opts;
    expect(opts).toBeDefined();
    const predicate = opts!.isMainAgentSession;
    expect(typeof predicate).toBe('function');
    return predicate as (ctx: PredicateCtx) => boolean;
  }

  describe('provider=claude', () => {
    it('stage=undefined（普通 Claude 会话不传 stage）→ true 常驻注入', async () => {
      const predicate = await getPredicate();
      expect(predicate(makeCtx('claude', undefined))).toBe(true);
    });

    it("stage=null（防御归一化前脏值）→ true", async () => {
      const predicate = await getPredicate();
      expect(predicate(makeCtx('claude', null))).toBe(true);
    });

    it("stage=''（空串）→ true", async () => {
      const predicate = await getPredicate();
      expect(predicate(makeCtx('claude', ''))).toBe(true);
    });

    it("stage='orchestrator'（存量 external 主控）→ true 照常注入", async () => {
      const predicate = await getPredicate();
      expect(predicate(makeCtx('claude', 'orchestrator'))).toBe(true);
    });

    it("stage='mission_worker'（分身 lease 常量）→ false 不注入（防递归派发）", async () => {
      const predicate = await getPredicate();
      expect(predicate(makeCtx('claude', 'mission_worker'))).toBe(false);
    });

    it("stage 其它非空值（'scan'）→ false", async () => {
      const predicate = await getPredicate();
      expect(predicate(makeCtx('claude', 'scan'))).toBe(false);
    });
  });

  describe('provider=codex（D-003@v1 一律不注入）', () => {
    it.each([
      ['undefined', undefined],
      ['orchestrator', 'orchestrator'],
      ['mission_worker', 'mission_worker'],
    ])('stage=%s → false', async (_label, stage) => {
      const predicate = await getPredicate();
      expect(predicate(makeCtx('codex', stage as string | undefined))).toBe(false);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// task-06（2026-08-23-agent-file-upload-mcp / FR-02 / D-002@v1）：cli.ts
// mainAgentMcpConfigProvider 并入 sillyhub-file——与 sillyhub-daemon 并列放进
// mergeMcpConfigs 的 platform 位（平台内置名自动入白名单）。
//
// provider 内容断言（MCP_SESSION_ID 不在 provider 拼——session-manager 在 provider
// 返回后按 ctx.sessionId 补写，见 session-manager-main-agent-mcp.test.ts）：
//   - 双 server 表：sillyhub-daemon（编排 5 tool）+ sillyhub-file（上传 2 tool）
//   - sillyhub-file env：MCP_TOOLSET=file、凭证、MCP_ALLOWED_ROOT=resolve(ctx.cwd)
//   - 两个 server 均在 platform 位（mergeMcpConfigs 自动入白名单，无 rejected）
// ════════════════════════════════════════════════════════════════════════════

describe('task-06: mainAgentMcpConfigProvider 并入 sillyhub-file（双 server 表）', () => {
  let tmpDir = '';
  let _origArgv: string[];
  let _origExit: typeof process.exit;

  beforeEach(async () => {
    tmpDir = await makeTmpDir('cli-injection-file-mcp');
    resetCaptured();
    _origArgv = process.argv;
    _origExit = process.exit;
    process.argv = ['node', 'sillyhub-daemon'];
    process.exit = ((code?: number) => {
      void code;
      return undefined as never;
    }) as never;
  });

  afterEach(async () => {
    process.argv = _origArgv;
    process.exit = _origExit;
    vi.restoreAllMocks();
    if (tmpDir) {
      await cleanupDir(tmpDir);
    }
  });

  /** startAction 后取捕获的 provider（config mock：token='test-token'，api_key=null）。 */
  async function getProvider(): Promise<
    (ctx: { sessionId: string; leaseId: string; provider: string; cwd: string }) =>
      | Record<string, { command: string; args?: string[]; env?: Record<string, string> }>
      | undefined
  > {
    await cli.startAction({ token: 'test-token' });
    const opts = captured.sessionManagerInstances[0]!.opts;
    expect(opts).toBeDefined();
    const provider = opts!.mainAgentMcpConfigProvider;
    expect(typeof provider).toBe('function');
    return provider as ReturnType<typeof getProvider>;
  }

  it('返回双 server 表：sillyhub-daemon + sillyhub-file 并列', async () => {
    const provider = await getProvider();
    const result = provider({ sessionId: 'sess-1', leaseId: 'lease-1', provider: 'claude', cwd: '/tmp/ws' });
    expect(result).toBeDefined();
    expect(Object.keys(result!).sort()).toEqual(['sillyhub-daemon', 'sillyhub-file']);
    // 两个条目均为 node <mcp-server.js> stdio 形态
    expect(result!['sillyhub-daemon']!.command).toBe('node');
    expect(result!['sillyhub-file']!.command).toBe('node');
    expect(result!['sillyhub-daemon']!.args?.[0]).toMatch(/mcp-server\.js$/);
    expect(result!['sillyhub-file']!.args?.[0]).toMatch(/mcp-server\.js$/);
  });

  it('sillyhub-file env 含 MCP_TOOLSET=file、凭证与 MCP_ALLOWED_ROOT=resolve(ctx.cwd)', async () => {
    const provider = await getProvider();
    const result = provider({ sessionId: 'sess-1', leaseId: 'lease-1', provider: 'claude', cwd: '/tmp/ws' });
    const fileEnv = result!['sillyhub-file']!.env!;
    expect(fileEnv.MCP_TOOLSET).toBe('file');
    expect(fileEnv.MCP_SERVER_BACKEND_URL).toBe('http://127.0.0.1:8000');
    // config mock：token='test-token'、api_key=null → Bearer token 回落路径
    expect(fileEnv.MCP_SERVER_DAEMON_TOKEN).toBe('test-token');
    expect(fileEnv.MCP_SERVER_DAEMON_API_KEY).toBeUndefined();
    // allowedRoot = 会话 cwd（design §7.1：会话场景=cwd），resolve 为绝对路径
    expect(fileEnv.MCP_ALLOWED_ROOT).toBe(resolve('/tmp/ws'));
  });

  it("provider 不拼 MCP_SESSION_ID（session-manager 在 provider 返回后补写）", async () => {
    const provider = await getProvider();
    const result = provider({ sessionId: 'sess-1', leaseId: 'lease-1', provider: 'claude', cwd: '/tmp/ws' });
    // provider 闭包不拼会话 id——task-06 契约：session-manager 按 ctx.sessionId 补写双条目
    expect(result!['sillyhub-daemon']!.env?.MCP_SESSION_ID).toBeUndefined();
    expect(result!['sillyhub-file']!.env?.MCP_SESSION_ID).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// task-08（2026-08-26-workspace-mcp-edit / FR-04 / D-006@v2 + D-007@v2）：
// mainAgentMcpConfigProvider 三件套合并注入全分支。
//
// 覆盖：优先级链（platform < workspace < 内置）、白名单剔除 + rejected warn、
// admin 白名单为空时内置仍注入（内置名并入白名单参数的回归锚）、缓存 miss
// （quick-chat / daemon 重启 restore）回落仅内置双 server（= 现状行为）、
// platform 维度含非 stdio 条目（fetchMcpBundle 仅净化 workspace 维度）时
// merge 抛错防御回落内置（R-03：会话创建路径永不因配置内容抛错）。
//
// 桩策略：沿 task-06 describe——startAction 捕获 provider 与 Daemon 构造
// options.mcpBundleCache（cli 装配处与 provider 闭包共享同一 Map 引用，
// task-07 D-007@v2）；测试直接 set bundle 模拟 daemon.ts 预取产物。
// ════════════════════════════════════════════════════════════════════════════

describe('task-08: 三件套合并注入（platform + workspace + 内置）', () => {
  let tmpDir = '';
  let _origArgv: string[];
  let _origExit: typeof process.exit;
  let _warnSpy: ReturnType<typeof vi.spyOn>;

  type ProviderCtx = { sessionId: string; leaseId: string; provider: string; cwd: string };
  type ProviderFn = (ctx: ProviderCtx) =>
    | Record<string, { command: string; args?: string[]; env?: Record<string, string>; type?: string }>
    | undefined;
  type BundleMap = Map<string, { platform: { mcpServers: Record<string, unknown> }; whitelist: string[]; workspace: { mcpServers: Record<string, unknown> } }>;

  beforeEach(async () => {
    tmpDir = await makeTmpDir('cli-injection-bundle');
    resetCaptured();
    _origArgv = process.argv;
    _origExit = process.exit;
    process.argv = ['node', 'sillyhub-daemon'];
    process.exit = ((code?: number) => {
      void code;
      return undefined as never;
    }) as never;
    _warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    process.argv = _origArgv;
    process.exit = _origExit;
    vi.restoreAllMocks();
    if (tmpDir) {
      await cleanupDir(tmpDir);
    }
  });

  /** startAction 后取 provider 与共享 bundle 缓存（daemon 构造 options 注入的同一 Map）。 */
  async function getProviderAndCache(): Promise<{ provider: ProviderFn; cache: BundleMap }> {
    await cli.startAction({ token: 'test-token' });
    const provider = captured.sessionManagerInstances[0]!.opts!.mainAgentMcpConfigProvider as ProviderFn;
    expect(typeof provider).toBe('function');
    const cache = captured.daemonCtorArgs!.options!.mcpBundleCache as BundleMap;
    expect(cache).toBeInstanceOf(Map);
    return { provider, cache };
  }

  const stdio = (command: string): { type: string; command: string; args: string[] } => ({
    type: 'stdio',
    command,
    args: [],
  });

  const CTX: ProviderCtx = { sessionId: 'sess-bundle', leaseId: 'lease-1', provider: 'claude', cwd: '/tmp/ws' };

  it('优先级链：workspace 同名覆盖 platform，内置双 server 最高不可覆盖', async () => {
    const { provider, cache } = await getProviderAndCache();
    cache.set(CTX.sessionId, {
      platform: { mcpServers: { shared: stdio('cmd-platform'), 'plat-only': stdio('cmd-plat') } },
      whitelist: ['shared', 'plat-only', 'ws-only'],
      workspace: { mcpServers: { shared: stdio('cmd-workspace'), 'ws-only': stdio('cmd-ws') } },
    });
    const result = provider(CTX)!;
    expect(result['shared']!.command).toBe('cmd-workspace'); // workspace 覆盖 platform（D-006@v2）
    expect(result['plat-only']!.command).toBe('cmd-plat');
    expect(result['ws-only']!.command).toBe('cmd-ws');
    // 内置双 server 仍在且为 node 形态（同名配置无法覆盖——内置位最高）
    expect(result['sillyhub-daemon']!.command).toBe('node');
    expect(result['sillyhub-file']!.command).toBe('node');
  });

  it('白名单外 workspace server 被剔除并记 rejected warn（R-05 可观测）', async () => {
    const { provider, cache } = await getProviderAndCache();
    cache.set(CTX.sessionId, {
      platform: { mcpServers: {} },
      whitelist: ['allowed-ws'],
      workspace: { mcpServers: { 'allowed-ws': stdio('ok'), rogue: stdio('bad') } },
    });
    const result = provider(CTX)!;
    expect(result['allowed-ws']).toBeDefined();
    expect(result['rogue']).toBeUndefined(); // 白名单外剔除
    expect(_warnSpy).toHaveBeenCalledWith(
      '[cli] mcp_servers_rejected_by_whitelist',
      expect.objectContaining({ sessionId: CTX.sessionId, rejected: ['rogue'] }),
    );
  });

  it('admin 白名单为空时内置双 server 仍注入（内置名并入白名单参数的回归锚，D-006@v2）', async () => {
    const { provider, cache } = await getProviderAndCache();
    cache.set(CTX.sessionId, {
      platform: { mcpServers: {} },
      whitelist: [],
      workspace: { mcpServers: {} },
    });
    const result = provider(CTX)!;
    expect(Object.keys(result).sort()).toEqual(['sillyhub-daemon', 'sillyhub-file']);
  });

  it('缓存 miss（quick-chat 无 workspaceId / daemon 重启 restore）回落仅内置双 server（= 现状行为）+ warn', async () => {
    const { provider } = await getProviderAndCache();
    const result = provider({ ...CTX, sessionId: 'sess-cold' })!; // 无缓存条目
    expect(Object.keys(result).sort()).toEqual(['sillyhub-daemon', 'sillyhub-file']);
    expect(_warnSpy).toHaveBeenCalledWith(
      '[cli] mcp_bundle_cache_miss',
      expect.objectContaining({ sessionId: 'sess-cold', fallback: 'empty_bundle' }),
    );
  });

  it('platform 维度含非 stdio 条目（未预净化）时防御回落内置，不抛错不阻塞（R-03）', async () => {
    const { provider, cache } = await getProviderAndCache();
    cache.set(CTX.sessionId, {
      platform: { mcpServers: { 'remote-sse': { type: 'sse', command: 'x', args: [] } } },
      whitelist: ['remote-sse'],
      workspace: { mcpServers: {} },
    });
    const result = provider(CTX)!; // 不抛错（防御 catch 回落）
    expect(Object.keys(result).sort()).toEqual(['sillyhub-daemon', 'sillyhub-file']);
    expect(_warnSpy).toHaveBeenCalledWith(
      '[cli] mcp_merge_failed_fallback_builtin',
      expect.objectContaining({ sessionId: CTX.sessionId }),
    );
  });
});
