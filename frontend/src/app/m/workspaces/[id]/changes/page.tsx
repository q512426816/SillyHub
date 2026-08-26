"use client";

/**
 * task-06 · 变更列表移动页（FR-03 / design §5.3 列表页 / §7，D-001@V1 / D-002@V1 /
 * D-004@V1，change 2026-08-26-mobile-workspace-page）。
 *
 * 数据层 100% 复用桌面（禁止复制第二份实现）：
 *  - 主列表 query key 逐字对齐桌面 (dashboard)/workspaces/[id]/changes/page.tsx:149
 *    的 ["changes", workspaceId, { location/search/currentStage/sort/
 *    pendingReviewOnly/page/pageSize }]（含 pendingReviewOnly 仅 active+focusMine
 *    生效），与桌面共享 ["changes"] 失效前缀与缓存；
 *  - 智能轮询复用桌面导出的 changesRefetchInterval（非终态 30s / 全终态停，R-07）；
 *  - Tab 计数 query key 逐字对齐桌面 :209 ["changesTabTotals", workspaceId]
 *    （retry:false / 不轮询 / 不随筛选变化）；
 *  - 工作区数据从 task-02 段 layout Provider（useMobileWorkspace）取，顶栏用
 *    MobileWorkspaceHeader（tab="changes"）。
 *
 * 移动版差异（design §5.3 / §5.5）：
 *  - 三 Tab（active 进行中 / archive 已归档 / quicklog 快速修复）带计数徽标；
 *    quicklog Tab（task-07 增量续作）：listQuicklogEntries + quicklogPollInterval
 *    数据层 100% 复用（零复制实现），卡片点击 MobileDetailSheet 全屏详情
 *    （getQuicklogDetail，对齐原型快速修复屏；桌面 QuicklogDrawer 右抽屉不适配手机）；
 *  - 搜索框 + MobileFilterDrawer（阶段 + 只看待我处理，应用即改 state → key 变化
 *    自动重取；重置对齐桌面 handleResetClick 连搜索词一并清空）；
 *  - 分页不用桌面 Table 分页器，底部「加载更多」递增 page：每页一个独立 query
 *    （key 含 page 与桌面同构，useQueries 组合），已加载页累积渲染；
 *  - 空态引导跳移动会话列表（对齐桌面 :443 行为，路由换 /m/ 前缀）。
 */
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  keepPreviousData,
  useQueries,
  useQuery,
} from "@tanstack/react-query";

import { useMobileWorkspace } from "@/app/m/workspaces/[id]/layout";
// 数据层与轮询纯函数复用桌面既有导出（任务卡约束：禁止复制第二份实现）
import { changesRefetchInterval } from "@/app/(dashboard)/workspaces/[id]/changes/page";
import { MobileCardList } from "@/components/mobile/mobile-card-list";
import { MobileChangeCard } from "@/components/mobile/mobile-change-card";
import { MobileDetailSheet } from "@/components/mobile/mobile-detail-sheet";
import { MobileFilterDrawer } from "@/components/mobile/mobile-filter-drawer";
import { MobileWorkspaceHeader } from "@/components/mobile/mobile-workspace-header";
import { formatRelativeTime } from "@/components/daemon/runtime-card-helpers";
import { StatusBadge } from "@/components/ui/status-badge";
import { ApiError } from "@/lib/api";
import { listChanges, type ChangeList, type ChangeSummary } from "@/lib/changes";
import {
  getQuicklogDetail,
  listQuicklogEntries,
  quicklogPollInterval,
  type QuicklogEntryListItem,
  type QuicklogEntryRead,
} from "@/lib/quicklog";
import { getWorkspace, type Workspace } from "@/lib/workspaces";
import { cn } from "@/lib/utils";

/** Tab 值对齐桌面 page.tsx:52 TABS（三 Tab 语义一致）。 */
type ChangesTab = "active" | "archive" | "quicklog";

/** 三 Tab 配置（顺序即渲染顺序，文案对齐桌面）。 */
const TABS = [
  { key: "active", label: "进行中" },
  { key: "archive", label: "已归档" },
  { key: "quicklog", label: "快速修复" },
] as const;

