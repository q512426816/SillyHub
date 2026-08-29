"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Checkbox, Input, Select, type TableProps } from "antd";

import {
  DataTable,
  PageContainer,
  PageHeader,
  SectionCard,
} from "@/components/layout";
import { Button, buttonVariants } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { StatusBadge } from "@/components/ui/status-badge";
import { ChangeStepBadge } from "@/components/changes/change-step-badge";
import { ChangeActivityBadge } from "@/components/changes/change-activity-badge";
import { QuicklogDrawer } from "@/components/changes/quicklog-drawer";
import { QuicklogTable } from "@/components/changes/quicklog-table";
import {
  DeleteChangeConfirm,
  canDeleteChange,
  useChangeDeleteAccess,
} from "@/components/delete-change-confirm";
import { ApiError } from "@/lib/api";
import { listQuicklogEntries, type QuicklogEntryListItem } from "@/lib/quicklog";
import {
  deleteChange,
  listChanges,
  reparseChanges,
  type ChangeList,
  type ChangeReparseStats,
  type ChangeSummary,
  type ChangeWarning,
} from "@/lib/changes";
import { useNotify } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { getWorkspace, type Workspace } from "@/lib/workspaces";

interface Props {
  params: { id: string };
}

// 查询条件垂直 Field（label 在上，控件在下），对齐 admin/roles / admin/users。
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex w-full flex-col gap-1">
      <span className="text-xs leading-4 text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

const TABS = [
  { key: "active", label: "进行中" },
  { key: "archive", label: "已归档" },
  { key: "quicklog", label: "快速修复" },
] as const;

type ChangesTab = "active" | "archive" | "quicklog";

// task-06 / design §7：待办徽标映射（替代死代码 GATE_LABELS）。
// 数据源 = ChangeSummary.pending_review（PG 镜像 _map 投影，task-03）+ status=blocked。
// 纯前端展示映射，后端 task-03 已统一投影为 4 个新取值（不再 need_* 兼容）。
export const PENDING_REVIEW_LABEL: Record<string, string> = {
  proposal_review: "待提案审核",
  plan_review: "待计划审核",
  human_test: "待人工测试",
  archive_confirm: "待归档确认",
};

const STAGE_OPTIONS = [
  { value: "", label: "全部阶段" },
  { value: "brainstorm", label: "需求分析" },
  { value: "plan", label: "规划" },
  { value: "execute", label: "执行" },
  { value: "verify", label: "验证" },
  { value: "archive", label: "归档" },
] as const;

// 排序方向（task-06 / D-004）：默认最近活动优先。
type SortDir = "updated_at_desc" | "updated_at_asc";

// ── 智能轮询纯函数（task-06 / design §5 Phase 2.4 / Grill #2，导出供测试）──────
//
// 终态可测试定义：status === "archived" || location === "archive"（changes 表仅
// active/archived 两值，无 failed——失败语义在 steps 层由 7 值枚举承载）。

/** 单条变更终态判定（design §5 Phase 2.4）。 */
export function isTerminalChange(
  c: Pick<ChangeSummary, "status" | "location">,
): boolean {
  return c.status === "archived" || c.location === "archive";
}

/** 当前页存在任一非终态变更（停轮判定：全终态 → false；数据未到也不轮）。 */
export function hasActiveChanges(
  data: ChangesPageData | undefined,
): boolean {
  if (!data) return false;
  return data.items.some((c) => !isTerminalChange(c));
}

/** 列表轮询间隔（D-001@v1）：非终态存在 → 30s；全终态 / 无数据 → false 停轮。 */
export const CHANGES_POLL_INTERVAL_MS = 30_000;

// task-12（design §8.1）：活动停滞阈值（30min）——与上方 CHANGES_POLL_INTERVAL_MS
// 同属展示层常量，此处同点重导出供测试/消费方与轮询间隔一处取用；真值表与
// 防御解析实现在 change-activity-badge.tsx（徽标组件领地，避免页面↔组件循环依赖）。
export { ACTIVITY_STALE_MS } from "@/components/changes/change-activity-badge";

