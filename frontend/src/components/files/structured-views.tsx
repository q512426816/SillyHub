"use client";

/**
 * structured-views — 固定结构文件的可视化视图（ql-20260917-004）。
 *
 * 变更目录里的 scope-audit.json / apply-manifest.json / verify-facts.json /
 * scope-audit.patch 等产物结构固定，纯文本 dump 对人类不友好。本模块提供
 * 两个共享视图，内联预览（change-file-tree FilePreview）与全屏弹窗
 * （previewers/json/patch）共用同一渲染，不做两套：
 * - JsonView：JSON.parse 后的递归折叠树——键/值按类型着色（主题语义
 *   token），对象/数组可折叠，默认展开前两层，长字符串（sha256）截断。
 * - DiffView：unified diff 红绿渲染——解析复用 git-log/file-tree 的
 *   parseUnifiedDiff（维护双侧行号），行样式对齐 scope-file-diff-modal
 *   （add 绿底/del 红底/hunk muted），5000 行渲染上限同款护栏。
 *
 * 视图自身不限高：垂直滚动交给外层容器（内联 flex 链 / 全屏弹窗 body），
 * 仅横向在 DiffView 行容器出滚动条。
 */

import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";

import { parseUnifiedDiff } from "@/components/git-log/file-tree";
import { cn } from "@/lib/utils";

// ── JSON 视图 ─────────────────────────────────────────────────────────

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** 尝试解析；失败返回 null（调用方回落纯文本）。 */
export function tryParseJson(text: string): JsonValue | null {
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return null;
  }
}

/** 折叠态摘要：对象/数组给计数，原始值给截断字面量。 */
function summaryOf(v: JsonValue): string {
  if (Array.isArray(v)) return `[ … ] ${v.length} 项`;
  if (v !== null && typeof v === "object") return `{ … } ${Object.keys(v).length} 键`;
  return literalOf(v);
}

function literalOf(v: string | number | boolean | null): string {
  if (typeof v === "string") return `"${v.length > 48 ? v.slice(0, 48) + "…" : v}"`;
  return String(v);
}

function valueClass(v: string | number | boolean | null): string {
  if (typeof v === "string") return "text-success";
  if (typeof v === "number") return "text-primary";
  if (typeof v === "boolean") return "text-warning";
  return "italic text-muted-foreground"; // null
}

/** 原始值行：`键: "值"`（键可缺省——数组元素）。 */
function PrimitiveRow({ k, v }: { k?: string; v: string | number | boolean | null }) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5 py-px font-mono text-xs leading-relaxed">
      {k !== undefined && <span className="shrink-0 font-medium text-foreground">{k}:</span>}
      <span className={cn("min-w-0 truncate", valueClass(v))} title={typeof v === "string" ? v : undefined}>
        {literalOf(v)}
      </span>
    </div>
  );
}

/** 对象/数组节点行：折叠按钮 + 键 + 结构摘要，展开时缩进渲染子节点。 */
function BranchNode({ k, v, depth }: { k?: string; v: JsonValue[] | { [key: string]: JsonValue }; depth: number }) {
  // 默认展开前两层（root=0），更深层折叠——大文件（files 数组等）不一次铺满
  const [open, setOpen] = useState(depth < 2);
  const entries = useMemo(() => {
    if (Array.isArray(v)) return v.map((item, i) => [String(i), item] as const);
    return Object.entries(v);
  }, [v]);

  const label = Array.isArray(v) ? `[ ]` : `{ }`;

  return (
    <div className="min-w-0" data-testid="json-branch">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex min-w-0 items-baseline gap-1 rounded py-px text-left font-mono text-xs leading-relaxed hover:bg-muted/60"
        aria-expanded={open}
      >
        <ChevronRight
          className={cn("h-3 w-3 shrink-0 self-center text-muted-foreground transition-transform", open && "rotate-90")}
          aria-hidden
        />
        {k !== undefined && <span className="shrink-0 font-medium text-foreground">{k}:</span>}
        <span className="shrink-0 text-muted-foreground">{label}</span>
        {!open && <span className="min-w-0 truncate text-muted-foreground">{summaryOf(v)}</span>}
      </button>
      {open && entries.length > 0 && (
        <div className="ml-1 border-l border-border pl-3">
          {entries.map(([ck, cv]) =>
            Array.isArray(cv) || (cv !== null && typeof cv === "object") ? (
              <BranchNode key={ck} k={ck} v={cv} depth={depth + 1} />
            ) : (
              <PrimitiveRow key={ck} k={ck} v={cv} />
            ),
          )}
        </div>
      )}
      {open && entries.length === 0 && (
        <div className="ml-1 border-l border-border pl-3 font-mono text-xs text-muted-foreground">（空）</div>
      )}
    </div>
  );
}

