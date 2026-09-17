/**
 * task-06 · 变更列表移动页单测（FR-03 / design §5.3 / §7，
 * change 2026-08-26-mobile-workspace-page）。
 *
 * 覆盖任务卡指定契约：
 *  1. 主列表 query key 逐字对齐桌面 (dashboard)/…/changes/page.tsx:149
 *     （["changes", workspaceId, { location/search/currentStage/sort/
 *     pendingReviewOnly/page/pageSize }]，含 pendingReviewOnly 仅 active+focusMine）；
 *  2. Tab 计数 query key 逐字为桌面 :209 ["changesTabTotals", workspaceId]（三计数）；
 *  3. tab 切换（archive → location=archive 重取）+ 计数徽标渲染；
 *  4. 筛选抽屉：阶段应用进 key 与请求、重置回默认（对齐桌面 handleResetClick）、
 *     只看待我处理（active 生效 / archive 不渲染开关）；
 *  5. 搜索提交进请求与 key；
 *  6. changesRefetchInterval 接线（缓存条目 options.refetchInterval：全终态 false /
 *     非终态 30000 / 无数据 false）；
 *  7. 卡片点击钻取 /m/workspaces/[id]/changes/[cid]；
 *  8. 空态引导跳移动会话列表；
 *  9. quicklog Tab（task-07 增量续作）：卡片列表渲染（listQuicklogEntries 全参）、
 *     quicklogPollInterval 接线（in_progress|stale → 30000 / 全终态 false）、
 *     搜索词联动、点击卡片 MobileDetailSheet 全屏详情（getQuicklogDetail 内容 +
 *     「关闭」submitText）、关联变更 chip 经 listChanges(search) 解析 id 后钻取；
 * 10. 「加载更多」递增 page 追加第二页（key 含 page 槽位与桌面同构）。
 * 11. task-08（FR-01）：重新扫描成功反馈条（文案与桌面 :701-720 逐字一致）+
 *     警告卡（[code] change_key: detail）+ 失效 ["changes", ws] 前缀 +
 *     ApiError 中文兜底 / 非 ApiError 兜底「重新解析失败」+ 解析中 disabled 防重入；
 * 12. task-08（FR-03）：筛选抽屉排序 chip 切「↑ 最早优先」→ sort=updated_at_asc
 *     进请求与 key；?tab=quicklog / ?search= URL 初始化（非法 tab 回 active）；
 *     R-03 断言：默认参数下主列表 / quicklog key 槽位与桌面逐字同构（字面量
 *     key 精确命中缓存即证 hash 相等，sortDir / status·author·showPlaceholder
 *     默认真值与改造前逐字一致，AC-03 兼容基线）；
 * 13. task-08（FR-04）：quicklog 筛选抽屉状态 chip（status=stale 进 key 与请求）、
 *     作者聚合口径（owner_name→author_name→author_raw 去重，对齐桌面
 *     quicklog-table.tsx:197-203）+ 作者 chip 筛选、占位开关关闭收窄
 *     （include_placeholder 不带参）、重置全部回默认（占位回 true）。
 *
 * mock 范式对齐 layout.m-workspace-id.test / quicklog-drawer.test：
 * importActual 部分 mock（@/lib/changes 只换 listChanges、@/lib/workspaces 只换
 * getWorkspace、@/lib/quicklog 只换 listQuicklogEntries）+ 真实 QueryClient
 * （断言缓存落键需要真实缓存）；next/navigation mock useRouter push/replace。
 * changesRefetchInterval 不 mock——页面 import 桌面真实导出，接线断言直接调
 * 缓存条目上的 options.refetchInterval 锁「复用而非复制」。
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── next/navigation mock：useRouter 提供 push/replace spy ────────────────────
// task-08（FR-03）：searchParams 升为可变槽位（桌面测试 mocks.searchParams 同款
// 范式）——URL 参数用例按需覆写 nav.searchParams，beforeEach 重置回空参数；
// 既有用例默认无参数行为不变
const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  searchParams: new URLSearchParams(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  // task-04（2026-09-16-mobile-changes-parity）：页面新增 ?tab=/?search= URL
  // 初始化消费 useSearchParams（对齐桌面 :230-239 与桌面测试 :72-73 范式）——
  // mock 补空 URLSearchParams 接线，既有用例默认无参数行为不变（仅 mock 接线，
  // 不改既有用例断言语义；task-08 补 URL 参数用例时按用例覆写）
  useSearchParams: () => nav.searchParams,
}));

// ── 数据层部分 mock（保留 actual，仅替换页面用到的请求函数）──────────────────
// task-08（FR-01）：补 reparseChanges mock 接线——页面 handleReparse 消费该函数，
// 不 mock 会发真请求；既有用例不触发重新扫描，行为不变
const changesApi = vi.hoisted(() => ({
  listChanges: vi.fn(),
  reparseChanges: vi.fn(),
}));
vi.mock("@/lib/changes", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/changes")>("@/lib/changes");
  return {
    ...actual,
    listChanges: changesApi.listChanges,
    reparseChanges: changesApi.reparseChanges,
  };
});

const workspacesApi = vi.hoisted(() => ({ getWorkspace: vi.fn() }));
vi.mock("@/lib/workspaces", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/workspaces")>(
      "@/lib/workspaces",
    );
  return { ...actual, getWorkspace: workspacesApi.getWorkspace };
});

const quicklogApi = vi.hoisted(() => ({
  listQuicklogEntries: vi.fn(),
  getQuicklogDetail: vi.fn(),
}));
vi.mock("@/lib/quicklog", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/quicklog")>("@/lib/quicklog");
  return {
    ...actual,
    listQuicklogEntries: quicklogApi.listQuicklogEntries,
    getQuicklogDetail: quicklogApi.getQuicklogDetail,
  };
});

// task-09（2026-09-04-conflict-resolve-entry）：新挂载的 PlatformSyncSection 数据源
// mock 接线——工作区未绑定（fetchMyBinding → null）→ 组件渲染 null 且不发机器查询，
// 页面行为与挂载前一致（仅 mock 接线，不改既有用例断言语义）
const bindingApi = vi.hoisted(() => ({ fetchMyBinding: vi.fn() }));
vi.mock("@/lib/workspace-binding", () => ({
  fetchMyBinding: bindingApi.fetchMyBinding,
}));

import MobileChangesPage from "@/app/m/workspaces/[id]/changes/page";
import { MobileWorkspaceContext } from "@/app/m/workspaces/[id]/layout";
import { ApiError } from "@/lib/api";
import type { ChangeList, ChangeSummary } from "@/lib/changes";
import type {
  QuicklogEntryListItem,
  QuicklogEntryRead,
} from "@/lib/quicklog";
import type { Workspace } from "@/lib/workspaces";

// ── fixtures ────────────────────────────────────────────────────────────────

function makeWorkspace(id = "ws-1"): Workspace {
  return {
    id,
    name: `workspace-${id}`,
    slug: `workspace-${id}`,
    root_path: "C:/proj",
    status: "active",
    default_agent: null,
    default_model: null,
    owner: { user_id: "user-1", email: "owner@test.com", display_name: "Owner" },
    created_at: "2026-06-30T00:55:11Z",
    last_scanned_at: "2026-06-30T00:55:11Z",
  } as unknown as Workspace;
}

function makeChange(
  id: string,
  overrides: Partial<ChangeSummary> = {},
): ChangeSummary {
  return {
    id,
    change_key: `2026-08-26-key-${id}`,
    title: `变更 ${id}`,
    status: "in_progress",
    location: "active",
    change_type: null,
    affected_components: [],
    owner_id: null,
    current_stage: "execute",
    pending_review: null,
    step_progress: null,
    owner_name: null,
    updated_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    ...overrides,
  };
}

function makeList(items: ChangeSummary[], total = items.length): ChangeList {
  return { items, total };
}

// ── quicklog fixtures（task-07）──────────────────────────────────────────────

function makeQl(
  qlId: string,
  overrides: Partial<QuicklogEntryListItem> = {},
): QuicklogEntryListItem {
  return {
    ql_id: qlId,
    timestamp: new Date(Date.now() - 5 * 60_000).toISOString(),
    title: `修复 ${qlId}`,
    status: "completed",
    status_note: null,
    placeholder: false,
    author_raw: "author-raw-1",
    author_name: "author-1",
    owner_name: "owner-1",
    linked_changes: [],
    files: [],
    affected_modules: [],
    source: "file",
    ...overrides,
  };
}

function makeQlList(items: QuicklogEntryListItem[], total = items.length) {
  return { items, total };
}

function makeQlDetail(
  overrides: Partial<QuicklogEntryRead> = {},
): QuicklogEntryRead {
  return {
    ql_id: "ql-1",
    timestamp: "2026-08-26T15:04:00Z",
    title: "修复登录白屏",
    status: "completed",
    status_note: null,
    placeholder: false,
    author_raw: "author-raw-1",
    author_name: "author-1",
    owner_name: null,
    linked_changes: ["2026-08-26-mobile-workspace-page"],
    files: [{ path: "src/app/page.tsx", note: "根因所在" }],
    affected_modules: ["frontend"],
    source: "file",
    body_sections: { 需求: "登录偶发白屏", 方案: "调整守卫顺序" },
    raw_block: "## raw",
    truncated: false,
    ...overrides,
  };
}

/** 主列表第一页 key（逐字对齐桌面 page.tsx:149 槽位结构）。 */
function mainKey(overrides: Record<string, unknown> = {}) {
  return [
    "changes",
    "ws-1",
    {
      location: "active",
      search: "",
      currentStage: "",
      sort: "updated_at_desc",
      pendingReviewOnly: false,
      page: 1,
      pageSize: 20,
      ...overrides,
    },
  ];
}

