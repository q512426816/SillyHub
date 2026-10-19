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
import { render, screen, fireEvent } from "@testing-library/react";
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
    fetchSessionTurnOutline: vi.fn(),
  fetchPendingDialogs: vi.fn(),
  fetchSessionDialogHistory: vi.fn(),
  listSessionRuns: vi.fn(),
  listSessionTasks: vi.fn().mockResolvedValue([]),  // 任务执行面板快照（task-10 补 mock 防真实 fetch）
  listSessionTeamMissions: vi.fn(),
  triggerSessionTeamMission: vi.fn(),
  fetchSessionQueue: vi.fn(),
  deleteSessionQueueEntry: vi.fn(),
  retrySessionQueueEntry: vi.fn(),
  // 定时消息列表（known_failures I 组 flaky 根因）：本测试全局 mock 的 apiFetch 对
  // 所有请求返回 makeActiveShared() 数组——真 listScheduledMessages 拿到无 prompt
  // 字段的共享智能体条目，ScheduledMessagesBar 渲染时 summarizeScheduledPrompt
  // 读 undefined.length 异步崩溃拖 exit 1（时序性）。mock 成空列表切断污染。
  listScheduledMessages: vi.fn().mockResolvedValue([]),
  // 2026-10-19-shared-agent-onboarding-hint：预会话门控查询（listDaemonMachines
  // limit=1）——真会话用例 enabled=false 不会调用；预会话用例内显式 mock。
  listDaemonMachines: vi.fn(),
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
    // 任务执行面板挂载即取数（task-10）：缺接线走 actual 真 fetch → 无 App
    // 上下文 notify 炸 unhandled rejection。
    listSessionTasks: sessionApi.listSessionTasks,
    listSessionTeamMissions: sessionApi.listSessionTeamMissions,
    triggerSessionTeamMission: sessionApi.triggerSessionTeamMission,
    fetchSessionQueue: sessionApi.fetchSessionQueue,
    deleteSessionQueueEntry: sessionApi.deleteSessionQueueEntry,
    retrySessionQueueEntry: sessionApi.retrySessionQueueEntry,
    // ScheduledMessagesBar 挂载即取数（I 组 flaky 根因，见 sessionApi 块注释）。
    listScheduledMessages: sessionApi.listScheduledMessages,
    // 2026-10-19-shared-agent-onboarding-hint：门控机器查询 mock（见 sessionApi 块）。
    listDaemonMachines: sessionApi.listDaemonMachines,
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

// useNotify mock（测试环境无 antd App 包裹，先例 session-panel-draft-scope.test：
// 预会话引导交互用例点档案项触发 notify.success 会炸 message 未挂载）。
vi.mock("@/lib/errors", async () => {
  const actual = await vi.importActual<typeof import("@/lib/errors")>(
    "@/lib/errors",
  );
  return {
    ...actual,
    useNotify: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
  };
});

vi.mock("@/lib/workspaces", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspaces")>(
    "@/lib/workspaces",
  );
  return { ...actual, listWorkspaces: workspaceApi.listWorkspaces };
});

// page 模式 chrome（SessionConfigBar）数据 hook：无网络，空数据
//（本文件只测会话头徽标，config-bar 徽标归 session-config-bar.test.tsx）。
// 2026-10-19-shared-agent-onboarding-hint：useMineAgentProfiles 改可配置
//（预会话引导用例需提供共享智能体档案让 profileLabel 解析名字）。
const profileApi = vi.hoisted(() => ({ useMineAgentProfiles: vi.fn() }));
vi.mock("@/lib/use-daemon-machines", () => ({
  useDaemonMachines: () => ({ items: [] }),
}));
vi.mock("@/lib/agent-profiles", async () => {
  const actual = await vi.importActual<typeof import("@/lib/agent-profiles")>(
    "@/lib/agent-profiles",
  );
  return { ...actual, useMineAgentProfiles: profileApi.useMineAgentProfiles };
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
    sessionApi.fetchSessionTurnOutline.mockResolvedValue({ session_id: "s-1", total_turns: 0, items: [] });
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
  // 2026-10-19-shared-agent-onboarding-hint：档案列表默认空（预会话引导用例内覆盖）。
  profileApi.useMineAgentProfiles.mockReturnValue({ profiles: [] });
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

/* ----- 2026-10-19-shared-agent-onboarding-hint：预会话共享智能体默认选中引导 ----- */

/** 门控机器响应（DaemonMachineListResponse 形态，预会话查询只读 total/shared_to_me）。 */
function makeMachines(total: number, sharedCount = 0) {
  return {
    items: [],
    total,
    limit: 1,
    offset: 0,
    shared_to_me: Array.from({ length: sharedCount }, (_, i) => ({
      machine_id: `m-${i}`,
      display_name: `共享机${i}`,
      lender_display_name: null,
      source_workspace_id: null,
      online: true,
      runtimes: [],
    })),
  };
}

/** 预会话挂载（sessionId=null 走预会话分支）。 */
function setupPreSession() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <SessionPanel mode="page" sessionId={null} machines={[]} llmProviders={[]} />
    </QueryClientProvider>,
  );
}

