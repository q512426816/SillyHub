"use client";

import { useMemo, useState } from "react";
import { ClipboardList, HelpCircle, MessageCircleQuestion } from "lucide-react";
import { Popover } from "antd";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { extractDialogQA } from "@/components/daemon/session-log-sanitize";
import { resolvePendingTitle } from "@/components/permissions/minimized-dialog-capsule";
import {
  fetchSessionDialogHistory,
  type PlanSummary,
  type SessionDialogRead,
  type SessionPermissionRequest,
} from "@/lib/daemon";
import { cn } from "@/lib/utils";

/**
 * 会话页面悬浮待决策面板（2026-10-16-session-decision-pill / FR-01~04 /
 * D-004@v1：前端自包含聚合，数据三类零新增）。
 *
 * - 胶囊入口与变更文件 pill 并排（挂载点 flex 悬浮行）；三类信息全空
 *   （pending 提问/Plan 卡/已答历史）不渲染（FR-01 显隐）；
 * - hover（或触屏点击）弹下拉分组：待决策置顶（提问/Plan 徽标 + 状态短语），
 *   已答历史默认折叠可展开（FR-02）；历史孤儿 pending 行（不在 SSE 待答集）
 *   归历史组显示「未回答」（对齐 ended 会话死卡门控语义）；
 * - pending 项点击经 onFocusPending 上抛定位还原（FR-03，父级路由 TurnTimeline
 *   focusDialogRequest / Plan 卡高亮）；历史项点开只读详情弹窗（FR-04，
 *   复用 extractDialogQA 解析问题/选项/当时选择）；
 * - 历史经 fetchSessionDialogHistory：挂载即取一次（显隐判定需要），下拉/弹窗
 *   打开时 15s 轮询、关闭即停（active 轮询，对齐 useSessionChanges 模式）。
 */
export interface SessionDecisionsHoverProps {
  sessionId: string;
  /** pending AskUser/plan_approval dialog（父级 SSE 态，权威源）。 */
  pendingRequests: SessionPermissionRequest[];
  /** Plan 审批卡态（机制 1，父级 SSE plan_mode_entered 态；null=无）。 */
  planPending: {
    runId: string;
    summary: PlanSummary;
    requestedAt: string | null;
  } | null;
  /** pending 项点击（dialog request_id；planPending 项固定 "plan" 哨兵）。 */
  onFocusPending: (requestId: string) => void;
}

/** 下拉条目（splitDecisions 产出；kind 驱动徽标，status 驱动配色/文案）。 */
export interface DecisionItem {
  key: string;
  title: string;
  kind: "ask" | "plan";
  status: "waiting" | "answered" | "unanswered";
  /** 回答摘要（历史组行内一句话；pending 恒 null）。 */
  answerSummary: string | null;
  /** 创建/请求时间（dialog pending 项无时间字段 → null 显示 "—"）。 */
  createdAt: string | null;
  /** 历史组详情弹窗原始行（pending 项为 null）。 */
  dialog: SessionDialogRead | null;
}

const PLAN_PENDING_KEY = "plan";
const PLAN_PENDING_TITLE = "Agent 提交了执行计划等待审批";

/** 历史行标题——resolvePendingTitle 同口径（SessionDialogRead 结构兼容子集）。 */
function dialogRowTitle(row: SessionDialogRead): string {
  const raw = row.dialog_payload?.questions;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const question = (item as { question?: unknown } | null)?.question;
      if (typeof question === "string" && question.trim()) return question.trim();
    }
  }
  if (row.dialog_kind === "plan_approval") return PLAN_PENDING_TITLE;
  return "智能体提问";
}

/** 历史行回答摘要——extractDialogQA 首问 answerText，取不到回退 null（行内显示状态短语）。 */
function answerSummaryOf(row: SessionDialogRead): string | null {
  const qa = extractDialogQA(row);
  return qa[0]?.answerText ?? null;
}

