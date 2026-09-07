/**
 * useSessionLiveness —— 会话列表活性小灯数据源 Hook
 * （2026-09-08-session-list-liveness-dot task-01 / FR-01 / FR-03 /
 * D-001@v2）。
 *
 * design §总体方案 1：
 * - 取数：GET /api/agent-logs（listWorkspaceAgentLogs(100)，对齐总览卡口径），
 *   queryKey 固定槽 ["agent-liveness-overview","all"]——第二段固定 "all" 不带
 *   wsId（API 本就不按 workspace 过滤，鉴权 scope 全量；槽位带 wsId 只会造成
 *   缓存分裂）。本 hook 的所有挂载点共享同一份缓存与 30s 轮询；工作台总览卡
 *   （wsId 槽）与本 hook 各自独立互不干扰。口径 ≤40s 可见性（tailer 10s 推送
 *   + 30s 轮询）。
 * - map 构建：按 API 返回序（last_seen_at DESC）**首个胜出**——同
 *   agent_session_id 多行时取最新行（Grill CC-13），仅收 agent_session_id
 *   有值条目。
 * - 转移检测状态机（D-001@v2 / Grill BL-01 修订）：每轮数据到达对每个会话读
 *   localStorage `sillyhub:liveness-state:${id}` 得 prevState；prevState ∈
 *   {working, blocked} 且 current == idle → 写 `sillyhub:liveness-unread:${id}`
 *   = Date.now()；随后更新 state 键。首见（无 prevState）不触发；不用
 *   state_derived_at 做判定（它是 tailer 每 10s 无条件覆写的心跳戳）。
 * - localStorage 读写全程 try/catch 降级——存储不可用时转移检测停摆（不亮
 *   红点）不崩溃。
 *
 * isUnread/clearUnread 为模块级导出（组件直接调；存储实现细节模块内私有）。
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { listWorkspaceAgentLogs, type AgentLogListItem } from "@/lib/agent-logs";

/**
 * 固定缓存槽（D-001@v2 / Grill CC-01 修订）：第二段恒 "all"——与工作台总览卡
 * 的 ["agent-liveness-overview", wsId] 各自独立，多挂载共享缓存与轮询。
 */
export const SESSION_LIVENESS_QUERY_KEY = ["agent-liveness-overview", "all"] as const;

/** 轮询间隔（ms）：30s 兜底刷新（daemon liveness tailer 每 10s 推送落库）。 */
const LIVENESS_POLL_INTERVAL_MS = 30_000;

/** 拉取条数上限：100，对齐工作台总览卡口径（design R-02）。 */
const LIVENESS_LIST_LIMIT = 100;

/** localStorage 键前缀（仅本地 UI 状态，不上行）。 */
const STATE_KEY_PREFIX = "sillyhub:liveness-state:";
const UNREAD_KEY_PREFIX = "sillyhub:liveness-unread:";

/** 触发未读标记的来源状态（working/blocked → idle 才算「新空闲」）。 */
const UNREAD_SOURCE_STATES: ReadonlySet<string> = new Set(["working", "blocked"]);

/* ── 存储访问（模块内私有，全 try/catch 降级） ─────────────────────────── */

/** 读会话上次见到的 state；无记录/存储不可用 → null（首见语义）。 */
function readLastState(sessionId: string): string | null {
  try {
    return window.localStorage.getItem(STATE_KEY_PREFIX + sessionId);
  } catch {
    return null;
  }
}

/** 写会话当前 state（转移检测的 prevState 记忆）。 */
function writeLastState(sessionId: string, state: string): void {
  try {
    window.localStorage.setItem(STATE_KEY_PREFIX + sessionId, state);
  } catch {
    // 存储不可用：转移检测停摆（不亮红点），不崩。
  }
}

/** 写未读标记（值为发现转移的时刻，仅存在性语义）。 */
function markUnread(sessionId: string): void {
  try {
    window.localStorage.setItem(
      UNREAD_KEY_PREFIX + sessionId,
      String(Date.now()),
    );
  } catch {
    // 同上降级。
  }
}

/** 未读红点判定（组件渲染期直接调；存储不可用恒 false——fail-open 不误亮）。 */
export function isUnread(sessionId: string): boolean {
  try {
    return window.localStorage.getItem(UNREAD_KEY_PREFIX + sessionId) !== null;
  } catch {
    return false;
  }
}

/** 清除未读标记（selected 置真时由 SessionRow useEffect 调，覆盖点击/Enter/深链）。 */
export function clearUnread(sessionId: string): void {
  try {
    window.localStorage.removeItem(UNREAD_KEY_PREFIX + sessionId);
  } catch {
    // 同上降级。
  }
}

/* ── map 构建（纯函数，组件外便于单测推理） ───────────────────────────── */

/**
 * 按 agent_session_id 建映射：仅收有值条目，API 返回序（last_seen_at DESC）
 * **首个胜出**——同 id 后到（更旧）不覆盖。
 */
export function buildLivenessBySessionId(
  entries: AgentLogListItem[],
): Map<string, AgentLogListItem> {
  const map = new Map<string, AgentLogListItem>();
  for (const entry of entries) {
    const sessionId = entry.agent_session_id;
    if (!sessionId) continue;
    if (map.has(sessionId)) continue;
    map.set(sessionId, entry);
  }
  return map;
}

export interface UseSessionLivenessReturn {
  /** key=agent_session_id → 最新活性条目（DESC 首个胜出；仅含有值条目）。 */
  bySessionId: Map<string, AgentLogListItem>;
  /** 原始条目（加载中/失败为空数组）。 */
  entries: AgentLogListItem[];
  /** 首载进行中（fail-open：失败时 map 为空 → 全部行无灯）。 */
  isLoading: boolean;
}

export function useSessionLiveness(): UseSessionLivenessReturn {
  const query = useQuery({
    queryKey: SESSION_LIVENESS_QUERY_KEY,
    queryFn: () => listWorkspaceAgentLogs(LIVENESS_LIST_LIMIT),
    refetchInterval: LIVENESS_POLL_INTERVAL_MS,
  });

  const entries = useMemo(() => query.data?.items ?? [], [query.data]);
  const bySessionId = useMemo(
    () => buildLivenessBySessionId(entries),
    [entries],
  );

  // 转移检测状态机（D-001@v2）：effect 里跑（不在渲染期写 localStorage）；
  // unreadEpoch 在本轮标记过未读时自增——isUnread 是模块函数读存储，宿主组件
  // 需要一次重渲染才能在渲染期取到新标记值（setState 即触发，无需进 deps）。
  const [, setUnreadEpoch] = useState(0);
  useEffect(() => {
    let marked = false;
    for (const [sessionId, entry] of bySessionId) {
      const current = entry.state;
      const prev = readLastState(sessionId);
      if (
        prev !== null &&
        UNREAD_SOURCE_STATES.has(prev) &&
        current === "idle"
      ) {
        markUnread(sessionId);
        marked = true;
      }
      if (prev !== current) writeLastState(sessionId, current);
    }
    if (marked) setUnreadEpoch((n) => n + 1);
  }, [bySessionId]);

  return { bySessionId, entries, isLoading: query.isLoading };
}
