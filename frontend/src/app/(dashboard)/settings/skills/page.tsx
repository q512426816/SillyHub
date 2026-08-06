"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  Boxes,
  ChevronDown,
  Eye,
  FileCode2,
  Lightbulb,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";

import { CustomSkillEditDialog } from "@/components/custom-skill-edit-dialog";
import { SkillContentDrawer } from "@/components/skill-content-drawer";
import { PageContainer, PageHeader, SectionCard } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { errMessage, useNotify } from "@/lib/errors";
import {
  useCreateCustomSkill,
  useCustomSkills,
  useDeleteCustomSkill,
  usePlatformSkillsManifest,
  useUpdateCustomSkill,
  type CustomSkillRead,
} from "@/lib/custom-skills";
import { cn } from "@/lib/utils";

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("zh-CN");
}

/**
 * 从 manifest files[] 前端兜底聚合「顶层 skill 目录」列表（无 description）。
 * 正常路径优先用后端 ``manifest.skills``（带 description）；本函数仅在后端未返回
 * skills 摘要时回退，结构与 PlatformSkillSummary 对齐（description 留空）。
 */
function deriveSkillGroups(
  files: { path: string; sha256: string }[],
): { name: string; description: string; file_count: number }[] {
  const groups = new Map<string, number>();
  for (const f of files) {
    // path 形如 `sillyspec-foo/SKILL.md` 或 `my-skill/helpers/x.ts`，取第一段为 skill 名
    const top = f.path.split("/")[0] ?? f.path;
    groups.set(top, (groups.get(top) ?? 0) + 1);
  }
  return Array.from(groups.entries())
    .map(([name, file_count]) => ({ name, description: "", file_count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export default function SkillsSettingsPage() {
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
  const notify = useNotify();

  const [editing, setEditing] = useState<CustomSkillRead | "new" | null>(null);
  // 2026-08-05-skill-content-viewer task-07：只读查看抽屉状态（platform 看 SKILL.md / custom 看 content）。
  const [viewing, setViewing] = useState<{
    kind: "platform" | "custom";
    skillName?: string;
    skillId?: string;
  } | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  // 新手引导卡：默认展开，让不懂技能的用户先看懂（P0-4 白话化）。
  const [showGuide, setShowGuide] = useState(true);

  // mutation 错误透传到页面顶部（dialog 自身也展示，这里冗余兜底）
  useEffect(() => {
    if (deleteSkill.isError) setPageError(errMessage(deleteSkill.error, "删除失败"));
  }, [deleteSkill.isError, deleteSkill.error]);

  const platformGroups = useMemo(() => {
    if (!manifest) return [];
    // 优先用后端聚合的 skills 摘要（带 description）；缺省回退前端按 files 聚合（无 description）
    if (manifest.skills && manifest.skills.length > 0) {
      return manifest.skills;
    }
    return deriveSkillGroups(manifest.files);
  }, [manifest]);

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
      notify.success("已删除，需重启守护进程才在所有 AI 助手处生效");
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
            管理「给 AI 看的操作说明书」——系统自带的只读查看，自己加的可编辑并分发给所有 AI 助手
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

      {/* 新手引导卡：白话讲清楚「技能是什么 / 在哪用 / 怎么生效」（P0-4）。默认展开，可折叠。 */}
      <div className="rounded-lg border border-blue-200 bg-blue-50/40">
        <button
          type="button"
          onClick={() => setShowGuide((v) => !v)}
          className="flex w-full items-center gap-2 px-4 py-3 text-left"
        >
          <Lightbulb className="h-4 w-4 shrink-0 text-blue-600" />
          <span className="text-sm font-medium text-foreground">
            什么是技能？在哪里用到？怎么生效？（点此{showGuide ? "收起" : "展开"}）
          </span>
          <ChevronDown
            className={cn(
              "ml-auto h-4 w-4 text-muted-foreground transition-transform",
              showGuide && "rotate-180",
            )}
          />
        </button>
        {showGuide && (
          <div className="space-y-2.5 border-t border-blue-200/60 px-4 py-3 text-sm text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">技能是什么：</span>
              一份给 AI 看的「操作说明书」。每个技能告诉 AI——什么情况下该用它、按什么步骤做。
            </p>
            <p>
              <span className="font-medium text-foreground">在哪里用到：</span>
              平台上所有 AI 助手（开发的 AI、你建的智能体）启动时都会自动加载这些技能。AI 会根据技能里的「描述」自己判断要不要用，就像它知道什么时候该查文档、什么时候该写代码。
            </p>
            <p>
              <span className="font-medium text-foreground">怎么生效：</span>
              你在这里新增或修改技能后，需要<strong className="text-foreground">重启守护进程</strong>才会同步给所有 AI，保存时会有提示。
            </p>
            <p>
              <span className="font-medium text-foreground">怎么写：</span>
              点「插入步骤模板」会自动填入骨架（何时使用 / 步骤 / 注意事项），把步骤写清楚，AI 就能照着做。
            </p>
          </div>
        )}
      </div>

      {pageError && (
        <div className="rounded-lg border border-destructive/30 bg-red-50 px-4 py-3 text-sm text-destructive">
          {pageError}
        </div>
      )}

      {/* 上区：平台 sillyspec skills 只读列表 */}
      <SectionCard
        title="平台 SillySpec 技能（系统自带）"
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
        {/* 灰字效果说明：系统自带技能 AI 启动自动加载，不可改（P0-3）。 */}
        <p className="border-b px-4 py-2 text-xs text-muted-foreground">
          这些是系统自带技能，AI 启动时自动加载使用，不能在这里修改。列表只读。
        </p>
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
                  <th className="px-4 py-3 text-right font-semibold">操作</th>
                </tr>
              </thead>
              <tbody>
                {platformGroups.map((g) => (
                  <tr key={g.name} className="border-b last:border-0 hover:bg-muted/25">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 font-medium text-foreground">
                        <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
                        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{g.name}</code>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <FileCode2 className="h-3.5 w-3.5" />
                        {g.file_count}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {g.description || "只读 · 随部署更新，AI 启动自动加载"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setViewing({ kind: "platform", skillName: g.name })}
                        className="gap-1"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        查看
                      </Button>
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
        title="自定义技能（自己加的）"
        extra={
          <Button size="sm" onClick={() => setEditing("new")} className="gap-1">
            <Plus className="h-3.5 w-3.5" />
            新增技能
          </Button>
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
              <span>新增后会把这份「AI 操作说明书」分发给属于你的 AI 助手，重启守护进程后生效。</span>
            }
            action={
              <Button size="sm" onClick={() => setEditing("new")} className="gap-1">
                <Plus className="h-3.5 w-3.5" />
                新增技能
              </Button>
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
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setViewing({ kind: "custom", skillId: s.id })}
                          className="gap-1"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          查看
                        </Button>
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

      <SkillContentDrawer
        open={viewing !== null}
        onClose={() => setViewing(null)}
        kind={viewing?.kind ?? "platform"}
        skillName={viewing?.skillName}
        skillId={viewing?.skillId}
      />
    </PageContainer>
  );
}
