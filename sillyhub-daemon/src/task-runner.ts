/**
 * TaskRunner —— 任务编排核心（task-19）。
 *
 * 把 Python `sillyhub_daemon/task_runner.py`（311 行 execute_task 7 步编排）
 * + `backends/__init__.py`（AgentBackend.execute 的 spawn 逻辑）
 * + `backends/stream_json.py`（spawn 模板 / stdin control_request / 看门狗）
 * 三个职责收敛到本类（方案B：子进程执行下沉到 TaskRunner 单点，adapter 仅解析）。
 *
 * 9 步编排链：
 *   1. workspace.prepareWorkspace(name, repoUrl, branch) → workDir
 *   2. stage_dispatch → STAGE_META env + skill prompt（task-02 不再写 CLAUDE.md）
 *   3. credential.buildEnv(toolConfig) → env
 *   4. getBackend(provider) → adapter
 *   5. client.startLease(leaseId, claimToken)
 *   6. spawn(cmdPath, adapter.buildArgs(), { cwd: workDir, env })
 *   7. readline 逐行读 stdout：adapter.parse(line) → AgentEvent[] → _eventToMessage → client.submitMessages
 *   8. exit 后 workspace.collectDiff(workDir) → patch/files_changed/insertions/deletions
 *   9. 汇总 TaskResult，置终态
 *
 * 承载的两个 P1 风险（蓝图 R-03 / R-04）：
 *   - R-03 stdin 控制不挂起：子进程发 control_request 时调 adapter.onControl(line, stdin)
 *     写回应答；result 行后才 stdin.end，绝不在中途关闭。
 *   - R-04 stdout 背压/编码：readline.createInterface + for await...of 自带背压（上游
 *     push 被消费前不继续）；逐行 parse 避免整 buffer 撑爆内存；UTF-8 强制解码。
 *
 * 状态机：pending → running → completed | failed | cancelled | timeout
 *
 * Python 1:1 对齐点：
 *   - track/untrack + cancel_task（asyncio.Task.cancel → AbortController）
 *   - execute_task 的 try/catch 映射到 failed
 *   - _event_to_message：event_type + 条件字段（content/tool_name/.../session_id）
 *   - _truncate（_MAX_OUTPUT=10000, _MAX_ERROR=5000）
 *   - startLease / submitMessages 失败不中断（Python 同策略，仅 log warning）
 *
 * 仅用 Node 原生依赖：node:child_process, node:readline, node:fs/promises,
 * node:path, node:timers, node:crypto。
 *
 * task-03（2026-09-07-arch-large-file-split / D-004@v1 / D-005@v3）：本文件由原
 * 3426 行瘦身为 facade——常量/类型/模块级纯函数与两个大方法体拆至
 * ``./task-runner/`` 包 8 子模块（runner-types / payload / change-write /
 * skill-prompt / render / spawn-stream / file-mcp / index），原导出面 27 符号经
 * ``export * from './task-runner/index.js'`` 原样转发（零变化）；类内保留核心
 * 编排（runLease 九步链 / init lease / 心跳循环 / 审批处理 / _eventToMessages /
 * _finish / runChangeWrite），_spawnAndStream、_handleLine、_writeFileMcpTmpConfig
 * 改一行委托到子模块函数——``this`` 经 ``_core()`` 类型桥（TaskRunnerCore）
 * 显式传参，行为零变化。
 *
 * @module task-runner
 */

// task-03（2026-09-07-arch-large-file-split / D-006@v1）：原路径兼容层——19 个
// 测试文件与 cli.ts / daemon.ts 的 import 语句零改动（原 27 符号导出面不变）。
export * from './task-runner/index.js';

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile, readdir, rm, stat } from 'node:fs/promises';
import { join, relative, isAbsolute, dirname } from 'node:path';
import {
  pullSpecBundle,
  postSpecSync,
  resolveSpecDir,
  syncSpecTreeIfNeeded,
  readLocalSpecVersion,
  shouldRefreshSpec,
  bumpLocalSpecVersion,
  handleInitLease,
  type HandleInitLeaseParams,
} from './spec-sync.js';
import { getBackend } from './adapters/index.js';
import type { ProtocolAdapter } from './adapters/protocol-adapter.js';
import { buildSpawnEnv } from './spawn-env.js';
import { applyClaudeSettings } from './claude-settings.js';
// 2026-07-08 修复：spawn 前把同步的平台 skills 拷到 workDir/.claude/skills/。
import { linkSkillsToWorkdir } from './skill-manager.js';
// task-03：observer 创建 / cmd-shim 解析 / readline 消费随 _spawnAndStream、
// _handleLine 方法体下沉到 ./task-runner/spawn-stream.js。
import type { TerminalObserver } from './terminal-observer.js';
// task-03（2026-09-10-multi-provider-injection）：daemonStateDir 懒求值（每次调用
// 现读 SILLYHUB_DAEMON_DIR env）——per-session codex/pi 目录挂其下，测试可 stub
// env 隔离（对齐 daemonBinDir 同款懒求值理由）。
import { daemonStateDir, type DaemonConfig } from './config.js';
// 2026-06-24-daemon-network-resilience task-11/12：batch submit 重试 + 终态轻量重试。
import type { ResilienceService } from './resilience/service.js';
import { toCauseInfo } from './resilience/error-classify.js';
// 2026-07-02-daemon-filesystem-policy task-16：per-runtime allowed_roots 快照数据源。
// batch Claude spawn 时按 task.runtimeId 从 PolicyCache 取该 runtime 的 allowed_roots，
// 替代全局 config.allowed_roots（D-002）。冻结语义见 runLease 内注释（D-003）。
import type { PolicyCache } from './policy/runtime-policy.js';
// task-17 / R-06：batch Codex 带内审批决策引擎。file/command 类审批 server request
// 命中时，对每个写路径调 policyEngine.canWrite(runtimeId, path, 'codex', tool)，
// 全 allow → accept，任一 deny → decline（附中文 reason）。仅 batch 路径用，
// 不影响 interactive Codex（codex-app-server-driver.ts 自己有 _handleApproval）。
import type { PolicyEngine } from './policy/filesystem-policy.js';
// task-17：approval 应答写 stdin 需识别 JsonRpcAdapter 的 PendingServerRequest 字段。
import type { PendingServerRequest } from './adapters/json-rpc.js';
// task-06：tool_use 分支推导工具种类（C-01 顶层 tool_kind 字段）。
// 与 backend/app/modules/agent/tool_kind.py 同逻辑，修改须同步（R-05 防漂移）。
// task-04 轻重构②：_eventToMessages 转换核心收敛至此（AgentEvent→wire dict 单一实现源）。
import { eventToSubmitMessages } from './event-wire.js';
import type {
  AgentEvent,
  LeaseCtx,
  ProviderConfig,
} from './types.js';
// task-03（2026-09-07-arch-large-file-split / D-004@v1）：原文件头部的常量/类型/
// 依赖契约接口/鸭子读取器原样下沉到 ./task-runner/ 包（零改写），facade 经
// import 引用；公共导出面 27 符号经上方 export * 原样转发。
import {
  MAX_ERROR,
  MAX_OUTPUT,
} from './task-runner/runner-types.js';
import type {
  RunnerCredentialManager,
  RunnerHubClient,
  RunnerWorkspaceManager,
  TaskRunnerResult,
  TaskStatus,
} from './task-runner/runner-types.js';
import {
  intersectAllowedRoots,
  pickBudgetUsageSnapshot,
  pickNum,
  pickStr,
  pickStrList,
} from './task-runner/payload.js';
import {
  EMPTY_DIFF,
  buildSkillPrompt,
  detectSkillInvoked,
  extractBudgetUsageTokens,
  isSpawnLevelFailure,
  resolveMaxRetries,
} from './task-runner/skill-prompt.js';
import type { SpawnAttemptResult } from './task-runner/skill-prompt.js';
import type { TaskRunnerCore } from './task-runner/runner-types.js';
import {
  startFileMcpSweepOnce,
  writeFileMcpTmpConfig,
} from './task-runner/file-mcp.js';
import { renderAgentEvent } from './task-runner/render.js';
import {
  handleLine,
  spawnAndStream,
} from './task-runner/spawn-stream.js';
import type {
  HandleLineEnv,
  SpawnStreamParams,
} from './task-runner/spawn-stream.js';
import { validateChangeWritePath } from './task-runner/change-write.js';
import type {
  ChangeWriteCtx,
  ChangeWriteResult,
} from './task-runner/change-write.js';
// task-03（2026-09-10-multi-provider-injection / FR-01 FR-02 / D-005 / D-011 / D-012）：
// 配置写盘层两写盘器——按 provider.agent_kind 分派进 per-session 隔离目录（见下方
// applyProviderFileSettings）。
import { writeCodexHome } from './codex-settings.js';
import { writePiDir } from './pi-settings.js';

// ── provider 文件层分派（task-03 / 2026-09-10-multi-provider-injection）──────────

/** 空串 / null / undefined 一律视为未设置（对齐 codex/pi-settings 同名判式）。 */
function nonEmptyStr(v: string | null | undefined): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * codex 写盘门槛判定（与 codex-settings.ts resolveCodexForm 的 sufficient 判据
 * 同步内联——task-03 allowed_paths 不含 codex-settings.ts，无法导出共享 helper；
 * **判据变更须两处同步**）：
 *   openai_chat：litellm_base_url / litellm_model_name 至少一项；
 *   anthropic（缺省）：api_key / base_url 至少一项。
 */
function isCodexFormSufficient(provider: ProviderConfig): boolean {
  if (provider.api_format === 'openai_chat') {
    return (
      nonEmptyStr(provider.litellm_base_url) !== undefined ||
      nonEmptyStr(provider.litellm_model_name) !== undefined
    );
  }
  return (
    nonEmptyStr(provider.api_key) !== undefined ||
    nonEmptyStr(provider.base_url) !== undefined
  );
}

/**
 * pi 写盘门槛判定（与 pi-settings.ts writePiDir 内部 gate 同步内联——同上，
 * **判据变更须两处同步**）：非 openai_chat 禁配形态 + base_url 非空（自定义端点，
 * 官方端点归 env 层 D-008）+ api_key 非空 + 裸 model id（default_fallback_model ??
 * model）非空。不足则零 mkdir 零 env（半写/空目录被 pi 读到 ≠ 按宿主现状运行，
 * design Plan 约束 3 同源理由）。
 */
function isPiFormSufficient(provider: ProviderConfig): boolean {
  return (
    provider.api_format !== 'openai_chat' &&
    nonEmptyStr(provider.base_url) !== undefined &&
    nonEmptyStr(provider.api_key) !== undefined &&
    (nonEmptyStr(provider.default_fallback_model) ?? nonEmptyStr(provider.model)) !==
      undefined
  );
}

/** applyProviderFileSettings 入参（design 接线段；两接线点同构调用）。 */
export interface ProviderFileSettingsInput {
  /**
   * per-session 目录段（D-011）：interactive = agent_sessions.id、
   * batch = leaseId（batch 无会话 id，lease 是唯一稳定执行粒度）。
   */
  sessionKey: string;
  /** lease 下发 provider_config；整体缺省（D-012 absent 边界）→ 不写不注入。 */
  provider: ProviderConfig | null | undefined;
  /** daemon 进程自身 apiKey（config.api_key，cli.ts setDaemonApiKey 同源）；codex openai_chat 形态作 auth key。 */
  daemonApiKey: string | null;
}

