#!/usr/bin/env node
/**
 * sillyhub-daemon CLI 入口（task-21，W5）。
 *
 * 替代 Python `sillyhub_daemon/__main__.py`（204 行），用 commander 替代 click，
 * 提供 4 个子命令：start / stop / status / logs。
 *
 * 通过 `npm i -g sillyhub-daemon` 后可直接运行：
 *   sillyhub-daemon start --server <url> --token <token>
 *
 * Python 1:1 对齐点（task-22 cli.test.ts 逐字断言）：
 *   - PID 文件路径：`~/.sillyhub/daemon/daemon.pid`
 *   - 日志路径：    `~/.sillyhub/daemon/daemon.log`
 *   - status 输出格式（State:/PID:/Runtime ID:/Server URL:/Config dir:）
 *   - stop / status 退出码（0 / 1）
 *   - 错误消息到 stderr
 *
 * **可测试性设计（task-22 协调点）**：
 *   PID / LOG 路径通过 `getPidFile()` / `getLogFile()` 函数返回（不导出顶层 const），
 *   task-22 用 `vi.spyOn(cli, 'getPidFile').mockReturnValue(tmp)` 注入临时路径。
 *   同理 `loadConfigFn` / `saveConfigFn` 也封装为可 spy 的函数。
 *
 * **信号职责划分（避免双重 stop）**：
 *   Daemon 内部（task-20）已注册 SIGINT/SIGTERM handler 调 `daemon.stop()`，
 *   并在 stop() 内 `_uninstallSignalHandlers()` 注销自己。CLI 层不再重复注册
 *   信号 handler —— 仅靠 Daemon 内部 handler 触发 stop，进程随事件循环清空自然退出。
 *   PID 文件清理放在 start 的 finally（与 Python `finally: _remove_pid()` 一致），
 *   Daemon.stop() 返回后 main() 解析，finally 执行 removePid。
 *
 * **Reverse Sync（蓝图假设 vs 真实 src 差异，以真实为准）**：
 *   1. config.ts 是函数式 `loadConfig(path?)` / `saveConfig(config, path?)`，
 *      不是 `new DaemonConfig()` + `config.save()`。蓝图假设的类式 API 不存在。
 *   2. TaskRunner 构造是 3 个位置参数 `new TaskRunner(client, workspace, credential)`，
 *      不是 options 对象。
 *   3. Daemon.isRunning 是 getter（camelCase），不是 `is_running`。
 *   4. Daemon.start() 已含 register + 三循环启动，CLI 只调它一次后保持进程。
 *
 * @module cli
 */

import { Command } from 'commander';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';

import { DEFAULT_CONFIG_DIR, DEFAULT_CONFIG_PATH, loadConfig, saveConfig } from './config.js';
import { HubClient } from './hub-client.js';
import { WorkspaceManager } from './workspace.js';
import { CredentialManager } from './credential.js';
import { TaskRunner } from './task-runner.js';
import { Daemon } from './daemon.js';
import { ClaudeSdkDriver } from './interactive/claude-sdk-driver.js';
import { SessionManager } from './interactive/session-manager.js';

// ── 路径访问（可测试性：函数返回，task-22 vi.spyOn 可 mock）──────────────────

/**
 * 返回 PID 文件路径。task-22 测试用 vi.spyOn(cli, 'getPidFile') 注入临时路径。
 * 不导出为顶层 const —— 顶层 const 无法被 vi.spyOn mock（违反 R3）。
 */
export function getPidFile(): string {
  return join(DEFAULT_CONFIG_DIR, 'daemon.pid');
}

/**
 * 返回日志文件路径。同 getPidFile，设计为可 spy 的函数。
 */
export function getLogFile(): string {
  return join(DEFAULT_CONFIG_DIR, 'daemon.log');
}

// ── 配置加载/保存包装（可测试性：task-22 可 spy）─────────────────────────────

/**
 * 加载配置的包装函数。task-22 可 spy 替换为内存配置。
 * 默认委托 config.ts 的 loadConfig。
 */
export async function loadConfigFn(path: string): Promise<ReturnType<typeof loadConfig>> {
  return loadConfig(path);
}

/**
 * 保存配置的包装函数。task-22 可 spy 拦截文件写入。
 */
export async function saveConfigFn(
  config: Parameters<typeof saveConfig>[0],
  path: string,
): Promise<void> {
  await saveConfig(config, path);
}

