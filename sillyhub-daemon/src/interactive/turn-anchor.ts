/**
 * interactive/turn-anchor.ts —— 轮锚点快照（2026-10-13-daemon-turn-anchor-snapshot
 * FR-01，轮次文件变化追踪 Route B 真相源最小闭环）。
 *
 * 职责：agent 每轮结束（onResult turn 边界）对会话 cwd 的 git 工作区打**内容锚点**，
 * 与该会话上一锚 diff 出逐文件 additions/deletions，追加 JSONL 到
 * `<daemonStateDir>/.runtime/turn-anchors/<sessionId>.jsonl`，供平台后续轮锚对账
 * 消费（rows/totals 形状已与 flow diff --json 对齐——toFlowDiffShape 投影口 +
 * 记录内嵌 totals，2026-10-13-turn-anchor-flowdiff-shape）。
 *
 * 锚形态（评审定案，Gap1 防漏）：
 *   - **复制现场 index → GIT_INDEX_FILE 下 `git add -A` → `git write-tree`**：
 *     复制现场 index 让 add -A 命中 stat 缓存（只有真正变化的文件重新哈希，成本
 *     ≈ 一次 git status，不是全仓重扫）；add -A 天然覆盖 **untracked 新文件**
 *     （`git stash create` 不含未跟踪是评审明确定性过的雷——agent 主要产出恰恰
 *     是新文件）；tree sha 内容寻址，两锚相同 = 零变化，天然去重免存储。
 *   - 同时记 `rev-parse HEAD`（区分「未提交改动」与「新提交进来」留给消费方）。
 *   - diff 基线：有上一锚用上一锚（tree-to-tree 捕获轮间**全部**内容变化，含轮内
 *     commit——这正是 Route B「真实」语义）；首轮无上一锚退 HEAD 树（轮内已 commit
 *     的部分会被 HEAD 吸收，最小闭环的已知边界，design 有记）；空仓（无 HEAD 无
 *     prev）files 留空。
 *
 * 失败安全（观测面不抛穿）：非 git 目录 / git 不可用 / 任何 git 错误 → 返回 null；
 * 接线方 fire-and-forget，不阻塞轮结果链路。同会话并发轮经 per-session promise 链
 * 串行化（prev 锚读写无竞态）；prev 锚优先内存、miss（daemon 重启）时读 JSONL 尾行。
 *
 * Windows：execFile 直跑 `git`（daemon 已假定 git 在 PATH，host-fs-handler 同款），
 * 临时 index 落 os.tmpdir() 绝对路径；中文路径经 `-c core.quotePath=false` 原样
 * UTF-8 输出（numstat 默认会转义非 ASCII）。
 *
 * @module interactive/turn-anchor
 */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFile, copyFile, mkdir, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { daemonStateDir } from '../config.js';

const execFileAsync = promisify(execFile);

/** 单次 git 子命令超时（对齐 host-fs-handler runCommand 15s 惯例）。 */
const GIT_TIMEOUT_MS = 15_000;
/** git 输出缓冲上限（write-tree/diff-tree 输出远小于此，防御性兜底）。 */
const GIT_MAX_BUFFER = 16 * 1024 * 1024;

/** 逐文件行级统计；二进制文件 git numstat 记 "-"，映射为 null（不伪造行数）。 */
export interface TurnAnchorFileStat {
  path: string;
  additions: number | null;
  deletions: number | null;
}

/** 行数加总口径（与 sillyspec flow diff --json 的 totals 同语义）：files=行数；null 行不计入加总。 */
export interface TurnAnchorTotals {
  files: number;
  additions: number;
  deletions: number;
}

/** 一条轮锚记录（JSONL 单行，字段名与 flow diff --json 的 rows 同风格）。 */
export interface TurnAnchorRecord {
  sessionId: string;
  runId: string | null;
  /** ISO 时间戳（轮边界时刻）。 */
  ts: string;
  /** 打锚时的 HEAD sha；空仓/异常为 null。 */
  headSha: string | null;
  /** 本锚工作区全量内容树（add -A 后 write-tree）。 */
  treeSha: string;
  /** 上一锚 treeSha（首轮 null）；去重判定与 diff 基线。 */
  prevTreeSha: string | null;
  /** true = 与上一锚内容树相同（零变化轮），不落盘不计数。 */
  deduped: boolean;
  /** 基线→本锚的逐文件变化；deduped=true 或无基线（空仓首轮）为空数组。 */
  files: TurnAnchorFileStat[];
  /**
   * files 的加总（2026-10-13-turn-anchor-flowdiff-shape，additive）：落盘时随 files 同算；
   * 消费方经 toFlowDiffShape 取用（投影不信任存量字段、始终重算——旧记录无此键零破坏）。
   */
  totals: TurnAnchorTotals;
}

