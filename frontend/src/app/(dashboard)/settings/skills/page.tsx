"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  Boxes,
  FileCode2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";

import { CustomSkillEditDialog } from "@/components/custom-skill-edit-dialog";
import { PageContainer, PageHeader, SectionCard } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { errMessage } from "@/lib/errors";
import {
  useCreateCustomSkill,
  useCustomSkills,
  useDeleteCustomSkill,
  usePlatformSkillsManifest,
  useUpdateCustomSkill,
  type CustomSkillRead,
} from "@/lib/custom-skills";
import { useSession } from "@/stores/session";
import { cn } from "@/lib/utils";

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("zh-CN");
}

/** 从 manifest files[] 聚合「顶层 skill 目录」列表（一个 skill = 一个一级目录）。 */
function deriveSkillGroups(
  files: { path: string; sha256: string }[],
): { skill: string; fileCount: number }[] {
  const groups = new Map<string, number>();
  for (const f of files) {
    // path 形如 `sillyspec-foo/SKILL.md` 或 `my-skill/helpers/x.ts`，取第一段为 skill 名
    const top = f.path.split("/")[0] ?? f.path;
    groups.set(top, (groups.get(top) ?? 0) + 1);
  }
  return Array.from(groups.entries())
    .map(([skill, fileCount]) => ({ skill, fileCount }))
    .sort((a, b) => a.skill.localeCompare(b.skill));
}