// ── 辅助函数（对齐 Python _read_pid / _is_process_alive / _write_pid / _remove_pid）──

/**
 * 读 PID 文件，返回存储的 PID；文件缺失或损坏返回 null。
 *
 * 对齐 Python `_read_pid()`（__main__.py:27-32）：
 *   try: int(_PID_FILE.read_text().strip())
 *   except (OSError, ValueError): None
 *
 * 文件存在但内容非数字（损坏）→ Number.parseInt 失败返回 NaN → 归一为 null。
 */
export function readPid(): number | null {
  const pidFile = getPidFile();
  let text: string;
  try {
    text = readFileSync(pidFile, 'utf-8');
  } catch {
    // 文件不存在（ENOENT）或权限不足 → null（对齐 Python except OSError）
    return null;
  }
  const trimmed = text.trim();
  if (!trimmed) return null;
  const n = Number.parseInt(trimmed, 10);
  // Number.isFinite 排除 NaN（损坏内容）和 Infinity（极端溢出）
  return Number.isFinite(n) ? n : null;
}

/**
 * 检查进程是否存活。对齐 Python `_is_process_alive(pid)`（__main__.py:35-43）。
 *
 * `process.kill(pid, 0)` 语义：
 *   - 进程存在且可信号 → 不抛（返回 true）
 *   - 进程不存在 → 抛 Error，code 'ESRCH'（对应 Python ProcessLookupError）→ false
 *   - 进程存在但无权限 → 抛 Error，code 'EPERM'（对应 Python PermissionError）→ true
 *     （Python 原版仅 catch OSError/ProcessLookupError 把 EPERM 视为存活）
 *
 * @param pid 进程 ID
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    // ESRCH：进程不存在 → false。EPERM：存在但无权限 → true（Python os.kill EPERM 同义）。
    if (code === 'ESRCH') return false;
    if (code === 'EPERM') return true;
    // 其他错误（EINVAL pid 非法等）保守视为不存在
    return false;
  }
}

/**
 * 写 PID 文件（递归建目录）。对齐 Python `_write_pid(pid)`（__main__.py:46-49）。
 *
 * 异步实现（fs/promises mkdir + writeFile）—— writePid 被 start 命令调用，
 * start 本身 async，调用方 await。readPid 保持同步因 stop/status 期望同步。
 */
export async function writePid(pid: number): Promise<void> {
  const pidFile = getPidFile();
  await mkdir(dirname(pidFile), { recursive: true });
  await writeFile(pidFile, String(pid), 'utf-8');
}

/**
 * 删除 PID 文件（best-effort，忽略 ENOENT）。
 * 对齐 Python `_remove_pid()`（__main__.py:52-56）。
 */
export async function removePid(): Promise<void> {
  const pidFile = getPidFile();
  try {
    await rm(pidFile, { force: true });
  } catch {
    // best-effort，任何错误都吞掉（对齐 Python `except OSError: pass`）
  }
}

// ── program 构造（导出便于 task-22 直接 parse argv）─────────────────────────

/**
 * 构造 commander program。导出为函数而非顶层单例，便于 task-22 多次 parse
 * 不同 argv（commander program parse 后状态被修改，单例会污染）。
 *
 * 回调签名（startAction 等）接收参数对象而非 commander options，便于测试直接调用。
 */
