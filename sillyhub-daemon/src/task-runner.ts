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
 *   2. claudeMd 非空 → 写 ${workDir}/.claude/CLAUDE.md
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
 * @module task-runner
 */

import { spawn, type ChildProcess } from 'node:child_process';
import * as readline from 'node:readline';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative, isAbsolute, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

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
import { resolveWindowsCmdShim } from './cmd-shim.js';
import {
  createTerminalObserver,
  NOOP_TERMINAL_OBSERVER,
  type TerminalObserver,
} from './terminal-observer.js';
import type { DaemonConfig } from './config.js';
// 2026-06-24-daemon-network-resilience task-11/12：batch submit 重试 + 终态轻量重试。
import type { ResilienceService } from './resilience/service.js';
import type { Envelope } from './resilience/service.js';
import { dedupKeyFor, toCauseInfo } from './resilience/error-classify.js';
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
import { classifyToolKind } from './tool-kind.js';
import type {
  AgentEvent,
  LeaseCtx,
  TaskResult,
} from './types.js';

// ── 常量（对齐 Python task_runner.py）────────────────────────────────────────

/** 累积输出最大字符数（对齐 Python _MAX_OUTPUT = 10000）。 */
const MAX_OUTPUT = 10_000;
/** 错误信息最大字符数（对齐 Python _MAX_ERROR = 5000）。 */
const MAX_ERROR = 5_000;
/** ql-20260706-009：stderr 实时 forward 到 backend 的行数上限（防风暴）。 */
const MAX_STDERR_FORWARD = 50;
/** 超时 kill 优雅升级：SIGTERM 后 2 秒仍存活则 SIGKILL（对齐 Python stream_json.py:115）。 */
const KILL_GRACE_MS = 2_000;

// ── 类型定义 ──────────────────────────────────────────────────────────────────

/**
 * 任务运行时状态（6 种，对齐蓝图 task-19.md §状态机）。
 * 比 BackendTaskResult 多 pending/running/cancelled 三个运行态。
 */
export type TaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout';

/**
 * 子进程 spawn 选项透传（仅 TaskRunner 用到的子集）。
 * 与 node:child_process.SpawnOptions 字段一致，但显式列出避免误传。
 */
interface SpawnOpts {
  cwd: string;
  // env 对齐 Node child_process.SpawnOptions.env 的类型（NodeJS.ProcessEnv，
  // 即 Record<string, string | undefined>）：process.env 的值天然含 undefined，
  // spawn 也接受。用 Record<string,string> 会让 { ...process.env } 合并报错。
  env: NodeJS.ProcessEnv;
}

// ── 依赖契约（构造注入）──────────────────────────────────────────────────────

/**
 * TaskRunner 需要的 HubClient 接口子集（鸭子类型，避免硬耦合 HubClient 类）。
 * 字段对齐 src/hub-client.ts 的方法签名。
 */
export interface RunnerHubClient {
  startLease(leaseId: string, claimToken: string): Promise<unknown>;
  submitMessages(
    leaseId: string,
    claimToken: string,
    agentRunId: string,
    messages: Record<string, unknown>[],
  ): Promise<unknown>;
  leaseHeartbeat?(leaseId: string, claimToken: string): Promise<unknown>;
  /**
   * ql-20260616-006：上报 AgentRun 状态（cancel 时报 killed）。
   * 端点 POST /api/daemon/leases/{leaseId}/sync。
   */
  syncStatus?(
    leaseId: string,
    claimToken: string,
    status: string,
    error?: string,
  ): Promise<unknown>;
  /**
   * task-09 / D-006@v1：拉取 workspace spec bundle（tar 流）。
   * 可选方法 —— server-local / 旧 mock client 未实现时，runLease 自动跳过 spec pull。
   * 实际实现见 HubClient.getSpecBundle。
   */
  getSpecBundle?(wsId: string): Promise<Buffer>;
  /**
   * task-09 / D-006@v1：回传 spec 整树（tar 流）。
   * 可选方法 —— 同上，未实现时跳过 sync push。
   */
  postSpecSync?(
    wsId: string,
    tarBuf: Buffer,
  ): Promise<{ ok: boolean; reparsed: number }>;
  /**
   * task-11 / FR-08 / D-004@v1：回执 change-write 执行结果。
   * 实际实现见 HubClient.completeChangeWrite。可选（mock client 未实现时跳过）。
   */
  completeChangeWrite?(
    changeWriteId: string,
    claimToken: string,
    payload: { ok: boolean; files?: unknown[]; error?: string },
  ): Promise<unknown>;
}

/**
 * TaskRunner 需要的 WorkspaceManager 接口子集。
 * 字段对齐 src/workspace.ts。
 */
export interface RunnerWorkspaceManager {
  prepareWorkspace(
    name: string,
    repoUrl?: string | null,
    branch?: string,
    options?: { rootPath?: string },
  ): Promise<string>;
  collectDiff(workspaceDir: string): Promise<{
    patch: string;
    files_changed: number;
    insertions: number;
    deletions: number;
    stats: string;
  }>;
}

/**
 * TaskRunner 需要的 CredentialManager 接口子集。
 * 字段对齐 src/credential.ts。
 *
 * buildEnv 签名与 CredentialManager.buildEnv 逐字一致（必传 config，
 * Record<string, unknown>），使 CredentialManager 实例可直接注入而无需
 * adapter 包装（G-04 类型安全）。调用点负责兜底 undefined（ctx.toolConfig ?? {}）。
 *
 * task-09：新增 get（读 credentials.json 顶层 token，供 buildSpawnEnv 注入
 * ANTHROPIC_API_KEY / CLAUDE_OAUTH_TOKEN）。CredentialManager 实例天然有 get，
 * 结构兼容 spawn-env.ts 的 SpawnCredentialManager（鸭子类型）。
 */
export interface RunnerCredentialManager {
  get(key: string): string | undefined;
  buildEnv(config: Record<string, unknown>): Record<string, string>;
}

