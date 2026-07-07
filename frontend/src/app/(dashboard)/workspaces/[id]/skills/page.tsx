"use client";

import Link from "next/link";

import { PageContainer, PageHeader, SectionCard } from "@/components/layout";
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
        title={
          <span className="flex flex-col gap-0.5">
            <span>自定义 Skills</span>
            <Link
              href={`/workspaces/${workspaceId}`}
              className="text-[11px] font-normal text-muted-foreground hover:underline"
            >
              ← 工作区
            </Link>
          </span>
        }
        subtitle="查看工作区 specDir/skills/ 下的自定义 skill（只读）"
        actions={
          <button
            type="button"
            onClick={() => void refetch()}
            className="inline-flex h-7 items-center rounded border border-border px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            刷新
          </button>
        }
      />

      {isError && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {error?.message ?? "加载自定义 skills 失败"}
        </div>
      )}

      {isLoading && (
        <p className="py-8 text-center text-xs text-muted-foreground">
          加载中...
        </p>
      )}

      {!isLoading && !isError && skills.length === 0 && (
        <SectionCard>
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <p className="text-sm text-muted-foreground">暂无自定义 skill</p>
            <p className="text-[11px] text-muted-foreground">
              在 specDir/skills/ 下创建 skill 目录后，将在此只读展示。
            </p>
          </div>
        </SectionCard>
      )}

      {!isLoading && !isError && skills.length > 0 && (
        <div className="space-y-2">
          {skills.map((skill) => (
            <SectionCard key={skill.name}>
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
