"use client";

/**
 * MobileChangeDetail — 移动版变更详情区块组件（task-08 / FR-04 / design §5.3 详情页 /
 * §7，D-001@V1 / D-002@V1，change 2026-08-26-mobile-workspace-page）。
 *
 * 区块组（自上而下）：阶段步骤条（横向滚动）/ 审批操作卡（pending_review 驱动默认
 * 展开，通过/驳回走 submitStageReview + 内联二次确认）/ 规范文档卡（chip →
 * FilePreviewModal 全屏直出）/ 阶段时间线（折叠，复用 ChangeStepTimeline）/
 * 智能体执行日志（默认折叠，复用 ChangeAgentRunLog）/ 关联会话卡（onOpenSession
 * 回调，宿主跳移动会话列表）/ 任务区桌面引导条（D-002）。
 *
 * ── X-03 落位清单（design §5.3 复用准则：纯内容复用 / 布局耦合重绘；verify 对账）──
 *  1. change-stage-header：**重绘**（flex flex-wrap 在 390px 六阶段折行拥挤，C-15 /
 *     design §5.3）——自绘横向滚动紧凑版；纯常量复用其导出 WORKFLOW_STAGES +
 *     change-step-badge 的 STAGE_LABELS（含 scan 补齐标签）。
 *  2. change-stage-actions：**重绘**（桌面 antd sm 按钮触摸热区 <44px、无折叠头与
 *     二次确认交互；APPROVAL_PANELS 映射为模块私有不可 import）——待办态标题改经
 *     PENDING_REVIEW_LABEL（expects_from task-05）映射，通过/驳回 action 词表对齐
 *     lib/changes.ts submitStageReview JSDoc 就地内联（proposal_approve /
 *     plan_approve / test_pass / archive_confirm / *_revise|replan|bug）。
 *  3. change-files-card（ChangeFilesCard）：**重绘壳**（max-w-6xl Dialog + 内嵌
 *     ChangeFileTree 树+预览横向布局，桌面宽屏耦合）——移动版 flat 文件 chip 列表，
 *     数据函数复用 lib/change-files（listChangeFiles / fetchChangeFileRaw），
 *     预览复用 FilePreviewModal（defaultFullscreen=true 全屏直出，原样消费）。
 *  4. change-step-timeline：**纯内容复用**（stage 分组垂直时间线，无 lg:grid/固定宽）。
 *  5. change-agent-run-log：**内容级复用**（ChangeAgentRunLog 黑盒挂进自绘折叠壳；
 *     其内部 AgentStepProgress/AgentRunPanel 子卡自带边框，套壳后双层卡片可接受；
 *     getAgentStatus 数据函数复用，query 挂 ["change", wid, cid] 失效前缀之下）。
 *  6. change-sessions-card：**重绘**（条目/卡尾 Link 耦合桌面门户路由，移动契约是
 *     props.onOpenSession 回调）——数据层复用 listChangeSessions + 同 key
 *     ["agentSessions", "changeSessionsCard", wid, cid]（与桌面卡共享缓存）。
 *  7. change-task-board-card：**不复刻**（D-002 变更中心核心版裁剪，任务区渲染
 *     桌面引导条替代）。
 *  8. change-review-history-card：**不移植**（本卡区块清单未含审核历史；task-09
 *     装配详情页壳如需再评估，normalizeReviewHistory 已导出可直接复用）。
 *  9. quicklog-linked-card：**重绘内容**（条目 Link 指向桌面 changes?tab=quicklog
 *     路由）——数据层复用 listQuicklogEntries + 同 key ["quicklogLinked", wid,
 *     changeKey]（与桌面卡共享缓存），状态徽标 4 态映射就地内联（模块私有）。
 * 10. run-file-artifacts：**不移植**（任务详情页「产出文件」区，属 D-002 任务域
 *     裁剪范围，变更详情桌面页也未挂载）。
 * 11. file-preview-modal：**原样复用**（constraints：不改 components/files/）。
 *
 * 审批约束（task-08）：一律走 submitStageReview（submitReview/approveChange 为退役
 * 链路，禁用）；成功后 invalidate ["changes", workspaceId] 前缀 + 详情 key 重取。
 * 详情 query key 逐字对齐桌面 (dashboard)/…/[cid]/page.tsx:43
 * ["change", workspaceId, changeId]（共享缓存；轮询语义对齐桌面：非终态 10s /
 * 终态停，isTerminalChange 从桌面详情页 import 复用）。
 */
