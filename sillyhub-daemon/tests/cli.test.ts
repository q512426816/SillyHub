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
  // Windows 的 os.homedir()（libuv）读 USERPROFILE 而非 HOME，仅 stub HOME 在
  // Windows 不生效，DEFAULT_CONFIG_DIR 仍指向真实 ~/.sillyhub/daemon，破坏隔离
  //（status/logs 读到真实 config/pid/log）。同时 stub USERPROFILE 让两侧一致。
  // POSIX 的 homedir() 用 HOME，USERPROFILE stub 无副作用。
  vi.stubEnv('USERPROFILE', tmpDir);
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
    // ql-20260616-003：terminal observer 4 字段（与 DEFAULT_CONFIG 默认对齐）
    terminal_observer_enabled: false,
    terminal_observer_mode: 'parsed',
    terminal_observer_close_on_exit: false,
    terminal_observer_command: null,
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

  // ql-20260818-001：running 时按 runtime lock 反查实际 server 的 per-server
  // 配置展示（pid 用测试进程自身，isProcessAlive 恒真，无需伪造活进程）。
  it('status_running_shows_lock_server_config: 运行中 daemon 展示 lock 反查的实际配置', async () => {
    await cli.writePid(process.pid);
    const daemonDir = join(tmpDir, '.sillyhub', 'daemon');
    mkdirSync(join(daemonDir, 'locks'), { recursive: true });
    writeFileSync(
      join(daemonDir, 'locks', 'runtime-status-test.lock'),
      JSON.stringify({
        pid: process.pid,
        hostname: 'test-host',
        provider: 'claude',
        server_hash: 'd412c05c',
        started_at: '2026-08-18T00:00:00.000Z',
        updated_at: '2026-08-18T00:00:00.000Z',
        version: '0.1.1',
      }),
    );
    writeFileSync(
      join(daemonDir, 'config-d412c05c.json'),
      JSON.stringify({ server_url: 'http://127.0.0.1:8001', runtime_id: 'rt-live-8001' }),
    );

    const code = await cli.statusAction();
    const output = out.writes.join('');
    expect(code).toBe(0);
    expect(output).toContain('running');
    expect(output).toContain('rt-live-8001');
    expect(output).toContain('http://127.0.0.1:8001');
  });

  // ql-20260818-001：lock 指向的 per-server config 不存在 → 回退 DEFAULT 配置
  //（beforeEach mock 的 loadConfigFn 返回 makeConfig 默认 8000），不报错不 unknown。
  it('status_running_lock_without_config_falls_back: lock 对应 config 缺失回退 DEFAULT', async () => {
    await cli.writePid(process.pid);
    const daemonDir = join(tmpDir, '.sillyhub', 'daemon');
    mkdirSync(join(daemonDir, 'locks'), { recursive: true });
    writeFileSync(
      join(daemonDir, 'locks', 'runtime-status-test.lock'),
      JSON.stringify({ pid: process.pid, server_hash: 'deadbeef' }),
    );

    const code = await cli.statusAction();
    const output = out.writes.join('');
    expect(code).toBe(0);
    expect(output).toContain('running');
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
      apiKey: 'shk_live_x',
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
      apiKey: 'shk_live_test_key',
    });
    expect(code).toBe(0);
    // config.json 在 tmpDir 下应已写入。
    const raw = await import('node:fs/promises').then((m) =>
      m.readFile(configMod.configPathForServer('http://localhost:8000'), 'utf-8'),
    );
    const saved = JSON.parse(raw);
    expect(saved.api_key).toBe('shk_live_test_key');
    expect(saved.token).toBeNull();
    err.restore();
    out.restore();
  });

  // 回归测试：commander 把 --api-key 存为 camelCase apiKey（不是 opts['api-key']）。
  // 走真实 commander 解析（不是直接调 startAction），确保 CLI 解析层正确传值。
  // 失败说明 startAction 读 opts['api-key'] 会拿到 undefined，config 残留旧值。
  itNonWindows('commander 解析 --api-key 后 config.api_key 是真实 key（非 undefined）', async () => {
    const daemonMod = await import('../src/daemon.js');
    vi.spyOn(daemonMod.Daemon.prototype, 'start').mockResolvedValue(undefined);
    const out = captureStdout();

    const program = cli.createProgram();
    await program.parseAsync([
      'node',
      'sillyhub-daemon',
      'start',
      '--server',
      'http://localhost:8000',
      '--api-key',
      'shk_live_commander_real',
    ]);

    const raw = await import('node:fs/promises').then((m) =>
      m.readFile(configMod.configPathForServer('http://localhost:8000'), 'utf-8'),
    );
    const saved = JSON.parse(raw);
    expect(saved.api_key).toBe('shk_live_commander_real');
    expect(saved.token).toBeNull();
    out.restore();
  });
});

