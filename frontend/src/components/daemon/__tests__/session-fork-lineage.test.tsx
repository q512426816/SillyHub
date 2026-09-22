// task-08（2026-09-22-session-fork-continuation / FR-02 / FR-05 / D-002@v1）：
// 谱系溯源闭环组件测试——溯源块渲染（native/seed 档标注）/ 多跳面包屑 /
// 浮层泛化（title 透传+已分叉状态条）/ 列表分叉分组与徽标（不混分身树）/
// TurnForkEntry 挂载接线（engineAnchor/seq/onForkTurn prop 透传）。
//
// 覆盖（对照原型 prototype-session-fork.html 溯源块/浮层/列表徽标节）：
//   1. 溯源块：分叉自「源标题」第 N 轮后 + 引擎档 pill（native/seed 措辞与
//      fork-confirm-modal 同源，验收断言点）+ 点击上抛源会话 id；
//   2. 多跳面包屑：A → B → 当前（沿 fork_of 链逐跳拉祖先），祖先节点可点；
//   3. 源拉取失败降级（短 id 占位，块仍渲染可点）；非 fork 会话零占位；
//   4. WorkerSessionOverlay 泛化：title/statusHint/closeLabel 透传 + 缺省
//      「分身会话」零回归 + SessionPanel 收到目标会话 id；
//   5. 列表：分叉子会话挂源会话附属分组（「↦ 分叉 N」头，默认收起）+ 子行
//      「🔗 分叉」徽标；与分身组并行不混树（同源双组并存）；源不可见回落
//      主行不丢行；无 fork 会话零变化；
//   6. TurnTimeline forkEntry 接线：入口按轮渲染（engineAnchor 缺失置灰 /
//      进行中置灰 / 可点点击上抛 (runKey, seq)）；未接线零渲染。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type * as React from "react";

// ── 模块 mock（单文件单 factory，四处消费共用）──────────────────────────

const mocks = vi.hoisted(() => ({
  // 列表面板数据源
  listAgentSessions: vi.fn(),
  listWorkspaceAgentSessions: vi.fn(),
  listChangeSessions: vi.fn(),
  listGroupChats: vi.fn(),
  machinesHook: vi.fn(),
  machinesRefetch: vi.fn(),
  listWorkspaces: vi.fn(),
  listChanges: vi.fn(),
  listQuicklogEntries: vi.fn(),
  listPersonalPlanTasks: vi.fn(),
  listProblems: vi.fn(),
  listWorkspaceAgentLogs: vi.fn(),
  fetchMyBindings: vi.fn(),
  // task-08：谱系溯源数据源（LineageBlock 按需拉取）
  getAgentSession: vi.fn(),
  listSessionRuns: vi.fn(),
}));

vi.mock("@/lib/daemon", () => ({
  listAgentSessions: (...args: unknown[]) => mocks.listAgentSessions(...args),
  listWorkspaceAgentSessions: (...args: unknown[]) =>
    mocks.listWorkspaceAgentSessions(...args),
  listChangeSessions: (...args: unknown[]) => mocks.listChangeSessions(...args),
  listGroupChats: (...args: unknown[]) => mocks.listGroupChats(...args),
  createGroupChat: vi.fn(),
  getAgentSession: (...args: unknown[]) => mocks.getAgentSession(...args),
  listSessionRuns: (...args: unknown[]) => mocks.listSessionRuns(...args),
  forkSession: vi.fn(),
  PROVIDER_META: {
    claude: { label: "Claude Code", icon: "🟣", color: "" },
    codex: { label: "Codex", icon: "🟢", color: "" },
    pi: { label: "Pi", icon: "🩷", color: "" },
    cursor: { label: "Cursor", icon: "🟡", color: "" },
  },
  SESSION_SUPPORTED_PROVIDERS: ["claude", "codex", "pi", "cursor"],
  SESSION_ENGINE_OPTIONS: [
    { value: "claude", label: "Claude Code" },
    { value: "codex", label: "Codex" },
    { value: "pi", label: "Pi" },
    { value: "cursor", label: "Cursor" },
  ],
  AGENT_SESSIONS_TREE_FETCH_LIMIT: 500,
}));

