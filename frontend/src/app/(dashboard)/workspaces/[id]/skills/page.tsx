"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Wrench } from "lucide-react";

import { PageContainer, PageHeader, SectionCard } from "@/components/layout";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { errMessage, useNotify } from "@/lib/errors";
import { cn } from "@/lib/utils";
import {
  useCreateWorkspaceSkill,
  useDeleteWorkspaceSkill,
  useDeleteWorkspaceSkillFile,
  useWorkspaceSkillFile,
  useWorkspaceSkills,
  useWriteWorkspaceSkillFile,
} from "@/lib/workspace-skills-view";

interface Props {
  params: { id: string };
}

/* ────────────────────── 前端白名单校验（与后端一致，design §5.1） ────────────────────── */

/** skill 名 / 文件路径段白名单：字母/数字/点/下划线/连字符（另需排除 ".."）。 */
const NAME_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

/** 校验新建 skill 名：返回 null 表示合法，否则返回中文错误文案。 */
export function validateSkillName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "skill 名不能为空";
  if (!NAME_SEGMENT_RE.test(trimmed) || trimmed.includes("..")) {
    return "skill 名仅允许字母/数字/点/下划线/连字符";
  }
  return null;
}

/** 校验新建文件路径（≤2 层，段白名单同 skill 名）：返回 null 表示合法。 */
export function validateSkillFilePath(path: string): string | null {
  const trimmed = path.trim();
  if (!trimmed) return "文件名不能为空";
  const segments = trimmed.split("/");
  if (segments.length > 2) return "文件路径最多两层（如 scripts/run.sh）";
  for (const seg of segments) {
    if (!NAME_SEGMENT_RE.test(seg) || seg.includes("..")) {
      return "文件名仅允许字母/数字/点/下划线/连字符";
    }
  }
  return null;
}

/* ────────────────────── 页面 ────────────────────── */

/**
 * Workspace Skills 子页（task-10 起；2026-08-26-workspace-skill-edit task-06
 * 升级双栏完整文件编辑，对照 prototype-workspace-skill-edit.html）。
 *
 * 左栏 skill 卡片（名 + 文件数）+ 选中展开文件树 + 新建文件/删除文件/删除
 * Skill 工具行；右栏 textarea 编辑器（未保存标记 + 保存/重置）。数据层全部
 * 走 workspace-skills-view hooks（task-05），写成功后失效列表 + 单文件双键。
 * 推翻旧变更 2026-07-07-skills-mcp-management-ui D-006 的只读约束。
 * membership 校验由详情页 layout 的 WorkspaceBindingGuard 完成，本页不重复校验。
 */
