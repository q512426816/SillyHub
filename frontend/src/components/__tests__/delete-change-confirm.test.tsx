/**
 * task-07 · 变更删除入口测试（2026-08-29-change-delete-closure-and-spec-pull /
 * design §6.3 / FR-05d）。
 *
 * 覆盖任务卡验收：
 *   1. changeKeyTail 末段防呆纯函数（去 YYYY-MM-DD- 日期前缀 / 非日期前缀 key 原样返回）；
 *   2. DeleteChangeConfirm 受控弹层：初始确认禁用 / 输入不符仍禁用 / 相符启用并可
 *      onConfirm / 取消只走 onCancel（不触发确认与请求）；警示文案对照原型；
 *   3. canDeleteChange 权限启发式（owner 本人 / 平台管理员 / 工作区所有者 / 无权限）；
 *   4. 桌面列表页操作列：权限可见者渲染、他人变更普通成员不可见；删除成功
 *      deleteChange + invalidateQueries(["changes", wsId]) + 成功 toast；
 *      403 失败错误 toast（中文文案，不白屏）；
 *   5. 详情页危险按钮：确认删除后跳回变更列表（router.push）+ 前缀失效；
 *   6. 移动端镜像页：owner 行出现「⋯」动作菜单删除入口，复用同一弹层与失效逻辑。
 *
 * mock 范式照 admin-user-drawer / changes page.test / m changes page.test：
 * importActual 部分 mock（@/lib/changes 只换请求函数，canDeleteChange /
 * useChangeDeleteAccess 用真实实现）+ useNotify mock（@/lib/errors）+
 * fetchMe mock（@/lib/auth，权限启发式的角色源）+ session store setState。
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── mocks（hoisted，让 mock 工厂能引用同一组 vi.fn）──────────────────────
const mocks = vi.hoisted(() => ({
  listChanges: vi.fn(),
  reparseChanges: vi.fn(),
  deleteChange: vi.fn(),
  getChange: vi.fn(),
  getAgentStatus: vi.fn(),
  submitStageReview: vi.fn(),
  listWorkspaceAgentSessions: vi.fn(),
  getTaskBoard: vi.fn(),
  listQuicklogEntries: vi.fn(),
  getWorkspace: vi.fn(),
  fetchMe: vi.fn(),
  routerPush: vi.fn(),
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
  searchParams: new URLSearchParams(),
}));

// @/lib/changes 部分 mock：请求函数替换（canDeleteChange / useChangeDeleteAccess
// 在组件模块 @/components/delete-change-confirm（未 mock），页面渲染分支测的
// 就是真实启发式）。
vi.mock("@/lib/changes", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/changes")>("@/lib/changes");
  return {
    ...actual,
    listChanges: mocks.listChanges,
    reparseChanges: mocks.reparseChanges,
    deleteChange: mocks.deleteChange,
    getChange: mocks.getChange,
    getAgentStatus: mocks.getAgentStatus,
    submitStageReview: mocks.submitStageReview,
  };
});

// fetchMe mock：useChangeDeleteAccess 的角色数据源（workspaces[].role_key）。
vi.mock("@/lib/auth", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return { ...actual, fetchMe: mocks.fetchMe };
});

// useNotify mock（照 skills page.test：不依赖 antd App 运行时，直接断言 toast 调用）。
vi.mock("@/lib/errors", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/errors")>("@/lib/errors");
  return {
    ...actual,
    useNotify: () => ({
      success: mocks.notifySuccess,
      error: mocks.notifyError,
      warning: vi.fn(),
    }),
  };
});

vi.mock("@/lib/workspaces", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/workspaces")>("@/lib/workspaces");
  return { ...actual, getWorkspace: mocks.getWorkspace };
});

vi.mock("@/lib/quicklog", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/quicklog")>("@/lib/quicklog");
  return { ...actual, listQuicklogEntries: mocks.listQuicklogEntries };
});

vi.mock("@/lib/daemon", () => ({
  listWorkspaceAgentSessions: mocks.listWorkspaceAgentSessions,
}));

vi.mock("@/lib/tasks", () => ({
  getTaskBoard: mocks.getTaskBoard,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.routerPush, replace: vi.fn() }),
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

// 只读卡片 stub（详情页渲染减负，照 page-last-signal.test 范式；删除入口不涉其内部）
vi.mock("@/components/changes/detail/change-agent-run-log", () => ({
  ChangeAgentRunLog: () => <div data-testid="change-agent-run-log" />,
}));
vi.mock("@/components/changes/detail/change-files-card", () => ({
  ChangeFilesCard: () => <div data-testid="change-files-card" />,
}));
vi.mock("@/components/changes/detail/change-review-history-card", () => ({
  ChangeReviewHistoryCard: () => <div data-testid="change-review-history-card" />,
  normalizeReviewHistory: () => [],
}));
vi.mock("@/components/changes/detail/change-sessions-card", () => ({
  ChangeSessionsCard: () => <div data-testid="change-sessions-card" />,
}));
vi.mock("@/components/changes/detail/change-task-board-card", () => ({
  ChangeTaskBoardCard: () => <div data-testid="change-task-board-card" />,
}));
vi.mock("@/components/changes/detail/change-step-timeline", () => ({
  ChangeStepTimeline: () => <div data-testid="change-step-timeline" />,
}));

import {
  DeleteChangeConfirm,
  canDeleteChange,
  changeKeyTail,
} from "@/components/delete-change-confirm";
import ChangesPage from "@/app/(dashboard)/workspaces/[id]/changes/page";
import ChangeDetailPage from "@/app/(dashboard)/workspaces/[id]/changes/[cid]/page";
import MobileChangesPage from "@/app/m/workspaces/[id]/changes/page";
import { MobileWorkspaceContext } from "@/app/m/workspaces/[id]/layout";
import { ApiError } from "@/lib/api";
import { useSession } from "@/stores/session";
import type { ChangeRead, ChangeSummary } from "@/lib/changes";
import type { Workspace } from "@/lib/workspaces";
import type { AgentSessionListItem } from "@/lib/daemon";

// ── fixtures ───────────────────────────────────────────────────────────────

const CHANGE_KEY = "2026-08-29-change-delete-closure-and-spec-pull";
const CHANGE_TAIL = "change-delete-closure-and-spec-pull";

function makeChange(overrides: Partial<ChangeSummary> = {}): ChangeSummary {
  return {
    id: "ch-1",
    change_key: CHANGE_KEY,
    title: "测试变更",
    status: "in_progress",
    location: "active",
    change_type: null,
    affected_components: ["frontend"],
    owner_id: null,
    current_stage: "execute",
    pending_review: null,
    updated_at: "2026-08-29T10:00:00Z",
    ...overrides,
  };
}

function makeDetailChange(over: Partial<ChangeRead> = {}): ChangeRead {
  return {
    id: "ch-1",
    workspace_id: "ws-1",
    change_key: CHANGE_KEY,
    title: "测试变更",
    status: "in_progress",
    location: "active",
    path: `changes/${CHANGE_KEY}`,
    affected_components: ["frontend"],
    change_type: null,
    owner_id: null,
    current_stage: "execute",
    pending_review: null,
    stages: {},
    created_at: "2026-08-29T08:00:00Z",
    updated_at: "2026-08-29T10:00:00Z",
    archived_at: null,
    ...over,
  } as unknown as ChangeRead;
}

function makeWorkspace(): Workspace {
  return {
    id: "ws-1",
    name: "测试工作区",
    slug: "test-ws",
    root_path: "C:/proj",
    status: "active",
    default_agent: null,
    default_model: null,
    owner: { user_id: "u-1", email: "o@t.com", display_name: "O" },
    created_at: "2026-06-30T00:55:11Z",
    last_scanned_at: "2026-06-30T00:55:11Z",
  } as unknown as Workspace;
}

function makeSession(): AgentSessionListItem {
  return {
    id: "sess-12345678",
    provider: "claude",
    status: "active",
    turn_count: 3,
    mode: null,
    author: { user_id: "u-1", display_name: "小明" },
    last_active_at: "2026-08-29T09:00:00Z",
    title: "帮我推进一下这个变更",
  };
}

/** 设置当前登录人（session store）+ fetchMe 角色源。 */
function loginAs(
  user: { id: string; isPlatformAdmin?: boolean },
  workspaceRole = "developer",
) {
  useSession.setState({
    accessToken: "tok",
    hydrated: true,
    user: {
      id: user.id,
      email: `${user.id}@t.com`,
      displayName: user.id,
      is_platform_admin: user.isPlatformAdmin ?? false,
      permissions: [],
    },
  });
  mocks.fetchMe.mockResolvedValue({
    user: { id: user.id, username: user.id, is_platform_admin: user.isPlatformAdmin ?? false },
    workspaces: [
      { workspace_id: "ws-1", role_key: workspaceRole, role_name: workspaceRole },
    ],
    permissions: [],
  });
}

