"use client";

import { useEffect, useState } from "react";
import { Boxes, Eye, Pencil } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MarkdownText } from "@/components/ui/markdown-text";
import { errMessage } from "@/lib/errors";
import {
  getCustomSkill,
  useCreateCustomSkill,
  useUpdateCustomSkill,
  type CustomSkillRead,
} from "@/lib/custom-skills";
import { cn } from "@/lib/utils";

interface Props {
  /** create = 新建空白表单；edit = 编辑既有 skill（需先拉详情补全 content）。 */
  mode: "create" | "edit";
  skill: CustomSkillRead | null;
  onClose: () => void;
}

type EditTab = "edit" | "preview";

/**
 * 自定义 skill 编辑/新增弹窗。
 *
 * - name 规则：[a-z0-9-]{2,40}，禁 sillyspec- 前缀（后端 D-002 校验，前端提示）
 * - content = SKILL.md 正文（markdown），提供 编辑/预览 双 tab（D-007 复用 MarkdownText）
 * - edit 模式：先 GET detail 拉完整 content（列表项只含 preview）
 *
 * 设计依据：design.md D-001 / D-007。
 */
export function CustomSkillEditDialog({ mode, skill, onClose }: Props) {
  const isEdit = mode === "edit" && skill !== null;

  const [name, setName] = useState(isEdit && skill ? skill.name : "");
  const [description, setDescription] = useState(
    isEdit && skill ? skill.description : "",
  );
  const [content, setContent] = useState("");
  const [tab, setTab] = useState<EditTab>("edit");
  const [loadingDetail, setLoadingDetail] = useState(isEdit);
  const [error, setError] = useState<string | null>(null);

  const createSkill = useCreateCustomSkill();
  const updateSkill = useUpdateCustomSkill();
  const submitting = createSkill.isPending || updateSkill.isPending;

  // edit 模式：拉详情补全 content（列表只有 preview）。create 模式 content 留空。
  useEffect(() => {
    if (!isEdit || !skill) return;
    let cancelled = false;
    (async () => {
      try {
        const detail = await getCustomSkill(skill.id);
        if (!cancelled) {
          setContent(detail.content);
          setLoadingDetail(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(errMessage(err, "加载技能内容失败"));
          setLoadingDetail(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEdit, skill]);

  const handleSubmit = async () => {
    setError(null);
    const trimmedName = name.trim();
    const trimmedDesc = description.trim();
    if (!trimmedName) {
      setError("技能名称必填");
      return;
    }
    if (!trimmedDesc) {
      setError("描述必填");
      return;
    }
    if (!content.trim()) {
      setError("SKILL.md 正文不能为空");
      return;
    }
    // D-002 客户端预校验：[a-z0-9-]{2,40}，禁 sillyspec- 前缀
    if (!/^[a-z0-9-]{2,40}$/.test(trimmedName)) {
      setError("技能名称只能包含小写字母、数字、连字符，长度 2-40");
      return;
    }
    if (trimmedName.startsWith("sillyspec-")) {
      setError("自定义技能名称不能以 sillyspec- 开头（与平台内置技能冲突）");
      return;
    }
    try {
      if (isEdit && skill) {
        await updateSkill.mutateAsync({
          id: skill.id,
          req: { name: trimmedName, description: trimmedDesc, content },
        });
      } else {
        await createSkill.mutateAsync({
          name: trimmedName,
          description: trimmedDesc,
          content,
        });
      }
      onClose();
    } catch (err) {
      setError(errMessage(err, "保存失败"));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !submitting) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
            {isEdit ? <Pencil className="h-5 w-5" /> : <Boxes className="h-5 w-5" />}
          </div>
          <DialogTitle>{isEdit ? "编辑自定义技能" : "新增自定义技能"}</DialogTitle>
          <DialogDescription>
            自定义技能以 SKILL.md 形式分发给所有守护进程。名称只能包含小写字母、数字、连字符。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
            <div>
              <label className="text-xs font-medium text-muted-foreground">技能名称</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如 my-helper"
                className="mt-1"
                maxLength={40}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">[a-z0-9-]{`{2,40}`}，不可与内置冲突</p>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">描述</label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="一句话说明该技能用途"
                className="mt-1"
                maxLength={200}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">1-200 字符</p>
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">SKILL.md 正文</label>
              <div className="flex rounded-md border bg-muted/40 p-0.5">
                <TabButton active={tab === "edit"} onClick={() => setTab("edit")}>
                  <Pencil className="h-3 w-3" />
                  编辑
                </TabButton>
                <TabButton active={tab === "preview"} onClick={() => setTab("preview")}>
                  <Eye className="h-3 w-3" />
                  预览
                </TabButton>
              </div>
            </div>
            {loadingDetail ? (
              <div className="h-64 rounded-md border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
                加载技能内容中...
              </div>
            ) : tab === "edit" ? (
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={"# 技能标题\n\n描述这个技能做什么、何时触发、如何使用...\n\n## 步骤\n1. ..."}
                className="h-64 w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs focus:border-ring focus:outline-none"
                spellCheck={false}
              />
            ) : (
              <div className="h-64 overflow-y-auto rounded-md border bg-background px-4 py-3 text-xs">
                {content.trim() ? (
                  <MarkdownText content={content} />
                ) : (
                  <span className="text-muted-foreground">暂无内容可预览</span>
                )}
              </div>
            )}
          </div>

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={submitting || loadingDetail}>
            {submitting ? "保存中..." : isEdit ? "保存修改" : "创建技能"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
