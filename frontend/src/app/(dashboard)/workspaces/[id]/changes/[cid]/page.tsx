"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { PageContainer, PageHeader } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DeleteChangeConfirm,
  canDeleteChange,
  useChangeDeleteAccess,
} from "@/components/delete-change-confirm";
import { ChangeAssetsCard } from "@/components/changes/detail/change-assets-card";
import { ChangeFilesCard } from "@/components/changes/detail/change-files-card";
import { ChangeSessionsCard } from "@/components/changes/detail/change-sessions-card";
import { ChangeStageActions } from "@/components/changes/detail/change-stage-actions";
import { StateIcon, StateLabel } from "@/components/primer";
import { isThinLineageChange } from "@/lib/thin-lineage";
import {
  ChangeStageHeader,
  WORKFLOW_STAGE_LABELS,
} from "@/components/changes/detail/change-stage-header";
import { ChangeStepTimeline } from "@/components/changes/detail/change-step-timeline";
import { ChangeTimelineCard } from "@/components/changes/detail/change-timeline-card";
import {
  ChangeLastSignal,
  lastSignalFromSteps,
} from "@/components/changes/change-activity-badge";
import { ChangeUsageCard } from "@/components/changes/detail/change-usage-card";
import { QuicklogLinkedCard } from "@/components/changes/detail/quicklog-linked-card";
import { ScopeAuditCommandCard } from "@/components/changes/scope-audit-command-card";
import { ApiError } from "@/lib/api";
import {
  deleteChange,
  getChange,
  submitStageReview,
  type ChangeRead,
} from "@/lib/changes";
import { useNotify } from "@/lib/errors";
import {
  listWorkspaceAgentSessions,
  type AgentSessionListItem,
} from "@/lib/daemon";

interface Props {
  params: { id: string; cid: string };
}

/** 变更详情查询 key（task-07 / D-004@v1：react-query 缓存定位与审批后失效重取） */
const CHANGE_QUERY_KEY = (workspaceId: string, changeId: string) =>
  ["change", workspaceId, changeId] as const;

/** 非终态轮询间隔（design §5 Phase 2.3：详情页 10s） */
const DETAIL_REFETCH_MS = 10_000;

/**
 * 变更终态判定（design §5 Phase 2.4 可测试定义）：status 为 archived 或
 * location 为 archive 即终态——changes 表仅 active/archived 两值，无 failed
 * （失败语义在 steps 层由 7 值枚举承载）。data 未就绪按非终态处理（继续拉取）。
 */
export function isTerminalChange(
  change: Pick<ChangeRead, "status" | "location"> | null | undefined,
): boolean {
  if (!change) return false;
  return change.status === "archived" || change.location === "archive";
}

// quick/thin/blocked/archived 四态 status 徽标（非线性节点，独立呈现）
// 2026-09-25-change-center-thin-flow task-07：补 thin=轻量变更（防标题裸显英文 "thin"）；
// quick 补存量口径。
const STATUS_BADGE: Record<
  string,
  { label: string; variant: "success" | "outline" | "destructive" | "default" }
> = {
  quick: { label: "快速任务（存量）", variant: "default" },
  thin: { label: "轻量变更", variant: "default" },
  blocked: { label: "已阻塞", variant: "destructive" },
  archived: { label: "已归档", variant: "success" },
};