// ── TaskRunner ───────────────────────────────────────────────────────────────

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
  ) {}

  // ── 追踪与取消 ────────────────────────────────────────────────────────────

  /**
   * 当前在跑的任务数。对齐 Python `running_tasks` 集合大小。
   */
  get activeTaskCount(): number {
    return this._controllers.size;
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
   * 2. 写 CLAUDE.md
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

    try {
      // ── init lease 分支（task-07 / D-002/D-009）：mode='init' → 不启 agent ──────────
      // daemon 拉到 init lease（kind=batch + mode='init'，backend task-06 start_init_dispatch
      // 下发）：写 .sillyspec-platform.json（6 字段）到成员 rootPath → pullSpecBundle 拉文档
      // 缓存 → postSpecSync 回灌本地改动 → 提前 return TaskRunnerResult（不 spawn agent）。
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
      // 时触发。server-local（无 workspaceId / specRoot 已有值）→ pullSpecBundle 返回 null。
      // pull 失败（bundle 404 / 网络错）不致命（FR-05「按需」语义）：agent 仍按 workDir
      // 自身的 .sillyspec 执行，对齐 design §5 E-01。
      //
      // task-11（D-010 日常保鲜）：pull 前比对 lease 下发的 latest_spec_version 与本地
      // `.sillyspec-platform.json.spec_version`。一致 → 跳过 pull（specRoot 直接指向本地
      // 缓存目录，agent 读已有内容）；不一致 / 本地无版本记录 → pullSpecBundle 刷新，
      // 成功后 bumpLocalSpecVersion 回写新版本。lease 未透传 latest_spec_version（旧
      // backend / server-local）→ 保持旧行为（pullSpecBundle 内 existingSpecRoot 等既有逻辑）。
      let specRoot: string | null = null;
      try {
        const wsId = (ctx as { workspaceId?: string }).workspaceId;
        const existingSpecRoot = (ctx as { specRoot?: string }).specRoot;
        const leaseSpecVersion =
          (ctx as { latestSpecVersion?: number }).latestSpecVersion ??
          (ctx as { latest_spec_version?: number }).latest_spec_version;
        let skipPullDueToVersion = false;
        if (wsId && !existingSpecRoot && leaseSpecVersion !== undefined) {
          const localVersion = await readLocalSpecVersion(ctx.rootPath);
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
            { existingSpecRoot },
          );
          // pull 成功（specDir 非空）+ lease 带了 latest_spec_version → 回写本地版本保鲜。
          // 仅 daemon-client（wsId 非空）路径有意义；server-local pullSpecBundle 返回 null 跳过。
          if (specRoot && wsId && leaseSpecVersion !== undefined) {
            await bumpLocalSpecVersion(ctx.rootPath, leaseSpecVersion);
          }
        }
      } catch (e) {
        console.warn('task_runner: spec_bundle_pull_failed', leaseId, e);
      }

      // 步骤 2：claudeMd 非空 → 写 .claude/CLAUDE.md
      if (ctx.claudeMd && ctx.claudeMd.length > 0) {
        try {
          const claudeDir = join(workDir, '.claude');
          await mkdir(claudeDir, { recursive: true });
          await writeFile(join(claudeDir, 'CLAUDE.md'), ctx.claudeMd, 'utf-8');
        } catch (e) {
          // 写 CLAUDE.md 失败不致命，仅 warn（对齐 Python 仅 log 不 raise）
          console.warn('task_runner: claude_md_write_failed', e);
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

      const spawnEnv = buildSpawnEnv(ctx, { credential: this.credential });
      const maxRetries = resolveMaxRetries(this.config);

      // task-16（D-003 冻结语义）：allowed_roots 在 spawn 前取一次 PolicyCache 快照，
      // 整个 batch（含 spawn 重试）期间冻结，不随 WS POLICY_UPDATE 热更新变。
      // 新起 batch 才再读 PolicyCache 最新值。
      // 数据源优先级：PolicyCache.get(ctx.runtimeId)?.allowedRoots（per-runtime）
      //   > config.allowed_roots（未注入 policyCache 时的全局兜底，向后兼容）。
      // policyCache 未注入（旧测试）或 rid 未命中（runtime 尚未注册 / 心跳未拉到）
      // 都回退 config.allowed_roots，绝不 throw，保持旧沙箱行为。
      const frozenAllowedRoots =
        this.policyCache?.get(ctx.runtimeId)?.allowedRoots ??
        this.config?.allowed_roots;

      // 重试循环：spawn → stream → 判定（task-10 B3）。
      // 可重试：timeout / spawn ENOENT / OOM / segfault / killed。
      // 不重试：cancelled / businessError（claude is_error）/ completed / 业务非零退出。
      // R-10：重试清空 resumeSessionId（避免 --resume 重复 side-effect）。
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
        // args 每次重试都重新构建（重试时 effectiveCtx.resumeSessionId 已清空，buildArgs 不带 --resume）
        // ql-20260617-008：透传 prompt，ndjson 协议把 prompt 作为 args 末尾位置参数
        // task-16：allowedRoots 用 frozenAllowedRoots（D-003 冻结，不随热更新变）。
        const args = adapter.buildArgs
          ? adapter.buildArgs({
              model: effectiveCtx.model,
              sessionId: effectiveCtx.sessionId,
              resumeSessionId: effectiveCtx.resumeSessionId,
              prompt: ctx.prompt ?? '',
              // task-16：per-runtime allowed_roots（PolicyCache.get 快照，spawn 时冻结）。
              allowedRoots: frozenAllowedRoots,
              toolConfig: ctx.toolConfig as
                | { mode?: string; allowed_tools?: string[]; max_turns?: number }
                | undefined,
            })
          : [];

        result = await this._spawnAndStream({
          cmdPath,
          args,
          opts: { cwd: workDir, env: spawnEnv },
          adapter,
          prompt: ctx.prompt ?? '',
          ctx: effectiveCtx,
          signal: ac.signal,
          outputParts,
          onSessionId: (sid: string) => {
            if (sid) sessionId = sid;
          },
          leaseId,
          claimToken,
        });

        // 判定是否重试
        const shouldRetry = isSpawnLevelFailure(result) && attempt < maxRetries;
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
      const success = result.status === 'completed' && result.exitCode === 0;
      const finalStatus: TaskStatus = success ? 'completed' : result.status;
      const output = this._truncate(outputParts.join(''), MAX_OUTPUT);
      const errorOut = this._truncate(result.error ?? '', MAX_ERROR);

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
    }
  }

  // ── init lease 轻量分支（task-07 / D-002/D-009，不启 agent）──────────────────

  /**
   * 处理 init lease：写 .sillyspec-platform.json + pull 文档 + post 本地改动。
   *
   * 与 ``runLease`` 并列但**严格不启 agent**（与 ``runChangeWrite`` 同范式的轻量分支）：
   *   - 不调 workspace.prepareWorkspace / getBackend / spawn / heartbeat（init 不跑 agent）；
   *   - 完整编排委托 ``spec-sync.handleInitLease``（纯函数 + client 参数注入，D-007@v1）。
   *
   * lease payload 来源（backend task-06 start_init_dispatch 下发，待合并）：
   *   - workspaceId / rootPath：成员 binding 解析（task-01 per-member）；
   *   - platformConfig{server_origin, strategy} + latest_spec_version：SpecWorkspace 字段。
   *   serverOrigin 缺省时回落 config.server_url（与 daemon._serverOrigin 一致，避免 backend
   *   未透传时 platform.json.server_origin 空）。
   *
   * 终态上报（design §9 init_completed / init_failed）：
   *   - 成功 → _finish status='completed'，**stats 携带 init_synced_at + init_synced_spec_version**
   *     供 daemon complete_lease 透传给 backend 更新 WorkspaceMemberRuntime（complete body
   *     stats 字段是 free-form Record，backend 据 stats.init_synced_* 落库）。
   *   - 失败 → status='failed'，error 含失败步骤，stats 仍带 init_synced_spec_version（兜底 0）
   *     让 backend 记录「初始化失败」终态。
   *
   * 容错：handleInitLease 内部已 catch 各步骤（写 platform.json / pull 硬失败 abort，post
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
    // 字段名兼容 camelCase / snake_case）。serverOrigin 缺省回落 config.server_url。
    const platformConfigRaw =
      (ctx as { platformConfig?: Record<string, unknown> }).platformConfig ??
      (ctx as { platform_config?: Record<string, unknown> }).platform_config ??
      {};
    const serverOrigin =
      pickStr(platformConfigRaw, 'server_origin', 'serverOrigin') ||
      this.config?.server_url ||
      '';
    const strategy =
      pickStr(platformConfigRaw, 'strategy') || ctx.specStrategy || 'platform-managed';
    const latestSpecVersion =
      pickNum(platformConfigRaw, 'latest_spec_version', 'latestSpecVersion') ??
      (ctx as { latestSpecVersion?: number }).latestSpecVersion ??
      (ctx as { latest_spec_version?: number }).latest_spec_version;

    const initParams: HandleInitLeaseParams = {
      workspaceId,
      rootPath,
      serverOrigin,
      strategy,
      latestSpecVersion,
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
    if (result.platformConfig) {
      stats.init_platform_config = result.platformConfig;
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
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, intervalMs);
        const onAbort = () => {
          clearTimeout(t);
          resolve();
        };
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
   */
  private async _spawnAndStream(params: {
    cmdPath: string;
    args: string[];
    opts: SpawnOpts;
    adapter: ProtocolAdapter;
    prompt: string;
    ctx: LeaseCtx;
    signal: AbortSignal;
    outputParts: string[];
    onSessionId: (sid: string) => void;
    leaseId: string;
    claimToken: string;
  }): Promise<SpawnAttemptResult> {
    const {
      cmdPath, args, opts, adapter, prompt, ctx, signal,
      outputParts, onSessionId, leaseId, claimToken,
    } = params;

    // ql-20260616-003：创建终端观察日志（写文件 + 可选弹独立终端）。
    // 关键设计：observer 创建是异步的（mkdir + writeFile），但**绝不**在 spawn 之前
    // 阻塞 —— 否则会让旧测试的「spawn 后单 setImmediate 等 listener 注册」断言失效
    // （实际生产无影响，仅是测试时序脆弱性）。改为 fire-and-forget：
    //   1. spawn 同步发生（spawn 必须先返回才能注册 listener）
    //   2. observer promise 在后台创建，就绪后用 .then 替换 NOOP
    //   3. 中间几条早期 stdout/stderr 可能丢（observer 仍是 NOOP 时 writeRaw 是 no-op）
    //      —— 这是可接受的权衡：观察日志是辅助功能，绝不能改变 spawn 时序
    let observer: TerminalObserver = NOOP_TERMINAL_OBSERVER;
    createTerminalObserver({
      leaseId,
      cwd: opts.cwd,
      cmdPath,
      args,
      config: this.config,
    })
      .then((obs) => {
        observer = obs;
      })
      .catch((e) => {
        console.warn('task_runner: observer_create_failed', e);
      });

    // 本地终端 echo + observer：开始边界，让用户看到 spawn 命令
    // observer 此时可能还是 NOOP（promise 未 resolve）—— start 行可能错过 observer 日志，
    // 但 echo 一定写到 stdout（用户本地能看到）。
    const startLine = renderTaskBoundary(leaseId, 'start', { cmdPath, args });
    observer.writeParsed(startLine);
    echoTaskBoundary(leaseId, 'start', { cmdPath, args });

    // 封装结束路径：echo + observer + return 一次性完成，避免漏写 close。
    // 任务终态时 observer promise 通常已 resolve（spawn + readline + exit 流程比 mkdir 长）。
    const finishAttempt = (result: SpawnAttemptResult): SpawnAttemptResult => {
      const endLine = renderTaskBoundary(leaseId, 'end', {
        status: result.status,
        exitCode: result.exitCode,
        error: result.error,
      });
      observer.writeParsed(endLine);
      observer.close(endLine);
      echoTaskBoundary(leaseId, 'end', {
        status: result.status,
        exitCode: result.exitCode,
        error: result.error,
      });
      return result;
    };

    // spawn（stdio 全管道：stdin / stdout / stderr 都需要）
    // ql-20260616-001：Windows .cmd/.bat/.ps1 npm wrapper 之前依赖 shell:true，
    // 但实测在不同 shell 父进程下不稳定（git-bash → ENOENT，PowerShell → 可能吞 stdout）。
    // ql-20260618-007：改用 resolveWindowsCmdShim 解析 .cmd 提取真实命令（node + codex.js
    // 或 claude.exe），用 spawn(exe, [target, ...args]) 直接调，绕过 cmd.exe 包装层。
    // 解析失败时回退 shell:true（兼容旧 .ps1 / 自定义 wrapper）。
    const isWindowsWrapper =
      process.platform === 'win32' &&
      /\.(cmd|bat|ps1)$/i.test(cmdPath);
    const isWindowsBareSh =
      process.platform === 'win32' &&
      !/\.[a-z0-9]+$/i.test(cmdPath);

    let spawnCmdPath = cmdPath;
    let spawnArgs = args;
    let useShell = false;
    if (process.platform === 'win32' && /\.cmd$/i.test(cmdPath)) {
      const resolved = resolveWindowsCmdShim(cmdPath);
      if (resolved) {
        spawnCmdPath = resolved.exe;
        spawnArgs = [...resolved.prependArgs, ...args];
      } else {
        // .cmd 解析失败，回退 shell:true（极少见，保留兜底）
        useShell = true;
      }
    } else if (isWindowsWrapper || isWindowsBareSh) {
      // .bat / .ps1 / 无扩展名 sh wrapper 仍走 shell（cmd-shim 解析仅覆盖 .cmd）
      useShell = true;
    }

    const child = spawn(spawnCmdPath, spawnArgs, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(useShell ? { shell: true } : {}),
    }) as ChildProcess;

    let exitCode = 0;
    let exitSignal: string | null = null;
    let exited = false;
    // 用对象容器存 spawn 错误：TS 控制流分析对「在异步闭包内赋值的 let 变量」
    // 会保守假定其类型恒为初始值（即 null），导致后续读取被收窄到 never。
    // 对象属性（可变）不受此 narrowing 影响，TS 对属性读取保守保留联合类型。
    const spawnErrorRef: { current: Error | null } = { current: null };
    let timedOut = false;
    let cancelled = false;
    let stderrBuf = '';
    // ql-20260706-009：已 forward 到 backend 的 stderr 行数（防风暴）。
    let stderrForwarded = 0;
    // task-06：收集 complete 事件 metadata.stats（claude result 消息的 usage/cost）。
    // complete 事件通常仅一个，覆盖式赋值；失败路径保持 undefined。
    let lastStats: Record<string, unknown> | undefined;

    // stderr 累积（用于失败诊断）+ observer raw 写入 + ql-20260706-009 实时 forward
    child.stderr?.on('data', (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      stderrBuf += text;
      // ql-20260616-003：把 stderr 实时投给 observer（mode=raw/both 时落日志）
      // 按行切分写入，避免大块 chunk 一次性塞进去难读
      const lines = text.split(/\r?\n/);
      for (const ln of lines) {
        if (ln.length === 0) continue;
        observer.writeRawStderr(ln);
        // ql-20260706-009：stderr 关键行实时 forward 到 backend agent_run_logs
        // （channel='stderr'），让前端"错误警告"筛可见——修 claude 529/API Error
        // 等只吐 stderr 不进 stdout stream-json 致前端只看 init 没下文的可见性 bug。
        // fire-and-forget（同 stdout submitMessages 策略）；MAX_STDERR_FORWARD 防风暴。
        if (claimToken && ctx.agentRunId && stderrForwarded < MAX_STDERR_FORWARD) {
          stderrForwarded += 1;
          void this.client
            .submitMessages(leaseId, claimToken, ctx.agentRunId, [
              { event_type: 'stderr', content: ln.slice(0, 5000), channel: 'stderr' },
            ])
            .catch((e) => {
              console.warn('task_runner: stderr_forward_failed', leaseId, e);
            });
        }
      }
      // stderr 也算 error 文本上限保护（避免无限累积）
      if (stderrBuf.length > MAX_ERROR * 4) {
        stderrBuf = stderrBuf.slice(0, MAX_ERROR * 4);
      }
    });

    // 'error' 事件：spawn ENOENT 等（B-19-05）
    child.once('error', (err: Error) => {
      spawnErrorRef.current = err;
      if (!exited) {
        exited = true;
        exitCode = 127;
      }
    });

    // 'exit' 事件
    child.once('exit', (code: number | null, sig: string | null) => {
      exitCode = code ?? (sig ? -1 : 0);
      exitSignal = sig;
      exited = true;
    });

    // ql-20260616-003：observer 创建是 fire-and-forget，但需要让一个 microtask
    // 跑完让 promise 链启动（否则 observer promise 在本函数返回前都不会 resolve）。
    // 这里的 await 是为了 .then 回调有机会被调度（实际不阻塞 spawn —— spawn 已同步执行）。
    await Promise.resolve();

    // 步骤 6b：写 prompt 到 stdin（不立即 end）
    // ql-20260617-008：JSON-RPC 协议（adapter 实现 buildHandshake）的 prompt 走
    // turn/start 的 instructions 字段（步骤 6c 握手 + _handleLine 触发的 buildTurnStart），
    // 这里跳过 buildInput，避免 codex stdin 收到非法 JSON 文本导致 -32600。
    if (!adapter.buildHandshake) {
      try {
        const inputData = adapter.buildInput
          ? adapter.buildInput(prompt)
          : `${prompt}\n`;
        const buf = typeof inputData === 'string' ? Buffer.from(inputData, 'utf-8') : inputData;
        if (buf.length > 0 && child.stdin && !child.stdin.destroyed) {
          await new Promise<void>((resolve) => {
            let done = false;
            const finish = (): void => { if (!done) { done = true; resolve(); } };
            const ok = child.stdin!.write(buf, (err?: Error | null) => {
              if (err) console.warn('task_runner: stdin_write_failed', err);
              finish();
            });
            if (!ok) {
              child.stdin!.once('drain', finish);
            } else {
              // ok=true 时 callback 已同步触发或将在 flush 后触发；为保证不悬挂，
              // 用 setImmediate 兜底 resolve（write 返回 true 表示已接受，无需等 drain）。
              setImmediate(finish);
            }
          });
        }
      } catch (e) {
        console.warn('task_runner: stdin_write_exception', e);
      }
    }

    // 步骤 6c：json_rpc 协议握手序列（ql-20260617-008）
    // codex app-server 是被动 server，必须主动发 initialize/initialized/thread.start
    // 才会开始处理。turn/start 在 TaskRunner._handleLine 检测到 thread/start response
    //（id=2）后用真实 threadId 触发（adapter.buildTurnStart）。
    if (adapter.buildHandshake && child.stdin && !child.stdin.destroyed) {
      try {
        const handshake = adapter.buildHandshake({
          cwd: opts.cwd,
          prompt,
          model: ctx.model,
        });
        for (const line of handshake) {
          await new Promise<void>((resolve) => {
            let done = false;
            const finish = (): void => { if (!done) { done = true; resolve(); } };
            const ok = child.stdin!.write(line + '\n', (err?: Error | null) => {
              if (err) console.warn('task_runner: handshake_write_failed', err);
              finish();
            });
            if (!ok) {
              child.stdin!.once('drain', finish);
            } else {
              setImmediate(finish);
            }
          });
          // ql-20260618-002：每条 handshake 之间加 300ms，让 codex.cmd 包装层稳定启动 + codex
          // 主进程处理完上一条再发下一条。实测 100ms 间隔会导致 thread/start 后 codex.cmd
          // exit 0（cmd.exe 包装层把 stdin 数据弄丢），300ms 是 probe 测试通过的稳定值。
          await new Promise<void>((r) => setTimeout(r, 300));
        }
      } catch (e) {
        console.warn('task_runner: handshake_write_exception', e);
      }
    }

    // 超时看门狗（task-10 B2：resolveTimeout 优先级链
    // ctx.timeoutSeconds > ctx.timeout > config.default_timeout_seconds > 1800；
    // 返回 0 = 不限，不启动看门狗）
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    let killTimer: ReturnType<typeof setTimeout> | null = null;
    const timeoutSec = resolveTimeout(ctx, this.config);
    if (timeoutSec > 0) {
      watchdog = setTimeout(() => {
        timedOut = true;
        this._killChild(child);
        // SIGTERM 后 2s 仍存活 → SIGKILL（优雅升级）
        killTimer = setTimeout(() => {
          this._killChild(child, 'SIGKILL');
        }, KILL_GRACE_MS);
      }, timeoutSec * 1000);
    }

    // 取消监听（AbortSignal）
    const onAbort = (): void => {
      if (signal.aborted && !exited) {
        cancelled = true;
        this._killChild(child);
        killTimer = setTimeout(() => {
          this._killChild(child, 'SIGKILL');
        }, KILL_GRACE_MS);
      }
    };
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    // 步骤 7：readline 逐行读 stdout，parse + submitMessages + control_request
    try {
      if (child.stdout) {
        const rl = readline.createInterface({
          input: child.stdout,
          crlfDelay: Infinity,
        });
        // 子进程退出（或已被 kill）→ 主动关闭 readline，让 for-await 跳出。
        // 否则在 FakeChild / 某些真实 agent 不主动 close stdout 时会无限等待。
        const exitCloser = (): void => {
          try { rl.close(); } catch { /* 已关闭 */ }
        };
        child.once('exit', exitCloser);
        // for await...of 天然具备背压（R-04）。
        // 退出条件：readline 自然结束（stdout push(null)）或 exitCloser 触发 rl.close()。
        // 不用 exited 标志 break —— exit listener 同步触发时 exited=true 但 rl 还能正常
        // 吐完缓冲行（实现单测同步 emit 场景下，行已在 stdout 缓冲）。
        for await (const line of rl) {
          if (cancelled || timedOut) {
            break;
          }
          // ql-20260616-003：原始 stdout 行投给 observer（mode=raw/both 时落日志）
          observer.writeRawStdout(line);
          await this._handleLine(line, adapter, child, {
            outputParts,
            onSessionId,
            leaseId,
            claimToken,
            agentRunId: ctx.agentRunId ?? '',
            // task-17：approval 决策需 runtimeId 隔离 PolicyEngine.canWrite（D-002）。
            runtimeId: ctx.runtimeId,
            observer,
            onStats: (stats: Record<string, unknown>) => {
              lastStats = stats;
            },
            prompt,
            model: ctx.model,
          });
        }
        child.off('exit', exitCloser);
        rl.close();
      }
    } catch (e) {
      // parse / control 异常已在 _handleLine 内 try/catch；此处兜底
      console.warn('task_runner: stdout_consume_error', e);
    }

    // 等子进程 exit（spawn 'error' 已设 exited=true；正常情况 exit 已触发）
    // Node 的 exit 事件可能在 stdout close 之前或之后，用 once 兜底等它。
    if (!exited) {
      await new Promise<void>((resolve) => {
        const done = (): void => {
          child.off('exit', done);
          child.off('error', done);
          resolve();
        };
        child.once('exit', done);
        child.once('error', done);
      });
    }

    // 清理定时器
    if (watchdog) clearTimeout(watchdog);
    if (killTimer) clearTimeout(killTimer);
    signal.removeEventListener('abort', onAbort);

    // 关闭 stdin（result 已收到或子进程退出）
    try {
      if (child.stdin && !child.stdin.destroyed) {
        child.stdin.end();
      }
    } catch {
      /* stdin 已关闭 */
    }

    // 计算最终状态
    if (cancelled) {
      return finishAttempt({ status: 'cancelled', exitCode: exitCode || 1, error: 'task cancelled', stats: mergeAdapterUsage(adapter, lastStats) });
    }
    if (timedOut) {
      return finishAttempt({ status: 'timeout', exitCode: exitCode || 1, error: `task timed out after ${timeoutSec}s`, stats: mergeAdapterUsage(adapter, lastStats) });
    }
    // spawnErrorRef.current：spawn 错误（'error' 事件异步赋值）。用对象容器
    // 避免 TS 对闭包内赋值的 let 变量做错误 narrowing（详见声明处注释）。
    if (spawnErrorRef.current) {
      return finishAttempt({ status: 'failed', exitCode: exitCode || 127, error: spawnErrorRef.current.message, stats: mergeAdapterUsage(adapter, lastStats) });
    }
    if (exitCode !== 0) {
      const errDetail = stderrBuf.trim();
      // task-10 B3：判定是否业务错误（claude result is_error=true）。
      // 鸭子类型调用 adapter.getLastResultInfo()（claude adapter 解析 result 消息时记录）。
      // businessError=true → isSpawnLevelFailure 返回 false，不重试（R-10 side-effect 优先）。
      const lastInfo = (adapter as {
        getLastResultInfo?: () => { isError?: boolean } | undefined;
      }).getLastResultInfo?.();
      const businessError = lastInfo?.isError === true;
      const errMsg = errDetail
        ? `agent process exited with exit code ${exitCode}: ${errDetail}`
        : `agent process exited with exit code ${exitCode}`;
      return finishAttempt({
        status: 'failed',
        exitCode: 1, // 统一映射非零退出为 1（对齐 Python 把非零 exit 视为 failed）
        error: errMsg,
        stats: mergeAdapterUsage(adapter, lastStats),
        businessError,
      });
    }
    return finishAttempt({ status: 'completed', exitCode: 0, stats: mergeAdapterUsage(adapter, lastStats) });
  }

  /**
   * 处理 stdout 一行：parse → submitMessages + control_request 应答 + result 检测。
   *
   * 对齐 Python `_consume_stdout` 主循环 + `_handle_control_request`。
   * 内部全部 try/catch，避免单行异常中断整体（B-19-04）。
   */
  private async _handleLine(
    line: string,
    adapter: ProtocolAdapter,
    child: ChildProcess,
    env: {
      outputParts: string[];
      onSessionId: (sid: string) => void;
      leaseId: string;
      claimToken: string;
      agentRunId: string;
      /** task-17：approval 决策按 runtime_id 隔离 PolicyEngine.canWrite（D-002）。 */
      runtimeId: string;
      observer: TerminalObserver;
      onStats?: (stats: Record<string, unknown>) => void;
      prompt?: string;
      model?: string;
    },
  ): Promise<void> {
    // R-03：control_request 行优先交给 adapter.onControl 应答
    if (adapter.onControl && _looksLikeControlRequest(line)) {
      try {
        await adapter.onControl(line, child.stdin as NodeJS.WritableStream);
      } catch (e) {
        console.warn('task_runner: control_response_failed', e);
      }
      // control_request 行本身不产 submitMessages 事件，但仍允许 parse（多数 adapter 对该行返回 null）
    }

    // ql-20260617-008：json_rpc thread/start response 监听
    // codex app-server 收到 thread/start（id=2）后回复含 result.thread.id 的 response。
    // TaskRunner 检测到此 response 后，用真实 threadId 调 adapter.buildTurnStart 构造
    // turn/start request 写 stdin，codex 才会开始处理用户 prompt。
    if (adapter.buildTurnStart && child.stdin && !child.stdin.destroyed) {
      try {
        const trimmed = line.trim();
        if (trimmed.startsWith('{')) {
          const msg = JSON.parse(trimmed) as {
            id?: unknown;
            result?: { thread?: { id?: unknown } };
          };
          if (msg.id === 2 && msg.result?.thread?.id) {
            const threadId = String(msg.result.thread.id);
            const turnStartLine = adapter.buildTurnStart({
              threadId,
              prompt: env.prompt ?? '',
              model: env.model,
            });
            await new Promise<void>((resolve) => {
              let done = false;
              const finish = (): void => { if (!done) { done = true; resolve(); } };
              const ok = child.stdin!.write(turnStartLine + '\n', (err?: Error | null) => {
                if (err) console.warn('task_runner: turn_start_write_failed', err);
                finish();
              });
              if (!ok) {
                child.stdin!.once('drain', finish);
              } else {
                setImmediate(finish);
              }
            });
          }
        }
      } catch (e) {
        // 非 JSON 行忽略（codex 推送的 notification 也走此路径，正常）
        if (!(e instanceof SyntaxError)) {
          console.warn('task_runner: turn_start_trigger_exception', e);
        }
      }
    }

    // result / system 行：尝试提取 session_id（B-19-09：仅在显式标记 result 时关闭 stdin）
    if (_looksLikeResult(line)) {
      const sid = _extractSessionId(line);
      if (sid) env.onSessionId(sid);
      // result 行收到 → 安全关闭 stdin（避免子进程继续等待输入，R-03 关键点）
      try {
        if (child.stdin && !child.stdin.destroyed) {
          child.stdin.end();
        }
      } catch {
        /* 已关闭 */
      }
    }

    // ql-20260618-003：codex/json-rpc 的 turn/completed → 安全关闭 stdin。
    // codex 是被动 server，单 turn 完成后不主动退出；daemon 检测到 turn/completed
    // notification 即关闭 stdin，让 codex 优雅退出，readline 收尾，task 完成。
    // 与 claude 的 _looksLikeResult 等价的"单次 lease 收尾点"。
    if (_looksLikeTurnCompleted(line)) {
      try {
        if (child.stdin && !child.stdin.destroyed) {
          child.stdin.end();
        }
      } catch {
        /* 已关闭 */
      }
    }

    // parse
    let events: AgentEvent[] | null = null;
    try {
      events = adapter.parse(line);
    } catch (e) {
      // 单行 parse 异常不中断整体（B-19-04）
      console.warn('task_runner: parse_error', line.slice(0, 100), e);
      return;
    }
    if (!events || events.length === 0) {
      return;
    }

    // task-17 / R-06：Codex batch 带内审批决策。
    // 扫描本轮 events 是否含 approval tool_use（json-rpc adapter parseServerRequest 产出）。
    // 命中则对每个写路径调 policyEngine.canWrite 决策，写 accept/decline response 到 stdin。
    // 必须在 _eventToMessages 之前处理：approval 是 server request 需 daemon 应答，
    // 不应答会卡死 turn（codex 等 response 才继续）。仅 json-rpc adapter 的 batch 路径生效，
    // stream-json / ndjson 无 server request 概念（无 PendingServerRequest）。
    const approvalEv = events.find(
      (e) => e.type === 'tool_use' && e.metadata?.kind === 'approval',
    );
    if (approvalEv) {
      await this._handleApprovalDecision(adapter, child, env, approvalEv);
    }

    // 累积 output + 提交 submitMessages
    const messages: Record<string, unknown>[] = [];
    for (const ev of events) {
      // 本地终端 echo + 观察日志：用同一份 render 渲染保证字节一致。
      // echo 写 daemon 本地 stdout；observer.writeParsed 按配置 mode 决定是否落日志。
      const rendered = renderAgentEvent(env.leaseId, ev);
      env.observer.writeParsed(rendered);
      try {
        process.stdout.write(rendered + '\n');
      } catch {
        // stdout 关闭：忽略
      }
      // 提取 sessionId（complete / status 事件可能在 metadata.session_id 带）
      const sid = ev.metadata?.session_id;
      if (typeof sid === 'string' && sid) {
        env.onSessionId(sid);
      }
      // task-06：complete 事件收集 metadata.stats（cost/tokens/turns）
      if (ev.type === 'complete' && ev.metadata?.stats && env.onStats) {
        const stats = ev.metadata.stats;
        if (stats && typeof stats === 'object' && !Array.isArray(stats)) {
          env.onStats(stats as Record<string, unknown>);
        }
      }
      // output 累积：仅 text / error 事件进 output 缓冲
      if (ev.type === 'text' || ev.type === 'error') {
        if (ev.content) {
          env.outputParts.push(ev.content);
        }
      }
      // 转 submitMessages 负载
      const msgs = this._eventToMessages(ev);
      if (msgs && msgs.length > 0) {
        messages.push(...msgs);
      }
    }

    if (messages.length === 0) {
      return;
    }

    // submitMessages：fire-and-forget，不阻塞 stdout readline（每条 await HTTP
    // 会让 cursor/codex 执行慢一个数量级；失败仅 warn，对齐容错策略）。
    // ql-004：空 agentRunId 不发 submitMessages，防空 agent_run_id 422 风暴。
    // task-11（FR-10 / D-005@v1）：注入 resilience 时走 submitWithRetry（带退避重试 +
    // dedup_key），保持非阻塞（void + catch）；未注入回退原 client.submitMessages。
    if (env.claimToken && env.agentRunId) {
      if (this.resilience) {
        const envelopes: Envelope[] = messages.map((m, idx) => ({
          message: m,
          dedup_key: dedupKeyFor(m, env.agentRunId, 0, idx),
        }));
        void this.resilience
          .submitWithRetry(env.leaseId, env.claimToken, env.agentRunId, envelopes)
          .catch((e) => {
            console.warn(
              'task_runner: event_forward_failed',
              env.leaseId,
              toCauseInfo(e),
            );
          });
      } else {
        void this.client
          .submitMessages(env.leaseId, env.claimToken, env.agentRunId, messages)
          .catch((e) => {
            console.warn('task_runner: event_forward_failed', env.leaseId, e);
          });
      }
    }
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
   * ql-20260616-005：1:1 复现老 SERVER 路径 _format_conversation_log 渲染规则
   * （commit be5448b 删除前 backend/app/modules/agent/adapters/claude_code.py:306-388），
   * 让前端 normalize.ts / agent-log-viewer.tsx 不动就能解析 [ASSISTANT]/[TOOL_USE]/
   * [TOOL_RESULT]/[SYSTEM:xxx]/[RESULT:success] 前缀，tool_use 同时产 stdout 文本
   * 行 + tool_call JSON 两类 message，前端 ToolCallCard 渲染照常工作。
   *
   * 1 个 event → 0/1/2 条 message：
   *   - text + status=running → 1 条 [SYSTEM:init] session started (stdout)
   *   - text + thinking       → 1 条 [THINKING] <preview 2000> (stdout)
   *   - text + 其他            → 1 条 [ASSISTANT] <content> (stdout)
   *   - tool_use              → 2 条：[TOOL_USE] Name: cmd (stdout) + JSON (tool_call)
   *   - tool_result           → 1 条 [TOOL_RESULT] <preview 3000> (stdout)
   *   - error                 → 1 条 [LEVEL] <content> (stderr)
   *   - complete              → 1 条 [RESULT:success] <text> duration=Xms turns=N (stdout)
   *
   * 业务字段（session_id/call_id/usage）注入到首条 message，backend submit_messages
   * 透传到 AgentRunLog.metadata / AgentRun.input_tokens（usage 实时回写，见 ql-004）。
   *
   * 返回 null：未知 event type 或所有 message 都被过滤。
   */
  private _eventToMessages(ev: AgentEvent): Record<string, unknown>[] | null {
    const md = ev.metadata ?? {};
    const rawContent = ev.content ?? '';
    const messages: Record<string, unknown>[] = [];

    switch (ev.type) {
      case 'text': {
        const status = typeof md.status === 'string' ? md.status : '';
        const thinking = md.thinking === true;
        const isLog = md.log === true;
        const isStreaming = md.streaming === true;
        // ql-20260618-005：codex item/agentMessage/delta 流式 token —— 不加 [ASSISTANT]
        // 前缀，直接发原始 delta 文本。前端 chat 面板会逐字 append 拼"打字效果"。
        // 若加 [ASSISTANT] 前缀，每个 delta 都带前缀 → "[ASSISTANT] 我[ASSISTANT]  Cod"。
        // Agent 控制台日志会按原样展示每条 delta（无前缀），可读性也 OK（每条 = 一次推送）。
        if (isStreaming && rawContent) {
          messages.push({
            event_type: ev.type,
            content: rawContent,
            channel: 'stdout',
          });
          break;
        }
        // ql-20260617-006：stream_event/message_delta 产的 status='usage_update' 事件
        // content 为空但 metadata.usage 有真实累加值。透传给 backend submit_messages
        // 实时更新 AgentRun.input_tokens/output_tokens（不写日志，仅 usage 回写）。
        if (status === 'usage_update') {
          messages.push({
            event_type: ev.type,
            content: '',
            channel: 'stdout',
          });
          break;
        }
        // ql-20260617-008：parseSystem 把 init / status / api_retry 等所有 subtype 都
        // 产成 status='system' + content='session=xxx cwd=xxx ...'，渲染成
        // `[SYSTEM:<subtype>] <content>` 一行。日志完整性优先，不再丢弃任何 subtype。
        if (status === 'system') {
          const subtype = typeof md.subtype === 'string' && md.subtype ? md.subtype : 'unknown';
          messages.push({
            event_type: ev.type,
            content: `[SYSTEM:${subtype}] ${rawContent}`.slice(0, 2000),
            channel: 'stdout',
          });
          break;
        }
        // ql-20260617-008：parseLog 产 metadata.log=true + level + content=message。
        // 渲染成 `[LOG:<level>] <message>`，stderr 级别（warn/error）走 stderr channel。
        if (isLog) {
          const level = typeof md.level === 'string' && md.level ? md.level : 'info';
          const isErrLevel = level === 'error' || level === 'warn';
          messages.push({
            event_type: ev.type,
            content: `[LOG:${level}] ${rawContent}`.slice(0, 5000),
            channel: isErrLevel ? 'stderr' : 'stdout',
          });
          break;
        }
        // ql-20260616-005：空 content + 非 system/thinking 分支 → 丢弃（对齐老
        // _eventToMessage L744 「空 content + 无 metadata 业务字段 → 返回 null」语义）
        if (!rawContent && !thinking) {
          return null;
        }
        let line: string;
        if (thinking) {
          const preview =
            rawContent.length > 2000
              ? rawContent.slice(0, 2000) + '...'
              : rawContent;
          line = `[THINKING] ${preview}`;
        } else {
          line = `[ASSISTANT] ${rawContent}`;
        }
        messages.push({
          event_type: ev.type,
          content: line,
          channel: 'stdout',
        });
        break;
      }
      case 'tool_use': {
        const name =
          typeof md.tool_name === 'string' && md.tool_name
            ? md.tool_name
            : 'unknown';
        // task-17 / R-06：审批 decline 事件 → stdout 直接写中文理由（不渲染 [TOOL_USE]
        // 模板，让前端 / 日志一眼可见拒绝原因 + 越界路径）。accept 时 metadata 无 reason，
        // 走下面的标准 tool_use 渲染（[TOOL_USE] Name: ...）。
        if (md.approval_decision === 'decline') {
          const reason =
            typeof md.deny_reason === 'string' && md.deny_reason
              ? md.deny_reason
              : '审批拒绝（未知原因）';
          messages.push({
            event_type: ev.type,
            content: `[APPROVAL:DECLINE] ${name}\n${reason}`.slice(0, 5000),
            channel: 'stderr',
          });
          break;
        }
        const inputObj =
          md.tool_input &&
          typeof md.tool_input === 'object' &&
          !Array.isArray(md.tool_input)
            ? (md.tool_input as Record<string, unknown>)
            : {};
        // task-13 / D-002@v1：提取 tool_use_id（SDK tool_use block 的 id，toolu_xxx）。
        // stream-json.ts:645-654 把 block.id 存到 metadata.call_id（命名待后续修正），
        // 这里兼容三种字段名：
        //   1. md.tool_use_id（未来 adapter 命名修正后的标准字段）
        //   2. md.id（直接透传 SDK content_block.id）
        //   3. md.call_id（当前 stream-json.ts 实际存储位置，旧字段名）
        // 任一非空字符串即采用；全空 → ''（退化，前端 normalize 回退 ±3 窗口）。
        // 注：只把 id 注入 tool_call JSON（submit_messages 仅存 content/channel/usage，
        // 不保留 metadata 字段，故 stdout 不带 metadata，避免无效写入）。
        const toolUseId =
          (typeof md.tool_use_id === 'string' && md.tool_use_id) ||
          (typeof md.id === 'string' && md.id) ||
          (typeof md.call_id === 'string' && md.call_id) ||
          '';
        // stdout 文本行：[TOOL_USE] Name: <command> 或 [TOOL_USE] Name: {json}
        // 对齐老 _format_conversation_log L333-337
        const cmd = typeof inputObj.command === 'string' ? inputObj.command : '';
        let argsLine: string;
        if (cmd) {
          argsLine = cmd;
        } else {
          try {
            argsLine = JSON.stringify(inputObj);
          } catch {
            argsLine = '';
          }
        }
        const stdoutContent = `[TOOL_USE] ${name}: ${argsLine}`.slice(0, 2000);
        messages.push({
          event_type: ev.type,
          content: stdoutContent,
          channel: 'stdout',
        });
        // task-06 / FR-03：推导工具种类。stdout 文本行（上方 SemanticCategory=log）
        // 不带 tool_kind（C-02：log 不参与工具筛选维度）；仅 tool_call JSON 行带。
        // toolName 缺失或为 unknown 时 classifyToolKind 返回 null，条件展开省略字段
        // （C-01：tool_kind 与 event_type/content/channel 同级顶层，非 metadata）。
        const toolKind = classifyToolKind(
          typeof md.tool_name === 'string' && md.tool_name ? md.tool_name : null,
          inputObj,
        );
        // 额外发一条 tool_call channel 的 JSON，前端 parseToolCallContent 解析为
        // ToolCallCard。对齐老 _emit_stdout L749-757 的 tc_content 格式。
        // task-13：补 tool_use_id 字段（snake_case，对齐 Anthropic API 命名 + 与
        // backend run_sync/service.py 一致），让前端 normalize 全局配对（task-14）。
        const ts = new Date().toISOString();
        let tcContent: string;
        try {
          tcContent = JSON.stringify({
            tool: name,
            // tool_use_id 仅非空时携带（省略 vs null 均可让前端 hasOwnProperty
            // 判断"无 id"分支）。这里用条件展开省略字段，退化路径保持原形状。
            ...(toolUseId ? { tool_use_id: toolUseId } : {}),
            args: inputObj,
            timestamp: ts,
            status: 'allowed',
            success: true,
          });
        } catch {
          tcContent = JSON.stringify({
            tool: name,
            ...(toolUseId ? { tool_use_id: toolUseId } : {}),
            args: {},
            timestamp: ts,
            status: 'allowed',
            success: true,
          });
        }
        messages.push({
          event_type: ev.type,
          content: tcContent,
          channel: 'tool_call',
          ...(toolKind ? { tool_kind: toolKind } : {}),
        });
        break;
      }
      case 'tool_result': {
        const preview =
          rawContent.length > 3000 ? rawContent.slice(0, 3000) : rawContent;
        messages.push({
          event_type: ev.type,
          content: `[TOOL_RESULT] ${preview}`,
          channel: 'stdout',
        });
        break;
      }
      case 'error': {
        const level =
          typeof md.level === 'string' && md.level ? md.level : 'error';
        messages.push({
          event_type: ev.type,
          content: `[${level.toUpperCase()}] ${rawContent}`.slice(0, 5000),
          channel: 'stderr',
        });
        break;
      }
      case 'complete': {
        const stats =
          md.stats &&
          typeof md.stats === 'object' &&
          !Array.isArray(md.stats)
            ? (md.stats as Record<string, unknown>)
            : {};
        const durationMs =
          typeof stats.total_duration_ms === 'number'
            ? stats.total_duration_ms
            : null;
        const numTurns =
          typeof stats.num_turns === 'number' ? stats.num_turns : null;
        let line = '[RESULT:success]';
        const body = rawContent.trim();
        if (body) {
          line += ` ${body.slice(0, 50000)}`; // ql-20260626-001 放宽（原 3000 截断完整 result 总结）
        }
        if (durationMs !== null) line += ` duration=${durationMs}ms`;
        if (numTurns !== null) line += ` turns=${numTurns}`;
        messages.push({
          event_type: ev.type,
          content: line,
          channel: 'stdout',
        });
        break;
      }
      default: {
        // 未知 event type：丢弃，避免污染日志
        return null;
      }
    }

    if (messages.length === 0) return null;

    // 业务字段透传到首条 message（backend submit_messages 用于 usage 实时回写、
    // session_id 索引等）。call_id 仅 tool_use 类型有意义，写第一条即可。
    const first = messages[0]!;
    if (typeof md.session_id === 'string' && md.session_id) {
      first.session_id = md.session_id;
    }
    if (typeof md.call_id === 'string' && md.call_id) {
      first.call_id = md.call_id;
    }
    if (
      md.usage &&
      typeof md.usage === 'object' &&
      !Array.isArray(md.usage)
    ) {
      first.usage = { ...(md.usage as Record<string, unknown>) };
    }
    return messages;
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
        child.kill(signal);
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
      const specDir = resolveSpecDir(workspaceId);
      let pushOk = false;
      try {
        const resp = await postSpecSync(
          this.client as unknown as Parameters<typeof postSpecSync>[0],
          workspaceId,
          specDir,
        );
        pushOk = resp !== null;
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

/**
 * task-11：change-write 待写入的单个文件（design §7.5 ``files[]{path, content}``）。
 *
 * ``path`` 通常相对于 spec_root（``changes/<changeKey>/...``，由 backend
 * proxy 下发）；兼容相对于 ``changes/<changeKey>/`` 的短路径。两种形态都会归一
 * 到 change 目录内相对路径，traversal 由 ``validateChangeWritePath`` 拦截。
 */
export interface ChangeWriteFile {
  path: string;
  content: string;
}

/**
 * task-11：runChangeWrite 执行上下文。
 *
 * 字段来源：task-09 ``ChangeWriteClaimResponse``（claim 后拿到 claim_token + files）
 * 透传 runtimeId（仅日志/上下文用，不进 complete body）。
 */
export interface ChangeWriteCtx {
  /** DaemonChangeWrite.id（task-09 task_id）。 */
  taskId: string;
  /** change 标识（落到 changes/<changeKey>/ 子目录）。 */
  changeKey: string;
  /** workspace id（定位本地 spec 根 + sync 回灌）。 */
  workspaceId: string;
  /** claimChangeWrite 颁发的令牌（complete 校验）。 */
  claimToken: string;
  /** 待写入文件清单（path 相对 changes/<key>/，content utf-8）。 */
  files: ChangeWriteFile[];
  /**
   * 任务类型（2026-07-02-workspace-config-flow task-13 / D-012）：
   *   - ``create`` / ``edit``（默认）：写 changes/<key>/ 文件 + sync 回灌。
   *   - ``spec-sync``：整树回灌到服务器（postSpecSync），不写文件。
   * 缺省 ``create`` 与 backend ``DaemonChangeWrite.kind`` server_default 对齐。
   */
  kind?: string;
}

/** task-11：runChangeWrite 返回值（含 ok / 实际写入相对路径清单）。 */
export interface ChangeWriteResult {
  taskId: string;
  changeKey: string;
  ok: boolean;
  files: string[];
}

/**
 * task-11：change-write path traversal 四类校验（照搬 spec-sync.ts:230 范式）。
 *
 * 拒绝：
 *   1. ``path`` 含 ``..`` 段（防 ``foo/../../bar`` 越界）；
 *   2. ``path`` 是绝对路径（``/`` 开头）；
 *   3. ``path`` 含 Win 盘符（``[A-Za-z]:[\\/]``）；
 *   （第 4 类 join 后越界由调用方 ``relative`` 二次校验兜底。）
 *
 * 接受两种合法形态：
 *   - ``changes/<changeKey>/MASTER.md``（backend proxy 下发，path 相对 spec_root）
 *   - ``MASTER.md``（兼容旧测试/调用方，path 相对 changes/<changeKey>/）
 *
 * 其余 ``changes/<otherKey>/...``、绝对路径、Win 盘符、``..``/``.`` 段均拒绝。
 *
 * @returns 归一化后的 change 目录内相对路径（POSIX 分隔符，供写入和回执 files[]）
 */
export function validateChangeWritePath(
  filePath: string,
  changeKey: string,
): string {
  if (
    typeof filePath !== 'string' ||
    filePath === '' ||
    isAbsolute(filePath) ||
    /^[A-Za-z]:[\\/]/.test(filePath)
  ) {
    throw new Error(`change-write path traversal blocked: ${String(filePath)}`);
  }
  const normalized = filePath.split('\\').join('/');
  if (normalized.endsWith('/')) {
    throw new Error(`change-write path traversal blocked: ${String(filePath)}`);
  }
  const parts = normalized.split('/').filter((part) => part.length > 0);
  if (parts.length === 0 || parts.some((part) => part === '..' || part === '.')) {
    throw new Error(`change-write path traversal blocked: ${String(filePath)}`);
  }
  if (parts[0] === 'changes') {
    if (parts[1] !== changeKey || parts.length <= 2) {
      throw new Error(`change-write path outside change dir: ${String(filePath)}`);
    }
    return parts.slice(2).join('/');
  }
  return parts.join('/');
}

// ── 公开类型 ──────────────────────────────────────────────────────────────────

/**
 * TaskRunner.runLease 的返回结构。
 * TaskResult 扩展加 status（终态）+ sessionId（直接平铺，便于调用方）+ stats（透传）。
 */
export interface TaskRunnerResult extends TaskResult {
  /** 任务终态。 */
  status: TaskStatus;
  /** agent 会话 ID（可能为空）。 */
  sessionId: string;
  /**
   * claude result 消息 stats（cost/tokens/turns），透传到 daemon completeLease payload。
   * 失败路径 / claude 无 result 消息时可能为 undefined。
   * task-06：adapter 解析 complete 事件 metadata.stats 收集。
   */
  stats?: Record<string, unknown>;
}

// ── 内部常量 & 辅助函数 ───────────────────────────────────────────────────────

/**
 * task-07：从 lease payload 鸭子类型 Record 安全取 string / number 字段（多键名兜底）。
 *
 * init lease 的 platform_config 由 backend task-06 下发，字段名 camelCase / snake_case
 * 兼容；直接 `(typeof x === 'string' && x)` 会产出 `string | false` 污染类型，本辅助函数
 * 收敛为 `string | undefined` / `number | undefined`，避免 `||` 回退链的类型 widen。
 */
function pickStr(
  obj: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v) return v;
  }
  return undefined;
}

function pickNum(
  obj: Record<string, unknown>,
  ...keys: string[]
): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return undefined;
}

