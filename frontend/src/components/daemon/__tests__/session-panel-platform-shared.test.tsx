// task-10（2026-08-28-daemon-agent-share / FR-05 / D-004@v2 / D-002@v2）：
// SessionPanel 会话头「平台共享」徽标单测。
//
// 判定路径（session-panel.tsx 实现注释同源）：AgentSessionRead / config_snapshot
// 均无 platform 共享标识字段（后端 task-05 未落展示位），前端对照
// GET /api/daemon/shared-agents/active 生效列表——会话 agent_profile_id ∈ 列表
// 即显示徽标。仅显示不改行为；文案「平台共享」不得出现「只读」。
//
// 覆盖：
//   1. 会话档案命中 active 共享智能体 → 头部元信息区渲染「平台共享」徽标；
//   2. 会话档案未命中 / 无档案 → 不渲染（现状零回归）；
//   3. active 列表请求失败 → 降级 []，面板正常渲染、无徽标（数据缺失不阻塞）。
//
// 测试纪律：FIRST / AAA / 仅 mock 网络层（模板同 session-panel-variant.test.tsx）；
// 断言用 aria-label/data-testid 避开 antd 中文按钮 autoLetterSpacing 拆分坑。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { SessionPanel } from "../session-panel";

// MarkdownText 用 next/dynamic + ssr:false，jsdom 同步 render 处于 loading(null)——
// mock 成纯文本渲染（同 session-panel-variant.test.tsx）。
vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

/* ----- mock 网络层（同 session-panel-variant.test.tsx 模板） ----- */

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
  fetchSessionQueue: vi.fn(),
  deleteSessionQueueEntry: vi.fn(),
  retrySessionQueueEntry: vi.fn(),
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
    fetchSessionQueue: sessionApi.fetchSessionQueue,
    deleteSessionQueueEntry: sessionApi.deleteSessionQueueEntry,
    retrySessionQueueEntry: sessionApi.retrySessionQueueEntry,
  };
});

// task-10：useActiveSharedAgents 直取 /api/daemon/shared-agents/active——apiFetch
// 局部 mock（ApiError 等其余导出保留真实）。
const sharedApi = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    apiFetch: (...args: unknown[]) => sharedApi.apiFetch(...args),
  };
});

// page 模式 workspacesQuery（工作区名解析）数据源。
const workspaceApi = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
}));

vi.mock("@/lib/workspaces", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspaces")>(
    "@/lib/workspaces",
  );
  return { ...actual, listWorkspaces: workspaceApi.listWorkspaces };
});

// page 模式 chrome（SessionConfigBar）数据 hook：无网络，空数据
//（本文件只测会话头徽标，config-bar 徽标归 session-config-bar.test.tsx）。
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

/** attach 详情（page detailQuery）；agentProfileId 可覆盖驱动徽标判定。 */
function makeDetail(agentProfileId: string | null) {
  return {
    id: "sess-shared",
    runtime_id: null,
    lease_id: null,
    provider: "claude",
    status: "active",
    agent_session_id: "ag-1",
    config: null,
    turn_count: 0,
    created_at: "t",
    last_active_at: null,
    ended_at: null,
    current_run_id: null,
    workspace_id: null,
    llm_provider_id: null,
    agent_profile_id: agentProfileId,
    title: "共享会话",
    config_snapshot: null,
  };
}

/** active 共享智能体生效摘要（SharedAgentActiveView 生成版形态）。 */
function makeActiveShared() {
  return [
    {
      id: "grant-1",
      agent_profile_id: "prof-shared",
      display_name: "平台源码助手",
      provider: "claude",
      runtime_online: true,
    },
  ];
}

/** page 模式挂载（与 variant 测试同模板）。 */
function setupPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <SessionPanel mode="page" sessionId="sess-shared" machines={[]} llmProviders={[]} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
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
    created_at: "2026-08-28T10:00:00Z",
  });
  sessionApi.getAgentSessionLogs.mockResolvedValue([]);
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
  // task-10：active 共享智能体默认生效列表（用例内覆盖失败场景）。
  sharedApi.apiFetch.mockResolvedValue(makeActiveShared());
});

describe("SessionPanel「平台共享」会话徽标（task-10 / FR-05）", () => {
  it("会话档案 ∈ active 共享智能体 → 头部元信息区渲染「平台共享」徽标（无「只读」字样）", async () => {
    sessionApi.getAgentSession.mockResolvedValue(makeDetail("prof-shared"));
    setupPage();

    const badge = await screen.findByTestId("session-platform-shared-badge");
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toBe("平台共享");
    // D-002@v2：文案是「平台共享」，不出现「只读」。
    expect(badge.textContent).not.toContain("只读");
    expect(badge.getAttribute("title")).toContain("共享输出目录");
  });

  it("会话档案未命中 active 列表（自有档案）→ 不渲染徽标（现状零回归）", async () => {
    sessionApi.getAgentSession.mockResolvedValue(makeDetail("prof-own"));
    setupPage();

    await screen.findByLabelText("会话面板");
    expect(
      screen.queryByTestId("session-platform-shared-badge"),
    ).not.toBeInTheDocument();
  });

  it("会话无档案（agent_profile_id=null）→ 不渲染徽标", async () => {
    sessionApi.getAgentSession.mockResolvedValue(makeDetail(null));
    setupPage();

    await screen.findByLabelText("会话面板");
    expect(
      screen.queryByTestId("session-platform-shared-badge"),
    ).not.toBeInTheDocument();
  });

  it("active 列表请求失败 → 降级不渲染，面板正常（徽标数据缺失不阻塞）", async () => {
    sharedApi.apiFetch.mockRejectedValue(new Error("网络错误"));
    sessionApi.getAgentSession.mockResolvedValue(makeDetail("prof-shared"));
    setupPage();

    const panel = await screen.findByLabelText("会话面板");
    expect(panel).toBeInTheDocument();
    expect(
      screen.queryByTestId("session-platform-shared-badge"),
    ).not.toBeInTheDocument();
  });
});
