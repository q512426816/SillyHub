"use client";

import {
  ChevronDown,
  ChevronRight,
  Copy,
  FileEdit,
  FileText,
  FolderSearch,
  Play,
  Search,
  Terminal,
} from "lucide-react";
import { useCallback, useState } from "react";

import { cn } from "@/lib/utils";
import type { ToolCallEntry } from "./types";

import { COMMAND_COLLAPSE_CHARS, COMMAND_COLLAPSE_LINES } from "./normalize";

/* ------------------------------------------------------------------ */
/*  Shared sub-components                                              */
/* ------------------------------------------------------------------ */

/**
 * task-15 / FR-10 / D-002@v1：tool 卡片状态徽标 + 耗时。
 *
 * - pending：⏳ 琥珀色，"待审批"（无耗时——进行中/等待人审）
 * - 成功：✓ emerald + "N.Ns"（耗时由 tool_use→tool_result 时间戳差算出，AgentLogRow 传入）
 * - 失败：✗ red + "N.Ns"（参照 prototype:179/218 `.tool-status.st-ok/.st-err`）
 *
 * durationMs 缺失（result 未到 / timestamp 解析失败 / 退化场景）→ 只显示状态图标，不显示秒数。
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function StatusBadge({
  status,
  success,
  durationMs,
}: {
  status: "allowed" | "pending";
  success: boolean;
  durationMs?: number;
}) {
  const isPending = status === "pending";
  const hasDuration = typeof durationMs === "number" && !Number.isNaN(durationMs) && durationMs >= 0;
  const icon = isPending ? "⏳" : success ? "✓" : "✗";
  const label = isPending ? "待审批" : hasDuration ? formatDuration(durationMs!) : success ? "已通过" : "失败";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium",
        isPending
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : success
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-red-200 bg-red-50 text-red-700",
      )}
    >
      <span aria-hidden>{icon}</span>
      {label}
    </span>
  );
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);
  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[10px] text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950"
      title={label}
    >
      <Copy className="h-2.5 w-2.5" />
      {copied ? "已复制" : label}
    </button>
  );
}

/**
 * task-15 / FR-10：通用折叠块。
 *
 * - defaultOpen：默认展开/折叠（tool 卡片参数默认展开，thinking 默认折叠）
 * - summary：折叠态在标题右侧显示的单行摘要（如 thinking 前 60 字符 + "..."）。
 *   仅折叠态显示，展开后隐藏（内容已在 children 中完整展示）。
 *   参照 prototype:66 `.thinking-summary` 的 `text-overflow: ellipsis` 单行截断。
 */
export function CollapsibleSection({
  title,
  defaultOpen = true,
  summary,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  summary?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex min-w-0 max-w-full items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-800"
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        <span className="shrink-0">{title}</span>
        {!open && summary && (
          <span className="ml-1 min-w-0 truncate text-zinc-400 italic">
            {summary}
          </span>
        )}
      </button>
      {open && <div className="mt-1">{children}</div>}
    </div>
  );
}

const CODE_CLS =
  "max-w-full whitespace-pre-wrap break-words rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] leading-5 text-zinc-800 [overflow-wrap:anywhere]";

/* ------------------------------------------------------------------ */
/*  Tool preview props                                                 */
/* ------------------------------------------------------------------ */

/**
 * task-15 / FR-10：tool 卡片预览 props。
 * durationMs 新增：tool_use→tool_result 时间戳差，由 AgentLogRow 计算后透传。
 */
interface ToolPreviewProps {
  entry: ToolCallEntry;
  mergedResult?: string;
  durationMs?: number;
}

/* ------------------------------------------------------------------ */
/*  Write                                                              */
/* ------------------------------------------------------------------ */