vi.mock("@/lib/agent-logs", () => ({
  listWorkspaceAgentLogs: (...args: unknown[]) =>
    mocks.listWorkspaceAgentLogs(...args),
}));

vi.mock("@/lib/use-daemon-machines", () => ({
  useDaemonMachines: () => mocks.machinesHook(),
}));

vi.mock("@/lib/workspaces", () => ({
  listWorkspaces: (...args: unknown[]) => mocks.listWorkspaces(...args),
}));

vi.mock("@/lib/workspace-binding", () => ({
  fetchMyBindings: (...args: unknown[]) => mocks.fetchMyBindings(...args),
}));

vi.mock("@/lib/changes", () => ({
  listChanges: (...args: unknown[]) => mocks.listChanges(...args),
}));

vi.mock("@/lib/quicklog", () => ({
  listQuicklogEntries: (...args: unknown[]) => mocks.listQuicklogEntries(...args),
}));

vi.mock("@/lib/ppm/task", () => ({
  listPersonalPlanTasks: (...args: unknown[]) =>
    mocks.listPersonalPlanTasks(...args),
}));

vi.mock("@/lib/ppm/problem", () => ({
  listProblems: (...args: unknown[]) => mocks.listProblems(...args),
}));

vi.mock("@/lib/errors", () => ({
  errMessage: (err: unknown) =>
    err instanceof Error ? err.message : "操作失败",
  useNotify: () => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() }),
}));

// 浮层复用的 SessionPanel 打桩（真身依赖 SSE/机器列表，与溯源断言无关）。
vi.mock("@/components/daemon/session-panel", () => ({
  SessionPanel: (props: { sessionId: string }) => (
    <div data-testid="overlay-session-panel" data-session-id={props.sessionId} />
  ),
}));

import { LineageBlock } from "@/components/daemon/session-fork/lineage-block";
import { WorkerSessionOverlay } from "@/components/daemon/session-panel/worker-session-overlay";
import { TurnTimeline, type SessionTurnView } from "@/components/daemon/turn-timeline";
import {
  SessionListPanel,
  SESSION_TREE_EXPANSION_LS_KEY,
  SESSION_TREE_FILTER_LS_KEY,
  GROUP_SECTION_COLLAPSED_LS_KEY,
} from "@/components/sessions/session-list-panel";
import type {
  AgentSessionRead,
  DaemonMachineRead,
  DaemonRuntimeRead,
  SessionRunRead,
} from "@/lib/daemon";
import type { Workspace } from "@/lib/workspaces";
import { useSession } from "@/stores/session";

// ── 固件构造 ─────────────────────────────────────────────────────────────

function makeRuntime(
  overrides: Partial<DaemonRuntimeRead> = {},
): DaemonRuntimeRead {
  return {
    id: "rt-1",
    display_alias: null,
    name: null,
    provider: "claude",
    version: null,
    os: null,
    arch: null,
    status: "online",
    last_heartbeat_at: null,
    capabilities: null,
    allowed_roots: [],
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  } as DaemonRuntimeRead;
}

function makeMachine(
  overrides: Partial<DaemonMachineRead> = {},
): DaemonMachineRead {
  return {
    id: "m-1",
    hostname: "machine-1",
    display_alias: null,
    os: "windows",
    arch: "x64",
    status: "online",
    last_heartbeat_at: "2026-08-15T08:00:00Z",
    version: "1.0.0",
    build_id: null,
    started_at: null,
    created_at: "2026-08-01T00:00:00Z",
    runtime_count: 1,
    online_runtime_count: 1,
    runtimes: [makeRuntime({ id: "rt-m1" })],
    ...overrides,
  } as DaemonMachineRead;
}

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "ws-1",
    name: "SillyHub",
    slug: "sillyhub",
    root_path: "C:/sillyhub",
    status: "active",
    ...overrides,
  } as Workspace;
}

