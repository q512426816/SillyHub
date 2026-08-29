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
import { readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { hostname } from 'node:os';

import {
  DEFAULT_CONFIG_DIR,
  CLAUDE_CONFIG_DIR,
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig,
  configPathForServer,
} from './config.js';
import { HubClient } from './hub-client.js';
import { WorkspaceManager } from './workspace.js';
import { CredentialManager } from './credential.js';
import { TaskRunner, mapDetectedToSillyspecTools } from './task-runner.js';
import { Daemon } from './daemon.js';
// task-03（2026-08-29-daemon-selfupdate-safety S3）：status 追加 pending 升级等待行。
import { readPendingUpdateFile } from './daemon.js';
// task-06（FR-04/D-007@v1）：构造 TaskRunner 前独立探测 agent CLI（映射 sillyspec --tool）。
import { AgentDetector } from './agent-detector.js';
// 2026-06-24-daemon-network-resilience task-13/15：网络层重试编排注入。
import { ResilienceService } from './resilience/service.js';
import type { ResilienceLogger } from './resilience/service.js';
import { FileOutbox } from './resilience/outbox.js';
import { ClaudeSdkDriver } from './interactive/claude-sdk-driver.js';
import { CodexAppServerDriver } from './interactive/codex-app-server-driver.js';
import { SessionManager } from './interactive/session-manager.js';
import type { SessionEventForBackend } from './interactive/types.js';
import { JsonSessionPersistence } from './interactive/session-store-persistence.js';
import { DAEMON_VERSION } from './daemon-version.js';
import { RuntimeLockManager } from './runtime-lock.js';
// task-11（design §5）：Filesystem Policy Engine 三件套，cli 生产装配注入 Daemon。
import { PolicyCache } from './policy/runtime-policy.js';
import { AuditSink } from './policy/audit-sink.js';
import type { AuditBatchSender, AuditEvent } from './policy/audit-sink.js';
import { PolicyEngine } from './policy/filesystem-policy.js';
// task-04（security-audit-remediation / Grill M-2）：daemon apiKey 注入 injector。
import { setDaemonApiKey } from './credential-injector.js';
import { performCleanup } from './cleanup.js';
import type { SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
// task-06（D-007@v2）：主 agent MCP tool 注入。buildDaemonMcpServerConfig 构造
// daemon 内置 MCP server 配置（command=node + args=[dist/mcp-server.js] + env），
// mergeMcpConfigs 合并 platform_default + daemon MCP server。injectMcpConfig 写
// 临时 .mcp.json 供 spawn --mcp-config；但 Claude SDK 经 options.mcpServers 直接
// 注入（不走 --mcp-config 文件），故此处只用 buildDaemonMcpServerConfig + merge。
// task-07（2026-08-26-workspace-mcp-edit）：合并源升格三件套（platform + workspace
// + 内置双 server），见 mainAgentMcpConfigProvider 注释块。
import {
  buildDaemonMcpServerConfig,
  buildFileMcpServerConfig,
  buildWorkerMcpServerConfig,
  DAEMON_MCP_SERVER_NAME,
  FILE_MCP_SERVER_NAME,
  mergeMcpConfigs,
  WORKER_MCP_SERVER_NAME,
} from './mcp-config.js';
// task-07（2026-08-26-workspace-mcp-edit / D-007@v2）：会话级 MCP 三件套缓存类型 +
// merge 返回类型（rejected warn 用）。
import type { McpBundle, MergedMcpResult } from './mcp-config.js';
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
  const write = (_level: 'info' | 'warn' | 'error', event: string, kv?: Record<string, unknown>): void => {
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
  // ql-20260726-002-1180：确保 claude 隔离配置目录存在（spawn-env 注入 CLAUDE_CONFIG_DIR，
  // daemon spawn claude 时 claude 读此目录而非宿主机 ~/.claude，避免 cc-switch 污染）。
  await mkdir(CLAUDE_CONFIG_DIR, { recursive: true });
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

  // ── clean ────────────────────────────────────────────────────────────────

  program
    .command('clean')
    .description('清理 daemon 本地缓存（specs / 会话日志 / 备份 / 日志文件）。')
    .option('--dry', '仅统计不删除（预览释放空间）')
    .action(async (opts: { dry?: boolean }) => {
      const code = await cleanAction(opts);
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
  // task-01（FR-01 / D-001@v1）：进程入口尽早取启动时间戳（epoch ms）。
  // 整个 daemon 生命周期内恒定；register/heartbeat 上报给 backend 作为
  // daemon_instances.started_at 的真实来源（cli.ts 入口取，非 daemon 循环内）。
  const processStartTime = Date.now();
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

  // task-04（security-audit-remediation / Grill M-2）：把 daemon 自身 apiKey 注入
  // injector 的进程级状态——litellm_proxy 形态下（master key 不再下发）injector 据此
  // 注 ANTHROPIC_AUTH_TOKEN，子进程 Bearer 打 hub 代理 /api/daemon/llm-proxy。
  // 只进内存（模块级变量 → spawn env），不落日志 / 配置文件。token 模式（无 apiKey）
  // 传 null → proxy 形态退化不写 AUTH_TOKEN 键。
  setDaemonApiKey(config.api_key);

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
  // task-07（2026-08-26-workspace-mcp-edit / design §5 Wave2 第 5 条 / D-007@v2）：
  // 会话级 MCP 三件套缓存（Map<sessionId, McpBundle>）。cli 装配处创建、同一引用
  // 两头共享——daemon._startInteractiveSession 按 execPayload.workspaceId 预取
  // fetchMcpBundle 写入（经 DaemonOptions.mcpBundleCache 注入）；下方
  // mainAgentMcpConfigProvider 同步读（provider 同步签名不能 await，只能读缓存）。
  // 生命周期=会话（daemon.onSessionEnd 清理，create 失败 catch 兜底删）。
  // 放 cli 装配处而非 daemon.ts 模块级单例：daemon 与 provider 共享引用经构造
  // 注入显式化（无跨模块可变全局态）；tests 对 daemon.js 的 vi.mock 工厂只导出
  // Daemon，provider 读本 Map 不依赖 daemon.js 运行时导出（mock 下依旧可用）。
  const mcpBundleBySession = new Map<string, McpBundle>();
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
      // task-04（FR-01~03）：session 反馈事件桥接 → HubClient 对应 notify 方法。
      // 失败仅日志不阻塞；字段从 camelCase event 映射为 snake_case body。
      // ql-20260827-007：后台任务终态自动唤醒——session-manager debounce 合并后
      // 经 hubClient 注入唤醒消息（失败仅日志，session-manager 侧已 catch）。
      onTaskWakeupInject: async (sessionId, prompt) => {
        await client.injectSessionPrompt(sessionId, prompt);
      },
      onSessionEvent: (sessionId, runId, event: SessionEventForBackend) => {
        void (async () => {
          try {
            switch (event.kind) {
              case 'plan_mode_entered':
                await client.notifyPlanModeEntered(sessionId, runId, event.summary);
                break;
              case 'bash_status':
                await client.notifyBashStatus(
                  sessionId,
                  runId,
                  event.command,
                  event.status,
                  event.exit_code,
                  event.elapsed_ms,
                );
                break;
              case 'bash_chunk':
                await client.notifyBashChunk(
                  sessionId,
                  runId,
                  event.command,
                  event.channel,
                  event.content,
                  event.is_final,
                );
                break;
              case 'agent_task_status':
                await client.notifyAgentTaskStatus(
                  sessionId,
                  runId,
                  event.task_id,
                  event.task_name,
                  event.status,
                  event.progress,
                  event.message,
                  // task-02（2026-08-27-background-subagent-progress / design §8）：
                  // 扩展可选字段并入上报 body（字段名 snake_case 直通零映射；
                  // undefined 由 hub-client 守卫剔除，不进 body —— 向后兼容）。
                  {
                    tool_use_id: event.tool_use_id,
                    summary: event.summary,
                    last_tool_name: event.last_tool_name,
                    elapsed_ms: event.elapsed_ms,
                    total_tokens: event.total_tokens,
                    tool_uses: event.tool_uses,
                    async: event.async,
                  },
                );
                break;
              default:
                // 其它 kind 不上报（约束：仅 plan/bash/agent_task）。
                break;
            }
          } catch (e) {
            // eslint-disable-next-line no-console
            console.error('[cli] onSessionEvent notify failed', {
              sessionId,
              runId,
              kind: event.kind,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        })();
      },
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
      // task-06（D-007@v2 / R-01）→ task-09 放宽（D-002@v2，2026-08-22-team-session-unify）：
      // Claude 会话常驻注入 5 工具。
      //
      // isMainAgentSession：读 ctx.provider + ctx.stage 判定本 session 是否注入
      // 主 agent MCP tool。链路：backend 写 lease.metadata.stage → daemon claim
      // payload stage（lease/context.py:479）→ execPayload.stage（daemon.ts:3760）
      // → CreateSessionInput.stage → MainAgentMcpContext.stage → 本谓词。判据
      // （design §5 Phase 2）：
      //   - provider=claude 且 stage ∈ {undefined/null/''，'orchestrator'} → true：
      //     普通 Claude 会话不传 stage（常驻注入）；存量 external 主控
      //     stage='orchestrator'（orchestrator.py dispatch_to_daemon）照常注入。
      //   - provider=claude 且 stage='mission_worker'（backend execution.py
      //     MISSION_WORKER_STAGE 常量派发）→ false：分身不进主控分支（防 worker
      //     递归派发与 converge 干扰，审查 CC-12）——但改走下方 isWorkerSession
      //     分支注入受限 server（task-06 2026-08-25-team-subsession-governance
      //     / D-003@v1，谓词三态化：普通 / 主控 / 分身）；其它非空 stage 值不注入。
      //   - provider=codex → 一律 false（D-003@v1：团队需要 Claude 引擎，codex
      //     不消费 mcpServers，另立后续变更）。
      //
      // mainAgentMcpConfigProvider：构造主 agent spawn 时要注入的 MCP server 配置表。
      // task-07（2026-08-26-workspace-mcp-edit）起为三件套合并注入：读会话级缓存
      // bundle（daemon.ts _startInteractiveSession 按 workspaceId 预取写入，上方
      // mcpBundleBySession 同一引用），mergeMcpConfigs 按 platform < workspace < 内置
      // 优先级合并（同名后者覆盖前者，D-006@v2）；内置双 server（sillyhub-daemon 编排
      // 5 tool + task-06 sillyhub-file 上传 2 tool）名并入白名单参数。SessionManager
      // 透传到 driverOpts.mcpServers → ClaudeSdkDriver.start 写入 SDK options.mcpServers
      // → 主 agent discover 全部 MCP tool。缓存 miss（quick-chat 无 workspaceId /
      // daemon 重启 restore 内存缓存丢失）→ 回落空 bundle，行为与 task-06 现状一致。
      //
      // **token 来源（task-09 P0 闭合）**：task-06 用 daemon apiKey（config.api_key
      // 优先，回落 config.token）但旧实现经 MCP_SERVER_DAEMON_TOKEN 单 env 把 apiKey
      // 当 Bearer 发——backend get_current_principal Bearer 路径只解 JWT，apiKey 非
      // JWT → 401（task-06 留的端到端阻塞）。task-09 把 apiKey / token 分开透传
      // （MCP_SERVER_DAEMON_API_KEY + MCP_SERVER_DAEMON_TOKEN），mcp-server.ts 优先
      // X-API-Key 路径，backend get_current_principal 解析 apiKey → User →
      // has_permission(WORKSPACE_WRITE)，5 endpoint 链路通。
      isMainAgentSession: (ctx) => {
        if (ctx.provider !== 'claude') return false;
        const stage = ctx.stage ?? '';
        return stage === '' || stage === 'orchestrator';
      },
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
        // task-06（2026-08-23-agent-file-upload-mcp / FR-02 / D-002@v1）：并列构造
        // sillyhub-file server（upload_file / list_uploaded_files，mcp-server file 模式）。
        // allowedRoot=ctx.cwd（会话场景工作目录，design §7.1：会话=cwd）；sessionId 不在
        // 此拼——session-manager _resolveMainAgentMcp 在 provider 返回后按 ctx.sessionId
        // 统一补写（浅拷贝语义，不污染本闭包持有的配置）。
        const fileServer = buildFileMcpServerConfig(
          config.server_url,
          { token: mcpToken, apiKey: mcpApiKey || undefined },
          { allowedRoot: ctx.cwd },
        );
        // task-07（2026-08-26-workspace-mcp-edit / D-007@v2）：读会话级缓存 bundle。
        // daemon.ts _startInteractiveSession 在 create（本 provider 被调）前按
        // workspaceId await fetchMcpBundle 写入缓存。缓存 miss 两源：① quick-chat/
        // legacy shared 无 workspaceId 未预取（预期常态）；② daemon 重启 restore
        // 内存缓存丢失（provider 同步签名不能重取，且 PersistedSessionRecord /
        // SESSION_RESUME payload 均不携带 workspaceId，无从重取——后续增强点：restore
        // 链路补 workspace 下发 + 异步重取供下次 reload 用，D-007@v2 完整形态）。
        // 回落空 bundle（platform/workspace 全空、白名单 []）= 行为与现状一致。
        const bundle = mcpBundleBySession.get(ctx.sessionId);
        if (!bundle) {
          // eslint-disable-next-line no-console
          console.warn('[cli] mcp_bundle_cache_miss', {
            sessionId: ctx.sessionId,
            fallback: 'empty_bundle',
          });
        }
        const platformCfg = bundle?.platform ?? { mcpServers: {} };
        const workspaceCfg = bundle?.workspace ?? { mcpServers: {} };
        const bundleWhitelist = bundle?.whitelist ?? [];
        // 内置双 server 固定进最后一个 config 位（优先级最高，防被 workspace 同名
        // 覆盖，D-006@v2）。
        const builtinConfig = {
          mcpServers: {
            [DAEMON_MCP_SERVER_NAME]: daemonServer,
            [FILE_MCP_SERVER_NAME]: fileServer,
          },
        };
        // mergeMcpConfigs：[platform, workspace, 内置] 依次合并（后者覆盖前者）。
        // **内置名必须并入白名单参数**（D-006@v2 / Grill CC-02）：mergeMcpConfigs
        // 只把 configs[0]（platform 位）的 server 名自动入白名单，内置在第 3 个
        // config 位不会被自动放行——不并入会被白名单剔除、破坏既有注入链。
        // platform 位的 server 仍走 configs[0] 自动白名单（既有语义不变）。
        // 防御 catch（R-03）：platform 配置未经 task-05 预净化（只有 workspace 维度
        // 有非 stdio 预净化），混入非 stdio 条目时 assertMcpServerType 抛错——回落
        // 仅内置双 server（= task-06 现状行为），绝不阻塞会话创建。
        let merged: MergedMcpResult;
        try {
          merged = mergeMcpConfigs(
            [...bundleWhitelist, DAEMON_MCP_SERVER_NAME, FILE_MCP_SERVER_NAME],
            platformCfg,
            workspaceCfg,
            builtinConfig,
          );
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[cli] mcp_merge_failed_fallback_builtin', {
            sessionId: ctx.sessionId,
            error: e instanceof Error ? e.message : String(e),
          });
          merged = mergeMcpConfigs(
            [DAEMON_MCP_SERVER_NAME, FILE_MCP_SERVER_NAME],
            builtinConfig,
          );
        }
        // 白名单外的 server（workspace 配了但 admin 未放行）被剔除 → rejected 记
        // warn（R-05 可观测：不静默丢弃，前端提示文案配合见 design §7.4）。
        if (merged.rejected.length > 0) {
          // eslint-disable-next-line no-console
          console.warn('[cli] mcp_servers_rejected_by_whitelist', {
            sessionId: ctx.sessionId,
            rejected: merged.rejected,
          });
        }
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
        // ctx 现读 cwd（sillyhub-file allowedRoot，task-06）+ sessionId（task-07 会话
        // 级缓存 key）；其余字段留未来扩展。
        return Object.keys(result).length > 0 ? result : undefined;
      },
      // task-06（2026-08-25-team-subsession-governance / FR-03 / D-003@v1，design
      // §5.C.1）：分身受限 MCP 注入——谓词三态化的第三态。stage=mission_worker 的
      // 会话不进主控 5 工具 server（isMainAgentSession 对其返回 false，递归闸），
      // 改注入 sillyhub-worker server。task-05（2026-08-26-team-subsession-
      // recursion / D-002@v1，design §5.C）起该 server 按分身深度两档：非叶
      // （worker_depth<MAX_DISPATCH_DEPTH）派工集 5 件、叶仅 worker_done。
      //
      // isWorkerSession：provider=claude 且 stage='mission_worker'（codex 不注入，
      // 对齐主控谓词口径；判据不变——stage 三态化结构不动，worker_depth 只影响
      // 工具集档位不影响谓词）。判定发生在 session-manager _resolveMainAgentMcp 分身
      // 分支（优先于主控谓词），create / restore / reload 三路共用点生效。
      //
      // workerMcpConfigProvider：buildWorkerMcpServerConfig 组装受限条目（env
      // MCP_TOOLSET=mission_worker + backend URL + apiKey 优先 token 回落，鉴权链
      // 同 buildDaemonMcpServerConfig）。sessionId 不在此拼——session-manager 在
      // provider 返回后按 ctx.sessionId 调 injectMcpSessionId 补写受限 server 名
      // （MCP_SESSION_ID → hub-client X-Session-Id，backend 沿 parent 链定位 mission）。
      isWorkerSession: (ctx) => {
        return ctx.provider === 'claude' && (ctx.stage ?? '') === 'mission_worker';
      },
      workerMcpConfigProvider: (ctx) => {
        const mcpApiKey = config.api_key ?? '';
        const mcpToken = config.token ?? '';
        const workerServer = buildWorkerMcpServerConfig(
          config.server_url,
          {
            token: mcpToken,
            apiKey: mcpApiKey || undefined,
          },
          // task-05（2026-08-26-team-subsession-recursion / design §5.C）：分身深度
          // 透传——ctx.worker_depth 来自 lease.metadata.worker_depth（task-04 承载
          // 链：claim payload → daemon → create/restore/reload 三路保档），经 env
          // MCP_WORKER_DEPTH 传给受限 server；mcp-server 按 depth <
          // MAX_DISPATCH_DEPTH 两档注册（非叶 5 件 / 叶 1 件）。undefined 不写键 =
          // 叶档兜底（旧 lease 宁少勿多，design §7 风险表）。
          { workerDepth: ctx.worker_depth },
        );
        const merged = mergeMcpConfigs([], {
          mcpServers: { [WORKER_MCP_SERVER_NAME]: workerServer },
        });
        const result: Record<string, McpServerConfigForDriver> = {};
        for (const [name, cfg] of Object.entries(merged.config.mcpServers)) {
          result[name] = {
            command: cfg.command,
            ...(cfg.args ? { args: cfg.args } : {}),
            ...(cfg.env ? { env: cfg.env } : {}),
          };
        }
        return Object.keys(result).length > 0 ? result : undefined;
      },
      // task-08（FR-05 / D-004@v1）：reloadWithProvider 构造新 env 的本机凭证管理器。
      // 复用同一 credentialMgr（与 daemon._credentialManager 同源），让停止场景
      //（provider_config=null）reload 后子进程仍能读 credentials.json 的 ANTHROPIC
      // token（buildSpawnEnv 第 2 层不再 noop 跳过）。CredentialManager 直接满足
      // SpawnCredentialManager 鸭子接口（get/buildEnv 两方法，对齐 daemon.ts:3136
      // create 路径的 this._credentialManager ?? noopCredential）。credentialMgr 在
      // line 536 已构造（早于 SessionManager），此处零时序问题。
      credentialManager: credentialMgr,
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
  // task-06（2026-08-15-init-trigger-sillyspec-init / FR-04 / D-005@v1 / D-007@v1）：
  // 构造 TaskRunner 前独立探测本机已装 agent → 映射 sillyspec VALID_TOOLS 同名交集 →
  // 注入 detectedAgents，init lease 的 sillyspec init --tool 据此下发。
  // 复核 N-03：Daemon.start() 的 detectAgents 晚于 TaskRunner 构造，故此处独立跑一次
  // 探测（AgentDetector 无状态可重复实例化；约 12 个 --version 子进程，秒级）。
  // 探测失败 / 空 → 注入 undefined（runSillyspecInit 兜底 ['claude']），绝不阻塞 daemon 启动。
  let detectedAgents: string[] | undefined;
  try {
    const detected = await new AgentDetector().detectAgents();
    const mapped = mapDetectedToSillyspecTools(
      detected.filter((a) => a.status === 'available').map((a) => a.provider),
    );
    detectedAgents = mapped.length > 0 ? mapped : undefined;
    console.info(
      'cli: init_tools_detected',
      detectedAgents ?? '(fallback claude in runSillyspecInit)',
    );
  } catch (e) {
    // 探测异常不阻塞启动（R-04：兜底 ['claude']，映射表集中一处）
    console.warn('cli: init_tools_detect_failed_fallback', e);
  }
  const taskRunner = new TaskRunner(
    client,
    workspaceMgr,
    credentialMgr,
    config,
    resilience,
    policyCache,
    policyEngine,
    detectedAgents,
  );
  daemon = new Daemon(config, client, taskRunner, {
    sessionManager,
    credentialManager: credentialMgr,
    persistence,
    recoveryClient: client,
    lockManager,
    resilience,
    policyCache,
    // task-07（2026-08-26-workspace-mcp-edit / D-007@v2）：会话级 MCP 三件套缓存
    // 共享引用（与上方 mainAgentMcpConfigProvider 闭包同一 Map）——daemon 预取
    // 写入 / provider 读，生命周期=会话。
    mcpBundleCache: mcpBundleBySession,
    // task-01：进程启动时间注入（register/heartbeat 上报 started_at 用）。
    startedAt: processStartTime,
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
 * 从 runtime lock 反查运行中 daemon 实际连接的 server 配置。
 *
 * 背景（ql-20260818-001）：`start --server <url>` 可连任意后端（per-server 配置
 * `config-<hash>.json`），而 status 此前固定展示 DEFAULT server（localhost:8000）
 * 那份配置，Runtime ID / Server URL 与运行进程实际不符。
 *
 * 路径：扫 `<DEFAULT_CONFIG_DIR>/locks/` 下 `runtime-*.lock`（per-provider，内容含
 * pid + server_hash）→ 按 pid 匹配运行进程 → 读 `config-<server_hash>.json` 取
 * runtime_id / server_url。lock 的 server_hash 与 per-server 文件名同源（均为
 * server_url 的 sha256 前 8 位），故直接拼文件名，不重复计算。
 *
 * 仅展示用途：任何一步失败（目录/文件缺失、JSON 损坏、pid 无匹配、字段类型
 * 异常）返回 null，由调用方回退 DEFAULT 配置，不影响 State/PID 判定。
 *
 * 导出为普通函数遵循本模块惯例（cli.ts:21 `loadConfigFn` 同理），便于测试 spy。
 *
 * @param pid 运行中 daemon 的进程 ID（来自 daemon.pid 文件）。
 */
export async function resolveRunningDaemonConfig(
  pid: number,
): Promise<{ runtime_id: string; server_url: string } | null> {
  try {
    const locksDir = join(DEFAULT_CONFIG_DIR, 'locks');
    for (const name of await readdir(locksDir)) {
      if (!name.endsWith('.lock')) continue;
      let lock: unknown;
      try {
        lock = JSON.parse(await readFile(join(locksDir, name), 'utf-8'));
      } catch {
        continue; // 单个 lock 文件损坏 → 跳过继续扫，不让一个坏文件拖垮反查
      }
      const record = lock as { pid?: unknown; server_hash?: unknown };
      if (record.pid !== pid || typeof record.server_hash !== 'string') continue;
      const config = JSON.parse(
        await readFile(join(DEFAULT_CONFIG_DIR, `config-${record.server_hash}.json`), 'utf-8'),
      ) as { runtime_id?: unknown; server_url?: unknown };
      if (typeof config.runtime_id === 'string' && typeof config.server_url === 'string') {
        return { runtime_id: config.runtime_id, server_url: config.server_url };
      }
      return null; // config 存在但字段缺失 → 回退 DEFAULT
    }
  } catch {
    // locks 目录不存在 / 读取异常 → 回退 DEFAULT
  }
  return null;
}

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
  // 2026-08-18 ql-20260818-001：running 时优先按 pid 从 runtime lock 反查
  // 实际 server 的 per-server 配置（DEFAULT 文件与 --server 启动的进程无关）；
  // 反查失败或非 running 时保持旧行为读 DEFAULT。
  const pid = readPid();
  const running = pid !== null && isProcessAlive(pid);
  let config: { runtime_id: string; server_url: string } | null = null;
  if (running && pid !== null) {
    config = await resolveRunningDaemonConfig(pid);
  }
  if (config === null) {
    try {
      config = await loadConfigFn(DEFAULT_CONFIG.server_url);
    } catch {
      // 配置加载失败（文件损坏/不存在等）→ 用占位值，不中断 status 输出
      config = { runtime_id: '(unknown)', server_url: '(unknown)' };
    }
  }

  let state: string;
  let pidInfo: string;
  if (running) {
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
  // task-03（2026-08-29-daemon-selfupdate-safety S3 / FR-01）：pending-update.json
  // 存在时追加等待空闲升级行（本地可见性；后端横幅走 task-05 心跳透传）。读失败
  // / 无效结构视为无 pending（readPendingUpdateFile 统一口径），不中断 status。
  const pending = await readPendingUpdateFile(
    join(DEFAULT_CONFIG_DIR, 'pending-update.json'),
  );
  if (pending) {
    process.stdout.write(
      `等待空闲升级：盘上 ${pending.target_version} 运行 ${pending.current_version}` +
        `（原因 ${pending.reason}，since ${new Date(pending.since).toISOString()}）\n`,
    );
  }
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

// ── cleanAction ─────────────────────────────────────────────────────────────

interface CleanOptions {
  dry?: boolean;
}

/**
 * clean 子命令业务逻辑。导出便于测试。
 *
 * @returns 退出码（0 成功）
 */
export async function cleanAction(opts: CleanOptions): Promise<number> {
  const result = await performCleanup(DEFAULT_CONFIG_DIR, { dryRun: opts.dry ?? false });

  if (result.entries.length === 0) {
    process.stdout.write('没有需要清理的内容。\n');
    return 0;
  }

  const label = result.dryRun ? '预览' : '已清理';
  process.stdout.write(`${label}：\n`);
  for (const entry of result.entries) {
    const sizeMB = (entry.freedBytes / 1024 / 1024).toFixed(1);
    process.stdout.write(`  ${entry.path}  ${sizeMB} MB\n`);
  }
  const totalMB = (result.totalFreedBytes / 1024 / 1024).toFixed(1);
  process.stdout.write(`合计释放：${totalMB} MB\n`);
  return 0;
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