/**
 * 按 provider.agent_kind 分派配置写盘层 + 产待注入 env（task-03 单点定义，
 * daemon.ts interactive / task-runner.ts batch 两接线点共用）：
 *
 *   - codex：门槛前置判定（isCodexFormSufficient，与 writeCodexHome 同判据）通过
 *     → mkdir per-session 目录 → writeCodexHome（auth.json + config.toml）→
 *     返回 `{CODEX_HOME: <dir>}`；门槛缺 → warn 跳过（零 mkdir 零写入零 env）；
 *   - pi：base_url 非空（自定义端点）且必需字段齐（isPiFormSufficient）→
 *     mkdir → writePiDir（三文件）→ 返回 `{PI_CODING_AGENT_DIR: <dir>}`；
 *     官方端点（base_url 空）静默跳过（env 层负责，D-008 分层）；
 *   - claude / 缺省 / 未知 kind → 返回 {}（claude settings.json 归调用侧
 *     applyClaudeSettings kind 守卫，不在此处）。
 *
 * per-session 目录（D-011）：`<daemonStateDir()>/codex/<sessionKey>/` 与
 * `<daemonStateDir()>/pi/<sessionKey>/`——与 CLAUDE_CONFIG_DIR 同根（平台管理的
 * 会话配置根旁挂 per-session 子目录，非 TEMP，R-06）。
 *
 * 失败语义（design Plan 约束 3「失败语义唯一化」）：mkdir / 写盘 IO 失败（含
 * writeCodexHome/writePiDir reject）→ 记 error 后该 kind 的 env 注入一并跳过、
 * 正常返回 {}，**绝不抛**——调用方 spawn 主路径不阻断（子进程按宿主 ~/.codex、
 * ~/.pi 现状运行 = 行为等同未配置，log 可归因）。终态清理与热切换重写归 task-04。
 *
 * 日志安全：warn/error 载荷只含 sessionKey / kind / 字段名 / 错误 message，
 * 永不含 api_key / daemonApiKey 明文（对齐两写盘器约束）。
 */
export async function applyProviderFileSettings(
  input: ProviderFileSettingsInput,
): Promise<Record<string, string>> {
  const { sessionKey, provider, daemonApiKey } = input;

  // D-012 absent 边界：provider_config 整体缺省 → 不写不注入（与现状逐字一致）。
  if (!provider) return {};

  if (provider.agent_kind === 'codex') {
    // 门槛前置判定先于 mkdir：门槛缺 → 零 mkdir 零写入零 env（可诊断不静默）。
    if (!isCodexFormSufficient(provider)) {
      console.warn('provider_file_dispatch_codex_skipped_missing_fields', {
        session_key: sessionKey,
        api_format: provider.api_format ?? 'anthropic',
      });
      return {};
    }
    const codexHome = join(daemonStateDir(), 'codex', sessionKey);
    try {
      // spawn 前创建 per-session 目录（写盘器不自建，目录缺失走 IO 失败路径）。
      await mkdir(codexHome, { recursive: true });
      await writeCodexHome({ codexHome, provider, daemonApiKey });
      return { CODEX_HOME: codexHome };
    } catch (e) {
      // writeCodexHome 已记 codex_home_write_failed；此处收口 mkdir 失败 + 统一
      // 跳过 env（失败语义唯一化：半写目录被 CLI 读到 ≠ 按宿主现状运行）。
      console.error('provider_file_dispatch_codex_failed', {
        session_key: sessionKey,
        error: (e as Error)?.message ?? String(e),
      });
      return {};
    }
  }

  if (provider.agent_kind === 'pi') {
    // 官方端点形态（base_url 空）：零写盘零 env 静默跳过——凭证注入归 env 层
    //（并行变更产物，D-008 分层，这是设计内分派而非异常）。
    if (nonEmptyStr(provider.base_url) === undefined) return {};
    if (!isPiFormSufficient(provider)) {
      console.warn('provider_file_dispatch_pi_skipped_missing_fields', {
        session_key: sessionKey,
        api_format: provider.api_format ?? 'anthropic',
      });
      return {};
    }
    const piDir = join(daemonStateDir(), 'pi', sessionKey);
    try {
      await mkdir(piDir, { recursive: true });
      await writePiDir({ piDir, provider });
      return { PI_CODING_AGENT_DIR: piDir };
    } catch (e) {
      // writePiDir 已记 pi_dir_write_failed；此处收口 mkdir 失败 + 统一跳过 env。
      console.error('provider_file_dispatch_pi_failed', {
        session_key: sessionKey,
        error: (e as Error)?.message ?? String(e),
      });
      return {};
    }
  }

  // claude / 缺省 / 未知 kind：无文件层 env（claude settings.json 由调用侧
  // applyClaudeSettings kind 守卫处理）。
  return {};
}

/**
 * 任务编排器：执行一个 lease，把 agent 输出流式 submit 到 server，
 * 收集 git diff，产出 TaskResult。
 *
 * 依赖通过构造器注入（client / workspace / credential），便于测试 mock；
 * getBackend 是模块级导入（每次调用返回新 adapter 实例，对齐 Python）。
 */
export class TaskRunner {
  /** 当前在跑的 lease → AbortController（cancel 用）。 */
  private readonly _controllers = new Map<string, AbortController>();
  /** lease → 终态（completed/failed/cancelled/timeout）。 */
  private readonly _states = new Map<string, TaskStatus>();
  /** lease → claimToken（submitMessages / completeLease 用）。 */
  private readonly _claimTokens = new Map<string, string>();

  /**
   * @param client     HubClient 实例（REST 调用）
   * @param workspace  WorkspaceManager 实例（git 镜像 + diff）
   * @param credential CredentialManager 实例（env 渲染）
   * @param config     daemon 配置（task-10：resolveTimeout/resolveMaxRetries 用，
   *                   可选，缺省走兜底默认 1800s / 1 retry）
   */
  constructor(
    private readonly client: RunnerHubClient,
    private readonly workspace: RunnerWorkspaceManager,
    private readonly credential: RunnerCredentialManager,
    private readonly config?: DaemonConfig,
    /**
     * 2026-06-24-daemon-network-resilience task-11/12：网络层重试编排。
     * 注入后 batch submitMessages 走 submitWithRetry（非阻塞）、终态 completeLease
     * 走 retryTerminal；未注入（undefined）回退直接调 client（向后兼容）。
     */
    private readonly resilience?: ResilienceService | null,
    /**
     * 2026-07-02-daemon-filesystem-policy task-16：per-runtime allowed_roots 数据源。
     * batch spawn 时按 ``ctx.runtimeId`` 取 ``PolicyCache.get(rid)?.allowedRoots`` 生成
     * CC ``--settings``（D-002）。未注入（undefined/null，仅旧测试场景）回退
     * ``config.allowed_roots``（向后兼容，单一全局沙箱）。cli.ts 生产链路必注入
     *（与 Daemon 共享同一 PolicyCache 实例，由心跳 + WS POLICY_UPDATE 维护）。
     *
     * 冻结语义（D-003）：spawn 那一刻取快照，跑 batch 期间不随热更新变；
     * 新起 batch 再读 PolicyCache 最新值。
     */
    private readonly policyCache?: PolicyCache | null,
    /**
     * 2026-07-02-daemon-filesystem-policy task-17 / R-06：batch Codex 带内审批决策引擎。
     *
     * batch spawn codex 时若收到 `item/fileChange/requestApproval` /
     * `item/commandExecution/requestApproval` server request，TaskRunner 在 _handleLine
     * 检测到 approval 事件后，对每个写路径调
     * ``policyEngine.canWrite(ctx.runtimeId, path, 'codex', tool)``：
     *   - 全 allow → 写 ``{ decision: 'accept' }`` response 到 stdin；
     *   - 任一 deny → 写 ``{ decision: 'decline' }`` response（decline 不带 reason 字段，
     *     codex 只看 decision；中文 reason 通过 audit + AgentEvent 透传供前端展示）。
     *
     * 未注入（undefined/null，仅旧测试场景）→ fail-closed decline（无引擎无法放行，
     * 保守拒绝，对齐 task-14 interactive「未注入 sessionPermission → decline」语义）。
     * cli.ts 生产链路必注入（与 Daemon 共享同一 PolicyEngine 实例）。
     */
    private readonly policyEngine?: PolicyEngine | null,
    /**
     * 2026-08-15-init-trigger-sillyspec-init task-06（FR-04 / D-005@v1 / D-007@v1）：
     * cli.ts 构造前 AgentDetector 探测并映射 sillyspec VALID_TOOLS 后的本机工具列表
     *（claude/cursor/openclaw/codex/gemini/opencode 同名交集子集）。
     * _runInitLease 透传给 handleInitLease.tools；未注入 / 空 → undefined →
     * runSillyspecInit 兜底 ['claude']。探测失败不阻塞 daemon 启动（cli.ts 侧 catch）。
     */
    private readonly detectedAgents?: string[] | null,
  ) {
    // task-07（2026-08-23-agent-file-upload-mcp / R-09）：daemon 启动清扫 tmpdir 同
    // 前缀残留 .mcp.json（上次 daemon 崩溃未走 run 终 finally 的遗留，内含 daemon
    // 凭证）。fire-and-forget——清扫失败不影响 TaskRunner 可用性，也不动 cli.ts
    //（构造即触发）。年龄阈值防误删并发在跑 run 的活跃 tmpfile（见常量注释）。
    // 进程级单次守卫：生产 daemon 每进程仅构造一次 TaskRunner，行为不变；测试并行
    // 构造多个 TaskRunner 时避免重复全量 readdir 系统临时目录造成 IO 风暴，拖慢
    // spawn 前路径击穿 waitForSpawn 类轮询预算（回归修正，见 _writeFileMcpTmpConfig
    // 同步写注释）。
    startFileMcpSweepOnce();
  }

  // ── 追踪与取消 ────────────────────────────────────────────────────────────

  /**
   * 当前在跑的任务数。对齐 Python `running_tasks` 集合大小。
   */
  get activeTaskCount(): number {
    return this._controllers.size;
  }

  /**
   * task-01（2026-08-29-daemon-selfupdate-safety / FR-01 / D-001@v1）：是否存在
   * 进行中的 batch lease——``_controllers`` 追踪集非空即 true。
   *
   * 空闲屏障的忙判定查询口，供 daemon 升级编排器（tryUpdate，task-04）判定是否
   * 推迟升级。口径与 ``activeTaskCount`` getter 严格一致（同读 ``_controllers.size``；
   * track/untrack 维护生命周期，untrack 后即不算）。零副作用纯查询。
   */
  hasActiveLease(): boolean {
    return this._controllers.size > 0;
  }

  /**
   * 把 leaseId 加入追踪集，返回关联的 AbortController（供 cancel 触发）。
   * 对齐 Python `running_tasks[task_id] = asyncio.create_task(...)`。
   */
  track(leaseId: string): AbortController {
    if (this._controllers.has(leaseId)) {
      // 已在跑：返回现有 controller（幂等，对齐 Python 不重复创建 Task）
      return this._controllers.get(leaseId)!;
    }
    const ac = new AbortController();
    this._controllers.set(leaseId, ac);
    this._states.set(leaseId, 'running');
    return ac;
  }

  /**
   * 从追踪集移除（任务终态后由 runLease 自动调）。
   * 对齐 Python `running_tasks.pop(task_id, None)`。
   */
  untrack(leaseId: string): void {
    this._controllers.delete(leaseId);
  }

  /**
   * 取消一个在跑的 lease。对齐 Python `cancel_task` → `task.cancel()`。
   * 触发 AbortSignal + kill 子进程（SIGTERM → 2s 后 SIGKILL）由 runLease 自己监听处理。
   *
   * @returns true 表示找到并取消；false 表示该 lease 不在追踪集
   */
  async cancel(leaseId: string): Promise<boolean> {
    const ac = this._controllers.get(leaseId);
    if (!ac) {
      return false;
    }
    ac.abort();
    this._states.set(leaseId, 'cancelled');
    return true;
  }