function WriteToolPreview({ entry, mergedResult, durationMs }: ToolPreviewProps) {
  const rawArgs = entry.rawArgs as Record<string, unknown> | null;
  const filePath = String(rawArgs?.file_path ?? "");
  const content = typeof rawArgs?.content === "string" ? rawArgs.content : "";
  const fileName = filePath.split("/").pop() ?? filePath;
  const contentLines = content.split("\n");
  const lineCount = contentLines.length;
  // ql-20260620：超大 content（如 agent Write 巨型文件）做 TextEncoder().encode 会 OOM
  // 导致标签页崩溃（表现为 client-side exception）。超阈值时退化为按字符长度估算。
  const byteSize = content.length > 200_000
    ? content.length
    : new TextEncoder().encode(content).length;
  const firstHeading = contentLines.find((l) => /^#{1,3}\s+/.test(l))?.replace(/^#+\s*/, "");
  const isSpecDoc = filePath.includes(".sillyspec/docs");

  return (
    <div className="min-w-0 space-y-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
          <FileText className="h-3 w-3" />Write
        </span>
        <span className="min-w-0 break-words text-xs font-medium text-zinc-900 [overflow-wrap:anywhere]">
          {fileName}
        </span>
        <StatusBadge status={entry.status} success={entry.success} durationMs={durationMs} />
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-zinc-500">
        <span className="max-w-full break-all">{filePath}</span>
        <span>{lineCount} 行</span>
        <span>{byteSize > 1024 ? `${(byteSize / 1024).toFixed(1)} KB` : `${byteSize} B`}</span>
        {firstHeading && (
          <span>
            标题: <span className="text-zinc-900">{firstHeading}</span>
          </span>
        )}
      </div>
      {isSpecDoc && (
        <span className="inline-flex items-center rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-700">
          规范文档
        </span>
      )}
      {mergedResult && (
        <div className="text-[11px] font-medium text-emerald-700">{mergedResult.slice(0, 200)}</div>
      )}
      <CollapsibleSection title={`内容预览 (${lineCount} 行)`}>
        <div className="relative">
          <pre className={CODE_CLS}>
            {content.length > 5000 ? content.slice(0, 5000) + "\n... (截断)" : content}
          </pre>
          <div className="mt-1">
            <CopyButton text={content} label="复制内容" />
          </div>
        </div>
      </CollapsibleSection>
      <CollapsibleSection title="原始数据">
        <pre className={CODE_CLS}>{entry.args}</pre>
      </CollapsibleSection>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Agent                                                              */
/* ------------------------------------------------------------------ */

function AgentToolPreview({ entry, mergedResult, durationMs }: ToolPreviewProps) {
  const rawArgs = entry.rawArgs as Record<string, unknown> | null;
  const description = String(rawArgs?.description ?? "");
  const prompt = typeof rawArgs?.prompt === "string" ? rawArgs.prompt : "";
  const runInBackground = Boolean(rawArgs?.run_in_background);

  return (
    <div className="min-w-0 space-y-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded border border-cyan-200 bg-cyan-50 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-700">
          <Play className="h-3 w-3" />Agent
        </span>
        {description && (
          <span className="min-w-0 break-words text-xs text-zinc-900 [overflow-wrap:anywhere]">
            {description}
          </span>
        )}
        {runInBackground && (
          <span className="inline-flex items-center rounded border border-cyan-200 bg-cyan-50 px-1.5 py-0.5 text-[10px] text-cyan-700">
            后台运行
          </span>
        )}
        <StatusBadge status={entry.status} success={entry.success} durationMs={durationMs} />
      </div>
      {mergedResult && (
        <div className="text-[11px] font-medium text-emerald-700">{mergedResult.slice(0, 300)}</div>
      )}
      {prompt && (
        <CollapsibleSection title={`Prompt (${prompt.length} 字符)`}>
          <div className="relative">
            <pre className={CODE_CLS}>
              {prompt.length > 3000 ? prompt.slice(0, 3000) + "\n... (截断)" : prompt}
            </pre>
            <div className="mt-1">
              <CopyButton text={prompt} label="复制 Prompt" />
            </div>
          </div>
        </CollapsibleSection>
      )}
      <CollapsibleSection title="原始数据">
        <pre className={CODE_CLS}>{entry.args}</pre>
      </CollapsibleSection>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Bash                                                               */
/* ------------------------------------------------------------------ */

function BashToolPreview({ entry, mergedResult, durationMs }: ToolPreviewProps) {
  const desc = entry.description;
  const cmd = entry.command ?? "";
  const cmdLines = cmd.split("\n");
  const cmdTooLong =
    cmdLines.length > COMMAND_COLLAPSE_LINES || cmd.length > COMMAND_COLLAPSE_CHARS;
  const firstLine = cmdLines[0] ?? "";
  const title =
    desc || (cmd ? firstLine.slice(0, 80) + (firstLine.length > 80 ? "..." : "") : entry.tool);

  const resultLines = (mergedResult ?? "").split("\n");
  const hasResult = resultLines.some((l) => l.trim());

  return (
    <div className="min-w-0 space-y-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
          <Terminal className="h-3 w-3" />Bash
        </span>
        <span className="min-w-0 break-words text-xs font-medium text-zinc-900 [overflow-wrap:anywhere]">
          {title}
        </span>
        <StatusBadge status={entry.status} success={entry.success} durationMs={durationMs} />
      </div>
      {cmd && (
        <div>
          {cmdTooLong ? (
            <CollapsibleSection title="执行命令">
              <div className="relative">
                <pre className={CODE_CLS}>{cmd}</pre>
                <div className="mt-1">
                  <CopyButton text={cmd} label="复制命令" />
                </div>
              </div>
            </CollapsibleSection>
          ) : (
            <div>
              <pre className={CODE_CLS}>
                {cmd}
              </pre>
              <div className="mt-1">
                <CopyButton text={cmd} label="复制命令" />
              </div>
            </div>
          )}
        </div>
      )}
      {hasResult && (
        <CollapsibleSection title={`输出 (${resultLines.length} 行)`} defaultOpen={resultLines.length <= 10}>
          <pre className={CODE_CLS}>{mergedResult}</pre>
          <div className="mt-1">
            <CopyButton text={mergedResult ?? ""} label="复制输出" />
          </div>
        </CollapsibleSection>
      )}
      <CollapsibleSection title="原始数据">
        <pre className={CODE_CLS}>{entry.args}</pre>
      </CollapsibleSection>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Grep / Glob                                                        */
/* ------------------------------------------------------------------ */

function SearchToolPreview({ entry, mergedResult, durationMs }: ToolPreviewProps) {
  const rawArgs = entry.rawArgs as Record<string, unknown> | null;
  const isGrep = /^grep$/i.test(entry.tool);
  const pattern = String(rawArgs?.pattern ?? "");
  const searchPath = String(rawArgs?.path ?? "");
  const glob = String(rawArgs?.glob ?? "");
  const fileType = String(rawArgs?.type ?? "");

  const resultLines = (mergedResult ?? "")
    .split("\n")
    .filter((l) => l.trim());
  const foundMatch = mergedResult?.match(/Found\s+(\d+)\s+match/i);
  const hitCount = foundMatch ? parseInt(foundMatch[1] ?? "0", 10) : resultLines.length;
  const previewLines = resultLines.slice(0, 5);

  return (
    <div className="min-w-0 space-y-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded border border-teal-200 bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700">
          {isGrep ? <Search className="h-3 w-3" /> : <FolderSearch className="h-3 w-3" />}
          {isGrep ? "Grep" : "Glob"}
        </span>
        <code className="min-w-0 break-words text-xs font-medium text-amber-800 [overflow-wrap:anywhere]">
          {pattern}
        </code>
        {searchPath && <span className="text-[10px] text-zinc-500">in {searchPath}</span>}
        {glob && <span className="text-[10px] text-zinc-500">glob: {glob}</span>}
        {fileType && <span className="text-[10px] text-zinc-500">type: {fileType}</span>}
        <StatusBadge status={entry.status} success={entry.success} durationMs={durationMs} />
      </div>
      {mergedResult && (
        <div className="text-[10px] text-zinc-600">
          命中 <span className="font-medium text-zinc-900">{hitCount}</span> 条
        </div>
      )}
      {previewLines.length > 0 && (
        <div className="space-y-0.5">
          {previewLines.map((line, i) => (
            <div key={i} className="truncate text-[10px] text-zinc-500">
              {line}
            </div>
          ))}
        </div>
      )}
      {resultLines.length > 5 && (
        <CollapsibleSection title={`完整结果 (${hitCount} 条)`}>
          <pre className={CODE_CLS}>{resultLines.join("\n")}</pre>
          <div className="mt-1">
            <CopyButton text={resultLines.join("\n")} label="复制结果" />
          </div>
        </CollapsibleSection>
      )}
      <CollapsibleSection title="原始数据">
        <pre className={CODE_CLS}>{entry.args}</pre>
      </CollapsibleSection>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Read                                                               */
/* ------------------------------------------------------------------ */

function ReadToolPreview({ entry, mergedResult, durationMs }: ToolPreviewProps) {
  const rawArgs = entry.rawArgs as Record<string, unknown> | null;
  const filePath = String(rawArgs?.file_path ?? "");
  const offset = Number(rawArgs?.offset ?? 0);
  const limit = Number(rawArgs?.limit ?? 0);
  const fileName = filePath.split("/").pop() ?? filePath;

  const resultLines = (mergedResult ?? "").split("\n");
  const lineCount = resultLines.filter((l) => l.trim()).length;

  return (
    <div className="min-w-0 space-y-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
          <FileText className="h-3 w-3" />Read
        </span>
        <span className="min-w-0 break-words text-xs font-medium text-zinc-900 [overflow-wrap:anywhere]">
          {fileName}
        </span>
        {(offset || limit) ? (
          <span className="text-[10px] text-zinc-500">
            行 {offset ? `${offset}–${offset + limit}` : `1–${limit}`}
          </span>
        ) : null}
        <StatusBadge status={entry.status} success={entry.success} durationMs={durationMs} />
      </div>
      <div className="text-[10px] text-zinc-500">{filePath}</div>
      {mergedResult && (
        <div className="text-[10px] text-zinc-600">{lineCount} 行内容</div>
      )}
      <CollapsibleSection title={`文件内容 (${lineCount} 行)`}>
        <div className="relative">
          <pre className={CODE_CLS}>{mergedResult}</pre>
          {mergedResult && (
            <div className="mt-1">
              <CopyButton text={mergedResult} label="复制内容" />
            </div>
          )}
        </div>
      </CollapsibleSection>
      <CollapsibleSection title="原始数据">
        <pre className={CODE_CLS}>{entry.args}</pre>
      </CollapsibleSection>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Edit                                                               */
/* ------------------------------------------------------------------ */

function EditToolPreview({ entry, mergedResult, durationMs }: ToolPreviewProps) {
  const rawArgs = entry.rawArgs as Record<string, unknown> | null;
  const filePath = String(rawArgs?.file_path ?? "");
  const fileName = filePath.split("/").pop() ?? filePath;
  const oldStr = typeof rawArgs?.old_string === "string" ? rawArgs.old_string : "";
  const newStr = typeof rawArgs?.new_string === "string" ? rawArgs.new_string : "";
  const replaceAll = Boolean(rawArgs?.replace_all);

  return (
    <div className="min-w-0 space-y-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded border border-orange-200 bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700">
          <FileEdit className="h-3 w-3" />Edit
        </span>
        <span className="min-w-0 break-words text-xs font-medium text-zinc-900 [overflow-wrap:anywhere]">
          {fileName}
        </span>
        {replaceAll && <span className="text-[10px] text-zinc-500">全局替换</span>}
        <StatusBadge status={entry.status} success={entry.success} durationMs={durationMs} />
      </div>
      <div className="text-[10px] text-zinc-500">{filePath}</div>
      {mergedResult && (
        <div className="text-[11px] font-medium text-emerald-700">{mergedResult.slice(0, 200)}</div>
      )}
      <CollapsibleSection title="变更内容">
        <div className="space-y-1.5">
          <div>
            <div className="mb-0.5 text-[10px] font-semibold text-red-700">-</div>
            <pre className={cn(CODE_CLS, "line-clamp-6")}>{oldStr}</pre>
          </div>
          <div>
            <div className="mb-0.5 text-[10px] font-semibold text-emerald-700">+</div>
            <pre className={cn(CODE_CLS, "line-clamp-6")}>{newStr}</pre>
          </div>
        </div>
      </CollapsibleSection>
      <CollapsibleSection title="原始数据">
        <pre className={CODE_CLS}>{entry.args}</pre>
      </CollapsibleSection>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Generic fallback                                                   */
/* ------------------------------------------------------------------ */

function GenericToolPreview({ entry, durationMs }: ToolPreviewProps) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="min-w-0 break-words font-semibold text-blue-700 [overflow-wrap:anywhere]">
          {entry.tool}
        </span>
        <StatusBadge status={entry.status} success={entry.success} durationMs={durationMs} />
      </div>
      {entry.args && (
        <CollapsibleSection title="参数" defaultOpen={entry.args.length < 300}>
          <pre className={CODE_CLS}>{entry.args}</pre>
        </CollapsibleSection>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Router                                                             */
/* ------------------------------------------------------------------ */

export function ToolCallPreview({ entry, mergedResult, durationMs }: ToolPreviewProps) {
  const tool = entry.tool.toLowerCase();
  switch (tool) {
    case "write":
      return <WriteToolPreview entry={entry} mergedResult={mergedResult} durationMs={durationMs} />;
    case "agent":
      return <AgentToolPreview entry={entry} mergedResult={mergedResult} durationMs={durationMs} />;
    case "bash":
      return <BashToolPreview entry={entry} mergedResult={mergedResult} durationMs={durationMs} />;
    case "grep":
    case "glob":
      return <SearchToolPreview entry={entry} mergedResult={mergedResult} durationMs={durationMs} />;
    case "read":
      return <ReadToolPreview entry={entry} mergedResult={mergedResult} durationMs={durationMs} />;
    case "edit":
      return <EditToolPreview entry={entry} mergedResult={mergedResult} durationMs={durationMs} />;
    default:
      return <GenericToolPreview entry={entry} durationMs={durationMs} />;
  }
}

/* ------------------------------------------------------------------ */
/*  Tool result cards (standalone [TOOL_RESULT] rendering)             */
/* ------------------------------------------------------------------ */

const RESULT_COLLAPSE_LINES = 20;
const RESULT_COLLAPSE_CHARS = 2000;

/* --- Workflow Spec detection --- */

interface WorkflowSpecSummary {
  name: string;
  description: string;
  specVersion?: string;
  roleCount: number;
  roles: { id: string; name: string; task: string }[];
  outputCount: number;
  orchestrationMode?: string;
  maxConcurrent?: string;
  timeoutPerRole?: string;
}

function parseWorkflowSpec(text: string): WorkflowSpecSummary | null {
  if (!/^name:/m.test(text) || !/^roles:/m.test(text)) return null;

  const name = text.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? "";
  const description = text.match(/^description:\s*"?(.+?)"?\s*$/m)?.[1]?.trim() ?? "";
  const specVersion = text.match(/^spec_version:\s*(.+)$/m)?.[1]?.trim();

  const roles: { id: string; name: string; task: string }[] = [];
  const roleRegex = /-\s+id:\s*(.+)\n\s+name:\s*(.+)\n\s+task:\s*(.+)/g;
  let m;
  while ((m = roleRegex.exec(text)) !== null) {
    roles.push({ id: (m[1] ?? "").trim(), name: (m[2] ?? "").trim(), task: (m[3] ?? "").trim() });
  }

  const orchestrationMode = text.match(/mode:\s*(.+)$/m)?.[1]?.trim();
  const maxConcurrent = text.match(/max_concurrent:\s*(\d+)/)?.[1];
  const timeoutPerRole = text.match(/timeout_per_role:\s*(.+)/)?.[1]?.trim();

  const outputsSection = text.match(/outputs:\s*\n((?:\s+-.*\n?)*)/);
  const outputCount = outputsSection ? ((outputsSection[1] ?? "").match(/\s+-/g) || []).length : 0;

  return {
    name,
    description,
    specVersion,
    roleCount: roles.length || (text.match(/-\s+id:/g) || []).length,
    roles,
    outputCount,
    orchestrationMode,
    maxConcurrent,
    timeoutPerRole,
  };
}

/* --- WorkflowSpecResultCard --- */

function WorkflowSpecResultCard({
  summary,
  fullText,
}: {
  summary: WorkflowSpecSummary;
  fullText: string;
}) {
  return (
    <div className="rounded-md border border-teal-200 bg-teal-50 px-2.5 py-2">
      <div className="flex items-center gap-2 text-[11px] font-semibold text-teal-700">
        工作流：{summary.name}
      </div>
      {summary.description && (
        <div className="mt-0.5 text-[10px] text-zinc-700">{summary.description}</div>
      )}
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-zinc-600">
        {summary.specVersion && (
          <span>版本 <span className="text-zinc-900">{summary.specVersion}</span></span>
        )}
        <span>角色 <span className="text-zinc-900">{summary.roleCount}</span></span>
        <span>输出 <span className="text-zinc-900">{summary.outputCount}</span></span>
        {summary.orchestrationMode && (
          <span>模式 <span className="text-zinc-900">{summary.orchestrationMode}</span></span>
        )}
        {summary.maxConcurrent && (
          <span>并发 <span className="text-zinc-900">{summary.maxConcurrent}</span></span>
        )}
        {summary.timeoutPerRole && (
          <span>超时 <span className="text-zinc-900">{summary.timeoutPerRole}</span></span>
        )}
      </div>
      {summary.roles.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {summary.roles.slice(0, 5).map((r, i) => (
            <div key={i} className="text-[10px] text-zinc-600">
              <span className="font-medium text-zinc-900">{r.id}</span>: {r.task.slice(0, 60)}
            </div>
          ))}
        </div>
      )}
      <CollapsibleSection title="查看完整 YAML">
        <pre className={CODE_CLS}>{fullText}</pre>
        <div className="mt-1">
          <CopyButton text={fullText} label="复制 YAML" />
        </div>
      </CollapsibleSection>
    </div>
  );
}

/* --- ToolResultCard (generic + YAML detection) --- */

export function ToolResultCard({ body }: { body: string }) {
  const lines = body.split("\n").filter((l) => l.trim());
  const isLong = lines.length > RESULT_COLLAPSE_LINES || body.length > RESULT_COLLAPSE_CHARS;

  const spec = parseWorkflowSpec(body);
  if (spec) return <WorkflowSpecResultCard summary={spec} fullText={body} />;

  return (
    <div className="rounded-md border border-zinc-200 bg-white px-2.5 py-2">
      <div className="text-[11px] font-semibold text-emerald-700">工具结果</div>
      {isLong ? (
        <>
          <div className="mt-1 space-y-0.5">
            {lines.slice(0, 5).map((line, i) => (
              <div key={i} className="truncate text-[10px] text-zinc-700">
                {line}
              </div>
            ))}
          </div>
          <CollapsibleSection title={`完整结果 (${lines.length} 行)`}>
            <pre className={CODE_CLS}>{body}</pre>
            <div className="mt-1">
              <CopyButton text={body} label="复制结果" />
            </div>
          </CollapsibleSection>
        </>
      ) : (
        <pre className="mt-1 max-w-full whitespace-pre-wrap break-words text-[11px] leading-5 text-zinc-800 [overflow-wrap:anywhere]">
          {body}
        </pre>
      )}
    </div>
  );
}
