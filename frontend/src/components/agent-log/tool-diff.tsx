"use client";

/**
 * 2026-10-13-agentlog-write-diff：行级 diff 渲染原语（自 daemon/tool-args-detail
 * 迁出共享——agent-log 与 daemon 两侧工具卡复用同一 DiffView；依赖方向维持
 * daemon → agent-log 单向，同 CopyButton 先例）。
 *
 * - parseStructuredPatch：SDK structuredPatch（backend edit_patch 列透传，hunks
 *   带 oldStart/newStart 文件内真实行号，1 起始）→ DiffRow[]；'\' 为 "\ No
 *   newline at end of file" 标记行不占行号跳过；多 hunk 间插双侧空行号「…」
 *   分隔行。JSON 非法 / hunk 形状不符 → null（调用方回退自身既有展示）。
 * - DiffView：双侧行号列 + -/+ 标记 + 红删绿增行底（透明度色双主题安全）；
 *   超 DIFF_MAX_ROWS 截断展示（复制按钮由调用方提供完整原文兜底）。
 */

import { cn } from "@/lib/utils";

/** diff 行：ctx=上下文（双侧行号）/ del=删除（旧侧行号）/ add=新增（新侧行号）。 */
export interface DiffRow {
  type: "ctx" | "del" | "add";
  oldNo: number | null;
  newNo: number | null;
  text: string;
}

/**
 * SDK structuredPatch hunks → DiffRow[]。行元素前缀 ' '/'-'/'+'（'\' 标记行跳
 * 过）；JSON 非法 / hunk 形状不符 → null。
 */
export function parseStructuredPatch(patchJson: string): DiffRow[] | null {
  let hunks: unknown;
  try {
    hunks = JSON.parse(patchJson);
  } catch {
    return null;
  }
  if (!Array.isArray(hunks) || hunks.length === 0) return null;
  const rows: DiffRow[] = [];
  for (let h = 0; h < hunks.length; h += 1) {
    const hunk = hunks[h] as {
      oldStart?: unknown;
      newStart?: unknown;
      lines?: unknown;
    } | null;
    if (!hunk || typeof hunk !== "object") return null;
    if (typeof hunk.oldStart !== "number" || typeof hunk.newStart !== "number") {
      return null;
    }
    if (!Array.isArray(hunk.lines)) return null;
    let oldNo = hunk.oldStart;
    let newNo = hunk.newStart;
    if (h > 0) rows.push({ type: "ctx", oldNo: null, newNo: null, text: "…" });
    for (const line of hunk.lines) {
      if (typeof line !== "string" || line.length === 0) return null;
      const prefix = line[0];
      const text = line.slice(1);
      if (prefix === " ") {
        rows.push({ type: "ctx", oldNo, newNo, text });
        oldNo += 1;
        newNo += 1;
      } else if (prefix === "-") {
        rows.push({ type: "del", oldNo, newNo: null, text });
        oldNo += 1;
      } else if (prefix === "+") {
        rows.push({ type: "add", oldNo: null, newNo, text });
        newNo += 1;
      } else if (prefix === "\\") {
        continue;
      } else {
        return null;
      }
    }
  }
  return rows;
}

/** diff 渲染行数上限（超长 diff 截断展示，完整原文由调用方复制按钮兜底）。 */
export const DIFF_MAX_ROWS = 2000;

/** diff 视图：双侧行号列 + -/+ 标记 + 红删绿增行底（透明度色双主题安全）。 */
export function DiffView({ rows }: { rows: DiffRow[] }) {
  const capped = rows.length > DIFF_MAX_ROWS;
  const shown = capped ? rows.slice(0, DIFF_MAX_ROWS) : rows;
  return (
    <div className="overflow-hidden rounded-md border border-border bg-background font-mono text-[10.5px] leading-5">
      {shown.map((r, idx) => (
        <div
          key={idx}
          className={cn(
            "flex items-start",
            r.type === "del" && "bg-red-500/10",
            r.type === "add" && "bg-emerald-500/10",
          )}
        >
          <span className="w-7 shrink-0 select-none pr-1 text-right text-muted-foreground">
            {r.oldNo ?? ""}
          </span>
          <span className="w-7 shrink-0 select-not select-none pr-1 text-right text-muted-foreground">
            {r.newNo ?? ""}
          </span>
          <span
            className={cn(
              "w-3 shrink-0 select-none text-center font-bold",
              r.type === "del" && "text-red-600",
              r.type === "add" && "text-emerald-600",
              r.type === "ctx" && "text-muted-foreground/50",
            )}
          >
            {r.type === "del" ? "-" : r.type === "add" ? "+" : " "}
          </span>
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-all pr-2 text-foreground">
            {r.text}
          </span>
        </div>
      ))}
      {capped && (
        <div className="border-t border-border px-2 py-1 text-[10px] text-muted-foreground">
          …diff 超过 {DIFF_MAX_ROWS} 行已截断，完整内容用「复制」按钮
        </div>
      )}
    </div>
  );
}
