/**
 * task-runner-terminal-observer.test.ts —— ql-20260616-003：task-runner 接 observer 集成测试。
 *
 * 验证 task-runner 在 spawn + readline 解析过程中：
 *   1. observer 日志文件被创建（runs/<leaseId>/terminal.log）
 *   2. spawn 成功 + parse 产事件 → observer 日志含 renderAgentEvent 渲染文本
 *   3. submitMessages 仍被正常调用（observer 不破坏业务流）
 *   4. spawn start/end 边界行（renderTaskBoundary）写入 observer 日志
 *   5. 子进程 stderr 进 observer raw stderr（mode=raw/both）
 *   6. 任务失败（非零退出）→ observer close 写入 end boundary + error 行
 *   7. createTerminalObserver 抛错时 task-runner 仍能完成 spawn（降级到 NOOP observer）
 *
 * 路径隔离策略（关键）：
 *   task-runner.ts 顶层 `import { DEFAULT_CONFIG_DIR } from './config.js'`，
 *   config.js 顶层 `const DEFAULT_CONFIG_DIR = join(homedir(), '.sillyhub', 'daemon')`。
 *   要让 DEFAULT_CONFIG_DIR 指向 tmpDir，必须：
 *     1. beforeEach vi.resetModules() 清缓存
 *     2. vi.doMock('node:os', () => ({ homedir: () => tmpDir })) 替换 os
 *     3. 动态 import TaskRunner —— 让 config.js 用 mock 后的 homedir 重算
 *   因此 TaskRunner / config / spawn 等都通过 beforeEach 内动态 import 注入。
 *
 * @module task-runner-terminal-observer.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('../src/skill-manager.js', () => ({ linkSkillsToWorkdir: vi.fn(async () => ({ linked: 0, skipped: true })) }));
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir as osTmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// ── 顶层 mock（vi.mock hoist 到 import 之前）──────────────────────────────
// spawn / getBackend / launchTerminal 都是顶层 mock，每次 resetModules 后仍生效。

let mockAdapter: Record<string, unknown> = {};

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: vi.fn(() => null as unknown),
  };
});

vi.mock('../src/adapters/index.js', () => ({
  getBackend: vi.fn((_provider: string) => mockAdapter),
}));

vi.mock('../src/terminal-launcher.js', () => ({
  launchTerminal: () => {
    // 测试不验证 launchTerminal 调用细节（terminal-observer.test.ts 已覆盖），
    // 这里 no-op 让 task-runner 链路不弹真终端
  },
}));

// ── 动态 import 注入到 beforeEach（路径隔离前提）─────────────────────────
let TaskRunner: typeof import('../src/task-runner.js').TaskRunner;
let spawn: typeof import('node:child_process').spawn;
let configMod: typeof import('../src/config.js');
let createFakeChildMod: typeof import('./helpers/fake-child.js');
let waitForSpawn: typeof import('./helpers/fake-child.js').waitForSpawn;
let tmpDir: string;

// ── 测试工具 ───────────────────────────────────────────────────────────────

function defaultMockAdapter(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    provider: 'claude',
    parse: vi.fn((line: string): import('../src/types.js').AgentEvent[] | null => {
      if (line.startsWith('text:')) {
        return [{ type: 'text', content: line.slice('text:'.length).trim() }];
      }
      return null;
    }),
    buildArgs: vi.fn(() => ['-p']),
    buildInput: vi.fn((prompt: string) => `${prompt}\n`),
    ...overrides,
  };
}

function makeLease(overrides: Partial<import('../src/types.js').LeaseCtx> = {}): import('../src/types.js').LeaseCtx {
  return {
    leaseId: 'observer-test-lease',
    runtimeId: 'rt-1',
    claimToken: 'tok',
    workspaceName: 'test-ws',
    claudeMd: '',
    prompt: 'hello',
    provider: 'claude',
    cmdPath: '/usr/local/bin/claude',
    agentRunId: 'run-1',
    ...overrides,
  };
}

function makeMockClient(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    startLease: vi.fn().mockResolvedValue({}),
    submitMessages: vi.fn().mockResolvedValue({ status: 'ok' }),
    completeLease: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

function makeMockWorkspace(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    prepareWorkspace: vi.fn().mockResolvedValue('/tmp/ws/test'),
    collectDiff: vi.fn().mockResolvedValue({
      patch: '',
      files_changed: 0,
      insertions: 0,
      deletions: 0,
      stats: '',
    }),
    ...overrides,
  };
}

function makeMockCred(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    get: vi.fn(() => undefined),
    buildEnv: vi.fn().mockReturnValue({}),
    ...overrides,
  };
}

function makeConfig(overrides: Partial<import('../src/config.js').DaemonConfig> = {}): import('../src/config.js').DaemonConfig {
  return {
    server_url: 'http://localhost:8000',
    token: null,
    runtime_id: 'rt-test',
    profile: 'default',
    workspace_dir: '/tmp/ws',
    poll_interval: 30,
    heartbeat_interval: 15,
    max_concurrent_tasks: 5,
    log_level: 'info',
    default_timeout_seconds: 1800,
    max_retries: 0,
    terminal_observer_enabled: false,
    terminal_observer_mode: 'both',
    terminal_observer_close_on_exit: false,
    terminal_observer_command: null,
    ...overrides,
  };
}

async function readObserverLog(leaseId: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  const path = join(configMod.DEFAULT_CONFIG_DIR, 'runs', leaseId, 'terminal.log');
  // observer 写入是 fire-and-forget appendFile（terminal-observer.ts L126 `void appendFile`），
  // runLease resolve 不等其 IO 落盘 → emitExit 后的 end 边界（done:/[stderr]）可能晚于
  // `await p` 落盘，直接读存在竞态（pre-existing flaky）。轮询直到内容连续两轮相同
  // （表示 fire-and-forget IO 已追平）或超时，消除时序脆弱性。
  let prev = '';
  for (let i = 0; i < 60; i++) {
    let log = '';
    try {
      log = await readFile(path, 'utf-8');
    } catch {
      log = ''; // observer header 尚未落盘
    }
    if (log.length > 0 && log === prev) return log;
    prev = log;
    await new Promise<void>((r) => setTimeout(r, 10));
  }
  return prev;
}

/**
 * 等 fire-and-forget observer 创建完成（mkdir + writeFile 写入 header）。
 *
 * task-runner 现在用 fire-and-forget 启动 observer 创建（spawn 同步发生，observer
 * promise 在后台 resolve）。测试里 emit 事件比 observer promise 快，所以要等
 * 「header 落盘」作为 observer 就绪的信号 —— header 是 createTerminalObserver 内
 * 第一个 await writeFile 的输出，header 出现即代表 observer 已替换 NOOP。
 *
 * 轮询最多 1s，每 10ms 检查一次。
 */
