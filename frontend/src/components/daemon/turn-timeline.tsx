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
 *
 * task-06（2026-08-19-session-stream-ux / FR-01 / FR-02 / FR-06 / design §5 Phase2
 * + §9.3）：渲染层 v2 段模型双路径——
 *   - turn.segments 非 undefined → v2 路径（SegmentedTurnBody）：「对话」视图渲染
 *     文本段（每段独立气泡）+ 运行中 TurnStatusBar（内置，Grill X-09 两消费方自动
 *     获得）；「全部（进度语义）」视图渲染完整段时间线（ml-9 竖线容器 + SegmentView
 *     段组件族），AskUser 记录按 ts 与段合并排序穿插（merged 逻辑平移）；
 *   - turn.segments === undefined（孤儿 turn 构造 / 旧数据）→ 旧渲染路径回退：
 *     output 单气泡 + processItems TurnDetailsList（§9.3 过渡期双路径，保留不删）；
 *   - whoLine / sender / errorDetail / 孤儿 turn 紧凑标记 / TurnStatusBadge / 空态 /
 *     滚动到底等现有特性两路径共享不动。
 *
 * task-13（2026-08-20-frontend-ai-native-style / FR-05 / D-004@v1）：会话页 AI
 * 原生观感细节，仅表现层——whoLine 改 .sh-ctx-chip 引用 chip、ThinkingPlaceholder
 * 三点改 .sh-typing-dots、旧路径 output 气泡运行中尾挂 .sh-stream-caret 流式光标
 * （utility 与 reduced-motion 降级均在 globals.css；v2 路径流式光标由
 * TextSegmentView 的 .seg-caret 承担，双路径语义一致）。数据逻辑 / SSE 零改动。
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bot, Wrench } from "lucide-react";
import { Badge } from "antd";