/** 桌面/移动列表共用的 listChanges mock（pageSize=1 → tab 计数，其余 → 主 load）。 */
function setupListChanges(opts: { items?: ChangeSummary[] } = {}) {
  const { items = [] } = opts;
  mocks.listChanges.mockImplementation((_wid: string, params?: any) => {
    if (params?.pageSize === 1) {
      return Promise.resolve({ items: [], total: 0 });
    }
    return Promise.resolve({ items, total: items.length });
  });
  mocks.listQuicklogEntries.mockImplementation(() =>
    Promise.resolve({ items: [], total: 0 }),
  );
  mocks.getWorkspace.mockResolvedValue(makeWorkspace());
}

/** 弹层防呆输入：往确认输入框输入文本。 */
function typeConfirmText(text: string) {
  fireEvent.change(screen.getByTestId("delete-change-confirm-input"), {
    target: { value: text },
  });
}

/** 取第一个删除入口按钮（noUncheckedIndexedAccess 下索引可能 undefined）。 */
function firstDeleteEntry(): HTMLElement {
  const btn = screen.getAllByTestId("change-delete-entry")[0];
  if (!btn) throw new Error("change-delete-entry 未渲染");
  return btn;
}

/** 点删除入口 → 弹层 → 输入末段 → 点确认（页面级删除流程的公共段）。 */
async function confirmDeleteViaModal() {
  await act(async () => {
    fireEvent.click(firstDeleteEntry());
  });
  expect(screen.getByTestId("delete-change-confirm")).toBeInTheDocument();
  typeConfirmText(CHANGE_TAIL);
  const ok = screen.getByRole("button", { name: /确认删除/ });
  expect(ok).not.toBeDisabled();
  await act(async () => {
    fireEvent.click(ok);
  });
}

