/**
 * task-runner/runner-types.ts —— TaskRunner 拆包的类型/常量层。
 *
 * task-03（2026-09-07-arch-large-file-split / D-004@v1 / D-005@v3）：原
 * task-runner.ts（3426 行）拆为 task-runner/ 包 8 子模块 + 瘦 facade。本文件
 * 原样承接原文件头部的全部模块级常量（MAX_OUTPUT 等）、类型（TaskStatus /
 * SpawnOpts / RunnerHubClient / RunnerWorkspaceManager / RunnerCredentialManager）
 * 与 SILLYSPEC_VALID_TOOLS / mapDetectedToSillyspecTools / TaskRunnerResult
 * （零改写），并新增 ``TaskRunnerCore``——子模块函数第一参数（原 ``this``）
 * 的类型桥（对齐 task-02 SessionManagerCore 先例）。
 *
 * @module task-runner/runner-types
 */

import type { ChildProcess } from 'node:child_process';
import type { DaemonConfig } from '../config.js';
import type { ResilienceService } from '../resilience/service.js';
import type { PolicyEngine } from '../policy/filesystem-policy.js';
import type { ProtocolAdapter } from '../adapters/protocol-adapter.js';
import type { TerminalObserver } from '../terminal-observer.js';
import type {
  AgentEvent,
  TaskResult,
} from '../types.js';

// ── 常量（对齐 Python task_runner.py）────────────────────────────────────────

/** 累积输出最大字符数（run 最终 output_redacted；ql-20260709-002 放宽 1万→5万）。 */
export const MAX_OUTPUT = 50_000;
/** 错误信息最大字符数（对齐 Python _MAX_ERROR = 5000）。 */
export const MAX_ERROR = 5_000;
/**
 * tool_result 预览最大字符数（ql-20260709-001：原 3000 → 100000）。
 * 对齐 backend run_sync/service.py TOOL_RESULT_MAX_CHARS。3000 会砍掉
 * scan / 构建 / 测试命令输出的关键尾部，100000（约 2000 行）覆盖绝大多数输出；
 * 超长追加中文标注。与 task-runner.ts:1928 已放宽的 result summary（50000）同向。
 */
export const TOOL_RESULT_PREVIEW_MAX = 100_000;
/** ql-20260706-009：stderr 实时 forward 到 backend 的行数上限（防风暴）。 */
export const MAX_STDERR_FORWARD = 50;
/** 超时 kill 优雅升级：SIGTERM 后 2 秒仍存活则 SIGKILL（对齐 Python stream_json.py:115）。 */
export const KILL_GRACE_MS = 2_000;

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
export interface SpawnOpts {
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
   * 可选方法 —— 旧 mock client 未实现时，runLease 自动跳过 spec pull（server-local 模式已于 2026-07-10-remove-server-local-workspace-mode 移除，wsId 永远非空）。
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
  /**
   * ql-20260813-spec-sync-visibility task-08：上报同步进度计数（files_total/processed）。
   * 可选——mock client 未实现时 daemon 跳过进度上报（不影响同步主流程）。
   */
  reportChangeWriteProgress?(
    changeWriteId: string,
    claimToken: string,
    payload: { files_total?: number; files_processed?: number },
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
 * sillyspec `--tool` 的合法值集（sillyspec CLI VALID_TOOLS，design §2 D-005@v1）。
 * 与 daemon agent-detector 12 provider 中的 6 个同名：claude/cursor/openclaw/codex/
 * gemini/opencode。集中一处便于扩展（CLI 新增工具时同步此表）。
 */
export const SILLYSPEC_VALID_TOOLS: ReadonlySet<string> = new Set([
  'claude',
  'cursor',
  'openclaw',
  'codex',
  'gemini',
  'opencode',
]);

/**
 * agent-detector 探测结果 → sillyspec --tool 工具列表（task-06 / D-005@v1）。
 *
 * agent 名 → VALID_TOOLS **同名交集**过滤（12 provider 里 6 个同名，其余如 copilot/
 * hermes/pi/kimi/kiro/antigravity 非 sillyspec 工具名，剔除）。探测失败调用方传
 * undefined 即可（runSillyspecInit 兜底 ['claude']），本函数只做纯映射不兜底。
 */
export function mapDetectedToSillyspecTools(detected: readonly string[]): string[] {
  return detected.filter((name) => SILLYSPEC_VALID_TOOLS.has(name));
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

// ── task-03 类型桥（对齐 task-02 SessionManagerCore 先例）────────────────────

/**
 * task-03（2026-09-07-arch-large-file-split）：子模块函数第一参数（原 ``this``）
 * 的类型桥。facade 侧经 ``this as unknown as TaskRunnerCore`` 传入；仅声明
 * spawn-stream.ts / file-mcp.ts 下沉函数实际用到的成员（方法本体仍在 facade
 * 类内：_eventToMessages / _handleApprovalDecision / _killChild），签名一一同名
 * 同型，行为零变化。
 */
export interface TaskRunnerCore {
  /** HubClient 实例（REST 调用）。 */
  readonly client: RunnerHubClient;
  /** daemon 配置（可选）。 */
  readonly config?: DaemonConfig;
  /** 网络层重试编排（可选注入）。 */
  readonly resilience?: ResilienceService | null;
  /** AgentEvent → submitMessages message dict 列表（本体在 facade）。 */
  _eventToMessages(ev: AgentEvent): Record<string, unknown>[] | null;
  /** batch Codex 带内审批决策（本体在 facade）。 */
  _handleApprovalDecision(
    adapter: ProtocolAdapter,
    child: ChildProcess,
    env: { leaseId: string; runtimeId: string; observer: TerminalObserver },
    approvalEv: AgentEvent,
  ): Promise<void>;
  /** 给子进程发信号，优雅升级由调用方负责（本体在 facade）。 */
  _killChild(child: ChildProcess, signal?: NodeJS.Signals): void;
}