import { AskUserDialogCard } from "@/components/ask-user-dialog-card";
import { RunErrorItem } from "@/components/agent-log/run-error-item";
import type { ErrorLogItem } from "@/components/agent-log/normalize";
import type { TurnSegment } from "@/components/daemon/session-log-assembler";
import { SegmentView } from "@/components/daemon/turn-segment-views";
import { TurnStatusBar } from "@/components/daemon/turn-status-bar";
// 2026-08-20-session-multimodal-attachments task-13（D-3）：历史附件标记行解析
// + 图片缩略图/文件 chip 渲染。
import { parseAttachmentMarkers } from "@/components/daemon/runtime-session-helpers";
import { AttachmentChips } from "@/components/daemon/attachment-chips";

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
  /**
   * ql-20260817-004：该轮 agent 答复完成时间 ISO（run.finished_at，运行中/
   * 旧数据为 undefined/null → 不显示）。答复气泡右下角显示，与用户消息时间对齐。
   */
  replyAt?: string | null;
  /**
   * task-06（2026-08-19-session-stream-ux / FR-01 / design §7）：结构化段
   * 时间线（session-log-assembler 装配产物，task-01/02/11 产出）。非 undefined
   * 时渲染走 v2 段模型路径（SegmentedTurnBody：对话=文本段+运行中状态条、
   * 全部「进度」=完整段线 + AskUser 按 ts 穿插）；undefined（孤儿 turn 构造 /
   * 旧数据）走旧渲染回退（output 单气泡 + processItems，§9.3）。空数组 = 已装配
   * 但尚无段（运行初期），仍走 v2 路径（状态条/思考占位生效）。
   */
  segments?: TurnSegment[];
  /**
   * task-06（FR-02 / Grill X-01）：轮级状态条计时锚点（AssembledTurn 透传）：
   * live = 本地发送占位时刻；attach = run 快照 started_at；均缺 = 首条 log
   * timestamp。null/undefined → 运行中轮不渲染状态条（缺锚点，消费方 task-09
   * 接线后常态有值）。
   */
  turnStartedAt?: number | null;
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
  /**
   * ql-20260823-002-6a1a：消息流末尾注入位（会话式条目挂载口）——渲染在最后
   * 一个 turn 之后、同一滚动容器内，让附加信息以「对话流里的一条消息」形态出现
   * （先例：AgentLogCard 本地 Agent 日志条目）而非面板级独立卡片。null/undefined
   * 不渲染（零回归）；空 turns（空态占位）不渲染（流不存在无落点）。
   */
  streamFooter?: ReactNode;
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
  streamFooter,
}: TurnTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // ql-20260822-010：贴底跟随——原实现每次 turns 更新无条件 scrollTo 底部，
  // 用户上滚读历史时被流式更新反复拉回底部。改为：onScroll 维护「距底 <
  // 阈值」ref，仅贴底时跟随新内容滚底；新增 pending 轮（用户刚发送/入队
  // 消息的占位 turn）例外强制回底——用户应立即看到自己发出的消息。
  const isNearBottomRef = useRef(true);
  const lastTurnKeyRef = useRef<string | null>(null);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    isNearBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof el.scrollTo !== "function") return;
    const last = turns[turns.length - 1] ?? null;
    const turnKey = last ? `${last.runId}:${last.turn ?? "-"}` : null;
    // 占位 turn（status=pending）首次出现视为「用户刚发送」→ 无条件回底；
    // 同一 turn 后续状态更新（running/completed）不再触发强制回底。
    const isNewPendingTurn =
      last !== null && last.status === "pending" && lastTurnKeyRef.current !== turnKey;
    lastTurnKeyRef.current = turnKey;
    if (isNewPendingTurn || isNearBottomRef.current) {
      el.scrollTo(0, el.scrollHeight);
    }
  }, [turns]);

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      data-testid="turn-timeline-scroll"
      className="min-h-0 flex-1 overflow-y-auto bg-background px-5 py-5"
    >
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
            // ql-20260818-011：静默切换轮（无 prompt/output，有 whoLine，已
            // 完成）→ 渲染为紧凑一行配置变更标记，不占轮次气泡。
            !turn.prompt && !turn.output && !!turn.whoLine && turn.status === 'completed' ? (
              <div
                key={turn.runId}
                className="flex items-center gap-1.5 text-[11px] text-muted-foreground opacity-70"
              >
                <span>⚙</span>
                {turn.replyAt && <span>{formatTurnTime(turn.replyAt)}</span>}
                <span>· 📋 {turn.whoLine!.profileName ?? '未指定'}</span>
                <span>· {turn.whoLine!.agentName}</span>
                <span>· ☁ {turn.whoLine!.providerName ?? '本机默认'}</span>
              </div>
            ) : <div key={turn.runId} className="space-y-2.5">
              {/* 用户消息气泡（右）。attach 中途接入的 unknown-run turn 无 prompt，不渲染。
                  ql-20260817-007：与 agent 答复对称——[时间][气泡][发送者头像]；
                  头像无图时用用户名首字（同顶栏用户菜单 AvatarFallback 模式）。 */}
              {turn.prompt && (
                <div className="flex items-end justify-end gap-1.5">
                  {turn.sender?.at && (
                    <span className="shrink-0 pb-1 text-[10.5px] text-muted-foreground">
                      {formatTurnTime(turn.sender.at)}
                    </span>
                  )}
                  <div className="max-w-[82%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm leading-6 text-primary-foreground shadow-sm">
                    {/* task-13：剥离历史附件标记行（D-3），文本与 chips 分层渲染 */}
                    {(() => {
                      const parsed = parseAttachmentMarkers(turn.prompt);
                      return (
                        <>
                          {parsed.attachments.length > 0 && (
                            <AttachmentChips attachments={parsed.attachments} />
                          )}
                          {parsed.text && (
                            <div className="whitespace-pre-wrap break-words">{parsed.text}</div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                  {turn.sender && (
                    <span
                      title={turn.sender.me ? `我（${turn.sender.name}）` : turn.sender.name}
                      aria-label={`发送者 ${turn.sender.me ? "我" : turn.sender.name}`}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-muted text-xs font-medium text-muted-foreground"
                    >
                      {(turn.sender.name.trim()[0] ?? "?").toUpperCase()}
                    </span>
                  )}
                </div>
              )}
              {/* ql-20260802-003：「全部」视图把过程项（思考/工具/stderr）与 AskUser 提问
                  按 timestamp/created_at 合并排序统一渲染——AskUser 不再固定堆在过程项
                  之后，而是穿插进真实时间线（思考→工具→提问→工具→…连贯有序）。
                  task-06（§9.3）：本块为旧渲染回退路径（segments 缺省的 turn）；带
                  segments 的 turn 的 AskUser 穿插由 SegmentedTurnBody 段线合并排序承担。 */}
              {viewMode === "all" &&
                turn.segments === undefined &&
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
                  历史不跟随会话当前配置。whoLine 缺省（弹窗旧组装）不渲染（零回归）。
                  task-13（FR-05 / D-004@v1）：展示改 .sh-ctx-chip 上下文引用 chip
                  （虚线描边浅底，brand 阶随主题，globals.css utility）——数据源仍为
                  快照三字段，不加新数据，缺省不渲染语义不变。 */}
              {turn.whoLine && (
                <div aria-label="轮次配置快照" className="ml-9">
                  <span className="sh-ctx-chip">
                    <span>📋 {turn.whoLine.profileName ?? "未指定"}</span>
                    <span aria-hidden>·</span>
                    <span>{turn.whoLine.agentName}</span>
                    <span aria-hidden>·</span>
                    <span>☁ {turn.whoLine.providerName ?? "本机默认"}</span>
                  </span>
                </div>
              )}
              {/* task-06（FR-01 / design §5 Phase2 + §9.3）：渲染主体双路径分支。
                  segments 非 undefined → v2 段模型（SegmentedTurnBody：对话=文本段
                  逐段气泡 + 运行中状态条；全部「进度」=完整段时间线 + AskUser 穿插）；
                  segments undefined（孤儿 turn 构造 / 旧数据）→ 旧渲染路径回退（output
                  单气泡 + processItems），行为与现状等价（回退不崩不空）。 */}
              {turn.segments !== undefined ? (
                <SegmentedTurnBody
                  segments={turn.segments}
                  turnStatus={turn.status}
                  turnStartedAt={turn.turnStartedAt}
                  viewMode={viewMode}
                  replyAt={turn.replyAt}
                  runKey={turn.realRunId ?? turn.runId}
                  dialogHistory={dialogHistory}
                />
              ) : (
                <>
                  {/* 旧路径（回退）：agent 答复单气泡（左，带助手图标）。运行中尚无答复时显示思考占位。 */}
                  {turn.output ? (
                    <div className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-muted text-muted-foreground">
                        <Bot className="h-3.5 w-3.5" aria-hidden />
                      </span>
                      <div className="flex items-end gap-1.5">
                        <div className="max-w-[82%] rounded-2xl rounded-tl-md border bg-card px-4 py-2.5 text-sm leading-6 text-foreground shadow-sm">
                          <MarkdownText content={turn.output} />
                          {/* task-13（FR-05 / D-004@v1）：流式光标——旧路径 output
                              气泡运行中（isLiveTurn 三态）挂正文尾，轮终态随条件转
                              false 移除；与 v2 路径 TextSegmentView 的 .seg-caret 同
                              语义（双路径一致）。utility/降级见 globals.css
                              .sh-stream-caret。 */}
                          {isLiveTurn(turn.status) && (
                            <span aria-hidden className="sh-stream-caret" />
                          )}
                        </div>
                        {/* ql-20260817-004：答复完成时间（run.finished_at，缺省不渲染）。 */}
                        {turn.replyAt && (
                          <span className="shrink-0 pb-1 text-[10.5px] text-muted-foreground">
                            {formatTurnTime(turn.replyAt)}
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    isLiveTurn(turn.status) && <ThinkingPlaceholder viewMode={viewMode} />
                  )}
                </>
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
          {/* ql-20260823-002-6a1a：消息流末尾注入位（props.streamFooter）——
              最后一个 turn 之后、同一 space-y-5 流容器内渲染，附加信息以
              「对话流里的一条消息」形态出现（AgentLogCard 先例）。 */}
          {streamFooter}
        </div>
      )}
    </div>
  );
}

/* ---------- helpers ---------- */

/* ═════════ v2 段模型渲染（task-06 / 2026-08-19-session-stream-ux） ═════════ */

/** task-06：轮处于运行中三态（状态条 / 思考占位的渲染门控）。 */
function isLiveTurn(status: TurnUiStatus): boolean {
  return status === "running" || status === "pending" || status === "interrupting";
}

/**
 * 运行中尚无答复/文本段的思考占位（三点脉冲 + 文案）——markup 自旧内联渲染抽出
 * （task-06 双路径共用：旧路径 output 空时、v2 路径无 text 段时）。全部视图文案
 * 「执行中…」、对话视图「正在思考…」（原语义平移）。
 */
function ThinkingPlaceholder({ viewMode }: { viewMode: SessionViewMode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-muted text-muted-foreground">
        <Bot className="h-3.5 w-3.5" aria-hidden />
      </span>
      <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-md border bg-card px-4 py-3 shadow-sm">
        {/* task-13（FR-05 / D-004@v1）：三点由内联 animate-pulse tailwind 类改为
            .sh-typing-dots utility（stagger 脉冲动画统一由 globals.css 承担，
            reduced-motion 静止半透明退化见该文件）；语义文案不变。 */}
        <span aria-hidden className="sh-typing-dots">
          <span />
          <span />
          <span />
        </span>
        <span className="ml-1 text-xs text-muted-foreground">
          {viewMode === "all" ? "执行中…" : "正在思考…"}
        </span>
      </div>
    </div>
  );
}

/** 段时间戳（AskUser 穿插排序用）：text/tool 用 startedAt、thinking/stderr 用 ts；
 *  subagent_stub 是临时容器无自身时刻 → null（排序视为 0，同旧路径缺 ts 语义）。 */
function segmentTsOf(seg: TurnSegment): number | null {
  switch (seg.kind) {
    case "text":
      return seg.startedAt;
    case "thinking":
      return seg.ts;
    case "tool":
      return seg.startedAt;
    case "stderr":
      return seg.ts;
    case "subagent_stub":
      return null;
  }
}

/** 「全部（进度）」视图合并时间线项：段 或 AskUser 提问记录（按 ts 与段穿插）。 */
type SegmentTimelineItem =
  | { kind: "segment"; segment: TurnSegment; ts: number | null }
  | { kind: "askUser"; dialog: SessionDialogRead; ts: number | null };

/**
 * task-06（FR-01 / FR-02 / FR-06）：v2 段模型轮渲染主体（segments 非 undefined 的
 * turn 专用，双视图分支 + 内置轮级状态条）：
 *
 *   - 「对话」视图（viewMode=conversation）：只渲染 text 段（每段独立气泡，贴原型
 *     .seg-text；思考/工具/子代理/stderr 段不挂载——渲染经济，FR-06），轻量 ❓
 *     AskUser 记录由外层共享逻辑渲染（答复之前）；
 *   - 「全部（进度）」视图（viewMode=all）：完整段时间线——ml-9 竖线容器（原型
 *     .turn-timeline：左缩进 36px + 2px 边线 + 14px 内距 + 6px 段距）内按序渲染
 *     SegmentView 段组件族（key=segment.id，段级 memo 由 task-05 保证）；AskUser
 *     提问记录按 created_at 与段 ts 合并排序穿插（merged 排序逻辑平移自旧路径，
 *     渲染复用 AskUserToolCard 工具卡片）；
 *   - TurnStatusBar 内置（FR-02 / Grill X-09）：轮处于 pending/running/interrupting
 *     且计时锚点 turnStartedAt 有值时渲染（两视图同显，段序列之前）；终态或锚点
 *     缺失不挂载；
 *   - 运行中且尚无 text 段：显示思考占位（ThinkingPlaceholder，同旧路径文案）；
 *   - replyAt：答复完成时间，段序列之后小字显示（特性保持）。
 *
 * 渲染经济性：段合并时间线 / 文本段过滤均 useMemo（segments 引用未变时跳过重算，
 * 装配器 path-copy 保证未触及段引用稳定）；段组件由 SegmentView 内部 memo。
 */
function SegmentedTurnBody({
  segments,
  turnStatus,
  turnStartedAt,
  viewMode,
  replyAt,
  runKey,
  dialogHistory,
}: {
  segments: TurnSegment[];
  turnStatus: TurnUiStatus;
  turnStartedAt: number | null | undefined;
  viewMode: SessionViewMode;
  replyAt: string | null | undefined;
  /** AskUser 提问历史按 run_id 过滤键（realRunId ?? runId，同旧路径）。 */
  runKey: string;
  dialogHistory: SessionDialogRead[];
}) {
  const turnDialogs = useMemo(
    () => dialogHistory.filter((d) => d.run_id === runKey),
    [dialogHistory, runKey],
  );
  const textSegments = useMemo(
    () => (viewMode === "all" ? null : segments.filter((s) => s.kind === "text")),
    [viewMode, segments],
  );
  const timeline = useMemo(() => {
    if (viewMode !== "all") return null;
    const items: SegmentTimelineItem[] = [
      ...segments.map((s) => ({ kind: "segment" as const, segment: s, ts: segmentTsOf(s) })),
      ...turnDialogs.map((d) => ({
        kind: "askUser" as const,
        dialog: d,
        ts: d.created_at ? Date.parse(d.created_at) : null,
      })),
    ];
    // 排序规则平移旧路径：缺 ts（NaN/null）视为 0；稳定排序保文档序。
    items.sort(
      (a, b) => (Number.isFinite(a.ts) ? a.ts! : 0) - (Number.isFinite(b.ts) ? b.ts! : 0),
    );
    return items;
  }, [viewMode, segments, turnDialogs]);

  return (
    <>
      {/* 轮级状态条（FR-02）：运行中三态 + 计时锚点有值才挂载（终态消失；锚点缺失
          容错不显示，消费方 task-09 接线后常态有值）。位置贴原型：whoLine 之后、
          段时间线之前，全宽。 */}
      {(turnStatus === "pending" || turnStatus === "running" || turnStatus === "interrupting") &&
        turnStartedAt != null && (
          <TurnStatusBar turnStartedAt={turnStartedAt} segments={segments} turnStatus={turnStatus} />
        )}
      {/* 「全部（进度）」：完整段时间线（段 + AskUser 按时间戳穿插）。空轮不渲染空容器。 */}
      {timeline != null && timeline.length > 0 && (
        <div className="ml-9 flex flex-col gap-1.5 border-l-2 border-muted pl-3.5">
          {timeline.map((item) =>
            item.kind === "segment" ? (
              <SegmentView key={item.segment.id} segment={item.segment} />
            ) : (
              <AskUserToolCard key={`dialog-${item.dialog.request_id}`} dialog={item.dialog} />
            ),
          )}
        </div>
      )}
      {/* 「对话」：只渲染 text 段，每段独立气泡（FR-01 文本不再粘连）。 */}
      {textSegments != null && textSegments.length > 0 && (
        <div className="ml-9 flex flex-col gap-1.5">
          {textSegments.map((s) => (
            <SegmentView key={s.id} segment={s} />
          ))}
        </div>
      )}
      {/* 运行中尚无 text 段（两视图同规则）：思考占位。 */}
      {isLiveTurn(turnStatus) && !segments.some((s) => s.kind === "text") && (
        <ThinkingPlaceholder viewMode={viewMode} />
      )}
      {/* 答复完成时间（run.finished_at，缺省不渲染；特性保持，段序列后小字）。 */}
      {replyAt && (
        <div className="ml-9 text-[10.5px] text-muted-foreground">{formatTurnTime(replyAt)}</div>
      )}
    </>
  );
}

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
        : { icon: "⏳", cls: "text-brand-600", title: "执行中" };
  const result = event.result?.trim() ?? "";
  return (
    <div className="rounded border border-brand-200 bg-brand-50/40 px-2 py-1.5">
      <div className="mb-0.5 flex items-center gap-1.5 text-[10px] text-brand-700">
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
    ? { icon: "⏳", cls: "text-brand-600", title: "等待回答" }
    : { icon: "✓", cls: "text-emerald-600", title: "已回答" };
  return (
    <div className="rounded border border-brand-200 bg-brand-50/40 px-2 py-1.5">
      <div className="mb-0.5 flex items-center gap-1.5 text-[10px] text-brand-700">
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
      : "bg-brand-50 border-brand-200 text-brand-700";
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
    // 通用：取 description/command/file_path/prompt/pattern/query/url（ql-20260820-008
    // 与 assembler extractPrimaryArg 同步补 pattern 系键），复制完整 args JSON
    const generic =
      args.description ?? args.command ?? args.file_path ?? args.prompt ??
      args.pattern ?? args.query ?? args.url ?? raw.slice(0, 120);
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
  // 2026-08-22-session-panel-unify task-03（FR-04 / D-003@v1）：状态色从自写 tone
  // 彩色 span 胶囊换 antd Badge status 语义档（色经 ConfigProvider token 随双主题
  // 换肤，不手写色值）。映射固定四档：running/interrupting→processing、
  // completed→success、failed/killed→error、pending 及其余中性态→default。
  const badgeStatus: Record<
    TurnUiStatus,
    "default" | "processing" | "success" | "error"
  > = {
    pending: "default",
    running: "processing",
    interrupting: "processing",
    completed: "success",
    failed: "error",
    killed: "error",
  };
  // ql-20260621：token 显示。执行中（running/pending）有累积值时显示「输入 N…」
  // 表明实时统计进行中；终态显示完整「↑in ↓out」。两者皆 null 时不渲染。
  // 规范化 undefined → null，防御上游 env.input_tokens / turn.inputTokens 缺失。
  const inTokens = inputTokens ?? null;
  const outTokens = outputTokens ?? null;
  const showTokens = inTokens !== null || outTokens !== null;
  const isLive = status === "running" || status === "pending" || status === "interrupting";
  return (
    <span className="font-mono">
      {label} · <Badge status={badgeStatus[status]} text={statusLabel[status]} />
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