// ── Tests：纯函数 ──────────────────────────────────────────────────────────

describe("changeKeyTail（末段防呆期望值）", () => {
  it("去 YYYY-MM-DD- 日期前缀，返回末段", () => {
    expect(changeKeyTail(CHANGE_KEY)).toBe(CHANGE_TAIL);
    expect(
      changeKeyTail("2026-08-28-session-ppm-task-binding"),
    ).toBe("session-ppm-task-binding");
  });

  it("非日期前缀 key 原样返回（防御：不误切前 3 段）", () => {
    expect(changeKeyTail("quick-fix-foo")).toBe("quick-fix-foo");
  });
});

describe("canDeleteChange（权限启发式纯函数，后端权威兜底）", () => {
  it("owner 本人可见", () => {
    expect(
      canDeleteChange({ owner_id: "u-1" }, {
        userId: "u-1",
        isPlatformAdmin: false,
        workspaceRole: null,
      }),
    ).toBe(true);
  });

  it("平台管理员全量可见（owner 为空亦可）", () => {
    expect(
      canDeleteChange({ owner_id: null }, {
        userId: "u-9",
        isPlatformAdmin: true,
        workspaceRole: null,
      }),
    ).toBe(true);
  });

  it("工作区所有者全量可见", () => {
    expect(
      canDeleteChange({ owner_id: "someone-else" }, {
        userId: "u-9",
        isPlatformAdmin: false,
        workspaceRole: "workspace_owner",
      }),
    ).toBe(true);
  });

  it("普通成员对他人的变更不可见（owner 为空也不可见）", () => {
    expect(
      canDeleteChange({ owner_id: "someone-else" }, {
        userId: "u-9",
        isPlatformAdmin: false,
        workspaceRole: "developer",
      }),
    ).toBe(false);
    expect(
      canDeleteChange({ owner_id: null }, {
        userId: "u-9",
        isPlatformAdmin: false,
        workspaceRole: "developer",
      }),
    ).toBe(false);
    expect(
      canDeleteChange({ owner_id: "someone-else" }, {
        userId: null,
        isPlatformAdmin: false,
        workspaceRole: null,
      }),
    ).toBe(false);
  });
});