const EMPTY_DIFF = {
  patch: '',
  files_changed: 0,
  insertions: 0,
  deletions: 0,
  stats: '',
} as const;

// ── task-10 B2/B3：超时优先级链 + spawn 级失败重试（纯函数）─────────────────

/** resolveMaxRetries 硬上限（防止 config 误配大值导致无限重试拖垮 daemon）。 */
const MAX_RETRIES_HARD_CAP = 3;

/** 兜底默认超时秒数（ctx + config 都未配时）。 */
const DEFAULT_TIMEOUT_FALLBACK = 1800;

/** 兜底默认重试次数（config 未配时）。 */
const DEFAULT_MAX_RETRIES_FALLBACK = 1;

/**
 * spawn 级失败关键字（stderr / error 命中即判定为 spawn 级，可重试）。
 * claude 业务非零退出（无这些关键字）→ 保守不重试（R-10 side-effect 优先）。
 */
const SPAWN_FAILURE_PATTERNS = /spawn ENOENT|segfault|oom|killed/i;

/**
 * _spawnAndStream 单次尝试的返回结构（task-10 B3：新增 businessError 区分业务错误）。
 */
interface SpawnAttemptResult {
  status: 'completed' | 'failed' | 'timeout' | 'cancelled';
  exitCode: number;
  error?: string;
  stats?: Record<string, unknown>;
  /** claude 业务报错（result is_error=true）置 true，retry 判定优先看此字段。 */
  businessError?: boolean;
}

