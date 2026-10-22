/**
 * interactive/turn-file-changes.ts —— 每轮工作区快照采集（2026-10-20-session-page-
 * dsh-alignment / 线 C 1b / D-023@v1 / task-09）。
 *
 * 职责：轮尾对会话工作区跑 **≤3 条** git 子进程，产出 `TurnFileChangesSnapshot`
 * （逐文件 +/−、status、attribution、source、partial 降级），并把「可能含并行会话
 * 改动」恒定标注（`concurrentSessionsHint: true`）。
 *
 * 数据链路（design 生命周期契约 E1-E4）：
 *   E1 轮首 `resolveBaselineHead()` 记 HEAD 基线（由 session-manager 在 inject 时
 *       fire-and-forget 调；不计入轮尾预算时为 1 条）；
 *   E2 轮尾 `collectTurnFileChanges()`：status --porcelain -z（1 条）+ diff
 *       --numstat（1 条），合计 ≤3；
 *   E3 完成 → 快照（超时/超限/队列溢出 → partial；git 不可用 → unavailable）；
 *   E4 上报由调用方（session-manager → daemon → hub）落地，本模块只做采集 + 遥测。
 *
 * 性能红线（D-023③，验收项不是建议）：
 *   - 每轮 git 子进程 ≤3（**实测 2**：工作区串行队列 + 固定 status/numstat 两条命令，
 *     不按文件数扩子进程；E1 轮首基线走零子进程的 `readBaselineHead`）；
 *   - 复杂度 O(改动数 + 工具调用数)：无全仓扫描、禁 rename 检测（`--no-renames`）；
 *   - `--no-optional-locks` + `-c core.preloadIndex=true` 恒在参数里（防与用户操作
 *     争 index.lock、复用 index 统计缓存）；
 *   - 1500ms 硬超时（Promise.race + AbortController kill 子进程）→ partial/timeout；
 *   - 单工作区串行队列（`Map<workspaceRoot, tail>`）：队列满 → partial/queue_overflow，
 *     绝不与用户操作并发跑 git。
 *
 * 降级语义（design 契约要点 3）：**partial 不是错误态**——卡片照出，行级 +/− 显示
 * 破折号。`failed` / `unavailable` 仍会产出一份**完整快照**（`files=[]` + 对应
 * status），backend 据「是否带 `file_changes`」判 `capability="full"`，前端再按
 * status 判不出卡（2026-10-22-file-card-hide-empty：没有信息就不占位）；只有
 * 「压根没上报」（老 daemon / 本轮未采）才是 `capability="tool_only"`。任何
 * 情况下都不把「没有快照」伪装成「本轮无改动」（本模块只报告诚实的 status）。
 *
 * spike-01 实测（2026-10-21，本机安静窗口 35% CPU，node 24 / Windows，用**本模块
 * 真实采集器**跑 9 轮交替采样；语料 = 本变更 worktree 与主仓）：
 *   | 语料 | porcelain | 全量口径 p50 / p95 | 仅 status（退档候选）p50 / p95 |
 *   |---|---|---|---|
 *   | worktree（在途 21 改动） | 1,082 B / 21 条 | **245ms / 480ms** | 75ms / 93ms |
 *   | 主仓（111 改动） | 5,627 B / 111 条 | **318ms / 379ms** | 72ms / 89ms |
 *   - 单轮子进程恒 2（`Plan` 上限 3）；降级率 0。
 *   - 裁决：**保留全量口径**（designated corpus p50 245ms ≤ 300ms 红线）；重脏仓
 *     318ms 超线已登记 R-07 风险。退档开关 `limits.includeLineCounts=false` 已实现
 *     并单测（只跑 status，行级 +/− 破折号、快照 partial），如需按字面退档一行改
 *     默认值即可，并把 `timeoutMs` 降到 800。
 *   - 口径注意：机器满载（99% CPU，多 agent 并行）时全量 p50 会被拉到 1500ms
 *     （撞硬超时），那属于环境噪声，不用于定档；判档一律取安静窗口。
 *
 * @module interactive/turn-file-changes
 */
import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

import type {
  CollectTurnFileChangesInput,
  TurnFileChange,
  TurnFileChangeStatus,
  TurnFileChangesExecFile,
  TurnFileChangesLimits,
  TurnFileChangesReason,
  TurnFileChangesSnapshot,
  TurnFileChangesStatus,
  TurnFileChangesTelemetrySample,
  TurnFileChangesTelemetrySummary,
  TurnToolCallPath,
} from './turn-file-changes-types.js';

/* ── 常量 ───────────────────────────────────────────────────────────────── */

/** 默认阈值（spike-01 实测定档：1500ms 硬超时 / 500 文件上限 / 队列深度 1）。 */
export const DEFAULT_TURN_FILE_CHANGES_LIMITS: TurnFileChangesLimits = {
  timeoutMs: 1500,
  maxFiles: 500,
  maxQueueDepth: 1,
  includeLineCounts: true,
};

/** 遥测滑窗容量（只保留最近 N 轮：p50/p95/降级率供 task-13 验收读取）。 */
export const TURN_FILE_CHANGES_TELEMETRY_WINDOW = 50;

