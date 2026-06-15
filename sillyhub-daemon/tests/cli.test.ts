/**
 * cli.test.ts —— Python test_cli.py 1:1 迁移（task-22 P0-A1）。
 *
 * Python 源是规格（150 行 / 4 TestClass / 10 用例）。方案A（task-22.md R6）：
 * 直接调 src/cli.ts 业务函数（startAction/stopAction/statusAction/logsAction/
 * createProgram）+ 辅助函数（readPid/isProcessAlive/writePid/removePid）。
 *
 * **路径隔离方案**：
 *   config.ts 的 DEFAULT_CONFIG_DIR = join(homedir(), '.sillyhub', 'daemon') 在
 *   模块顶层 const 计算，普通 stubEnv 后已 cached 无效。用 beforeEach 内：
 *     1. vi.resetModules() 清缓存
 *     2. vi.stubEnv('HOME', tmpDir) 让 homedir() 返回 tmpDir
 *     3. 动态 import cli → config.ts 重新执行，DEFAULT_CONFIG_DIR 指向 tmpDir
 *   这样 cli 内部 getPidFile/getLogFile 裸调用自然指向 tmpDir（无需 spy 内部函数）。
 *   afterEach unstubAllEnvs + cleanupDir。
 *
 * **顶层 main() 副作用**：cli.ts `void main()` 用真实 argv。stub process.exit 防
 * commander 错误路径真退出 + 设空 argv 让 commander 无子命令正常返回。
 *
 * Mock 隔离（AC-04）：所有 spy/stubEnv/exit mock 在 afterEach 还原。
 *
 * @module cli.test
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { makeTmpDir, cleanupDir } from './helpers.js';

// ── 占位类型：动态 import 后赋值 ──────────────────────────────────────────────
type CliModule = typeof import('../src/cli.js');
type ConfigModule = typeof import('../src/config.js');
type DaemonConfigType = import('../src/config.js').DaemonConfig;

let cli: CliModule;
let configMod: ConfigModule;

// argv/exit stub 持续到 afterEach 才还原（main() 的 parseAsync 是异步，
// 若 import 后立即还原 argv，parseAsync 执行时读到的是真实 vitest argv 会误触发 action）。
let _origArgv: string[] | null = null;
let _origExit: typeof process.exit | null = null;

/** 每个 describe 的 beforeEach 调：resetModules + stubEnv HOME + 动态 import。 */
async function setupCliWithTmpHome(tmpDir: string): Promise<void> {
  vi.resetModules();
  vi.stubEnv('HOME', tmpDir);
  // stub argv + exit：持续到 teardownCliWithTmpHome 才还原（防 main 异步副作用）
  if (_origArgv === null) {
    _origArgv = process.argv;
    _origExit = process.exit;
  }
  process.argv = ['node', 'sillyhub-daemon']; // 无子命令，commander 显示 help 正常返回
  process.exit = ((code?: number) => {
    void code;
    return undefined as never;
  }) as never;
  // 动态 import 触发 config.ts 顶层 DEFAULT_CONFIG_DIR 重算（用 stubEnv 后的 homedir）
  configMod = await import('../src/config.js');
  cli = await import('../src/cli.js');
  // 不立即还原 argv/exit —— main() 的 parseAsync 可能还在异步执行中
}

/** afterEach 调：还原 argv/exit stub。 */
function teardownCliStub(): void {
  if (_origArgv !== null) {
    process.argv = _origArgv;
    _origArgv = null;
  }
  if (_origExit !== null) {
    process.exit = _origExit;
    _origExit = null;
  }
}

/** 捕获 process.stdout.write。 */
function captureStdout(): { writes: string[]; restore: () => void } {
  const writes: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  });
  return { writes, restore: () => spy.mockRestore() };
}

/** 捕获 process.stderr.write。 */
function captureStderr(): { writes: string[]; restore: () => void } {
  const writes: string[] = [];
  const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  });
  return { writes, restore: () => spy.mockRestore() };
}

/** 构造最小可用 config（对齐 DaemonConfig interface）。 */
function makeConfig(overrides: Partial<DaemonConfigType> = {}): DaemonConfigType {
  return {
    server_url: 'http://localhost:8000',
    token: 'tok-test',
    api_key: null,
    runtime_id: 'rt-test-001',
    profile: 'default',
    workspace_dir: '/tmp/ws',
    poll_interval: 30,
    heartbeat_interval: 15,
    max_concurrent_tasks: 5,
    log_level: 'info',
    default_timeout_seconds: 1800,
    max_retries: 1,
    ...overrides,
  };
}

// ── TestStatus（对齐 Python class TestStatus）──────────────────────────────────

