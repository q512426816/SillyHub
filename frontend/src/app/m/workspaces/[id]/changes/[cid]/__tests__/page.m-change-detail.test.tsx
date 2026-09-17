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
 *     复制变更名（clipboard 写展示名）；
 *  7. 删除入口（task-07 / FR-07 / D-004）：canDeleteChange 三判门控（管理员 /
 *     owner 本人 / 工作区所有者出现 danger 项；无权限 / change=null 加载态不
 *     出现，其余动作不受影响）+ DeleteChangeConfirm 末段防呆确认流（取消不
 *     发请求；成功 → toast + ["changes", ws] 前缀失效完成后跳回移动列表；
 *     403 失败 → notify.error 中文兜底，留在本页不跳转）。
 *
 * mock 范式对齐 page.test.tsx / page.m-sessions-fallback / page.m-workspaces：
 * importActual 部分 mock（@/lib/changes 只换 getChange/reparseChanges/deleteChange
 * 、@/lib/auth 只换 fetchMe）+ 真实 QueryClient + next/navigation mock（useRouter
 * push/replace + useParams）；MobileChangeDetail 打桩断言透传契约（页面壳零重复
 * 实现详情，桩即哨兵）。删除门控三要素：@/stores/session stub（可变 user 供
 * 用例切换登录态）+ fetchMe stub（workspaces[].role_key）+ @/lib/errors useNotify
 * stub（toast 哨兵，复用删除入口域组件实件 canDeleteChange/useChangeDeleteAccess/
 * DeleteChangeConfirm 验真实判定与防呆）。
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
const changesApi = vi.hoisted(() => ({
  getChange: vi.fn(),
  reparseChanges: vi.fn(),
  deleteChange: vi.fn(),
}));
vi.mock("@/lib/changes", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/changes")>("@/lib/changes");
  return {
    ...actual,
    getChange: changesApi.getChange,
    reparseChanges: changesApi.reparseChanges,
    deleteChange: changesApi.deleteChange,
  };
});

// ── 删除门控三要素 stub（task-07）：session user / fetchMe workspaceRole ──────
// useChangeDeleteAccess / canDeleteChange / DeleteChangeConfirm 走实件（真判定），
// 仅 stub 数据源与 toast。sessionStub.user 可变，用例内切换登录态/管理员。
const sessionStub = vi.hoisted(() => ({
  user: null as { id: string; is_platform_admin?: boolean } | null,
}));
vi.mock("@/stores/session", () => ({
  useSession: (
    sel: (_state: { user: typeof sessionStub.user }) => unknown,
  ) => sel({ user: sessionStub.user }),
  getState: () => ({ user: sessionStub.user }),
}));

const authApi = vi.hoisted(() => ({ fetchMe: vi.fn() }));
vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return { ...actual, fetchMe: authApi.fetchMe };
});

// toast 哨兵（useNotify 依赖 antd App 上下文，stub 成 spy 断言文案）
const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));
vi.mock("@/lib/errors", () => ({
  useNotify: () => notify,
  errMessage: (err: unknown, fallback?: string) =>
    err instanceof Error && err.message ? err.message : (fallback ?? "操作失败"),
}));

