"use client";

/**
 * ql-20260824-019：会话「进度」视图工具卡展开区详情组件族（自 turn-segment-views
 * 的 ql-20260824-018 Write/Edit 预览扩展而来，规则沿用 agent-log/tool-renderers）。
 *
 * 单一入口 ToolExpandBody——ToolRowView 展开容器的全部内容（参数详情 + 工具
 * result 区）：
 *
 *   - Write  内容预览（5 万字符截断+标注，复制完整原文；ql-20260709-002 规则）
 *   - Edit   行级 diff（computeLineDiff LCS + DiffView 双侧行号 + 红/绿行底，
 *            用户要求「行号 + 高亮变化」取代两个裸代码块；replace_all 徽章 +
 *            复制新文本；超大输入回退红/绿两块）
 *   - Bash   完整命令 pre；result 区改纯文本 pre + 复制输出 + 10 万字符前端
 *            兜底截断（命令输出走 Markdown 会误渲染 #/* 语法）
 *   - Read   行范围标注（offset–limit）+ 复制内容（复制 result）
 *   - Grep/Glob 参数行（path/glob/type）+ 命中 N 条（解析 result Found N match）
 *   - Agent/Task Prompt 预览（2 万字符截断 + 复制 Prompt）
 *   - 其余    通用「参数」JSON pre（2 万字符截断 + 复制参数）——覆盖 MCP /
 *            Skill / WebSearch / WebFetch 等一切工具的 args 可见性
 *
 * 容器（max-h 滚动 + 底色）归 ToolRowView，本组件只出内容 fragment。
 */

import { memo } from "react";
import type { ReactNode } from "react";

import { CopyButton } from "@/components/agent-log/tool-renderers";
import { MarkdownText } from "@/components/ui/markdown-text";
import type { ToolTurnSegment } from "@/components/daemon/session-log-assembler";
import { cn } from "@/lib/utils";

/** 参数/输出 pre 块样式（旧渲染器 CODE_CLS 语义，配色走主题 token 适配双主题）。 */
export const ARGS_PRE_CLS =
  "max-w-full whitespace-pre-wrap break-words rounded-md border border-border bg-background px-2 py-1 text-[11px] leading-5 text-foreground [overflow-wrap:anywhere]";

/** 详情块小标题（统一 10px 弱化样式）。 */
const DETAIL_LABEL_CLS = "mb-0.5 text-[10px] font-semibold text-muted-foreground";

/**
 * 解析 tool 段 raw（tool_call JSON）的 args 对象；解析失败 / 无 args → null。
 * 与 turn-segment-views toolCopyText 同容错口径（R-07：非 JSON 不抛错）。
 */
