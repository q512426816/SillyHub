/**
 * task-15: workspaces/[id]/page.tsx daemon-client 扫描入口 page 层测试（D-006@v1）。
 *
 * 覆盖 task-14 的 page 改动：daemon-client 三策略显示「扫描」按钮、点击触发
 * scanGenerate（带 spec_strategy）、与 platform-managed「初始化」共存。
 * scanGenerate 的 spec_strategy 透传契约由 lib/workspaces.test.ts 覆盖；
 * AgentRunPanel 内部 SSE/markdown 不在本测试范围（整体 mock）。
 */
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import WorkspaceDetailPage from "@/app/(dashboard)/workspaces/[id]/page";
import type { SpecWorkspace } from "@/lib/spec-workspaces";
import type { Workspace } from "@/lib/workspaces";

// ── next/link mock（详情页多处用 Link）──────────────────────────────────────
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// ── AgentRunPanel 整体 mock（隔离 SSE + markdown-text jsdom null）─────────────
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

const specApi = vi.hoisted(() => ({ getSpecWorkspace: vi.fn() }));
vi.mock("@/lib/spec-workspaces", async () => {
  const actual = await vi.importActual<typeof import("@/lib/spec-workspaces")>("@/lib/spec-workspaces");
  return { ...actual, getSpecWorkspace: specApi.getSpecWorkspace };
});

vi.mock("@/lib/components", () => ({ listComponents: vi.fn(async () => ({ items: [], total: 0 })) }));
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

async function renderWithStrategy(strategy: "platform-managed" | "repo-mirrored" | "repo-native") {
  const { ws, specWs } = makeWorkspace(strategy);
  workspacesApi.getWorkspace.mockResolvedValue(ws);
  specApi.getSpecWorkspace.mockResolvedValue(specWs);
  workspacesApi.scanGenerate.mockResolvedValue({ workspace_id: "ws-1", agent_run_id: "run-1" });
  render(<WorkspaceDetailPage params={{ id: "ws-1" }} />);
  await waitFor(() =>
    expect(screen.getAllByText("multi-agent-platform").length).toBeGreaterThan(0),
  );
  return { ws, specWs };
}

describe("WorkspaceDetailPage daemon-client 扫描入口（task-14 / D-006@v1）", () => {
  afterEach(() => vi.clearAllMocks());

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
});
