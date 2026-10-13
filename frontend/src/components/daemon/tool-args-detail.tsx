"use client";

/**
 * ql-20260824-019：会话「进度」视图工具卡展开区详情组件族（自 turn-segment-views
 * 的 ql-20260824-018 Write/Edit 预览扩展而来，规则沿用 agent-log/tool-renderers）。
 *
 * 单一入口 ToolExpandBody——ToolRowView 展开容器的全部内容（参数详情 + 工具
 * result 区）：
 *
 *   - Write  行级 diff——覆盖写优先 SDK structuredPatch（backend edit_patch 不限
 *            工具名抓取，2026-10-13-write-tool-diff）红删绿增 + 复制完整原文；
 *            无 patch（新建文件 / 非 claude provider）整文件按新增行全绿展示
 *   - Edit   行级 diff——优先 SDK structuredPatch（tool_use_result 透传，
 *            oldStart/newStart 为文件内真实行号；ql-20260824-020），无 patch
 *            回退 computeLineDiff LCS 自算（片段相对行号）；DiffView 双侧行号
 *            + 红/绿行底；replace_all 徽章 + 复制新文本；超大输入回退红/绿两块
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

import { memo, createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

import { CopyButton } from "@/components/agent-log/tool-renderers";
import { MarkdownText } from "@/components/ui/markdown-text";
import type { ToolTurnSegment } from "@/components/daemon/session-log-assembler";
// 子模块直引（precipitate-dialog 同款先例）：本函数仅在 slim 截断段展开时触达，
// 走 "@/lib/daemon" 聚合入口会被整模块 mock 的测试工厂（显式键集）在导入期
// 炸 No export；直引子模块让既有测试零改动（真实实现不被截断夹具触达）。
import { getAgentSessionLogFull } from "@/lib/daemon/sessions";
import { cn } from "@/lib/utils";

/* ───────────── slim 全文回填上下文（2026-09-27-session-fast-replay FR-07） ───────────── */

/**
 * slim 单条全文拉取上下文：Provider 挂会话面板根（sessionId 作用域），ToolExpandBody
 * 展开截断条目时经 getAgentSessionLogFull 按需拉全文替换渲染。缺省 null =
 * 宿主未声明（dialog / 群聊 viewer / 子代理面板等非 slim 数据源路径）→ 不拉取，
 * 渲染行为与改前逐字一致（零回归）。Context 方案避免 sessionId 穿透
 * SegmentView → ToolRowView → ToolExpandBody 的多层 props 链。
 */
const SlimLogFullContext = createContext<string | null>(null);

/** 挂载 slim 全文回填能力（sessionId 非空才启用；null 原样透传 children）。 */
export function SlimLogFullProvider({
  sessionId,
  children,
}: {
  sessionId: string | null;
  children: ReactNode;
}) {
  return (
    <SlimLogFullContext.Provider value={sessionId}>
      {children}
    </SlimLogFullContext.Provider>
  );
}

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

// 2026-10-13-agentlog-write-diff：DiffRow / parseStructuredPatch / DiffView 迁至
// agent-log/tool-diff 共享（agent-log WriteToolPreview 同用）；此处 re-export
// 保持既有导入面（本文件测试与 computeLineDiff 消费方）零改动。
// 2026-10-13-editpatch-fullchain：computeLineDiff 一并迁入 tool-diff
// （agent-log EditToolPreview 无 patch 时 LCS 回退同用）。
export { parseStructuredPatch, DiffView, DIFF_MAX_ROWS, computeLineDiff } from "@/components/agent-log/tool-diff";
export type { DiffRow } from "@/components/agent-log/tool-diff";

import { parseStructuredPatch, DiffView, computeLineDiff } from "@/components/agent-log/tool-diff";
import type { DiffRow } from "@/components/agent-log/tool-diff";

/* ───────────── 各工具参数详情（展开区上半部） ───────────── */

/** Write：内容预览（规则平移 WriteToolPreview / ql-20260709-002）。 */
/**
 * Write：覆盖写有 SDK structuredPatch（tool_use_result.structuredPatch 经
 * edit_patch 透传，抓取链不限工具名——Write 覆盖已有文件同样携带）→ 红删绿增
 * 真实 diff；无 patch（新建文件 / 非 claude provider 无此通道）→ 整文件按新增
 * 行全绿展示（DiffView 2000 行截断护栏复用，复制按钮恒给完整原文）。
 */
