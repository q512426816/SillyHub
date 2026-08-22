// task-11（2026-08-22-team-session-unify / FR-03 / FR-07 / D-003 / D-004）：
// SessionPanel 会话内团队触发入口单测（page/dialog 双模式，design §5 Phase 3 +
// 原型 prototype-team-session-unify.html §01/§02）。
//
// 覆盖（task-11 剩余实现——popover 组件本体单测见 team-trigger-popover.test.tsx）：
//   1. 派团队按钮引擎门控（D-003 一期 Claude 专属）：claude 可用；codex 置灰 +
//      tooltip「团队需要 Claude 引擎」（dialog provider 态 + page session.provider
//      两个信息源）；
//   2. /team 前缀拦截（D-004 四路等价）：claude 会话提交 → 不发送、弹层打开 +
//      objective 预填去前缀文本 + 输入框清空；codex 会话不拦截（正常入队）；
//   3. TeamTaskBlock 挂载冒烟：listSessionTeamMissions 列表全部渲染（活跃在前）+
//      活跃 chip「团队进行中 · N 分身」+ chip 可关闭收回（块仍在）；
//   4. page 模式 /team 拦截（独立代码路径同断言）。
//
// 测试纪律：FIRST / AAA / 仅 mock 网络层（@/lib/daemon 会话 API + 团队 client、
// @/lib/workspaces、@/lib/ppm/project、@/lib/workspace、page chrome 数据 hook）；
// 断言用正则/aria-label 避开 antd 中文按钮 autoLetterSpacing 拆分坑（团队触发行
// 本身为非 antd 原生按钮，不受影响）。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { SessionPanel } from "../session-panel";
import type { TeamMissionSummary } from "@/lib/daemon";

// MarkdownText 用 next/dynamic + ssr:false，jsdom 同步 render 处于 loading(null)——
// mock 成纯文本渲染（同 interactive-session-panel.test.tsx）。
vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

/* ----- mock 网络层 ----- */

const sessionApi = vi.hoisted(() => ({
  createSession: vi.fn(),
  injectSession: vi.fn(),
  interruptSession: vi.fn(),
  endSession: vi.fn(),
  streamSession: vi.fn(),
  getAgentSession: vi.fn(),
  getAgentSessionLogs: vi.fn(),
  fetchPendingDialogs: vi.fn(),
  fetchSessionDialogHistory: vi.fn(),
  listSessionRuns: vi.fn(),
  listSessionTeamMissions: vi.fn(),
  triggerSessionTeamMission: vi.fn(),
}));

vi.mock("@/lib/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/lib/daemon")>("@/lib/daemon");
  return {
    ...actual,
    createSession: sessionApi.createSession,
    injectSession: sessionApi.injectSession,
    interruptSession: sessionApi.interruptSession,
    endSession: sessionApi.endSession,
    streamSession: sessionApi.streamSession,
    getAgentSession: sessionApi.getAgentSession,
    getAgentSessionLogs: sessionApi.getAgentSessionLogs,
    fetchPendingDialogs: sessionApi.fetchPendingDialogs,
    fetchSessionDialogHistory: sessionApi.fetchSessionDialogHistory,
    listSessionRuns: sessionApi.listSessionRuns,
    listSessionTeamMissions: sessionApi.listSessionTeamMissions,
    triggerSessionTeamMission: sessionApi.triggerSessionTeamMission,
  };
});

// page 模式 workspacesQuery（工作区名解析）+ popover 项目下拉/项目工作区数据源。
const workspaceApi = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
  listProjects: vi.fn(),
  listProjectWorkspaces: vi.fn(),
}));

vi.mock("@/lib/workspaces", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspaces")>(
    "@/lib/workspaces",
  );
  return { ...actual, listWorkspaces: workspaceApi.listWorkspaces };
});

vi.mock("@/lib/ppm/project", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ppm/project")>(
    "@/lib/ppm/project",
  );
  return { ...actual, listProjects: workspaceApi.listProjects };
});

vi.mock("@/lib/workspace", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspace")>(
    "@/lib/workspace",
  );
  return { ...actual, listProjectWorkspaces: workspaceApi.listProjectWorkspaces };
});

// page 模式 chrome（SessionConfigBar）数据 hook：无网络，空数据。
vi.mock("@/lib/use-daemon-machines", () => ({
  useDaemonMachines: () => ({ items: [] }),
}));
vi.mock("@/lib/agent-profiles", async () => {
  const actual = await vi.importActual<typeof import("@/lib/agent-profiles")>(
    "@/lib/agent-profiles",
  );
  return { ...actual, useMineAgentProfiles: () => ({ profiles: [] }) };
});
vi.mock("@/lib/api/llm-providers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/llm-providers")>(
    "@/lib/api/llm-providers",
  );
  return { ...actual, listProviders: vi.fn().mockResolvedValue([]) };
});

/* ----- fixture ----- */

const OBJECTIVE = "修掉登录页三处移动端问题并补回归用例";