// ── Tests：DeleteChangeConfirm 受控弹层 ────────────────────────────────────

describe("DeleteChangeConfirm 弹层", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("渲染标题/变更名/负责人/不可恢复警示，确认按钮初始禁用", () => {
    render(
      <DeleteChangeConfirm
        target={{ change_key: CHANGE_KEY, owner_name: "qinyi" }}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByText("删除变更")).toBeInTheDocument();
    expect(screen.getByText(CHANGE_KEY)).toBeInTheDocument();
    expect(screen.getByText(/负责人：qinyi/)).toBeInTheDocument();
    expect(
      screen.getByText(/该操作不可恢复：变更将从变更中心移除/),
    ).toBeInTheDocument();
    expect(screen.getByText(/工作区全体成员将不再看到此变更/)).toBeInTheDocument();
    // 输入框 placeholder = 末段（原型 placeholder=change-delete-closure-and-spec-pull）
    expect(screen.getByTestId("delete-change-confirm-input")).toHaveAttribute(
      "placeholder",
      CHANGE_TAIL,
    );
    expect(screen.getByRole("button", { name: /确认删除/ })).toBeDisabled();
  });

  it("输入与末段不符 → 确认仍禁用；完全相等 → 启用并触发 onConfirm", () => {
    const onConfirm = vi.fn();
    render(
      <DeleteChangeConfirm
        target={{ change_key: CHANGE_KEY, owner_name: null }}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    typeConfirmText("不是末段");
    expect(screen.getByRole("button", { name: /确认删除/ })).toBeDisabled();
    // 前缀匹配不算（必须完全相等）
    typeConfirmText(`2026-08-29-${CHANGE_TAIL}`);
    expect(screen.getByRole("button", { name: /确认删除/ })).toBeDisabled();
    // 完全相等 → 启用
    typeConfirmText(CHANGE_TAIL);
    const ok = screen.getByRole("button", { name: /确认删除/ });
    expect(ok).not.toBeDisabled();
    fireEvent.click(ok);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("点取消 → 只走 onCancel，不触发 onConfirm", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <DeleteChangeConfirm
        target={{ change_key: CHANGE_KEY, owner_name: "qinyi" }}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

// ── Tests：桌面列表页操作列 ────────────────────────────────────────────────

describe("桌面列表页删除入口（操作列 + 权限渲染分支）", () => {
  beforeEach(() => {
    setupListChanges();
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    useSession.setState({ user: null, accessToken: null });
  });

  function renderPage() {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0, refetchInterval: false },
        mutations: { retry: false },
      },
    });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const utils = render(
      <QueryClientProvider client={client}>
        <ChangesPage params={{ id: "ws-1" }} />
      </QueryClientProvider>,
    );
    return { ...utils, client, invalidateSpy };
  }

  async function renderAndWait() {
    const utils = renderPage();
    await waitFor(() =>
      expect(screen.getAllByText(/测试工作区/).length).toBeGreaterThan(0),
    );
    return utils;
  }

  it("owner 本人行渲染删除入口；他人变更对普通成员不渲染", async () => {
    setupListChanges({
      items: [
        makeChange({ id: "ch-mine", owner_id: "u-1" }),
        makeChange({ id: "ch-other", owner_id: "u-other" }),
      ],
    });
    loginAs({ id: "u-1" }, "developer");
    await renderAndWait();
    expect(screen.getAllByTestId("change-delete-entry")).toHaveLength(1);
  });

  it("工作区所有者对他人变更也渲染删除入口", async () => {
    setupListChanges({
      items: [makeChange({ owner_id: "u-other" })],
    });
    loginAs({ id: "u-1" }, "workspace_owner");
    await renderAndWait();
    expect(screen.getAllByTestId("change-delete-entry")).toHaveLength(1);
  });

  it("未登录（无 session user）不渲染删除入口", async () => {
    setupListChanges({ items: [makeChange({ owner_id: "u-1" })] });
    await renderAndWait();
    expect(screen.queryAllByTestId("change-delete-entry")).toHaveLength(0);
  });

  it("删除成功 → deleteChange(ws, id) + invalidateQueries(['changes', wsId]) + 成功 toast + 弹层关闭", async () => {
    setupListChanges({ items: [makeChange({ owner_id: "u-1" })] });
    loginAs({ id: "u-1" });
    mocks.deleteChange.mockResolvedValue({
      ok: true,
      backup_dir: "/backups/changes",
      file_count: 12,
    });
    const { invalidateSpy } = await renderAndWait();

    await confirmDeleteViaModal();

    await waitFor(() =>
      expect(mocks.deleteChange).toHaveBeenCalledWith("ws-1", "ch-1"),
    );
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["changes", "ws-1"],
      }),
    );
    expect(mocks.notifySuccess).toHaveBeenCalledWith(
      expect.stringContaining("已删除"),
    );
    await waitFor(() =>
      expect(
        screen.queryByTestId("delete-change-confirm"),
      ).not.toBeInTheDocument(),
    );
  });

  it("删除失败（403 ApiError）→ 错误 toast 中文文案，不白屏，弹层已关", async () => {
    setupListChanges({ items: [makeChange({ owner_id: "u-1" })] });
    loginAs({ id: "u-1" });
    const apiErr = new ApiError(403, {
      code: "PERMISSION_DENIED",
      message: "无权删除该变更：仅变更责任人本人或持有 change:archive 权限的成员可删除。",
      request_id: null,
      details: null,
    });
    mocks.deleteChange.mockRejectedValue(apiErr);
    await renderAndWait();

    await confirmDeleteViaModal();

    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith(
        apiErr,
        expect.stringContaining("删除"),
      ),
    );
    // toast 载荷取 ApiError 中文 message（errMessage 规则，不白屏）
    expect(mocks.notifyError).toHaveBeenCalled();
    expect(
      screen.queryByTestId("delete-change-confirm"),
    ).not.toBeInTheDocument();
  });

  it("弹层取消不触发任何删除请求", async () => {
    setupListChanges({ items: [makeChange({ owner_id: "u-1" })] });
    loginAs({ id: "u-1" });
    await renderAndWait();

    await act(async () => {
      fireEvent.click(firstDeleteEntry());
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "取消" }));
    });
    expect(mocks.deleteChange).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("delete-change-confirm"),
    ).not.toBeInTheDocument();
  });
});

