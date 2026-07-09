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
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
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

// ── WorkspaceBindingDialog stub（CB-1 未绑定点击弹窗，task-06 产物）─────────
const bindingDialogMock = vi.hoisted(() => ({ lastOpen: false }));
vi.mock("@/components/workspace-binding-dialog", () => ({
  WorkspaceBindingDialog: (props: {
    workspaceId: string;
    open: boolean;
    onBound: (b: unknown) => void;
    onClose: () => void;
  }) => {
    bindingDialogMock.lastOpen = props.open;
    return props.open ? (
      <div data-testid="binding-dialog" data-workspace={props.workspaceId}>
        <button data-testid="binding-close" onClick={() => props.onClose()}>
          关闭
        </button>
        <button
          data-testid="binding-bound"
          onClick={() => {
            props.onBound({ workspace_id: props.workspaceId, daemon_id: "d-1" });
          }}
        >
          模拟绑定成功
        </button>
      </div>
    ) : null;
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
}));
vi.mock("@/lib/workspaces", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspaces")>("@/lib/workspaces");
  return {
    ...actual,
    listWorkspaces: workspacesApi.listWorkspaces,
    updateWorkspace: workspacesApi.updateWorkspace,
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

vi.mock("@/lib/errors", () => ({
  useNotify: () => ({ success: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));

// ── fixtures ────────────────────────────────────────────────────────────────
function mkWorkspace(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    display_alias: null,
    slug: id,
    root_path: `/srv/${id}`,
    path_source: "daemon-client",
    daemon_runtime_id: null,
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
  daemonApi.listDaemonRuntimes.mockResolvedValue([]);
  daemonApi.listDaemonInstances.mockResolvedValue([]);
  bindingApi.fetchMyBindings.mockResolvedValue([]);
  adminApi.listUsers.mockResolvedValue({ items: [], total: 0 });
});

afterEach(() => {
  cleanup();
  cardMock.lastProps = null;
  bindingDialogMock.lastOpen = false;
  vi.restoreAllMocks();
});

describe("WorkspacesPage 选择器改造 (task-07)", () => {
  it("D-001：顶部渲染「平台管理」「系统设置」旁路链接，href=/admin /settings", async () => {
    renderPage(<WorkspacesPage />);
    const adminLink = await screen.findByRole("link", { name: "平台管理" });
    const settingsLink = screen.getByRole("link", { name: "系统设置" });
    expect(adminLink).toHaveAttribute("href", "/admin");
    expect(settingsLink).toHaveAttribute("href", "/settings");
  });

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

  it("CB-1：未绑定工作区（daemon_id null）点击 → 弹 WorkspaceBindingDialog，不跳转", async () => {
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
    // 徽标透传：未绑定 → unbound
    expect(cardMock.lastProps?.daemonStatus).toBe("unbound");

    // 整卡点击 → 弹绑定弹窗，不跳转
    fireEvent.click(screen.getByTestId("card-activate"));
    expect(nav.push).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId("binding-dialog")).toBeInTheDocument());
    expect(screen.getByTestId("binding-dialog")).toHaveAttribute("data-workspace", "ws-free");
  });

  it("AC-5：绑定弹窗 onBound → 关窗 + reload 刷新徽标状态", async () => {
    workspacesApi.listWorkspaces.mockResolvedValue({
      items: [mkWorkspace("ws-rebind")],
      total: 1,
    });
    statusApi.statusMap = {
      "ws-rebind": { daemon_id: null, online: false, status: null },
    };

    renderPage(<WorkspacesPage />);
    await waitFor(() =>
      expect(screen.getByTestId("ws-card-ws-rebind")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("card-activate"));
    await waitFor(() => expect(screen.getByTestId("binding-dialog")).toBeInTheDocument());

    // 模拟 task-06 绑定成功回调
    fireEvent.click(screen.getByTestId("binding-bound"));

    // 弹窗关闭 + listWorkspaces 再调（reload 刷新徽标）
    await waitFor(() =>
      expect(workspacesApi.listWorkspaces).toHaveBeenCalledTimes(2),
    );
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
});
