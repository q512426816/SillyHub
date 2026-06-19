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
    constructor(deps) {
      captured.sessionManagerInstances.push({ deps });
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
      server_url: 'http://test:8000',
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
});