export function createProgram(): Command {
  const program = new Command();

  program
    .name('sillyhub-daemon')
    .description('SillyHub Daemon - local task execution daemon.')
    .version('0.1.0');

  // ── start ────────────────────────────────────────────────────────────────

  program
    .command('start')
    .description('Start the daemon.')
    .option('--server <url>', 'Server URL (e.g. http://localhost:8000)')
    .option('--token <token>', 'Bearer access token (short-lived, 15min) — mutually exclusive with --api-key')
    .option('--api-key <key>', 'Long-lived API key (X-API-Key) — mutually exclusive with --token')
    .option('--workspace-dir <dir>', 'Workspace base directory')
    .option('--poll-interval <sec>', 'HTTP poll interval in seconds')
    .option('--heartbeat-interval <sec>', 'WS heartbeat interval in seconds')
    .option('--max-concurrent <n>', 'Max concurrent tasks')
    .option('--log-level <level>', 'Log level (debug/info/warn/error)')
    // ql-20260616-003：本地终端观察（弹独立窗口 tail 任务日志）
    .option('--open-terminal', 'Open a local terminal window tail-ing the observer log for each agent task')
    .option('--terminal-mode <mode>', 'Observer log mode: parsed (default) / raw / both')
    .option('--terminal-close-on-exit', 'Close observer terminal after task exits (best-effort, platform-dependent)')
    .option('--terminal-command <cmd>', 'Custom terminal launch command template, supports {log} and {title} placeholders')
    .action(async (opts: StartOptions) => {
      const code = await startAction(opts);
      if (code !== 0) process.exit(code);
    });

  // ── stop ─────────────────────────────────────────────────────────────────

  program
    .command('stop')
    .description('Stop the daemon (sends SIGTERM to the running daemon process).')
    .action(() => {
      const code = stopAction();
      if (code !== 0) process.exit(code);
    });

  // ── status ───────────────────────────────────────────────────────────────

  program
    .command('status')
    .description('Show daemon status.')
    .action(async () => {
      const code = await statusAction();
      if (code !== 0) process.exit(code);
    });

  // ── logs ─────────────────────────────────────────────────────────────────

  program
    .command('logs')
    .description('Show daemon logs.')
    .option('--tail <n>', 'Number of lines to show', '50')
    .action(async (opts: LogsOptions) => {
      const code = await logsAction(opts);
      if (code !== 0) process.exit(code);
    });

  return program;
}

// ── 选项类型 ────────────────────────────────────────────────────────────────

interface StartOptions {
  server?: string;
  token?: string;
  // commander 把 --api-key 存为 camelCase apiKey（不是 opts['api-key']）。
  // 测试也用 camelCase 调 startAction，与 commander 解析保持一致。
  apiKey?: string;
  'workspace-dir'?: string;
  'poll-interval'?: string;
  'heartbeat-interval'?: string;
  'max-concurrent'?: string;
  'log-level'?: string;
  // ql-20260616-003：terminal observer 参数。commander 把 kebab-case 选项
  // 存为同名 bracket 访问（opts['open-terminal']），与现有 --workspace-dir
  // 一致；--terminal-close-on-exit 同理。
  'open-terminal'?: boolean;
  'terminal-mode'?: string;
  'terminal-close-on-exit'?: boolean;
  'terminal-command'?: string;
}

interface LogsOptions {
  tail?: string;
}

// ── startAction（对齐 Python start() __main__.py:74-124）─────────────────────

/**
 * start 子命令业务逻辑。导出便于 task-22 直接调用（不经 commander 解析）。
 *
 * 流程（对齐 Python __main__.py:74-124）：
 *   1. loadConfig（函数式，非 new DaemonConfig）
 *   2. --server / --token 覆盖 config 字段
 *   3. saveConfig（函数式）
 *   4. 校验 token 缺失 → stderr + exit 1
 *   5. 实例化 HubClient / WorkspaceManager / CredentialManager / TaskRunner / Daemon
 *   6. writePid(process.pid)
 *   7. daemon.start()
 *   8. 保持运行（await 永不 resolve 的 promise，靠 daemon.stop() / 信号终止）
 *   9. finally removePid()
 *
 * @returns 退出码（0 正常退出，1 错误）
 */