export default function ChangeDetailPage({ params }: Props) {
  const workspaceId = params.id;
  const changeId = params.cid;
  const queryClient = useQueryClient();

  // ── 变更详情（task-07 / D-004@v1：react-query 智能轮询替换原裸 useEffect）──
  // 非终态 10s 周期刷新、终态停轮（isTerminalChange）；refetchIntervalInBackground
  // 默认 false = 页面不可见暂停；structuralSharing 默认开启 = 内容未变跳过
  // re-render（不乱跳），queryFn 保持原 getChange 请求参数。
  // ql-20260816-001：请求已出错且无数据（变更被删/硬 404）→ 停轮，防无限空轮。
  const changeQuery = useQuery({
    queryKey: CHANGE_QUERY_KEY(workspaceId, changeId),
    queryFn: () => getChange(workspaceId, changeId),
    refetchInterval: (query) => {
      if (query.state.error && !query.state.data) return false;
      return isTerminalChange(query.state.data) ? false : DETAIL_REFETCH_MS;
    },
  });
  const change = changeQuery.data ?? null;
  const changeError = changeQuery.error;
  // loading / loadError 语义对齐原裸 load：仅初次加载（尚无数据）进入加载屏 /
  // 错误屏；轮询或审批后刷新失败不打断已渲染内容（react-query 按策略自动重试）。
  const loading = changeQuery.isPending;
  const loadError =
    changeQuery.isError && !changeQuery.data
      ? changeError instanceof ApiError
        ? changeError.message
        : "加载变更详情失败"
      : null;

  const [pageError, setPageError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // ── 删除入口（task-07 / design §6.3 / FR-05d）──────────────────────────
  // PageHeader 右侧独立危险按钮（不混入审批卡）。可见性启发式（owner/平台
  // 管理员/工作区所有者）仅控显隐，后端 DELETE 组合权限为权威；动作本体
  // （useRouter + mutation + 弹层）在 DetailDeleteAction 子组件内，仅权限
  // 可见者挂载——未挂载即不触碰 router（无 app-router 上下文的环境不触发
  // next/navigation invariant）。
  const deleteAccess = useChangeDeleteAccess(workspaceId);

  // ── 审批卡（唯一操作区）state ───────────────────────────────────────
  const [transitioning, setTransitioning] = useState(false);
  const [gateComment, setGateComment] = useState("");
  const [notifyResult, setNotifyResult] = useState<{
    notified_session: boolean;
    notify_error: string | null;
  } | null>(null);
  // 绑定会话（change_session_links 最新；前端取工作区最近活跃会话近似展示，D-007）
  const [boundSession, setBoundSession] = useState<AgentSessionListItem | null>(
    null,
  );

  // ── 阶段-步骤联动（ql-20260821-017）：点击阶段步骤条节点筛选步骤时间线 ──
  // stepStages = steps 中实际有条目的阶段集合（决定哪些节点可点）；再次点击
  // 同一阶段取消筛选；current_stage 非线性（quick 等）时步骤条不渲染，联动
  // 入口自然缺席，focusStage 恒为 null 无副作用。
  const [focusStage, setFocusStage] = useState<string | null>(null);

  // ── 辅助数据（绑定会话近似）：一次性加载，不随详情轮询（agent 状态链随
  //     智能体运行状态卡移除一并退役，2026-09-28-change-ux-detail-batch）──
  useEffect(() => {
    let cancelled = false;
    setPageError(null);
    const loadSide = async () => {
      const sessions = await listWorkspaceAgentSessions(workspaceId, {
        include_ended: true,
      }).catch(() => []);
      if (cancelled) return;
      // §8 绑定查询语义 = 工作区最近活跃会话（coalesce(last_active_at, created_at) desc）
      setBoundSession(sessions?.[0] ?? null);
    };
    void loadSide();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, changeId]);

  // ── 审批唯一入口 submitStageReview（task-10：notify_session 透传，注入移后端 best-effort）──
  const handleGateAction = useCallback(
    async (action: string) => {
      if (transitioning) return;
      setTransitioning(true);
      setNotifyResult(null);
      try {
        const result = await submitStageReview(
          workspaceId,
          changeId,
          action,
          gateComment || undefined,
          true, // notify_session
        );
        setGateComment("");
        setNotifyResult({
          notified_session: result.notified_session,
          notify_error: result.notify_error ?? null,
        });
        if (result.notified_session) {
          setSuccessMsg("✅ 审批已生效，已通知绑定会话");
          setTimeout(() => setSuccessMsg(null), 3000);
        }
        // 审批后刷新（task-07）：变更详情改 query 失效重取
        await queryClient
          .invalidateQueries({
            queryKey: CHANGE_QUERY_KEY(workspaceId, changeId),
          })
          .catch(() => undefined);
      } catch (err) {
        setPageError(err instanceof ApiError ? err.message : "操作失败");
      } finally {
        setTransitioning(false);
      }
    },
    [workspaceId, changeId, transitioning, gateComment, queryClient],
  );

  if (loading) {
    return (
      <PageContainer size="full">
        <p className="text-xs text-muted-foreground">加载中…</p>
      </PageContainer>
    );
  }

  if (loadError || !change) {
    return (
      <PageContainer size="full">
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {loadError ?? "变更未找到"}
        </div>
        <Link
          href={`/workspaces/${workspaceId}/changes`}
          className="mt-3 inline-block text-xs text-primary hover:underline"
        >
          ← 变更列表
        </Link>
      </PageContainer>
    );
  }

  // 阶段-步骤联动派生：steps 条目出现的阶段去重（含 quick 等非线性 stage，
  // 但步骤条只渲染 5 大阶段节点，非 WORKFLOW_STAGES 值仅参与 includes 判断）
  const stepStages =
    change.steps && change.steps.length > 0
      ? Array.from(new Set(change.steps.map((e) => e.stage)))
      : [];

  return (
    <PageContainer size="full" className="gap-5">
      <p className="text-[11px] text-muted-foreground">
        <Link
          href={`/workspaces/${workspaceId}/changes`}
          className="hover:underline"
        >
          ← 变更列表
        </Link>
      </p>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {/* 2026-09-28-change-detail-header-overflow：flex 行内 truncate 项
                补 min-w-0——同为 flex 项 min-width:auto 陷阱，超长标题否则无法
                收缩截断（列表行同款修复先例 cde844492 ①）。 */}
            <span className="min-w-0 truncate">{change.title ?? change.change_key}</span>
            {(() => {
              const stage = change.current_stage ?? "draft";
              // 轻量出身标识在归档后存活（2026-09-26-thin-badge-survives-archive
              // / FR-01）：thin-flow「归档时自动翻转」让 stage 变 archived，出身
              // 随徽章消失——归档态（isTerminalChange 双条件：status=archived 或
              // location=archive，评审 P1 收窄补齐）若为轻量出身（thin 写入分流
              // 2026-09-25 上线，此后新 quick 类型变更全部分流 thin，change_type
              // 保留 "quick"），在「已归档」旁并排补「轻量变更」徽章。
              const thinBadge = STATUS_BADGE.thin;
              const thinOrigin =
                Boolean(thinBadge) &&
                isTerminalChange(change) &&
                change.change_type === "quick" &&
                new Date(change.created_at ?? 0) >=
                  new Date("2026-09-25T00:00:00+08:00");
              if (isTerminalChange(change)) {
                return (
                  <>
                    {thinOrigin && thinBadge ? (
                      <Badge variant={thinBadge.variant}>
                        {thinBadge.label}
                      </Badge>
                    ) : null}
                    <Badge variant="success">已归档</Badge>
                  </>
                );
              }
              const statusBadge = STATUS_BADGE[stage];
              if (statusBadge) {
                return (
                  <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                );
              }
              return (
                <Badge variant="outline">
                  {WORKFLOW_STAGE_LABELS[stage] ?? stage ?? "未知"}
                </Badge>
              );
            })()}
          </span>
        }
        subtitle={
          <span className="flex flex-wrap gap-x-5 gap-y-0.5">
            <span>
              Key: <code className="font-mono">{change.change_key}</code>
            </span>
            <span>类型: {change.change_type ?? "—"}</span>
            <span>位置: {change.location}</span>
            {change.affected_components.length > 0 && (
              <span>影响: {change.affected_components.join(", ")}</span>
            )}
            {/* 2026-09-28-change-ux-detail-batch：详情页头部补变更描述（列表行同源
                proposal 动机段）——w-full 独占 flex-wrap 一行 + truncate 单行截断，
                悬浮看全文；无描述零占位。 */}
            {change.description && (
              <span
                title={change.description}
                className="w-full min-w-0 truncate text-xs text-muted-foreground"
              >
                {change.description}
              </span>
            )}
          </span>
        }
        // task-07：PageHeader actions 危险按钮（仅权限可见者挂载 DetailDeleteAction，
        // 危险悬停色走 destructive 主题 token；确认弹层独立于下方审批卡）
        actions={
          canDeleteChange(change, deleteAccess) ? (
            <DetailDeleteAction
              workspaceId={workspaceId}
              changeId={changeId}
              changeKey={change.change_key}
              ownerName={change.owner_name}
            />
          ) : undefined
        }
      />

      {/* 阶段步骤条（主线宏观进度；节点可点击筛选下方步骤时间线，ql-20260821-017） */}
      {isThinLineageChange(change) ? (
        /* 2026-09-27-thin-display-fix：thin 出身不渲染六阶段 checks（flow 未走
           主管线），改轻量流程条——对照原型轻量语义（StateLabel zap）。 */
        <div className="flex flex-wrap items-center gap-3 rounded-md border bg-card px-3 py-2.5">
          <StateLabel variant="attention" size="md">
            轻量变更
          </StateLabel>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <StateIcon name="check" size={14} className="text-success" />
              flow start
            </span>
            <span aria-hidden="true">→</span>
            <span className="flex items-center gap-1">
              <StateIcon name="check" size={14} className="text-success" />
              干活（改代码 + 填槽）
            </span>
            <span aria-hidden="true">→</span>
            <span className="flex items-center gap-1">
              {isTerminalChange(change) ? (
                <StateIcon name="check" size={14} className="text-success" />
              ) : (
                <StateIcon name="openCircle" size={14} className="text-primary" />
              )}
              {isTerminalChange(change) ? "flow done 收口归档" : "flow done 收口（进行中）"}
            </span>
          </span>
        </div>
      ) : (
        <ChangeStageHeader
          currentStage={change.current_stage ?? null}
          stages={change.stages as Record<string, unknown> | null}
          updatedAt={change.updated_at ?? null}
          stepStages={stepStages}
          focusStage={focusStage}
          onStageClick={(stage) =>
            setFocusStage((prev) => (prev === stage ? null : stage))
          }
        />
      )}

      {/* task-12（design §8.1）：头部「最后信号」——数据源 = steps 明细最大
          completed_at（每步 --done 推送时点）纯前端派生：ChangeRead 无
          last_pushed_at（task-11 只落列表 ChangeSummary），且本页禁新增网络
          请求（复用既有 10s 详情轮询）；无信号（steps 缺失/无 completed_at）
          整行不渲染，畸形串回退原文（组件内防御）。 */}
      <ChangeLastSignal lastPushedAt={lastSignalFromSteps(change.steps)} />

      {/* task-09（2026-08-30-change-center-usage-stats / FR-05 / D-004@v1）：
          变更执行用量卡（kind=change），组件 useQuery 自取数（D-007@v1），接线层
          零取数逻辑——对齐同页 ChangeSessionsCard 直接传参挂载惯例，不加门控。
          裁定：上方「本页禁新增网络请求（复用既有 10s 详情轮询）」注释仅约束
          last-signal（须纯前端派生、复用详情轮询），不约束自取数辅助卡（本页
          sessions 卡已同先例自开 useQuery）。 */}
      <ChangeUsageCard kind="change" workspaceId={workspaceId} refKey={changeId} />

      {pageError ? (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {pageError}
        </div>
      ) : null}
      {successMsg ? (
        <div style={{ borderColor: "hsl(var(--success))", backgroundColor: "var(--semantic-success-soft)" }} className="rounded border px-3 py-2 text-xs text-success">
          {successMsg}
        </div>
      ) : null}

      {/* 左主右辅两栏（移动端 <lg 单列：次线堆叠在主线下方） */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_296px]">
        {/* 主线：审批卡 + 步骤时间线 + 智能体执行日志（只读） */}
        <main className="space-y-3">
          <ChangeStageActions
            change={change}
            boundSession={boundSession}
            gateComment={gateComment}
            onGateCommentChange={setGateComment}
            onGateAction={(action) => void handleGateAction(action)}
            transitioning={transitioning}
            notifyResult={notifyResult}
          />

          {/* 步骤时间线（task-07 / D-005@v1：数据源 latest_progress.steps，替换旧
              SillySpecStepProgress 的 change.stages 派生挂载；steps 缺失降级不渲染，
              组件内自空态兜底，D-003；focusStage 与上方阶段节点联动 ql-20260821-017） */}
          {change.steps && change.steps.length > 0 ? (
            <section
              data-testid="change-step-timeline-card"
              className="rounded-md border bg-card"
            >
              <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                <h2 className="text-xs font-medium">
                  步骤时间线 ({change.steps.length})
                </h2>
                {focusStage ? (
                  <button
                    type="button"
                    onClick={() => setFocusStage(null)}
                    aria-label="清除阶段筛选"
                    className="inline-flex shrink-0 items-center gap-1 rounded-full border border-brand-300 bg-brand-500/10 px-2 py-px text-[11px] text-brand-600 transition-colors hover:bg-brand-500/20"
                  >
                    {WORKFLOW_STAGE_LABELS[focusStage] ?? focusStage} ✕
                  </button>
                ) : null}
              </div>
              <div className="px-3 py-2.5">
                <ChangeStepTimeline
                  steps={change.steps}
                  focusStage={focusStage}
                />
              </div>
            </section>
          ) : null}

          {/* 真实留痕时间线（2026-09-26-change-real-timeline / FR-03；2026-09-27-
              timeline-coexist 共存化）：原与步骤时间线互斥（steps 空才挂载）——归档时
              CLI unregisterChange 终态一致化补种 steps（3 行同一时间戳）会把本卡顶掉，
              归档后真实数据（事件轴 × 任务面 × 墙钟）不可见。改恒挂载：组件自身
              events/tasks/born 全空时静默隐藏，无观测数据零占位（厚变更不受扰）。 */}
          <ChangeTimelineCard workspaceId={workspaceId} changeId={changeId} />

          {/* 沉淀资产（2026-09-28-change-ux-detail-batch：自 aside 移主栏 + 默认展开
              + 分组固定高度滚动网格——侧栏 296px 窄列里折叠卡「点了看不到东西」，
              归档资产是详情页主信息之一，宽列网格展开才是可用形态）。 */}
          <ChangeAssetsCard workspaceId={workspaceId} changeId={changeId} />

          {/* 智能体运行状态卡已移除（2026-09-28-change-ux-detail-batch 用户裁决）：
              thin 变更无派发，「当前阶段未配置智能体」常驻属噪音；完整流程的执行
              观测走会话页。组件保留（mobile-change-detail 仍在用）。 */}
        </main>

        {/* 次线（2026-09-27 visual-align-2：对齐原型 MetaPanel 观感——外层统一
            圆角边框容器，子卡去边框去阴影，六卡视觉融合为单块侧栏面板；各卡
            自取数/折叠/头部功能零改动）：变更文件 / 关联快速任务 / 观测事件 /
            会话 / 范围对账 / 沉淀资产 */}
        <aside
          className="flex flex-col gap-0 overflow-hidden rounded-lg border bg-card [&>*]:!rounded-none [&>*]:!border-x-0 [&>*]:!border-t-0 [&>*]:!shadow-none [&>*:not(:last-child)]:!border-b [&>*:last-child]:!border-b-0"
        >
          <ChangeFilesCard workspaceId={workspaceId} changeId={changeId} />
          <QuicklogLinkedCard
            workspaceId={workspaceId}
            changeKey={change.change_key}
          />
          {/* 2026-09-28-drop-observation-card：原「观测事件」折叠卡移除——与主栏
              真实留痕时间线卡同表同数据双显（r18-full FR-07/08 与 change-real-timeline
              重叠），产品裁决事件流水由主栏时间线卡独家承担；后端
              GET /changes/{name}/events 端点保留（CLI 推送/调试面）。 */}
          <ChangeSessionsCard workspaceId={workspaceId} changeId={changeId} />
          {/* ql-20260910-014-6c29：scope-audit 范围对账结果卡（ql-20260911-001-c0be
              升级：本机跑对账出三态计数+锚点合计+明细弹窗行联动单文件 diff，本地命令折叠为兜底；identifier=
              change_key）。archived 传入（2026-09-25-change-detail-assets-usability /
              FR-05）：已归档变更降级时指路「沉淀资产 · 归档留档」。 */}
          <ScopeAuditCommandCard
            target={{
              kind: "change",
              workspaceId,
              changeKey: change.change_key,
            }}
            archived={isTerminalChange(change)}
          />
          {/* 2026-09-25-change-precipitated-assets 卡已移主栏（2026-09-28-
              change-ux-detail-batch）。 */}
          {/* 智能体运行状态卡已移除（2026-09-28-change-ux-detail-batch）。 */}
        </aside>
      </div>
    </PageContainer>
  );
}

