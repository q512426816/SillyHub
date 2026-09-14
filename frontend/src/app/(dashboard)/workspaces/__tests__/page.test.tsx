/**
 * task-07（2026-07-09-workspace-prioritization）：/workspaces 列表页改造为选择器。
 *
 * page 层职责（本测试覆盖）：
 *   - 顶部后台旁路入口（D-001）：「平台管理」「系统设置」链接 href=/admin /settings
 *   - daemon 状态徽标透传（消费 task-03 useDaemonStatusMap → WorkspaceCard daemonStatus prop）
 *   - 空状态创建引导（D-004 / AC-3）：无工作区显「你还没有任何工作区」+ 创建按钮
 *   - 卡片点击分流（CB-1）：已绑定→router.push 详情；未绑定→弹 WorkspaceBindingDialog
 *
 * WorkspaceCard / WorkspaceBindingDialog / WorkspaceScanDialog 内部行为由各自单测覆盖，
 * 这里 mock 为 stub（透传关键 props）以隔离 page 层分流逻辑。
 */
import { act, cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import WorkspacesPage from "@/app/(dashboard)/workspaces/page";

// ── next/link mock（旁路入口用 Link，断言 href）─────────────────────────────
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href} data-testid="next-link">
      {children}
    </a>
  ),
}));

// ── next/navigation mock（page 用 useRouter 分流跳转）────────────────────────
const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// ── WorkspaceCard stub（透传 daemonStatus + onActivate，暴露给断言）──────────
const cardMock = vi.hoisted(() => ({
  lastProps: null as null | {
    workspaceId: string;
    daemonStatus?: string;
    onActivate?: () => void;
  },
}));
vi.mock("@/components/workspace-card", () => ({
  WorkspaceCard: (props: {
    workspace: { id: string };
    daemonStatus?: string;
    onActivate?: () => void;
  }) => {
    cardMock.lastProps = {
      workspaceId: props.workspace.id,
      daemonStatus: props.daemonStatus,
      onActivate: props.onActivate,
    };
    return (
      <div data-testid={`ws-card-${props.workspace.id}`}>
        <span data-testid="card-daemon-status">{props.daemonStatus ?? "none"}</span>
        <button
          data-testid="card-activate"
          onClick={() => props.onActivate?.()}
        >
          模拟整卡点击
        </button>
      </div>
    );
  },
}));


// ── WorkspaceScanDialog stub（page 用 {showDialog && <Dialog/>} 控制挂载；
//    被渲染即代表 open=true，stub 据此断言「创建按钮点击 → page 挂载弹窗」）─────
vi.mock("@/components/workspace-scan-dialog", () => ({
  WorkspaceScanDialog: (props: { onCreated: () => void; onCancel: () => void }) => (
    <div data-testid="scan-dialog">
      <button data-testid="scan-cancel" onClick={() => props.onCancel()}>
        取消
      </button>
    </div>
  ),
}));

// ── lib mocks ───────────────────────────────────────────────────────────────
const statusApi = vi.hoisted(() => ({
  statusMap: {} as Record<string, unknown>,
}));
vi.mock("@/lib/workspace-daemon-status", () => ({
  useDaemonStatusMap: () => ({
    statusMap: statusApi.statusMap,
    isLoading: false,
    isError: false,
  }),
}));

const workspacesApi = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
  updateWorkspace: vi.fn(),
  moveWorkspace: vi.fn(),
}));
vi.mock("@/lib/workspaces", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspaces")>("@/lib/workspaces");
  return {
    ...actual,
    listWorkspaces: workspacesApi.listWorkspaces,
    updateWorkspace: workspacesApi.updateWorkspace,
    moveWorkspace: workspacesApi.moveWorkspace,
  };
});

