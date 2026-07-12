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
import { hostname } from 'node:os';

import {
  DEFAULT_CONFIG_DIR,
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig,
  configPathForServer,
} from './config.js';
import { HubClient } from './hub-client.js';
import { WorkspaceManager } from './workspace.js';
import { CredentialManager } from './credential.js';
import { TaskRunner } from './task-runner.js';
import { Daemon } from './daemon.js';
// 2026-06-24-daemon-network-resilience task-13/15：网络层重试编排注入。
import { ResilienceService } from './resilience/service.js';
import type { ResilienceLogger } from './resilience/service.js';
import { FileOutbox } from './resilience/outbox.js';
import { ClaudeSdkDriver } from './interactive/claude-sdk-driver.js';
import { CodexAppServerDriver } from './interactive/codex-app-server-driver.js';
import { SessionManager } from './interactive/session-manager.js';
import { JsonSessionPersistence } from './interactive/session-store-persistence.js';
import { DAEMON_VERSION } from './daemon-version.js';
import { RuntimeLockManager } from './runtime-lock.js';
// task-11（design §5）：Filesystem Policy Engine 三件套，cli 生产装配注入 Daemon。
import { PolicyCache } from './policy/runtime-policy.js';
import { AuditSink } from './policy/audit-sink.js';
import type { AuditBatchSender, AuditEvent } from './policy/audit-sink.js';
import { PolicyEngine } from './policy/filesystem-policy.js';
import type { SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
// task-06（D-007@v2）：主 agent MCP tool 注入。buildDaemonMcpServerConfig 构造
// daemon 内置 MCP server 配置（command=node + args=[dist/mcp-server.js] + env），
// mergeMcpConfigs 合并 platform_default + daemon MCP server。injectMcpConfig 写
// 临时 .mcp.json 供 spawn --mcp-config；但 Claude SDK 经 options.mcpServers 直接
// 注入（不走 --mcp-config 文件），故此处只用 buildDaemonMcpServerConfig + merge。
import {
  buildDaemonMcpServerConfig,
  DAEMON_MCP_SERVER_NAME,
  mergeMcpConfigs,
} from './mcp-config.js';
import type { McpServerConfigForDriver } from './interactive/driver.js';

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
 *
 * 2026-07-03-daemon-entity-binding task-04（D-001）：签名从 `loadConfigFn(path)`
 * 改为 `loadConfigFn(server_url)`。配置文件路径现由 server_url 驱动
 * （`configPathForServer` → `config-<sha256[0:8]>.json`），每个后端地址独立配置
 * 文件 + 独立 daemon_local_id。
 *
 * 默认委托 config.ts 的 loadConfig。
 *
 * @param server_url daemon 连接的后端地址（决定 per-server 配置文件名）。
 */
export async function loadConfigFn(server_url: string): Promise<ReturnType<typeof loadConfig>> {
  return loadConfig(server_url);
}

/**
 * 保存配置的包装函数。task-22 可 spy 拦截文件写入。
 *
 * 2026-07-03-daemon-entity-binding task-04（D-001）：第二参数从 `path` 改为
 * `server_url`，与 loadConfigFn 对称——配置文件路径由 server_url 驱动
 * （configPathForServer）。落盘到 per-server 文件，保证下次同 server 启动复用。
 *
 * @param config    要保存的配置对象。
 * @param server_url daemon 连接的后端地址（决定 per-server 文件名）。
 */
export async function saveConfigFn(
  config: Parameters<typeof saveConfig>[0],
  server_url: string,
): Promise<void> {
  await saveConfig(config, configPathForServer(server_url));
}

// ── 辅助函数（对齐 Python _read_pid / _is_process_alive / _write_pid / _remove_pid）──

/**
 * 2026-06-24-daemon-network-resilience task-13：ResilienceService 用的最小 logger。
 *
 * cli 层无 daemon 的 createLogger（daemon 内部私有），这里构造一个轻量 logger 走 stderr，
 * 让 ResilienceService 的 submit_enqueued_to_outbox / submit_exhausted_no_outbox 等
 * 事件可观测。daemon 自身的 createLogger 未对 ResilienceService 开放注入（避免循环依赖），
 * 故 cli 侧独立提供。
 */
function cliResilienceLogger(): ResilienceLogger {
  const write = (level: 'info' | 'warn' | 'error', event: string, kv?: Record<string, unknown>): void => {
    const parts = kv ? Object.entries(kv).map(([k, v]) => `${k}=${v instanceof Error ? v.message : typeof v === 'object' ? JSON.stringify(v) : String(v)}`) : [];
    process.stderr.write(`[resilience.${event}] ${parts.join(' ')}\n`);
  };
  return {
    info: (e, kv) => write('info', e, kv),
    warn: (e, kv) => write('warn', e, kv),
    error: (e, kv) => write('error', e, kv),
  };
}

/**
 * task-11（design §5.1.5）：构造 Audit 批量上报的 AuditBatchSender 适配器。
 *
 * AuditSink 通过依赖倒置的 {@link AuditBatchSender} 接口上报，不硬耦合 HubClient。
 * 本函数把「POST 到 `${serverUrl}/api/daemon/audit/batch`」包装成该接口的实现：
 *   - 路径前缀 `/api/daemon`（REST_PREFIX，daemon module 专用），对齐 design 表 §7.2
 *     `POST /daemon/audit/batch`（= `/api/daemon/audit/batch`）；
 *   - 鉴权用 daemon 级凭证（X-API-Key 优先，回退 Bearer token），与 register/heartbeat
 *     同级——audit 端点目前按 daemon runtime 鉴权（claim_token 级鉴权属后续 backend
 *     任务范畴，装配期不持有 lease token，故用 daemon 级凭证）；
 *   - 复用 hub-client.ts 的原生 fetch 风格：Node 原生 fetch 默认不读 HTTP_PROXY
 *     （等价 Python httpx trust_env=False），AbortSignal.timeout 30s，非 2xx 抛 Error。
 *
 * 失败语义：网络/超时/非 2xx 均 reject（由 AuditSink.sendWithRetry 指数退避重试、
 * 重试耗尽降级落盘 jsonl，见 audit-sink.ts）。本适配器只负责「发一次」，不重试。
 *
 * @param serverUrl backend origin，如 'http://localhost:8000'（尾部斜杠容错）
 * @param apiKey    daemon X-API-Key 凭证（可选）
 * @param token     daemon Bearer token 凭证（apiKey 缺失时回退）
 */
function makeAuditSender(
  serverUrl: string,
  apiKey?: string,
  token?: string,
): AuditBatchSender {
  // 对齐 hub-client.ts constructor 的去尾斜杠处理，避免 `${base}/api/...` 双斜杠。
  const baseUrl = serverUrl.replace(/\/+$/, '');
  const url = `${baseUrl}/api/daemon/audit/batch`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  } else if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return {
    async postBatch(events: AuditEvent[]): Promise<void> {
      // 按 runtimeId 分组（backend AuditBatchRequest 单 runtime_id），
      // 并去掉每事件的 runtimeId 字段（backend AuditEventIn extra=forbid 不接收）。
      const groups = new Map<string, Omit<AuditEvent, "runtimeId">[]>();
      for (const ev of events) {
        const { runtimeId, ...rest } = ev;
        const arr = groups.get(runtimeId) ?? [];
        arr.push(rest);
        groups.set(runtimeId, arr);
      }
      for (const [rid, evs] of groups) {
        const resp = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({ runtime_id: rid, events: evs }),
          signal: AbortSignal.timeout(30_000),
          // Node 原生 fetch 默认不读 HTTP_PROXY/HTTPS_PROXY（等价 trust_env=False）。
        });
        if (!resp.ok) {
          const bodyText = await resp.text().catch(() => "");
          throw new Error(
            `audit_batch_failed status=${resp.status} body=${bodyText.slice(0, 200)}`,
          );
        }
      }
    },
  };
}

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
    .version(DAEMON_VERSION);

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
    // ql-20260624-006：强制回收 stale/corrupt runtime lock（不强杀活跃 daemon 进程）。
    .option('--force', 'Force reclaim a stale or corrupt runtime lock before start (never kills a live daemon)')
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
  // ql-20260624-006：强制回收 stale/corrupt runtime lock。commander --force 存为 force。
  force?: boolean;
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
  // config.ts 是函数式 loadConfig(server_url)，返回 DaemonConfig 纯对象（非 class 实例）。
  //
  // 2026-07-03-daemon-entity-binding task-04（D-001）：配置文件路径现由 server_url 驱动
  //（configPathForServer → config-<sha256[0:8]>.json），故 loadConfig 前必须先确定
  // server_url。来源优先级：CLI --server 参数 > DEFAULT_CONFIG.server_url（兜底默认
  // http://localhost:8000）。注意此处 server_url 仅用于定位 per-server 文件；
  // 后续 opts.server 仍会覆盖 config.server_url 字段并落盘，保证持久化值与定位一致。
  //（用户首次用 --server A 启动 → 写入 config-<hashA>.json，server_url=A；下次同命令
  // 启动 opts.server=A 与 per-server 文件内 server_url 一致，无歧义。）
  const serverUrl = opts.server ?? DEFAULT_CONFIG.server_url;
  const config = { ...(await loadConfigFn(serverUrl)) };

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
  // 2026-07-03-daemon-entity-binding task-04：落盘到 per-server 文件
  //（configPathForServer(config.server_url)）。用 config.server_url（已被
  // opts.server 覆盖后的最终值）而非 serverUrl，确保 opts.server 改了 server
  // 时落盘到新 server 的 per-server 文件（与 loadConfigFn 定位一致）。
  await saveConfigFn(config, config.server_url);

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
  // 2026-06-24-daemon-network-resilience task-13/15：构造 Outbox（落盘 JSONL）+
  // ResilienceService 注入 TaskRunner（batch submit 重试）+ Daemon（interactive submit
  // 重试 + 终态轻量重试 + drain 补发）。outboxDir 同源 ~/.sillyhub/daemon/。
  const outbox = new FileOutbox(
    join(DEFAULT_CONFIG_DIR, 'outbox'),
    { maxPerRun: config.outbox_max_per_run, maxTotal: config.outbox_max_total },
    cliResilienceLogger(),
  );
  // outbox.load 恢复 daemon 重启前的 pending（FR-09），失败不阻断启动。
  await outbox.load().catch((e) => {
    process.stderr.write(`[resilience.outbox_load_failed] ${(e as Error)?.message ?? e}\n`);
  });
  // W3 v1 取舍：validity 校验传 null——drain 不做 lease/session 终态预校验，靠 backend
  // submit_messages 的 dedup_key 幂等（task-21 ON CONFLICT）兜底重复提交。终态预校验
  // 是优化（避免无谓补发请求），非正确性必需；后续可接 daemon 的 lease/session 查询。
  const resilience = new ResilienceService(client, outbox, {
    maxAttempts: config.retry_max_attempts,
    baseDelayMs: config.retry_base_delay_ms,
    backoffFactor: config.retry_backoff_factor,
    jitter: config.retry_jitter,
  }, cliResilienceLogger(), null);
  // task-16：TaskRunner 创建推迟到 policyCache 之后（共享同一 PolicyCache 实例，
  // 注入到 TaskRunner constructor 第 6 位参数）。原位置（policyCache 未创建）改为此注释占位。
  // const taskRunner = new TaskRunner(client, workspaceMgr, credentialMgr, config, resilience);

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
  // task-06（D-001@v1）：注册 provider driver registry。claude + codex 两个 driver
  // 由 SessionManager 按 session.provider 选取（task-02 _getDriver 路由）。Codex
  // app-server driver 无状态（不持有 child；句柄以 CodexHandle 形式由 SessionManager
  // 持有），可安全单例注入。
  const codexDriver = new CodexAppServerDriver();
  // gap-8.3（design §11）：interactive session 持久化 + daemon 重启恢复。
  // JsonSessionPersistence 默认写 ~/.sillyhub/daemon/sessions.json；SessionManager
  // 状态变更排队 flush（_scheduleFlush），daemon 重启时 _recoverSessionsOnBoot
  // 加载并经 restoreAndReconnect（driver resume）恢复。
  const persistence = new JsonSessionPersistence();
  // task-11（design §5）：Filesystem Policy Engine 三件套装配。
  // 构造顺序：cache → auditSink → engine（PolicyEngine 依赖前两者）。
  //   - PolicyCache：纯内存，由 daemon 心跳 _syncAllowedRoots + WS POLICY_UPDATE 维护
  //     （task-12 接入）；
  //   - AuditSink：注入 makeAuditSender 适配器（POST /api/daemon/audit/batch），失败
  //     指数退避重试 + 落盘降级（audit-sink.ts 内部处理）；
  //   - PolicyEngine：消费 cache + auditSink，task-14（interactive canUseTool）接入，
  //     task-12 ~ task-18 接入其余 tool。
  // **task-14**：装配提前到 SessionManager 之前（policyEngine 引用注入 SessionManager，
  // 让 interactive 写守卫走 PolicyEngine.canWrite）。三者 additive，Daemon 行为不变。
  const policyCache = new PolicyCache();
  const auditSink = new AuditSink(
    makeAuditSender(
      config.server_url,
      config.api_key ?? undefined,
      config.token ?? undefined,
    ),
  );
  const policyEngine = new PolicyEngine(policyCache, auditSink);
  let daemon: Daemon;
  const sessionManager = new SessionManager(
    {
      // task-06（D-001@v1）：显式 drivers registry（claude + codex）。task-02 保留
      // 旧 `driver` 兼容入口（构造函数内映射到 drivers.claude），但因 SessionManagerDeps
      // 仍标 driver 必填（task-01 遗留，types.ts 不在本任务 allowed_paths），此处同时
      // 传 driver（=claude driver）满足类型 + drivers registry 覆盖两 provider。
      driver,
      drivers: { claude: driver, codex: codexDriver },
      persistence,
      // task-02/06：回调类型放宽为联合（SDKResultMessage | InteractiveDriverResult
      // / SDKMessage | InteractiveDriverMessage）。design §5.4.4 要求两种 provider
      // 的消息都透传给 daemon.onTurnResult/onTurnMessage（daemon 按 provider 解释）：
      //   - Claude SDK raw：result.type==='result' / msg.type 为字符串（assistant/user/...）
      //   - Codex flat：{event_type, content, metadata, session_id}（无 type 字段，
      //     有 event_type 字段；result 为 {subtype, is_error, ...}）
      // 守卫放开：SDK 形态（有 type）或 Codex flat 形态（有 event_type / 无 type 但
      // 是 object）都透传，让 daemon.onTurnMessage 内 duck-typing 统一处理。
      onTurnResult: (sessionId, runId, result) => {
        if (!result || typeof result !== 'object') return;
        // Claude SDK result 带 type='result'；Codex driver result（subtype/is_error
        // flat）无 type 但有 subtype。两者都透传，daemon.onTurnResult 内按字段提取。
        void daemon.onTurnResult(sessionId, runId, result as SDKResultMessage);
      },
      onTurnMessage: (sessionId, runId, msg) => {
        if (!msg || typeof msg !== 'object') return;
        // Claude SDK msg 有 type 字符串；Codex flat msg 有 event_type 字符串。
        // 都透传，daemon.onTurnMessage 内 duck-typing（type==='assistant' 提 usage；
        // 其余原样 submitMessages，backend 按 event_type/content 展开）。
        void daemon.onTurnMessage(sessionId, runId, msg as SDKMessage);
      },
      onSessionEnd: (sessionId, status) => daemon.onSessionEnd(sessionId, status),
    },
    {
      // scan 真阻塞（改造点 C）：实例级 manualApproval=true 仅表示「能力就绪」
      //（resolverFactory 自动每 session 一个 + wsClient 注入）；具体 session 是否注入
      // canUseTool 由 create input.manualApproval 决定（chat=false 不注入，scan=true 注入）。
      manualApproval: true,
      permissionWsClient: {
        // 闭包延迟绑定 daemon（daemon 在下方 new Daemon 后赋值，与 onTurnResult 同模式）；
        // sendToHub 用首个已注册 runtime 的 WsClient 发 PERMISSION_REQUEST 到 backend。
        send: (msg) => daemon.sendToHub(msg),
      },
      // onUserDialog（SDK request_user_dialog / AskUserQuestion 真实路由路径）：
      // 声明 AskUserQuestion 走对话回调而非 canUseTool——canUseTool 只能 allow/deny
      // 无法回传用户选择，导致 'user did not answer the questions'。supportedDialogKinds
      // 非空 + onUserDialog 注入（SessionManager.create 在 manualApproval=true 时自动注入）
      // 后，AskUserQuestion 的 questions 经 PERMISSION_REQUEST（带 dialog_kind/dialog_payload）
      // 发到前端，用户选择的答案经 PERMISSION_RESPONSE.dialog_result 回喂 SDK。
      supportedDialogKinds: ['AskUserQuestion'],
      // interactive CC 写拦截（2026-06-29）+ task-14（design §5.2 PolicyEngine）：
      // 注入 policyEngine 引用，让 SessionManager 的写守卫改调
      // `policyEngine.canWrite(runtimeId, path, provider, tool)`（按 runtime_id 隔离 +
      // 统一中文 deny 文案 + audit）。runtimeIdProvider 按 provider 查注册 runtime
      // （ql-20260703-002：原取 config.runtime_id 致 PolicyCache 永久 miss，配
      // allowed_roots 后 interactive session 仍 deny；改 daemon.resolveRuntimeId
      // (provider) 对齐心跳 _syncAllowedRoots 按 _registeredRuntimes 存的 rid）。
      policyEngine,
      runtimeIdProvider: (provider: string) => daemon?.resolveRuntimeId(provider) ?? '',
      // task-06（D-007@v2 / R-01）：主 agent（role=orchestrator）MCP tool 注入。
      //
      // isMainAgentSession：读 ctx.stage判定本 session 是否 team 主 agent
      //（backend orchestrator.py:162 dispatch_to_daemon(stage='orchestrator') →
      // lease.metadata.stage → daemon execPayload.stage → CreateSessionInput.stage →
      // MainAgentMcpContext.stage）。普通 scan/stage/chat session stage 未传或非
      // 'orchestrator' → 不注入（零回归）。
      //
      // mainAgentMcpConfigProvider：构造主 agent spawn 时要注入的 MCP server 配置表。
      // 用 buildDaemonMcpServerConfig 构造 daemon 内置 MCP server（command=node +
      // args=[dist/mcp-server.js] + env={MCP_SERVER_BACKEND_URL, MCP_SERVER_DAEMON_TOKEN}），
      // 经 mergeMcpConfigs 与空 platform_default 合并（白名单自动加入 DAEMON_MCP_SERVER_NAME，
      // 见 mcp-config.ts:188）。返回 ``{ [DAEMON_MCP_SERVER_NAME]: config }`` 单 server 表，
      // SessionManager 透传到 driverOpts.mcpServers → ClaudeSdkDriver.start 写入
      // SDK options.mcpServers → 主 agent discover 5 tool。
      //
      // **token 来源（task-09 P0 闭合）**：task-06 用 daemon apiKey（config.api_key
      // 优先，回落 config.token）但旧实现经 MCP_SERVER_DAEMON_TOKEN 单 env 把 apiKey
      // 当 Bearer 发——backend get_current_principal Bearer 路径只解 JWT，apiKey 非
      // JWT → 401（task-06 留的端到端阻塞）。task-09 把 apiKey / token 分开透传
      // （MCP_SERVER_DAEMON_API_KEY + MCP_SERVER_DAEMON_TOKEN），mcp-server.ts 优先
      // X-API-Key 路径，backend get_current_principal 解析 apiKey → User →
      // has_permission(WORKSPACE_WRITE)，5 endpoint 链路通。
      isMainAgentSession: (ctx) => ctx.stage === 'orchestrator',
      mainAgentMcpConfigProvider: (ctx) => {
        // task-09 P0 鉴权 gap 闭合：apiKey（X-API-Key）与 token（Bearer）分开透传。
        // daemon apiKey 优先（config.api_key），回落 Bearer token（config.token）。
        // mcp-config.ts buildDaemonMcpServerConfig 把 apiKey 写 MCP_SERVER_DAEMON_API_KEY，
        // mcp-server.ts 优先 X-API-Key 路径——backend get_current_principal 解析 apiKey
        // → User → has_permission(WORKSPACE_WRITE)。旧实现把 apiKey 当 Bearer 发致 401。
        const mcpApiKey = config.api_key ?? '';
        const mcpToken = config.token ?? '';
        const daemonServer = buildDaemonMcpServerConfig(
          config.server_url,
          mcpToken,
          undefined,
          mcpApiKey || undefined,
        );
        // mergeMcpConfigs：空 platform_default + daemon server。daemon server 作为
        // configs[0]（platform 位）自动入白名单（mcp-config.ts:188），无需额外配白名单。
        const merged = mergeMcpConfigs([], {
          mcpServers: { [DAEMON_MCP_SERVER_NAME]: daemonServer },
        });
        // 转为 driver 契约类型（McpServerConfig → McpServerConfigForDriver，结构兼容）。
        const result: Record<string, McpServerConfigForDriver> = {};
        for (const [name, cfg] of Object.entries(merged.config.mcpServers)) {
          result[name] = {
            command: cfg.command,
            ...(cfg.args ? { args: cfg.args } : {}),
            ...(cfg.env ? { env: cfg.env } : {}),
          };
        }
        // provider/model 透传：ctx.model 含主 agent configured model（来自
        // CreateSessionInput.model），driver 已在 _buildDriverOptions 单独透传 model
        // 到 SDK options.model，此处 MCP 配置不需重复（MCP server 不读 model）。
        // ctx 仅作日志/未来扩展用（如 codex 主 agent 需不同 server 配置）。
        void ctx;
        return Object.keys(result).length > 0 ? result : undefined;
      },
    },
  );
  // gap-8（interactive 凭证 parity）：把同一 CredentialManager 传给 Daemon，让
  // interactive 路径经 buildSpawnEnv 读 credentials.json 的 ANTHROPIC token，与 batch 对齐。
  // gap-8.3：persistence + recoveryClient 接通 daemon 重启恢复。client（HubClient）
  // 已实现 RecoveryCoordinator（recoverSession/confirmReconnected/markRecoveryFailed）。
  // ql-20260624-006：runtime 单实例 lock（强制一 host+一 user+一 provider=一 daemon）。
  // lock 维度 provider+hostname+serverOrigin，与 backend runtime_id upsert key 对齐。
  const lockManager = new RuntimeLockManager({
    hostname: hostname(),
    serverOrigin: config.server_url,
    pid: process.pid,
    version: DAEMON_VERSION,
    force: opts.force === true,
  });
  // task-16：TaskRunner 注入 policyCache（per-runtime allowed_roots 数据源，D-002）。
  // task-17：TaskRunner 注入 policyEngine（batch Codex 带内审批决策 accept/decline，R-06）。
  // 与 Daemon 共享同一 PolicyCache/PolicyEngine 实例（由心跳 _syncAllowedRoots + WS POLICY_UPDATE 维护）。
  // **task-14**：policyCache/auditSink/policyEngine 装配已上移到 SessionManager 之前
  // （policyEngine 引用注入 SessionManager），此处直接复用，避免重复构造。
  const taskRunner = new TaskRunner(
    client,
    workspaceMgr,
    credentialMgr,
    config,
    resilience,
    policyCache,
    policyEngine,
  );
  daemon = new Daemon(config, client, taskRunner, {
    sessionManager,
    credentialManager: credentialMgr,
    persistence,
    recoveryClient: client,
    lockManager,
    resilience,
    policyCache,
    auditSink,
    policyEngine,
  });

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
  // 2026-07-03-daemon-entity-binding task-04：status 无 server 参数，读默认
  // per-server 文件（DEFAULT_CONFIG.server_url = http://localhost:8000）。
  // 若连过其他后端，该文件可能不存在 → 显示 unknown（不影响 PID/State 判断）。
  let config: { runtime_id: string; server_url: string } | null = null;
  try {
    config = await loadConfigFn(DEFAULT_CONFIG.server_url);
  } catch {
    // 配置加载失败（文件损坏/不存在等）→ 用占位值，不中断 status 输出
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

// 生产稳定性：三循环（heartbeat/poll/ws）fire-and-forget 的 async 若抛未捕获
// rejection，Node 默认 --unhandled-rejections=throw 会让 daemon 静默 exit 1（仅留
// heartbeat_failed 等 warn，无崩溃栈，难定位）。
// task-03（FR-02 / D-006）：handler 吞事件保活——结构化 FATAL 日志（含 message+
// stack+cause）供运维 grep 定位，绝不 process.exit（进程保活优先）。handler 自身
// 容错：所有写日志包 try/catch，stderr 不可用时 fallback 原始字符串，绝不让 handler
// 抛出。SIGINT/SIGTERM 仍走下方 process.exit(130) 不受影响。
function logFatal(kind: string, payload: unknown): void {
  try {
    const err = payload instanceof Error ? payload : new Error(String(payload));
    const cause = (err as Error & { cause?: unknown }).cause;
    const parts = [`[FATAL ${kind}] ${err.message}`];
    if (err.stack) parts.push(err.stack);
    if (cause !== undefined) {
      parts.push(`cause: ${JSON.stringify(cause)}`);
    }
    parts.push(`daemon 保活：已吞未捕获 ${kind}，进程不退出。`);
    process.stderr.write(`${parts.join('\n')}\n`);
  } catch {
    try {
      process.stderr.write(`[FATAL ${kind}] ${String(payload)}\n`);
    } catch {
      /* noop：stderr 不可用时彻底放弃，绝不抛出 */
    }
  }
}

process.on('unhandledRejection', (reason) => {
  logFatal('unhandledRejection', reason);
});
process.on('uncaughtException', (err) => {
  logFatal('uncaughtException', err);
});
void main();