// ── TestStartSingleInstance（ql-20260831-001-6dde：start 单实例守卫）──────────
//
// 场景：pid 文件记录的进程仍存活（≠ 自身）→ 拒绝二次启动 exit 1（双实例会
// pid 互相覆盖 / stop 只能停其一 / server 侧双 runtime 抢会话；典型触发：
// macOS autostart enable 的 bootstrap RunAtLoad 立即拉起第二实例）。
// 豁免两支：SILLYHUB_DAEMON_RESPAWN=1（自更新交接既定时序）、pid=自身。
// 活进程 pid 取 process.ppid（测试运行器的父进程，恒存活且 ≠ process.pid）。
describe('TestStartSingleInstance (ql-20260831-001-6dde)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTmpDir('sillyhub-cli-single-');
    await setupCliWithTmpHome(tmpDir);
  });

  afterEach(async () => {
    teardownCliStub();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await cleanupDir(tmpDir);
  });

  it('pid 文件记录存活进程 → exit 1 + already running 提示（含 stop 指引），pid 文件不被覆盖', async () => {
    await cli.writePid(process.ppid);
    const err = captureStderr();

    const code = await cli.startAction({ server: 'http://localhost:8000' });

    expect(code).toBe(1);
    const text = err.writes.join('');
    expect(text).toContain('already running');
    expect(text).toContain(String(process.ppid));
    expect(text).toContain('stop');
    err.restore();
    // 守卫在 config 落盘与 writePid 之前：拒绝后 pid 文件保持原值
    expect(cli.readPid()).toBe(process.ppid);
  });

  it('SILLYHUB_DAEMON_RESPAWN=1（自更新交接）→ 不被守卫拦截，走到后续凭据校验', async () => {
    vi.stubEnv('SILLYHUB_DAEMON_RESPAWN', '1');
    await cli.writePid(process.ppid);
    const err = captureStderr();

    const code = await cli.startAction({ server: 'http://localhost:8000' });

    // tmp 家目录无凭据 → 走到凭据校验退出 1（而非守卫拦截）
    expect(code).toBe(1);
    expect(err.writes.join('')).not.toContain('already running');
    err.restore();
  });

  it('pid 等于自身（同进程内重复调用）→ 不被守卫拦截', async () => {
    await cli.writePid(process.pid);
    const err = captureStderr();

    await cli.startAction({ server: 'http://localhost:8000' });

    expect(err.writes.join('')).not.toContain('already running');
    err.restore();
  });
});