function makeSession(
  overrides: Partial<AgentSessionRead> = {},
): AgentSessionRead {
  return {
    id: "s-1",
    runtime_id: "rt-m1",
    lease_id: null,
    provider: "claude",
    status: "active",
    agent_session_id: null,
    config: null,
    agent_profile_id: null,
    llm_provider_id: null,
    config_snapshot: null,
    turn_count: 1,
    created_at: "2026-08-15T09:00:00Z",
    last_active_at: "2026-08-15T09:05:00Z",
    ended_at: null,
    title: "会话标题",
    deleted_at: null,
    current_run_id: null,
    origin: "chat",
    parent_session_id: null,
    tree_depth: 0,
    fork_of_session_id: null,
    fork_at_run_id: null,
    engine_fork_anchor: null,
    ...overrides,
  } as AgentSessionRead;
}

function makeRun(overrides: Partial<SessionRunRead> = {}): SessionRunRead {
  return {
    id: "run-1",
    created_at: "2026-09-22T10:00:00Z",
    spec_strategy: null,
    status: "completed",
    error_code: null,
    failure_summary: null,
    error_detail: null,
    started_at: "2026-09-22T10:00:00Z",
    finished_at: "2026-09-22T10:01:00Z",
    exit_code: null,
    agent_profile_snapshot: null,
    llm_provider_id: null,
    input_tokens: null,
    output_tokens: null,
    cache_read_tokens: null,
    cache_creation_tokens: null,
    metadata: null,
    ctx_tokens: null,
    engine_anchor: null,
    user_id: null,
    sender_name: null,
    ...overrides,
  } as SessionRunRead;
}

function makeTurn(over: Partial<SessionTurnView> = {}): SessionTurnView {
  return {
    runId: "run-1",
    turn: 1,
    prompt: "继续任务",
    output: "好的，继续。",
    status: "completed",
    seenLogIds: new Set<string>(),
    inputTokens: null,
    outputTokens: null,
    ctxTokens: null,
    errorDetail: null,
    processItems: [],
    segments: [],
    turnStartedAt: 0,
    ...over,
  };
}

/** 设置 useDaemonMachines 返回（默认成功空集）。 */
function setMachines(r: Partial<{ items: DaemonMachineRead[] }> = {}) {
  const items = r.items ?? [];
  mocks.machinesHook.mockReturnValue({
    items,
    sharedToMe: [],
    machineCandidates: items,
    total: items.length,
    sessions: [],
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: mocks.machinesRefetch,
  });
}

/** 设置 listWorkspaces 返回（默认成功空集）。 */
function setWorkspaces(items: Workspace[] = []) {
  mocks.listWorkspaces.mockResolvedValue({
    items,
    total: items.length,
    limit: 100,
    offset: 0,
  });
}

function listResponse(items: AgentSessionRead[]) {
  return { items, total: items.length, limit: 50, offset: 0 };
}

