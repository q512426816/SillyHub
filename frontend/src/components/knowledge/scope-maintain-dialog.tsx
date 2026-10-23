"use client";

/**
 * 知识注入作用域维护对话框（2026-10-23-knowledge-scope-maintenance）。
 *
 * 用户指令入口：平台知识库页面「维护作用域」——节级维护 CLI 注入四档
 * （always/repo/module:域/关键词）。语义与 CLI `knowledge-scope.js` 同源：
 * always=每次变更恒注入；repo=本仓恒注入；module=触达知识域时注入；
 * keyword=无标记（按关键词命中，现状缺省）。
 *
 * 节目标清单来自列表接口 headings（文件全部 section），当前档位回填自
 * sections（仅含已有标记的节）。保存走 PATCH /knowledge/scope → 成功后父级
 * 刷新列表（徽标/筛选即时更新）。
 */

import { useEffect, useMemo, useState } from "react";
import { Compass } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useNotify } from "@/lib/errors";
import {
  updateKnowledgeScope,
  type KnowledgeScopeSection,
} from "@/lib/knowledge";

type ScopeValue = "always" | "repo" | "module" | "keyword";

const SCOPES: ReadonlyArray<{ value: ScopeValue; label: string; hint: string }> = [
  { value: "always", label: "always", hint: "每次变更恒注入（跨仓通用规约）" },
  { value: "repo", label: "repo", hint: "本仓每次变更恒注入（仓级约束）" },
  { value: "module", label: "module", hint: "仅当触达指定知识域时注入" },
  { value: "keyword", label: "关键词档", hint: "无标记——按关键词命中（现状缺省）" },
];

interface Props {
  workspaceId: string;
  filename: string;
  /** 文件全部 section heading（列表接口 headings）。 */
  headings: string[];
  /** 已有作用域声明的节（列表接口 sections）。 */
  sections: KnowledgeScopeSection[];
  onClose: () => void;
  /** 保存成功（父级刷新列表）。 */
  onSaved: () => void;
}

export function ScopeMaintainDialog({
  workspaceId,
  filename,
  headings,
  sections,
  onClose,
  onSaved,
}: Props) {
  const notify = useNotify();
  const [heading, setHeading] = useState(headings[0] ?? "");
  const [scope, setScope] = useState<ScopeValue>("keyword");
  const [domains, setDomains] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const current = useMemo(
    () => sections.find((s) => s.heading === heading) ?? null,
    [sections, heading],
  );

  // 目标节切换 → 回填该节当前档位（无标记=关键词档）。
  useEffect(() => {
    if (current) {
      setScope(current.scope);
      setDomains(current.domains.join(","));
    } else {
      setScope("keyword");
      setDomains("");
    }
  }, [current, heading]);

  const submit = async () => {
    if (!heading) {
      notify.warning("请选择目标节");
      return;
    }
    setSubmitting(true);
    try {
      const doms =
        scope === "module"
          ? domains
              .split(/[,，\s]+/)
              .map((d) => d.trim())
              .filter(Boolean)
          : [];
      await updateKnowledgeScope(workspaceId, {
        filename,
        heading,
        scope,
        domains: doms,
      });
      notify.success(`作用域已保存：${heading} → ${scope === "keyword" ? "关键词档" : scope}`);
      onSaved();
      onClose();
    } catch (err) {
      notify.error(err, "保存作用域失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
            <Compass className="h-5 w-5" />
          </div>
          <DialogTitle>维护注入作用域</DialogTitle>
          <DialogDescription>
            {filename} · 节级声明知识注入作用域（flow start 注入块会按档位呈现）。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label
              htmlFor="scope-heading"
              className="text-xs font-medium text-muted-foreground"
            >
              目标节 <span className="text-destructive">*</span>
            </label>
            <select
              id="scope-heading"
              aria-label="目标节"
              data-testid="scope-heading-select"
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              value={heading}
              onChange={(e) => setHeading(e.target.value)}
              disabled={submitting}
            >
              {headings.length === 0 ? (
                <option value="">（该文件无可维护的 section）</option>
              ) : (
                headings.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))
              )}
            </select>
          </div>

          <fieldset>
            <legend className="text-xs font-medium text-muted-foreground">注入作用域</legend>
            <div className="mt-1 space-y-1.5">
              {SCOPES.map((s) => (
                <label
                  key={s.value}
                  className="flex cursor-pointer items-start gap-2 rounded-md border border-border/60 px-2 py-1.5 text-xs hover:border-brand-400"
                >
                  <input
                    type="radio"
                    name="knowledge-scope"
                    value={s.value}
                    data-testid={`scope-radio-${s.value}`}
                    checked={scope === s.value}
                    onChange={() => setScope(s.value)}
                    disabled={submitting}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-mono font-semibold">{s.label}</span>
                    <span className="text-muted-foreground"> — {s.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {scope === "module" && (
            <div>
              <label
                htmlFor="scope-domains"
                className="text-xs font-medium text-muted-foreground"
              >
                知识域 id（逗号分隔，与 FR 域同源）
              </label>
              <Input
                id="scope-domains"
                aria-label="知识域 id"
                data-testid="scope-domains-input"
                className="mt-1"
                value={domains}
                onChange={(e) => setDomains(e.target.value)}
                placeholder="cli-entry,core-engine"
                disabled={submitting}
              />
            </div>
          )}

          <p className="text-[11px] leading-5 text-muted-foreground">
            写入形态：节 heading 下一行 HTML 注释{" "}
            <code className="rounded bg-muted px-1">
              {"<!-- scope: always|repo|module:域 -->"}
            </code>
            ；关键词档=移除标记。仅知识手册（top zone）顶层文件可维护，保存走单写者语义（其他节内容不动）。
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={submitting || !heading}
            data-testid="scope-save-button"
          >
            {submitting ? "保存中…" : "保存作用域"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
