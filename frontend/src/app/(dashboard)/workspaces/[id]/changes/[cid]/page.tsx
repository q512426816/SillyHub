"use client";

/**
 * 变更详情页（桌面）—— tab 容器（2026-10-15-change-detail-redesign / D-002@v1 / D-013@v1）。
 *
 * 结构：primer `PageHead`（面包屑 + 标题 + 状态胶囊 + 元信息 + 操作）→ 阶段条（常驻；
 * 点阶段切到「过程」tab 并置筛选）→ `ChangeTabs`（`?tab=` 为唯一源）→ 当前 tab 的面板。
 *
 * 四 tab（在途）/ 三 tab（归档，隐藏「文件与对账」，D-007@v1）由 `visibleTabs` 单布尔驱动，
 * thin 不特判（D-015@v1）。面板**懒挂载**：只挂当前 tab（首屏不做多余取数）；`?tab=` 缺省 /
 * 非法 / 不在可见集（含归档态 `files`、切换变更残留值）一律 `router.replace` 钳回 `overview`。
 *
 * 旧版能力全部保留、只换挂载位置：10s 轮询与终态停轮、删除入口与权限启发式、审批唯一入口
 * `submitStageReview`（含通知降级文案）、绑定会话近似口径、最后信号派生、范围对账与四个弹窗
 * （后两者随组件移入相应 tab）。
 *
 * ⚠️ 契约：本文件具名导出 `isTerminalChange` 是**移动端消费面**
 * （frontend/src/components/mobile/mobile-change-detail.tsx:66-67），MUST 原地保留且语义不变
 * （D-011@v1 / D-016@v1）。`change-step-timeline.tsx` / `change-usage-card.tsx` 等旧组件文件
 * MUST NOT 删除（移动端与既有测试仍引用）。
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { PageContainer } from "@/components/layout";
import { Button } from "@/components/ui/button";
import {
  DeleteChangeConfirm,
  canDeleteChange,
  useChangeDeleteAccess,
} from "@/components/delete-change-confirm";
import { PageHead, StatGrid, StateLabel, type StateLabelVariant } from "@/components/primer";
import { isThinLineageChange } from "@/lib/thin-lineage";
import {
  ChangeStageHeader,
  WORKFLOW_STAGE_LABELS,
} from "@/components/changes/detail/change-stage-header";
import { ChangeTabs, visibleTabs, type DetailTab } from "@/components/changes/detail/change-tabs";
import { ChangeAssetsCard } from "@/components/changes/detail/change-assets-card";
import { ChangeAssetsGraph } from "@/components/changes/detail/change-assets-graph";
import { ChangeFilesPanel } from "@/components/changes/detail/change-files-panel";
import { ChangeOverviewPanel } from "@/components/changes/detail/change-overview-panel";
import { ChangeTaskChecklist } from "@/components/changes/detail/change-task-checklist";
import { ChangeUnifiedTimeline } from "@/components/changes/detail/change-unified-timeline";
import {
  inferTaskTimeStatus,
  mergeChangeTimeline,
  type TimelineEvent,
  type TimelineTask,
  type UnifiedRow,
} from "@/components/changes/detail/merge-change-timeline";
import { ApiError } from "@/lib/api";
import {
  deleteChange,
  getChange,
  getChangeTimeline,
  renameChangeTitle,
  submitStageReview,
  type ChangeRead,
} from "@/lib/changes";
import { useNotify } from "@/lib/errors";
import {
  listChangeSessions,
  type AgentSessionListItem,
} from "@/lib/daemon";

interface Props {
  params: { id: string; cid: string };
}

/** 变更详情查询 key（react-query 缓存定位与审批后失效重取）。 */
const CHANGE_QUERY_KEY = (workspaceId: string, changeId: string) =>
  ["change", workspaceId, changeId] as const;