/** 默认锚存储目录：<daemonStateDir>/.runtime/turn-anchors（SILLYHUB_DAEMON_DIR 可覆盖）。 */
export function defaultAnchorsDir(): string {
  return join(daemonStateDir(), '.runtime', 'turn-anchors');
}

/** git 子命令包装：execFile 非 shell（防注入）+ 超时 + 可选额外 env（GIT_INDEX_FILE）。 */
async function git(
  cwd: string,
  args: string[],
  extraEnv?: Record<string, string>,
): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    windowsHide: true,
  });
  return stdout;
}

/**
 * 工作区内容树快照：复制现场 index → 临时 index 上 add -A → write-tree。
 * 非 git 目录 / git 失败 → 抛错由上层 recordTurnAnchor 收口为 null。
 */
async function snapshotWorktree(
  cwd: string,
): Promise<{ treeSha: string; headSha: string | null }> {
  // 现场 index 路径（--git-path 相对 cwd 输出，需归一为绝对路径）。
  const indexRel = (await git(cwd, ['rev-parse', '--git-path', 'index'])).trim();
  const indexPath = isAbsolute(indexRel) ? indexRel : resolve(cwd, indexRel);
  const tmpIndex = join(tmpdir(), `turn-anchor-index-${process.pid}-${randomUUID().slice(0, 8)}`);
  try {
    // 复制现场 index（stat 缓存暖场）；空仓无 index 文件 → 忽略，add 自建。
    await copyFile(indexPath, tmpIndex).catch(() => undefined);
    const env = { GIT_INDEX_FILE: tmpIndex };
    await git(cwd, ['add', '-A', '--'], env);
    const treeSha = (await git(cwd, ['write-tree'], env)).trim();
    let headSha: string | null = null;
    try {
      headSha = (await git(cwd, ['rev-parse', 'HEAD'])).trim();
    } catch {
      // 空仓（无任何提交）：headSha=null，消费方按「无提交基线」理解。
    }
    return { treeSha, headSha };
  } finally {
    await unlink(tmpIndex).catch(() => undefined);
  }
}

/** 两棵树 diff 为逐文件行级统计（--no-renames：改名记删+增两行，口径简单可加总）。 */
async function diffTrees(
  cwd: string,
  baseTree: string,
  nextTree: string,
): Promise<TurnAnchorFileStat[]> {
  const out = await git(cwd, [
    '-c', 'core.quotePath=false',
    'diff-tree', '-r', '--numstat', '--no-renames',
    baseTree, nextTree,
  ]);
  return out
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const cols = line.split('\t');
      const adds = cols[0];
      const dels = cols[1];
      // numstat 行 = "adds\tdels\tpath"；路径含 \t 时剩余列并回（罕见，保守拼接）。
      const path = cols.slice(2).join('\t');
      if (adds === undefined || dels === undefined || path === '') return null;
      return {
        path,
        additions: adds === '-' ? null : Number(adds),
        deletions: dels === '-' ? null : Number(dels),
      };
    })
    .filter((entry): entry is TurnAnchorFileStat => entry !== null);
}

/* ── 模块级运行态（per-session）：prev 锚内存 + 并发轮串行链 ── */
const _lastTreeBySession = new Map<string, string>();
const _chainBySession = new Map<string, Promise<TurnAnchorRecord | null>>();

/** 读 JSONL 尾行恢复 prev 锚（daemon 重启后内存 miss 的兜底；坏行跳过）。 */
async function readLastRecord(
  anchorsDir: string,
  sessionId: string,
): Promise<TurnAnchorRecord | null> {
  let text: string;
  try {
    text = await readFile(join(anchorsDir, `${sessionId}.jsonl`), 'utf-8');
  } catch {
    return null;
  }
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]!) as TurnAnchorRecord;
    } catch {
      // 尾行截断/坏行：继续向前找最后一条可解析记录。
    }
  }
  return null;
}