/**
 * 解析执行超时秒数（task-10 B2 优先级链）。
 *
 * 从高到低：ctx.timeoutSeconds > ctx.timeout（兼容旧字段）> config.default_timeout_seconds > 1800。
 *
 * 特殊语义：
 *   - timeoutSeconds/timeout = -1（负数）→ 返回 0（显式不限，看门狗不启动）
 *   - timeoutSeconds/timeout = 0 → 跳过（>0 判断），走 config/兜底
 *
 * 纯函数，不修改入参。
 */
export function resolveTimeout(ctx: LeaseCtx, config?: DaemonConfig): number {
  // 显式 -1（timeoutSeconds 或兼容 timeout）→ 不限
  const explicit = ctx.timeoutSeconds ?? ctx.timeout;
  if (typeof explicit === 'number' && explicit < 0) return 0;
  // 优先级 1：ctx.timeoutSeconds（lease.metadata 透传）
  if (typeof ctx.timeoutSeconds === 'number' && ctx.timeoutSeconds > 0) return ctx.timeoutSeconds;
  // 优先级 1b：ctx.timeout（兼容旧字段，既有测试 makeLease({ timeout }) 仍生效）
  if (typeof ctx.timeout === 'number' && ctx.timeout > 0) return ctx.timeout;
  // 优先级 2：config.default_timeout_seconds
  const cfg = config?.default_timeout_seconds;
  if (typeof cfg === 'number' && cfg > 0) return cfg;
  // 优先级 3：兜底 1800
  return DEFAULT_TIMEOUT_FALLBACK;
}

