"use client";

import { useEffect, useMemo, useState } from "react";
import { Boxes, Eye, Pencil, RotateCcw, Sparkles } from "lucide-react";

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
import { errMessage, useNotify } from "@/lib/errors";
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

const NAME_PATTERN = /^[a-z0-9-]{2,40}$/;
const STEPS_TEMPLATE =
  "## 何时使用\n（描述什么场景下 AI 该用这个技能）\n\n## 步骤\n1. \n2. \n\n## 注意事项\n- ";

/**
 * 拼出后端将下发给 AI 的 SKILL.md 头部。
 *
 * 必须与 skills_bundle_service._build_skill_md 严格一致（D-008），让用户在
 * 「头部预览」看到的就是 AI 实际读到的 frontmatter。
 */
function buildFrontmatter(name: string, description: string): string {
  return `---\nname: ${name || "(未填)"}\ndescription: ${description || "(未填)"}\n---`;
}

/**
 * 自定义 skill 编辑/新增弹窗（skills-settings-p0-fixup P0-2/3）。
 *
 * - content 只写正文 body；头部 frontmatter（name+description）由后端打包层拼装，
 *   本弹窗用 buildFrontmatter 预览给用户看（D-004/D-008）。
 * - 保存前统一校验（name 合法 + 非 sillyspec- 前缀 + description 非空 + content 非空）。
 * - 脏检测：未改动禁用保存 + 「撤销改动」。
 * - 保存成功后 notify「需重启守护进程才生效」（复用 MCP 的 useNotify，D-005）。
 */
export function CustomSkillEditDialog({ mode, skill, onClose }: Props) {
  const isEdit = mode === "edit" && skill !== null;
  const notify = useNotify();

  const [name, setName] = useState(isEdit && skill ? skill.name : "");
  const [description, setDescription] = useState(
    isEdit && skill ? skill.description : "",
  );
  const [content, setContent] = useState("");
  // 初始值快照（脏检测基准）；edit 模式拉详情后回填，create 模式为空。
  const [initial, setInitial] = useState({ name: "", description: "", content: "" });
  const [tab, setTab] = useState<EditTab>("edit");
  const [loadingDetail, setLoadingDetail] = useState(isEdit);
  const [error, setError] = useState<string | null>(null);

  const createSkill = useCreateCustomSkill();
  const updateSkill = useUpdateCustomSkill();
  const submitting = createSkill.isPending || updateSkill.isPending;

  // edit 模式：拉详情补全 content（列表只有 preview）+ 记录初始值。create 模式 content 留空。
  useEffect(() => {
    if (!isEdit || !skill) return;
    let cancelled = false;
    (async () => {
      try {
        const detail = await getCustomSkill(skill.id);
        if (!cancelled) {
          setContent(detail.content);
          setInitial({
            name: detail.name,
            description: detail.description,
            content: detail.content,
          });
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

  // 统一校验（D-008）：保存按钮 disabled 依据。
  const validation = useMemo(() => {
    const trimmedName = name.trim();
    const trimmedDesc = description.trim();
    if (!trimmedName) return { ok: false as const, reason: "技能名称必填" };
    if (!NAME_PATTERN.test(trimmedName))
      return { ok: false as const, reason: "名称只能含小写字母、数字、连字符，2-40 位" };
    if (trimmedName.startsWith("sillyspec-"))
      return { ok: false as const, reason: "名称不能以 sillyspec- 开头（与内置技能冲突）" };
    if (!trimmedDesc) return { ok: false as const, reason: "描述必填" };
    if (!content.trim()) return { ok: false as const, reason: "技能说明书正文不能为空" };
    return { ok: true as const, reason: "" };
  }, [name, description, content]);

  // 脏检测：当前值 vs 初始值（create 模式初始为空，填了即脏）。
  const dirty = useMemo(() => {
    return (
      name.trim() !== initial.name ||
      description.trim() !== initial.description ||
      content !== initial.content
    );
  }, [name, description, content, initial]);

  const handleInsertTemplate = () => {
    setContent((c) => (c.trim() ? `${c.trim()}\n\n${STEPS_TEMPLATE}` : STEPS_TEMPLATE));
  };

  const handleRevert = () => {
    setName(initial.name);
    setDescription(initial.description);
    setContent(initial.content);
    setError(null);
  };

  const handleSubmit = async () => {
    setError(null);
    if (!validation.ok) {
      setError(validation.reason);
      return;
    }
    const trimmedName = name.trim();
    const trimmedDesc = description.trim();
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
      // D-005/D-007：daemon 仅启动时同步技能，保存后明示需重启才生效。
      notify.success("已保存，需重启守护进程才生效，历史技能也会在下次同步后生效");
      onClose();
    } catch (err) {
      setError(errMessage(err, "保存失败"));
    }
  };

  const descTooShort = description.trim().length > 0 && description.trim().length < 10;

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !submitting) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
            {isEdit ? <Pencil className="h-5 w-5" /> : <Boxes className="h-5 w-5" />}
          </div>
          <DialogTitle>{isEdit ? "编辑自定义技能" : "新增自定义技能"}</DialogTitle>
          <DialogDescription>
            自定义技能是一份给 AI 看的操作说明书，会分发给所有 AI 助手。系统会用左侧的名称和描述自动拼成 AI 识别用的头部，你只需写正文步骤。
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
              <p className="mt-1 text-[11px] text-muted-foreground">只能用英文小写字母、数字、连字符，2-40 位</p>
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
              <p className="mt-1 text-[11px] text-muted-foreground">
                这段会作为技能说明给 AI 看，决定 AI 何时调用本技能。建议写清触发场景，例：用户要部署到服务器时按本技能打包镜像。
              </p>
              {descTooShort && (
                <p className="mt-1 text-[11px] text-amber-600">描述太短，AI 可能判断不出何时调用。</p>
              )}
            </div>
          </div>

          {/* 头部预览：展示后端将拼出、AI 实际读到的 frontmatter（D-008） */}
          <div className="rounded-md border bg-muted/30 px-3 py-2">
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">
              AI 实际读到的技能头部（系统自动拼装，预览）
            </p>
            <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-foreground">
              {buildFrontmatter(name.trim(), description.trim())}
            </pre>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">技能说明书正文</label>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleInsertTemplate}
                  className="h-7 gap-1 text-[11px]"
                >
                  <Sparkles className="h-3 w-3" />
                  插入步骤模板
                </Button>
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
            </div>
            {loadingDetail ? (
              <div className="h-64 rounded-md border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
                加载技能内容中...
              </div>
            ) : tab === "edit" ? (
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={STEPS_TEMPLATE}
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
            <p className="mt-1 text-[11px] text-muted-foreground">只写正文步骤，头部（名称、描述）由系统自动拼装。</p>
          </div>

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <div className="mr-auto flex items-center gap-3">
            {dirty && !loadingDetail && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleRevert}
                className="gap-1 text-[11px] text-muted-foreground"
              >
                <RotateCcw className="h-3 w-3" />
                撤销改动
              </Button>
            )}
            <span className="text-[11px] text-muted-foreground">保存后需守护进程重启才会生效</span>
          </div>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={submitting || loadingDetail || !validation.ok || !dirty}
          >
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