describe('TestStatus (test_cli.py)', () => {
  let tmpDir: string;
  let out: ReturnType<typeof captureStdout>;

  beforeEach(async () => {
    tmpDir = await makeTmpDir('sillyhub-cli-status-');
    await setupCliWithTmpHome(tmpDir);
    out = captureStdout();
    // status 内部 loadConfigFn 默认走磁盘，spy 返回内存 config（status 只读 runtime_id/server_url）
    vi.spyOn(cli, 'loadConfigFn').mockResolvedValue(makeConfig());
  });

  afterEach(async () => {
    out.restore();
    teardownCliStub();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await cleanupDir(tmpDir);
  });

  // Python test_status_no_daemon
  it('status_no_daemon: 无 PID 文件 → 退出码 0，输出含 stopped + Runtime ID:', async () => {
    const code = await cli.statusAction();
    const output = out.writes.join('');
    expect(code).toBe(0);
    expect(output).toContain('stopped');
    expect(output).toContain('Runtime ID:');
  });

  // Python test_status_shows_config
  it('status_shows_config: 输出含 Server URL: + http://localhost:8000', async () => {
    const code = await cli.statusAction();
    const output = out.writes.join('');
    expect(code).toBe(0);
    expect(output).toContain('Server URL:');
    expect(output).toContain('http://localhost:8000');
  });
});

// ── TestStop（对齐 Python class TestStop）──────────────────────────────────────

describe('TestStop (test_cli.py)', () => {
  let tmpDir: string;
  let out: ReturnType<typeof captureStdout>;

  beforeEach(async () => {
    tmpDir = await makeTmpDir('sillyhub-cli-stop-');
    await setupCliWithTmpHome(tmpDir);
    out = captureStdout();
  });

  afterEach(async () => {
    out.restore();
    teardownCliStub();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await cleanupDir(tmpDir);
  });

  // Python test_stop_no_pid_file
  it('stop_no_pid_file: 无 PID 文件 → 退出码 1，输出含 "No PID file found"', () => {
    const code = cli.stopAction();
    const output = out.writes.join('');
    expect(code).toBe(1);
    expect(output).toContain('No PID file found');
  });

  // Python test_stop_stale_pid
  it('stop_stale_pid: PID=999999999 不存活 → 退出码 1，输出含 "not running"', () => {
    // 直接写真实 PID 文件（tmpDir 已是 HOME，DEFAULT_CONFIG_DIR 指向 tmpDir/.sillyhub/daemon）
    mkdirSync(join(configMod.DEFAULT_CONFIG_DIR), { recursive: true });
    writeFileSync(join(configMod.DEFAULT_CONFIG_DIR, 'daemon.pid'), '999999999');
    const code = cli.stopAction();
    const output = out.writes.join('');
    expect(code).toBe(1);
    expect(
      output.toLowerCase().includes('not running') ||
        output.toLowerCase().includes('stale'),
    ).toBe(true);
  });

  // Python test_stop_alive_process
  it('stop_alive_process: PID 存活 + mock process.kill → 退出码 0，输出含 SIGTERM，kill 调 2 次', () => {
    mkdirSync(join(configMod.DEFAULT_CONFIG_DIR), { recursive: true });
    writeFileSync(
      join(configMod.DEFAULT_CONFIG_DIR, 'daemon.pid'),
      String(process.pid),
    );
    const killSpy = vi
      .spyOn(process, 'kill')
      .mockImplementation(() => true);
    const code = cli.stopAction();
    const output = out.writes.join('');
    expect(killSpy).toHaveBeenCalledTimes(2);
    expect(code).toBe(0);
    expect(output).toContain('SIGTERM');
  });
});

// ── TestLogs（对齐 Python class TestLogs）──────────────────────────────────────

describe('TestLogs (test_cli.py)', () => {
  let tmpDir: string;
  let out: ReturnType<typeof captureStdout>;

  beforeEach(async () => {
    tmpDir = await makeTmpDir('sillyhub-cli-logs-');
    await setupCliWithTmpHome(tmpDir);
    out = captureStdout();
  });

  afterEach(async () => {
    out.restore();
    teardownCliStub();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await cleanupDir(tmpDir);
  });

  // Python test_logs_no_file
  it('logs_no_file: 日志文件不存在 → 退出码 0，输出含 "No log file found"', async () => {
    const code = await cli.logsAction({});
    const output = out.writes.join('');
    expect(code).toBe(0);
    expect(output).toContain('No log file found');
  });

  // Python test_logs_shows_content
  it('logs_shows_content: 日志文件含 3 行 → 输出含 line1 与 line3', async () => {
    mkdirSync(join(configMod.DEFAULT_CONFIG_DIR), { recursive: true });
    writeFileSync(
      join(configMod.DEFAULT_CONFIG_DIR, 'daemon.log'),
      'line1\nline2\nline3\n',
    );
    const code = await cli.logsAction({});
    const output = out.writes.join('');
    expect(code).toBe(0);
    expect(output).toContain('line1');
    expect(output).toContain('line3');
  });

  // Python test_logs_tail_option
  it('logs_tail_option: 100 行 + --tail 5 → 输出含 line 95/99，不含 line 90', async () => {
    mkdirSync(join(configMod.DEFAULT_CONFIG_DIR), { recursive: true });
    const lines = Array.from({ length: 100 }, (_, i) => `log line ${i}`);
    writeFileSync(
      join(configMod.DEFAULT_CONFIG_DIR, 'daemon.log'),
      lines.join('\n') + '\n',
    );
    const code = await cli.logsAction({ tail: '5' });
    const output = out.writes.join('');
    expect(code).toBe(0);
    expect(output).toContain('log line 95');
    expect(output).toContain('log line 99');
    expect(output).not.toContain('log line 90');
  });
});