  /**
   * 查询某个 lease 的状态。对齐蓝图 getState API（task-19 AC-08）。
   * 任务未运行过返回 undefined。
   */
  getState(leaseId: string): TaskStatus | undefined {
    return this._states.get(leaseId);
  }

  // ── 主入口：runLease（9 步编排链）─────────────────────────────────────────

  /**
   * 执行一个 lease 的完整生命周期。
   *
   * 对齐 Python `execute_task(payload)`（task_runner.py:77-245）：
   * 1. workspace.prepareWorkspace
   * 2. stage_dispatch → STAGE_META env + skill prompt（task-02 不再写 CLAUDE.md）
   * 3. credential.buildEnv
   * 4. getBackend(provider)
   * 5. client.startLease
   * 6. spawn + stdin 写 prompt
   * 7. readline 逐行 parse + submitMessages
   * 8. exit → collectDiff
   * 9. 汇总 TaskResult
   *
   * 容错策略（对齐 Python）：
   *   - startLease 失败 → 仅 warn，不中断（lease 仍执行）
   *   - submitMessages 失败 → 仅 warn，不中断
   *   - collectDiff 失败 → 仅 warn，patch 留空
   *   - workspace.prepareWorkspace / getBackend 失败 → 直接 failed
   *
   * 返回的 TaskResult 同时写入 _states 终态，并 untrack。
   */
  async runLease(ctx: LeaseCtx): Promise<TaskRunnerResult> {
    const leaseId = ctx.leaseId;
    const ac = this.track(leaseId);
    const startTime = Date.now();
    // claimToken 在 WS 流程外部已注入；poll 流程内嵌。这里允许 undefined，
    // submitMessages / startLease 容忍空 token（对齐 Python 用 .get 默认空串）。
    const claimToken = ctx.claimToken ?? this._claimTokens.get(leaseId) ?? '';

    // 输出缓冲 + 会话 ID 收集
    const outputParts: string[] = [];
    let sessionId = '';

    // ql-20260616-006：lease heartbeat 循环控制器（声明在 try 外，便于 finally 清理）
    let hbStop: AbortController | null = null;
    let heartbeatPromise: Promise<void> | null = null;

    // task-07（2026-08-23-agent-file-upload-mcp / R-09 / D-009@v2）：worker .mcp.json
    // 临时文件路径（声明在 try 外，便于 finally 删除；null = 未写入——非 claude
    // provider 或写盘失败降级）。run 终态（成功/失败/取消）finally 删除，凭证不残留。
    let fileMcpTmpPath: string | null = null;

    try {
      // ── init lease 分支（task-07 / D-002/D-009）：mode='init' → 不启 agent ──────────
      // daemon 拉到 init lease（kind=batch + mode='init'，backend task-06 start_init_dispatch
      // 下发）：pullSpecBundle 拉文档缓存 → 写 daemon 状态文件（2 字段）到
      // resolveSpecDir(workspaceId)/.runtime/（D-001@v1；ql-20260820-007 rev3：状态文件
      // 后置于 pull，防 .runtime 占位阻塞策略分支）→ postSpecSync 回灌本地改动
      // → 提前 return TaskRunnerResult（不 spawn agent）。
      // 完整编排抽到 spec-sync.handleInitLease（纯函数 + client 参数注入，D-007@v1）。
      //
      // mode 探测：lease payload 字段 mode / purpose / init_mode 任一为 'init' 即视为 init lease
      //（backend task-06 待合并，字段名以 init lease 生命周期契约 §9 mode="init" 为准；多字段
      // 兜底提高兼容性）。非 init lease（缺省/未知 mode）→ 落入下方既有 9 步编排。
      const leaseMode =
        (ctx as { mode?: string }).mode ??
        (ctx as { purpose?: string }).purpose ??
        (ctx as { init_mode?: string }).init_mode;
      if (leaseMode === 'init') {
        return this._runInitLease(ctx, leaseId, startTime);
      }

      // 步骤 1：workspace.prepareWorkspace（失败直接抛 → finally 映射 failed）
      // ql-20260617-009：优先用 ctx.rootPath（真实代码目录，host path）作 cwd，跳过 mirror。
      // rootPath 不可访问时 prepareWorkspace 内部自动回落到 mirror by slug。
      // slug 优先于 workspaceName 作 mirror 目录名（slug 唯一稳定）；两者都缺时兜底 'default'
      // （quick-chat 场景）。repoUrl/branch 退役兜底（task-05）：让 undefined 透传。
      const wsName = ctx.workspaceSlug ?? ctx.workspaceName ?? 'default';
      const repoUrl = ctx.repoUrl;
      const branch = ctx.branch;
      const workDir = await this.workspace.prepareWorkspace(wsName, repoUrl, branch, {
        rootPath: ctx.rootPath,
      });

      // 步骤 1.5：spec-sync utility pull（task-05 改调，逻辑等价原 batch 私有 pull 实现）。
      // wsId/existingSpecRoot 从 ctx 鸭子类型读取（task-07 未合并前的兼容，types.ts 本任务不改）。
      // 仅当 execution-context 透传了 workspace_id 且 spec_root 为空（daemon-client 留空）
      // 时触发。quick-chat / 共享 session 等无 workspace 场景（无 workspaceId / specRoot 已有值）→ pullSpecBundle 返回 null（server-local 模式已于 2026-07-10 移除，wsId 永远非空）。
      // pull 失败（bundle 404 / 网络错）不致命（FR-05「按需」语义）：agent 仍按 workDir
      // 自身的 .sillyspec 执行，对齐 design §5 E-01。
      //
      // task-11（D-010 日常保鲜）：pull 前比对 lease 下发的 latest_spec_version 与本地
      // `.runtime/spec-version.json.spec_version`（D-001@v1）。一致 → 跳过 pull（specRoot 直接指向本地
      // 缓存目录，agent 读已有内容）；不一致 / 本地无版本记录 → pullSpecBundle 刷新，
      // 成功后 bumpLocalSpecVersion 回写新版本。lease 未透传 latest_spec_version（旧
      // backend）→ 保持旧行为（pullSpecBundle 内 existingSpecRoot 等既有逻辑）。
      let specRoot: string | null = null;
      try {
        const wsId = (ctx as { workspaceId?: string }).workspaceId;
        const existingSpecRoot = (ctx as { specRoot?: string }).specRoot;
        const leaseSpecVersion =
          (ctx as { latestSpecVersion?: number }).latestSpecVersion ??
          (ctx as { latest_spec_version?: number }).latest_spec_version;
        let skipPullDueToVersion = false;
        if (wsId && !existingSpecRoot && leaseSpecVersion !== undefined) {
          const localVersion = await readLocalSpecVersion(resolveSpecDir(wsId));
          if (!shouldRefreshSpec(localVersion, leaseSpecVersion)) {
            // 版本一致：跳过 pull，specRoot 指向本地缓存（resolveSpecDir 已做路径校验，
            // 缓存目录可能尚未存在——agent 读时由 sillyspec 自身处理，对齐 pull 404 容错语义）。
            skipPullDueToVersion = true;
            specRoot = resolveSpecDir(wsId);
            console.info('task_runner: spec_version_fresh_skip_pull', leaseId, {
              workspace_id: wsId,
              spec_version: localVersion,
            });
          }
        }
        if (!skipPullDueToVersion) {
          specRoot = await pullSpecBundle(
            this.client as unknown as Parameters<typeof pullSpecBundle>[0],
            wsId,
            {
              existingSpecRoot,
              // ql-20260820-007：补传 strategy/rootPath——漏传时永远按 platform-managed
              // pull（rm -rf + 解包），会拆除 interactive scan 已建的 repo-native junction，
              // 策略静默永久退化；repo-mirrored 首拷判定同样失效。ctx.specStrategy 由
              // daemon.ts execPayload 归一化透传（backend lease payload spec_strategy）。
              strategy: ctx.specStrategy,
              rootPath: ctx.rootPath,
            },
          );
          // pull 成功（specDir 非空）+ lease 带了 latest_spec_version → 回写本地版本保鲜。
          // wsId 现永远非空（2026-07-10-remove-server-local-workspace-mode 移除 server-local，唯一路径恒为 daemon-client）；quick-chat / 无 workspace 场景 pullSpecBundle 返回 null 跳过。
          if (specRoot && wsId && leaseSpecVersion !== undefined) {
            await bumpLocalSpecVersion(resolveSpecDir(wsId), leaseSpecVersion);
          }
        }
      } catch (e) {
        console.warn('task_runner: spec_bundle_pull_failed', leaseId, e);
      }


      // 步骤 2.7（2026-07-08 修复）：spawn 前把同步的平台 skills 拷到 workDir/.claude/skills/。
      // syncSkills 同步到 ~/.sillyhub/daemon/skills/，但 claude 只读 <cwd>/.claude/skills/
      // ——不接线则 batch 会话看不到 sillyspec/custom skills。失败仅 warn（skill 缺失不阻塞 spawn）。
      try {
        await linkSkillsToWorkdir(workDir);
        // task-09（design §9 / D-017）：profile.skill_refs 子集过滤。claim payload
        //（context.py task-07 透传）带 skillRefs 时，link 全量后按子集裁剪
        // <workDir>/.claude/skills/，只保留引用的 skill 目录，其余删除（profile 只能收紧）。
        // skillRefs 缺省/空 → 不裁剪（全量，向后兼容 FR-15）。
        const skillRefs = pickStrList(ctx, 'skillRefs', 'skill_refs');
        if (skillRefs) {
          await pruneSkillsToSubset(workDir, skillRefs, leaseId);
        }
      } catch (e) {
        console.warn('task_runner: link_skills_failed', leaseId, e);
      }

      // 步骤 2.8（2026-07-08）：派发 prompt 记入 agent 日志——batch 路径。
      // claude 秒退（529/init 失败）时 agent 日志只有 SYSTEM:init + error，看不到实际
      // 派发了什么。提交 prompt 为 user_input 日志条目（与 interactive 路径对齐）。
      if (ctx.agentRunId && claimToken) {
        try {
          await this.client.submitMessages(leaseId, claimToken, ctx.agentRunId, [
            { event_type: 'user_input', content: ctx.prompt ?? '(空 prompt)', channel: 'user_input' },
          ]);
        } catch (e) {
          console.warn('task_runner: prompt_log_failed', leaseId, e);
        }
      }

      // 步骤 3：spawn env 构造（task-09 接入 buildSpawnEnv）
      // 三层合并：tool_config.env > claude token（credentials.json + process.env 兜底）
      // > process.env 副本。token 绝不入日志/Redis/HTTP（R-09 不泄漏铁律）。
      // buildSpawnEnv 内部调 credential.buildEnv 渲染 ctx.toolConfig 占位符（task-05 注入）。

      // 步骤 4：getBackend(provider)（默认 claude，对齐 Python DEFAULT_PROVIDER）
      const provider = ctx.provider ?? 'claude';
      let adapter: ProtocolAdapter;
      try {
        adapter = getBackend(provider);
      } catch (e) {
        // 不支持的 provider（对齐 Python KeyError → failed）
        const msg = e instanceof Error ? e.message : String(e);
        const errMsg = `unsupported provider: ${provider} (${msg})`;
        return this._finish(leaseId, startTime, false, 1, 'failed', '', this._truncate(errMsg, MAX_ERROR), sessionId, {
          diff: EMPTY_DIFF,
          exitCode: 1,
          spawnStatus: 'failed',
          stats: undefined,
          retryCount: 0,
        });
      }
      // task-06：adapter 累加器跨 lease 重置（防御性，避免 adapter 单例时跨 lease 污染）。
      // StreamJsonAdapter 实现了 resetAccumulator；其他 adapter 无此方法则跳过。
      const adapterWithReset = adapter as { resetAccumulator?: () => void };
      if (typeof adapterWithReset.resetAccumulator === 'function') {
        adapterWithReset.resetAccumulator();
      }

      // 步骤 5：startLease（失败仅 warn，不中断）
      try {
        await this.client.startLease(leaseId, claimToken);
      } catch (e) {
        console.warn('task_runner: start_lease_failed', leaseId, e);
      }

      // ql-20260616-006：lease heartbeat 循环（并发检测 backend cancel 信号）
      // backend cancel_lease 把 lease.status 置 'cancelled'，daemon 侧通过定期
      // leaseHeartbeat 拉取 status 字段检测；命中立即 this.cancel() 触发 SIGTERM
      // kill 子进程。同时续期 lease_expires_at（默认 60s），防止 expire_leases 误杀。
      hbStop = new AbortController();
      heartbeatPromise = this._runLeaseHeartbeatLoop(
        leaseId,
        claimToken,
        ac.signal,
        hbStop.signal,
      );

      // 步骤 6：spawn 子进程 + 流式采集（task-10 B3：spawn 级失败自动重试循环）
      const cmdPath = ctx.cmdPath ?? ctx.cmd ?? '';
      if (!cmdPath) {
        // cmdPath 空字符串 → 不能 spawn（B-19-13）
        const errMsg = 'cmd_path is empty, cannot spawn agent process';
        return this._finish(leaseId, startTime, false, 1, 'failed', '', errMsg, sessionId, {
          diff: EMPTY_DIFF,
          exitCode: 1,
          spawnStatus: 'failed',
          stats: undefined,
          retryCount: 0,
        });
      }

      // task-06（spike-01 修正 / D-009）：spawn 前把 provider_config.settings_config 的
      // 白名单顶层键（attribution/enabledPlugins/model/skipDangerousModePermissionPrompt）
      // 写进 $CLAUDE_CONFIG_DIR/settings.json，让无 env 等价物的开关（attribution）生效。
      // absent / null / 仅 env → helper 内 return 不写文件（零回归）；写盘失败 best-effort
      // 不阻断 spawn。单 lease 内只写一次（retry 循环在下方，同一 settings.json 重写幂等）。
      // task-03（2026-09-10-multi-provider-injection / Grill P2）：kind 守卫——仅
      // agent_kind='claude' 或缺省才调 applyClaudeSettings，堵 codex/pi kind 的
      // settings_config 白名单键写穿 claude 目录并残留（claude-settings.ts 本体不动；
      // provider_config 为 null/undefined 时照旧调用，helper 内部零写入零回归）。
      if (
        !ctx.provider_config ||
        ctx.provider_config.agent_kind === 'claude' ||
        ctx.provider_config.agent_kind === undefined
      ) {
        await applyClaudeSettings(ctx.provider_config);
      }

      // task-03（FR-01/FR-02 / D-005/D-011/D-012）：codex/pi 配置写盘层分派。
      // per-session 目录段 = leaseId（batch 无会话 id，lease 是唯一稳定执行粒度）；
      // 写盘失败 helper 内收口（零 env 正常返回），spawn 主路径不阻断。
      const providerFileEnv = await applyProviderFileSettings({
        sessionKey: leaseId,
        provider: ctx.provider_config,
        daemonApiKey: this.config?.api_key ?? null,
      });

      const spawnEnv = buildSpawnEnv(ctx, { credential: this.credential });

      // task-03：文件层 env（CODEX_HOME / PI_CODING_AGENT_DIR）最后合并——per-session
      // 隔离目录是平台更高意志，盖过 process.env / injector 层同键残留（正常流无同键）。
      Object.assign(spawnEnv, providerFileEnv);

      // task-02 (2026-07-07-daemon-skill-execution): stage_dispatch 分支
      // backend 拼 stage prompt 已废弃，改为传 stage_meta（StageDispatchMeta）。
      // daemon 注入 STAGE_META env + 构造 skill 调用 prompt。
      // stage_meta 通过 duck typing 读取（AgentSpecBundle.stage_meta 透传至 lease payload）。
      const stageMeta = (ctx as { stage_meta?: Record<string, unknown> }).stage_meta;
      const stageDispatch = (ctx as { stage_dispatch?: boolean }).stage_dispatch;
      if (stageMeta !== undefined) {
        spawnEnv['STAGE_META'] = JSON.stringify(stageMeta);
      }
      // stage_dispatch 且 prompt 为空/DAU → 用 skill 指令替代 prompt（设计 §5.1）。
      // prompt 已有值（非 stage_dispatch / 非空）→ 保持原逻辑零回归。
      const effectivePrompt = (stageDispatch && (!ctx.prompt || ctx.prompt.trim() === ''))
        ? buildSkillPrompt(stageMeta)
        : (ctx.prompt ?? '');
      const maxRetries = resolveMaxRetries(this.config);

      // task-16（D-003 冻结语义）：allowed_roots 在 spawn 前取一次 PolicyCache 快照，
      // 整个 batch（含 spawn 重试）期间冻结，不随 WS POLICY_UPDATE 热更新变。
      // 新起 batch 才再读 PolicyCache 最新值。
      // 数据源优先级：PolicyCache.get(ctx.runtimeId)?.allowedRoots（per-runtime）
      //   > config.allowed_roots（未注入 policyCache 时的全局兜底，向后兼容）。
      // policyCache 未注入（旧测试）或 rid 未命中（runtime 尚未注册 / 心跳未拉到）
      // 都回退 config.allowed_roots，绝不 throw，保持旧沙箱行为。
      const physicalAllowedRoots =
        this.policyCache?.get(ctx.runtimeId)?.allowedRoots ??
        this.config?.allowed_roots;
      // task-09（D-013）：profile.effective_allowed_roots 下推收紧。backend dispatch
      // 时算好 effective = daemon.allowed_roots ∩ agent.overlay（agent 只能收紧），
      // 经 claim payload（context.py task-07 透传）下发。payload 带 effective 时与
      // 物理沙箱取交集兜底（effective 已是 daemon 子集，此处防御性 ∩ 物理上限防
      // backend 误算放宽）；不带 → 用原值（向后兼容 FR-15）。
      const effectiveRoots = pickStrList(
        ctx,
        'effectiveAllowedRoots',
        'effective_allowed_roots',
      );
      const frozenAllowedRoots = effectiveRoots
        ? intersectAllowedRoots(physicalAllowedRoots, effectiveRoots)
        : physicalAllowedRoots;

      // 步骤 5.5（task-07 / 2026-08-23-agent-file-upload-mcp / FR-02/FR-07）：
      // 仅 provider=claude 租约注入 sillyhub-file MCP（D-008@v1：codex/cursor 不注入，
      // gemini 无链路）。buildFileMcpServerConfig（runId=agentRunId、allowedRoot=workDir
      // worktree 根、daemon 凭证）→ 写 os.tmpdir() 下 0600 临时 .mcp.json（D-009@v2：
      // 凭证经 per-server env 落 0600 tmpfile——spike-01 证父进程 spawnEnv 自定义变量
      // 不透传 interactive SDK MCP 子进程，per-server env 是已验证可靠通道；R-03 spike
      // 顺带实测 claude CLI 2.1.216 的 .mcp.json per-server env 支持 ${VAR} 展开（按
      // claude 进程 env 展开），「文件只存变量引用」加固形态可用，本任务按 D-009@v2
      // 直写凭证形态实现）。文件不进 workDir（rootPath 模式 workDir=宿主真实仓库，
      // 防 git status 污染，R-09）；重试循环复用同一文件；run 终 finally 删除。
      // 写盘失败仅 warn 降级（worker 无上传工具但编排照跑，与 startLease 失败同策略）。
      if (provider === 'claude') {
        try {
          fileMcpTmpPath = this._writeFileMcpTmpConfig(leaseId, ctx, workDir);
        } catch (e) {
          console.warn('task_runner: file_mcp_config_write_failed', leaseId, e);
          fileMcpTmpPath = null;
        }
      }

      // 重试循环：spawn → stream → 判定（task-10 B3）。
      // 可重试：timeout / spawn ENOENT / OOM / segfault / killed。
      // 不重试：cancelled / businessError（claude is_error）/ completed / 业务非零退出。
      // R-10：重试清空 resumeSessionId（避免 --resume 重复 side-effect）。
      //
      // task-08（D-006 / D-009）：budget 累计 + 软切断检查点。
      // 口径 = input_tokens + output_tokens（**不含** cache_*），per-lease / per-AgentRun
      // 跨 attempt 累加。budget_tokens undefined → 整段检查点短路（FR-07 零回归）。
      // 软切断：累计 ≥ budget → 设 overBudget（**不**调 close/kill）→ 当前 attempt 自然
      // 跑完，重试循环 by overBudget 拦截下一个 attempt（D-006：不硬杀当前 turn/step）。
      const budgetTokens = ctx.budget_tokens;
      const budgetEnabled =
        typeof budgetTokens === 'number' &&
        Number.isFinite(budgetTokens) &&
        budgetTokens > 0;
      // budgetState.used = 已收尾 attempt 的累计 token（跨 attempt 加总）；
      // .over = 已触发软切断（事件只发一次，幂等）。
      const budgetState = { used: 0, over: false };
      /**
       * task-08：stats 回调（每次 complete 事件触发）→ 累计 + 软切断检查。
       * usedBeforeAttempt 是 per-attempt 闭包绑定（每次循环 const 重建），
       * 避免同 attempt 内多次 stats 叠加（stats 本身是 attempt 内 cumulative）。
       */
      const checkBudgetMidStream = (
        usedBeforeAttempt: number,
        stats: Record<string, unknown>,
      ): void => {
        if (!budgetEnabled || budgetState.over) return;
        const attemptDelta = extractBudgetUsageTokens(stats);
        const total = usedBeforeAttempt + attemptDelta;
        if (total >= (budgetTokens as number)) {
          budgetState.over = true;
          const u = pickBudgetUsageSnapshot(stats);
          this._emitBudgetExceeded(
            leaseId,
            claimToken,
            ctx.agentRunId ?? '',
            u,
            budgetTokens as number,
          );
        }
      };
      let attempt = 0;
      let result: SpawnAttemptResult;
      let effectiveCtx = ctx;
      for (;;) {
        // 重试前重置 adapter 累加器（防御性，避免跨 attempt 污染）
        if (attempt > 0) {
          const adapterWithReset = adapter as { resetAccumulator?: () => void };
          if (typeof adapterWithReset.resetAccumulator === 'function') {
            adapterWithReset.resetAccumulator();
          }
        }
        // task-08：本 attempt 起始的累计基线（const per-attempt，闭包捕获稳定）。
        const usedBeforeAttempt = budgetState.used;
        // args 每次重试都重新构建（重试时 effectiveCtx.resumeSessionId 已清空，buildArgs 不带 --resume）
        // ql-20260617-008：透传 prompt，ndjson 协议把 prompt 作为 args 末尾位置参数
        // task-16：allowedRoots 用 frozenAllowedRoots（D-003 冻结，不随热更新变）。
        // task-07：mcpConfigPath 走交叉类型局部变量透传——ProtocolAdapter.buildArgs
        // 契约（protocol-adapter.ts）不含该字段（本任务不改契约文件），StreamJsonAdapter
        // 的 buildArgs opts 已扩 mcpConfigPath?，非 claude provider 时为 undefined。
        const buildArgsOpts: Parameters<NonNullable<ProtocolAdapter['buildArgs']>>[0] & {
          mcpConfigPath?: string;
        } = {
          model: effectiveCtx.model,
          sessionId: effectiveCtx.sessionId,
          resumeSessionId: effectiveCtx.resumeSessionId,
          prompt: effectivePrompt,
          // task-16：per-runtime allowed_roots（PolicyCache.get 快照，spawn 时冻结）。
          allowedRoots: frozenAllowedRoots,
          toolConfig: ctx.toolConfig as
            | { mode?: string; allowed_tools?: string[]; max_turns?: number }
            | undefined,
        };
        if (fileMcpTmpPath) {
          buildArgsOpts.mcpConfigPath = fileMcpTmpPath;
        }
        const args = adapter.buildArgs ? adapter.buildArgs(buildArgsOpts) : [];

        result = await this._spawnAndStream({
          cmdPath,
          args,
          opts: { cwd: workDir, env: spawnEnv },
          adapter,
          prompt: effectivePrompt,
          ctx: effectiveCtx,
          signal: ac.signal,
          outputParts,
          onSessionId: (sid: string) => {
            if (sid) sessionId = sid;
          },
          leaseId,
          claimToken,
          // task-08：stats 观察回调（budget 软切断检查点，未启用时仍空跑无副作用）。
          onStats: (stats) => checkBudgetMidStream(usedBeforeAttempt, stats),
        });

        // task-08：attempt 结束 → 把本 attempt 最终 usage 累加到 budgetState.used，
        // 并再做一次阈值判定（覆盖 ndjson getUsage 兜底统计 / 未走 complete stats 的场景）。
        if (budgetEnabled) {
          const finalDelta = extractBudgetUsageTokens(result.stats);
          budgetState.used = usedBeforeAttempt + finalDelta;
          if (!budgetState.over && budgetState.used >= (budgetTokens as number)) {
            budgetState.over = true;
            const u = pickBudgetUsageSnapshot(result.stats);
            this._emitBudgetExceeded(
              leaseId,
              claimToken,
              ctx.agentRunId ?? '',
              u,
              budgetTokens as number,
            );
          }
        }

        // 判定是否重试 —— overBudget 时不再启新 attempt（软切断 D-006）。
        const shouldRetry =
          !budgetState.over &&
          isSpawnLevelFailure(result) &&
          attempt < maxRetries;
        if (!shouldRetry) break;
        attempt++;
        // R-10：重试清空 resumeSessionId（避免 --resume 重复 side-effect）
        effectiveCtx = { ...effectiveCtx, resumeSessionId: undefined };
        console.warn(
          `task_runner: spawn_retry lease=${leaseId} attempt=${attempt} status=${result.status} error=${result.error ?? ''}`,
        );
      }

      // 步骤 7-8 已在 _spawnAndStream 内完成（parse + submit + exit 等待）。
      // 此处 result.exitCode / result.status / sessionId 已就绪。

      // 步骤 8b：collectDiff（失败仅 warn，patch 留空）
      // 显式可变类型 + 展开拷贝：EMPTY_DIFF 是 as const 字面量（readonly 字面量类型），
      // 直接 let diff = EMPTY_DIFF 会让后续 diff = d 因字面量不兼容报错。
      let diff: { patch: string; files_changed: number; insertions: number; deletions: number; stats: string } = { ...EMPTY_DIFF };
      try {
        const d = await this.workspace.collectDiff(workDir);
        diff = d;
      } catch (e) {
        console.warn('task_runner: diff_collect_failed', leaseId, e);
      }

      // 步骤 8.5：spec-sync utility sync（task-05 改调，pack+post 合并到 postSpecSync）。
      // 仅当 specRoot 非空（即步骤 1.5 触发了 pull）时触发。失败不阻塞 agent 结果
      //（FR-05 + §5 E-02）：sync 失败仅 warn，_finish 仍按 agent 实际 exitCode/status
      // 汇总 TaskResult，绝不把 success=true 改写为 failed。
      if (specRoot) {
        try {
          const wsId = (ctx as { workspaceId?: string }).workspaceId!;
          const resp = await postSpecSync(
            this.client as unknown as Parameters<typeof postSpecSync>[0],
            wsId,
            specRoot,
          );
          if (resp !== null) {
            console.info('task_runner: spec_sync_ok', leaseId, resp);
          }
        } catch (e) {
          console.warn('task_runner: spec_sync_failed', leaseId, e);
        }
      }

      // 步骤 9：汇总 TaskResult
      let success = result.status === 'completed' && result.exitCode === 0;
      let finalStatus: TaskStatus = success ? 'completed' : result.status;
      const outputRaw = outputParts.join('');
      let output = this._truncate(outputRaw, MAX_OUTPUT);
      let errorOut = this._truncate(result.error ?? '', MAX_ERROR);

      // task-08（NFR-01 / D-001 兜底）：stage lease 检测 claude 是否成功调 skill。
      // 输出含 "skill not found" 等明确失败标记 → 标 failed + 报错（不静默放过）。
      // 非 stage lease（stageMeta 空）→ 不检测，零回归。
      if (success && stageMeta !== undefined && !detectSkillInvoked(outputRaw, stageMeta)) {
        const skillName = typeof stageMeta.skill_name === 'string' ? stageMeta.skill_name : '<unknown>';
        const stageName = typeof stageMeta.stage === 'string' ? stageMeta.stage : '<unknown>';
        const skillErr = `stage '${stageName}' 必须调用 skill '${skillName}'，但 claude 未成功调用（输出含 skill not found 或无 skill 调用痕迹）`;
        console.warn('task_runner: skill_not_invoked', leaseId, { stage: stageName, skill: skillName });
        success = false;
        finalStatus = 'failed';
        errorOut = skillErr;
      }

      return this._finish(leaseId, startTime, success, result.exitCode, finalStatus, output, errorOut, sessionId, {
        diff,
        exitCode: result.exitCode,
        spawnStatus: result.status,
        stats: result.stats,
        retryCount: attempt,
      });
    } catch (e) {
      // 顶层 try/catch：workspace / 其它未预期异常 → failed（对齐 Python except Exception）
      const msg = e instanceof Error ? e.message : String(e);
      const output = this._truncate(outputParts.join(''), MAX_OUTPUT);
      return this._finish(leaseId, startTime, false, 1, 'failed', output, this._truncate(msg, MAX_ERROR), sessionId, {
        diff: EMPTY_DIFF,
        exitCode: 1,
        spawnStatus: 'failed',
        stats: undefined,
        retryCount: 0,
      });
    } finally {
      // ql-20260616-006：停止 lease heartbeat 循环并等其退出，避免泄漏
      if (hbStop) hbStop.abort();
      if (heartbeatPromise) await heartbeatPromise.catch(() => {});
      // task-07（R-09/D-009@v2）：run 终态（成功/失败/取消/异常统一路径）删除
      // tmp .mcp.json——凭证生命周期收敛为单 run。force 容忍已不存在，rm 失败静默
      //（残留由下次 daemon 启动清扫兜底，见构造器 cleanupStaleFileMcpConfigs）。
      if (fileMcpTmpPath) {
        await rm(fileMcpTmpPath, { force: true }).catch(() => {});
      }
    }
  }