/**
 * git 全局参数前缀（**恒在参数数组里**，不依赖用户 git config）：
 *   - `-c core.preloadIndex=true`：复用 index 统计缓存（status 的主要成本面）；
 *   - `-c core.quotePath=false`：中文/非 ASCII 路径原样 UTF-8 输出；
 *   - `--no-optional-locks`：**不拿** index.lock（与用户操作并行只读，不互相阻塞）。
 */
const GIT_BASE_ARGS = [
  '-c',
  'core.preloadIndex=true',
  '-c',
  'core.quotePath=false',
  '--no-optional-locks',
] as const;

/** numstat / status 输出缓冲上限（改动数已限 500，防御性兜底）。 */
const GIT_MAX_BUFFER = 16 * 1024 * 1024;

/**
 * 视为「编辑类」工具（归因 `edit_patch` 的来源白名单）：命中即把该路径记入
 * `editToolNames[]`；其余工具（Bash / 脚本 / MCP）一律 `command`。
 *
 * 大小写不敏感比对（不同 provider 工具名大小写不一：claude 的 Edit/Write、
 * codex/pi 的 edit/write）；`apply_patch` 是 codex 档的补丁工具。
 */
const EDIT_TOOL_NAMES = new Set([
  'edit',
  'write',
  'multiedit',
  'notebookedit',
  'apply_patch',
  'edit_file',
  'write_file',
]);

/** 工具入参里可能承载文件路径的键（provider 长尾，按优先级取首个非空字符串）。 */
const PATH_ARG_KEYS = [
  'file_path',
  'filePath',
  'path',
  'notebook_path',
  'target_file',
  'file',
] as const;

/**
 * mtime 探测的时钟容差（ms）：文件系统 mtime 粒度（FAT 2s / ext4 ns）与本进程
 * 墙钟不同源，允许 1s 回拨以免把「本轮刚好写到边界」的改动判丢。
 */
const MTIME_CLOCK_TOLERANCE_MS = 1_000;

/* ── 模块级运行态：单工作区串行队列 + 遥测滑窗 ───────────────────────────── */

interface WorkspaceQueue {
  /** 队尾（下一个任务 await 它；gate 只在任务结束时 resolve）。 */
  tail: Promise<void>;
  /** 是否有任务正在跑（含「立即起跑」的那个）。 */
  busy: boolean;
  /** 已排队等待（不含正在跑）的任务数。 */
  waiting: number;
}

const _queues = new Map<string, WorkspaceQueue>();
const _telemetry: TurnFileChangesTelemetrySample[] = [];

/** 工作区键（Windows 大小写不敏感 → 归一小写，避免同一目录两条队列）。 */
function workspaceQueueKey(workspaceRoot: string): string {
  const key = resolve(workspaceRoot).replace(/\\/g, '/');
  return process.platform === 'win32' ? key.toLowerCase() : key;
}

/**
 * 抢一个队列位：空闲队列**立即起跑**（不占等待额度，`waits=false`）；
 * 已有任务在跑时排队（`waits=true`）；等待队列超上限返回 null → 调用方按
 * `queue_overflow` 立即降级（不排队、不采集）。
 */
function reserveQueueSlot(
  key: string,
  maxQueueDepth: number,
): { queue: WorkspaceQueue; waits: boolean } | null {
  const existing = _queues.get(key);
  if (!existing || (!existing.busy && existing.waiting === 0)) {
    const queue = existing ?? {
      tail: Promise.resolve(),
      busy: false,
      waiting: 0,
    };
    queue.busy = true;
    _queues.set(key, queue);
    return { queue, waits: false };
  }
  if (existing.waiting >= maxQueueDepth) return null;
  existing.waiting += 1;
  return { queue: existing, waits: true };
}

/** 立即起跑 / 等前序结束（严格串行）；返回释放闸门的函数。 */
async function enterQueue(
  key: string,
  slot: { queue: WorkspaceQueue; waits: boolean },
): Promise<() => void> {
  const { queue, waits } = slot;
  let releaseGate: () => void = () => undefined;
  const gate = new Promise<void>((resolveGate) => {
    releaseGate = resolveGate;
  });
  const prev = queue.tail;
  queue.tail = prev.then(() => gate).catch(() => undefined);
  if (waits) {
    await prev.catch(() => undefined);
    queue.waiting = Math.max(0, queue.waiting - 1);
    queue.busy = true;
  }
  return () => {
    releaseGate();
    queue.busy = false;
    if (queue.waiting === 0 && _queues.get(key) === queue) {
      _queues.delete(key);
    }
  };
}

/* ── git 子进程（禁 shell：参数数组 + 可注入执行器）────────────────────────── */

/**
 * 默认执行器：`execFile('git', args)`——**禁 shell**（防注入），`signal` abort 时
 * node 直接杀掉子进程（1500ms 硬超时的 kill 面），`timeout` 作单次兜底。
 */
const defaultExecFile: TurnFileChangesExecFile = (args, opts) =>
  new Promise((resolvePromise, rejectPromise) => {
    execFile(
      'git',
      args,
      {
        cwd: opts.cwd,
        timeout: opts.timeoutMs,
        maxBuffer: GIT_MAX_BUFFER,
        windowsHide: true,
        signal: opts.signal,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        if (error) {
          // execFile 的错误对象自带 stderr / code / killed，供下方 classify 分类。
          rejectPromise(error);
          return;
        }
        resolvePromise({ stdout: stdout ?? '', stderr: stderr ?? '' });
      },
    );
  });