/**
 * 解析最大重试次数（task-10 B3）。
 *
 * config.max_retries 缺失/非法 → 兜底 1；> 3 → 截断 3（log warn）；0 → 禁用重试。
 *
 * 纯函数，不修改入参。
 */
export function resolveMaxRetries(config?: DaemonConfig): number {
  const cfg = config?.max_retries;
  if (typeof cfg !== 'number' || cfg < 0 || !Number.isFinite(cfg)) {
    return DEFAULT_MAX_RETRIES_FALLBACK;
  }
  if (cfg > MAX_RETRIES_HARD_CAP) {
    console.warn(
      `task_runner: max_retries_truncated value=${cfg} cap=${MAX_RETRIES_HARD_CAP}`,
    );
    return MAX_RETRIES_HARD_CAP;
  }
  return cfg;
}

/**
 * 判定单次 spawn 尝试结果是否为「spawn 级失败」（可重试）。
 *
 * 可重试（true）：timeout / spawn ENOENT / OOM / segfault / killed。
 * 不重试（false）：cancelled / businessError（claude is_error）/ completed /
 *   业务非零退出（无 spawn 关键字，保守不重试，R-10 side-effect 优先）。
 *
 * 纯函数，不修改入参。
 */
export function isSpawnLevelFailure(
  r: { status: string; exitCode: number; error?: string; businessError?: boolean },
): boolean {
  // 业务错误（claude result is_error=true）→ 不重试（最优先，避免与 failed 分支歧义）
  if (r.businessError) return false;
  if (r.status === 'timeout') return true;
  if (r.status === 'cancelled') return false;
  if (r.status === 'completed') return false;
  if (r.status === 'failed') {
    // 仅 spawn 级关键字命中才重试；业务非零退出（如 claude 逻辑错误返回非 0）不重试
    return SPAWN_FAILURE_PATTERNS.test(r.error ?? '');
  }
  return false;
}

