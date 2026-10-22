/**
 * interactive/turn-file-changes-types.ts —— 每轮工作区快照的 daemon 侧 DTO
 *（2026-10-20-session-page-dsh-alignment / 线 C 1b / D-023@v1 / task-09）。
 *
 * 契约来源（逐字对齐，三跳不得增删字段）：
 *   - design.md「### 文件变更卡 DTO（线 C 实现契约）」的 `TurnFileChange` /
 *     `TurnFileChangesSnapshot` / `FileChangesCapability` 声明；
 *   - design.md「### 1b 承载面与读模型字段」的 daemon 侧命名
 *     `collectTurnFileChanges()`；
 *   - 契约要点 1-6（producer 口径 / 归因边界 / 降级三态 / capability 独立 /
 *     `(runId)` 幂等 / 不含 agent_run_logs 与 edit_patch 表）。
 *
 * 命名口径：DTO 字段一律 camelCase（与 backend pydantic 的 camelCase 别名 /
 * 前端类型逐字一致）；`status` / `reason` / `truncated` / `files[].attribution` /
 * `files[].source` / `concurrentSessionsHint` 是跨跳比对键，禁止改名。
 *
 * @module interactive/turn-file-changes-types
 */

/** 单文件变更状态（禁 rename 检测：改名一律呈现为 delete + add 两条）。 */
export type TurnFileChangeStatus = 'added' | 'modified' | 'deleted' | 'untracked';

/**
 * 归因：`edit_patch` 仅当同一文件命中本轮 Edit/Write 的 edit_patch.path；
 * 其余一律 `command`（「命令行/脚本改动」）。
 *
 * 禁止用 edit_patch 反推改动来源（D-023 已核实 91/1271 覆盖，bash 178 条与
 * sillyspec 30 条无 patch）。
 */
export type TurnFileChangeAttribution = 'edit_patch' | 'command';

/** 数据来源：`git` = status/numstat 直出；`mtime` = ignored 目录的路径前缀 + mtime 探测。 */
export type TurnFileChangeSource = 'git' | 'mtime';

/** 逐文件变更行（design「接口定义」逐字字段）。 */
export interface TurnFileChange {
  /** 仓根相对路径（posix 分隔符；非 git 仓 / 越界路径不进本字段）。 */
  path: string;
  status: TurnFileChangeStatus;
  /** `git diff --numstat <baselineHead>`；二进制为 0/0 + `binary:true`。 */
  added: number;
  deleted: number;
  /** 二进制文件（numstat 的 `-` 列）：行数不伪造，恒 0/0。 */
  binary?: boolean;
  attribution: TurnFileChangeAttribution;
  /**
   * attribution=edit_patch 时的来源工具名（Edit / Write / MultiEdit / NotebookEdit）。
   * 2026-10-22-file-changes-card-fix：**按调用顺序保留重复项**——数组长度 = 本轮
   * 该文件的编辑调用次数（前端「改N次」计数；工具名提示去重展示）。
   */
  editToolNames?: string[];
  /** ignored 目录经 mtime 探测命中时必须标 mtime。 */
  source?: TurnFileChangeSource;
}

/**
 * 快照状态（design 契约要点 3）：
 *   - `ok`         全量可信；
 *   - `partial`    ＝ 采集超时（reason=timeout，默认 1500ms/慢盘自适应；保留已采清单）/ 改动数超上限（truncated=true）/
 *                    队列溢出（reason=queue_overflow）/ 行数口径未采集（spike-01 退档）
 *                    —— 卡片照出，行级 +/− 显示破折号（partial 不是错误态，E3）；
 *   - `failed`     git 异常但非「不可用」形态（未知错误）；
 *   - `unavailable` 非 git 仓 / git 缺失 —— 仍产出完整快照（`files=[]`），backend
 *                    落 `capability="full"`，前端按 status 不出卡（2026-10-22-file-card-hide-empty
 *                    起旧的降级占位卡已下线）；只有「没上报」才是 `tool_only`。
 */