import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { PENDING_REVIEW_LABEL } from "@/app/(dashboard)/workspaces/[id]/changes/page";
import { isTerminalChange } from "@/app/(dashboard)/workspaces/[id]/changes/[cid]/page";
import { STAGE_LABELS } from "@/components/changes/change-step-badge";
import { ChangeAgentRunLog } from "@/components/changes/detail/change-agent-run-log";
import { WORKFLOW_STAGES } from "@/components/changes/detail/change-stage-header";
import { ChangeStepTimeline } from "@/components/changes/detail/change-step-timeline";
import {
  FilePreviewModal,
  type FilePreviewTarget,
} from "@/components/files/file-preview-modal";
import { StatusBadge } from "@/components/ui/status-badge";
import { ApiError } from "@/lib/api";
import {
  fetchChangeFileRaw,
  listChangeFiles,
  type ChangeFileEntry,
} from "@/lib/change-files";
import {
  getAgentStatus,
  getChange,
  submitStageReview,
  type ChangeRead,
} from "@/lib/changes";
import { listChangeSessions } from "@/lib/daemon";
import { listQuicklogEntries } from "@/lib/quicklog";
import { useSession } from "@/stores/session";
import { cn } from "@/lib/utils";

/** 详情非终态轮询间隔（桌面 [cid]/page.tsx:47 同值 10s）。 */
const DETAIL_REFETCH_MS = 10_000;

// ── 审批卡按钮 → action 映射（就地内联；词表对齐 lib/changes.ts submitStageReview
//    JSDoc 与桌面 change-stage-actions APPROVAL_PANELS 语义：通过/驳回各一主项，
//    archive_confirm 无驳回）──────────────────────────────────────────────────
const REVIEW_ACTIONS: Record<
  string,
  {
    pass: { label: string; action: string };
    reject: { label: string; action: string } | null;
  }
> = {
  proposal_review: {
    pass: { label: "通过并推进", action: "proposal_approve" },
    reject: { label: "驳回", action: "proposal_revise" },
  },
  plan_review: {
    pass: { label: "通过并推进", action: "plan_approve" },
    reject: { label: "驳回", action: "plan_replan" },
  },
  human_test: {
    pass: { label: "通过并推进", action: "test_pass" },
    reject: { label: "驳回", action: "test_bug" },
  },
  archive_confirm: {
    pass: { label: "确认归档", action: "archive_confirm" },
    reject: null,
  },
};

/** quicklog 关联条目状态徽标映射（对齐桌面 quicklog-linked-card STATUS_META 4 态）。 */
const QL_STATUS_META: Record<
  string,
  { label: string; kind: "success" | "warning" | "error" | "info" | "neutral" }
> = {
  completed: { label: "已完成", kind: "success" },
  in_progress: { label: "进行中", kind: "info" },
  partial_done: { label: "已暂存", kind: "warning" },
  stale: { label: "疑似中断", kind: "error" },
};

/** 步骤条阶段序列：scan + 主线五阶段（design §5.3「六阶段」；WORKFLOW_STAGES 复用）。 */
const STEPPER_STAGES: readonly string[] = ["scan", ...WORKFLOW_STAGES];

// ── 自绘基础壳 ───────────────────────────────────────────────────────────────

/** 折叠卡壳（sec-card 模式，design §5.3）：头部整条为按钮（触摸 ≥44px），点击切换折叠。 */
function SecCard({
  title,
  defaultOpen = true,
  testId,
  children,
}: {
  title: ReactNode;
  defaultOpen?: boolean;
  testId: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section
      data-testid={testId}
      className="rounded-[var(--radius-lg)] border border-border bg-card shadow-[var(--shadow-sm)]"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 px-3 py-2 text-left text-[14px] font-medium text-foreground"
      >
        {title}
        <span aria-hidden className="shrink-0 text-xs text-muted-foreground">
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open ? <div className="px-3 pb-3">{children}</div> : null}
    </section>
  );
}