/** quicklog 列表 key（对齐桌面 QuicklogTable 默认形态槽位结构）。 */
function quicklogKey(overrides: Record<string, unknown> = {}) {
  return [
    "quicklogEntries",
    "ws-1",
    {
      search: "",
      status: "",
      author: "",
      showPlaceholder: true,
      page: 1,
      pageSize: 20,
      ...overrides,
    },
  ];
}

describe("m/workspaces/[id]/changes 变更列表移动页", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    // task-09：PlatformSyncSection 数据源——未绑定（null）即组件不渲染
    bindingApi.fetchMyBinding.mockResolvedValue(null);
    // 默认数据面：active 2 条 / archive 0 条 / quicklog 3 条
    changesApi.listChanges.mockImplementation(
      async (_ws: string, params?: { location?: string; page?: number }) => {
        if (params?.page) {
          return makeList([makeChange("c1"), makeChange("c2")], 2);
        }
        // Tab 计数探测调用（pageSize:1、无 page 参数）
        if (params?.location === "archive") return makeList([], 0);
        return makeList([], 2);
      },
    );
    quicklogApi.listQuicklogEntries.mockResolvedValue(makeList([], 3));
    quicklogApi.getQuicklogDetail.mockResolvedValue(makeQlDetail());
    workspacesApi.getWorkspace.mockResolvedValue(makeWorkspace());
    // task-08（FR-01）：重新扫描默认成功零警告（用例按需覆写）
    changesApi.reparseChanges.mockResolvedValue({
      workspace_id: "ws-1",
      stats: { parsed: 0, created: 0, updated: 0, deleted: 0 },
      warnings: [],
    });
    // task-08（FR-03）：URL 参数槽位每用例重置回空（用例内覆写生效不串扰）
    nav.searchParams = new URLSearchParams();
    nav.push.mockReset();
    nav.replace.mockReset();
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.clearAllMocks();
  });

  function renderPage() {
    return render(
      <QueryClientProvider client={queryClient}>
        <MobileWorkspaceContext.Provider
          value={{
            workspaceId: "ws-1",
            workspace: makeWorkspace(),
            isLoading: false,
            error: null,
          }}
        >
          <MobileChangesPage />
        </MobileWorkspaceContext.Provider>
      </QueryClientProvider>,
    );
  }

  it("主列表 query key 逐字对齐桌面 page.tsx:149（全参槽位）且请求全参", async () => {
    renderPage();
    await waitFor(() => {
      expect(
        queryClient.getQueryData(mainKey()),
      ).toBeTruthy();
    });
    // queryFn 与桌面同构：listChanges 全参（search/currentStage 空串转 undefined）
    expect(changesApi.listChanges).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        location: "active",
        sort: "updated_at_desc",
        pendingReviewOnly: false,
        page: 1,
        pageSize: 20,
      }),
    );
  });

  it("Tab 计数 query key 逐字为 [changesTabTotals, workspaceId]，三计数落缓存并渲染徽标", async () => {
    renderPage();
    await waitFor(() => {
      expect(
        queryClient.getQueryData(["changesTabTotals", "ws-1"]),
      ).toEqual({ active: 2, archive: 0, quicklog: 3 });
    });
    expect(
      screen.getByTestId("m-changes-tab-quicklog").textContent,
    ).toContain("3");
  });

  it("tab 切换：点已归档 → location=archive 重取且落桌面同构 key", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("变更 c1")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("m-changes-tab-archive"));
    await waitFor(() => {
      expect(changesApi.listChanges).toHaveBeenCalledWith(
        "ws-1",
        expect.objectContaining({ location: "archive" }),
      );
    });
    await waitFor(() => {
      expect(
        queryClient.getQueryData(
          mainKey({ location: "archive" }),
        ),
      ).toBeTruthy();
    });
  });

  it("筛选抽屉：阶段应用 → currentStage 进 key 与请求；重置回默认（对齐桌面 handleResetClick）", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("变更 c1")).toBeInTheDocument();
    });
    // 打开抽屉 → 选「规划」→ 确定
    fireEvent.click(screen.getByTestId("mobile-filter-trigger"));
    expect(await screen.findByTestId("mobile-filter-body")).toBeVisible();
    fireEvent.click(screen.getByTestId("m-changes-stage-chip-plan"));
    fireEvent.click(screen.getByTestId("mobile-filter-apply"));
    await waitFor(() => {
      expect(changesApi.listChanges).toHaveBeenCalledWith(
        "ws-1",
        expect.objectContaining({ currentStage: "plan" }),
      );
    });
    await waitFor(() => {
      expect(
        queryClient.getQueryData(mainKey({ currentStage: "plan" })),
      ).toBeTruthy();
    });
    // 重置：阶段/聚焦/搜索词全部回默认 → key 回默认形态重取
    fireEvent.click(screen.getByTestId("mobile-filter-trigger"));
    await screen.findByTestId("mobile-filter-body");
    fireEvent.click(screen.getByTestId("mobile-filter-reset"));
    await waitFor(() => {
      expect(
        queryClient.getQueryData(mainKey()),
      ).toBeTruthy();
    });
    // 重置对齐桌面 handleResetClick：搜索词一并清空（草稿与生效值）
    expect(screen.getByTestId("m-changes-search-input")).toHaveValue("");
  });

  it("只看待我处理：active 应用 → pendingReviewOnly=true 进 key；archive tab 不渲染聚焦开关", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("变更 c1")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("mobile-filter-trigger"));
    await screen.findByTestId("mobile-filter-body");
    fireEvent.click(screen.getByTestId("m-changes-focusmine-toggle"));
    fireEvent.click(screen.getByTestId("mobile-filter-apply"));
    await waitFor(() => {
      expect(
        queryClient.getQueryData(mainKey({ pendingReviewOnly: true })),
      ).toBeTruthy();
    });
    // archive tab：聚焦开关不渲染（仅进行中视图语义）
    fireEvent.click(screen.getByTestId("m-changes-tab-archive"));
    await waitFor(() => {
      expect(changesApi.listChanges).toHaveBeenCalledWith(
        "ws-1",
        expect.objectContaining({ location: "archive" }),
      );
    });
    fireEvent.click(screen.getByTestId("mobile-filter-trigger"));
    await screen.findByTestId("mobile-filter-body");
    expect(
      screen.queryByTestId("m-changes-focusmine-toggle"),
    ).not.toBeInTheDocument();
  });

  it("搜索提交：关键词进请求与 key", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("变更 c1")).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId("m-changes-search-input"), {
      target: { value: "mobile" },
    });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    await waitFor(() => {
      expect(changesApi.listChanges).toHaveBeenCalledWith(
        "ws-1",
        expect.objectContaining({ search: "mobile" }),
      );
    });
    await waitFor(() => {
      expect(
        queryClient.getQueryData(mainKey({ search: "mobile" })),
      ).toBeTruthy();
    });
  });

  it("changesRefetchInterval 接线：缓存条目回调全终态 false / 非终态 30000 / 无数据 false", async () => {
    renderPage();
    await waitFor(() => {
      expect(queryClient.getQueryData(mainKey())).toBeTruthy();
    });
    const entry = queryClient.getQueryCache().find({ queryKey: mainKey() });
    expect(entry).toBeTruthy();
    // QueryOptions 泛型收窄后不含 refetchInterval 字段，此处按运行时实际形状取值断言
    const options = entry?.options as unknown as {
      refetchInterval?: (q: { state: { data?: unknown } }) => number | false;
    };
    const interval = options.refetchInterval!;
    expect(typeof interval).toBe("function");    const ws = makeWorkspace();
    const terminalPage = {
      items: [makeChange("c9", { status: "archived", location: "archive" })],
      total: 1,
      workspace: ws,
    };
    const activePage = {
      items: [makeChange("c1")],
      total: 1,
      workspace: ws,
    };
    expect(interval({ state: { data: terminalPage } })).toBe(false);
    expect(interval({ state: { data: activePage } })).toBe(30000);
    expect(interval({ state: { data: undefined } })).toBe(false);
  });

  it("卡片点击 → 钻取 /m/workspaces/ws-1/changes/:cid", async () => {
    renderPage();
    const card = await screen.findByRole("button", {
      name: "打开变更 变更 c1",
    });
    fireEvent.click(card);
    expect(nav.push).toHaveBeenCalledWith("/m/workspaces/ws-1/changes/c1");
  });

  it("空态引导：active 无变更 → 「去会话页」跳移动会话列表", async () => {
    changesApi.listChanges.mockImplementation(
      async (_ws: string, params?: { location?: string; page?: number }) => {
        if (params?.page) return makeList([], 0);
        if (params?.location === "archive") return makeList([], 0);
        return makeList([], 0);
      },
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("当前没有进行中的变更")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("m-changes-empty-guide"));
    expect(nav.push).toHaveBeenCalledWith("/m/workspaces/ws-1/sessions");
  });

  it("quicklog Tab：渲染卡片列表（listQuicklogEntries 全参对齐桌面默认形态），不发 location=quicklog 列表请求", async () => {
    // 列表调用（page:1）吐卡片；Tab 计数探测调用（无 page）吐空
    quicklogApi.listQuicklogEntries.mockImplementation(
      async (_ws: string, params?: { page?: number }) => {
        if (params?.page) {
          return makeQlList(
            [makeQl("ql-1", { status: "in_progress" }), makeQl("ql-2")],
            2,
          );
        }
        return makeQlList([], 2);
      },
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("变更 c1")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("m-changes-tab-quicklog"));
    // 卡片渲染：标题（ql_id 副行）+ 状态徽标 4 态映射 + 作者（owner 优先，两卡同值）
    // ——限定卡片列表内断言，避免与顶栏 Tab 文案（进行中）重名
    await waitFor(() => {
      expect(screen.getByText("修复 ql-1")).toBeInTheDocument();
    });
    expect(screen.getByText("修复 ql-2")).toBeInTheDocument();
    const listEl = screen.getByTestId("mobile-card-list-items");
    expect(within(listEl).getByText("进行中")).toBeInTheDocument();
    expect(within(listEl).getByText("已完成")).toBeInTheDocument();
    expect(within(listEl).getAllByText("owner-1").length).toBe(2);
    // 请求参数与桌面 QuicklogTable 默认形态一致（占位默认显示 + 首页 20 条）
    expect(quicklogApi.listQuicklogEntries).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        include_placeholder: true,
        page: 1,
        page_size: 20,
      }),
    );
    // quicklog Tab 不发变更列表请求（桌面 :179 同义）
    expect(changesApi.listChanges).not.toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({ location: "quicklog" }),
    );
  });

  it("quicklogPollInterval 接线：缓存条目回调 in_progress|stale → 30000 / 全终态 → false / 无数据 → false", async () => {
    renderPage();
    fireEvent.click(screen.getByTestId("m-changes-tab-quicklog"));
    await waitFor(() => {
      expect(queryClient.getQueryData(quicklogKey())).toBeTruthy();
    });
    const entry = queryClient
      .getQueryCache()
      .find({ queryKey: quicklogKey() });
    expect(entry).toBeTruthy();
    // QueryOptions 泛型收窄后不含 refetchInterval 字段，按运行时实际形状取值断言
    const options = entry?.options as unknown as {
      refetchInterval?: (q: { state: { data?: unknown } }) => number | false;
    };
    const interval = options.refetchInterval!;
    expect(typeof interval).toBe("function");
    expect(
      interval({
        state: { data: { items: [makeQl("a", { status: "in_progress" })] } },
      }),
    ).toBe(30000);
    expect(
      interval({ state: { data: { items: [makeQl("b", { status: "stale" })] } } }),
    ).toBe(30000);
    expect(
      interval({ state: { data: { items: [makeQl("c")] } } }),
    ).toBe(false);
    expect(interval({ state: { data: undefined } })).toBe(false);
  });

  it("quicklog Tab 搜索：关键词进请求与 key（与页内搜索词联动）", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("变更 c1")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("m-changes-tab-quicklog"));
    await screen.findByTestId("m-quicklog-search-input");
    fireEvent.change(screen.getByTestId("m-quicklog-search-input"), {
      target: { value: "白屏" },
    });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    await waitFor(() => {
      expect(quicklogApi.listQuicklogEntries).toHaveBeenCalledWith(
        "ws-1",
        expect.objectContaining({ search: "白屏" }),
      );
    });
    await waitFor(() => {
      expect(
        queryClient.getQueryData(quicklogKey({ search: "白屏" })),
      ).toBeTruthy();
    });
  });

  it("点击 quicklog 卡片 → MobileDetailSheet 全屏详情（getQuicklogDetail 内容 + 「关闭」提交）", async () => {
    quicklogApi.listQuicklogEntries.mockImplementation(
      async (_ws: string, params?: { page?: number }) => {
        if (params?.page) return makeQlList([makeQl("ql-1")], 1);
        return makeQlList([], 1);
      },
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("变更 c1")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("m-changes-tab-quicklog"));
    const card = await screen.findByRole("button", {
      name: "打开快速修复 修复 ql-1",
    });
    fireEvent.click(card);
    // Sheet 打开即按 ql_id 拉详情（key 对齐桌面 QuicklogDrawer 共享缓存）
    await waitFor(() => {
      expect(quicklogApi.getQuicklogDetail).toHaveBeenCalledWith(
        "ws-1",
        "ql-1",
      );
    });
    await waitFor(() => {
      expect(
        queryClient.getQueryData(["quicklogDetail", "ws-1", "ql-1"]),
      ).toBeTruthy();
    });
    // 详情要素（限定 Sheet 体内，避免与背景卡片徽标重名）：状态徽标 / 四段正文 /
    // 文件列表（path + 括注）/ 关联变更 chip
    const sheet = await screen.findByTestId("mobile-detail-sheet-body");
    expect(sheet).toBeVisible();
    expect(within(sheet).getByText("已完成")).toBeInTheDocument();
    expect(within(sheet).getByTestId("m-quicklog-body-需求")).toBeInTheDocument();
    expect(within(sheet).getByText("src/app/page.tsx")).toBeInTheDocument();
    expect(within(sheet).getAllByTestId("m-quicklog-linked-chip").length).toBe(1);
    // 纯展示场景 submitText「关闭」：提交按钮即关闭（onSubmit 复用 onClose）
    expect(screen.getByTestId("mobile-detail-sheet-submit").textContent).toContain(
      "关闭",
    );
    fireEvent.click(screen.getByTestId("mobile-detail-sheet-submit"));
    await waitFor(() => {
      expect(screen.queryByTestId("mobile-detail-sheet-body")).toBeNull();
    });
  });

  it("关联变更 chip → listChanges(search=key) 解析变更 id 后钻取详情路由", async () => {
    quicklogApi.listQuicklogEntries.mockImplementation(
      async (_ws: string, params?: { page?: number }) => {
        if (params?.page) return makeQlList([makeQl("ql-1")], 1);
        return makeQlList([], 1);
      },
    );
    // 关联变更解析：search=change_key 命中唯一变更（id=cid-9）
    changesApi.listChanges.mockImplementation(
      async (_ws: string, params?: { search?: string; page?: number; location?: string }) => {
        if (params?.search) {
          return makeList(
            [makeChange("cid-9", { change_key: "2026-08-26-mobile-workspace-page" })],
            1,
          );
        }
        if (params?.page) return makeList([makeChange("c1"), makeChange("c2")], 2);
        if (params?.location === "archive") return makeList([], 0);
        return makeList([], 2);
      },
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("变更 c1")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("m-changes-tab-quicklog"));
    fireEvent.click(
      await screen.findByRole("button", { name: "打开快速修复 修复 ql-1" }),
    );
    const chip = await screen.findByTestId("m-quicklog-linked-chip");
    fireEvent.click(chip);
    await waitFor(() => {
      expect(nav.push).toHaveBeenCalledWith(
        "/m/workspaces/ws-1/changes/cid-9",
      );
    });
  });

  it("加载更多：递增 page 追加第二页（key 含 page 槽位与桌面同构）", async () => {
    changesApi.listChanges.mockImplementation(
      async (_ws: string, params?: { location?: string; page?: number }) => {
        if (params?.page === 2) return makeList([makeChange("c2p2")], 5);
        if (params?.page) return makeList([makeChange("c1")], 5);
        if (params?.location === "archive") return makeList([], 0);
        return makeList([], 5);
      },
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("变更 c1")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("m-changes-load-more"));
    // 第二页 key（page:2）落缓存，两页条目累积渲染
    await waitFor(() => {
      expect(
        queryClient.getQueryData(mainKey({ page: 2 })),
      ).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByText("变更 c2p2")).toBeInTheDocument();
    });
    expect(screen.getByText("变更 c1")).toBeInTheDocument();
  });

  // ── task-08（FR-01 / D-003@v1 清单项 1）：重新扫描 ──────────────────────────

  it("FR-01 重新扫描成功：stats 反馈条文案与桌面逐字一致 + 警告卡 + 失效 [changes, ws] 前缀", async () => {
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    changesApi.reparseChanges.mockResolvedValue({
      workspace_id: "ws-1",
      stats: { parsed: 3, created: 1, updated: 1, deleted: 1 },
      warnings: [
        {
          code: "missing_field",
          detail: "缺少 title 字段",
          change_key: "2026-09-16-demo",
          doc_type: null,
        },
        {
          code: "bad_stage",
          detail: "未知阶段 typo",
          change_key: null,
          doc_type: null,
        },
      ],
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("变更 c1")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("m-changes-rescan-btn"));
    await waitFor(() => {
      expect(changesApi.reparseChanges).toHaveBeenCalledWith("ws-1");
    });
    // stats 反馈条文案逐字对齐桌面 :701-720（含警告计数后缀，注意「。」后空格）
    const statsBanner = await screen.findByTestId("m-changes-reparse-stats");
    expect(statsBanner.textContent).toBe(
      "已重新扫描：解析 3，新增 1 · 更新 1 · 删除 1。 2 个警告。",
    );
    // 警告卡：[code] change_key: detail 列表（change_key 缺失降级 —）
    const warningsCard = screen.getByTestId("m-changes-reparse-warnings");
    expect(warningsCard.textContent).toContain("解析警告（2）");
    expect(warningsCard.textContent).toContain(
      "[missing_field] 2026-09-16-demo: 缺少 title 字段",
    );
    expect(warningsCard.textContent).toContain("[bad_stage] —: 未知阶段 typo");
    // 成功后仅失效 ["changes", workspaceId] 前缀（不含 changesTabTotals，桌面同语义）
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["changes", "ws-1"],
      });
    });
  });

  it("FR-01 重新扫描失败：ApiError → 中文红条（ApiError.message）；非 ApiError → 兜底「重新解析失败」，均不白屏", async () => {
    changesApi.reparseChanges
      .mockRejectedValueOnce(
        new ApiError(422, {
          code: "reparse_failed",
          message: "变更目录读取失败",
          request_id: null,
          details: null,
        }),
      )
      .mockRejectedValueOnce(new Error("boom"));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("变更 c1")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("m-changes-rescan-btn"));
    // ApiError.message 中文红条（role=alert）
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "变更目录读取失败",
    );
    // 列表不受影响（不白屏）
    expect(screen.getByText("变更 c1")).toBeInTheDocument();
    // 非 ApiError → 兜底「重新解析失败」
    fireEvent.click(screen.getByTestId("m-changes-rescan-btn"));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("重新解析失败");
    });
  });

  it("FR-01 解析中防重入：pending 期间按钮 disabled 且文案「解析中…」", async () => {
    changesApi.reparseChanges.mockImplementation(() => new Promise(() => {}));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("变更 c1")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("m-changes-rescan-btn"));
    const btn = screen.getByTestId("m-changes-rescan-btn");
    expect(btn).toBeDisabled();
    expect(btn.textContent).toBe("解析中…");
  });

  // ── task-08（FR-03 / D-003@v1 清单项 3/4）：排序切换与 URL 参数 ──────────────

  it("FR-03 排序切换：抽屉切「↑ 最早优先」确定 → sort=updated_at_asc 进请求与 key（默认 chip ↓ 最近优先）", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("变更 c1")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("mobile-filter-trigger"));
    const body = await screen.findByTestId("mobile-filter-body");
    // 默认选中 ↓ 最近优先（DEFAULT_SORT 真值，R-03 基线）
    expect(
      within(body).getByTestId("m-changes-sort-chip-desc"),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(body).getByTestId("m-changes-sort-chip-asc"));
    fireEvent.click(screen.getByTestId("mobile-filter-apply"));
    await waitFor(() => {
      expect(changesApi.listChanges).toHaveBeenCalledWith(
        "ws-1",
        expect.objectContaining({ sort: "updated_at_asc" }),
      );
    });
    await waitFor(() => {
      expect(
        queryClient.getQueryData(mainKey({ sort: "updated_at_asc" })),
      ).toBeTruthy();
    });
  });

  it("FR-03 URL ?tab=quicklog：初始 tab 为快速修复（tab 选中 + 不发主列表请求）", async () => {
    nav.searchParams = new URLSearchParams("tab=quicklog");
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("m-changes-tab-quicklog")).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });
    // quicklog 列表请求发出（page:1 全参）
    await waitFor(() => {
      expect(quicklogApi.listQuicklogEntries).toHaveBeenCalledWith(
        "ws-1",
        expect.objectContaining({ page: 1, page_size: 20 }),
      );
    });
    // 主列表不发请求（enabled: tab !== "quicklog"）——listChanges 仅 tabTotals
    // 的 pageSize:1 探测调用（无 page 参数）
    const listCalls = changesApi.listChanges.mock.calls;
    expect(
      listCalls.every(
        ([, params]) =>
          (params as { page?: number } | undefined)?.page === undefined,
      ),
    ).toBe(true);
  });

  it("FR-03 URL ?tab=非法值：回 active 默认 tab（主列表照常请求）", async () => {
    nav.searchParams = new URLSearchParams("tab=bogus");
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("m-changes-tab-active")).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });
    await waitFor(() => {
      expect(queryClient.getQueryData(mainKey())).toBeTruthy();
    });
  });

  it("FR-03 URL ?search=词：搜索词初始化（输入框与已提交 state 同步 → 请求与 key 带 search）", async () => {
    nav.searchParams = new URLSearchParams("search=白屏");
    renderPage();
    // 输入框与已提交 state 双同步（不点搜索按钮即随初始 load 携带）
    expect(screen.getByTestId("m-changes-search-input")).toHaveValue("白屏");
    await waitFor(() => {
      expect(changesApi.listChanges).toHaveBeenCalledWith(
        "ws-1",
        expect.objectContaining({ search: "白屏" }),
      );
    });
    await waitFor(() => {
      expect(
        queryClient.getQueryData(mainKey({ search: "白屏" })),
      ).toBeTruthy();
    });
  });

  it("R-03 默认参数 key 同构：主列表/quicklog 默认 key 槽位与桌面逐字一致，请求参数与改造前默认值逐字相同", async () => {
    renderPage();
    // 主列表：字面量默认 key 精确命中缓存（hash 相等即证 key 同构；sort 槽位
    // 真值 updated_at_desc = task-04 改造前固定常量 DEFAULT_SORT）
    await waitFor(() => {
      expect(queryClient.getQueryData(mainKey())).toBeTruthy();
    });
    // 主列表请求参数与改造前默认值逐字相同（search/currentStage 空串转
    // undefined 不带参——toEqual 语义对 undefined 键与缺失键等价）
    expect(changesApi.listChanges).toHaveBeenCalledWith("ws-1", {
      location: "active",
      sort: "updated_at_desc",
      pendingReviewOnly: false,
      page: 1,
      pageSize: 20,
    });
    fireEvent.click(screen.getByTestId("m-changes-tab-quicklog"));
    // quicklog：默认 key 槽位 status:""/author:""/showPlaceholder:true 与桌面
    // QuicklogTable 同构（task-05 改造前固定默认值，不产生额外请求）
    await waitFor(() => {
      expect(queryClient.getQueryData(quicklogKey())).toBeTruthy();
    });
    expect(quicklogApi.listQuicklogEntries).toHaveBeenCalledWith("ws-1", {
      include_placeholder: true,
      page: 1,
      page_size: 20,
    });
  });

  // ── task-08（FR-04 / D-003@v1 清单项 5）：quicklog 筛选抽屉 ──────────────────

  it("FR-04 状态筛选：抽屉选「疑似中断」确定 → quicklog key 与请求带 status=stale", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("变更 c1")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("m-changes-tab-quicklog"));
    await screen.findByTestId("m-quicklog-search-input");
    fireEvent.click(screen.getByTestId("mobile-filter-trigger"));
    const body = await screen.findByTestId("mobile-filter-body");
    fireEvent.click(within(body).getByTestId("m-quicklog-status-chip-stale"));
    fireEvent.click(screen.getByTestId("mobile-filter-apply"));
    await waitFor(() => {
      expect(quicklogApi.listQuicklogEntries).toHaveBeenLastCalledWith(
        "ws-1",
        expect.objectContaining({ status: "stale" }),
      );
    });
    await waitFor(() => {
      expect(
        queryClient.getQueryData(quicklogKey({ status: "stale" })),
      ).toBeTruthy();
    });
  });

  it("FR-04 作者聚合：owner_name → author_name → author_raw 去重链（口径对齐桌面 quicklog-table:197-203）+ 作者 chip 筛选进 key 与请求", async () => {
    quicklogApi.listQuicklogEntries.mockImplementation(
      async (_ws: string, params?: { page?: number }) => {
        if (params?.page) {
          return makeQlList(
            [
              makeQl("ql-1", { owner_name: "张三" }),
              makeQl("ql-2", { owner_name: null, author_name: "李四" }),
              makeQl("ql-3", {
                owner_name: null,
                author_name: null,
                author_raw: "raw-9",
              }),
              // owner_name 优先：author_name 不同也不进候选，且重复张三去重
              makeQl("ql-4", { owner_name: "张三", author_name: "author-x" }),
              // 三值全空 falsy（author_raw 类型为非空 string，空串即空值）
              // → 不进候选
              makeQl("ql-5", {
                owner_name: null,
                author_name: null,
                author_raw: "",
              }),
            ],
            5,
          );
        }
        return makeQlList([], 5);
      },
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("变更 c1")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("m-changes-tab-quicklog"));
    await waitFor(() => {
      expect(screen.getByText("修复 ql-1")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("mobile-filter-trigger"));
    const body = await screen.findByTestId("mobile-filter-body");
    // 候选 = 全部作者 + 张三/李四/raw-9（空值过滤 + Set 去重 + owner 优先链）
    expect(
      within(body).getAllByTestId(/^m-quicklog-author-chip-/),
    ).toHaveLength(4);
    expect(
      within(body).getByTestId("m-quicklog-author-chip-张三"),
    ).toBeInTheDocument();
    expect(
      within(body).getByTestId("m-quicklog-author-chip-李四"),
    ).toBeInTheDocument();
    expect(
      within(body).getByTestId("m-quicklog-author-chip-raw-9"),
    ).toBeInTheDocument();
    expect(
      within(body).queryByTestId("m-quicklog-author-chip-author-x"),
    ).not.toBeInTheDocument();
    // 选作者张三 → 确定 → key 与请求带 author
    fireEvent.click(within(body).getByTestId("m-quicklog-author-chip-张三"));
    fireEvent.click(screen.getByTestId("mobile-filter-apply"));
    await waitFor(() => {
      expect(quicklogApi.listQuicklogEntries).toHaveBeenLastCalledWith(
        "ws-1",
        expect.objectContaining({ author: "张三" }),
      );
    });
    await waitFor(() => {
      expect(
        queryClient.getQueryData(quicklogKey({ author: "张三" })),
      ).toBeTruthy();
    });
  });

  it("FR-04 占位开关：关闭「显示空壳占位」确定 → key showPlaceholder=false + 请求不带占位参数", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("变更 c1")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("m-changes-tab-quicklog"));
    await screen.findByTestId("m-quicklog-search-input");
    fireEvent.click(screen.getByTestId("mobile-filter-trigger"));
    const body = await screen.findByTestId("mobile-filter-body");
    // 默认开（占位默认 true = task-05 改造前固定值）
    expect(
      within(body).getByTestId("m-quicklog-placeholder-toggle"),
    ).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(body).getByTestId("m-quicklog-placeholder-toggle"));
    fireEvent.click(screen.getByTestId("mobile-filter-apply"));
    await waitFor(() => {
      expect(
        queryClient.getQueryData(quicklogKey({ showPlaceholder: false })),
      ).toBeTruthy();
    });
    // include_placeholder 收窄：false → 不带参（showPlaceholder || undefined）
    const qlCalls = quicklogApi.listQuicklogEntries.mock.calls;
    const lastParams = qlCalls[qlCalls.length - 1]?.[1] as
      | { include_placeholder?: boolean }
      | undefined;
    expect(lastParams?.include_placeholder).toBeUndefined();
  });

  it("FR-04 重置：quicklog 抽屉筛选态全部回默认（状态/作者清空、占位回 true、搜索词一并清空）", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("变更 c1")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("m-changes-tab-quicklog"));
    await screen.findByTestId("m-quicklog-search-input");
    // 先制造筛选态：搜索词 + 状态=疑似中断 + 占位关闭
    fireEvent.change(screen.getByTestId("m-quicklog-search-input"), {
      target: { value: "白屏" },
    });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    await waitFor(() => {
      expect(quicklogApi.listQuicklogEntries).toHaveBeenLastCalledWith(
        "ws-1",
        expect.objectContaining({ search: "白屏" }),
      );
    });
    fireEvent.click(screen.getByTestId("mobile-filter-trigger"));
    const body = await screen.findByTestId("mobile-filter-body");
    fireEvent.click(within(body).getByTestId("m-quicklog-status-chip-stale"));
    fireEvent.click(within(body).getByTestId("m-quicklog-placeholder-toggle"));
    fireEvent.click(screen.getByTestId("mobile-filter-apply"));
    await waitFor(() => {
      expect(
        queryClient.getQueryData(
          quicklogKey({
            search: "白屏",
            status: "stale",
            showPlaceholder: false,
          }),
        ),
      ).toBeTruthy();
    });
    // 重置：抽屉保持打开（MobileFilterDrawer 语义），草稿与生效态全部回默认
    fireEvent.click(screen.getByTestId("mobile-filter-trigger"));
    const body2 = await screen.findByTestId("mobile-filter-body");
    fireEvent.click(screen.getByTestId("mobile-filter-reset"));
    expect(
      within(body2).getByTestId("m-quicklog-placeholder-toggle"),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      within(body2).getByTestId("m-quicklog-status-chip-all"),
    ).toHaveAttribute("aria-pressed", "true");
    // 搜索词一并清空（生效值与输入框同步）
    expect(screen.getByTestId("m-quicklog-search-input")).toHaveValue("");
    fireEvent.click(screen.getByTestId("mobile-filter-apply"));
    // 重置后请求回默认形态（status/author 不带参、占位 true）
    await waitFor(() => {
      expect(quicklogApi.listQuicklogEntries).toHaveBeenLastCalledWith(
        "ws-1",
        expect.objectContaining({
          include_placeholder: true,
          page: 1,
          page_size: 20,
        }),
      );
    });
  });
});
