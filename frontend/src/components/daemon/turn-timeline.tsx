"use client";

/**
 * task-13（2026-08-14-sessions-portal / FR-05 / D-002@v1）：会话消息流共享子组件。
 *
 * 从 interactive-session-panel.tsx 纯机械抽取（弹窗零回归，NG-04/D-002）：
 *   - 轮次时间线渲染（用户气泡 / 过程项 / agent 答复 / 错误项 / 状态徽章）
 *   - 错误横幅 + AskUserQuestion 待答卡 + 空态
 *   - 自动滚动到底部
 *
 * 「对话/全部」二态视图由 viewMode 控制（ql-20260729-005）；AskUser 提问记录按
 * run_id 穿插到对应 turn（ql-20260802-001/003）。本组件无弹窗上下文依赖，
 * /runtimes 弹窗与 /sessions 新页面均可独立 import 组装。
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bot, Wrench } from "lucide-react";

import { AskUserDialogCard } from "@/components/ask-user-dialog-card";
import { RunErrorItem } from "@/components/agent-log/run-error-item";
import type { ErrorLogItem } from "@/components/agent-log/normalize";

/** ql-20260817-003：轮次发送时间格式化（今天只显 HH:mm，跨天带 MM-DD HH:mm）。 */
function formatTurnTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay ? hm : `${p(d.getMonth() + 1)}-${p(d.getDate())} ${hm}`;
}
import { ErrorBoundary } from "@/components/error-boundary";
import { MarkdownText } from "@/components/ui/markdown-text";
import type { SessionDialogRead, SessionPermissionRequest } from "@/lib/daemon";
import { cn } from "@/lib/utils";
import { extractDialogQA } from "@/components/daemon/session-log-sanitize";

/**
 * ql-20260730-003：一个回合内按真实到达顺序排列的过程项。
 * 思考/工具/stderr 混在同一有序序列，渲染时连续 thinking 合并成一整段（被工具/stderr
 * 打断则分段、工具卡片穿插其间），保留 agent 真实执行时序——不一股脑合并丢顺序。
 * - thinking：[THINKING] 片段（可能多段，连续的才合并）
 * - tool：工具调用事件（含配对 result + 状态；raw 空串=孤儿 result 无配对 use）
 * - stderr：channel=stderr 的错误/告警文本
 */
export type SessionProcessItem =
  | { kind: "thinking"; text: string; ts?: number }
  | ({ kind: "tool" } & SessionToolEvent & { ts?: number })
  | { kind: "stderr"; text: string; ts?: number };

export type SessionUiStatus = "idle" | "creating" | "active" | "ending" | "ended" | "failed" | "reconnecting";
export type TurnUiStatus = "pending" | "running" | "interrupting" | "completed" | "failed" | "killed";

/**
 * ql-20260730-001：agent 回合内的工具调用事件（折叠卡片用）。
 * - raw：[TOOL_USE] 内容（命令/args，已剥前缀；空串=孤儿 result 无配对 use）
 * - result：配对的 [TOOL_RESULT] 内容（已剥前缀，可能缺失=进行中）
 * - status：running（未配对 result）/ ok（成功）/ deny（被拒/失败）
 */
export interface SessionToolEvent {
  raw: string;
  result?: string;
  status: "running" | "ok" | "deny";
}

