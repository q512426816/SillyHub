"use client";

import Link from "next/link";
import { Archive, GitBranch, Puzzle, Zap } from "lucide-react";

import { cn } from "@/lib/utils";

interface WorkspaceStatsRowProps {
  workspaceId: string;
  componentCount: number;
  activeChanges: number;
  archivedChanges: number;
  /** 快速修复总条数（QUICKLOG；用户反馈 ql-20260820-013：原"运行时阶段"卡替换）。 */
  quickTotal: number;
}

function StatCard({
  href,
  icon: Icon,
  label,
  value,
  clickable,
}: {
  href?: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  clickable?: boolean;
}) {
  const content = (
    <div
      className={cn(
        // 2026-09-27 visual-gap-fix：换 GitHub Insights 竖排（label 上/mono 大数字下）
        "flex flex-col gap-1 bg-card px-4 py-3 transition",
        clickable
          ? "hover:bg-muted/50"
          : "",
      )}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-mono text-2xl font-semibold leading-8 text-foreground">{value}</p>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block">
        {content}
      </Link>
    );
  }

  return content;
}

export function WorkspaceStatsRow({
  workspaceId,
  componentCount,
  activeChanges,
  archivedChanges,
  quickTotal,
}: WorkspaceStatsRowProps): JSX.Element {
  return (
    <section
      className={cn(
        "grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border lg:grid-cols-4",
      )}
    >
      <StatCard
        href={`/workspaces/${workspaceId}/components`}
        icon={Puzzle}
        label="项目组组件"
        value={componentCount}
        clickable
      />
      <StatCard
        href={`/workspaces/${workspaceId}/changes`}
        icon={GitBranch}
        label="进行中变更"
        value={activeChanges}
        clickable
      />
      <StatCard
        href={`/workspaces/${workspaceId}/changes?tab=archive`}
        icon={Archive}
        label="已归档变更"
        value={archivedChanges}
        clickable
      />
      <StatCard
        href={`/workspaces/${workspaceId}/changes?tab=quicklog`}
        icon={Zap}
        /* 存量口径（2026-09-25-change-center-thin-flow task-09）：quick 通道已退役，
           计数只含存量收尾条目；新的小修复走「轻量变更」。 */
        label="快速修复（存量）"
        value={quickTotal}
        clickable
      />
    </section>
  );
}
