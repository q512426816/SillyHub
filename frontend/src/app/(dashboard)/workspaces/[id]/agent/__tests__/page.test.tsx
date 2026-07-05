/**
 * ql-20260702-002：agent 控制台 pending run 可见性测试。
 *
 * 覆盖 page.tsx 改动：pending run 并入活跃运行面板。原 runningRuns/completedRuns
 * 两条派生流都过滤掉 pending，但"总运行"SummaryCard=runs.length 把 pending 算进去了，
 * 导致用户看到"总运行 1"却看不到任何 run 也点不到日志。修复后 pending 应可见。
 *
 * 验证：pending 卡片在活跃面板可见 + "排队中"徽标 + 排队角标 + 总运行计数自洽 +
 * 终止 pending 调 killAgentRun（后端 kill_run 支持 pending lease 直接置 killed）。
 */

/**
 * task-12 / D-005：agent 页单次 provider 覆盖 workspace.default_agent。
 *
 * 覆盖 page.tsx 改动：新增"新运行"面板，内含 provider 选择器（默认回填
 * workspace.default_agent），发起 scanGenerate 时透传所选 provider 但不持久化。
 *
 * 验证：默认 provider（= default_agent）、单次覆盖（选不同 provider）、
 * daemon 未启用所选 provider（按钮禁用 + 提示）三态。
 */
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentRun } from "@/lib/agent";
import type { Workspace } from "@/lib/workspaces";
import type { MemberBindingView } from "@/lib/workspace-binding";
import type { DaemonRuntimeRead } from "@/lib/daemon";

// next/link mock（page 用 Link 渲染 task/change 链接）
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// AgentRunPanel 整体 mock（隔离 SSE + markdown-text jsdom null 坑，见
// frontend-markdown-text-jsdom-null 记忆）。
vi.mock("@/components/agent-run-panel", () => ({
  AgentRunPanel: () => <div data-testid="agent-run-panel-mock" />,
}));

// @/lib/agent：override killAgentRun（避免真实 fetch），其余用 actual。
const agentApi = vi.hoisted(() => ({ killAgentRun: vi.fn() }));
vi.mock("@/lib/agent", async () => {
  const actual = await vi.importActual<typeof import("@/lib/agent")>("@/lib/agent");
  return { ...actual, killAgentRun: agentApi.killAgentRun };
});

// @/lib/use-agent-runs：返回静态 runs，绕过 react-query Provider（只测 page 渲染逻辑）。
const runsState = vi.hoisted(() => ({ runs: [] as AgentRun[] }));
vi.mock("@/lib/use-agent-runs", () => ({
  useAgentRuns: () => ({
    runs: runsState.runs,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

// task-12 / D-005：mock workspace / binding / daemon runtime APIs
const mockWorkspace = vi.hoisted(() => vi.fn());
const mockFetchMyBinding = vi.hoisted(() => vi.fn());
const mockListDaemonRuntimes = vi.hoisted(() => vi.fn());
const mockScanGenerate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/workspaces", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspaces")>("@/lib/workspaces");
  return { ...actual, getWorkspace: mockWorkspace, scanGenerate: mockScanGenerate };
});
vi.mock("@/lib/workspace-binding", () => ({
  fetchMyBinding: mockFetchMyBinding,
}));
vi.mock("@/lib/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/lib/daemon")>("@/lib/daemon");
  return { ...actual, listDaemonRuntimes: mockListDaemonRuntimes };
});

import AgentPage from "@/app/(dashboard)/workspaces/[id]/agent/page";

function makeRun(o: Partial<AgentRun>): AgentRun {
  return {
    id: "runid01",
    task_id: null,
    lease_id: null,
    change_id: null,
    agent_type: "claude_code",
    provider: null,
    model: null,
    status: "pending",
    started_at: null,
    finished_at: null,
    exit_code: null,
    output_redacted: null,
    spec_strategy: "platform-managed",
    profile_version: null,
    diff_summary: null,
    created_at: "2026-07-02T15:00:00Z",
    total_cost_usd: null,
    duration_ms: null,
    duration_api_ms: null,
    num_turns: null,
    session_id: null,
    agent_session_id: null,
    input_tokens: null,
    output_tokens: null,
    cache_read_tokens: null,
    cache_creation_tokens: null,
    post_scan_status: null,
    source_commit: null,
    is_resume: null,
    resumed_from_step: null,
    ...o,
  } as unknown as AgentRun;
}

