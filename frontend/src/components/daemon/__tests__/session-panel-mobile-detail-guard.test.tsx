// 2026-09-28-audit-risk-fixes：detailColumnVisible 的 !mobile 守卫回归锚。
//
// 背景：desktop 与 mobile 共享同一 localStorage 键（sillyhub.sessions.detailPanel），
// 守卫缺失时 desktop 开过的详情偏好会在 mobile 视口生效——右列（PanelResizer+
// 详情列）挤进窄屏、TaskExecutionPanel/SessionUsageBar 双挂、taskPanelRef 被右列
// 实例覆盖，且 mobile 无关闭入口。守卫后：mobile 恒收起（对齐 hasSubagentPanelHost
// 的 !mobile 口径），desktop 偏好读写不受影响。
//
// mock 范式照 session-panel-variant.test.tsx（模板同源，仅本用例所需面）。
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { SessionPanel } from "../session-panel";

vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

const sessionApi = vi.hoisted(() => ({
  getSessionUsage: vi.fn().mockResolvedValue(null),
  createSession: vi.fn(),
  injectSession: vi.fn(),
  interruptSession: vi.fn(),
  endSession: vi.fn(),
  streamSession: vi.fn(),
  getAgentSession: vi.fn(),
  getAgentSessionLogs: vi.fn(),
  fetchSessionTurnOutline: vi.fn().mockResolvedValue({ session_id: "s-1", total_turns: 0, items: [] }),
  fetchPendingDialogs: vi.fn(),
  fetchSessionDialogHistory: vi.fn(),
  listSessionRuns: vi.fn(),
  listSessionTasks: vi.fn().mockResolvedValue([]),
  listSessionTeamMissions: vi.fn(),
  triggerSessionTeamMission: vi.fn(),
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
    fetchSessionTurnOutline: sessionApi.fetchSessionTurnOutline,
    fetchPendingDialogs: sessionApi.fetchPendingDialogs,
    fetchSessionDialogHistory: sessionApi.fetchSessionDialogHistory,
    listSessionRuns: sessionApi.listSessionRuns,
    listSessionTasks: sessionApi.listSessionTasks,
    listSessionTeamMissions: sessionApi.listSessionTeamMissions,
    triggerSessionTeamMission: sessionApi.triggerSessionTeamMission,
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
  const actual = await vi.importActual<typeof import("@/lib/workspaces")>("@/lib/workspaces");
  return { ...actual, listWorkspaces: workspaceApi.listWorkspaces };
});
vi.mock("@/lib/ppm/project", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ppm/project")>("@/lib/ppm/project");
  return { ...actual, listProjects: workspaceApi.listProjects };
});
vi.mock("@/lib/workspace", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspace")>("@/lib/workspace");
  return { ...actual, listProjectWorkspaces: workspaceApi.listProjectWorkspaces };
});
vi.mock("@/lib/use-daemon-machines", () => ({
  useDaemonMachines: () => ({ items: [] }),
}));
vi.mock("@/lib/agent-profiles", async () => {
  const actual = await vi.importActual<typeof import("@/lib/agent-profiles")>("@/lib/agent-profiles");
  return { ...actual, useMineAgentProfiles: () => ({ profiles: [] }) };
});
vi.mock("@/lib/api/llm-providers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/llm-providers")>("@/lib/api/llm-providers");
  return { ...actual, listProviders: vi.fn().mockResolvedValue([]) };
});

function makeDetail() {
  return {
    id: "sess-guard",
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
    title: "守卫会话",
    config_snapshot: null,
  };
}

function makeHistoryLogs() {
  return [
    {
      id: "log-1",
      run_id: "run-1",
      timestamp: "2026-09-27T10:00:00Z",
      channel: "user_input",
      content_redacted: "第一句",
    },
    {
      id: "log-2",
      run_id: "run-1",
      timestamp: "2026-09-27T10:00:01Z",
      channel: "stdout",
      content_redacted: "答复正文",
    },
  ];
}

/** page 模式挂载（variant 显式声明；localStorage 预置由调用方控制）。 */
function setupPage(variant: "desktop" | "mobile") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SessionPanel
        mode="page"
        sessionId="sess-guard"
        machines={[]}
        llmProviders={[]}
        variant={variant}
      />
    </QueryClientProvider>,
  );
}

const DETAIL_LS_KEY = "sillyhub.sessions.detailPanel";

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
    created_at: "2026-09-27T10:00:00Z",
  });
  sessionApi.getAgentSession.mockResolvedValue(makeDetail());
  sessionApi.getAgentSessionLogs.mockResolvedValue(makeHistoryLogs());
  sessionApi.listSessionRuns.mockResolvedValue([]);
  sessionApi.streamSession.mockImplementation(() => ({
    close: vi.fn(),
    getLastEventId: () => null,
  }));
  sessionApi.fetchPendingDialogs.mockResolvedValue([]);
  sessionApi.fetchSessionDialogHistory.mockResolvedValue([]);
  sessionApi.listSessionTeamMissions.mockResolvedValue([]);
  sessionApi.injectSession.mockResolvedValue({ run_id: "run-new", queued: false });
  workspaceApi.listWorkspaces.mockResolvedValue({ items: [] });
  workspaceApi.listProjects.mockResolvedValue([]);
  workspaceApi.listProjectWorkspaces.mockResolvedValue([]);
});

describe("detailColumnVisible 的 !mobile 守卫（localStorage 跨视口隔离）", () => {
  it("desktop + localStorage open=true：右列（subagent-panel-column）在场（守卫不影响 desktop）", async () => {
    window.localStorage.setItem(DETAIL_LS_KEY, JSON.stringify({ open: true }));
    setupPage("desktop");

    await screen.findByLabelText("会话面板");
    expect(
      await screen.findByTestId("subagent-panel-column"),
    ).toBeInTheDocument();
  });

  it("mobile + 同一 localStorage open=true：右列不渲染（desktop 偏好不污染 mobile 视口）", async () => {
    window.localStorage.setItem(DETAIL_LS_KEY, JSON.stringify({ open: true }));
    setupPage("mobile");

    const panel = (await screen.findByLabelText("会话面板")) as HTMLElement;
    expect(panel.getAttribute("data-variant")).toBe("mobile");
    expect(
      screen.queryByTestId("subagent-panel-column"),
    ).not.toBeInTheDocument();
    // Resizer 同属右列装配，一并断言不在场。
    expect(screen.queryByTestId("subagent-panel-resizer")).not.toBeInTheDocument();
  });
});
