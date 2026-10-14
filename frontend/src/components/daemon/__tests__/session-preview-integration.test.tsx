/**
 * task-03 / task-04（2026-10-14-session-turn-preview-cards / FR-01 / FR-03 /
 * FR-04 / D-001@v1）：消息流预览卡整页集成测试——
 *   1. FR-01：attach 后消息流按大纲呈现未加载轮预览卡（已加载轮不渲染卡）；
 *   2. FR-03：点击未加载导航刻度 → 目标轮单轮直达 + 前后各 1 个未加载轮后台
 *      预取（已加载邻居跳过）；预览卡命中不误判（hit 内容门排除 data-turn-preview，
 *      D-005@v1）；
 *   3. FR-04：大纲缺失（空 items）消息流无预览卡（降级现状形态）。
 *
 * mock 风格照抄 session-history-scroll.test.tsx（page 模式 QueryClientProvider +
 * 仅 mock 网络层；MarkdownText jsdom 同步渲染 mock）。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionPanel } from "../session-panel";

vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

const sessionApi = vi.hoisted(() => ({
  getSessionUsage: vi.fn().mockResolvedValue(null),
  injectSession: vi.fn(), interruptSession: vi.fn(), endSession: vi.fn(),
  streamSession: vi.fn(), getAgentSession: vi.fn(), getAgentSessionLogs: vi.fn(),
  fetchSessionTurnOutline: vi.fn(),
  fetchPendingDialogs: vi.fn(), fetchSessionDialogHistory: vi.fn(),
  listSessionRuns: vi.fn(), listSessionTasks: vi.fn().mockResolvedValue([]),
  listSessionTeamMissions: vi.fn(), fetchSessionQueue: vi.fn(),
}));

vi.mock("@/lib/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/lib/daemon")>("@/lib/daemon");
  return { ...actual, ...Object.fromEntries(Object.entries(sessionApi).map(([k, v]) => [k, v])) };
});
vi.mock("@/lib/workspaces", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspaces")>("@/lib/workspaces");
  return { ...actual, listWorkspaces: vi.fn().mockResolvedValue({ items: [] }) };
});
vi.mock("@/lib/use-daemon-machines", () => ({ useDaemonMachines: () => ({ items: [] }) }));
vi.mock("@/lib/agent-profiles", async () => {
  const actual = await vi.importActual<typeof import("@/lib/agent-profiles")>("@/lib/agent-profiles");
  return { ...actual, useMineAgentProfiles: () => ({ profiles: [] }) };
});
vi.mock("@/lib/api/llm-providers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/llm-providers")>("@/lib/api/llm-providers");
  return { ...actual, listProviders: vi.fn().mockResolvedValue([]) };
});

function makeDetail(id: string) {
  return { id, runtime_id: null, lease_id: null, provider: "claude", status: "active",
    agent_session_id: `ag-${id}`, config: null, turn_count: 3, created_at: "t",
    last_active_at: null, ended_at: null, current_run_id: null, workspace_id: "ws-1",
    llm_provider_id: null, agent_profile_id: null, title: `S${id}`, config_snapshot: null };
}

/** 单轮最小日志集（user_input + stdout 各 1，让 logsToTurns 装配出有正文轮）。 */
function turnLogs(runId: string, seq: number, minute: number) {
  const ts = (sec: number) =>
    `2026-08-26T10:${String(minute).padStart(2, "0")}:${String(sec).padStart(2, "0")}.0Z`;
  return [
    { id: `log-${runId}-u`, run_id: runId, timestamp: ts(0), channel: "user_input", content_redacted: `第${seq}轮提问内容，用于装配用户消息正文` },
    { id: `log-${runId}-a`, run_id: runId, timestamp: ts(5), channel: "stdout", content_redacted: `第${seq}轮答复内容，装配 agent 答复正文使用` },
  ];
}

/** 三轮大纲：run-a（第1轮，未加载）/ run-b（第2轮，未加载）/ run-c（第3轮，初始窗口内已加载）。 */
const OUTLINE = {
  session_id: "s1",
  total_turns: 3,
  items: [
    { run_id: "run-a", seq: 1, created_at: "2026-08-26T10:00:00.0Z", started_at: "2026-08-26T10:00:00.0Z", status: "completed", prompt_summary: "第一轮提问摘要", answer_summary: "第一轮答复摘要" },
    { run_id: "run-b", seq: 2, created_at: "2026-08-26T10:05:00.0Z", started_at: "2026-08-26T10:05:00.0Z", status: "completed", prompt_summary: "第二轮提问摘要" },
    { run_id: "run-c", seq: 3, created_at: "2026-08-26T10:10:00.0Z", started_at: "2026-08-26T10:10:00.0Z", status: "completed", prompt_summary: "第三轮提问摘要" },
  ],
};

