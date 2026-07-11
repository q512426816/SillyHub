/**
 * task-09 / FR-003：page 层接线 WorkspaceConfigCard 的回归测试。
 *
 * task-07 把原「规范管理（Spec Workspace）」SectionCard 整段删除，替换为
 * <WorkspaceConfigCard>。卡片内部 6 状态分支（初始化/扫描/同步/导入/三态引导
 * /owner 门禁/409 重扫）的按钮与文案由 task-08 的 workspace-config-card.test.tsx
 * 单独覆盖；本测试只验证 page 层接线：
 *   1. page 渲染 <WorkspaceConfigCard>（用 data-testid mock 隔离卡片内部）；
 *   2. 其他区块（基本信息 / 默认智能体 / Overview / Quick nav）行为零回归——
 *      特别保留 task-11 的 default_agent × 3 case 作为「其他区块行为不变」守护。
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import WorkspaceDetailPage from "@/app/(dashboard)/workspaces/[id]/page";
import type { SpecWorkspace } from "@/lib/spec-workspaces";
import type { Workspace } from "@/lib/workspaces";
import { useSession } from "@/stores/session";

// ── next/link mock（详情页多处用 Link）──────────────────────────────────────
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// ── 子组件 mock（减少依赖）───────────────────────────────────────────────────
vi.mock("@/components/workspace-config-card", () => ({
  WorkspaceConfigCard: () => (
    <div data-testid="workspace-config-card-mock" />
  ),
}));
vi.mock("@/components/workspace-daemon-switcher", () => ({
  WorkspaceDaemonSwitcher: () => null,
}));
vi.mock("@/components/workspace-path-fields", () => ({
  WorkspacePathFields: () => null,
}));
vi.mock("@/components/AgentProviderSelect", () => ({
  AgentProviderSelect: () => null,
}));
vi.mock("@/components/AgentModelInput", () => ({
  AgentModelInput: () => null,
}));

// ── lib mock ─────────────────────────────────────────────────────────────────
const workspacesApi = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  scanGenerate: vi.fn(),
  updateWorkspace: vi.fn(),
}));
vi.mock("@/lib/workspaces", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspaces")>("@/lib/workspaces");
  return {
    ...actual,
    getWorkspace: workspacesApi.getWorkspace,
    scanGenerate: workspacesApi.scanGenerate,
    updateWorkspace: workspacesApi.updateWorkspace,
  };
});

const specApi = vi.hoisted(() => ({
  getSpecWorkspace: vi.fn(),
  syncManual: vi.fn(),
  listPendingSync: vi.fn(),
}));
vi.mock("@/lib/spec-workspaces", async () => {
  const actual = await vi.importActual<typeof import("@/lib/spec-workspaces")>("@/lib/spec-workspaces");
  return {
    ...actual,
    getSpecWorkspace: specApi.getSpecWorkspace,
    syncManual: specApi.syncManual,
    listPendingSync: specApi.listPendingSync,
  };
});

const bindingApi = vi.hoisted(() => ({ fetchMyBinding: vi.fn() }));
vi.mock("@/lib/workspace-binding", () => ({
  fetchMyBinding: bindingApi.fetchMyBinding,
}));

const daemonApi = vi.hoisted(() => ({
  listDaemonRuntimes: vi.fn(),
  listDaemonInstances: vi.fn(),
}));
vi.mock("@/lib/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/lib/daemon")>("@/lib/daemon");
  return { ...actual, getDaemonRuntime: vi.fn(async () => null), listDaemonRuntimes: daemonApi.listDaemonRuntimes, listDaemonInstances: daemonApi.listDaemonInstances };
});

const componentsApi = vi.hoisted(() => ({ listComponents: vi.fn() }));
vi.mock("@/lib/components", () => ({ listComponents: componentsApi.listComponents }));

vi.mock("@/lib/changes", () => ({ listChanges: vi.fn(async () => ({ items: [], total: 0 })) }));
vi.mock("@/lib/agent", async () => {
  const actual = await vi.importActual<typeof import("@/lib/agent")>("@/lib/agent");
  return { ...actual, listAgentRuns: vi.fn(async () => []) };
});
vi.mock("@/lib/runtime", () => ({ getRuntimeProgress: vi.fn(async () => null) }));

// ── fixtures ─────────────────────────────────────────────────────────────────

function makeWorkspace(strategy: "platform-managed" | "repo-mirrored" | "repo-native"): {
  ws: Workspace;
  specWs: SpecWorkspace;
} {
  const ws = {
    id: "ws-1",
    name: "multi-agent-platform",
    slug: "multi-agent-platform",
    root_path: "C:/proj",
    status: "active",
    default_agent: null,
    default_model: null,
    owner: { user_id: "user-1", email: "owner@test.com", display_name: "Owner" },
    created_at: "2026-06-30T00:55:11Z",
    last_scanned_at: "2026-06-30T00:55:11Z",
  } as unknown as Workspace;
  const specWs = {
    id: "sw-1",
    workspace_id: "ws-1",
    spec_root: "/data/spec-workspaces/ws-1",
    strategy,
    repo_sillyspec_path: null,
    profile_version: "0.1.0",
    sync_status: "clean",
    last_synced_at: "2026-06-30T00:55:27Z",
    created_at: "2026-06-30T00:55:12Z",
    updated_at: "2026-06-30T00:55:27Z",
  } as unknown as SpecWorkspace;
  return { ws, specWs };
}

function mockDefaultBinding() {
  bindingApi.fetchMyBinding.mockResolvedValue({
    workspace_id: "ws-1",
    user_id: "user-1",
    daemon_id: null,
    runtime_id: "rid-1",
    root_path: "C:/proj",
    path_source: "daemon-client",
    synced_at: null,
    last_scan_at: null,
    init_synced_at: null,
  });
}

async function renderWithStrategy(
  strategy: "platform-managed" | "repo-mirrored" | "repo-native",
  overrides?: {
    initSyncedAt?: string | null;
    componentCount?: number;
  },
) {
  const { ws, specWs } = makeWorkspace(strategy);
  workspacesApi.getWorkspace.mockResolvedValue(ws);
  specApi.getSpecWorkspace.mockResolvedValue(specWs);
  workspacesApi.scanGenerate.mockResolvedValue({ workspace_id: "ws-1", agent_run_id: "run-1" });
  componentsApi.listComponents.mockResolvedValue({
    items: [],
    total: overrides?.componentCount ?? 0,
  });

  // 默认未初始化
  mockDefaultBinding();
  if (overrides?.initSyncedAt !== undefined) {
    bindingApi.fetchMyBinding.mockResolvedValue({
      workspace_id: "ws-1",
      user_id: "user-1",
      daemon_id: null,
      runtime_id: "rid-1",
      root_path: "C:/proj",
      path_source: "daemon-client",
      synced_at: null,
      last_scan_at: null,
      init_synced_at: overrides.initSyncedAt,
    });
  }

  render(<WorkspaceDetailPage params={{ id: "ws-1" }} />);
  await waitFor(() =>
    expect(screen.getAllByText("multi-agent-platform").length).toBeGreaterThan(0),
  );
  return { ws, specWs };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("WorkspaceDetailPage 接线 WorkspaceConfigCard（task-09 / FR-003）", () => {
  afterEach(() => {
    vi.clearAllMocks();
    useSession.getState().clear();
  });

  // ── task-09：page 层接线断言 ──

  it("page 渲染 <WorkspaceConfigCard>（原规范管理区已替换为卡片）", async () => {
    await renderWithStrategy("platform-managed");
    expect(screen.getByTestId("workspace-config-card-mock")).toBeInTheDocument();
  });

  it("page 不再渲染原「规范管理」SectionCard 标题", async () => {
    await renderWithStrategy("repo-native");
    // task-07 删除原 SectionCard，标题文本不应再出现在 page 层
    expect(screen.queryByText("规范管理")).not.toBeInTheDocument();
    expect(screen.queryByText("规范管理（Spec Workspace）")).not.toBeInTheDocument();
  });

  it("page 不再直接展示 spec_root / profile_version 字段（已迁入卡片）", async () => {
    await renderWithStrategy("platform-managed");
    // 这些字段原本直接在 page 渲染，task-07 后迁入卡片内部展示
    expect(screen.queryByText("/data/spec-workspaces/ws-1")).not.toBeInTheDocument();
    expect(screen.queryByText("0.1.0")).not.toBeInTheDocument();
  });

  it("page 不再渲染已迁入卡片的操作按钮（初始化/扫描/同步到服务器）", async () => {
    await renderWithStrategy("platform-managed", {
      initSyncedAt: "2026-07-02T10:00:00Z",
      componentCount: 3,
    });
    // 这些按钮随 task-07 迁入卡片，page 层不再渲染（行为由 task-08 组件测试覆盖）
    expect(screen.queryByRole("button", { name: "初始化" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "扫描" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "同步到服务器" })).not.toBeInTheDocument();
  });

  it("三种策略下卡片均渲染（接线不分策略）", async () => {
    for (const strat of ["platform-managed", "repo-mirrored", "repo-native"] as const) {
      cleanup();
      await renderWithStrategy(strat);
      expect(screen.getByTestId("workspace-config-card-mock")).toBeInTheDocument();
    }
  });

  // ── task-11 / daemon-entity-binding：default_agent 独立选择器（保留，其他区块行为不变）──

  it("default_agent 卡片展示：daemon 未绑时显示占位提示", async () => {
    await renderWithStrategy("repo-native");
    // daemon_id=null → 占位提示
    expect(screen.getByText("请先绑定守护进程。")).toBeInTheDocument();
  });

  it("default_agent 卡片展示：已绑 daemon 有在线 provider 时显示 provider 选择器", async () => {
    daemonApi.listDaemonRuntimes.mockResolvedValue([
      // 匹配绑定 daemon "did-1" 的一个在线 provider
      {
        id: "rt-claude",
        daemon_instance_id: "did-1",
        provider: "claude",
        status: "online",
        name: "Claude Code",
        version: "2.0.0",
        allowed_roots: [],
        created_at: "2026-07-01T00:00:00Z",
        updated_at: "2026-07-01T00:00:00Z",
      },
      // 不匹配的 daemon（应被过滤）
      {
        id: "rt-codex",
        daemon_instance_id: "did-other",
        provider: "codex",
        status: "online",
        name: "Codex",
        version: "0.100.0",
        allowed_roots: [],
        created_at: "2026-07-01T00:00:00Z",
        updated_at: "2026-07-01T00:00:00Z",
      },
    ]);
    daemonApi.listDaemonInstances.mockResolvedValue([
      { id: "did-1", hostname: "HOST-1", display_alias: null, status: "online", providers: [{ provider: "claude", status: "online" }] },
    ]);

    const { ws, specWs } = makeWorkspace("repo-native");
    ws.default_agent = null;
    ws.default_model = null;
    workspacesApi.getWorkspace.mockResolvedValue(ws);
    specApi.getSpecWorkspace.mockResolvedValue(specWs);
    workspacesApi.scanGenerate.mockResolvedValue({ workspace_id: "ws-1", agent_run_id: "run-1" });
    componentsApi.listComponents.mockResolvedValue({ items: [], total: 3 });
    // 设置 binding 有 daemon_id
    bindingApi.fetchMyBinding.mockResolvedValue({
      workspace_id: "ws-1",
      user_id: "user-1",
      daemon_id: "did-1",
      runtime_id: "rid-1",
      root_path: "C:/proj",
      path_source: "daemon-client",
      synced_at: null,
      last_scan_at: null,
      init_synced_at: "2026-07-02T10:00:00Z",
    });

    render(<WorkspaceDetailPage params={{ id: "ws-1" }} />);
    await waitFor(() =>
      expect(screen.getAllByText("multi-agent-platform").length).toBeGreaterThan(0),
    );

    // 不应出现"请先绑定"占位
    expect(screen.queryByText("请先绑定守护进程。")).not.toBeInTheDocument();
    // 应该有 provider 选择器（<select> 元素）；用 findByRole 等 useEffect 异步
    // 加载 daemon providers 完成（boundDaemonProviders 变非空才渲染 select），
    // 修全量跑 flaky：waitFor 只等 workspace name，effect 来不及 settle。
    const select = await screen.findByRole("combobox");
    expect(select).toBeInTheDocument();
    // 选项应包含 claude
    expect(select).toContainHTML("Claude Code");
    // 不应包含 codex（那是另一个 daemon 的）
    expect(select).not.toContainHTML("Codex");
  });

  it("default_agent 卡片展示：已绑 daemon 无在线 provider 时显示无 provider 提示", async () => {
    daemonApi.listDaemonRuntimes.mockResolvedValue([
      // 匹配 daemon 但 status=offline，应被过滤
      {
        id: "rt-claude",
        daemon_instance_id: "did-1",
        provider: "claude",
        status: "offline",
        name: "Claude Code",
        version: "2.0.0",
        allowed_roots: [],
        created_at: "2026-07-01T00:00:00Z",
        updated_at: "2026-07-01T00:00:00Z",
      },
    ]);
    daemonApi.listDaemonInstances.mockResolvedValue([
      { id: "did-1", hostname: "HOST-1", display_alias: null, status: "online", providers: [{ provider: "claude", status: "offline" }] },
    ]);

    const { ws, specWs } = makeWorkspace("repo-native");
    ws.default_agent = null;
    ws.default_model = null;
    workspacesApi.getWorkspace.mockResolvedValue(ws);
    specApi.getSpecWorkspace.mockResolvedValue(specWs);
    workspacesApi.scanGenerate.mockResolvedValue({ workspace_id: "ws-1", agent_run_id: "run-1" });
    componentsApi.listComponents.mockResolvedValue({ items: [], total: 3 });
    bindingApi.fetchMyBinding.mockResolvedValue({
      workspace_id: "ws-1",
      user_id: "user-1",
      daemon_id: "did-1",
      runtime_id: "rid-1",
      root_path: "C:/proj",
      path_source: "daemon-client",
      synced_at: null,
      last_scan_at: null,
      init_synced_at: "2026-07-02T10:00:00Z",
    });

    render(<WorkspaceDetailPage params={{ id: "ws-1" }} />);
    await waitFor(() =>
      expect(screen.getAllByText("multi-agent-platform").length).toBeGreaterThan(0),
    );

    // 用 findByText 等 useEffect 异步加载完成（boundDaemonProviders 经 filter
    // 后为空 → 走"无在线 provider"分支）；同步 getByText 在 myBinding/effect
    // 时序边界下可能短暂命中"请先绑定"占位，造成全量跑 flaky。
    expect(
      await screen.findByText("当前绑定的守护进程无在线智能体提供方，请先确认守护进程已启用。"),
    ).toBeInTheDocument();
  });
});