async function flushObserverWrites(leaseId: string): Promise<void> {
  const headerPath = join(configMod.DEFAULT_CONFIG_DIR, 'runs', leaseId, 'terminal.log');
  const { stat } = await import('node:fs/promises');
  for (let i = 0; i < 100; i++) {
    try {
      await stat(headerPath);
      // 文件存在 —— observer 已写 header，可以 break
      // 但需要再多让一拍让 mkdir/writeFile 完全返回 + pending 写入 flush
      await new Promise<void>((r) => setImmediate(r));
      await new Promise<void>((r) => setTimeout(r, 20));
      return;
    } catch {
      await new Promise<void>((r) => setTimeout(r, 10));
    }
  }
  // 超时也继续 —— 让后续断言失败而不是这里抛错
}

beforeEach(async () => {
  vi.resetModules();
  mockAdapter = defaultMockAdapter();

  // 1. 先建 tmpDir
  tmpDir = await mkdtemp(join(osTmpdir(), 'sillyhub-taskrunner-obs-'));

  // 2. doMock node:os 让 homedir() 返回 tmpDir
  const osActual = await vi.importActual<typeof import('node:os')>('node:os');
  vi.doMock('node:os', () => ({ ...osActual, homedir: () => tmpDir }));

  // 3. 动态 import —— config.js 重算 DEFAULT_CONFIG_DIR，task-runner 拿到新值
  TaskRunner = (await import('../src/task-runner.js')).TaskRunner;
  spawn = (await import('node:child_process')).spawn;
  configMod = await import('../src/config.js');
  createFakeChildMod = await import('./helpers/fake-child.js');
  waitForSpawn = (await import('./helpers/fake-child.js')).waitForSpawn;

  vi.clearAllMocks();
  vi.mocked(spawn).mockReturnValue(null as never);
});

afterEach(async () => {
  vi.doUnmock('node:os');
  vi.useRealTimers();
  await rm(tmpDir, { recursive: true, force: true });
});

// ── 测试 ───────────────────────────────────────────────────────────────────