/** 采集期的降级终止信号（携带 status/reason/baseline，异常面由 collect 收口）。 */
class CollectAbort extends Error {
  readonly status: TurnFileChangesStatus;
  readonly reason?: TurnFileChangesReason;
  readonly baselineHead: string | null;

  constructor(
    status: TurnFileChangesStatus,
    reason: TurnFileChangesReason | undefined,
    baselineHead: string | null,
  ) {
    super(`turn_file_changes_${status}${reason ? `_${reason}` : ''}`);
    this.name = 'CollectAbort';
    this.status = status;
    this.reason = reason;
    this.baselineHead = baselineHead;
  }
}

/** 硬超时信号（Promise.race 的另一臂；与 git 错误区分开）。 */
class CollectTimeout extends Error {
  constructor() {
    super('turn_file_changes_timeout');
    this.name = 'CollectTimeout';
  }
}

/**
 * git 错误分类（design 固定枚举，不新增值）：
 *   - ENOENT / 可执行缺失 → unavailable + git_missing；
 *   - "not a git repository" → unavailable + not_a_repo；
 *   - abort / killed / 超时 → partial + timeout；
 *   - 其余 → null（调用方按 `failed` 处理：未知 git 错误，不伪造 ok）。
 */
function classifyGitError(
  error: unknown,
): { status: TurnFileChangesStatus; reason?: TurnFileChangesReason } | null {
  const err = error as
    | (NodeJS.ErrnoException & { killed?: boolean; stderr?: string })
    | undefined;
  if (!err) return null;
  if (err.code === 'ENOENT') {
    return { status: 'unavailable', reason: 'git_missing' };
  }
  if (err.code === 'ABORT_ERR' || err.killed === true) {
    return { status: 'partial', reason: 'timeout' };
  }
  const stderr = typeof err.stderr === 'string' ? err.stderr : '';
  const message = `${stderr}\n${err.message ?? ''}`;
  if (/not a git repository/i.test(message)) {
    return { status: 'unavailable', reason: 'not_a_repo' };
  }
  return null;
}

/* ── 路径归一 / porcelain / numstat 解析 ─────────────────────────────────── */

/**
 * 工具入参路径 → 仓根相对 posix 路径（无法安全归一时返回 null，调用方跳过）：
 *   - 绝对路径：`relative(workspaceRoot, p)`，越界（`..`）丢弃；
 *   - 相对路径：去 `./` 前缀；`../` 越界丢弃；
 *   - Windows 反斜杠统一成 `/`（git 输出恒 posix 分隔符）。
 */
export function toRepoRelativePath(
  workspaceRoot: string,
  rawPath: string,
): string | null {
  if (typeof rawPath !== 'string' || rawPath.trim() === '') return null;
  const candidates = [rawPath, rawPath.replace(/\\/g, '/')];
  for (const candidate of candidates) {
    let relPath: string;
    if (isAbsolute(candidate) || /^[a-zA-Z]:\//.test(candidate)) {
      const rel = relative(resolve(workspaceRoot), resolve(candidate));
      if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) continue;
      relPath = rel.replace(/\\/g, '/');
    } else {
      relPath = candidate.replace(/^\.\//, '');
      if (relPath.startsWith('../') || relPath === '..') continue;
    }
    if (relPath !== '') return relPath;
  }
  return null;
}

/** 路径比对键（Windows 大小写不敏感；其余平台原样）。 */
function pathMatchKey(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path;
}

/**
 * `git status --porcelain -z` 解析：`XY PATH\0`（-z 不转义、无引号）。
 *
 * `R` / `C` 条目（`--no-renames` 下正常不会出现，防 git 版本/配置漂移）**归一成
 * delete + add 两条**：原路径 deleted、新路径 added —— 与设计「改名呈现为删一个
 * 加一个」的已知呈现代价同口径。
 *
 * 口径注记：`--untracked-files=normal` 下新增目录只报一条 `?? dir/`（不展开逐文件）
 * ——这是上限内的取舍（展开要 `-uall`，大目录会显著变慢）；该条 added/deleted 记
 * 0/0，语义是「本轮新增了一个未跟踪目录」。
 */
function parsePorcelainZ(
  stdout: string,
): Array<{ path: string; status: TurnFileChangeStatus }> {
  const tokens = stdout.split('\0');
  const out: Array<{ path: string; status: TurnFileChangeStatus }> = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) continue;
    const xy = token.slice(0, 2);
    const path = token.slice(3); // 跳过 "XY "（X=index, Y=worktree）
    if (path === '') continue;
    const index = xy.slice(0, 1);
    const worktree = xy.slice(1, 2);
    if (
      index === 'R' ||
      worktree === 'R' ||
      index === 'C' ||
      worktree === 'C'
    ) {
      const oldPath = tokens[i + 1] ?? '';
      i += 1; // -z 的 rename 条目把原路径放在下一个 token
      if (oldPath !== '') out.push({ path: oldPath, status: 'deleted' });
      out.push({ path, status: 'added' });
      continue;
    }
    out.push({ path, status: statusFromXY(xy) });
  }
  return out;
}

