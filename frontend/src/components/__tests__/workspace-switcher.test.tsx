// task-08（2026-07-09-workspace-prioritization / FR-04 / D-002 / D-005 / D-003）
// WorkspaceSwitcher 顶栏工作区切换器组件单测。
//
// mock 上游契约（task-03/04/06 + 列表数据），仅测本组件行为：
//   - 当前 ws 名 + daemon 徽标显示（在线/离线/平台页引导态）
//   - current.name 空时用列表数据填充（task-04 留空，本组件补全）
//   - 下拉展开列出可切换工作区，每项带 daemon 状态
//   - 已绑定项点击 → switchWorkspace(id)（task-04，D-002 切同模块）
//   - 未绑定项点击 → 打开 WorkspaceBindingDialog（task-06，D-003）
//   - daemon 离线项可点击（D-005 仅标红不阻断）
//   - 平台页（workspaceId=null）显示「选择工作区」引导态
//   - 「查看全部工作区」跳 /workspaces
//
// Radix DropdownMenu 在 jsdom 下需 pointer capture polyfill + pointerDown/Up
// 事件序列触发 open/onSelect（标准 click 不触发 Radix 内部指针逻辑），见文件内
// openMenu()/clickItem() helper。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

// Radix DropdownMenu 在 jsdom 下需 pointer capture polyfill 才能 open。
// 局部补丁（不改全局 setup.ts），不影响其他测试。
if (!(Element.prototype as any).hasPointerCapture) {
  (Element.prototype as any).hasPointerCapture = () => false;
  (Element.prototype as any).setPointerCapture = () => {};
  (Element.prototype as any).releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// ── mock @/lib/use-workspace-context（task-04 契约） ──
const mockSwitchWorkspace = vi.fn();
const mockUseWorkspaceContext = vi.fn();
vi.mock("@/lib/use-workspace-context", () => ({
  useWorkspaceContext: (...args: unknown[]) => mockUseWorkspaceContext(...args),
}));

// ── mock @/lib/workspace-daemon-status（task-03 契约） ──
const mockUseDaemonStatusMap = vi.fn();
vi.mock("@/lib/workspace-daemon-status", () => ({
  useDaemonStatusMap: (...args: unknown[]) => mockUseDaemonStatusMap(...args),
}));

// ── mock @/lib/workspaces（列表数据，拿 workspace name） ──
vi.mock("@/lib/workspaces", () => ({
  listWorkspaces: vi.fn(),
}));

// ── mock @/lib/workspace-binding（fetchMyBindings 列表） ──
vi.mock("@/lib/workspace-binding", () => ({
  fetchMyBindings: vi.fn(),
}));

// ── mock WorkspaceBindingDialog（task-06），只验 open/workspaceId 透传 ──
let lastDialogProps: { workspaceId: string; open: boolean } | null = null;
vi.mock("@/components/workspace-binding-dialog", () => ({
  WorkspaceBindingDialog: (props: {
    workspaceId: string;
    open: boolean;
    onBound: (b: unknown) => void;
    onClose: () => void;
  }) => {
    lastDialogProps = { workspaceId: props.workspaceId, open: props.open };
    return props.open ? (
      <div data-testid="binding-dialog-stub">
        <button
          type="button"
          data-testid="dialog-confirm-bound"
          onClick={() =>
            props.onBound({ workspace_id: props.workspaceId, daemon_id: "d-x" })
          }
        >
          模拟绑定成功
        </button>
      </div>
    ) : null;
  },
}));

// ── mock next/navigation（switchWorkspace 内部用 router.push） ──
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/workspaces/ws-a/changes",
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { listWorkspaces, type Workspace } from "@/lib/workspaces";
import {
  fetchMyBindings,
  type MemberBindingView,
} from "@/lib/workspace-binding";

import { WorkspaceSwitcher } from "@/components/workspace-switcher";

const mockedList = vi.mocked(listWorkspaces);
const mockedBindings = vi.mocked(fetchMyBindings);

function mkWorkspace(o: Partial<Workspace> & { id: string }): Workspace {
  return {
    id: o.id,
    name: o.name ?? "未命名",
    display_alias: o.display_alias ?? null,
    slug: o.slug ?? o.id,
    root_path: o.root_path ?? "/tmp",
    path_source: o.path_source ?? "server-local",
    daemon_runtime_id: o.daemon_runtime_id ?? null,
    status: o.status ?? "active",
    component_key: o.component_key ?? null,
    type: o.type ?? null,
    role: o.role ?? null,
    repo_url: o.repo_url ?? null,
    default_branch: o.default_branch ?? null,
    default_agent: o.default_agent ?? null,
    default_model: o.default_model ?? null,
    tech_stack: o.tech_stack ?? [],
    build_command: o.build_command ?? null,
    test_command: o.test_command ?? null,
    source_yaml_path: o.source_yaml_path ?? null,
    created_by: o.created_by ?? null,
    created_at: o.created_at ?? "2026-01-01T00:00:00Z",
    updated_at: o.updated_at ?? "2026-01-01T00:00:00Z",
    last_scanned_at: o.last_scanned_at ?? null,
    deleted_at: o.deleted_at ?? null,
    owner: o.owner ?? null,
  };
}

function mkBinding(
  o: Partial<MemberBindingView> & { workspace_id: string },
): MemberBindingView {
  return {
    workspace_id: o.workspace_id,
    user_id: o.user_id ?? "user-1",
    runtime_id: o.runtime_id ?? null,
    daemon_id: o.daemon_id ?? null,
    root_path: o.root_path ?? "/tmp",
    path_source: o.path_source ?? "daemon-client",
    synced_at: o.synced_at ?? null,
    last_scan_at: o.last_scan_at ?? null,
    init_synced_at: o.init_synced_at ?? null,
  } as MemberBindingView;
}

function withQueryClient(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

function setupCtx(overrides: {
  workspaceId?: string | null;
  currentName?: string;
  daemonOnline?: boolean;
}) {
  // 注意：workspaceId 可显式传 null（平台页），用 nullish 但区分 undefined
  const wsId =
    overrides.workspaceId === undefined ? "ws-a" : overrides.workspaceId;
  mockUseWorkspaceContext.mockReturnValue({
    workspaceId: wsId,
    current: wsId
      ? {
          id: wsId,
          name: overrides.currentName ?? "",
          daemon_id: overrides.daemonOnline ? "d-a" : null,
          daemon_online: overrides.daemonOnline ?? true,
        }
      : null,
    daemonOnline: overrides.daemonOnline ?? true,
    switchWorkspace: mockSwitchWorkspace,
  });
}

function setupStatus(
  entries: Record<string, { daemon_id: string | null; online: boolean }>,
) {
  mockUseDaemonStatusMap.mockReturnValue({
    statusMap: entries,
    isLoading: false,
    isError: false,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  lastDialogProps = null;
});

/** 打开下拉菜单（Radix Trigger 监听 keydown Enter/Space open，pointer/click 在
 *  jsdom 下不生效——实测 keyDown 最稳）。 */
async function openMenu() {
  const trigger = screen.getByRole("button", { name: /切换工作区/ });
  fireEvent.keyDown(trigger, { key: "Enter" });
  fireEvent.keyUp(trigger, { key: "Enter" });
  // 等 Portal 渲染 Content
  await waitFor(() => {
    expect(screen.getByText("全部工作区")).toBeInTheDocument();
  });
}

/** 点击下拉项（Radix MenuItem 监听 click 触发 onSelect）。 */
async function clickItem(label: string | RegExp) {
  const item = await screen.findByText(label);
  fireEvent.click(item.closest("[role=menuitem]") ?? item);
}

describe("WorkspaceSwitcher", () => {
  it("显示当前工作区名 + 在线 daemon 徽标（current.name 已有时直接用）", async () => {
    setupCtx({ currentName: "前端中台", daemonOnline: true });
    setupStatus({ "ws-a": { daemon_id: "d-a", online: true } });
    mockedList.mockResolvedValue({
      items: [mkWorkspace({ id: "ws-a", name: "前端中台" })],
      total: 1,
    });
    mockedBindings.mockResolvedValue([
      mkBinding({ workspace_id: "ws-a", daemon_id: "d-a" }),
    ]);

    withQueryClient(<WorkspaceSwitcher />);

    await waitFor(() => {
      expect(screen.getByText("前端中台")).toBeInTheDocument();
    });
    expect(screen.queryByText(/离线/)).not.toBeInTheDocument();
  });

  it("current.name 为空时，用列表数据填充当前工作区名（task-04 留空补全）", async () => {
    setupCtx({ currentName: "", daemonOnline: true });
    setupStatus({ "ws-a": { daemon_id: "d-a", online: true } });
    mockedList.mockResolvedValue({
      items: [mkWorkspace({ id: "ws-a", name: "前端中台（列表填充）" })],
      total: 1,
    });
    mockedBindings.mockResolvedValue([
      mkBinding({ workspace_id: "ws-a", daemon_id: "d-a" }),
    ]);

    withQueryClient(<WorkspaceSwitcher />);

    await waitFor(() => {
      expect(screen.getByText("前端中台（列表填充）")).toBeInTheDocument();
    });
  });

  it("下拉展开列出可切换工作区，每项带 daemon 状态", async () => {
    setupCtx({ currentName: "前端中台", daemonOnline: true });
    setupStatus({
      "ws-a": { daemon_id: "d-a", online: true },
      "ws-b": { daemon_id: "d-b", online: false },
      "ws-c": { daemon_id: null, online: false },
    });
    mockedList.mockResolvedValue({
      items: [
        mkWorkspace({ id: "ws-a", name: "前端中台" }),
        mkWorkspace({ id: "ws-b", name: "后端 API" }),
        mkWorkspace({ id: "ws-c", name: "数据看板" }),
      ],
      total: 3,
    });
    mockedBindings.mockResolvedValue([
      mkBinding({ workspace_id: "ws-a", daemon_id: "d-a" }),
      mkBinding({ workspace_id: "ws-b", daemon_id: "d-b" }),
      mkBinding({ workspace_id: "ws-c", daemon_id: null }),
    ]);

    withQueryClient(<WorkspaceSwitcher />);
    await waitFor(() => expect(screen.getByText("前端中台")).toBeInTheDocument());

    await openMenu();

    expect(await screen.findByText("后端 API")).toBeInTheDocument();
    expect(screen.getByText("数据看板")).toBeInTheDocument();
    // 每项带 daemon 状态文本
    expect(screen.getAllByText(/离线|在线|未绑定/).length).toBeGreaterThan(0);
  });

  it("已绑定项点击 → switchWorkspace(id)（D-002 切同模块）", async () => {
    setupCtx({ currentName: "前端中台", daemonOnline: true });
    setupStatus({
      "ws-a": { daemon_id: "d-a", online: true },
      "ws-b": { daemon_id: "d-b", online: true },
    });
    mockedList.mockResolvedValue({
      items: [
        mkWorkspace({ id: "ws-a", name: "前端中台" }),
        mkWorkspace({ id: "ws-b", name: "Agent 实验室" }),
      ],
      total: 2,
    });
    mockedBindings.mockResolvedValue([
      mkBinding({ workspace_id: "ws-a", daemon_id: "d-a" }),
      mkBinding({ workspace_id: "ws-b", daemon_id: "d-b" }),
    ]);

    withQueryClient(<WorkspaceSwitcher />);
    await waitFor(() => expect(screen.getByText("前端中台")).toBeInTheDocument());

    await openMenu();
    await clickItem("Agent 实验室");

    expect(mockSwitchWorkspace).toHaveBeenCalledWith("ws-b");
  });

  it("未绑定项点击 → 打开 WorkspaceBindingDialog，不调 switchWorkspace（D-003）", async () => {
    setupCtx({ currentName: "前端中台", daemonOnline: true });
    setupStatus({
      "ws-a": { daemon_id: "d-a", online: true },
      "ws-c": { daemon_id: null, online: false },
    });
    mockedList.mockResolvedValue({
      items: [
        mkWorkspace({ id: "ws-a", name: "前端中台" }),
        mkWorkspace({ id: "ws-c", name: "数据看板" }),
      ],
      total: 2,
    });
    mockedBindings.mockResolvedValue([
      mkBinding({ workspace_id: "ws-a", daemon_id: "d-a" }),
      mkBinding({ workspace_id: "ws-c", daemon_id: null }),
    ]);

    withQueryClient(<WorkspaceSwitcher />);
    await waitFor(() => expect(screen.getByText("前端中台")).toBeInTheDocument());

    await openMenu();
    await clickItem("数据看板");

    expect(mockSwitchWorkspace).not.toHaveBeenCalled();
    expect(lastDialogProps).not.toBeNull();
    expect(lastDialogProps?.open).toBe(true);
    expect(lastDialogProps?.workspaceId).toBe("ws-c");
  });

  it("绑定弹窗成功后，切进入（onBound 回调触发 switchWorkspace）", async () => {
    setupCtx({ currentName: "前端中台", daemonOnline: true });
    setupStatus({
      "ws-a": { daemon_id: "d-a", online: true },
      "ws-c": { daemon_id: null, online: false },
    });
    mockedList.mockResolvedValue({
      items: [
        mkWorkspace({ id: "ws-a", name: "前端中台" }),
        mkWorkspace({ id: "ws-c", name: "数据看板" }),
      ],
      total: 2,
    });
    mockedBindings.mockResolvedValue([
      mkBinding({ workspace_id: "ws-a", daemon_id: "d-a" }),
      mkBinding({ workspace_id: "ws-c", daemon_id: null }),
    ]);

    withQueryClient(<WorkspaceSwitcher />);
    await waitFor(() => expect(screen.getByText("前端中台")).toBeInTheDocument());

    await openMenu();
    await clickItem("数据看板");
    fireEvent.click(await screen.findByTestId("dialog-confirm-bound"));

    expect(mockSwitchWorkspace).toHaveBeenCalledWith("ws-c");
  });

  it("daemon 离线项仍可点击切换（D-005 仅标红不阻断）", async () => {
    setupCtx({ currentName: "前端中台", daemonOnline: true });
    setupStatus({
      "ws-a": { daemon_id: "d-a", online: true },
      "ws-b": { daemon_id: "d-b", online: false },
    });
    mockedList.mockResolvedValue({
      items: [
        mkWorkspace({ id: "ws-a", name: "前端中台" }),
        mkWorkspace({ id: "ws-b", name: "后端 API" }),
      ],
      total: 2,
    });
    mockedBindings.mockResolvedValue([
      mkBinding({ workspace_id: "ws-a", daemon_id: "d-a" }),
      mkBinding({ workspace_id: "ws-b", daemon_id: "d-b" }),
    ]);

    withQueryClient(<WorkspaceSwitcher />);
    await waitFor(() => expect(screen.getByText("前端中台")).toBeInTheDocument());

    await openMenu();
    await clickItem("后端 API");

    expect(mockSwitchWorkspace).toHaveBeenCalledWith("ws-b");
  });

  it("平台页（workspaceId=null）显示「选择工作区」引导态，不阻断", async () => {
    setupCtx({ workspaceId: null, currentName: "", daemonOnline: false });
    setupStatus({});
    mockedList.mockResolvedValue({ items: [], total: 0 });
    mockedBindings.mockResolvedValue([]);

    withQueryClient(<WorkspaceSwitcher />);

    expect(await screen.findByText("选择工作区")).toBeInTheDocument();
    expect(screen.queryByText("前端中台")).not.toBeInTheDocument();
  });

  it("平台页引导态点击 → 跳 /workspaces", async () => {
    setupCtx({ workspaceId: null, currentName: "", daemonOnline: false });
    setupStatus({});
    mockedList.mockResolvedValue({ items: [], total: 0 });
    mockedBindings.mockResolvedValue([]);

    withQueryClient(<WorkspaceSwitcher />);
    fireEvent.click(await screen.findByRole("button", { name: /选择工作区/ }));

    expect(mockPush).toHaveBeenCalledWith("/workspaces");
  });

  it("下拉底部「查看全部工作区」跳 /workspaces", async () => {
    setupCtx({ currentName: "前端中台", daemonOnline: true });
    setupStatus({ "ws-a": { daemon_id: "d-a", online: true } });
    mockedList.mockResolvedValue({
      items: [mkWorkspace({ id: "ws-a", name: "前端中台" })],
      total: 1,
    });
    mockedBindings.mockResolvedValue([
      mkBinding({ workspace_id: "ws-a", daemon_id: "d-a" }),
    ]);

    withQueryClient(<WorkspaceSwitcher />);
    await waitFor(() => expect(screen.getByText("前端中台")).toBeInTheDocument());

    await openMenu();
    await clickItem(/查看全部工作区/);

    expect(mockPush).toHaveBeenCalledWith("/workspaces");
  });
});
