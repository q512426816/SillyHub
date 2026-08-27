/**
 * task-09 · 变更详情移动钻取页 changes/[cid] 单测（FR-04 / FR-09 / design §5.3 /
 * §5.5，change 2026-08-26-mobile-workspace-page）。
 *
 * 覆盖任务卡指定契约：
 *  1. MobileChangeDetail 透传 props（changeId/workspaceId/onOpenSession 桩断言），
 *     onOpenSession 跳移动会话列表 /m/workspaces/[id]/sessions；
 *  2. 返回顶栏（MobileTopBar）：返回按钮 → router.push 回列表页
 *     /m/workspaces/[id]/changes；标题 = 变更名（title 优先）；
 *  3. 页面级 useQuery getChange：key 逐字为 ["change", workspaceId, changeId]
 *     （与 MobileChangeDetail 内部同 key 共享缓存）且只发一次请求；
 *  4. 加载骨架（pending → m-change-detail-page-loading，详情桩不挂载）；
 *  5. 错误重试态（reject → m-change-detail-page-error + 重试 refetch 恢复）；
 *  6. ⋯ 菜单（MobileActionMenu）：重解析（reparseChanges + invalidate + 反馈）/
 *     复制变更名（clipboard 写展示名）。
 *
 * mock 范式对齐 page.test.tsx / page.m-sessions-fallback.test.tsx：importActual
 * 部分 mock（@/lib/changes 只换 getChange/reparseChanges）+ 真实 QueryClient +
 * next/navigation mock（useRouter push/replace + useParams）；MobileChangeDetail
 * 打桩断言透传契约（页面壳零重复实现详情，桩即哨兵）。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── next/navigation mock：useRouter push/replace spy + useParams 固定 ws-1/c1 ──
const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useParams: () => ({ id: "ws-1", cid: "c1" }),
}));

// ── MobileChangeDetail 契约桩：props 直出 + onOpenSession 触发按钮 ─────────────
vi.mock("@/components/mobile/mobile-change-detail", () => ({
  MobileChangeDetail: (props: {
    changeId: string;
    workspaceId: string;
    onOpenSession: () => void;
  }) => (
    <div
      data-testid="mobile-change-detail-stub"
      data-change-id={props.changeId}
      data-workspace-id={props.workspaceId}
    >
      <button type="button" onClick={props.onOpenSession}>
        桩-打开会话
      </button>
    </div>
  ),
}));

// ── 数据层部分 mock（保留 actual，仅替换页面用到的请求函数）──────────────────
const changesApi = vi.hoisted(() => ({ getChange: vi.fn(), reparseChanges: vi.fn() }));
vi.mock("@/lib/changes", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/changes")>("@/lib/changes");
  return {
    ...actual,
    getChange: changesApi.getChange,
    reparseChanges: changesApi.reparseChanges,
  };
});

import Page from "@/app/m/workspaces/[id]/changes/[cid]/page";
import type { ChangeRead } from "@/lib/changes";

// ── fixtures ────────────────────────────────────────────────────────────────

function makeChangeRead(overrides: Partial<ChangeRead> = {}): ChangeRead {
  return {
    id: "c1",
    workspace_id: "ws-1",
    change_key: "2026-08-26-mobile-workspace-page",
    title: "工作区移动端页面",
    status: "in_progress",
    location: "active",
    path: ".sillyspec/changes/2026-08-26-mobile-workspace-page",
    affected_components: [],
    change_type: null,
    owner_id: null,
    current_stage: "execute",
    pending_review: null,
    stages: null,
    approval_status: null,
    approved_by: null,
    approved_at: null,
    rejection_reason: null,
    created_at: "2026-08-26T10:00:00Z",
    updated_at: "2026-08-26T15:00:00Z",
    archived_at: null,
    step_progress: null,
    steps: null,
    owner_name: null,
    ...overrides,
  };
}

describe("m/workspaces/[id]/changes/[cid] 变更详情移动钻取页", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    changesApi.getChange.mockResolvedValue(makeChangeRead());
    changesApi.reparseChanges.mockResolvedValue({
      workspace_id: "ws-1",
      stats: {},
    });
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
        <Page />
      </QueryClientProvider>,
    );
  }

  it("成功态：MobileChangeDetail 透传 changeId/workspaceId，getChange 同 key 落缓存且只发一次请求", async () => {
    renderPage();
    const stub = await screen.findByTestId("mobile-change-detail-stub");
    expect(stub).toHaveAttribute("data-change-id", "c1");
    expect(stub).toHaveAttribute("data-workspace-id", "ws-1");
    // 页面级 query key 逐字对齐（与 MobileChangeDetail 内部同 key 共享缓存）
    await waitFor(() => {
      expect(
        queryClient.getQueryData(["change", "ws-1", "c1"]),
      ).toEqual(makeChangeRead());
    });
    // 单 observer 一次请求（共享缓存不双请求的页面侧哨兵）
    expect(changesApi.getChange).toHaveBeenCalledTimes(1);
    expect(changesApi.getChange).toHaveBeenCalledWith("ws-1", "c1");
  });

  it("顶栏：标题 = 变更名；返回按钮 → push 回列表页 /m/workspaces/ws-1/changes", async () => {
    renderPage();
    await screen.findByTestId("mobile-change-detail-stub");
    // 标题 = title 优先（change_key 兜底）
    expect(screen.getByTestId("mobile-top-bar").textContent).toContain(
      "工作区移动端页面",
    );
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(nav.push).toHaveBeenCalledWith("/m/workspaces/ws-1/changes");
  });

  it("onOpenSession（详情桩回调）→ push 跳移动会话列表", async () => {
    renderPage();
    await screen.findByTestId("mobile-change-detail-stub");
    fireEvent.click(screen.getByRole("button", { name: "桩-打开会话" }));
    expect(nav.push).toHaveBeenCalledWith("/m/workspaces/ws-1/sessions");
  });

  it("加载态：getChange pending → 整页骨架，MobileChangeDetail 桩不挂载", async () => {
    changesApi.getChange.mockImplementation(
      () => new Promise<ChangeRead>(() => {}),
    );
    renderPage();
    expect(
      await screen.findByTestId("m-change-detail-page-loading"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("mobile-change-detail-stub"),
    ).not.toBeInTheDocument();
    // 顶栏标题降级「加载中…」
    expect(screen.getByTestId("mobile-top-bar").textContent).toContain(
      "加载中…",
    );
  });

  it("错误态：reject → 错误屏 + 重试 refetch 恢复详情", async () => {
    changesApi.getChange
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(makeChangeRead());
    renderPage();
    const errBox = await screen.findByTestId("m-change-detail-page-error");
    // 非 ApiError 错误走通用文案
    expect(errBox.textContent).toContain("加载变更详情失败");
    expect(
      screen.queryByTestId("mobile-change-detail-stub"),
    ).not.toBeInTheDocument();
    // 重试 → 同 key refetch → 详情恢复
    fireEvent.click(screen.getByTestId("m-change-detail-page-retry"));
    await screen.findByTestId("mobile-change-detail-stub");
    expect(changesApi.getChange).toHaveBeenCalledTimes(2);
  });

  it("⋯ 菜单：重解析 → reparseChanges(ws) + 成功反馈；复制变更名 → clipboard 写展示名", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderPage();
    await screen.findByTestId("mobile-change-detail-stub");

    // 重解析
    fireEvent.click(screen.getByTestId("m-change-menu-trigger"));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "重新解析变更" }),
    );
    await waitFor(() => {
      expect(changesApi.reparseChanges).toHaveBeenCalledWith("ws-1");
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("m-change-action-feedback").textContent,
      ).toContain("重新解析");
    });

    // 复制变更名（展示名口径：title 优先）
    fireEvent.click(screen.getByTestId("m-change-menu-trigger"));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "复制变更名" }),
    );
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("工作区移动端页面");
    });
    expect(screen.getByTestId("m-change-action-feedback").textContent).toContain(
      "复制",
    );
  });
});