/** refetchInterval 决策函数（导出供单测两分支：非终态 30000 / 全终态 false）。 */
export function changesRefetchInterval(
  data: ChangesPageData | undefined,
): number | false {
  return hasActiveChanges(data) ? CHANGES_POLL_INTERVAL_MS : false;
}

/** 主 load 响应：变更分页 + 并发拉取的 workspace（原 Promise.all 装配，R-07 保持）。 */
type ChangesPageData = ChangeList & { workspace: Workspace };

export default function ChangesPage({ params }: Props) {
  const workspaceId = params.id;
  const queryClient = useQueryClient();
  // task-10（FR-07）：支持 ?tab=quicklog 初始 tab（变更详情页「关联的快速任务」跳转入口）；
  // ?search= 初始搜索词（quicklog 关联变更列跳转消费端，QA P2 修复）
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab");
  const initialSearch = searchParams.get("search") ?? "";
  const [tab, setTab] = useState<ChangesTab>(
    initialTab === "quicklog" || initialTab === "archive" ? initialTab : "active",
  );
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [search, setSearch] = useState(initialSearch);
  // ql-20260818-004：「只看待我处理」下放为查询条件（仅进行中视图），默认不勾选
  const [focusMine, setFocusMine] = useState(false);
  const [stageFilter, setStageFilter] = useState("");
  const [sortDir, setSortDir] = useState<SortDir>("updated_at_desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [reparsing, setReparsing] = useState(false);
  // task-07（design §6.3 / FR-05d）：受控删除弹层 target（null = 关闭，
  // 照 admin/users DeleteConfirm 受控范式），确认后关弹层 + deleteMutation。
  const [deleteTarget, setDeleteTarget] = useState<ChangeSummary | null>(null);
  // task-09（D-006）：quicklog 行点击打开详情抽屉
  const [quicklogSelected, setQuicklogSelected] =
    useState<QuicklogEntryListItem | null>(null);
  // reparse 错误横幅（主 load 错误改由 query 派生，见 listError）
  const [pageError, setPageError] = useState<string | null>(null);
  const [stats, setStats] = useState<ChangeReparseStats | null>(null);
  const [warnings, setWarnings] = useState<ChangeWarning[]>([]);

  // 主 load（task-06 / D-004@v1：裸 useEffect+useState 改 useQuery）。
  // queryKey = workspaceId + 全部请求参数（tab/search/stageFilter/sortDir/
  // pendingReviewOnly/page/pageSize），任一变化即新查询自动重取——请求参数与
  // 改造前逐项一致（R-07）。queryFn 保持原 Promise.all（listChanges 全参 +
  // getWorkspace，task-11 / 2026-07-10-remove-server-local-workspace-mode：平台
  // 统一 daemon-client 语义，前端不再校验 daemon 在线状态）。
  const changesQuery = useQuery({
    queryKey: [
      "changes",
      workspaceId,
      {
        location: tab,
        search,
        currentStage: stageFilter,
        sort: sortDir,
        // D-007：进行中 + 聚焦 → 只看待我处理（pending_review 非空）
        pendingReviewOnly: tab === "active" && focusMine,
        page,
        pageSize,
      },
    ],
    queryFn: async (): Promise<ChangesPageData> => {
      const [resp, ws] = await Promise.all([
        listChanges(workspaceId, {
          location: tab,
          search: search || undefined,
          currentStage: stageFilter || undefined,
          sort: sortDir,
          pendingReviewOnly: tab === "active" && focusMine,
          page,
          pageSize,
        }),
        getWorkspace(workspaceId),
      ]);
      return { ...resp, workspace: ws };
    },
    // task-08（D-001）：quicklog tab 不发变更列表请求（QuicklogTable 自带独立查询）
    enabled: tab !== "quicklog",
    // 分页/筛选切 key 时保留上一页数据渲染（改造前 items 不清空、不闪空表）
    placeholderData: keepPreviousData,
    // 智能轮询（D-001@v1）：当前页存在非终态变更 30s 刷新，全终态停轮；
    // refetchIntervalInBackground 默认 false = 页面不可见暂停；structuralSharing
    // 默认开——响应内容不变时引用相等，DataTable rowKey="id" 行不重渲染（R-04 不乱跳）。
    refetchInterval: (query) => changesRefetchInterval(query.state.data),
  });

  const items = changesQuery.data?.items ?? [];
  const total = changesQuery.data?.total ?? 0;
  const workspace = changesQuery.data?.workspace ?? null;

  // ── 删除入口（task-07 / design §6.3 / FR-05d）──────────────────────────
  // 可见性启发式（owner 本人 / 平台管理员 / 工作区所有者）——仅控制按钮显隐，
  // 后端 DELETE 组合权限为权威（判漏 403 兜底走 onError toast）。
  const notify = useNotify();
  const deleteAccess = useChangeDeleteAccess(workspaceId);
  const deleteMutation = useMutation({
    mutationFn: (c: ChangeSummary) => deleteChange(workspaceId, c.id),
    onSuccess: async (_resp, c) => {
      notify.success(`变更 ${c.change_key} 已删除`);
      // ["changes", workspaceId] 前缀失效（列表/各 tab 分页同前缀全刷，页面
      // 既有范式 :276-278；location='deleted' 行不进 active/archive 两 tab，
      // 行从当前 tab 消失）。tab 计数 changesTabTotals 不在此前缀（对齐
      // reparse 既有语义，不额外失效）。
      await queryClient.invalidateQueries({
        queryKey: ["changes", workspaceId],
      });
    },
    onError: (err) => {
      // 403（无权限）/404（不存在）/409（已删幂等）统一中文 toast（errMessage
      // 取 ApiError.message，不白屏）
      notify.error(err, "删除变更失败");
    },
  });
  // loading = 挂起态（首载/切 key 无数据可显时转圈）；后台轮询与同参 refetch
  // 不闪 loading（antd spinner 会造成整表重渲染抖动，与 R-04 不乱跳目标相悖）
  const loading = changesQuery.isPending;
  // 主 load 错误语义保持（R-07）：ApiError 取 err.message，否则「加载变更列表失败」
  const listError = changesQuery.isError
    ? changesQuery.error instanceof ApiError
      ? changesQuery.error.message
      : "加载变更列表失败"
    : null;
  // 顶部红条取主 load 错误优先，其次 reparse 横幅错误（原 listError ?? pageError 就地表达式）
  const bannerError = listError ?? pageError;

  // tab 计数（进行中=不聚焦的总数 M；已归档=archive total），用于 tab 挂数量 + 副标题 M。
  // 独立 useQuery（key 不含 filter/聚焦）：filter/聚焦变化不重发，tab 计数稳定不被
  // 污染；不轮询、失败静默（非关键，与原 effect 的 catch 行为一致）。首次无值时
  // tab 不显示计数，请求完成后回填。
  const tabTotalsQuery = useQuery({
    queryKey: ["changesTabTotals", workspaceId],
    queryFn: async (): Promise<{
      active: number;
      archive: number;
      quicklog: number;
    }> => {
      // task-08（D-001）：第三 tab 计数=快速修复条目数；ql-20260820-008 起含空壳
      // 占位（与表格默认显示口径一致，计数不与列表脱节）
      const [a, b, q] = await Promise.all([
        listChanges(workspaceId, { location: "active", pageSize: 1 }),
        listChanges(workspaceId, { location: "archive", pageSize: 1 }),
        listQuicklogEntries(workspaceId, { include_placeholder: true, page_size: 1 }),
      ]);
      return { active: a.total, archive: b.total, quicklog: q.total };
    },
    retry: false,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });
  const tabTotals: { active?: number; archive?: number; quicklog?: number } =
    tabTotalsQuery.data ?? {};

  // 旧 load() 每次执行先清错误横幅：新数据到达时收敛 reparse 错误横幅（语义对齐）。
  useEffect(() => {
    setPageError(null);
  }, [changesQuery.dataUpdatedAt]);

  const handleSearchClick = () => {
    const noChange = searchInput === search && page === 1;
    setSearch(searchInput);
    setPage(1);
    // 参数未变（queryKey 不变，react-query 不会自动重取）→ 手动 refetch，保持
    // 旧「同参重查」行为
    if (noChange) void changesQuery.refetch();
  };

  const handleResetClick = () => {
    setSearchInput("");
    setSearch("");
    setStageFilter("");
    // ql-20260818-004：聚焦下放查询条件后，重置一并回默认（不勾选）
    setFocusMine(false);
    setPage(1);
  };

  const handleTabChange = (newTab: ChangesTab) => {
    if (newTab === tab) return;
    setTab(newTab);
    setPage(1);
  };

  const toggleSort = () => {
    setSortDir((prev) =>
      prev === "updated_at_desc" ? "updated_at_asc" : "updated_at_desc",
    );
    setPage(1);
  };

  const handleReparse = async () => {
    setReparsing(true);
    setPageError(null);
    try {
      const resp = await reparseChanges(workspaceId);
      setStats(resp.stats);
      setWarnings(resp.warnings ?? []);
      // 旧 load() 只刷主列表（tabTotals 不随 reparse 刷新）：失效主列表 key 前缀
      // ["changes", workspaceId]（不含 changesTabTotals），等价替换且 await 语义一致
      await queryClient.invalidateQueries({
        queryKey: ["changes", workspaceId],
      });
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "重新解析失败");
    } finally {
      setReparsing(false);
    }
  };

  // 待办徽标渲染（D-007 / design §7）：blocked 优先，否则 pending_review 投影，否则空占位。
  const renderTodoBadge = (c: ChangeSummary): ReactNode => {
    if (c.status === "blocked") {
      return <StatusBadge kind="error">阻塞中</StatusBadge>;
    }
    if (c.pending_review && PENDING_REVIEW_LABEL[c.pending_review]) {
      return (
        <StatusBadge kind="warning">
          {PENDING_REVIEW_LABEL[c.pending_review]}
        </StatusBadge>
      );
    }
    return <span className="text-xs text-muted-foreground">—</span>;
  };

  // 负责人列渲染（task-05 / FR-04，2026-08-16-change-owner-from-token）：owner_name
  // = 后端 enrich 批量 join users 填充（display_name 优先 username fallback，
  // design §5 Phase 2.1，task-04 落地）。三态：owner_name 非空 → 用户名（可读，
  // 小字号）；owner_name 空且 owner_id 有值 → UUID 前 8 位短标识降级（mono，
  // enrich 未覆盖的兜底路径）；双空 → "—"（从未上行过 owner 的存量变更）。
  const renderOwner = (c: ChangeSummary): ReactNode => {
    if (c.owner_name) {
      return <span className="text-xs text-foreground">{c.owner_name}</span>;
    }
    if (c.owner_id) {
      return (
        <span className="font-mono text-[11px] text-primary">
          {c.owner_id.slice(0, 8)}
        </span>
      );
    }
    return <span className="text-xs text-muted-foreground">—</span>;
  };

  const columns: TableProps<ChangeSummary>["columns"] = [
    {
      title: "待办状态",
      key: "todo",
      // task-12（design §8.1）：列内追加活动徽标（真值表三态：进行中/停滞/空闲），
      // 消费 step_progress.current_step_status + last_pushed_at（task-11 投影）；
      // 数据随既有 30s 智能轮询刷新，零新增请求。宽度 120→150 容纳
      // 「停滞 · 最后信号 x 小时前」最长文案单行不折行。
      width: 150,
      render: (_v: unknown, c: ChangeSummary) => (
        <div className="flex flex-col items-start gap-1">
          {renderTodoBadge(c)}
          <ChangeActivityBadge
            currentStepStatus={c.step_progress?.current_step_status ?? null}
            lastPushedAt={c.last_pushed_at ?? null}
          />
        </div>
      ),
    },
    {
      title: "标题",
      key: "title",
      render: (_v: unknown, c: ChangeSummary) => (
        <Link
          href={`/workspaces/${workspaceId}/changes/${c.id}`}
          prefetch={false}
          className="group inline-block"
        >
          <span className="block font-mono text-[11px] text-primary group-hover:underline">
            {c.change_key}
          </span>
          {c.title && (
            <span className="block text-[11px] text-muted-foreground">
              {c.title}
            </span>
          )}
        </Link>
      ),
    },
    {
      title: "负责人",
      key: "owner",
      width: 90,
      render: (_v: unknown, c: ChangeSummary) => renderOwner(c),
    },
    {
      title: "阶段",
      key: "stage",
      // task-06 / FR-03：换 ChangeStepBadge（stage 主行 + step 摘要副行）。
      // step_progress 缺省传 null 由组件内部降级只渲染 stage 主行（D-003@v1，
      // 视觉与现状一致）；宽度 90→150 容纳「step x/y · 当前步名」副行。
      width: 150,
      render: (_v: unknown, c: ChangeSummary) => (
        <ChangeStepBadge
          stage={c.current_stage ?? "scan"}
          stepProgress={c.step_progress ?? null}
        />
      ),
    },
    {
      title: "影响组件",
      key: "affected_components",
      ellipsis: true,
      render: (c: ChangeSummary) => (
        <span className="text-[11px]">
          {c.affected_components.length > 0
            ? c.affected_components.join(", ")
            : "—"}
        </span>
      ),
    },
    {
      title: (
        <button
          type="button"
          onClick={toggleSort}
          className="inline-flex items-center gap-0.5 font-normal text-primary hover:underline"
          title="点击切换升序/降序"
        >
          更新时间
          <span aria-hidden>{sortDir === "updated_at_desc" ? "↓" : "↑"}</span>
        </button>
      ),
      dataIndex: "updated_at",
      key: "updated_at",
      align: "right",
      width: 140,
      render: (v: string) => (
        <span className="text-[11px] text-muted-foreground">
          {new Date(v).toLocaleString("zh-CN", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      ),
    },
    // task-07（design §6.3 / FR-05d）：操作列删除入口——仅权限可见者渲染
    // （canDeleteChange 三判启发式，后端权威）；无权行渲染空占位（不加「—」，
    // 避免与待办/负责人列的「—」占位叠加干扰可读性）。active/archive 两 tab
    // 均可删（§6.1 归档区变更同样可删）。
    {
      title: "操作",
      key: "actions",
      width: 70,
      render: (_v: unknown, c: ChangeSummary) =>
        canDeleteChange(c, deleteAccess) ? (
          <Button
            size="sm"
            variant="ghost"
            data-testid="change-delete-entry"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => setDeleteTarget(c)}
          >
            删除
          </Button>
        ) : null,
    },
  ];

  // 副标题（task-06）：workspace 名 + 计数。
  // 聚焦时 N=total（当前待我处理），M=tabTotals.active（进行中总数，单独 useQuery 拉）。
  const renderSubtitle = (): ReactNode => {
    const wsName = workspace?.name ?? "—";
    if (tab === "quicklog") {
      const n = tabTotals.quicklog;
      return n !== undefined
        ? `${wsName} · ${n} 条快速修复记录`
        : `${wsName} · 快速修复记录`;
    }
    if (tab === "archive") {
      return `${wsName} · 已归档变更`;
    }
    const m = tabTotals.active;
    if (focusMine) {
      const n = total;
      if (m !== undefined) {
        return `${wsName} · ${n} 个变更正在等你处理（共 ${m} 个进行中）`;
      }
      // 首次未拉到 M 时降级（只显示 N）
      return `${wsName} · ${n} 个变更正在等你处理`;
    }
    return `${wsName} · 共 ${total} 个进行中`;
  };

  // 空状态（分场景，对齐原型 ③）
  // task-09 / FR-04a（D-001@v1）：删「+ 新建变更」入口后，进行中空态引导去会话页
  // （/workspaces/[id]/sessions），由 agent 在会话里自动立项并推进；「重新扫描」仍在
  // PageHeader 作全量兜底（FR-04c）。archive 空态不引导（归档无新建语义）。
  const sessionGuide = (
    <div className="mt-3 flex flex-col items-center gap-1.5">
      <span className="text-xs text-muted-foreground">
        还没有进行中的变更。去会话跟 agent 对话，描述你的需求，agent 会自动立项并推进。
      </span>
      <Link
        href={`/workspaces/${workspaceId}/sessions`}
        className={cn(buttonVariants({ variant: "default", size: "sm" }))}
      >
        去会话页
      </Link>
    </div>
  );
  const renderEmpty = (): ReactNode => {
    if (items.length > 0) return null;
    // 有 filter 无匹配 → 简短文案（不显示 CTA，避免误导）
    if (search || stageFilter) {
      return (
        <div className="py-10 text-center text-xs text-muted-foreground">
          没有匹配的变更。
        </div>
      );
    }
    if (tab === "active" && focusMine) {
      return (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <div className="text-[15px] font-medium text-foreground">
            🎉 暂无待你处理的变更
          </div>
          <div className="text-xs text-muted-foreground">
            所有变更都在正常推进，或已全部处理完。
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setFocusMine(false)}
          >
            查看全部进行中
          </Button>
          {sessionGuide}
        </div>
      );
    }
    if (tab === "active" && !focusMine) {
      return (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <div className="text-[15px] font-medium text-foreground">
            当前没有进行中的变更
          </div>
          {sessionGuide}
        </div>
      );
    }
    // archive
    return (
      <div className="py-10 text-center text-[15px] font-medium text-foreground">
        还没有归档的变更
      </div>
    );
  };

  return (
    <PageContainer size="full">
      <PageHeader
        title="变更中心"
        subtitle={renderSubtitle()}
        actions={
          // FR-04c：删「+ 新建变更」后，「重新扫描」保留作全量兜底（含 scoped 不做删除的收敛）
          <Button
            size="sm"
            variant="outline"
            onClick={handleReparse}
            disabled={reparsing}
          >
            {reparsing ? "解析中…" : "重新扫描"}
          </Button>
        }
      />

      {bannerError && <ErrorBanner message={bannerError} />}

      {stats && (
        <div className="rounded border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
          已重新扫描：解析 {stats.parsed}，新增 {stats.created} · 更新{" "}
          {stats.updated} · 删除 {stats.deleted}。
          {warnings.length > 0 && ` ${warnings.length} 个警告。`}
        </div>
      )}

      {warnings.length > 0 && (
        <SectionCard title="解析警告">
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-warning">
            {warnings.map((w, i) => (
              <li key={i}>
                <span className="font-mono">[{w.code}]</span>{" "}
                {w.change_key ?? "—"}: {w.detail}
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {/* 主 tab：进行中 / 已归档（按 location，D-007），挂数量（tabTotals 独立 useQuery 拉） */}
      <div className="flex items-center gap-1">
        {TABS.map((t) => {
          const cnt =
            t.key === "active"
              ? tabTotals.active
              : t.key === "archive"
                ? tabTotals.archive
                : tabTotals.quicklog;
          return (
            <button
              key={t.key}
              onClick={() => handleTabChange(t.key as ChangesTab)}
              className={`border-b-2 pb-1.5 text-xs font-medium transition-colors ${
                tab === t.key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              } mr-3 last:mr-0`}
            >
              {t.label}
              {cnt !== undefined && (
                <span className="ml-1 inline-block min-w-[18px] rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">
                  {cnt}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* task-08（D-001/FR-05）：快速修复 tab——独立查询区（无阶段/聚焦概念）+ QuicklogTable */}
      {tab === "quicklog" && (
        <SectionCard bodyPadding="p-2">
          <QuicklogTable
            workspaceId={workspaceId}
            onSelect={setQuicklogSelected}
          />
        </SectionCard>
      )}

      {/* task-09（FR-06/D-006）：quicklog 条目详情抽屉 */}
      <QuicklogDrawer
        entry={quicklogSelected}
        workspaceId={workspaceId}
        onClose={() => setQuicklogSelected(null)}
      />

      {tab !== "quicklog" && (
      <SectionCard bodyPadding="p-2">
        {/* 工具栏：搜索 + 重置（右对齐，对齐 FRONTEND_PAGE_STYLE §2） */}
        <div className="mb-2 flex items-center justify-end gap-2">
          <Button size="sm" onClick={handleSearchClick}>
            搜索
          </Button>
          <Button size="sm" variant="outline" onClick={handleResetClick}>
            重置
          </Button>
        </div>
        {/* 查询区：进行中 3 格（关键词/阶段/待我处理聚焦）、归档 2 格，消留白
            （task-06 原 grid-cols-4 右半空；ql-20260818-004 聚焦下放第三格） */}
        <div
          className={cn(
            "grid w-full gap-3",
            tab === "active" ? "grid-cols-3" : "grid-cols-2",
          )}
        >
          <Field label="关键词">
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="搜索 Key / 标题 / 组件…"
              allowClear
              onPressEnter={() => handleSearchClick()}
            />
          </Field>
          <Field label="阶段">
            <Select
              value={stageFilter}
              onChange={(v) => setStageFilter(v ?? "")}
              className="w-full"
            >
              {STAGE_OPTIONS.map((opt) => (
                <Select.Option key={opt.value} value={opt.value}>
                  {opt.label}
                </Select.Option>
              ))}
            </Select>
          </Field>
          {/* 聚焦筛选（D-007 → ql-20260818-004 下放查询区）：仅进行中视图，
              默认不勾选；items-end 与左侧 Input/Select 控件底对齐 */}
          {tab === "active" && (
            <div className="flex w-full items-end pb-1.5">
              <Checkbox
                checked={focusMine}
                onChange={(e) => {
                  setFocusMine(e.target.checked);
                  setPage(1);
                }}
              >
                只看待我处理
              </Checkbox>
            </div>
          )}
        </div>
      </SectionCard>
      )}

      {tab !== "quicklog" && (
      <DataTable<ChangeSummary>
        rowKey="id"
        columns={columns}
        dataSource={items}
        loading={loading}
        size="small"
        bordered
        scroll={{ y: "calc(100vh - 430px)" }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p, s) => {
            setPage(p);
            setPageSize(s);
          },
        }}
        // 空态走自定义 ReactNode（分场景 + CTA），透传给 antd Table locale.emptyText
        locale={{ emptyText: renderEmpty() }}
      />
      )}

      {/* task-07：删除确认弹层（受控 target，null = 关闭；确认先关弹层再
          deleteMutation——403/404/409 失败路径走 onError toast，不重开弹层） */}
      {deleteTarget && (
        <DeleteChangeConfirm
          target={deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            const target = deleteTarget;
            setDeleteTarget(null);
            deleteMutation.mutate(target);
          }}
        />
      )}
    </PageContainer>
  );
}