/**
 * XY → 快照 status（design 契约要点 1 的裁决顺序）：
 * `??`/`!!` → untracked；含 `A` → added；含 `D` → deleted；其余 → modified。
 */
function statusFromXY(xy: string): TurnFileChangeStatus {
  if (xy === '??' || xy === '!!') return 'untracked';
  if (xy.includes('A')) return 'added';
  if (xy.includes('D')) return 'deleted';
  return 'modified';
}

interface NumstatEntry {
  added: number;
  deleted: number;
  binary: boolean;
}

/**
 * `git diff --numstat` 解析：`added\tdeleted\tpath`（行级）。
 * 二进制记 `-\t-` → added/deleted=0 + binary=true（**不伪造行数**）。
 */
function parseNumstat(stdout: string): Map<string, NumstatEntry> {
  const out = new Map<string, NumstatEntry>();
  for (const rawLine of stdout.split(/\r?\n/)) {
    if (rawLine.trim() === '') continue;
    const cols = rawLine.split('\t');
    const addedCol = cols[0];
    const deletedCol = cols[1];
    if (addedCol === undefined || deletedCol === undefined) continue;
    const path = cols.slice(2).join('\t');
    if (path === '') continue;
    const binary = addedCol === '-' || deletedCol === '-';
    out.set(pathMatchKey(path), {
      added: binary ? 0 : Number.parseInt(addedCol, 10) || 0,
      deleted: binary ? 0 : Number.parseInt(deletedCol, 10) || 0,
      binary,
    });
  }
  return out;
}

/* ── 归因：本轮 Edit/Write 的路径 → 工具名 ───────────────────────────────── */

/** 本轮编辑类工具调用的归因表（matchKey → 工具名集合，保序）。 */
function buildEditAttribution(
  workspaceRoot: string,
  toolCallPaths: readonly TurnToolCallPath[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const call of toolCallPaths) {
    const toolName = typeof call?.toolName === 'string' ? call.toolName : '';
    if (!EDIT_TOOL_NAMES.has(toolName.toLowerCase())) continue;
    const relPath = toRepoRelativePath(workspaceRoot, call?.path ?? '');
    if (relPath === null) continue;
    const key = pathMatchKey(relPath);
    const names = map.get(key) ?? [];
    if (!names.includes(toolName)) names.push(toolName);
    map.set(key, names);
  }
  return map;
}

/**
 * 归因裁决：命中本轮 Edit/Write 的同一文件 → `edit_patch`（带来源工具名），
 * 其余一律 `command`。**禁止**用 edit_patch 反推改动来源（D-023）。
 */
function attributeFor(
  relPath: string,
  editAttribution: Map<string, string[]>,
): Pick<TurnFileChange, 'attribution' | 'editToolNames'> {
  const names = editAttribution.get(pathMatchKey(relPath));
  if (names && names.length > 0) {
    return { attribution: 'edit_patch', editToolNames: [...names] };
  }
  return { attribution: 'command' };
}

/**
 * 工具调用事件 → 本轮路径集合（session-manager 的 `_onMessage` 累加器唯一入口）。
 *
 * 输入是 driver 归一化后的 `AgentEvent`：`tool_use` 事件的 `content` 是入参 JSON
 *（归一化器口径，与 `registerAgentToolUseMeta` 同一解析手法）。**不改事件协议**：
 * 只读既有字段（type / tool_name / content），产出加进本轮的旁路累加器。
 *
 * 非编辑类工具（Bash / MCP / 搜索）也收——它们的路径用于 ignored 目录 mtime 探测
 * 的「本轮工具调用路径前缀」，但归因仍只会落在 Edit/Write 命中项上。
 */
export function toolCallPathsFromEvent(ev: {
  type?: string;
  tool_name?: string;
  content?: string;
}): TurnToolCallPath[] {
  if (!ev || ev.type !== 'tool_use') return [];
  const toolName = typeof ev.tool_name === 'string' ? ev.tool_name : '';
  if (toolName === '') return [];
  let args: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(ev.content || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      args = parsed as Record<string, unknown>;
    }
  } catch {
    return []; // 非法 JSON：本轮该调用不提供路径（不猜、不反推）
  }
  for (const key of PATH_ARG_KEYS) {
    const value = args[key];
    if (typeof value === 'string' && value.trim() !== '') {
      return [{ path: value, toolName }];
    }
  }
  return [];
}

/* ── ignored 目录 mtime 探测 ─────────────────────────────────────────────── */