const daemonApi = vi.hoisted(() => ({
  listDaemonRuntimes: vi.fn(),
  listDaemonInstances: vi.fn(),
}));
vi.mock("@/lib/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/lib/daemon")>("@/lib/daemon");
  return {
    ...actual,
    listDaemonRuntimes: daemonApi.listDaemonRuntimes,
    listDaemonInstances: daemonApi.listDaemonInstances,
  };
});

const bindingApi = vi.hoisted(() => ({ fetchMyBindings: vi.fn() }));
vi.mock("@/lib/workspace-binding", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/workspace-binding")>("@/lib/workspace-binding");
  return { ...actual, fetchMyBindings: bindingApi.fetchMyBindings };
});

const adminApi = vi.hoisted(() => ({ listUsers: vi.fn() }));
vi.mock("@/lib/admin", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin")>("@/lib/admin");
  return { ...actual, listUsers: adminApi.listUsers };
});

vi.mock("@/stores/session", () => ({
  useSession: (sel: (s: { user?: { is_platform_admin?: boolean } }) => unknown) =>
    sel({ user: { is_platform_admin: false } }),
}));

// ── @/lib/errors mock（task-09：handleRequestMove 用 notify.warning 拦截筛选态、
//    move 流程用 notify.success/error——hoisted 暴露给断言）──────────────────────
const notifyMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));
vi.mock("@/lib/errors", () => ({
  useNotify: () => notifyMock,
}));

// ── WorkspaceDragGrid stub（task-10 增补）：透传 items/page/total/dragDisabled/
//    onRequestMove/onMoved 暴露给断言；卡片经既有 WorkspaceCard stub 逐张渲染
//    （cardProps 由 page 组装），保持旧用例 ws-card-*/card-activate 断言不变。──
const gridMock = vi.hoisted(() => ({
  lastProps: null as null | Record<string, unknown>,
  /** 模拟「移动到…」入口点击的卡片下标（items[moveIndex]） */
  moveIndex: 0,
}));
vi.mock("@/components/workspace-drag-grid", async () => {
  const card = await import("@/components/workspace-card");
  return {
    WorkspaceDragGrid: (props: any) => {
      gridMock.lastProps = props;
      return (
        <div data-testid="drag-grid">
          {props.items.map((w: any) => (
            <card.WorkspaceCard key={w.id} workspace={w} {...props.cardProps(w)} />
          ))}
          <button
            data-testid="grid-move-entry"
            onClick={() => props.onRequestMove?.(props.items[gridMock.moveIndex ?? 0])}
          >
            模拟移动到入口
          </button>
        </div>
      );
    },
  };
});

// ── WorkspaceMoveDialog stub（task-10 增补）：受控弹窗透传 open/workspace/
//    currentPage/totalPages/disabled；确认按钮按 confirmTarget 触发 onConfirm
//    （四象限/自锚提交流程逻辑在 page.tsx handleMoveConfirm，此处只做透传）。──
const moveDialogMock = vi.hoisted(() => ({
  lastProps: null as null | Record<string, unknown>,
  confirmTarget: { page: 0, position: "first" as "first" | "last" },
}));
vi.mock("@/components/workspace-move-dialog", () => ({
  WorkspaceMoveDialog: (props: any) => {
    moveDialogMock.lastProps = props;
    if (!props.open) return null;
    return (
      <div data-testid="move-dialog">
        <button
          data-testid="move-dialog-confirm"
          onClick={() => props.onConfirm(moveDialogMock.confirmTarget)}
        >
          确认移动
        </button>
      </div>
    );
  },
}));

// ── fixtures ────────────────────────────────────────────────────────────────
function mkWorkspace(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    display_alias: null,
    slug: id,
    root_path: `/srv/${id}`,
    status: "active",
    component_key: null,
    type: null,
    role: null,
    repo_url: null,
    default_branch: null,
    default_agent: null,
    default_model: null,
    tech_stack: [],
    build_command: null,
    test_command: null,
    source_yaml_path: null,
    created_by: null,
    created_at: "2026-07-09T00:00:00Z",
    updated_at: "2026-07-09T00:00:00Z",
    last_scanned_at: null,
    deleted_at: null,
    owner: null,
    ...overrides,
  } as never;
}