export async function startAction(opts: StartOptions): Promise<number> {
  // step 0: 互斥校验（先于 config 加载，避免污染持久化文件）。
  // --token 与 --api-key 同时给 → 退出码 1，避免运行时鉴权歧义。
  if (opts.token && opts.apiKey) {
    process.stderr.write('Error: --token and --api-key are mutually exclusive.\n');
    return 1;
  }

  // step 1-2: 加载配置 + CLI 覆盖字段。
  // config.ts 是函数式 loadConfig(path?)，返回 DaemonConfig 纯对象（非 class 实例）。
  const configPath = DEFAULT_CONFIG_PATH;
  const config = { ...(await loadConfigFn(configPath)) };

  if (opts.server) {
    config.server_url = opts.server;
  }
  if (opts.token) {
    config.token = opts.token;
    // 选 token 时清掉 api_key，避免持久化文件里两个都非空导致下次启动歧义。
    config.api_key = null;
  }
  if (opts.apiKey) {
    config.api_key = opts.apiKey;
    config.token = null;
  }
  if (opts['workspace-dir']) {
    config.workspace_dir = opts['workspace-dir'];
  }
  if (opts['poll-interval']) {
    const n = Number.parseInt(opts['poll-interval'], 10);
    if (Number.isFinite(n)) config.poll_interval = n;
  }
  if (opts['heartbeat-interval']) {
    const n = Number.parseInt(opts['heartbeat-interval'], 10);
    if (Number.isFinite(n)) config.heartbeat_interval = n;
  }
  if (opts['max-concurrent']) {
    const n = Number.parseInt(opts['max-concurrent'], 10);
    if (Number.isFinite(n)) config.max_concurrent_tasks = n;
  }
  if (opts['log-level']) {
    config.log_level = opts['log-level'];
  }

  // ql-20260616-003：terminal observer 选项合并
  if (opts['open-terminal']) {
    config.terminal_observer_enabled = true;
  }
  if (opts['terminal-mode']) {
    const m = opts['terminal-mode'];
    if (m === 'parsed' || m === 'raw' || m === 'both') {
      config.terminal_observer_mode = m;
    } else {
      process.stderr.write('Error: --terminal-mode must be one of parsed/raw/both.\n');
      return 1;
    }
  }
  if (opts['terminal-close-on-exit']) {
    config.terminal_observer_close_on_exit = true;
  }
  if (opts['terminal-command']) {
    config.terminal_observer_command = opts['terminal-command'];
  }

  // step 3: 持久化配置（对齐 Python `config.save()`）。
  await saveConfigFn(config, configPath);

  // step 4: 凭证缺失校验（兼容旧版错误消息：仍是 token/api_key 任一即可）。
  if (!config.token && !config.api_key) {
    process.stderr.write(
      'Error: --token or --api-key is required. Get one from the SillyHub web UI.\n',
    );
    return 1;
  }

  // step 5 前置：echo 启动信息（对齐 Python __main__.py:93-94）。
  process.stdout.write(`Starting SillyHub daemon (server=${config.server_url})...\n`);
  process.stdout.write(`Runtime ID: ${config.runtime_id}\n`);

  // step 5: 实例化 5 个模块（构造签名以真实 src 为准，Reverse Sync）。
  //   - HubClient: new HubClient(serverUrl, auth?) —— auth 为 string（旧式 token）
  //     或 { token?, apiKey? } 对象。daemon-api-key 变更新增 apiKey 分支。
  //   - WorkspaceManager: new WorkspaceManager(baseDir)
  //   - CredentialManager: new CredentialManager()
  //   - TaskRunner: new TaskRunner(client, workspace, credential)
  //   - Daemon: new Daemon(config, client, taskRunner?, options?)
  //
  // CredentialManager 直接满足 TaskRunner 的 RunnerCredentialManager 鸭子接口
  // （buildEnv 签名已在 task-runner.ts 对齐 credential.ts），无需 adapter 包装（G-04）。
  const clientAuth = config.api_key
    ? { apiKey: config.api_key }
    : { token: config.token ?? undefined };
  const client = new HubClient(config.server_url, clientAuth);
  const workspaceDir = join(DEFAULT_CONFIG_DIR, 'workspaces');
  const workspaceMgr = new WorkspaceManager(workspaceDir);
  const credentialMgr = new CredentialManager();
  // CredentialManager 直接满足 TaskRunner 的 RunnerCredentialManager 鸭子接口
  // （buildEnv 签名已对齐，task-runner.ts:127），无需 adapter 包装（G-04）。
  // ql-20260616-003：第 4 参传 config —— TaskRunner 需要读 terminal_observer_*
  // 字段决定是否写日志 + 弹独立终端。之前漏传，导致 config 一直走兜底（observer
  // 字段未生效）。
  const taskRunner = new TaskRunner(client, workspaceMgr, credentialMgr, config);

  // task-04（D-002@v3 补丁 gap-1）：注入 SessionManager + daemon 桥接 deps。
  //
  // 组装顺序（design §2 + R1 循环引用）：
  //   1. new ClaudeSdkDriver() —— interactive session 的 SDK 驱动（与 batch TaskRunner 并存）
  //   2. new SessionManager({ driver, onTurnResult/onTurnMessage/onSessionEnd 闭包 })
  //      —— deps 闭包内引用 daemon（daemon 此刻尚未构造，闭包延迟绑定生效）
  //   3. new Daemon(config, client, taskRunner, { sessionManager })
  //      —— daemon 构造后赋值，deps 闭包此刻可正确 forward 到 daemon.onTurnResult 等
  //
  // 闭包延迟绑定（R1）：deps 引 daemon、daemon 引 sessionManager，用 `let daemon` 先声明，
  // deps 闭包内 `daemon.onTurnResult(...)` 在 daemon 赋值后调用时才解析（JS 闭包捕获引用）。
  // 不用 circular import、不用 daemon 构造后回填 deps（避免双段初始化时序问题）。
  //
  // 桥接方向（design §6）：
  //   deps.onTurnResult    → daemon.onTurnResult    → hubClient.notifyRunResult   → backend close_interactive_run
  //   deps.onTurnMessage   → daemon.onTurnMessage   → hubClient.submitMessages    → backend SSE turn_progress
  //   deps.onSessionEnd    → daemon.onSessionEnd    → hubClient.notifySessionEnd  → backend end_session
  const driver = new ClaudeSdkDriver();
  let daemon: Daemon;
  const sessionManager = new SessionManager({
    driver,
    onTurnResult: (sessionId, runId, result) => daemon.onTurnResult(sessionId, runId, result),
    onTurnMessage: (sessionId, runId, msg) => daemon.onTurnMessage(sessionId, runId, msg),
    onSessionEnd: (sessionId, status) => daemon.onSessionEnd(sessionId, status),
  });
  daemon = new Daemon(config, client, taskRunner, { sessionManager });

  // step 6: 写 PID 文件（对齐 Python __main__.py:106 `_write_pid(os.getpid())`）。
  await writePid(process.pid);

  // step 7-8: 启动 daemon + 保持运行。
  // 信号处理：Daemon 内部（task-20）已注册 SIGINT/SIGTERM → daemon.stop()，
  // stop() 内部 _uninstallSignalHandlers() 注销自己。CLI 层不重复注册，
  // 避免双重 stop。停止信号通过 Daemon 内部 handler 触发。
  //
  // 保持运行：await 一个仅在 daemon.isRunning 变 false 时 resolve 的 Promise。
  // Daemon.stop() 把 _running=false，轮询检测后 resolve，main() 返回进 finally。
  try {
    await daemon.start();

    // 保持进程运行，直到 daemon.isRunning === false（信号触发 stop 后）。
    // 对齐 Python `while daemon.is_running: await asyncio.sleep(1)`。
    // 轮询 1s 一次（轻量），不阻塞事件循环。
    while (daemon.isRunning) {
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));
    }

    // daemon.isRunning false 后，确认 stop 完成（Daemon 内部 handler 已触发 stop，
    // 此处 await 确保所有循环退出 + ws/http 关闭）。
    await daemon.stop();
    process.stdout.write('\nShutting down...\n');
    return 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`Error starting daemon: ${msg}\n`);
    // 异常退出前也确保 daemon.stop 被调用（资源清理）
    try {
      await daemon.stop();
    } catch {
      // 已在停止中，忽略
    }
    return 1;
  } finally {
    // 对齐 Python __main__.py:123-124 `finally: _remove_pid()`。
    await removePid();
  }
}

