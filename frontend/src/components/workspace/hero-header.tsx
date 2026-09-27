"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { PageHead, StateLabel } from "@/components/primer";
import { cn } from "@/lib/utils";
import type { Workspace } from "@/lib/workspaces";

interface WorkspaceHeroHeaderProps {
  workspace: Workspace;
  /** 外部操作按钮 slot，渲染在「返回列表」左边（如「编辑我的接入配置」）。 */
  extraActions?: React.ReactNode;
}

// ql-20260829-008：状态中文标签（原样英文 archived/pending 对用户不可读）；
// 未知存量值回退原值显示。
const WORKSPACE_STATUS_LABEL: Record<string, string> = {
  active: "活跃",
  archived: "已归档",
  pending: "待激活",
  deleted: "已删除",
};

/**
 * 2026-09-26 重排（FR-06 / D-001@v1）：深色渐变 Hero 退役，改 GitHub Repo 首页式
 * 白底页头（PageHead + StateLabel 状态胶囊 + slug mono 副标题）——props 契约不变
 * （workspace + extraActions），调用方零改动；对照原型「工作区概览」视图。
 */
export function WorkspaceHeroHeader({
  workspace,
  extraActions,
}: WorkspaceHeroHeaderProps): JSX.Element {
  return (
    <PageHead
      title={workspace.name}
      titleExtra={
        <StateLabel
          variant={workspace.status === "active" ? "done" : "neutral"}
          size="md"
        >
          {WORKSPACE_STATUS_LABEL[workspace.status] ?? workspace.status}
        </StateLabel>
      }
      subtitle={<span className="font-mono">{workspace.slug}</span>}
      actions={
        <div className="flex items-center gap-2">
          {extraActions}
          <Link
            href="/workspaces"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            返回列表
          </Link>
        </div>
      }
    />
  );
}