/**
 * JSON 可视化视图。输入原始文本（内部 parse），解析失败由调用方回落纯文本。
 */
export function JsonView({ value }: { value: JsonValue }) {
  if (Array.isArray(value) || (value !== null && typeof value === "object")) {
    return (
      <div data-testid="json-view" className="min-w-0 p-1 font-mono">
        <BranchNode v={value} depth={0} />
      </div>
    );
  }
  // 顶层是原始值（少见）：单行呈现
  return (
    <div data-testid="json-view" className="p-1">
      <PrimitiveRow v={value} />
    </div>
  );
}

// ── unified diff 视图 ─────────────────────────────────────────────────

/** diff 渲染行数上限（对齐 scope-file-diff-modal 的 5000 行护栏）。 */
const DIFF_RENDER_MAX_LINES = 5000;

/**
 * unified diff 可视化视图（scope-audit.patch 等）。解析复用
 * parseUnifiedDiff；无 hunk（非 diff 格式）时渲染原始文本不炸。
 */
export function DiffView({ content }: { content: string }) {
  const lines = useMemo(() => parseUnifiedDiff(content), [content]);
  const truncated = lines.length > DIFF_RENDER_MAX_LINES;

  if (lines.length === 0) {
    return (
      <pre
        data-testid="diff-view-raw"
        className="min-w-0 flex-1 overflow-auto rounded-md border border-input bg-background p-3 font-mono text-xs leading-relaxed whitespace-pre"
      >
        {content || "（空文件）"}
      </pre>
    );
  }
  return (
    <div
      data-testid="diff-view"
      className="min-w-0 flex-1 overflow-x-auto rounded-md border bg-card font-mono text-xs leading-relaxed"
    >
      {truncated && (
        <p className="border-b border-warning/30 bg-warning/10 px-2.5 py-1.5 text-[11px] text-warning">
          差异行数超出展示上限（{DIFF_RENDER_MAX_LINES} 行），以下仅展示部分。
        </p>
      )}
      {(truncated ? lines.slice(0, DIFF_RENDER_MAX_LINES) : lines).map((l, i) =>
        l.kind === "hunk" ? (
          <div key={i} className="bg-muted px-2.5 py-0.5 text-[11px] text-muted-foreground">
            {l.text}
          </div>
        ) : (
          <div
            key={i}
            data-diff-kind={l.kind}
            className={cn(
              "flex whitespace-pre",
              l.kind === "add"
                ? "bg-success/10 text-success"
                : l.kind === "del"
                  ? "bg-error/10 text-error"
                  : "text-muted-foreground",
            )}
          >
            <span className="w-10 flex-none select-none pr-2 text-right text-[11px] text-muted-foreground/70">
              {l.oldNo ?? ""}
            </span>
            <span className="w-10 flex-none select-none pr-2 text-right text-[11px] text-muted-foreground/70">
              {l.newNo ?? ""}
            </span>
            <span className="flex-1 py-0.5 pl-1 pr-3">{l.text}</span>
          </div>
        ),
      )}
    </div>
  );
}
