// 2026-10-11-mobile-subagent-drawer：mobile 子代理「紧凑卡 + 点击弹窗」单测。
//
// 背景：旧口径 mobile 不挂 SubagentPanelContext（design §3「移动端窄屏不做
// 右栏」），SubagentBlockView 回退内联展开分支——子代理内部会话整段刷进对话
// 流（用户实测手机端刷屏）。本变更：mobile 恒挂 Provider（内部槽位状态承载），
// 子代理段渲染紧凑基本信息卡（同 PC），点击右侧滑出 Drawer 内嵌既有
// SubagentDetailPanel 展示内部会话。
//
// 覆盖：
//   1. mobile 紧凑卡：子代理 children 不内联（对话流无内部会话内容），卡片
//      容器（data-segment-id）存在；
//   2. 点击卡片 → Drawer 打开，内部会话内容（子段正文 + 初始化提示词）在
//      Drawer 内可见；
//   3. ✕ 关闭 → Drawer 卸载、内容消失；
//   4. 零回归锚：desktop 且宿主未装配右栏 props（悬浮宿主 page 旧形态）仍
//      回退内联展开（children 可见，无卡片点击语义）。
//
// 固件：真会话历史日志喂真实装配链（getAgentSessionLogs → logsToTurns →
// displayTurns）——tool_call JSON 的 tool_use_id 即容器段 id，stdout 行按
// parent_tool_use_id 路由进 children（写法照 sessions-portal.test.tsx task-04）。
// mock 口径同 session-panel-variant.test.tsx（仅 mock 网络层）。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
  fetchSessionQueue: vi.fn(),
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
    fetchSessionQueue: sessionApi.fetchSessionQueue,
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

/** 子代理会话日志（容器段 tu-sub-1 + children，写法照 sessions-portal task-04）。 */
function makeSubagentLogs() {
  return [
    {
      id: "log-1",
      run_id: "run-1",
      timestamp: "2026-09-15T10:00:00Z",
      channel: "user_input",
      content_redacted: "帮我调研缓存方案",
    },
    {
      id: "log-2",
      run_id: "run-1",
      timestamp: "2026-09-15T10:00:01Z",
      channel: "tool_call",
      content_redacted:
        '{"tool":"Task","args":{"description":"调研缓存方案","prompt":"请调研并给出结论"},"tool_use_id":"tu-sub-1","success":true}',
    },
    {
      id: "log-3",
      run_id: "run-1",
      timestamp: "2026-09-15T10:00:02Z",
      channel: "stdout",
      content_redacted: "子代理调研完成，结论如下。",
      parent_tool_use_id: "tu-sub-1",
      subagent_type: "general-purpose",
      depth: 1,
    },
  ];
}

function setupPanel(variant?: "mobile") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SessionPanel
        mode="page"
        sessionId="sess-m"
        machines={[]}
        llmProviders={[]}
        {...(variant ? { variant } : {})}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionApi.getAgentSession.mockResolvedValue({
    id: "sess-m", runtime_id: null, lease_id: null, provider: "claude",
    status: "active", agent_session_id: "ag-1", config: null, turn_count: 1,
    created_at: "t", last_active_at: null, ended_at: null,
  });
  sessionApi.getAgentSessionLogs.mockResolvedValue(makeSubagentLogs());
  sessionApi.listSessionRuns.mockResolvedValue([]);
  sessionApi.streamSession.mockImplementation(() => ({
    close: vi.fn(),
    getLastEventId: () => null,
  }));
  sessionApi.fetchPendingDialogs.mockResolvedValue([]);
  sessionApi.fetchSessionDialogHistory.mockResolvedValue([]);
  sessionApi.listSessionTeamMissions.mockResolvedValue([]);
  sessionApi.fetchSessionQueue.mockResolvedValue([]);
  workspaceApi.listWorkspaces.mockResolvedValue({ items: [] });
});

/** 等历史轮回灌完成（用户消息气泡出现 = displayTurns 已装配）。 */
async function awaitTurns() {
  await waitFor(() => {
    expect(screen.getByText("帮我调研缓存方案")).toBeInTheDocument();
  });
}

describe("mobile 子代理紧凑卡 + Drawer 弹窗（2026-10-11-mobile-subagent-drawer）", () => {
  it("mobile：子代理段为紧凑卡（children 不内联刷屏），点击打开 Drawer 展示内部会话，✕ 关闭", async () => {
    const { container } = setupPanel("mobile");
    await awaitTurns();

    // 紧凑卡：容器段存在，但子代理内部正文不在对话流。
    const card = container.querySelector('[data-segment-id="tu-sub-1"]');
    expect(card).toBeTruthy();
    expect(screen.queryByText("子代理调研完成，结论如下。")).not.toBeInTheDocument();

    // 点击卡片头 → Drawer 打开，内部会话正文 + 初始化提示词可见。
    const head = card!.querySelector('[role="button"]');
    expect(head).toBeTruthy();
    fireEvent.click(head!);
    await waitFor(() => {
      expect(screen.getByText("子代理调研完成，结论如下。")).toBeInTheDocument();
    });
    expect(screen.getByText(/请调研并给出结论/)).toBeInTheDocument();

    // ✕ 关闭 → 内容随 Drawer 卸载消失。
    fireEvent.click(screen.getByTestId("subagent-panel-close"));
    await waitFor(() => {
      expect(screen.queryByText("子代理调研完成，结论如下。")).not.toBeInTheDocument();
    });
  });

  it("mobile：再点已激活卡片为 toggle 关闭（与 PC 语义一致）", async () => {
    const { container } = setupPanel("mobile");
    await awaitTurns();
    const card = container.querySelector('[data-segment-id="tu-sub-1"]')!;
    const head = card.querySelector('[role="button"]')!;

    fireEvent.click(head);
    await waitFor(() => {
      expect(screen.getByText("子代理调研完成，结论如下。")).toBeInTheDocument();
    });
    // 卡片已激活（ring 高亮），再点 → 关闭 Drawer。
    fireEvent.click(head);
    await waitFor(() => {
      expect(screen.queryByText("子代理调研完成，结论如下。")).not.toBeInTheDocument();
    });
  });

  it("零回归锚：desktop 悬浮宿主形态（未装配右栏 props）仍内联展开（children 可见）", async () => {
    setupPanel();
    await awaitTurns();
    // 无 Provider → SubagentBlockView 内联分支：终端态默认折叠，头部可展开
    // （aria-expanded 语义为内联分支专属）——展开后 children 正文直接在对话流。
    // 同名按钮多处命中（块头 + 段内工具行等），取带 aria-expanded 的容器块头。
    const head = (await screen.findAllByRole("button", { name: /调研缓存方案/ })).find(
      (b) => b.hasAttribute("aria-expanded"),
    );
    expect(head).toBeTruthy();
    fireEvent.click(head!);
    await waitFor(() => {
      expect(screen.getByText("子代理调研完成，结论如下。")).toBeInTheDocument();
    });
  });
});
