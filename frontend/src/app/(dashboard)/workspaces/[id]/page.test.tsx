/**
 * task-15: workspaces/[id]/page.tsx daemon-client 扫描入口 page 层测试（D-006@v1）。
 * task-08: 三态引导 + init dispatch + owner 门禁 + 409 确认框。
 *
 * 覆盖 task-14 的 page 改动：daemon-client 三策略显示「扫描」按钮、点击触发
 * scanGenerate（带 spec_strategy）、与 platform-managed「初始化」共存。
 * task-08 覆盖：未初始化/已初始化未扫描/已扫描三态引导、初始化按钮改调 initDispatch、
 * 扫描按钮非 owner 禁用提示、owner 已扫时弹确认。
 *
 * scanGenerate 的 spec_strategy 透传契约由 lib/workspaces.test.ts 覆盖；
 * AgentRunPanel 内部 SSE/markdown 不在本测试范围（整体 mock）。
 */
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
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

// ── AgentRunPanel 整体 mock（隔离 SSE + markdown-text jsdom null）─────────────
// MarkdownText（next/dynamic ssr:false）在 jsdom 下一直为 null（已知坑
// frontend-markdown-text-jsdom-null）。AgentRunPanel mock 整体隔离，无需再单独 mock。
// 其他 test 需要 MarkdownText 时分两种模式：测试父组件逻辑→vi.mock 成纯文本渲染；
vi.mock("@/components/agent-run-panel", () => ({
  AgentRunPanel: ({ onDone }: { onDone?: (status: string) => void }) => (
    <div data-testid="agent-run-panel-mock">
      <button onClick={() => onDone?.("failed")}>模拟扫描失败</button>
    </div>
  ),
}));

// ── 子组件 mock（减少依赖）───────────────────────────────────────────────────
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

const componentsApi = vi.hoisted(() => ({ listComponents: vi.fn() }));
vi.mock("@/lib/components", () => ({ listComponents: componentsApi.listComponents }));

vi.mock("@/lib/changes", () => ({ listChanges: vi.fn(async () => ({ items: [], total: 0 })) }));
vi.mock("@/lib/agent", async () => {
  const actual = await vi.importActual<typeof import("@/lib/agent")>("@/lib/agent");
  return { ...actual, listAgentRuns: vi.fn(async () => []) };
});
vi.mock("@/lib/runtime", () => ({ getRuntimeProgress: vi.fn(async () => null) }));
vi.mock("@/lib/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/lib/daemon")>("@/lib/daemon");
  return { ...actual, getDaemonRuntime: vi.fn(async () => null) };
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
    path_source: "daemon-client",
    daemon_runtime_id: "rid-1",
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