export type TurnFileChangesStatus = 'ok' | 'partial' | 'failed' | 'unavailable';

/**
 * 降级原因（design 固定枚举，禁止新增值——错误按事件命名，不造无依据枚举）。
 *
 * 「行数口径未采集」不占 reason：它不改变 files 的完整性，只让行级 +/− 变成
 * 破折号，故以 `status="partial"` + 遥测里的 `lineCounts:false` 表达。
 */
export type TurnFileChangesReason =
  | 'timeout'
  | 'not_a_repo'
  | 'git_missing'
  | 'queue_overflow';

/** 每轮工作区快照（design「接口定义」逐字字段）。 */
export interface TurnFileChangesSnapshot {
  /** `(runId)` 为覆盖写键（E4 幂等：重复上报等价于最后一次）。 */
  runId: string;
  /** 轮首 HEAD；非 git 仓 / 空仓为 null。 */
  baselineHead: string | null;
  /** ISO 时间戳（采集完成时刻）。 */
  collectedAt: string;
  /** 采集耗时（不含同工作区排队等待时间）。 */
  collectMs: number;
  status: TurnFileChangesStatus;
  reason?: TurnFileChangesReason;
  /** 改动数超上限被截断（true 才写，缺失＝未截断）。 */
  truncated?: boolean;
  /** 逐文件变更（按 path 唯一，升序）。 */
  files: TurnFileChange[];
  /** 恒 true：共享工作区可能含并行会话改动（D-023 不引入每会话 worktree）。 */
  concurrentSessionsHint: true;
}

/**
 * capability 标记：backend 按「本轮上报里有没有 `file_changes`」判定——带了（含
 * `failed` / `unavailable` 的完整快照）→ `full`；压根没上报（老 daemon / 未采）
 * → `tool_only`。
 *
 * 前端自 2026-10-22-file-card-hide-empty 起对「无可用数据」一律**不出卡**（含
 * `tool_only`、`full` 但 `failed/unavailable`、`partial` 且无文件清单之外的零信息
 * 形态）；`capability` 本身仍是版本门控真相源（禁把「没快照」显示成「本轮无改动」）。
 * daemon 侧只做类型占位（本文件不产出 capability——由 backend 读模型决定）。
 */
export type FileChangesCapability = 'full' | 'tool_only';

/* ── 采集入参（daemon 内部契约，非跨跳 DTO）──────────────────────────────── */

/** 本轮工具调用路径（归因 + ignored 目录 mtime 探测的唯一输入）。 */
export interface TurnToolCallPath {
  /**
   * 工具入参里的文件路径原样（绝对或相对 workspaceRoot）。
   * 采集期统一归一为仓根相对 posix 路径再比对。
   */
  path: string;
  /** provider 原生工具名（Edit / Write / MultiEdit / Bash / …，不改名）。 */
  toolName: string;
}

/** 采集阈值（spike-01 实测定档；退档开关见 `includeLineCounts`）。 */
export interface TurnFileChangesLimits {
  /** 硬超时（Promise.race + 子进程 kill）。默认 1500ms。 */
  timeoutMs: number;
  /** 改动文件上限（超上限 → truncated + partial）。默认 500。 */
  maxFiles: number;
  /** 单工作区等待队列上限（排在运行中任务之后的最大等待数）。默认 1。 */
  maxQueueDepth: number;
  /**
   * 是否跑 `git diff --numstat` 取行级 +/−。
   *
   * 默认 true（spike-01 实测 p50 207.5ms 未触发 300ms 红线而保留全量口径）；
   * plan「Spike 前置验证」的退档口径 = false：只跑 status，行级 +/− 由前端显示
   * 破折号（快照 status 为 partial），子进程降为 rev-parse + status 两条。
   */
  includeLineCounts: boolean;
}

