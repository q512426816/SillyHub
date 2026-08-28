/**
 * 2026-07-04-daemon-version-management task-10 + 2026-07-07 task-09 适配：
 * runtimes 页 daemon 版本展示 + 升级按钮单测（机器级化后）。
 *
 * task-09 适配：page 改为 Machine→Runtime 两级手风琴后——
 *   - mock 数据源从 listDaemonRuntimesPage 改为 listDaemonMachines（runtime 包进单个
 *     machine.runtimes）；保留 daemon_version/build_id 在 runtime 字段供 C-002 断言。
 *   - runtime 卡默认折叠在 MachineCard 内，findCardByName 渲染后先点 machine header
 *     展开，再定位 runtime article。
 *   - 升级按钮上提机器头（task-09 / design §8），调 triggerMachineSelfUpdate(instance.id)
 *     而非 triggerDaemonSelfUpdate(runtime.id)；断言相应改机器级。
 *
 * 覆盖（C-002 上提后 runtime 卡只验 meta 既有项）:
 *   1. 卡片不再渲染 Daemon 版本行（C-002）
 *   2. 升级按钮点击调 triggerMachineSelfUpdate（机器级，AC-03）
 *   3. 离线 machine 升级按钮 disabled（AC-04）
 */

import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp } from "antd";

import RuntimesPage from "@/app/(dashboard)/runtimes/page";
import { useSession } from "@/stores/session";
// task-09：共享机器「会话」断言用 store 锁定态（FR-01，同根 page.test.tsx 惯例）。
import { useFloatingSessionStore } from "@/stores/floating-session";
import { PROVIDER_META } from "@/lib/daemon";

// 每 test 独立 QueryClient（retry:false）。
function renderPage(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, refetchInterval: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AntApp>{ui}</AntApp>
    </QueryClientProvider>,
  );
}

// ── next/navigation mock ────────────────────────────────────────────────────

const nav = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.searchParams,
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), refresh: vi.fn() }),
}));

// ── mocks:task-09 改 mock listDaemonMachines + triggerMachineSelfUpdate ──

const daemon = vi.hoisted(() => {
  // task-09：page 数据源改 useDaemonMachines → listDaemonMachines。
  // 测试侧仍用 listDaemonRuntimes 收集 runtime 数组，再包成单个 machine 响应。
  return {
    listDaemonRuntimes: vi.fn(),
    listDaemonMachines: vi.fn(),
    listAgentSessions: vi.fn(),
    deleteAgentSession: vi.fn(),
    deleteDaemonRuntime: vi.fn(),
    getAgentSessionLogs: vi.fn(),
    getAgentSession: vi.fn(),
    reopenSession: vi.fn(),
    streamSession: vi.fn(),
    getRuntimesUsage: vi.fn(),
    getDaemonVersion: vi.fn(),
    triggerMachineSelfUpdate: vi.fn(),
    // task-09（2026-08-28-daemon-agent-share）：平台共享智能体管理卡数据源。
    fetchSharedAgents: vi.fn(),
    fetchSharedAgentsActive: vi.fn(),
  };
});

vi.mock("@/lib/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/lib/daemon")>("@/lib/daemon");
  return {
    ...actual,
    listDaemonRuntimes: daemon.listDaemonRuntimes,
    // task-09：page 列表数据源改 listDaemonMachines；测试 mock 把 runtime 数组
    // 包进单个 machine 响应（machine.id 固定 "m-1"，hostname "host-1"）。
    listDaemonMachines: daemon.listDaemonMachines,
    updateDaemonMachine: vi.fn(),
    triggerMachineSelfUpdate: daemon.triggerMachineSelfUpdate,
    listAgentSessions: daemon.listAgentSessions,
    deleteAgentSession: daemon.deleteAgentSession,
    deleteDaemonRuntime: daemon.deleteDaemonRuntime,
    getAgentSessionLogs: daemon.getAgentSessionLogs,
    getAgentSession: daemon.getAgentSession,
    reopenSession: daemon.reopenSession,
    streamSession: daemon.streamSession,
    getRuntimesUsage: daemon.getRuntimesUsage,
    getDaemonVersion: daemon.getDaemonVersion,
    // task-09：管理卡（admin）sharedAgents 数据源。
    fetchSharedAgents: daemon.fetchSharedAgents,
    fetchSharedAgentsActive: daemon.fetchSharedAgentsActive,
  };
});