describe("WorkspaceDetailPage daemon-client 扫描入口（task-14 / D-006@v1 + task-08）", () => {
  afterEach(() => {
    vi.clearAllMocks();
    useSession.getState().clear();
  });

  // ── 既有 task-14 测试（保持向后兼容）──

  it("daemon-client 三策略均显示「扫描」按钮", async () => {
    for (const strat of ["platform-managed", "repo-mirrored", "repo-native"] as const) {
      cleanup();
      await renderWithStrategy(strat);
      expect(screen.getByRole("button", { name: "扫描" })).toBeInTheDocument();
    }
  });

  it("platform-managed 同时显示「初始化」+「扫描」", async () => {
    await renderWithStrategy("platform-managed");
    expect(screen.getByRole("button", { name: "初始化" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "扫描" })).toBeInTheDocument();
  });

  it("点击「扫描」触发 scanGenerate 带 daemon-client + spec_strategy", async () => {
    await renderWithStrategy("repo-native");
    fireEvent.click(screen.getByRole("button", { name: "扫描" }));
    await waitFor(() => expect(workspacesApi.scanGenerate).toHaveBeenCalled());
    expect(workspacesApi.scanGenerate.mock.calls.length).toBeGreaterThan(0);
    const args = workspacesApi.scanGenerate.mock.calls[0]!;
    expect(args[0]).toBe("C:/proj"); // root_path
    expect(args[3]).toBe("daemon-client"); // path_source
    expect(args[4]).toBe("rid-1"); // daemon_runtime_id
    expect(args[5]).toBe("repo-native"); // spec_strategy
  });

  it("scan 中断(failed)显示「重新扫描」入口而非冷冰冰失败（ql-20260630-001）", async () => {
    await renderWithStrategy("repo-native");
    fireEvent.click(screen.getByRole("button", { name: "扫描" }));
    await waitFor(() =>
      expect(screen.getByTestId("agent-run-panel-mock")).toBeInTheDocument(),
    );
    // 模拟 daemon 重启：后端 _converge_crashed_run 把 run 收敛为 failed
    fireEvent.click(screen.getByRole("button", { name: "模拟扫描失败" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "重新扫描" })).toBeInTheDocument(),
    );
    expect(screen.getByText(/上次扫描未完成/)).toBeInTheDocument();
  });

  // ── task-08 三态引导 ──

  it("未初始化时显示「初始化」按钮 + 引导", async () => {
    await renderWithStrategy("platform-managed");
    // 未初始化 → init_synced_at 为 null → 蓝色引导
    expect(screen.getByText("此工作区尚未初始化。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "初始化" })).toBeInTheDocument();
    // 不应出现已初始化或就绪提示
    expect(screen.queryByText("已初始化，但工作区尚无扫描文档。")).not.toBeInTheDocument();
    expect(screen.queryByText("工作区已就绪。")).not.toBeInTheDocument();
  });

  it("已初始化·未扫描时显示请先扫描引导", async () => {
    await renderWithStrategy("platform-managed", {
      initSyncedAt: "2026-07-02T10:00:00Z",
      componentCount: 0,
    });
    expect(screen.getByText("已初始化，但工作区尚无扫描文档。")).toBeInTheDocument();
    expect(screen.getByText(/请由 owner 点击/)).toBeInTheDocument();
    // 不应出现未初始化或就绪
    expect(screen.queryByText("此工作区尚未初始化。")).not.toBeInTheDocument();
    expect(screen.queryByText("工作区已就绪。")).not.toBeInTheDocument();
  });

  it("已初始化·已扫描时显示就绪引导", async () => {
    await renderWithStrategy("platform-managed", {
      initSyncedAt: "2026-07-02T10:00:00Z",
      componentCount: 3,
    });
    expect(screen.getByText("工作区已就绪。")).toBeInTheDocument();
    expect(screen.getByText(/规范文档已同步/)).toBeInTheDocument();
    // 不应出现未初始化或请先扫描
    expect(screen.queryByText("此工作区尚未初始化。")).not.toBeInTheDocument();
    expect(screen.queryByText("已初始化，但工作区尚无扫描文档。")).not.toBeInTheDocument();
  });

  // ── task-08 init dispatch ──

  it("点击「初始化」调用 initDispatch 并显示进行中", async () => {
    const mockInitDispatch = vi.fn().mockResolvedValue({
      lease_id: "lease-1",
      runtime_id: "rid-1",
      claim_token: "tok-1",
    });
    // 临时替换 initDispatch mock
    vi.mocked(await import("@/lib/spec-workspaces")).initDispatch = mockInitDispatch;

    await renderWithStrategy("platform-managed");
    fireEvent.click(screen.getByRole("button", { name: "初始化" }));

    await waitFor(() => {
      expect(mockInitDispatch).toHaveBeenCalledWith("ws-1");
      expect(screen.getByText("初始化进行中...")).toBeInTheDocument();
    });
  });

  // ── task-08 owner 门禁 ──

  it("非 owner 扫描按钮禁用 + title 提示", async () => {
    useSession.getState().setUser({
      id: "user-2",
      email: "other@test.com",
      displayName: "Other User",
    });
    // 创建 owner 为 user-1 的工作区
    const ws = {
      id: "ws-1",
      name: "multi-agent-platform",
      slug: "multi-agent-platform",
      root_path: "C:/proj",
      status: "active",
      path_source: "daemon-client",
      daemon_runtime_id: "rid-1",
      owner: { user_id: "user-1", email: "owner@test.com", display_name: "Owner" },
      default_agent: null,
      default_model: null,
      created_at: "2026-06-30T00:55:11Z",
      last_scanned_at: "2026-06-30T00:55:11Z",
    } as unknown as Workspace;
    const specWs = {
      id: "sw-1",
      workspace_id: "ws-1",
      spec_root: "/data/spec-workspaces/ws-1",
      strategy: "repo-native" as const,
      repo_sillyspec_path: null,
      profile_version: "0.1.0",
      sync_status: "clean",
      last_synced_at: "2026-06-30T00:55:27Z",
      created_at: "2026-06-30T00:55:12Z",
      updated_at: "2026-06-30T00:55:27Z",
    } as unknown as SpecWorkspace;

    workspacesApi.getWorkspace.mockResolvedValue(ws);
    specApi.getSpecWorkspace.mockResolvedValue(specWs);
    workspacesApi.scanGenerate.mockResolvedValue({ workspace_id: "ws-1", agent_run_id: "run-1" });
    componentsApi.listComponents.mockResolvedValue({ items: [], total: 0 });
    mockDefaultBinding();

    render(<WorkspaceDetailPage params={{ id: "ws-1" }} />);
    await waitFor(() =>
      expect(screen.getAllByText("multi-agent-platform").length).toBeGreaterThan(0),
    );

    const scanBtn = screen.getByRole("button", { name: "扫描" });
    expect(scanBtn).toBeDisabled();
    expect(scanBtn).toHaveAttribute("title", "仅 owner 可扫描");
  });

  it("owner 已有扫描结果时点扫描弹确认框", async () => {
    // 当前用户即 owner
    useSession.getState().setUser({
      id: "user-1",
      email: "owner@test.com",
      displayName: "Owner",
    });

    await renderWithStrategy("repo-native", {
      initSyncedAt: "2026-07-02T10:00:00Z",
      componentCount: 3, // 已有扫描结果
    });

    // mock confirm → 取消
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    fireEvent.click(screen.getByRole("button", { name: "扫描" }));

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalled();
      expect(workspacesApi.scanGenerate).not.toHaveBeenCalled(); // 取消不调用
    });

    confirmSpy.mockRestore();
  });

  it("owner 确认重扫后调用 scanGenerate", async () => {
    useSession.getState().setUser({
      id: "user-1",
      email: "owner@test.com",
      displayName: "Owner",
    });

    await renderWithStrategy("repo-native", {
      initSyncedAt: "2026-07-02T10:00:00Z",
      componentCount: 3,
    });

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    fireEvent.click(screen.getByRole("button", { name: "扫描" }));

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalled();
      expect(workspacesApi.scanGenerate).toHaveBeenCalledTimes(1);
    });

    confirmSpy.mockRestore();
  });

  // ── task-14 / D-012：同步按钮状态机 ──

  it("已就绪（initSynced + componentCount > 0）时显示「同步到服务器」按钮", async () => {
    specApi.syncManual.mockResolvedValue({ status: "done" });
    await renderWithStrategy("platform-managed", {
      initSyncedAt: "2026-07-02T10:00:00Z",
      componentCount: 3,
    });
    expect(screen.getByRole("button", { name: "同步到服务器" })).toBeInTheDocument();
  });

  it("未就绪时不显示同步按钮", async () => {
    specApi.syncManual.mockResolvedValue({ status: "done" });
    // componentCount=0 → 未就绪
    await renderWithStrategy("platform-managed", {
      initSyncedAt: "2026-07-02T10:00:00Z",
      componentCount: 0,
    });
    expect(screen.queryByRole("button", { name: "同步到服务器" })).not.toBeInTheDocument();

    cleanup();
    // initSyncedAt=null → 未就绪
    await renderWithStrategy("platform-managed", {
      initSyncedAt: null,
      componentCount: 3,
    });
    expect(screen.queryByRole("button", { name: "同步到服务器" })).not.toBeInTheDocument();
  });

  it("syncManual 返 done → 按钮变「已同步」+ 反馈展示", async () => {
    specApi.syncManual.mockResolvedValue({ status: "done" });
    await renderWithStrategy("platform-managed", {
      initSyncedAt: "2026-07-02T10:00:00Z",
      componentCount: 3,
    });
    fireEvent.click(screen.getByRole("button", { name: "同步到服务器" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "已同步" })).toBeInTheDocument();
      expect(screen.getByText("已同步。")).toBeInTheDocument();
    });
  });

  it("syncManual 失败 → 显示失败反馈", async () => {
    specApi.syncManual.mockRejectedValue(new Error("网络错误"));
    await renderWithStrategy("platform-managed", {
      initSyncedAt: "2026-07-02T10:00:00Z",
      componentCount: 3,
    });
    fireEvent.click(screen.getByRole("button", { name: "同步到服务器" }));
    await waitFor(() => {
      expect(screen.getByText("同步失败。")).toBeInTheDocument();
    });
  });
});
