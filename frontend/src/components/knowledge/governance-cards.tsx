/**
 * GovernanceCards — 知识治理信号卡（2026-09-27-knowledge-governance-cards）。
 *
 * 三层治理②层的平台出口：知识 tab 顶部信号卡区。数据链 useQuery 消费
 * GET /knowledge/governance（getKnowledgeGovernance 封装，与 OpsDashboard
 * stats 同款模式）。healthy 一行安语（安静即健康态，防仪式化）；超阈逐卡
 * （kind/计数/明细/处置指引——CLI 命令文案，动作回传 v2 走 merge/reject 同款 RPC）。
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Inbox, Map, Stethoscope } from "lucide-react";

import {
  getKnowledgeGovernance,
  type GovernanceSignal,
} from "@/lib/knowledge";
import { cn } from "@/lib/utils";

export const governanceQueryKey = (workspaceId: string) => [
  "workspaces",
  workspaceId,
  "knowledge",
  "governance",
];

const SIGNAL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  rot: Stethoscope,
  inbox: Inbox,
  "pseudo-domain": Map,
};

const SIGNAL_LABELS: Record<string, string> = {
  rot: "待复核批量标记",
  inbox: "收件箱积压",
  "pseudo-domain": "伪域在库",
};

function SignalCard({ signal }: { signal: GovernanceSignal }) {
  const Icon = SIGNAL_ICONS[signal.kind] ?? AlertTriangle;
  const label = SIGNAL_LABELS[signal.kind] ?? signal.kind;
  return (
    <div
      data-testid={`governance-card-${signal.kind}`}
      className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950/40"
    >
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-amber-600 dark:text-amber-400" />
        <span className="text-sm font-medium">{label}</span>
        <span className="ml-auto font-mono text-sm text-amber-700 dark:text-amber-300">
          {signal.count}
        </span>
      </div>
      {signal.detail ? (
        <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">{signal.detail}</p>
      ) : null}
      <p className="mt-1.5 text-xs text-muted-foreground">
        处置：<span className="font-mono">{signal.suggestion}</span>
      </p>
    </div>
  );
}

export function GovernanceCards({ workspaceId }: { workspaceId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: governanceQueryKey(workspaceId),
    queryFn: () => getKnowledgeGovernance(workspaceId),
  });

  if (isLoading) {
    return (
      <section data-testid="governance-cards" className="text-xs text-muted-foreground">
        治理信号加载中…
      </section>
    );
  }
  if (isError || !data) {
    return (
      <section data-testid="governance-cards" className="text-xs text-muted-foreground">
        治理信号暂不可用
      </section>
    );
  }

  if (data.healthy) {
    return (
      <section
        data-testid="governance-cards"
        className={cn(
          "rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-xs text-green-800",
          "dark:border-green-800 dark:bg-green-950/40 dark:text-green-300",
        )}
      >
        ✅ 治理信号全部在阈内（待复核/收件箱/伪域）——安静即健康态，无需动作
        <span className="ml-2 font-mono text-[11px] text-muted-foreground">
          底数：rot {data.totals.rot ?? 0}｜收件箱 {data.totals.inbox ?? 0}｜伪域{" "}
          {data.totals.pseudo ?? 0}
          {data.totals.unmapped_pool ? `｜unmapped 池 ${data.totals.unmapped_pool}` : ""}
        </span>
      </section>
    );
  }

  return (
    <section data-testid="governance-cards" className="space-y-2">
      <p className="text-xs text-muted-foreground">
        ⚠️ {data.signals.length} 类治理信号超阈（处置指引为 CLI 命令，动作回传 v2）：
      </p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {data.signals.map((s) => (
          <SignalCard key={s.kind} signal={s} />
        ))}
      </div>
    </section>
  );
}