  // ── task-03（2026-09-07-arch-large-file-split）：子模块下沉函数的类型桥 ──────

  /**
   * task-03：``this as unknown as TaskRunnerCore`` 类型桥——spawn-stream.ts /
   * file-mcp.ts 的下沉函数经此拿原 ``this`` 的成员引用（对齐 task-02
   * SessionManagerCore 先例），行为零变化。
   */
  private _core(): TaskRunnerCore {
    return this as unknown as TaskRunnerCore;
  }

  // ── task-07（2026-08-23-agent-file-upload-mcp）：worker sillyhub-file .mcp.json ──

  /**
   * 写 worker 临时 .mcp.json（仅 claude 租约调用，runLease 步骤 5.5）。
   *
   * - server 条目：``buildFileMcpServerConfig(server_url, {token, apiKey}, {runId,
   *   allowedRoot: workDir})``（task-05 工厂；runId 缺省回落 leaseId，保证文件名可辨识）；
   * - 位置：``os.tmpdir()``（node:path join 三平台兼容；**不进 workDir**——rootPath
   *   模式 workDir=宿主真实仓库，写进去会污染 git status，R-09）；
   * - 权限：writeFile mode 0600 + 显式 chmod 兜底（umask）；Windows 无 POSIX 权限位，
   *   chmod best-effort 不抛错（三平台兼容）；
   * - 凭证（D-009@v2）：daemon token/apiKey 经 per-server env 写入本 0600 文件
   *   （spike-01 验证 per-server env 是 MCP 子进程可靠投递通道）。
   *
   * 写盘异常由调用方 catch（warn 降级，不阻塞 worker 编排）。
   * task-03：方法体下沉到 ./task-runner/file-mcp.js（this → runner 显式传参）。
   */
  private _writeFileMcpTmpConfig(leaseId: string, ctx: LeaseCtx, workDir: string): string {
    return writeFileMcpTmpConfig(this._core(), leaseId, ctx, workDir);
  }

