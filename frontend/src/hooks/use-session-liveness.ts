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
 * - 转移检测状态机（2026-10-15-session-turn-completion-semantics 重定义）：
 *   每轮数据到达对每个会话读 localStorage `sillyhub:liveness-state:${id}` 得
 *   prevState；prevState ∈ {working, blocked} 且 current == idle → 一轮执行
 *   结束，写完成通知标记 `sillyhub:session-completed-unread:${id}`（绿色
 *   「此会话已执行完成」角标，取代原红色「空闲未读」——展示与清除归
 *   session-list-panel，标记存储在 lib/session-completed-unread）。首见（无
 *   prevState）不触发；不用 state_derived_at 做判定（它是 tailer 每 10s 无条件
 *   覆写的心跳戳）。opts.suppress(sessionId) 为真的会话跳过标记（面板传
 *   「正选中该会话」——用户就在其上看完收尾，无需通知）。
 * - localStorage 读写全程 try/catch 降级——存储不可用时转移检测停摆（不亮
 *   角标）不崩溃。
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { listWorkspaceAgentLogs, type AgentLogListItem } from "@/lib/agent-logs";
import { markCompletedUnread } from "@/lib/session-completed-unread";

/**
 * 固定缓存槽（D-001@v2 / Grill CC-01 修订）：第二段恒 "all"——与工作台总览卡
 * 的 ["agent-liveness-overview", wsId] 各自独立，多挂载共享缓存与轮询。
 */
export const SESSION_LIVENESS_QUERY_KEY = ["agent-liveness-overview", "all"] as const;

/** 轮询间隔（ms）：30s 兜底刷新（daemon liveness tailer 每 10s 推送落库）。 */
const LIVENESS_POLL_INTERVAL_MS = 30_000;

/** 拉取条数上限：100，对齐工作台总览卡口径（design R-02）。 */
const LIVENESS_LIST_LIMIT = 100;

/** localStorage 键前缀（仅本地 UI 状态，不上行；转移检测的 prevState 记忆）。 */
const STATE_KEY_PREFIX = "sillyhub:liveness-state:";

/** 触发轮次完成标记的来源状态（working/blocked → idle 才算「这轮执行结束」）。 */
const COMPLETION_SOURCE_STATES: ReadonlySet<string> = new Set(["working", "blocked"]);

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
    // 存储不可用：转移检测停摆（不亮角标），不崩。
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

/**
 * quick（ql-20260916-007）：空闲降频——opts.enabled 条件轮询。活性灯只在列表存在
 * 进行中会话时才有渲染意义（行不命中 map 不亮灯），全空闲列表挂 30s 轮询是纯
 * 噪音；宿主传 hasActiveSessions（由列表数据派生，无需新请求）。缺省 true 零回归
 * （既有挂载点显式传值）。opts.suppress：轮次完成标记的跳过谓词（面板传
 * 「正选中该会话」——用户就在其上时转移不通知；缺省不跳过）。
 */
export function useSessionLiveness(opts: {
  enabled?: boolean;
  suppress?: (_sessionId: string) => boolean;
} = {}): UseSessionLivenessReturn {
  // 解构后引用（effect deps 收敛到稳定局部量，规避 exhaustive-deps 对整个
  // opts 字面量的告警——opts 缺省 {} 每渲染新引用）。
  const { enabled = true, suppress } = opts;
  const query = useQuery({
    queryKey: SESSION_LIVENESS_QUERY_KEY,
    queryFn: () => listWorkspaceAgentLogs(LIVENESS_LIST_LIMIT),
    refetchInterval: LIVENESS_POLL_INTERVAL_MS,
    enabled,
  });

  const entries = useMemo(() => query.data?.items ?? [], [query.data]);
  const bySessionId = useMemo(
    () => buildLivenessBySessionId(entries),
    [entries],
  );

  // 转移检测状态机（2026-10-15-session-turn-completion-semantics 重定义）：
  // effect 里跑（不在渲染期写 localStorage）；completedEpoch 在本轮标记过完成
  // 时自增——isCompletedUnread 是模块函数读存储，宿主组件需要一次重渲染才能
  // 在渲染期取到新标记值（setState 即触发，无需进 deps）。
  const [, setCompletedEpoch] = useState(0);
  useEffect(() => {
    let marked = false;
    for (const [sessionId, entry] of bySessionId) {
      const current = entry.state;
      const prev = readLastState(sessionId);
      if (
        prev !== null &&
        COMPLETION_SOURCE_STATES.has(prev) &&
        current === "idle" &&
        !suppress?.(sessionId)
      ) {
        markCompletedUnread(sessionId);
        marked = true;
      }
      if (prev !== current) writeLastState(sessionId, current);
    }
    if (marked) setCompletedEpoch((n) => n + 1);
  }, [bySessionId, suppress]);

  return { bySessionId, entries, isLoading: query.isLoading };
}
