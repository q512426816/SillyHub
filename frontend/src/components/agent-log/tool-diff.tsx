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
 * - computeLineDiff：LCS 行级 diff（2026-10-13-editpatch-fullchain 自 daemon
 *   迁入——Edit 无 structuredPatch 时回退自算，daemon 侧 re-export 兼容）。
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

/**
 * 2026-10-29-edit-diff-stat-badge：structuredPatch → diff stat 统计（跑马灯
 * 完成态条目 / 进度视图工具行尾的 +N -M 徽标数据源）。复用 parseStructuredPatch
 * 同一解析器数 add/del 行——徽标口径与展开区行级 diff 严格同源，永不自相矛盾。
 * 解析失败 / 空 hunks / 零改动（0/0）→ null（调用方不渲染，不伪造不估数）。
 */
export function diffStatFromPatch(patchJson: string): {
  added: number;
  removed: number;
} | null {
  const rows = parseStructuredPatch(patchJson);
  if (rows == null) return null;
  let added = 0;
  let removed = 0;
  for (const row of rows) {
    if (row.type === "add") added += 1;
    else if (row.type === "del") removed += 1;
  }
  if (added === 0 && removed === 0) return null;
  return { added, removed };
}

/** LCS 单元格上限（(n+1)*(m+1) dp 表内存/耗时护栏，1000×1000 行内可算）。 */
const DIFF_MAX_CELLS = 1_000_000;

/**
 * 行级 diff（LCS 最长公共子序列，dp 反向表 + 前向回溯）。旧/新文本按行对齐：
 * ctx 行双侧推进，del 行仅旧侧行号，add 行仅新侧行号（unified diff 语义）。
 * 任一侧行数乘积超 DIFF_MAX_CELLS → null（调用方回退红/绿两块，防巨型编辑
 * 卡顿——Write 型整文件重写走 Write 工具不进此路径）。
 */
export function computeLineDiff(oldStr: string, newStr: string): DiffRow[] | null {
  const a = oldStr.split("\n");
  const b = newStr.split("\n");
  if (a.length * b.length > DIFF_MAX_CELLS) return null;
  const n = a.length;
  const m = b.length;
  // dp[i][j] = a[i:] 与 b[j:] 的 LCS 长度（反向填充，回溯从 [0][0] 前向走）。
  // Int32Array 扁平化——noUncheckedIndexedAccess 下 number[][] 索引返回
  // number|undefined，扁平 typed array 索引恒为 number（越界语义不存在于
  // 本函数受控下标域）。
  // noUncheckedIndexedAccess 下 typed array 索引也返回 number|undefined——
  // 下标域受控（i≤n, j≤m），经 asArray 断言收窄（读取值不存在即算法 bug）。
  const dp = new Int32Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => dp[i * (m + 1) + j] as number;
  const setAt = (i: number, j: number, v: number) => {
    dp[i * (m + 1) + j] = v;
  };
  for (let i = n - 1; i >= 0; i -= 1) {
    const ai = a[i];
    if (ai === undefined) continue;
    for (let j = m - 1; j >= 0; j -= 1) {
      const bj = b[j];
      const nextDown = at(i + 1, j);
      const nextRight = at(i, j + 1);
      setAt(i, j, ai === bj ? at(i + 1, j + 1) + 1 : Math.max(nextDown, nextRight));
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  let oldNo = 0;
  let newNo = 0;
  while (i < n && j < m) {
    const ai = a[i];
    const bj = b[j];
    if (ai === undefined || bj === undefined) break;
    if (ai === bj) {
      oldNo += 1;
      newNo += 1;
      rows.push({ type: "ctx", oldNo, newNo, text: ai });
      i += 1;
      j += 1;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      oldNo += 1;
      rows.push({ type: "del", oldNo, newNo: null, text: ai });
      i += 1;
    } else {
      newNo += 1;
      rows.push({ type: "add", oldNo: null, newNo, text: bj });
      j += 1;
    }
  }
  while (i < n) {
    const ai = a[i];
    if (ai === undefined) break;
    oldNo += 1;
    rows.push({ type: "del", oldNo, newNo: null, text: ai });
    i += 1;
  }
  while (j < m) {
    const bj = b[j];
    if (bj === undefined) break;
    newNo += 1;
    rows.push({ type: "add", oldNo: null, newNo, text: bj });
    j += 1;
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