  // ── init lease 轻量分支（task-07 / D-002/D-009，不启 agent）──────────────────

  /**
   * 处理 init lease：写 daemon 状态文件（D-001@v1，2 字段到 .runtime/spec-version.json）+ pull 文档 + post 本地改动。
   *
   * 与 ``runLease`` 并列但**严格不启 agent**（与 ``runChangeWrite`` 同范式的轻量分支）：
   *   - 不调 workspace.prepareWorkspace / getBackend / spawn / heartbeat（init 不跑 agent）；
   *   - 完整编排委托 ``spec-sync.handleInitLease``（纯函数 + client 参数注入，D-007@v1）。
   *
   * lease payload 来源（backend task-06 start_init_dispatch 下发，待合并）：
   *   - workspaceId / rootPath：成员 binding 解析（task-01 per-member）；
   *   - platformConfig{server_origin, strategy} + latest_spec_version：SpecWorkspace 字段；
   *     platformConfig.local_yaml{platform_token, mcp_token}：claim 时一次性注入（design §5.4）。
   *   serverOrigin 用 daemon config.server_url 去尾斜杠（D-002：**不用 payload.server_origin**——
   *   local.yaml 给本机 sillyspec 用需本机可达地址，backend 值 docker/远程部署可能不一致）。
   *
   * 终态上报（design §9 init_completed / init_failed）：
   *   - 成功 → _finish status='completed'，**stats 携带 init_synced_at + init_synced_spec_version**
   *     供 daemon complete_lease 透传给 backend 更新 WorkspaceMemberRuntime（complete body
   *     stats 字段是 free-form Record，backend 据 stats.init_synced_* 落库）。
   *   - 失败 → status='failed'，error 含失败步骤，stats 仍带 init_synced_spec_version（兜底 0）
   *     让 backend 记录「初始化失败」终态。
   *
   * 容错：handleInitLease 内部已 catch 各步骤（写 daemon 状态文件 / pull 硬失败 abort，post
   * 软失败 warn），不会向上抛；此处不再 try/catch（保证终态落 completed/failed 而非 runLease
   * 顶层 catch 的 generic failed）。
   */
  private async _runInitLease(
    ctx: LeaseCtx,
    leaseId: string,
    startTime: number,
  ): Promise<TaskRunnerResult> {
    const workspaceId =
      (ctx as { workspaceId?: string }).workspaceId ??
      (ctx as { workspace_id?: string }).workspace_id;
    const rootPath = ctx.rootPath;

    // 缺关键字段 → 直接 failed（init lease 必带 workspaceId + rootPath，缺失是 lease 构造异常）。
    if (!workspaceId || !rootPath) {
      const errMsg = `init lease missing required fields: workspace_id=${workspaceId ?? ''} root_path=${rootPath ?? ''}`;
      return this._finish(leaseId, startTime, false, 1, 'failed', '', this._truncate(errMsg, MAX_ERROR), '', {
        diff: EMPTY_DIFF,
        exitCode: 1,
        spawnStatus: 'failed',
        stats: { init_synced: false, init_error: errMsg },
        retryCount: 0,
      });
    }

    // platform_config + latest_spec_version 从 lease payload 鸭子类型读取（backend task-06 透传；
    // 字段名兼容 camelCase / snake_case）。
    const platformConfigRaw =
      (ctx as { platformConfig?: Record<string, unknown> }).platformConfig ??
      (ctx as { platform_config?: Record<string, unknown> }).platform_config ??
      {};
    // D-002：serverOrigin 用 daemon config.server_url（本机可达地址）去尾斜杠，**不用 payload.server_origin**
    //（后端 SERVER_ORIGIN 在 docker/远程部署时可能与本机可达地址不一致；local.yaml 给本机 sillyspec 用，
    // 必须 reach 本机地址）。复用 daemon._serverOrigin() 范式（daemon.ts:2169 config.server_url.replace(/\/+$/,'')）。
    const serverOrigin = (this.config?.server_url || '').replace(/\/+$/, '');
    const strategy =
      pickStr(platformConfigRaw, 'strategy') || ctx.specStrategy || 'platform-managed';
    const latestSpecVersion =
      pickNum(platformConfigRaw, 'latest_spec_version', 'latestSpecVersion') ??
      (ctx as { latestSpecVersion?: number }).latestSpecVersion ??
      (ctx as { latest_spec_version?: number }).latest_spec_version;
    // local_yaml 从 platformConfig 透传给 handleInitLease 第4步 writeLocalYaml（design §5.4 / D-003）。
    // platformConfigRaw.local_yaml={platform_token,mcp_token}（backend claim 时一次性注入，不落库）。
    // 缺失 / 非对象 / 任一 token 空 → undefined（向后兼容旧 lease / mock，handleInitLease 据此跳过 writeLocalYaml）。
    const localYamlRaw = platformConfigRaw.local_yaml;
    const localYamlObj =
      localYamlRaw && typeof localYamlRaw === 'object'
        ? (localYamlRaw as Record<string, unknown>)
        : null;
    const localPlatformToken = localYamlObj ? pickStr(localYamlObj, 'platform_token') : undefined;
    const localMcpToken = localYamlObj ? pickStr(localYamlObj, 'mcp_token') : undefined;
    const local_yaml: HandleInitLeaseParams['local_yaml'] =
      localPlatformToken && localMcpToken
        ? { platform_token: localPlatformToken, mcp_token: localMcpToken }
        : undefined;
    // init lease 凭据断链取证（docs/sillyspec/init-lease-silent-no-local-yaml.md，2026-09-09）：
    // 跳过写盘本身是既有语义（向后兼容旧 lease / mock），但此前零提示——backend 降级不签发
    // 或 lease 残缺时 local.yaml platform 段缺失整链静默，CLI 同步断链无从发现。warn 带
    // 原因枚举，不改变行为。
    if (!local_yaml) {
      const localYamlSkipReason = !localYamlRaw
        ? 'local_yaml_missing'
        : !localYamlObj
          ? 'local_yaml_not_object'
          : 'token_empty_or_invalid';
      console.warn(
        'task_runner: init_lease_local_yaml_skipped',
        leaseId,
        localYamlSkipReason,
      );
    }

    const initParams: HandleInitLeaseParams = {
      workspaceId,
      rootPath,
      serverOrigin,
      strategy,
      latestSpecVersion,
      local_yaml,
      // task-06（FR-04 / D-005@v1 / D-007@v1）：cli.ts 注入的 detectedAgents 透传给
      // runSillyspecInit --tool；未注入 / 空 → undefined（runSillyspecInit 内兜底 ['claude']）。
      tools:
        this.detectedAgents && this.detectedAgents.length > 0
          ? this.detectedAgents
          : undefined,
    };

    const result = await handleInitLease(
      this.client as unknown as Parameters<typeof handleInitLease>[0],
      initParams,
    );

    // 终态：成功 completed / 失败 failed。stats 携带 init_synced_* 供 backend 落库
    // WorkspaceMemberRuntime（complete_lease body.stats 是 free-form Record，daemon.ts
    // completeLease 透传 taskResult.stats 不需改 daemon）。
    const initSyncedAt = new Date().toISOString();
    const stats: Record<string, unknown> = {
      init_synced: result.ok,
      init_synced_at: initSyncedAt,
      init_synced_spec_version: result.specVersion,
    };
    if (result.daemonState) {
      stats.init_daemon_state = result.daemonState;
    }
    if (!result.ok && result.error) {
      stats.init_error = result.error;
    }

    console.info('task_runner: init_lease_done', leaseId, {
      workspace_id: workspaceId,
      ok: result.ok,
      spec_version: result.specVersion,
    });

    const status: TaskStatus = result.ok ? 'completed' : 'failed';
    const exitCode = result.ok ? 0 : 1;
    const output = result.ok ? 'init lease completed' : '';
    const error = result.ok ? '' : this._truncate(result.error ?? 'init lease failed', MAX_ERROR);
    return this._finish(leaseId, startTime, result.ok, exitCode, status, output, error, '', {
      diff: EMPTY_DIFF,
      exitCode,
      spawnStatus: status,
      stats,
      retryCount: 0,
    });
  }