export interface SessionTurnView {
  runId: string;
  turn: number | null;
  prompt: string;
  output: string;
  status: TurnUiStatus;
  seenLogIds: Set<string>;
  /**
   * ql-20260621：实时累积 token。由 SSE `tokens` 事件（执行中）与
   * `turn_completed` 事件（终态）写入；null 表示尚未收到。
   */
  inputTokens: number | null;
  outputTokens: number | null;
  /**
   * 2026-07-29-model-error-visibility / FR-04：turn 终态=failed 时拉取的结构化错误
   * 详情（GET /sessions/{id}/runs 的 error_detail 经 buildErrorLogItem 映射）。
   * null/undefined（成功 turn / brownfield / attach 历史 turn）→ 不渲染 RunErrorItem。
   * 可选：外部 logsToTurns 构造的历史 turn 不带此字段（只读 import，不改其构造）。
   */
  errorDetail?: ErrorLogItem | null;
  /**
   * ql-20260730-003：回合过程项（思考/工具/stderr），按真实到达顺序累积。
   * 默认「对话」视图只渲染 prompt + output（答复正文）；切「全部」后在答复气泡前按序
   * 渲染——连续 thinking 合并成一整段、被工具/stderr 打断则分段（保留时序）。
   * 可选：外部构造的历史 turn（logsToTurns 已填充）。
   */
  processItems?: SessionProcessItem[];
  /**
   * ql-20260802-001：真实 agent_run_id（attach 历史 turn 用）。logsToTurns 按 log.run_id
   * 分组但 turn.runId 用伪 id（__attach_history_N__）作 React key；realRunId 保留真实
   * run_id，供 AskUser 提问历史按 run_id 穿插到对应 turn（跟会话顺序，不再堆顶）。实时
   * turn 的 runId 本就是真实 run_id，realRunId 留 undefined，渲染匹配用 realRunId ?? runId。
   */
  realRunId?: string;
  /**
   * task-14（2026-08-14-sessions-portal / FR-07 / D-008@v1）：该轮生效配置快照
   * （档案 · 智能体 · 供应商），由父层从 attach 历史 logs 的 run 级快照构造。
   * who 行读快照而非会话当前配置——切换后历史消息保持当时配置不跟随（D-008）。
   * profileName/providerName 为 null 时如实显示「未指定」/「本机默认」。
   * 可选：不传（/runtimes 弹窗旧组装 / 实时 turn 未带快照）→ 不渲染，行为不变（零回归）。
   */
  whoLine?: {
    /** 档案名；null=该轮未指定档案。 */
    profileName: string | null;
    /** 智能体展示名（该轮 run 所属 runtime）。 */
    agentName: string;
    /** 供应商名；null=该轮用本机默认供应商。 */
    providerName: string | null;
  };
  /**
   * ql-20260817-003：轮次发送者（共享守护进程场景多用户同会话）。父层从
   * runs 快照（run.user_id + sender_name）注入。可选：不传（/runtimes 弹窗
   * 旧组装 / 旧 run 无发送者数据）→ 用户气泡不显示发送行（零回归）。
   */
  sender?: {
    /** 发送者显示名（后端 users.display_name）。 */
    name: string;
    /** true=会话属主（当前用户视角显示「我」）。 */
    me?: boolean;
    /** 轮次开始时间 ISO（无则前端不显示时间）。 */
    at: string | null;
  };
}

/** 消息视图模式（ql-20260729-005）：对话=只显用户消息+答复正文；全部=追加过程项。 */
export type SessionViewMode = "conversation" | "all";

export interface TurnTimelineProps {
  turns: SessionTurnView[];
  viewMode: SessionViewMode;
  errorMsg: string | null;
  /**
   * pending 待答卡渲染门控：ended/failed 会话不回显（ql-20260623 改动三，死卡防护）。
   */
  sessionStatus: SessionUiStatus;
  /** AskUserQuestion 待答卡队列（permission_request.dialog_kind）。 */
  pendingRequests: SessionPermissionRequest[];
  /** AskUser 提问历史（ql-20260801-003，按 run_id 穿插到对应 turn）。 */
  dialogHistory: SessionDialogRead[];
  /** 待答卡提交/被 resolved 后移除（父级双保险过滤）。 */
  onDialogResolved: (requestId: string) => void;
  /** 失败轮次「重新发送」（RunErrorItem onResend，父级守卫 turn 级串行）。 */
  onResend: (prompt: string) => void;
  /** RunErrorItem 主操作「切换供应商」。 */
  onSwitchProvider: () => void;
  /** 空态文案两态：在线显示 provider 已就绪；离线显示无守护进程。 */
  hasOnlineProvider: boolean;
  /** 空态文案：在线 provider 展示名（父级经 PROVIDER_META 解析后传入）。 */
  emptyProviderLabel: string;
}

