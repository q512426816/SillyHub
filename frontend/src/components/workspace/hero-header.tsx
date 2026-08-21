"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Workspace } from "@/lib/workspaces";

interface WorkspaceHeroHeaderProps {
  workspace: Workspace;
  /** 外部操作按钮 slot，渲染在「返回列表」左边（如「编辑我的接入配置」）。 */
  extraActions?: React.ReactNode;
}

export function WorkspaceHeroHeader({
  workspace,
  extraActions,
}: WorkspaceHeroHeaderProps): JSX.Element {
  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-lg bg-gradient-to-br from-brand-700 via-brand-800 to-slate-950 px-6 py-6 text-white shadow-sm",
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        {/* 左侧：名称 + 状态 + slug */}
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
              {workspace.name}
            </h1>
            <Badge
              variant={workspace.status === "active" ? "success" : "outline"}
              className={cn(
                "shrink-0 border-white/20 text-[11px]",
                workspace.status === "active"
                  ? "bg-white/10 text-white"
                  : "bg-transparent text-white/80",
              )}
            >
              {workspace.status === "active" ? "活跃" : workspace.status}
            </Badge>
          </div>
          <p className="font-mono text-xs text-white/60">{workspace.slug}</p>
        </div>

        {/* 右侧：操作组（ql-20260821-003：编辑信息与基本信息卡头重复已删；
            extraActions slot 供外部按钮（编辑我的接入配置）挂在返回列表左边） */}
        <div className="flex shrink-0 items-center gap-2">
          {extraActions}
          <Link
            href="/workspaces"
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white",
            )}
          >
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            返回列表
          </Link>
        </div>
      </div>
    </section>
  );
}