  // ── ql-20260616-006：lease heartbeat 循环（cancel 信号检测 + 续期）──────────

  /**
   * 并发跑 lease heartbeat：定期调 backend leaseHeartbeat，拉回的 status 字段
   * 命中 'cancelled' → 立即 this.cancel(leaseId) 触发 AbortSignal + SIGTERM kill
   * 子进程。同时续期 lease_expires_at，防止 expire_leases 误杀。
   *
   * 并发安全：与 _spawnAndStream 共享 ac.signal（cancel 时一并 abort）。
   * stopSignal 用于正常退出（spawn 完成）时让循环跳出。
   *
   * leaseHeartbeat 是 RunnerHubClient 可选方法（旧 mock client 可能没实现），
   * 缺失时直接 return（不影响主流程）。
   */
  private async _runLeaseHeartbeatLoop(
    leaseId: string,
    claimToken: string,
    parentSignal: AbortSignal,
    stopSignal: AbortSignal,
  ): Promise<void> {
    if (!claimToken) return;
    if (typeof this.client.leaseHeartbeat !== 'function') return;
    const intervalMs = Math.max(1, (this.config?.lease_heartbeat_interval ?? 5)) * 1000;
    while (!parentSignal.aborted && !stopSignal.aborted) {
      try {
        const resp = await this.client.leaseHeartbeat(leaseId, claimToken);
        const status = (resp as { status?: string } | null)?.status;
        if (status === 'cancelled') {
          console.warn(
            `task_runner: lease_cancelled_by_backend lease=${leaseId} — reporting killed + killing child`,
          );
          // 先上报 killed 让 AgentRun.status 立即变终态（complete_lease 对 cancelled
          // lease 会失败，syncStatus 是唯一保证 agent_run 状态更新的路径）
          if (typeof this.client.syncStatus === 'function') {
            try {
              await this.client.syncStatus(
                leaseId,
                claimToken,
                'killed',
                'cancelled by user',
              );
            } catch (syncErr) {
              console.warn(
                'task_runner: sync_status_killed_failed',
                leaseId,
                syncErr,
              );
            }
          }
          await this.cancel(leaseId);
          return;
        }
      } catch (e) {
        // heartbeat 失败不致命（网络抖动 / lease 过期 / token 失效），仅 debug
        console.warn('task_runner: lease_heartbeat_failed', leaseId, e);
      }
      // 可中断 sleep：parent 或 stop 任一 abort 立即跳出
      // 注意：若信号已 aborted（race），Promise executor 同步 resolve，避免悬挂。
      if (parentSignal.aborted || stopSignal.aborted) return;
      // D1（健壮性修复，2026-07-24）：定时器正常触发时也必须移除 abort 监听器——
      // 原 {once:true} 仅在 abort 事件触发时移除该信号上的监听器，定时器 resolve 路径
      // 两个监听器永不移除 → 每个 lease 跑超 ~25s 就累积 10+ 监听器触发
      // MaxListenersExceededWarning + 内存膨胀；abort 时未触发的那条信号上的监听器也泄漏。
      // done 守卫 + onAbort 统一在两条路径清理两个信号 + 清定时器。
      await new Promise<void>((resolve) => {
        let done = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const onAbort = () => {
          if (done) return;
          done = true;
          if (timer) clearTimeout(timer);
          parentSignal.removeEventListener('abort', onAbort);
          stopSignal.removeEventListener('abort', onAbort);
          resolve();
        };
        timer = setTimeout(onAbort, intervalMs);
        parentSignal.addEventListener('abort', onAbort, { once: true });
        stopSignal.addEventListener('abort', onAbort, { once: true });
      });
    }
  }

  // ── 步骤 6-7：spawn + 流式 stdout 解析 + stdin 控制 ───────────────────────

  /**
   * spawn 子进程，逐行读 stdout，写 prompt 到 stdin，处理 control_request。
   *
   * 对齐 Python `StreamJsonBackend.execute`（backends/stream_json.py:34-172）+
   * `_consume_stdout`（174-204）+ `_handle_control_request`（206-246）。
   *
   * R-03（stdin 控制）：
   *   - 写完 prompt 后 stdin 不立即 end；
   *   - stdout 行命中 control_request → adapter.onControl(line, stdin) 写回应答；
   *   - result 行（或 exit）后才 stdin.end。
   *
   * R-04（背压）：readline.createInterface + for await...of 自带背压。
   *
   * 超时（B-19-07）：setTimeout → SIGTERM → 2s 后 SIGKILL。
   *
   * 取消（B-19-06）：AbortSignal.aborted → SIGTERM → 同样优雅升级。
   *
   * task-03（2026-09-07-arch-large-file-split）：方法体下沉到
   * ./task-runner/spawn-stream.js（this → runner 显式传参，行为零变化）。
   */
  private async _spawnAndStream(params: SpawnStreamParams): Promise<SpawnAttemptResult> {
    return spawnAndStream(this._core(), params);
  }

  /**
   * 处理 stdout 一行：parse → submitMessages + control_request 应答 + result 检测。
   *
   * 对齐 Python `_consume_stdout` 主循环 + `_handle_control_request`。
   * 内部全部 try/catch，避免单行异常中断整体（B-19-04）。
   *
   * task-03（2026-09-07-arch-large-file-split）：方法体下沉到
   * ./task-runner/spawn-stream.js（this → runner 显式传参，行为零变化）。
   */
  private async _handleLine(
    line: string,
    adapter: ProtocolAdapter,
    child: ChildProcess,
    env: HandleLineEnv,
  ): Promise<void> {
    return handleLine(this._core(), line, adapter, child, env);
  }


  // ── task-17 / R-06：batch Codex 带内审批决策 ───────────────────────────────

