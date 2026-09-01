// ql-20260826-010：会话页 4 项 UX 修复的面板级回归（dialog 模式，mock 同
// session-panel-team.test.tsx 基建）：
//   1. 草稿清空 trim 修复——发送 input.trim() 的文本带尾随换行（粘贴多行常见），
//      成功后输入框清空（原 prev === prompt 精确比对永不清空，被草稿持久化
//      放大为「已发送消息残留输入框」）；
//   2. 派团队确认 → 输入框回填前置 /team 指令（裸 objective 常被 agent 当普通
//      聊天不派发分身）；
//   3. 活跃 mission 存在时 /team 消息不再拦截弹层（放行直发主控轮 briefing
//      派发；否则确认回填的 /team 再发送会陷入「弹层⇄回填」死循环）。
//
// 输入框高度拖拽 / ActivityCatalog 折叠的组件级测试见
// session-input-bar.test.tsx / activity-catalog.test.tsx。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { SessionPanel } from "../session-panel";
import type { TeamMissionSummary } from "@/lib/daemon";

vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

/* ----- mock 网络层（对齐 session-panel-team.test.tsx） ----- */

const sessionApi = vi.hoisted(() => ({
  // 会话用量条（session-usage-bar）自取数：必须 resolve（裸 vi.fn() 返回
  // undefined 会被组件 .then 同步崩）；null = 按无数据不渲染。
  getSessionUsage: vi.fn().mockResolvedValue(null),
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
  // ql-20260828-009-4a13：handleTeamTrigger 前置取消（更新指派）依赖。
  cancelTeamMission: vi.fn(),
  fetchSessionQueue: vi.fn(),
  deleteSessionQueueEntry: vi.fn(),
  retrySessionQueueEntry: vi.fn(),
}));

vi.mock("@/lib/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/lib/daemon")>("@/lib/daemon");
  return {
    ...actual,
    getSessionUsage: sessionApi.getSessionUsage,
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
    cancelTeamMission: sessionApi.cancelTeamMission,
    fetchSessionQueue: sessionApi.fetchSessionQueue,
    deleteSessionQueueEntry: sessionApi.deleteSessionQueueEntry,
    retrySessionQueueEntry: sessionApi.retrySessionQueueEntry,
  };
});

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

const OBJECTIVE = "给登录页加回归用例";

function makeMission(
  id: string,
  status: TeamMissionSummary["status"],
): TeamMissionSummary {
  return {
    mission_id: id,
    status,
    objective: `目标-${id}`,
    scope_workspace_ids: [],
    budget_usd: null,
    workers: [],
  };
}

function makeDetail() {
  return {
    id: "sess-ux",
    runtime_id: null,
    lease_id: null,
    provider: "claude",
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
    title: "UX 修复会话",
    config_snapshot: null,
  };
}

async function setupActiveSession() {
  render(
    <SessionPanel
      mode="dialog"
      sessionId="sess-ux"
      providers={["claude"]}
      defaultProvider="claude"
      model={null}
      onModelChange={vi.fn()}
      hasOnlineProvider
      // 弹层 scopeMode=workspace 确认校验要求会话绑定工作区（handleConfirm）。
      workspaceId="ws-1"
    />,
  );
  // attach 完成 → active 输入框就绪。
  return screen.findByPlaceholderText(/继续追问/) as Promise<HTMLTextAreaElement>;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  sessionApi.fetchSessionQueue.mockResolvedValue([]);
  sessionApi.deleteSessionQueueEntry.mockResolvedValue(undefined);
  sessionApi.retrySessionQueueEntry.mockResolvedValue({
    id: "entry-1",
    prompt: "",
    attachment_ids: [],
    agent_profile_id: null,
    llm_provider_id: null,
    status: "pending",
    error_msg: null,
    created_at: "2026-08-26T10:00:00Z",
  });
  sessionApi.getAgentSessionLogs.mockResolvedValue([]);
  sessionApi.getAgentSession.mockResolvedValue(makeDetail());
  sessionApi.streamSession.mockImplementation(() => ({
    close: vi.fn(),
    getLastEventId: () => null,
  }));
  sessionApi.fetchPendingDialogs.mockResolvedValue([]);
  sessionApi.fetchSessionDialogHistory.mockResolvedValue([]);
  sessionApi.listSessionRuns.mockResolvedValue([]);
  sessionApi.listSessionTeamMissions.mockResolvedValue([]);
  sessionApi.triggerSessionTeamMission.mockResolvedValue(
    makeMission("m-new", "planning"),
  );
  workspaceApi.listProjects.mockResolvedValue([]);
  workspaceApi.listProjectWorkspaces.mockResolvedValue([]);
  sessionApi.injectSession.mockResolvedValue({
    session_id: "sess-ux",
    run_id: "run-2",
    status: "running",
    queued: false,
  });
});