// ── task-16 (2026-06-24-runtime-usage-stats)：batch usage 兜底合并 ───────────

/**
 * ndjson adapter (task-03) 的 `getUsage()` 在 batch 路径原先无任何调用方：
 * stream-json 的 cache 走 `extractResultStats` 注入 complete 事件 metadata.stats
 * （→ lastStats → TaskResult.stats，cache 已就绪）；但 ndjson（opencode）**不产
 * complete stats 事件**，只通过 `getUsage()` 暴露 usage，导致 batch 路径
 * TaskResult.usage / cache 在 ndjson 下完全丢失（step9 符号影响面检查发现）。
 *
 * 本函数鸭子类型调用 `adapter.getUsage()`（仅 ndjson 实现；stream-json 用
 * extractResultStats，无 getUsage → 跳过，零回归），把 adapter 累积的 usage
 * 合并进 lastStats：
 *   - lastStats 已有的字段不覆盖（stream-json/codex 产 stats 时优先）。
 *   - lastStats 为空 → 整体用 getUsage()。
 *   - lastStats 缺 cache_read_tokens / cache_creation_tokens → 从 getUsage() 补。
 *   - getUsage() 缺失/抛错 → 原样返回 lastStats（不阻塞）。
 *
 * typeof === 'number' 守卫：非数字（含 undefined/NaN）不写，0 值合法不丢。
 *
 * @param adapter   ProtocolAdapter（鸭子类型，可能无 getUsage）
 * @param lastStats complete 事件 metadata.stats（可能 undefined）
 * @returns 合并后的 stats（可能 undefined —— 两处都无数据时）
 */