/** 实际打锚 + diff + 落盘（只经 recordTurnAnchor 的串行链调用）。 */
async function doRecord(opts: {
  cwd: string;
  sessionId: string;
  runId?: string | null;
  anchorsDir?: string;
}): Promise<TurnAnchorRecord | null> {
  const anchorsDir = opts.anchorsDir ?? defaultAnchorsDir();
  const snap = await snapshotWorktree(opts.cwd); // 失败上抛 → 外层 catch 收口 null
  let prevTreeSha = _lastTreeBySession.get(opts.sessionId) ?? null;
  if (prevTreeSha === null) {
    prevTreeSha = (await readLastRecord(anchorsDir, opts.sessionId))?.treeSha ?? null;
  }
  const deduped = prevTreeSha !== null && prevTreeSha === snap.treeSha;
  const record: TurnAnchorRecord = {
    sessionId: opts.sessionId,
    runId: opts.runId ?? null,
    ts: new Date().toISOString(),
    headSha: snap.headSha,
    treeSha: snap.treeSha,
    prevTreeSha,
    deduped,
    files: [],
    totals: computeTotals([]),
  };
  if (!deduped) {
    // diff 基线：上一锚 → 本锚；首轮退 HEAD 树（轮内已 commit 部分被吸收，design 记边界）。
    const baseTree = prevTreeSha ?? snap.headSha;
    if (baseTree !== null) {
      record.files = await diffTrees(opts.cwd, baseTree, snap.treeSha);
      record.totals = computeTotals(record.files); // 与 files 同源同算（防两处漂移）
    }
    await mkdir(anchorsDir, { recursive: true });
    await appendFile(
      join(anchorsDir, `${opts.sessionId}.jsonl`),
      `${JSON.stringify(record)}\n`,
      'utf-8',
    );
    _lastTreeBySession.set(opts.sessionId, snap.treeSha);
  }
  return record;
}

/**
 * files → totals 折叠（flow diff totals 同语义：null 行不计入加总，files=行数）。
 * toFlowDiffShape 与 doRecord 共用（单一算式两处消费防漂移）。
 */
function computeTotals(files: TurnAnchorFileStat[]): TurnAnchorTotals {
  let additions = 0;
  let deletions = 0;
  for (const f of files) {
    if (Number.isFinite(f.additions)) additions += f.additions as number;
    if (Number.isFinite(f.deletions)) deletions += f.deletions as number;
  }
  return { files: files.length, additions, deletions };
}

/**
 * flow diff 消费契约投影（2026-10-13-turn-anchor-flowdiff-shape）：轮锚记录 → sillyspec
 * `flow diff --json` 的 {rows, totals} 形状——平台消费方一套契约吃轮粒度（本函数）与
 * 变更粒度（flow diff --json）两种数据源。rows=files 原样引用（零复制零改写，不造第二
 * 真相）；totals **不信任存量字段、始终从 files 重算**——存量旧记录无 totals 键零破坏，
 * 新旧记录同口径。维度差异（JSDoc 契约注记）：flow diff 的 rows[].state 是变更粒度三源
 * 区分（committed/dirty/untracked/archived），轮锚 diff 行天然无此维，消费方按缺省理解。
 */
export function toFlowDiffShape(record: TurnAnchorRecord): {
  rows: TurnAnchorFileStat[];
  totals: TurnAnchorTotals;
} {
  return { rows: record.files, totals: computeTotals(record.files) };
}

/**
 * 轮锚点快照入口（永不抛错；失败返回 null）。
 * 同会话并发调用经 per-session promise 链串行化（prev 锚读写无竞态）；
 * 不同会话互不阻塞。onResult 接线为 fire-and-forget（void 调用）。
 */
export async function recordTurnAnchor(opts: {
  cwd: string;
  sessionId: string;
  runId?: string | null;
  anchorsDir?: string;
}): Promise<TurnAnchorRecord | null> {
  const prevChain = _chainBySession.get(opts.sessionId) ?? Promise.resolve(null);
  const task = prevChain
    .catch(() => null) // 前一环失败不断链（失败安全逐轮独立）
    .then(() => doRecord(opts))
    .catch(() => null); // 任何 git/fs 错误 → null，观测面不抛穿
  _chainBySession.set(opts.sessionId, task);
  try {
    return await task;
  } finally {
    if (_chainBySession.get(opts.sessionId) === task) {
      _chainBySession.delete(opts.sessionId);
    }
  }
}