function renderPage(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, refetchInterval: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  nav.push = vi.fn();
  nav.replace = vi.fn();
  statusApi.statusMap = {};
  workspacesApi.listWorkspaces.mockResolvedValue({ items: [], total: 0 });
  workspacesApi.updateWorkspace.mockResolvedValue(mkWorkspace("x"));
  // task-10：moveWorkspace 默认成功（rank 可按用例 mockResolvedValueOnce 覆盖）。
  workspacesApi.moveWorkspace.mockResolvedValue({
    workspace: mkWorkspace("x"),
    rebalanced: false,
    rank: 0,
  });
  daemonApi.listDaemonRuntimes.mockResolvedValue([]);
  daemonApi.listDaemonInstances.mockResolvedValue([]);
  bindingApi.fetchMyBindings.mockResolvedValue([]);
  adminApi.listUsers.mockResolvedValue({ items: [], total: 0 });
  // task-10：grid/dialog stub 状态复位（clearMocks 只清 vi.fn 调用计数）。
  gridMock.lastProps = null;
  gridMock.moveIndex = 0;
  moveDialogMock.lastProps = null;
  moveDialogMock.confirmTarget = { page: 0, position: "first" };
});

afterEach(() => {
  cleanup();
  cardMock.lastProps = null;
  vi.restoreAllMocks();
});

