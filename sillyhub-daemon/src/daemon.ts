/**
 * Daemon 主类（task-20，W4 编排核心）。
 *
 * 替代 Python `sillyhub_daemon/daemon.py`（341 行）。
 * 守护进程主类：register → 三循环（heartbeat/poll/ws）→ task_available 事件分发
 * → lease 状态机（claim → start → execute → complete）。
 *
 * **编排层**：不实现任何子能力（agent 探测 / HTTP / WS / 子进程 / git 都不在本类），
 * 只做组装。6 个前置模块的接口消费点：
 *   - task-12 config.ts：`DaemonConfig`（只读）
 *   - task-03 protocol.ts：`MSG` / `WS_PATH`
 *   - task-16 agent-detector.ts：`AgentDetector.detectAgents(): Promise<DetectedAgent[]>`
 *   - task-17 hub-client.ts：`HubClient.{register,heartbeat,claimLease,startLease,completeLease,getPendingLeases,close}`
 *   - task-18 ws-client.ts：`WsClient` class（`connect()/close()/send()`）
 *   - task-19 task-runner.ts：`TaskRunner.runLease(ctx): Promise<TaskRunnerResult>`
 *
 * 行为对齐 Python `daemon.py:36-341`。Node 异步模型用 Promise + AbortController
 * 替代 asyncio.Task + CancelledError。
 *
 * **Reverse Sync（蓝图假设 vs 真实 src 差异，以真实为准）**：
 *   1. TaskRunner 真实方法是 `runLease(ctx: LeaseCtx)`，不是 `executeTask(leaseId, token, payload)`。
 *      daemon 在 _runLeaseStateMachine step 3 构造 LeaseCtx 传给 runLease。
 *   2. TaskRunnerResult 字段名是 camelCase（filesChanged/durationMs/sessionId），
 *      complete_lease 提交时映射成 server 期望的 snake_case（files_changed 等）。
 *   3. DetectedAgent 字段：`provider`（非 `name`）、`path`（非 `bin_path`）、
 *      `status: 'available' | 'unavailable'`（非 `available: bool`）。
 *      daemon 用 `agent.status === 'available'` 过滤，用 `agent.provider` 作 key。
 *   4. AgentDetector 方法名是 `detectAgents()`（非 `detectAll()`）。
 *   5. WsClient 构造签名：`new WsClient({ serverUrl, runtimeId, token?, callbacks? })`，
 *      connect() 是同步 void（内部自动重连），不是 `connect(signal): Promise<void>`。
 *      daemon 不能 await connect()，改成一次性调 connect() 后让循环空跑等待 stop。
 *   6. HubClient.register 真实接受对象参数（含 provider/name/version/...），
 *      返回 `Record<string, unknown>`，用 `resp.id` 取 server 分配的 runtime_id。
 *   7. HubClient.close() 是同步 void（非 async），stop 中无需 await。
 *
 * @module daemon
 */

import { arch, homedir, hostname, platform, tmpdir } from 'node:os';
// stat：2026-08-28-fix-cross-machine-worker-dispatch task-06——认领段 cwd 存在性
// 预检（FR-05/D-004@v1，正确机器上 worktree 必已存在，存在性即「对机」试金石）。
import { mkdir, stat, readFile, writeFile, rename, unlink, chmod } from 'node:fs/promises';

import { join, dirname } from 'node:path';
import type { SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { type DaemonConfig, DEFAULT_CONFIG_DIR, daemonBinDir, normalizeAllowedRoots } from './config.js';
// task-07（2026-08-26-workspace-mcp-edit / D-007@v2）：会话级 MCP 三件套预取
// （fetchMcpBundle）+ bundle 类型（会话级缓存值）。
import { fetchMcpBundle, normalizeWorkerDepth } from './mcp-config.js';
import type { McpBundle } from './mcp-config.js';
import { MSG } from './protocol.js';
// 2026-08-20-session-multimodal-attachments task-09：SESSION_INJECT 附件类型。
import type { SessionInjectAttachment } from './protocol.js';
// 2026-08-29-daemon-platform-resilience task-06：控制指令 kind 词表（与 backend
// control_commands.py KIND_* 逐字对齐）+ 补拉条目类型（WS 控制消息与 HTTP 补拉
// 共用 control-dispatcher 路由）。
import { CONTROL_KIND } from './protocol.js';
import type { PendingControlCommand } from './protocol.js';
// task-06（design A1+A2 消费端）：控制指令统一消费入口（路由/去重/ack 收集）。
import { ControlDispatcher } from './control-dispatcher.js';
// task-06（design §5.4.4）：onTurnMessage/onTurnResult 参数类型从 Claude SDK 专属类型
// 放宽为 provider-neutral 联合，支持 Codex flat message/result 透传。
import type {
  InteractiveDriverMessage,
  InteractiveDriverResult,
} from './interactive/driver.js';
import type {
  DaemonMessage,
  ExecutionContextPayload,
  LeaseCtx,
  LeasePayload,
  ProviderConfig,
} from './types.js';
import { AgentDetector, normalizeProvider } from './agent-detector.js';
import type { DetectedAgent } from './agent-detector.js';
import { extractCause } from './hub-client.js';
// 2026-08-31-machine-sillyspec-version task-05：register/heartbeat 追加的 sillyspec
// 参数形状（键存在性语义见 hub-client.ts D-002@v1 注释），daemon 组装快照时用。
import type {
  HeartbeatSillySpecParam,
  RegisterSillySpecParam,
} from './hub-client.js';
// task-04（FR-01 / D-005@v1）：onTurnResult 桥接把模型层 ModelError 注入
// notifyRunResult payload.error（与 backend ModelErrorDTO 三端同构）。
import type { ModelError } from './model-error/types.js';
import { WsClient, RpcError } from './ws-client.js';
// 2026-08-18-workspace-file-browser task-03：explorer_* 只读浏览三函数 + 默认上限
// （design §7.1；函数实现归 task-01 file-rpc.ts，daemon.ts 只注册 RPC handler）。
import {
  listDir,
  explorerListDir,
  explorerReadFile,
  explorerSearch,
  EXPLORER_DEFAULT_MAX_RESULTS,
  assertWithinAllowedRoots,
} from './file-rpc.js';
import { listRoots } from './roots-rpc.js';
// 2026-08-28-fix-cross-machine-worker-dispatch task-05/06（FR-05 / D-004@v1）：
// interactive 会话 cwd 守卫纯函数——白名单终检 + 存在性判定，daemon.ts 认领段只接线。
import { checkWorkspaceBoundCwd } from './interactive-cwd-guard.js';
// task-03（2026-07-06-daemon-host-fs-delegate）：host_fs.* WS handler 业务层。
// backend 经 HostFsDelegate + ws_rpc 调本 handler 在宿主执行 stat/git_apply/...（FR-02）。
import { HostFsHandler } from './host-fs-handler.js';
import { buildSpawnEnv, type SpawnCredentialManager } from './spawn-env.js';
import { applyClaudeSettings } from './claude-settings.js';
// 2026-06-24 preflight：启动前预检 sillyspec 版本 + daemon 自更新（失败不阻断启动）。
// task-04（S1）：编排器静态引入自更新三件套——runDaemonSelfUpdate（下载原子替换）、
// respawnDaemonAndExit（交接拉起）、fetchLatestBuildId（推迟路径目标版本回传，
// 指令 payload 缺 version 时拉 latest.json 兜底）。
// task-07（2026-08-30-daemon-self-heal / D-009）：validateBundleOnDisk——_tryUpdate
// stop() 之前的主拦截校验（盘上 bundle 内容可信性，坏盘中止不走交接）。
import {
  runPreflight,
  runDaemonSelfUpdate,
  respawnDaemonAndExit,
  fetchLatestBuildId,
  validateBundleOnDisk,
} from './preflight.js';
// 2026-07-07-daemon-skill-execution task-03：skill-manager，启动同步平台 sillyspec skills。
import { syncSkills, linkSkillsToWorkdir } from './skill-manager.js';
// 2026-08-31-machine-sillyspec-version task-05：sillyspec 运行期版本管理与升级状态机
//（task-04 核心模块）。daemon 侧接线三处：_sillyspecLoop 第四自动循环（auto 触发）、
// 心跳/注册快照透传、WS SILLYSPEC_UPDATE 指令入口（server_command 触发）。
import { SillySpecManager } from './sillyspec-manager.js';
// daemon 自身构建标识（release=git SHA），register 时上报供服务端判定是否需推送自更新。
import { BUILD_ID } from './build-id.js';
// 2026-06-24-daemon-network-resilience task-10/12：网络层重试编排（submit 重试 + 终态轻量重试）。
import { ResilienceService } from './resilience/service.js';
import type { Envelope } from './resilience/service.js';
import { dedupKeyFor } from './resilience/error-classify.js';
import type {
  TaskRunnerResult,
  ChangeWriteCtx,
  ChangeWriteFile,
  ChangeWriteResult,
} from './task-runner.js';
// task-11（design §5）：Filesystem Policy Engine 三件套（构造注入，additive）。
import type { PolicyCache } from './policy/runtime-policy.js';
// task-09（D-007@v2 候选 B）：借用 session 沙箱目录创建（mirror by slug，复用 WorkspaceManager）。
import { WorkspaceManager } from './workspace.js';
import type { SessionManager } from './interactive/session-manager.js';
// task-06（D-007@v1）：spec bundle 同步共享 utility（task-04 抽出），interactive
// 路径接入 pull（session 开始）+ sync（session end）。纯函数 + client 参数注入，
// interactive 无 TaskRunner 实例也能直接调用。
import {
  pullSpecBundle,
  syncSpecTreeIfNeeded,
  readLocalSpecVersion,
  shouldRefreshSpec,
  bumpLocalSpecVersion,
  resolveSpecDir,
} from './spec-sync.js';
import { RuntimeHandler, normalizeRootPathParam } from './runtime-handler.js';
// ql-20260831-001-6dde：恢复链/重开与本地在途 turn 竞态守卫（SessionBusyError
// instanceof 分支用，value import）。
import { SessionBusyError } from './interactive/types.js';
import type {
  PersistedSessionRecord,
  SessionStatus,
  SessionStorePersistence,
  SessionSwitchConfigPayload,
  SessionSwitchProfilePayload,
} from './interactive/types.js';

// ── task-09（2026-08-14-sessions-portal / FR-05 / D-012@v1）────────────────────
// SESSION_SWITCH_CONFIG 消息类型字面量（Server → Daemon：会话内切档案/供应商 +
// 原子承载切换轮 prompt，design §7.2）。命名沿用既有 ``daemon:<snake>`` 风格，
// 与 backend task-05 的 DAEMON_MSG_SESSION_SWITCH_CONFIG 逐字对齐；task-05 落地
// 后升格进 protocol.ts MSG 表（本任务 allowed_paths 只 daemon.ts + tests，
// 暂以模块级常量收口，避免越界改 protocol.ts）。
const SESSION_SWITCH_CONFIG_MSG = 'daemon:session_switch_config';

// ── 2026-08-29-daemon-platform-resilience task-06：控制指令路由与 register 重试 ──
//
// WS 控制消息 type（MSG.*，形如 `daemon:session_inject`）→ 控制指令 kind
//（CONTROL_KIND.*，形如 `session_inject`）映射。task-04 起六类控制消息统一走
// backend daemon_control_commands 三段式投递（payload 尾部注入 command_id），
// daemon 侧 WS 推送与 HTTP 补拉共用 control-dispatcher 按 kind 路由——本表是
// WS 入口把 msgType 翻译成 kind 的唯一落点。PLAN_RESPONSE 不入表（backend 未
// 收录 plan 下发点，见 protocol.ts CONTROL_KIND 注释），保持既有直连路由。
const CONTROL_MSG_TYPE_TO_KIND: Record<string, string> = {
  [MSG.SESSION_INJECT]: CONTROL_KIND.SESSION_INJECT,
  [MSG.SESSION_INTERRUPT]: CONTROL_KIND.SESSION_INTERRUPT,
  [MSG.SESSION_END]: CONTROL_KIND.SESSION_END,
  [MSG.SESSION_RESUME]: CONTROL_KIND.SESSION_RESUME,
  [MSG.PERMISSION_RESPONSE]: CONTROL_KIND.PERMISSION_RESPONSE,
  [MSG.PROVIDER_CONFIG_CHANGED]: CONTROL_KIND.PROVIDER_CONFIG_CHANGED,
};

// register 周期重试退避（design A1）：启动时 register 失败 / 运行期注册全失效时，
// 心跳循环按退避周期重试 _registerDaemon——15s 起步，连续失败翻倍，60s 封顶；
// 成功清计数恢复正常心跳。常量导出便于测试注入时间。
export const REGISTER_RETRY_BASE_MS = 15_000;
export const REGISTER_RETRY_MAX_MS = 60_000;

// task-04（S1 / D-002@v1）：忙推迟升级的空闲复查间隔——忙时记 pending 后每 30s
// 重探（完整重跑 _tryUpdate，无状态机），无限等空闲。导出供测试断言间隔语义。
export const SELF_UPDATE_RETRY_INTERVAL_MS = 30_000;

// task-06（2026-08-30-daemon-self-heal / D-001）：心跳降级恢复触发守卫——心跳
// 断连累计 >720s（600s offline sweep 宽限 + 60s sweep 轮次余量 + 缓冲）后恢复，
// 此时 backend 必已把该 runtime 名下非终态会话翻 suspended，才值得跑恢复链；
// 短于 720s 的闪断不产生 suspended、不触发。导出供测试断言阈值语义。
export const RECOVER_AFTER_DEGRADED_MS = 720_000;

/**
 * task-04（S1）：_deferUpdate 目标版本缺省占位（可见性字段，不参与升级判定）。
 *
 * disk_change 回调恒带盘上 BUILD_ID、server_command 通常带指令 version——只有
 * 「server_command 且 payload 缺 version 且 fetchLatestBuildId 也失败」时落到
 * 此占位（status/心跳仍能展示「有升级在等」，具体版本未知）。
 */
const SELF_UPDATE_TARGET_UNKNOWN = '<disk>';

// ── task-03（2026-08-29-daemon-selfupdate-safety / S2+S3）：磁盘旁路探测 + pending ──

// daemon bundle 落盘目录（respawn 加载的同一文件，探测读它比对 BUILD_ID）。
// 2026-08-31 收口：原与 preflight.ts 的模块私有常量 DAEMON_BIN_DIR 同值重声明（当时
// task 卡 allowed_paths 限制）；现统一派生 config.daemonBinDir()——SILLYHUB_DAEMON_DIR
// 隔离时 bin 一并重定向，隔离实例的自更新探测/落盘不再写真实 ~/.sillyhub/daemon/bin。
const DAEMON_BIN_DIR: string = daemonBinDir();

// daemon bundle 文件名。与 preflight.ts:64 的模块私有常量 DAEMON_BUNDLE_NAME
// 同值重声明（理由同上）。
const DAEMON_BUNDLE_NAME = 'sillyhub-daemon.js';

/**
 * bundle 文本内 BUILD_ID 提取正则（design S2 / D-003@v2）。
 *
 * gen-build-id.mjs 生成 `export const BUILD_ID = "<sha>-<ts>";` 单行，格式为 regex
 * 兼容而设计；引号单双皆容。首处匹配即取（bundle 内无前序同形出现）。
 */
const DISK_BUILD_ID_RE = /BUILD_ID\s*=\s*["']([^"']+)/;

/**
 * pending-update.json 记录结构（S3 可见性 / FR-01）。
 *
 * 推迟升级期间落盘 `~/.sillyhub/daemon/pending-update.json`，cli status / task-05
 * 心跳读取展示；升级执行或取消时删除。since=写入时刻 epoch ms——task-04 忙复查
 * 每轮重写，故本地值为「最近一次推迟时刻」（本地 status 展示用，非权威）；
 * 「pending 起点」的权威 since 在 backend（upsert 同内容保留原值，不随心跳漂移）。
 */
export interface PendingUpdateRecord {
  /** 推迟原因：'server_command'（服务端指令）| 'disk_change'（磁盘旁路探测）。 */
  reason: string;
  /** 推迟时进程内存中的 BUILD_ID。 */
  current_version: string;
  /** 等待切换到的目标 BUILD_ID。 */
  target_version: string;
  /** 最近一次推迟时刻（epoch ms；起点权威值在 backend upsert 侧）。 */
  since: number;
}

/**
 * 读取 pending-update.json（严格校验四字段，损坏/缺字段/不存在 → null）。
 *
 * 导出为独立函数：cli.ts statusAction（无 Daemon 实例）与 task-05 心跳复用同一
 * 校验口径；Daemon.readPendingUpdate 委托本函数。
 *
 * @param filePath pending-update.json 绝对路径。
 */
export async function readPendingUpdateFile(
  filePath: string,
): Promise<PendingUpdateRecord | null> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch {
    // 不存在 / 不可读 → 无 pending（调用方语义：null=无）。
    return null;
  }
  try {
    const obj = JSON.parse(raw) as Partial<PendingUpdateRecord>;
    if (
      typeof obj.reason === 'string' &&
      obj.reason.length > 0 &&
      typeof obj.current_version === 'string' &&
      obj.current_version.length > 0 &&
      typeof obj.target_version === 'string' &&
      obj.target_version.length > 0 &&
      typeof obj.since === 'number' &&
      Number.isFinite(obj.since)
    ) {
      return {
        reason: obj.reason,
        current_version: obj.current_version,
        target_version: obj.target_version,
        since: obj.since,
      };
    }
    return null;
  } catch {
    // JSON 损坏 → 无有效 pending。
    return null;
  }
}


// ── 最小日志（design G-05 零依赖，不装 winston/pino）──────────────────────────

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const LOG_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

interface Logger {
  debug(event: string, kv?: Record<string, unknown>): void;
  info(event: string, kv?: Record<string, unknown>): void;
  warn(event: string, kv?: Record<string, unknown>): void;
  error(event: string, kv?: Record<string, unknown>): void;
}

function formatVal(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (v instanceof Error) return v.message;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function createLogger(level: LogLevel): Logger {
  const filter = LOG_ORDER[level] ?? LOG_ORDER.info;
  const log = (lvl: LogLevel, event: string, kv?: Record<string, unknown>): void => {
    if (LOG_ORDER[lvl] < filter) return;
    const parts = kv
      ? Object.entries(kv).map(([k, v]) => `${k}=${formatVal(v)}`)
      : [];
    // eslint-disable-next-line no-console
    console[lvl === 'debug' ? 'log' : lvl](`[daemon.${event}]`, ...parts);
  };
  return {
    debug: (e, kv) => log('debug', e, kv),
    info: (e, kv) => log('info', e, kv),
    warn: (e, kv) => log('warn', e, kv),
    error: (e, kv) => log('error', e, kv),
  };
}

// ── 可中断 sleep（AbortSignal 替代 asyncio.CancelledError，R7）───────────────

/**
 * sillyspec 临时路径放行常量（FR-003，与 permission-rules.ts 的
 * SILLYSPEC_TEMP_PATTERNS 同步）。PolicyCache 注入点（register 响应 + 心跳
 * _syncAllowedRoots/_syncPolicyCache）把这些路径并入 allowedRoots，让
 * PolicyEngine isPathUnderAnyRoot 放行 sillyspec 写 c:\dev\null / 系统 temp。
 *
 * 注：.sillyspec/.runtime 位于 ~/.sillyhub 下，已在 homedir 兜底白名单内，不重复加。
 * 跨平台：Windows C:/dev/null + os.tmpdir()；POSIX /dev/null + os.tmpdir()。
 * 写死 3 类路径，不接受外部输入（R-02 写安全兜底，越界写仍 deny，task-08 守护）。
 */
const SILLYSPEC_TEMP_ROOTS: string[] = [
  'C:\\dev\\null',
  'C:/dev/null',
  '/dev/null',
  tmpdir(),
];

/** abortableSleep 抛出的异常类型（标识 stop 信号）。 */
class AbortError extends Error {
  constructor() {
    super('Aborted');
    this.name = 'AbortError';
  }
}

/**
 * 可中断 sleep。signal.aborted 时立即 reject(AbortError)。
 *
 * 不用 Promise.race([sleep, abortPromise])：会产生未处理的 rejection 警告。
 * 用 setTimeout + signal.addEventListener('abort', ...) 实现干净的中断。
 */
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new AbortError());
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new AbortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

// ── modelUsage 聚合（ql-20260829-002）────────────────────────────────────────
// SDK 文档（sdk.d.ts SDKResultSuccess）：result.usage 是 MAIN AGENT LOOP ONLY
// （不含 Task 子代理 / sidechain / compaction），modelUsage 才是 "The correct
// field for token/cost accounting"（per-model 累计，含全部 query-pipeline 调用）。
// 平台会话大量派 Task 子代理，终态 token 只取 result.usage 会系统性低估。
// 本函数把 Record<string, ModelUsage>（camelCase 四维）跨模型求和；任一条目
// 出现 number 字段即视为有效（seen）；非对象 / 空对象 / 全非有限数 → null
// （调用方回落 result.usage 现行为，兼容老 CLI 与 Codex driver）。
interface ModelUsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

function _aggregateModelUsage(modelUsage: unknown): ModelUsageTotals | null {
  if (typeof modelUsage !== 'object' || modelUsage === null || Array.isArray(modelUsage)) {
    return null;
  }
  const totals: ModelUsageTotals = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  let seen = false;
  for (const raw of Object.values(modelUsage as Record<string, unknown>)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = raw as Record<string, unknown>;
    // 非有限数（NaN/Infinity/字符串）不计入，防脏 stats 污染求和。
    if (typeof entry.inputTokens === 'number' && Number.isFinite(entry.inputTokens)) {
      totals.input += entry.inputTokens;
      seen = true;
    }
    if (typeof entry.outputTokens === 'number' && Number.isFinite(entry.outputTokens)) {
      totals.output += entry.outputTokens;
      seen = true;
    }
    if (
      typeof entry.cacheReadInputTokens === 'number' &&
      Number.isFinite(entry.cacheReadInputTokens)
    ) {
      totals.cacheRead += entry.cacheReadInputTokens;
      seen = true;
    }
    if (
      typeof entry.cacheCreationInputTokens === 'number' &&
      Number.isFinite(entry.cacheCreationInputTokens)
    ) {
      totals.cacheCreation += entry.cacheCreationInputTokens;
      seen = true;
    }
  }
  return seen ? totals : null;
}

// ── modelUsage 明细行（task-06 / 2026-08-29-usage-by-provider-model）──────────

/**
 * 终态上报 payload 的 run×模型用量明细行（FR-01-3）。
 *
 * 字段 snake_case 对齐 backend ModelUsageItemRead（InteractiveRunResultRequest.
 * model_usage 元素）；由 `_modelUsageRows` 从 SDK modelUsage（camelCase 四维）
 * 拆行映射产出。daemon.ts 拥有该 wire 形状（计算方），hub-client.ts 仅
 * type-only 引用（对齐既有 SessionRecoverStatus 的 daemon→hub-client 方向）。
 */
export interface ModelUsageRow {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  /** 该模型调用次数（估算分摊，见 _modelUsageRows；run 级精确值在 payload.api_requests）。 */
  api_requests: number;
}

/**
 * task-06（FR-01-3 / design §3.1 / D-001@v1）：modelUsage（Record<string,
 * ModelUsage>，camelCase 四维）逐 key 拆明细行，camel→snake 映射。
 *
 * 防御口径同 `_aggregateModelUsage`：modelUsage 非对象 / null / 数组 → 空数组；
 * 条目非对象跳过；任一维为非有限数（NaN/Infinity/字符串）按 0 计；四维全非法
 * 的条目跳过（与聚合函数 seen 语义一致——不产生全 0 噪声行）。
 *
 * api_requests 分摊（design §2 D-01 / R-01）：SDK 不提供 per-model 请求数，
 * totalRequests 非 null 时按各行 input+output 占比四舍五入分配，残差补给最大
 * 消耗行（input+output 最大，并列取首行），保证 Σ行 == totalRequests；
 * totalRequests 为 null（无计数来源）时各行 0。行内值为**估算分摊**，run 级
 * payload.api_requests 才是精确计数。
 */
function _modelUsageRows(modelUsage: unknown, totalRequests: number | null): ModelUsageRow[] {
  if (typeof modelUsage !== 'object' || modelUsage === null || Array.isArray(modelUsage)) {
    return [];
  }
  const rows: ModelUsageRow[] = [];
  for (const [model, raw] of Object.entries(modelUsage as Record<string, unknown>)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = raw as Record<string, unknown>;
    // 非有限数按 null 标记（区别于合法 0），便于 seen 判定（同聚合函数语义）。
    const dim = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) ? v : null;
    const input = dim(entry.inputTokens);
    const output = dim(entry.outputTokens);
    const cacheRead = dim(entry.cacheReadInputTokens);
    const cacheCreation = dim(entry.cacheCreationInputTokens);
    if (input === null && output === null && cacheRead === null && cacheCreation === null) {
      continue;
    }
    rows.push({
      model,
      input_tokens: input ?? 0,
      output_tokens: output ?? 0,
      cache_read_tokens: cacheRead ?? 0,
      cache_creation_tokens: cacheCreation ?? 0,
      api_requests: 0,
    });
  }
  // 分摊：totalRequests 非有限数防御性视同 null（调用方传 daemon 内部计数，
  // 正常恒为非负整数；防脏数据把负数/Infinity 摊进行内）。
  const total =
    totalRequests !== null && Number.isFinite(totalRequests)
      ? Math.max(0, Math.round(totalRequests))
      : null;
  if (rows.length > 0 && total !== null) {
    const weights = rows.map((r) => r.input_tokens + r.output_tokens);
    const weightSum = weights.reduce((a, b) => a + b, 0);
    if (weightSum > 0) {
      let assigned = 0;
      rows.forEach((row, i) => {
        const share = Math.round((weights[i]! / weightSum) * total);
        row.api_requests = share;
        assigned += share;
      });
      // 残差（四舍五入舍入误差，可正可负）补给最大消耗行，保 Σ行 == total。
      let maxIdx = 0;
      for (let i = 1; i < rows.length; i++) {
        if (weights[i]! > weights[maxIdx]!) maxIdx = i;
      }
      rows[maxIdx]!.api_requests += total - assigned;
    } else {
      // 全部行 input+output=0（纯 cache 消耗 / 全 0）：无法按占比分摊，
      // 全部归首行（并列取首行的同一确定性规则），仍保 Σ行 == total。
      rows[0]!.api_requests = total;
    }
  }
  return rows;
}

// ── modelUsage 快照差分（ql-20260831-009）────────────────────────────────────

/**
 * 单模型四维累计快照（差分基线用；SDK modelUsage 条目四维的已规范化形态）。
 */
interface ModelUsageSnapshot {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

/**
 * 会话级差分基线（sessionId → 本值）：各模型累计快照 + total_cost_usd 累计。
 * 生命周期 = daemon 进程内该 interactive 会话（同进程同流式 query）；重启即丢，
 * 丢基线只会让下一轮多报一次快照全量（不丢用量、不重复持久化历史）。
 */
interface ModelUsageBaseline {
  models: Record<string, ModelUsageSnapshot>;
  totalCostUsd: number;
}

/** 差分产物（camelCase 四维 Record）：直接喂 _aggregateModelUsage / _modelUsageRows。 */
type ModelUsageDelta = Record<
  string,
  {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
  }
>;

/**
 * ql-20260831-009：SDK `modelUsage` / `total_cost_usd` 在 streaming-input 会话中是
 * **跨轮累计快照**（sdk.d.ts：cumulative across turns — "each result carries the
 * running total so far, so read the latest result rather than summing across
 * results"）。daemon 一条 interactive 会话 = 一条长生命周期流式 query（claude-sdk-driver
 * 订阅跨 turn 的 input AsyncIterable），每轮终态直接把快照当「本轮增量」上报，
 * backend 按 run 求和 → 多轮会话用量虚增（实证 3 轮会话缓存读显示 338.7 万 vs
 * 真实末轮快照 128.3 万）。本函数把快照差分为本轮增量：delta = 当前快照 − 上轮快照
 * （按模型逐维，钳非负）。
 *
 * 复位检测：快照在同一生命周期内单调不降；某模型任一有效维当前值 < 基线对应维
 * 即判定 SDK 计数已复位（sdk.d.ts 明示 resume 新 query / 中途 /clear / crash 清零
 * 三种场景），该模型基线归零、delta 取当前快照全量——此前轮次已按各自增量上报，
 * 不重不漏。
 *
 * 有效性门槛与 `_aggregateModelUsage` 的 seen 同源：modelUsage 非对象 / 无任何有限
 * 数维度 → 返回 null（调用方基线不动、回落 result.usage 旧路径，老 CLI / Codex
 * 兼容）。有效时返回 { delta, nextModels }；nextModels 为推进后的各模型基线（缺失
 * 维沿用旧基线值，防 SDK 偶发漏报导致后续轮多扣）。total_cost_usd 维度的基线推进
 * 由调用方随成本差分一并处理（两字段同生命周期但有效性相互独立）。
 */
function _deltaModelUsage(
  modelUsage: unknown,
  baseline: ModelUsageBaseline | undefined,
): { delta: ModelUsageDelta; nextModels: Record<string, ModelUsageSnapshot> } | null {
  if (typeof modelUsage !== 'object' || modelUsage === null || Array.isArray(modelUsage)) {
    return null;
  }
  const delta: ModelUsageDelta = {};
  const nextModels: Record<string, ModelUsageSnapshot> = {};
  let seen = false;
  for (const [model, raw] of Object.entries(modelUsage as Record<string, unknown>)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = raw as Record<string, unknown>;
    // 非有限数按 null 标记（区别于合法 0），缺失维差分计 0（对齐 _modelUsageRows ?? 0）。
    const num = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) ? v : null;
    const cur = {
      input: num(entry.inputTokens),
      output: num(entry.outputTokens),
      cacheRead: num(entry.cacheReadInputTokens),
      cacheCreation: num(entry.cacheCreationInputTokens),
    };
    if (
      cur.input === null &&
      cur.output === null &&
      cur.cacheRead === null &&
      cur.cacheCreation === null
    ) {
      // 四维全非法：不产生噪声行、不计 seen（与 _modelUsageRows 跳过语义一致）。
      continue;
    }
    seen = true;
    const base = baseline?.models[model];
    // 复位检测（任一有效维回落 → 基线归零，见函数头注释）。
    const reset =
      base !== undefined &&
      ((cur.input !== null && cur.input < base.input) ||
        (cur.output !== null && cur.output < base.output) ||
        (cur.cacheRead !== null && cur.cacheRead < base.cacheRead) ||
        (cur.cacheCreation !== null && cur.cacheCreation < base.cacheCreation));
    const from = reset || base === undefined ? { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 } : base;
    const d = (c: number | null, b: number): number => Math.max(0, (c ?? 0) - b);
    delta[model] = {
      inputTokens: d(cur.input, from.input),
      outputTokens: d(cur.output, from.output),
      cacheReadInputTokens: d(cur.cacheRead, from.cacheRead),
      cacheCreationInputTokens: d(cur.cacheCreation, from.cacheCreation),
    };
    // 基线推进：有效维取当前值；缺失维沿用旧基线（reset 时归 0 由 from 语义带入）。
    nextModels[model] = {
      input: cur.input ?? base?.input ?? 0,
      output: cur.output ?? base?.output ?? 0,
      cacheRead: cur.cacheRead ?? base?.cacheRead ?? 0,
      cacheCreation: cur.cacheCreation ?? base?.cacheCreation ?? 0,
    };
  }
  if (!seen) return null;
  return { delta, nextModels };
}

// ── translateSpecRoot（prompt 路径翻译纯函数）─────────────────────────────────
// 2026-06-22-agent-run-pipeline-fix task-02：SPEC_ROOT_MAP 翻译器。
// design §4.1 A1 第 2 层：daemon 在 prompt 透传给 SessionManager.create 前，
// 按 spec_root_map（"from:to"）把容器内路径翻译成宿主机路径，避免 Windows
// Git Bash 把 /data/... 转成 C:\Program Files\Git\data\... 导致 EPERM。
//
// 关键修正（task-02 边界 3 / AC-07）：旧实现 `split(':', 2)` 在 Windows 盘符
// 场景会把 to 截断成 'C'。改用 indexOf(':') + slice 按首个 ':' 分割，
// to 含盘符冒号（如 C:/data/spec-workspaces）。
//
// 纯函数导出便于单测（daemon-spec-root-map.test.ts）。

/**
 * 按 specRootMap（"from:to"）翻译 prompt 中的路径。
 *
 * 语义（task-02 §接口定义）：
 *   - specRootMap 空串 → 不翻译，返回原 prompt
 *   - specRootMap 不含 ':' → 返回原 prompt（调用方负责 warn 日志）
 *   - 按**首个** ':' 分割为 from/to（容忍 to 含 ':'，如 Windows 盘符路径）
 *   - from 或 to 为空 → 返回原 prompt
 *   - prompt.includes(from) → replaceAll(from, to)；否则原样返回
 *
 * @param prompt       原始 prompt
 * @param specRootMap  映射 "from:to"（来自 config.spec_root_map 或 env SPEC_ROOT_MAP）
 * @returns            翻译后 prompt（新字符串；不变时返回原引用）
 */
export function translateSpecRoot(prompt: string, specRootMap: string): string {
  if (!specRootMap) return prompt;
  const colonIdx = specRootMap.indexOf(':');
  if (colonIdx < 0) return prompt;
  const from = specRootMap.slice(0, colonIdx);
  const to = specRootMap.slice(colonIdx + 1);
  if (!from || !to) return prompt;
  if (!prompt.includes(from)) return prompt;
  return prompt.replaceAll(from, to);
}

// ── 依赖契约（鸭子类型，避免硬耦合具体类）─────────────────────────────────────

/** daemon 需要的 AgentDetector 接口子集。 */
interface DetectorLike {
  detectAgents(): Promise<DetectedAgent[]>;
}

/** daemon 需要的 HubClient 接口子集。 */
interface ClientLike {
  register(params: {
    daemonLocalId: string;
    serverUrl: string;
    hostname: string;
    os?: string;
    arch?: string;
    allowedRoots?: string[];
    /** task-01：进程启动时间（对齐 hub-client task-02 的 register 签名）。 */
    startedAt?: number | Date | null;
    providers: { provider: string; version?: string; status?: string }[];
    /**
     * 2026-08-31-machine-sillyspec-version task-05：注册前 sillyspec 探测快照
     *（对齐 hub-client task-05 register 追加末位参，D-002@v1 直接落值语义）。
     */
    sillyspec?: RegisterSillySpecParam;
  }): Promise<Record<string, unknown>>;
  heartbeat(
    daemonLocalId: string,
    providers?: { provider: string; status?: string }[],
    /** task-01：进程启动时间（对齐 hub-client task-02 的 heartbeat 第 3 参数）。 */
    startedAt?: number | Date | null,
    /**
     * task-05（2026-08-29-daemon-selfupdate-safety / FR-04）：推迟升级期间的
     * pending 状态（对齐 hub-client task-05 heartbeat 第 4 参数，结构同
     * HeartbeatPendingUpdate）。undefined 时请求体不含 pending_update 键。
     */
    pendingUpdate?: {
      reason: string;
      current_version: string;
      target_version: string;
    },
    /**
     * 2026-08-31-machine-sillyspec-version task-05：sillyspec 版本/升级状态快照
     *（对齐 hub-client task-05 heartbeat 第 5 参数，D-002@v1 键存在性语义——
     * version/latest 知道才带，update 非 null 才带）。undefined 时请求体不含
     * 任何 sillyspec_* 键。
     */
    sillyspec?: HeartbeatSillySpecParam,
  ): Promise<unknown>;
  markOffline?(runtimeId: string): Promise<unknown>;
  /**
   * 2026-08-29-daemon-platform-resilience task-08（design A5 / FR-04）：优雅停止
   * 批量挂起本 daemon 全部 active 会话（POST /sessions/suspend-batch）。可选——
   * 真实 HubClient 已实现；旧测试 mock 未实现时 stop() 跳过挂起（等价强杀，
   * 走 backend 600s offline sweep 兜底收敛 suspended）。
   */
  suspendSessions?(daemonLocalId: string): Promise<unknown>;
  claimLease(leaseId: string, runtimeId: string): Promise<Record<string, unknown>>;
  // 2026-08-20-session-multimodal-attachments task-09：会话附件下载（可选——
  // HubClient 已实现；测试 mock 未实现时附件回拉/落盘走失败降级标注）。
  downloadSessionAttachment?(attachmentId: string): Promise<Buffer>;
  startLease(leaseId: string, claimToken: string): Promise<unknown>;
  completeLease(
    leaseId: string,
    claimToken: string,
    result: Record<string, unknown>,
  ): Promise<unknown>;
  getPendingLeases(runtimeId: string): Promise<Record<string, unknown>[]>;
  /**
   * 2026-08-29-daemon-platform-resilience task-06：补拉 runtime 的 pending 控制
   * 指令（design A2）。可选——真实 HubClient 已实现；旧测试 mock 未实现时
   * control-dispatcher 不挂 HTTP 源（只走 WS 路由+去重，不补拉不回执）。
   */
  getPendingControls?(runtimeId: string): Promise<PendingControlCommand[]>;
  /**
   * task-06：控制指令消费回执（ids 批量置 acked，design A2 ack 语义=已处理）。
   * 可选，同 getPendingControls。
   */
  ackControls?(
    runtimeId: string,
    ids: string[],
  ): Promise<{ acked: number } | Record<string, unknown>>;
  getExecutionContext(agentRunId: string): Promise<ExecutionContextPayload>;
  close(): void;
  /**
   * gap-3（design §4）：上报 interactive AgentRun 终态。
   * SessionManager._onResult → deps.onTurnResult → daemon 桥接 → 此方法
   * → backend close_interactive_run。W1 已在 hub-client.ts 实现。
   */
  notifyRunResult(
    leaseId: string,
    claimToken: string,
    runId: string,
    payload: {
      status: string;
      is_error: boolean;
      subtype?: string;
      result_summary?: string;
      // SDKResultSuccess 透传字段（usage / cost / duration 等，interactive 路径
      // 原先丢弃，导致 AgentRun 全 NULL；对齐 batch extractResultStats）。
      total_cost_usd?: number;
      num_turns?: number;
      duration_ms?: number;
      duration_api_ms?: number;
      input_tokens?: number;
      output_tokens?: number;
      // task-16：cache 两维（短名，对齐 backend _METADATA_FIELDS）。
      cache_read_tokens?: number;
      cache_creation_tokens?: number;
      // task-06（2026-08-29-usage-by-provider-model / FR-01-3/FR-02-1）：
      // modelUsage 逐模型明细行 + run 级 assistant 计数。modelUsage 缺失/空时
      // daemon 两字段都不写（老 CLI / Codex 兼容，backend N-01 None）。
      model_usage?: ModelUsageRow[];
      api_requests?: number;
      // task-04：模型层结构化错误（is_error=true 时归类器产出，成功路径不 set）。
      error?: ModelError;
    },
  ): Promise<unknown>;
  /**
   * 增量上报 agent 执行消息（流式）。interactive + batch 共用端点，
   * interactive 路径经 daemon 桥接转发（design §6 step 4）。
   */
  submitMessages(
    leaseId: string,
    claimToken: string,
    agentRunId: string,
    messages: Record<string, unknown>[],
  ): Promise<unknown>;
  /**
   * gap-4（design §5）：上报 interactive session 终态（end / idle / fail）。
   * SessionManager.end/fail → deps.onSessionEnd → daemon 桥接 → 此方法
   * → backend end_session。W1 已在 hub-client.ts 实现。
   */
  notifySessionEnd(
    sessionId: string,
    status: 'ended' | 'failed',
    reason: string,
  ): Promise<unknown>;
  /**
   * 2026-08-29-daemon-platform-resilience task-07（design A3）：PERMISSION_REQUEST
   * 的 HTTP 上行兜底（WS 不通时 sendToHub 改走）。可选——真实 HubClient 已实现；
   * 旧测试 mock 未实现且 WS 不通时保持既有 fail-closed deny 语义。
   */
  submitPermissionRequest?(
    sessionId: string,
    payload: Record<string, unknown>,
    claimToken?: string,
  ): Promise<unknown>;
  /**
   * task-02（design Phase 1 / FR-01）：上报 interactive session 已就绪（create 完成）。
   * _startInteractiveSession create 成功（fresh）→ 此方法
   * → backend SessionReadiness.mark_ready → inject_session 等 ready 解除（秒级，
   * 修复 /model 等 inject 在 daemon create 完成前到达被丢的时序竞态）。best-effort：
   * hub-client 实现失败 warn 不抛，调用点无需额外 try/catch。W1 已在 hub-client.ts 实现。
   */
  notifySessionReady(sessionId: string): Promise<void>;
  /**
   * task-06（session-reopen-resume / DS-3 / FR-03）：reopen 恢复成功后向
   * backend 确认 reconnecting → active。可选方法（? 有 markOffline 先例）：
   * reopen 路径经 _routeSessionResume 调用，opts 显式透传 payload 的
   * leaseId/runtimeId（不依赖 recover 链路的 _recoveryRuntimeBySession 映射）。
   * 与 hub-client.ts 实现签名对齐。
   */
  confirmReconnected?(
    sessionId: string,
    opts?: { leaseId?: string; runtimeId?: string },
  ): Promise<void>;
  /**
   * task-06（session-reopen-resume / DS-3 / FR-04）：reopen 恢复失败（含
   * SessionAlreadyExistsError）后向 backend 写 reconnecting → failed。
   * opts 语义同 confirmReconnected。与 hub-client.ts 实现签名对齐。
   */
  markRecoveryFailed?(
    sessionId: string,
    reason?: string,
    opts?: { leaseId?: string; runtimeId?: string },
  ): Promise<void>;
  /**
   * task-06（D-003@v1 tar 模式 pull）：GET spec bundle（tar Buffer）。
   * 与 hub-client.ts:694 实现对齐。interactive 路径经 pullSpecBundle 调用。
   */
  getSpecBundle(wsId: string): Promise<Buffer>;
  /**
   * task-06（D-003@v1 tar 模式 sync）：POST spec 整树回传（tar Buffer）。
   * 与 hub-client.ts:737 实现对齐。interactive 路径经 postSpecSync 调用。
   */
  postSpecSync(
    wsId: string,
    tarBuf: Buffer,
  ): Promise<{ ok: boolean; reparsed: number }>;
  /**
   * task-11 / FR-08 / D-004@v1：拉取 runtime 下所有 pending change-write。
   * 与 hub-client.ts getPendingChangeWrites 对齐。
   */
  getPendingChangeWrites(
    runtimeId: string,
  ): Promise<Record<string, unknown>[]>;
  /**
   * task-11：抢占一行 pending change-write（换取 claim_token）。
   * task-09 端点无 body，runtimeId 仅日志用。
   */
  claimChangeWrite(
    changeWriteId: string,
    runtimeId?: string,
  ): Promise<Record<string, unknown>>;
  /**
   * task-11：回执 change-write 执行结果（ok/files/error）。
   */
  completeChangeWrite(
    changeWriteId: string,
    claimToken: string,
    payload: { ok: boolean; files?: unknown[]; error?: string },
  ): Promise<unknown>;
  /**
   * ql-20260813-spec-sync-visibility task-08：上报同步进度计数（files_total/processed）。
   * 可选——mock client 未实现时 daemon 跳过进度上报（不影响同步主流程）。后端 PATCH
   * /change-writes/{id}/progress（status==claimed 校验，D-004 单一写者不改 status）。
   */
  reportChangeWriteProgress?(
    changeWriteId: string,
    claimToken: string,
    payload: { files_total?: number; files_processed?: number },
  ): Promise<unknown>;
}

/** daemon 需要的 TaskRunner 接口子集。 */
interface TaskRunnerLike {
  runLease(ctx: LeaseCtx): Promise<TaskRunnerResult>;
  /**
   * task-11 / FR-10：change-write 轻量执行（不启 agent）。可选——测试 mock
   * TaskRunner 未实现时 daemon 跳过 change-write 分支。
   */
  runChangeWrite?(ctx: ChangeWriteCtx): Promise<ChangeWriteResult>;
  /**
   * change 2026-08-05-daemon-kill-channel-unify task-04 / FR-03 / R-06：取消在跑的
   * batch lease。daemon `_handleWsMessage` 收到 LEASE_CANCEL WS 消息时调用，复用
   * 现有 AbortController → _killChild 即时杀子进程（design §5 Phase2）。真实
   * TaskRunner 已实现（task-runner.ts:327，幂等——AbortController 已 aborted 则
   * abort() no-op、_killChild 检查 child.killed）；可选仅为兼容仅含 runLease 的
   * 测试 mock（duck-typed，daemon 调用前用 `typeof === 'function'` 探测）。
   */
  cancel?(leaseId: string): Promise<boolean>;
  /**
   * task-04（2026-08-29-daemon-selfupdate-safety / FR-01 / D-001@v1）：是否存在
   * 进行中的 batch lease（真实 TaskRunner._controllers 非空，task-runner.ts
   * hasActiveLease）。可选——照 cancel? / runChangeWrite? 先例（Grill M14）：
   * 仅含 runLease 的旧测试 mock 不实现时缺省视为不忙，daemon 调用前用
   * `typeof === 'function'` 探测（_isBusyForUpdate），不砸碎既有 mock。
   */
  hasActiveLease?(): boolean;
}

/** daemon 需要的 WsClient 接口子集。 */
interface WsClientLike {
  connect(): void;
  close(): void;
  /**
   * WS 是否处于 Connected（open）状态。perf-remediation task-09：lease 轮询
   * 门控消费（isConnected + lastMessageAt 新鲜 → 跳过该轮 HTTP 兜底）。
   */
  readonly isConnected: boolean;
  /**
   * 最后一条 WS 消息**或 pong** 到达时间（epoch ms，只读）。perf-remediation
   * task-09 / D-003@v1：lease 轮询门控 + _wsLoop 假活看门狗（2026-08-27）
   * 消费；pong 计入使健康链路 ping/pong（30s）恒保鲜。从未收到消息/pong 为
   * null（两处消费均视为陈旧）。测试 mock 可用 getter 实现。
   */
  readonly lastMessageAt: number | null;
  /**
   * 最近一次进入 Connected 的时刻（epoch ms，只读）；从未连上/已断开为
   * null。假活看门狗在 lastMessageAt=null 时的兜底锚点。可选——测试 mock
   * 可不实现（null 时看门狗 fail-open，交给 keepalive 主判据）。
   */
  readonly connectedAt?: number | null;
  /**
   * task-05：注册 RPC handler（D-005@v1）。鸭子类型可选——测试 mock 的 WsClient
   * 可不实现（生产路径真实 WsClient 必须实现，否则 list_dir 等方法不可用，R-5）。
   * daemon 在 _wsLoop 用 `typeof === 'function'` 探测后调用。
   */
  registerRpcHandler?: (
    method: string,
    handler: (params: Record<string, unknown>) => Promise<unknown> | unknown,
  ) => void;
  /**
   * scan 真阻塞（改造点 C）：发 WS 消息到 backend（PERMISSION_REQUEST）。真实 WsClient
   *（task-18）实现 send；此处声明供 daemon.sendToHub 调用。返回类型宽松（真实可能
   * void/boolean），sendToHub 用 try/catch 判定是否成功。
   */
  send?: (msg: { type: string; payload: unknown }) => unknown;
}

/** WsClient 工厂：daemon 在 _wsLoop 用它创建实例（便于测试 mock）。 */
type WsClientFactory = (opts: {
  serverUrl: string;
  runtimeId: string;
  /**
   * task-02（security-audit-remediation / FR-01）：hub API key，WS 升级期以
   * X-API-Key 头携带（backend 校验，缺头 4001）。config.api_key 可能为 null
   * （未配置）→ undefined 不发头。
   */
  apiKey?: string;
  callbacks: {
    onMessage?: (msg: DaemonMessage) => void;
    onConnected?: () => void;
    onDisconnected?: (code: number, reason: string) => void;
    onError?: (err: Error) => void;
    /**
     * task-13（D-004）：POLICY_UPDATE 推送回调。daemon 据此 sub-second 热更新
     * PolicyCache，并做 version 去重（R-07）。
     */
    onPolicyUpdate?: (
      runtimeId: string,
      allowedRoots: string[],
      version: number,
    ) => void;
  };
}) => WsClientLike;

// ── task-10：daemon 重启恢复编排（鸭子类型端口）──────────────────────────────
//
// daemon 启动时按 §5 编排：load → 对每条记录向 backend recover →
// SessionManager.restoreAndReconnect（query resume）→ reconnecting→active。
//
// backend recover/confirm/markFailed 的真实 HTTP 端点属 task-05 router 范围
//（allowed_paths 限制，不在本任务直接改 HubClient）。daemon 通过此鸭子类型
// 端口调用；生产路径由 main.ts 注入真实 client（内部走 HubClient 的对应方法），
// 测试注入 mock。

/** backend recover 响应状态（task-10 §4.4 / §5）。 */
export type SessionRecoverStatus =
  | 'reconnecting'
  | 'ended'
  | 'failed'
  | 'rejected';

/**
 * task-10 §4.4 / §5：daemon→backend 恢复对账端口（鸭子类型）。
 *
 * 三个方法对应 backend service.py 的 recover_session_after_daemon_restart /
 * confirm_session_reconnected / mark_session_recovery_failed。daemon 启动编排
 * 按序调用；失败隔离（单条 reject/throw 不影响其他 session）。
 */
export interface RecoveryCoordinator {
  /**
   * 向 backend 收敛崩溃 currentRun + 写 session=reconnecting（或返回终态/rejected）。
   * daemon 收到 reconnecting 后才调 SessionManager.restoreAndReconnect。
   */
  recoverSession(
    sessionId: string,
    params: {
      leaseId: string;
      runtimeId: string;
      provider: string;
      agentSessionId: string;
      interruptedRunId?: string;
    },
  ): Promise<{ status: SessionRecoverStatus }>;
  /** 恢复成功（reconnecting → active）后向 backend 确认。 */
  confirmReconnected(sessionId: string): Promise<void>;
  /** 恢复失败（driver.start 抛错）后向 backend 写 reconnecting → failed。 */
  markRecoveryFailed(sessionId: string): Promise<void>;
}

/**
 * task-08（design A5 / FR-04）：单条恢复编排结果三态。
 *   - 'recovered'：恢复成功（reconnecting→active）；
 *   - 'dropped'：未恢复且记录已从持久化移除（业务终态 ended/failed/rejected、
 *     restore/markReconnected 失败、超龄 7 天清理）；
 *   - 'retry'：recover HTTP 网络类失败——本地记录保留并已入重试队列。
 */
type SessionRecoveryOutcome = 'recovered' | 'dropped' | 'retry';

/**
 * task-08（design A5）：恢复重试队列条目（recover 网络类失败保留的本地记录）。
 *
 * 内存态（不写 sessions.json——退避计数是本次进程的暂态，重启后 boot 编排
 * 立即重试无需续接计数）；记录本体留在 sessions.json（_mergedPersistableSnapshot
 * 合并回写防 flush 冲掉）。
 */
interface PendingRecoveryEntry {
  record: PersistedSessionRecord;
  /** 连续失败次数（成功恢复/终态出队即消亡；退避 = BASE × 2^(retryCount-1) 封顶 MAX）。 */
  retryCount: number;
  /** 下次允许重试的时间戳（epoch ms；WS onConnected 立即重试一轮时归零）。 */
  nextRetryAt: number;
}

// ── DaemonOptions（便于测试注入 mock detector/wsClientFactory）────────────────

/**
 * task-09 / D-007@v2（候选 B 主路径）：借用沙箱 cwd marker。
 *
 * backend placement（placement.py）对借用 lease 写 ``metadata.cwd =
 * "<BORROW_SANDBOX_MARKER><slug>"``，借 ``build_claim_payload`` 既有 cwd→root_path
 * 透传链路（context.py:92，**无需改 context.py**）把 marker 带到 daemon execPayload.rootPath。
 * daemon ``_startInteractiveSession`` 检测 marker 前缀 → 提取 slug → prepareWorkspace
 * 创建独立沙箱目录作 cwd（不复用 lender 代码 rootPath）→ 登记到 SessionManager
 * 激活按 lease 隔离的只读 policy。
 *
 * marker 字符串本身从不进入真实文件系统路径——daemon 解析后 cwd 落到
 * ``<workspace_dir>/borrow-sandboxes/<slug>`` 真实目录。
 */
const BORROW_SANDBOX_MARKER = 'borrow-sandbox:';

// ── perf-remediation task-09 / D-003@v1：_pollLoop 按通道拆分门控常量 ─────────
//
// lease 轮询跳过条件：WS isConnected 且距最后一条 WS 消息 < LEASE_POLL_SKIP_MS
//（90s，TASK_AVAILABLE 推送兜底分发；ping 30s + 任意 backend 消息均刷新 lastMessageAt）。
// 消息陈旧 ≥ 90s（假活，R-05）或断连时恢复 30s 轮询兜底。
// 常量导出便于测试注入时间（task-09 constraints）。
export const LEASE_POLL_SKIP_MS = 90_000;

// 假活看门狗阈值（2026-08-27 网络切换 WS 永久假连事故）：WsClient 自称
// Connected 但 lastMessageAt（消息+pong）陈旧超过该值 → 判假活，_wsLoop
// 强制关闭重建。健康链路 ping/pong（30s 周期）恒刷新新鲜度，不会误杀；
// 阈值取 90s 轮询判据 + 30s ping 周期 + 缓冲。常量导出便于测试注入时间。
export const WS_STALE_REAP_MS = 120_000;

// ql-20260831-006（quick）：SESSION_INJECT 早到（daemon create 未写 store）时的
// 分离式等待窗口。backend 等 ready 仅 8s 即超时 fallback 发 inject，而 daemon
// create 全链（skills 拷贝 / MCP bundle 预取 / claude spawn 前置步骤）实机可达
// ~31s（会话 52893639：inject 到达与 store 写入差 23s）——原 3×100ms 短重试窗口
// 耗尽即丢弃，叠加 ql-20260831-005「丢弃即报 run failed」把慢启动竞态变成必死。
// 60s 默认覆盖实测慢启动 ~2.5x 余量；真不存在的会话（daemon 重启丢失等）超时后
// 仍走丢弃上报（比旧 005 前的 10min backend GC 快一个量级）。env 可调供测试。
export const DEFAULT_INJECT_WAIT_SESSION_MS = 60_000;

/** inject 早到等待的轮询间隔（原 3×100ms 重试同节奏）。 */
const INJECT_WAIT_POLL_MS = 100;

/** 读取等待窗口（env SILLYHUB_INJECT_WAIT_SESSION_MS，非法/缺省回落默认；逐次读取便于测试覆写）。 */
export function injectWaitSessionMs(): number {
  const raw = process.env.SILLYHUB_INJECT_WAIT_SESSION_MS;
  if (raw === undefined || raw === '') return DEFAULT_INJECT_WAIT_SESSION_MS;
  const v = Number.parseInt(raw, 10);
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_INJECT_WAIT_SESSION_MS;
}

// ── task-08（design A5 / FR-04）：recover 网络类失败重试退避 + 超龄清理常量 ────
//
// _recoverOneSession 遇 recover HTTP 网络类失败（请求未达/超时/5xx——HubHttpError
// 非 2xx 或原生网络异常；业务终态只以 2xx status 字段返回）保留 sessions.json
// 记录入重试队列：退避 30s 起步指数翻倍封顶 5min 持续重试；WS onConnected 立即
// 重试一轮。R6 防堆积：记录按 lastActiveAt 超龄 7 天清理，仅业务终态
//（ended/failed/rejected）与 restore 失败删记录。常量导出便于测试注入时间。
export const RECOVERY_RETRY_BASE_MS = 30_000;
export const RECOVERY_RETRY_MAX_MS = 5 * 60_000;
/** 待恢复记录超龄阈值（7 天，R6）：启动编排 / 重试入队时检查，超龄删记录。 */
export const RECOVERY_RECORD_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

export interface DaemonOptions {
  /** 注入自定义 AgentDetector（测试用 mock）。默认 new AgentDetector()。 */
  detector?: DetectorLike;
  /**
   * 注入自定义 WsClient 工厂（测试用 mock）。
   * 默认用真实 WsClient（task-18）：`new WsClient({ serverUrl, runtimeId, callbacks })`。
   * 用工厂而非 wsClient 实例，因真实 WsClient 在构造时即准备 connect，
   * daemon 需要 _wsLoop 时按 server_url 构造。
   */
  wsClientFactory?: WsClientFactory;
  /**
   * task-04（D-002@v3）：注入 SessionManager（交互式会话生命周期管理）。
   * 默认 undefined：kind=interactive lease 记 error 并由 backend 收 failed，不崩 daemon
   *（生产部署在 main.ts 实例化时传入；本任务默认 null，AC-14 覆盖过渡期）。
   */
  sessionManager?: SessionManager | null;
  /**
   * task-07（2026-08-26-workspace-mcp-edit / design §5 Wave2 第 5 条 / D-007@v2）：
   * 会话级 MCP 三件套缓存（``Map<sessionId, McpBundle>``）。
   *
   * cli.ts 装配处创建并与 ``mainAgentMcpConfigProvider`` 共享同一引用：daemon
   * ``_startInteractiveSession`` 按 ``execPayload.workspaceId`` 调 ``fetchMcpBundle``
   * 预取写入（create 前 await 完成），provider（同步签名）create/restore/reload
   * 三路读缓存合并注入；``onSessionEnd`` / create 失败 catch 清理（生命周期=会话）。
   * 默认 undefined：daemon 内部自建私有 Map（行为等价，仅 provider 侧读不到——
   * 生产装配必经 cli.ts 注入共享引用；现有测试构造点零改动）。
   */
  mcpBundleCache?: Map<string, McpBundle> | null;
  /**
   * task-10（FR-08）：sessions.json 元数据持久化端口。注入后在 daemon.start
   * 启动时加载可恢复记录 + 状态变更排队 flush。默认 undefined：不持久化
   *（Wave1/2 内存态行为，回退路径：删 sessions.json 即回到 failed 默认路径）。
   */
  persistence?: SessionStorePersistence | null;
  /**
   * task-10（FR-08）：daemon→backend 恢复对账端口。注入后 daemon.start 在
   * 三循环启动前对每条持久化记录调 recoverSession + restoreAndReconnect。
   * 默认 undefined：不执行恢复编排（Wave1/2 行为）。
   */
  recoveryClient?: RecoveryCoordinator | null;
  /** task-10 §5：恢复并发上限，默认 4。 */
  recoveryConcurrency?: number;
  /**
   * gap-8（interactive 凭证 parity）：本机凭证管理器（鸭子类型，仅用 get/buildEnv）。
   *
   * batch 路径经 buildSpawnEnv(credential) 把 credentials.json 的 ANTHROPIC token 注入
   * claude 子进程；interactive 路径（SessionManager→ClaudeSdkDriver）原先只用裸
   * process.env，**不读 credentials.json**，导致用户按设计在 ~/.sillyhub/daemon/
   * credentials.json 配置 token 后 batch 能跑、interactive 仍因无凭证失败。注入后
   * _startInteractiveSession 用同一 buildSpawnEnv 逻辑构造 env 传给 driver，达成 parity。
   * 默认 undefined：driver 回退裸 process.env（向后兼容）。
   */
  credentialManager?: InteractiveCredentialManager | null;
  /**
   * ql-20260624-006：runtime 单实例 lock 管理器。注入后 daemon.start 在注册 agents 前
   * 对每个 provider acquire lock（强制一 host+一 user+一 provider=一 daemon，防同机双开
   * 共享 backend runtime_id 致 ownership 双通过 + WS 重连风暴），失败回滚并阻止启动；
   * stop 时 releaseAll。默认 undefined：不强制单实例（向后兼容）。
   */
  lockManager?: RuntimeLockLike | null;
  /**
   * 2026-06-24-daemon-network-resilience task-10/12/13：网络层重试编排服务。
   * 注入后 submitMessages 走退避重试（用尽入 outbox）、终态上报走 retryTerminal。
   * 默认 undefined：回退直接调 HubClient（无重试，向后兼容 W1）。
   */
  resilience?: ResilienceService | null;
  /**
   * task-11（design §5 / 2026-07-02-daemon-filesystem-policy）：Filesystem Policy Engine
   * 三件套，构造注入（additive）。三者均 optional，不传时 Daemon 行为与改动前一致
   *（现有 write-guard 仍在，task-15 才删除），现有 18 个测试构造点无需改动。
   *
   * 装配关系（cli.ts）：cache → auditSink → engine（PolicyEngine 构造依赖前两者）。
   * 真正接入各 tool 接入点由后续 task-12 ~ task-18 完成；本任务仅持有引用。
   */
  policyCache?: PolicyCache | null;
  /**
   * task-09（D-007@v2 候选 B）：借用沙箱目录管理器（mirror by slug）。
   *
   * 注入后 ``_startInteractiveSession`` 检测到借用 lease 时用它 ``prepareWorkspace(slug)``
   * 创建独立沙箱目录作 cwd。默认 undefined：daemon 首次借用 lease 时 lazy 构造一个
   * 指向 ``<workspace_dir>/borrow-sandboxes`` 的 WorkspaceManager（与 TaskRunner 的
   * workspace 管理器隔离，避免借用沙箱混入开发 mirror）。
   *
   * 测试可注入指向 tmp 目录的实例，避免污染真实 ~/.sillyhub。
   */
  borrowWorkspaceManager?: WorkspaceManager | null;
  /**
   * task-01（FR-01 / D-001@v1）：daemon 进程启动时间（epoch ms）。
   *
   * 由 cli.ts 入口（``Date.now()``）尽早取后注入，daemon 运行期恒定不变；register /
   * heartbeat 调 hub-client 时透传给 backend，作为 ``daemon_instances.started_at`` 的
   * 真实来源（旧 daemon 不传 → 后端取 register 时刻，本字段把语义校正为进程启动时刻）。
   * 默认 undefined：daemon 不上报 startedAt（hub-client 转 null，后端兜底 register 时刻）。
   */
  startedAt?: number;
  /**
   * task-03（S2 / FR-03 / D-003@v2）：磁盘旁路探测读的 daemon bundle 文件路径。
   *
   * 默认 ``<DAEMON_BIN_DIR>/<DAEMON_BUNDLE_NAME>``（~/.sillyhub/daemon/bin/
   * sillyhub-daemon.js，respawn 加载的同一文件）。仅测试注入临时目录用（不污染
   * 真实 ~/.sillyhub）；生产路径不传。
   */
  selfUpdateBundlePath?: string;
  /**
   * task-03（S3 / FR-01）：pending-update.json 落盘路径。
   *
   * 默认 ``~/.sillyhub/daemon/pending-update.json``（DEFAULT_CONFIG_DIR 下）。测试
   * 注入临时目录用；cli.ts statusAction 读同一默认路径。
   */
  pendingUpdatePath?: string;
  /**
   * 2026-08-31-machine-sillyspec-version task-05：注入 sillyspec 运行期管理器
   *（探测/升级状态机）。默认 undefined：daemon 内部构造真实 SillySpecManager
   *（isBusy 接 ``_isBusyForUpdate`` 三臂忙判定，日志适配 ``_preflightLog``）。
   * 测试注入假实现避免真实 spawn（probeLocal/probeLatest 会起子进程）。
   */
  sillyspecManager?: SillySpecManager | null;
}

/**
 * gap-8：interactive 路径凭证注入所需的 CredentialManager 接口子集（鸭子类型，
 * 对齐 src/credential.ts 的 get/buildEnv，与 spawn-env.ts 的 SpawnCredentialManager 一致）。
 */
export interface InteractiveCredentialManager {
  get(key: string): string | undefined;
  buildEnv(config: Record<string, unknown>): Record<string, string>;
}

/**
 * ql-20260624-006：runtime 单实例 lock 管理器鸭子类型（对齐 src/runtime-lock.ts 的
 * RuntimeLockManager，便于测试 mock）。
 */
export interface RuntimeLockLike {
  acquire(provider: string): Promise<void>;
  releaseAll(): Promise<void>;
}

// ── Daemon class（核心）──────────────────────────────────────────────────────

/**
 * 守护进程主类。生命周期：
 *   start() → detectAgents → register each → 启动三循环（heartbeat/poll/ws）
 *           → 收 task_available → _executeTask（claim→start→run→complete）
 *   stop()  → 中断三循环 → 关闭 WS/HTTP → 注销信号
 *
 * 行为对齐 sillyhub_daemon/daemon.py:36-341。
 * 编排层：不实现任何子能力，只组装 6 个前置模块。
 */
export class Daemon {
  private readonly _config: DaemonConfig;
  private readonly _client: ClientLike;
  private readonly _taskRunner: TaskRunnerLike | null;
  private readonly _detector: DetectorLike;
  private readonly _logger: Logger;
  /**
   * task-01（FR-01 / D-001@v1）：进程启动时间（epoch ms），由 cli.ts 入口注入。
   * undefined 时不向 backend 上报（hub-client 转 null）。运行期恒定。
   */
  private readonly _startedAt: number | undefined;
  /**
   * task-04（D-002@v3）：交互式会话管理器。null/undefined 时 interactive lease 记 error
   * 不崩（AC-14 过渡期）。生产路径由 main.ts 在构造 daemon 时传入。
   */
  private readonly _sessionManager: SessionManager | null;
  /**
   * task-10（FR-08）：sessions.json 元数据持久化端口。
   * null 时不持久化（Wave1/2 内存态）。
   */
  private readonly _persistence: SessionStorePersistence | null;
  /**
   * task-10（FR-08）：daemon→backend 恢复对账端口。
   * null 时不执行启动恢复编排（Wave1/2 行为）。
   */
  private readonly _recoveryClient: RecoveryCoordinator | null;
  /** task-10 §5：恢复并发上限，默认 4。 */
  private readonly _recoveryConcurrency: number;
  /**
   * gap-8：本机凭证管理器（interactive 凭证 parity）。null 时 driver 回退裸 process.env。
   */
  private readonly _credentialManager: InteractiveCredentialManager | null;
  /** ql-20260624-006：runtime 单实例 lock 管理器。null 时不强制单实例。 */
  private readonly _lockManager: RuntimeLockLike | null;
  /**
   * 2026-06-24-daemon-network-resilience task-10/12：网络层重试编排。
   * 注入后 onTurnMessage 走 submitWithRetry、终态走 retryTerminal；未注入（null）
   * 回退直接调 _client（向后兼容）。由 cli（task-13）构造时注入。
   */
  private readonly _resilience: ResilienceService | null;
  /**
   * task-11（design §5）：Filesystem Policy Engine 三件套引用。null = 未注入
   *（additive：不传时 Daemon 行为不变，现有 write-guard 仍在，task-15 才删）。
   * 真正接入各 tool 由 task-12 ~ task-18 完成；此处仅持有引用供后续 task 取用。
   */
  private readonly _policyCache: PolicyCache | null;
  /**
   * task-13（D-004 / R-07）：POLICY_UPDATE 推送的 per-runtime version 去重表。
   *
   * 收到 POLICY_UPDATE(version) 时：仅当 version > 已记录的最大 version 才写
   * PolicyCache 并更新本表；旧 version（乱序/重放）忽略。与 PolicyCache.set
   * 内部自管的 version 解耦——PolicyCache.version 是写入次数计数，本表是
   * backend 推送序列号，两者语义不同（design §5.3 + R-07）。
   */
  private readonly _lastPolicyVersion = new Map<string, number>();
  /**
   * task-09（D-007@v2 候选 B）：借用沙箱目录管理器（构造注入或 lazy 构造）。
   *
   * daemon 首次处理借用 lease 时（_startInteractiveSession 检测 marker）经
   * ``_getBorrowWorkspaceManager`` 取实例；未注入则 lazy ``new WorkspaceManager``。
   * 用 ``WorkspaceManager | null`` 字段 + getter 而非构造期 eager 创建：
   * 避免非借用部署（绝大多数）启动时无谓 mkdir borrow-sandboxes 目录。
   */
  private _borrowWorkspaceManager: WorkspaceManager | null = null;
  /**
   * task-04：interactive lease.id → session_id（防 WS 重放重复 create，AC-09）。
   * batch lease 不进此 map（走 _inflightLeases 去重）。
   * 也用作 CLEANUP 忙碌守卫：非空 = 有交互会话在跑，缓存清理跳过。
   */
  private readonly _interactiveSessionsByLease = new Map<string, string>();
  /** CLEANUP 指令 in-flight guard：并发指令去重（对齐 terminal-observer cleanupStarted 模式）。 */
  private _cleanupInFlight = false;
  /**
   * task-09（FR-02 / D-002@v1）：interactive 转发 per-run 确定性 flatSeq 计数。
   *
   * 为什么需要：onTurnMessage 每次转发一条 flat message，无 msg.id 时（Codex flat
   * message / 部分 Claude 消息）dedupKeyFor 需要确定性的 `${runId}:${turnSeq}:${flatSeq}`
   * 才能让重发命中 backend ON CONFLICT DO NOTHING 去重；退化 `${runId}:${Date.now()}`
   * 会让重发产生新 key，去重失效（task-09 的核心问题）。
   *
   * 设计：
   *   - key = runId（每个 AgentRun 全局唯一），value = 该 run 内已转发消息条数（0 起）。
   *   - turnSeq 固定 0：interactive 单条转发不区分 turn，同一 run 内所有 message 共享
   *     runId 维度，flatSeq 在 run 内单调递增即保证唯一。
   *   - 确定性：同一 run 同一条消息（相同调用顺序）始终拿到相同 flatSeq，重发命中去重。
   *   - 生命周期：跟随 session 存在（量级 = session 内 message 数，可控）；runId 全局
   *     唯一不与其它 run 撞。ql-20260825-f3#8：终态清理已落地——onTurnMessage 记录
   *     runId→sessionId 归属（_interactiveFlatSeqOwner），onSessionEnd 反查删除该
   *     session 的全部条目（原注释「后续 GC 任务兜底」兑现），Map 不再只增不减。
   */
  private readonly _interactiveFlatSeq = new Map<string, number>();
  /** ql-20260825-f3#8：runId → sessionId 归属（onSessionEnd 反查清理 flatSeq 条目用）。 */
  private readonly _interactiveFlatSeqOwner = new Map<string, string>();
  /**
   * task-06（2026-08-29-usage-by-provider-model / FR-02-1 / D-01）：run 级
   * assistant 消息计数（runId → count），终态随 payload.api_requests 上报。
   *
   * 为什么需要：SDK 无 per-run 请求数字段，assistant 消息数是调用次数的最优
   * 近似（SDK 每次模型调用产出一条 assistant；Task 子代理消息同为 assistant
   * 类型带 parent_tool_use_id，天然计入——design §2 口径，与 modelUsage 同源
   * 对齐）。turn 边界不清零：runId 即 turn 维度，新 run 无条目从 0 起。
   *
   * 生命周期：onTurnMessage（type==='assistant'）递增；onTurnResult 读出后
   * delete（api_requests=0 也发——有 modelUsage 而无计数的诚实值；modelUsage
   * 缺失时 payload 两字段都不写，条目仍清理）；onSessionEnd 兜底回收（run
   * 未达终态时防泄漏，复用 _interactiveFlatSeqOwner 归属反查）。
   *
   * 不进 SessionState（interactive/types.ts）：桥接层私有计数无需会话状态可见，
   * Map 跟随 daemon 实例生命周期（重启即清零，只影响本次终态上报，不落盘）。
   */
  private readonly _assistantMsgCountByRun = new Map<string, number>();
  /**
   * ql-20260831-009：modelUsage / total_cost_usd 快照差分基线（sessionId → 基线）。
   * SDK 在 streaming-input 会话跨轮报累计快照，onTurnResult 用它差分出本轮增量
   * （见 _deltaModelUsage）；onSessionEnd 统一回收（生命周期=会话，防泄漏）。
   * 不进 SessionState：桥接层私有，重启即清零只影响在途会话下一轮（多报一次
   * 全量，不持久化不跨进程）。
   */
  private readonly _modelUsageBaselineBySession = new Map<string, ModelUsageBaseline>();
  /**
   * task-06（D-003@v1 tar 模式）：interactive lease.id → spec 同步上下文。
   * _startInteractiveSession tar 模式 pull 时 set(leaseId, {workspaceId})；
   * onSessionEnd 经 sessionId→sessionManager.get→leaseId 反查本 map 取 workspaceId，
   * postSpecSync 回传整树后 finally delete（幂等，AC-09 / AC-12）。
   * shared 模式（transport!=='tar'）不 set → onSessionEnd 查不到 ctx 跳过（D-004 现状）。
   */
  private readonly _interactiveSpecSyncCtx = new Map<
    string,
    { workspaceId: string }
  >();
  /**
   * task-07（2026-08-26-workspace-mcp-edit / D-007@v2）：会话级 MCP 三件套缓存
   * （sessionId → McpBundle）。
   *
   * ``_startInteractiveSession`` 按 workspaceId ``fetchMcpBundle`` 预取 set（create
   * 前，provider 读到的一定是已预取结果）；``onSessionEnd`` / create 失败 catch
   * delete（生命周期=会话，防泄漏；幂等）。构造注入优先（cli.ts 与
   * ``mainAgentMcpConfigProvider`` 共享同一 Map 引用）；未注入自建（现有测试
   * 构造点零改动，仅 provider 侧读不到缓存——回落空 bundle，见 cli.ts）。
   */
  private readonly _mcpBundleBySession: Map<string, McpBundle>;

  /**
   * P1-1（2026-06-18）：恢复成功（markReconnected + confirm）后正在 active 运行的
   * session 集合。用于把恢复后**异步**的 driver onError → SessionManager.fail 路径
   * 桥接到 backend markRecoveryFailed（否则 backend session 卡 reconnecting）。
   *
   * daemon 不持有 SessionManager.deps.onSessionEnd 注入点（SessionManager 从外部
   * 注入），故暴露 markRecoveredSessionFailed 让 onSessionEnd 注入方在收到 failed
   * 时调用；daemon 据此集合判定是否走恢复失败通知路径，并清理集合。
   */
  private readonly _recoveredSessionIds = new Set<string>();

  /**
   * task-08（design A5 / FR-04）：recover 网络类失败保留的重试队列
   * （sessionId → PendingRecoveryEntry）。退避定时器按最早到期 deadline 单实例
   * 排程（_scheduleRecoveryRetry）；WS onConnected 把 nextRetryAt 归零立即重试
   * 一轮（_retryPendingRecoveryNow）。stop() 清定时器 + 合并落盘遗留记录。
   */
  private readonly _pendingRecovery = new Map<string, PendingRecoveryEntry>();
  /** task-08：重试定时器（null=未排程）。 */
  private _recoveryRetryTimer: ReturnType<typeof setTimeout> | null = null;
  /** task-08：当前定时器指向的 deadline（epoch ms；防持续入队把最早 deadline 无限后推）。 */
  private _recoveryRetryScheduledFor: number | null = null;
  /** task-08：重试轮防重入标记（定时器与 onConnected 并发触发只跑一轮）。 */
  private _recoveryRetryInFlight = false;

  /**
   * 单条 WS 客户端（连 backend Hub 带 daemon_local_id，design §5.5 / D-006）。
   *
   * 2026-07-03-daemon-entity-binding task-07：从 per-provider ``_wsClients`` Map
   * 收敛为单条 ``_wsClient``。一个物理 daemon 进程对 backend 只开一条 WS，连接
   * 身份用 ``daemon_local_id``（= ``config.runtime_id``）。WS receive loop 按
   * ``message.payload.runtime_id`` 分发到对应 provider 的 session-manager /
   * task-runner（实际 dispatch 已按 sessionId/leaseId，不依赖连接维度的 provider
   * 路由，design §5.5）。null = 未连接（无已注册 runtime / 已关闭）。
   */
  private _wsClient: WsClientLike | null = null;
  private readonly _wsClientFactory: WsClientFactory;

  /**
   * runtime.* RPC handler（2026-08-19-runtime-live-daemon-read，无状态只读）。
   * task-04（2026-08-20-runtime-readpoint-repo-first，design §5.2）：注入
   * rootsProvider 供 root_path 读点第二道校验（containment）——方法引用惰性求值，
   * 规避字段初始化顺序问题，写法对齐 HostFsHandler（下方 _registerHostFsRpcHandler）。
   */
  private readonly _runtimeHandler = new RuntimeHandler({
    rootsProvider: () => this._effectiveAllowedRoots(),
  });

  /** 运行标志，三循环 while 条件。 */
  private _running = false;

  /** 每个 _fire 的 AbortController（stop 时全部 abort，R7）。 */
  private readonly _controllers = new Set<AbortController>();

  /** 每个 _fire 的 Promise（stop 时 allSettled 等待）。 */
  private readonly _loopPromises = new Set<Promise<void>>();

  /**
   * _fire 断路器：记录每次自愈重启的起始时间戳。
   * 循环成功运行超过 loop_restart_backoff_ms 后清除，允许计数器归零。
   */
  private readonly _restartStartedAt = new WeakMap<Function, number>();

  /** agent provider → server 分配的 runtime_id（register 成功后填入）。 */
  private readonly _registeredRuntimes = new Map<string, string>();

  /**
   * task-06（design A1）：启动时探测到的 available agent 列表快照。register
   * 周期重试（_retryRegisterIfNeeded）重放 _registerDaemon 用——本地 CLI 探测
   * 结果不随网络波动变化，重试不需要重新探测（detector 可能是测试 mock，
   * 重放快照保持与启动路径同一数据源）。
   */
  private _lastAvailableAgents: DetectedAgent[] = [];

  /**
   * task-06（design A1）：register 周期重试状态。_registerRetryCount=连续失败
   * 次数（成功清零）；_nextRegisterRetryAt=下次允许重试的时间戳（15s 起步
   * 翻倍封顶 60s，见 REGISTER_RETRY_BASE/MAX_MS）。类成员跨 _fire 自愈重启保留
   *（同 _heartbeatFailSince 惯例，重启即清会误判健康）。
   */
  private _registerRetryCount = 0;
  private _nextRegisterRetryAt = 0;

  /**
   * task-06（design A1+A2）：控制指令统一消费入口。六类控制消息（WS 推送 +
   * HTTP 补拉）经它按 kind 路由到下方既有 _route* 方法（不复制业务逻辑）、
   * LRU 256 command_id 去重、收集 ack 回执。构造器创建（handler 闭包捕获 this）。
   */
  private readonly _controlDispatcher: ControlDispatcher;

  /**
   * task-06（design A1）：重连后统一对账防重入标记。_reconcileAfterReconnect
   * 运行中为 true（并发触发直接返回，幂等只跑一轮）；finally 兜底复位。
   */
  private _reconciling = false;

  /**
   * task-05（FR-03）→ task-07 per-daemon：心跳断连计数。value=首次失败时间戳 ms，
   * null=健康。_fire 自愈重启 _heartbeatLoop 后类成员保留，不重置（避免重启即
   * 误判健康）。原 per-runtime Map 已随单条心跳合并收敛为单值。
   */
  private _heartbeatFailSince: number | null = null;

  /** task-05 → task-07 per-daemon：已告警 FATAL 标记，防持续断连刷日志风暴；恢复时清除。 */
  private _degradedWarned = false;

  /**
   * task-06（2026-08-30-daemon-self-heal / D-002）：心跳降级恢复链在途标记。
   * `_maybeRecoverAfterDegraded` 触发恢复前置 true、finally 复位；期间
   * `_isBusyForUpdate()` 返回 true——selfupdate 触发走既有忙推迟（pending +
   * 30s 复查），恢复不被 stop 打断（反向：selfupdate 已过忙判定进入 stop 流程
   * 时心跳已停、无恢复触发点，天然互斥）。不持久化，daemon 重启自然消失
   * （boot 恢复兜底，R6）。
   */
  private _recoverInFlight = false;

  /**
   * task-06（D-007）：恢复忙推迟 pending 标记——触发时忙（在跑 interactive
   * turn / 在跑 batch lease / 恢复已在途）则仅置位 + warn 返回，**不清标志**：
   * 心跳每拍成功路径复查，空闲拍补触发并清位（无新定时器）；daemon 重启自然
   * 消失（boot 恢复兜底）。
   */
  private _recoverPendingAfterDegraded = false;

  /**
   * ql-20260616-006：agent provider → 本机 CLI 可执行文件路径。
   * server 不持有 daemon 本机的 cmd_path（capabilities.bin_path 仅记录不回传），
   * claim_lease 返回的 payload.cmdPath 恒 undefined → spawn 前必须由 daemon 注入。
   */
  private readonly _agentPaths = new Map<string, string>();

  /** 进行中的 lease_id 集合（并发去重，边界 3）。 */
  private readonly _inflightLeases = new Set<string>();
  /**
   * task-11：change-write 在途去重集合（与 lease inflight 独立，避免 UUID 碰撞
   * 误判 + 便于观测）。taskId 进入即 add，执行完 finally delete。
   */
  private readonly _inflightChangeWrites = new Set<string>();

  /** 信号 handler 引用（stop 时 process.off 注销，R8）。 */
  private _sigtermHandler: (() => void) | null = null;
  private _sigintHandler: (() => void) | null = null;

  /**
   * task-03（S2）：磁盘旁路探测循环定时器（null=未启动/已停止）。
   * startDiskProbe 创建（unref 不阻止进程退出），stop() 清理。
   */
  private _diskProbeTimer: ReturnType<typeof setInterval> | null = null;
  /** task-03（S2）：探测读的 bundle 文件路径（构造注入或默认 DAEMON_BIN_DIR 下）。 */
  private readonly _selfUpdateBundlePath: string;
  /** task-03（S3）：pending-update.json 路径（构造注入或默认 DEFAULT_CONFIG_DIR 下）。 */
  private readonly _pendingUpdatePath: string;
  /**
   * task-04（S1）：自更新编排所有权（true=一次 _tryUpdate 在途）。入口同步
   * check+set 占位（JS 单线程原子，无竞态窗口）；仅「交接排定后」（stop 完成、
   * respawn 已排）保持 true 到进程退出，noop/异常/回推迟路径都释放（可再触发）。
   */
  private _updateBusy = false;
  /**
   * task-04（S1 / D-002）：推迟升级的 30s 空闲复查定时器（null=未排定）。unref
   * 不阻止进程退出；pending 期间新触发仅经 _deferUpdate 的 clear+set 刷新不叠。
   */
  private _updateRetryTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * 2026-08-31-machine-sillyspec-version task-05：sillyspec 运行期版本管理与升级
   * 状态机（task-04 核心模块）。忙判定接 `_isBusyForUpdate`（忙时升级走 manager
   * 内部 deferred + 30s 复查，daemon.ts 不重复实现推迟语义）；探测/安装 spawn
   * 复用 preflight 基建（runCmd/installSillySpec），本类零自写进程逻辑。
   */
  private readonly _sillyspecManager: SillySpecManager;

  /** R1（2026-08-30 审计）：在途 stop 的 Promise——二次 stop() 等待完成不空转。 */
  private _stopPromise: Promise<void> | null = null;

  constructor(
    config: DaemonConfig,
    client: ClientLike,
    taskRunner?: TaskRunnerLike | null,
    options?: DaemonOptions,
  ) {
    this._config = config;
    this._client = client;
    this._taskRunner = taskRunner ?? null;
    this._detector = options?.detector ?? new AgentDetector();
    // task-01：进程启动时间注入存储（运行期恒定）。
    this._startedAt = options?.startedAt;
    this._wsClientFactory =
      options?.wsClientFactory ??
      ((opts) => new WsClient(opts) as unknown as WsClientLike);
    this._sessionManager = options?.sessionManager ?? null;
    this._credentialManager = options?.credentialManager ?? null;
    this._lockManager = options?.lockManager ?? null;
    this._resilience = options?.resilience ?? null;
    // task-07（A3 422 对账 / A5 空窗重放）：claim_token 刷新回调接线——按 runId
    // 反查当前 SessionState 的 claimToken（SESSION_INJECT 已刷新到 state；
    // _interactiveFlatSeqOwner 记录 runId→sessionId 归属）。ResilienceService 在
    // 422 对账与 drain 重放 pending_token entry 时咨询。
    if (this._resilience) {
      this._resilience.setClaimTokenRefresher(async (runId) => {
        const sid = this._interactiveFlatSeqOwner.get(runId);
        if (!sid) return null;
        const token = this._sessionManager?.get(sid)?.claimToken;
        return token || null;
      });
    }
    // task-11：Policy 三件套构造注入（additive，未传 = null，行为不变）。
    this._policyCache = options?.policyCache ?? null;
    // task-09（D-007@v2 候选 B）：借用沙箱管理器，构造期注入优先；未注入走 lazy。
    this._borrowWorkspaceManager = options?.borrowWorkspaceManager ?? null;
    // task-07（D-007@v2）：会话级 MCP bundle 缓存——注入共享引用优先，未注入自建。
    this._mcpBundleBySession = options?.mcpBundleCache ?? new Map();
    this._persistence = options?.persistence ?? null;
    this._recoveryClient = options?.recoveryClient ?? null;
    this._recoveryConcurrency =
      options?.recoveryConcurrency && options.recoveryConcurrency > 0
        ? Math.floor(options.recoveryConcurrency)
        : 4;
    this._logger = createLogger(
      this._normalizeLogLevel(config.log_level),
    );
    // task-03（S2/S3）：磁盘探测 bundle 路径 + pending 文件路径（默认真实路径，
    // 测试经 DaemonOptions 注入临时目录）。
    this._selfUpdateBundlePath =
      options?.selfUpdateBundlePath ?? join(DAEMON_BIN_DIR, DAEMON_BUNDLE_NAME);
    this._pendingUpdatePath =
      options?.pendingUpdatePath ?? join(DEFAULT_CONFIG_DIR, 'pending-update.json');
    // 2026-08-31-machine-sillyspec-version task-05：sillyspec 运行期管理器——构造
    // 注入优先（测试假实现，避免真实 spawn）；缺省真实实例，isBusy 闭包接三臂
    // 忙判定（构造期只存引用，调用时字段均已就绪），日志走 _preflightLog 适配。
    this._sillyspecManager =
      options?.sillyspecManager ??
      new SillySpecManager({
        isBusy: () => this._isBusyForUpdate(),
        logger: (level, msg, data) => this._preflightLog(level, msg, data),
      });
    // task-06（design A2 消费端）：控制指令统一消费入口。handler 全部是下方既有
    // _route* 方法的薄包装（同一实例调用，不复制业务逻辑）；HTTP 源仅在 client
    // 实现两方法（真实 HubClient）时挂接——旧测试 mock 缺方法 → 只走 WS 路由。
    const controlSource =
      typeof this._client.getPendingControls === 'function' &&
      typeof this._client.ackControls === 'function'
        ? {
            getPendingControls: (rid: string) =>
              this._client.getPendingControls!(rid),
            ackControls: (rid: string, ids: string[]) =>
              this._client.ackControls!(rid, ids),
          }
        : null;
    this._controlDispatcher = new ControlDispatcher({
      handlers: {
        [CONTROL_KIND.SESSION_INJECT]: (p) =>
          this._routeSessionControl(MSG.SESSION_INJECT, p),
        [CONTROL_KIND.SESSION_INTERRUPT]: (p) =>
          this._routeSessionControl(MSG.SESSION_INTERRUPT, p),
        [CONTROL_KIND.SESSION_END]: (p) =>
          this._routeSessionControl(MSG.SESSION_END, p),
        [CONTROL_KIND.SESSION_RESUME]: (p) =>
          this._routeSessionControl(MSG.SESSION_RESUME, p),
        [CONTROL_KIND.PERMISSION_RESPONSE]: (p) =>
          this._routePermissionResponse(p),
        [CONTROL_KIND.PROVIDER_CONFIG_CHANGED]: (p) =>
          this._routeProviderConfigChanged(p),
      },
      source: controlSource,
      logger: this._logger,
    });
  }

  private _normalizeLogLevel(level: string): LogLevel {
    if (level === 'debug' || level === 'info' || level === 'warn' || level === 'error') {
      return level;
    }
    return 'info';
  }

  /**
   * task-09（D-007@v2 候选 B）：借用沙箱目录管理器 lazy 取用。
   *
   * 构造期注入（测试 / 未来 cli.ts 显式接线）优先；未注入时首次借用 lease 触发 lazy
   * 构造 ``new WorkspaceManager(<workspace_dir>/borrow-sandboxes)``。借用沙箱与
   * TaskRunner 的开发 mirror 目录隔离（不同 baseDir），避免借用 slug 混入开发工作区。
   *
   * WorkspaceManager 构造函数内部 mkdirSync baseDir（recursive），lazy 触发即创建。
   * 非借用部署永不调本方法 → 永不创建 borrow-sandboxes 目录（零回归）。
   */
  private _getBorrowWorkspaceManager(): WorkspaceManager {
    if (!this._borrowWorkspaceManager) {
      const baseDir = join(this._config.workspace_dir, 'borrow-sandboxes');
      this._borrowWorkspaceManager = new WorkspaceManager(baseDir);
      this._logger.info('borrow_sandbox_workspace_manager_initialized', {
        base_dir: baseDir,
      });
    }
    return this._borrowWorkspaceManager;
  }

  // ── 公开 API ──────────────────────────────────────────────────────────────

  /** 运行中状态查询（对齐 daemon.py:134 is_running property）。 */
  get isRunning(): boolean {
    return this._running;
  }

  /**
   * 启动 daemon：detectAgents → register each → 启动三循环 → 注册信号 handler。
   * 对齐 daemon.py:64-118 start()。
   *
   * 幂等性：若已 _running，直接 return（防重复 start）。
   */
  async start(): Promise<void> {
    if (this._running) {
      this._logger.warn('already_running');
      return;
    }
    this._running = true;
    this._logger.info('starting', { runtime_id: this._config.runtime_id });

    // preflight（2026-06-24）：启动前预检 sillyspec 版本 + daemon 自更新。
    // 失败不阻断启动——runPreflight 内部每步 try/catch 隔离，此处再兜底防意外抛错。
    // 适配内部 Logger（debug/info/warn/error 方法）为 preflight 的 (level,msg,data) 签名。
    try {
      await runPreflight(this._config, (level, msg, data) => {
        this._logger[level](msg, data);
      });
    } catch (e) {
      this._logger.warn('preflight_failed', { error: e });
    }

    // task-03（S3 / Grill M15）：启动清矛盾 pending 残留——上次升级已执行完成
    //（盘上 target==内存 BUILD_ID）或文件结构无效的 pending-update.json 会永久
    // 误导本地 status / task-05 心跳，发现即删；仍在途（target≠内存）则保留。
    // 失败不阻断启动（残留最多多展示一行，下次启动再清）。
    try {
      await this.cleanupStalePendingUpdate();
    } catch (e) {
      this._logger.warn('pending_update_cleanup_failed', { error: e });
    }

    // 1. 探测 agent（task-16，真实方法名 detectAgents，不是 detectAll）
    const agents = await this._detector.detectAgents();
    const availableAgents = agents.filter((a) => a.status === 'available');
    this._logger.info('agents_detected', {
      agents: availableAgents.map((a) => a.provider),
    });
    // task-06（design A1）：快照供 register 周期重试重放（网络恢复后重试
    // _registerDaemon 不重新探测本地 CLI——见 _lastAvailableAgents 注释）。
    this._lastAvailableAgents = availableAgents;

    // 2. per-daemon 注册（design §5.2 / D-006）：单次 POST /register 上报整体
    // daemon_local_id + 探测到的 provider 列表。单个失败不中断（错误隔离在
    // _registerDaemon 内）。
    if (availableAgents.length === 0) {
      this._logger.info('no_agents_detected');
    } else {
      // ql-20260624-006：注册前 acquire runtime lock（强制单实例）。
      // 任一 provider lock 被活跃进程持有 → 回滚已持有 + _running 复位 + 抛错，
      // 阻止三循环启动（cli.ts catch 打印提示并 exit 1）。
      if (this._lockManager) {
        try {
          for (const agent of availableAgents) {
            await this._lockManager.acquire(agent.provider);
          }
          this._logger.info('runtime_lock_acquired', {
            providers: availableAgents.map((a) => a.provider),
          });
        } catch (e) {
          this._logger.error('runtime_lock_acquire_failed', { error: e });
          await this._lockManager.releaseAll();
          this._running = false;
          throw e;
        }
      }
      await this._registerDaemon(availableAgents);
    }

    // task-10（FR-08 / §5）：在三循环启动前执行崩溃恢复编排（boot 触发）。
    // load 持久化记录 → 对每条向 backend recover → restoreAndReconnect
    //（query resume）→ reconnecting→active。失败隔离 + backend rejected 删记录。
    // 未注入 persistence/recoveryClient → 跳过（Wave1/2 行为，向后兼容）。
    // task-05（2026-08-30-daemon-self-heal）：提取为 _recoverPersistedSessions(trigger)，
    // boot 调用点改传 'boot'，行为零变化（heartbeat_recover 触发归 task-06）。
    await this._recoverPersistedSessions('boot');

    // task-03（2026-07-07-daemon-skill-execution）：同步平台 sillyspec skills。
    // 在 agent 探测之后、三循环启动之前。skills 版本比对 + bundle 拉取 + 解压。
    // 失败不阻断启动（同步失败不影响已有 skill 集，下一轮启动重试）。
    // 2026-07-08 修复：传 auth（apiKey 优先 X-API-Key），否则 manifest 端点 401。
    try {
      await syncSkills(
        this._serverOrigin(),
        { apiKey: this._config.api_key, token: this._config.token },
        (level, msg, data) => {
          this._logger[level](msg, data);
        },
      );
    } catch (e) {
      this._logger.warn('skill_sync_failed', { error: e });
    }

    // 3. 启动三循环
    this._fire((signal) => this._heartbeatLoop(signal));
    this._fire((signal) => this._pollLoop(signal));
    this._fire((signal) => this._wsLoop(signal));

    // 2026-08-31-machine-sillyspec-version task-05（design §1）：第四循环——
    // sillyspec 自动升级检查（间隔 config.sillyspec_update_interval_sec，默认
    // 3600s；0/非法值在 _sillyspecLoop 内部判定为关闭，循环立即返回）。
    this._fire((signal) => this._sillyspecLoop(signal));

    // task-07（FR-06 / D-004@v1）：启动 SessionManager 空闲扫描定时器。
    // sessionManager 为 null（task-04 边界 14：未注入）时 ?. 不调；空闲扫描不启动。
    // batch 路径完全不受影响。
    try {
      this._sessionManager?.start();
    } catch (e) {
      this._logger.warn('session_manager_start_failed', { error: e });
    }

    // 4. 注册信号 handler（R8）
    this._installSignalHandlers();

    // task-04（S1 / S2 接线）：磁盘旁路探测——盘上 BUILD_ID 差异（含降级，操作者
    // 换文件即意图）汇入单入口编排器（盘上版本即目标，不查 manifest）。间隔 0
    //（显式关闭）/ dev 构建由 startDiskProbe 内部判定不启动。
    this.startDiskProbe((diskBuildId) =>
      void this._tryUpdate('disk_change', diskBuildId),
    );

    this._logger.info('started', { runtime_id: this._config.runtime_id });
  }

  /**
   * 优雅停止：_running=false → abort 所有循环 → 等待 → 关闭 WS/HTTP → 注销信号。
   * 对齐 daemon.py:120-132 stop()。
   *
   * R1（2026-08-30 审计·selfupdate 停机竞态）：stop 在途时二次调用**等待同一
   * Promise 完成**而非幂等空转——原 `if (!this._running) return` 会让并发调用方
   * （SELF_UPDATE 交接链的 `await this.stop()`）在外部 SIGTERM stop 进行中、
   * runtime lock / markOffline 尚未落地时立即返回 → respawn 新进程抢锁失败退出、
   * 旧进程随后 exit(0) → 机器上无 daemon。
   */
  async stop(): Promise<void> {
    if (this._stopPromise) {
      await this._stopPromise;
      return;
    }
    if (!this._running) return;
    this._running = false;
    this._stopPromise = this._stopInternal().finally(() => {
      this._stopPromise = null;
    });
    await this._stopPromise;
  }

  private async _stopInternal(): Promise<void> {
    this._logger.info('stopping');

    // 注销信号 handler（避免 stop 中再次收到信号二次触发）
    this._uninstallSignalHandlers();

    // abort 所有循环的 AbortController
    for (const c of this._controllers) c.abort();

    // 等待所有循环退出（AbortError 被 _fire 的 catch 吞掉）
    await Promise.allSettled([...this._loopPromises]);
    this._controllers.clear();
    this._loopPromises.clear();

    // task-08：清恢复重试定时器（收尾不再触发新一轮；遗留记录在下方 flush 后
    // 合并落盘，下次启动 _recoverPersistedSessions 续接）。
    this._clearRecoveryRetryTimer();

    // task-03（S2）：清磁盘旁路探测定时器（stop 后不再探测；respawn 前的新进程
    // 会自行 startDiskProbe 重建，接线归 task-04）。
    this._stopDiskProbe();

    // task-04（S1）：清推迟升级复查定时器——daemon 已停，30s 重探不应再触发
    //（正常交接路径 _tryUpdate 在 stop 前已清；此处兜底 SIGTERM 等旁路 stop）。
    // 定时器本身 unref 不阻止退出，纯语义收口。
    this._clearUpdateRetryTimer();

    // task-08（design A5 / FR-04）：优雅停止挂起——在 markOffline 前批量挂起本
    // daemon 全部 active 会话（中断 run→failed(daemon_stopped)、session→
    // suspended、挂起 lease→cancelled）。失败仅结构化日志降级不阻断收尾（与
    // 强杀等价走 backend 600s offline sweep 兜底收敛 suspended，已声明行为）。
    await this._suspendSessionsOnStop();

    await this._markRegisteredRuntimesOffline();

    // task-07（FR-06 / D-004@v1）：停 SessionManager 空闲扫描定时器。
    // 顺序在 WS close 之前，避免 shutdown 中途扫描又触发 end→onSessionEnd→WS 已关报错。
    // sessionManager 为 null 时 ?. 不调。不主动 end 所有 session（避免 shutdown 风暴 backend）；
    // active session 内存态随进程退出丢失，backend 侧 lease 心跳/WS 失活兜底收口。
    try {
      this._sessionManager?.stop();
    } catch (e) {
      this._logger.warn('session_manager_stop_failed', { error: e });
    }

    // task-10（§7 边界 13）：daemon stop 强制 flush 最后一次内存快照
    //（SIGKILL 兜底靠上一次原子快照）。persistence/sessionManager 为 null 时 no-op。
    if (this._persistence && this._sessionManager) {
      try {
        await this._sessionManager.flush();
      } catch (e) {
        this._logger.warn('session_flush_on_stop_failed', { error: e });
      }
    }

    // task-08：上方 flush 只写 store snapshot（active 会话）——遗留待恢复记录
    //（recover 网络失败重试队列）不在 store，需合并回写 sessions.json，否则
    // 长时间 backend 故障期间停止 daemon 会把保留记录静默丢档（R6 语义回归）。
    await this._persistPendingRecoveryRecords();

    // ql-20260624-006：释放 runtime lock（启动期 acquire 的单实例 lock）。
    // SIGKILL/断电未走到此 → 下次启动靠 pid 存活检测回收 stale lock。
    if (this._lockManager) {
      try {
        await this._lockManager.releaseAll();
      } catch (e) {
        this._logger.warn('runtime_lock_release_failed', { error: e });
      }
    }

    this._closeWsClient();
    // 关闭 HTTP（真实 HubClient.close 是同步 void no-op）
    try {
      this._client.close();
    } catch (e) {
      this._logger.warn('client_close_failed', { error: e });
    }

    this._logger.info('stopped');
  }

  // ── task-03（S2/S3）：磁盘旁路探测 + pending-update 方法组 ──────────────────
  // 契约（provides DiskProbeAndPending，task-04 接线 / task-05 心跳消费）：
  //   - startDiskProbe(onDiskChange)：探测循环，差异出口**仅**注入式回调——本卡
  //     不实现也不引用 tryUpdate 编排（差异处置归 task-04 汇合接线）。
  //   - writePendingUpdate / clearPendingUpdate / readPendingUpdate / pendingUpdatePath：
  //     pending-update.json 落盘（推迟升级可见性，FR-01）。

  /** task-03（S3）：pending-update.json 路径（cli status / task-05 心跳同源读取）。 */
  get pendingUpdatePath(): string {
    return this._pendingUpdatePath;
  }

  /** task-03（S2）：磁盘探测循环是否在跑（「interval=0 不创建定时器」断言用）。 */
  get diskProbeActive(): boolean {
    return this._diskProbeTimer !== null;
  }

  /**
   * task-03（S2 / FR-03 / D-003@v2）：启动磁盘旁路探测循环。
   *
   * 每间隔（config.self_reload_check_interval_sec，默认 600s）读 bundle 文件按
   * `BUILD_ID` 正则提取与内存 BUILD_ID 比对；**任何差异（含降级）** 调
   * onDiskChange(盘上值)——每轮至多一次，多轮仍差异则每轮再触发（去抖/刷新语义
   * 由 task-04 的 pending 路径收口）。操作者换文件即意图，不做 manifest 校验。
   *
   * 不动作（仅 debug 日志，防替换窗口半写文件自杀，D-003@v2）：
   *   - 读文件失败 / 正则不中 / 盘上提取值为空（任一侧空）
   *   - dev 构建（BUILD_ID='dev'，本地开发无 SHA，与 preflight 同判定）
   *   - interval <= 0 / 非数值：**不创建定时器**（0=显式关闭）
   *
   * 定时器 unref（不阻止进程退出）；重复调用先清旧定时器（幂等单实例）；
   * stop() 统一清理。接线（start() 内调用）归 task-04。
   *
   * @param onDiskChange 差异回调，参数为盘上 bundle 提取的 BUILD_ID（目标版本）。
   */
  startDiskProbe(onDiskChange: (diskBuildId: string) => void): void {
    // interval 读取口：config 默认 600；0=关闭。Number() 容忍字符串脏值，
    // 非法/<=0 一律视为关闭不创建定时器（对齐 _recoveryConcurrency 的兜底惯例）。
    const intervalSec = Number(this._config.self_reload_check_interval_sec);
    if (!Number.isFinite(intervalSec) || intervalSec <= 0) {
      this._logger.debug('disk_probe_disabled', {
        interval_sec: this._config.self_reload_check_interval_sec,
      });
      return;
    }
    // dev 构建跳过探测：无 SHA 注入，盘上 release bundle 与内存 'dev' 恒不等，
    // 跑了只会每轮徒劳触发差异（preflight runDaemonSelfUpdate 同判定）。
    // 显式放宽为 string 再比对：BUILD_ID 是 gen-build-id.mjs 生成的字面量常量，
    // 当前值非 'dev' 时字面量类型会让 `=== 'dev'` 被 tsc 判无重叠（dev 构建下
    // 该常量即 'dev'，运行时判定有意义）。
    const memoryBuildId: string = BUILD_ID;
    if (!memoryBuildId || memoryBuildId === 'dev') {
      this._logger.debug('disk_probe_skipped_dev_build', { build_id: memoryBuildId });
      return;
    }
    // 幂等：已探测中先清旧定时器再重建（不叠多个循环）。
    this._stopDiskProbe();
    this._diskProbeTimer = setInterval(() => {
      // 探测读文件/回调异常不冒泡到定时器（unhandled rejection 会杀进程），
      // 对齐 daemon.ts void 分发 + .catch 收敛惯例；下轮照常。
      void this._probeDiskOnce(onDiskChange).catch((e) => {
        this._logger.error('disk_probe_round_failed', { error: e });
      });
    }, intervalSec * 1000);
    // node 标准：定时器不阻塞 daemon 退出（fake timers 下 unref 可能缺省，守卫调用）。
    if (typeof this._diskProbeTimer.unref === 'function') {
      this._diskProbeTimer.unref();
    }
    this._logger.debug('disk_probe_started', {
      bundle_path: this._selfUpdateBundlePath,
      interval_sec: intervalSec,
    });
  }

  /** task-03（S2）：清磁盘探测定时器（stop() / startDiskProbe 重建前调用）。 */
  private _stopDiskProbe(): void {
    if (this._diskProbeTimer) {
      clearInterval(this._diskProbeTimer);
      this._diskProbeTimer = null;
    }
  }

  /**
   * task-03（S2）：单轮探测——读 bundle 提取 BUILD_ID 与内存比对。
   *
   * 失败即返回不动作（D-003@v2：探测失败 ≠ 版本变化）；差异恰好调用一次回调
   * （回调异常由 startDiskProbe 的 interval 包装 catch 收敛，不中断后续轮次）。
   */
  private async _probeDiskOnce(
    onDiskChange: (diskBuildId: string) => void,
  ): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this._selfUpdateBundlePath, 'utf-8');
    } catch (e) {
      // 文件不存在（未 install）/ 替换窗口半写 → 本轮放弃，下轮再试。
      this._logger.debug('disk_probe_read_failed', {
        path: this._selfUpdateBundlePath,
        error: (e as Error)?.message ?? String(e),
      });
      return;
    }
    const diskBuildId = DISK_BUILD_ID_RE.exec(raw)?.[1] ?? '';
    if (!diskBuildId) {
      // 正则不中 / 提取值为空（任一侧空，内存侧已由 startDiskProbe 非 dev 保证）。
      this._logger.debug('disk_probe_build_id_missing', {
        path: this._selfUpdateBundlePath,
      });
      return;
    }
    if (diskBuildId === BUILD_ID) {
      // 同值：静默（默认 10min 一轮，避免日志噪音）。
      return;
    }
    this._logger.info('disk_change_detected', {
      disk_build_id: diskBuildId,
      memory_build_id: BUILD_ID,
    });
    // 差异出口：恰一次，含目标（盘上）BUILD_ID。
    onDiskChange(diskBuildId);
  }

  /**
   * task-03（S3 / FR-01）：写 pending-update.json（推迟升级可见性）。
   *
   * 四字段：reason / current_version / target_version / since（=Date.now()）。
   * 原子写照 interactive/session-store-persistence 惯例：同目录 tmp 文件 →
   * rename 落位（POSIX rename 原子；Windows rename 目标存在会失败 → 先 unlink
   * 再 rename），0o600（Windows NTFS 无 0600 语义，失败降级忽略）。同内容续写
   * 不重置 since 的去重语义归 task-04 调用方。
   */
  async writePendingUpdate(record: {
    reason: string;
    current_version: string;
    target_version: string;
  }): Promise<void> {
    const payload: PendingUpdateRecord = {
      reason: record.reason,
      current_version: record.current_version,
      target_version: record.target_version,
      since: Date.now(),
    };
    const body = JSON.stringify(payload, null, 2);
    await mkdir(dirname(this._pendingUpdatePath), { recursive: true });
    // 同目录临时文件：rename 不跨设备（同分区）。
    const tmpPath = `${this._pendingUpdatePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmpPath, body, 'utf-8');
    try {
      await chmod(tmpPath, 0o600);
    } catch {
      // POSIX chmod 失败 / Windows 无 0600 语义 → 降级不中断（惯例 R-05）。
    }
    // R2（2026-08-30 审计）：直接 rename 覆盖（Node 的 rename 在 Windows 经
    // MoveFileExW(REPLACE_EXISTING)、POSIX rename(2) 均原子替换已存在目标）——
    // 不再无条件「先 unlink 再 rename」（旧注释前提错误，unlink↔rename 窗口
    // 心跳 readPendingUpdate 会读到 ENOENT → backend 清 pending → since 重置）。
    // rename 失败（目标被短暂锁定的兜底路径）才退回 unlink+rename 重试。
    try {
      await rename(tmpPath, this._pendingUpdatePath);
    } catch {
      try {
        await unlink(this._pendingUpdatePath);
      } catch {
        // 目标不存在（首写）/ 并发已清：忽略，重试 rename。
      }
      try {
        await rename(tmpPath, this._pendingUpdatePath);
      } catch {
        // rename 二次失败兜底：直接写目标（牺牲原子性但保证最终落盘）。
        await writeFile(this._pendingUpdatePath, body, 'utf-8');
        await chmod(this._pendingUpdatePath, 0o600).catch(() => undefined);
        await unlink(tmpPath).catch(() => undefined);
      }
    }
    this._logger.info('pending_update_written', {
      reason: payload.reason,
      current_version: payload.current_version,
      target_version: payload.target_version,
    });
  }

  /**
   * task-03（S3）：删除 pending-update.json（升级执行 / 取消 / noop 路径调用）。
   *
   * 不存在 = 幂等成功（忽略 ENOENT）；其他失败仅 warn 不抛（清除路径在收尾链上，
   * 抛错会阻断 stop/respawn 编排；残留由下次启动 cleanupStalePendingUpdate 兜底）。
   */
  async clearPendingUpdate(): Promise<void> {
    try {
      await unlink(this._pendingUpdatePath);
      this._logger.info('pending_update_cleared', {});
    } catch (e) {
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        // 已不存在：幂等成功，静默。
        return;
      }
      this._logger.warn('pending_update_clear_failed', {
        error: (e as Error)?.message ?? String(e),
      });
    }
  }

  /**
   * task-03（S3）：读取当前 pending 记录（task-05 心跳「仅 pending 期间携带
   * pending_update 字段」的读取口）。无 / 无效 → null（心跳不带字段）。
   */
  async readPendingUpdate(): Promise<PendingUpdateRecord | null> {
    return readPendingUpdateFile(this._pendingUpdatePath);
  }

  /**
   * task-03（S3 / Grill M15）：启动清矛盾 pending 残留。
   *
   * 判定（design S3）：文件存在且 target_version == 内存 BUILD_ID（升级已完成，
   * 矛盾）或结构无效（reason 等字段缺失）→ 删除；target ≠ 内存（仍在途推迟）→
   * 保留。防「升级后删除失败」导致本地 status / 心跳永久展示过期等待。start()
   * 已接线（preflight 后、三循环前）；亦导出为公开方法供测试直接调用。
   */
  async cleanupStalePendingUpdate(): Promise<void> {
    const record = await this.readPendingUpdate();
    if (record !== null && record.target_version !== BUILD_ID) {
      // 仍在途：盘上 ≠ 内存，保留给 status / 心跳展示。
      this._logger.debug('pending_update_kept', {
        target_version: record.target_version,
        current_build_id: BUILD_ID,
      });
      return;
    }
    // record===null 但文件可能存在（损坏/缺字段）→ clear 兜底删；不存在 → no-op。
    await this.clearPendingUpdate();
    this._logger.debug('pending_update_stale_removed', {
      target_version: record?.target_version ?? null,
    });
  }

  // ── task-04（S1）：自更新单入口编排器 tryUpdate ──────────────────────────────
  // 契约（consumes task-01 BusyCheckApi + task-03 DiskProbeAndPending）：
  //   SELF_UPDATE 指令（WS）与磁盘探测差异（startDiskProbe 回调）都汇入
  //   _tryUpdate(reason, targetVersion)——所有权占位/忙推迟（pending+30s 复查）/
  //   空闲按 reason 分流（server_command 走 runDaemonSelfUpdate 升级链 + stop 前
  //   终检；disk_change 不下载直启）/交接排定后所有权持有到进程退出。

  /**
   * task-04：preflight 的 PreflightLogger((level,msg,data)) → 内部 Logger 方法
   * 适配（runDaemonSelfUpdate / fetchLatestBuildId / respawnDaemonAndExit 三处
   * 共用，同 start() 内 runPreflight 的适配写法）。
   */
  private _preflightLog(
    level: 'debug' | 'info' | 'warn' | 'error',
    msg: string,
    data?: Record<string, unknown>,
  ): void {
    this._logger[level](msg, data);
  }

  /**
   * task-04（S1 / FR-01 / D-001@v1）：升级忙判定——纯同步查询。
   *
   * 口径：sessionManager 存在「在跑轮次」（SessionState.status==='running'，
   * hasRunningTurn；'reconnecting' 恢复中间态不算忙）或 taskRunner 存在「在跑
   * batch lease」（hasActiveLease：_controllers 非空）。task-06
   * （2026-08-30-daemon-self-heal / D-002）新增第三臂：心跳降级恢复在途
   * （`_recoverInFlight`）也算忙——恢复中途不被 selfupdate stop 打断；反向
   * selfupdate 已过忙判定进入 stop 流程时心跳已停、无恢复触发点，天然互斥。
   * **同步性是终检（Grill B3）的前提**：终检与 stop() 首动作之间不得有 await——
   * 本方法内任何 await 都会把竞态窗口从毫秒级放大到一次 IO。taskRunner 缺
   * hasActiveLease（旧测试 mock）视为不忙（TaskRunnerLike 可选方法先例，Grill M14）。
   */
  private _isBusyForUpdate(): boolean {
    // task-06（D-002）：恢复在途也算忙（置于最前——最廉价的纯标志查询）。
    if (this._recoverInFlight) return true;
    if (this._sessionManager?.hasRunningTurn() === true) return true;
    if (
      typeof this._taskRunner?.hasActiveLease === 'function' &&
      this._taskRunner.hasActiveLease() === true
    ) {
      return true;
    }
    return false;
  }

  /**
   * task-04（S1 / D-002@v1）：忙推迟——释放所有权 + 写 pending + 排/刷新 30s 复查。
   *
   * 生命周期约定（design Grill M05/M19）：进入推迟态即释放所有权（推迟期不占，
   * 新触发可再入——仅刷新 pending 目标、定时器 clear+set 不叠）；离开推迟态
   * （升级执行/noop/异常）必清定时器（_clearUpdateRetryTimer，防 noop 后 30s
   * 死循环）；reason 取最新触发（server_command 与 disk_change 等价，谁后到
   * pending 显示谁——writePendingUpdate 整体覆盖天然满足）。
   *
   * 目标版本解析：disk_change 恒携带盘上 BUILD_ID；server_command 优先 WS 指令
   * version，缺失时拉 latest.json（fetchLatestBuildId 等价接口）兜底，仍失败用
   * '<disk>' 占位（可见性字段，不参与升级判定——升级与否由 runDaemonSelfUpdate
   * /盘上文件决定）。
   */
  private async _deferUpdate(
    reason: 'server_command' | 'disk_change',
    targetVersion?: string,
  ): Promise<void> {
    // 先释放再落盘/排时：此后即便有新触发穿插（写 pending 竞态）也只是刷新目标。
    this._updateBusy = false;
    let target = targetVersion;
    if (!target) {
      // 仅 server_command 可能缺目标（disk_change 回调恒带盘上 BUILD_ID）。
      // fetchLatestBuildId 内部全收敛不抛，try/catch 为防御性兜底。
      try {
        target =
          (await fetchLatestBuildId(this._config, this._preflightLog.bind(this)))
          ?? undefined;
      } catch {
        target = undefined;
      }
    }
    const resolved = target ?? SELF_UPDATE_TARGET_UNKNOWN;
    await this.writePendingUpdate({
      reason,
      current_version: BUILD_ID,
      target_version: resolved,
    });
    this._scheduleUpdateRetry(reason, resolved);
  }

  /**
   * task-04（S1 / D-002）：排/刷新 30s 空闲复查定时器（unref）。
   *
   * 已有 pending 仅刷新不叠：clearTimeout 再 setTimeout（单实例定时器）。到点
   * 完整重跑 _tryUpdate（携带已解析目标，避免每 30s 重拉 latest.json）——每轮
   * 从零重探，无 drain-hook 状态机（D-002 明示不做）。
   */
  private _scheduleUpdateRetry(
    reason: 'server_command' | 'disk_change',
    targetVersion: string,
  ): void {
    if (this._updateRetryTimer) clearTimeout(this._updateRetryTimer);
    this._updateRetryTimer = setTimeout(() => {
      this._updateRetryTimer = null;
      // R1（2026-08-30 审计）：daemon 已停/停机中不触发升级复查——stop() 已清本
      // 定时器，此守卫兜底「_deferUpdate 的 await 晚于 stop 清理点又排了新定时
      // 器」的窗口（SDK 子进程句柄可使进程存活到 +30s，期间定时器仍会到点）。
      if (!this._running) {
        this._logger.debug('self_update_retry_skipped_stopped');
        return;
      }
      // _tryUpdate 全路径内部 catch 收敛不 reject；.catch 为防御性兜底（惯例）。
      void this._tryUpdate(reason, targetVersion).catch((e) => {
        this._logger.error('self_update_retry_failed', { error: e });
      });
    }, SELF_UPDATE_RETRY_INTERVAL_MS);
    if (typeof this._updateRetryTimer.unref === 'function') {
      this._updateRetryTimer.unref();
    }
    this._logger.debug('self_update_retry_scheduled', {
      reason,
      target_version: targetVersion,
      interval_ms: SELF_UPDATE_RETRY_INTERVAL_MS,
    });
  }

  /** task-04（S1）：清 30s 复查定时器——离开推迟态（升级执行/noop/异常）必调。 */
  private _clearUpdateRetryTimer(): void {
    if (this._updateRetryTimer) {
      clearTimeout(this._updateRetryTimer);
      this._updateRetryTimer = null;
    }
  }

  /**
   * task-04（S1 / Grill B2+B3 修正）+ task-07（D-009 stop 前主拦截）：自更新
   * 单入口编排器。
   *
   * 流程（design S1 + S4 主拦截点）：
   *   1. 所有权占位：已占（另一次 _tryUpdate 在途）→ 本次忽略仅记 debug。
   *   2. 忙判定（_isBusyForUpdate）忙 → 推迟（_deferUpdate：释放+pending+30s）。
   *   3. 空闲按 reason 分流：
   *      - server_command → runDaemonSelfUpdate 下载原子替换（false=noop →
   *        释放+清 pending+清定时器）→ true → validateBundleOnDisk 校验盘上
   *        bundle（D-009：拦落盘后被写坏，坏盘 warn+释放+清 pending 返回）→
   *        ★终检（重跑 _isBusyForUpdate，忙回推迟；**终检与 stop() 首动作之间
   *        不得有 await**，竞态窗口毫秒级——校验必须在终检之前，GAP-1）→ stop()
   *        （挂起空闲会话，D-001）→ respawnDaemonAndExit（交接）。
   *      - disk_change → 不下载不查 manifest，先 validateBundleOnDisk 校验盘上
   *        bundle（D-009：拦外部写入的坏盘，坏盘同款中止）→ 校验后重跑忙判定
   *        （GAP-1：async 校验打破「入口判定即终检」，以重跑补偿；忙回推迟）→
   *        stop() → respawn 到盘上版本（操作者换文件即意图，multica trySelfReload
   *        同款——防磁盘降级/盘≠manifest 被 runDaemonSelfUpdate 的防降级/noop
   *        挡成永不收敛）。
   *   4. 一切非「交接排定」路径释放所有权+清 pending 可再触发；交接排定后所有
   *      权保持到进程退出。坏盘中止（daemon_update_aborted_bad_bundle）亦释放
   *      所有权——旧进程完整在线，盘修复后下次触发正常重试。
   *
   * 注：disk_change 原本「入口忙判定即终检、到 stop() 零 await」被 task-07 的
   * async 校验打破，改为校验后重跑 _isBusyForUpdate（重跑点与 stop() 首动作之间
   * 零 await）；server_command 因下载 await 挂起存在窗口，校验放在终检之前，
   * 终检与 stop() 首动作之间保持零 await（GAP-1 顺序钉扎，两路径一致满足）。
   *
   * 校验目录取 dirname(_selfUpdateBundlePath)（探测所读同一路径，D-006 同款
   * 可注入口径）：生产默认值 dirname 后即 DAEMON_BIN_DIR，行为不变；测试经
   * DaemonOptions.selfUpdateBundlePath 注入临时目录即可隔离——不再硬编码
   * HOME 常量（集成测试环境无 ~/.sillyhub 部署时校验必挂，CI 环境依赖）。
   */
  private async _tryUpdate(
    reason: 'server_command' | 'disk_change',
    targetVersion?: string,
  ): Promise<void> {
    // 所有权占位（JS 单线程下 check+set 原子）。推迟态所有权已释放，不在此列；
    // 在途的下载 await 挂起期间到达的新触发在这里被忽略（推迟信息由在途那次
    // 自身的 defer/终检路径收口）。
    if (this._updateBusy) {
      this._logger.debug('self_update_skipped_inflight', { reason });
      return;
    }
    this._updateBusy = true;
    try {
      if (this._isBusyForUpdate()) {
        this._logger.info('self_update_deferred_busy', {
          reason,
          target_version: targetVersion,
        });
        await this._deferUpdate(reason, targetVersion);
        return;
      }
      if (reason === 'disk_change') {
        this._logger.info('self_update_disk_change_restart', {
          target_version: targetVersion,
        });
        // task-07（D-009 主拦截）：分流后、stop 之前校验盘上 bundle——探测到版本
        // 变化 ≠ 内容可信，拦外部写入的坏盘。校验不过 → warn + 释放所有权 +
        // 清 pending + return：不走 stop/respawn，旧进程完整在线（WS/心跳/会话
        // 未动），盘修复后下次触发（磁盘探测 600s 周期或下条指令）正常重试
        // （不再被 skipped_inflight 挡成僵尸）。
        const bundleOk = await validateBundleOnDisk(
          dirname(this._selfUpdateBundlePath),
          this._preflightLog.bind(this),
          'disk_change',
        );
        if (!bundleOk) {
          this._logger.warn('daemon_update_aborted_bad_bundle', {
            reason,
            target_version: targetVersion,
          });
          this._updateBusy = false;
          this._clearUpdateRetryTimer();
          await this.clearPendingUpdate();
          return;
        }
        // GAP-1 顺序钉扎（D-009 / Grill GAP-1）：本路径原本「入口忙判定即终检、
        // 判定后到 stop() 之间零 await」——上方 async 校验打破了该前提，故校验
        // 返回后必须重跑 _isBusyForUpdate()（忙 → 走既有推迟路径）补偿终检语义；
        // 重跑点与 stop() 首动作之间保持零 await。禁止把 await validateBundleOnDisk
        // 插在忙终检与 stop() 之间（会把竞态窗口从毫秒级放大到一次文件 IO）。
        if (this._isBusyForUpdate()) {
          this._logger.info('self_update_final_check_busy', {
            target_version: targetVersion,
          });
          await this._deferUpdate(reason, targetVersion);
          return;
        }
        // 离开推迟态（升级执行）必清定时器，再走 stop → 交接。
        this._clearUpdateRetryTimer();
        await this.stop();
        // 交接排定：所有权保持到进程退出，不释放。
        respawnDaemonAndExit(this._preflightLog.bind(this));
        return;
      }
      // server_command：现有升级链（下载+tmp+rename 原子替换；false=已最新/
      // 防降级/拉取下载失败，内部已 warn）。
      const updated = await runDaemonSelfUpdate(
        BUILD_ID,
        this._config,
        this._preflightLog.bind(this),
      );
      if (!updated) {
        // noop：释放所有权+清 pending+清复查定时器（防 noop 后 30s 死循环），
        // 新指令可再触发。
        this._updateBusy = false;
        this._clearUpdateRetryTimer();
        await this.clearPendingUpdate();
        this._logger.info('self_update_noop', { target_version: targetVersion });
        return;
      }
      // task-07（D-009 主拦截）：下载替换成功后（盘上已是新内容）、★忙终检之前
      // 校验盘上 bundle——拦「下载内容可信但落盘后、拉起前盘又被写坏」的窗口。
      // GAP-1 顺序钉扎：validateBundleOnDisk 是 async，校验点必须保持在忙终检
      // （下方 _isBusyForUpdate）之前——终检与 stop() 首动作之间不得插入任何
      // await（否则把竞态窗口从毫秒级放大到一次文件 IO）。校验不过 → warn +
      // 释放所有权 + 清 pending + return：不走终检/stop/respawn，旧进程完整在线
      // （WS/心跳/会话未动），盘修复后下次触发（磁盘探测 600s 周期或下条指令）
      // 正常重试（不再被 skipped_inflight 挡成僵尸）。
      const bundleOk = await validateBundleOnDisk(
        dirname(this._selfUpdateBundlePath),
        this._preflightLog.bind(this),
        'server_command',
      );
      if (!bundleOk) {
        this._logger.warn('daemon_update_aborted_bad_bundle', {
          reason,
          target_version: targetVersion,
        });
        this._updateBusy = false;
        this._clearUpdateRetryTimer();
        await this.clearPendingUpdate();
        return;
      }
      // ★终检（Grill B3）：下载 await 挂起期间可能新起了 turn/lease——stop 前
      // 重跑忙判定，忙则不打断回推迟。终检与 stop() 首动作之间不得有 await。
      if (this._isBusyForUpdate()) {
        this._logger.info('self_update_final_check_busy', {
          target_version: targetVersion,
        });
        await this._deferUpdate(reason, targetVersion);
        return;
      }
      this._logger.info('self_update_done', { target_version: targetVersion });
      // 离开推迟态（升级执行）必清定时器；stop 必须先于 respawn——新进程
      // acquire runtime lock 时旧进程已释放（无竞态）。
      this._clearUpdateRetryTimer();
      await this.stop();
      // 交接排定：所有权保持到进程退出（respawn 内部 500ms 后 exit(0)）。
      respawnDaemonAndExit(this._preflightLog.bind(this));
    } catch (e) {
      // 兜底 catch：runDaemonSelfUpdate / respawnDaemonAndExit 均内部收敛不抛，
      // 能到这里的只有 stop()/pending 落盘意外——释放所有权+清 pending（升级未
      // 排定，新触发可再入）+ warn。
      //
      // respawn 失败停摆语义（design S1 / Grill M07）：spawn 在 stop() 之后，
      // 失败时进程已停摆（WS/心跳已关）——「保活」指进程不退出待人工/看护介入，
      // backend 45s 判 offline 可见；该路径 preflight 内部吞掉不上抛，**到不了
      // 本 catch**，此处释放所有权仅为语义自洽（无消费者）。
      this._updateBusy = false;
      this._clearUpdateRetryTimer();
      try {
        await this.clearPendingUpdate();
      } catch {
        // clearPendingUpdate 自身 warn 收敛不抛，防御性兜底。
      }
      this._logger.warn('self_update_failed', {
        reason,
        error: (e as Error)?.message ?? String(e),
      });
    }
  }

  // ── 内部：register 单个 agent（task-17 HubClient.register）─────────────────

  private async _markRegisteredRuntimesOffline(): Promise<void> {
    if (!this._client.markOffline) return;
    const runtimeIds = [...new Set(this._registeredRuntimes.values())].filter(Boolean);
    await Promise.allSettled(
      runtimeIds.map(async (rid) => {
        try {
          await this._client.markOffline!(rid);
          this._logger.info('runtime_marked_offline', { runtime_id: rid });
        } catch (e) {
          this._logger.warn('runtime_mark_offline_failed', { runtime_id: rid, error: e });
        }
      }),
    );
  }

  /**
   * task-08（design A5 / FR-04）：优雅停止挂起——POST suspend-batch（按
   * daemon_local_id = config.runtime_id）让 backend 把本 daemon 全部 active
   * 会话单事务三步收敛（中断 run→failed(daemon_stopped)、session→suspended、
   * 挂起 lease→cancelled，幂等可重入）。
   *
   * 失败仅结构化日志降级（不阻断 stop 收尾）：网络已断时与强杀等价，backend
   * 600s offline sweep 兜底收敛 suspended（design A5 已声明行为，代价是 fallback
   * 路径下前端最长 600s 仍显示 active）。旧 mock client 未实现 suspendSessions
   *（ClientLike 可选方法）同样跳过，现有测试构造点零改动。
   */
  private async _suspendSessionsOnStop(): Promise<void> {
    if (typeof this._client.suspendSessions !== 'function') return;
    try {
      const resp = (await this._client.suspendSessions(
        this._config.runtime_id,
      )) as { suspended?: number; runs_failed?: number } | null;
      this._logger.info('daemon_stop_sessions_suspended', {
        daemon_local_id: this._config.runtime_id,
        suspended: resp?.suspended ?? 0,
        runs_failed: resp?.runs_failed ?? 0,
      });
    } catch (e) {
      this._logger.warn('daemon_stop_suspend_failed', {
        daemon_local_id: this._config.runtime_id,
        error: e,
      });
    }
  }

  /**
   * per-daemon 注册（design §5.2 / D-006）。
   *
   * 单次 POST /register 上报 daemon_local_id（=config.runtime_id）+ 机器级字段
   * + 探测到的 provider 列表。backend 返回 ``{ daemon_instance_id, runtimes }``，
   * 本地把每个 provider → runtime_id 存入 ``_registeredRuntimes``（WS payload 标识
   * 具体 provider 会话用）。同时维护 ``_agentPaths``（provider → 本机 path）。
   *
   * 失败隔离：整个注册失败只 warn，不抛（保持与旧 _registerOne「单失败不中断」语义；
   * 此处是整体失败=所有 provider 都没注册上，但仍不阻断三循环启动——daemon 会等
   * 下次心跳周期重试由上层编排处理）。
   */
  private async _registerDaemon(agents: DetectedAgent[]): Promise<void> {
    const serverUrl = this._serverOrigin();
    const providers = agents.map((a) => ({
      provider: a.provider,
      version: a.version ?? undefined,
      status: 'online',
    }));
    try {
      // 2026-08-31-machine-sillyspec-version task-05（design §1 启动衔接）：注册前
      // manager 做一次探测（本机版本 + npm latest），让 register 报文即带版本
      //（D-002@v1 直接落值语义——null 也落，本机卸载后重启即借此清列）。
      // update 启动时恒无（manager 刚构造，无升级状态）。探测异常不阻断注册
      //（快照保持未知 → sillyspec 参数缺省，键不出现）。
      try {
        await this._sillyspecManager.probeLocal();
        await this._sillyspecManager.probeLatest();
      } catch (e) {
        this._logger.warn('sillyspec_register_probe_failed', { error: e });
      }
      const snap = this._sillyspecManager.getSnapshot();
      const sillyspec: RegisterSillySpecParam | undefined =
        snap.version !== null || snap.latest_version !== null
          ? { version: snap.version, latest_version: snap.latest_version }
          : undefined;
      const resp = await this._client.register({
        daemonLocalId: this._config.runtime_id,
        serverUrl,
        hostname: hostname(),
        os: platform(),
        arch: arch(),
        allowedRoots: this._config.allowed_roots,
        // task-01：进程启动时间上报，backend 据此写 daemon_instances.started_at。
        startedAt: this._startedAt,
        providers,
        sillyspec,
      });
      // backend 返回 { daemon_instance_id, runtimes: [{provider, runtime_id, allowed_roots}] }
      const runtimes = (resp.runtimes ?? []) as {
        provider?: string;
        runtime_id?: string;
        allowed_roots?: string[];
      }[];
      for (const item of runtimes) {
        const providerName = item.provider;
        const runtimeId = String(item.runtime_id ?? '');
        if (providerName && runtimeId) {
          this._registeredRuntimes.set(providerName, runtimeId);
        }
        // 2026-07-06-allowed-roots-per-runtime task-07：register 响应 per-runtime
        // allowed_roots 立即初始化 PolicyCache（关闭首次写 fail-closed 窗口）。
        if (runtimeId && this._policyCache && Array.isArray(item.allowed_roots)) {
          const expanded = item.allowed_roots
            .filter((p): p is string => typeof p === 'string')
            .map((p) => p.replace(/^~(?=$|[/\\])/, homedir()));
          const union = new Set<string>(expanded);
          union.add(homedir());
          // FR-003：sillyspec 临时路径放行（c:\dev\null / /dev/null / tmpdir），
          // 与 permission-rules.ts CLI allow 同步（双重放行，R-01 写安全兜底）。
          for (const temp of SILLYSPEC_TEMP_ROOTS) union.add(temp);
          this._policyCache.set(runtimeId, normalizeAllowedRoots([...union]));
        }
      }
      // 兜底：仅当 backend 未返任何 per-runtime allowed_roots（旧 backend）时，
      // 才用 config.allowed_roots 给所有 runtime 设共享值。新 backend register
      // 响应总带 per-runtime allowed_roots（上方 task-07 已按 runtime 独立 set），
      // 无条件覆盖会冲掉用户配的值（ql-20260706-005）。
      const gotPerRuntime = runtimes.some((it) => Array.isArray(it.allowed_roots));
      if (!gotPerRuntime) {
        this._syncPolicyCache(this._config.allowed_roots);
      }
      // 维护 provider → 本机 path 映射（cmd_path 不来自 server，daemon 自维护）
      for (const a of agents) {
        if (a.path) {
          this._agentPaths.set(a.provider, a.path);
        }
      }
      this._logger.info('daemon_registered', {
        daemon_local_id: this._config.runtime_id,
        providers: [...this._registeredRuntimes.keys()],
      });
    } catch (e) {
      this._logger.error('daemon_register_failed', {
        daemon_local_id: this._config.runtime_id,
        error: e,
      });
    }
  }

  // ── task-10：daemon 启动崩溃恢复编排（§5）───────────────────────────────────

  /**
   * task-06（2026-08-30-daemon-self-heal / D-001+D-007）：心跳脱离降级后的恢复
   * 触发入口（含忙推迟复查）。
   *
   * 忙门控（D-007）：`_isBusyForUpdate()` 为真（在跑 interactive turn / 在跑
   * batch lease / 恢复已在途）→ 仅置 `_recoverPendingAfterDegraded` + warn
   * `session_recover_deferred_busy` 返回，**不清标志**——心跳每拍成功路径复查
   * （`_sendHeartbeatOnce` 触发条件的第二臂），空闲拍补触发（无新定时器）；
   * 本地在跑工作绝不被恢复链驱逐打断。
   *
   * 不忙：清 pending 标志 + 置 `_recoverInFlight`（`_isBusyForUpdate` 第三臂的
   * 数据源，D-002 与 selfupdate 双向互斥；**不参与触发判定**，见 GAP-2）→
   * await `_recoverPersistedSessions('heartbeat_recover')`（恢复主体内部全隔离
   * 不 reject，catch 仅防御性兜底防崩）→ finally 复位（异常路径也放行）。
   * 调用方 fire-and-forget，不阻塞心跳节拍。
   */
  private async _maybeRecoverAfterDegraded(degradedMs: number): Promise<void> {
    if (this._isBusyForUpdate()) {
      this._recoverPendingAfterDegraded = true;
      this._logger.warn('session_recover_deferred_busy', { degraded_ms: degradedMs });
      return;
    }
    this._recoverPendingAfterDegraded = false;
    this._recoverInFlight = true;
    try {
      await this._recoverPersistedSessions('heartbeat_recover');
    } catch (e) {
      // 不应到此（_recoverPersistedSessions 内部已全隔离），防御性兜底防崩。
      this._logger.error('session_recover_unexpected_error', { error: e });
    } finally {
      this._recoverInFlight = false;
    }
  }

  /**
   * 持久化会话恢复编排：load → 超龄清理 → 限流并发对每条记录 recover+restore →
   * flush → 遗留待恢复记录合并落盘。
   *
   * 触发来源（trigger，2026-08-30-daemon-self-heal task-05 参数化提取）：
   * - 'boot'：start() 内三循环启动前触发（本卡前为 boot 专用恢复方法，参数化更名）；
   * - 'heartbeat_recover'：心跳脱离降级后主动触发（由 task-06 接入，本卡仅落类型）。
   *   trigger 仅用于 session_recover_start/done 日志区分来源，不影响任何控制流。
   *
   * 顺序（§5）：boot 触发时在三循环（heartbeat/poll/ws）启动**前**完成全部恢复。
   * - 未注入 persistence/recoveryClient/sessionManager → no-op（Wave1/2 行为）。
   * - load 抛错（不应发生，persistence 内部已隔离）→ 记 warn 不崩。
   * - 单条记录失败（backend rejected 或 driver.start 抛错）→ 结构化 warn 后
   *   继续其他记录，不崩 daemon（失败隔离）。
   * - task-08：load 后先剔超龄 7 天记录（R6）；recover 网络类失败的记录保留
   *   入重试队列（_recoverOneSession 返回 'retry'），boot 收尾合并回写。
   * - 全部恢复完成后 flush（清 currentRunId / 无效记录）。
   */
  private async _recoverPersistedSessions(
    trigger: 'boot' | 'heartbeat_recover',
  ): Promise<void> {
    if (!this._persistence || !this._recoveryClient || !this._sessionManager) {
      // Wave1/2 行为：无持久化 / 无 recovery 端口 / 无 SessionManager → 不恢复。
      return;
    }
    let records: PersistedSessionRecord[];
    try {
      records = await this._persistence.load();
    } catch (e) {
      this._logger.warn('session_recover_load_failed', { error: e });
      return;
    }
    if (records.length === 0) {
      this._logger.debug('session_recover_no_records');
      return;
    }
    // task-08（R6 超龄清理）：启动先剔 lastActiveAt 距今超 7 天的陈旧记录——
    // backend suspended 会话 24h GC 早已收敛 failed，恢复无意义；防断网堆积的
    // 遗留记录无限滞留 sessions.json。
    const fresh: PersistedSessionRecord[] = [];
    let expired = 0;
    for (const record of records) {
      if (this._recoveryRecordExpired(record)) {
        expired += 1;
        this._logger.warn('session_recover_record_expired', {
          session_id: record.sessionId,
          last_active_at: record.lastActiveAt,
        });
        await this._markRecordRemoved(record);
      } else {
        fresh.push(record);
      }
    }
    if (fresh.length === 0) {
      this._logger.info('session_recover_done', {
        total: records.length,
        recovered: 0,
        failed: 0,
        expired,
        trigger,
      });
      return;
    }
    this._logger.info('session_recover_start', { count: fresh.length, trigger });

    // 限流并发（默认 4）：用 slot 池控制最大并发，单条失败不影响其他。
    const limit = this._recoveryConcurrency;
    const recovered = new Set<string>();
    const failed = new Set<string>();
    let cursor = 0;
    const workers: Promise<void>[] = [];
    const runOne = async (): Promise<void> => {
      while (cursor < fresh.length) {
        const idx = cursor++;
        const record = fresh[idx]!;
        try {
          const outcome = await this._recoverOneSession(record);
          if (outcome === 'recovered') recovered.add(record.sessionId);
          else failed.add(record.sessionId);
        } catch (e) {
          // 不应到此（_recoverOneSession 内已 try/catch），防御性兜底。
          this._logger.error('session_recover_unexpected_error', {
            session_id: record.sessionId,
            error: e,
          });
          failed.add(record.sessionId);
        }
      }
    };
    for (let i = 0; i < Math.min(limit, fresh.length); i++) {
      workers.push(runOne());
    }
    await Promise.all(workers);

    // 全部完成后 flush：清 currentRunId / 移除失败与 rejected 记录。
    try {
      await this._sessionManager.flush();
    } catch (e) {
      this._logger.warn('session_recover_flush_failed', { error: e });
    }
    // task-08：flush 只写 store snapshot——网络类失败保留的待恢复记录不在 store，
    // 合并回写防 boot 收尾把它们从 sessions.json 冲掉（保留语义）。
    await this._persistPendingRecoveryRecords();
    this._logger.info('session_recover_done', {
      total: records.length,
      recovered: recovered.size,
      failed: failed.size,
      expired,
      trigger,
    });
  }

  /**
   * 恢复单条记录（§5 单条流程）。返回三态（task-08）：
   *   - 'recovered'：恢复成功（reconnecting→active）；
   *   - 'dropped'：该记录未恢复且已从持久化移除（终态/rejected/driver 抛错/超龄）；
   *   - 'retry'：recover HTTP 网络类失败——本地记录保留并已入重试队列。
   *
   * 失败隔离：本方法不抛错（所有异常内部 catch + 结构化日志），让调用方
   * 的并发循环继续处理其他记录。
   */
  private async _recoverOneSession(
    record: PersistedSessionRecord,
  ): Promise<SessionRecoveryOutcome> {
    // daemon 注册的 runtime id（恢复对账需要）。取 record 对应 provider 的
    // 已注册 runtime；未注册 → 不恢复为 active（backend 会 reject）。
    const runtimeId = this._registeredRuntimes.get(record.provider) ?? '';
    if (!runtimeId) {
      this._logger.warn('session_recover_no_runtime', {
        session_id: record.sessionId,
        provider: record.provider,
      });
      // 仍向 backend 发 recover 让它收敛 currentRun（即使最后 rejected）。
    }

    let recoverStatus: SessionRecoverStatus;
    try {
      const resp = await this._recoveryClient!.recoverSession(record.sessionId, {
        leaseId: record.leaseId,
        runtimeId: runtimeId || (this._firstRegisteredRuntimeId() ?? ''),
        provider: record.provider,
        agentSessionId: record.agentSessionId,
        interruptedRunId: record.currentRunId,
      });
      recoverStatus = resp.status;
    } catch (e) {
      // task-08（design A5 / FR-04）：recover HTTP 网络类失败（请求未达/超时/5xx
      // ——HubHttpError 非 2xx，或 fetch 透传的原生网络异常；业务终态只以 2xx
      // 响应的 status 字段返回，见 backend recover_session_after_daemon_restart）
      // **不再删记录**——保留 sessions.json 记录入退避重试队列（30s 起步翻倍
      // 封顶 5min），backend 恢复（或 WS onConnected 立即重试）后继续走完
      // reconnecting→active（D-001 任意时长重启后可继续对话）。
      this._logger.error('session_recover_call_failed', {
        session_id: record.sessionId,
        error: e,
      });
      const queued = await this._enqueueRecoveryRetry(record);
      return queued ? 'retry' : 'dropped';
    }

    // backend 终态/rejected → 不调 restoreAndReconnect；删本地记录。
    if (recoverStatus !== 'reconnecting') {
      this._logger.info('session_recover_skipped', {
        session_id: record.sessionId,
        backend_status: recoverStatus,
      });
      await this._markRecordRemoved(record);
      return 'dropped';
    }

    // backend reconnecting → driver.start({resume}) 跨进程恢复（spike D3）。
    try {
      await this._sessionManager!.restoreAndReconnect(record);
    } catch (e) {
      // ql-20260831-001-6dde：本地该会话仍有在途 turn（status=running 或待处理
      // 输入）——驱逐会杀在途工作。入恢复重试队列（复用网络失败退避路径，
      // 30s 起步），turn 结束后下一轮恢复再重建；backend 侧 reconnecting 由
      // 重试成功收口，不写 failed、不删本地记录。
      if (e instanceof SessionBusyError) {
        this._logger.warn('session_restore_busy_retry', {
          session_id: record.sessionId,
          status: record.currentRunId != null ? 'running' : 'active',
        });
        const queued = await this._enqueueRecoveryRetry(record);
        return queued ? 'retry' : 'dropped';
      }
      // restoreAndReconnect 抛错（cwd 不一致 / executable 缺失 / SDK jsonl 缺失）：
      // session 已被 SessionManager 从内存 store 移除 + onSessionEnd(failed)。
      // 这里向 backend 写 reconnecting→failed + 删记录。继续其他记录。
      this._logger.error('session_restore_failed', {
        session_id: record.sessionId,
        error: e,
      });
      await this._notifyRecoveryFailed(record);
      await this._markRecordRemoved(record);
      return 'dropped';
    }

    // P1-1（2026-06-18）：去掉 stillAlive 短路判断。
    // 原逻辑用 `sessionManager.get(sessionId) !== undefined` 判断 driver 是否异步
    // onError 失败，但 driver.start 同步返回且 consume 是 fire-and-forget 协程，
    // 异步 onError 在本同步点尚未触发 → stillAlive 恒 true，短路判断无效。
    // 恢复成功只以 markReconnected 成功为准；恢复后**异步**的 driver onError →
    // SessionManager.fail → onSessionEnd(failed) 由 markRecoveredSessionFailed
    // 桥接到 backend markRecoveryFailed（见该方法注释）。

    // 恢复成功：reconnecting → active；向 backend confirm。
    try {
      await this._sessionManager!.markReconnected(record.sessionId);
    } catch (e) {
      this._logger.warn('session_mark_reconnected_failed', {
        session_id: record.sessionId,
        error: e,
      });
      await this._notifyRecoveryFailed(record);
      await this._markRecordRemoved(record);
      return 'dropped';
    }
    try {
      await this._recoveryClient!.confirmReconnected(record.sessionId);
    } catch (e) {
      // confirm 失败：本地已 active，但 backend 仍 reconnecting。由 task-07
      // 空闲扫描或人工 end 收口（§7 边界 5）。记 warn 不回滚本地 active。
      this._logger.warn('session_confirm_reconnected_failed', {
        session_id: record.sessionId,
        error: e,
      });
    }
    // P1-1：登记到恢复成功集合，让后续异步 fail 能桥接到 backend markRecoveryFailed。
    this._recoveredSessionIds.add(record.sessionId);
    // 恢复成功后 flush（清 currentRunId）。
    try {
      await this._sessionManager!.flush();
    } catch {
      /* flush 失败不影响 session 运行（恢复索引非运行依赖） */
    }
    this._logger.info('session_recovered', { session_id: record.sessionId });
    return 'recovered';
  }

  /**
   * P1-1（2026-06-18）：恢复成功后**异步** driver onError → SessionManager.fail
   * → onSessionEnd(failed) 的桥接入口。
   *
   * SessionManager 的 onSessionEnd 回调由外部注入（cli.ts / 测试）。当回调收到
   * status='failed' 且 sessionId 属于本 daemon 恢复成功的集合时，注入方应调用本
   * 方法，daemon 据此向 backend 发 markRecoveryFailed（让 reconnecting/active
   * session 收敛为 failed，不卡在 reconnecting）。
   *
   * 非 recovered session（正常创建后 fail）调用本方法是 no-op（集合不含）。
   * 幂等：集合 delete 重复安全；markRecoveryFailed 失败只记 warn 不抛。
   */
  async markRecoveredSessionFailed(sessionId: string): Promise<void> {
    if (!this._recoveredSessionIds.has(sessionId)) return;
    this._recoveredSessionIds.delete(sessionId);
    if (!this._recoveryClient) return;
    try {
      await this._recoveryClient.markRecoveryFailed(sessionId);
    } catch (e) {
      this._logger.warn('recovered_session_fail_notify_failed', {
        session_id: sessionId,
        error: e,
      });
    }
  }

  /** 向 backend 通知恢复失败（reconnecting → failed）。失败本身静默（不复活）。 */
  private async _notifyRecoveryFailed(record: PersistedSessionRecord): Promise<void> {
    if (!this._sessionManager || !this._recoveryClient) return;
    try {
      // SessionManager.fail 已被 restoreAndReconnect 抛错路径或 onError 路径调用
      //（onSessionEnd(failed)），这里幂等再调一次（fail 内部幂等）+ 通知 backend。
      await this._sessionManager.fail(record.sessionId);
    } catch {
      /* fail 幂等，session 可能已不在 store */
    }
    try {
      await this._recoveryClient.markRecoveryFailed(record.sessionId);
    } catch (e) {
      this._logger.warn('session_mark_recovery_failed_call_failed', {
        session_id: record.sessionId,
        error: e,
      });
    }
  }

  /**
   * 把单条记录从持久化集合移除（终态/rejected/driver 抛错路径）。
   *
   * 实现：直接调 persistence.save，写入合并快照（SessionManager.
   * snapshotPersistable() 的结果 + 重试队列遗留记录；已恢复成功的 session 仍在；
   * 失败/终态的 session 因不在 _store 而被自动剔除）。不依赖 SessionManager.flush
   * 的 microtask 去抖，保证启动编排路径同步落盘正确的「移除后」状态。
   *
   * task-08：改写合并快照——单独删一条终态记录时不能把重试队列里的保留记录
   * 从 sessions.json 一并冲掉（保留语义，见 _mergedPersistableSnapshot）。
   */
  private async _markRecordRemoved(record: PersistedSessionRecord): Promise<void> {
    if (!this._persistence || !this._sessionManager) return;
    try {
      // 排除被移除的 sessionId（终态出队先于队列 delete，见 _mergedPersistableSnapshot）。
      const remaining = this._mergedPersistableSnapshot(record.sessionId);
      await this._persistence.save(remaining);
    } catch (e) {
      this._logger.warn('session_mark_removed_flush_failed', {
        session_id: record.sessionId,
        error: e,
      });
    }
  }

  // ── task-08（design A5 / FR-04）：recover 网络类失败重试队列 ──────────────────

  /** task-08（R6）：待恢复记录超龄判定（lastActiveAt 距今 > 7 天）。 */
  private _recoveryRecordExpired(record: PersistedSessionRecord): boolean {
    return Date.now() - record.lastActiveAt > RECOVERY_RECORD_MAX_AGE_MS;
  }

  /**
   * task-08：合并落盘快照 = snapshotPersistable()（store 内 active 会话）+
   * 重试队列遗留记录（不在 store，flush 只写 snapshot 会把它们从 sessions.json
   * 丢掉）。sessionId 去重——已成功恢复的记录以 store 快照为准。
   *
   * ``excludeSessionId``：正在被移除的记录（_markRecordRemoved 调用点）不参与
   * 合并——终态出队发生在队列 delete 之前，不排除会把刚删的记录又写回文件。
   */
  private _mergedPersistableSnapshot(excludeSessionId?: string): PersistedSessionRecord[] {
    const snapshot = this._sessionManager?.snapshotPersistable() ?? [];
    if (this._pendingRecovery.size === 0) return snapshot;
    const inSnapshot = new Set(snapshot.map((r) => r.sessionId));
    const merged = [...snapshot];
    for (const entry of this._pendingRecovery.values()) {
      if (entry.record.sessionId === excludeSessionId) continue;
      if (!inSnapshot.has(entry.record.sessionId)) merged.push(entry.record);
    }
    return merged;
  }

  /**
   * task-08：把重试队列遗留记录合并回写 sessions.json。
   *
   * 挂点：boot 收尾 flush 后、stop 收尾 flush 后、每轮重试后——对冲
   * SessionManager.flush 只写 store snapshot 的丢档窗口（运行期其他会话
   * 生命周期触发的 debounced flush 同理，由下一轮重试（≤5min）收敛）。
   * 队列为空 / 端口未注入 → no-op；save 失败仅 warn（重试仍在内存继续）。
   */
  private async _persistPendingRecoveryRecords(): Promise<void> {
    if (this._pendingRecovery.size === 0) return;
    if (!this._persistence || !this._sessionManager) return;
    try {
      await this._persistence.save(this._mergedPersistableSnapshot());
      this._logger.debug('session_recover_pending_persisted', {
        pending: this._pendingRecovery.size,
      });
    } catch (e) {
      this._logger.warn('session_recover_pending_persist_failed', { error: e });
    }
  }

  /**
   * task-08：把 recover 网络类失败的记录入重试队列。
   *
   * 退避 30s 起步指数翻倍封顶 5min 持续重试；WS onConnected 时
   * _retryPendingRecoveryNow 立即重试一轮。R6 防堆积：记录超龄 7 天
   * （按 lastActiveAt）不再入队，直接删记录。
   *
   * @returns true=已入队（等待退避/立即重试）；false=超龄已删记录（按 dropped 收口）。
   */
  private async _enqueueRecoveryRetry(record: PersistedSessionRecord): Promise<boolean> {
    if (this._recoveryRecordExpired(record)) {
      this._logger.warn('session_recover_record_expired', {
        session_id: record.sessionId,
        last_active_at: record.lastActiveAt,
      });
      await this._markRecordRemoved(record);
      return false;
    }
    const prev = this._pendingRecovery.get(record.sessionId);
    const retryCount = (prev?.retryCount ?? 0) + 1;
    const delayMs = Math.min(
      RECOVERY_RETRY_BASE_MS * 2 ** (retryCount - 1),
      RECOVERY_RETRY_MAX_MS,
    );
    this._pendingRecovery.set(record.sessionId, {
      record,
      retryCount,
      nextRetryAt: Date.now() + delayMs,
    });
    this._scheduleRecoveryRetry();
    this._logger.warn('session_recover_retry_scheduled', {
      session_id: record.sessionId,
      attempt: retryCount,
      retry_in_ms: delayMs,
    });
    return true;
  }

  /**
   * task-08：按最早到期 deadline 排一个单实例定时器。已排程的 deadline 不晚于
   * 新算出的最早值时保持不动（防持续入队把最早 deadline 无限后推）；队列为空
   * 时清掉定时器。
   */
  private _scheduleRecoveryRetry(): void {
    if (this._pendingRecovery.size === 0) {
      this._clearRecoveryRetryTimer();
      return;
    }
    let earliest = Number.POSITIVE_INFINITY;
    for (const entry of this._pendingRecovery.values()) {
      if (entry.nextRetryAt < earliest) earliest = entry.nextRetryAt;
    }
    if (
      this._recoveryRetryTimer !== null &&
      this._recoveryRetryScheduledFor !== null &&
      this._recoveryRetryScheduledFor <= earliest
    ) {
      return;
    }
    if (this._recoveryRetryTimer !== null) clearTimeout(this._recoveryRetryTimer);
    this._recoveryRetryScheduledFor = earliest;
    this._recoveryRetryTimer = setTimeout(() => {
      this._recoveryRetryTimer = null;
      this._recoveryRetryScheduledFor = null;
      void this._runRecoveryRetryRound();
    }, Math.max(0, earliest - Date.now()));
  }

  /** task-08：清恢复重试定时器（stop 收尾用，防退出后触发新一轮）。 */
  private _clearRecoveryRetryTimer(): void {
    if (this._recoveryRetryTimer !== null) {
      clearTimeout(this._recoveryRetryTimer);
      this._recoveryRetryTimer = null;
    }
    this._recoveryRetryScheduledFor = null;
  }

  /**
   * task-08：WS onConnected 钩子——遗留待恢复记录立即重试一轮（backend 可达
   * 信号），不等退避到期。
   *
   * 实现形态：把队列内全部条目 nextRetryAt 归零后重排定时器（deadline 已过
   * → 0ms 触发 _runRecoveryRetryRound）。退避计数不清零：立即轮再失败继续按
   * 原退避序列等待（只重置等待不重置计数，防重连风暴打爆 backend）。
   */
  private _retryPendingRecoveryNow(): void {
    if (this._pendingRecovery.size === 0) return;
    for (const entry of this._pendingRecovery.values()) {
      entry.nextRetryAt = 0;
    }
    this._scheduleRecoveryRetry();
  }

  /**
   * task-08：执行一轮到期记录的恢复重试（退避定时器 / WS onConnected 触发）。
   *
   * 幂等防重入（_recoveryRetryInFlight）：并发触发只跑一轮。每条仍走
   * _recoverOneSession 全流程（recover→restore→active）；'recovered'/'dropped'
   * 出队，'retry' 由 _recoverOneSession 内部重新入队（退避翻倍）。收尾重排
   * 定时器 + 把遗留记录合并回写 sessions.json。
   */
  private async _runRecoveryRetryRound(): Promise<void> {
    if (!this._running) return; // stop() 后不再触发新轮（定时器已清，防迟到轮重排）。
    if (this._recoveryRetryInFlight) return;
    if (this._pendingRecovery.size === 0) return;
    this._recoveryRetryInFlight = true;
    try {
      const now = Date.now();
      const due = [...this._pendingRecovery.values()].filter(
        (e) => e.nextRetryAt <= now,
      );
      if (due.length > 0) {
        this._logger.info('session_recover_retry_round', { count: due.length });
      }
      for (const entry of due) {
        const cur = this._pendingRecovery.get(entry.record.sessionId);
        if (!cur) continue; // 已被并发路径处理（成功恢复/终态出队）。
        const outcome = await this._recoverOneSession(cur.record);
        if (outcome === 'recovered' || outcome === 'dropped') {
          this._pendingRecovery.delete(cur.record.sessionId);
        }
        // outcome === 'retry'：_recoverOneSession 已重新入队（nextRetryAt 退避翻倍）。
      }
      this._scheduleRecoveryRetry();
      await this._persistPendingRecoveryRecords();
    } finally {
      this._recoveryRetryInFlight = false;
    }
  }

  // ── Wave2 task-04 gap-1：interactive session 桥接 deps → hubClient ─────────
  //
  // 调用链（design §6）：
  //   SessionManager._onResult/_onMessage/end/fail
  //   → deps.onTurnResult/onTurnMessage/onSessionEnd（cli.ts 注入的闭包，延迟绑定 daemon）
  //   → daemon.onTurnResult/onTurnMessage/onSessionEnd（以下三方法）
  //   → hubClient.notifyRunResult/submitMessages/notifySessionEnd
  //   → backend close_interactive_run / submitMessages / end_session
  //
  // 边界（R-bridge）：state 不存在 / sessionManager null → warn 不抛（不崩 daemon）。
  // hubClient 抛错 → warn 不向上抛（SessionManager 调用方不感知 backend 故障，
  // daemon 主循环 / consume 协程继续运行）。

  /**
   * gap-3 桥接：上报 interactive AgentRun 终态（SDK result）。
   *
   * 查 SessionState（this._sessionManager.get），取 leaseId + claimToken + runId，
   * 调 hubClient.notifyRunResult → backend close_interactive_run。
   *
   * payload 字段对齐 backend InteractiveRunResultRequest：
   *   - status：SDK result.subtype（'success' | 'error_during_execution' | 其他）
   *   - is_error：SDK result.is_error
   *   - subtype：SDK result.subtype（可选）
   *   - result_summary：可读摘要（可选，SDK result.result 字段截断）
   *
   * 边界：
   *   - sessionManager 为 null（AC-14 过渡期）→ warn 不抛；
   *   - state 不存在（session 已结束 / 迟到 result）→ warn 不抛，不调 notifyRunResult；
   *   - state.claimToken 空（恢复路径占位，design §恢复链路）→ warn 不抛；
   *   - hubClient.notifyRunResult 抛错 → warn 不向上抛。
   *
   * @param sessionId  AgentSession.id
   * @param runId  当前 turn 的 AgentRun.id（SessionManager 已切 active 时由调用方传）
   * @param result  SDK SDKResultMessage
   */
  async onTurnResult(
    sessionId: string,
    runId: string,
    // task-06（design §5.4.4）：放宽为 provider-neutral 联合。Claude driver 传
    // SDKResultMessage；Codex driver 传 InteractiveDriverResult（flat：subtype/is_error/
    // total_cost_usd/usage）。下方字段提取用 `as SDKResultMessage & {...}` duck-typing，
    // 两种 provider 都兼容（字段不存在则 undefined，不写 payload）。
    result: SDKResultMessage | InteractiveDriverResult,
  ): Promise<void> {
    if (!this._sessionManager) {
      this._logger.warn('on_turn_result_no_manager', { session_id: sessionId });
      return;
    }
    const state = this._sessionManager.get(sessionId);
    if (!state) {
      this._logger.warn('on_turn_result_session_not_found', {
        session_id: sessionId,
      });
      return;
    }
    // payload 字段映射（snake_case 对齐 backend InteractiveRunResultRequest）。
    // SDKResultSuccess 含 total_cost_usd / num_turns / duration_ms / duration_api_ms /
    // usage.{input_tokens,output_tokens}（见 sdk.d.ts SDKResultSuccess 类型）；
    // interactive 路径原先丢弃这些字段导致 AgentRun 全 NULL（对齐 batch
    // task-runner extractResultStats）。ql-20260829-002：token 四维优先取
    // modelUsage 聚合（usage 只含主循环、不含子代理，见 _aggregateModelUsage）。
    const resultMeta = result as SDKResultMessage & {
      subtype?: string;
      is_error?: boolean;
      result?: unknown;
      total_cost_usd?: number;
      num_turns?: number;
      duration_ms?: number;
      duration_api_ms?: number;
      // task-16：usage 字段名映射点 —— Anthropic SDK 全名 cache_*_input_tokens，
      // 提取处映射为短名 cache_*_tokens（对齐 backend 列 / _METADATA_FIELDS）。
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
      // task-04（FR-01 / D-005@v1）：session-manager._onResult 收尾时归类并挂到
      // result.modelError（duck-type，对齐 _onMessage 挂 depth 的模式）。null/undefined
      // = 非模型错误或成功路径（classifier 对 is_error=false 返回 null，D-008）。
      modelError?: ModelError | null;
    };
    const status = resultMeta.subtype ?? 'success';
    const isError = resultMeta.is_error === true;
    const payload: {
      status: string;
      is_error: boolean;
      subtype?: string;
      result_summary?: string;
      total_cost_usd?: number;
      num_turns?: number;
      duration_ms?: number;
      duration_api_ms?: number;
      input_tokens?: number;
      output_tokens?: number;
      // task-16：cache 两维（短名），SDK 全名在此处映射注入。
      cache_read_tokens?: number;
      cache_creation_tokens?: number;
      // task-06（2026-08-29-usage-by-provider-model）：模型明细行 + run 级计数
      //（modelUsage 缺失/空时两字段都不写，见下方组装段）。
      model_usage?: ModelUsageRow[];
      api_requests?: number;
      // task-04：模型层结构化错误（is_error=true 时 session-manager 已挂到 result.modelError）。
      error?: ModelError;
    } = {
      status,
      is_error: isError,
    };
    if (resultMeta.subtype !== undefined) {
      payload.subtype = resultMeta.subtype;
    }
    // 可读摘要：result.result 可能是 string / object，截断后送 backend redact 存储。
    if (resultMeta.result !== undefined) {
      const raw =
        typeof resultMeta.result === 'string'
          ? resultMeta.result
          : JSON.stringify(resultMeta.result);
      payload.result_summary = raw.length > 500 ? `${raw.slice(0, 500)}...` : raw;
    }
    // SDKResultSuccess 透传（undefined 字段不写，保留 backend AgentRun 原值）。
    // ql-20260831-009：total_cost_usd 与 modelUsage 同生命周期，同为跨轮累计快照
    //（sdk.d.ts：read the latest result rather than summing across results）——差分
    // 为本轮增量；当前 < 基线 = SDK 成本计数复位（resume / /clear / crash 清零），
    // 报全量。浮点差分保留 6 位小数，防 0.3-0.1 类尾差进 payload。
    const costRaw = resultMeta.total_cost_usd;
    const costSnapshot =
      typeof costRaw === 'number' && Number.isFinite(costRaw) ? costRaw : null;
    if (costSnapshot !== null) {
      const costBase = this._modelUsageBaselineBySession.get(sessionId)?.totalCostUsd ?? 0;
      payload.total_cost_usd =
        costSnapshot >= costBase
          ? Math.round((costSnapshot - costBase) * 1e6) / 1e6
          : costSnapshot;
    }
    if (typeof resultMeta.num_turns === 'number') {
      payload.num_turns = resultMeta.num_turns;
    }
    if (typeof resultMeta.duration_ms === 'number') {
      payload.duration_ms = resultMeta.duration_ms;
    }
    if (typeof resultMeta.duration_api_ms === 'number') {
      payload.duration_api_ms = resultMeta.duration_api_ms;
    }
    // ql-20260829-002：token 四维优先取 modelUsage 跨模型聚合（含 Task 子代理 /
    // sidechain / compaction 的全部 query-pipeline 消耗，SDK 官方指明这才是
    // token 口径权威字段）；modelUsage 缺失 / 空（老 CLI、Codex driver）回落
    // resultMeta.usage（主循环 only，即修复前 D-001 行为，向后兼容）。
    // total_cost_usd 本身已覆盖全部 pipeline（SDK 语义），不走本分支。
    const modelUsage = (resultMeta as { modelUsage?: unknown }).modelUsage;
    // task-06（FR-02-1 / D-01）：run 级 assistant 计数读出 + 清理。读出即删
    //（retryTerminal 重试闭包已捕获 payload 值，计数不因重发重复累计；run 未
    // 达终态的残留条目由 onSessionEnd 兜底回收）。
    const apiRequests = this._assistantMsgCountByRun.get(runId) ?? 0;
    this._assistantMsgCountByRun.delete(runId);
    // ql-20260831-009：快照差分（_deltaModelUsage 头注释）。无效快照（老 CLI /
    // Codex driver 无 modelUsage）→ null：基线不动，下方回落 result.usage 旧路径。
    const baselineBefore = this._modelUsageBaselineBySession.get(sessionId);
    const diffed = _deltaModelUsage(modelUsage, baselineBefore);
    const modelTotals = _aggregateModelUsage(diffed ? diffed.delta : modelUsage);
    if (modelTotals) {
      payload.input_tokens = modelTotals.input;
      payload.output_tokens = modelTotals.output;
      payload.cache_read_tokens = modelTotals.cacheRead;
      payload.cache_creation_tokens = modelTotals.cacheCreation;
    } else if (resultMeta.usage) {
      if (typeof resultMeta.usage.input_tokens === 'number') {
        payload.input_tokens = resultMeta.usage.input_tokens;
      }
      if (typeof resultMeta.usage.output_tokens === 'number') {
        payload.output_tokens = resultMeta.usage.output_tokens;
      }
      // task-16：cache 两维提取（Anthropic SDK 全名 → payload 短名映射）。
      // 全名 cache_*_input_tokens 来自 Claude SDK result.usage；映射为短名 cache_*_tokens
      //（对齐 backend agent_runs 列 / _METADATA_FIELDS）。typeof 'number' 守卫，
      // 字段缺失（codex/老 CLI）不 set → backend NULL（D-001@v1）。0 值合法不丢。
      if (
        resultMeta.usage &&
        typeof resultMeta.usage.cache_creation_input_tokens === 'number'
      ) {
        payload.cache_creation_tokens = resultMeta.usage.cache_creation_input_tokens;
      }
      if (
        resultMeta.usage &&
        typeof resultMeta.usage.cache_read_input_tokens === 'number'
      ) {
        payload.cache_read_tokens = resultMeta.usage.cache_read_input_tokens;
      }
    }
    // task-06（FR-01-3/FR-02-1，design §3.1）：modelUsage 逐模型明细行 + run 级
    // api_requests。modelUsage 缺失/空（拆行结果为空数组）→ 两字段都不写（老
    // CLI / Codex driver 兼容，backend None → 明细无行，N-01）；有 → 两字段都写
    //（api_requests=0 也写：本 run 至少一次调用时计数≥1，0 = 有 modelUsage 而无
    // 计数来源的诚实值）。行内 api_requests 为按 input+output 占比的分摊估算
    //（design §2 D-01 / R-01），顶层 api_requests 为精确计数。
    const usageRows = _modelUsageRows(diffed ? diffed.delta : modelUsage, apiRequests);
    if (usageRows.length > 0) {
      payload.model_usage = usageRows;
      payload.api_requests = apiRequests;
    }
    // ql-20260831-009：差分基线推进（本轮快照有效才写）。成本维独立推进：有效取
    // 当前快照，缺失沿用旧基线（modelUsage 与 cost 有效性互不担保）；两者皆无效
    // （老 CLI）不动基线——下轮照旧全量/差分不受污染。
    if (diffed || costSnapshot !== null) {
      this._modelUsageBaselineBySession.set(sessionId, {
        models: diffed ? diffed.nextModels : (baselineBefore?.models ?? {}),
        totalCostUsd: costSnapshot ?? baselineBefore?.totalCostUsd ?? 0,
      });
    }
    // task-04（FR-01 / D-005@v1）：模型层结构化错误注入。session-manager._onResult
    // 收尾时已按 provider + is_error + resultText 调 classifyModelError 归类，把非空
    // ModelError 挂到 result.modelError（duck-type 透传，对齐 depth 挂载）。此处仅读取
    // 注入 payload.error，供 hubClient.notifyRunResult → backend error_detail。
    // 守卫用 truthy（ModelError 恒为对象）：null/undefined（成功 / 非模型错误）不 set，
    // backend error_detail 保留 NULL（D-008 成功路径不回归）。
    if (resultMeta.modelError) {
      payload.error = resultMeta.modelError;
    }
    if (!state.claimToken) {
      // task-07（A5 claim_token 空窗）：终态不再丢弃——kind=run_result 入箱
      //（pending_token 标记），SESSION_INJECT 刷新 token 后 drain 重放；
      // 未注入 resilience（旧测试形态）维持旧行为（warn 即丢）。
      this._logger.warn('on_turn_result_no_claim_token', {
        session_id: sessionId,
        lease_id: state.leaseId,
      });
      if (this._resilience) {
        try {
          await this._resilience.enqueueRunResult(state.leaseId, '', runId, payload);
        } catch {
          // 落盘失败不向上抛（对齐下方 notify 失败的容错语义）。
        }
      }
      return;
    }
    try {
      // task-12（FR-05 / D-005@v1）：终态上报包 retryTerminal 轻量重试（不暂存）。
      // _resilience 未注入 → 回退直接调 _client。用尽抛被下方 catch 兜住 warn。
      const call = (): Promise<unknown> =>
        this._client.notifyRunResult(state.leaseId, state.claimToken, runId, payload);
      if (this._resilience) {
        await this._resilience.retryTerminal(call);
      } else {
        await call();
      }
    } catch (e) {
      // task-07（A3 终态入箱）：retryTerminal 用尽/失败不丢——kind=run_result 落
      // outbox，由对账/心跳 drain 重放（backend 端点幂等，200 no-op 防重复副作用）。
      if (this._resilience) {
        try {
          await this._resilience.enqueueRunResult(
            state.leaseId,
            state.claimToken,
            runId,
            payload,
          );
        } catch {
          // 落盘失败仅记 warn（下方统一 warn），不向上抛。
        }
      }
      // backend 500 / 422 / 网络 → warn 不向上抛（SessionManager._onResult 不感知，
      // daemon 主循环继续）。run 关闭失败由 backend 兜底（lease 超时 / SSE 重连）。
      this._logger.warn('on_turn_result_notify_failed', {
        session_id: sessionId,
        lease_id: state.leaseId,
        run_id: runId,
        error: e,
      });
    }

    // task-06（FR-05 / D-002@v1）：scan run 终态额外触发 spec 树回灌（独立于 session end）。
    // scan/stage 跑在长生命周期 interactive session（scan 期 session 永不 end），仅靠
    // onSessionEnd 兜底会导致 scan-docs/knowledge/.runtime 一直不可见；此处终态点立即回灌。
    // 仅 scan/stage interactive 有 specSyncCtx（quick-chat/shared 不 set → syncSpecTreeIfNeeded no-op）。
    // 幂等：apply_sync 整树覆写（D-006@v1），与后续 onSessionEnd double-sync 无害；终态点不
    // delete ctx，留给 onSessionEnd 兜底再同步一次。
    await syncSpecTreeIfNeeded(
      this._interactiveSpecSyncCtx.get(state.leaseId) ?? null,
      this._client as never,
    );
  }

  /**
   * 桥接：增量上报 agent 执行消息（流式）。
   *
   * 查 SessionState，调 hubClient.submitMessages(leaseId, claimToken, runId, [msg])
   * → backend SSE turn_progress。复用既有 submitMessages 端点（interactive + batch 共用）。
   *
   * 边界同 onTurnResult：state 不存在 / claimToken 空 / submitMessages 抛错 → warn 不抛。
   *
   * @param sessionId  AgentSession.id
   * @param runId  当前 turn 的 AgentRun.id
   * @param msg  SDK SDKMessage
   */
  async onTurnMessage(
    sessionId: string,
    runId: string,
    // task-06（design §5.4.4）：放宽为 provider-neutral 联合。Claude driver 传
    // SDKMessage（{type:'assistant'|'user'|..., message:{usage}}）；Codex driver 传
    // InteractiveDriverMessage（= Record<string,unknown>，flat：{event_type, content,
    // metadata, session_id}）。下方 duck-typing 按 type/event_type 分流提取。
    msg: SDKMessage | InteractiveDriverMessage,
  ): Promise<void> {
    if (!this._sessionManager) {
      this._logger.warn('on_turn_message_no_manager', { session_id: sessionId });
      return;
    }
    const state = this._sessionManager.get(sessionId);
    if (!state) {
      this._logger.warn('on_turn_message_session_not_found', {
        session_id: sessionId,
      });
      return;
    }
    if (!runId) {
      // ql-004：空 runId（''/undefined）不发 submitMessages，避免空 agent_run_id
      // 触发 backend 422 风暴（每请求 auth 占连接 → 连接池耗尽）。
      this._logger.warn('on_turn_message_empty_run_id', {
        session_id: sessionId,
        lease_id: state.leaseId,
      });
      return;
    }
    if (!state.claimToken) {
      // task-07（A5 claim_token 空窗）：消息不再丢弃——带 pending_token 标记入
      // outbox，SESSION_INJECT 刷新 token 后 drain 重放（refresher 咨询
      // SessionState.claimToken）；未注入 resilience（旧测试形态）维持旧行为。
      this._logger.warn('on_turn_message_no_claim_token', {
        session_id: sessionId,
        lease_id: state.leaseId,
      });
      if (this._resilience) {
        const fwdMsg = msg as unknown as Record<string, unknown>;
        // flatSeq 语义与主路径一致（per-run 递增保 dedup_key 确定性，重放同 key
        // 命中 backend ON CONFLICT 去重）。
        const flatSeq = this._interactiveFlatSeq.get(runId) ?? 0;
        this._interactiveFlatSeq.set(runId, flatSeq + 1);
        this._interactiveFlatSeqOwner.set(runId, sessionId);
        try {
          await this._resilience.enqueuePendingToken(state.leaseId, runId, [
            { message: fwdMsg, dedup_key: dedupKeyFor(fwdMsg, runId, 0, flatSeq) },
          ]);
        } catch {
          // 落盘失败不向上抛（对齐 submit 失败的容错语义）。
        }
      }
      return;
    }
    // task-06（FR-02-1 / D-01）：run 级 assistant 计数（API 调用次数近似，design
    // §2）。放在 try 之前：模型调用已实际发生，计数不依赖 submitMessages 转发
    // 成败。子代理消息同为 type==='assistant'（带 parent_tool_use_id）天然计入；
    // Codex flat message（event_type，无 type）不计——其 driver 本就无 modelUsage，
    // payload 两字段都不写，口径自洽。
    if ((msg as unknown as Record<string, unknown>)['type'] === 'assistant') {
      this._assistantMsgCountByRun.set(
        runId,
        (this._assistantMsgCountByRun.get(runId) ?? 0) + 1,
      );
    }
    try {
      const fwdMsg = msg as unknown as Record<string, unknown>;
      const msgType = fwdMsg['type'];
      // ql-20260627-usage（实时 token 透传）：通用 usage lift，提到 if/else 之外。
      // 两类消息都可能携带 usage：
      //   1) session-manager flush 产出的 flat 消息（[THINKING]/[ASSISTANT]）——
      //      message_delta.usage 已注入顶层 fwdMsg['usage']（partial 实时计费）。
      //   2) Claude SDK assistant 完整消息——usage 嵌套在 msg.message.usage。
      // 统一提到顶层并做 Anthropic 全名（cache_*_input_tokens）→ 短名（cache_*_tokens）
      // 映射，让 backend submit_messages 实时更新 AgentRun token，不必等 result 汇总。
      // task-16：复制一份再映射，不修改原 usage 对象（adapter 产，只读）；全名缺失 →
      // 短名也不 set（backend NULL，D-001@v1）。
      let liftedUsage = fwdMsg['usage'] as Record<string, unknown> | undefined;
      if (!liftedUsage && msgType === 'assistant') {
        // assistant 完整消息：usage 嵌套在 message.usage，先取出（message_delta 未及时
        // flush 被 _clearPartialBufferSync 清掉时的兜底终态来源）。
        const inner = fwdMsg['message'] as Record<string, unknown> | undefined;
        liftedUsage = inner?.['usage'] as Record<string, unknown> | undefined;
      }
      if (liftedUsage && typeof liftedUsage['input_tokens'] === 'number') {
        const lifted: Record<string, unknown> = { ...liftedUsage };
        if (
          typeof lifted['cache_creation_input_tokens'] === 'number' &&
          lifted['cache_creation_tokens'] === undefined
        ) {
          lifted['cache_creation_tokens'] = lifted['cache_creation_input_tokens'];
        }
        if (
          typeof lifted['cache_read_input_tokens'] === 'number' &&
          lifted['cache_read_tokens'] === undefined
        ) {
          lifted['cache_read_tokens'] = lifted['cache_read_input_tokens'];
        }
        fwdMsg['usage'] = lifted;
      }
      // task-06（Reverse Sync / design §5.3 第 6 点）：Codex flat message 的
      // thread_started 事件携带 session_id=threadId。daemon 提取并记日志，便于
      // 追踪 Codex thread 与 AgentSession 的绑定；flat message 原样 submitMessages
      // 透传，backend submit_messages 现有逻辑据 message.session_id 写回
      // AgentRun.session_id（ql-20260617-001）。AgentSession.agent_session_id 的对齐
      // 由 session-manager _onMessage 写 state.agentSessionId（供落盘/恢复）。
      const eventType = fwdMsg['event_type'];
      if (typeof eventType === 'string' && eventType !== undefined) {
        const metadata = fwdMsg['metadata'] as Record<string, unknown> | undefined;
        const subtype = metadata?.['subtype'];
        const flatSessionId = fwdMsg['session_id'];
        if (subtype === 'thread_started' && typeof flatSessionId === 'string' && flatSessionId) {
          this._logger.info('interactive_codex_thread_started', {
            session_id: sessionId,
            lease_id: state.leaseId,
            thread_id: flatSessionId,
            provider: state.provider,
          });
        }
      }
      // task-10（FR-04 / D-005@v1）：interactive submit 走退避重试。
      // _resilience 未注入 → 回退直接调 _client（无重试，向后兼容）。
      // dedup_key（task-09 / FR-02 / D-002@v1）：Claude msg.id 优先（dedupKeyFor 内部
      // `if (id) return id`，不动）；无 msg.id 时走确定性 seq 分支
      // `${runId}:0:${flatSeq}`——用 per-run 递增 _interactiveFlatSeq 计数，绝不退化
      // `${runId}:${Date.now()}`（重发会变 key，backend ON CONFLICT 去重失效）。
      // turnSeq 固定 0：interactive 单条转发不区分 turn，runId 维度 + flatSeq 单调递增
      // 已保证唯一；同一条消息重发拿到相同 flatSeq → 相同 dedup_key → 命中去重。
      const flatSeq = this._interactiveFlatSeq.get(runId) ?? 0;
      this._interactiveFlatSeq.set(runId, flatSeq + 1);
      // ql-20260825-f3#8：记录 runId→sessionId 归属，onSessionEnd 据此反查清理
      //（flatSeq 条目不再只增不减；同 session 多 run 各记一条，幂等覆盖）。
      this._interactiveFlatSeqOwner.set(runId, sessionId);
      if (this._resilience) {
        const envelope: Envelope = {
          message: fwdMsg,
          dedup_key: dedupKeyFor(fwdMsg, runId, 0, flatSeq),
        };
        await this._resilience.submitWithRetry(
          state.leaseId,
          state.claimToken,
          runId,
          [envelope],
        );
      } else {
        await this._client.submitMessages(
          state.leaseId,
          state.claimToken,
          runId,
          [fwdMsg],
        );
      }
    } catch (e) {
      // task-02（FR-01）：展开底层 cause，让 fetch failed 暴露 ECONNREFUSED/
      // ENOTFOUND/ETIMEDOUT/证书错误等 undici code，而非仅 "fetch failed"。
      this._logger.warn('on_turn_message_submit_failed', {
        session_id: sessionId,
        lease_id: state.leaseId,
        run_id: runId,
        message: (e as Error | undefined)?.message ?? String(e),
        cause: extractCause(e),
      });
    }
  }

  /**
   * gap-4 桥接：上报 interactive session 终态（end / idle 30min / fail）。
   *
   * 调 hubClient.notifySessionEnd(sessionId, status, reason) → backend end_session
   *（daemon 入口，api-key 鉴权，区别前端 user JWT）。backend 端幂等（已 ended → no-op）。
   *
   * reason 推导：
   *   - status='ended'：正常收口（手动 end / idle 30min）。idle 路径在 SessionManager
   *     _onIdleExpire 走 end → onSessionEnd('ended')，daemon 此处统一 'manual' 占位
   *     （idle vs manual 的精确区分在 SessionManager 调用方语义，daemon 桥接不感知）。
   *   - status='failed'：driver onError / 不可恢复异常。reason 含 'error'。
   *
   * **幂等**：SessionManager.end/fail 自身幂等（已 ended/failed 不重复调 onSessionEnd），
   * daemon 此处只在 SessionManager 触发时转发；backend notifySessionEnd 自身幂等
   *（重复调用安全，design §5 已声明）。
   *
   * **不依赖 state**：session 终态时 state 仍在 store（end/fail 不从 store 移除，
   * task-10 flush 后 snapshotPersistable 过滤掉终态记录），但 notifySessionEnd 是
   * session 级通知（api-key 鉴权），不需要 claim_token，故不读 state.claimToken。
   *
   * 边界：
   *   - sessionManager null → warn 不抛（仍可调 notifySessionEnd，但 daemon 选择 ?. 兜底
   *     不调，避免无 sessionManager 上下文时无意义通知；AC-14 过渡期一致）；
   *   - notifySessionEnd 抛错 → warn 不向上抛。
   *
   * @param sessionId  AgentSession.id
   * @param status  'ended'（正常 / idle）/ 'failed'（driver error）
   */
  async onSessionEnd(
    sessionId: string,
    status: SessionStatus,
  ): Promise<void> {
    // status 收敛：reconnecting 等中间态不应进此路径（SessionManager 仅在 end/fail 调）。
    // 防御性：非 ended/failed 的 status 视为 ended 兜底（backend 接受 SessionStatus）。
    const mappedStatus: 'ended' | 'failed' =
      status === 'failed' ? 'failed' : 'ended';
    const reason =
      mappedStatus === 'failed'
        ? 'driver_error'
        : 'manual';
    try {
      // task-12（FR-05 / D-005@v1）：终态上报包 retryTerminal 轻量重试（不暂存）。
      // _resilience 未注入 → 回退直接调 _client。用尽抛被下方 catch 兜住 warn。
      const call = (): Promise<unknown> =>
        this._client.notifySessionEnd(sessionId, mappedStatus, reason);
      if (this._resilience) {
        await this._resilience.retryTerminal(call);
      } else {
        await call();
      }
    } catch (e) {
      // task-07（A3 终态入箱）：retryTerminal 用尽/失败不丢——kind=session_end 落
      // outbox（dedupId=sessionId），由对账/心跳 drain 重放（backend end 端点幂等，
      // 终态 no-op 不翻转）。未注入 resilience（旧测试形态）维持旧行为。
      if (this._resilience) {
        try {
          await this._resilience.enqueueSessionEnd(sessionId, mappedStatus, reason);
        } catch {
          // 落盘失败仅 warn（下方统一 warn），不向上抛。
        }
      }
      this._logger.warn('on_session_end_notify_failed', {
        session_id: sessionId,
        status: mappedStatus,
        error: e,
      });
    }

    // task-06（D-003@v1 tar 模式 sync / R-07 时序）：在 notifySessionEnd **之后**触发。
    // session 须真正结束（driver 已退出、SessionManager 已 end/fail）后才回传，避免
    // 回传时 sillyspec 还在写文件导致 tar 不完整。即便 notifySessionEnd 失败（warn），
    // 仍继续尝试 sync——sync 尽力而为，失败也仅 warn（R-03）。shared 模式无 specSyncCtx →
    // 跳过（D-004）。
    await this._postInteractiveSpecSync(sessionId);

    // 清理 _interactiveSessionsByLease（防内存泄漏）。
    // SESSION_END WS 消息路径已在 _routeSessionControl 中 delete（line ~2022）；
    // 但 session 通过 idle 超时 / driver error / 手动 end 结束时只走本回调，
    // 不经过 SESSION_END WS 消息 → 条目泄漏。此处兜底清理（幂等，重复 delete 无副作用）。
    try {
      const state = this._sessionManager?.get(sessionId);
      if (state?.leaseId) {
        this._interactiveSessionsByLease.delete(state.leaseId);
      }
    } catch {
      // state 查不到（sessionManager 已 dispose 等极端情况）——忽略。
    }

    // task-07（2026-08-26-workspace-mcp-edit / D-007@v2）：清理会话级 MCP bundle
    // 缓存（生命周期=会话，防泄漏）。onSessionEnd 是会话终态统一收口（end/fail/
    // SESSION_END WS 路径均经 SessionManager 终态走到这里），幂等 delete。
    this._mcpBundleBySession.delete(sessionId);

    // ql-20260831-009：回收 modelUsage 差分基线（生命周期=会话；会话结束后同 id
    // 重建的会话是新流式 query，快照从零起，残留基线会误触发复位检测多报全量）。
    this._modelUsageBaselineBySession.delete(sessionId);

    // ql-20260825-f3#8：清理本 session 的 per-run flatSeq 计数条目（原只增不减）。
    // flatSeq 以 runId 为 key，onTurnMessage 时已记 runId→sessionId 归属，此处反查
    // 一次性回收该 session 全部 run 的条目（Map 迭代中 delete 当前项安全，ES 规范）。
    // task-06：assistant 计数条目同批回收（run 未达终态时防泄漏——assistant 消息
    // 走 onTurnMessage 必然同时登记 flatSeq 归属，此处反查必命中）。
    for (const [rid, ownerSessionId] of this._interactiveFlatSeqOwner) {
      if (ownerSessionId === sessionId) {
        this._interactiveFlatSeqOwner.delete(rid);
        this._interactiveFlatSeq.delete(rid);
        this._assistantMsgCountByRun.delete(rid);
      }
    }
  }

  /**
   * task-06：onSessionEnd 后置 spec 整树回传（tar 模式）。
   *
   * 反查路径：sessionId → sessionManager.get(sessionId).leaseId → _interactiveSpecSyncCtx
   * 取 workspaceId → postSpecSync。非 tar 模式 / pull 未登记 / sessionManager null → 跳过。
   *
   * 容错（R-03）：sync 失败仅 warn，不阻塞、不改写 session 终态（notifySessionEnd 已先行
   * 上报）；finally 内 delete specSyncCtx 保证 onSessionEnd 幂等（AC-09）。
   */
  private async _postInteractiveSpecSync(sessionId: string): Promise<void> {
    if (!this._sessionManager) return; // AC-14 过渡期
    let leaseId: string | undefined;
    try {
      const state = this._sessionManager.get(sessionId);
      leaseId = state?.leaseId;
    } catch (e) {
      this._logger.warn('interactive_spec_sync_state_lookup_failed', {
        session_id: sessionId,
        error: (e as Error)?.message ?? String(e),
      });
      return;
    }
    if (!leaseId) return; // 边界 10：state 查不到 / 无 leaseId
    const ctx = this._interactiveSpecSyncCtx.get(leaseId);
    if (!ctx) return; // 非 tar 模式 / pull 未登记 → 跳过（D-004 shared 现状）

    try {
      // task-06（D-002@v1）：改调 syncSpecTreeIfNeeded（ctx-guarded 薄封装，内部 try/catch
      // 仅 warn 不抛）。`as never`：见 _startInteractiveSession pull 处同款说明（ClientLike → HubClient）。
      await syncSpecTreeIfNeeded(ctx, this._client as never);
      this._logger.info('interactive_spec_sync_ok', {
        session_id: sessionId,
        lease_id: leaseId,
        workspace_id: ctx.workspaceId,
      });
    } catch (e) {
      // R-03 容错：sync 失败仅 warn，不阻塞、不改写 session 终态。
      //（syncSpecTreeIfNeeded 自身已 catch 不抛，此分支为防御性兜底；notifySessionEnd 已上报）
      this._logger.warn('interactive_spec_sync_failed', {
        session_id: sessionId,
        lease_id: leaseId,
        workspace_id: ctx.workspaceId,
        error: (e as Error)?.message ?? String(e),
      });
    } finally {
      // 幂等：二次 onSessionEnd 查不到 ctx 直接 return（AC-09 / 边界 9）。
      this._interactiveSpecSyncCtx.delete(leaseId);
    }
  }

  // ── 内部：_fire（AbortController 追踪，R7）─────────────────────────────────

  /**
   * 启动一个后台循环并追踪它的 AbortController + Promise。
   * 循环抛 AbortError 时静默吞掉（正常停止）；其他异常记日志。
   * task-04（FR-02）：非 AbortError 异常带退避自愈重启，防三循环崩了永久死。
   * 重启前双重检查 _running（sleep 前后），stop() 退出后不复活循环。
   *
   * 断路器（circuit-breaker）：连续崩溃超过 max_loop_restarts 次后停止重启，
   * 记 FATAL 日志。循环成功运行超过 loop_restart_backoff_ms 后计数器自动归零，
   * 避免偶发崩溃累积到上限。
   *
   * @param loop  后台循环函数
   * @param restartCount  当前连续重启次数（内部递归传递，外部调用省略）
   */
  private _fire(
    loop: (signal: AbortSignal) => Promise<void>,
    restartCount = 0,
  ): void {
    const controller = new AbortController();
    this._controllers.add(controller);
    const startedAt = Date.now();
    const p: Promise<void> = loop(controller.signal)
      .catch(async (e: unknown) => {
        if (e instanceof AbortError || (e as Error | undefined)?.name === 'AbortError') {
          return;
        }
        // 断路器：循环成功运行超过退避时间 → 重置计数器（瞬态故障，非持久性 bug）。
        const survivedMs = Date.now() - startedAt;
        const backoffMs = this._config.loop_restart_backoff_ms ?? 5000;
        const effectiveCount = survivedMs >= backoffMs ? 0 : restartCount;

        const nextCount = effectiveCount + 1;
        const maxRestarts = this._config.max_loop_restarts ?? 10;

        this._logger.error('loop_crashed', {
          error: e,
          restart_count: nextCount,
          max_restarts: maxRestarts,
          survived_ms: survivedMs,
        });

        // 断路器触发：连续崩溃超限 → 停止重启，记 FATAL。
        if (nextCount >= maxRestarts) {
          this._logger.error('loop_circuit_breaker_open', {
            restart_count: nextCount,
            max_restarts: maxRestarts,
            error: e,
          });
          this._restartStartedAt.delete(loop);
          return;
        }

        // task-04：自愈重启——仅当仍在运行时带退避重启，AbortError/已 stop 不重启。
        if (!this._running) return;
        this._restartStartedAt.set(loop, Date.now());
        try {
          await abortableSleep(backoffMs, controller.signal);
        } catch {
          // sleep 期间被 abort（stop 触发）——不再重启。
          this._restartStartedAt.delete(loop);
          return;
        }
        if (this._running) this._fire(loop, nextCount);
        else this._restartStartedAt.delete(loop);
      })
      .finally(() => {
        this._controllers.delete(controller);
        this._loopPromises.delete(p);
      });
    this._loopPromises.add(p);
  }

  // ── 心跳循环（daemon.py:164-179）───────────────────────────────────────────

  private async _heartbeatLoop(signal: AbortSignal): Promise<void> {
    while (this._running) {
      try {
        await abortableSleep(this._config.heartbeat_interval * 1000, signal);
        // task-07 / D-006：单条心跳合并上报 daemon_local_id + 各 provider 状态。
        // 至少一个 provider 已注册才发心跳（design §5.4）；无 provider 则——
        // task-06（design A1）：不再纯 continue 跳过，按退避周期重试 register
        //（15s 起步翻倍封顶 60s，成功清计数恢复正常心跳循环）。
        if (this._registeredRuntimes.size === 0) {
          await this._retryRegisterIfNeeded();
          continue;
        }
        await this._sendHeartbeatOnce();
      } catch (e) {
        if (e instanceof AbortError) break;
        // 非预期异常：记日志后继续循环（不崩）
        this._logger.warn('heartbeat_loop_error', { error: e });
      }
    }
  }

  /**
   * 2026-08-31-machine-sillyspec-version task-05（design §1 / FR-05）：第四循环——
   * sillyspec 自动升级检查。
   *
   * 每拍 `manager.checkAndUpgrade('auto')`：probeLatest + probeLocal → 未安装或
   * isOutdated → requestUpgrade('auto')（忙时 manager 内部 deferred，不在此判断）；
   * 已最新 no-op。latest 不可达仅 warn（无重试/退避，失败留给下轮或手动触发）。
   *
   * 间隔读取口：config.sillyspec_update_interval_sec（默认 3600，0=关闭）。Number()
   * 容忍字符串脏值，非法/<=0 一律视为关闭（对齐 startDiskProbe 的兜底惯例——
   * 旧测试 config 缺该字段同样安全跳过）。abortableSleep/AbortError 处理对齐
   * _heartbeatLoop 写法（stop 触发 abort → 静默退出；意外异常 warn 后继续）。
   */
  private async _sillyspecLoop(signal: AbortSignal): Promise<void> {
    const intervalSec = Number(this._config.sillyspec_update_interval_sec);
    if (!Number.isFinite(intervalSec) || intervalSec <= 0) {
      this._logger.debug('sillyspec_loop_disabled', {
        interval_sec: this._config.sillyspec_update_interval_sec,
      });
      return;
    }
    while (this._running) {
      try {
        await abortableSleep(intervalSec * 1000, signal);
        // checkAndUpgrade 全路径内部 catch 收敛不 reject；此处 try/catch 对齐
        // _heartbeatLoop 的防御性写法（意外异常 warn 不崩循环）。
        await this._sillyspecManager.checkAndUpgrade('auto');
      } catch (e) {
        if (e instanceof AbortError) break;
        this._logger.warn('sillyspec_loop_error', { error: e });
      }
    }
  }

  /**
   * task-06（design A1）：单拍心跳（心跳循环每拍 + 重连对账第 1 步共用）。
   *
   * 成功路径：清断连计数/告警标记 → 通知 resilience 健康 → 同步 allowed_roots
   * → 心跳响应携带 pending_controls > 0 时触发控制指令补拉（design A1 触发点
   * 之二：仅第 3 步）。失败路径：断连计数/FATAL 告警（原心跳循环内逻辑原样
   * 收敛于此，行为不变）。返回是否成功（对账观测用；循环内忽略返回值）。
   */
  private async _sendHeartbeatOnce(): Promise<boolean> {
    const registeredProviders = [...this._registeredRuntimes.keys()];
    if (registeredProviders.length === 0) return false;
    const daemonLocalId = this._config.runtime_id;
    const providers = registeredProviders.map((provider) => ({
      provider,
      status: 'online' as const,
    }));
    try {
      // task-05（FR-04 / design S3）：pending 期心跳透传 pending_update——读
      // task-03 提供的 readPendingUpdate（pending-update.json 读取口），剥掉
      // since 只传三字段（backend 首次落库盖 since，daemon 不上报）。null/读失败
      // → 不传第 4 参，body 无该键（=backend 清除，task-06 语义）。
      const pending = await this.readPendingUpdate();
      // 2026-08-31-machine-sillyspec-version task-05（FR-05 / D-002@v1）：心跳透传
      // sillyspec 快照（manager.getSnapshot 纯同步零 spawn）——version/latest 仅
      // 知道（非 null）时携带（兄弟字段语义=backend 保留），update 仅非 null 携带
      //（键不出现=backend 清除，pending_update 同款反向语义）。三键全无 → 第 5
      // 参不占位（heartbeat 调用保持 4 参旧形态，既有心跳测试断言零回归）。
      const snap = this._sillyspecManager.getSnapshot();
      const sillyspec: HeartbeatSillySpecParam = {};
      if (snap.version !== null) sillyspec.version = snap.version;
      if (snap.latest_version !== null) {
        sillyspec.latest_version = snap.latest_version;
      }
      if (snap.update !== undefined) sillyspec.update = snap.update;
      const sillyspecTail: HeartbeatSillySpecParam[] =
        sillyspec.version !== undefined ||
        sillyspec.latest_version !== undefined ||
        sillyspec.update !== undefined
          ? [sillyspec]
          : [];
      const hbResp = await this._client.heartbeat(
        daemonLocalId,
        providers,
        // task-01：进程启动时间随心跳上报（位置参数第 3，对齐 hub-client task-02 签名）。
        this._startedAt,
        pending == null
          ? undefined
          : {
              reason: pending.reason,
              current_version: pending.current_version,
              target_version: pending.target_version,
            },
        ...sillyspecTail,
      );
      // task-05（FR-03）→ task-07 per-daemon：成功 → 清断连计数 + 告警标记。
      // task-06（2026-08-30-daemon-self-heal / D-001）：重置前先捕获降级起点，
      // 断连累计超 RECOVER_AFTER_DEGRADED_MS（触发时 sweep 必已翻完 suspended）
      // 或存在忙推迟 pending（D-007 空闲复查臂）时触发恢复链。fire-and-forget
      // 不阻塞心跳；**不设 _recoverInFlight 外层门**（GAP-2：恢复在途由 D-007
      // 忙门控「算忙→置 pending」统一收口，外层门会使 busy-pending 复查臂不可达）。
      const failSince = this._heartbeatFailSince;
      this._heartbeatFailSince = null;
      this._degradedWarned = false;
      const degradedMs = failSince === null ? 0 : Date.now() - failSince;
      if (degradedMs > RECOVER_AFTER_DEGRADED_MS || this._recoverPendingAfterDegraded) {
        void this._maybeRecoverAfterDegraded(degradedMs);
      }
      // task-18（FR-07 / D-004@v1）：心跳健康 → 触发 outbox drain。
      this._resilience?.notifyHeartbeatResult(true);
      // 2026-06-29-runtime-allowed-roots-config task-04：心跳响应同步 allowed_roots。
      this._syncAllowedRoots(hbResp);
      // task-06（design A1）：心跳响应 pending_controls > 0 → 控制指令补拉
      //（backend task-04 起携带；旧 backend 无该字段视为 0 不触发）。
      this._maybeTriggerControlPull(hbResp);
      return true;
    } catch (e) {
      // task-06（design A1）：heartbeat 401/403 → 凭证被平台拒绝（D-002 边界外
      // 的异常态，如 api_key 失效）。记一次 FATAL（运维感知，不静默），并清空
      // 注册表让 _retryRegisterIfNeeded 退避重注册接管——重试成功即恢复三循环。
      const hubStatus = (e as { status?: number } | undefined)?.status;
      if (hubStatus === 401 || hubStatus === 403) {
        this._logger.error('heartbeat_auth_rejected', {
          daemon_local_id: daemonLocalId,
          status: hubStatus,
          message: (e as Error | undefined)?.message ?? String(e),
        });
        this._registeredRuntimes.clear();
        this._resilience?.notifyHeartbeatResult(false);
        // task-06（D-008）：凭证断连同样累计降级起点——本分支提前 return 发生在
        // 下方 failSince 置位之前，不补置则纯凭证断连 failSince 恒 null、恢复后
        // 不触发恢复链（期间 sweep 同样翻 suspended，语义应与网络断连一致）。
        // 已非 null 保持原值不覆盖（沿用最早断连时刻）；FATAL 日志语义不变。
        if (this._heartbeatFailSince === null) {
          this._heartbeatFailSince = Date.now();
        }
        return false;
      }
      // task-02（FR-01）：展开 cause 暴露底层 undici code。
      // task-05（FR-03 / D-006）→ task-07 per-daemon：累加断连时长，超阈值记一次
      //   FATAL（运维感知），不主动调 offline——backend 45s 自然判 daemon 实体
      //   offline（runtime 联动），网络恢复后 heartbeat 自动拉回 online。
      if (this._heartbeatFailSince === null) {
        this._heartbeatFailSince = Date.now();
      }
      const elapsed = Date.now() - (this._heartbeatFailSince ?? Date.now());
      if (
        !this._degradedWarned &&
        elapsed >= this._config.disconnect_log_threshold_sec * 1000
      ) {
        this._logger.error('daemon_disconnect_degraded', {
          daemon_local_id: daemonLocalId,
          elapsed_sec: Math.round(elapsed / 1000),
        });
        this._degradedWarned = true;
      }
      this._logger.warn('heartbeat_failed', {
        daemon_local_id: daemonLocalId,
        message: (e as Error | undefined)?.message ?? String(e),
        cause: extractCause(e),
      });
      // task-18：心跳失败 → 标记不健康（drainOutbox 不补发，等恢复）。
      this._resilience?.notifyHeartbeatResult(false);
      return false;
    }
  }

  /**
   * task-06（design A1）：register 周期重试。心跳循环每拍（15s）检测
   * `_registeredRuntimes` 为空时调用——按退避节流（15s 起步翻倍封顶 60s）重放
   * `_registerDaemon(启动期探测快照)`。失败记日志不崩（_registerDaemon 内部
   * catch）；成功清计数（下拍恢复正常心跳）。未探测到 agent（快照空）时跳过
   *（保持「无 agent 不注册」语义，同启动路径 no_agents_detected）。
   */
  private async _retryRegisterIfNeeded(): Promise<void> {
    if (this._lastAvailableAgents.length === 0) return;
    const now = Date.now();
    if (now < this._nextRegisterRetryAt) return;
    this._logger.info('register_retry', {
      daemon_local_id: this._config.runtime_id,
      attempt: this._registerRetryCount + 1,
      providers: this._lastAvailableAgents.map((a) => a.provider),
    });
    await this._registerDaemon(this._lastAvailableAgents);
    if (this._registeredRuntimes.size > 0) {
      // 成功：清计数，恢复心跳循环正常节拍。
      this._registerRetryCount = 0;
      this._nextRegisterRetryAt = 0;
      return;
    }
    // 失败：翻倍退避（15→30→60→60…），从当前拍起算。
    this._registerRetryCount += 1;
    const delayMs = Math.min(
      REGISTER_RETRY_BASE_MS * 2 ** (this._registerRetryCount - 1),
      REGISTER_RETRY_MAX_MS,
    );
    this._nextRegisterRetryAt = now + delayMs;
    this._logger.warn('register_retry_scheduled', {
      daemon_local_id: this._config.runtime_id,
      fail_count: this._registerRetryCount,
      next_retry_in_ms: delayMs,
    });
  }

  /**
   * task-06（design A1）：心跳响应 pending_controls > 0 → 对账第 3 步（仅控制
   * 指令补拉）。fire-and-forget——补拉失败（旧 backend 404/网络错）由
   * _pullPendingControlsForAllRuntimes 内 catch 降级 warn，不影响心跳节拍。
   */
  private _maybeTriggerControlPull(resp: unknown): void {
    if (!resp || typeof resp !== 'object') return;
    const pending = (resp as Record<string, unknown>).pending_controls;
    if (typeof pending !== 'number' || !Number.isFinite(pending) || pending <= 0) {
      return;
    }
    this._logger.info('pending_controls_signal', { count: pending });
    void this._pullPendingControlsForAllRuntimes();
  }

  /**
   * task-06（design A1/A2）：对所有已注册 runtime 各跑一趟控制指令补拉
   *（getPendingControls → dispatcher 消费+ack）。单 runtime 失败（旧 backend
   * 无端点 404 / 网络错）降级 warn 不崩，其余 runtime 照常（对账后续步骤由
   * 调用方继续）。
   */
  private async _pullPendingControlsForAllRuntimes(): Promise<void> {
    for (const rid of this._registeredRuntimeIds()) {
      try {
        const summary = await this._controlDispatcher.pullAndConsume(rid);
        if (summary.pulled > 0) {
          this._logger.info('pending_controls_pulled', {
            runtime_id: rid,
            pulled: summary.pulled,
            consumed: summary.consumed,
            acked: summary.acked,
          });
        }
      } catch (e) {
        // 旧 backend 无 pending-controls 端点（404）或网络失败——降级 warn，
        // 指令留 backend pending 等下轮（constraints：不崩、后续步骤照常）。
        this._logger.warn('pending_controls_pull_failed', {
          runtime_id: rid,
          error: e,
        });
      }
    }
  }

  /**
   * 2026-06-29-runtime-allowed-roots-config task-04 → task-07 per-daemon：心跳响应
   * 同步 allowed_roots。
   *
   * 单条 WS 后 allowed_roots 来源唯一（daemon 实体级），不再需要 per-runtime 并集。
   * 响应 allowed_roots 写入 config.allowed_roots（展开 ~/.sillyhub 占位 + homedir 兜底）。
   * 向后兼容：响应无 allowed_roots 字段（旧 backend）→ 不动。
   */
  private _syncAllowedRoots(resp: Record<string, unknown> | unknown): void {
    if (!resp || typeof resp !== 'object') return;
    const obj = resp as Record<string, unknown>;
    // 2026-07-06-allowed-roots-per-runtime：per-runtime map
    // （runtimes: [{runtime_id, allowed_roots}]），各 runtime 独立同步 PolicyCache。
    const runtimesRaw = obj.runtimes;
    if (Array.isArray(runtimesRaw)) {
      // 2026-07-08：只在 roots 真变化时 set + 打日志。旧实现每次心跳无条件 log
      // → allowed_roots_synced_per_runtime spam（心跳 N 秒一次 × runtime 数）。
      // 变化检测：JSON.stringify 对比缓存内 allowedRoots，相同则跳过 set 与日志。
      let changed = 0;
      for (const item of runtimesRaw) {
        if (!item || typeof item !== 'object') continue;
        const rt = item as Record<string, unknown>;
        const rid = rt.runtime_id;
        const rootsRaw = rt.allowed_roots;
        if (!Array.isArray(rootsRaw)) continue;
        const runtimeId = rid === undefined || rid === null ? '' : String(rid);
        if (!runtimeId || !this._policyCache) continue;
        const expanded = rootsRaw
          .filter((p): p is string => typeof p === 'string')
          .map((p) => p.replace(/^~(?=$|[/\\])/, homedir()));
        const union = new Set<string>(expanded);
        union.add(homedir());
        // FR-003：sillyspec 临时路径放行（与 register 注入点同步）。
        for (const temp of SILLYSPEC_TEMP_ROOTS) union.add(temp);
        const normalized = normalizeAllowedRoots([...union]);
        const existing = this._policyCache.get(runtimeId)?.allowedRoots;
        // 短路（task-03，D-004@v1）：task-01 后 existing 与 normalized 均为
        // normalizeAllowedRoots 归一字符串，同口径可直接 JSON.stringify 比较。
        // existing undefined（cache 无该 runtime，noUncheckedIndexedAccess）→ 视为需 set，走原 set 路径，
        // 不把 undefined 与字符串比较。相同则跳过 set + changed++，消除每心跳无谓 set。
        if (
          existing !== undefined &&
          JSON.stringify(existing) === JSON.stringify(normalized)
        ) {
          continue;
        }
        this._policyCache.set(runtimeId, normalized);
        changed++;
      }
      if (changed > 0) {
        this._logger.info('allowed_roots_synced_per_runtime', {
          count: runtimesRaw.length,
          changed,
        });
      }
      return;
    }
    // 兼容旧 backend（allowed_roots 单值 → 同步到所有 runtime，过渡期）
    const raw = obj.allowed_roots;
    if (!Array.isArray(raw)) return;
    const expanded = raw
      .filter((p): p is string => typeof p === 'string')
      .map((p) => p.replace(/^~(?=$|[/\\])/, homedir()));
    const union = new Set<string>(expanded);
    union.add(homedir());
    const normalized = normalizeAllowedRoots([...union]);
    if (JSON.stringify(normalized) !== JSON.stringify(this._config.allowed_roots)) {
      this._config.allowed_roots = normalized;
    }
    this._syncPolicyCache(normalized);
  }

  /**
   * ql-20260705-008：把 allowed_roots 同步到 PolicyCache（每个 registered runtime）。
   * 心跳 _syncAllowedRoots + register 都调，确保 PolicyCache 有数据。_policyCache
   * null（未注入，仅旧测试）→ no-op。
   */
  private _syncPolicyCache(roots: string[]): void {
    if (!this._policyCache) return;
    // FR-003：sillyspec 临时路径放行（与 register/心跳 per-runtime 注入点同步）。
    // roots 已 normalize，临时路径并入后再 normalize 一次去重归一。
    const union = new Set<string>(roots);
    for (const temp of SILLYSPEC_TEMP_ROOTS) union.add(temp);
    const normalized = normalizeAllowedRoots([...union]);
    for (const runtimeId of this._registeredRuntimes.values()) {
      if (runtimeId) this._policyCache.set(runtimeId, normalized);
    }
  }

  /**
   * task-13（2026-07-02-daemon-filesystem-policy / D-004 / R-07）：处理 WS POLICY_UPDATE 推送。
   *
   * 与 {@link _syncAllowedRoots}（心跳兜底）互补：
   *   - 心跳路径是「定期全量刷新」，WS 推送是「admin 改动后即时单点更新」（sub-second）；
   *   - 两者都落到 `_policyCache.set(rid, roots)`，PolicyCache 内部 version 续递增。
   *
   * version 去重（R-07）：backend 推送带单调递增 version，daemon 维护 per-rid
   * 最大已见 version，**仅当新 version > 已记录才写入**，旧/乱序/重放包忽略。
   * 与 PolicyCache 自身 version 解耦（一个是推送序列号，一个是写入计数）。
   *
   * 兜底：_policyCache 为 null（未注入，仅旧测试场景）→ no-op，不抛错
   *（cli.ts 生产链路必注入 PolicyCache，task-11）。
   *
   * @param rid          目标 runtime_id
   * @param roots        新 allowed_roots（原始字符串）
   * @param version      backend 推送序列号（单调递增）
   */
  private _handlePolicyUpdate(
    rid: string,
    roots: string[],
    version: number,
  ): void {
    // 未注入 PolicyCache（仅旧测试场景）→ no-op（cli.ts 生产必注入，task-11）。
    if (!this._policyCache) return;
    const last = this._lastPolicyVersion.get(rid) ?? 0;
    // R-07：旧/重复 version 忽略（防乱序、防重放覆盖新值）。
    if (version <= last) {
      this._logger.info('policy_update_stale', { rid, version, last });
      return;
    }
    this._lastPolicyVersion.set(rid, version);
    // 严格按 backend 下发：不 expand `~`、不补 homedir（D-007，与 _syncAllowedRoots 一致）。
    // 口径统一（task-04，R-2）：与 register(:1022)/_syncPolicyCache(:1973)/_syncAllowedRoots
    // 同——所有 _policyCache.set 输入均为 normalizeAllowedRoots 归一字符串（task-01 后缓存
    // 不 realpath，realpath 由 isPathUnderAnyRoot 判定时做 task-02）。
    const normalized = normalizeAllowedRoots(roots);
    this._policyCache.set(rid, normalized);
    this._logger.info('policy_cache_set', { rid, count: normalized.length, version });
  }

  // ── 轮询循环（daemon.py:183-215，HTTP 兜底）────────────────────────────────

  /**
   * perf-remediation task-09 / D-003@v1：lease 通道跳过条件。
   * WS 健康且推送新鲜（isConnected + 距最后一条消息 < LEASE_POLL_SKIP_MS）→ true
   * （TASK_AVAILABLE 推送兜底分发，跳过本轮 lease HTTP 轮询）。断连 / 消息陈旧
   *（假活，R-05）/ 无 WS 客户端 → false（照常轮询兜底）。
   */
  private _leasePollSkippable(): boolean {
    const ws = this._wsClient;
    if (!ws || !ws.isConnected) return false;
    const last = ws.lastMessageAt;
    if (last === null || last === undefined) return false;
    return Date.now() - last < LEASE_POLL_SKIP_MS;
  }

  private async _pollLoop(signal: AbortSignal): Promise<void> {
    while (this._running) {
      try {
        await abortableSleep(this._config.poll_interval * 1000, signal);
        if (!this._taskRunner) continue; // daemon.py:188-189
        const allIds = [...this._registeredRuntimes.values()];
        // task-09 / D-003@v1：lease 通道门控——WS 健康且消息新鲜时整轮跳过 lease
        // 轮询（推送兜底）。计算一次、整轮复用（各 rid 共享同一条 WS）。
        const skipLeasePoll = this._leasePollSkippable();
        for (const rid of allIds) {
          if (skipLeasePoll) {
            this._logger.debug('poll_lease_skipped_ws_healthy', { rid });
          } else {
            await this._pullPendingLeasesOnce(rid);
          }

          // task-11 / FR-08 / D-004@v1：change-write 轮询分支（与 lease 轮询同节奏，
          // 独立通道，**不走** _runLeaseStateMachine 的 claim→start→runLease→complete
          // lease 三段；走 claim→本地写→complete→spec 回灌轻量流，FR-10 不启 agent）。
          // perf-remediation task-09 / Grill B-1：该分支**永不被 WS 门控跳过**——
          // protocol 无 change-write 消息类型、change_writer 不走 ws_hub，30s 轮询
          // 是唯一分发通道，门控会让 change 写任务失联。
          await this._pullPendingChangeWritesOnce(rid);
        }
      } catch (e) {
        if (e instanceof AbortError) break;
        this._logger.warn('poll_failed', { error: e });
      }
    }
  }

  /**
   * 单 runtime 一趟 pending lease 补拉（原 _pollLoop 循环体抽出，行为不变；
   * task-06 起重连对账第 4 步复用）。poll payload 字段映射（daemon.py:199-206）：
   * 把 server 返回的 snake_case 组装成 LeaseCtx（camelCase）后 _fire 非阻塞执行。
   * 单趟失败降级 debug（同原 catch 语义——轮询兜底通道，失败等下一拍）。
   */
  private async _pullPendingLeasesOnce(rid: string): Promise<void> {
    try {
      const pending = await this._client.getPendingLeases(rid);
      for (const task of pending) {
        const leaseId = task.lease_id as string | undefined;
        if (!leaseId) continue;
        this._logger.info('poll_task', { lease_id: leaseId });
        const payload: LeasePayload = {
          leaseId,
          runtimeId: rid,
          agentRunId: (task.agent_run_id as string | undefined) ?? undefined,
          prompt: (task.prompt as string | undefined) ?? undefined,
          provider: (task.provider as string | undefined) ?? undefined,
          cmdPath: (task.cmd_path as string | undefined) ?? undefined,
        };
        this._fire(() => this._executeTask(payload));
      }
    } catch (e) {
      this._logger.debug('poll_runtime_failed', { rid, error: e });
    }
  }

  /**
   * 单 runtime 一趟 pending change-write 补拉（原 _pollLoop 循环体抽出，行为
   * 不变；task-06 起重连对账第 4 步复用——「含 change-write 分支保持现状」）。
   */
  private async _pullPendingChangeWritesOnce(rid: string): Promise<void> {
    try {
      const writes = await this._client.getPendingChangeWrites(rid);
      for (const w of writes) {
        const taskId = w.task_id as string | undefined;
        if (!taskId) continue;
        this._fire(() => this._executeChangeWrite(taskId, rid, w));
      }
    } catch (e) {
      this._logger.debug('poll_change_writes_failed', { rid, error: e });
    }
  }

  /**
   * task-06（design A1）：重连后统一对账。四步顺序固定：
   *   1. 立即拍一次 HTTP 心跳（加速 backend 在线状态恢复——对冲 WS 断开 10s
   *      延迟降级的 offline 标记，design A4/D-007；同时拉 allowed_roots/pending 计数）；
   *   2. drain outbox（上行回放，原 onConnected 逻辑并入此处，不重复调用）；
   *   3. 补拉控制指令（dispatcher pullAndConsume：消费+ack，design A2）；
   *   4. 补拉 pending leases + change-writes（复用 _pollLoop 既有补拉逻辑）。
   *
   * 幂等 + `_reconciling` 防重入：并发触发（如重连风暴下多个 onConnected）只跑
   * 一轮，后到者直接返回。各步失败均降级 warn 不崩（单步失败不阻断后续步——
   * 旧 backend 无 pending-controls 端点时对账照常走完）。
   */
  private async _reconcileAfterReconnect(): Promise<void> {
    if (this._reconciling) return;
    this._reconciling = true;
    try {
      this._logger.info('reconcile_after_reconnect_started', {
        daemon_local_id: this._config.runtime_id,
      });
      // 第 1 步：立即心跳（未注册任何 runtime 时跳过——同心跳循环守卫）。
      await this._sendHeartbeatOnce();
      // 第 2 步：drain outbox（断连期间暂存的上行回放；resilience 未注入跳过）。
      try {
        await this._resilience?.drainOutbox();
      } catch (e) {
        this._logger.warn('reconcile_drain_outbox_failed', { error: e });
      }
      // 第 3 步：补拉控制指令（逐 runtime；失败 warn 由内部 catch 降级）。
      await this._pullPendingControlsForAllRuntimes();
      // 第 4 步：补拉 pending leases（含 change-write 分支，保持现状语义）。
      // 同 _pollLoop 守卫（daemon.py:188-189）：无 taskRunner 不轮询——lease 与
      // change-write 均由 runner 执行，拉了也无法消费（AC-02b 语义）。
      if (this._taskRunner) {
        for (const rid of this._registeredRuntimeIds()) {
          await this._pullPendingLeasesOnce(rid);
          await this._pullPendingChangeWritesOnce(rid);
        }
      }
      this._logger.info('reconcile_after_reconnect_done', {
        daemon_local_id: this._config.runtime_id,
      });
    } finally {
      this._reconciling = false;
    }
  }

  // ── WS 循环（daemon.py:219-251，抽象为 WsClient 委托，R4.3）─────────────────

  private async _wsLoop(signal: AbortSignal): Promise<void> {
    // task-07 / D-006：单条 WS（daemon_local_id）。WsClient 内部自动管理重连；
    // daemon 每秒 reconcile——register 后无 WS 则建，全部 unregister 则关；
    // _reapStaleWsClient 假活看门狗（2026-08-27）——状态机任何未知漏洞令
    // isConnected 永真且 keepalive 失效时，按消息新鲜度强制自愈重建。
    while (this._running) {
      try {
        this._ensureWsClient();
        this._reapStaleWsClient();
        await abortableSleep(1000, signal);
      } catch (e) {
        if (e instanceof AbortError) break;
        this._logger.warn('ws_loop_error', { error: e });
        break;
      }
    }
  }

  /**
   * 假活看门狗（2026-08-27 网络切换 WS 永久假连事故）。
   *
   * 事故形态：旧 socket 迟到 close 事件串扰致 keepalive 丢失（已由
   * ws-client 事件身份守卫修复），此后网络切换的黑洞连接无 ping/pong 检测，
   * WsClient 状态卡 Connected、connect() 幂等保护令重连永不触发——HTTP
   * 心跳与会话 HTTP 兜底照常（「在线」假象），唯独 backend→daemon RPC
   * （git-log / explorer）持续 502。
   *
   * 本看门狗按与 _wsPushFresh 相同的新鲜度判据升级为自愈动作：isConnected
   * 且 lastMessageAt（消息+pong）陈旧 ≥ WS_STALE_REAP_MS → _closeWsClient
   * 关闭，下一拍 _ensureWsClient 重建新连接。lastMessageAt 为 null 时以
   * connectedAt 兜底（连接建立却始终无消息无pong 超阈值同样判假活）；
   * 两者皆 null（mock 未实现/形态未知）fail-open 跳过，交给 keepalive
   * 主判据。健康链路 ping/pong（30s 周期）恒刷新新鲜度，不会误杀；重建
   * 瞬断由 RPC 超时重试与 lease HTTP 轮询兜底吸收。
   */
  private _reapStaleWsClient(): void {
    const ws = this._wsClient;
    if (!ws || !ws.isConnected) return;
    const last = ws.lastMessageAt ?? ws.connectedAt ?? null;
    if (last === null) return;
    if (Date.now() - last < WS_STALE_REAP_MS) return;
    this._logger.warn('ws_stale_connected_reaping', {
      daemon_local_id: this._config.runtime_id,
      last_message_at: ws.lastMessageAt,
      connected_at: ws.connectedAt ?? null,
      stale_ms: Date.now() - last,
    });
    this._closeWsClient();
  }

  /** Hub HTTP origin（WsClient 内部 http→ws / https→wss 转换）。 */
  private _serverOrigin(): string {
    return this._config.server_url.replace(/\/+$/, '');
  }

  /**
   * 按 provider 解析已注册的 runtime_id（task-14 runtimeIdProvider 用）。
   * 未注册返回空串 → 调用方 fail-closed deny（design D-007）。
   */
  resolveRuntimeId(provider: string): string {
    return this._registeredRuntimes.get(provider) ?? '';
  }

  private _registeredRuntimeIds(): string[] {
    return [...new Set(this._registeredRuntimes.values())].filter(Boolean);
  }

  private _firstRegisteredRuntimeId(): string | undefined {
    return this._registeredRuntimeIds()[0];
  }

  /**
   * scan 真阻塞（generic-wibbling-whisper.md 改造点 C）：发 WS 消息（PERMISSION_REQUEST）
   * 到 backend，供 SessionManager 的 permissionWsClient.send 调用。task-07：单条 WS
   * 收敛后直接用 ``_wsClient``。连接未就绪 / 发送异常 → 返回 false（fail-closed，
   * canUseTool 回调 deny，不让工具静默放行）。
   *
   * task-07（2026-08-29-daemon-platform-resilience / design A3）：PERMISSION_REQUEST
   * 例外——WS 不通时改走 HTTP 上行（submitPermissionRequest）创建待审记录，
   * 返回 true 让 resolver 继续等人审（PERMISSION_RESPONSE 经 WS/补拉到达；
   * backend 5min 超时 + daemon fallback timer 双兜底），不再 fail-closed deny。
   */
  sendToHub(msg: { type: string; payload: unknown }): boolean {
    const ws = this._wsClient;
    if (!ws || typeof ws.send !== 'function') {
      if (msg.type === MSG.PERMISSION_REQUEST) {
        return this._uplinkPermissionRequestViaHttp(msg.payload);
      }
      this._logger.warn('send_to_hub_no_ws', { msg_type: msg.type });
      return false;
    }
    try {
      ws.send(msg);
      return true;
    } catch (e) {
      if (msg.type === MSG.PERMISSION_REQUEST) {
        return this._uplinkPermissionRequestViaHttp(msg.payload);
      }
      this._logger.warn('send_to_hub_failed', {
        msg_type: msg.type,
        error: (e as Error)?.message ?? String(e),
      });
      return false;
    }
  }

  /**
   * task-07（design A3）：PERMISSION_REQUEST 的 HTTP 上行兜底。
   *
   * fire-and-forget：POST /api/daemon/sessions/{id}/permission-requests（带当前
   * SessionState 的 claimToken），返回 true 表示已转 HTTP 在途（resolver 挂起等
   * PERMISSION_RESPONSE）。HTTP 失败仅 warn——由 daemon fallback timer（5min+5s）
   * deny 收口，不本地静默 allow。claimToken 空窗（恢复占位）/ client 未实现 /
   * payload 无 session_id → 返回 false 维持既有 fail-closed deny。
   */
  private _uplinkPermissionRequestViaHttp(rawPayload: unknown): boolean {
    const p = rawPayload as { session_id?: unknown } | null;
    const sessionId = typeof p?.session_id === 'string' ? p.session_id : '';
    if (!sessionId || typeof this._client.submitPermissionRequest !== 'function') {
      this._logger.warn('permission_http_uplink_unavailable', {
        session_id: sessionId || null,
      });
      return false;
    }
    const claimToken = this._sessionManager?.get(sessionId)?.claimToken ?? '';
    if (!claimToken) {
      // claim_token 空窗：backend X-Claim-Token 校验必拒，等价 fail-closed deny。
      this._logger.warn('permission_http_uplink_no_claim_token', {
        session_id: sessionId,
      });
      return false;
    }
    void this._client
      .submitPermissionRequest(
        sessionId,
        rawPayload as Record<string, unknown>,
        claimToken,
      )
      .then(() => {
        this._logger.info('permission_http_uplink_sent', { session_id: sessionId });
      })
      .catch((e: unknown) => {
        // 人审等待交由 backend 超时 + fallback timer 兜底（design A3）。
        this._logger.warn('permission_http_uplink_failed', {
          session_id: sessionId,
          error: (e as Error)?.message ?? String(e),
        });
      });
    return true;
  }

  /**
   * task-07 / D-006：确保单条 WS 客户端存在（连 backend Hub 带 daemon_local_id）。
   *
   * 收敛自 per-provider ``_wsClients`` Map：一个物理 daemon 对 backend 只开一条 WS。
   * 至少一个 provider 已注册（``_registeredRuntimes`` 非空）→ 若 ``_wsClient`` 为
   * null 则创建；否则保持。无已注册 runtime → 关闭并清空 ``_wsClient``。
   */
  private _ensureWsClient(): void {
    const hasRegistered = this._registeredRuntimes.size > 0;
    if (!hasRegistered) {
      this._closeWsClient();
      return;
    }
    if (this._wsClient !== null) return;

    const serverUrl = this._serverOrigin();
    // task-07：连接身份用 daemon_local_id（= config.runtime_id）。ws-client.ts 将其
    // 作为握手标识发送（详见 ws-client.ts：当前 query 参数名仍为 runtime_id，属遗留
    // 待补——backend task-06 已改期望 daemon_local_id，daemon 侧 ws-client.ts 握手字段
    // 改名不在本 task allowed_paths，见 review 标注）。
    const ws = this._wsClientFactory({
      serverUrl,
      runtimeId: this._config.runtime_id,
      // task-02（security-audit-remediation / FR-01）：WS 升级期带 X-API-Key
      //（config.api_key null → undefined，不发头）。key 本身不落日志。
      apiKey: this._config.api_key ?? undefined,
      callbacks: {
        onMessage: (msg) => {
          void this._handleWsMessage(msg);
        },
        // task-06（design A1）：WS 重连成功 → 统一对账（心跳→drain outbox→补拉
        // 控制指令→补拉 pending leases）。原 task-18 的 drainOutbox 并入对账第 2
        // 步，此处不再单独调用（不重复 drain）。幂等防重入见 _reconcileAfterReconnect。
        onConnected: () => {
          void this._reconcileAfterReconnect();
          // task-08（design A5）：WS 重连成功 = backend 可达信号——遗留待恢复
          // 记录（recover 网络失败重试队列）立即重试一轮，不等退避到期。
          this._retryPendingRecoveryNow();
        },
        // task-13（D-004）：POLICY_UPDATE 推送 → sub-second 热更新 PolicyCache。
        onPolicyUpdate: (rid, roots, version) => {
          this._handlePolicyUpdate(rid, roots, version);
        },
      },
    });
    this._registerListDirRpcHandler(ws);
    this._registerGetSpecBundleRpcHandler(ws);
    // task-03（2026-07-06-daemon-host-fs-delegate）：注册 host_fs.* 八方法 RPC handler。
    // backend complete_lease 收尾（apply_patch/post_scan/stage_callback）经 HostFsDelegate +
    // ws_rpc 调本 handler 在宿主执行（FR-02）。方法名带 host_fs. 前缀与 design §7 method 字段对齐。
    this._registerHostFsRpcHandler(ws);
    // task-03（2026-08-18-workspace-file-browser）：注册 explorer_* 三方法只读浏览
    // RPC（工作区文件浏览器，design §7.1）。roots 每次 RPC 现取 _effectiveAllowedRoots()，
    // **不**照抄裸 list_dir 的空 roots 跳校验写法（design §5 关键安全设计 1 警示条）。
    this._registerExplorerRpcHandler(ws);
    // task-01（2026-08-25-workspace-git-log）：注册 git_log 系四只读 RPC（平名，
    // design §5.2 CC-02 / §7.2 契约），供 backend git_log 模块经 MemberBindingResolver
    // 解析绑定后直连（不走 host_fs. 前缀降级通道）。task-01（2026-08-26-
    // workspace-git-status）追加第 5 个平名方法 git_status。
    this._registerGitLogRpcHandler(ws);
    // task-09（2026-08-19-runtime-live-daemon-read）：注册 runtime.* 四方法只读
    // RPC（运行时状态实时读取，design §6.1）。业务全在 RuntimeHandler（D-005@v1
    // 独立命名空间，不污染 host_fs 九方法契约）；RpcError code 经 _dispatchRpc
    // 原样回填，由 backend _map_runtime_remote_error 消费（§6.3 映射表）。
    this._registerRuntimeRpcHandler(ws);

    try {
      ws.connect();
    } catch (e) {
      this._logger.warn('ws_connect_failed', { daemon_local_id: this._config.runtime_id, error: e });
    }

    this._wsClient = ws;
    this._logger.info('ws_client_created', { daemon_local_id: this._config.runtime_id });
  }

  private _registerListDirRpcHandler(ws: WsClientLike): void {
    if (typeof ws.registerRpcHandler !== 'function') {
      this._logger.warn('ws_no_rpc_support', { daemon_local_id: this._config.runtime_id });
      return;
    }
    ws.registerRpcHandler('list_dir', async (params) => {
      const path = typeof params.path === 'string' ? params.path : '';
      // ql-20260706-006：目录浏览器遍历所有目录选择路径，不受 allowed_roots 限制。
      // 往 file-rpc 传入 policyEngine=null 时只要 fallbackRoots 为空数组就会抛错，
      // 这里直接传空白名单，让 file-rpc.listDir 跳过权限校验（只做存在+目录检查）。
      return listDir(path, null, '', []);
    });
    // 2026-07-09-remote-folder-picker task-02：list_roots RPC 供前端文件夹选择器拿磁盘根（FR-1），
    // 浏览自由同 list_dir（ql-20260706-006），不受 allowed_roots 限制。
    ws.registerRpcHandler('list_roots', async () => listRoots());
  }

  /**
   * 2026-06-30：spec import RPC——backend 经 WS RPC 让 daemon 打包客户端
   * rootPath/.sillyspec 整树为 tar，base64 编码回传。backend apply_sync 写入 spec_root。
   * daemon-client workspace 的 root_path 是宿主机路径（F:\WorkNew\SillyHub），daemon 可访问。
   */
  private _registerGetSpecBundleRpcHandler(ws: WsClientLike): void {
    if (typeof ws.registerRpcHandler !== 'function') return;
    ws.registerRpcHandler('get_spec_bundle', async (params) => {
      const rootPath = typeof params.root_path === 'string' ? params.root_path : '';
      if (!rootPath) throw new Error('root_path required for get_spec_bundle');
      // DA-2（2026-08-20 审计）：补 allowed_roots 守卫——原实现只判非空即打包，
      // 恶意/失陷 backend 可读宿主任意路径的 .sillyspec 整树外传；同文件其余
      // host_fs handler 均有此校验，此处对齐（含 symlink/junction realpath 判定）。
      assertWithinAllowedRoots(rootPath, this._effectiveAllowedRoots());
      const specDir = join(rootPath, '.sillyspec');
      const { packSpecDir } = await import('./spec-sync.js');
      // ql-20260701-002：排除 .runtime（运行时缓存含 worktrees 2.1G，非 spec 数据）。
      // D-002（2026-07-01-spec-import-async-and-change-reparse）：撤销 ql-003 的
      // excludeNames:['changes'] 误判——changes 是变更中心依赖（ChangeService.reparse 解析
      // 填 Change 表），必须导入。打包慢改由 backend import SSE 异步化解决，而非排除数据。
      // postSpecSync 回灌路径不受影响（不传此选项，保持含 .runtime）。
      const tarBuf = await packSpecDir(specDir, { excludeRuntime: true });
      return { tar_base64: tarBuf.toString('base64') };
    });
  }

  /**
   * task-03（2026-07-06-daemon-host-fs-delegate / FR-02）+ task-02（P3 driver gate pilot）
   * + task-02（2026-08-23-agent-log-conversation-view）：注册 host_fs.* 十方法 RPC handler。
   *
   * backend complete_lease 收尾的 3 个宿主操作（apply_patch / post_scan / stage_callback）
   * 经 HostFsDelegate（task-01）+ ws_rpc（task-02）调本 handler，在宿主（Windows）执行
   * stat / read_file / list_dir / git_apply / git_rev_parse / pollution_archive /
   * read_package_json / read_local_yaml。
   *
   * task-02（P3 driver gate pilot）：加第 9 方法 run_command，接 backend HostFsDelegate.run_command
   * 经 send_rpc（M5 带 timeout）转发的 gate 核验请求，在宿主跑 `sillyspec gate verify --change
   * <name> --json [--stage <stage>]`（命令白名单 R3 + AC-8 拒非 gate 命令），返回
   * `{exit_code, stdout, stderr, duration_ms}`（design §5.3 / §7）。
   *
   * task-02（2026-08-23-agent-log-conversation-view / FR-02）：加第 10 方法
   * read_agent_log_messages，接 backend platform_sync 转发的 agent 日志对话化读取
   * 请求，返回 `{status, messages, truncated, totalSegments, skippedLines}`
   * （design §7.1）。老 daemon 未注册本方法 → ws method-not-found 语义由
   * backend task-03 映射 422 HTTP_422_AGENT_LOG_UNSUPPORTED。
   *
   * 方法名带 `host_fs.` 前缀（与 design §7 method 字段对齐，避免与 list_dir /
   * get_spec_bundle 命名空间冲突）。handler 收 `params`（ws-client.ts:_dispatchRpc 已归一化
   * params 子对象），透传 workspace_id 仅用于日志（实际路径由 args 提供，与 backend
   * HostFsDelegate 签名一致）。
   *
   * allowed_roots 取 daemon 实体级 config（与 _registerListDirRpcHandler 同模式）。
   * 每方法 handler 内 try/catch 消化异常 → RpcError 结构化返回，**绝不冒泡到
   * ws-client.ts:_dispatchRpc 之外**（design §4.1 3 + task-03 验收）。
   */
  /**
   * 当前生效的 allowed_roots：config.allowed_roots（daemon 本地）∪ policyCache 各 runtime
   * roots 并集。host_fs handler 每次调 rootsProvider 现取，避免构造时快照冻结 —— platform
   * PUT allowed_roots 推 policy_update / 心跳 _syncAllowedRoots 后，下次 RPC 立即生效。
   */
  private _effectiveAllowedRoots(): string[] {
    const roots = new Set<string>(this._config.allowed_roots);
    if (this._policyCache) {
      const runtimeIds = [...new Set(this._registeredRuntimes.values())].filter(Boolean);
      for (const rid of runtimeIds) {
        const entry = this._policyCache.get(rid);
        if (entry?.allowedRoots) {
          for (const r of entry.allowedRoots) roots.add(r);
        }
      }
    }
    return [...roots];
  }

  private _registerHostFsRpcHandler(ws: WsClientLike): void {
    if (typeof ws.registerRpcHandler !== 'function') {
      this._logger.warn('ws_no_rpc_support', { daemon_local_id: this._config.runtime_id });
      return;
    }
    const handler = new HostFsHandler({ rootsProvider: () => this._effectiveAllowedRoots() });

    // 十方法各注册一次（method 带 host_fs. 前缀）。handler 抛 RpcError 由 _dispatchRpc
    // 原样回填 code；抛普通 Error 映射 internal（ws-client.ts:512-519）。
    ws.registerRpcHandler('host_fs.stat', async (params) => {
      const path = typeof params.path === 'string' ? params.path : '';
      return handler.stat(path);
    });
    ws.registerRpcHandler('host_fs.read_file', async (params) => {
      const path = typeof params.path === 'string' ? params.path : '';
      return { content: await handler.readFile(path) };
    });
    ws.registerRpcHandler('host_fs.list_dir', async (params) => {
      const path = typeof params.path === 'string' ? params.path : '';
      return handler.listDir(path);
    });
    ws.registerRpcHandler('host_fs.git_apply', async (params) => {
      const workdir = typeof params.workdir === 'string' ? params.workdir : '';
      const patch_data =
        typeof params.patch_data === 'string' ? params.patch_data : '';
      const use_3way = params.use_3way === true;
      return handler.gitApply({ workdir, patch_data, use_3way });
    });
    // task-02（2026-07-12-worker-worktree-isolation / design §7 + §7.5）：worktree 三方法。
    // git_worktree_add：per-worker sibling 副本创建（dispatch_worker 事件），D-008 默认 identity。
    ws.registerRpcHandler('host_fs.git_worktree_add', async (params) => {
      const workdir = typeof params.workdir === 'string' ? params.workdir : '';
      const sibling_path =
        typeof params.sibling_path === 'string' ? params.sibling_path : '';
      const branch = typeof params.branch === 'string' ? params.branch : '';
      const base_ref =
        typeof params.base_ref === 'string' ? params.base_ref : '';
      return handler.gitWorktreeAdd({
        workdir,
        sibling_path,
        branch,
        base_ref,
      });
    });
    // git_merge：converge 收敛合并 worker 分支（§7.5 第 4/5 行），冲突解析喂主 agent LLM。
    ws.registerRpcHandler('host_fs.git_merge', async (params) => {
      const workdir = typeof params.workdir === 'string' ? params.workdir : '';
      const worker_branch =
        typeof params.worker_branch === 'string' ? params.worker_branch : '';
      return handler.gitMerge({ workdir, worker_branch });
    });
    // git_worktree_remove：合并后清理 worker 副本（§7.5 第 8 行 cleanup 事件）。
    ws.registerRpcHandler('host_fs.git_worktree_remove', async (params) => {
      const workdir = typeof params.workdir === 'string' ? params.workdir : '';
      const sibling_path =
        typeof params.sibling_path === 'string' ? params.sibling_path : '';
      return handler.gitWorktreeRemove({ workdir, sibling_path });
    });
    ws.registerRpcHandler('host_fs.git_rev_parse', async (params) => {
      const root = typeof params.root === 'string' ? params.root : '';
      // ref 默认 HEAD（对齐 backend _get_source_commit；delegate 传具体 ref 时用之）。
      const ref =
        typeof params.ref === 'string' && params.ref.length > 0
          ? params.ref
          : 'HEAD';
      return handler.gitRevParse({ root, ref });
    });
    ws.registerRpcHandler('host_fs.pollution_archive', async (params) => {
      const source_root =
        typeof params.source_root === 'string' ? params.source_root : '';
      const runtime_root =
        typeof params.runtime_root === 'string' ? params.runtime_root : '';
      const scan_run_id =
        typeof params.scan_run_id === 'string' ? params.scan_run_id : '';
      return handler.pollutionArchive({
        source_root,
        runtime_root,
        scan_run_id,
      });
    });
    ws.registerRpcHandler('host_fs.read_package_json', async (params) => {
      const root = typeof params.root === 'string' ? params.root : '';
      return handler.readPackageJson({ root });
    });
    ws.registerRpcHandler('host_fs.read_local_yaml', async (params) => {
      const root = typeof params.root === 'string' ? params.root : '';
      return handler.readLocalYaml({ root });
    });
    // task-02（P3 driver gate pilot / design §5.3+§7）：第 9 方法 run_command。
    // 参数清洗（command/args/cwd/timeout/env 类型守卫）后调 handler.runCommand，
    // 白名单在 handler 内判定（R3/AC-8 拒非 gate 命令 → exit_code 126 结构化回传不抛）。
    // timeout 默认 12min（对齐 M5，与 backend HostFsDelegate.run_command 传值一致）；
    // 透传调用方值（params.timeout 合法 >0 时用之，不写死）。
    ws.registerRpcHandler('host_fs.run_command', async (params) => {
      const command = typeof params.command === 'string' ? params.command : '';
      const args = Array.isArray(params.args)
        ? params.args.filter((a) => typeof a === 'string')
        : [];
      const cwd = typeof params.cwd === 'string' ? params.cwd : '';
      const timeout =
        typeof params.timeout === 'number' && params.timeout > 0
          ? params.timeout
          : 12 * 60 * 1000;
      const env =
        params.env && typeof params.env === 'object' && !Array.isArray(params.env)
          ? (params.env as Record<string, string>)
          : null;
      return handler.runCommand({ command, args, cwd, timeout, env });
    });
    // task-02（2026-08-23-agent-log-conversation-view / FR-02 / design §7.1）：
    // 第 10 方法 read_agent_log_messages——agent 日志对话化读取（backend task-03
    // platform_sync 经 send_rpc 转发 path + format + beforeSeq?）。
    // 参数清洗与既有九方法同款：path/format 非字符串归一空串（由
    // assertWithinAllowedRoots 入口断言拒 forbidden）；beforeSeq 数字可选，
    // 非数字/缺省归 undefined（透传 handler → 解析器按 null = 不切片）。
    // not_found/forbidden 由 handler 抛 RpcError（与 read_file 同通道），
    // unsupported/too_large/parse_error 走 status 结构化返回（不抛）。
    ws.registerRpcHandler('host_fs.read_agent_log_messages', async (params) => {
      const path = typeof params.path === 'string' ? params.path : '';
      const format = typeof params.format === 'string' ? params.format : '';
      const beforeSeq =
        typeof params.beforeSeq === 'number' ? params.beforeSeq : undefined;
      return handler.readAgentLogMessages(path, format, beforeSeq);
    });
  }

  /**
   * task-03（2026-08-18-workspace-file-browser / FR-01 FR-05 FR-06 / D-002@v1）：
   * 注册 explorer_* 三方法只读浏览 RPC handler（design §7.1；函数实现归 task-01
   * file-rpc.ts，此处只做方法名注册 + params 归一）。
   *
   * backend explorer service 经 ws_rpc 转发工作区浏览请求：explorer_list_dir /
   * explorer_read_file / explorer_search。path/root 由 backend 按成员绑定 root_path
   * 透传；realpath 落点 + allowed_roots 双重校验（主防线，design §5 关键安全设计 1 /
   * R-01）全在 file-rpc.explorer* 内做，本层不重复。
   *
   * ⚠️ roots 每次 RPC 现取 ``this._effectiveAllowedRoots()``（host_fs rootsProvider
   * 同模式，daemon.ts:2405 附近；policy_update 推送 / _syncAllowedRoots 后下次调用
   * 立即生效）。**不得**照抄 _registerListDirRpcHandler 的空 roots 跳校验写法
   * （ql-20260706-006 豁免仅限裸 list_dir，design §5 警示条）。
   *
   * params 归一（对齐既有 handler 写法）：path/root/query 非字符串或缺省 → 归一为
   * 空串，由 explorer* 的入口断言拒 `forbidden`（"path/root/query is empty"）；
   * encoding 仅接受 'utf8'（缺省）| 'base64'，其它值显式拒 `forbidden`（不静默
   * 回退，防 backend 拼错被误当文本解码往返损坏）；max_results 缺省 100
   * （EXPLORER_DEFAULT_MAX_RESULTS），显式传入的非法值原样透传由 explorerSearch
   * 统一拒 `forbidden`（不静默钳制）。handler 不额外 try/catch：explorer* 抛
   * RpcError 由 ws-client._dispatchRpc 原样回填 code（普通 Error 映射 internal），
   * 不冒泡到 _dispatchRpc 之外（host_fs.* 同约定）。
   */
  private _registerExplorerRpcHandler(ws: WsClientLike): void {
    if (typeof ws.registerRpcHandler !== 'function') {
      this._logger.warn('ws_no_rpc_support', { daemon_local_id: this._config.runtime_id });
      return;
    }
    ws.registerRpcHandler('explorer_list_dir', async (params) => {
      const path = typeof params.path === 'string' ? params.path : '';
      const root = typeof params.root === 'string' ? params.root : '';
      return explorerListDir(path, root, this._effectiveAllowedRoots());
    });
    ws.registerRpcHandler('explorer_read_file', async (params) => {
      const path = typeof params.path === 'string' ? params.path : '';
      const root = typeof params.root === 'string' ? params.root : '';
      let encoding: 'utf8' | 'base64' = 'utf8';
      if (params.encoding === 'base64') {
        encoding = 'base64';
      } else if (params.encoding !== undefined && params.encoding !== 'utf8') {
        throw new RpcError(
          'forbidden',
          `invalid encoding: ${String(params.encoding)}`,
        );
      }
      return explorerReadFile(path, root, this._effectiveAllowedRoots(), encoding);
    });
    ws.registerRpcHandler('explorer_search', async (params) => {
      const root = typeof params.root === 'string' ? params.root : '';
      const query = typeof params.query === 'string' ? params.query : '';
      // 缺省 100（design §7.1）；显式传入的非法值（非正整数）原样透传由 explorerSearch
      // 统一拒 forbidden——不静默钳制，backend 端拼错应显式暴露而非悄悄改语义。
      const maxResults =
        params.max_results === undefined || params.max_results === null
          ? EXPLORER_DEFAULT_MAX_RESULTS
          : (params.max_results as number);
      return explorerSearch(root, query, this._effectiveAllowedRoots(), maxResults);
    });
  }

  /**
   * task-01（2026-08-25-workspace-git-log / design §5.2 CC-02 + §7.2）：注册
   * git_log / git_refs / git_show / git_diff_file 四只读 RPC handler——**平名注册**
   * （对齐 explorer 系 explorer_list_dir 形态，不走 host_fs. 前缀通道；protocol.ts
   * 仅定义 RPC 帧格式无方法注册表，无需改动）。
   *
   * + task-01（2026-08-26-workspace-git-status）：同注册器追加第 5 个平名 git 方法
   * git_status（十四字段状态契约，design §5.2 / §7.2；Grill CC-11 计数更正）。
   *
   * backend git_log 模块经 MemberBindingResolver 解析绑定 + resolve_root_path_for_daemon
   * 改写路径后直连本 RPC（显式超时 + 自持错误映射）；老 daemon 未注册 → method
   * not-found 语义由 backend 映射 422「daemon 版本过旧」。
   *
   * 业务实现复用 HostFsHandler（gitLog/gitRefs/gitShow/gitDiffFile，design §5.2
   * 骨架：assertWithinAllowedRoots 白名单 → runCmd('git') 独立 argv 只读子命令 →
   * 失败结构化回传不抛；空仓库捕获转空态 CC-17）。
   *
   * params 归一对齐既有 handler 写法：root/branch/author/sha/path 非字符串或缺省
   * 归一为空串（由方法入口断言拒 forbidden）；count 缺省 100（对齐 explorer
   * max_results 缺省形态），显式非法值原样透传由 handler 统一拒 forbidden——不静默
   * 钳制。roots 每次 RPC 现取 _effectiveAllowedRoots()（explorer 同模式）。
   */
  private _registerGitLogRpcHandler(ws: WsClientLike): void {
    if (typeof ws.registerRpcHandler !== 'function') {
      this._logger.warn('ws_no_rpc_support', { daemon_local_id: this._config.runtime_id });
      return;
    }
    const handler = new HostFsHandler({ rootsProvider: () => this._effectiveAllowedRoots() });

    ws.registerRpcHandler('git_log', async (params) => {
      const root = typeof params.root === 'string' ? params.root : '';
      const branch = typeof params.branch === 'string' ? params.branch : '';
      const author = typeof params.author === 'string' ? params.author : '';
      // 缺省 100；显式非法值（非正整数/超上限）透传由 handler 拒 forbidden（同 explorer_search）。
      const count =
        params.count === undefined || params.count === null
          ? 100
          : (params.count as number);
      return handler.gitLog({ root, branch, author, count });
    });
    ws.registerRpcHandler('git_refs', async (params) => {
      const root = typeof params.root === 'string' ? params.root : '';
      return handler.gitRefs({ root });
    });
    ws.registerRpcHandler('git_show', async (params) => {
      const root = typeof params.root === 'string' ? params.root : '';
      const sha = typeof params.sha === 'string' ? params.sha : '';
      return handler.gitShow({ root, sha });
    });
    ws.registerRpcHandler('git_diff_file', async (params) => {
      const root = typeof params.root === 'string' ? params.root : '';
      const sha = typeof params.sha === 'string' ? params.sha : '';
      const path = typeof params.path === 'string' ? params.path : '';
      return handler.gitDiffFile({ root, sha, path });
    });
    // task-01（2026-08-26-workspace-git-status）：第 5 个平名 git 方法 git_status
    //（design §5.2 / §7.2 十四字段契约；fetch 15s 降级 + porcelain v2 + numstat 单源）。
    ws.registerRpcHandler('git_status', async (params) => {
      const root = typeof params.root === 'string' ? params.root : '';
      return handler.gitStatus({ root });
    });
  }

  /**
   * task-09（2026-08-19-runtime-live-daemon-read）：注册 runtime.* 四方法只读 RPC
   * （design §6.1 契约表）。backend RuntimeLiveService 经 ws_rpc 转发，daemon 在
   * 宿主侧读 specCacheRoot（~/.sillyhub/daemon/specs/<workspace_id>/）下实时状态：
   *
   * - runtime.read_progress：RuntimeHandler spawn sillyspec progress dump --json；
   * - runtime.read_user_inputs / list_artifacts / read_artifact：直读 .runtime/ 下文件。
   *
   * task-04（2026-08-20-runtime-readpoint-repo-first，design §5.2）：四方法透传
   * 可选 root_path 读点（仓库优先缓存回退，D-01@v1）。
   *
   * params 归一对齐 explorer handler 写法：workspace_id/filename 非字符串或缺省
   * 归一为空串，由 RuntimeHandler 入口断言拒 forbidden；root_path 经
   * normalizeRootPathParam 归一（非字符串/空串 → undefined = 缓存读点）。
   * handler 不额外 try/catch：RuntimeHandler 抛 ws-client.RpcError（code 语义化），
   * _dispatchRpc 原样回填（普通 Error 映射 internal），不冒泡（explorer / host_fs
   * 同约定）。
   */
  private _registerRuntimeRpcHandler(ws: WsClientLike): void {
    if (typeof ws.registerRpcHandler !== 'function') {
      this._logger.warn('ws_no_rpc_support', { daemon_local_id: this._config.runtime_id });
      return;
    }
    const handler = this._runtimeHandler;
    ws.registerRpcHandler('runtime.read_progress', async (params) => {
      const workspaceId = typeof params.workspace_id === 'string' ? params.workspace_id : '';
      const rootPath = normalizeRootPathParam(params.root_path);
      return handler.readProgress(workspaceId, rootPath);
    });
    ws.registerRpcHandler('runtime.read_user_inputs', async (params) => {
      const workspaceId = typeof params.workspace_id === 'string' ? params.workspace_id : '';
      const rootPath = normalizeRootPathParam(params.root_path);
      return handler.readUserInputs(workspaceId, rootPath);
    });
    ws.registerRpcHandler('runtime.list_artifacts', async (params) => {
      const workspaceId = typeof params.workspace_id === 'string' ? params.workspace_id : '';
      const rootPath = normalizeRootPathParam(params.root_path);
      return handler.listArtifacts(workspaceId, rootPath);
    });
    ws.registerRpcHandler('runtime.read_artifact', async (params) => {
      const workspaceId = typeof params.workspace_id === 'string' ? params.workspace_id : '';
      const filename = typeof params.filename === 'string' ? params.filename : '';
      const rootPath = normalizeRootPathParam(params.root_path);
      return handler.readArtifact(workspaceId, filename, rootPath);
    });
  }

  private _closeWsClient(): void {
    if (this._wsClient === null) return;
    try {
      this._wsClient.close();
    } catch (e) {
      this._logger.warn('ws_close_failed', { daemon_local_id: this._config.runtime_id, error: e });
    }
    this._wsClient = null;
  }

  // ── 事件分发（daemon.py:253-267）───────────────────────────────────────────

  private async _handleWsMessage(msg: DaemonMessage): Promise<void> {
    // task-09：SESSION_SWITCH_CONFIG 常量暂在 daemon.ts 模块级（升格 protocol.ts
    // 前不在 MsgType 联合内），msgType 显式放宽为 string 让 switch 收新 case。
    const msgType: string = msg.type;
    // ql-20260616-006：backend WS 发 snake_case (lease_id/runtime_id/task_id)，
    // daemon 内部统一用 camelCase (LeasePayload/LeaseCtx)。在分发前做一次归一化，
    // 让 _executeTask 不再因字段名不匹配而 task_no_lease_id 丢任务。
    const rawPayload = (msg.payload ?? {}) as Record<string, unknown>;
    const payload: LeasePayload = {
      ...((rawPayload as unknown) as LeasePayload),
      leaseId:
        (rawPayload.leaseId as string | undefined) ??
        (rawPayload.lease_id as string | undefined) ??
        '',
      runtimeId:
        (rawPayload.runtimeId as string | undefined) ??
        (rawPayload.runtime_id as string | undefined) ??
        this._firstRegisteredRuntimeId() ??
        this._config.runtime_id,
      agentRunId:
        (rawPayload.agentRunId as string | undefined) ??
        (rawPayload.agent_run_id as string | undefined),
    };
    switch (msgType) {
      case MSG.TASK_AVAILABLE: {
        this._logger.info('task_available', { lease_id: payload.leaseId });
        if (!this._taskRunner) {
          this._logger.warn('task_available_no_runner');
          return;
        }
        // 非阻塞分发：_fire 立即返回，WS 接收下一条不受影响（R5）
        this._fire(() => this._executeTask(payload));
        break;
      }
      case MSG.HEARTBEAT_ACK: {
        this._logger.debug('heartbeat_ack', { payload });
        break;
      }
      // change 2026-08-05-daemon-kill-channel-unify task-04 / FR-03 / R-06：
      // backend cancel_lease 对 batch lease 标记 cancelled 后即时 WS 推送
      // LEASE_CANCEL（design §5 Phase2 / §7.5）。daemon 收到后非阻塞调
      // taskRunner.cancel(leaseId) 复用现有 AbortController → _killChild 即时
      // 杀 batch 子进程，不再等心跳周期。payload.leaseId 已在入口归一化（上方
      // snake/camel 双写）；与心跳轮询双触发幂等由 taskRunner.cancel 内部保证
      //（AbortController 已 aborted 则 abort() no-op、_killChild 检查 child.killed）。
      case MSG.LEASE_CANCEL: {
        const cancelLeaseId = payload.leaseId;
        if (!cancelLeaseId) {
          this._logger.warn('lease_cancel_no_lease_id', { runtime_id: payload.runtimeId });
          return;
        }
        if (!this._taskRunner || typeof this._taskRunner.cancel !== 'function') {
          this._logger.warn('lease_cancel_no_runner', { lease_id: cancelLeaseId });
          return;
        }
        this._logger.info('lease_cancel_received', { lease_id: cancelLeaseId });
        // 非阻塞分发（同 SESSION_INJECT 风格，不阻塞 WS 接收）；cancel 内部幂等，
        // 失败仅 error 不崩（best-effort，心跳轮询兜底）。
        void this._taskRunner
          .cancel(cancelLeaseId)
          .then((cancelled: boolean) => {
            this._logger.info('lease_cancel_handled', {
              lease_id: cancelLeaseId,
              cancelled,
            });
          })
          .catch((e: unknown) => {
            this._logger.error('lease_cancel_failed', {
              lease_id: cancelLeaseId,
              error: e,
            });
          });
        break;
      }
      // change 2026-08-06-provider-switch-live-session task-06 / FR-04 / D-002@v1 /
      // design §5 Wave2：backend set/unset_default 经 WS 即时推送供应商热切换指令。
      // 2026-08-29-daemon-platform-resilience task-06：改经 control-dispatcher 统一
      // 消费（kind 路由到下方 _routeProviderConfigChanged 既有实现 + command_id
      // 去重 + ack 收集；payload 无 command_id 的旧 backend 消息行为不变）。
      case MSG.PROVIDER_CONFIG_CHANGED: {
        // 非阻塞分发（同 SESSION_INJECT / LEASE_CANCEL 风格，不阻塞 WS 接收）。
        void this._dispatchControl(CONTROL_KIND.PROVIDER_CONFIG_CHANGED, rawPayload);
        break;
      }
      // task-04：交互式会话控制消息（SESSION_INJECT/INTERRUPT/END）路由到 SessionManager。
      // 2026-08-29-daemon-platform-resilience task-06：改经 control-dispatcher 统一
      // 消费——kind 路由到 _routeSessionControl 既有实现（四类共享），补拉消息走
      // 同一路径（断线窗口控制指令零丢失零重复，design A1+A2）。
      case MSG.SESSION_INJECT:
      case MSG.SESSION_INTERRUPT:
      case MSG.SESSION_END:
      case MSG.SESSION_RESUME: {
        // 非阻塞分发（同 task_available 风格，不阻塞 WS 接收）。
        void this._dispatchControl(
          CONTROL_MSG_TYPE_TO_KIND[msgType] ?? msgType,
          rawPayload,
        );
        break;
      }
      // task-02 verify P0 返工（2026-08-24-platform-session-feedback-fix / FR-02）：
      // 用户 plan 决策（backend handle_plan_response 落库后推送）→ 转交
      // SessionManager.resolvePlanResponse 注入 turn。无 lease_id 字段，不走
      // _routeSessionControl 的 lease 匹配校验，独立路由。
      case MSG.PLAN_RESPONSE: {
        // 非阻塞分发（同 SESSION_INJECT / SESSION_SWITCH_CONFIG 风格）。
        void this._routePlanResponse(rawPayload).catch((e) => {
          this._logger.error('plan_response_route_failed', { error: e });
        });
        break;
      }
      // task-09（2026-08-14-sessions-portal / FR-05 / D-012@v1 / design §5 Wave2）：
      // backend inject_session（带新配置 + prompt）→ WS SESSION_SWITCH_CONFIG 下发。
      // daemon 收到后非阻塞调 sessionManager.markPendingConfigSwitch（task-08 实现）：
      // 空闲 session 立即 reloadWithConfig 喂 prompt，生成中 turn 仅覆盖写
      // pendingConfigSwitch 等 _onResult 边界切换——reload 细节全部委托 task-08，
      // 本路由只做字段归一化 + 校验。
      case SESSION_SWITCH_CONFIG_MSG: {
        // 非阻塞分发（同 SESSION_INJECT / PROVIDER_CONFIG_CHANGED 风格）。
        void this._routeSessionSwitchConfig(rawPayload).catch((e) => {
          this._logger.error('session_switch_config_failed', { error: e });
        });
        break;
      }
      // task-08（D-007@v1 / FR-07）：backend PERMISSION_RESPONSE → resolver.resolve
      // settle canUseTool 回调。session 不存在 / resolver 不存在 / unknown_request
      // 只 warn 丢弃（迟到 response，turn 已结束）；不断 WS、不崩。
      // 2026-08-29-daemon-platform-resilience task-06：改经 control-dispatcher 统一
      // 消费（kind 路由到 _routePermissionResponse 既有实现 + 去重 + ack）。
      case MSG.PERMISSION_RESPONSE: {
        void this._dispatchControl(CONTROL_KIND.PERMISSION_RESPONSE, rawPayload);
        break;
      }
      // Server → Daemon：服务端判定 daemon 版本落后后推送的自更新指令。
      // task-04（S1）：改经单入口编排器 _tryUpdate——忙判定推迟（pending+30s 复查）/
      // 空闲走 runDaemonSelfUpdate 下载原子替换 → stop 前终检（Grill B3）→ 优雅
      // stop（释放 runtime lock / 标 offline / 挂起会话）→ respawnDaemonAndExit 以
      // detached 子进程拉起新 bundle（同启动参数）并退出——仓库不存在外部
      // supervisor（install wrapper 是一次性 exec，无 systemd/服务/计划任务），
      // 不自带拉起就会"更新完就死"（新进程 acquire lock 时旧进程已释放，无竞态）。
      // fire-and-forget（指令无回执，同 CLEANUP 惯例）；_tryUpdate 全路径内部
      // catch 收敛不 reject。
      case MSG.SELF_UPDATE: {
        const payload = (msg as { payload?: { version?: string } }).payload;
        this._logger.info('self_update_received', {
          version: payload?.version,
        });
        void this._tryUpdate('server_command', payload?.version);
        break;
      }
      // Server → Daemon：用户在 Web 端机器卡点「升级 sillyspec」触发。
      // 2026-08-31-machine-sillyspec-version task-05（FR-05 / D-001@v1）：入口对齐
      // SELF_UPDATE 写法——fire-and-forget（payload {} 可选不消费，npm latest 由
      // daemon 自行探测），void 调 manager.requestUpgrade('server_command')；
      // 全路径内部 catch 收敛不 reject（in-flight 门/忙推迟语义由 manager 状态机
      // 承载，daemon.ts 不重复实现），升级状态经心跳 sillyspec_update 回传。
      case MSG.SILLYSPEC_UPDATE: {
        this._logger.info('sillyspec_update_received', {});
        void this._sillyspecManager.requestUpgrade('server_command');
        break;
      }
      // Server → Daemon：清理本地缓存（specs 缓存 / Claude 会话日志 / 备份 / 日志）。
      // 黑名单删除（cleanup.ts CLEANABLE_DIRS），outbox/（未投递消息）与 runs/
      // （活跃任务日志，terminal-observer 另有 7 天保留期清理）不在清理范围。
      // fire-and-forget，无需回复 backend。交互会话运行中跳过（避免删掉正被写的
      // transcript / 正被部署的 skills），并发指令用 in-flight guard 去重。
      case MSG.CLEANUP: {
        if (this._cleanupInFlight) {
          this._logger.warn('cleanup_skipped_inflight', {});
          break;
        }
        if (this._interactiveSessionsByLease.size > 0) {
          this._logger.warn('cleanup_skipped_busy', {
            activeSessions: this._interactiveSessionsByLease.size,
          });
          break;
        }
        this._cleanupInFlight = true;
        this._logger.info('cleanup_received', {});
        try {
          const { performCleanup } = await import('./cleanup.js');
          const result = await performCleanup(DEFAULT_CONFIG_DIR);
          this._logger.info('cleanup_done', {
            entries: result.entries.length,
            freedBytes: result.totalFreedBytes,
          });
        } catch (e) {
          this._logger.warn('cleanup_failed', {
            error: (e as Error)?.message ?? String(e),
          });
        } finally {
          this._cleanupInFlight = false;
        }
        break;
      }
      default: {
        this._logger.warn('unknown_message_type', { type: msgType });
      }
    }
  }

  /**
   * task-06（design A2 消费端）：WS 控制消息统一经 control-dispatcher 消费。
   *
   * 从 payload 尾部提取 backend task-04 注入的可选 `command_id`（幂等去重键；
   * 旧 backend 消息无该字段 → dispatcher 跳过去重直接路由，行为与改造前一致）
   * 与 `runtime_id`（snake/camel 双读，ack 归属桶键）。去重命中（补拉在途时 WS
   * 同条到达）→ dispatcher 跳过执行并记日志；handler 业务失败由 dispatcher 捕获
   * 落 error 日志（原 case 内 `.catch` 收敛语义平移，不向上冒泡阻塞 WS 接收）。
   */
  private async _dispatchControl(
    kind: string,
    rawPayload: Record<string, unknown>,
  ): Promise<void> {
    const commandId =
      typeof rawPayload.command_id === 'string' ? rawPayload.command_id : undefined;
    const runtimeId =
      (typeof rawPayload.runtime_id === 'string' ? rawPayload.runtime_id : undefined) ??
      (typeof rawPayload.runtimeId === 'string' ? rawPayload.runtimeId : undefined);
    const outcome = await this._controlDispatcher.consume(kind, rawPayload, {
      commandId,
      runtimeId,
    });
    if (outcome === 'duplicate') {
      this._logger.info('control_command_duplicate_dropped', {
        kind,
        command_id: commandId,
      });
    }
  }

  /**
   * task-02 verify P0 返工：路由 PLAN_RESPONSE 到 SessionManager.resolvePlanResponse。
   *
   * 字段名兼容 snake_case（backend 发 session_id/run_id/decision/feedback）。
   * 校验：session_id/run_id 非空 + decision ∈ confirm/revise/cancel，否则 warn 丢弃。
   * 未注入 sessionManager → warn 不崩（同 _routeSessionControl AC-14）。决策送达
   * 结果（delivered true/false）记 info 日志——决策已在 backend 落库，失败可重发。
   */
  private async _routePlanResponse(raw: Record<string, unknown>): Promise<void> {
    if (!this._sessionManager) {
      this._logger.warn('plan_response_no_manager', {});
      return;
    }
    const sessionId =
      (raw.session_id as string | undefined) ?? (raw.sessionId as string | undefined) ?? '';
    const runId = (raw.run_id as string | undefined) ?? (raw.runId as string | undefined) ?? '';
    const decision = (raw.decision as string | undefined) ?? '';
    const feedback = raw.feedback as string | null | undefined;
    if (!sessionId || !runId) {
      this._logger.warn('plan_response_missing_fields', {
        session_id: sessionId,
        run_id: runId,
      });
      return;
    }
    if (decision !== 'confirm' && decision !== 'revise' && decision !== 'cancel') {
      this._logger.warn('plan_response_invalid_decision', {
        session_id: sessionId,
        decision,
      });
      return;
    }
    const delivered = await this._sessionManager.resolvePlanResponse(
      sessionId,
      runId,
      decision,
      feedback,
    );
    if (delivered) {
      this._logger.info('plan_response_delivered', { session_id: sessionId, run_id: runId });
    } else {
      this._logger.warn('plan_response_not_delivered', {
        session_id: sessionId,
        run_id: runId,
        decision,
      });
    }
  }

  /**
   * task-04：路由 SESSION_INJECT/INTERRUPT/END 到 SessionManager。
   *
   * 字段名兼容 snake_case（backend WS 发 session_id/lease_id/run_id/prompt）。
   * 校验：session 存在 + lease_id 与 store 中 state.leaseId 匹配，否则 warn 丢弃
   *（边界 6）。未注入 sessionManager → warn 不崩（AC-14）。
   */
  private async _routeSessionControl(
    msgType: string,
    raw: Record<string, unknown>,
  ): Promise<void> {
    if (!this._sessionManager) {
      this._logger.warn('session_control_no_manager', { type: msgType });
      // ql-20260831-005：INJECT 静默丢弃即回报 run failed（payload 三件齐时），
      // 不让 run 挂到 10 分钟 GC 才以笼统 interactive_inject_send_failed 收敛
      // （实机案：生产 wp 机 84cf91ab，delivered 后无回执）。
      if (msgType === MSG.SESSION_INJECT) {
        await this._reportInjectDropped(raw, 'daemon 会话管理器未初始化，消息未被处理');
      }
      return;
    }
    // task-08（session-history-enhance / FR-2）：SESSION_RESUME 在 session 尚未在
    // 内存 SessionStore 时到达（用户 reopen 历史 session），不能走下面 get(state)
    // + leaseId 匹配的 inject/end 校验路径——分流到 resume 分支。
    if (msgType === MSG.SESSION_RESUME) {
      await this._routeSessionResume(raw);
      return;
    }
    const sessionId =
      (raw.session_id as string | undefined) ?? (raw.sessionId as string | undefined) ?? '';
    const leaseId =
      (raw.lease_id as string | undefined) ?? (raw.leaseId as string | undefined) ?? '';
    if (!sessionId) {
      this._logger.warn('session_control_no_session_id', { type: msgType });
      return;
    }

    // ql-20260831-006（quick，替代原 3×100ms 短重试）：SESSION_INJECT 与 create
    // 写 store 的竞态窗口远大于原重试覆盖——backend 等 ready 仅 8s 即 fallback 发
    // inject，daemon create 实机可 ~31s（Windows 冷启动，会话 52893639 实证），
    // 短重试耗尽即丢弃 + 005 丢弃即报失败 → 会话必死。修：not_found 时转
    // _awaitSessionThenRoute 分离式等待（轮询至窗口上限，会话出现后重入本方法
    // 正常消费，超时才丢弃上报），handler 即刻返回不阻塞 WS/补拉分发批。其余
    // 控制消息（INTERRUPT/END）维持原语义不等待（not_found 为良性终态收敛）。
    if (msgType === MSG.SESSION_INJECT) {
      const earlyState = this._sessionManager.get(sessionId);
      if (!earlyState) {
        this._logger.info('inject_wait_session_parked', {
          session_id: sessionId,
          wait_ms: injectWaitSessionMs(),
        });
        void this._awaitSessionThenRoute(sessionId, raw);
        return;
      }
    }
    const state = this._sessionManager.get(sessionId);
    if (!state) {
      this._logger.warn('session_control_session_not_found', {
        type: msgType,
        session_id: sessionId,
      });
      // ql-20260831-006：INJECT 的 not_found 已在上方分流到 _awaitSessionThenRoute
      // 等待，此处仅非 INJECT 控制消息可达——not_found 是良性终态收敛（会话已
      // 不在，无 run 可失败），维持纯 warn。
      return;
    }
    if (state.leaseId !== leaseId) {
      // 边界 6：lease 不匹配（防误操作他人 session），warn 丢弃不操作。
      this._logger.warn('session_control_lease_mismatch', {
        type: msgType,
        session_id: sessionId,
        expected_lease_id: state.leaseId,
        received_lease_id: leaseId,
      });
      // ql-20260831-005：INJECT 丢弃即回报（收到指令的 run 不能挂着等 GC）。
      if (msgType === MSG.SESSION_INJECT) {
        await this._reportInjectDropped(
          raw,
          '消息指令与会话的 lease 不一致（daemon 防误操作校验拒绝执行）',
        );
      }
      return;
    }

    switch (msgType) {
      case MSG.SESSION_INJECT: {
        const runId =
          (raw.run_id as string | undefined) ?? (raw.runId as string | undefined) ?? '';
        const prompt = (raw.prompt as string | undefined) ?? '';
        if (!runId || !prompt) {
          this._logger.warn('session_inject_missing_fields', {
            session_id: sessionId,
            run_id: runId,
            prompt_len: prompt.length,
          });
          // ql-20260831-005：run_id 在即可回报该 run 失败；run_id 缺失无法定位
          // run（backend GC 联动同样依赖 payload.run_id），维持纯 warn。
          if (runId) {
            await this._reportInjectDropped(
              raw,
              '消息指令缺少必要字段（prompt 为空），daemon 无法执行',
            );
          }
          return;
        }
        // gap-8.4（design §11）：SESSION_INJECT 带 lease 级 claim_token（recover 后
        // rotated）。刷新 state.claimToken（恢复路径 restoreAndReconnect 占位空串），
        // 让后续 onTurnMessage（submitMessages）/ onTurnResult（notifyRunResult）能用新 token。
        const claimToken =
          (raw.claim_token as string | undefined) ?? (raw.claimToken as string | undefined) ?? '';
        if (claimToken) {
          await this._sessionManager.refreshClaimToken(sessionId, claimToken);
        }
        // 2026-08-20-session-multimodal-attachments task-09：附件透传（可选）。
        // raw.attachments 即协议 SessionInjectAttachment[]（snake_case）；下载闭包
        // 用 daemon 既有 hub client（D-4 回拉 / disk 落盘共用），旧 payload 无此键
        // → undefined 零回归。
        const attachments = raw.attachments as SessionInjectAttachment[] | undefined;
        const downloadAttachment = attachments?.length
          ? async (id: string): Promise<Buffer> => {
              if (!this._client.downloadSessionAttachment) {
                throw new Error('hub client does not support attachment download');
              }
              return this._client.downloadSessionAttachment(id);
            }
          : undefined;
        await this._sessionManager.inject(
          sessionId,
          prompt,
          runId,
          attachments,
          downloadAttachment,
        );
        break;
      }
      case MSG.SESSION_INTERRUPT: {
        await this._sessionManager.interrupt(sessionId);
        break;
      }
      case MSG.SESSION_END: {
        await this._sessionManager.end(sessionId);
        this._interactiveSessionsByLease.delete(state.leaseId);
        break;
      }
      default: {
        this._logger.warn('session_control_unknown_type', { type: msgType });
      }
    }
  }

  /**
   * ql-20260831-006（quick）：SESSION_INJECT 早到（daemon create 尚未写 store）时
   * 的分离式等待。
   *
   * 实机案（本地会话 52893639）：backend 等 ready 仅 8s 即超时 fallback 发
   * inject，daemon create 全链实机 ~31s（Windows 冷启动 + skills 拷贝 / MCP
   * bundle 预取），inject 到达与 store 写入差 23s——原 3×100ms 同步重试耗尽即
   * 丢弃，叠加 005「丢弃即报 run failed」把慢启动竞态变成会话必死。修：not_found
   * 时由 _routeSessionControl 分流到本方法，轮询等待（默认 60s，env
   * SILLYHUB_INJECT_WAIT_SESSION_MS 可调）store 出现该会话后重入
   * _routeSessionControl 走正常消费（lease 校验 / claim_token 刷新 / 附件全链），
   * 超时才 _reportInjectDropped（005 语义保留，只是延后到确认真等不到）。
   *
   * 分离式（void 调用、handler 即刻返回）而非同步 await：WS 案本就 fire-and-forget，
   * 补拉批（pullAndConsume 逐条 await）不能被 60s 等待阻塞同批后续指令（如
   * permission_response 是用户审批延迟敏感路径）。分离调用绕过了 dispatcher 的
   * handler_error catch，重入与超时上报各自兜 try/catch 防 unhandled rejection。
   *
   * quick 风险审查修（2026-09-01）：轮询加停机感知——stop() 后 _running=false，
   * 挂起中的 100ms 轮询链不应再把事件循环钉住最长 60s（systemd/launchd
   * Restart=always 场景会拖慢新实例接管）。停机即中止等待：不报 run failed
   * （消息未处理的原因是 daemon 退出而非会话未建，语义不符；backend 侧由
   * 控制指令 GC 兜底收敛），仅 warn 留痕。
   */
  private async _awaitSessionThenRoute(
    sessionId: string,
    raw: Record<string, unknown>,
  ): Promise<void> {
    const waitMs = injectWaitSessionMs();
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, INJECT_WAIT_POLL_MS));
      if (!this._running) {
        this._logger.warn('inject_wait_aborted_by_shutdown', {
          session_id: sessionId,
        });
        return;
      }
      if (this._sessionManager?.get(sessionId)) {
        this._logger.info('inject_wait_session_appeared', {
          session_id: sessionId,
          waited_ms: waitMs - (deadline - Date.now()),
        });
        try {
          await this._routeSessionControl(MSG.SESSION_INJECT, raw);
        } catch (e) {
          this._logger.error('inject_wait_reroute_failed', {
            session_id: sessionId,
            error: e,
          });
        }
        return;
      }
    }
    this._logger.warn('inject_wait_session_timeout', {
      session_id: sessionId,
      wait_ms: waitMs,
    });
    await this._reportInjectDropped(
      raw,
      `daemon 本地无该会话状态（等待 ${waitMs}ms 会话仍未创建，可能已结束、或 daemon 重启后未恢复），消息未被处理`,
    );
  }

  /**
   * ql-20260831-005：SESSION_INJECT 被 daemon 丢弃时立即回报 run failed。
   *
   * 背景（实机案：生产 wp 机会话 84cf91ab）：inject 已 delivered 但被
   * _routeSessionControl 的校验路径静默丢弃（只 warn），run 在 backend 挂起
   * pending，用户等 10 分钟才被控制指令 GC 用笼统 interactive_inject_send_failed
   * 收敛——原因（走了哪条丢弃路径）永远到不了前端。修：丢弃时用 inject payload
   * 自带的 run_id/lease_id/claim_token 立即 notifyRunResult 失败（P2b 同款
   * error_during_execution + is_error + result_summary 模式，:6105 先例），
   * result_summary 落 AgentRun.output_redacted → 经 SessionRunRead.failure_summary
   * 透出到前端错误卡（ql-20260831-004 链）。
   *
   * 约束：payload 三件（run_id/lease_id/claim_token）齐才上报——缺 run_id 无法
   * 定位 run（backend close_interactive_run 按 run_id 寻行），缺 claim_token 过
   * 不了 lease 校验；不齐仅记 warn（该形状 backend 本就不产，防御路径）。
   * 上报失败仅 warn：与 P2b 同语义，backend 侧 10min GC 兜底仍在。
   */
  private async _reportInjectDropped(
    raw: Record<string, unknown>,
    reason: string,
  ): Promise<void> {
    const runId =
      (raw.run_id as string | undefined) ?? (raw.runId as string | undefined) ?? '';
    const leaseId =
      (raw.lease_id as string | undefined) ?? (raw.leaseId as string | undefined) ?? '';
    const claimToken =
      (raw.claim_token as string | undefined) ??
      (raw.claimToken as string | undefined) ??
      '';
    if (!runId || !leaseId || !claimToken) {
      this._logger.warn('inject_drop_report_skipped_missing_fields', {
        run_id: runId,
        lease_id: leaseId,
        has_claim_token: Boolean(claimToken),
        reason,
      });
      return;
    }
    try {
      await this._client.notifyRunResult(leaseId, claimToken, runId, {
        status: 'error_during_execution',
        is_error: true,
        result_summary: `daemon 丢弃消息指令：${reason}；本轮失败`,
      });
      this._logger.info('inject_drop_reported', {
        run_id: runId,
        lease_id: leaseId,
        reason,
      });
    } catch (e) {
      this._logger.warn('inject_drop_report_failed', {
        run_id: runId,
        lease_id: leaseId,
        reason,
        error: e,
      });
    }
  }

  /**
   * task-08（session-history-enhance / FR-2）：路由 backend SESSION_RESUME。
   *
   * 与 INJECT/INTERRUPT/END 不同：resume 时目标 session 尚未在内存 SessionStore
   *（已 end 或 daemon 进程重启），用 backend 下发的 agent_session_id 调
   * SessionManager.restoreAndReconnect（driver.start({resume}) 跨进程还原 SDK 上下文，
   * spike D3）→ 随后 markReconnected 切 active → confirmReconnected 通知 backend
   * 收 confirm 切 status=active（task-06 DS-3，携 payload 的 leaseId/runtimeId）。
   *
   * 字段名 snake/camel 双写归一化（与 SESSION_INJECT 同风格，ql-20260616-006）：
   * backend 发 snake_case（task-07），daemon 入口映射到 PersistedSessionRecord
   *（camelCase），避免字段名漂移导致丢 resume。
   *
   * 边界（task-08.md AC-05 + task-06 DS-3）：
   *   - payload 缺 session_id / agent_session_id → warn 丢弃，不 resume；
   *   - restoreAndReconnect 抛错（provider 不支持 / driver.start 失败；内存残留
   *     同 id 条目自 ql-20260823-006 起在 session-manager 内先静默驱逐再恢复，
   *     不再抛 SessionAlreadyExistsError）或
   *     markReconnected 抛错 → 本方法内 catch 收敛（记 error + best-effort 调
   *     markRecoveryFailed 让 backend 立即置 failed），不再向上抛（与
   *     _routeProviderConfigChanged catch 收敛风格一致）；
   *   - confirmReconnected / markRecoveryFailed 自身失败仅 warn（best-effort：
   *     不回滚本地已恢复状态，backend 180s sweeper 兜底收敛）。
   */
  private async _routeSessionResume(
    raw: Record<string, unknown>,
  ): Promise<void> {
    if (!this._sessionManager) {
      // 与 _routeSessionControl 同风格：防御未来其它调用路径 NPE。
      this._logger.warn('session_resume received but SessionManager unavailable');
      return;
    }
    const sessionId =
      (raw.session_id as string | undefined) ?? (raw.sessionId as string | undefined) ?? '';
    const leaseId =
      (raw.lease_id as string | undefined) ?? (raw.leaseId as string | undefined) ?? '';
    // task-06（DS-3 / F1）：runtimeId 取自 SESSION_RESUME payload（protocol.ts:114
    // payload 已含 runtime_id；snake/camel 双写同款 ql-20260616-006）。reopen 路径
    // 唯一 runtimeId 来源——不写也不读 recover 链路的 _recoveryRuntimeBySession
    // 映射（映射由 recoverSession 写入，reopen 不经 recover）。
    const runtimeId =
      (raw.runtime_id as string | undefined) ?? (raw.runtimeId as string | undefined) ?? '';
    const agentSessionId =
      (raw.agent_session_id as string | undefined) ??
      (raw.agentSessionId as string | undefined) ??
      '';
    if (!sessionId || !agentSessionId) {
      // AC-05：缺 session_id / agent_session_id（无 SDK resume key）→ 拒绝 + warn。
      this._logger.warn('session_resume_missing_fields', {
        session_id: sessionId,
        agent_session_id: agentSessionId,
        lease_id: leaseId,
      });
      return;
    }
    // ql-20260703-001：改用 normalizeProvider（原粗暴三元 === 'codex' ? 'codex' : 'claude'
    // 会把 opencode/cursor/openclaw 误归 'claude'）。与 _startInteractiveSession create
    // 路径（:2338）统一归一化逻辑，两端一致。断言 union 同 create 路径（interactive
    // driver registry 只 claude/codex，types.ts:196）。
    const provider = normalizeProvider(raw.provider as string | undefined) as 'claude' | 'codex';
    // backend reopen payload 不带 exe path；按归一化后的 provider 从 _agentPaths
    //（agent-detector 注册：create 时 _agentPaths.set(provider, path)）补齐，否则
    // restoreAndReconnect 内 exe = record.pathToAgentExecutable ??
    // pathToClaudeCodeExecutable ?? '' 拿到空串 → Codex driver start() 抛
    // CodexExecutableNotFoundError → reopen 失败（design §11 Codex reopen 验收）。
    // 字段同时填 pathToAgentExecutable（Codex driver 读）+ pathToClaudeCodeExecutable
    //（兼容名，SessionManager.restoreAndReconnect fallback）。
    const exePath = this._agentPaths.get(provider) ?? '';
    // ql-20260827-014：backend reopen 随 SESSION_RESUME 下发的会话级供应商凭证
    //（resolve_bound_provider_config 解密，结构同 claim payload 的 provider_config；
    // snake/camel 双读同款 ql-20260616-006）。缺省（backend 未带——会话无供应商或
    // 解析降级）不写键 → restoreAndReconnect 走本机凭证链（零回归）。含 api_key
    // 明文，仅进 record（内存态/落盘 sessions.json 与既有快照同信任域），不入日志。
    const rawProviderConfig =
      (raw.provider_config as ProviderConfig | null | undefined) ??
      (raw.providerConfig as ProviderConfig | null | undefined);
    const record: PersistedSessionRecord = {
      sessionId,
      leaseId,
      agentSessionId,
      cwd: (raw.cwd as string | undefined) ?? '',
      provider,
      pathToClaudeCodeExecutable: exePath,
      pathToAgentExecutable: exePath,
      // backend reopen payload 不带 turnCount/lastActiveAt（非恢复必需），
      // 给合理默认：turnCount=0（新进程无内存计数），lastActiveAt=now。
      turnCount: 0,
      lastActiveAt: Date.now(),
      // null 归一缺省（record 类型不收 null；backend 不发 null，防御性归一）。
      ...(rawProviderConfig != null ? { providerConfig: rawProviderConfig } : {}),
    };
    // restoreAndReconnect 内部 new InputQueue + driver.start({resume}) + fire
    // consume 协程；成功返回后调 markReconnected 切 active。task-06（DS-3）：
    // 本地恢复与 backend 状态翻转是两步——daemon 必须向 backend confirm
    //（reconnecting → active）才算闭环；失败（含 SessionAlreadyExistsError
    // 在 session-manager 内部 try 前抛出）则 markRecoveryFailed 置 failed。
    try {
      await this._sessionManager!.restoreAndReconnect(record);
      await this._sessionManager!.markReconnected(sessionId);
    } catch (e) {
      // ql-20260831-001-6dde：本地副本仍在跑 turn——backend 的「daemon 侧副本
      // 已死」断言不成立。不驱逐（杀在途工作）、也不向 backend 写 failed
      //（把活会话误翻终态更糟），warn 后交 sweeper/后续流程收敛。
      if (e instanceof SessionBusyError) {
        this._logger.warn('session_resume_local_busy_skipped', {
          session_id: sessionId,
          lease_id: leaseId,
        });
        return;
      }
      this._logger.error('session_resume_restore_failed', {
        session_id: sessionId,
        lease_id: leaseId,
        error: e,
      });
      // best-effort：立即向 backend 写 reconnecting → failed（不等 sweeper 兜底）。
      // 自身失败（HTTP 抛错）仅 warn 不抛，与成功路径 confirm 同语义。
      try {
        await this._client.markRecoveryFailed?.(sessionId, String(e), {
          leaseId,
          runtimeId,
        });
      } catch (notifyErr) {
        this._logger.warn('session_resume_mark_recovery_failed_call_failed', {
          session_id: sessionId,
          lease_id: leaseId,
          error: notifyErr,
        });
      }
      return;
    }
    this._logger.info('session_resume_ok', { session_id: sessionId, lease_id: leaseId });
    // task-06（DS-3 / FR-03）：恢复成功向 backend confirm（reconnecting → active），
    // 显式携 payload 的 runtimeId（F1：不依赖 recover 映射）与 leaseId（供 backend
    // 防陈旧确认误翻）。best-effort：失败仅 warn——本地已恢复 active 不回滚，
    // backend 180s sweeper 兜底收敛（DS-6）。
    try {
      await this._client.confirmReconnected?.(sessionId, { leaseId, runtimeId });
    } catch (e) {
      this._logger.warn('session_resume_confirm_reconnected_failed', {
        session_id: sessionId,
        lease_id: leaseId,
        error: e,
      });
    }
    // task-03（design Phase 1 / FR-01 / gap-1 修正）：recover 成功路径双覆盖——daemon
    // 重启 recover 重建 session 完成（restoreAndReconnect + markReconnected 切回 active）
    // 后上报 session ready，与 fresh create（task-02 _startInteractiveSession）双覆盖，
    // 避免 recover 后 inject 等 ready 超时降级 fallback。best-effort：notifySessionReady
    // 自身失败 warn 不抛（hub-client.ts 实现），调用点无需 try/catch；恢复失败已在
    // 上方 catch 分支 return，不会走到本行，故仅成功路径上报。
    await this._client.notifySessionReady(sessionId);
  }

  /**
   * task-06（provider-switch-live-session / FR-04 / D-002@v1）：路由 backend
   * PROVIDER_CONFIG_CHANGED 到 SessionManager.markPendingSwitch。
   *
   * 与 SESSION_INJECT 同风格的 snake/camel 双写归一化（ql-20260616-006）：
   * backend WS 发 ``{session_id, provider_config}``（snake_case，task-02 protocol.py），
   * daemon 入口读两个常见大小写变体取值。
   *
   * 边界（task-06.md acceptance / constraints）：
   *   - 未注入 sessionManager → warn 不崩（与 _routeSessionControl 同 AC-14 风格）；
   *   - payload 缺 session_id → warn 丢弃（无目标 session 无法路由）；
   *   - provider_config 为 null → 透传 null 给 markPendingSwitch（D-004@v1 停止→回退本机凭证）；
   *   - session 不存在（迟到/WS 重放/SessionStore 已清）→ markPendingSwitch 抛
   *     SessionNotFoundError，此处 catch 收敛为 warn（best-effort，不崩 WS 主循环）。
   *
   * markPendingSwitch 同步返回 void（内部 reload 走 fire-and-forget），故本方法
   * 不 await 异步副作用——非阻塞分发契约由调用点 ``void ... .catch`` 保证。
   */
  private async _routeProviderConfigChanged(
    raw: Record<string, unknown>,
  ): Promise<void> {
    if (!this._sessionManager) {
      this._logger.warn('provider_config_changed_no_manager');
      return;
    }
    const sessionId =
      (raw.session_id as string | undefined) ?? (raw.sessionId as string | undefined) ?? '';
    if (!sessionId) {
      this._logger.warn('provider_config_changed_no_session_id');
      return;
    }
    // snake/camel 双写归一化；缺字段（undefined）→ null（停止/回退本机凭证语义）。
    // backend set_default 带 ProviderConfig dict；unset_default 显式发 null。
    const providerConfig =
      ((raw.provider_config as ProviderConfig | null | undefined) ??
        (raw.providerConfig as ProviderConfig | null | undefined)) ??
      null;
    this._logger.info('provider_config_changed_received', {
      session_id: sessionId,
      // 不打 provider_config 全量（含 api_key 明文，R-02 不入日志）；仅记有无。
      has_provider_config: providerConfig != null,
    });
    try {
      this._sessionManager.markPendingSwitch(sessionId, providerConfig);
    } catch (e) {
      // session 不存在（SessionNotFoundError）等——best-effort warn 丢弃，
      // 不让单条迟到消息崩 WS 主循环（design §9 向前兼容）。
      this._logger.warn('provider_config_changed_session_error', {
        session_id: sessionId,
        error: e,
      });
    }
  }

  /**
   * task-09（2026-08-14-sessions-portal / FR-05 / D-012@v1 / design §5 Wave2、§7.2）：
   * 路由 backend SESSION_SWITCH_CONFIG 到 SessionManager.markPendingConfigSwitch
   *（task-08 实现：空闲立即 reloadWithConfig 喂切换轮 prompt，生成中仅覆盖写
   * pendingConfigSwitch 等 turn 边界）。
   *
   * 与 SESSION_INJECT 同风格的 snake/camel 双写归一化（ql-20260616-006）：
   * backend WS 发 ``{session_id, run_id, claim_token, prompt, profile?,
   * provider_config?}``（snake_case，task-05 下发侧），daemon 入口读两个常见
   * 大小写变体取值。
   *
   * 校验口径与 SESSION_INJECT 一致（task-09.md constraints）：
   *   - 未注入 sessionManager → warn 不崩（AC-14 风格）；
   *   - 缺 session_id → warn 丢弃（无目标 session 无法路由）；
   *   - session 不在 SessionStore（迟到/WS 重放/已清）→ warn 丢弃，不调
   *     markPendingConfigSwitch（与 _routeSessionControl 的 session_not_found
   *     先例同语义；markPendingConfigSwitch 自身抛 SessionNotFoundError 时
   *     由下方 catch 二次兜底）；
   *   - 缺 run_id / claim_token / prompt（切换轮三要素，design §7.2）→ warn
   *     丢弃；profile / provider_config 缺省 → 归一为 null（不切，与
   *     SessionSwitchConfigPayload null 语义一致，非 fallback 编造）。
   *
   * markPendingConfigSwitch 同步返回 void（reload 走 fire-and-forget），故本
   * 方法不 await 异步副作用——非阻塞分发契约由调用点 ``void ... .catch`` 保证。
   * turn result 上报沿用 state.currentRunId/claimToken（task-08 在
   * reloadWithConfig 内写入），本路由不重复处理。
   */
  private async _routeSessionSwitchConfig(
    raw: Record<string, unknown>,
  ): Promise<void> {
    if (!this._sessionManager) {
      this._logger.warn('session_switch_config_no_manager');
      return;
    }
    const sessionId =
      (raw.session_id as string | undefined) ?? (raw.sessionId as string | undefined) ?? '';
    if (!sessionId) {
      this._logger.warn('session_switch_config_no_session_id');
      return;
    }
    // session 存在校验（属主口径与 SESSION_INJECT 一致：lease 级归属由
    // claim_token 承载——切换轮新 token 在 reloadWithConfig 内刷新）。
    const state = this._sessionManager.get(sessionId);
    if (!state) {
      this._logger.warn('session_switch_config_session_not_found', {
        session_id: sessionId,
      });
      return;
    }
    // 切换轮三要素（design §7.2）：runId=切换轮新 AgentRun，claimToken=切换轮
    // token，prompt=切换轮用户消息。缺一 → warn 丢弃（不 fallback 编造）。
    const runId =
      (raw.run_id as string | undefined) ?? (raw.runId as string | undefined) ?? '';
    const claimToken =
      (raw.claim_token as string | undefined) ??
      (raw.claimToken as string | undefined) ??
      '';
    // ql-20260817-011：prompt 允许空串（静默切换——只 reload 配置不喂消息，
    // reloadWithConfig 既有 if (payload.prompt) 守卫处理）；必填仅 runId/claimToken。
    const prompt = (raw.prompt as string | undefined) ?? '';
    if (!runId || !claimToken) {
      this._logger.warn('session_switch_config_missing_fields', {
        session_id: sessionId,
        run_id: runId,
        has_claim_token: !!claimToken,
        prompt_len: prompt.length,
      });
      return;
    }
    // profile：可 null（=不切，design §7.2）；缺省归一 null（null 与缺席同义）。
    const profile =
      ((raw.profile as SessionSwitchProfilePayload | null | undefined) ?? null);
    // ql-20260824-016：providerConfig 缺省**不**归一 null——后端切回本机默认时
    // 下发显式 null（service.py「会话供应商 NULL（本机默认）才发 null」），字段
    // 缺席才是不切该维度。?? null 会把缺席塌缩成 null、下游再 ?? 回旧供应商，
    // 两层塌缩叠加 = 「切回本机」永远不生效（实测 /model 仍显示 glm-5.1）。
    // 保留 undefined 让 reloadWithConfig 区分两种语义；snake 键存在（含显式
    // null）优先于 camel 键——?? 链会把显式 null 漏给第二键，须用 !== undefined。
    const providerConfig =
      raw.provider_config !== undefined
        ? (raw.provider_config as ProviderConfig | null)
        : (raw.providerConfig as ProviderConfig | null | undefined);
    this._logger.info('session_switch_config_received', {
      session_id: sessionId,
      run_id: runId,
      // 不打 provider_config 全量（含 api_key 明文，R-02 不入日志）；仅记有无。
      has_profile: profile != null,
      has_provider_config: providerConfig != null,
    });
    const payload: SessionSwitchConfigPayload = {
      sessionId,
      runId,
      claimToken,
      prompt,
      profile,
      providerConfig,
    };
    try {
      this._sessionManager.markPendingConfigSwitch(sessionId, payload);
    } catch (e) {
      // session 不存在（SessionNotFoundError）等——best-effort warn 丢弃，
      // 不让单条迟到消息崩 WS 主循环（design §9 向前兼容，同
      // _routeProviderConfigChanged 收敛姿势）。
      this._logger.warn('session_switch_config_session_error', {
        session_id: sessionId,
        error: e,
      });
    }
  }

  /**
   * task-08（D-007@v1 / FR-07）：路由 backend PERMISSION_RESPONSE 到 SessionManager
   * 当前 session 的 resolver.resolve，settle 对应 canUseTool 回调的 pending promise。
   *
   * 边界：
   *   - payload 非法（缺 request_id/decision 非 allow|deny）→ warn 丢弃，不抛；
   *   - session_id 不在 SessionStore → warn（迟到 response，turn 已结束），不抛；
   *   - resolver 不存在（manual_approval=false 或 session 无 resolver）→ warn 不抛；
   *   - resolver.resolve 返回 unknown_request / session_mismatch → warn（已记日志）。
   *
   * 字段名兼容 snake_case（backend WS 发 session_id/request_id/decision/message?）。
   */
  private async _routePermissionResponse(
    raw: Record<string, unknown>,
  ): Promise<void> {
    if (!this._sessionManager) {
      this._logger.warn('permission_response_no_manager');
      return;
    }
    const sessionId =
      (raw.session_id as string | undefined) ?? (raw.sessionId as string | undefined) ?? '';
    const requestId = (raw.request_id as string | undefined) ?? '';
    const decisionRaw = raw.decision;
    const message = raw.message as string | undefined;
    // onUserDialog 扩展：前端用户在对话卡上选择/填写的答案（仅当对应
    // PERMISSION_REQUEST 带 dialog_kind 时有意义）。透传给 resolver.resolve，
    // 由 onUserDialog 回调回喂 SDK UserDialogResult.result。
    const dialogResult =
      'dialog_result' in raw ? (raw as { dialog_result?: unknown }).dialog_result : undefined;

    // payload schema 非法（缺字段 / decision 非 allow|deny）→ warn 丢弃，不抛。
    if (!sessionId || !requestId || (decisionRaw !== 'allow' && decisionRaw !== 'deny')) {
      this._logger.warn('permission_response_invalid_payload', {
        session_id: sessionId,
        request_id: requestId,
        decision: decisionRaw,
      });
      return;
    }

    // session 不在 SessionStore → warn（迟到 response）。
    const state = this._sessionManager.get(sessionId);
    if (!state) {
      this._logger.warn('permission_response_unknown_session', {
        session_id: sessionId,
        request_id: requestId,
      });
      return;
    }

    const resolver = this._sessionManager.getPermissionResolver(sessionId);
    if (!resolver) {
      // manual_approval=false 或 session 无 resolver（已 end/fail）。
      this._logger.debug('permission_response_no_resolver', {
        session_id: sessionId,
        request_id: requestId,
      });
      return;
    }

    const result = resolver.resolve(
      {
        session_id: sessionId,
        request_id: requestId,
        decision: decisionRaw,
        ...(message !== undefined ? { message } : {}),
        ...(dialogResult !== undefined ? { dialog_result: dialogResult } : {}),
      },
      sessionId,
    );
    if (result !== 'resolved') {
      this._logger.warn('permission_response_not_resolved', {
        session_id: sessionId,
        request_id: requestId,
        result,
      });
    } else {
      this._logger.debug('permission_response_resolved', {
        session_id: sessionId,
        request_id: requestId,
        decision: decisionRaw,
      });
    }
  }

  /**
   * task-04（D-002@v3）：启动交互式会话。
   *
   * 与 batch 路径互斥：不调 startLease/completeLease（backend claim/start 时已处理），
   * 不调 TaskRunner.runLease。委托 SessionManager.create 建 session + 启动 driver 协程。
   *
   * 边界：
   *   - 未注入 sessionManager（AC-14 过渡期）：记 error 不崩，backend end_session 收 failed。
   *   - agent-detector 未检测 claude / _agentPaths 无 path（AC-07）：不调 create，
   *     记 CLAUDE_EXECUTABLE_NOT_FOUND，由 backend onSessionEnd 收 failed。
   *   - 重复 task_available 同 leaseId（AC-09）：_interactiveSessionsByLease 命中跳过。
   *   - SessionManager.create 抛错（executable 解析失败等）：记 error，不崩 daemon。
   */
  private async _startInteractiveSession(
    leaseId: string,
    // task-04：交叉类型承载 worker_depth（execPayload 归一化产物；LeaseCtx 未
    // 声明该字段，见 _runLeaseStateMachine 注释）。
    execPayload: LeasePayload & { worker_depth?: number },
  ): Promise<void> {
    // AC-09：重复 task_available（WS 重连/重放）→ 跳过，driver 只启动一次。
    if (this._interactiveSessionsByLease.has(leaseId)) {
      this._logger.info('interactive_session_already_started', { lease_id: leaseId });
      return;
    }

    if (!this._sessionManager) {
      // AC-14 过渡期：未注入 SessionManager。kind=interactive 无法执行，记 error；
      // batch 路径完全不受影响。backend 据 lease 超时/WS 失活收 failed。
      this._logger.error('interactive_no_session_manager', { lease_id: leaseId });
      return;
    }

    const sessionId = execPayload.agentSessionId ?? '';
    const firstRunId = execPayload.agentRunId ?? '';
    let prompt = execPayload.prompt ?? '';
    // 路径映射：backend 在 Docker 容器内跑，spec_root 用容器内路径（如
    // /data/spec-workspaces/{id}）；daemon 跑在宿主机上（Windows/Mac），本地无 /data。
    // spec_root_map 格式 "from:to"，如 "/data/spec-workspaces:C:/data/spec-workspaces"。
    // 在 prompt 透传给 SessionManager.create 前，把 from 替换为 to。
    //
    // 数据源（task-02）：优先读 config.spec_root_map（loadConfig 已从 env SPEC_ROOT_MAP
    // 覆盖到 config），env 兜底（双保险）。详见 design §4.1 A1 第 2 层。
    //
    // 翻译逻辑抽为纯函数 translateSpecRoot（按首个 ':' 分割，避免 split(':',2)
    // 在 Windows 盘符场景把 to 截断成 'C'，见 task-02 边界 3 / AC-07）。
    const specRootMap = this._config.spec_root_map || process.env.SPEC_ROOT_MAP || '';
    if (specRootMap) {
      const colonIdx = specRootMap.indexOf(':');
      if (colonIdx < 0) {
        // AC-06：specRootMap 无冒号 → 跳过，记 warn（配置可能写错）
        this._logger.warn('interactive_spec_root_map_invalid', {
          lease_id: leaseId,
          spec_root_map: specRootMap,
        });
      } else {
        const from = specRootMap.slice(0, colonIdx);
        const to = specRootMap.slice(colonIdx + 1);
        const translated = translateSpecRoot(prompt, specRootMap);
        if (translated !== prompt) {
          // AC-02：翻译生效，记 info（含 from/to + prompt 摘要前 200 字符）
          this._logger.info('interactive_spec_root_translated', {
            lease_id: leaseId,
            from,
            to,
            prompt_before_snippet: prompt.slice(0, 200),
          });
          prompt = translated;
        } else if (from && to) {
          // 边界 2：prompt 不含 from → 跳过，记 debug（避免每次 interactive 刷 info）
          this._logger.debug('interactive_spec_root_not_matched', {
            lease_id: leaseId,
            from,
          });
        }
        // from/to 为空（specRootMap=':' 或 'from:' 或 ':to'）→ 静默跳过（不刷日志）
      }
    }
    // specRootMap 空串 → 完全跳过（向后兼容旧 daemon，AC-04）
    // task-09 / D-007@v2（候选 B 主路径）：借用 lease cwd 解析。
    // backend placement 对借用 lease 写 metadata.cwd = "<BORROW_SANDBOX_MARKER><slug>"，
    // 经 build_claim_payload 透传到 execPayload.rootPath。检测 marker → 提取 slug →
    // prepareWorkspace 创建独立沙箱目录作 cwd（不复用 lender 代码 rootPath，防借用污染开发代码）。
    // sandbox 创建失败 → 回退 workspace_dir（fail-open cwd 让 session 能跑，但写隔离仍由
    // SessionManager 在登记沙箱后才激活；创建失败时不登记 → 退化 runtime policy，仅影响借用
    // 写隔离，不阻塞业务读源码出方案的主流程）。
    const rawRootPath = execPayload.rootPath;
    let borrowSandboxRoot: string | undefined;
    let cwd: string;
    if (
      typeof rawRootPath === 'string' &&
      rawRootPath.startsWith(BORROW_SANDBOX_MARKER)
    ) {
      const sandboxSlug = rawRootPath.slice(BORROW_SANDBOX_MARKER.length);
      try {
        borrowSandboxRoot = await this._getBorrowWorkspaceManager().prepareWorkspace(
          sandboxSlug,
        );
        cwd = borrowSandboxRoot;
        this._logger.info('borrow_sandbox_prepared', {
          lease_id: leaseId,
          slug: sandboxSlug,
          sandbox_root: borrowSandboxRoot,
        });
      } catch (e) {
        // 沙箱创建失败（磁盘满 / 权限）→ 回退 workspace_dir 不阻塞 session 启动。
        // 不登记 borrowSandboxRoot → SessionManager 写守卫走 runtime policy（fail-open）。
        // 业务方案主产出走 submit_lease_messages 回传不落沙箱，cwd 退化不影响读源码。
        cwd = this._config.workspace_dir;
        this._logger.warn('borrow_sandbox_prepare_failed', {
          lease_id: leaseId,
          slug: sandboxSlug,
          error: (e as Error)?.message ?? String(e),
          fallback_cwd: cwd,
        });
      }
    } else {
      // 非借用：rootPath 优先作 cwd（与 batch 一致，ql-20260617-009）；无则 workspace_dir 兜底。
      // 2026-08-28-fix-cross-machine-worker-dispatch task-06（Grill D-1.2 修订）：
      // 兜底判定用 truthy 而非 `??` —— `??` 只兜 null/undefined 不兜空串 ''，
      // 空串 rootPath 会漏成 cwd=''（spawn/stat 走错分支）；空串与
      // undefined/null 一律回落 config.workspace_dir 兜底。
      cwd = rawRootPath ? rawRootPath : this._config.workspace_dir;
    }
    // ql-20260703-001：归一化 adapter id → detector provider key（claude_code→claude），
    // 对齐 reopen 路径（:2144）。原 (execPayload.provider ?? 'claude') as 'claude'|'codex'
    // 直接透传 backend 的 'claude_code' → _agentPaths.get('claude_code')=undefined →
    // 命中 :2355 静默早返回 → lease 永远 claimed / run 永远 pending。
    // 断言 'claude'|'codex'：interactive driver registry 当前只这两者
    // （types.ts:196 Record<'claude'|'codex'>），未知 provider 由 SessionManager.create
    // 抛 UnsupportedProviderError 兜底。
    const provider = normalizeProvider(execPayload.provider) as 'claude' | 'codex';
    // task-06（D-002@v1）：executable path 按 provider 取。claude → claude CLI path；
    // codex → codex app-server path（agent-detector 探测后 _agentPaths.set('codex', path)）。
    // 字段名保留 pathToClaudeCodeExecutable（CreateSessionInput 兼容名，语义=provider
    // executable path；SessionManager.create 内部 fallback 到 pathToAgentExecutable）。
    const pathToClaudeCodeExecutable = this._agentPaths.get(provider) ?? '';

    if (!sessionId || !firstRunId || !prompt) {
      this._logger.error('interactive_missing_fields', {
        lease_id: leaseId,
        has_session_id: !!sessionId,
        has_run_id: !!firstRunId,
        has_prompt: !!prompt,
      });
      return;
    }

    // 跨机派发守卫（2026-08-28-fix-cross-machine-worker-dispatch task-06 / FR-05 / D-004@v1）：
    // workspace 绑定会话（rootPath 非空且非借用沙箱 marker）——白名单终检先行 +
    // 存在性检查（正确机器上 worktree 必已存在，存在性即「对机」试金石）；
    // 任一不过：notifyRunResult 拒绝后 return，绝不 mkdir（gap-8 的无差别 mkdir
    // 会把错机派发静默变成「错机上建空目录继续跑」）。
    // 判定抽纯函数 checkWorkspaceBoundCwd（task-05，含 assertWithinAllowedRoots 同一
    // containment 口径 + 双违反 forbidden 优先）；插入点在 firstRunId 非空守卫之后
    // （保证 notifyRunResult 可用，防 run 永久 pending，对齐 executable-not-found 模式）。
    const workspaceBoundCwd =
      typeof rawRootPath === 'string' &&
      rawRootPath &&
      !rawRootPath.startsWith(BORROW_SANDBOX_MARKER)
        ? cwd
        : null;
    if (workspaceBoundCwd) {
      let cwdExists = false;
      try {
        await stat(workspaceBoundCwd);
        cwdExists = true;
      } catch {
        cwdExists = false;
      }
      const verdict = checkWorkspaceBoundCwd(
        workspaceBoundCwd,
        cwdExists,
        this._effectiveAllowedRoots(),
        // ql-20260831-006：按工作区范围直接放行——非借用路径 cwd 恒等于
        // rawRootPath（工作区绑定根），机器白名单不再拦截工作区目录（错机
        // 保护由存在性检查 cwd_not_found 承担）。
        rawRootPath,
      );
      if (!verdict.ok) {
        this._logger.error('interactive_cwd_guard_rejected', {
          lease_id: leaseId,
          cwd: workspaceBoundCwd,
          code: verdict.code,
        });
        // 主动回传拒绝（status=error_during_execution）防 run 永久 pending；回传失败
        // 仅 warn 不阻塞主循环（backend 侧 lease GC / WS 失活兜底仍在，同下方
        // executable-not-found 块模式）。
        if (execPayload.claimToken && firstRunId) {
          try {
            await this._client.notifyRunResult(
              leaseId,
              execPayload.claimToken,
              firstRunId,
              {
                status: 'error_during_execution',
                is_error: true,
                result_summary: verdict.message,
              },
            );
          } catch (e) {
            this._logger.warn('interactive_cwd_guard_report_failed', {
              lease_id: leaseId,
              error: String(e),
            });
          }
        }
        return;
      }
    }

    if (!pathToClaudeCodeExecutable) {
      // task-06（FR-05 / D-002@v1）：provider 的 executable 缺失 → 拒绝启动。
      // 错误码 provider-specific（interactive_${provider}_executable_not_found），
      // 让日志/监控能区分 claude vs codex 缺失。不调 create；daemon 主循环不崩。
      this._logger.error(`interactive_${provider}_executable_not_found`, {
        lease_id: leaseId,
        provider,
        code: `${provider.toUpperCase()}_EXECUTABLE_NOT_FOUND`,
      });
      // ql-20260703-001（治本）：原注释称"backend 据 lease 超时/WS 失活收 failed"，
      // 实测 interactive lease lease_expires_at=NULL（长生命周期）+ WS 不失活 → 永不收
      // failed，run 永远 pending（用户实测 workspace 8777e292 的 scan run e0f4f147 卡
      // 死 10+ 分钟）。这里主动回传 notifyRunResult 标 failed，避免无声卡死。
      // execPayload.claimToken 已在 _runLeaseStateMachine:2785 归一化可用；firstRunId
      // 已过 :2345 非空检查。notifyRunResult 失败仅 warn（不阻塞主循环，backend 侧
      // lease GC / WS 失活兜底仍在）。
      if (execPayload.claimToken && firstRunId) {
        try {
          await this._client.notifyRunResult(leaseId, execPayload.claimToken, firstRunId, {
            status: 'error_during_execution',
            is_error: true,
            result_summary: `provider '${execPayload.provider ?? ''}' (normalized='${provider}') executable not found; agent-detector key mismatch or CLI not installed`,
          });
        } catch (e) {
          this._logger.warn('interactive_executable_not_found_report_failed', {
            lease_id: leaseId,
            provider,
            error: String(e),
          });
        }
      }
      return;
    }

    // gap-8（interactive cwd 不存在导致 SDK spawn 失败）：daemon-client 交互会话
    // 没有 workspace → execPayload.rootPath 为空 → cwd 回落到 config.workspace_dir
    //（默认 ~/sillyhub_workspaces），该目录通常不存在。batch 路径由 TaskRunner 在
    // spawn 前 mkdir 工作目录（task-runner.ts），但交互路径（SessionManager→
    // ClaudeSdkDriver）从不创建 cwd，导致 SDK child_process.spawn 因 cwd 不存在
    // 立即失败（SDK 误报成 "native binary failed to launch"），session 秒挂
    // onError→fail→onSessionEnd，agent_session_id 永远为 null（实测复现）。
    // 修复：create 前确保 cwd 存在（与 batch 对齐）。失败仅 warn 不阻断——让 SDK
    // 的真实错误经 onError 收口，不在此吞掉诊断信息。
    // 2026-08-28-fix-cross-machine-worker-dispatch task-06（D-004@v1 收敛）：
    // mkdir 仅对「非 workspace 绑定形态」执行——无 rootPath 兜底路径（daemon-client
    // 会话回落 workspace_dir）保留 mkdir（该目录是 daemon 自有领地，无错机语义，
    // gap-8 原意）；workspace 绑定路径（rootPath 非空非借用 marker）不 mkdir——
    // 上方守卫 stat 已确认目录存在（正确机器上 worktree 必已建），错机派发已在
    // 守卫处 notifyRunResult 拒绝。借用沙箱形态 workspaceBoundCwd 亦为 null →
    // 本段照旧执行（prepareWorkspace 已自建目录，recursive mkdir 幂等无副作用；
    // 失败回落 workspace_dir 属兜底形态保 fail-open），行为零变化。
    if (!workspaceBoundCwd) {
      try {
        await mkdir(cwd, { recursive: true });
      } catch (e) {
        this._logger.warn('interactive_cwd_mkdir_failed', {
          lease_id: leaseId,
          cwd,
          error: (e as Error)?.message ?? String(e),
        });
      }
    }

    // 2026-07-08 修复：spawn 前把同步的平台 skills 拷到 cwd/.claude/skills/，让 claude
    // 能加载 sillyspec/custom skills（syncSkills 同步到 ~/.sillyhub/daemon/skills/，
    // claude 只读 <cwd>/.claude/skills/——不接线则交互式会话看不到技能）。失败仅 warn。
    try {
      await linkSkillsToWorkdir(cwd, (level, msg, data) => {
        this._logger[level](msg, data);
      });
    } catch (e) {
      this._logger.warn('interactive_link_skills_failed', { lease_id: leaseId, error: String(e) });
    }

    // gap-8（interactive 凭证 parity）+ task-09（X-02 门控独立化）：
    // 与 batch 一致用 buildSpawnEnv 构造子进程 env，让 driver 能读到 credentials.json
    // 的 ANTHROPIC token（+ lease tool_config 占位符渲染）。**provider_config 第 0 层
    // 注入不依赖 credentialManager 存在**——credentialManager 缺失时用 noop credential
    //（层 2 token 读取自然跳过：get→undefined / buildEnv→{}），平台下发的 provider_config
    // 仍独立经第 0 层生效。避免「daemon 未注入 credentialManager → 即使 lease 带
    // provider_config 也走不进 buildSpawnEnv → 第 0 层失效」回归（X-02 选方案 (a)，
    // 不依赖生产 main.ts 必注入 credentialManager 假设漂移）。
    const noopCredential: SpawnCredentialManager = {
      get: () => undefined,
      buildEnv: () => ({}),
    };
    // task-06（spike-01 修正 / D-009）：spawn 前把 provider_config.settings_config 白名单
    // 顶层键写进 $CLAUDE_CONFIG_DIR/settings.json（attribution 等无 env 等价物项）。
    // 与 batch（task-runner.ts buildSpawnEnv 前）对齐，interactive 也走同一 helper。
    // absent / null / 仅 env → 不写文件（零回归）；写盘失败 best-effort 不阻断 session create。
    await applyClaudeSettings(execPayload.provider_config);

    const interactiveEnv = buildSpawnEnv(
      {
        toolConfig: execPayload.toolConfig ?? {},
        // task-09（D-004@v1）：lease 下发的 provider_config 透传给第 0 层。
        provider_config: execPayload.provider_config,
        // task-02（2026-08-23-agent-activity-sessions / D-008）：平台会话身份注入。
        // sessionId 即 execPayload.agentSessionId（:3415 取出，:3516 已验非空）——
        // 会话内跑的 sillyspec CLI 读该 env 作上报 hub_session_id，关联
        // platform_agent_logs 到本会话（design §3.2）。仅内存传递不落盘。
        agentSessionId: sessionId,
      },
      { credential: this._credentialManager ?? noopCredential },
    );

    // 先登记 lease→session（即使 create 抛错也登记，防 create 失败后 WS 重放反复重试；
    // SessionManager.create 抛 SessionAlreadyExistsError 时 store 已无此 session，安全）。
    this._interactiveSessionsByLease.set(leaseId, sessionId);

    // task-06（D-003@v1 tar 模式 pull / R-07 时序）：在 _sessionManager.create（driver
    // spawn）**之前** await 完成。ClaudeSdkDriver 一旦 spawn 即开始跑 sillyspec scan/stage，
    // 读 --spec-root 指向的本地缓存目录（~/.sillyhub/daemon/specs/{ws}）——pull 须先完成才有
    // 内容可读。shared 模式（transport!=='tar'）跳过，bind mount 共享现状不变（D-004）。
    //
    // transport/workspaceId 读取：camelCase 优先 + snake_case 兜底，与 _runLeaseStateMachine
    // 归一化风格一致（types.ts 字段由 task-03 透传，此处只读，类型用 as 断言兼容未定义期）。
    const transport =
      (execPayload as { transport?: string }).transport ??
      (execPayload as { transport_mode?: string }).transport_mode ??
      'shared';
    const workspaceId =
      (execPayload as { workspaceId?: string }).workspaceId ??
      (execPayload as { workspace_id?: string }).workspace_id;
    // spec 同步策略 + 源项目路径（2026-06-28-daemon-client-spec-sync-strategy，D-001）：
    // daemon pullSpecBundle 据此三分支初始化缓存（platform-managed/repo-mirrored/repo-native）。
    // specStrategy 缺省（旧 lease/quick-chat）→ pullSpecBundle 内按 platform-managed 兼容。
    const specStrategy =
      (execPayload as { specStrategy?: string }).specStrategy ??
      (execPayload as { spec_strategy?: string }).spec_strategy;
    // task-09（D-007@v2 候选 B）：借用 lease 的 execPayload.rootPath 是沙箱 marker
    // （非真实 spec 路径）→ 不能透传给 pullSpecBundle。借用 agent 读源码出方案，不参与
    // sillyspec 文档同步，spec pull 整块跳过（下方 transport 分支加 !borrowSandboxRoot 守卫）。
    const specRootPath = borrowSandboxRoot
      ? undefined
      : ((execPayload as { rootPath?: string }).rootPath ??
        (execPayload as { root_path?: string }).root_path);

    // task-09：借用 session 跳过 spec pull（业务/管理人员读源码，不写 spec；沙箱 cwd 也
    // 非 spec 根）。非借用维持 tar/shared 原逻辑。
    if (transport === 'tar' && !borrowSandboxRoot) {
      if (!workspaceId) {
        // 边界 5：transport=tar 但 workspaceId 缺失 → task-03 透传链路异常，warn 不阻塞。
        this._logger.warn('interactive_spec_pull_no_workspace', {
          lease_id: leaseId,
        });
      } else {
        // task-11（D-010 日常保鲜）：pull 前比对 lease latest_spec_version 与本地
        // `.runtime/spec-version.json.spec_version`（D-001@v1）。一致 → 跳过 pull（interactive 路径仍
        // set specSyncCtx 保证 onSessionEnd 回灌）；不一致 / 本地无记录 → pullSpecBundle
        // 刷新，成功后 bumpLocalSpecVersion 回写新版本。lease 未透传 latest_spec_version
        //（旧 backend）→ 保持旧行为（无条件 pull）。
        const leaseSpecVersion =
          (execPayload as { latestSpecVersion?: number }).latestSpecVersion ??
          (execPayload as { latest_spec_version?: number }).latest_spec_version;
        let skipPullDueToVersion = false;
        if (leaseSpecVersion !== undefined) {
          const localVersion = await readLocalSpecVersion(resolveSpecDir(workspaceId));
          if (!shouldRefreshSpec(localVersion, leaseSpecVersion)) {
            skipPullDueToVersion = true;
            this._logger.info('interactive_spec_version_fresh_skip_pull', {
              lease_id: leaseId,
              workspace_id: workspaceId,
              spec_version: localVersion,
            });
          }
        }
        // 无论 pull 与否，specSyncCtx 都登记（interactive 路径 onSessionEnd 兜底回灌）。
        this._interactiveSpecSyncCtx.set(leaseId, { workspaceId });
        if (skipPullDueToVersion) {
          // 版本一致跳过 pull：仍 info 一次便于观测，specSyncCtx 已 set。
          this._logger.info('interactive_spec_pulled', {
            lease_id: leaseId,
            workspace_id: workspaceId,
            spec_dir: resolveSpecDir(workspaceId),
            skipped: 'version_fresh',
          });
        } else {
          try {
            // `as never`：ClientLike 是 daemon 内部鸭子类型，spec-sync utility 期望 HubClient
            // 具体类型；ClientLike 已声明 getSpecBundle/postSpecSync 签名（additive），运行时
            // 真实 _client 为 HubClient 实例（main.ts 注入），duck-type 安全（task-06 §4.1/边界 11）。
            const specDir = await pullSpecBundle(
              this._client as never,
              workspaceId,
              { strategy: specStrategy, rootPath: specRootPath },
            );
            // 404 容错（首次 scan backend 无 bundle）：utility 内已 mkdir 空目录返回路径非 null。
            // lease 带了 latest_spec_version → 回写本地版本保鲜（D-010）。
            if (leaseSpecVersion !== undefined) {
              await bumpLocalSpecVersion(resolveSpecDir(workspaceId), leaseSpecVersion);
            }
            this._logger.info('interactive_spec_pulled', {
              lease_id: leaseId,
              workspace_id: workspaceId,
              spec_dir: specDir,
            });
          } catch (e) {
            // R-03 容错：pull 失败（5xx/网络，404 已被 utility 容错）不阻塞 session 启动。
            // agent 仍可跑（读不到缓存则 sillyspec 生成新文档）。specSyncCtx 已 set，
            // onSessionEnd 仍会尝试回灌（保守：即使 pull 失败也回传本地状态）。
            this._logger.warn('interactive_spec_pull_failed', {
              lease_id: leaseId,
              workspace_id: workspaceId,
              error: (e as Error)?.message ?? String(e),
            });
          }
        }
      }
    }
    // transport !== 'tar'（shared）→ 跳过 pull + 不 set specSyncCtx（onSessionEnd 自然跳过 sync）。

    // task-07（2026-08-26-workspace-mcp-edit / design §5 Wave2 第 5 条 / D-007@v2）：
    // 会话级 MCP 三件套预取。有 workspaceId（工作区会话，覆盖普通对话 + 主控，
    // D-008@v1；与 transport 无关）时在 _sessionManager.create（driver spawn，
    // provider 随 create 被同步调用）**之前** await fetchMcpBundle 拉取「平台默认
    // + 白名单 + 工作区配置」写入会话级缓存（key=sessionId，与 cli.ts
    // mainAgentMcpConfigProvider 共享同一 Map 引用——provider 同步签名不能
    // await，只能读缓存，故必须 create 前完成）。fetchMcpBundle 全链路容错回落
    // （platform→本地文件 / workspace→空 / whitelist→[]）且设计永不抛，任何失败
    // 仅 warn 不阻塞会话创建（R-03）。无 workspaceId（quick-chat/legacy shared）
    // 不预取——provider 缓存 miss 回落空 bundle，行为与现状一致。
    // restore/reload：reload（会话存活期）缓存条目仍在 → 命中；daemon 重启
    // restore 内存缓存必然缺失 → provider 回落空 + warn（cli.ts 侧记
    // mcp_bundle_cache_miss）。同步重取不可行（provider 同步签名 +
    // PersistedSessionRecord/SESSION_RESUME payload 均不携带 workspaceId，无从
    // 定向重取）——后续增强点：restore 链路补 workspace 下发 + 异步重取供下次
    // reload 用（D-007@v2 完整形态，本任务最小实现先回落）。
    if (workspaceId) {
      try {
        const bundle = await fetchMcpBundle(
          this._config.server_url,
          this._config.token,
          workspaceId,
          (level, msg, data) => {
            this._logger[level](msg, data);
          },
          this._config.api_key ?? undefined,
        );
        this._mcpBundleBySession.set(sessionId, bundle);
        this._logger.debug('mcp_bundle_prefetched', {
          session_id: sessionId,
          workspace_id: workspaceId,
          platform_servers: Object.keys(bundle.platform.mcpServers).length,
          workspace_servers: Object.keys(bundle.workspace.mcpServers).length,
          whitelist_size: bundle.whitelist.length,
        });
      } catch (e) {
        // 防御性兜底（fetchMcpBundle 设计永不抛，此处防意外异常）：写空 bundle
        // + warn，绝不阻塞会话创建（R-03 / 验收 1）——provider 读到空 bundle
        // 时仅注入内置双 server，等价现状行为。
        this._mcpBundleBySession.set(sessionId, {
          platform: { mcpServers: {} },
          whitelist: [],
          workspace: { mcpServers: {} },
        });
        this._logger.warn('mcp_bundle_prefetch_failed', {
          session_id: sessionId,
          workspace_id: workspaceId,
          error: (e as Error)?.message ?? String(e),
        });
      }
    }

    // ql-20260825-002：原 2026-07-08「派发 prompt 记入 agent 日志」的 user_input
    // 上报已删除——backend create_session 已落一条 user_input（带附件标记行版本，
    // 无论 daemon 死活都在库），daemon 再报一条裸文本造成双日志 + 双回显（首句
    // 渲染两个气泡的根因之一）。claude 秒退场景的可见性由 backend 那条覆盖。

    try {
      await this._sessionManager.create({
        sessionId,
        leaseId,
        env: interactiveEnv,
        // gap-2：claim_token 从 claimResp 归一化到 execPayload.claimToken，
        // 透传给 SessionManager 存入 state.claimToken，供 onTurnMessage→submitMessages
        // + gap-3 notifyRunResult 复用（桥接在 task-04）。
        claimToken: execPayload.claimToken ?? '',
        firstPrompt: prompt,
        firstRunId,
        cwd,
        provider,
        pathToClaudeCodeExecutable,
        model: execPayload.model,
        // scan 真阻塞：透传给 SessionManager.create 决定是否注入 canUseTool + 分流策略。
        manualApproval: execPayload.manualApproval,
        askUserOnly: execPayload.askUserOnly,
        // task-06（D-007@v2）：lease stage 透传。主 agent run stage='orchestrator'，
        // SessionManager isMainAgentSession 谓词据此判定 → 注入 daemon MCP server 5 tool。
        // 普通会话 stage 未传/其他值 → 不注入（零回归）。
        stage: execPayload.stage,
        // task-04（2026-08-26-team-subsession-recursion / design §5.C / FR-04）：
        // 分身深度透传 SessionManager.create（state.worker_depth + snapshot 保档；
        // MainAgentMcpContext 承载，工具集分档消费归 task-05）。undefined →
        // 旧 lease / 主控 / 普通会话全链无键（零回归）。
        worker_depth: execPayload.worker_depth,
        // task-10（C-12 / FR-10/11）：AgentProfile 三字段透传 SessionManager.create。
        // execPayload 已归一化（camelCase 优先 snake_case 兜底）；SessionManager 据
        // mcpRefs ∩ 过滤主 agent MCP 注入，skillRefs 承载（daemon spawn 前 link 子集），
        // effectiveAllowedRoots 写守卫 fallback 替代 provider 值。undefined → FR-15 不过滤。
        mcpRefs: execPayload.mcpRefs,
        skillRefs: execPayload.skillRefs,
        effectiveAllowedRoots: execPayload.effectiveAllowedRoots,
        // task-08 / FR-05 / D-005/D-009（RS-4 接线）：budget_tokens 透传 SessionManager
        // .create（session-manager 据此设 session 级检查点，累计 input+output ≥ 阈值
        // → 软切断 D-006 + 回传 budget_exceeded）。undefined → 检查点不触发（FR-07）。
        budget_tokens: execPayload.budget_tokens,
        // task-04（2026-08-13-profile-system-prompt-injection）：profile.system_prompt
        // 透传 SessionManager.create（backend _apply_profile_to_lease 写 lease.metadata →
        // _PROFILE_PAYLOAD_FIELDS 双写 claim payload → execPayload.systemPrompt）。
        // SessionManager 据此设 SDK systemPrompt preset+append（保留 claude 默认能力 +
        // 追加档案提示词）。undefined → 不注入（行为同今天，零回归）。
        systemPrompt: execPayload.systemPrompt,
        // task-04（2026-08-29-batch-session-inherit / D-001@v1）：resume 目标会话 id
        // 透传 SessionManager.create（CreateSessionInput.resume）。取 execPayload
        // .resumeSessionId（上方归一化区既有：resumeSessionId ?? resume_session_id，
        // 不新建第二套）。SessionManager.create 内 spec.resume → driverOpts.resume
        // 转发归 task-05。undefined（旧 backend 无该键）→ 键不生效，走全新会话
        // 原路径（零回归）。
        resume: execPayload.resumeSessionId,
        // 2026-08-06-public-mcp-server verify 修复（read_only 物制 / G3 / D-005@v2）：
        // worker 全走 kind=interactive（placement.py D-002@v3），原 interactive 路径在
        // _runLeaseStateMachine 对 kind=interactive 提前 return（daemon.ts:3582）跳过 ctx
        // 构造 → tool_config 永不达 SessionManager/ClaudeSdkDriver → read_only 失效（worker
        // 实测 Write/Bash 全放行，spike-B 追 batch stream-json 路径漏了 interactive）。
        // execPayload 构造把 lease tool_config 映射到 camelCase `toolConfig`（见上方
        // 字段构造 rawExec.tool_config → toolConfig），此处读它取 allowed_tools → 透传
        // ClaudeSdkDriver StartOptions.allowedTools（SDK 白名单，非白名单工具不可用）。
        // read_only=[Read,Glob,Grep]，写 worker=[...+Edit,Write,Bash]。absent → SDK 默认。
        allowedTools: (execPayload.toolConfig as { allowed_tools?: string[] } | undefined)?.allowed_tools,
      });
      // task-09（D-007@v2 候选 B）：借用 session 登记沙箱根，激活 SessionManager
      // 按 lease 隔离的只读 policy（写守卫只允许落沙箱内，不命中 lender runtime 缓存）。
      // create 成功后立即登记（同步，在 SDK 跑首 turn 前生效）；非借用 session 不登记，
      // 走原 runtime policy（开发人员自有任务零回归）。
      if (borrowSandboxRoot) {
        this._sessionManager.registerBorrowSandbox(sessionId, borrowSandboxRoot);
      }
      this._logger.info('interactive_session_started', {
        lease_id: leaseId,
        session_id: sessionId,
        run_id: firstRunId,
        borrow_sandbox: borrowSandboxRoot ?? null,
      });
      // task-02（design Phase 1 / FR-01）：create 成功后上报 session ready，让 backend
      // inject_session 的 ready wait 解除（修复 inject 在 create 完成前到达被丢导致
      // /model 空白的时序竞态）。best-effort：notifySessionReady 自身失败 warn 不抛
      //（hub-client.ts 实现），调用点无需 try/catch；catch 块（create 失败）改为
      // 主动回传 run failed（见下方 P2b），不再依赖 backend 兜底。
      await this._client.notifySessionReady(sessionId);
    } catch (e) {
      // create 抛错（ClaudeExecutableNotFoundError wrapper 解析失败等）：移除登记，
      // 让 WS 重放可重试；记录错误不崩。SessionManager create catch 只删 store 后
      // rethrow（不触发 onSessionEnd）——此前注释称「已标 failed（onSessionEnd）」
      // 与实现不符（2026-08-24 会话审查 P2b/daemon H4 修正）。
      this._interactiveSessionsByLease.delete(leaseId);
      // task-07（D-007@v2）：create 失败路径不经 onSessionEnd，显式清会话级 MCP
      // bundle 缓存（防泄漏；WS 重放重试时会重新预取，幂等安全）。
      this._mcpBundleBySession.delete(sessionId);
      const code =
        (e as Error & { code?: string })?.code ??
        (e instanceof Error ? e.name : 'UNKNOWN');
      this._logger.error('interactive_session_create_failed', {
        lease_id: leaseId,
        session_id: sessionId,
        code,
        error: e,
      });
      // P2b（daemon H4）治本：create 失败必须回传 run failed。interactive lease
      // lease_expires_at=NULL（长生命周期）+ WS 不失活时 backend 永不收 failed，
      // run 永远 pending（前端首条消息永久转圈）。同 ql-20260703-001 executable
      // 缺失路径的上报手法；notifyRunResult 失败仅 warn 不阻塞主循环。
      if (execPayload.claimToken && firstRunId) {
        try {
          await this._client.notifyRunResult(leaseId, execPayload.claimToken, firstRunId, {
            status: 'error_during_execution',
            is_error: true,
            result_summary: `interactive session create failed (${code}): ${
              e instanceof Error ? e.message : String(e)
            }`,
          });
        } catch (reportErr) {
          this._logger.warn('interactive_create_failed_report_failed', {
            lease_id: leaseId,
            run_id: firstRunId,
            error: String(reportErr),
          });
        }
      }
    }
  }

  // ── lease 状态机（daemon.py:269-340，本任务核心 R6）────────────────────────

  private async _executeTask(payload: LeasePayload): Promise<void> {
    const leaseId = payload.leaseId;
    const runtimeId =
      payload.runtimeId ?? this._firstRegisteredRuntimeId() ?? this._config.runtime_id;

    if (!leaseId) {
      this._logger.warn('task_no_lease_id', { payload });
      return;
    }

    // 并发去重（边界 3）：同一 lease_id 已在执行，跳过
    if (this._inflightLeases.has(leaseId)) {
      this._logger.info('lease_inflight_skip', { lease_id: leaseId });
      return;
    }
    // 并发上限（边界 3）
    if (this._inflightLeases.size >= this._config.max_concurrent_tasks) {
      this._logger.warn('concurrent_limit_reached', {
        inflight: this._inflightLeases.size,
        max: this._config.max_concurrent_tasks,
      });
      return;
    }

    this._inflightLeases.add(leaseId);
    try {
      await this._runLeaseStateMachine(leaseId, runtimeId, payload);
    } finally {
      this._inflightLeases.delete(leaseId);
    }
  }

  // ── task-11 / FR-10 / D-004@v1：change-write 轻量执行（不启 agent）─────────────

  /**
   * 执行一个 change-write 任务（claim → 本地写 → complete 回执 → sync）。
   *
   * **严格不走** ``_runLeaseStateMachine``（FR-10：纯文件写 + sync，不启 agent driver）。
   * 调用 task-runner ``runChangeWrite`` 轻量分支（不 import/不调用 SessionManager /
   * driver），complete 成功后由 runChangeWrite 内部触发 spec 回灌。
   *
   * 容错策略（对齐 design R-03）：
   *   - claim 失败（404/409/网络）→ 仅 log，return（不重试，等下轮 poll）。
   *   - 写文件 / path traversal 失败 → 回执 ok=false（若 client 支持），return。
   *   - sync 失败 → runChangeWrite 内部已 warn 不抛（不改写 ok）。
   *
   * @param taskId  DaemonChangeWrite.id（task-09 task_id）
   * @param runtimeId  当前 runtime（日志/claim 透传）
   * @param item  getPendingChangeWrites 返回的单条（含 change_key/workspace_id/files）
   */
  private async _executeChangeWrite(
    taskId: string,
    runtimeId: string,
    item: Record<string, unknown>,
  ): Promise<void> {
    // 并发去重：同一 taskId 已在执行，跳过。
    if (this._inflightChangeWrites.has(taskId)) {
      this._logger.info('change_write_inflight_skip', { task_id: taskId });
      return;
    }

    const changeKey = item.change_key as string | undefined;
    const workspaceId = item.workspace_id as string | undefined;
    if (!changeKey || !workspaceId) {
      this._logger.warn('change_write_missing_fields', {
        task_id: taskId,
        change_key: changeKey,
        workspace_id: workspaceId,
      });
      return;
    }

    this._inflightChangeWrites.add(taskId);
    let claimToken = '';
    try {
      // 1. CLAIM：抢占，拿 claim_token（task-09 端点无 body）。
      let claimResp: Record<string, unknown>;
      try {
        claimResp = await this._client.claimChangeWrite(taskId, runtimeId);
      } catch (e) {
        // 404/409/网络 → 仅 log（不重试，等下轮 poll）。
        this._logger.warn('change_write_claim_failed', {
          task_id: taskId,
          error: e,
        });
        return;
      }
      claimToken = (claimResp.claim_token as string | undefined) ?? '';
      if (!claimToken) {
        this._logger.warn('change_write_no_claim_token', { task_id: taskId });
        return;
      }

      // 2. files 取 claim 回执（task-09 ChangeWriteClaimResponse 带 files，对齐 pending）。
      // ql-20260816-002：保留元字段（kind=spec-sync 时 backend 透传 workspace_id/root_path
      // 供 task-runner 分流打包主仓 .sillyspec），path/content 缺省空串兼容 create/edit。
      const rawFiles = (claimResp.files ?? item.files ?? []) as unknown[];
      const files: ChangeWriteFile[] = rawFiles.map((f) => {
        const obj = (f ?? {}) as { path?: string; content?: string; root_path?: string };
        return {
          path: String(obj.path ?? ''),
          content: String(obj.content ?? ''),
          ...(obj.root_path !== undefined ? { root_path: obj.root_path } : {}),
        };
      });

      // 3. 本地写 + complete 回执 + sync（task-runner 轻量分支，不启 agent）。
      // task-13 / D-012：透传 kind（claim 回执 ChangeWriteClaimResponse 带 kind），
      // task-runner 据 kind=spec-sync 分流到 postSpecSync 整树回灌（不写文件）。
      const kind = (claimResp.kind as string | undefined) ?? 'create';
      const ctx: ChangeWriteCtx = {
        taskId,
        changeKey,
        workspaceId,
        claimToken,
        files,
        kind,
      };
      await this._taskRunner!.runChangeWrite!(ctx);
      this._logger.info('change_write_done', { task_id: taskId, change_key: changeKey });
    } catch (e) {
      // 写文件 / path traversal 失败 → 回执 ok=false（尽力，对齐 R-03 不崩循环）。
      this._logger.warn('change_write_execute_failed', {
        task_id: taskId,
        error: e,
      });
      try {
        await this._client.completeChangeWrite(taskId, claimToken, {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      } catch (e2) {
        // 回执失败本身不阻塞（claim_token 为空时 backend 会 409，下轮 gc 兜底）。
        this._logger.debug('change_write_complete_failed_failed', {
          task_id: taskId,
          error: e2,
        });
      }
    } finally {
      this._inflightChangeWrites.delete(taskId);
    }
  }

  private async _runLeaseStateMachine(
    leaseId: string,
    runtimeId: string,
    payload: LeasePayload,
  ): Promise<void> {
    // 1. CLAIM：拿 claim_token（task-17 claimLease）
    let claimResp: Record<string, unknown>;
    try {
      claimResp = await this._client.claimLease(leaseId, runtimeId);
    } catch (e) {
      this._logger.error('lease_claim_failed', { lease_id: leaseId, error: e });
      return;
    }
    const claimToken = String(claimResp.claim_token ?? '');
    if (!claimToken) {
      this._logger.error('lease_claim_no_token', { lease_id: leaseId });
      return;
    }

    // 3. EXECUTE：委托 TaskRunner.runLease（真实方法名，不是 executeTask）
    // claim_resp.payload 兼容两种形态（daemon.py:306）：
    //   - server 返回 { lease_id, claim_token, payload: {...}, lease_expires_at }
    //   - 或 server 直接返回 payload 字段平铺
    //
    // ql-20260616-006：backend claim 返回 snake_case（lease_id/agent_run_id/...），
    // 必须把 snake_case 归一化为 camelCase LeasePayload，否则 agentRunId/cmdPath 等
    // 永远 undefined，submitMessages 因 agent_run_id 空字符串触发 422。
    const nestedPayload = claimResp.payload as Record<string, unknown> | undefined;
    const flatClaimResp = claimResp as Record<string, unknown>;
    const rawExec: Record<string, unknown> = nestedPayload
      ? { ...(nestedPayload as object), ...(flatClaimResp as object) }
      : { ...(flatClaimResp as object) };
    // task-04：交叉类型承载 worker_depth（LeaseCtx 未声明本字段——src/types.ts 不在
    // 本卡 allowed_paths；读取 + 透传见下方归一化注释）。
    const execPayload: LeasePayload & { worker_depth?: number } = {
      ...payload,
      leaseId: (rawExec.leaseId as string | undefined) ?? (rawExec.lease_id as string | undefined) ?? payload.leaseId,
      runtimeId: (rawExec.runtimeId as string | undefined) ?? (rawExec.runtime_id as string | undefined) ?? runtimeId,
      agentRunId:
        (rawExec.agentRunId as string | undefined) ??
        (rawExec.agent_run_id as string | undefined) ??
        payload.agentRunId,
      workspaceName:
        (rawExec.workspaceName as string | undefined) ??
        (rawExec.workspace_name as string | undefined) ??
        payload.workspaceName,
      // ql-20260617-009：workspace slug + 真实 root_path 透传（root_path 优先作 cwd）。
      workspaceSlug:
        (rawExec.workspaceSlug as string | undefined) ??
        (rawExec.workspace_slug as string | undefined) ??
        payload.workspaceSlug,
      rootPath:
        (rawExec.rootPath as string | undefined) ??
        (rawExec.root_path as string | undefined) ??
        payload.rootPath,
      repoUrl: (rawExec.repoUrl as string | undefined) ?? (rawExec.repo_url as string | undefined) ?? payload.repoUrl,
      branch: (rawExec.branch as string | undefined) ?? payload.branch,
      claudeMd:
        (rawExec.claudeMd as string | undefined) ??
        (rawExec.claude_md as string | undefined) ??
        payload.claudeMd,
      // task-02（D-007）：stage_meta 透传（snake_case 保留，task-runner duck typing 读）。
      stage_meta:
        (rawExec.stage_meta as Record<string, unknown> | undefined) ??
        payload.stage_meta,
      stage_dispatch:
        (rawExec.stage_dispatch as boolean | undefined) ??
        payload.stage_dispatch,
      provider:
        (rawExec.provider as string | undefined) ??
        (rawExec.agent_type as string | undefined) ??
        payload.provider,
      toolConfig:
        (rawExec.toolConfig as LeaseCtx['toolConfig'] | undefined) ??
        (rawExec.tool_config as LeaseCtx['toolConfig'] | undefined) ??
        payload.toolConfig,
      resumeSessionId:
        (rawExec.resumeSessionId as string | undefined) ??
        (rawExec.resume_session_id as string | undefined) ??
        payload.resumeSessionId,
      sessionId:
        (rawExec.sessionId as string | undefined) ??
        (rawExec.session_id as string | undefined) ??
        payload.sessionId,
      cmdPath: (rawExec.cmdPath as string | undefined) ?? (rawExec.cmd_path as string | undefined) ?? payload.cmdPath,
      cmd: (rawExec.cmd as string | undefined) ?? payload.cmd,
      prompt: (rawExec.prompt as string | undefined) ?? payload.prompt,
      model: (rawExec.model as string | undefined) ?? payload.model,
      timeout: (rawExec.timeout as number | undefined) ?? payload.timeout,
      timeoutSeconds:
        (rawExec.timeoutSeconds as number | undefined) ??
        (rawExec.timeout_seconds as number | undefined) ??
        payload.timeoutSeconds,
      // task-04（D-002@v3）：lease.kind 分流 + interactive agent_session_id 透传。
      // snake_case 兼容（backend claim 响应可能给 agent_session_id）。
      kind:
        (rawExec.kind as 'batch' | 'interactive' | undefined) ??
        (payload.kind as 'batch' | 'interactive' | undefined),
      agentSessionId:
        (rawExec.agentSessionId as string | undefined) ??
        (rawExec.agent_session_id as string | undefined) ??
        payload.agentSessionId,
      // ql-20260627：tar 模式 transport + workspaceId 透传（build_claim_payload 已返回，
      // 但 execPayload 构造遗漏 → _startInteractiveSession 读不到 → 默认 shared → spec
      // pull/sync 从不触发 → interactive scan 文档不同步到服务器）。
      transport:
        (rawExec.transport as string | undefined) ??
        (rawExec.transport_mode as string | undefined) ??
        (rawExec.transportMode as string | undefined) ??
        'shared',
      workspaceId:
        (rawExec.workspaceId as string | undefined) ??
        (rawExec.workspace_id as string | undefined),
      // ql-20260711（init lease 接线）：mode + platform_config + latest_spec_version
      // + spec_strategy 归一化透传（历史 bug：execPayload 构造遗漏 → ctx 没字段 →
      // task-runner leaseMode==='init' 不命中 → _runInitLease 从不跑 → init lease
      // 落入 agent spawn 无 prompt → Claude 等待）。
      mode: rawExec.mode as string | undefined,
      platformConfig:
        (rawExec.platform_config as Record<string, unknown> | undefined) ??
        (rawExec.platformConfig as Record<string, unknown> | undefined),
      latestSpecVersion:
        (rawExec.latest_spec_version as number | undefined) ??
        (rawExec.latestSpecVersion as number | undefined),
      specStrategy:
        (rawExec.spec_strategy as string | undefined) ??
        (rawExec.specStrategy as string | undefined),
      // gap-2：claim_token 归一化到 execPayload.claimToken。
      // 优先用 claim 阶段拿到的 claimToken（局部变量，来自 claimResp.claim_token）；
      // 兜底 rawExec.claim_token / rawExec.claimToken（理论上 claimResp 顶层就有，
      // 这里是防御性）。interactive lease 必须带 claimToken 供 SessionManager 复用。
      claimToken: claimToken,
      // scan 真阻塞：lease metadata.manual_approval / ask_user_only 透传（scan=true）。
      manualApproval:
        (rawExec.manual_approval as boolean | undefined) ??
        (rawExec.manualApproval as boolean | undefined) ??
        payload.manualApproval,
      askUserOnly:
        (rawExec.ask_user_only as boolean | undefined) ??
        (rawExec.askUserOnly as boolean | undefined) ??
        payload.askUserOnly,
      // task-06（D-007@v2）：lease stage 标记透传。backend dispatch_to_daemon(stage=...)
      // 写入 lease.metadata.stage；主 agent run stage='orchestrator'。daemon 侧
      // _startInteractiveSession 透传到 CreateSessionInput.stage，SessionManager
      // isMainAgentSession 谓词据此判定主 agent 注入 MCP tool。
      stage:
        (rawExec.stage as string | undefined) ??
        payload.stage,
      // task-04（2026-08-26-team-subsession-recursion / design §5.C / FR-04）：
      // 分身会话深度归一化。backend placement 写 lease.metadata.worker_depth →
      // context.py 白名单进 claim payload → 此处读取（snake 优先 camel 兜底 +
      // 初始 payload 防御兜底，对齐 budget_tokens 归一化惯例）。undefined（旧
      // lease / 主控 / 普通会话）→ 全链穿透不伪造默认值（零回归）。
      // 注：LeaseCtx（src/types.ts）不在本卡 allowed_paths，以交叉类型随
      // execPayload 承载，_startInteractiveSession 透传 CreateSessionInput。
      // 审计修复 F4（2026-08-26）：入口即归一化（normalizeWorkerDepth 单源）——
      // 字符串/非法形态若靠运行期 normalize 救回，落盘 snapshot 会被
      // validateRecord 拒收致重启非叶静默降级叶档；此处提前归一杜绝。
      worker_depth: normalizeWorkerDepth(
        (rawExec.worker_depth as number | undefined) ??
          (rawExec.workerDepth as number | undefined) ??
          (payload as { worker_depth?: number }).worker_depth,
      ),
      // task-08 / task-09（D-004@v1 / D-005@v1）：LLM 供应商配置透传。backend
      // build_claim_payload 按 lease→user 解析默认 provider 解密 api_key 后下发；
      // daemon spawn-env 第 0 层据此注入 ANTHROPIC_* env。interactive 经 execPayload
      // 直读（:2817），batch 经 ctx 透传（:3318）。absent → 第 0 层跳过零回归（D-007）。
      provider_config:
        (rawExec.provider_config as LeaseCtx['provider_config'] | undefined) ??
        (rawExec.providerConfig as LeaseCtx['provider_config'] | undefined) ??
        payload.provider_config,
      // task-10（C-12 / FR-10/11）：AgentProfile 三字段透传。context.py task-07
      // 双写 camelCase+snake_case 到 claim payload。camelCase 优先、snake_case 兜底，
      // 与 stage_meta/provider_config 等惯例一致。interactive 路径经 execPayload 直读
      // → _startInteractiveSession → CreateSessionInput；batch 经 ctx 透传 task-runner。
      // 缺省/旧 lease 无键 → undefined → SessionManager/task-runner 按不过滤/原值兜底（FR-15）。
      mcpRefs:
        (rawExec.mcpRefs as string[] | undefined) ??
        (rawExec.mcp_refs as string[] | undefined) ??
        payload.mcpRefs,
      skillRefs:
        (rawExec.skillRefs as string[] | undefined) ??
        (rawExec.skill_refs as string[] | undefined) ??
        payload.skillRefs,
      effectiveAllowedRoots:
        (rawExec.effectiveAllowedRoots as string[] | undefined) ??
        (rawExec.effective_allowed_roots as string[] | undefined) ??
        payload.effectiveAllowedRoots,
      // task-04（2026-08-13-profile-system-prompt-injection）：profile.system_prompt 透传。
      // context.py task-02 双写 systemPrompt(camel)+system_prompt(snake) 进 claim payload。
      // camelCase 优先、snake_case 兜底（与 mcpRefs 等惯例一致）。interactive 经 execPayload
      // 直读 → _startInteractiveSession → CreateSessionInput → SDK systemPrompt preset+append。
      systemPrompt:
        (rawExec.systemPrompt as string | undefined) ??
        (rawExec.system_prompt as string | undefined) ??
        payload.systemPrompt,
      // task-08 / FR-05 / D-005/D-009（RS-4 接线）：AgentMission.budget_tokens 透传。
      // context.py task-07 双写 budget_tokens(snake)+budgetTokens(camel) 进 claim payload。
      // snake 优先（与 types.ts LeaseCtx.budget_tokens 字段名一致），camel 兜底。
      // undefined → task-runner / SessionManager 检查点短路（D-006/FR-07 零回归）。
      budget_tokens:
        (rawExec.budget_tokens as number | undefined) ??
        (rawExec.budgetTokens as number | undefined) ??
        payload.budget_tokens,
    };

    // task-04（D-002@v3）：kind 分流。在 fetch/startLease 之前——interactive 不走
    // TaskRunner / startLease / completeLease（backend 已 startLease），独立由
    // SessionManager 接管。缺省/未知 kind 一律按 batch（design §9 兼容）。
    const kind = execPayload.kind;
    if (kind === 'interactive') {
      await this._startInteractiveSession(leaseId, execPayload);
      return;
    }

    // 1.5 FETCH execution-context：claim 成功后、startLease 之前从 server 拉完整 bundle。
    // 当前 ctx 构造字段恒 undefined（claudeMd/repoUrl/branch/toolConfig...），
    // 必须先 fetch 再构造 ctx。位置必须在 startLease 之前：startLease 触发 server 把
    // lease 标 claimed、AgentRun → running；放 startLease 前让 fetch 属 claim-claimed 过渡态，
    // 避免 running 期间拉 bundle 增加窗口期延迟（task-05 §实现要求 3）。
    // R-03：fetch 失败不致命——claim 已扣 token，中断会留 dangling lease；
    // 记 error 供排查，继续用 payload 兜底（裸 prompt 也能跑）。
    let execCtx: ExecutionContextPayload | null = null;
    if (execPayload.agentRunId) {
      try {
        execCtx = await this._client.getExecutionContext(execPayload.agentRunId);
      } catch (e) {
        this._logger.error('execution_context_fetch_failed', {
          lease_id: leaseId,
          agent_run_id: execPayload.agentRunId,
          error: e,
        });
      }
    }

    // 2. START：通知 server lease 开始（task-17 startLease）
    try {
      await this._client.startLease(leaseId, claimToken);
    } catch (e) {
      this._logger.error('lease_start_failed', { lease_id: leaseId, error: e });
      return;
    }

    // 构造 LeaseCtx（对齐 types.ts LeaseCtx 接口，camelCase）。
    // 字段优先级：execCtx（fetch 结果，最新源）?? execPayload（claim payload 兜底）。
    // **prompt 不从 fetch 覆盖**：payload.prompt 是 dispatch 时写入 lease.metadata 的
    // 最终意图，避免 fetch 端点重建 prompt 的潜在差异（task-05 §边界处理 5）。
    //
    // ql-20260616-006：cmdPath server 不会下发，daemon 必须从 _agentPaths（注册时
    // 探测的本机路径）按 provider 注入，否则 task-runner 因 cmdPath 空直接 failed。
    const resolvedProvider = execCtx?.provider ?? execPayload.provider ?? 'claude';
    const localCmdPath =
      execPayload.cmdPath ?? execPayload.cmd ?? this._agentPaths.get(resolvedProvider) ?? '';
    const ctx: LeaseCtx = {
      leaseId,
      runtimeId,
      claimToken,
      agentRunId: execPayload.agentRunId,
      workspaceName: execPayload.workspaceName,
      // ql-20260617-009：fetch 是 task-05 之后的最新源，优先覆盖（fetch 失败回落 payload）
      workspaceSlug: execCtx?.workspace_slug ?? execPayload.workspaceSlug,
      rootPath: execCtx?.root_path ?? execPayload.rootPath,
      // fetch 覆盖（fetch 失败 execCtx=null 时回落 payload，payload 仍可能 undefined）
      repoUrl: execCtx?.repo_url ?? execPayload.repoUrl,
      branch: execCtx?.branch ?? execPayload.branch,
      claudeMd: execCtx?.claude_md ?? execPayload.claudeMd,
      // task-02（D-007）：stage_meta + stage_dispatch 透传。
      stage_meta: execCtx?.stage_meta ?? execPayload.stage_meta,
      stage_dispatch: execCtx?.stage_dispatch ?? execPayload.stage_dispatch,
      provider: resolvedProvider,
      // toolConfig：fetch.tool_config 是 snake_case Record，payload.toolConfig 是 camelCase；
      // fetch 优先（端点是 task-03 之后的最新源）
      toolConfig: execCtx?.tool_config ?? execPayload.toolConfig,
      // task-09（D-004@v1）：provider_config 透传给 batch 路径 task-runner
      //（task-runner.ts:549 buildSpawnEnv 第 0 层自动消费）。fetch 优先（最新源）。
      provider_config: execCtx?.provider_config ?? execPayload.provider_config,
      // resumeSessionId 优先用 fetch（端点是最新源）；session_id 兜底
      resumeSessionId: execCtx?.resume_session_id ?? execPayload.resumeSessionId,
      sessionId: execCtx?.session_id ?? execPayload.sessionId,
      cmdPath: localCmdPath,
      cmd: execPayload.cmd ?? localCmdPath,
      prompt: execPayload.prompt, // 不从 fetch 覆盖
      model: execCtx?.model ?? execPayload.model,
      timeout: execPayload.timeout,
      // ql-20260711（init lease 接线）：mode/platformConfig/workspaceId/latestSpecVersion/
      // specStrategy 透传 → task-runner leaseMode==='init' 命中 → _runInitLease 跑（不 spawn agent）。
      mode: execPayload.mode,
      platformConfig: execPayload.platformConfig,
      workspaceId: execPayload.workspaceId,
      latestSpecVersion: execPayload.latestSpecVersion,
      specStrategy: execPayload.specStrategy,
      // task-10（C-12 / FR-10/11）：AgentProfile 三字段透传 batch 路径 task-runner
      //（task-runner.ts frozenAllowedRoots 采用 effectiveAllowedRoots；mcpRefs/skillRefs
      // 由 task-runner 在 spawn 前取子集）。claim payload 是 batch 路径唯一源（无 fetch
      // 覆盖——execution-context 端点尚未透传 profile 字段，保持 execPayload 直读）。
      mcpRefs: execPayload.mcpRefs,
      skillRefs: execPayload.skillRefs,
      effectiveAllowedRoots: execPayload.effectiveAllowedRoots,
      // task-08 / FR-05 / D-005/D-009（RS-4 接线）：budget_tokens 透传 batch 路径
      // task-runner（runLease 读 ctx.budget_tokens 做累计检查点，累计 input+output ≥
      // 阈值 → 软切断 D-006 + 回传 budget_exceeded）。undefined → 检查点不触发（FR-07）。
      budget_tokens: execPayload.budget_tokens,
    };

    const taskResult: TaskRunnerResult = await this._taskRunner!.runLease(ctx);

    // 4. COMPLETE：回传结果（task-17 completeLease）
    // 字段映射：TaskRunnerResult 是 camelCase，server complete_lease 期望 snake_case
    try {
      // task-12（FR-05 / D-005@v1）：终态上报包 retryTerminal 轻量重试（不暂存）。
      // _resilience 未注入 → 回退直接调 _client。用尽抛被下方 catch 兜住。
      const call = (): Promise<unknown> =>
        this._client.completeLease(leaseId, claimToken, {
          success: taskResult.success,
          output: taskResult.output,
          error: taskResult.error,
          patch: taskResult.patch,
          files_changed: taskResult.filesChanged,
          insertions: taskResult.insertions,
          deletions: taskResult.deletions,
          duration_ms: taskResult.durationMs,
          session_id: taskResult.metadata?.session_id ?? taskResult.sessionId ?? '',
          stats: taskResult.stats,
          exit_code: taskResult.exitCode,
          status: taskResult.status,
        });
      if (this._resilience) {
        await this._resilience.retryTerminal(call);
      } else {
        await call();
      }
      this._logger.info('task_completed', {
        lease_id: leaseId,
        success: taskResult.success,
      });
    } catch (e) {
      this._logger.error('lease_complete_failed', { lease_id: leaseId, error: e });
    }
  }

  // ── 信号处理（R8）──────────────────────────────────────────────────────────

  private _installSignalHandlers(): void {
    if (this._sigtermHandler) return; // 防重复注册
    this._sigtermHandler = (): void => {
      void this.stop();
    };
    this._sigintHandler = (): void => {
      // 第一次 SIGINT：优雅 stop；第二次（连按）：_running 已 false → 强制 exit 130
      if (!this._running) {
        process.exit(130); // 128 + SIGINT(2)
      }
      void this.stop();
    };
    process.on('SIGTERM', this._sigtermHandler);
    process.on('SIGINT', this._sigintHandler);
  }

  private _uninstallSignalHandlers(): void {
    if (this._sigtermHandler) {
      process.off('SIGTERM', this._sigtermHandler);
      this._sigtermHandler = null;
    }
    if (this._sigintHandler) {
      process.off('SIGINT', this._sigintHandler);
      this._sigintHandler = null;
    }
  }
}