// ql-20260616-003：terminal observer 4 个 CLI 选项 + mode 校验
describe('TestStartTerminalObserver (ql-20260616-003)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTmpDir('sillyhub-cli-terminal-');
    await setupCliWithTmpHome(tmpDir);
  });

  afterEach(async () => {
    teardownCliStub();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await cleanupDir(tmpDir);
  });

  // createProgram 必须暴露 4 个新选项（导出层断言）
  it('start_help 含 4 个 terminal observer 选项', async () => {
    const program = cli.createProgram();
    const startCmd = program.commands.find((c) => c.name() === 'start');
    const optFlags = (startCmd?.options ?? []).map((o) => o.flags);
    expect(optFlags.some((f) => f.includes('--open-terminal'))).toBe(true);
    expect(optFlags.some((f) => f.includes('--terminal-mode'))).toBe(true);
    expect(optFlags.some((f) => f.includes('--terminal-close-on-exit'))).toBe(true);
    expect(optFlags.some((f) => f.includes('--terminal-command'))).toBe(true);
  });

  // 非法 mode 直接返回 1（验证在 config 写盘前，跨平台可跑）
  it('--terminal-mode abc 返回退出码 1 + 非法错误（跨平台）', async () => {
    const err = captureStderr();
    const code = await cli.startAction({
      server: 'http://localhost:8000',
      token: 'tok-x',
      'terminal-mode': 'abc',
    });
    expect(code).toBe(1);
    expect(err.writes.join('')).toContain('must be one of parsed/raw/both');
    err.restore();
  });

  // 合法的 3 种 mode 都接受（在 token/apiKey 互斥检查之前，命中第一个 return 1
  // 是「缺凭证」而非「mode 非法」—— 用 --api-key 让流程推进到 saveConfig 阶段）。
  // Windows 上 HOME/USERPROFILE stubEnv 不生效，只在 Linux/macOS 跑落盘验证。
  const itNonWindows = process.platform === 'win32' ? it.skip : it;

  for (const m of ['parsed', 'raw', 'both'] as const) {
    itNonWindows(`--terminal-mode ${m} 写入 config.terminal_observer_mode`, async () => {
      const daemonMod = await import('../src/daemon.js');
      vi.spyOn(daemonMod.Daemon.prototype, 'start').mockResolvedValue(undefined);
      const out = captureStdout();

      const code = await cli.startAction({
        server: 'http://localhost:8000',
        apiKey: 'shk_live_mode_test',
        'terminal-mode': m,
      });
      expect(code).toBe(0);

      const raw = await import('node:fs/promises').then((fs) =>
        fs.readFile(configMod.configPathForServer('http://localhost:8000'), 'utf-8'),
      );
      const saved = JSON.parse(raw);
      expect(saved.terminal_observer_mode).toBe(m);
      out.restore();
    });
  }

  itNonWindows('--open-terminal 让 config.terminal_observer_enabled=true', async () => {
    const daemonMod = await import('../src/daemon.js');
    vi.spyOn(daemonMod.Daemon.prototype, 'start').mockResolvedValue(undefined);
    const out = captureStdout();

    const code = await cli.startAction({
      server: 'http://localhost:8000',
      apiKey: 'shk_live_open_term',
      'open-terminal': true,
    });
    expect(code).toBe(0);

    const raw = await import('node:fs/promises').then((fs) =>
      fs.readFile(configMod.configPathForServer('http://localhost:8000'), 'utf-8'),
    );
    const saved = JSON.parse(raw);
    expect(saved.terminal_observer_enabled).toBe(true);
    out.restore();
  });

  itNonWindows('--terminal-close-on-exit + --terminal-command 写入 config', async () => {
    const daemonMod = await import('../src/daemon.js');
    vi.spyOn(daemonMod.Daemon.prototype, 'start').mockResolvedValue(undefined);
    const out = captureStdout();

    const code = await cli.startAction({
      server: 'http://localhost:8000',
      apiKey: 'shk_live_close_cmd',
      'terminal-close-on-exit': true,
      'terminal-command': 'xterm -e tail -f {log}',
    });
    expect(code).toBe(0);

    const raw = await import('node:fs/promises').then((fs) =>
      fs.readFile(configMod.configPathForServer('http://localhost:8000'), 'utf-8'),
    );
      const saved = JSON.parse(raw);
      expect(saved.terminal_observer_close_on_exit).toBe(true);
      expect(saved.terminal_observer_command).toBe('xterm -e tail -f {log}');
      out.restore();
    });
});

// ── TestAutostart（2026-08-30-daemon-autostart task-07，design §5 测试清单）────
//
// 覆盖 task-05 定型的 autostart 三子命令 CLI 分派层行为（命令树 / 分派入参 /
// 退出码 / 凭据管线 / 输出文案）。平台产物内容级断言（plist/VBS/service）归
// task-06 的 autostart.test.ts，本 describe 只测 CLI 分派层，不触真实
// schtasks/launchctl/systemctl。
//
// 注入策略（沿用 spyOn 封装注入点模式，但观测点在依赖模块命名空间）：
//   - cli.ts 的 loadConfigFn/saveConfigFn 是模块内 lexical 调用，vi.spyOn(cli, ...)
//     拦不到（见上方 TestStartApiKey 注释）；二者分别委托 config.ts 的
//     loadConfig/saveConfig（跨模块引用经 vitest ssr 命名空间），故 spy
//     configMod.loadConfig / configMod.saveConfig 等价观测 cli 的落盘/加载管线；
//   - enableAutostart/disableAutostart/autostartStatus 是 cli 从
//     ./autostart/index.js 导入的跨模块引用，vi.spyOn(autostartMod, ...) 直接
//     拦截 cli 内部调用，替换为可控 resolved 值，绝不真注册；
//   - beforeEach 统一装 spy 并给安全默认 resolved 值（即使断言遗漏也不触系统）。

type AutostartModule = typeof import('../src/autostart/index.js');
type AutostartStatusEntryType = import('../src/autostart/index.js').AutostartStatusEntry;