function WriteArgsDetail({ raw, editPatch }: { raw: string; editPatch?: string }) {
  const args = parseToolArgs(raw);
  const content = strArg(args, "content");
  if (!content) return null;
  const lineCount = content.split("\n").length;
  const patchRows = editPatch ? parseStructuredPatch(editPatch) : null;
  const rows: DiffRow[] =
    patchRows ??
    content.split("\n").map((text, idx) => ({
      type: "add",
      oldNo: null,
      newNo: idx + 1,
      text,
    }));
  const addCount = rows.filter((r) => r.type === "add").length;
  const delCount = rows.filter((r) => r.type === "del").length;
  return (
    <div className="mb-2">
      <div className={DETAIL_LABEL_CLS}>
        {patchRows
          ? `变更对比（覆盖写入 +${addCount} −${delCount}）`
          : `写入内容（${lineCount} 行）`}
      </div>
      <DiffView rows={rows} />
      <div className="mt-1">
        <CopyButton text={content} label="复制内容" />
      </div>
    </div>
  );
}

/** Edit：行级 diff——优先 structuredPatch 真实文件行号（ql-20260824-020），
 *  无 patch / 解析失败回退 LCS 自算；超大输入回退红/绿两块。 */
function EditArgsDetail({ raw, editPatch }: { raw: string; editPatch?: string }) {
  const args = parseToolArgs(raw);
  const oldStr = strArg(args, "old_string");
  const newStr = strArg(args, "new_string");
  if (!oldStr && !newStr) return null;
  const replaceAll = Boolean(args?.replace_all);
  const patchRows = editPatch ? parseStructuredPatch(editPatch) : null;
  const rows = patchRows ?? (oldStr && newStr ? computeLineDiff(oldStr, newStr) : null);
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
      return <WriteArgsDetail raw={raw} editPatch={segment.editPatch} />;
    case "Edit":
      return <EditArgsDetail raw={raw} editPatch={segment.editPatch} />;
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
 *
 * 2026-09-27-session-fast-replay FR-07：slim 截断条目（contentTruncated /
 * resultTruncated，装配时由日志行 content_truncated 传入）展开时按需拉取单条
 * 全文（getAgentSessionLogFull，log id 见 sourceLogId / resultSourceLogId）替换
 * 渲染；非截断条目与无上下文宿主（dialog / 群聊 viewer 等）零额外请求、行为
 * 不变。本组件仅在展开态挂载（ToolRowView open && …）→ fetch 即「展开时拉取」。
 */
export const ToolExpandBody = memo(function ToolExpandBody({
  segment,
  running,
}: {
  segment: ToolTurnSegment;
  running: boolean;
}) {
  // slim 全文回填：宿主会话 id（Provider 挂载；null = 不具备回填能力）。
  const sessionId = useContext(SlimLogFullContext);
  const rawTruncated = segment.contentTruncated === true && !!segment.sourceLogId;
  const resultTruncated =
    segment.resultTruncated === true && !!segment.resultSourceLogId;
  const canBackfill = sessionId != null && (rawTruncated || resultTruncated);
  /** 回填态：fullRaw / fullResult = 已拉到的全文（未拉 / 失败 = null）；loading / error 内联提示。 */
  const [fullRaw, setFullRaw] = useState<string | null>(null);
  const [fullResult, setFullResult] = useState<string | null>(null);
  const [fullLoading, setFullLoading] = useState(false);
  const [fullError, setFullError] = useState(false);
  useEffect(() => {
    if (!canBackfill || sessionId == null) return;
    let cancelled = false;
    setFullLoading(true);
    setFullError(false);
    const rawLogId = rawTruncated ? segment.sourceLogId! : null;
    const resultLogId = resultTruncated ? segment.resultSourceLogId! : null;
    // raw / result 两源行独立截断 → 各自按需拉取（Promise.all 并行，失败整体
    // 降级显示截断内容 + 提示，不阻断展开区其余内容）。
    void Promise.all([
      rawLogId ? getAgentSessionLogFull(sessionId, rawLogId) : null,
      resultLogId ? getAgentSessionLogFull(sessionId, resultLogId) : null,
    ])
      .then(([rawEntry, resultEntry]) => {
        if (cancelled) return;
        if (rawEntry?.content_redacted != null) setFullRaw(rawEntry.content_redacted);
        if (resultEntry?.content_redacted != null) {
          setFullResult(resultEntry.content_redacted);
        }
        setFullLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFullLoading(false);
        setFullError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [canBackfill, sessionId, segment.sourceLogId, segment.resultSourceLogId, rawTruncated, resultTruncated]);
  // 全文替换渲染：回填成功侧用全文（JSON 解析 / diff / 复制均拿到完整原文），
  // 未回填侧照旧用段内截断文本。
  const effectiveSegment =
    fullRaw != null && rawTruncated ? { ...segment, raw: fullRaw } : segment;
  const result = (fullResult != null && resultTruncated
    ? fullResult
    : (segment.result ?? "")
  ).trim();
  const detail = argsDetailOf(effectiveSegment, result);
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
      {canBackfill && (fullLoading || fullError) && (
        <p
          className={cn(
            "mt-1 text-[10px]",
            fullError ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {fullLoading
            ? "内容过长已截断，正在加载全文…"
            : "全文加载失败，当前展示截断内容"}
        </p>
      )}
    </>
  );
});