// ── Tests：详情页危险按钮 ──────────────────────────────────────────────────

describe("详情页危险按钮（PageHeader actions）", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    useSession.setState({ user: null, accessToken: null });
  });

  async function renderDetail(change: ChangeRead) {
    mocks.getChange.mockResolvedValue(change);
    mocks.getAgentStatus.mockResolvedValue({
      change_id: "ch-1",
      current_stage: "execute",
      has_active_run: false,
      config_enabled: false,
      last_dispatch: null,
    });
    mocks.listWorkspaceAgentSessions.mockResolvedValue([makeSession()]);
    mocks.getTaskBoard.mockResolvedValue(null);
    mocks.listQuicklogEntries.mockResolvedValue({ items: [], total: 0 });
    mocks.getWorkspace.mockResolvedValue(makeWorkspace());
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0, refetchInterval: false },
        mutations: { retry: false },
      },
    });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    render(
      <QueryClientProvider client={client}>
        <ChangeDetailPage params={{ id: "ws-1", cid: "ch-1" }} />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.getByText(/测试变更/)).toBeInTheDocument(),
    );
    return { client, invalidateSpy };
  }

  it("owner 本人在 PageHeader 右侧看到危险按钮；确认后删除成功跳回列表 + 前缀失效", async () => {
    loginAs({ id: "u-1" });
    mocks.deleteChange.mockResolvedValue({
      ok: true,
      backup_dir: "/backups/changes",
      file_count: 5,
    });
    const { invalidateSpy } = await renderDetail(
      makeDetailChange({ owner_id: "u-1" }),
    );
    expect(screen.getAllByTestId("change-delete-entry")).toHaveLength(1);

    await confirmDeleteViaModal();

    await waitFor(() =>
      expect(mocks.deleteChange).toHaveBeenCalledWith("ws-1", "ch-1"),
    );
    await waitFor(() =>
      expect(mocks.routerPush).toHaveBeenCalledWith("/workspaces/ws-1/changes"),
    );
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["changes", "ws-1"],
      }),
    );
    expect(mocks.notifySuccess).toHaveBeenCalled();
  });

  it("普通成员对他人变更不渲染危险按钮", async () => {
    loginAs({ id: "u-9" }, "developer");
    await renderDetail(makeDetailChange({ owner_id: "u-other" }));
    expect(screen.queryAllByTestId("change-delete-entry")).toHaveLength(0);
  });
});