function makeMission(
  id: string,
  status: TeamMissionSummary["status"],
  workers: TeamMissionSummary["workers"],
): TeamMissionSummary {
  return {
    mission_id: id,
    status,
    objective: `目标-${id}`,
    scope_workspace_ids: [],
    budget_usd: null,
    workers,
  };
}

function makeWorker(runId: string, status: string) {
  return { run_id: runId, role: "impl", status, objective: "分工目标" };
}

/** attach 详情（dialog 轮询 / page detailQuery 共用形状）。 */
function makeDetail(provider: string) {
  return {
    id: "sess-team",
    runtime_id: null,
    lease_id: null,
    provider,
    status: "active",
    agent_session_id: "ag-1",
    config: null,
    turn_count: 1,
    created_at: "t",
    last_active_at: null,
    ended_at: null,
    current_run_id: null,
    workspace_id: "ws-1",
    llm_provider_id: null,
    agent_profile_id: null,
    title: "团队会话",
    config_snapshot: null,
  };
}

function setupDialog(overrides: Record<string, unknown> = {}) {
  const props = {
    mode: "dialog" as const,
    sessionId: "sess-team",
    providers: ["claude"],
    defaultProvider: "claude",
    model: null,
    onModelChange: vi.fn(),
    hasOnlineProvider: true,
    ...overrides,
  };
  return render(<SessionPanel {...(props as any)} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  // dialog attach 默认链路：prefetch 空 + fake SSE + 轮询 active。
  sessionApi.getAgentSessionLogs.mockResolvedValue([]);
  sessionApi.getAgentSession.mockResolvedValue(makeDetail("claude"));
  sessionApi.streamSession.mockImplementation(() => ({
    close: vi.fn(),
    getLastEventId: () => null,
  }));
  sessionApi.fetchPendingDialogs.mockResolvedValue([]);
  sessionApi.fetchSessionDialogHistory.mockResolvedValue([]);
  sessionApi.listSessionTeamMissions.mockResolvedValue([]);
  sessionApi.triggerSessionTeamMission.mockResolvedValue(
    makeMission("m-new", "planning", []),
  );
  workspaceApi.listProjects.mockResolvedValue([]);
  workspaceApi.listProjectWorkspaces.mockResolvedValue([]);
});

/* ───────── 1. 派团队按钮引擎门控（dialog） ───────── */

describe("SessionPanel 派团队按钮（dialog 模式引擎门控，D-003）", () => {
  it("claude 会话：按钮可用，tooltip 为派团队说明", async () => {
    setupDialog();
    const btn = (await screen.findByRole("button", {
      name: "派团队",
    })) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.title).not.toContain("团队需要 Claude 引擎");
  });

  it("codex 会话：按钮置灰 + tooltip「团队需要 Claude 引擎」", async () => {
    setupDialog({
      providers: ["codex"],
      defaultProvider: "codex",
      sessionId: null, // idle 新建态：引擎门控优先于会话存在性展示
    });
    const btn = (await screen.findByRole("button", {
      name: "派团队",
    })) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe("团队需要 Claude 引擎");
  });
});

/* ───────── 2. /team 前缀拦截（dialog，D-004） ───────── */

describe("SessionPanel /team 指令拦截（dialog 模式）", () => {
  /**
   * idle → createSession 转 active（避免 attach 轮询等待）：首条消息创建会话后，
   * 第二条输入 /team 指令验证拦截。
   */
  async function createClaudeSession() {
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-team",
      run_id: "run-1",
      lease_id: "l",
      status: "active",
      stream_url: "",
    });
    setupDialog({ sessionId: null });
    const input = screen.getByPlaceholderText(/创建会话/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalledTimes(1));
    return screen.getByPlaceholderText(
      /消息将排队|继续追问/,
    ) as HTMLTextAreaElement;
  }

  it("claude：/team 前缀不发送 → 弹层打开 + objective 预填去前缀文本 + 输入框清空", async () => {
    const input = await createClaudeSession();
    fireEvent.change(input, { target: { value: `/team ${OBJECTIVE}` } });
    fireEvent.click(screen.getByTitle("发送"));

    // 弹层打开（原型 §02）：标题 + 目标预填。
    expect(await screen.findByText("派团队做这件事")).toBeInTheDocument();
    const objInput = screen.getByLabelText(/^目标/) as HTMLInputElement;
    expect(objInput.value).toBe(OBJECTIVE);
    // 不发送：无排队条目、无 inject、草稿已清空（文本转入弹层）。
    expect(sessionApi.injectSession).not.toHaveBeenCalled();
    expect(screen.queryByText(/排队消息/)).not.toBeInTheDocument();
    expect(input.value).toBe("");
  });

  it("裸 /team（无目标文本）也拦截：弹层打开、objective 留空", async () => {
    const input = await createClaudeSession();
    fireEvent.change(input, { target: { value: "/team" } });
    fireEvent.click(screen.getByTitle("发送"));

    expect(await screen.findByText("派团队做这件事")).toBeInTheDocument();
    expect((screen.getByLabelText(/^目标/) as HTMLInputElement).value).toBe("");
    expect(sessionApi.injectSession).not.toHaveBeenCalled();
  });

  it("codex：不拦截 → 正常入队（D-003 一期 Claude 专属）", async () => {
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-codex",
      run_id: "run-1",
      lease_id: "l",
      status: "active",
      stream_url: "",
    });
    setupDialog({
      sessionId: null,
      providers: ["codex"],
      defaultProvider: "codex",
    });
    const input = screen.getByPlaceholderText(/创建会话/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalledTimes(1));

    const input2 = screen.getByPlaceholderText(
      /消息将排队|继续追问/,
    ) as HTMLTextAreaElement;
    fireEvent.change(input2, { target: { value: `/team ${OBJECTIVE}` } });
    fireEvent.click(screen.getByTitle("发送"));

    // 未拦截：消息进队列（MessageQueueBar），弹层不打开。
    await waitFor(() =>
      expect(screen.getByText(/排队消息（1）/)).toBeInTheDocument(),
    );
    expect(screen.queryByText("派团队做这件事")).not.toBeInTheDocument();
  });
});