export function mergeAdapterUsage(
  adapter: ProtocolAdapter,
  lastStats: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  // 鸭子类型：仅 ndjson 实现 getUsage；stream-json 无此方法 → 直接返回原 stats。
  const getUsage = (adapter as { getUsage?: () => Record<string, unknown> }).getUsage;
  if (typeof getUsage !== 'function') {
    return lastStats;
  }
  let adapterUsage: Record<string, unknown> | undefined;
  try {
    adapterUsage = getUsage.call(adapter);
  } catch {
    // adapter getUsage 异常不阻塞主流程（对齐 _handleLine 单行容错策略）。
    return lastStats;
  }
  if (!adapterUsage || typeof adapterUsage !== 'object') {
    return lastStats;
  }
  // lastStats 为空 → 整体用 adapterUsage；否则合并缺失字段（lastStats 优先）。
  const merged: Record<string, unknown> = lastStats
    ? { ...lastStats }
    : {};
  // input/output / cache 两维 / num_turns / total_cost_usd 等所有 number 字段
  // 逐个补缺（lastStats 已有的不覆盖）。
  const FIELDS = [
    'input_tokens',
    'output_tokens',
    'cache_read_tokens',
    'cache_creation_tokens',
    'num_turns',
    'total_cost_usd',
  ];
  for (const key of FIELDS) {
    if (merged[key] === undefined) {
      const v = adapterUsage[key];
      if (typeof v === 'number') {
        merged[key] = v;
      }
    }
  }
  // 两处都无任何业务字段 → 返回 undefined（避免空对象污染下游）。
  if (Object.keys(merged).length === 0) {
    return lastStats;
  }
  return merged;
}

