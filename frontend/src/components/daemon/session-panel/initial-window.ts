/**
 * 2026-10-23-session-first-window-turn-align：会话首屏自适应窗口编排。
 *
 * 背景（生产会话 f815989f / 16f0ef66 实证）：首屏历史此前按「最近 400 行日志」
 * 硬切，工具调用/输出把一轮日志撑到 400 行以上后，窗口起点落在轮中段，轮首
 * user_input 与更早轮次被截到窗口外——用户重新进入页面就像自己发的消息丢了
 * （数据实际都在 DB，顶部「加载更早消息」可翻到）。
 *
 * 本模块把「按行硬切」升级为「轮次对齐 + 预算自适应」，设计对齐
 * deepseek-harness 的分页语义（首屏至少 50 条消息 / 至少 2 个 turn，最多 500
 * 条消息；在 turn 边界裁切）：
 *   1. 底窗仍是最近 HISTORY_PAGE_SIZE 行（保持既有请求与翻页游标口径）；
 *   2. 若底窗最旧行所在轮被截断（紧邻更早一行同 run），直达拉该轮并与底窗行
 *      合并去重——直达 ASC 上限可能丢尾部，合并而非替换可保证窗口段不丢；
 *   3. 若底窗覆盖轮数不足 INITIAL_WINDOW_MIN_TURNS，从更早轮向前补，直到满足
 *      轮数下限、预算耗尽（INITIAL_WINDOW_BUDGET_LOGS）或单轮直达触达
 *      RUN_LOGS_MAX（可能截断，停而不采纳，避免轮间留洞）。
 * 小会话（日志不足一页）原样返回，天然全量。
 *
 * 纯编排：网络请求由调用方注入（fetchRunLogs / probeEarlier），便于单测与降级。
 */

import type { AgentRunLogEntry } from "@/lib/agent";
import type { SessionRunRead } from "@/lib/daemon/sessions";
import { HISTORY_PAGE_SIZE } from "./turn-state";

/**
 * 首屏覆盖轮数的语义下限（对齐 deepseek-harness 的 minTurns=2）。预算允许时
 * 会继续向前补到全量；预算/单轮上限不足时以硬上限为准（评审 P1：不做「2 轮
 * 即停」的额外截断）。
 */
export const INITIAL_WINDOW_MIN_TURNS = 2;

/** 首屏合并后日志行预算（含底窗；超预算停止向前补拉）。 */
export const INITIAL_WINDOW_BUDGET_LOGS = 3000;

/** 单轮直达端点上限（后端 _SESSION_RUN_LOGS_MAX=2000；触达即可能截断）。 */
export const RUN_LOGS_MAX = 2000;

export interface InitialWindowDeps {
  /** 底窗日志（最新 HISTORY_PAGE_SIZE 行语义，后端升序返回）。 */
  baseLogs: AgentRunLogEntry[];
  /** 轮次快照（listSessionRuns，created_at desc；失败/空则降级只做截断轮对齐）。 */
  runs: SessionRunRead[] | null;
  /** 探测紧邻底窗最旧行之前的一条日志（before + beforeId + limit=1）。 */
  probeEarlier: (_oldest: AgentRunLogEntry) => Promise<AgentRunLogEntry[]>;
  /** 单轮直达（{ runId } 升序，上限 RUN_LOGS_MAX）。 */
  fetchRunLogs: (_runId: string) => Promise<AgentRunLogEntry[]>;
  /** 测试可覆盖的预算参数（缺省用模块常量）。 */
  pageSize?: number;
  budget?: number;
}

export interface InitialWindowResult {
  /** 自适应合并后的行集（升序，轮次从早到晚）。 */
  logs: AgentRunLogEntry[];
  /** 是否发生了补拉/合并（测试与调试断言用）。 */
  extended: boolean;
  /**
   * 「加载更早」翻页游标锚点。直达结果完整时取合并后最旧行（或最早已补轮首行）；
   * 直达触达 2000 上限（可能缺中段）时**保持底窗最旧行**——游标前移到轮首会让
   * 缺口永久不可回补（评审 P2，2026-10-23）。
   */
  cursorLog: AgentRunLogEntry | null;
}

function groupByRun(logs: AgentRunLogEntry[]): Map<string, AgentRunLogEntry[]> {
  const map = new Map<string, AgentRunLogEntry[]>();
  for (const log of logs) {
    const list = map.get(log.run_id);
    if (list) list.push(log);
    else map.set(log.run_id, [log]);
  }
  return map;
}

/** 时间最旧行（同 ts 取 id 字典序最小——与后端 ts,id 稳定排序同向）。 */
function oldestOf(logs: AgentRunLogEntry[]): AgentRunLogEntry | null {
  let oldest: AgentRunLogEntry | null = null;
  for (const log of logs) {
    if (
      oldest === null ||
      log.timestamp < oldest.timestamp ||
      (log.timestamp === oldest.timestamp && log.id < oldest.id)
    ) {
      oldest = log;
    }
  }
  return oldest;
}

/** 直达结果 + 底窗补尾：full 顺序为基，base 中不在 full 的行按原序追加。 */
function mergeRunLogs(
  full: AgentRunLogEntry[],
  baseRows: AgentRunLogEntry[],
): AgentRunLogEntry[] {
  const seen = new Set(full.map((l) => l.id));
  const tail = baseRows.filter((l) => !seen.has(l.id));
  return tail.length > 0 ? [...full, ...tail] : full;
}

