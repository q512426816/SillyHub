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
 *    quicklog Tab 本任务仅计数 + 空态占位（卡片列表归 task-07 增量续作）；
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
import { MobileFilterDrawer } from "@/components/mobile/mobile-filter-drawer";
import { MobileWorkspaceHeader } from "@/components/mobile/mobile-workspace-header";
import { ApiError } from "@/lib/api";
import { listChanges, type ChangeList, type ChangeSummary } from "@/lib/changes";
import { listQuicklogEntries } from "@/lib/quicklog";
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

  // 任意查询条件（tab/搜索词/阶段/聚焦）变化 → 已加载页数回 1（新条件下重新累积）。
  useEffect(() => {
    setPagesLoaded(1);
  }, [tab, search, stageFilter, focusMine]);

  const handleTabChange = (newTab: ChangesTab) => {
    if (newTab === tab) return;
    setTab(newTab);
  };

  // 搜索提交（对齐桌面 handleSearchClick：同参重查也手动 refetch）
  const handleSearchClick = () => {
    const noChange = searchInput === search;
    setSearch(searchInput);
    if (noChange) void lastQuery?.refetch();
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

  // 空态引导：进行中无变更 → 去移动会话列表（对齐桌面 :443 行为，路由换 /m/ 前缀）
  const sessionGuide = (
    <div className="flex flex-col items-center gap-2 py-6 text-center">
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
        // quicklog Tab 占位（task-07 增量续作卡片列表；本卡仅 Tab 壳 + 计数 + 空态占位）
        <div
          data-testid="m-changes-quicklog-placeholder"
          className="flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-dashed border-border px-4 py-10 text-center"
        >
          <p className="text-[14px] text-foreground">快速修复列表移动版开发中</p>
          <p className="text-xs text-muted-foreground">
            当前共 {tabTotals.quicklog ?? "—"} 条记录，请先在电脑端查看与处理。
          </p>
        </div>
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
    </div>
  );
}