/**
 * 阶段步骤条（自绘横向滚动紧凑版，X-03 #1 / C-15）：节点 = 序号圆点 + 中文标签，
 * 已完成 ✓、当前高亮、未到弱化；容器 overflow-x-auto 横向滚动不折行。
 * 非线性阶段（quick 等）或 current_stage 缺失时不渲染（对齐桌面 null 降级）。
 */
function StageStepper({ currentStage }: { currentStage: string | null }) {
  if (!currentStage) return null;
  // 终态别名兼容：CLI 归档会把 current_stage 写成 'archived'（对齐桌面 :56）
  const displayStage = currentStage === "archived" ? "archive" : currentStage;
  const currentIndex = STEPPER_STAGES.indexOf(displayStage);
  if (currentIndex < 0) return null;
  return (
    <div
      data-testid="m-change-stage-steps"
      aria-label="变更阶段进度"
      className="flex items-center gap-1 overflow-x-auto rounded-[var(--radius-lg)] border border-border bg-card p-2 shadow-[var(--shadow-sm)]"
    >
      {STEPPER_STAGES.map((stage, i) => {
        const isCompleted = currentIndex > i;
        const isCurrent = currentIndex === i;
        return (
          <div key={stage} className="flex shrink-0 items-center">
            <div className="flex items-center gap-1">
              <span
                aria-hidden
                data-status={
                  isCompleted ? "completed" : isCurrent ? "current" : "pending"
                }
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-medium",
                  isCurrent
                    ? "bg-primary text-primary-foreground"
                    : isCompleted
                      ? "bg-success/15 text-success"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {isCompleted ? "✓" : i + 1}
              </span>
              <span
                className={cn(
                  "whitespace-nowrap text-[12px]",
                  isCurrent
                    ? "font-medium text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {STAGE_LABELS[stage] ?? stage}
              </span>
            </div>
            {i < STEPPER_STAGES.length - 1 && (
              <span aria-hidden className="mx-1 h-px w-3 shrink-0 bg-border" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── 主组件 ───────────────────────────────────────────────────────────────────

export interface MobileChangeDetailProps {
  /** 变更 id（路由段 [cid]）。 */
  changeId: string;
  /** 工作区 id（路由段 [id]）。 */
  workspaceId: string;
  /** 关联会话卡点击回调（宿主 task-09 跳移动会话列表 /m/workspaces/[id]/sessions）。 */
  onOpenSession: () => void;
}

export function MobileChangeDetail({
  changeId,
  workspaceId,
  onOpenSession,
}: MobileChangeDetailProps) {
  const queryClient = useQueryClient();

  // ── 详情 query（key 逐字对齐桌面 [cid]/page.tsx:43，共享缓存；非终态 10s 轮询）──
  const changeQuery = useQuery({
    queryKey: ["change", workspaceId, changeId],
    queryFn: () => getChange(workspaceId, changeId),
    refetchInterval: (query) => {
      // 请求出错且无数据（变更被删/404）→ 停轮，防无限空轮（对齐桌面 :85）
      if (query.state.error && !query.state.data) return false;
      return isTerminalChange(query.state.data) ? false : DETAIL_REFETCH_MS;
    },
  });
  const change = changeQuery.data ?? null;

  // ── 智能体执行日志数据（getAgentStatus 复用；挂 ["change", wid] 失效前缀下，
  //    审批后 invalidate 前缀会连带刷新）───────────────────────────────────────
  const agentStatusQuery = useQuery({
    queryKey: ["change", workspaceId, changeId, "agentStatus"],
    queryFn: () => getAgentStatus(workspaceId, changeId),
  });
  const agentStatus = agentStatusQuery.data ?? null;

  // ── 规范文档清单（listChangeFiles 复用，X-03 #3）────────────────────────────
  const filesQuery = useQuery({
    queryKey: ["changeFiles", workspaceId, changeId],
    queryFn: () => listChangeFiles(workspaceId, changeId),
    retry: false,
  });
  const [previewTarget, setPreviewTarget] = useState<FilePreviewTarget | null>(
    null,
  );

  // ── 关联会话（listChangeSessions + 桌面卡同 key，X-03 #6；仅本人过滤同口径）──
  const currentUserId = useSession((s) => s.user?.id ?? null);
  const sessionsQuery = useQuery({
    queryKey: ["agentSessions", "changeSessionsCard", workspaceId, changeId],
    queryFn: () => listChangeSessions(workspaceId, changeId),
  });
  const mySessions = (sessionsQuery.data ?? []).filter(
    (s) => s.author?.user_id == null || s.author.user_id === currentUserId,
  );
  const activeSessionCount = mySessions.filter(
    (s) => s.status === "active",
  ).length;

  // ── 审批卡 state（X-03 #2 自绘）────────────────────────────────────────────
  const [comment, setComment] = useState("");
  const [transitioning, setTransitioning] = useState(false);
  // 内联二次确认（任务卡允许「确认弹层或内联二次确认」，移动端取内联）
  const [confirming, setConfirming] = useState<{ label: string; action: string } | null>(
    null,
  );
  const [pageError, setPageError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // ── quicklog 关联（X-03 #9：同 key 同函数复用，失败静默隐藏）──────────────────
  const quicklogQuery = useQuery({
    queryKey: ["quicklogLinked", workspaceId, change?.change_key ?? ""],
    queryFn: () =>
      listQuicklogEntries(workspaceId, {
        linked_change: change?.change_key ?? "",
        include_placeholder: true,
        page_size: 20,
      }),
    enabled: Boolean(change?.change_key),
    retry: false,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });

  // 审批唯一入口 submitStageReview（退役链路 submitReview/approveChange 禁用）：
  // 成功后 invalidate ["changes", workspaceId] 前缀（列表）+ 详情 key 重取（refetch）。
  const handleReviewAction = async (action: string) => {
    if (transitioning) return;
    setTransitioning(true);
    setConfirming(null);
    setPageError(null);
    try {
      const result = await submitStageReview(
        workspaceId,
        changeId,
        action,
        comment || undefined,
        true, // notify_session（对齐桌面）
      );
      setComment("");
      setSuccessMsg(
        result.notified_session
          ? "✅ 审批已生效，已通知绑定会话"
          : "审批已生效，通知绑定会话失败（审批记录与状态不受影响）",
      );
      await Promise.all([
        queryClient
          .invalidateQueries({ queryKey: ["changes", workspaceId] })
          .catch(() => undefined),
        queryClient
          .invalidateQueries({ queryKey: ["change", workspaceId, changeId] })
          .catch(() => undefined),
      ]);
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "操作失败");
    } finally {
      setTransitioning(false);
    }
  };

  if (changeQuery.isPending) {
    return (
      <p
        data-testid="m-change-detail-loading"
        className="py-10 text-center text-[14px] text-muted-foreground"
      >
        加载中…
      </p>
    );
  }

  const loadError =
    changeQuery.isError && !changeQuery.data
      ? changeQuery.error instanceof ApiError
        ? changeQuery.error.message
        : "加载变更详情失败"
      : null;

  if (loadError || !change) {
    return (
      <div
        role="alert"
        className="rounded-[var(--radius-md)] border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
      >
        {loadError ?? "变更未找到"}
      </div>
    );
  }

  const pendingKey = change.pending_review ?? null;
  const reviewMeta = pendingKey ? (REVIEW_ACTIONS[pendingKey] ?? null) : null;
  // 待办态标题：PENDING_REVIEW_LABEL 映射（expects_from task-05），未知值回退原值
  const pendingLabel = pendingKey
    ? (PENDING_REVIEW_LABEL[pendingKey] ?? pendingKey)
    : null;
  const steps = change.steps ?? null;
  const quicklogItems = quicklogQuery.data?.items ?? [];

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {/* 阶段步骤条（自绘横向滚动，X-03 #1） */}
      <StageStepper currentStage={change.current_stage ?? null} />

      {/* 审批操作卡（X-03 #2 自绘：有待办默认展开；无待办折叠只读说明） */}
      {reviewMeta ? (
        <section
          data-testid="m-change-review-card"
          className="rounded-[var(--radius-lg)] border-2 border-primary/25 bg-primary/5 shadow-[var(--shadow-sm)]"
        >
          <div className="px-3 pt-2.5">
            <p className="text-[14px] font-semibold text-foreground">
              ⏳ {pendingLabel} · 需要你确认
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              审批结果将通知绑定会话，由智能体继续推进。
            </p>
          </div>
          <div className="flex flex-col gap-2.5 px-3 pb-3 pt-2">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              placeholder="审核意见（可选）"
              aria-label="审核意见"
              data-testid="m-change-review-comment"
              className="w-full rounded-[var(--radius-md)] border border-input bg-card px-2.5 py-1.5 text-[14px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50"
            />
            {confirming ? (
              /* 内联二次确认：替换按钮行，确认才真正提交 */
              <div
                data-testid="m-change-review-confirm"
                className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-border bg-card px-3 py-2"
              >
                <span className="min-w-0 flex-1 text-xs text-foreground">
                  确认执行「{confirming.label}」？操作会立即生效。
                </span>
                <button
                  type="button"
                  onClick={() => setConfirming(null)}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-md)] border border-border bg-card px-4 text-[14px] text-foreground transition-colors hover:bg-muted"
                >
                  取消
                </button>
                <button
                  type="button"
                  data-testid="m-change-review-confirm-ok"
                  disabled={transitioning}
                  onClick={() => void handleReviewAction(confirming.action)}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-md)] bg-primary px-4 text-[14px] font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {transitioning ? "提交中…" : "确认"}
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                {reviewMeta.reject ? (
                  <button
                    type="button"
                    disabled={transitioning}
                    onClick={() =>
                      setConfirming({
                        label: reviewMeta.reject!.label,
                        action: reviewMeta.reject!.action,
                      })
                    }
                    className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-[var(--radius-md)] border border-destructive/40 bg-card px-3 text-[14px] text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    ✕ {reviewMeta.reject.label}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={transitioning}
                  onClick={() =>
                    setConfirming({
                      label: reviewMeta.pass.label,
                      action: reviewMeta.pass.action,
                    })
                  }
                  className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-[var(--radius-md)] bg-primary px-3 text-[14px] font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  ✓ {reviewMeta.pass.label}
                </button>
              </div>
            )}
            {pageError ? (
              <p
                data-testid="m-change-review-error"
                className="text-xs text-destructive"
              >
                {pageError}
              </p>
            ) : null}
            {successMsg ? (
              <p
                data-testid="m-change-review-success"
                className="text-xs text-success"
              >
                {successMsg}
              </p>
            ) : null}
          </div>
        </section>
      ) : (
        <SecCard
          testId="m-change-review-idle"
          title="当前无可审批事项"
          defaultOpen={false}
        >
          <p className="text-xs text-muted-foreground">
            阶段推进由智能体在会话中驱动，有待办时会在此提示。
          </p>
        </SecCard>
      )}

      {/* 规范文档卡（X-03 #3 重绘壳：flat chips → FilePreviewModal 全屏直出） */}
      <SecCard
        testId="m-change-docs-card"
        title={
          <>
            📄 规范文档
            {filesQuery.data ? ` · ${filesQuery.data.items.length}` : ""}
          </>
        }
      >
        {filesQuery.isPending ? (
          <p className="text-xs text-muted-foreground">加载中…</p>
        ) : filesQuery.isError ? (
          <p className="text-xs text-muted-foreground">文档清单加载失败，请稍后重试。</p>
        ) : filesQuery.data && filesQuery.data.items.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {filesQuery.data.items.map((f: ChangeFileEntry) => (
              <button
                key={f.path}
                type="button"
                data-testid="m-change-doc-chip"
                aria-label={`全屏预览 ${f.name}`}
                onClick={() =>
                  setPreviewTarget({
                    fetch: () =>
                      fetchChangeFileRaw(workspaceId, changeId, f.path),
                    meta: { name: f.name, mime: null, size: f.size },
                  })
                }
                className="flex min-h-[44px] w-full items-center gap-2 rounded-[var(--radius-md)] border border-border bg-card px-2.5 py-1.5 text-left transition-colors hover:bg-muted"
              >
                <span
                  aria-hidden
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-primary/10 text-[14px]"
                >
                  📄
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-foreground">
                    {f.name}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {f.path}
                  </span>
                </span>
                <span aria-hidden className="shrink-0 text-muted-foreground">
                  ›
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">暂无规范文档。</p>
        )}
      </SecCard>

      {/* 阶段时间线（X-03 #4 纯内容复用 ChangeStepTimeline；折叠壳） */}
      {steps && steps.length > 0 ? (
        <SecCard
          testId="m-change-timeline-card"
          title={<>🧭 阶段时间线（{steps.length}）</>}
        >
          <ChangeStepTimeline steps={steps} />
        </SecCard>
      ) : null}

      {/* 智能体执行日志（X-03 #5 内容级复用 ChangeAgentRunLog；默认折叠） */}
      <SecCard
        testId="m-change-runlog-card"
        title="🤖 智能体执行日志"
        defaultOpen={false}
      >
        <ChangeAgentRunLog
          workspaceId={workspaceId}
          panelRunId={agentStatus?.last_dispatch?.run_id ?? null}
          panelIsActive={agentStatus?.has_active_run ?? false}
          agentStatus={agentStatus}
          gateStatus={null}
          teamMode={false}
          stageTeamMissionId={null}
          onDone={() => void agentStatusQuery.refetch()}
          onGateStatusChanged={() => undefined}
          onRefresh={() => void agentStatusQuery.refetch()}
          refreshing={agentStatusQuery.isFetching}
          onDispatch={() => undefined}
          dispatching={false}
        />
      </SecCard>

      {/* 关联会话卡（X-03 #6 重绘：整卡点击 → onOpenSession，宿主跳移动会话列表） */}
      <section
        data-testid="m-change-sessions-card"
        className="rounded-[var(--radius-lg)] border border-border bg-card shadow-[var(--shadow-sm)]"
      >
        <button
          type="button"
          onClick={onOpenSession}
          className="flex min-h-[44px] w-full items-center justify-between gap-2 px-3 py-2 text-left"
        >
          <span className="min-w-0">
            <span className="block text-[14px] font-medium text-foreground">
              💬 关联会话
              {sessionsQuery.data && mySessions.length > 0
                ? ` · ${mySessions.length}`
                : ""}
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {activeSessionCount > 0
                ? `含 ${activeSessionCount} 个进行中会话 · 点击进入会话列表`
                : "点击进入会话列表"}
            </span>
          </span>
          <span aria-hidden className="shrink-0 text-muted-foreground">
            ›
          </span>
        </button>
      </section>

      {/* quicklog 关联（X-03 #9 重绘内容：同 key 数据复用；失败静默隐藏） */}
      {!quicklogQuery.isError && quicklogItems.length > 0 ? (
        <SecCard
          testId="m-change-quicklog-card"
          title={<>⚡ 关联的快速任务（{quicklogItems.length}）</>}
          defaultOpen={false}
        >
          <div className="flex flex-col gap-2">
            {quicklogItems.map((it) => {
              const m = QL_STATUS_META[it.status] ?? {
                label: it.status,
                kind: "neutral" as const,
              };
              return (
                <div
                  key={it.ql_id}
                  data-testid="m-change-quicklog-item"
                  className="flex items-center gap-2"
                >
                  <StatusBadge kind={m.kind}>{m.label}</StatusBadge>
                  <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                    {it.placeholder ? "（空壳占位）" : it.title}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {it.timestamp
                      ? new Date(it.timestamp).toLocaleString("zh-CN", {
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </SecCard>
      ) : null}

      {/* 任务区桌面引导条（D-002：任务看板/执行页移动端不做，引导电脑端） */}
      <div
        data-testid="m-change-desktop-guide"
        className="flex items-start gap-2 rounded-[var(--radius-lg)] border border-dashed border-border bg-muted/40 px-3 py-3"
      >
        <span aria-hidden className="text-[16px] leading-none">
          🖥
        </span>
        <p className="text-xs leading-relaxed text-muted-foreground">
          任务看板与任务执行页请到电脑端操作（工作区 → 变更 → 任务）。
        </p>
      </div>

      {/* 统一文件预览（复用 FilePreviewModal，全屏直出 defaultFullscreen=true） */}
      <FilePreviewModal
        target={previewTarget}
        open={previewTarget !== null}
        onClose={() => setPreviewTarget(null)}
        defaultFullscreen
      />
    </div>
  );
}