/** 某批行的最大时间戳（空数组 null）。 */
function maxTimestampOf(logs: AgentRunLogEntry[]): string | null {
  let max: string | null = null;
  for (const log of logs) {
    if (max === null || log.timestamp > max) max = log.timestamp;
  }
  return max;
}

/**
 * 构建首屏自适应窗口。任何补拉失败都降级为已获得的行集（不阻断首屏）。
 *
 * 停止条件（对齐 deepseek-harness 的「硬上限」语义）：预算 INITIAL_WINDOW_BUDGET_LOGS
 * 行耗尽、更早轮直达触达 RUN_LOGS_MAX（可能截断，不采纳）、请求失败或到头。
 * 小会话（总行数 ≤ 预算）因此全量加载，不做「2 轮即停」的额外截断
 * （评审 P1，2026-10-23）。
 */
export async function buildInitialWindow(
  deps: InitialWindowDeps,
): Promise<InitialWindowResult> {
  const pageSize = deps.pageSize ?? HISTORY_PAGE_SIZE;
  const budget = deps.budget ?? INITIAL_WINDOW_BUDGET_LOGS;
  const { baseLogs, runs, probeEarlier, fetchRunLogs } = deps;

  // 不足一页 = 首屏已是全量历史（既有 hasEarlier 口径），无需自适应。
  if (baseLogs.length < pageSize) {
    return { logs: baseLogs, extended: false, cursorLog: null };
  }

  const baseByRun = groupByRun(baseLogs);
  const oldest = oldestOf(baseLogs);
  if (oldest === null) return { logs: baseLogs, extended: false, cursorLog: null };

  let extended = false;
  const runLogs = new Map<string, AgentRunLogEntry[]>();
  let mergedCount = baseLogs.length;
  let truncatedFull: AgentRunLogEntry[] | null = null;

  // ── 1) 窗口起点轮是否被截断：probe 紧邻更早一行同 run 即判定 ────────────
  let truncatedRunId: string | null = null;
  try {
    const probe = await probeEarlier(oldest);
    if (probe.length > 0 && probe[0]!.run_id === oldest.run_id) {
      truncatedRunId = oldest.run_id;
    }
  } catch {
    // probe 失败：无法判定截断，降级保持底窗（不额外拉取）。
    truncatedRunId = null;
  }

  if (truncatedRunId !== null) {
    try {
      const full = await fetchRunLogs(truncatedRunId);
      if (full.length > 0) {
        const merged = mergeRunLogs(full, baseByRun.get(truncatedRunId) ?? []);
        runLogs.set(truncatedRunId, merged);
        mergedCount = mergedCount - (baseByRun.get(truncatedRunId)?.length ?? 0) + merged.length;
        truncatedFull = full;
        extended = true;
      }
    } catch {
      // 直达失败：保留底窗该轮行，首屏不阻断。
    }
  }

  // ── 2) 持续向前补更早轮，直到预算/单轮上限/到头 ────────────────────────
  const earlierRuns: AgentRunLogEntry[][] = [];
  const covered = new Set(baseByRun.keys());
  if (runs !== null && runs.length > 0) {
    const runsAsc = [...runs].sort(
      (a, b) =>
        a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
    );
    const anchorIdx = runsAsc.findIndex((r) => r.id === oldest.run_id);
    if (anchorIdx > 0) {
      for (let i = anchorIdx - 1; i >= 0; i -= 1) {
        const run = runsAsc[i]!;
        if (covered.has(run.id)) continue;
        let full: AgentRunLogEntry[];
        try {
          full = await fetchRunLogs(run.id);
        } catch {
          break;
        }
        if (full.length === 0) break;
        // 触达单轮上限 = 可能截断（ASC 丢尾部）；不采纳，避免轮间留无法回补的洞。
        if (full.length >= RUN_LOGS_MAX) break;
        if (mergedCount + full.length > budget) break;
        earlierRuns.push(full);
        covered.add(run.id);
        mergedCount += full.length;
        extended = true;
      }
    }
  }

  // ── 3) 组装：更早轮（时间升序）→ 底窗原有轮顺序（截断轮已合并） ─────────
  const ordered: AgentRunLogEntry[] = [];
  for (let i = earlierRuns.length - 1; i >= 0; i -= 1) {
    ordered.push(...earlierRuns[i]!);
  }
  for (const [runId, rows] of baseByRun) {
    ordered.push(...(runLogs.get(runId) ?? rows));
  }

  // ── 4) 翻页游标（评审 P2）：直达不完整时不得前移，否则中段缺口不可回补 ──
  let cursorLog: AgentRunLogEntry | null = oldest;
  if (truncatedFull !== null) {
    const pageMax = maxTimestampOf(baseByRun.get(truncatedRunId!) ?? []);
    const directMax = maxTimestampOf(truncatedFull);
    const complete = pageMax === null || (directMax !== null && directMax >= pageMax);
    if (!complete) {
      // 直达 ASC 截断：保留底窗最旧行作游标，翻页可逐页回补中段（重复由去重吞掉）。
      cursorLog = oldest;
    } else if (earlierRuns.length > 0) {
      cursorLog = earlierRuns[earlierRuns.length - 1]![0] ?? oldestOf(ordered);
    } else {
      cursorLog = oldestOf(ordered) ?? oldest;
    }
  } else if (earlierRuns.length > 0) {
    cursorLog = earlierRuns[earlierRuns.length - 1]![0] ?? oldest;
  }
  return { logs: ordered, extended, cursorLog };
}