// ── Tests：移动端镜像页 ────────────────────────────────────────────────────

describe("移动端删除入口（m/workspaces/[id]/changes）", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    useSession.setState({ user: null, accessToken: null });
  });

  function renderMobile() {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0, refetchInterval: false },
        mutations: { retry: false },
      },
    });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    render(
      <QueryClientProvider client={client}>
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
    return { client, invalidateSpy };
  }

  async function renderMobileAndWait() {
    const utils = renderMobile();
    await waitFor(() =>
      expect(screen.getAllByTestId("mobile-change-card").length).toBeGreaterThan(
        0,
      ),
    );
    return utils;
  }

  it("owner 本人行出现「⋯」动作菜单删除入口；普通成员对他人的变更无入口", async () => {
    setupListChanges({
      items: [
        makeChange({ id: "ch-mine", owner_id: "u-1" }),
        makeChange({ id: "ch-other", owner_id: "u-other" }),
      ],
    });
    loginAs({ id: "u-1" }, "developer");
    await renderMobileAndWait();
    // 仅本人行渲染「⋯」（MobileCardList actions 工厂返回空数组则不渲染）
    expect(screen.getByTestId("mobile-card-actions-ch-mine")).toBeDefined();
    expect(
      screen.queryByTestId("mobile-card-actions-ch-other"),
    ).toBeNull();
  });

  it("⋯ → 删除（ActionSheet）→ 同一弹层确认 → deleteChange + 前缀失效 + 成功 toast", async () => {
    setupListChanges({ items: [makeChange({ owner_id: "u-1" })] });
    loginAs({ id: "u-1" });
    mocks.deleteChange.mockResolvedValue({
      ok: true,
      backup_dir: "/backups/changes",
      file_count: 3,
    });
    const { invalidateSpy } = await renderMobileAndWait();

    // 打开「⋯」底部 ActionSheet → 点「删除」
    await act(async () => {
      fireEvent.click(screen.getByTestId("mobile-card-actions-ch-1"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("mobile-action-menu")).toBeInTheDocument(),
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole("menuitem", { name: "删除" }),
      );
    });
    // 复用同一 DeleteChangeConfirm 弹层
    await waitFor(() =>
      expect(screen.getByTestId("delete-change-confirm")).toBeInTheDocument(),
    );
    typeConfirmText(CHANGE_TAIL);
    const ok = screen.getByRole("button", { name: /确认删除/ });
    await act(async () => {
      fireEvent.click(ok);
    });

    await waitFor(() =>
      expect(mocks.deleteChange).toHaveBeenCalledWith("ws-1", "ch-1"),
    );
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["changes", "ws-1"],
      }),
    );
    expect(mocks.notifySuccess).toHaveBeenCalledWith(
      expect.stringContaining("已删除"),
    );
  });
});