function parseToolArgs(raw: string): Record<string, unknown> | null {
  try {
    const obj = JSON.parse(raw.trim()) as { args?: unknown } | null;
    if (obj && typeof obj === "object" && obj.args && typeof obj.args === "object") {
      return obj.args as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function strArg(args: Record<string, unknown> | null, key: string): string {
  const v = args?.[key];
  return typeof v === "string" ? v : "";
}

function numArg(args: Record<string, unknown> | null, key: string): number {
  const v = args?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/* ───────────── Edit 行级 diff（LCS + 双侧行号 + 红/绿高亮） ───────────── */

/** diff 行：ctx=上下文（双侧行号）/ del=删除（旧侧行号）/ add=新增（新侧行号）。 */
export interface DiffRow {
  type: "ctx" | "del" | "add";
  oldNo: number | null;
  newNo: number | null;
  text: string;
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

/** diff 渲染行数上限（超长 diff 截断展示，取全量走「复制新文本」）。 */
const DIFF_MAX_ROWS = 2000;

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
          …diff 超过 {DIFF_MAX_ROWS} 行已截断，完整内容用「复制新文本」
        </div>
      )}
    </div>
  );
}

/* ───────────── 各工具参数详情（展开区上半部） ───────────── */

/** Write：内容预览（规则平移 WriteToolPreview / ql-20260709-002）。 */
function WriteArgsDetail({ raw }: { raw: string }) {
  const args = parseToolArgs(raw);
  const content = strArg(args, "content");
  if (!content) return null;
  const lineCount = content.split("\n").length;
  return (
    <div className="mb-2">
      <div className={DETAIL_LABEL_CLS}>写入内容（{lineCount} 行）</div>
      <pre className={ARGS_PRE_CLS}>
        {content.length > 50000 ? `${content.slice(0, 50000)}\n... (截断)` : content}
      </pre>
      <div className="mt-1">
        <CopyButton text={content} label="复制内容" />
      </div>
    </div>
  );
}

/** Edit：行级 diff（双侧行号 + 红/绿高亮）；超大输入回退红/绿两块。 */
function EditArgsDetail({ raw }: { raw: string }) {
  const args = parseToolArgs(raw);
  const oldStr = strArg(args, "old_string");
  const newStr = strArg(args, "new_string");
  if (!oldStr && !newStr) return null;
  const replaceAll = Boolean(args?.replace_all);
  const rows = oldStr && newStr ? computeLineDiff(oldStr, newStr) : null;
  return (
    <div className="mb-2">
      <div className={cn(DETAIL_LABEL_CLS, "flex items-center gap-2")}>
        变更对比（旧 {oldStr ? oldStr.split("\n").length : 0} 行 → 新{" "}
        {newStr ? newStr.split("\n").length : 0} 行）
        {replaceAll && (
          <span className="rounded border border-border bg-card px-1 py-px font-normal text-muted-foreground">
            全局替换
          </span>
        )}
      </div>
      {rows ? (
        <DiffView rows={rows} />
      ) : (
        <div className="space-y-1.5">
          {oldStr && (
            <div>
              <div className="mb-0.5 text-[10px] font-semibold text-red-600">- 原文本</div>
              <pre className={ARGS_PRE_CLS}>{oldStr}</pre>
            </div>
          )}
          {newStr && (
            <div>
              <div className="mb-0.5 text-[10px] font-semibold text-emerald-600">+ 新文本</div>
              <pre className={ARGS_PRE_CLS}>{newStr}</pre>
            </div>
          )}
        </div>
      )}
      {newStr && (
        <div className="mt-1">
          <CopyButton text={newStr} label="复制新文本" />
        </div>
      )}
    </div>
  );
}

/** Bash：完整命令 pre（行首 primary 单行截断，展开看全量）。 */
function BashArgsDetail({ raw }: { raw: string }) {
  const args = parseToolArgs(raw);
  const cmd = strArg(args, "command");
  if (!cmd) return null;
  return (
    <div className="mb-2">
      <div className={DETAIL_LABEL_CLS}>执行命令</div>
      <pre className={ARGS_PRE_CLS}>{cmd}</pre>
    </div>
  );
}

/** Read：行范围标注（offset–limit）+ 复制内容（复制 result 全文）。 */
function ReadArgsDetail({ raw, result }: { raw: string; result: string }) {
  const args = parseToolArgs(raw);
  const offset = numArg(args, "offset");
  const limit = numArg(args, "limit");
  if (!offset && !limit && !result) return null;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
      {(offset > 0 || limit > 0) && (
        <span>
          行 {offset > 0 ? `${offset}–${offset + limit}` : `1–${limit}`}
        </span>
      )}
      {result && <CopyButton text={result} label="复制内容" />}
    </div>
  );
}

/** Grep/Glob：参数行（path/glob/type）+ 命中 N 条（解析 result，规则平移 SearchToolPreview）。 */
function SearchArgsDetail({ raw, result }: { raw: string; result: string }) {
  const args = parseToolArgs(raw);
  const meta = [
    strArg(args, "path") && `in ${strArg(args, "path")}`,
    strArg(args, "glob") && `glob: ${strArg(args, "glob")}`,
    strArg(args, "type") && `type: ${strArg(args, "type")}`,
  ].filter(Boolean);
  const hit = result.match(/Found\s+(\d+)\s+match/i)?.[1];
  if (meta.length === 0 && hit === undefined) return null;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
      {meta.map((m) => (
        <span key={m} className="break-all">
          {m}
        </span>
      ))}
      {hit !== undefined && (
        <span>
          命中 <span className="font-medium text-foreground">{hit}</span> 条
        </span>
      )}
    </div>
  );
}