function renderPanel(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, refetchInterval: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

/** 展开工作区分组（默认折叠，点组头展开）。 */
async function openGroup(name: string) {
  const head = await screen.findByRole("button", {
    name: `工作区分组 ${name}`,
  });
  fireEvent.click(head);
  await waitFor(() => expect(head).toHaveAttribute("aria-expanded", "true"));
}

beforeEach(() => {
  mocks.listAgentSessions.mockReset().mockResolvedValue(listResponse([]));
  mocks.listWorkspaceAgentSessions.mockReset().mockResolvedValue([]);
  mocks.listChangeSessions.mockReset().mockResolvedValue([]);
  mocks.listGroupChats.mockReset().mockResolvedValue([]);
  mocks.listWorkspaces.mockReset();
  mocks.fetchMyBindings.mockReset().mockResolvedValue([]);
  mocks.listChanges.mockReset().mockResolvedValue({ items: [], total: 0 });
  mocks.listQuicklogEntries.mockReset().mockResolvedValue({ items: [], total: 0 });
  mocks.listPersonalPlanTasks
    .mockReset()
    .mockResolvedValue({ items: [], total: 0, page: 1, page_size: 100 });
  mocks.listProblems
    .mockReset()
    .mockResolvedValue({ items: [], total: 0, page: 1, page_size: 100 });
  mocks.listWorkspaceAgentLogs.mockReset().mockResolvedValue({ items: [] });
  mocks.getAgentSession.mockReset();
  mocks.listSessionRuns.mockReset();
  useSession.setState({ user: null });
  setWorkspaces();
  setMachines();
  mocks.machinesRefetch.mockReset();
  window.localStorage.removeItem(SESSION_TREE_EXPANSION_LS_KEY);
  window.localStorage.removeItem(SESSION_TREE_FILTER_LS_KEY);
  window.localStorage.removeItem(GROUP_SECTION_COLLAPSED_LS_KEY);
});

afterEach(() => {
  cleanup();
});

// ── 1+2+3. LineageBlock 溯源块 / 多跳面包屑 ─────────────────────────────

describe("LineageBlock 溯源块（单跳 native 档）", () => {
  it("渲染「分叉自「源标题」第 N 轮后」+ native 档 pill，点击上抛源会话 id", async () => {
    mocks.getAgentSession.mockResolvedValueOnce(
      makeSession({ id: "s-a", title: "重构方案讨论" }),
    );
    // desc 序 [run-2, run-1]——fork_at_run_id=run-1 → 升序位 1（第 1 轮后）。
    mocks.listSessionRuns.mockResolvedValueOnce([
      makeRun({ id: "run-2", created_at: "2026-09-22T11:00:00Z" }),
      makeRun({ id: "run-1", created_at: "2026-09-22T10:00:00Z" }),
    ]);
    const onOpenSource = vi.fn();
    render(
      <LineageBlock
        session={makeSession({
          id: "s-b",
          title: "重构方案讨论（分叉）",
          origin: "fork",
          fork_of_session_id: "s-a",
          fork_at_run_id: "run-1",
          engine_fork_anchor: "uuid-1",
        })}
        onOpenSource={onOpenSource}
      />,
    );
    expect(await screen.findByTestId("fork-lineage-block")).toBeInTheDocument();
    // 标题同时出现在溯源块正文与面包屑节点——断言收敛到块内。
    const block = screen.getByTestId("fork-lineage-block");
    expect(within(block).getByText(/分叉自/).textContent).toContain("重构方案讨论");
    expect(within(block).getByText(/第 1 轮后/)).toBeInTheDocument();
    expect(screen.getByTestId("fork-lineage-tier")).toHaveTextContent(
      "原生分叉·真截断",
    );
    fireEvent.click(screen.getByRole("button", { name: /查看原会话/ }));
    expect(onOpenSource).toHaveBeenCalledWith("s-a");
  });

  it("seed 档（codex）标注「种子分叉·前情转述（非原生上下文）」", async () => {
    mocks.getAgentSession.mockResolvedValueOnce(
      makeSession({ id: "s-a", title: "方案讨论" }),
    );
    mocks.listSessionRuns.mockResolvedValueOnce([]);
    render(
      <LineageBlock
        session={makeSession({
          id: "s-b",
          provider: "codex",
          origin: "fork",
          fork_of_session_id: "s-a",
        })}
        onOpenSource={vi.fn()}
      />,
    );
    expect(await screen.findByTestId("fork-lineage-tier")).toHaveTextContent(
      "种子分叉·前情转述（非原生上下文）",
    );
  });

  it("源详情拉取失败降级——短 id 占位标题，块仍渲染且可点", async () => {
    mocks.getAgentSession.mockRejectedValueOnce(new Error("gone"));
    const onOpenSource = vi.fn();
    render(
      <LineageBlock
        session={makeSession({
          id: "s-b",
          origin: "fork",
          fork_of_session_id: "s-a",
        })}
        onOpenSource={onOpenSource}
      />,
    );
    expect(await screen.findByTestId("fork-lineage-block")).toBeInTheDocument();
    // 降级标题同时出现在块正文与面包屑——断言收敛到块内。
    expect(
      within(screen.getByTestId("fork-lineage-block")).getByText(/分叉自/).textContent,
    ).toContain("会话 s-a");
    fireEvent.click(screen.getByRole("button", { name: /查看原会话/ }));
    expect(onOpenSource).toHaveBeenCalledWith("s-a");
  });

  it("非分叉会话（fork_of 为空）零占位", () => {
    const { container } = render(
      <LineageBlock session={makeSession({ id: "s-a" })} onOpenSource={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("LineageBlock 多跳面包屑（C←B←A）", () => {
  it("沿 fork_of 链渲染 A → B → 当前，祖先节点逐个可点开浮层", async () => {
    mocks.getAgentSession.mockImplementation(async (id: string) => {
      if (id === "s-b")
        return makeSession({ id: "s-b", title: "分叉 B", origin: "fork", fork_of_session_id: "s-a" });
      return makeSession({ id: "s-a", title: "方案讨论 A" });
    });
    mocks.listSessionRuns.mockResolvedValue([]);
    const onOpenSource = vi.fn();
    render(
      <LineageBlock
        session={makeSession({
          id: "s-c",
          title: "分叉的分叉 C",
          origin: "fork",
          fork_of_session_id: "s-b",
        })}
        onOpenSource={onOpenSource}
      />,
    );
    const crumbs = await screen.findByTestId("fork-lineage-crumbs");
    // 链序：A → B → 当前 C。
    expect(crumbs.textContent).toContain("方案讨论 A");
    expect(crumbs.textContent).toContain("分叉 B");
    expect(crumbs.textContent).toContain("分叉的分叉 C（当前）");
    // 逐节点可点：点 B 节点 → 开 B 会话浮层。
    fireEvent.click(screen.getByRole("button", { name: "分叉 B" }));
    expect(onOpenSource).toHaveBeenCalledWith("s-b");
    fireEvent.click(screen.getByRole("button", { name: "方案讨论 A" }));
    expect(onOpenSource).toHaveBeenCalledWith("s-a");
  });
});

// ── 4. WorkerSessionOverlay 泛化（title 透传 + 已分叉状态条）────────────

describe("WorkerSessionOverlay 标题参数化", () => {
  it("缺省形态零回归——「分身会话」+ 无状态条 +「返回主控」", () => {
    render(
      <WorkerSessionOverlay subSessionId="sub-12345678" onClose={vi.fn()} />,
    );
    expect(screen.getByRole("dialog", { name: "分身会话" })).toBeInTheDocument();
    expect(screen.queryByTestId("overlay-status-hint")).toBeNull();
    expect(screen.getByRole("button", { name: "返回主控" })).toBeInTheDocument();
    expect(screen.getByTestId("overlay-session-panel")).toHaveAttribute(
      "data-session-id",
      "sub-12345678",
    );
  });

  it("溯源复用——title/statusHint/closeLabel 透传（原会话浮层形态）", () => {
    render(
      <WorkerSessionOverlay
        subSessionId="src-12345678"
        title="原会话"
        statusHint="↦ 已分叉"
        closeLabel="关闭"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog", { name: "原会话" })).toBeInTheDocument();
    expect(screen.getByTestId("overlay-status-hint")).toHaveTextContent("↦ 已分叉");
    expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();
    expect(screen.getByTestId("overlay-session-panel")).toHaveAttribute(
      "data-session-id",
      "src-12345678",
    );
  });
});

// ── 5. 会话列表分叉附属分组与徽标 ───────────────────────────────────────

describe("SessionListPanel 分叉子会话附属分组（FR-05）", () => {
  function forkFixtures() {
    setMachines({ items: [makeMachine()] });
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    const source = makeSession({
      id: "s-a",
      workspace_id: "ws-1",
      title: "重构方案讨论",
    });
    const forkChild = makeSession({
      id: "s-b",
      workspace_id: "ws-1",
      title: "重构方案讨论（分叉）",
      origin: "fork",
      fork_of_session_id: "s-a",
    });
    mocks.listAgentSessions.mockResolvedValue(listResponse([source, forkChild]));
    return { source, forkChild };
  }

  it("分叉子会话挂源会话附属分组——「↦ 分叉 1」头默认收起，子行带「🔗 分叉」徽标", async () => {
    forkFixtures();
    renderPanel(<SessionListPanel />);
    await waitFor(() => expect(mocks.listAgentSessions).toHaveBeenCalled());
    await openGroup("SillyHub");

    expect(await screen.findByText("重构方案讨论")).toBeVisible();
    const header = screen.getByTestId("fork-subgroup-header");
    expect(header).toHaveTextContent("↦ 分叉 1");
    // 默认收起：子行不可见。
    expect(screen.queryByText("重构方案讨论（分叉）")).toBeNull();
    fireEvent.click(header);
    expect(await screen.findByText("重构方案讨论（分叉）")).toBeVisible();
    // 子行「🔗 分叉」徽标（SessionRow 按 origin='fork' 派生）。
    const badge = screen.getAllByTestId("fork-origin-badge")[0];
    expect(badge).toHaveTextContent("🔗 分叉");
  });

  it("与分身组并行不混树——同一源行下「分身 N」与「↦ 分叉 N」双组并存", async () => {
    setMachines({ items: [makeMachine()] });
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    const source = makeSession({ id: "s-a", workspace_id: "ws-1", title: "团队主任务" });
    const workerSub = makeSession({
      id: "s-sub",
      workspace_id: "ws-1",
      title: "分身甲",
      parent_session_id: "s-a",
      tree_depth: 1,
    });
    const forkChild = makeSession({
      id: "s-b",
      workspace_id: "ws-1",
      title: "主任务的分叉",
      origin: "fork",
      fork_of_session_id: "s-a",
    });
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([source, workerSub, forkChild]),
    );
    renderPanel(<SessionListPanel />);
    await waitFor(() => expect(mocks.listAgentSessions).toHaveBeenCalled());
    await openGroup("SillyHub");

    expect(await screen.findByText("团队主任务")).toBeVisible();
    expect(screen.getByText("分身 1")).toBeVisible();
    const header = screen.getByTestId("fork-subgroup-header");
    expect(header).toHaveTextContent("↦ 分叉 1");
    // 分身判定（parent_session_id）与分叉判定（origin+fork_of）互不吞行：
    // 展开分叉组只见分叉子行，分身子行仍在分身组。
    fireEvent.click(header);
    expect(await screen.findByText("主任务的分叉")).toBeVisible();
    expect(screen.queryByText("分身甲")).toBeNull();
  });

  it("源不可见（筛选/分页外）——分叉子会话回落主行渲染不丢行，徽标仍可辨识", async () => {
    setMachines({ items: [makeMachine()] });
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    const orphan = makeSession({
      id: "s-b",
      workspace_id: "ws-1",
      title: "找不到源的分叉",
      origin: "fork",
      fork_of_session_id: "s-not-here",
    });
    mocks.listAgentSessions.mockResolvedValue(listResponse([orphan]));
    renderPanel(<SessionListPanel />);
    await waitFor(() => expect(mocks.listAgentSessions).toHaveBeenCalled());
    await openGroup("SillyHub");

    expect(await screen.findByText("找不到源的分叉")).toBeVisible();
    expect(screen.getAllByTestId("fork-origin-badge")[0]).toHaveTextContent("🔗 分叉");
    expect(screen.queryByTestId("fork-subgroup-header")).toBeNull();
  });

  it("无分叉会话零变化——不渲染分叉组头", async () => {
    setMachines({ items: [makeMachine()] });
    setWorkspaces([makeWorkspace({ id: "ws-1", name: "SillyHub" })]);
    mocks.listAgentSessions.mockResolvedValue(
      listResponse([makeSession({ id: "s-a", workspace_id: "ws-1", title: "普通会话" })]),
    );
    renderPanel(<SessionListPanel />);
    await waitFor(() => expect(mocks.listAgentSessions).toHaveBeenCalled());
    await openGroup("SillyHub");
    await screen.findByText("普通会话");
    expect(screen.queryByTestId("fork-subgroup-header")).toBeNull();
    expect(screen.queryByTestId("fork-origin-badge")).toBeNull();
  });
});

// ── 6. TurnTimeline forkEntry 接线（TurnForkEntry prop 透传）─────────────

describe("TurnTimeline forkEntry 轮级分叉入口接线", () => {
  function renderTimeline(
    turns: SessionTurnView[],
    forkEntry?: {
      provider: string;
      engineAnchors: ReadonlyMap<string, string | null | undefined>;
      onForkTurn: (_runKey: string, _seq: number) => void;
    },
    viewMode: "conversation" | "all" = "all",
  ) {
    return render(
      <TurnTimeline
        turns={turns}
        viewMode={viewMode}
        errorMsg={null}
        sessionStatus="active"
        pendingRequests={[]}
        dialogHistory={[]}
        onResend={vi.fn()}
        onSwitchProvider={vi.fn()}
        onDialogResolved={vi.fn()}
        hasOnlineProvider
        emptyProviderLabel="Claude"
        forkEntry={forkEntry ?? null}
      />,
    );
  }

  it("接线后逐轮渲染入口：锚点在+终态可点，engineAnchor 取自映射 key", () => {
    const onForkTurn = vi.fn();
    renderTimeline(
      [makeTurn({ runId: "run-1", turn: 1 })],
      {
        provider: "claude",
        engineAnchors: new Map([["run-1", "anchor-1"]]),
        onForkTurn,
      },
    );
    const btn = screen.getByTestId("turn-fork-entry");
    expect(btn).toBeEnabled();
    expect(btn).toHaveTextContent("⑂ 从此分叉");
    fireEvent.click(btn);
    expect(onForkTurn).toHaveBeenCalledWith("run-1", 1);
  });

  it("engine_anchor 缺失（/runs 未含该轮）→ native 档置灰「该轮缺少引擎锚点」", () => {
    renderTimeline(
      [makeTurn({ runId: "run-1", turn: 1 })],
      {
        provider: "claude",
        engineAnchors: new Map([["run-1", null]]),
        onForkTurn: vi.fn(),
      },
    );
    const btn = screen.getByTestId("turn-fork-entry");
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent("⑂ 该轮缺少引擎锚点");
  });

  it("映射未命中的轮同缺失口径；turn 序号缺失回退行序（idx+1）", () => {
    const onForkTurn = vi.fn();
    renderTimeline(
      [makeTurn({ runId: "run-x", turn: null })],
      {
        provider: "claude",
        engineAnchors: new Map([["run-1", "anchor-1"]]),
        onForkTurn,
      },
    );
    expect(screen.getByTestId("turn-fork-entry")).toBeDisabled();
  });

  it("对话视图同样挂载入口（RoundDivider 轮尾行）；进行中轮置灰", () => {
    renderTimeline(
      [makeTurn({ runId: "run-1", turn: 1, status: "running" })],
      {
        provider: "claude",
        engineAnchors: new Map([["run-1", "anchor-1"]]),
        onForkTurn: vi.fn(),
      },
      "conversation",
    );
    const btn = screen.getByTestId("turn-fork-entry");
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent("⑂ 进行中不可分叉");
  });

  it("未接线（forkEntry 缺省 null）零渲染——既有消费方零回归", () => {
    renderTimeline([makeTurn({ runId: "run-1", turn: 1 })]);
    expect(screen.queryByTestId("turn-fork-entry")).toBeNull();
  });
});
