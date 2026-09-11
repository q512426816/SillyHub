"use client";

/**
 * SourceManageCard —— git 技能源管理区块（变更 2026-09-11-skills-central-library
 * / task-04，仅 admin 渲染——page 按 is_platform_admin 门控，本组件不再自判）。
 *
 * 结构（design「源管理 admin 卡」+ FR-04）：
 * - 新增/编辑表单：url / branch（默认 main）/ subdir（可选）；
 * - 源卡列表：url + branch/subdir 徽标 + enabled 源级开关（PATCH）+
 *   last_commit 短显（slice 7）+ last_error 告警色展示 + 手动刷新/编辑/删除。
 *
 * 数据自持（useSkillsLibrary 内嵌 sources + 本文件四个源 mutation）；页面零胶水，
 * 「我的技能」既有区块不受影响。范式对齐 components/mcp-registry/（antd
 * Switch/Tag + shadcn Input/Button + SectionCard）。
 *
 * 样式：FRONTEND_PAGE_STYLE.md §0.5 主题铁律——brand-* 语义阶 + 语义 token
 * （text-destructive 告警），antd 组件色走 ConfigProvider 预设不手写。
 */
import { useState } from "react";
import { Switch, Tag } from "antd";
import { AlertTriangle, GitBranch, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";

import { SectionCard } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { errMessage, useNotify } from "@/lib/errors";
import { cn } from "@/lib/utils";
import {
  useCreateSkillSource,
  useDeleteSkillSource,
  useRefreshSkillSource,
  useSkillsLibrary,
  useUpdateSkillSource,
  type SkillSourceRead,
} from "./skill-source-api";

/** url 短显（host + 路径首尾段太长的中间截断由 CSS truncate 处理，这里只剥 scheme）。 */
function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

/** git commit 短显（slice 7，与 git 短 hash 惯例一致）。 */
function shortCommit(commit: string | null): string {
  return commit ? commit.slice(0, 7) : "—";
}

/** 表单状态（create 空 / edit 回填既有源）。 */
interface SourceFormState {
  url: string;
  branch: string;
  subdir: string;
}

const EMPTY_FORM: SourceFormState = { url: "", branch: "main", subdir: "" };

export function SourceManageCard() {
  const { sources, isLoading, isError, error } = useSkillsLibrary();
  const createSource = useCreateSkillSource();
  const updateSource = useUpdateSkillSource();
  const deleteSource = useDeleteSkillSource();
  const refreshSource = useRefreshSkillSource();
  const notify = useNotify();

  const [form, setForm] = useState<SourceFormState>(EMPTY_FORM);
  /** 编辑中的源 id（null = 新增态）。 */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const submitting = createSource.isPending || updateSource.isPending;
  const mutationError =
    createSource.error ?? updateSource.error ?? deleteSource.error ?? refreshSource.error;

  const setField = (key: keyof SourceFormState, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const resetForm = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
  };

  const handleSubmit = async () => {
    const url = form.url.trim();
    if (!url) {
      setFormError("仓库地址必填（https:// 开头的 git 仓库地址）");
      return;
    }
    setFormError(null);
    try {
      if (editingId) {
        await updateSource.mutateAsync({
          sourceId: editingId,
          req: {
            url,
            branch: form.branch.trim() || "main",
            subdir: form.subdir.trim() || null,
          },
        });
        notify.success("源已更新");
      } else {
        await createSource.mutateAsync({
          url,
          branch: form.branch.trim() || "main",
          subdir: form.subdir.trim() || null,
        });
        notify.success("已添加，保存时会立即拉取一次（失败不阻塞，可在行内看错误）");
      }
      resetForm();
    } catch (err) {
      setFormError(errMessage(err, editingId ? "更新失败" : "添加失败"));
    }
  };

  const handleToggleEnabled = async (s: SkillSourceRead, enabled: boolean) => {
    try {
      await updateSource.mutateAsync({ sourceId: s.id, req: { enabled } });
    } catch (err) {
      notify.error(err, enabled ? "启用源失败" : "停用源失败");
    }
  };

  const handleRefresh = async (s: SkillSourceRead) => {
    try {
      const updated = await refreshSource.mutateAsync(s.id);
      if (updated.last_error) {
        notify.error(new Error(`刷新失败：${updated.last_error}`));
      } else {
        notify.success(`已刷新（commit ${shortCommit(updated.last_commit)}）`);
      }
    } catch (err) {
      notify.error(err, "刷新失败");
    }
  };

  const handleDelete = async (s: SkillSourceRead) => {
    if (!confirm(`确定删除技能源 "${shortUrl(s.url)}"？该源下所有 git 技能将从所有用户的技能库移除。`)) {
      return;
    }
    try {
      await deleteSource.mutateAsync(s.id);
      notify.success("已删除源及其全部启用绑定");
    } catch (err) {
      notify.error(err, "删除失败");
    }
  };

  const handleEdit = (s: SkillSourceRead) => {
    setEditingId(s.id);
    setForm({ url: s.url, branch: s.branch, subdir: s.subdir ?? "" });
    setFormError(null);
  };

  return (
    <SectionCard
      title="git 技能源（管理员）"
      extra={
        <span className="text-xs text-muted-foreground">
          {isLoading ? "加载中..." : `共 ${sources.length} 个源`}
        </span>
      }
      bodyPadding="p-4"
      data-testid="skill-source-manage-card"
    >
      <p className="mb-3 text-xs text-muted-foreground">
        从 git 仓库收录技能：填仓库 https 地址（可选分支/子目录），保存即拉取一次；
        全员在下方「技能库」逐个启用技能，停用源即整源下架。
      </p>

      {/* 新增 / 编辑表单（同一表单双态） */}
      <div className="mb-4 grid gap-2 rounded-lg border bg-muted/20 p-3 sm:grid-cols-[1fr_150px_150px_auto]">
        <Input
          placeholder="https://github.com/user/skills-repo.git"
          value={form.url}
          onChange={(e) => setField("url", e.target.value)}
          aria-label="仓库地址"
          data-testid="source-form-url"
        />
        <Input
          placeholder="分支（默认 main）"
          value={form.branch}
          onChange={(e) => setField("branch", e.target.value)}
          aria-label="分支"
          data-testid="source-form-branch"
        />
        <Input
          placeholder="子目录（可选，缺省=仓库根）"
          value={form.subdir}
          onChange={(e) => setField("subdir", e.target.value)}
          aria-label="子目录"
          data-testid="source-form-subdir"
        />
        <div className="flex gap-1.5">
          <Button size="sm" onClick={() => void handleSubmit()} disabled={submitting} className="gap-1">
            <Plus className="h-3.5 w-3.5" />
            {editingId ? "保存修改" : "添加源"}
          </Button>
          {editingId && (
            <Button size="sm" variant="outline" onClick={resetForm}>
              取消
            </Button>
          )}
        </div>
      </div>

      {formError && (
        <div className="mb-3 rounded-lg border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {formError}
        </div>
      )}
      {mutationError && !formError && (
        <div className="mb-3 rounded-lg border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {errMessage(mutationError, "操作失败")}
        </div>
      )}

      {/* 源卡列表 */}
      {isLoading ? (
        <div className="py-8 text-center text-sm text-muted-foreground">加载中...</div>
      ) : isError ? (
        <div className="py-4 text-sm text-destructive">
          加载技能源失败：{errMessage(error, "网络错误")}
        </div>
      ) : sources.length === 0 ? (
        <EmptyState
          icon={<GitBranch className="h-5 w-5" />}
          title="还没有配置 git 技能源"
          description={<span>添加一个公网 git 仓库地址，仓库内含 SKILL.md 的目录会自动收进技能库。</span>}
        />
      ) : (
        <div className="space-y-2">
          {sources.map((s) => (
            <div
              key={s.id}
              className="flex flex-col gap-2 rounded-lg border bg-card p-3 transition-colors hover:border-brand-300"
              data-testid={`skill-source-row-${s.id}`}
            >
              {/* 头部：url 短显 + branch/subdir 徽标 */}
              <div className="flex flex-wrap items-center gap-2">
                <code
                  className="max-w-full truncate rounded bg-muted px-2 py-0.5 text-xs font-medium text-foreground"
                  title={s.url}
                >
                  {shortUrl(s.url)}
                </code>
                <Tag className="m-0">
                  <GitBranch className="mr-1 inline h-3 w-3 align-[-2px]" />
                  {s.branch}
                </Tag>
                {s.subdir && <Tag className="m-0">{s.subdir}</Tag>}
                {!s.enabled && <Tag color="warning">已停用</Tag>}
              </div>

              {/* 状态行：启用开关 + commit 短显 + last_error 告警 */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Switch
                    size="small"
                    checked={s.enabled}
                    disabled={updateSource.isPending}
                    onChange={(checked) => void handleToggleEnabled(s, checked)}
                    aria-label={`源开关 ${shortUrl(s.url)}`}
                  />
                  {s.enabled ? "启用中" : "已停用"}
                </span>
                <span>
                  commit：<code className="rounded bg-muted px-1 py-0.5">{shortCommit(s.last_commit)}</code>
                </span>
                {s.last_error && (
                  <span
                    className={cn(
                      "flex min-w-0 items-center gap-1 text-destructive",
                      "truncate",
                    )}
                    title={s.last_error}
                    data-testid={`source-last-error-${s.id}`}
                  >
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{s.last_error}</span>
                  </span>
                )}
              </div>

              {/* 操作行 */}
              <div className="flex items-center gap-1 border-t pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleRefresh(s)}
                  disabled={refreshSource.isPending}
                  className="gap-1"
                >
                  <RefreshCw
                    className={cn("h-3.5 w-3.5", refreshSource.isPending && "animate-spin")}
                  />
                  刷新
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleEdit(s)}
                  disabled={editingId === s.id}
                  className="gap-1"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  编辑
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={deleteSource.isPending}
                  onClick={() => void handleDelete(s)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  删除
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