/** 合成时间线查询 key（与旧「真实留痕时间线卡」同 key——缓存复用，不新增请求源）。 */
const TIMELINE_QUERY_KEY = (workspaceId: string, changeId: string) =>
  ["changeTimeline", workspaceId, changeId] as const;

/** 非终态轮询间隔（design：详情页 10s）。 */
const DETAIL_REFETCH_MS = 10_000;

/**
 * 变更终态判定（可测试定义）：status 为 archived 或 location 为 archive 即终态——
 * changes 表仅 active/archived 两值（失败语义在 steps 层）。data 未就绪按非终态处理。
 *
 * ⚠️ 移动端消费面（mobile-change-detail.tsx 直接 import 本符号）：语义与位置均属契约，
 * 重构 MUST NOT 迁走或改写（D-011@v1 / D-016@v1）。
 */
export function isTerminalChange(
  change: Pick<ChangeRead, "status" | "location"> | null | undefined,
): boolean {
  if (!change) return false;
  return change.status === "archived" || change.location === "archive";
}

/** 页头状态胶囊（沿用既有四态文案；quick/thin/blocked 为非线性节点）。 */
const STATUS_PILL: Record<
  string,
  { label: string; variant: StateLabelVariant; iconName?: "zap" | "clock" }
> = {
  quick: { label: "快速任务（存量）", variant: "neutral" },
  thin: { label: "轻量变更", variant: "attention", iconName: "zap" },
  blocked: { label: "已阻塞", variant: "error" },
};

/** 归档态补充：轻量出身标识随徽章存活（change_type=quick 且创建于 thin 分流点之后）。 */
function thinOriginBadge(change: ChangeRead): boolean {
  return (
    change.change_type === "quick" &&
    new Date(change.created_at ?? 0) >= new Date("2026-09-25T00:00:00+08:00")
  );
}

/**
 * 阶段跨度：每阶段条目数 + 首末时刻跨度（观测留痕推算；不足两点标「单点记录」）。
 * 说明：这是「过程」tab 的统计补充，不是执行耗时（后者在概览信息栏的「已用时长」）。
 */
function stageSpans(rows: UnifiedRow[]): Array<{ label: string; value: string }> {
  const byStage = new Map<string, number[]>();
  for (const row of rows) {
    if (!row.stage) continue;
    const ms = row.at ? Date.parse(row.at) : Number.NaN;
    if (Number.isNaN(ms)) continue;
    const bucket = byStage.get(row.stage) ?? [];
    bucket.push(ms);
    byStage.set(row.stage, bucket);
  }
  const items = [...byStage.entries()].map(([stage, times]) => {
    const sorted = [...times].sort((a, b) => a - b);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const spanMs = sorted.length >= 2 && first != null && last != null ? last - first : 0;
    const spanText =
      spanMs <= 0
        ? "单点记录"
        : spanMs >= 3_600_000
          ? `${(spanMs / 3_600_000).toFixed(1)} 小时`
          : spanMs >= 60_000
            ? `${Math.round(spanMs / 60_000)} 分钟`
            : `${Math.round(spanMs / 1000)} 秒`;
    return {
      label: WORKFLOW_STAGE_LABELS[stage] ?? stage,
      value: `${times.length} 条 · ${spanText}`,
    };
  });
  return items.length > 0 ? items : [{ label: "阶段跨度", value: "暂无带时间戳的记录" }];
}

/**
 * 返回列表入口（2026-10-16-change-center-back-keeps-list-state）——breadcrumb「变更列表」
 * 与错误态「← 变更列表」共用。历史可后退时点击走 router.back()（回离开前带 query 的列表
 * URL，列表页从 URL 恢复 tab/页码，见列表页同变更的 URL 快照）；新标签深链（length<=1）
 * 保持 Link 默认导航到默认列表。href 始终保留（新标签打开/收藏语义不变）；SSR 渲染输出
 * 与客户端一致（判定只影响 onClick，不进 DOM），无 hydration mismatch。
 */