describe("预会话共享智能体默认选中引导（2026-10-19-shared-agent-onboarding-hint）", () => {
  it("无自有/共享机器 + 在线共享智能体 → 默认选中并显示读写约束引导提示", async () => {
    sessionApi.listDaemonMachines.mockResolvedValue(makeMachines(0));
    profileApi.useMineAgentProfiles.mockReturnValue({
      profiles: [{ id: "prof-shared", name: "平台源码助手" }],
    });
    setupPreSession();

    const hint = await screen.findByTestId("pre-session-shared-agent-hint");
    expect(hint.textContent).toContain("平台源码助手");
    expect(hint.textContent).toContain("读平台源码不受限");
    expect(hint.textContent).toContain("写操作限制在共享输出目录");
    // 默认选中生效：配置条档案按钮显示共享智能体名。
    expect(screen.getByLabelText("配置-档案 平台源码助手")).toBeInTheDocument();
  });

  it("手动选『不指定』后自动选中让位，提示消失且不再被改回", async () => {
    sessionApi.listDaemonMachines.mockResolvedValue(makeMachines(0));
    profileApi.useMineAgentProfiles.mockReturnValue({
      profiles: [{ id: "prof-shared", name: "平台源码助手" }],
    });
    setupPreSession();
    await screen.findByTestId("pre-session-shared-agent-hint");

    // 打开档案下拉并选「不指定（无人格）」（aria-label 由 SwitchItem 拼装）。
    fireEvent.click(screen.getByLabelText("配置-档案 平台源码助手"));
    fireEvent.click(screen.getByLabelText("选择 不指定（无人格）"));

    // 档案回到未指定且提示消失；门控仍成立但自动选中不再覆盖（touchedRef）。
    expect(await screen.findByLabelText("配置-档案 未指定")).toBeInTheDocument();
    expect(
      screen.queryByTestId("pre-session-shared-agent-hint"),
    ).not.toBeInTheDocument();
  });

  it("有自有机器（total>0）→ 不自动选中、不显示提示", async () => {
    sessionApi.listDaemonMachines.mockResolvedValue(makeMachines(1));
    setupPreSession();

    await screen.findByTestId("session-pre-session-panel");
    expect(
      screen.queryByTestId("pre-session-shared-agent-hint"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("配置-档案 未指定")).toBeInTheDocument();
  });

  it("有『共享给我的』机器 → 不自动选中、不显示提示", async () => {
    sessionApi.listDaemonMachines.mockResolvedValue(makeMachines(0, 1));
    setupPreSession();

    await screen.findByTestId("session-pre-session-panel");
    expect(
      screen.queryByTestId("pre-session-shared-agent-hint"),
    ).not.toBeInTheDocument();
  });

  it("共享智能体全部离线 → 不自动选中、不显示提示", async () => {
    sessionApi.listDaemonMachines.mockResolvedValue(makeMachines(0));
    sharedApi.apiFetch.mockResolvedValue([
      {
        id: "grant-off",
        agent_profile_id: "prof-shared",
        display_name: "平台源码助手",
        provider: "claude",
        runtime_online: false,
      },
    ]);
    setupPreSession();

    await screen.findByTestId("session-pre-session-panel");
    expect(
      screen.queryByTestId("pre-session-shared-agent-hint"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("配置-档案 未指定")).toBeInTheDocument();
  });

  it("门控机器查询失败 → fail-open 不选中不提示，面板正常", async () => {
    sessionApi.listDaemonMachines.mockRejectedValue(new Error("网络错误"));
    profileApi.useMineAgentProfiles.mockReturnValue({
      profiles: [{ id: "prof-shared", name: "平台源码助手" }],
    });
    setupPreSession();

    const panel = await screen.findByTestId("session-pre-session-panel");
    expect(panel).toBeInTheDocument();
    expect(
      screen.queryByTestId("pre-session-shared-agent-hint"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("配置-档案 未指定")).toBeInTheDocument();
  });
});
