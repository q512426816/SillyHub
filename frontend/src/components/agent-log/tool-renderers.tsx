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

function StatusBadge({ status, success }: { status: "allowed" | "pending"; success: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium",
        status === "pending"
          ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
          : success
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
            : "border-red-500/30 bg-red-500/10 text-red-300",
      )}
    >
      {status === "pending" ? "待审批" : success ? "已通过" : "失败"}
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
      className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
      title={label}
    >
      <Copy className="h-2.5 w-2.5" />
      {copied ? "已复制" : label}
    </button>
  );
}

export function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-800"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {title}
      </button>
      {open && <div className="mt-1">{children}</div>}
    </div>
  );
}

const CODE_CLS =
  "max-w-full whitespace-pre-wrap break-words rounded-md border border-zinc-800 bg-black/30 px-2 py-1 text-[11px] leading-5 text-zinc-400 [overflow-wrap:anywhere]";

/* ------------------------------------------------------------------ */
/*  Tool preview props                                                 */
/* ------------------------------------------------------------------ */

interface ToolPreviewProps {
  entry: ToolCallEntry;
  mergedResult?: string;
}

/* ------------------------------------------------------------------ */
/*  Write                                                              */
/* ------------------------------------------------------------------ */

function WriteToolPreview({ entry, mergedResult }: ToolPreviewProps) {
  const rawArgs = entry.rawArgs as Record<string, unknown> | null;
  const filePath = String(rawArgs?.file_path ?? "");
  const content = typeof rawArgs?.content === "string" ? rawArgs.content : "";
  const fileName = filePath.split("/").pop() ?? filePath;
  const contentLines = content.split("\n");
  const lineCount = contentLines.length;
  const byteSize = new TextEncoder().encode(content).length;
  const firstHeading = contentLines.find((l) => /^#{1,3}\s+/.test(l))?.replace(/^#+\s*/, "");
  const isSpecDoc = filePath.includes(".sillyspec/docs");

  return (
    <div className="min-w-0 space-y-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-violet-300">
          <FileText className="h-3 w-3" />Write
        </span>
        <span className="min-w-0 break-words text-xs font-medium text-zinc-200 [overflow-wrap:anywhere]">
          {fileName}
        </span>
        <StatusBadge status={entry.status} success={entry.success} />
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-zinc-500">
        <span className="max-w-full break-all">{filePath}</span>
        <span>{lineCount} 行</span>
        <span>{byteSize > 1024 ? `${(byteSize / 1024).toFixed(1)} KB` : `${byteSize} B`}</span>
        {firstHeading && (
          <span>
            标题: <span className="text-zinc-300">{firstHeading}</span>
          </span>
        )}
      </div>
      {isSpecDoc && (
        <span className="inline-flex items-center rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-300">
          规范文档
        </span>
      )}
      {mergedResult && (
        <div className="text-[11px] text-emerald-400">{mergedResult.slice(0, 200)}</div>
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

function AgentToolPreview({ entry, mergedResult }: ToolPreviewProps) {
  const rawArgs = entry.rawArgs as Record<string, unknown> | null;
  const description = String(rawArgs?.description ?? "");
  const prompt = typeof rawArgs?.prompt === "string" ? rawArgs.prompt : "";
  const runInBackground = Boolean(rawArgs?.run_in_background);

  return (
    <div className="min-w-0 space-y-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded bg-cyan-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-300">
          <Play className="h-3 w-3" />Agent
        </span>
        {description && (
          <span className="min-w-0 break-words text-xs text-zinc-200 [overflow-wrap:anywhere]">
            {description}
          </span>
        )}
        {runInBackground && (
          <span className="inline-flex items-center rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] text-cyan-300">
            后台运行
          </span>
        )}
        <StatusBadge status={entry.status} success={entry.success} />
      </div>
      {mergedResult && (
        <div className="text-[11px] text-emerald-400">{mergedResult.slice(0, 300)}</div>
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

function BashToolPreview({ entry, mergedResult }: ToolPreviewProps) {
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
        <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
          <Terminal className="h-3 w-3" />Bash
        </span>
        <span className="min-w-0 break-words text-xs text-zinc-200 [overflow-wrap:anywhere]">
          {title}
        </span>
        <StatusBadge status={entry.status} success={entry.success} />
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
              <pre className="max-w-full whitespace-pre-wrap break-words rounded-md border border-zinc-800 bg-black/20 px-2 py-1 text-[11px] leading-5 text-zinc-400 [overflow-wrap:anywhere]">
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

function SearchToolPreview({ entry, mergedResult }: ToolPreviewProps) {
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
        <span className="inline-flex items-center gap-1 rounded bg-teal-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-teal-300">
          {isGrep ? <Search className="h-3 w-3" /> : <FolderSearch className="h-3 w-3" />}
          {isGrep ? "Grep" : "Glob"}
        </span>
        <code className="min-w-0 break-words text-xs text-amber-300 [overflow-wrap:anywhere]">
          {pattern}
        </code>
        {searchPath && <span className="text-[10px] text-zinc-500">in {searchPath}</span>}
        {glob && <span className="text-[10px] text-zinc-500">glob: {glob}</span>}
        {fileType && <span className="text-[10px] text-zinc-500">type: {fileType}</span>}
        <StatusBadge status={entry.status} success={entry.success} />
      </div>
      {mergedResult && (
        <div className="text-[10px] text-zinc-400">
          命中 <span className="font-medium text-zinc-200">{hitCount}</span> 条
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

function ReadToolPreview({ entry, mergedResult }: ToolPreviewProps) {
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
        <span className="inline-flex items-center gap-1 rounded bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-blue-300">
          <FileText className="h-3 w-3" />Read
        </span>
        <span className="min-w-0 break-words text-xs font-medium text-zinc-200 [overflow-wrap:anywhere]">
          {fileName}
        </span>
        {(offset || limit) ? (
          <span className="text-[10px] text-zinc-500">
            行 {offset ? `${offset}–${offset + limit}` : `1–${limit}`}
          </span>
        ) : null}
        <StatusBadge status={entry.status} success={entry.success} />
      </div>
      <div className="text-[10px] text-zinc-500">{filePath}</div>
      {mergedResult && (
        <div className="text-[10px] text-zinc-400">{lineCount} 行内容</div>
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

function EditToolPreview({ entry, mergedResult }: ToolPreviewProps) {
  const rawArgs = entry.rawArgs as Record<string, unknown> | null;
  const filePath = String(rawArgs?.file_path ?? "");
  const fileName = filePath.split("/").pop() ?? filePath;
  const oldStr = typeof rawArgs?.old_string === "string" ? rawArgs.old_string : "";
  const newStr = typeof rawArgs?.new_string === "string" ? rawArgs.new_string : "";
  const replaceAll = Boolean(rawArgs?.replace_all);

  return (
    <div className="min-w-0 space-y-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded bg-orange-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-orange-300">
          <FileEdit className="h-3 w-3" />Edit
        </span>
        <span className="min-w-0 break-words text-xs font-medium text-zinc-200 [overflow-wrap:anywhere]">
          {fileName}
        </span>
        {replaceAll && <span className="text-[10px] text-zinc-500">全局替换</span>}
        <StatusBadge status={entry.status} success={entry.success} />
      </div>
      <div className="text-[10px] text-zinc-500">{filePath}</div>
      {mergedResult && (
        <div className="text-[11px] text-emerald-400">{mergedResult.slice(0, 200)}</div>
      )}
      <CollapsibleSection title="变更内容">
        <div className="space-y-1.5">
          <div>
            <div className="mb-0.5 text-[10px] text-red-400">-</div>
            <pre className={cn(CODE_CLS, "line-clamp-6")}>{oldStr}</pre>
          </div>
          <div>
            <div className="mb-0.5 text-[10px] text-emerald-400">+</div>
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

function GenericToolPreview({ entry }: ToolPreviewProps) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="min-w-0 break-words font-semibold text-blue-200 [overflow-wrap:anywhere]">
          {entry.tool}
        </span>
        <StatusBadge status={entry.status} success={entry.success} />
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

export function ToolCallPreview({ entry, mergedResult }: ToolPreviewProps) {
  const tool = entry.tool.toLowerCase();
  switch (tool) {
    case "write":
      return <WriteToolPreview entry={entry} mergedResult={mergedResult} />;
    case "agent":
      return <AgentToolPreview entry={entry} mergedResult={mergedResult} />;
    case "bash":
      return <BashToolPreview entry={entry} mergedResult={mergedResult} />;
    case "grep":
    case "glob":
      return <SearchToolPreview entry={entry} mergedResult={mergedResult} />;
    case "read":
      return <ReadToolPreview entry={entry} mergedResult={mergedResult} />;
    case "edit":
      return <EditToolPreview entry={entry} mergedResult={mergedResult} />;
    default:
      return <GenericToolPreview entry={entry} />;
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
    <div className="rounded-md border border-teal-700/40 bg-teal-950/30 px-2.5 py-2">
      <div className="flex items-center gap-2 text-[11px] font-semibold text-teal-300">
        Workflow: {summary.name}
      </div>
      {summary.description && (
        <div className="mt-0.5 text-[10px] text-zinc-400">{summary.description}</div>
      )}
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-zinc-500">
        {summary.specVersion && (
          <span>版本 <span className="text-zinc-300">{summary.specVersion}</span></span>
        )}
        <span>角色 <span className="text-zinc-300">{summary.roleCount}</span></span>
        <span>输出 <span className="text-zinc-300">{summary.outputCount}</span></span>
        {summary.orchestrationMode && (
          <span>模式 <span className="text-zinc-300">{summary.orchestrationMode}</span></span>
        )}
        {summary.maxConcurrent && (
          <span>并发 <span className="text-zinc-300">{summary.maxConcurrent}</span></span>
        )}
        {summary.timeoutPerRole && (
          <span>超时 <span className="text-zinc-300">{summary.timeoutPerRole}</span></span>
        )}
      </div>
      {summary.roles.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {summary.roles.slice(0, 5).map((r, i) => (
            <div key={i} className="text-[10px] text-zinc-500">
              <span className="text-zinc-300">{r.id}</span>: {r.task.slice(0, 60)}
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
    <div className="rounded-md border border-zinc-700/50 bg-zinc-900/50 px-2.5 py-2">
      <div className="text-[11px] font-semibold text-emerald-300">Tool Result</div>
      {isLong ? (
        <>
          <div className="mt-1 space-y-0.5">
            {lines.slice(0, 5).map((line, i) => (
              <div key={i} className="truncate text-[10px] text-zinc-400">
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
        <pre className="mt-1 max-w-full whitespace-pre-wrap break-words text-[11px] leading-5 text-zinc-400 [overflow-wrap:anywhere]">
          {body}
        </pre>
      )}
    </div>
  );
}