export default function WorkspaceSkillsPage({ params }: Props) {
  const workspaceId = params.id;
  const { skills, isLoading, isError, error, refetch } =
    useWorkspaceSkills(workspaceId);

  // 选中态：skill 决定左栏展开哪棵文件树；file 决定右栏编辑器内容。
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [editorText, setEditorText] = useState("");
  const [showCreateSkill, setShowCreateSkill] = useState(false);
  const [showNewFile, setShowNewFile] = useState(false);

  const fileQuery = useWorkspaceSkillFile(
    workspaceId,
    selectedSkill ?? "",
    selectedFile,
  );

  const createSkill = useCreateWorkspaceSkill(workspaceId);
  const deleteSkill = useDeleteWorkspaceSkill(workspaceId);
  const writeFile = useWriteWorkspaceSkillFile(workspaceId);
  const deleteFile = useDeleteWorkspaceSkillFile(workspaceId);
  const notify = useNotify();

  // 列表就绪后默认选中第一个 skill；选中项已不在列表（被删/外部变化）时回退。
  useEffect(() => {
    const first = skills[0];
    if (!first) return;
    if (selectedSkill && skills.some((s) => s.name === selectedSkill)) return;
    setSelectedSkill(first.name);
  }, [skills, selectedSkill]);

  // 单文件内容 → 编辑器（加载与保存后失效重取都经此同步；保存后内容等于
  // editorText，不会覆盖用户输入）。
  useEffect(() => {
    if (fileQuery.data) setEditorText(fileQuery.data.content);
  }, [fileQuery.data]);

  const loadedContent = fileQuery.data?.content ?? "";
  const dirty = selectedFile !== null && editorText !== loadedContent;
  const skillEntry = skills.find((s) => s.name === selectedSkill);

  const selectSkill = (name: string) => {
    setSelectedSkill(name);
    setSelectedFile(null);
    setEditorText("");
  };

  const selectFile = (skillName: string, path: string) => {
    setSelectedSkill(skillName);
    setSelectedFile(path);
    // 立即清空，避免新文件加载期间短暂显示上一个文件的内容。
    setEditorText("");
  };

  const handleSave = async () => {
    if (!selectedSkill || !selectedFile || !dirty) return;
    try {
      await writeFile.mutateAsync({
        skillName: selectedSkill,
        path: selectedFile,
        body: { content: editorText },
      });
      notify.success("已保存（下次同步对新会话生效）");
    } catch (err) {
      notify.error(err, "保存失败");
    }
  };

  const handleReset = () => setEditorText(loadedContent);

  const handleDeleteFile = async () => {
    if (!selectedSkill || !selectedFile || selectedFile === "SKILL.md") return;
    if (
      !confirm(`确定删除文件 "${selectedSkill}/${selectedFile}"？删除后不可恢复。`)
    ) {
      return;
    }
    try {
      await deleteFile.mutateAsync({
        skillName: selectedSkill,
        path: selectedFile,
      });
      notify.success(`已删除文件 ${selectedFile}`);
      setSelectedFile(null);
      setEditorText("");
    } catch (err) {
      notify.error(err, "删除文件失败");
    }
  };

  const handleDeleteSkill = async () => {
    if (!selectedSkill) return;
    const fileCount = skillEntry?.files.length ?? 0;
    if (
      !confirm(
        `将删除整个 skill 目录 "${selectedSkill}"（${fileCount} 个文件），不可恢复。确定继续？`,
      )
    ) {
      return;
    }
    try {
      await deleteSkill.mutateAsync(selectedSkill);
      notify.success(`已删除 skill "${selectedSkill}"`);
      setSelectedSkill(null);
      setSelectedFile(null);
      setEditorText("");
    } catch (err) {
      notify.error(err, "删除 skill 失败");
    }
  };

  const handleCreateSkill = async (name: string, description: string) => {
    // 失败（409 已存在/422 非法名）向对话框抛出，由对话框内联展示。
    await createSkill.mutateAsync({ name, description });
    notify.success(`已创建 skill "${name}"`);
    setShowCreateSkill(false);
    // 刷新由 hook 内 invalidate 完成；直接选中新 skill 的 SKILL.md。
    setSelectedSkill(name);
    setSelectedFile("SKILL.md");
    setEditorText("");
  };

  const handleCreateFile = async (path: string) => {
    if (!selectedSkill) return;
    if (skillEntry?.files.includes(path)) {
      throw new Error("该文件已存在，请换一个名字");
    }
    // PUT 空内容即创建（无独立 create 端点，design §7.3）。
    await writeFile.mutateAsync({
      skillName: selectedSkill,
      path,
      body: { content: "" },
    });
    notify.success(`已创建文件 ${path}`);
    setShowNewFile(false);
    setSelectedFile(path);
    setEditorText("");
  };

  const dangerBtnCls =
    "text-destructive hover:bg-destructive/10 hover:text-destructive";

  return (
    <PageContainer size="full">
      <PageHeader
        title="自定义 Skills"
        subtitle="编辑工作区 specDir/skills/ 下的自定义 skill（保存后写入，下次同步对新会话生效）"
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
              disabled={isLoading}
            >
              刷新
            </Button>
            <Button size="sm" onClick={() => setShowCreateSkill(true)}>
              ＋ 新建 Skill
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
            description='点击右上角「＋ 新建 Skill」创建第一个自定义 skill。'
          />
        </SectionCard>
      )}

      {!isLoading && !isError && skills.length > 0 && (
        <div className="grid items-start gap-3 md:grid-cols-[280px_1fr]">
          {/* ══ 左栏：skill 卡片列表 + 选中展开文件树 + 工具行 ══ */}
          <SectionCard>
            {skills.map((skill) => {
              const active = skill.name === selectedSkill;
              return (
                <div
                  key={skill.name}
                  className={cn(
                    "mb-2 rounded-lg border bg-muted/40",
                    active ? "border-brand-500" : "border-border",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => selectSkill(skill.name)}
                    className="w-full rounded-lg px-2.5 py-2 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">
                        {skill.name}
                      </span>
                      <StatusBadge kind="neutral">
                        {skill.files.length} 个文件
                      </StatusBadge>
                    </div>
                  </button>
                  {active && (
                    <div className="border-t border-border/60 px-2.5 pb-2 pt-1 font-mono text-xs">
                      {skill.files.length === 0 ? (
                        <p className="py-1 font-sans text-[11px] text-muted-foreground">
                          该 skill 目录下暂无文件。
                        </p>
                      ) : (
                        skill.files.map((f) => {
                          const sel = f === selectedFile;
                          return (
                            <button
                              key={f}
                              type="button"
                              onClick={() => selectFile(skill.name, f)}
                              className={cn(
                                "block w-full truncate rounded px-1.5 py-1 text-left",
                                sel
                                  ? "bg-background font-semibold text-brand-700"
                                  : "text-muted-foreground hover:bg-background hover:text-foreground",
                              )}
                            >
                              {f}
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            <div className="mt-1 flex flex-wrap gap-2 border-t border-border pt-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowNewFile(true)}
                disabled={!selectedSkill}
              >
                ＋ 新建文件
              </Button>
              <Button
                variant="outline"
                size="sm"
                className={dangerBtnCls}
                onClick={() => void handleDeleteFile()}
                disabled={
                  !selectedSkill ||
                  !selectedFile ||
                  selectedFile === "SKILL.md" ||
                  deleteFile.isPending
                }
              >
                删除文件
              </Button>
              <Button
                variant="outline"
                size="sm"
                className={dangerBtnCls}
                onClick={() => void handleDeleteSkill()}
                disabled={!selectedSkill || deleteSkill.isPending}
              >
                删除 Skill
              </Button>
            </div>
          </SectionCard>

          {/* ══ 右栏：文件编辑器 ══ */}
          <SectionCard>
            {selectedSkill && selectedFile ? (
              <>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate font-mono text-xs text-muted-foreground">
                      {selectedSkill} / {selectedFile}
                    </span>
                    {dirty && (
                      <span className="shrink-0 text-[11px] text-warning">
                        ● 未保存
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleReset}
                      disabled={!dirty || writeFile.isPending}
                    >
                      重置
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => void handleSave()}
                      disabled={!dirty || writeFile.isPending}
                    >
                      {writeFile.isPending ? "保存中…" : "保存"}
                    </Button>
                  </div>
                </div>
                {fileQuery.isLoading ? (
                  <p className="py-16 text-center text-xs text-muted-foreground">
                    加载文件内容...
                  </p>
                ) : fileQuery.isError ? (
                  <ErrorBanner
                    message={
                      fileQuery.error?.message ?? "加载文件内容失败"
                    }
                  />
                ) : (
                  <textarea
                    value={editorText}
                    onChange={(e) => setEditorText(e.target.value)}
                    spellCheck={false}
                    className="min-h-[300px] w-full resize-y rounded border border-input bg-background p-3 font-mono text-xs leading-relaxed focus:border-ring focus:outline-none"
                  />
                )}
                <p className="mt-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                  ⚠ 仅支持文本文件（≤512KB）；SKILL.md
                  是 skill 的入口文件（不可删除）；文件名仅限字母/数字/点/下划线/连字符。
                </p>
              </>
            ) : (
              <EmptyState
                icon={<Wrench className="h-5 w-5" />}
                title="未选择文件"
                description="在左侧选择 skill 并点击其中的文件，即可在此查看与编辑内容。"
              />
            )}
          </SectionCard>
        </div>
      )}

      {showCreateSkill && (
        <CreateSkillDialog
          pending={createSkill.isPending}
          onClose={() => setShowCreateSkill(false)}
          onSubmit={handleCreateSkill}
        />
      )}
      {showNewFile && selectedSkill && (
        <NewFileDialog
          skillName={selectedSkill}
          pending={writeFile.isPending}
          onClose={() => setShowNewFile(false)}
          onSubmit={handleCreateFile}
        />
      )}
    </PageContainer>
  );
}

/* ────────────────────── 对话框（同文件内小组件，勿移出本页） ────────────────────── */

/** 「新建 Skill」对话框：名（白名单校验）+ 描述，成功由父级关闭。 */
function CreateSkillDialog({
  pending,
  onClose,
  onSubmit,
}: {
  pending: boolean;
  onClose: () => void;
  onSubmit: (name: string, description: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const invalid = validateSkillName(name);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    try {
      await onSubmit(name.trim(), description.trim());
    } catch (err) {
      setError(errMessage(err, "创建失败"));
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>新建 Skill</DialogTitle>
          <DialogDescription>
            将创建 skills/{"<名>"}/SKILL.md（frontmatter 含名称与描述）。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label
              htmlFor="new-skill-name"
              className="block text-xs font-medium text-muted-foreground"
            >
              Skill 名（字母/数字/点/下划线/连字符）
            </label>
            <Input
              id="new-skill-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-skill"
              className="mt-1"
              autoFocus
            />
          </div>
          <div>
            <label
              htmlFor="new-skill-desc"
              className="block text-xs font-medium text-muted-foreground"
            >
              描述（写入 SKILL.md frontmatter）
            </label>
            <Input
              id="new-skill-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="这个 skill 做什么"
              className="mt-1"
              maxLength={500}
            />
          </div>
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            取消
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={pending || !name.trim()}
          >
            {pending ? "创建中…" : "创建"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 「新建文件」对话框：路径白名单校验（≤2 层），成功由父级关闭。 */
function NewFileDialog({
  skillName,
  pending,
  onClose,
  onSubmit,
}: {
  skillName: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: (path: string) => Promise<void>;
}) {
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const invalid = validateSkillFilePath(path);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    try {
      await onSubmit(path.trim());
    } catch (err) {
      setError(errMessage(err, "创建失败"));
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>新建文件</DialogTitle>
          <DialogDescription>
            在 skill「{skillName}」目录下创建文本文件（写入空内容后可在右侧编辑）。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label
              htmlFor="new-file-path"
              className="block text-xs font-medium text-muted-foreground"
            >
              文件名（字母/数字/点/下划线/连字符，最多两层）
            </label>
            <Input
              id="new-file-path"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="reference.md 或 scripts/run.sh"
              className="mt-1"
              autoFocus
            />
          </div>
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            取消
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={pending || !path.trim()}
          >
            {pending ? "创建中…" : "创建"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