// task-09：共享机器「来源工作区名」数据源（page 仅在有共享数据时查询）。
const workspaces = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/lib/workspaces", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspaces")>("@/lib/workspaces");
  return { ...actual, listWorkspaces: workspaces.list };
});

// task-09：管理卡档案下拉数据源。同模块 hook 内部调用不被 export mock 拦截
//（vitest 闭包绑定），直接 mock usePlatformAgentProfiles（先例 agent-profile-form.test.tsx）。
const profiles = vi.hoisted(() => ({ platform: vi.fn() }));
vi.mock("@/lib/agent-profiles", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/agent-profiles")>("@/lib/agent-profiles");
  return {
    ...actual,
    usePlatformAgentProfiles: () => ({
      profiles: profiles.platform(),
      isLoading: false,
      isError: false,
      error: null,
    }),
  };
});

// EventSource stub
class FakeES {
  url: string;
  listeners: Record<string, ((e: { data: string }) => void)[]> = {};
  constructor(url: string) {
    this.url = url;
  }
  addEventListener(kind: string, cb: (e: { data: string }) => void) {
    (this.listeners[kind] ??= []).push(cb);
  }
  removeEventListener() {}
  close() {}
}

function makeRuntime(overrides: Record<string, unknown> = {}) {
  return {
    id: "rt-1",
    name: "daemon",
    provider: "claude",
    version: "1.0.0",
    status: "online",
    last_heartbeat_at: "2026-07-04T10:00:00Z",
    capabilities: { protocol: "ws", agents: ["claude"] },
    allowed_roots: [],
    created_at: "2026-07-04T09:00:00Z",
    updated_at: "2026-07-04T10:00:00Z",
    ...overrides,
  };
}

/** task-09：把 runtime 数组包成单个 machine 响应（machine.id="m-1"，status 默认 online）。 */
function wrapMachines(
  runtimes: ReturnType<typeof makeRuntime>[],
  machineOverrides: Record<string, unknown> = {},
) {
  return {
    items: [
      {
        id: "m-1",
        hostname: "host-1",
        display_alias: null,
        os: "linux",
        arch: "x64",
        status: "online",
        last_heartbeat_at: "2026-07-04T10:00:00Z",
        version: "1.4.2",
        build_id: "a1b2c3d9e8f7",
        created_at: "2026-07-04T09:00:00Z",
        owner: null,
        runtime_count: runtimes.length,
        online_runtime_count: runtimes.filter((r) => r.status === "online").length,
        runtimes,
        ...machineOverrides,
      },
    ],
    total: 1,
    limit: 20,
    offset: 0,
  };
}

const LATEST_VERSION = {
  latest: "a1b2c3d",
  minRequired: "0.1.0",
  downloadUrl: "/x",
  latest_version: "1.4.2",
  latest_build_id: "a1b2c3d",
};