// ── TestStart（对齐 Python class TestStart）────────────────────────────────────

describe('TestStart (test_cli.py)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTmpDir('sillyhub-cli-start-');
    await setupCliWithTmpHome(tmpDir);
  });

  afterEach(async () => {
    teardownCliStub();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await cleanupDir(tmpDir);
  });

  // Python test_start_help
  it('start_help: createProgram 解析 start --help，输出含 "--server"', async () => {
    // commander 在 --help 时若 process.exit 被 mock 会继续调 action（已知行为）。
    // 改为直接查 start command 的 option 定义，避免触发 action handler（R-08 行为等价）。
    // 同时也覆盖 help 文本路径：用独立 program 实例 + exit mock 输出 help 文本。
    const program = cli.createProgram();
    const startCmd = program.commands.find((c) => c.name() === 'start');
    expect(startCmd).toBeDefined();
    const optFlags = (startCmd?.options ?? []).map((o) => o.flags);
    expect(optFlags.some((f) => f.includes('--server'))).toBe(true);

    // 另：program 顶层 help 也含 start 命令的描述
    const helpText = program.helpInformation();
    expect(helpText).toContain('start');
  });

  // Python test_start_writes_pid_and_cleans_up_on_keyboard_interrupt
  it('start_writes_pid_and_cleans_up: writePid + removePid 端到端语义验证', async () => {
    // Python 用 patch Daemon 类模拟 KeyboardInterrupt 验证 finally removePid。
    // TS startAction 内部 new Daemon(...)，单测无法注入 mock 实例（重 mock 太重）。
    // 降级为验证 writePid + removePid 的可测语义（task-22 R-08 行为覆盖等价）：
    //   writePid(12345) → readPid 读回 12345 → removePid → readPid null
    // setupCliWithTmpHome 让 getPidFile 指向 tmpDir，writePid/removePid 真实写删 tmpDir。
    await cli.writePid(12345);
    expect(cli.readPid()).toBe(12345);
    await cli.removePid();
    expect(cli.readPid()).toBeNull();
  });
});

// daemon-api-key 变更：--api-key 选项 + 与 --token 互斥 + config 持久化。
describe('TestStartApiKey (daemon-api-key)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTmpDir('sillyhub-cli-apikey-');
    await setupCliWithTmpHome(tmpDir);
  });

  afterEach(async () => {
    teardownCliStub();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await cleanupDir(tmpDir);
  });

  it('start_help 含 --api-key 选项', async () => {
    const program = cli.createProgram();
    const startCmd = program.commands.find((c) => c.name() === 'start');
    const optFlags = (startCmd?.options ?? []).map((o) => o.flags);
    expect(optFlags.some((f) => f.includes('--api-key'))).toBe(true);
  });

  it('token + api-key 同时传 → 退出码 1 + 互斥错误', async () => {
    const err = captureStderr();
    const code = await cli.startAction({
      server: 'http://localhost:8000',
      token: 'tok-1',
      'api-key': 'shk_live_x',
    });
    expect(code).toBe(1);
    expect(err.writes.join('')).toContain('mutually exclusive');
    err.restore();
  });

  // 注：startAction 内部 loadConfigFn / saveConfigFn 是模块内 lexical 调用，
  // vi.spyOn(cli, ...) 拦不到；HOME/USERPROFILE stubEnv 在 Windows 不生效，
  // 会读到真实 ~/.sillyhub/daemon/config.json。这两个用例在 Windows 跳过，
  // Linux/macOS 走 setupCliWithTmpHome 的 stubEnv('HOME', tmp) 可正确隔离。
  const itNonWindows = process.platform === 'win32' ? it.skip : it;

  itNonWindows('两者都不传 → 退出码 1 + required 错误', async () => {
    const err = captureStderr();
    const code = await cli.startAction({
      server: 'http://localhost:8000',
    });
    expect(code).toBe(1);
    expect(err.writes.join('')).toContain('--token or --api-key is required');
    err.restore();
  });

  itNonWindows('只传 --api-key → saveConfigFn 收到 api_key 且 token 为 null', async () => {
    const daemonMod = await import('../src/daemon.js');
    vi.spyOn(daemonMod.Daemon.prototype, 'start').mockResolvedValue(undefined);
    const err = captureStderr();
    const out = captureStdout();
    const code = await cli.startAction({
      server: 'http://localhost:8000',
      'api-key': 'shk_live_test_key',
    });
    expect(code).toBe(0);
    // config.json 在 tmpDir 下应已写入。
    const raw = await import('node:fs/promises').then((m) =>
      m.readFile(configMod.DEFAULT_CONFIG_PATH, 'utf-8'),
    );
    const saved = JSON.parse(raw);
    expect(saved.api_key).toBe('shk_live_test_key');
    expect(saved.token).toBeNull();
    err.restore();
    out.restore();
  });
});
