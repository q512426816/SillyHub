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
 * task-05 / 2026-08-20-workspace-overview-redesign：四段式重排后同步断言，
 * 新增统计四数字与 6 入口 href 覆盖（FR-05, D-202）。
 */
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

// quick-4a55e2dc：page 挂 useDaemonMachines（quick-18951370 共享绑定的显示回退
// 数据源），其内部 useQuery 需 QueryClientProvider——本测试文件原裸 render（无
// Provider），quick-18951370 接线时漏补，HEAD 基线 10/10 全挂（预存债顺手修）。
// mock 掉 hook 避免真实网络请求；machineCandidates=[] 走 page 的 `?? []` 兜底，
// 借用归属判定不依赖它（只看 listDaemonInstances 是否命中）。
vi.mock("@/lib/use-daemon-machines", () => ({
  useDaemonMachines: () => ({
    items: [],
    total: 0,
    sessions: [],
    sharedToMe: [],
    machineCandidates: [],
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
  }),
}));

const componentsApi = vi.hoisted(() => ({ listComponents: vi.fn() }));
vi.mock("@/lib/components", () => ({ listComponents: componentsApi.listComponents }));

vi.mock("@/lib/changes", () => ({ listChanges: vi.fn(async () => ({ items: [], total: 0 })) }));
vi.mock("@/lib/agent", async () => {
  const actual = await vi.importActual<typeof import("@/lib/agent")>("@/lib/agent");
  return { ...actual, listAgentRuns: vi.fn(async () => []) };
});
vi.mock("@/lib/quicklog", () => ({ listQuicklogEntries: vi.fn(async () => ({ items: [], total: 0 })) }));