/** Agent/Task：Prompt 预览（2 万字符截断 + 复制完整原文，规则平移 AgentToolPreview）。 */
function AgentArgsDetail({ raw }: { raw: string }) {
  const args = parseToolArgs(raw);
  const prompt = strArg(args, "prompt");
  if (!prompt) return null;
  return (
    <div className="mb-2">
      <div className={DETAIL_LABEL_CLS}>Prompt</div>
      <pre className={ARGS_PRE_CLS}>
        {prompt.length > 20000 ? `${prompt.slice(0, 20000)}\n... (截断)` : prompt}
      </pre>
      <div className="mt-1">
        <CopyButton text={prompt} label="复制 Prompt" />
      </div>
    </div>
  );
}

/** 通用：参数 JSON pre（2 万字符截断 + 复制完整 JSON）——一切非专属工具的 args 可见性兜底。 */
function GenericArgsDetail({ raw }: { raw: string }) {
  const args = parseToolArgs(raw);
  if (!args) return null;
  const json = JSON.stringify(args, null, 2);
  return (
    <div className="mb-2">
      <div className={DETAIL_LABEL_CLS}>参数</div>
      <pre className={ARGS_PRE_CLS}>
        {json.length > 20000 ? `${json.slice(0, 20000)}\n... (截断)` : json}
      </pre>
      <div className="mt-1">
        <CopyButton text={json} label="复制参数" />
      </div>
    </div>
  );
}

/* ───────────── result 区（展开区下半部） ───────────── */

/** Bash 输出：纯文本 pre（不走 Markdown，防 #/* 误渲染）+ 复制输出 + 10 万字符兜底。 */
const BASH_RESULT_DISPLAY_MAX = 100_000;

function BashResultView({ text }: { text: string }) {
  const display =
    text.length > BASH_RESULT_DISPLAY_MAX
      ? `${text.slice(0, BASH_RESULT_DISPLAY_MAX)}\n...(输出过长，已截断，共 ${text.length} 字符)`
      : text;
  return (
    <div>
      <pre className={ARGS_PRE_CLS}>{display}</pre>
      <div className="mt-1">
        <CopyButton text={text} label="复制输出" />
      </div>
    </div>
  );
}

/* ───────────── 单一入口 ───────────── */

/** 参数详情分发：无专属详情且 args 可解析 → 通用参数 JSON 兜底。 */
function argsDetailOf(segment: ToolTurnSegment, result: string): ReactNode {
  const raw = segment.raw;
  if (!raw) return null;
  switch (segment.toolName) {
    case "Write":
      return <WriteArgsDetail raw={raw} />;
    case "Edit":
      return <EditArgsDetail raw={raw} />;
    case "Bash": {
      const args = parseToolArgs(raw);
      return typeof args?.command === "string" && args.command ? (
        <BashArgsDetail raw={raw} />
      ) : (
        <GenericArgsDetail raw={raw} />
      );
    }
    case "Read":
      return <ReadArgsDetail raw={raw} result={result} />;
    case "Grep":
    case "Glob":
      return <SearchArgsDetail raw={raw} result={result} />;
    case "Agent":
    case "Task": {
      const args = parseToolArgs(raw);
      return typeof args?.prompt === "string" && args.prompt ? (
        <AgentArgsDetail raw={raw} />
      ) : (
        <GenericArgsDetail raw={raw} />
      );
    }
    default:
      return <GenericArgsDetail raw={raw} />;
  }
}

/**
 * 工具卡展开区全部内容：参数详情（上半）+ result 区（下半）。
 * result 区按工具分流——Bash 纯文本 pre（+复制输出），其余 MarkdownText；
 * running 无 result → 「执行中…」占位，终态无 result → 「（无结果）」。
 */
export const ToolExpandBody = memo(function ToolExpandBody({
  segment,
  running,
}: {
  segment: ToolTurnSegment;
  running: boolean;
}) {
  const result = segment.result?.trim() ?? "";
  const detail = argsDetailOf(segment, result);
  return (
    <>
      {detail}
      {result ? (
        segment.toolName === "Bash" ? (
          <BashResultView text={result} />
        ) : (
          <MarkdownText content={result} />
        )
      ) : running ? (
        <span>执行中…</span>
      ) : (
        <span>（无结果）</span>
      )}
    </>
  );
});