  /**
   * task-17 / R-06：处理 batch Codex server request 审批决策。
   *
   * json-rpc adapter 的 parseServerRequest 已识别 file/command 类 approval，提取写路径
   * 并登记 PendingServerRequest。本方法对每个写路径调 policyEngine.canWrite 决策：
   *   - 全 allow（含 0 路径的写审批不可解，fail-closed decline）→ 写 accept response；
   *   - 任一 deny（含未注入 policyEngine / 提取不到路径）→ 写 decline response。
   *
   * 决策结果通过 audit（PolicyEngine 内部已记 ALLOW/DENY）+ AgentEvent.metadata 透传
   * 给前端展示（decline 时 metadata.reason 携带中文理由，submitMessages 一并上报）。
   *
   * response 格式（对照 codex-app-server-driver.ts _writeFailClosedResponse L1096）：
   *   ``{"jsonrpc":"2.0","id":<id>,"result":{"decision":"accept"|"decline"}}``
   *
   * 不影响 interactive Codex（codex-app-server-driver.ts 走自己的 _handleApproval，
   * 不经 TaskRunner._handleLine）。
   */
  private async _handleApprovalDecision(
    adapter: ProtocolAdapter,
    child: ChildProcess,
    env: {
      leaseId: string;
      runtimeId: string;
      observer: TerminalObserver;
    },
    approvalEv: AgentEvent,
  ): Promise<void> {
    // 从 adapter 取出 pending 条目（json-rpc adapter 已登记）。
    // 鸭子类型：仅 JsonRpcAdapter 有 getPendingServerRequests / markResponded。
    const withJsonRpc = adapter as {
      getPendingServerRequests?: () => readonly PendingServerRequest[];
      markResponded?: (id: number | string) => void;
    };
    if (
      typeof withJsonRpc.getPendingServerRequests !== 'function' ||
      typeof withJsonRpc.markResponded !== 'function'
    ) {
      // 非 json-rpc adapter（stream-json / ndjson 无 server request）→ 跳过。
      return;
    }

    const rpcId = approvalEv.metadata?.rpc_id as number | string | undefined;
    if (rpcId === undefined) return;

    // 找到对应 pending 条目（按 id）。
    const pending = withJsonRpc
      .getPendingServerRequests()
      .find((p) => p.id === rpcId);
    if (!pending) return;

    const approvalKind = pending.approvalKind ?? null;
    const writePaths = pending.writePaths ?? [];
    const toolName = pending.toolName || 'codex_approval';

    // elicitation：非写类，固定 accept（adapter 已预填 ELICITATION_RESPONSE，
    // 此处直接写 accept decision 保持简单 —— elicitation 实际由 codex-app-server
    // 走 mcpServer/elicitation/request 单独 method，正常不会进 file/command 分支）。
    if (approvalKind === 'elicitation') {
      await this._writeApprovalResponse(child, rpcId, {
        decision: 'accept',
      });
      withJsonRpc.markResponded(rpcId);
      return;
    }

    // file/command 类：走 PolicyEngine 决策。
    let decision = 'accept';
    let reason = '';
    let deniedPath = '';

    if (approvalKind === 'file' || approvalKind === 'command') {
      // 未注入 policyEngine → fail-closed decline（无引擎无法放行，保守拒绝）。
      if (!this.policyEngine) {
        decision = 'decline';
        reason =
          'Runtime Policy 拒绝本次写入。\n' +
          `Agent：codex\n` +
          `原因：PolicyEngine 未注入（batch 审批无法决策，保守拒绝）。`;
        deniedPath = '<no-policy-engine>';
      } else if (writePaths.length === 0) {
        // task-17 降级（design §13 #9）：写路径提取不到（codex payload 字段不明确），
        // 无法静态判断目标 → fail-closed decline，靠 audit 追溯兜底。
        decision = 'decline';
        reason =
          'Runtime Policy 拒绝本次写入。\n' +
          `Agent：codex\n` +
          `原因：无法从审批消息中提取写目标路径（codex 审批 payload 字段未覆盖），保守拒绝。`;
        deniedPath = '<unknown-path>';
      } else {
        // 逐条 canWrite：任一 deny 即整体 decline（对齐 canRename 短路语义）。
        for (const p of writePaths) {
          const d = this.policyEngine.canWrite(
            env.runtimeId,
            p,
            'codex',
            toolName,
          );
          if (!d.allowed) {
            decision = 'decline';
            reason = d.reason;
            deniedPath = d.normalizedPath;
            break;
          }
        }
      }
    } else {
      // 未知 approvalKind（null，adapter 未识别 method）→ fail-closed decline。
      decision = 'decline';
      reason = `Runtime Policy 拒绝本次写入。\nAgent：codex\n原因：未识别的审批 method（${pending.method}）。`;
    }

    // 写 response 到 stdin（accept/decline，codex 只看 decision 字段）。
    await this._writeApprovalResponse(child, rpcId, { decision });
    withJsonRpc.markResponded(rpcId);

    // 把决策结果回填到 approvalEv.metadata，让后续 _eventToMessages / submitMessages
    // 把 decline 中文理由透传给前端（accept 时 reason 为空，不影响展示）。
    approvalEv.metadata = {
      ...approvalEv.metadata,
      approval_decision: decision,
      ...(decision === 'decline' ? { deny_reason: reason, denied_path: deniedPath } : {}),
    };

    // observer + 本地 echo：让用户看到审批决策（accept/decline + 路径）。
    env.observer.writeParsed(
      renderAgentEvent(env.leaseId, {
        ...approvalEv,
        content: decision === 'decline' ? `审批拒绝：${deniedPath}` : '审批通过',
      }),
    );
  }