/**
 * 详情页删除动作（task-07 / design §6.3 / FR-05d）——危险按钮 + 受控弹层。
 *
 * 独立子组件（PageHeader actions slot 挂载）：承载 useRouter + useMutation，
 * 仅权限可见者由父组件挂载（canDeleteChange 三判启发式，后端权威）。删除
 * 成功 → toast + ["changes", wsId] 前缀失效 + 跳回变更列表；403/404/409
 * 失败 → 中文 toast 留在本页（errMessage 取 ApiError.message，不白屏）。
 */
function DetailDeleteAction({
  workspaceId,
  changeId,
  changeKey,
  ownerName,
}: {
  workspaceId: string;
  changeId: string;
  changeKey: string;
  ownerName?: string | null;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const notify = useNotify();
  const [open, setOpen] = useState(false);
  const deleteMutation = useMutation({
    mutationFn: () => deleteChange(workspaceId, changeId),
    onSuccess: async () => {
      notify.success(`变更 ${changeKey} 已删除`);
      // 列表前缀失效（行从 tab 消失）+ 详情页跳回列表
      await queryClient.invalidateQueries({
        queryKey: ["changes", workspaceId],
      });
      router.push(`/workspaces/${workspaceId}/changes`);
    },
    onError: (err) => {
      notify.error(err, "删除变更失败");
    },
  });
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        data-testid="change-delete-entry"
        className="text-muted-foreground hover:border-destructive/50 hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        删除
      </Button>
      {/* 受控弹层（照 admin/users DeleteConfirm 范式）：确认先关弹层再删，
          失败路径走 onError toast 不重开弹层 */}
      {open && (
        <DeleteChangeConfirm
          target={{ change_key: changeKey, owner_name: ownerName }}
          onCancel={() => setOpen(false)}
          onConfirm={() => {
            setOpen(false);
            deleteMutation.mutate();
          }}
        />
      )}
    </>
  );
}