/**
 * 阶段筛选项：桌面 page.tsx:70 STAGE_OPTIONS 为模块私有（未 export），按任务卡
 * 「模块私有就地内联不 export」在本页内联同值副本（纯展示常量，非数据函数）。
 */
const STAGE_OPTIONS = [
  { value: "", label: "全部阶段" },
  { value: "brainstorm", label: "需求分析" },
  { value: "plan", label: "规划" },
  { value: "execute", label: "执行" },
  { value: "verify", label: "验证" },
  { value: "archive", label: "归档" },
] as const;

/** 排序方向（桌面 page.tsx:80 SortDir 同名同值）。移动版不暴露切换 UI，固定默认值。 */
type SortDir = "updated_at_desc" | "updated_at_asc";
const DEFAULT_SORT: SortDir = "updated_at_desc";

/** 每页条数（与桌面默认 pageSize 一致）。 */
const PAGE_SIZE = 20;

/** 主 load 响应（桌面 page.tsx:113 ChangesPageData 同构：变更分页 + 并发拉取的 workspace）。 */
type ChangesPageData = ChangeList & { workspace: Workspace };

// ── quicklog Tab（task-07 / FR-05）：模块私有展示常量与纯展示组件 ──────────────

/**
 * quicklog 状态徽标 4 态映射（D-007 派生后：completed|in_progress|partial_done|
 * stale）。桌面 quicklog-table STATUS_META 为模块私有未导出——按「模块私有就地内联
 * 不 export」惯例内联同值副本（mobile-change-detail.tsx 已有同款先例）。
 */
const QL_STATUS_META: Record<
  string,
  { label: string; kind: "success" | "warning" | "error" | "info" | "neutral" }
> = {
  completed: { label: "已完成", kind: "success" },
  in_progress: { label: "进行中", kind: "info" },
  partial_done: { label: "已暂存", kind: "warning" },
  stale: { label: "疑似中断", kind: "error" },
};

/** quicklog 详情四段正文渲染顺序固定（桌面 quicklog-drawer BODY_ORDER 同值，design FR-06）。 */
const QL_BODY_ORDER = ["需求", "根因", "方案", "结果"] as const;

/**
 * quicklog 卡片（纯展示，数据由页面 quicklog query 提供）：标题（空壳占位降级）/
 * 状态徽标（4 态映射）/ 作者（owner_name → author_name → author_raw 兜底链，
 * ql-20260818-006 同口径）/ 相对时间。整卡 button 触摸热区 ≥44px（design §5.5）。
 */
function QuicklogCard({
  entry,
  onClick,
}: {
  entry: QuicklogEntryListItem;
  onClick: () => void;
}) {
  const meta =
    QL_STATUS_META[entry.status] ?? {
      label: entry.status,
      kind: "neutral" as const,
    };
  const author =
    entry.owner_name || entry.author_name || entry.author_raw || "—";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`打开快速修复 ${entry.placeholder ? entry.ql_id : entry.title}`}
      data-testid="m-quicklog-card"
      className="flex min-h-[44px] w-full flex-col gap-2 rounded-[var(--radius-lg)] border border-border bg-card p-3 text-left shadow-[var(--shadow-sm)] transition-colors active:border-primary/40 active:bg-muted/50"
    >
      {/* 标题（truncate）+ 相对时间 */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <span
            className="block truncate text-[14px] font-medium text-foreground"
            title={entry.placeholder ? "空壳占位条目" : entry.title}
          >
            {entry.placeholder ? (
              <span className="italic text-muted-foreground">（空壳占位）</span>
            ) : (
              entry.title
            )}
          </span>
          <span
            className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground"
            title={entry.ql_id}
          >
            {entry.ql_id}
          </span>
        </div>
        <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
          {entry.timestamp ? formatRelativeTime(entry.timestamp) : "—"}
        </span>
      </div>
      {/* 状态徽标 + 作者 */}
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge kind={meta.kind}>{meta.label}</StatusBadge>
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {author}
        </span>
      </div>
    </button>
  );
}

