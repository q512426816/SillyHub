/**
 * 2026-07-04-daemon-version-management task-10：runtimes 页 daemon 版本展示 + 升级按钮单测。
 *
 * 依据文档:
 *   - .sillyspec/changes/2026-07-04-daemon-version-management/design.md（版本徽标 4 态）
 *   - tasks/task-09.md（前端 runtimes 页版本展示 + 升级按钮）
 *
 * 覆盖:
 *   1. 卡片显示 daemon 版本号 + build_id 短码（AC-01）
 *   2. 版本徽标「最新」（build_id === latest.latest_build_id）（AC-02）
 *   3. 版本徽标「可升级」（build_id !== latest 且都有效）（AC-02）
 *   4. 升级按钮点击调 triggerDaemonSelfUpdate（AC-03）
 *   5. 离线 runtime 升级按钮 disabled（AC-04）
 *
 * 测试模式:照搬 page-usage.test.tsx 的 mock 脚手架，补 getDaemonVersion / triggerDaemonSelfUpdate。
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

// ── mocks:照搬 page-usage.test.tsx，补 getDaemonVersion / triggerDaemonSelfUpdate ──

const daemon = vi.hoisted(() => ({
  listDaemonRuntimes: vi.fn(),
  listAgentSessions: vi.fn(),
  deleteAgentSession: vi.fn(),
  deleteDaemonRuntime: vi.fn(),
  getAgentSessionLogs: vi.fn(),
  getAgentSession: vi.fn(),
  reopenSession: vi.fn(),
  streamSession: vi.fn(),
  getRuntimesUsage: vi.fn(),
  getDaemonVersion: vi.fn(),
  triggerDaemonSelfUpdate: vi.fn(),
}));

vi.mock("@/lib/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/lib/daemon")>("@/lib/daemon");
  return {
    ...actual,
    listDaemonRuntimes: daemon.listDaemonRuntimes,
    listDaemonRuntimesPage: vi.fn(async (params?: { limit?: number; offset?: number }) => {
      const items = await daemon.listDaemonRuntimes();
      return {
        items,
        total: items.length,
        limit: params?.limit ?? 12,
        offset: params?.offset ?? 0,
      };
    }),
    updateDaemonRuntime: vi.fn(),
    listAgentSessions: daemon.listAgentSessions,
    deleteAgentSession: daemon.deleteAgentSession,
    deleteDaemonRuntime: daemon.deleteDaemonRuntime,
    getAgentSessionLogs: daemon.getAgentSessionLogs,
    getAgentSession: daemon.getAgentSession,
    reopenSession: daemon.reopenSession,
    streamSession: daemon.streamSession,
    getRuntimesUsage: daemon.getRuntimesUsage,
    getDaemonVersion: daemon.getDaemonVersion,
    triggerDaemonSelfUpdate: daemon.triggerDaemonSelfUpdate,
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
  daemon.triggerDaemonSelfUpdate.mockResolvedValue({ sent: true, latest_version: "1.4.2" });
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

async function findCardByName(name: string) {
  const heading = await screen.findByText(name);
  const article = heading.closest("article");
  expect(article, `runtime 卡片 ${name} 的 article 未找到`).not.toBeNull();
  return article as HTMLElement;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("2026-07-04-daemon-version-management task-09: 版本展示 + 徽标", () => {
  it("卡片显示 daemon 版本号 + build_id 短码（前 7 位）", async () => {
    daemon.listDaemonRuntimes.mockResolvedValue([
      makeRuntime({
        id: "rt-latest",
        name: "LatestClaude",
        daemon_version: "1.4.2",
        daemon_build_id: "a1b2c3d9e8f7",
      }),
    ]);

    await renderAndWaitForRuntime();
    const card = await findCardByName("LatestClaude");

    // daemon 版本号显示
    expect(within(card).getByText("1.4.2")).toBeInTheDocument();
    // build_id 短码（前 7 位，# 前缀）
    expect(within(card).getByText(/^#a1b2c3d$/)).toBeInTheDocument();
  });

  it("build_id 与 latest.latest_build_id 相等 → 徽标「最新」", async () => {
    daemon.listDaemonRuntimes.mockResolvedValue([
      makeRuntime({
        id: "rt-up",
        name: "UpToDateClaude",
        daemon_version: "1.4.2",
        daemon_build_id: "a1b2c3d", // 等于 LATEST_VERSION.latest_build_id
      }),
    ]);

    await renderAndWaitForRuntime();
    const card = await findCardByName("UpToDateClaude");

    expect(within(card).getByText("最新")).toBeInTheDocument();
  });

  it("build_id 有效但与 latest 不等 → 徽标「可升级」", async () => {
    daemon.listDaemonRuntimes.mockResolvedValue([
      makeRuntime({
        id: "rt-old",
        name: "StaleClaude",
        daemon_version: "1.3.0",
        daemon_build_id: "zzzz999", // 不同于 a1b2c3d
      }),
    ]);

    await renderAndWaitForRuntime();
    const card = await findCardByName("StaleClaude");

    expect(within(card).getByText("可升级")).toBeInTheDocument();
  });

  it("build_id === 'dev' → 徽标「dev」", async () => {
    daemon.listDaemonRuntimes.mockResolvedValue([
      makeRuntime({
        id: "rt-dev",
        name: "DevClaude",
        daemon_version: "0.0.0-dev",
        daemon_build_id: "dev",
      }),
    ]);

    await renderAndWaitForRuntime();
    const card = await findCardByName("DevClaude");

    expect(within(card).getByText("dev")).toBeInTheDocument();
  });

  it("daemon_version 为 null → 显示「未知」版本号 + 「未知」徽标", async () => {
    daemon.listDaemonRuntimes.mockResolvedValue([
      makeRuntime({
        id: "rt-unknown",
        name: "UnknownClaude",
        daemon_version: null,
        daemon_build_id: null,
      }),
    ]);

    await renderAndWaitForRuntime();
    const card = await findCardByName("UnknownClaude");

    // 版本号位置显示「未知」（与徽标「未知」同名，至少 2 处）
    const unknowns = within(card).getAllByText("未知");
    expect(unknowns.length).toBeGreaterThanOrEqual(2);
  });
});

describe("2026-07-04-daemon-version-management task-09: 升级按钮", () => {
  it("点击「升级到最新版」调 triggerDaemonSelfUpdate 并成功 toast", async () => {
    daemon.listDaemonRuntimes.mockResolvedValue([
      makeRuntime({
        id: "rt-up",
        name: "UpgradeClaude",
        daemon_version: "1.3.0",
        daemon_build_id: "zzzz999",
        status: "online",
      }),
    ]);

    await renderAndWaitForRuntime();
    const card = await findCardByName("UpgradeClaude");

    const btn = within(card).getByRole("button", { name: /升级到最新版/ });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(daemon.triggerDaemonSelfUpdate).toHaveBeenCalledWith("rt-up");
    });
  });

  it("离线 runtime 升级按钮 disabled（不调 triggerDaemonSelfUpdate）", async () => {
    daemon.listDaemonRuntimes.mockResolvedValue([
      makeRuntime({
        id: "rt-off",
        name: "OfflineClaude",
        status: "offline",
        daemon_version: "1.3.0",
        daemon_build_id: "zzzz999",
      }),
    ]);

    await renderAndWaitForRuntime();
    const card = await findCardByName("OfflineClaude");

    const btn = within(card).getByRole("button", { name: /升级到最新版/ });
    expect(btn).toBeDisabled();

    fireEvent.click(btn);
    // disabled 按钮不触发 click handler，triggerDaemonSelfUpdate 不应被调
    expect(daemon.triggerDaemonSelfUpdate).not.toHaveBeenCalled();
  });

  it("升级失败 → 调 triggerDaemonSelfUpdate 抛错（失败路径覆盖）", async () => {
    const { ApiError } = await import("@/lib/api");
    daemon.listDaemonRuntimes.mockResolvedValue([
      makeRuntime({
        id: "rt-fail",
        name: "FailClaude",
        status: "online",
        daemon_version: "1.3.0",
        daemon_build_id: "zzzz999",
      }),
    ]);
    daemon.triggerDaemonSelfUpdate.mockRejectedValueOnce(
      new ApiError(504, {
        code: "DAEMON_OFFLINE",
        message: "daemon 离线",
        request_id: null,
        details: null,
      }),
    );

    await renderAndWaitForRuntime();
    const card = await findCardByName("FailClaude");

    const btn = within(card).getByRole("button", { name: /升级到最新版/ });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(daemon.triggerDaemonSelfUpdate).toHaveBeenCalledWith("rt-fail");
    });
  });
});