/**
 * ignored 目录（gitignore 命中）的探测：本轮工具调用路径前缀 + mtime。
 *
 * 只在「路径不在 git 结果里」时探测（tracked 改动必然出现在 status）——命中
 * `stat` 存在且 mtime 落在本轮起点之后的文件，标 `source="mtime"`，行数记 0/0
 *（git 看不到的改动不伪造行数）。
 *
 * **必须有 `sinceMs`（轮首墙钟）才探测**：没有时间下界就分不清「本轮新建的
 * ignored 文件」与「早就在那里的普通文件」（tracked 未改动文件同样不在 status
 * 里），故缺省直接跳过——宁可不报，也不假报。
 *
 * 已知边界（disclosed）：tracked 但内容未变、仅 mtime 变了的文件（touch / 改动
 * 后回滚）可能被判成 `source="mtime"` 的 modified；概率低且不伪造行数，卡片上
 * source=mtime 已标明来源不是 git。
 *
 * status：birthtime 也落在本轮之后 → `added`（本轮新建）；否则 `modified`。
 * birthtime 不可用（部分文件系统给 0）时保守记 `modified`。
 */
async function probeIgnoredByMtime(args: {
  workspaceRoot: string;
  toolCallPaths: readonly TurnToolCallPath[];
  seen: Set<string>;
  sinceMs: number | undefined;
  editAttribution: Map<string, string[]>;
}): Promise<TurnFileChange[]> {
  const out: TurnFileChange[] = [];
  if (args.sinceMs === undefined) return out; // 无轮首时间下界：不探测（防假报）
  const sinceMs = args.sinceMs;
  const probed = new Set<string>();
  for (const call of args.toolCallPaths) {
    const relPath = toRepoRelativePath(args.workspaceRoot, call?.path ?? '');
    if (relPath === null) continue;
    const key = pathMatchKey(relPath);
    if (args.seen.has(key) || probed.has(key)) continue;
    if (relPath === '.git' || relPath.startsWith('.git/')) continue;
    probed.add(key);
    let fileStat: Awaited<ReturnType<typeof stat>>;
    try {
      fileStat = await stat(resolve(args.workspaceRoot, relPath));
    } catch {
      continue; // 不存在 / 无权限：不猜（不把「读不到」写成「没改」）
    }
    if (!fileStat.isFile()) continue;
    if (fileStat.mtimeMs + MTIME_CLOCK_TOLERANCE_MS < sinceMs) continue;
    const createdThisTurn =
      fileStat.birthtimeMs > 0 &&
      fileStat.birthtimeMs + MTIME_CLOCK_TOLERANCE_MS >= sinceMs;
    out.push({
      path: relPath,
      status: createdThisTurn ? 'added' : 'modified',
      added: 0,
      deleted: 0,
      ...attributeFor(relPath, args.editAttribution),
      source: 'mtime',
    });
  }
  return out;
}

/* ── 采集主体 ───────────────────────────────────────────────────────────── */

interface CollectContext {
  subprocessCount: number;
}

interface CollectOutcome {
  files: TurnFileChange[];
  baselineHead: string | null;
  truncated: boolean;
  lineCounts: boolean;
}

/**
 * 采集主体（在队列闸门内、超时 race 内执行）：
 *   ①（基线缺省时）rev-parse HEAD ②status --porcelain -z ③diff --numstat。
 * 致命错误经 `CollectAbort` 上抛，由 `collectTurnFileChanges` 收口成快照。
 */
async function collectInner(args: {
  workspaceRoot: string;
  baselineHead: string | null | undefined;
  toolCallPaths: readonly TurnToolCallPath[];
  turnStartedAtMs: number | undefined;
  limits: TurnFileChangesLimits;
  exec: TurnFileChangesExecFile;
  signal: AbortSignal;
  taskStartMs: number;
  ctx: CollectContext;
}): Promise<CollectOutcome> {
  const { limits, exec, signal, ctx } = args;
  const runGit = async (gitArgs: string[]): Promise<string> => {
    ctx.subprocessCount += 1;
    const remaining = Math.max(
      1,
      limits.timeoutMs - (Date.now() - args.taskStartMs),
    );
    const { stdout } = await exec(
      [...GIT_BASE_ARGS, ...gitArgs],
      {
        cwd: args.workspaceRoot,
        signal,
        timeoutMs: remaining,
      },
    );
    return stdout;
  };

  // ① 基线：E1 已解析（string / null）则不再花子进程；缺省则自取。
  let baselineHead: string | null;
  if (args.baselineHead === undefined) {
    try {
      const head = (await runGit(['rev-parse', 'HEAD'])).trim();
      baselineHead = head === '' ? null : head;
    } catch (error) {
      const classified = classifyGitError(error);
      if (classified) {
        // 非 git 仓 / git 缺失：直接 unavailable（不跑 status，省一条子进程）。
        throw new CollectAbort(classified.status, classified.reason, null);
      }
      // 空仓（无任何提交）等：基线留 null，status 仍可产出 untracked 清单。
      baselineHead = null;
    }
  } else {
    baselineHead = args.baselineHead;
  }

  // ② status（本轮改动的唯一真相源；失败即降级）。
  let statusOut: string;
  try {
    statusOut = await runGit([
      'status',
      '--porcelain',
      '-z',
      '--untracked-files=normal',
      '--no-renames',
    ]);
  } catch (error) {
    const classified = classifyGitError(error);
    throw new CollectAbort(
      classified?.status ?? 'failed',
      classified?.reason,
      baselineHead,
    );
  }

  // ③ numstat（行级 +/−；退档口径 includeLineCounts=false 时不跑）。
  //    无基线（空仓 / 非仓库已降级）时跳过：diff 无从比较。
  let numstat: Map<string, NumstatEntry> = new Map();
  let lineCounts = false;
  if (limits.includeLineCounts && baselineHead !== null) {
    try {
      const numstatOut = await runGit([
        'diff',
        '--numstat',
        '--no-renames',
        baselineHead,
      ]);
      numstat = parseNumstat(numstatOut);
      lineCounts = true;
    } catch (error) {
      const classified = classifyGitError(error);
      if (classified) {
        // 超时 / git 消失：整轮降级（files 仍可照出 status 面）。
        throw new CollectAbort(classified.status, classified.reason, baselineHead);
      }
      // 未知 numstat 错误：保住 status 面，行数留 0（partial 由调用方标记）。
      lineCounts = false;
    }
  }

  const editAttribution = buildEditAttribution(
    args.workspaceRoot,
    args.toolCallPaths,
  );
  const seen = new Set<string>();
  const files: TurnFileChange[] = [];
  for (const entry of parsePorcelainZ(statusOut)) {
    const relPath = toRepoRelativePath(args.workspaceRoot, entry.path) ?? entry.path;
    const key = pathMatchKey(relPath);
    if (seen.has(key)) continue;
    seen.add(key);
    const line = numstat.get(key);
    files.push({
      path: relPath,
      status: entry.status,
      added: line?.added ?? 0,
      deleted: line?.deleted ?? 0,
      ...(line?.binary ? { binary: true } : {}),
      ...attributeFor(relPath, editAttribution),
      source: 'git',
    });
  }

  // ignored 目录：本轮工具调用路径前缀 + mtime（R-09 的唯一补偿面）。
  const mtimeFiles = await probeIgnoredByMtime({
    workspaceRoot: args.workspaceRoot,
    toolCallPaths: args.toolCallPaths,
    seen,
    sinceMs: args.turnStartedAtMs,
    editAttribution,
  });
  files.push(...mtimeFiles);

  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  // 上限截断：改动数超上限 → truncated + partial（卡片照出，行级 +/− 破折号）。
  const truncated = files.length > limits.maxFiles;
  const cappedFiles = truncated ? files.slice(0, limits.maxFiles) : files;

  return {
    files: cappedFiles,
    baselineHead,
    truncated,
    lineCounts,
  };
}