function BackToListLink({
  workspaceId,
  className,
  children,
}: {
  workspaceId: string;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  // Next 14.2.5 history.state 无栈深标记（idx 为 Next 15+ 字段），以 length 判定：
  // 从列表/其他页进入必有前置条目（>1）；新标签深链 =1。已知取舍：从站外页点进来时
  // back 回站外页（标准返回语义，内部工具罕见）。
  const canBack = typeof window !== "undefined" && window.history.length > 1;
  return (
    <Link
      href={`/workspaces/${workspaceId}/changes`}
      prefetch={false}
      className={className}
      onClick={(e) => {
        if (canBack) {
          e.preventDefault();
          router.back();
        }
      }}
    >
      {children}
    </Link>
  );
}

export default function ChangeDetailPage({ params }: Props) {
  const workspaceId = params.id;
  const changeId = params.cid;
  const queryClient = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();

  // ── 变更详情（非终态 10s 轮询、终态停轮；请求已出错且无数据即停轮防无限空轮）──
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
  const loading = changeQuery.isPending;
  const loadError =
    changeQuery.isError && !changeQuery.data
      ? changeError instanceof ApiError
        ? changeError.message
        : "加载变更详情失败"
      : null;

  const archived = isTerminalChange(change);

  // ── tab 状态：`?tab=` 为唯一源（D-013@v1）；非法/收窄值（归档态 files、切换残留）钳回概览 ──
  const rawTab = searchParams?.get("tab") ?? null;
  const tabs = visibleTabs(archived);
  const activeTab: DetailTab = (tabs as string[]).includes(rawTab ?? "")
    ? (rawTab as DetailTab)
    : "overview";
  const [focusStage, setFocusStage] = useState<string | null>(null);

  useEffect(() => {
    if (rawTab !== null && rawTab !== activeTab) {
      router.replace(`/workspaces/${workspaceId}/changes/${changeId}?tab=${activeTab}`);
    }
  }, [rawTab, activeTab, router, workspaceId, changeId]);

  const handleTabChange = useCallback(
    (next: DetailTab) => {
      router.replace(`/workspaces/${workspaceId}/changes/${changeId}?tab=${next}`);
    },
    [router, workspaceId, changeId],
  );

  // 阶段条联动（ql-20260821-017 语义承接）：点阶段 → 切「过程」tab + 置筛选。
  const handleStageClick = useCallback(
    (stage: string) => {
      setFocusStage((prev) => (prev === stage ? null : stage));
      if (activeTab !== "process") handleTabChange("process");
    },
    [activeTab, handleTabChange],
  );

  const [pageError, setPageError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // ── 删除入口（PageHead 右侧危险按钮；可见性启发式，后端组合权限为权威）──
  const deleteAccess = useChangeDeleteAccess(workspaceId);

  // ── 审批卡（唯一操作区）state ───────────────────────────────────────────
  const [transitioning, setTransitioning] = useState(false);
  const [gateComment, setGateComment] = useState("");
  const [notifyResult, setNotifyResult] = useState<{
    notified_session: boolean;
    notify_error: string | null;
  } | null>(null);
  /** 变更关联会话（change_session_links 真实关联；概览信息栏最近 3 条 + 绑定会话）。 */
  const [sessions, setSessions] = useState<AgentSessionListItem[]>([]);

  // ── 辅助数据（变更关联会话）：一次性加载，不随详情轮询 ──────────────────
  // 2026-10-28-change-detail-sessions-source-fix FR-01/FR-02：数据源从
  // listWorkspaceAgentSessions（工作区全量近似）改为 listChangeSessions
  // （GET /changes/{id}/sessions，与后端 _notify_bound_session 注入目标同源）。
  useEffect(() => {
    let cancelled = false;
    setPageError(null);
    const loadSide = async () => {
      const list = await listChangeSessions(workspaceId, changeId).catch(() => []);
      if (cancelled) return;
      setSessions(list ?? []);
    };
    void loadSide();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, changeId]);
  const boundSession = sessions[0] ?? null;

  // ── 合成时间线（步骤 + 事件轴两源）→ 统一行（合并纯函数，零取数）──────────
  const timelineQuery = useQuery({
    queryKey: TIMELINE_QUERY_KEY(workspaceId, changeId),
    queryFn: () => getChangeTimeline(workspaceId, changeId),
    refetchInterval: archived ? false : DETAIL_REFETCH_MS,
    retry: false,
    refetchOnWindowFocus: false,
  });
  // 派生数组用 useMemo 固定引用（否则每次渲染的新数组会击穿下方 useMemo 的依赖比较）。
  const timelineData = timelineQuery.data;
  const timelineEvents = useMemo<TimelineEvent[]>(
    () => timelineData?.events ?? [],
    [timelineData],
  );
  const tasks = useMemo<TimelineTask[]>(() => timelineData?.tasks ?? [], [timelineData]);
  const unifiedRows: UnifiedRow[] = useMemo(
    () =>
      mergeChangeTimeline({
        steps: change?.steps ?? [],
        events: timelineEvents,
        bornAt: timelineQuery.data?.born_at ?? null,
      }),
    [change?.steps, timelineEvents, timelineQuery.data?.born_at],
  );
  const taskSummary = useMemo(
    () => ({ checked: tasks.filter((t) => t.checked).length, total: tasks.length }),
    [tasks],
  );
  const timeStatus = useMemo(() => inferTaskTimeStatus(tasks, timelineEvents), [tasks, timelineEvents]);

  // ── 审批唯一入口 submitStageReview（notify_session 透传，注入移后端 best-effort）──
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
          true,
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
        await queryClient
          .invalidateQueries({ queryKey: CHANGE_QUERY_KEY(workspaceId, changeId) })
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
        <BackToListLink
          workspaceId={workspaceId}
          className="mt-3 inline-block text-xs text-primary hover:underline"
        >
          ← 变更列表
        </BackToListLink>
      </PageContainer>
    );
  }

  const stepStages =
    change.steps && change.steps.length > 0
      ? Array.from(new Set(change.steps.map((e) => e.stage)))
      : [];

  const stage = change.current_stage ?? "draft";
  const pill = archived
    ? { label: "已归档", variant: "merged" as StateLabelVariant, iconName: undefined }
    : (STATUS_PILL[stage] ?? {
        label: WORKFLOW_STAGE_LABELS[stage] ?? stage ?? "未知",
        variant: "open" as StateLabelVariant,
        iconName: undefined,
      });

  return (
    <PageContainer size="full" className="gap-4">
      <PageHead
        breadcrumb={
          <span className="flex items-center gap-1.5">
            <BackToListLink workspaceId={workspaceId} className="hover:underline">
              变更列表
            </BackToListLink>
            <span className="text-muted-foreground/60">/</span>
            <span className="text-foreground">{change.change_key}</span>
          </span>
        }
        title={change.title ?? change.change_key}
        titleExtra={
          <span className="flex flex-wrap items-center gap-2">
            {archived && thinOriginBadge(change) ? (
              <StateLabel variant="attention" iconName="zap">
                轻量变更
              </StateLabel>
            ) : null}
            <StateLabel variant={pill.variant}>{pill.label}</StateLabel>
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
        actions={
          <span className="flex items-center gap-2">
            {/* 2026-10-16-change-title-condense-backfill FR-06：改名入口与删除入口
                同权限三元组可见（启发式少给无权者看按钮，后端 403 兜底）。 */}
            {canDeleteChange(change, deleteAccess) ? (
              <DetailRenameAction
                workspaceId={workspaceId}
                changeId={changeId}
                currentTitle={change.title ?? change.change_key}
              />
            ) : null}
            {canDeleteChange(change, deleteAccess) ? (
              <DetailDeleteAction
                workspaceId={workspaceId}
                changeId={changeId}
                changeKey={change.change_key}
                ownerName={change.owner_name}
              />
            ) : null}
            {/* 归档态不出「继续执行」（D-016@v1 Q-1：三处差异以批准稿为准）。 */}
            {archived ? null : (
              <Button size="sm" data-testid="change-continue-entry">
                继续执行
              </Button>
            )}
          </span>
        }
      />

      {/* 阶段条常驻（thin 出身维持轻量流程条，既有语义） */}
      {isThinLineageChange(change) ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border bg-card px-3 py-2.5">
          <StateLabel variant="attention" size="md">
            轻量变更
          </StateLabel>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>flow start</span>
            <span aria-hidden="true">→</span>
            <span>干活（改代码 + 填槽）</span>
            <span aria-hidden="true">→</span>
            <span>{archived ? "flow done 收口归档" : "flow done 收口（进行中）"}</span>
          </span>
        </div>
      ) : (
        <ChangeStageHeader
          currentStage={change.current_stage ?? null}
          stages={change.stages as Record<string, unknown> | null}
          updatedAt={change.updated_at ?? null}
          stepStages={stepStages}
          focusStage={focusStage}
          onStageClick={handleStageClick}
        />
      )}

      <ChangeTabs archived={archived} value={activeTab} onChange={handleTabChange} />

      {pageError ? (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {pageError}
        </div>
      ) : null}
      {successMsg ? (
        <div
          style={{
            borderColor: "hsl(var(--success))",
            backgroundColor: "var(--semantic-success-soft)",
          }}
          className="rounded border px-3 py-2 text-xs text-success"
        >
          {successMsg}
        </div>
      ) : null}

      {activeTab === "overview" ? (
        <ChangeOverviewPanel
          change={change}
          workspaceId={workspaceId}
          changeId={changeId}
          archived={archived}
          recentRows={unifiedRows}
          taskSummary={taskSummary}
          sessions={sessions}
          boundSession={boundSession}
          gateComment={gateComment}
          onGateCommentChange={setGateComment}
          onGateAction={(action) => void handleGateAction(action)}
          transitioning={transitioning}
          notifyResult={notifyResult}
        />
      ) : null}

      {activeTab === "assets" ? (
        <div className="flex flex-col gap-3" data-testid="change-assets-panel">
          {change.change_key ? (
            <ChangeAssetsGraph workspaceId={workspaceId} changeKey={change.change_key} />
          ) : null}
          <ChangeAssetsCard
            workspaceId={workspaceId}
            changeId={changeId}
            changeKey={change.change_key}
            archived={archived}
          />
        </div>
      ) : null}

      {activeTab === "process" ? (
        <div className="flex flex-col gap-3" data-testid="change-process-panel">
          <section className="rounded-md border bg-card" data-testid="change-process-timeline">
            <div className="flex items-center justify-between gap-2 border-b px-3.5 py-2.5">
              <h2 className="text-xs font-medium">统一过程时间线</h2>
              <span className="text-[11px] text-muted-foreground">
                步骤 + 事件两源合流 · {unifiedRows.length} 条
              </span>
            </div>
            <div className="px-3.5 py-3">
              {unifiedRows.length === 0 ? (
                <p className="py-3 text-center text-[11px] text-muted-foreground">
                  暂无过程记录。
                </p>
              ) : (
                <ChangeUnifiedTimeline
                  rows={unifiedRows}
                  activeStage={focusStage}
                  onStageChange={setFocusStage}
                />
              )}
            </div>
          </section>

          <ChangeTaskChecklist tasks={tasks} timeStatus={timeStatus} />

          <section className="rounded-md border bg-card" data-testid="change-process-stagecost">
            <div className="flex items-center justify-between gap-2 border-b px-3.5 py-2.5">
              <h2 className="text-xs font-medium">阶段跨度</h2>
              <span className="text-[11px] text-muted-foreground">
                各阶段条目数与首末时刻跨度（观测留痕推算）
              </span>
            </div>
            <div className="px-3.5 py-3">
              <StatGrid items={stageSpans(unifiedRows)} />
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === "files" ? (
        <ChangeFilesPanel
          workspaceId={workspaceId}
          changeId={changeId}
          changeKey={change.change_key}
          archived={archived}
        />
      ) : null}
    </PageContainer>
  );
}

/** 人工命名带宽（后端同款口径：strip 后 10-30 字必须，建议约 20，FR-05/06 单源）。 */
const TITLE_MIN_LEN = 10;
const TITLE_MAX_LEN = 30;

/**
 * 详情页改名动作——按钮 + 受控弹层（2026-10-16-change-title-condense-backfill
 * FR-06，用户口径 2026-10-16：管理员/平台责任人/变更责任人可重命名 title）。
 * 照 DetailDeleteAction 受控弹层范式；输入 strip 后 10-30 字内才启用保存，
 * 越带禁用并实时提示字数；保存成功关弹层 + 失效详情/列表缓存（失败走 onError
 * toast 不重开弹层，与删除动作一致）。
 */
function DetailRenameAction({
  workspaceId,
  changeId,
  currentTitle,
}: {
  workspaceId: string;
  changeId: string;
  currentTitle: string;
}) {
  const queryClient = useQueryClient();
  const notify = useNotify();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(currentTitle);
  const trimmed = draft.trim();
  const inBand =
    trimmed.length >= TITLE_MIN_LEN && trimmed.length <= TITLE_MAX_LEN;
  const renameMutation = useMutation({
    mutationFn: () => renameChangeTitle(workspaceId, changeId, trimmed),
    onSuccess: async (res) => {
      notify.success(`变更标题已更新：${res.title}`);
      setOpen(false);
      await queryClient.invalidateQueries({
        queryKey: ["change", workspaceId, changeId],
      });
      await queryClient.invalidateQueries({
        queryKey: ["changes", workspaceId],
      });
    },
    onError: (err) => {
      notify.error(err, "改名失败");
    },
  });
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        data-testid="change-rename-entry"
        className="text-muted-foreground"
        onClick={() => {
          setDraft(currentTitle);
          setOpen(true);
        }}
      >
        改名
      </Button>
      {open && (
        <div
          data-testid="change-rename-dialog"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
        >
          <div className="w-96 rounded-md border bg-background p-5 shadow-lg">
            <h3 className="text-sm font-semibold">修改变更标题</h3>
            <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
              10-30 字之内，建议 20 字左右概括变更内容
            </p>
            <input
              id="change-rename-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={currentTitle}
              maxLength={80}
              data-testid="change-rename-input"
              className="mt-3 h-9 w-full rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none"
            />
            <div
              className={`mt-1.5 text-xs ${
                inBand ? "text-muted-foreground" : "text-destructive"
              }`}
              data-testid="change-rename-hint"
            >
              {trimmed.length} / 带宽 10-30 字
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                取消
              </Button>
              <Button
                size="sm"
                disabled={!inBand || renameMutation.isPending}
                data-testid="change-rename-save"
                onClick={() => renameMutation.mutate()}
              >
                保存
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * 详情页删除动作——危险按钮 + 受控弹层（PageHead actions slot 挂载；仅权限可见者挂载
 * 该子组件，未挂载即不触碰 router —— 无 app-router 上下文的环境不触发 invariant）。
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
      await queryClient.invalidateQueries({ queryKey: ["changes", workspaceId] });
      // 2026-10-16-change-center-delete-back-keeps-state：删除后返回保来路列表状态——
      // 可后退时 back 回带 query 的列表 URL（列表页从 URL 恢复 tab/页码，同
      // BackToListLink 链路）；新标签深链（length<=1）兜底 push 默认列表。
      if (typeof window !== "undefined" && window.history.length > 1) {
        router.back();
      } else {
        router.push(`/workspaces/${workspaceId}/changes`);
      }
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
      {/* 受控弹层（照 admin/users DeleteConfirm 范式）：确认先关弹层再删，失败路径走
          onError toast 不重开弹层 */}
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