function Host({ sessionId }: { sessionId: string }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SessionPanel mode="page" sessionId={sessionId} machines={[]} llmProviders={[]} />
    </QueryClientProvider>
  );
}

async function attachSession(sessionId: string) {
  render(<Host sessionId={sessionId} />);
  // attach 完成：初始窗口（run-c 轮）已装配进消息流。
  await waitFor(() =>
    expect(screen.getAllByText(/第3轮提问内容/).length).toBeGreaterThan(0),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionApi.getAgentSession.mockImplementation(async (sid: string) => makeDetail(sid));
  sessionApi.listSessionRuns.mockResolvedValue([]);
  sessionApi.streamSession.mockImplementation(() => ({ close: vi.fn(), getLastEventId: () => null }));
  sessionApi.fetchPendingDialogs.mockResolvedValue([]);
  sessionApi.fetchSessionDialogHistory.mockResolvedValue([]);
  sessionApi.listSessionTeamMissions.mockResolvedValue([]);
  sessionApi.fetchSessionQueue.mockResolvedValue([]);
  sessionApi.fetchSessionTurnOutline.mockResolvedValue(OUTLINE);
  // 初始窗口只回 run-c 日志（无 before 游标）；run_id 直达按参数分派。
  sessionApi.getAgentSessionLogs.mockImplementation(
    async (_sid: string, opts?: { runId?: string; before?: string }) => {
      if (opts?.runId === "run-a") return turnLogs("run-a", 1, 0);
      if (opts?.runId === "run-b") return turnLogs("run-b", 2, 5);
      if (opts?.runId === "run-c") return turnLogs("run-c", 3, 10);
      if (opts?.before) return [];
      return turnLogs("run-c", 3, 10);
    },
  );
});

const runIdCalls = () =>
  sessionApi.getAgentSessionLogs.mock.calls
    .filter((c) => c[1]?.runId)
    .map((c) => c[1]!.runId);

describe("消息流预览卡集成（FR-01 / FR-03 / FR-04）", () => {
  it("FR-01：attach 后未加载轮渲染预览卡（已加载轮不渲染）", async () => {
    await attachSession("s1");
    const cards = screen.getAllByTestId("turn-preview-card");
    // run-a / run-b 未加载 → 2 张预览卡；run-c 已加载 → 不在卡列（其内容行在）。
    expect(cards).toHaveLength(2);
    expect(cards[0]!.getAttribute("data-turn-key")).toBe("run-a");
    expect(cards[1]!.getAttribute("data-turn-key")).toBe("run-b");
    expect(cards[0]).toHaveTextContent("第一轮提问摘要");
  });

  it("FR-03：点击未加载刻度 → 目标轮直达 + 前向未加载邻居预取（已加载邻居跳过）", async () => {
    await attachSession("s1");
    // 点击第 2 轮（run-b）导航刻度。
    const tickB = screen
      .getAllByTestId("turn-nav-tick")
      .find((el) => el.getAttribute("aria-label")?.startsWith("第2轮"));
    expect(tickB).toBeTruthy();
    fireEvent.click(tickB!);
    // 目标轮直达 + 前邻居 run-a 预取（后邻居 run-c 已加载，跳过）。
    await waitFor(() => {
      const calls = runIdCalls();
      expect(calls).toContain("run-b");
      expect(calls).toContain("run-a");
    });
    // 已加载判重生效：run-c 不因预取被重复 run_id 拉取。
    expect(runIdCalls().filter((r) => r === "run-c")).toHaveLength(0);
    // 目标轮内容装配上屏（直达成功）。
    await waitFor(() =>
      expect(screen.getAllByText(/第2轮提问内容/).length).toBeGreaterThan(0),
    );
  });

  it("FR-03/D-005：预览卡不被 hit() 60 字内容门误判——直达真实发起（回归锚）", async () => {
    await attachSession("s1");
    const tickB = screen
      .getAllByTestId("turn-nav-tick")
      .find((el) => el.getAttribute("aria-label")?.startsWith("第2轮"));
    fireEvent.click(tickB!);
    // 若 hit() 误判预览卡为已加载，直达请求不会发起——本断言即回归门。
    await waitFor(() => expect(runIdCalls()).toContain("run-b"));
  });

  it("FR-04：大纲缺失（空 items）降级现状形态——无预览卡不报错", async () => {
    sessionApi.fetchSessionTurnOutline.mockResolvedValue({
      session_id: "s1", total_turns: 0, items: [],
    });
    await attachSession("s1");
    expect(screen.queryByTestId("turn-preview-card")).not.toBeInTheDocument();
    expect(screen.getAllByText(/第3轮提问内容/).length).toBeGreaterThan(0);
  });
});