/* ── 遥测 ───────────────────────────────────────────────────────────────── */

/** 样本入滑窗（FIFO，容量 TURN_FILE_CHANGES_TELEMETRY_WINDOW）。 */
function pushTelemetrySample(sample: TurnFileChangesTelemetrySample): void {
  _telemetry.push(sample);
  while (_telemetry.length > TURN_FILE_CHANGES_TELEMETRY_WINDOW) {
    _telemetry.shift();
  }
}

/** 最近邻百分位（nearest-rank：小样本也稳定，不插值）。 */
function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round((p / 100) * (sorted.length - 1))),
  );
  return sorted[rank] ?? 0;
}

/**
 * 遥测滑窗统计（task-13 验收读取：p50 > 300ms 或降级率 > 5% 必须登记风险）。
 * 只覆盖本进程内的采集样本（daemon 重启归零，不落盘）。
 */
export function getTurnFileChangesTelemetry(): TurnFileChangesTelemetrySummary {
  const samples = _telemetry.length;
  if (samples === 0) {
    return { samples: 0, p50: 0, p95: 0, degradeRate: 0, subprocessCountMax: 0 };
  }
  const durations = _telemetry.map((s) => s.collectMs);
  const degraded = _telemetry.filter((s) => s.status !== 'ok').length;
  return {
    samples,
    p50: Math.round(percentile(durations, 50)),
    p95: Math.round(percentile(durations, 95)),
    degradeRate: Math.round((degraded / samples) * 1000) / 1000,
    subprocessCountMax: Math.max(..._telemetry.map((s) => s.subprocessCount)),
  };
}

/** 清空遥测滑窗 + 串行队列（单测隔离用；生产不调）。 */
export function resetTurnFileChangesTelemetry(): void {
  _telemetry.length = 0;
  _queues.clear();
}

/** 结构化日志（一行/轮；字段名与 telemetry sample 同形，便于日志侧聚合）。 */
function logCollected(sample: TurnFileChangesTelemetrySample): void {
  // eslint-disable-next-line no-console
  console.info('[turn-file-changes] turn_file_changes_collected', sample);
}

/** 收口：组快照 + 落遥测 + 打日志（所有降级路径共用同一出口，防两处漂移）。 */
function finalizeSnapshot(args: {
  runId: string;
  baselineHead: string | null;
  status: TurnFileChangesStatus;
  reason?: TurnFileChangesReason;
  truncated?: boolean;
  files: TurnFileChange[];
  collectMs: number;
  subprocessCount: number;
  lineCounts: boolean;
}): TurnFileChangesSnapshot {
  const sample: TurnFileChangesTelemetrySample = {
    runId: args.runId,
    collectMs: args.collectMs,
    fileCount: args.files.length,
    subprocessCount: args.subprocessCount,
    status: args.status,
    ...(args.reason !== undefined ? { reason: args.reason } : {}),
    truncated: args.truncated === true,
    lineCounts: args.lineCounts,
  };
  pushTelemetrySample(sample);
  logCollected(sample);
  return {
    runId: args.runId,
    baselineHead: args.baselineHead,
    collectedAt: new Date().toISOString(),
    collectMs: args.collectMs,
    status: args.status,
    ...(args.reason !== undefined ? { reason: args.reason } : {}),
    ...(args.truncated === true ? { truncated: true } : {}),
    files: args.files,
    concurrentSessionsHint: true,
  };
}

