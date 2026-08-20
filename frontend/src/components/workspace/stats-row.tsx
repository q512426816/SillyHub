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
        "flex items-center gap-3 bg-card px-4 py-3 transition",
        clickable
          ? "hover:bg-muted/50"
          : "",
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold leading-tight text-foreground">{value}</p>
      </div>
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
        "shadow-sm",
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
        icon={Archive}
        label="已归档变更"
        value={archivedChanges}
      />
      <StatCard
        href={`/workspaces/${workspaceId}/changes`}
        icon={Zap}
        label="快速修复"
        value={quickTotal}
        clickable
      />
    </section>
  );
}