export default function SkillsSettingsPage() {
  const isPlatformAdmin = useSession((s) => s.user?.is_platform_admin === true);

  const {
    skills,
    isLoading: skillsLoading,
    isFetching: skillsFetching,
    isError: skillsError,
    error: skillsErr,
    refetch: refetchSkills,
  } = useCustomSkills();

  const {
    manifest,
    isLoading: manifestLoading,
    isError: manifestError,
    error: manifestErr,
    refetch: refetchManifest,
  } = usePlatformSkillsManifest();

  const deleteSkill = useDeleteCustomSkill();

  const [editing, setEditing] = useState<CustomSkillRead | "new" | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  // mutation 错误透传到页面顶部（dialog 自身也展示，这里冗余兜底）
  useEffect(() => {
    if (deleteSkill.isError) setPageError(errMessage(deleteSkill.error, "删除失败"));
  }, [deleteSkill.isError, deleteSkill.error]);

  const platformGroups = useMemo(
    () => (manifest ? deriveSkillGroups(manifest.files) : []),
    [manifest],
  );

  const handleRefresh = () => {
    void refetchSkills();
    void refetchManifest();
  };

  const handleDelete = async (s: CustomSkillRead) => {
    if (!confirm(`确定删除自定义技能 "${s.name}"？删除后所有 daemon 下次同步将移除该 skill。`)) {
      return;
    }
    setPageError(null);
    try {
      await deleteSkill.mutateAsync(s.id);
    } catch {
      // 错误已由 effect 透传
    }
  };

  return (
    <PageContainer className="gap-5">
      <PageHeader
        title="技能管理"
        subtitle={
          <span>
            <Link href="/settings" className="hover:underline">
              设置
            </Link>
            <span className="px-1 text-muted-foreground/60">/</span>
            查看平台 SillySpec 技能 + 管理自定义技能（分发给所有守护进程）
          </span>
        }
        actions={
          <Button
            variant="outline"
            size="lg"
            onClick={handleRefresh}
            disabled={skillsFetching}
            className="gap-2"
          >
            <RefreshCw className={cn("h-4 w-4", skillsFetching && "animate-spin")} />
            刷新
          </Button>
        }
      />

      {pageError && (
        <div className="rounded-lg border border-destructive/30 bg-red-50 px-4 py-3 text-sm text-destructive">
          {pageError}
        </div>
      )}

      {/* 上区：平台 sillyspec skills 只读列表 */}
      <SectionCard
        title="平台 SillySpec 技能"
        extra={
          manifest ? (
            <div className="flex items-center gap-2">
              <StatusBadge kind={manifest.version ? "success" : "neutral"}>
                {manifest.version ? "已同步" : "无内容"}
              </StatusBadge>
              <code className="rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                {manifest.version ? manifest.version.slice(0, 12) : "—"}
              </code>
            </div>
          ) : null
        }
        bodyPadding="p-0"
      >
        {manifestLoading ? (
          <div className="px-6 py-10 text-center text-sm text-muted-foreground">
            加载中...
          </div>
        ) : manifestError ? (
          <div className="px-6 py-6 text-sm text-destructive">
            加载平台技能失败：{errMessage(manifestErr, "网络错误")}
          </div>
        ) : manifest && manifest.message ? (
          <EmptyState
            icon={<BookOpen className="h-5 w-5" />}
            title="代码库暂无 SillySpec 技能"
            description={
              <span>{manifest.message}（平台 skills 目录下未发现 sillyspec-* 技能目录）</span>
            }
          />
        ) : manifest && platformGroups.length === 0 ? (
          <EmptyState
            icon={<BookOpen className="h-5 w-5" />}
            title="平台技能清单为空"
            description={<span>manifest 无文件条目</span>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-semibold">技能名</th>
                  <th className="px-4 py-3 font-semibold">文件数</th>
                  <th className="px-4 py-3 font-semibold">说明</th>
                </tr>
              </thead>
              <tbody>
                {platformGroups.map((g) => (
                  <tr key={g.skill} className="border-b last:border-0 hover:bg-muted/25">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 font-medium text-foreground">
                        <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
                        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{g.skill}</code>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <FileCode2 className="h-3.5 w-3.5" />
                        {g.fileCount}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      只读 · 随部署更新，daemon 启动自动同步
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {manifest && manifest.files.length > 0 && (
          <div className="flex items-center justify-between border-t bg-muted/20 px-4 py-2 text-[11px] text-muted-foreground">
            <span>共 {platformGroups.length} 个技能 / {manifest.files.length} 个文件</span>
            <span>version：{manifest.version.slice(0, 16) || "—"}</span>
          </div>
        )}
      </SectionCard>

      {/* 下区：自定义 skills 表格 CRUD */}
      <SectionCard
        title="自定义技能"
        extra={
          isPlatformAdmin ? (
            <Button size="sm" onClick={() => setEditing("new")} className="gap-1">
              <Plus className="h-3.5 w-3.5" />
              新增技能
            </Button>
          ) : null
        }
        bodyPadding="p-0"
      >
        {skillsLoading ? (
          <div className="px-6 py-10 text-center text-sm text-muted-foreground">加载中...</div>
        ) : skillsError ? (
          <div className="px-6 py-6 text-sm text-destructive">
            加载自定义技能失败：{errMessage(skillsErr, "网络错误")}
          </div>
        ) : skills.length === 0 ? (
          <EmptyState
            icon={<Boxes className="h-5 w-5" />}
            title="还没有自定义技能"
            description={
              isPlatformAdmin ? (
                <span>新增后技能会并入 skills bundle，分发给所有守护进程。</span>
              ) : (
                <span>需要平台管理员权限才能新增自定义技能。</span>
              )
            }
            action={
              isPlatformAdmin ? (
                <Button size="sm" onClick={() => setEditing("new")} className="gap-1">
                  <Plus className="h-3.5 w-3.5" />
                  新增技能
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-semibold">名称</th>
                  <th className="px-4 py-3 font-semibold">描述</th>
                  <th className="px-4 py-3 font-semibold">内容预览</th>
                  <th className="px-4 py-3 font-semibold">更新时间</th>
                  <th className="px-4 py-3 text-right font-semibold">操作</th>
                </tr>
              </thead>
              <tbody>
                {skills.map((s) => (
                  <tr key={s.id} className="border-b last:border-0 hover:bg-muted/25">
                    <td className="px-4 py-3">
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground">
                        {s.name}
                      </code>
                    </td>
                    <td className="px-4 py-3 text-xs text-foreground">{s.description}</td>
                    <td className="max-w-[280px] truncate px-4 py-3 text-xs text-muted-foreground">
                      {s.content_preview}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                      {formatDateTime(s.updated_at)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isPlatformAdmin ? (
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditing(s)}
                            className="gap-1"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            编辑
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            disabled={deleteSkill.isPending}
                            onClick={() => void handleDelete(s)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            删除
                          </Button>
                        </div>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">只读</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {editing && (
        <CustomSkillEditDialog
          mode={editing === "new" ? "create" : "edit"}
          skill={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </PageContainer>
  );
}