/**
 * git 子进程执行器（禁 shell，参数数组；可注入以便单测计数/造错）。
 *
 * 默认实现走 `node:child_process.execFile`，`opts.signal` 被 abort 时杀掉子进程
 * （硬超时的 kill 面），`opts.timeoutMs` 同时作为单次调用的兜底超时。
 */
export type TurnFileChangesExecFile = (
  args: string[],
  opts: { cwd: string; signal: AbortSignal; timeoutMs: number },
) => Promise<{ stdout: string; stderr: string }>;

/** `collectTurnFileChanges` 入参。 */
export interface CollectTurnFileChangesInput {
  /** 本轮 AgentRun.id（上报覆盖写键）。 */
  runId: string;
  /** 会话工作区根（= SessionState.cwd）。 */
  workspaceRoot: string;
  /**
   * 轮首 HEAD（E1 由调用方在 inject 时记录）：
   *   - string → 直接作 diff 基线；
   *   - null   → 已解析但无 HEAD（非 git 仓 / 空仓），采集期不再跑 rev-parse；
   *   - 缺省   → 未解析，采集期自取（计入 ≤3 子进程预算）。
   */
  baselineHead?: string | null;
  /** 本轮工具调用路径（归因 + ignored 目录探测输入；缺省＝无）。 */
  toolCallPaths?: readonly TurnToolCallPath[];
  /** 轮首墙钟（ms）：ignored 目录 mtime 探测的「本轮」下界；缺省＝只探存在性。 */
  turnStartedAtMs?: number;
  limits?: Partial<TurnFileChangesLimits>;
  /** 测试注入点；缺省走 node:child_process.execFile。 */
  execFile?: TurnFileChangesExecFile;
}

/* ── 遥测（模块内滑窗，零外部依赖）──────────────────────────────────────── */

/** 单轮采集遥测样本（结构化日志 `turn_file_changes_collected` 同形）。 */
export interface TurnFileChangesTelemetrySample {
  runId: string;
  collectMs: number;
  fileCount: number;
  subprocessCount: number;
  status: TurnFileChangesStatus;
  reason?: TurnFileChangesReason;
  truncated: boolean;
  /** 本轮是否采到行级 +/−（false = spike-01 退档口径，卡片显示破折号）。 */
  lineCounts: boolean;
}

/** 滑窗统计（task-13 验收读取：p50 > 300ms 或降级率 > 5% 必须登记风险）。 */
export interface TurnFileChangesTelemetrySummary {
  /** 窗口内样本数（≤ TURN_FILE_CHANGES_TELEMETRY_WINDOW）。 */
  samples: number;
  /** 采集耗时中位数（ms，四舍五入整数）。 */
  p50: number;
  /** 采集耗时 p95（ms）。 */
  p95: number;
  /** 降级率 = status !== "ok" 的样本占比（0..1，3 位小数）。 */
  degradeRate: number;
  /** 窗口内单轮子进程数峰值（红线 ≤3）。 */
  subprocessCountMax: number;
}

/**
 * 一轮的 daemon 侧上报体（**单次 payload 组装**的唯一形状）。
 *
 * task-10（TTFT/attempt）在同一函数追加 `timing` 字段、同一次上报调用落地——
 * 禁止另起第二次上报调用（design「1b 承载面」：侧表 `(run_id)` 幂等覆盖写）。
 */
export interface TurnSnapshotReport {
  sessionId: string;
  runId: string;
  /** 采集所用工作区根（后台排查用，不上送 backend DTO 字段面）。 */
  workspaceRoot: string;
  /** 本轮文件变更快照（unavailable / partial 也上报，capability 由 backend 判定）。 */
  fileChanges: TurnFileChangesSnapshot;
  /** task-10 预留：本轮 TTFT/attempt（本任务不产出；缺失就不写）。 */
  timing?: Record<string, unknown>;
}

/** 上报回调（daemon 装配时经 `SessionManager.setTurnSnapshotReporter` 注入 hub 通道）。 */
export type TurnSnapshotReporter = (
  report: TurnSnapshotReport,
) => void | Promise<void>;