interface MockData {
  workspace: Workspace | null;
  binding: MemberBindingView | null;
  runtimes: DaemonRuntimeRead[];
}

const mockData = vi.hoisted((): MockData => ({
  workspace: null,
  binding: null,
  runtimes: [],
}));

beforeEach(() => {
  runsState.runs = [];
  agentApi.killAgentRun.mockReset();
  mockScanGenerate.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});

  // Default mock data：online daemon with claude + codex providers
  mockData.workspace = {
    id: "ws-1",
    name: "测试工作区",
    slug: "test-ws",
    root_path: "/home/test/project",
    path_source: "daemon-client",
    daemon_runtime_id: null, // daemon-entity-binding 后新工作区恒 NULL（绑定存 member binding 行）
    default_agent: "claude",
    default_model: null,
    status: "active",
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    component_key: null,
    type: null,
    role: null,
    repo_url: null,
    default_branch: null,
    tech_stack: [],
    build_command: null,
    test_command: null,
    source_yaml_path: null,
    created_by: null,
    last_scanned_at: null,
    deleted_at: null,
    owner: null,
  } as Workspace;
  mockData.binding = {
    workspace_id: "ws-1",
    user_id: "user-1",
    daemon_id: "daemon-1",
    runtime_id: null,
    root_path: "/home/test/project",
    path_source: "daemon-client",
    synced_at: null,
    last_scan_at: null,
    init_synced_at: null,
  } as MemberBindingView;
  mockData.runtimes = [
    { id: "rt-claude", daemon_instance_id: "daemon-1", provider: "claude", status: "online", name: null, version: null, os: null, arch: null, last_heartbeat_at: null, capabilities: null, allowed_roots: [], created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-01T00:00:00Z" },
    { id: "rt-codex", daemon_instance_id: "daemon-1", provider: "codex", status: "online", name: null, version: null, os: null, arch: null, last_heartbeat_at: null, capabilities: null, allowed_roots: [], created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-01T00:00:00Z" },
  ] as unknown as DaemonRuntimeRead[];

  mockWorkspace.mockResolvedValue(mockData.workspace);
  mockFetchMyBinding.mockResolvedValue(mockData.binding);
  mockListDaemonRuntimes.mockResolvedValue(mockData.runtimes);
  mockScanGenerate.mockResolvedValue({ workspace_id: "ws-1", agent_run_id: "new-run-001" });
});
afterEach(() => cleanup());