// ── stopAction（对齐 Python stop() __main__.py:131-151）──────────────────────

/**
 * stop 子命令业务逻辑。导出便于 task-22 直接调用。
 *
 * 流程（对齐 Python __main__.py:131-151）：
 *   1. readPid → null → 友好错误 + exit 1
 *   2. isProcessAlive(pid) false → 删 stale PID + exit 1
 *   3. process.kill(pid, 'SIGTERM') → echo 成功 + exit 0
 *   4. PermissionError (EPERM) → stderr + exit 1
 *
 * 同步实现（readPid / isProcessAlive / process.kill 都是同步）。
 *
 * @returns 退出码（0 成功发送信号，1 各种失败）
 */
export function stopAction(): number {
  const pid = readPid();
  if (pid === null) {
    process.stdout.write('No PID file found. Is the daemon running?\n');
    return 1;
  }

  if (!isProcessAlive(pid)) {
    process.stdout.write(
      `Process ${pid} is not running (stale PID file removed).\n`,
    );
    // 同步删除 stale PID（对齐 Python 同步 _remove_pid()）。stopAction 同步语义。
    try {
      rmSync(getPidFile(), { force: true });
    } catch {
      // best-effort
    }
    return 1;
  }

  try {
    process.kill(pid, 'SIGTERM');
    process.stdout.write(`Sent SIGTERM to daemon (PID ${pid}).\n`);
    return 0;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EPERM') {
      process.stderr.write(`Permission denied: cannot signal process ${pid}.\n`);
      return 1;
    }
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`Error stopping daemon: ${msg}\n`);
    return 1;
  }
}