export function TurnTimeline({
  turns,
  viewMode,
  errorMsg,
  sessionStatus,
  pendingRequests,
  dialogHistory,
  onDialogResolved,
  onResend,
  onSwitchProvider,
  hasOnlineProvider,
  emptyProviderLabel,
}: TurnTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && typeof el.scrollTo === "function") {
      el.scrollTo(0, el.scrollHeight);
    }
  }, [turns]);

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-background px-5 py-5">
      {errorMsg && (
        <div className="mb-3 rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {errorMsg}
        </div>
      )}
      {/* ql-20260621：AskUserQuestion 对话卡（permission_request.dialog_kind）。
          sticky top-0 让用户在长日志滚动时仍可见、可作答；提交 / SSE resolved
          后自动移除。普通工具审批（无 dialog_kind）不在本面板展示。
          ql-20260623（改动三）：ended/failed 会话不回显 pending dialog 卡片
         （session 已终止，残留 pending 行为死卡；onSessionEnded 也会清空）。 */}
      {pendingRequests.length > 0 && sessionStatus !== "ended" && sessionStatus !== "failed" && (
        <div className="sticky top-0 z-10 mb-3 space-y-2 border-b border-indigo-300 bg-indigo-50/95 px-3 py-2 shadow-sm backdrop-blur-sm">
          {pendingRequests.map((req) => (
            <ErrorBoundary
              key={req.request_id}
              label="ask-user-dialog-card"
              fallback={() => (
                <div className="text-[11px] text-red-600/70">
                  提问卡片渲染失败
                </div>
              )}
            >
              <AskUserDialogCard
                request={req}
                onResolved={onDialogResolved}
              />
            </ErrorBoundary>
          ))}
        </div>
      )}
      {/* ql-20260802-001：AskUser 提问记录已改为按 run_id 穿插到对应 turn 内（跟会话
          顺序），不再在此处堆顶展示。顶部仅保留 pending 实时交互卡片（上方 pendingRequests）。 */}
      {turns.length === 0 ? (
        <div className="flex h-full min-h-[260px] flex-col items-center justify-center text-center">
          <p className="text-xs font-medium text-foreground">
            {hasOnlineProvider
              ? `${emptyProviderLabel} 已就绪`
              : "没有在线守护进程"}
          </p>
          <p className="mt-1 max-w-[260px] text-[11px] text-muted-foreground">
            {hasOnlineProvider
              ? "首条消息将创建会话；单条 SSE 贯穿整段对话，可中途追问、打断本轮或结束会话。"
              : "启动守护进程后即可发送。"}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {turns.map((turn) => (
            <div key={turn.runId} className="space-y-2.5">
              {/* 用户消息气泡（右）。attach 中途接入的 unknown-run turn 无 prompt，不渲染。 */}
              {turn.prompt && (
                <div className="flex flex-col items-end gap-0.5">
                  {/* ql-20260817-003：发送者 + 时间（可选，缺省不渲染零回归）。 */}
                  {turn.sender && (
                    <span className="px-1 text-[10.5px] text-muted-foreground">
                      {turn.sender.me ? "我" : turn.sender.name}
                      {turn.sender.at ? ` · ${formatTurnTime(turn.sender.at)}` : ""}
                    </span>
                  )}
                  <div className="max-w-[82%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm leading-6 text-primary-foreground shadow-sm">
                    <div className="whitespace-pre-wrap break-words">{turn.prompt}</div>
                  </div>
                </div>
              )}
              {/* ql-20260802-003：「全部」视图把过程项（思考/工具/stderr）与 AskUser 提问
                  按 timestamp/created_at 合并排序统一渲染——AskUser 不再固定堆在过程项
                  之后，而是穿插进真实时间线（思考→工具→提问→工具→…连贯有序）。 */}
              {viewMode === "all" &&
                (() => {
                  const realRunId = turn.realRunId ?? turn.runId;
                  const turnDialogs = dialogHistory.filter((d) => d.run_id === realRunId);
                  if ((turn.processItems?.length ?? 0) === 0 && turnDialogs.length === 0) return null;
                  const merged: Array<
                    SessionProcessItem | { kind: "askUser"; dialog: SessionDialogRead; ts?: number }
                  > = [
                    ...(turn.processItems ?? []),
                    ...turnDialogs.map((d) => ({
                      kind: "askUser" as const,
                      dialog: d,
                      ts: d.created_at ? Date.parse(d.created_at) : undefined,
                    })),
                  ];
                  merged.sort(
                    (a, b) =>
                      (Number.isFinite(a.ts) ? a.ts! : 0) - (Number.isFinite(b.ts) ? b.ts! : 0),
                  );
                  return <TurnDetailsList items={merged} />;
                })()}
              {/* ql-20260802-001/003：「对话」视图用轻量 ❓ 提问记录（只显问题+作答，
                  穿插在对应 turn、答复之前）。AskUser 走 onUserDialog 不走 tool_use 日志，
                  故用 dialog 历史渲染。全部视图的 AskUser 已并入上方时间线。 */}
              {viewMode !== "all" &&
                dialogHistory
                  .filter((d) => d.run_id === (turn.realRunId ?? turn.runId))
                  .map((d) => {
                    const qa = extractDialogQA(d);
                    if (qa.length === 0) return null;
                    return (
                      <div
                        key={`dialog-${d.request_id}`}
                        className="ml-9 space-y-0.5 rounded-md border border-indigo-200 bg-indigo-50/40 px-3 py-1.5 text-xs leading-5"
                      >
                        {qa.map((item, i) => (
                          <div key={i} className="break-words">
                            <span className="font-medium text-foreground">❓ {item.question}</span>
                            <span className="ml-1 text-muted-foreground">
                              → {item.answerText ?? (d.status === "pending" ? "（待答）" : "（未回答）")}
                            </span>
                          </div>
                        ))}
                      </div>
                    );
                  })}
              {/* task-14（FR-07 / D-008@v1）：消息 who 行——读该轮 run 配置快照
                  （📋 档案 · 智能体 · ☁ 供应商），未选如实显示「未指定/本机默认」；
                  历史不跟随会话当前配置。whoLine 缺省（弹窗旧组装）不渲染（零回归）。 */}
              {turn.whoLine && (
                <div
                  aria-label="轮次配置快照"
                  className="ml-9 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground"
                >
                  <span>📋 {turn.whoLine.profileName ?? "未指定"}</span>
                  <span aria-hidden>·</span>
                  <span>{turn.whoLine.agentName}</span>
                  <span aria-hidden>·</span>
                  <span>☁ {turn.whoLine.providerName ?? "本机默认"}</span>
                </div>
              )}
              {/* agent 答复气泡（左，带助手图标）。运行中尚无答复时显示思考占位。 */}
              {turn.output ? (
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-muted text-muted-foreground">
                    <Bot className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <div className="max-w-[82%] rounded-2xl rounded-tl-md border bg-card px-4 py-2.5 text-sm leading-6 text-foreground shadow-sm">
                    <MarkdownText content={turn.output} />
                  </div>
                </div>
              ) : (
                (turn.status === "running" ||
                  turn.status === "pending" ||
                  turn.status === "interrupting") && (
                  <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-muted text-muted-foreground">
                      <Bot className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-md border bg-card px-4 py-3 shadow-sm">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/60" />
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:150ms]" />
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:300ms]" />
                      <span className="ml-1 text-xs text-muted-foreground">
                        {viewMode === "all" ? "执行中…" : "正在思考…"}
                      </span>
                    </div>
                  </div>
                )
              )}
              {turn.errorDetail && (
                <div className="flex justify-start">
                  <div className="max-w-[86%]">
                    <ErrorBoundary
                      label="run-error-item"
                      fallback={() => (
                        <div className="text-[11px] text-red-600/70">
                          运行错误展示失败
                        </div>
                      )}
                    >
                      {/* 2026-07-29-model-error-visibility：turn 失败的结构化错误展示
                          （原因 + 针对性建议 + 操作）。onResend 仅在 prompt 存在时提供，
                          RunErrorItem 内部再按 retryable 决定是否渲染「重新发送」；
                          retryable=false 时主操作自动升为「切换供应商」。 */}
                      <RunErrorItem
                        item={turn.errorDetail}
                        onResend={
                          turn.prompt.trim()
                            ? () => {
                                onResend(turn.prompt);
                              }
                            : undefined
                        }
                        onSwitchProvider={onSwitchProvider}
                      />
                    </ErrorBoundary>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-1.5 pl-9 text-[10px] text-muted-foreground">
                <TurnStatusBadge
                  status={turn.status}
                  turn={turn.turn}
                  inputTokens={turn.inputTokens}
                  outputTokens={turn.outputTokens}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- helpers ---------- */

/**
 * ql-20260729-005：「全部」视图的过程项列表，按真实到达顺序渲染。
 * 缩进对齐答复气泡（ml-9 ≈ 助手图标宽度），左侧竖线表示"执行过程"语义。
 * ql-20260730-003：连续 thinking 合并成一整段「思考过程」卡片，被工具/stderr 打断则
 * 分段（参考 agent 日志 mergedThinkingContent），工具卡片穿插其间保留时序；思考正文
 * 与工具结果均用 MarkdownText 渲染（与对话答复一致）。
 */
function TurnDetailsList({
  items,
}: {
  items: Array<SessionProcessItem | { kind: "askUser"; dialog: SessionDialogRead }>;
}) {
  // 先把连续 thinking 合并成单个渲染项（被 tool/stderr/askUser 打断则分段），保留真实顺序
  type RenderItem =
    | { kind: "thinking"; text: string }
    | { kind: "tool"; event: SessionToolEvent }
    | { kind: "stderr"; text: string }
    | { kind: "askUser"; dialog: SessionDialogRead };
  const grouped: RenderItem[] = [];
  for (const item of items) {
    if (item.kind === "thinking") {
      const last = grouped[grouped.length - 1];
      if (last && last.kind === "thinking") {
        last.text = `${last.text}\n${item.text}`;
      } else {
        grouped.push({ kind: "thinking", text: item.text });
      }
    } else if (item.kind === "tool") {
      grouped.push({
        kind: "tool",
        event: { raw: item.raw, result: item.result, status: item.status },
      });
    } else if (item.kind === "askUser") {
      grouped.push({ kind: "askUser", dialog: item.dialog });
    } else {
      grouped.push({ kind: "stderr", text: item.text });
    }
  }
  return (
    <div className="ml-9 space-y-1 border-l-2 border-muted pl-3">
      {grouped.map((item, idx) => {
        if (item.kind === "thinking") {
          const summary = item.text.replace(/\s+/g, " ").trim();
          return (
            <SessionCollapsible
              key={idx}
              tone="thinking"
              title="思考过程"
              summary={summary.slice(0, 60) + (summary.length > 60 ? "…" : "")}
            >
              <div className="rounded-md bg-muted/50 px-2.5 py-1.5 text-[11px] leading-5 text-muted-foreground">
                <MarkdownText content={item.text} />
              </div>
            </SessionCollapsible>
          );
        }
        if (item.kind === "tool") {
          return <ToolEventCard key={idx} event={item.event} />;
        }
        if (item.kind === "askUser") {
          return <AskUserToolCard key={idx} dialog={item.dialog} />;
        }
        // stderr
        return (
          <div key={idx} className="flex items-start gap-1.5 text-[11px] text-amber-700">
            <span aria-hidden className="shrink-0">⚠</span>
            <span className="min-w-0 whitespace-pre-wrap break-words">{item.text}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * ql-20260730-003：单个配对工具事件卡片。
 * 解析 raw（tool_use JSON）为工具名 + 命令 + 复制文本（parseToolRaw，解析失败原样显示），
 * 右上角状态徽章（✓ 成功 / ✗ 失败·被拒 / ⏳ 执行中），result 默认折叠（结果常太长），
 * 展开后用 MarkdownText 渲染。raw 空串=孤儿 result（无配对 use），只显示结果。
 */
function ToolEventCard({ event }: { event: SessionToolEvent }) {
  const parsed = event.raw ? parseToolRaw(event.raw) : null;
  const badge =
    event.status === "ok"
      ? { icon: "✓", cls: "text-emerald-600", title: "执行成功" }
      : event.status === "deny"
        ? { icon: "✗", cls: "text-destructive", title: "执行失败 / 被拒" }
        : { icon: "⏳", cls: "text-blue-600", title: "执行中" };
  const result = event.result?.trim() ?? "";
  return (
    <div className="rounded border border-blue-200 bg-blue-50/40 px-2 py-1.5">
      <div className="mb-0.5 flex items-center gap-1.5 text-[10px] text-blue-700">
        <Wrench className="h-3 w-3 shrink-0" aria-hidden />
        <span className="font-medium">{parsed?.tool ?? (event.raw ? "工具调用" : "工具结果")}</span>
        <span className={cn("font-mono", badge.cls)} title={badge.title} aria-label={badge.title}>
          {badge.icon}
        </span>
        {parsed?.copyText && (
          <button
            type="button"
            onClick={() => {
              const ct = parsed?.copyText ?? "";
              void navigator.clipboard?.writeText(ct);
            }}
            className="ml-auto rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
            title="复制命令"
          >
            复制
          </button>
        )}
      </div>
      {event.raw && (
        <div className="break-all font-mono text-[10px] text-muted-foreground" title={event.raw}>
          {parsed?.primary ?? event.raw}
        </div>
      )}
      {result && (
        <SessionCollapsible
          tone="tool"
          title="结果"
          summary={result.slice(0, 60) + (result.length > 60 ? "…" : "")}
        >
          <div className="rounded-md bg-muted/50 px-2 py-1 text-[10px] leading-5 text-muted-foreground">
            <MarkdownText content={result} />
          </div>
        </SessionCollapsible>
      )}
    </div>
  );
}

/**
 * ql-20260802-002/003：「全部」视图把 AskUser 提问渲染成工具调用卡片（和 Write/Bash 一致），
 * 让 AskUser 在工具区可见。AskUser 不走 tool_use 日志（走 onUserDialog 对话协议，
 * cli.ts:653-659），故用 dialog 历史数据模拟工具卡片：工具名 AskUserQuestion +
 * ✓已答/⏳待答 徽章 + 问题（参数）+ 全部可选项（选中项绿底✓，未选灰○，hover 显 description）。
 * ql-20260802-003 修复：旧版只显用户选中的那一项、看不到其余备选；现显全部 options。
 */
function AskUserToolCard({ dialog }: { dialog: SessionDialogRead }) {
  const qa = extractDialogQA(dialog);
  if (qa.length === 0) return null;
  const pending = dialog.status === "pending";
  const badge = pending
    ? { icon: "⏳", cls: "text-blue-600", title: "等待回答" }
    : { icon: "✓", cls: "text-emerald-600", title: "已回答" };
  return (
    <div className="rounded border border-blue-200 bg-blue-50/40 px-2 py-1.5">
      <div className="mb-0.5 flex items-center gap-1.5 text-[10px] text-blue-700">
        <Wrench className="h-3 w-3 shrink-0" aria-hidden />
        <span className="font-medium">AskUserQuestion</span>
        <span className={cn("font-mono", badge.cls)} title={badge.title} aria-label={badge.title}>
          {badge.icon}
        </span>
      </div>
      <div className="space-y-1">
        {qa.map((item, i) => (
          <div key={i} className="space-y-0.5">
            <div className="break-words font-mono text-[10px] text-muted-foreground">
              ❓ {item.question}
            </div>
            {item.options.length > 0 ? (
              <div className="space-y-0.5 pl-1">
                {item.options.map((opt, j) => (
                  <div
                    key={j}
                    title={opt.description}
                    className={cn(
                      "flex items-start gap-1 rounded px-1.5 py-0.5 text-[10px] leading-5",
                      opt.selected
                        ? "bg-emerald-50 font-medium text-emerald-700"
                        : "text-muted-foreground/70",
                    )}
                  >
                    <span aria-hidden className="shrink-0">
                      {opt.selected ? "✓" : "○"}
                    </span>
                    <span className="min-w-0 break-words">{opt.label}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="break-words text-muted-foreground">
                → {item.answerText ?? (pending ? "（待答）" : "（未回答）")}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * ql-20260730-003：会话气泡内的折叠卡片（灰底思考 / 蓝底工具）。
 * 带摘要的单行折叠条，点击展开内容。替代 agent-log 的 CollapsibleSection
 * （后者日志流小箭头风格与气泡不搭）。融合自 WhaleFall d5466b7e，配 processItems 渲染。
 */
function SessionCollapsible({
  tone,
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  tone: "thinking" | "tool";
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const headerCls =
    tone === "thinking"
      ? "bg-zinc-100 border-zinc-200 text-zinc-600"
      : "bg-blue-50 border-blue-200 text-blue-700";
  return (
    <div className={`overflow-hidden rounded border ${headerCls}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] font-medium"
      >
        <span className="text-[9px]">{open ? "▼" : "▶"}</span>
        <span className="shrink-0">{title}</span>
        {!open && summary && (
          <span className="ml-1 min-w-0 flex-1 truncate text-[10px] font-normal opacity-60">
            {summary}
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-current/10 bg-background px-2.5 py-2 text-foreground">
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * ql-20260730-002：解析 tool_use raw（JSON 字符串）为工具名 + 主要参数 + 复制文本。
 * 解析失败（非 JSON）返回 null，渲染时原样显示 raw。
 */
function parseToolRaw(
  raw: string,
): { tool: string; primary: string; copyText: string } | null {
  try {
    const obj = JSON.parse(raw);
    const tool = obj.tool ?? "工具";
    const args = obj.args ?? {};
    if (tool === "Bash") {
      const cmd = args.command ?? "";
      return { tool, primary: cmd, copyText: cmd };
    }
    if (tool === "Write" || tool === "Edit" || tool === "Read") {
      const fp = args.file_path ?? "";
      const ct = args.content ? `${fp}\n\n${args.content}` : fp;
      return { tool, primary: fp, copyText: ct };
    }
    if (tool === "Agent") {
      const desc = args.description ?? args.prompt ?? "";
      return { tool, primary: desc, copyText: desc };
    }
    // 通用：取 description/command/file_path/prompt，复制完整 args JSON
    const generic = args.description ?? args.command ?? args.file_path ?? args.prompt ?? raw.slice(0, 120);
    return { tool, primary: generic, copyText: JSON.stringify(args, null, 2) };
  } catch {
    return null;
  }
}

function TurnStatusBadge({
  status,
  turn,
  inputTokens,
  outputTokens,
}: {
  status: TurnUiStatus;
  turn: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}) {
  const label =
    turn != null ? `第 ${turn} 轮` : "轮次";
  const statusLabel: Record<TurnUiStatus, string> = {
    pending: "排队中",
    running: "运行中",
    interrupting: "打断中",
    completed: "已完成",
    failed: "失败",
    killed: "已中止",
  };
  const tone: Record<TurnUiStatus, string> = {
    pending: "text-muted-foreground",
    running: "text-blue-600",
    interrupting: "text-amber-600",
    completed: "text-emerald-600",
    failed: "text-destructive",
    killed: "text-amber-600",
  };
  // ql-20260621：token 显示。执行中（running/pending）有累积值时显示「输入 N…」
  // 表明实时统计进行中；终态显示完整「↑in ↓out」。两者皆 null 时不渲染。
  // 规范化 undefined → null，防御上游 env.input_tokens / turn.inputTokens 缺失。
  const inTokens = inputTokens ?? null;
  const outTokens = outputTokens ?? null;
  const showTokens = inTokens !== null || outTokens !== null;
  const isLive = status === "running" || status === "pending" || status === "interrupting";
  return (
    <span className={cn("font-mono", tone[status])}>
      {label} · {statusLabel[status]}
      {showTokens && (
        <span className="ml-1.5 text-muted-foreground/80">
          {" · "}
          {inTokens !== null ? `↑${inTokens.toLocaleString()}` : "↑0"}
          {" "}
          {outTokens !== null
            ? `↓${outTokens.toLocaleString()}`
            : isLive
              ? "↓执行中…"
              : "↓0"}
        </span>
      )}
    </span>
  );
}