/* ── 公开入口 ───────────────────────────────────────────────────────────── */

function resolveLimits(
  limits: Partial<TurnFileChangesLimits> | undefined,
): TurnFileChangesLimits {
  return { ...DEFAULT_TURN_FILE_CHANGES_LIMITS, ...(limits ?? {}) };
}

/**
 * 每轮工作区快照采集（纯采集：不写库、不上报、永不抛错）。
 *
 * 顺序：E2 入口 → 抢单工作区队列位（满 → partial/queue_overflow，立即返回）→
 * 串行等前序 → 1500ms 硬超时 race 内跑 ≤3 条 git → 收口快照。
 *
 * 降级路径（全部有测试覆盖）：
 *   - `ok`               ：全量采集成功；
 *   - `partial/timeout`  ：硬超时（AbortController kill 子进程）；
 *   - `partial/queue_overflow`：同工作区等待队列超上限；
 *   - `partial` + truncated   ：改动数超 maxFiles；
 *   - `partial`（无 reason）   ：`includeLineCounts=false` 退档口径（行级 +/− 不采）；
 *   - `unavailable/not_a_repo` / `unavailable/git_missing`：非 git 仓 / git 缺失；
 *   - `failed`           ：未知 git 错误（不伪造 ok）。
 */
export async function collectTurnFileChanges(
  input: CollectTurnFileChangesInput,
): Promise<TurnFileChangesSnapshot> {
  const callStartMs = Date.now();
  const limits = resolveLimits(input.limits);
  const exec = input.execFile ?? defaultExecFile;
  const workspaceRoot = input.workspaceRoot;
  const queueKey = workspaceQueueKey(workspaceRoot);

  const queue = reserveQueueSlot(queueKey, limits.maxQueueDepth);
  if (queue === null) {
    // 队列溢出：**立即**返回 partial（不排队、不采、不阻塞轮收尾）。
    return finalizeSnapshot({
      runId: input.runId,
      baselineHead: input.baselineHead ?? null,
      status: 'partial',
      reason: 'queue_overflow',
      files: [],
      collectMs: Date.now() - callStartMs,
      subprocessCount: 0,
      lineCounts: limits.includeLineCounts,
    });
  }

  const leaveQueue = await enterQueue(queueKey, queue);
  const taskStartMs = Date.now();
  const ctx: CollectContext = { subprocessCount: 0 };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_resolve, rejectDeadline) => {
      timer = setTimeout(() => {
        // 先 kill 子进程（signal），再让 race 的失败臂立即落 partial。
        controller.abort();
        rejectDeadline(new CollectTimeout());
      }, limits.timeoutMs);
    });
    const outcome = await Promise.race([
      collectInner({
        workspaceRoot,
        baselineHead: input.baselineHead,
        toolCallPaths: input.toolCallPaths ?? [],
        turnStartedAtMs: input.turnStartedAtMs,
        limits,
        exec,
        signal: controller.signal,
        taskStartMs,
        ctx,
      }),
      deadline,
    ]);
    // 行级口径未采（退档 includeLineCounts=false / numstat 未知错误 / 空仓无基线）
    // → partial：卡片照出 files，行级 +/− 显示破折号。reason 枚举里没有「行数未采」
    // 值，故不带 reason——完整性面（files 清单）仍可信，只有行数不可信；遥测
    // sample 的 lineCounts 标明本轮口径。
    const status: TurnFileChangesStatus =
      outcome.truncated || !outcome.lineCounts ? 'partial' : 'ok';
    return finalizeSnapshot({
      runId: input.runId,
      baselineHead: outcome.baselineHead,
      status,
      ...(outcome.truncated ? { truncated: true } : {}),
      files: outcome.files,
      collectMs: Date.now() - taskStartMs,
      subprocessCount: ctx.subprocessCount,
      lineCounts: outcome.lineCounts,
    });
  } catch (error) {
    const collectMs = Date.now() - taskStartMs;
    if (error instanceof CollectTimeout) {
      return finalizeSnapshot({
        runId: input.runId,
        baselineHead: input.baselineHead ?? null,
        status: 'partial',
        reason: 'timeout',
        files: [],
        collectMs,
        subprocessCount: ctx.subprocessCount,
        lineCounts: false,
      });
    }
    if (error instanceof CollectAbort) {
      return finalizeSnapshot({
        runId: input.runId,
        baselineHead: error.baselineHead,
        status: error.status,
        ...(error.reason !== undefined ? { reason: error.reason } : {}),
        files: [],
        collectMs,
        subprocessCount: ctx.subprocessCount,
        lineCounts: false,
      });
    }
    // 兜底：任何未分类异常都不抛穿（观测面 best-effort，E2 不阻塞轮收尾）。
    return finalizeSnapshot({
      runId: input.runId,
      baselineHead: input.baselineHead ?? null,
      status: 'failed',
      files: [],
      collectMs,
      subprocessCount: ctx.subprocessCount,
      lineCounts: false,
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    controller.abort(); // 收尾必 kill（超时分支的残余子进程 / 正常分支的空操作）
    leaveQueue();
  }
}

/**
 * E1 基线（轮首，**零子进程**）：直接读工作区的 `.git/HEAD` 解析 HEAD sha。
 *
 * 为什么不用 `git rev-parse HEAD`：轮首在 `inject` 成功路径上，任何以工作区为
 * cwd 的子进程都会在 Windows 上短暂占住该目录（实证：临时 cwd 的测试/用户侧
 * 目录清理会撞 EBUSY），而 HEAD 解析是纯读盘、毫秒级、跨平台一致的——不值得
 * 为它开子进程。**子进程预算因此从 3 降到 2**（status + numstat，见上方 spike-01）。
 *
 * 返回值三态（喂给 `CollectTurnFileChangesInput.baselineHead`）：
 *   - `string`    解析成功 → 直接作 diff 基线；
 *   - `null`      工作区没有 `.git`（非 git 仓）→ 采集期不再跑 rev-parse；
 *   - `undefined` 有 `.git` 但解析不出（linked worktree / 子模块 / 裸仓 / 空仓 /
 *                 packed-refs 之外的复杂形态）→ 采集期由 git 自己 `rev-parse`
 *                 兜底（那时已是轮尾，不占工作区 cwd 的短命窗口）。
 *
 * 永不抛错（读盘失败一律 undefined，交给 git 兜底）。
 */
export async function readBaselineHead(
  workspaceRoot: string,
): Promise<string | null | undefined> {
  const SHA_RE = /^[0-9a-f]{40,64}$/i;
  try {
    const dotGit = join(workspaceRoot, '.git');
    let gitDir: string;
    let dotGitStat: Awaited<ReturnType<typeof stat>> | null = null;
    try {
      dotGitStat = await stat(dotGit);
    } catch {
      dotGitStat = null;
    }
    if (dotGitStat === null) return null; // 非 git 仓
    if (dotGitStat.isDirectory()) {
      gitDir = dotGit;
    } else {
      // `<worktree>/.git` 是文件：`gitdir: <path>`（linked worktree / 子模块）
      const text = await readFile(dotGit, 'utf-8').catch(() => '');
      const match = /^gitdir:\s*(.+)$/m.exec(text);
      if (!match) return undefined;
      gitDir = resolve(workspaceRoot, match[1]!.trim());
    }
    const headText = (
      await readFile(join(gitDir, 'HEAD'), 'utf-8').catch(() => '')
    ).trim();
    if (headText === '') return undefined;
    if (!headText.startsWith('ref:')) {
      // detached HEAD：HEAD 直接是 sha
      return SHA_RE.test(headText) ? headText : undefined;
    }
    const ref = headText.slice(4).trim();
    if (ref === '') return undefined;
    // refs 可能落在主仓（linked worktree 的 commondir）——两个 base 都查一遍。
    const bases: string[] = [gitDir];
    const commonDirText = (
      await readFile(join(gitDir, 'commondir'), 'utf-8').catch(() => '')
    ).trim();
    if (commonDirText !== '') {
      bases.push(resolve(gitDir, commonDirText));
    }
    for (const base of bases) {
      const loose = (
        await readFile(join(base, ref), 'utf-8').catch(() => '')
      ).trim();
      if (SHA_RE.test(loose)) return loose;
    }
    for (const base of bases) {
      const packed = await readFile(join(base, 'packed-refs'), 'utf-8').catch(
        () => '',
      );
      if (packed === '') continue;
      for (const line of packed.split(/\r?\n/)) {
        if (line === '' || line.startsWith('#') || line.startsWith('^')) continue;
        const cols = line.split(' ');
        const sha = cols[0];
        const packedRef = cols[1];
        if (sha !== undefined && packedRef === ref && SHA_RE.test(sha)) {
          return sha;
        }
      }
    }
    return undefined; // 复杂形态交给 git 兜底
  } catch {
    return undefined;
  }
}

/**
 * `git rev-parse HEAD` 口径（1 条子进程）——**仅供轮尾兜底与测试/诊断**。
 *
 * 采集器内部（`collectInner` 的 ①）对 `baselineHead === undefined` 的复杂形态直接
 * 跑同一命令，故生产轮首 E1 走零子进程的 `readBaselineHead`（见其注释），本函数
 * 只在测试里作为「git 自己的 HEAD 口径」对照。
 * 失败一律 null（非 git 仓 / 空仓 / git 缺失 / 超时）且**永不抛错**。
 */
export async function resolveBaselineHead(
  workspaceRoot: string,
  exec: TurnFileChangesExecFile = defaultExecFile,
  timeoutMs: number = DEFAULT_TURN_FILE_CHANGES_LIMITS.timeoutMs,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { stdout } = await exec([...GIT_BASE_ARGS, 'rev-parse', 'HEAD'], {
      cwd: workspaceRoot,
      signal: controller.signal,
      timeoutMs,
    });
    const head = stdout.trim();
    return head === '' ? null : head;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