import Page from "@/app/m/workspaces/[id]/changes/[cid]/page";
import { ApiError } from "@/lib/api";
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
    // 删除门控默认态：未登录（fetchMe 不发请求、无删除项）；各用例按需切换
    sessionStub.user = null;
    authApi.fetchMe.mockResolvedValue({
      user: { id: "user-1", is_platform_admin: false },
      workspaces: [],
      permissions: [],
    });
    changesApi.deleteChange.mockResolvedValue({
      ok: true,
      backup_dir: "/tmp/backup/c1",
      file_count: 0,
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

  // ── 删除入口（task-07 / FR-07 / D-004）────────────────────────────────────

  it("删除入口门控（三判其一）：管理员 / owner 本人 / 工作区所有者 → danger 项「删除变更」出现，其余动作不受影响", async () => {
    const judges: Array<{
      name: string;
      user: { id: string; is_platform_admin?: boolean };
      ownerId: string | null;
      roleKey: string;
    }> = [
      {
        name: "平台管理员",
        user: { id: "admin-1", is_platform_admin: true },
        ownerId: null,
        roleKey: "member",
      },
      {
        name: "owner 本人",
        user: { id: "user-1", is_platform_admin: false },
        ownerId: "user-1",
        roleKey: "member",
      },
      {
        name: "工作区所有者",
        user: { id: "user-2", is_platform_admin: false },
        ownerId: "owner-9",
        roleKey: "workspace_owner",
      },
    ];
    for (const judge of judges) {
      sessionStub.user = judge.user;
      changesApi.getChange.mockResolvedValue(
        makeChangeRead({ owner_id: judge.ownerId }),
      );
      authApi.fetchMe.mockResolvedValue({
        user: { id: judge.user.id, is_platform_admin: false },
        workspaces: [{ workspace_id: "ws-1", role_key: judge.roleKey }],
        permissions: [],
      });
      const { unmount } = renderPage();
      await screen.findByTestId("mobile-change-detail-stub");
      fireEvent.click(screen.getByTestId("m-change-menu-trigger"));
      const item = await screen.findByRole("menuitem", { name: "删除变更" });
      // danger 项（MobileAction.danger → text-destructive 红色文案）
      expect(item).toHaveAttribute("data-action-key", "delete-change");
      expect(item.className).toContain("text-destructive");
      // 重解析 / 复制动作不受影响
      expect(
        screen.getByRole("menuitem", { name: "重新解析变更" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("menuitem", { name: "复制变更名" }),
      ).toBeInTheDocument();
      unmount();
      cleanup();
      // ["me","workspaceRoles"] 有 5min staleTime，跨迭代清缓存防上一轮角色
      // 拦截本轮 fetchMe（三判各自独立取角色）
      queryClient.clear();
    }
  });

  it("删除入口门控（无权限）：member 且非本人 → 不出现，重解析/复制不受影响", async () => {
    sessionStub.user = { id: "user-1", is_platform_admin: false };
    changesApi.getChange.mockResolvedValue(makeChangeRead({ owner_id: "owner-9" }));
    authApi.fetchMe.mockResolvedValue({
      user: { id: "user-1", is_platform_admin: false },
      workspaces: [{ workspace_id: "ws-1", role_key: "member" }],
      permissions: [],
    });
    renderPage();
    await screen.findByTestId("mobile-change-detail-stub");
    // 等 fetchMe 角色落定再开门（确认走了 workspaceRole 判定而非提前 false）
    await waitFor(() => expect(authApi.fetchMe).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("m-change-menu-trigger"));
    await screen.findByRole("menuitem", { name: "重新解析变更" });
    expect(
      screen.queryByRole("menuitem", { name: "删除变更" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "复制变更名" }),
    ).toBeInTheDocument();
  });

  it("删除入口门控（加载态）：change=null → ⋯ 菜单不出现删除项", async () => {
    sessionStub.user = { id: "admin-1", is_platform_admin: true };
    changesApi.getChange.mockImplementation(
      () => new Promise<ChangeRead>(() => {}),
    );
    renderPage();
    await screen.findByTestId("m-change-detail-page-loading");
    fireEvent.click(screen.getByTestId("m-change-menu-trigger"));
    await screen.findByRole("menuitem", { name: "重新解析变更" });
    expect(
      screen.queryByRole("menuitem", { name: "删除变更" }),
    ).not.toBeInTheDocument();
  });

  it("删除确认弹层：取消 → 关闭弹层且不触发 deleteChange", async () => {
    sessionStub.user = { id: "admin-1", is_platform_admin: true };
    renderPage();
    await screen.findByTestId("mobile-change-detail-stub");
    fireEvent.click(screen.getByTestId("m-change-menu-trigger"));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "删除变更" }),
    );
    const dialog = await screen.findByTestId("delete-change-confirm");
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    await waitFor(() =>
      expect(
        screen.queryByTestId("delete-change-confirm"),
      ).not.toBeInTheDocument(),
    );
    expect(changesApi.deleteChange).not.toHaveBeenCalled();
  });

  it("删除确认流（成功）：末段防呆 → deleteChange → toast + changes 前缀失效完成后跳回移动列表", async () => {
    sessionStub.user = { id: "admin-1", is_platform_admin: true };
    // 失效顺序哨兵：invalidateQueries 手动 resolve，验证「先失效完成再跳转」
    let resolveInvalidate!: () => void;
    const invalidateSpy = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveInvalidate = resolve;
          }),
      );
    renderPage();
    await screen.findByTestId("mobile-change-detail-stub");
    fireEvent.click(screen.getByTestId("m-change-menu-trigger"));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "删除变更" }),
    );

    const dialog = await screen.findByTestId("delete-change-confirm");
    // 末段防呆：change_key 去日期前缀 → mobile-workspace-page，输入前确认禁用
    const confirmBtn = within(dialog).getByRole("button", { name: "确认删除" });
    expect(confirmBtn).toBeDisabled();
    fireEvent.change(
      within(dialog).getByTestId("delete-change-confirm-input"),
      { target: { value: "mobile-workspace-page" } },
    );
    expect(confirmBtn).toBeEnabled();
    fireEvent.click(confirmBtn);

    // 确认先关弹层再 mutate
    await waitFor(() =>
      expect(changesApi.deleteChange).toHaveBeenCalledWith("ws-1", "c1"),
    );
    expect(
      screen.queryByTestId("delete-change-confirm"),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith(
        "变更 2026-08-26-mobile-workspace-page 已删除",
      ),
    );
    // ["changes", ws-1] 前缀失效（列表行消失口径）未完成前不跳转
    expect(nav.push).not.toHaveBeenCalled();
    resolveInvalidate();
    await waitFor(() =>
      expect(nav.push).toHaveBeenCalledWith("/m/workspaces/ws-1/changes"),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["changes", "ws-1"],
    });
  });

  it("删除确认流（失败）：403 → notify.error 中文兜底，留在详情页不跳转", async () => {
    sessionStub.user = { id: "admin-1", is_platform_admin: true };
    const apiErr = new ApiError(403, {
      code: "forbidden",
      message: "无权限删除该变更",
      request_id: null,
      details: null,
    });
    changesApi.deleteChange.mockRejectedValue(apiErr);
    renderPage();
    await screen.findByTestId("mobile-change-detail-stub");
    fireEvent.click(screen.getByTestId("m-change-menu-trigger"));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "删除变更" }),
    );
    const dialog = await screen.findByTestId("delete-change-confirm");
    fireEvent.change(
      within(dialog).getByTestId("delete-change-confirm-input"),
      { target: { value: "mobile-workspace-page" } },
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "确认删除" }),
    );
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(apiErr, "删除变更失败"),
    );
    // 留在详情页不白屏、不跳转；弹层已关不重开
    expect(nav.push).not.toHaveBeenCalled();
    expect(screen.getByTestId("mobile-change-detail-stub")).toBeInTheDocument();
    expect(
      screen.queryByTestId("delete-change-confirm"),
    ).not.toBeInTheDocument();
  });
});