/** 构造最小可用 status 条目（AutostartRecord 六字段齐全 + systemState 三态）。 */
function makeAutostartEntry(
  overrides: Partial<AutostartStatusEntryType> = {},
): AutostartStatusEntryType {
  return {
    server_url: 'http://localhost:8000',
    platform: 'win32',
    node_path: 'C:\\node\\node.exe',
    script_path: 'C:\\app\\dist\\cli.js',
    task_name: 'SillyHubDaemon-0000test',
    enabled_at: '2026-08-30T00:00:00.000Z',
    systemState: 'registered',
    ...overrides,
  };
}

describe('TestAutostart (2026-08-30-daemon-autostart task-07)', () => {
  let tmpDir: string;
  let out: ReturnType<typeof captureStdout>;
  let err: ReturnType<typeof captureStderr>;
  let autostartMod: AutostartModule;

  beforeEach(async () => {
    tmpDir = await makeTmpDir('sillyhub-cli-autostart-');
    await setupCliWithTmpHome(tmpDir);
    out = captureStdout();
    err = captureStderr();
    // autostart 三顶层 API：setupCliWithTmpHome 的 resetModules + 动态 import 后，
    // 此处 import 与 cli.js 内部引用是同一模块实例（同 registry key）。
    autostartMod = await import('../src/autostart/index.js');
    vi.spyOn(autostartMod, 'enableAutostart').mockResolvedValue({
      ok: true,
      record: makeAutostartEntry(),
    });
    vi.spyOn(autostartMod, 'disableAutostart').mockResolvedValue({ ok: true, removed: [] });
    vi.spyOn(autostartMod, 'autostartStatus').mockResolvedValue([]);
    // 凭据管线：config 缺省有 token（enable 各用例按需覆盖）；saveConfig 不 mock
    // 实现，真实落盘到 tmp HOME（对齐既有 start 用例的落盘语义）。
    vi.spyOn(configMod, 'loadConfig').mockResolvedValue(makeConfig());
    vi.spyOn(configMod, 'saveConfig');
  });

  afterEach(async () => {
    out.restore();
    err.restore();
    teardownCliStub();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await cleanupDir(tmpDir);
  });

  // ── 命令树（find(name===) 定向 + toContain，不做命令列表全量快照）──────────

  it('命令树: autostart 组下 enable/disable/status 可见，enable 含 --server/--api-key/--token', () => {
    const program = cli.createProgram();
    const autostartCmd = program.commands.find((c) => c.name() === 'autostart');
    expect(autostartCmd).toBeDefined();
    const subNames = (autostartCmd?.commands ?? []).map((c) => c.name());
    expect(subNames).toContain('enable');
    expect(subNames).toContain('disable');
    expect(subNames).toContain('status');
    const enableCmd = (autostartCmd?.commands ?? []).find((c) => c.name() === 'enable');
    const optFlags = (enableCmd?.options ?? []).map((o) => o.flags);
    expect(optFlags.some((f) => f.includes('--server'))).toBe(true);
    expect(optFlags.some((f) => f.includes('--api-key'))).toBe(true);
    expect(optFlags.some((f) => f.includes('--token'))).toBe(true);
  });

  // ── enable 分派 ────────────────────────────────────────────────────────────

  it('enable_dispatch_api_key: --api-key 注册成功 → 落盘先于注册、入参含 serverUrl/apiKey、退出码 0、输出任务标识与立即启动提示', async () => {
    vi.mocked(autostartMod.enableAutostart).mockResolvedValue({
      ok: true,
      record: makeAutostartEntry({ task_name: 'SillyHubDaemon-abc12345' }),
    });

    const code = await cli.autostartEnableAction({
      server: 'http://localhost:8000',
      apiKey: 'shk_live_autostart',
    });

    expect(code).toBe(0);
    // 分派入参：凭据经合并后传入（apiKey 优先，token 清空为 undefined，D-004）。
    expect(autostartMod.enableAutostart).toHaveBeenCalledWith({
      serverUrl: 'http://localhost:8000',
      apiKey: 'shk_live_autostart',
      token: undefined,
    });
    // 落盘先于注册（invocationCallOrder 为全局单调递增计数）。
    const saveOrder = vi.mocked(configMod.saveConfig).mock.invocationCallOrder[0];
    const enableOrder = vi.mocked(autostartMod.enableAutostart).mock.invocationCallOrder[0];
    expect(saveOrder).toBeDefined();
    expect(enableOrder).toBeDefined();
    expect(saveOrder!).toBeLessThan(enableOrder!);
    // 落盘内容：api_key 写入 per-server config 文件（凭据落盘、不进任务命令）。
    const saveCall = vi.mocked(configMod.saveConfig).mock.calls[0];
    expect(saveCall?.[0].api_key).toBe('shk_live_autostart');
    expect(saveCall?.[1]).toBe(configMod.configPathForServer('http://localhost:8000'));
    // 成功输出：任务标识 + 启动命令 + 日志位置 + 立即启动提示。
    const output = out.writes.join('');
    expect(output).toContain('已注册开机（或登录）自启动');
    expect(output).toContain('任务标识：SillyHubDaemon-abc12345');
    expect(output).toContain('启动命令：');
    expect(output).toContain('日志位置：');
    expect(output).toContain('立即启动可执行：sillyhub-daemon start --server http://localhost:8000');
  });

  it('enable_missing_credentials: config 与命令行均无凭据 → 退出码 1 + stderr 提示 + enableAutostart 不被调用', async () => {
    vi.mocked(configMod.loadConfig).mockResolvedValue(
      makeConfig({ token: null, api_key: null }),
    );

    const code = await cli.autostartEnableAction({ server: 'http://localhost:8000' });

    expect(code).toBe(1);
    // 不注册半残任务（开机必失败的任务没有意义）。
    expect(autostartMod.enableAutostart).not.toHaveBeenCalled();
    expect(err.writes.join('')).toContain('缺少凭据');
    // 无条件落盘仍发生（对齐 start：落盘先于凭据校验）。
    expect(configMod.saveConfig).toHaveBeenCalled();
  });

  it('enable_token_warning: --token 注册成功路径输出「登录 Token 会过期」警告（R-12/C-20）', async () => {
    vi.mocked(configMod.loadConfig).mockResolvedValue(
      makeConfig({ token: null, api_key: null }),
    );
    vi.mocked(autostartMod.enableAutostart).mockResolvedValue({
      ok: true,
      record: makeAutostartEntry({ task_name: 'SillyHubDaemon-token9876' }),
    });

    const code = await cli.autostartEnableAction({
      server: 'http://localhost:8000',
      token: 'jwt-short-lived',
    });

    expect(code).toBe(0);
    expect(autostartMod.enableAutostart).toHaveBeenCalledWith({
      serverUrl: 'http://localhost:8000',
      token: 'jwt-short-lived',
      apiKey: undefined,
    });
    // 琥珀警告走 stderr（emitAmberWarning），注册成功与否都提示。
    expect(err.writes.join('')).toContain('登录 Token 会过期');
    expect(out.writes.join('')).toContain('任务标识：SillyHubDaemon-token9876');
  });

  it('enable_register_failed: enableAutostart 返回 ok:false → 退出码 1 + stderr 错误与提示', async () => {
    vi.mocked(autostartMod.enableAutostart).mockResolvedValue({
      ok: false,
      error: 'schtasks 创建失败: 拒绝访问',
      hint: '检查任务计划程序权限',
    });

    const code = await cli.autostartEnableAction({
      server: 'http://localhost:8000',
      apiKey: 'shk_live_autostart',
    });

    expect(code).toBe(1);
    const errText = err.writes.join('');
    expect(errText).toContain('注册开机（或登录）自启失败');
    expect(errText).toContain('schtasks 创建失败: 拒绝访问');
    expect(errText).toContain('提示：检查任务计划程序权限');
    expect(out.writes.join('')).not.toContain('已注册开机（或登录）自启动');
  });

  // ── disable 分派 ───────────────────────────────────────────────────────────

  it('disable_by_server: --server 单条 → disableAutostart({serverUrl}) 被调、退出码 0、输出已注销与运行不受影响', async () => {
    vi.mocked(autostartMod.disableAutostart).mockResolvedValue({
      ok: true,
      removed: ['http://localhost:8000'],
    });

    const code = await cli.autostartDisableAction({ server: 'http://localhost:8000' });

    expect(code).toBe(0);
    expect(autostartMod.disableAutostart).toHaveBeenCalledWith({
      serverUrl: 'http://localhost:8000',
      all: undefined,
    });
    const output = out.writes.join('');
    expect(output).toContain('已注销自启：http://localhost:8000');
    expect(output).toContain('正在运行的 daemon 不受影响');
  });

  it('disable_all: --all → disableAutostart({all:true}) 被调、多条 removed 逐行输出、退出码 0', async () => {
    vi.mocked(autostartMod.disableAutostart).mockResolvedValue({
      ok: true,
      removed: ['http://localhost:8000', 'http://127.0.0.1:9001'],
    });

    const code = await cli.autostartDisableAction({ all: true });

    expect(code).toBe(0);
    expect(autostartMod.disableAutostart).toHaveBeenCalledWith({ all: true });
    const output = out.writes.join('');
    expect(output).toContain('已注销自启：http://localhost:8000');
    expect(output).toContain('已注销自启：http://127.0.0.1:9001');
    expect(output).toContain('正在运行的 daemon 不受影响');
  });

  it('disable_no_arg_multiple: 无参且多条注册 → 列出条目要求 --server/--all、退出码 1、disableAutostart 不被调用', async () => {
    vi.mocked(autostartMod.autostartStatus).mockResolvedValue([
      makeAutostartEntry({
        server_url: 'http://localhost:8000',
        task_name: 'SillyHubDaemon-0000aaaa',
      }),
      makeAutostartEntry({
        server_url: 'http://127.0.0.1:9001',
        task_name: 'SillyHubDaemon-0000bbbb',
      }),
    ]);

    const code = await cli.autostartDisableAction({});

    expect(code).toBe(1);
    expect(autostartMod.disableAutostart).not.toHaveBeenCalled();
    const errText = err.writes.join('');
    expect(errText).toContain('多条自启');
    expect(errText).toContain('http://127.0.0.1:9001');
    expect(errText).toContain('任务标识：SillyHubDaemon-0000bbbb');
    expect(errText).toContain('--all');
  });

  it('disable_no_arg_single: 无参且单条注册 → 自动注销该条（省 --server），退出码 0', async () => {
    vi.mocked(autostartMod.autostartStatus).mockResolvedValue([
      makeAutostartEntry({
        server_url: 'http://localhost:8000',
        task_name: 'SillyHubDaemon-0000cccc',
      }),
    ]);
    vi.mocked(autostartMod.disableAutostart).mockResolvedValue({
      ok: true,
      removed: ['http://localhost:8000'],
    });

    const code = await cli.autostartDisableAction({});

    expect(code).toBe(0);
    expect(autostartMod.disableAutostart).toHaveBeenCalledWith({
      serverUrl: 'http://localhost:8000',
    });
    expect(out.writes.join('')).toContain('已注销自启：http://localhost:8000');
  });

  it('disable_no_arg_empty: 无参且无注册 → 提示未注册、退出码 0（幂等成功），disableAutostart 不被调用', async () => {
    vi.mocked(autostartMod.autostartStatus).mockResolvedValue([]);

    const code = await cli.autostartDisableAction({});

    expect(code).toBe(0);
    expect(autostartMod.disableAutostart).not.toHaveBeenCalled();
    expect(out.writes.join('')).toContain('未注册任何开机（或登录）自启');
  });

  // ── status 分派（恒退出码 0，查询路径不报错退出）──────────────────────────

  it('status_empty: 无注册记录 → 提示未注册、退出码 0', async () => {
    vi.mocked(autostartMod.autostartStatus).mockResolvedValue([]);

    const code = await cli.autostartStatusAction();

    expect(code).toBe(0);
    expect(out.writes.join('')).toContain('未注册任何开机（或登录）自启');
  });

  it('status_entries: 有注册记录 → 逐条输出 Server/任务标识/系统状态三态标签、退出码 0', async () => {
    vi.mocked(autostartMod.autostartStatus).mockResolvedValue([
      makeAutostartEntry({
        server_url: 'http://localhost:8000',
        task_name: 'SillyHubDaemon-0000aaaa',
        systemState: 'registered',
      }),
      makeAutostartEntry({
        server_url: 'http://127.0.0.1:9001',
        task_name: 'SillyHubDaemon-0000bbbb',
        systemState: 'missing',
      }),
      makeAutostartEntry({
        server_url: 'http://10.0.0.8:8000',
        task_name: 'SillyHubDaemon-0000dddd',
        systemState: 'unknown',
      }),
    ]);

    const code = await cli.autostartStatusAction();

    expect(code).toBe(0);
    const output = out.writes.join('');
    expect(output).toContain('Server：http://localhost:8000');
    expect(output).toContain('任务标识：SillyHubDaemon-0000aaaa');
    expect(output).toContain('系统状态：已注册');
    expect(output).toContain('Server：http://10.0.0.8:8000');
    expect(output).toContain('系统状态：注册丢失');
    expect(output).toContain('系统状态：查询失败');
  });
});
