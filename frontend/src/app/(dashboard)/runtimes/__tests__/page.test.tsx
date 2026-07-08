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

const daemon = vi.hoisted(() => ({
  // task-09：page 数据源改 useDaemonMachines → listDaemonMachines。
  // 测试侧仍用 listDaemonRuntimes 收集 runtime 数组，再包成单个 machine 响应。
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
}));

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
  useSession.setState({ accessToken: "tok", hydrated: true } as never);
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
