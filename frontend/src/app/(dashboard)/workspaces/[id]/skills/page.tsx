"use client";

import Link from "next/link";
import { Wrench } from "lucide-react";

import { PageContainer, PageHeader, SectionCard } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-banner";
import { StatusBadge } from "@/components/ui/status-badge";
import { useWorkspaceSkills } from "@/lib/workspace-skills-view";

interface Props {
  params: { id: string };
}

/**
 * Workspace Skills 子页（task-10，变更 2026-07-07-skills-mcp-management-ui）。
 *
 * 只读列出 workspace specDir/skills/ 下的自定义 skill（名 + 文件清单）。
 * D-006：只读——无编辑/上传/删除按钮。数据来自 useWorkspaceSkills（react-query）。
 * membership 校验由详情页 layout 的 WorkspaceBindingGuard 完成，本页不重复校验。
 */
export default function WorkspaceSkillsPage({ params }: Props) {
  const workspaceId = params.id;
  const { skills, isLoading, isError, error, refetch } =
    useWorkspaceSkills(workspaceId);

  return (
    <PageContainer>
      <PageHeader
        title="自定义 Skills"
        subtitle="查看工作区 specDir/skills/ 下的自定义 skill（只读）"
        actions={
          <div className="flex items-center gap-2">
            <Link
              href={`/workspaces/${workspaceId}`}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              ← 工作区
            </Link>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refetch()}
            >
              刷新
            </Button>
          </div>
        }
      />

      {isError && (
        <ErrorBanner message={error?.message ?? "加载自定义 skills 失败"} />
      )}

      {isLoading && (
        <p className="py-8 text-center text-xs text-muted-foreground">
          加载中...
        </p>
      )}

      {!isLoading && !isError && skills.length === 0 && (
        <SectionCard>
          <EmptyState
            icon={<Wrench className="h-5 w-5" />}
            title="暂无自定义 skill"
            description="在 specDir/skills/ 下创建 skill 目录后，将在此只读展示。"
          />
        </SectionCard>
      )}

      {!isLoading && !isError && skills.length > 0 && (
        <div className="space-y-2">
          {skills.map((skill) => (
            <SectionCard key={skill.name} hover="lift">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-sm font-semibold">{skill.name}</span>
                <StatusBadge kind="neutral">
                  {skill.files.length} 个文件
                </StatusBadge>
              </div>
              {skill.files.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  该 skill 目录下暂无文件。
                </p>
              ) : (
                <ul className="grid gap-0.5 font-mono text-[11px] text-muted-foreground">
                  {skill.files.map((f) => (
                    <li key={f} className="truncate">
                      {f}
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