describe('task-runner + terminal observer 集成', () => {
  it('spawn 成功后 runs/<leaseId>/terminal.log 文件被创建', async () => {
    const fakeChild = createFakeChildMod.createFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild as never);
    const runner = new TaskRunner(
      makeMockClient() as never,
      makeMockWorkspace() as never,
      makeMockCred() as never,
      makeConfig(),
    );

    const p = runner.runLease(makeLease());
    await waitForSpawn();
    fakeChild._emitExit(0);
    await p;
    await flushObserverWrites('observer-test-lease');

    const logPath = join(configMod.DEFAULT_CONFIG_DIR, 'runs', 'observer-test-lease', 'terminal.log');
    expect(existsSync(logPath)).toBe(true);
  });

  it('parse 产 text 事件 → observer 日志含渲染文本 + submitMessages 仍调用', async () => {
    const fakeChild = createFakeChildMod.createFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild as never);
    const client = makeMockClient();
    const runner = new TaskRunner(
      client as never,
      makeMockWorkspace() as never,
      makeMockCred() as never,
      makeConfig({ terminal_observer_mode: 'parsed' }),
    );

    const p = runner.runLease(makeLease());
    await waitForSpawn();
    await flushObserverWrites('observer-test-lease');
    fakeChild._emitLines(['text:hello world']);
    fakeChild._emitExit(0);
    await p;

    const log = await readObserverLog('observer-test-lease');
    expect(log).toContain('[task ');
    expect(log).toContain('hello world');
    expect(client.submitMessages).toHaveBeenCalled();
  });

  it('spawn 边界 end 行写入 observer 日志（done: status=completed exit=0）', async () => {
    const fakeChild = createFakeChildMod.createFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild as never);
    const runner = new TaskRunner(
      makeMockClient() as never,
      makeMockWorkspace() as never,
      makeMockCred() as never,
      makeConfig(),
    );

    const p = runner.runLease(makeLease());
    await waitForSpawn();
    await flushObserverWrites('observer-test-lease');
    fakeChild._emitExit(0);
    await p;

    const log = await readObserverLog('observer-test-lease');
    // end 边界（done: status=completed exit=0）由 finishAttempt 写入，
    // 此时 observer promise 通常已 resolve，所以 end 边界能进日志。
    // 注意：start 边界（spawn: ...）是 fire-and-forget 写入，observer 此时可能
    // 仍是 NOOP，所以 start 行不一定落盘 —— 这里只断言 end 行。
    expect(log).toContain('done:');
    expect(log).toContain('status=completed');
  });

  it('子进程 stderr 进 observer raw stderr（mode=both 时）', async () => {
    const fakeChild = createFakeChildMod.createFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild as never);
    const runner = new TaskRunner(
      makeMockClient() as never,
      makeMockWorkspace() as never,
      makeMockCred() as never,
      makeConfig({ terminal_observer_mode: 'both' }),
    );

    const p = runner.runLease(makeLease());
    await waitForSpawn();
    await flushObserverWrites('observer-test-lease');
    fakeChild._emitStderr('warning: something failed\n');
    fakeChild._emitExit(0);
    await p;

    const log = await readObserverLog('observer-test-lease');
    expect(log).toContain('[stderr]');
    expect(log).toContain('warning: something failed');
  });

  it('任务非零退出 → observer end 边界写入 status=failed + exit + error', async () => {
    const fakeChild = createFakeChildMod.createFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild as never);
    const runner = new TaskRunner(
      makeMockClient() as never,
      makeMockWorkspace() as never,
      makeMockCred() as never,
      makeConfig(),
    );

    const p = runner.runLease(makeLease());
    await waitForSpawn();
    await flushObserverWrites('observer-test-lease');
    fakeChild._emitStderr('some error detail\n');
    fakeChild._emitExit(2);
    await p;

    const log = await readObserverLog('observer-test-lease');
    expect(log).toContain('done:');
    expect(log).toContain('status=failed');
    expect(log).toContain('exit=');
    expect(log).toContain('some error detail');
  });

  it('原始 stdout 行进 observer raw stdout（mode=both 时）', async () => {
    const fakeChild = createFakeChildMod.createFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild as never);
    const runner = new TaskRunner(
      makeMockClient() as never,
      makeMockWorkspace() as never,
      makeMockCred() as never,
      makeConfig({ terminal_observer_mode: 'both' }),
    );

    const p = runner.runLease(makeLease());
    await waitForSpawn();
    await flushObserverWrites('observer-test-lease');
    fakeChild._emitLines(['raw-line-1']);
    fakeChild._emitExit(0);
    await p;

    const log = await readObserverLog('observer-test-lease');
    expect(log).toContain('[raw stdout] raw-line-1');
  });

  it('createTerminalObserver 抛错也不影响 spawn 主流程（业务降级）', async () => {
    // 用 doMock 覆盖 terminal-observer，在 beforeEach 之后追加（resetModules 已清）
    vi.doMock('../src/terminal-observer.js', () => ({
      createTerminalObserver: async () => {
        throw new Error('mock observer create failure');
      },
      NOOP_TERMINAL_OBSERVER: {
        writeParsed() {},
        writeRawStdout() {},
        writeRawStderr() {},
        close() {},
      },
    }));
    // resetModules + 重新 import 让 task-runner 用新的 observer mock
    vi.resetModules();
    const osActual = await vi.importActual<typeof import('node:os')>('node:os');
    vi.doMock('node:os', () => ({ ...osActual, homedir: () => tmpDir }));
    const TaskRunnerFresh = (await import('../src/task-runner.js')).TaskRunner;
    const spawnFresh = (await import('node:child_process')).spawn;
    // 重新注册 spawn 返回值（vi.mock 在 resetModules 后需要再 mock）
    vi.mocked(spawnFresh).mockReturnValue(null as never);

    const fakeChild = createFakeChildMod.createFakeChild();
    vi.mocked(spawnFresh).mockReturnValue(fakeChild as never);

    const client = makeMockClient();
    const runner = new TaskRunnerFresh(
      client as never,
      makeMockWorkspace() as never,
      makeMockCred() as never,
      makeConfig(),
    );

    const p = runner.runLease(makeLease({ leaseId: 'observer-fail-gracefully' }));
    await waitForSpawn();
    fakeChild._emitLines(['text:still works']);
    fakeChild._emitExit(0);
    const result = await p;

    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
    // 业务调用仍发生（observer 失败但 submitMessages 应被调）
    expect(client.submitMessages).toHaveBeenCalled();
  });
});