beforeEach(() => {
  useSession.setState({ accessToken: "tok", hydrated: true, user: null } as never);
  vi.stubGlobal("EventSource", FakeES);
  nav.searchParams = new URLSearchParams();
  nav.replace = vi.fn();
  daemon.listDaemonRuntimes.mockResolvedValue([]);
  // task-09：默认空 machine 列表（具体用例各自 mockResolvedValue）。
  daemon.listDaemonMachines.mockResolvedValue(wrapMachines([]));
  daemon.listAgentSessions.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });
  daemon.deleteAgentSession.mockResolvedValue(undefined);
  daemon.deleteDaemonRuntime.mockResolvedValue(undefined);
  daemon.getAgentSessionLogs.mockResolvedValue([]);
  daemon.reopenSession.mockResolvedValue({ session_id: "stub", status: "reconnecting" });
  daemon.getAgentSession.mockResolvedValue({
    id: "stub",
    runtime_id: null,
    lease_id: null,
    provider: "claude",
    status: "reconnecting",
    agent_session_id: "ag",
    config: null,
    turn_count: 0,
    created_at: "t",
    last_active_at: null,
    ended_at: null,
  });
  daemon.streamSession.mockImplementation(() => ({
    close: () => {},
    getLastEventId: () => null,
  }));
  daemon.getRuntimesUsage.mockResolvedValue({ window: "7d", runtimes: [] });
  daemon.getDaemonVersion.mockResolvedValue(LATEST_VERSION);
  daemon.triggerMachineSelfUpdate.mockResolvedValue({ sent: true, latest_version: "1.4.2" });
  // task-09：管理卡/共享区块数据源默认空（具体用例各自覆盖）。
  daemon.fetchSharedAgents.mockResolvedValue([]);
  daemon.fetchSharedAgentsActive.mockResolvedValue([]);
  workspaces.list.mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
  profiles.platform.mockReturnValue([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function renderAndWaitForRuntime() {
  const utils = renderPage(<RuntimesPage />);
  await waitFor(() => {
    expect(screen.queryByText("加载中...")).not.toBeInTheDocument();
  });
  await waitFor(() => {
    expect(daemon.getDaemonVersion).toHaveBeenCalled();
  });
  return utils;
}

/**
 * task-09：定位指定 runtime 的 article 卡。runtime 卡默认折叠在 MachineCard 展开体内，
 * 这里先点 machine header（aria-expanded=false 的 role=button）展开，再按 name 找 article。
 */
async function findCardByName(name: string) {
  // 展开第一个 machine 卡（点击折叠头）。
  const machineHeaders = await screen.findAllByRole("button");
  const machineHeader = machineHeaders.find((el) => el.getAttribute("aria-expanded") === "false");
  if (machineHeader) fireEvent.click(machineHeader);
  const heading = await screen.findByText(name);
  const article = heading.closest("article");
  expect(article, `runtime 卡片 ${name} 的 article 未找到`).not.toBeNull();
  return article as HTMLElement;
}

/**
 * task-09：定位机器头「升级 daemon」按钮。
 * MachineCard 折叠头本身 role=button 且其 accessible name 含子按钮文本「升级 daemon」，
 * 导致 getByRole 匹配到 header + 真按钮两个；这里 getAllByRole 后过滤 tagName===BUTTON。
 */
function findUpgradeButton(): HTMLElement {
  const matches = screen.getAllByRole("button", { name: /升级\s*daemon/ });
  const real = matches.filter((el) => el.tagName === "BUTTON");
  expect(real.length, "机器头「升级 daemon」按钮应恰有 1 个").toBe(1);
  return real[0] as HTMLElement;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("2026-07-04-daemon-version-management task-09: 版本展示 + 徽标", () => {
  // task-07 / C-002：「Daemon 版本」meta 行已从 RuntimeCard 删除（daemon_version / build_id
  // 短码 / 版本徽标）——该信息上提 task-08 机器头聚合块。原断言 daemon 版本号 / build_id 短码 /
  // 徽标「最新/可升级/dev/未知」的用例改为断言 runtime meta 既有项（协议=ws），保证卡片 meta 区
  // 仍渲染，徽标相关断言移交 task-08 机器头测试覆盖。

  it("卡片显示 runtime meta（协议），不再渲染 Daemon 版本行（C-002）", async () => {
    daemon.listDaemonMachines.mockResolvedValue(
      wrapMachines([
        makeRuntime({
          id: "rt-latest",
          name: "LatestClaude",
          daemon_version: "1.4.2",
          daemon_build_id: "a1b2c3d9e8f7",
        }),
      ]),
    );

    await renderAndWaitForRuntime();
    const card = await findCardByName("LatestClaude");

    // 协议 meta 仍渲染（capabilities.protocol=ws）
    expect(within(card).getByText("ws")).toBeInTheDocument();
    // daemon 版本号 / build_id 短码不再渲染（C-002 上提机器头）
    expect(within(card).queryByText("1.4.2")).not.toBeInTheDocument();
    expect(within(card).queryByText(/^#a1b2c3d$/)).not.toBeInTheDocument();
  });

  it("build_id 与 latest.latest_build_id 相等 → 卡片不再渲染徽标（C-002，徽标上提 task-08）", async () => {
    daemon.listDaemonMachines.mockResolvedValue(
      wrapMachines([
        makeRuntime({
          id: "rt-up",
          name: "UpToDateClaude",
          daemon_version: "1.4.2",
          daemon_build_id: "a1b2c3d", // 等于 LATEST_VERSION.latest_build_id
        }),
      ]),
    );

    await renderAndWaitForRuntime();
    const card = await findCardByName("UpToDateClaude");

    // 协议 meta 仍渲染
    expect(within(card).getByText("ws")).toBeInTheDocument();
    // 徽标「最新」不再在卡片渲染（C-002）
    expect(within(card).queryByText("最新")).not.toBeInTheDocument();
  });

  it("build_id 有效但与 latest 不等 → 卡片不再渲染徽标（C-002，徽标上提 task-08）", async () => {
    daemon.listDaemonMachines.mockResolvedValue(
      wrapMachines([
        makeRuntime({
          id: "rt-old",
          name: "StaleClaude",
          daemon_version: "1.3.0",
          daemon_build_id: "zzzz999", // 不同于 a1b2c3d
        }),
      ]),
    );

    await renderAndWaitForRuntime();
    const card = await findCardByName("StaleClaude");

    // 协议 meta 仍渲染
    expect(within(card).getByText("ws")).toBeInTheDocument();
    // 徽标「可升级」不再在卡片渲染（C-002）
    expect(within(card).queryByText("可升级")).not.toBeInTheDocument();
  });

  it("build_id === 'dev' → 卡片不再渲染徽标（C-002，徽标上提 task-08）", async () => {
    daemon.listDaemonMachines.mockResolvedValue(
      wrapMachines([
        makeRuntime({
          id: "rt-dev",
          name: "DevClaude",
          daemon_version: "0.0.0-dev",
          daemon_build_id: "dev",
        }),
      ]),
    );

    await renderAndWaitForRuntime();
    const card = await findCardByName("DevClaude");

    // 协议 meta 仍渲染
    expect(within(card).getByText("ws")).toBeInTheDocument();
    // 徽标「dev」不再在卡片渲染（C-002）
    expect(within(card).queryByText("dev")).not.toBeInTheDocument();
  });

  it("daemon_version 为 null → 卡片 meta 区仅渲染既有项（C-002，版本号/徽标上提 task-08）", async () => {
    daemon.listDaemonMachines.mockResolvedValue(
      wrapMachines([
        makeRuntime({
          id: "rt-unknown",
          name: "UnknownClaude",
          daemon_version: null,
          daemon_build_id: null,
        }),
      ]),
    );

    await renderAndWaitForRuntime();
    const card = await findCardByName("UnknownClaude");

    // 协议 meta 仍渲染（既有项）
    expect(within(card).getByText("ws")).toBeInTheDocument();
    // 卡片不再渲染「未知」版本号 / 徽标（C-002 上提机器头）
    expect(within(card).queryByText("未知")).not.toBeInTheDocument();
  });
});

describe("2026-07-04-daemon-version-management task-09: 升级按钮（task-09 上提机器头）", () => {
  // task-09：升级按钮上提 MachineCard 机器头，文本「升级 daemon」，调
  // triggerMachineSelfUpdate(instance.id)；machine.status 控制离线 disabled。
  // 用例不再展开 runtime 卡（按钮在机器头），直接 screen 级定位按钮。

  it("点击「升级 daemon」调 triggerMachineSelfUpdate(instance.id)", async () => {
    daemon.listDaemonMachines.mockResolvedValue(
      wrapMachines([
        makeRuntime({
          id: "rt-up",
          name: "UpgradeClaude",
          daemon_version: "1.3.0",
          daemon_build_id: "zzzz999",
          status: "online",
        }),
      ]),
    );

    await renderAndWaitForRuntime();
    // 升级按钮在机器头（非 runtime article），screen 级定位。
    const btn = findUpgradeButton();
    fireEvent.click(btn);

    await waitFor(() => {
      expect(daemon.triggerMachineSelfUpdate).toHaveBeenCalledWith("m-1");
    });
  });

  it("离线 machine 升级按钮 disabled（不调 triggerMachineSelfUpdate）", async () => {
    daemon.listDaemonMachines.mockResolvedValue(
      wrapMachines(
        [
          makeRuntime({
            id: "rt-off",
            name: "OfflineClaude",
            status: "offline",
            daemon_version: "1.3.0",
            daemon_build_id: "zzzz999",
          }),
        ],
        { status: "offline" },
      ),
    );

    await renderAndWaitForRuntime();
    const btn = findUpgradeButton();
    expect(btn).toBeDisabled();

    fireEvent.click(btn);
    // disabled 按钮不触发 click handler，triggerMachineSelfUpdate 不应被调
    expect(daemon.triggerMachineSelfUpdate).not.toHaveBeenCalled();
  });

  it("升级失败 → 调 triggerMachineSelfUpdate 抛错（失败路径覆盖）", async () => {
    const { ApiError } = await import("@/lib/api");
    daemon.listDaemonMachines.mockResolvedValue(
      wrapMachines([
        makeRuntime({
          id: "rt-fail",
          name: "FailClaude",
          status: "online",
          daemon_version: "1.3.0",
          daemon_build_id: "zzzz999",
        }),
      ]),
    );
    daemon.triggerMachineSelfUpdate.mockRejectedValueOnce(
      new ApiError(504, {
        code: "DAEMON_OFFLINE",
        message: "daemon 离线",
        request_id: null,
        details: null,
      }),
    );

    await renderAndWaitForRuntime();
    const btn = findUpgradeButton();
    fireEvent.click(btn);

    await waitFor(() => {
      expect(daemon.triggerMachineSelfUpdate).toHaveBeenCalledWith("m-1");
    });
  });
});

describe("2026-08-28-daemon-agent-share task-09: 共享给我的区块 + 平台共享智能体管理卡", () => {
  /** SharedMachineView 契约 fixture（task-02 provides 五字段 + task-13 runtimes 明细）。 */
  const SHARED_ONLINE = {
    machine_id: "sm-1",
    display_name: "林工的笔记本",
    lender_display_name: "林工",
    source_workspace_id: "ws-1",
    online: true,
    runtimes: [
      { runtime_id: "srt-1", provider: "claude", online: true },
      { runtime_id: "srt-2", provider: "codex", online: false },
    ],
  };
  const SHARED_OFFLINE = {
    machine_id: "sm-2",
    display_name: "测试机-02",
    lender_display_name: "陈晨",
    source_workspace_id: "ws-1",
    online: false,
  };

  it("shared_to_me 渲染共享区块：统计计数=条数 + 卡片信息 + 仅「会话」按钮（FR-01/FR-03）", async () => {
    daemon.listDaemonMachines.mockResolvedValue({
      ...wrapMachines([makeRuntime()]),
      shared_to_me: [SHARED_ONLINE, SHARED_OFFLINE],
    } as ReturnType<typeof wrapMachines> & { shared_to_me: unknown[] });
    workspaces.list.mockResolvedValue({
      items: [{ id: "ws-1", name: "multi-agent-platform", display_alias: null }],
      total: 1,
      limit: 100,
      offset: 0,
    });

    await renderAndWaitForRuntime();

    // 统计行：「共享给我」计数卡 = shared_to_me 条数（2）
    const stat = screen.getByTestId("stat-shared-to-me");
    expect(within(stat).getByText("共享给我")).toBeInTheDocument();
    expect(within(stat).getByText("2")).toBeInTheDocument();

    // 区块渲染：卡片信息（机器名/共享人/来源工作区名）。
    const section = screen.getByTestId("shared-machines-section");
    expect(within(section).getByText("林工的笔记本")).toBeInTheDocument();
    expect(within(section).getByText("测试机-02")).toBeInTheDocument();
    expect(within(section).getByText(/共享人：林工/)).toBeInTheDocument();
    // 两张共享卡同来源工作区（ws-1）→ 来源工作区名出现两次。
    expect(within(section).getAllByText(/multi-agent-platform/)).toHaveLength(2);

    // FR-03：区块内操作仅「会话」；修改类按钮（别名/可写目录/升级/禁用/移除）不渲染。
    const sessionButtons = within(section).getAllByRole("button", { name: /会\s*话/ });
    expect(sessionButtons).toHaveLength(2);
    for (const label of ["别名", "可写目录", "升级", "禁用", "移除", "移出", "清理"]) {
      expect(
        within(section).queryByRole("button", { name: new RegExp(label.split("").join("\\s*")) }),
        `共享卡不应渲染「${label}」按钮`,
      ).toBeNull();
    }

    // 离线卡「会话」禁用；在线卡点击 → 唤起悬浮助手并锁定共享机器（FR-01）。
    const offlineBtn = within(
      screen.getByTestId("shared-machine-card-sm-2"),
    ).getByRole("button", { name: /会\s*话/ });
    expect(offlineBtn).toBeDisabled();

    const onlineBtn = within(
      screen.getByTestId("shared-machine-card-sm-1"),
    ).getByRole("button", { name: /会\s*话/ });
    fireEvent.click(onlineBtn);
    // task-13：机器级 grant 的会话锁定在线 runtime 粒度（runtime_id 非 machine_id）。
    expect(useFloatingSessionStore.getState().lockedRuntime).toEqual({
      id: "srt-1",
      machineLabel: "林工的笔记本",
      providerLabel: PROVIDER_META.claude?.label ?? "claude",
    });
  });

  it("无共享数据 → 区块不渲染、计数 0（既有断言零变化，兼容红线）", async () => {
    daemon.listDaemonMachines.mockResolvedValue(wrapMachines([makeRuntime()]));
    await renderAndWaitForRuntime();

    expect(screen.queryByTestId("shared-machines-section")).toBeNull();
    expect(screen.queryByText("共享给我的")).toBeNull();
    const stat = screen.getByTestId("stat-shared-to-me");
    expect(within(stat).getByText("0")).toBeInTheDocument();
  });

  it("管理卡仅 platform admin 渲染（非 admin 不出现该卡）", async () => {
    daemon.listDaemonMachines.mockResolvedValue(wrapMachines([makeRuntime()]));
    await renderAndWaitForRuntime();
    expect(screen.queryByTestId("platform-shared-agents-card")).toBeNull();
    expect(screen.queryByText("平台共享智能体")).toBeNull();
  });

  it("管理卡 platform admin 渲染（标题 + 表单挂载）", async () => {
    useSession.setState({
      accessToken: "tok",
      hydrated: true,
      user: {
        id: "u-admin",
        email: "admin@example.com",
        displayName: "管理员",
        is_platform_admin: true,
      },
    } as never);
    daemon.listDaemonMachines.mockResolvedValue(wrapMachines([makeRuntime()]));
    // 管理卡自身经 useDaemonMachines({user_id}) 拉自己名下机器——复用同 mock。
    await renderAndWaitForRuntime();

    expect(screen.getByTestId("platform-shared-agents-card")).toBeInTheDocument();
    expect(screen.getByText("平台共享智能体")).toBeInTheDocument();
    expect(screen.getByText(/仅平台管理员/)).toBeTruthy();
    // quick-6625a929：卡默认折叠——表单不渲染，头部展开按钮常驻；展开后表单挂载
    // （交互细节归组件测试）。
    expect(screen.queryByText(/共享输出目录 writable_dir/)).toBeNull();
    fireEvent.click(screen.getByTestId("platform-shared-agents-toggle"));
    expect(await screen.findByText(/共享输出目录 writable_dir/)).toBeInTheDocument();
  });
});