  /**
   * task-17：把 approval response JSON-RPC 写到子进程 stdin（带背压保护）。
   *
   * 格式：``{"jsonrpc":"2.0","id":<id>,"result":{"decision":"accept"|"decline"}}``
   *（对照 codex-app-server-driver.ts:1119 CodexJsonRpcResponse 形态）。
   *
   * 写失败仅 warn（不阻塞 readline，对齐 _handleLine 单行容错策略）。
   */
  private async _writeApprovalResponse(
    child: ChildProcess,
    id: number | string,
    result: Record<string, unknown>,
  ): Promise<void> {
    if (!child.stdin || child.stdin.destroyed) return;
    const response = JSON.stringify({ jsonrpc: '2.0', id, result });
    try {
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = (): void => {
          if (!done) {
            done = true;
            resolve();
          }
        };
        const ok = child.stdin!.write(response + '\n', (err?: Error | null) => {
          if (err) console.warn('task_runner: approval_response_write_failed', err);
          finish();
        });
        if (!ok) {
          child.stdin!.once('drain', finish);
        } else {
          setImmediate(finish);
        }
      });
    } catch (e) {
      console.warn('task_runner: approval_response_exception', e);
    }
  }



  /**
   * 把 AgentEvent IR 渲染成 server submit_messages 的 message dict 列表。
   *
   * task-04 轻重构②（2026-09-07-arch-large-file-split）：转换核心原样搬移至
   * src/event-wire.ts（与 session-manager eventToReportDict 共用 AgentEvent→wire
   * dict 单一实现源），本方法保留为委托（TaskRunnerCore 接口签名不变，spawn-stream
   * 调用点零改动），输出与搬移前逐字节等价（tests/event-wire.test.ts 断言）。
   *
   * 渲染规则（ql-20260616-005：1:1 复现老 SERVER 路径 _format_conversation_log，
   * 详见 event-wire.ts eventToSubmitMessages 注释）：
   *
   * 1 个 event → 0/1/2 条 message：
   *   - text + status=running → 1 条 [SYSTEM:init] session started (stdout)
   *   - text + thinking       → 1 条 [THINKING] <preview 20000> (stdout)
   *   - text + 其他            → 1 条 [ASSISTANT] <content> (stdout)
   *   - tool_use              → 2 条：[TOOL_USE] Name: cmd (stdout) + JSON (tool_call)
   *   - tool_result           → 1 条 [TOOL_RESULT] <preview 100000> (stdout)
   *   - error                 → 1 条 [LEVEL] <content> (stderr)
   *   - complete              → 1 条 [RESULT:success] <text> duration=Xms turns=N (stdout)
   *
   * 业务字段（session_id/call_id/usage）注入到首条 message，backend submit_messages
   * 透传到 AgentRunLog.metadata / AgentRun.input_tokens（usage 实时回写，见 ql-004）。
   *
   * 返回 null：未知 event type 或所有 message 都被过滤。
   */
  private _eventToMessages(ev: AgentEvent): Record<string, unknown>[] | null {
    return eventToSubmitMessages(ev);
  }

  // ── task-08（D-006 / D-009）：budget 软切断事件回传 ─────────────────────────

  /**
   * task-08（D-006 / D-009）：经现有 submitMessages 回传 ``budget_exceeded`` 事件。
   *
   * 软切断（D-006）：本调用**只发事件**，**不**调 close / kill / cancel —— 当前
   * step / attempt 让它自然跑完（由 runLease 重试循环的 ``shouldRetry`` 判定拦截下一个
   * attempt）。硬杀是 cancel / END 路径的职责，budget 不介入。
   *
   * usage 口径 D-009：仅 ``input_tokens + output_tokens``（**不含** cache_*）。
   *
   * 失败语义：fire-and-forget（同 _handleLine 的 submitMessages 策略），失败仅 warn
   * 不阻塞主流程；空 claimToken / agentRunId 静默跳过（对齐 ql-004 防空 run_id 422）。
   */
  private _emitBudgetExceeded(
    leaseId: string,
    claimToken: string,
    agentRunId: string,
    usage: { input_tokens: number; output_tokens: number },
    budgetTokens: number,
  ): void {
    if (!claimToken || !agentRunId) return;
    const message: Record<string, unknown> = {
      event_type: 'system',
      content: `[BUDGET_EXCEEDED] input=${usage.input_tokens} output=${usage.output_tokens} budget=${budgetTokens}`,
      channel: 'stdout',
      reason: 'budget_exceeded',
      usage: {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
      },
      budget_tokens: budgetTokens,
    };
    // 走 resilience 通道时优先 dedup；否则裸 client.submitMessages（fire-and-forget）。
    const forward: Promise<unknown> = this.resilience
      ? this.resilience
          .submitWithRetry(leaseId, claimToken, agentRunId, [
            { message, dedup_key: `budget_exceeded:${agentRunId}` },
          ])
          .catch((e) => {
            console.warn(
              'task_runner: budget_exceeded_forward_failed',
              leaseId,
              toCauseInfo(e),
            );
          })
      : this.client
          .submitMessages(leaseId, claimToken, agentRunId, [message])
          .catch((e) => {
            console.warn(
              'task_runner: budget_exceeded_forward_failed',
              leaseId,
              e,
            );
          });
    // 不进 pendingForwards（本调用不总在 _spawnAndStream 上下文里），fire-and-forget。
    void forward;
  }

  // ── spec bundle pull / sync push 已迁移到 ./spec-sync.ts utility（task-05 改调）──

  // ── 工具：截断（对齐 Python _truncate）─────────────────────────────────────

  /**
   * 把字符串截断到 maxLen。对齐 Python `_truncate(text: str, max_length: int) -> str`。
   * 语义：len(text) <= max → 原样；否则取 text[:max]。
   */
  private _truncate(text: string, max: number): string {
    if (text.length <= max) return text;
    return text.slice(0, max);
  }

  // ── 工具：kill 子进程（优雅升级）───────────────────────────────────────────

  /**
   * 给子进程发信号。对齐 Python `proc.terminate()`（SIGTERM）。
   * 调用方负责后续 SIGKILL 升级（_spawnAndStream 内的 killTimer）。
   */
  private _killChild(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): void {
    try {
      if (!child.killed) {
        // DA-5（2026-08-20 审计）：shell:true 路径下直接 child 是 cmd.exe 包装层，
        // 只杀它会让 agent 孙进程变孤儿继续跑。SIGKILL 升级时 Windows 改杀进程树
        // （taskkill /PID /T /F，范式对齐 runtime-handler.ts:96-115 / D-004 禁 /IM）；
        // SIGTERM 仍走优雅信号让 agent 自行收尾。
        if (signal === 'SIGKILL' && process.platform === 'win32' && child.pid) {
          spawn(
            'taskkill',
            ['/PID', String(child.pid), '/T', '/F'],
            { windowsHide: true, stdio: 'ignore' },
          );
        } else {
          child.kill(signal);
        }
      }
    } catch {
      /* 子进程已退出 */
    }
  }

  // ── 工具：终态收尾 ─────────────────────────────────────────────────────────

  /**
   * 把 TaskRunner 内部收集的碎片汇总为 TaskRunnerResult，并更新 _states + untrack。
   */
  private _finish(
    leaseId: string,
    startTime: number,
    success: boolean,
    exitCode: number,
    status: TaskStatus,
    output: string,
    error: string,
    sessionId: string,
    extra: {
      diff: { patch: string; files_changed: number; insertions: number; deletions: number; stats: string };
      error?: string;
      exitCode?: number;
      spawnStatus?: string;
      stats?: Record<string, unknown>;
      /** task-10 B3：实际重试次数（0=未重试），写入 metadata.retry_count。 */
      retryCount?: number;
    },
  ): TaskRunnerResult {
    this._states.set(leaseId, status);
    this.untrack(leaseId);
    return {
      success,
      exitCode,
      status,
      patch: extra.diff.patch,
      filesChanged: extra.diff.files_changed,
      insertions: extra.diff.insertions,
      deletions: extra.diff.deletions,
      output,
      error,
      durationMs: Date.now() - startTime,
      sessionId,
      // metadata：对齐 Python task_runner.py TaskResult.metadata（默认空 dict），
      // 此处把 session_id / retry_count / runtime 诊断信息塞入，供 complete_lease 提取
      //（types.ts LeaseCompleteResult.sessionId）。
      metadata: {
        session_id: sessionId,
        // task-10 B3：retry_count（spawn 级失败重试次数，0=未重试）。
        retry_count: extra.retryCount ?? 0,
      },
      // task-06：透传 adapter 收集的 stats（undefined 也允许，调用方 / 后端判空）。
      stats: extra.stats,
    };
  }

  // ── task-11 / FR-10 / D-004@v1：change-write 轻量分支（不启 agent）─────────────

  /**
   * 执行一个 change-write 任务：本地写 changes/<key>/ 文件 + 回执 + spec 整树回灌。
   *
   * 与 ``runLease`` 并列但**严格区分**（FR-10）：
   *   - **不**调 agent driver / SessionManager / spawn（纯文件写 + sync）；
   *   - 执行栈不经过 ``runLease``。
   *
   * kind 分流（2026-07-02-workspace-config-flow task-13 / D-012）：
   *   - ``create`` / ``edit``（默认）：写 changes/<key>/ 文件 + syncSpecTreeIfNeeded 回灌。
   *   - ``spec-sync``：「同步到服务器」手动按钮 —— **不写 changes/<key>/**，
   *     直接调 ``postSpecSync`` 把本地 spec 整树回灌到服务器权威 spec_root。
   *     files 字段携带 workspace_id 元信息（不再写文件）。
   *
   * 流程（design §5.3 Phase 3 + §7.5 回灌）：
   *   1. ``resolveSpecDir(wsId)`` 定位本地 spec 根（~/.sillyhub/daemon/specs/<wsId>）。
   *   2. ``kind === 'spec-sync'`` → ``postSpecSync`` 整树回灌（跳过文件写入）。
   *   3. 否则目标子目录 ``join(specDir, 'changes', changeKey)``。
   *   4. 遍历 ``files[]{path, content}``：path traversal 四类校验（../  / 绝对 / Win 盘符 /
   *      join 后越界）→ 抛错拒绝；``mkdir recursive`` + ``writeFile`` utf-8。
   *   5. 回执 ``completeChangeWrite(id, claimToken, { ok:true, files:[writtenRelPaths] })``。
   *   6. create/edit sync：调 task-06 ``syncSpecTreeIfNeeded({workspaceId: wsId}, client)``
   *      （复用，不重复 pack；失败仅 warn 不阻塞回执，对齐 R-03）。
   *
   * 任何 file 写入 / traversal 失败 → 抛错（调用方 daemon 负责回执 ok=false）。
   * sync 失败**不**改写 ok（已先 complete 回执，sync 是 best-effort 回灌）。
   *
   * @param ctx change-write 执行上下文（taskId / changeKey / workspaceId / files / claimToken / kind）
   */
  async runChangeWrite(ctx: ChangeWriteCtx): Promise<ChangeWriteResult> {
    const { taskId, changeKey, workspaceId, files, claimToken, kind } = ctx;

    // ── kind=spec-sync 分支：整树回灌到服务器（D-012 / task-13）──────────────
    // 「同步到服务器」手动按钮：不写 changes/<key>/，直接把本地 spec 整树 push 回服务器。
    // 复用 postSpecSync（spec-sync.ts）：pack 整树（排除 .runtime 走 postSpecSync 内部
    // packSpecDir）→ HTTP POST .../sync → backend apply_sync 落盘 + reparse。
    // 失败抛错（调用方 _executeChangeWrite 回执 ok=false），成功后 complete 回执 ok=true。
    if (kind === 'spec-sync') {
      // ql-20260816-002：backend files[0] 透传 root_path（宿主仓库根）时，打包
      // <root_path>/.sillyspec 而非 daemon 本地缓存——platform-managed 策略下缓存
      // 是旧 pull 快照，永远推不出新 change（与 get_spec_bundle RPC 同源口径）。
      // 未透传（旧 backend）保持旧行为打包缓存目录，向后兼容。
      const metaFile = files[0] as { workspace_id?: string; root_path?: string } | undefined;
      const repoRoot = metaFile?.root_path;
      let specDir = resolveSpecDir(workspaceId);
      if (repoRoot) {
        const repoSpec = join(repoRoot, '.sillyspec');
        try {
          const st = await stat(repoSpec);
          if (st.isDirectory()) {
            specDir = repoSpec;
          } else {
            console.warn('task_runner: spec_sync_repo_spec_not_dir_fallback_cache', repoSpec);
          }
        } catch {
          console.warn('task_runner: spec_sync_repo_spec_missing_fallback_cache', repoSpec);
        }
      }
      let pushOk = false;
      let filesTotal: number | undefined;
      try {
        const resp = await postSpecSync(
          this.client as unknown as Parameters<typeof postSpecSync>[0],
          workspaceId,
          specDir,
          // D-004@V2：taskId 透传给 backend apply 循环内回写 files_processed（逐文件级）。
          taskId,
          // onProgress：只报 files_total（processed 改由 backend apply 循环写，daemon 不再报）。
          (p) => {
            if (p.files_total !== undefined && typeof this.client.reportChangeWriteProgress === 'function') {
              this.client
                .reportChangeWriteProgress(taskId, claimToken, { files_total: p.files_total })
                .catch((e) => {
                  console.warn('task_runner: spec_sync_progress_report_failed', taskId, e);
                });
            }
          },
        );
        pushOk = resp !== null;
        filesTotal = resp?.filesTotal;
      } catch (e) {
        // postSpecSync 抛错（网络 / 4xx/5xx）→ 回执 ok=false。
        if (typeof this.client.completeChangeWrite === 'function') {
          await this.client.completeChangeWrite(taskId, claimToken, {
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
        throw e;
      }
      // D-004@V2：complete 前只报 files_total（files_processed 由 backend apply 循环写，daemon 不再报）。
      if (filesTotal !== undefined && typeof this.client.reportChangeWriteProgress === 'function') {
        try {
          await this.client.reportChangeWriteProgress(taskId, claimToken, {
            files_total: filesTotal,
          });
        } catch (e) {
          console.warn('task_runner: spec_sync_progress_report_failed', taskId, e);
        }
      }
      if (typeof this.client.completeChangeWrite === 'function') {
        await this.client.completeChangeWrite(taskId, claimToken, {
          ok: true,
          files: [],
        });
      }
      return {
        taskId,
        changeKey,
        ok: pushOk,
        files: [],
      };
    }

    const specDir = resolveSpecDir(workspaceId);
    const changesDir = join(specDir, 'changes', changeKey);

    // 写入前先建 changesDir（即使 files 为空也要保证目录存在，供后续 sync 收集）。
    await mkdir(changesDir, { recursive: true });

    const writtenRelPaths: string[] = [];
    for (const f of files) {
      const relPath = validateChangeWritePath(f.path, changeKey);
      const fullPath = join(changesDir, relPath);
      // join 后二次校验（防御 normalize 后越界，照搬 spec-sync extractTar 范式）。
      const rel = relative(changesDir, fullPath);
      if (rel.startsWith('..') || isAbsolute(rel)) {
        throw new Error(
          `change-write path escapes changes dir: ${f.path} -> ${fullPath}`,
        );
      }
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, f.content, 'utf-8');
      writtenRelPaths.push(relPath);
    }

    // 回执：ok=true + 实际写入路径清单。
    // completeChangeWrite 是真实 HubClient 的 additive 方法（必有），mock client
    // 未实现时降级跳过（仅本地写文件，不回执——测试场景）。
    if (typeof this.client.completeChangeWrite === 'function') {
      await this.client.completeChangeWrite(taskId, claimToken, {
        ok: true,
        files: writtenRelPaths,
      });
    }

    // sync：复用 task-06 syncSpecTreeIfNeeded（ctx-guarded + 内部 try/catch，失败仅 warn）。
    // design §5.3 末段：complete 成功后构造 specSyncCtx 回灌 changes/<key>/。
    // syncSpecTreeIfNeeded 自身失败不抛（R-03），故此处不再 try/catch。
    await syncSpecTreeIfNeeded(
      { workspaceId },
      this.client as unknown as Parameters<typeof syncSpecTreeIfNeeded>[1],
    );

    return {
      taskId,
      changeKey,
      ok: true,
      files: writtenRelPaths,
    };
  }
}

// ── 内部常量 & 辅助函数 ───────────────────────────────────────────────────────

/**
 * task-09（design §9）：link 全量 platform skills 后按 profile.skillRefs 子集裁剪。
 *
 * 删除 <workDir>/.claude/skills/ 下不在 skillRefs 中的 skill 目录（profile 只能收紧）。
 * 隐藏项（. 开头）与非目录跳过；单条 rm 失败仅 warn（不阻塞 spawn，对齐
 * linkSkillsToWorkdir 容错策略）。目录不存在（linkSkillsToWorkdir 未建 / 全跳过）→ 静默返回。
 */
async function pruneSkillsToSubset(
  workDir: string,
  skillRefs: string[],
  leaseId: string,
): Promise<void> {
  const skillsBase = join(workDir, '.claude', 'skills');
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(skillsBase, { withFileTypes: true });
  } catch {
    return; // 目录不存在（linkSkillsToWorkdir 未建 / mock no-op）→ 无可裁剪
  }
  const keep = new Set(skillRefs);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;
    if (!keep.has(entry.name)) {
      await rm(join(skillsBase, entry.name), { recursive: true, force: true }).catch(
        (e: unknown) => {
          console.warn('task_runner: prune_skill_failed', leaseId, {
            skill: entry.name,
            error: e,
          });
        },
      );
    }
  }
}

// ── task-09 tar 工具（手工 ustar）已迁移到 ./spec-sync.ts utility
//（task-05 死代码清理），本文件不再保留手工 ustar 实现。