/** 分组纯函数（测试导出）：SSE 待答集 + Plan 卡态 + 历史行 → 待决策/历史两组。 */
export function splitDecisions(
  pendingRequests: SessionPermissionRequest[],
  planPending: SessionDecisionsHoverProps["planPending"],
  history: SessionDialogRead[] | undefined,
): { pending: DecisionItem[]; history: DecisionItem[] } {
  const pendingIds = new Set(pendingRequests.map((r) => r.request_id));
  const pending: DecisionItem[] = pendingRequests.map((r) => ({
    key: r.request_id,
    title: resolvePendingTitle(r),
    kind: r.dialog_kind === "plan_approval" ? "plan" : "ask",
    status: "waiting",
    answerSummary: null,
    createdAt: null,
    dialog: null,
  }));
  if (planPending) {
    pending.push({
      key: PLAN_PENDING_KEY,
      title: PLAN_PENDING_TITLE,
      kind: "plan",
      status: "waiting",
      answerSummary: null,
      createdAt: planPending.requestedAt,
      dialog: null,
    });
  }
  const historyItems: DecisionItem[] = [];
  for (const row of history ?? []) {
    // SSE 待答集是 pending 权威源：不在集内的 status=pending 行是孤儿死卡
    //（会话终止/恢复中断），归历史组显示「未回答」。
    const orphanPending = row.status === "pending" && !pendingIds.has(row.request_id);
    historyItems.push({
      key: row.request_id,
      title: dialogRowTitle(row),
      kind: row.dialog_kind === "plan_approval" ? "plan" : "ask",
      status: row.status === "answered" ? "answered" : "unanswered",
      answerSummary: orphanPending ? null : answerSummaryOf(row),
      createdAt: row.created_at ?? null,
      dialog: row,
    });
  }
  return { pending, history: historyItems };
}

const KIND_BADGE: Record<DecisionItem["kind"], string> = {
  ask: "bg-brand-50 text-brand-700",
  plan: "bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300",
};
const KIND_LABEL: Record<DecisionItem["kind"], string> = { ask: "提问", plan: "Plan" };
const STATUS_BADGE: Record<DecisionItem["status"], string> = {
  waiting: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  answered: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  unanswered: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
};
const STATUS_LABEL: Record<DecisionItem["status"], string> = {
  waiting: "等待你的回答",
  answered: "已答",
  unanswered: "未回答",
};

function shortTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SessionDecisionsHover({
  sessionId,
  pendingRequests,
  planPending,
  onFocusPending,
}: SessionDecisionsHoverProps) {
  // 受控 popover：hover 弹出移开收起，click 固定（触屏兜底）——与变更文件
  // pill 同款交互契约，antd 只发事件，state 是唯一真相。
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [detailKey, setDetailKey] = useState<string | null>(null);

  const { data: history } = useQuery({
    queryKey: ["sessionDecisions", sessionId],
    queryFn: () => fetchSessionDialogHistory(sessionId),
    staleTime: 10_000,
    refetchInterval: popoverOpen || detailKey !== null ? 15_000 : false,
  });

  const { pending, history: historyItems } = useMemo(
    () => splitDecisions(pendingRequests, planPending, history),
    [pendingRequests, planPending, history],
  );
  const detail = useMemo(
    () => historyItems.find((d) => d.key === detailKey) ?? null,
    [historyItems, detailKey],
  );

  // 三类全空不渲染、不占位（FR-01：历史未加载完成且 pending 为空同样不渲染）。
  if (pending.length === 0 && historyItems.length === 0) return null;

  const renderItem = (item: DecisionItem, isPending: boolean) => (
    <button
      key={item.key}
      type="button"
      data-testid={`session-decision-item-${item.key}`}
      onClick={() => {
        if (isPending) {
          setPopoverOpen(false);
          onFocusPending(item.key);
        } else {
          // 开详情弹窗收起下拉（对齐变更文件 pill openDialog 先例）
          setPopoverOpen(false);
          setDetailKey(item.key);
        }
      }}
      className="w-full rounded-md border border-transparent px-2.5 py-1.5 text-left transition-colors hover:border-brand-400 hover:bg-accent"
    >
      <div className="flex items-center gap-1.5">
        {item.kind === "ask" ? (
          <HelpCircle className="h-3 w-3 shrink-0 text-brand-600" aria-hidden />
        ) : (
          <ClipboardList className="h-3 w-3 shrink-0 text-cyan-600" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{item.title}</span>
        <span
          className={`shrink-0 rounded px-1 py-px text-[10px] font-semibold ${KIND_BADGE[item.kind]}`}
        >
          {KIND_LABEL[item.kind]}
        </span>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span
          className={`rounded px-1 py-px font-medium ${STATUS_BADGE[item.status]}`}
        >
          {isPending && item.kind === "plan" ? "长驻等待，不会自动超时" : STATUS_LABEL[item.status]}
        </span>
        <span className="ml-auto">{shortTime(item.createdAt)}</span>
      </div>
      {!isPending && item.answerSummary && (
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground/80">
          你的回答：{item.answerSummary}
        </div>
      )}
    </button>
  );

  const popoverContent = (
    <div
      data-testid="session-decision-popover"
      className="max-h-[60vh] w-80 overflow-auto p-1"
    >
      <div className="px-1.5 pb-1 text-[11px] font-semibold text-muted-foreground">
        待决策（{pending.length}）
      </div>
      {pending.map((item) => renderItem(item, true))}
      {historyItems.length > 0 && (
        <>
          <button
            type="button"
            data-testid="session-decision-history-toggle"
            onClick={() => setHistoryExpanded((v) => !v)}
            className="mt-1.5 w-full rounded-md border border-dashed px-2.5 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:border-brand-400 hover:text-foreground"
          >
            {historyExpanded ? "▾" : "▸"} 已答历史（{historyItems.length}）
            {historyExpanded ? "" : "— 点击展开"}
          </button>
          {historyExpanded && historyItems.map((item) => renderItem(item, false))}
        </>
      )}
    </div>
  );

  return (
    <div data-testid="session-decisions-hover">
      <Popover
        open={popoverOpen}
        onOpenChange={setPopoverOpen}
        trigger={["hover", "click"]}
        placement="topRight"
        content={popoverContent}
        styles={{ container: { padding: 4 } }}
      >
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 rounded-lg shadow-sm"
          aria-label="悬浮查看会话待决策信息"
        >
          <MessageCircleQuestion className="h-3.5 w-3.5" aria-hidden />
          待决策
          <span
            data-testid="session-decision-count"
            className={cn(
              "rounded-full bg-emerald-600 px-1.5 text-[10px] font-bold leading-4 text-white",
              pending.length > 0 ? "animate-pulse" : "",
            )}
          >
            {pending.length}
          </span>
        </Button>
      </Popover>

      <Dialog
        open={detailKey !== null}
        onOpenChange={(o) => {
          if (!o) setDetailKey(null);
        }}
      >
        <DialogContent className="flex max-h-[80vh] max-w-2xl flex-col gap-0 p-0">
          <DialogHeader className="flex-row items-center gap-2 space-y-0 border-b px-4 py-3">
            <DialogTitle className="text-sm">决策详情</DialogTitle>
            {detail && (
              <span
                className={`rounded px-1 py-px text-[10px] font-semibold ${KIND_BADGE[detail.kind]}`}
              >
                {KIND_LABEL[detail.kind]}
              </span>
            )}
            {detail && (
              <span
                className={`rounded px-1 py-px text-[10px] font-semibold ${STATUS_BADGE[detail.status]}`}
              >
                {STATUS_LABEL[detail.status]}
              </span>
            )}
            <DialogDescription className="ml-auto shrink-0 text-[11px]">
              只读回看 · 作答仍在聊天流完成
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto p-4">
            {detail?.dialog &&
              extractDialogQA(detail.dialog).map((qa, i) => (
                <div key={i} className={i > 0 ? "mt-4" : ""}>
                  <p className="text-xs font-semibold">{qa.question}</p>
                  <div className="mt-1.5 overflow-hidden rounded-md border">
                    {qa.options.map((opt, j) => (
                      <div
                        key={j}
                        className={cn(
                          "border-b px-2.5 py-1.5 text-xs last:border-b-0",
                          opt.selected
                            ? "bg-brand-50 font-semibold text-brand-700"
                            : "text-muted-foreground",
                        )}
                      >
                        <span className="mr-1" aria-hidden>
                          {opt.selected ? "✓" : "○"}
                        </span>
                        {opt.label}
                        {opt.selected && (
                          <span className="ml-1.5 text-[10px] font-normal">你的选择</span>
                        )}
                        {opt.description && (
                          <p className="mt-0.5 text-[11px] font-normal text-muted-foreground/80">
                            {opt.description}
                          </p>
                        )}
                      </div>
                    ))}
                    {qa.options.length === 0 && (
                      <div className="px-2.5 py-1.5 text-xs text-muted-foreground">
                        → {qa.answerText ?? STATUS_LABEL[detail.status]}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            {detail?.dialog &&
              extractDialogQA(detail.dialog).length === 0 && (
                <p className="text-xs text-muted-foreground">
                  （该决策记录无结构化问答载荷）
                </p>
              )}
            {detail && (
              <p className="mt-4 flex gap-4 text-[11px] text-muted-foreground">
                <span>提问：{shortTime(detail.dialog?.created_at)}</span>
                <span>
                  回答：{shortTime(detail.dialog?.answered_at ?? null)}
                </span>
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