describe("agent page — provider override (task-12 / D-005)", () => {
  it("默认 provider 回填 workspace.default_agent（claude）", async () => {
    render(<AgentPage params={{ id: "ws-1" }} />);
    // 等待数据加载完成后，"新运行"面板应出现
    await waitFor(() => {
      expect(screen.getByText("新运行")).toBeInTheDocument();
    });
    // 选择框默认选中 default_agent（claude），因 claude 在在线列表内
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("claude");
    // 启动按钮应可用
    expect(screen.getByRole("button", { name: /启动扫描/ })).toBeEnabled();
  });

  it("单次覆盖：选择 codex 并启动，scanGenerate 收到 codex 而非 default_agent", async () => {
    render(<AgentPage params={{ id: "ws-1" }} />);
    await waitFor(() => {
      expect(screen.getByText("新运行")).toBeInTheDocument();
    });
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    // 切换到 codex
    fireEvent.change(select, { target: { value: "codex" } });
    expect(select.value).toBe("codex");
    // 点击启动
    fireEvent.click(screen.getByRole("button", { name: /启动扫描/ }));
    await waitFor(() => {
      expect(mockScanGenerate).toHaveBeenCalledWith(
        "/home/test/project",
        "codex", // 选中值为 codex，不是 default_agent claude
        null,
        "daemon-client",
        null, // daemonRuntimeId：legacy 字段，新链路不传
        undefined,
        "daemon-1", // daemonId 取自 myBinding.daemon_id（daemon-entity-binding 稳定绑定键）
      );
    });
  });

  it("daemon 未启用所选 provider → 禁用按钮并提示", async () => {
    // 清空 mock 数据：daemon 只启用 claude，不启用 glm
    mockData.runtimes = [
      { id: "rt-claude", daemon_instance_id: "daemon-1", provider: "claude", status: "online", name: null, version: null, os: null, arch: null, last_heartbeat_at: null, capabilities: null, allowed_roots: [], created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-01T00:00:00Z" },
    ] as unknown as DaemonRuntimeRead[];
    mockListDaemonRuntimes.mockResolvedValue(mockData.runtimes);

    render(<AgentPage params={{ id: "ws-1" }} />);
    await waitFor(() => {
      expect(screen.getByText("新运行")).toBeInTheDocument();
    });
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    // 切换到不存在的 provider "glm"（通过直接设置 value，因 fireEvent.change
    // 对 <select> 只触发已存在 <option> 的变更——"glm"不在 option 列表中）
    // 改用 fireEvent.select 或直接模拟选择不存在 option 的场景：
    // 清空默认的 claude 选项，选空项（""=跟随默认）也应可用。
    // 对于"未启用"场景，我们测试当 workspace.default_agent 指向不在线 provider 时
    // （如 workspace.default_agent="glm"），按钮应禁用并提示。
    // 重新设置 default_agent = "glm"
    mockData.workspace = {
      ...mockData.workspace!,
      default_agent: "glm",
    } as Workspace;
    mockWorkspace.mockResolvedValue(mockData.workspace);

    // 重渲染以用新的 workspace.default_agent
    cleanup();
    render(<AgentPage params={{ id: "ws-1" }} />);
    await waitFor(() => {
      expect(screen.getByText("新运行")).toBeInTheDocument();
    });
    // 默认选中 glm，但 daemon 未启用 glm
    // select value 应为 "glm"（虽不在 option 列表但也应渲染）
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("glm");
    // 启动按钮应禁用
    expect(screen.getByRole("button", { name: /启动扫描/ })).toBeDisabled();
    // 应显示 daemon 未启用提示（用 getAllByText 避免 select option 文本干扰）
    expect(screen.getAllByText(/守护进程未启用/).length).toBeGreaterThan(0);
  });
});

/* ── Existing tests (ql-20260702-002) ── */

describe("agent page — pending run 可见性 (ql-20260702-002)", () => {
  it("pending run 显示在活跃面板，带「排队中」徽标和 run id", () => {
    runsState.runs = [makeRun({ id: "pend0001", status: "pending" })];
    render(<AgentPage params={{ id: "ws-1" }} />);
    // 卡片"排队中"Badge（区别于 running 蓝脉动）。
    expect(screen.getByText("排队中")).toBeInTheDocument();
    // shortId：id 长度 <=8 返回原串。
    expect(screen.getByText("pend0001")).toBeInTheDocument();
  });

  it("running + pending 同时存在，两者都渲染且各有角标", () => {
    runsState.runs = [
      makeRun({ id: "runrun01", status: "running", started_at: "2026-07-02T15:00:00Z" }),
      makeRun({ id: "pendrun1", status: "pending" }),
    ];
    render(<AgentPage params={{ id: "ws-1" }} />);
    expect(screen.getByText("pendrun1")).toBeInTheDocument();
    expect(screen.getByText("runrun01")).toBeInTheDocument();
    // Header 角标：排队（琥珀）+ 运行（绿脉动）。
    expect(screen.getByText(/1 个排队中/)).toBeInTheDocument();
    expect(screen.getByText(/1 个运行中/)).toBeInTheDocument();
  });

  it("总运行 SummaryCard = runs.length（pending+running+completed 数字自洽）", () => {
    runsState.runs = [
      makeRun({ id: "aaaa1111", status: "pending" }),
      makeRun({ id: "bbbb2222", status: "running", started_at: "2026-07-02T15:00:00Z" }),
      makeRun({ id: "cccc3333", status: "completed", finished_at: "2026-07-02T15:01:00Z" }),
    ];
    render(<AgentPage params={{ id: "ws-1" }} />);
    // "总运行" label 的最近 div 含 label + value(3)。
    const totalLabel = screen.getByText("总运行");
    expect(totalLabel.closest("div")).toHaveTextContent("3");
  });

  it("终止 pending run 调用 killAgentRun(workspaceId, runId)", async () => {
    runsState.runs = [makeRun({ id: "kill0001", status: "pending" })];
    agentApi.killAgentRun.mockResolvedValue({});
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AgentPage params={{ id: "ws-1" }} />);
    fireEvent.click(screen.getByRole("button", { name: /终止/ }));
    await waitFor(() =>
      expect(agentApi.killAgentRun).toHaveBeenCalledWith("ws-1", "kill0001"),
    );
  });
});