/* ───────── 3. TeamTaskBlock 挂载冒烟 + 活跃 chip（dialog） ───────── */

describe("SessionPanel TeamTaskBlock 挂载与活跃 chip（dialog 模式）", () => {
  it("mission 列表全部渲染（活跃在前）+ chip「团队进行中 · N 分身」可关闭收回", async () => {
    sessionApi.listSessionTeamMissions.mockResolvedValue([
      makeMission("m-done", "done", [makeWorker("w-3", "completed")]),
      makeMission("m-run", "running", [
        makeWorker("w-1", "running"),
        makeWorker("w-2", "completed"),
      ]),
    ]);
    setupDialog();

    // 列表挂载：两个任务块，活跃（running）排在前。
    const list = await screen.findByLabelText("会话团队任务列表");
    const blocks = screen.getAllByLabelText("团队任务");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.textContent).toContain("运行中");
    expect(blocks[1]!.textContent).toContain("已完成");
    expect(list).toBeInTheDocument();

    // 活跃 chip：👥 团队进行中 · 2 分身（活跃 mission 的分身计数）。
    const chip = await screen.findByTestId("team-active-chip");
    expect(chip.textContent).toContain("团队进行中 · 2 分身");

    // chip 可关闭收回（只藏提示条，不取消任务——任务块仍在）。
    fireEvent.click(screen.getByLabelText("收起团队状态提示"));
    await waitFor(() =>
      expect(screen.queryByTestId("team-active-chip")).not.toBeInTheDocument(),
    );
    expect(screen.getAllByLabelText("团队任务")).toHaveLength(2);
  });

  it("无活跃 mission（全部终态）→ 不显示 chip", async () => {
    sessionApi.listSessionTeamMissions.mockResolvedValue([
      makeMission("m-done", "done", [makeWorker("w-1", "completed")]),
    ]);
    setupDialog();
    await screen.findByLabelText("会话团队任务列表");
    expect(screen.queryByTestId("team-active-chip")).not.toBeInTheDocument();
  });
});

/* ───────── 4. page 模式：引擎门控 + /team 拦截（独立代码路径） ───────── */

describe("SessionPanel page 模式团队入口", () => {
  function setupPage(provider: string) {
    sessionApi.getAgentSession.mockResolvedValue(makeDetail(provider));
    sessionApi.listSessionRuns.mockResolvedValue([]);
    workspaceApi.listWorkspaces.mockResolvedValue({ items: [] });
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={qc}>
        <SessionPanel
          mode="page"
          sessionId="sess-team"
          machines={[]}
          llmProviders={[]}
        />
      </QueryClientProvider>,
    );
  }

  it("claude 会话（session.provider）：按钮可用", async () => {
    setupPage("claude");
    const btn = (await screen.findByRole("button", {
      name: "派团队",
    })) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it("codex 会话（session.provider）：按钮置灰 + tooltip「团队需要 Claude 引擎」", async () => {
    setupPage("codex");
    const btn = (await screen.findByRole("button", {
      name: "派团队",
    })) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe("团队需要 Claude 引擎");
  });

  it("/team 前缀拦截：弹层打开 + 不入队不 inject", async () => {
    setupPage("claude");
    const input = (await screen.findByPlaceholderText(
      /继续追问/,
    )) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: `/team ${OBJECTIVE}` } });
    fireEvent.click(screen.getByTitle("发送"));

    expect(await screen.findByText("派团队做这件事")).toBeInTheDocument();
    expect((screen.getByLabelText(/^目标/) as HTMLInputElement).value).toBe(
      OBJECTIVE,
    );
    expect(sessionApi.injectSession).not.toHaveBeenCalled();
    expect(screen.queryByText(/排队消息/)).not.toBeInTheDocument();
  });
});