/**
 * 粗判一行是否是 control_request（含 '"control_request"' 字样）。
 * 真正的解析在 adapter.onControl 内（不同协议 JSON 字段略有差异）。
 */
function _looksLikeControlRequest(line: string): boolean {
  return line.includes('"control_request"') || line.includes("'control_request'");
}

// ── 本地终端 echo（quick-chat 实时观察 agent 执行过程）──────────────────────────

/** 单条 echo 最大长度（超长截断，避免大 tool_input 刷屏）。 */
const ECHO_MAX_LEN = 2000;

/**
 * 把 AgentEvent 渲染成单行文本写入 stdout，供启动 daemon 的本地终端实时观察。
 *
 * 设计要点：
 *   - 用 process.stdout.write 直接写，不走 logger（logger 受 log_level 过滤，
 *     debug 级别默认不显示，违背「随时能看到」的诉求）。
 *   - daemon 是前台进程，stdout 跟着终端或重定向目标走，不污染 daemon.log
 *     （cli.ts 的日志文件目前没有重定向 stdout，echo 只活在终端）。
 *   - 业务逻辑（outputParts 累积 / submitMessages）与 echo 解耦，互不影响。
 *   - 单条消息超长截断到 ECHO_MAX_LEN，防止超长 tool_input 刷屏。
 *
 * 不是 TaskRunner 成员方法：纯函数 + leaseId 入参，便于单测独立验证。
 */
/**
 * 把 AgentEvent 渲染成单行文本（不含换行符）。
 *
 * ql-20260616-003：拆出纯函数 render，echo 和 terminal observer 写日志复用
 * 同一份渲染逻辑，保证本地 stdout 和观察日志文件内容字节一致。
 *
 * 渲染规则：
 *   - 前缀 `[task <leaseId前8位>]`，长 UUID 截短避免刷屏
 *   - text         → 直接拼 content（带可选 [status]）
 *   - tool_use     → [tool_use <name>] <input>
 *   - tool_result  → [tool_result <name>] <output>
 *   - error        → [<level>] <content>
 *   - complete     → [complete] usage=<json>（可选）
 *   - 单条超 ECHO_MAX_LEN 截断 + 标记
 */
export function renderAgentEvent(leaseId: string, ev: AgentEvent): string {
  const prefix = `[task ${shortLeaseId(leaseId)}]`;
  let line: string;
  switch (ev.type) {
    case 'text': {
      const status = typeof ev.metadata?.status === 'string' ? ev.metadata.status : '';
      line = status ? `${prefix} [${status}] ${ev.content}` : `${prefix} ${ev.content}`;
      break;
    }
    case 'tool_use': {
      const name = typeof ev.metadata?.tool_name === 'string' ? ev.metadata.tool_name : '<unknown>';
      const input = ev.content || '';
      line = `${prefix} [tool_use ${name}] ${input}`;
      break;
    }
    case 'tool_result': {
      const name = typeof ev.metadata?.tool_name === 'string' ? ev.metadata.tool_name : '';
      line = `${prefix} [tool_result${name ? ` ${name}` : ''}] ${ev.content}`;
      break;
    }
    case 'error': {
      const level = typeof ev.metadata?.level === 'string' ? ev.metadata.level : 'error';
      line = `${prefix} [${level}] ${ev.content}`;
      break;
    }
    case 'complete': {
      const usage = ev.metadata?.usage;
      const usageStr = usage && typeof usage === 'object'
        ? ` usage=${JSON.stringify(usage)}`
        : '';
      line = `${prefix} [complete]${usageStr}`;
      break;
    }
    default: {
      line = `${prefix} [${(ev as { type: string }).type}] ${ev.content}`;
    }
  }
  if (line.length > ECHO_MAX_LEN) {
    line = line.slice(0, ECHO_MAX_LEN) + '…<truncated>';
  }
  return line;
}

/**
 * 把渲染好的 line 写到 daemon 本地 stdout。
 * 包装 try/catch 避免极端情况（stdout 已关闭）影响业务。
 */
export function echoAgentEvent(leaseId: string, ev: AgentEvent): void {
  try {
    process.stdout.write(renderAgentEvent(leaseId, ev) + '\n');
  } catch {
    // stdout 已关闭（极端场景：进程退出中）—— 静默吞掉，不影响业务
  }
}

/** leaseId 取短显示（前 8 位），用于 echo 前缀，避免长 UUID 刷屏。 */
function shortLeaseId(leaseId: string): string {
  return leaseId.length > 12 ? leaseId.slice(0, 8) : leaseId;
}

/**
 * 渲染任务开始/结束边界行（不含换行符）。ql-20260616-003 拆出纯函数。
 *
 * start：`[task xxx] spawn: <cmd> <args...>`
 * end：  `[task xxx] done: status=<status> exit=<exitCode> error=<error>`
 */
export function renderTaskBoundary(
  leaseId: string,
  phase: 'start' | 'end',
  kv: { cmdPath?: string; args?: string[]; status?: string; exitCode?: number; error?: string },
): string {
  const prefix = `[task ${shortLeaseId(leaseId)}]`;
  if (phase === 'start') {
    const argStr = (kv.args ?? []).join(' ');
    const cmd = kv.cmdPath ?? '';
    return `${prefix} spawn: ${cmd} ${argStr}`;
  }
  const parts = [`status=${kv.status ?? '?'}`, `exit=${kv.exitCode ?? '?'}`];
  if (kv.error) {
    const e = kv.error.length > ECHO_MAX_LEN ? kv.error.slice(0, ECHO_MAX_LEN) + '…<truncated>' : kv.error;
    parts.push(`error=${e}`);
  }
  return `${prefix} done: ${parts.join(' ')}`;
}

/**
 * 任务边界写入 daemon 本地 stdout。包装 try/catch。
 */
export function echoTaskBoundary(
  leaseId: string,
  phase: 'start' | 'end',
  kv: { cmdPath?: string; args?: string[]; status?: string; exitCode?: number; error?: string },
): void {
  try {
    process.stdout.write(renderTaskBoundary(leaseId, phase, kv) + '\n');
  } catch {
    // ignore
  }
}

/**
 * 粗判一行是否是 claude stream-json 的 result 事件。
 *
 * ql-20260618-003：之前用 `line.includes('"result"')` 兜底太宽，会误命中
 * codex/json-rpc 的 response（`{"id":2,"result":{"thread":...}}` 也含 "result"
 * key），导致 thread/start response 被误判为终结行 → 提前 stdin.end() →
 * 后续 turn/start 写触发 ERR_STREAM_WRITE_AFTER_END。
 *
 * 修复：用正则只匹配 `"type":"result"`（容忍冒号两侧空格）。codex 的
 * turn/completed 通过 _looksLikeTurnCompleted 单独检测。
 */
function _looksLikeResult(line: string): boolean {
  return /"type"\s*:\s*"result"/.test(line);
}

/**
 * ql-20260618-003：检测 codex/json-rpc 的 turn/completed 通知。
 *
 * codex 是被动 server，单 turn 完成后不会自动退出，需要 daemon 主动关闭
 * stdin 让其收尾。turn/completed notification 标志当前 turn 结束（含
 * status="completed" / "failed" / "cancelled"），是单次 lease 的安全收尾点。
 */
function _looksLikeTurnCompleted(line: string): boolean {
  return /"method"\s*:\s*"turn\/completed"/.test(line);
}

/**
 * 从一行 JSON 文本里提取 session_id（若存在）。
 * 失败返回空串。
 */
function _extractSessionId(line: string): string {
  // 优先 JSON.parse
  try {
    const obj = JSON.parse(line) as { session_id?: unknown; sessionId?: unknown };
    if (typeof obj.session_id === 'string') return obj.session_id;
    if (typeof obj.sessionId === 'string') return obj.sessionId;
  } catch {
    // 非 JSON 行，正则兜底
    const m = /"session_id"\s*:\s*"([^"]+)"/.exec(line);
    if (m && m[1]) return m[1];
  }
  return '';
}

// ── task-09 tar 工具（手工 ustar）已迁移到 ./spec-sync.ts utility
//（task-05 死代码清理），本文件不再保留手工 ustar 实现。