// ql-20260824-005-aa13：关联项目链路（page 基本信息行 + 弹窗内真实
// LinkedProjectsSection）。默认空数组——load 内 refreshLinkedProjects 拿 []，
// 不影响既有用例（均不断言「未关联/项目名」）。
const workspaceLinkApi = vi.hoisted(() => ({
  listLinkedProjects: vi.fn(async () => [] as unknown[]),
  linkProject: vi.fn(),
}));
vi.mock("@/lib/workspace", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspace")>("@/lib/workspace");
  return {
    ...actual,
    listLinkedProjects: workspaceLinkApi.listLinkedProjects,
    linkProject: workspaceLinkApi.linkProject,
  };
});
const ppmProjectApi = vi.hoisted(() => ({
  listProjects: vi.fn(async () => [] as unknown[]),
}));
vi.mock("@/lib/ppm/project", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ppm/project")>("@/lib/ppm/project");
  return {
    ...actual,
    listProjects: ppmProjectApi.listProjects,
  };
});

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
  workspacesApi.scanGenerate.mockResolvedValue({ workspace_id: "ws-1", agent_run_id: "run-1", session_id: "sess-1" });
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

  const view = render(<WorkspaceDetailPage params={{ id: "ws-1" }} />);
  await waitFor(() =>
    expect(screen.getAllByText("multi-agent-platform").length).toBeGreaterThan(0),
  );
  return { ws, specWs, ...view };
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

  // ── task-05 / 2026-08-20-workspace-overview-redesign：统计四数字 ──
  //（快速入口宫格已随 2026-08-20-workspace-nav-consolidate 删除，入口统一走顶部 WorkspaceTabs）

  it("统计四数字按 mock 数据渲染（组件/进行中/已归档/快速修复）", async () => {
    await renderWithStrategy("platform-managed", { componentCount: 7 });
    // 四张统计卡标签应存在（ql-20260820-013 第四卡=快速修复）
    expect(screen.getByText("项目组组件")).toBeInTheDocument();
    expect(screen.getByText("进行中变更")).toBeInTheDocument();
    expect(screen.getByText("已归档变更")).toBeInTheDocument();
    const quickCard = screen.getByText("快速修复").closest("a");
    expect(quickCard).toHaveAttribute(
      "href",
      "/workspaces/ws-1/changes?tab=quicklog",
    );
    expect(quickCard).toHaveTextContent("0");
    // 组件数显式断言
    const componentCard = screen.getByText("项目组组件").closest("a");
    expect(componentCard).toHaveTextContent("7");
    // 进行中 / 已归档变更因 mock 返回 total=0，断言卡片存在即可
    expect(screen.getByText("进行中变更")).toBeInTheDocument();
    expect(screen.getByText("已归档变更")).toBeInTheDocument();
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
    workspacesApi.scanGenerate.mockResolvedValue({ workspace_id: "ws-1", agent_run_id: "run-1", session_id: "sess-1" });
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

    // ql-20260820-013 信息区已平铺为 SectionCard 卡片（原 Collapse 移除），
    // select 不再处于折叠面板，querySelector 取法保留（语义不变）。
    const select = await waitFor(() => {
      const el = document.querySelector('select');
      expect(el).toBeInstanceOf(HTMLSelectElement);
      return el as HTMLSelectElement;
    });
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
    workspacesApi.scanGenerate.mockResolvedValue({ workspace_id: "ws-1", agent_run_id: "run-1", session_id: "sess-1" });
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

  // ── ql-20260824-005-aa13：关联项目弹窗操作后基本信息行回显 ──

  it("弹窗内绑定成功 → 基本信息「关联项目」行即时回显,无需手动刷新", async () => {
    const brief = {
      project_id: "proj-1",
      project_name: "项目甲",
      project_status: "1",
    };
    let linkedCalls = 0;
    // 1 = page load；2 = 弹窗挂载 reload → 均空；3 = 绑定后 section reload；
    // 4 = onChanged 重拉基本信息行 → 已关联。
    workspaceLinkApi.listLinkedProjects.mockImplementation(async () => {
      linkedCalls += 1;
      return linkedCalls >= 3 ? [brief] : [];
    });
    ppmProjectApi.listProjects.mockResolvedValue([
      {
        id: "proj-1",
        project_name: "项目甲",
        project_code: "P-001",
        project_status: "1",
      } as never,
    ]);
    workspaceLinkApi.linkProject.mockResolvedValue(brief as never);

    await renderWithStrategy("platform-managed");
    expect(await screen.findByText("未关联")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关联 PPM 项目" }));
    fireEvent.click(await screen.findByRole("button", { name: "绑定" }));

    // 基本信息行刷新：「未关联」消失；「项目甲」出现在基本信息 tag 与
    // 弹窗已关联列表两处（Modal 为覆盖层,背后页面仍在 DOM）。
    await waitFor(() =>
      expect(screen.queryByText("未关联")).not.toBeInTheDocument(),
    );
    expect(screen.getAllByText("项目甲").length).toBeGreaterThanOrEqual(2);
  });

  // ── quick-4a55e2dc：守护进程共享卡——借用绑定不能「共享的共享」 ──
  // 注：不走 renderWithStrategy（其内部 mockDefaultBinding 会把 daemon_id 覆盖
  // 成 null），照 default_agent 用例手动 mock + 裸 render。

  it("绑定自有 daemon → 「守护进程共享」开关正常渲染", async () => {
    daemonApi.listDaemonRuntimes.mockResolvedValue([]);
    daemonApi.listDaemonInstances.mockResolvedValue([
      { id: "did-1", hostname: "HOST-1", display_alias: null, status: "online", providers: [] },
    ]);
    const { ws, specWs } = makeWorkspace("repo-native");
    workspacesApi.getWorkspace.mockResolvedValue(ws);
    specApi.getSpecWorkspace.mockResolvedValue(specWs);
    workspacesApi.scanGenerate.mockResolvedValue({ workspace_id: "ws-1", agent_run_id: "run-1", session_id: "sess-1" });
    componentsApi.listComponents.mockResolvedValue({ items: [], total: 0 });
    bindingApi.fetchMyBinding.mockResolvedValue({
      workspace_id: "ws-1",
      user_id: "user-1",
      daemon_id: "did-1",
      runtime_id: "rid-1",
      root_path: "C:/proj",
      path_source: "daemon-client",
      synced_at: null,
      last_scan_at: null,
      init_synced_at: null,
    });

    render(<WorkspaceDetailPage params={{ id: "ws-1" }} />);
    await waitFor(() =>
      expect(screen.getAllByText("multi-agent-platform").length).toBeGreaterThan(0),
    );

    // effect 解析后 owned=true → 开关渲染、无借用提示。
    expect(
      await screen.findByTestId("shared-daemon-toggle"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/仅自有守护进程可开启共享/),
    ).not.toBeInTheDocument();
  });

  it("绑定他人共享 daemon（借用）→ 不渲染共享开关，改提示文案", async () => {
    // listDaemonInstances 只返回自有实例；绑定 did-shared 不在其中 =
    // quick-18951370 放宽的借用绑定形态。
    daemonApi.listDaemonRuntimes.mockResolvedValue([]);
    daemonApi.listDaemonInstances.mockResolvedValue([
      { id: "did-1", hostname: "HOST-1", display_alias: null, status: "online", providers: [] },
    ]);
    const { ws, specWs } = makeWorkspace("repo-native");
    workspacesApi.getWorkspace.mockResolvedValue(ws);
    specApi.getSpecWorkspace.mockResolvedValue(specWs);
    workspacesApi.scanGenerate.mockResolvedValue({ workspace_id: "ws-1", agent_run_id: "run-1", session_id: "sess-1" });
    componentsApi.listComponents.mockResolvedValue({ items: [], total: 0 });
    bindingApi.fetchMyBinding.mockResolvedValue({
      workspace_id: "ws-1",
      user_id: "user-1",
      daemon_id: "did-shared",
      runtime_id: null,
      root_path: "C:/proj",
      path_source: "daemon-client",
      synced_at: null,
      last_scan_at: null,
      init_synced_at: null,
    });

    render(<WorkspaceDetailPage params={{ id: "ws-1" }} />);
    await waitFor(() =>
      expect(screen.getAllByText("multi-agent-platform").length).toBeGreaterThan(0),
    );

    // effect 解析（findByText 等待）后：提示出现、开关不渲染。
    expect(
      await screen.findByText(/当前绑定的是他人共享的守护进程（借用），仅自有守护进程可开启共享。/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("shared-daemon-toggle")).not.toBeInTheDocument();
  });
});
