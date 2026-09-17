"use client";

/**
 * 知识条目编辑态（task-05 / 2026-09-17-knowledge-precipitation / FR-07）。
 *
 * 对照原型 editEntry：原文 Markdown textarea + 保存/取消。编辑对象仅正文——
 * YAML frontmatter 段原样展示（不可编辑），提交时把原 frontmatter 段拼回
 * content 头部（后端 PATCH 契约为整文件正文替换，见 lib/knowledge.ts
 * updateKnowledge 注释），保证 frontmatter 字节不动。
 *
 * decisions zone（D-006@v1）由归档流程幂等维护：编辑器兜底渲染只读态
 * （textarea readOnly + 标注「由归档流程维护 · 只读」，不提供保存入口）；
 * 页面侧本就不为 decisions 条目渲染编辑按钮，本守卫为第二道防线。
 *
 * 保存调 updateKnowledge 成功后经 onSaved 上抛服务端回传的新正文（父级回显
 * 并刷新列表）；取消直接 onCancel 不落盘。
 */

import { useState } from "react";
import { PencilLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { errMessage, useNotify } from "@/lib/errors";
import { updateKnowledge } from "@/lib/knowledge";

/** 把整文件原文拆成 frontmatter 段（含首尾 --- 行）与正文（无 frontmatter 时全为正文）。 */
export function splitFrontmatter(raw: string): { frontmatter: string | null; body: string } {
  if (!raw.startsWith("---")) return { frontmatter: null, body: raw };
  const lines = raw.split("\n");
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trim() === "---") {
      return {
        frontmatter: lines.slice(0, i + 1).join("\n"),
        // 剥闭合 --- 后的前导空行（展示与编辑都用正文本体；提交时统一补一个换行）。
        body: lines.slice(i + 1).join("\n").replace(/^\n+/, ""),
      };
    }
  }
  // 只有起始 --- 没有闭合段：视为无 frontmatter 的普通正文。
  return { frontmatter: null, body: raw };
}

interface Props {
  workspaceId: string;
  filename: string;
  /** 条目 zone（decisions → 只读态）。 */
  zone: string;
  /** 整文件原文（含 frontmatter，getKnowledge 回传的 content）。 */
  content: string;
  /** 保存成功：参数为服务端回传的新正文（父级回显 + 刷新列表）。 */
  onSaved: (_newContent: string) => void;
  onCancel: () => void;
}

export function EntryEditor({
  workspaceId,
  filename,
  zone,
  content,
  onSaved,
  onCancel,
}: Props) {
  const { frontmatter, body } = splitFrontmatter(content);
  const [draft, setDraft] = useState(body);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notify = useNotify();

  const readOnly = zone === "decisions";

  const handleSave = async () => {
    if (saving || readOnly) return;
    setSaving(true);
    setError(null);
    try {
      // 整文件正文替换契约：frontmatter 段原样拼回，仅正文取编辑值。
      const fullContent = frontmatter !== null ? `${frontmatter}\n${draft}` : draft;
      const updated = await updateKnowledge(workspaceId, filename, {
        content: fullContent,
      });
      // ql-20260918-001：去掉「旧内容已备份」——apply_ops 的 update 不进
      // spec-backups（仅 delete 备份），原文案与实际语义不符。
      notify.success("已保存（版本 +1）");
      onSaved(updated.content ?? fullContent);
    } catch (err) {
      setError(errMessage(err, "保存失败，请重试"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-testid="entry-editor" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <PencilLine className="h-3.5 w-3.5" />
          编辑正文（Markdown）
        </div>
        {readOnly && (
          <span
            data-testid="decisions-readonly-tag"
            className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-bold leading-4 text-brand-700"
            title="决策条目由归档流程自动维护，网页暂只读"
          >
            由归档流程维护 · 只读
          </span>
        )}
      </div>

      {frontmatter !== null && (
        <pre className="overflow-auto whitespace-pre-wrap break-words rounded-md border border-dashed bg-muted/30 p-2 font-mono text-[10.5px] leading-4 text-muted-foreground">
          {frontmatter}
        </pre>
      )}

      <textarea
        aria-label="正文编辑"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        readOnly={readOnly}
        className="min-h-[300px] w-full resize-y rounded-md border border-input bg-background p-2.5 font-mono text-xs leading-5 focus:border-ring focus:outline-none"
      />
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      <p className="text-[10.5px] text-muted-foreground">
        保存经平台直写落盘（文件版本 +1，旧内容进 30 天备份区），各端下次连接自动同步；frontmatter
        保持不动。
      </p>
      {!readOnly && (
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
            取消
          </Button>
          <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
            {saving ? "保存中…" : "保存修改"}
          </Button>
        </div>
      )}
    </div>
  );
}