/**
 * quicklog 详情内容（MobileDetailSheet children，纯展示）：状态徽标 + 元信息
 * （负责人/时间/来源）+ 四段正文（缺失段省略）+ 文件清单（path + 括注）+
 * 关联变更 chip（点击钻取变更详情路由）+ truncated 节选提示。内容对齐桌面
 * QuicklogDrawer 四段口径（design §5.3「MobileDetailSheet 全屏呈现」）。
 */
function QuicklogDetailContent({
  entry,
  detail,
  loading,
  error,
  onOpenLinkedChange,
}: {
  entry: QuicklogEntryListItem;
  detail: QuicklogEntryRead | null;
  loading: boolean;
  error: string | null;
  /** 关联变更 chip 点击（change_key → 页面解析成变更 id 后钻取详情路由）。 */
  onOpenLinkedChange: (changeKey: string) => void;
}) {
  const meta =
    QL_STATUS_META[entry.status] ?? {
      label: entry.status,
      kind: "neutral" as const,
    };
  const author =
    entry.owner_name || entry.author_name || entry.author_raw || "—";
  const bodySections = detail?.body_sections ?? {};
  const hasBody = QL_BODY_ORDER.some((k) => bodySections[k]);

  return (
    <div className="flex flex-col gap-4">
      {/* 状态 + 元信息（列表条目即时呈现，详情到达后补正文/文件/关联变更） */}
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge kind={meta.kind}>{meta.label}</StatusBadge>
          <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
            {entry.ql_id}
          </span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
          <span>负责人：{author}</span>
          <span>
            时间：
            {entry.timestamp
              ? new Date(entry.timestamp).toLocaleString("zh-CN", {
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "—"}
          </span>
          <span>来源：{entry.source === "pushed" ? "CLI 推送" : "文件同步"}</span>
        </div>
        {entry.status_note ? (
          <p className="text-xs text-muted-foreground">备注：{entry.status_note}</p>
        ) : null}
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-[var(--radius-md)] border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </p>
      ) : null}
      {loading ? (
        <p className="text-xs text-muted-foreground">加载中…</p>
      ) : null}

      {detail ? (
        <>
          {/* 四段正文（缺失段省略，对齐桌面 QuicklogDrawer） */}
          {hasBody ? (
            <div className="flex flex-col gap-3">
              {QL_BODY_ORDER.map((key) =>
                bodySections[key] ? (
                  <section key={key} data-testid={`m-quicklog-body-${key}`}>
                    <h3 className="mb-1 text-xs font-medium text-foreground">
                      {key}
                    </h3>
                    <p className="whitespace-pre-wrap text-xs leading-5 text-foreground">
                      {bodySections[key]}
                    </p>
                  </section>
                ) : null,
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">（暂无正文记录）</p>
          )}

          {/* 文件清单（path + 括注） */}
          <section data-testid="m-quicklog-files">
            <h3 className="mb-1 text-xs font-medium text-foreground">
              变更文件（{detail.files.length}）
            </h3>
            {detail.files.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {detail.files.map((f) => (
                  <li
                    key={f.path}
                    className="break-all font-mono text-[11px] leading-5 text-foreground"
                  >
                    {f.path}
                    {f.note ? (
                      <span className="ml-1 font-sans text-[11px] text-muted-foreground">
                        （{f.note}）
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">（无）</p>
            )}
          </section>

          {/* 关联变更 chip → 钻取变更详情路由（change_key 由页面解析成 id 后跳转） */}
          <section data-testid="m-quicklog-linked">
            <h3 className="mb-1 text-xs font-medium text-foreground">
              关联变更（{detail.linked_changes.length}）
            </h3>
            {detail.linked_changes.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {detail.linked_changes.map((c) => (
                  <button
                    key={c}
                    type="button"
                    data-testid="m-quicklog-linked-chip"
                    title={c}
                    onClick={() => onOpenLinkedChange(c)}
                    className="inline-flex min-h-[44px] max-w-full items-center rounded-full border border-primary/40 bg-primary/10 px-3 text-[12px] text-primary transition-colors hover:bg-primary/20"
                  >
                    <span className="truncate font-mono">{c}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">（无）</p>
            )}
          </section>

          {detail.truncated ? (
            <p className="text-[11px] text-muted-foreground">
              原始文件超出读取上限，以上内容为节选。
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export default function MobileChangesPage() {
  const { workspaceId, workspace } = useMobileWorkspace();
  const router = useRouter();

  // ── 查询条件 state（语义对齐桌面：搜索词输入/提交分离、聚焦仅进行中视图）────
  const [tab, setTab] = useState<ChangesTab>("active");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [focusMine, setFocusMine] = useState(false);
  // 「加载更多」已加载页数（递增 page；任意查询条件变化回 1）
  const [pagesLoaded, setPagesLoaded] = useState(1);
  // 筛选抽屉草稿态：打开时从生效值拷贝，「确定」才落到查询 state
  const [filterOpen, setFilterOpen] = useState(false);
  const [draftStage, setDraftStage] = useState("");
  const [draftFocusMine, setDraftFocusMine] = useState(false);
  // quicklog Tab（task-07 / FR-05）：选中条目即详情 Sheet 的 openId（null = 关闭）
  const [quicklogSelected, setQuicklogSelected] =
    useState<QuicklogEntryListItem | null>(null);

  // 主列表分页 query key（page 槽位变化即新查询，形态逐字对齐桌面 page.tsx:149）。
  // 就地拼数组（不经 queryKeys 工厂）：桌面同 key 就是就地字面量，工厂化反而制造
  // 两个"权威来源"漂移面——与桌面逐字一致是本页硬约束。
  const pageQueryKey = (page: number) =>
    [
      "changes",
      workspaceId,
      {
        location: tab,
        search,
        currentStage: stageFilter,
        sort: DEFAULT_SORT,
        // D-007：进行中 + 聚焦 → 只看待我处理（pending_review 非空）
        pendingReviewOnly: tab === "active" && focusMine,
        page,
        pageSize: PAGE_SIZE,
      },
    ] as const;

  // ── 主列表：useQueries 组合「加载更多」的 1..pagesLoaded 页 ──────────────────
  // 每页一个独立 query（key 含 page 与桌面同构、共享 ["changes"] 失效前缀），
  // 已加载页累积渲染；refetchInterval 复用桌面 changesRefetchInterval（每页独立
  // 决策，全终态该页停轮；react-query 默认后台窗口失焦不轮询，R-07）。
  const pageQueries = useQueries({
    queries: Array.from({ length: pagesLoaded }, (_, idx) => {
      const page = idx + 1;
      return {
        queryKey: pageQueryKey(page),
        // queryFn 与桌面同构：listChanges 全参 + getWorkspace 的 Promise.all
        queryFn: async (): Promise<ChangesPageData> => {
          const [resp, ws] = await Promise.all([
            listChanges(workspaceId, {
              location: tab,
              search: search || undefined,
              currentStage: stageFilter || undefined,
              sort: DEFAULT_SORT,
              pendingReviewOnly: tab === "active" && focusMine,
              page,
              pageSize: PAGE_SIZE,
            }),
            getWorkspace(workspaceId),
          ]);
          return { ...resp, workspace: ws };
        },
        // quicklog Tab 不发变更列表请求（桌面 :179 同义；卡片列表归 task-07）
        enabled: tab !== "quicklog",
        // 筛选/加载更多切 key 时保留上一份数据渲染（桌面 :182 同款，不闪空表）
        placeholderData: keepPreviousData,
        refetchInterval: (query: {
          state: { data?: ChangesPageData | undefined };
        }) => changesRefetchInterval(query.state.data),
      };
    }),
  });

  const lastQuery = pageQueries[pageQueries.length - 1];
  const items = pageQueries.flatMap((q) => q.data?.items ?? []);
  const total = lastQuery?.data?.total ?? 0;
  const loading = tab !== "quicklog" && (lastQuery?.isPending ?? false);
  const listError =
    tab !== "quicklog" && lastQuery?.isError
      ? lastQuery.error instanceof ApiError
        ? lastQuery.error.message
        : "加载变更列表失败"
      : null;

  // ── Tab 计数（key 逐字对齐桌面 :209；不随筛选变化、不轮询、失败静默）────────
  const tabTotalsQuery = useQuery({
    queryKey: ["changesTabTotals", workspaceId],
    queryFn: async (): Promise<{
      active: number;
      archive: number;
      quicklog: number;
    }> => {
      const [a, b, q] = await Promise.all([
        listChanges(workspaceId, { location: "active", pageSize: 1 }),
        listChanges(workspaceId, { location: "archive", pageSize: 1 }),
        listQuicklogEntries(workspaceId, {
          include_placeholder: true,
          page_size: 1,
        }),
      ]);
      return { active: a.total, archive: b.total, quicklog: q.total };
    },
    retry: false,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });
  const tabTotals: { active?: number; archive?: number; quicklog?: number } =
    tabTotalsQuery.data ?? {};

  // ── quicklog Tab 列表（task-07 / FR-05）────────────────────────────────────
  // 数据层 100% 复用 lib/quicklog.ts 既有函数（零复制实现）；key 结构对齐桌面
  // QuicklogTable 默认形态（["quicklogEntries", ws, { search/status/author/
  // showPlaceholder/page/pageSize }]——移动端无状态/负责人筛选，固定默认槽位值），
  // 与桌面共享缓存与失效前缀；search 与页内搜索词联动（tab 内共享 search state）。
  const quicklogListQuery = useQuery({
    queryKey: [
      "quicklogEntries",
      workspaceId,
      {
        search,
        status: "",
        author: "",
        showPlaceholder: true,
        page: 1,
        pageSize: PAGE_SIZE,
      },
    ],
    queryFn: () =>
      listQuicklogEntries(workspaceId, {
        search: search || undefined,
        include_placeholder: true,
        page: 1,
        page_size: PAGE_SIZE,
      }),
    enabled: tab === "quicklog",
    placeholderData: keepPreviousData,
    // FR-05 轮询语义复用：refetchInterval 直传 quicklogPollInterval(items)
    // 返回值（存在 in_progress|stale → 30s、全终态 false，lib/quicklog.ts:49）
    refetchInterval: (query) =>
      quicklogPollInterval(query.state.data?.items ?? []),
  });
  const quicklogItems = quicklogListQuery.data?.items ?? [];
  const quicklogLoading = tab === "quicklog" && quicklogListQuery.isPending;
  const quicklogError =
    tab === "quicklog" && quicklogListQuery.isError
      ? quicklogListQuery.error instanceof ApiError
        ? quicklogListQuery.error.message
        : "加载快速修复列表失败"
      : null;

  // ── quicklog 详情（Sheet 打开时拉取；key 对齐桌面 QuicklogDrawer 共享缓存）──
  const quicklogDetailQuery = useQuery({
    queryKey: ["quicklogDetail", workspaceId, quicklogSelected?.ql_id],
    queryFn: () => getQuicklogDetail(workspaceId, quicklogSelected!.ql_id),
    enabled: Boolean(quicklogSelected),
  });

  // 任意查询条件（tab/搜索词/阶段/聚焦）变化 → 已加载页数回 1（新条件下重新累积）。
  useEffect(() => {
    setPagesLoaded(1);
  }, [tab, search, stageFilter, focusMine]);

  const handleTabChange = (newTab: ChangesTab) => {
    if (newTab === tab) return;
    setTab(newTab);
  };

  // 搜索提交（对齐桌面 handleSearchClick：同参重查也手动 refetch——按当前 Tab
  // 重查对应列表：quicklog Tab 查 quicklog query，否则查主列表末页 query）
  const handleSearchClick = () => {
    const noChange = searchInput === search;
    setSearch(searchInput);
    if (noChange) {
      void (tab === "quicklog"
        ? quicklogListQuery.refetch()
        : lastQuery?.refetch());
    }
  };

  // ── 筛选抽屉（受控开关 + 草稿态）──────────────────────────────────────────
  const handleFilterOpenChange = (open: boolean) => {
    if (open) {
      // 打开时从生效值拷贝草稿，取消（不点确定）不污染生效筛选
      setDraftStage(stageFilter);
      setDraftFocusMine(focusMine);
    }
    setFilterOpen(open);
  };
  // 「确定」：草稿落生效 state → key 变化自动重取（聚焦仅进行中视图语义生效）
  const handleFilterApply = () => {
    setStageFilter(draftStage);
    if (tab === "active") setFocusMine(draftFocusMine);
  };
  // 「重置」对齐桌面 handleResetClick：搜索词/阶段/聚焦全部回默认（page 经 effect 回 1）
  const handleFilterReset = () => {
    setSearchInput("");
    setSearch("");
    setStageFilter("");
    setFocusMine(false);
    setDraftStage("");
    setDraftFocusMine(false);
  };

  // quicklog 关联变更 chip → 钻取变更详情路由：linked_changes 存的是 change_key，
  // 而详情路由段 [cid] 要变更 id（后端 GET /changes/{id} 仅收 UUID），经
  // listChanges(search=key) 复用解析（精确 change_key 命中优先）；解析不到静默
  // 留在当前页（关联变更可能已删除，桌面抽屉跳 ?search= 同为列表兜底语义）。
  const handleOpenLinkedChange = async (changeKey: string) => {
    try {
      const resp = await listChanges(workspaceId, {
        search: changeKey,
        pageSize: 5,
      });
      const hit =
        resp.items.find((c) => c.change_key === changeKey) ?? null;
      if (hit) {
        router.push(`/m/workspaces/${workspaceId}/changes/${hit.id}`);
      }
    } catch {
      /* 解析失败静默 */
    }
  };

  // 空态引导：进行中无变更 → 去移动会话列表（对齐桌面 :443 行为，路由换 /m/ 前缀）
  const sessionGuide = (    <div className="flex flex-col items-center gap-2 py-6 text-center">
      <p className="text-xs leading-relaxed text-muted-foreground">
        还没有进行中的变更。去会话跟 agent 对话，描述你的需求，agent
        会自动立项并推进。
      </p>
      <button
        type="button"
        data-testid="m-changes-empty-guide"
        onClick={() => router.push(`/m/workspaces/${workspaceId}/sessions`)}
        className="inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-md)] bg-primary px-4 text-[14px] font-medium text-primary-foreground transition-colors hover:opacity-90"
      >
        去会话页
      </button>
    </div>
  );

  // 空态分场景（对齐桌面 renderEmpty：有筛选无匹配短文案 / active 聚焦 / active / archive）
  const renderEmpty = (): ReactNode => {
    if (search || stageFilter) {
      return (
        <p className="py-10 text-center text-[14px] text-muted-foreground">
          没有匹配的变更。
        </p>
      );
    }
    if (tab === "active" && focusMine) {
      return (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <p className="text-[15px] font-medium text-foreground">
            🎉 暂无待你处理的变更
          </p>
          <p className="text-xs text-muted-foreground">
            所有变更都在正常推进，或已全部处理完。
          </p>
          <button
            type="button"
            onClick={() => setFocusMine(false)}
            className="inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-md)] border border-border bg-card px-4 text-[14px] text-foreground transition-colors hover:bg-muted"
          >
            查看全部进行中
          </button>
          {sessionGuide}
        </div>
      );
    }
    if (tab === "active") {
      return (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <p className="text-[15px] font-medium text-foreground">
            当前没有进行中的变更
          </p>
          {sessionGuide}
        </div>
      );
    }
    // archive
    return (
      <p className="py-10 text-center text-[15px] font-medium text-foreground">
        还没有归档的变更
      </p>
    );
  };

  // quicklog Tab 空态（对齐桌面 QuicklogTable renderEmpty 两分场景）
  const renderQuicklogEmpty = (): ReactNode =>
    search ? (
      <p className="py-10 text-center text-[14px] text-muted-foreground">
        没有匹配的快速修复记录。
      </p>
    ) : (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <p className="text-[15px] font-medium text-foreground">
          还没有快速修复记录
        </p>
        <p className="text-xs text-muted-foreground">
          在仓库跑 sillyspec quick 后，条目会实时出现在这里（CLI 推送 +
          文件同步双链路）。
        </p>
      </div>
    );

  const hasMore = items.length < total;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {/* 顶栏：task-04 MobileWorkspaceHeader（工作区数据来自 task-02 layout Provider；
          预取未完成时渲染轻量占位，不阻塞下方 Tab/列表渲染） */}
      {workspace ? (
        <MobileWorkspaceHeader
          workspace={workspace}
          tab="changes"
          onTabChange={(t) => {
            if (t === "sessions") {
              router.push(`/m/workspaces/${workspaceId}/sessions`);
            }
          }}
          onBack={() => router.push("/m/workspaces")}
        />
      ) : (
        <div
          data-testid="m-changes-header-fallback"
          className="sticky top-0 z-30 -mx-4 -mt-3 border-b border-border bg-card px-4 py-3 text-[14px] text-muted-foreground"
        >
          工作区加载中…
        </div>
      )}

      {/* 三 Tab + 计数徽标（tabTotals 独立 useQuery，不随筛选变化） */}
      <div
        role="tablist"
        aria-label="变更视图切换"
        className="flex items-center gap-1"
      >
        {TABS.map((t) => {
          const cnt =
            t.key === "active"
              ? tabTotals.active
              : t.key === "archive"
                ? tabTotals.archive
                : tabTotals.quicklog;
          const selected = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={selected}
              data-testid={`m-changes-tab-${t.key}`}
              onClick={() => handleTabChange(t.key)}
              className={cn(
                "inline-flex min-h-[44px] flex-1 items-center justify-center gap-1 border-b-2 text-[14px] font-medium transition-colors",
                selected
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              {cnt !== undefined && (
                <span className="inline-block min-w-[18px] rounded-full bg-muted px-1.5 text-[11px] leading-[18px] text-muted-foreground">
                  {cnt}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {tab === "quicklog" ? (
        // ── 快速修复 Tab（task-07 / FR-05）：搜索与页内搜索词联动；无阶段/聚焦
        //    概念不挂筛选抽屉；卡片点击 MobileDetailSheet 全屏详情 ──────────────
        <>
          <div className="flex items-center gap-2">
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearchClick();
              }}
              placeholder="搜索标题 / 正文全文…"
              aria-label="搜索快速修复"
              data-testid="m-quicklog-search-input"
              className="min-h-[44px] min-w-0 flex-1 rounded-[var(--radius-md)] border border-border bg-card px-3 text-[14px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50"
            />
            <button
              type="button"
              onClick={handleSearchClick}
              className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-border bg-card px-3 text-[14px] text-foreground transition-colors hover:bg-muted"
            >
              搜索
            </button>
          </div>

          {quicklogError ? (
            <p
              role="alert"
              className="rounded-[var(--radius-md)] border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {quicklogError}
            </p>
          ) : null}

          {quicklogLoading ? (
            <p
              data-testid="m-quicklog-loading"
              className="py-10 text-center text-[14px] text-muted-foreground"
            >
              加载中…
            </p>
          ) : quicklogItems.length > 0 ? (
            <MobileCardList
              items={quicklogItems}
              itemKey={(it) => it.ql_id}
              renderCard={(it) => (
                <QuicklogCard
                  entry={it}
                  onClick={() => setQuicklogSelected(it)}
                />
              )}
            />
          ) : (
            renderQuicklogEmpty()
          )}
        </>
      ) : (
        <>
          {/* 工具栏：搜索框 + 筛选抽屉入口（阶段 / 只看待我处理收进抽屉） */}
          <div className="flex items-center gap-2">
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearchClick();
              }}
              placeholder="搜索 Key / 标题 / 组件…"
              aria-label="搜索变更"
              data-testid="m-changes-search-input"
              className="min-h-[44px] min-w-0 flex-1 rounded-[var(--radius-md)] border border-border bg-card px-3 text-[14px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50"
            />
            <button
              type="button"
              onClick={handleSearchClick}
              className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-border bg-card px-3 text-[14px] text-foreground transition-colors hover:bg-muted"
            >
              搜索
            </button>
            <MobileFilterDrawer
              open={filterOpen}
              onOpenChange={handleFilterOpenChange}
              onApply={handleFilterApply}
              onReset={handleFilterReset}
            >
              {/* 阶段选择（单选 chips，对齐原型筛选抽屉屏） */}
              <p className="mb-2 text-xs text-muted-foreground">阶段</p>
              <div className="mb-4 flex flex-wrap gap-2">
                {STAGE_OPTIONS.map((opt) => {
                  const active = draftStage === opt.value;
                  return (
                    <button
                      key={opt.value || "all"}
                      type="button"
                      aria-pressed={active}
                      data-testid={`m-changes-stage-chip-${opt.value || "all"}`}
                      onClick={() => setDraftStage(opt.value)}
                      className={cn(
                        "inline-flex min-h-[38px] items-center justify-center rounded-full border px-3.5 text-[13px] transition-colors",
                        active
                          ? "border-primary bg-primary/10 font-medium text-primary"
                          : "border-border bg-card text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              {/* 只看待我处理（仅进行中视图，对齐桌面 ql-20260818-004 查询条件） */}
              {tab === "active" && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={draftFocusMine}
                  data-testid="m-changes-focusmine-toggle"
                  onClick={() => setDraftFocusMine((v) => !v)}
                  className="flex min-h-[44px] w-full items-center justify-between rounded-[var(--radius-md)] border border-border bg-card px-3 text-[14px] text-foreground"
                >
                  <span>只看待我处理</span>
                  <span
                    aria-hidden
                    className={cn(
                      "inline-flex h-6 w-11 items-center rounded-full px-0.5 transition-colors",
                      draftFocusMine ? "bg-primary" : "bg-muted",
                    )}
                  >
                    <span
                      className={cn(
                        "h-5 w-5 rounded-full bg-card shadow-[var(--shadow-sm)] transition-transform",
                        draftFocusMine && "translate-x-5",
                      )}
                    />
                  </span>
                </button>
              )}
            </MobileFilterDrawer>
          </div>

          {listError ? (
            <p
              role="alert"
              className="rounded-[var(--radius-md)] border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {listError}
            </p>
          ) : null}

          {loading ? (
            <p
              data-testid="m-changes-loading"
              className="py-10 text-center text-[14px] text-muted-foreground"
            >
              加载中…
            </p>
          ) : items.length > 0 ? (
            <>
              <MobileCardList
                items={items}
                renderCard={(c) => (
                  <MobileChangeCard
                    change={c}
                    onClick={() =>
                      router.push(
                        `/m/workspaces/${workspaceId}/changes/${c.id}`,
                      )
                    }
                  />
                )}
              />
              {hasMore && (
                <button
                  type="button"
                  data-testid="m-changes-load-more"
                  onClick={() => setPagesLoaded((n) => n + 1)}
                  className="inline-flex min-h-[44px] w-full items-center justify-center rounded-[var(--radius-md)] border border-border bg-card text-[14px] text-foreground transition-colors hover:bg-muted"
                >
                  加载更多（已显示 {items.length} / 共 {total} 条）
                </button>
              )}
            </>
          ) : (
            renderEmpty()
          )}
        </>
      )}

      {/* quicklog 详情全屏 Sheet（task-07 / FR-05，对齐原型快速修复屏）：纯展示
          场景 submitText 用「关闭」、onSubmit 复用 onClose；children 渲染
          getQuicklogDetail 内容（状态/正文/文件列表/关联变更 chip 钻取变更详情） */}
      <MobileDetailSheet
        open={Boolean(quicklogSelected)}
        title={
          quicklogSelected
            ? quicklogSelected.placeholder
              ? "（空壳占位）"
              : quicklogSelected.title
            : ""
        }
        onClose={() => setQuicklogSelected(null)}
        onSubmit={() => setQuicklogSelected(null)}
        submitText="关闭"
      >
        {quicklogSelected ? (
          <QuicklogDetailContent
            entry={quicklogSelected}
            detail={quicklogDetailQuery.data ?? null}
            loading={quicklogDetailQuery.isPending}
            error={
              quicklogDetailQuery.isError
                ? quicklogDetailQuery.error instanceof ApiError
                  ? quicklogDetailQuery.error.message
                  : "加载快速修复详情失败"
                : null
            }
            onOpenLinkedChange={(changeKey) => {
              void handleOpenLinkedChange(changeKey);
            }}
          />
        ) : null}
      </MobileDetailSheet>
    </div>
  );
}