describe("草稿清空 trim 修复（发送尾随空白文本）", () => {
  it("粘贴多行带尾随换行 → 发送成功后输入框清空（原精确比对残留）", async () => {
    const input = await setupActiveSession();
    // 模拟粘贴以换行结尾的多行文本：发送的是 trim 后文本。
    fireEvent.change(input, {
      target: { value: `${OBJECTIVE}\n\n` },
    });
    fireEvent.click(screen.getByTitle("发送"));

    await waitFor(() => expect(sessionApi.injectSession).toHaveBeenCalledTimes(1));
    // dialog 无附件 followup 走两参调用（submitFollowup 契约）。
    expect(sessionApi.injectSession).toHaveBeenCalledWith("sess-ux", OBJECTIVE);
    // 发送窗口期输入未被再编辑 → 成功后清空（trim 口径比对）。
    await waitFor(() => expect(input.value).toBe(""));
  });

  it("发送窗口期新输入的内容不被清空（保留语义回归）", async () => {
    // inject 挂起 → 发送窗口期用户改输入 → 成功后不覆盖新输入。
    let resolveInject!: (v: unknown) => void;
    sessionApi.injectSession.mockImplementation(
      () =>
        new Promise((res) => {
          resolveInject = res;
        }),
    );
    const input = await setupActiveSession();
    fireEvent.change(input, { target: { value: `${OBJECTIVE}\n` } });
    fireEvent.click(screen.getByTitle("发送"));
    fireEvent.change(input, { target: { value: "追问下一句" } });
    resolveInject({
      session_id: "sess-ux",
      run_id: "run-3",
      status: "running",
      queued: false,
    });
    await waitFor(() =>
      expect(sessionApi.injectSession).toHaveBeenCalledTimes(1),
    );
    // 新输入保留，不被发送成功回调清掉。
    await waitFor(() => expect(input.value).toBe("追问下一句"));
  });
});

describe("派团队确认回填 /team 前缀（ql-20260826-010）", () => {
  it("弹层确认 → 输入框回填「/team <objective>」+ mission 列表刷新", async () => {
    sessionApi.listSessionTeamMissions
      .mockResolvedValueOnce([]) // 初始（无活跃）
      .mockResolvedValue([makeMission("m-new", "planning")]); // 确认后刷新
    const input = await setupActiveSession();

    fireEvent.click(screen.getByRole("button", { name: "更多功能" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /派团队/ }));
    const objInput = (await screen.findByLabelText(
      /目标（可选，随下条消息发出）/,
    )) as HTMLInputElement;
    fireEvent.change(objInput, { target: { value: OBJECTIVE } });
    fireEvent.click(
      screen.getByRole("button", { name: /就绪，随下条消息发出/ }),
    );

    await waitFor(() =>
      expect(sessionApi.triggerSessionTeamMission).toHaveBeenCalledTimes(1),
    );
    await waitFor(() => expect(input.value).toBe(`/team ${OBJECTIVE}`));
    // 弹层已关。
    expect(
      screen.queryByText("派团队做这件事"),
    ).not.toBeInTheDocument();
  });

  it("活跃 mission 下发送回填的 /team 指令 → 原文直达 inject，弹层不重开（ql-20260901-002）", async () => {
    sessionApi.listSessionTeamMissions.mockResolvedValue([
      makeMission("m-run", "running"),
    ]);
    const input = await setupActiveSession();

    fireEvent.change(input, {
      target: { value: `/team ${OBJECTIVE}` },
    });
    fireEvent.click(screen.getByTitle("发送"));

    // 放行直发，发原始输入（"/team 目标" 原文——气泡/回放显示前缀；前缀
    // 剥离收口到后端派发层 service._strip_team_command_prefix）；弹层不重开。
    await waitFor(() => expect(sessionApi.injectSession).toHaveBeenCalledTimes(1));
    expect(sessionApi.injectSession).toHaveBeenCalledWith(
      "sess-ux",
      `/team ${OBJECTIVE}`,
    );
    expect(
      screen.queryByText("派团队做这件事"),
    ).not.toBeInTheDocument();
    // 草稿清空：发送原文与草稿同文直接比对命中。
    await waitFor(() => expect(input.value).toBe(""));
  });

  it("裸 /team（活跃 mission 下）→ 无可发内容不 inject", async () => {
    sessionApi.listSessionTeamMissions.mockResolvedValue([
      makeMission("m-run", "running"),
    ]);
    const input = await setupActiveSession();

    fireEvent.change(input, { target: { value: "/team" } });
    fireEvent.click(screen.getByTitle("发送"));

    await waitFor(() => expect(input.value).toBe("/team"));
    expect(sessionApi.injectSession).not.toHaveBeenCalled();
    expect(
      screen.queryByText("派团队做这件事"),
    ).not.toBeInTheDocument();
  });
});
