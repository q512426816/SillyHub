"use client";

/**
 * agent-log/agent-liveness-overview-card.tsx —— 工作台「Agent 状态总览」卡片。
 *
 * 2026-09-07-agent-liveness-states task-14（design §5.4 D-004 两层展示第二层 /
 * FR-05）：会话列表空间紧张，完整状态信息只出现在本卡（分组计数 + 「在等你」
 * 组明细与跳转）与 agent 日志面板行徽章两处。数据 GET /api/agent-logs（daemon
 * liveness tailer 每 10s 推送落库，30s 轮询刷新即可满足 ≤40s 可见性口径；
 * 卡内计数为快照非实时）。双主题铁律：语义色阶（info/warning/destructive/muted）。
 */
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/zh-cn";

import { SectionCard } from "@/components/layout";
import { LIVENESS_META, livenessTitle } from "@/components/agent-log/liveness-badge";
import { LivenessDot } from "@/components/agent-log/liveness-badge";
import { listWorkspaceAgentLogs, type AgentLogListItem } from "@/lib/agent-logs";
import { cn } from "@/lib/utils";

dayjs.extend(relativeTime);
dayjs.locale("zh-cn");

/** 展示顺序：在等你 > 在干活 > 空闲 > 已结束 > 未知（人数多的状态在前无意义，按紧急度）。 */
const STATE_ORDER = ["blocked", "working", "idle", "ended", "unknown"] as const;

export function AgentLivenessOverviewCard({ workspaceId }: { workspaceId: string }) {
  const q = useQuery({
    queryKey: ["agent-liveness-overview", workspaceId],
    queryFn: () => listWorkspaceAgentLogs(100),
    refetchInterval: 30_000,
  });
  const entries = q.data?.items ?? [];
  const byState = new Map<NonNullable<AgentLogListItem["state"]>, AgentLogListItem[]>(
    STATE_ORDER.map((st) => [st, []]),
  );
  for (const e of entries) {
    byState.get(e.state)?.push(e);
  }
  const blocked = byState.get("blocked") ?? [];

  return (
    <SectionCard
      title="Agent 状态总览"
      bodyPadding="p-4"
      extra={
        <span className="text-[11px] text-muted-foreground">
          {q.isFetching ? "刷新中…" : entries.length > 0 ? "≤30s 快照" : ""}
        </span>
      }
    >
      {q.isError ? (
        <p className="text-xs text-muted-foreground">状态加载失败，稍后自动重试。</p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          暂无已登记的 agent 会话（daemon 在线并上报后此处展示各会话活性）。
        </p>
      ) : (
        <div className="space-y-3">
          {/* 分组计数行 */}
          <div className="flex flex-wrap items-center gap-2" data-testid="liveness-overview-counts">
            {STATE_ORDER.filter((st) => (byState.get(st) ?? []).length > 0).map((st) => {
              const meta = LIVENESS_META[st];
              const n = (byState.get(st) ?? []).length;
              return (
                <span
                  key={st}
                  className={cn(
                    "inline-flex h-5 items-center gap-1 rounded-full border px-2 text-[11px]",
                    meta.badgeCls,
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full", meta.dotCls, meta.pulse && "animate-pulse")} />
                  {meta.label}（{n}）
                </span>
              );
            })}
          </div>
          {/* 「在等你」明细：会话 + 等待时长 + 跳转（D-004：完整信息只在此处） */}
          {blocked.length > 0 && (
            <ul className="space-y-1.5" data-testid="liveness-overview-blocked">
              {blocked.slice(0, 5).map((e) => (
                <li
                  key={e.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-2.5 py-1.5 text-xs"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <LivenessDot state="blocked" />
                    <span className="truncate">
                      {e.harness}
                      {e.session_id ? ` · ${e.session_id.slice(0, 8)}` : ""}
                      <span className="text-muted-foreground">
                        {e.last_event_at ? ` · 等待 ${dayjs(e.last_event_at).fromNow(true)}` : ""}
                      </span>
                    </span>
                  </span>
                  <Link
                    href={`/workspaces/${workspaceId}/sessions`}
                    className="shrink-0 text-info-600 hover:underline"
                  >
                    去处理 →
                  </Link>
                </li>
              ))}
              {blocked.length > 5 && (
                <li className="px-2.5 text-[11px] text-muted-foreground">另有 {blocked.length - 5} 个会话在等你…</li>
              )}
            </ul>
          )}
        </div>
      )}
    </SectionCard>
  );
}