describe("WorkspacesPage 选择器改造 (task-07)", () => {
  // ql-20260821-007：平台管理/系统设置旁路链接已按用户反馈删除（顶部菜单另有入口），用例移除。

  it("D-004 / AC-3：无工作区时显示创建引导 + 「创建工作区」按钮（点击开扫描弹窗）", async () => {
    renderPage(<WorkspacesPage />);
    await waitFor(() =>
      expect(screen.getByText("你还没有任何工作区")).toBeInTheDocument(),
    );
    const createBtn = screen.getByRole("button", { name: /创建工作区/ });
    fireEvent.click(createBtn);
    // 点击 → setShowDialog(true) → WorkspaceScanDialog stub 渲染
    await waitFor(() => expect(screen.getByTestId("scan-dialog")).toBeInTheDocument());
  });

  it("CB-1：已绑定工作区（daemon_id 非空）点击 → router.push('/workspaces/{id}')", async () => {
    workspacesApi.listWorkspaces.mockResolvedValue({
      items: [mkWorkspace("ws-bound")],
      total: 1,
    });
    // task-03 statusMap：已绑定 + 在线
    statusApi.statusMap = {
      "ws-bound": { daemon_id: "d-1", online: true, status: "online" },
    };

    renderPage(<WorkspacesPage />);
    await waitFor(() =>
      expect(screen.getByTestId("ws-card-ws-bound")).toBeInTheDocument(),
    );
    // 徽标透传：已绑定在线 → online
    expect(cardMock.lastProps?.daemonStatus).toBe("online");

    // 整卡点击 → router.push 详情
    fireEvent.click(screen.getByTestId("card-activate"));
    expect(nav.push).toHaveBeenCalledWith("/workspaces/ws-bound");
    // 未弹绑定弹窗
    expect(screen.queryByTestId("binding-dialog")).not.toBeInTheDocument();
  });

  it("CB-1：未绑定工作区（daemon_id null）点击 → 直接 router.push 详情（2026-07-26-ungate-workspace-entry 门禁后移，不弹 Dialog）", async () => {
    workspacesApi.listWorkspaces.mockResolvedValue({
      items: [mkWorkspace("ws-free")],
      total: 1,
    });
    // task-03 statusMap：未绑定
    statusApi.statusMap = {
      "ws-free": { daemon_id: null, online: false, status: null },
    };

    renderPage(<WorkspacesPage />);
    await waitFor(() =>
      expect(screen.getByTestId("ws-card-ws-free")).toBeInTheDocument(),
    );
    // 徽标透传：未绑定 → unbound（仅展示，不阻断进门）
    expect(cardMock.lastProps?.daemonStatus).toBe("unbound");

    // 门禁后移：整卡点击 → 直接进详情，不弹绑定弹窗
    fireEvent.click(screen.getByTestId("card-activate"));
    expect(nav.push).toHaveBeenCalledWith("/workspaces/ws-free");
    expect(screen.queryByTestId("binding-dialog")).not.toBeInTheDocument();
  });

  it("D-005：daemon 离线卡片徽标=offline，仍可点击进入（仅显示不阻断）", async () => {
    workspacesApi.listWorkspaces.mockResolvedValue({
      items: [mkWorkspace("ws-offline")],
      total: 1,
    });
    statusApi.statusMap = {
      "ws-offline": { daemon_id: "d-2", online: false, status: "offline" },
    };

    renderPage(<WorkspacesPage />);
    await waitFor(() =>
      expect(screen.getByTestId("ws-card-ws-offline")).toBeInTheDocument(),
    );
    // 离线徽标
    expect(cardMock.lastProps?.daemonStatus).toBe("offline");
    // 离线仍可点击进入（daemon_id 非空 → push 详情）
    fireEvent.click(screen.getByTestId("card-activate"));
    expect(nav.push).toHaveBeenCalledWith("/workspaces/ws-offline");
  });

  it("ql-20260829-008：默认只拉活跃工作区（status=active）；切「全部状态」后不带 status", async () => {
    workspacesApi.listWorkspaces.mockResolvedValue({
      items: [mkWorkspace("ws-live")],
      total: 1,
    });

    renderPage(<WorkspacesPage />);
    await waitFor(() =>
      expect(screen.getByTestId("ws-card-ws-live")).toBeInTheDocument(),
    );
    // 首载即带 status: "active"——归档行默认不进列表（用户需求：页面默认只展示活跃）。
    expect(workspacesApi.listWorkspaces).toHaveBeenCalledWith(
      expect.objectContaining({ status: "active" }),
    );

    // 切「全部状态」（value=""）→ status 归 undefined 重新拉取。
    // antd Select 非 select 原生控件：fireEvent.change 不触发 onChange，按
    // antd RTL 惯例 mouseDown 展开下拉 + 点选选项（portal 渲染）。
    fireEvent.mouseDown(screen.getByLabelText("筛选状态"));
    fireEvent.click(await screen.findByText("全部状态"));
    await waitFor(() =>
      expect(workspacesApi.listWorkspaces).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: undefined }),
      ),
    );
  });
});