// ── statusAction（对齐 Python status() __main__.py:158-177）──────────────────

/**
 * status 子命令业务逻辑。导出便于 task-22 直接调用。
 *
 * 输出格式严格对齐 Python __main__.py:173-177（task-22 逐字断言）：
 *   State:       running | stopped | stopped (stale PID)
 *   PID:         <pid> | <pid> (dead) | -
 *   Runtime ID:  <runtime_id>
 *   Server URL:  <server_url>
 *   Config dir:  ~/.sillyhub/daemon
 *
 * 注意字段对齐用空格（Python `f"State:       {state}"` —— "State:" 后 7 空格）。
 * 字段名后空格数：State=7, PID=7, Runtime ID=2, Server URL=2, Config dir=2。
 *
 * @returns 退出码（status 命令始终返回 0，对齐 Python 无 sys.exit）
 */
export async function statusAction(): Promise<number> {
  const configPath = DEFAULT_CONFIG_PATH;
  let config: { runtime_id: string; server_url: string } | null = null;
  try {
    config = await loadConfigFn(configPath);
  } catch {
    // 配置加载失败（文件损坏等）→ 用占位值，不中断 status 输出
    config = { runtime_id: '(unknown)', server_url: '(unknown)' };
  }

  const pid = readPid();
  let state: string;
  let pidInfo: string;
  if (pid !== null && isProcessAlive(pid)) {
    state = 'running';
    pidInfo = String(pid);
  } else if (pid !== null) {
    state = 'stopped (stale PID)';
    pidInfo = `${pid} (dead)`;
  } else {
    state = 'stopped';
    pidInfo = '-';
  }

  // 字段对齐：与 Python click.echo(f"State:       {state}") 字节一致。
  // "State:" 后 7 空格（让 value 对齐到第 13 列）。
  process.stdout.write(`State:       ${state}\n`);
  process.stdout.write(`PID:         ${pidInfo}\n`);
  process.stdout.write(`Runtime ID:  ${config.runtime_id}\n`);
  process.stdout.write(`Server URL:  ${config.server_url}\n`);
  process.stdout.write(`Config dir:  ${DEFAULT_CONFIG_DIR}\n`);
  return 0;
}

// ── logsAction（对齐 Python logs() __main__.py:184-198）──────────────────────

/**
 * logs 子命令业务逻辑。导出便于 task-22 直接调用。
 *
 * 流程（对齐 Python __main__.py:184-198）：
 *   1. 日志文件不存在 → 友好提示（两行）+ return 0
 *   2. 读全文 → splitlines → 取最后 N 行逐行 echo
 *   3. OSError → stderr + exit 1
 *
 * @returns 退出码（0 成功或无日志，1 读错误）
 */
export async function logsAction(opts: LogsOptions): Promise<number> {
  const logFile = getLogFile();
  const tailRaw = opts.tail ?? '50';
  const tail = Number.parseInt(tailRaw, 10);
  const n = Number.isFinite(tail) && tail > 0 ? tail : 50;

  if (!existsSync(logFile)) {
    process.stdout.write(`No log file found at ${logFile}\n`);
    process.stdout.write('Start the daemon first to generate logs.\n');
    return 0;
  }

  try {
    const raw = await readFile(logFile, 'utf-8');
    const lines = raw.split(/\r?\n/);
    // splitlines 会去掉末尾换行产生的空串；split(/\r?\n/) 在末尾换行时产生空串，
    // 过滤掉末尾空串以对齐 Python splitlines 行为。
    if (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }
    const tailLines = lines.slice(-n);
    for (const line of tailLines) {
      process.stdout.write(`${line}\n`);
    }
    return 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`Error reading log file: ${msg}\n`);
    return 1;
  }
}

// ── 入口（ESM 顶层调用）─────────────────────────────────────────────────────

/**
 * main 入口。捕获所有异常转退出码。
 *
 * commander parseAsync 处理未知命令/参数错误时自身会 process.exit，
 * 外层 try/catch 处理业务逻辑抛出的异常。
 */
async function main(): Promise<void> {
  const program = createProgram();
  try {
    await program.parseAsync(process.argv);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
  }
}

// ESM 入口：直接被 node 执行时（dist/cli.js）启动 main。
// commander 内部 action async 完成后正常退出；异常时 process.exit。
// 用 void 忽略返回的 Promise（错误已在 main 内处理）。
void main();
