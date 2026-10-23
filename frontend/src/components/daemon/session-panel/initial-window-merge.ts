/**
 * 2026-10-23-session-first-load-ux：首屏自适应窗口增量合并（两段渲染第二段）。
 *
 * 背景：establish 两段化后底窗（HISTORY_PAGE_SIZE 行）先渲染，buildInitialWindow
 * 在后台完成后需把窗口结果相对底窗的**新增行**prepend 进已渲染时间线——不能
 * 整体替换 turnState（SSE 实时增量/用户占位轮可能已写入，替换会回退丢内容）。
 *
 * 合并语义（对齐「加载更早」load-earlier-full-turn 的轮边界对齐口径）：
 *   1. 新增行 = adaptive.logs 中 id 不在底窗行集的行（earlierRuns 各轮 + 锚点
 *      轮直达补齐段）；
 *   2. 锚点轮（底窗时间最旧行所在 run，与 initial-window 直达判定同源）取
 *      **整轮**（adaptive 中该轮 = 直达全量 + 底窗段合并产物）独立装配一块，
 *      并标记摘除底窗旧块——整轮行已并入新块，旧块不摘会同轮双显；
 *   3. 其余新增轮（earlierRuns，底窗外整轮）按 adaptive 时间序装配成块；
 *   4. 全部 prepend 块 runId 加 `#w<窗口键>` 后缀防 React key 撞（同 run 跨块，
 *      realRunId 保持原值——SSE 增量按 realRunId 取最末块不受影响）；窗口键
 *      取合并窗口时间最旧行（ts 数字串 + id 前 8 位，与翻页 #e 键同构，前缀
 *      #w 区分）。
 *
 * 纯函数：不碰 React state/ref。摘块（replaceRunIds）由调用方 establish 侧
 * 无条件执行——与 handleLoadEarlier 的 survivors 不同，本阶段 SSE 尚未建流，
 * 不存在需要保护运行中块不摘的实时增量链路；运行中锚点轮由调用方把合并块
 * 翻回 running 承接。
 */

import type { AgentRunLogEntry } from "@/lib/agent";
import { logsToTurns } from "@/components/daemon/runtime-session-helpers";
import type { SessionTurnView } from "@/components/daemon/turn-timeline";
import type { InitialWindowResult } from "./initial-window";

/** 剥 prepend 轮块的游标页键后缀（`realRunId#e<pageKey>` / `#w<windowKey>` →
 *  realRunId；非变体块原样返回）。与 session-panel-page 的同名 helper 同构。 */
function stripMergeKeySuffix(runId: string): string {
  const at = runId.indexOf("#");
  return at === -1 ? runId : runId.slice(0, at);
}

/**
 * 剔除与已存在轮块冲突的 prepend 块（评审 P2：补拉在飞期间用户可能已通过
 * 预览卡/导航刻度单轮直达同一 run，#e 块先入时间线；第二段整窗合并再以 #w
 * 块 prepend 会同 run 双块）。
 *
 * 判定「已存在且有内容」——prompt/segments/output 任一非空（对齐
 * fetchAndAttachTurn 的 anyBody 口径）；空壳块（快照补建）不算，保留 prepend
 * 以便整轮内容覆盖。锚点轮由调用方先按 replaceRunIds 摘除，不在 existing 中。
 */
export function filterPrependAgainstExisting(
  prependTurns: SessionTurnView[],
  existingTurns: SessionTurnView[],
): SessionTurnView[] {
  const loadedRuns = new Set<string>();
  for (const t of existingTurns) {
    const body =
      !!(t.prompt ?? "").trim() ||
      (t.segments?.length ?? 0) > 0 ||
      !!(t.output ?? "").trim();
    if (!body) continue;
    const key =
      t.realRunId ??
      (t.runId.startsWith("__") ? null : stripMergeKeySuffix(t.runId));
    if (key != null) loadedRuns.add(key);
  }
  return prependTurns.filter(
    (t) => t.realRunId == null || !loadedRuns.has(t.realRunId),
  );
}

export interface InitialWindowMergeResult {
  /** prepend 进时间线头部的轮块（runId 带 #w 窗口键后缀；空数组=无增量）。 */
  prependTurns: SessionTurnView[];
  /** 底窗中已被整轮合并取代、需摘除的旧块 run id 集合（锚点轮；空=无摘除）。 */
  replaceRunIds: Set<string>;
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

/**
 * 构建首屏窗口相对已渲染底窗的增量合并产物。
 *
 * 无增量形态一律返回空（extended=false 小会话/回退、或窗口与底窗无差集）——
 * 调用方零动作，底窗渲染即终态。
 */
export function buildInitialWindowMerge(
  baseLogs: AgentRunLogEntry[],
  adaptive: InitialWindowResult,
): InitialWindowMergeResult {
  const empty: InitialWindowMergeResult = {
    prependTurns: [],
    replaceRunIds: new Set<string>(),
  };
  // 未扩展（小会话全量 / 锚点不完整整体回退）：底窗即最终窗口。
  if (!adaptive.extended) return empty;

  const baseIds = new Set(baseLogs.map((l) => l.id));
  const added = adaptive.logs.filter((l) => !baseIds.has(l.id));
  if (added.length === 0) return empty;

  // 锚点轮判定（与 initial-window 直达判定同源）：底窗时间最旧行所在 run。
  // 仅当该轮确有新增行（被直达合并补齐）才走「整轮一块 + 摘底窗旧块」。
  const oldest = oldestOf(baseLogs);
  const anchorRunId = oldest?.run_id ?? null;
  const anchorHasAdded =
    anchorRunId !== null && added.some((l) => l.run_id === anchorRunId);

  // 装配输入：非锚点新增行（earlierRuns，时间升序在前）→ 锚点整轮行（最后）。
  // logsToTurns 按 run 分组、块序=输入首见序——锚点轮时间晚于全部 earlierRuns。
  const nonAnchorAdded = added.filter((l) => l.run_id !== anchorRunId);
  const anchorRows = anchorHasAdded
    ? adaptive.logs.filter((l) => l.run_id === anchorRunId)
    : [];
  const assembled = logsToTurns([...nonAnchorAdded, ...anchorRows]);
  if (assembled.length === 0) return empty;

  // 窗口键：合并窗口时间最旧行（翻页 #e 键同构；#w 前缀区分，防与后续翻页撞）。
  const windowOldest = oldestOf(adaptive.logs) ?? oldest;
  const pageKey = windowOldest
    ? `${windowOldest.timestamp.replace(/[^0-9]/g, "")}-${windowOldest.id.slice(0, 8)}`
    : "w";
  const prependTurns = assembled.map((t) => ({
    ...t,
    runId: `${t.realRunId ?? t.runId}#w${pageKey}`,
  }));

  return {
    prependTurns,
    replaceRunIds: anchorHasAdded ? new Set([anchorRunId!]) : new Set<string>(),
  };
}