// task-10（2026-09-14-workspace-drag-sort）：拖拽排序 page 层接线与不变量。
//
// page 层职责（本组覆盖，对照 requirements FR-06/07/08 与任务卡 task-10 ⑤⑦⑧）：
//   - filtersActive 透传 WorkspaceDragGrid.dragDisabled（默认视图 false / 任一筛选激活 true）
//     + 筛选条禁拖提示 + 「移动到…」入口拦截（警告、不弹窗、零 move 调用）
//   - 「移动到…」弹窗提交流程（handleMoveConfirm）：先拉目标页默认视图 → 方向锚点
//     四象限（页首：向上 before/向下 after=目标页第一张；页尾对偶；同页页首 before/
//     页尾 after）→ moveWorkspace 携 page_size=12；锚点=被移动卡自身时跳过请求
//   - 分页数量不变量前端侧（D-014@v1）：move 成功 reload 后 limit 恒 12、total
//     不变、满页恒 12 张（末页允许不满）、无重复 id
// WorkspaceDragGrid / WorkspaceMoveDialog 内部交互由 workspace-drag-grid.test.tsx
// 覆盖，这里 mock 为 stub 断言接线（任务卡 task-10 ⑧ 指定做法）。
describe("WorkspacesPage 拖拽排序接线 (task-09/task-10)", () => {
  /** 26 条 fixture → 3 页（12/12/2），mock 返回可控 total 支撑分页不变量断言。 */
  function mockPagedList(count: number) {
    const fixture = Array.from(
      { length: count },
      (_, i) => mkWorkspace(`w-${String(i).padStart(2, "0")}`),
    );
    workspacesApi.listWorkspaces.mockImplementation(
      async (params?: { offset?: number; limit?: number }) => {
        const offset = params?.offset ?? 0;
        const limit = params?.limit ?? 12;
        return { items: fixture.slice(offset, offset + limit), total: fixture.length };
      },
    );
    return fixture;
  }

  /** 当前页翻到第 2 页（0 基 page=1）——四象限/同页/自锚都以当前页 1 为基准。 */
  async function gotoPage1() {
    fireEvent.click(screen.getByLabelText("下一页"));
    await waitFor(() =>
      expect(workspacesApi.listWorkspaces).toHaveBeenLastCalledWith(
        expect.objectContaining({ offset: 12 }),
      ),
    );
  }

  it("FR-07/D-005@v2：默认视图 dragDisabled=false 透传，无禁拖提示；「移动到…」入口打开弹窗", async () => {
    mockPagedList(3);
    renderPage(<WorkspacesPage />);
    await waitFor(() => expect(screen.getByTestId("drag-grid")).toBeInTheDocument());
    expect((gridMock.lastProps as { dragDisabled?: boolean }).dragDisabled).toBe(false);
    expect(screen.queryByText(/筛选状态下不可拖拽排序/)).not.toBeInTheDocument();

    // 「移动到…」入口 → 打开弹窗（workspace=被移动卡，当前页/总页数/禁用态透传）。
    gridMock.moveIndex = 0;
    fireEvent.click(screen.getByTestId("grid-move-entry"));
    await waitFor(() => expect(screen.getByTestId("move-dialog")).toBeInTheDocument());
    expect((moveDialogMock.lastProps as { workspace?: { id: string } }).workspace?.id).toBe(
      "w-00",
    );
    expect((moveDialogMock.lastProps as { currentPage?: number }).currentPage).toBe(0);
    expect((moveDialogMock.lastProps as { totalPages?: number }).totalPages).toBe(1);
    expect((moveDialogMock.lastProps as { disabled?: boolean }).disabled).toBe(false);
  });

  it("FR-07/D-005@v2：任一筛选激活 → dragDisabled=true + 禁拖提示；入口仅警告不弹窗、零 move 调用", async () => {
    mockPagedList(3);
    renderPage(<WorkspacesPage />);
    await waitFor(() => expect(screen.getByTestId("drag-grid")).toBeInTheDocument());

    // 激活类型筛选（antd Select：mouseDown 展开下拉 + 点选选项）。
    fireEvent.mouseDown(screen.getByLabelText("筛选类型"));
    fireEvent.click(await screen.findByText("前端代码"));
    await waitFor(() =>
      expect((gridMock.lastProps as { dragDisabled?: boolean }).dragDisabled).toBe(true),
    );
    // 筛选条出现禁拖提示（FR-07 中文文案）。
    expect(screen.getByText(/筛选状态下不可拖拽排序/)).toBeInTheDocument();

    // 「移动到…」入口拦截：警告提示 + 不弹窗 + 不发任何 move 请求。
    fireEvent.click(screen.getByTestId("grid-move-entry"));
    expect(notifyMock.warning).toHaveBeenCalledWith(
      expect.stringContaining("筛选状态下不可拖拽排序"),
    );
    expect(screen.queryByTestId("move-dialog")).not.toBeInTheDocument();
    expect(workspacesApi.moveWorkspace).not.toHaveBeenCalled();
    // 弹窗确认按钮禁用兜底（disabled 随 filtersActive 透传，D-005@v2）。
    expect((moveDialogMock.lastProps as { disabled?: boolean }).disabled).toBe(true);
  });

  // 四象限 + 同页方向锚点用例表（目标页 / 页内位置 / 期望 move 锚点）。
  const quadrantCases: ReadonlyArray<
    [string, number, "first" | "last", { before_id?: string; after_id?: string }]
  > = [
    ["向上页首：before_id=目标页第一张", 0, "first", { before_id: "w-00" }],
    ["向上页尾：before_id=目标页最后一张", 0, "last", { before_id: "w-11" }],
    ["向下页首：after_id=目标页第一张", 2, "first", { after_id: "w-24" }],
    ["向下页尾：after_id=目标页最后一张", 2, "last", { after_id: "w-25" }],
    ["同页页首：before_id=当前页第一张", 1, "first", { before_id: "w-12" }],
    ["同页页尾：after_id=当前页最后一张", 1, "last", { after_id: "w-23" }],
  ];
  it.each(quadrantCases)(
    "FR-06/D-009@v2 弹窗方向锚点 %s（提交前先拉目标页，move 携 page_size=12）",
    async (_name, targetPage, position, expectedAnchor) => {
      const fixture = mockPagedList(26);
      renderPage(<WorkspacesPage />);
      await waitFor(() =>
        expect(screen.getAllByTestId(/ws-card-/)).toHaveLength(12),
      );
      await gotoPage1();

      // 被移动卡 = 当前页第 2 张（w-13，与各象限锚点均不同，避开自锚分支）。
      gridMock.moveIndex = 1;
      fireEvent.click(screen.getByTestId("grid-move-entry"));
      await waitFor(() => expect(screen.getByTestId("move-dialog")).toBeInTheDocument());
      expect((moveDialogMock.lastProps as { workspace?: { id: string } }).workspace?.id).toBe(
        "w-13",
      );

      moveDialogMock.confirmTarget = { page: targetPage, position };
      workspacesApi.moveWorkspace.mockResolvedValueOnce({
        workspace: fixture[13],
        rebalanced: false,
        rank: 5,
      });
      fireEvent.click(screen.getByTestId("move-dialog-confirm"));
      await waitFor(() =>
        expect(workspacesApi.moveWorkspace).toHaveBeenCalledTimes(1),
      );
      // 锚点方向规则 + page_size 携带（FR-06 / D-009@v2）逐字段断言。
      expect(workspacesApi.moveWorkspace).toHaveBeenCalledWith("w-13", {
        ...expectedAnchor,
        page_size: 12,
      });
      // 提交前先拉目标页默认视图（offset=目标页*12 的 active 拉取发生在 move 之前）。
      const moveOrder = workspacesApi.moveWorkspace.mock.invocationCallOrder[0]!;
      const fetchedTargetPageBeforeMove = workspacesApi.listWorkspaces.mock.calls.some(
        (call, i) =>
          workspacesApi.listWorkspaces.mock.invocationCallOrder[i]! < moveOrder &&
          call[0]?.offset === targetPage * 12 &&
          call[0]?.limit === 12 &&
          call[0]?.status === "active",
      );
      expect(fetchedTargetPageBeforeMove).toBe(true);
      // move 成功后 reload 收敛服务端真序（D-014：重取列表而非本地增删卡）。
      await waitFor(() =>
        expect(workspacesApi.listWorkspaces.mock.calls.length).toBeGreaterThan(3),
      );
      expect(notifyMock.success).toHaveBeenCalledWith("已移动到目标页");
    },
  );

  it("FR-06 自锚跳过：锚点=被移动卡自身 → moveWorkspace 零调用 + 提示已在位 + 弹窗关闭", async () => {
    mockPagedList(26);
    renderPage(<WorkspacesPage />);
    await waitFor(() => expect(screen.getAllByTestId(/ws-card-/)).toHaveLength(12));
    await gotoPage1();

    // 被移动卡 = 当前页最后一张 w-23；目标=同页页尾 → 锚点即自身。
    gridMock.moveIndex = 11;
    fireEvent.click(screen.getByTestId("grid-move-entry"));
    await waitFor(() => expect(screen.getByTestId("move-dialog")).toBeInTheDocument());
    moveDialogMock.confirmTarget = { page: 1, position: "last" };
    fireEvent.click(screen.getByTestId("move-dialog-confirm"));
    await waitFor(() =>
      expect((moveDialogMock.lastProps as { open?: boolean }).open).toBe(false),
    );
    expect(workspacesApi.moveWorkspace).not.toHaveBeenCalled();
    expect(notifyMock.success).toHaveBeenCalledWith("工作区已在该位置");
  });

  it("FR-08/D-014@v1 分页数量不变量：move 后 reload 每页恒 12（末页允许不满）、total 不变、无重复 id", async () => {
    mockPagedList(26);
    renderPage(<WorkspacesPage />);
    await waitFor(() => expect(screen.getAllByTestId(/ws-card-/)).toHaveLength(12));
    expect(screen.getByText("共 26 条 · 第 1 页")).toBeInTheDocument();
    expect((screen.getByLabelText("上一页") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("下一页") as HTMLButtonElement).disabled).toBe(false);

    // 第 2 页：满页 12 张、无重复 id。
    await gotoPage1();
    await waitFor(() => expect(screen.getAllByTestId(/ws-card-/)).toHaveLength(12));
    const page1Ids = (
      (gridMock.lastProps as { items: { id: string }[] }).items ?? []
    ).map((w) => w.id);
    expect(page1Ids).toHaveLength(12);
    expect(new Set(page1Ids).size).toBe(12);
    expect((gridMock.lastProps as { total?: number }).total).toBe(26);

    // 第 3 页（末页）：允许不满（26-24=2），total 不变，下一页禁用。
    fireEvent.click(screen.getByLabelText("下一页"));
    await waitFor(() =>
      expect(workspacesApi.listWorkspaces).toHaveBeenLastCalledWith(
        expect.objectContaining({ offset: 24 }),
      ),
    );
    await waitFor(() => expect(screen.getAllByTestId(/ws-card-/)).toHaveLength(2));
    expect((gridMock.lastProps as { total?: number }).total).toBe(26);
    expect((screen.getByLabelText("下一页") as HTMLButtonElement).disabled).toBe(true);

    // 模拟 move 成功（onMoved 上抛 rank→page=1）→ 翻页 reload：limit 仍恒 12。
    fireEvent.click(screen.getByLabelText("上一页")); // 便于区分 onMoved 触发的 reload
    await waitFor(() =>
      expect(workspacesApi.listWorkspaces).toHaveBeenLastCalledWith(
        expect.objectContaining({ offset: 12 }),
      ),
    );
    const callsBefore = workspacesApi.listWorkspaces.mock.calls.length;
    act(() => {
      (
        (gridMock.lastProps as { onMoved?: (e: unknown) => void }).onMoved as (
          e: unknown,
        ) => void
      )?.({ id: "w-00", rank: 15, page: 1 });
    });
    await waitFor(() =>
      expect(workspacesApi.listWorkspaces.mock.calls.length).toBeGreaterThan(callsBefore),
    );
    expect(workspacesApi.listWorkspaces).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 12, offset: 12 }),
    );
    await waitFor(() => expect(screen.getAllByTestId(/ws-card-/)).toHaveLength(12));

    // 不变量收口：全流程每一次列表请求 limit 恒 WORKSPACE_PAGE_SIZE(12)。
    for (const call of workspacesApi.listWorkspaces.mock.calls) {
      expect(call[0]).toMatchObject({ limit: 12 });
    }
  });
});
