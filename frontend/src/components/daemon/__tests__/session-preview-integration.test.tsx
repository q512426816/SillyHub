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

// 2026-10-19-preview-card-empty-turn-fix：useNotify 换 spy（测试环境无 <AntApp>
// 包裹，不起 message DOM）——empty 轻提示断言面（先例 session-input-bar-upload）。
const notifyMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));
vi.mock("@/lib/errors", async () => {
  const actual = await vi.importActual<typeof import("@/lib/errors")>(
    "@/lib/errors",
  );
  return { ...actual, useNotify: () => notifyMock };
});

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

async function attachSession(sessionId: string, loadedMarker = /第3轮提问内容/) {
  render(<Host sessionId={sessionId} />);
  // attach 完成：初始窗口（run-c 轮）已装配进消息流（marker 随用例内 turnLogs seq 变化）。
  await waitFor(() =>
    expect(screen.getAllByText(loadedMarker).length).toBeGreaterThan(0),
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

  it("defect-fixes：额度失败轮（仅 user_input 无答复）点导航原位展开用户消息，且重复点击不重复请求", async () => {
    // 两轮大纲：run-x 失败轮（seq 1）——真实形态：user_input 是「[后台任务通知]」
    // 系统注入（logsToTurns 剥空 → prompt 恒空）+ 429 错误行；失败卡内容由 runs
    // 快照 error_detail 注入。run-c 完整轮（seq 2，初始窗口内已加载）。
    sessionApi.fetchSessionTurnOutline.mockResolvedValue({
      session_id: "s1",
      total_turns: 2,
      items: [
        { run_id: "run-x", seq: 1, created_at: "2026-08-26T10:00:00.0Z", started_at: "2026-08-26T10:00:00.0Z", status: "failed", error_code: "provider_quota_exceeded", prompt_summary: "[后台任务通知] 以下 2 个后台子代理任务已全部结束" },
        { run_id: "run-c", seq: 2, created_at: "2026-08-26T10:10:00.0Z", started_at: "2026-08-26T10:10:00.0Z", status: "completed", prompt_summary: "第三轮提问摘要" },
      ],
    });
    // runs 快照带 error_detail（失败卡数据源——enrichDisplayTurns 注入 RunErrorItem）。
    sessionApi.listSessionRuns.mockResolvedValue([
      { id: "run-x", status: "failed", error_code: "provider_quota_exceeded", error_detail: { message: "已达到 5 小时的使用上限", type: "quota_exceeded" }, started_at: "2026-08-26T10:00:00.0Z", created_at: "2026-08-26T10:00:00.0Z", finished_at: "2026-08-26T10:01:00.0Z", user_id: null, sender_name: null, input_tokens: null, output_tokens: null, ctx_tokens: null, duration_api_ms: null, llm_provider_id: null, agent_profile_snapshot: null, metadata: null, engine_anchor: null, failure_summary: null, run_kind: null, cwd: null, config_snapshot: null },
    ] as never);
    sessionApi.getAgentSessionLogs.mockImplementation(
      async (_sid: string, opts?: { runId?: string; before?: string }) => {
        if (opts?.runId === "run-x") {
          // 额度耗尽失败轮真实形态：系统通知开轮（剥空）+ 429 stderr 行——
          // logsToTurns 产出 prompt/segments/output 三空（旧口径被判零正文 →
          // 点击无反应；新口径 outline failed 放行 → 空块 + 失败卡）。
          return [
            { id: "log-run-x-u", run_id: "run-x", timestamp: "2026-08-26T10:00:30.0Z", channel: "user_input", content_redacted: "[后台任务通知] 以下 2 个后台子代理任务已全部结束（列表中的每一个都已终止）" },
            { id: "log-run-x-e", run_id: "run-x", timestamp: "2026-08-26T10:01:00.0Z", channel: "stderr", content_redacted: "[ASSISTANT] API Error: Request rejected (429) · 已达到 5 小时的使用上限" },
          ];
        }
        if (opts?.runId === "run-c") return turnLogs("run-c", 2, 10);
        if (opts?.before) return [];
        return turnLogs("run-c", 2, 10);
      },
    );
    await attachSession("s1", /第2轮提问内容/);
    expect(screen.getAllByTestId("turn-preview-card")).toHaveLength(1);
    const tickX = screen
      .getAllByTestId("turn-nav-tick")
      .find((el) => el.getAttribute("aria-label")?.startsWith("第1轮"));
    fireEvent.click(tickX!);
    // 直达真实发起且空块被放进来（outline failed 放行）：该轮 data-turn-key 出现
    // 非 preview 行、预览卡消失（无双块）、runs 快照注入的失败卡正文可见。
    await waitFor(() => {
      const row = document.querySelector(
        '[data-testid="turn-timeline-scroll"] [data-turn-key="run-x"]:not([data-turn-preview])',
      );
      expect(row).toBeTruthy();
    });
    await waitFor(() =>
      expect(screen.queryByTestId("turn-preview-card")).not.toBeInTheDocument(),
    );
    // 已加载判定含 #e 装饰后缀：再次点击导航不重复发起直达。
    const callsAfterFirst = runIdCalls().filter((r) => r === "run-x").length;
    fireEvent.click(tickX!);
    await new Promise((r) => setTimeout(r, 300));
    expect(runIdCalls().filter((r) => r === "run-x").length).toBe(callsAfterFirst);
  });

  it("defect-fixes：真零正文轮（无 user_input 无答复）幂等语义不变——不展开不重复请求", async () => {
    sessionApi.fetchSessionTurnOutline.mockResolvedValue({
      session_id: "s1",
      total_turns: 2,
      items: [
        { run_id: "run-e", seq: 1, created_at: "2026-08-26T10:00:00.0Z", started_at: "2026-08-26T10:00:00.0Z", status: "completed", prompt_summary: null },
        { run_id: "run-c", seq: 2, created_at: "2026-08-26T10:10:00.0Z", started_at: "2026-08-26T10:10:00.0Z", status: "completed", prompt_summary: "第三轮提问摘要" },
      ],
    });
    sessionApi.getAgentSessionLogs.mockImplementation(
      async (_sid: string, opts?: { runId?: string; before?: string }) => {
        if (opts?.runId === "run-e") {
          // 群聊空 user_input 形态：一条无关紧要的系统行，装配无 prompt 无 output。
          return [
            { id: "log-run-e-s", run_id: "run-e", timestamp: "2026-08-26T10:00:30.0Z", channel: "system", content_redacted: "" },
          ];
        }
        if (opts?.runId === "run-c") return turnLogs("run-c", 2, 10);
        if (opts?.before) return [];
        return turnLogs("run-c", 2, 10);
      },
    );
    await attachSession("s1", /第2轮提问内容/);
    const tickE = screen
      .getAllByTestId("turn-nav-tick")
      .find((el) => el.getAttribute("aria-label")?.startsWith("第1轮"));
    fireEvent.click(tickE!);
    await waitFor(() => expect(runIdCalls()).toContain("run-e"));
    await new Promise((r) => setTimeout(r, 300));
    // 零正文：预览卡保持（无内容可展开），重复点击不重复请求（2026-09-29 语义）。
    expect(screen.getAllByTestId("turn-preview-card")).toHaveLength(1);
    const callsAfterFirst = runIdCalls().filter((r) => r === "run-e").length;
    fireEvent.click(tickE!);
    await new Promise((r) => setTimeout(r, 300));
    expect(runIdCalls().filter((r) => r === "run-e").length).toBe(callsAfterFirst);
  });

  it("2026-10-19：纯切换轮（started_at 空、零日志）不出预览卡，渲染孤儿配置行", async () => {
    // 实测形态（会话 54317e42 第 2/4/7 轮）：切换档案建 run 零日志、started_at
    // 空、摘要双空——刷新后大纲含它，但归并层须透传孤儿配置行（紧凑配置行语义
    // 保留，2026-10-14 design 非目标），不得替换成永久展不开的「点击展开」死卡。
    sessionApi.fetchSessionTurnOutline.mockResolvedValue({
      session_id: "s1",
      total_turns: 2,
      items: [
        { run_id: "run-c", seq: 1, created_at: "2026-08-26T10:10:00.0Z", started_at: "2026-08-26T10:10:00.0Z", status: "completed", prompt_summary: "第三轮提问摘要" },
        { run_id: "run-sw", seq: 2, created_at: "2026-08-26T10:12:00.0Z", started_at: null, status: "completed", prompt_summary: null, answer_summary: null },
      ],
    });
    // runs 快照带档案名（孤儿配置行 whoLine 数据源；finished_at 在已加载窗口内）。
    sessionApi.listSessionRuns.mockResolvedValue([
      { id: "run-sw", status: "completed", error_code: null, error_detail: null, started_at: null, created_at: "2026-08-26T10:12:00.0Z", finished_at: "2026-08-26T10:12:01.0Z", user_id: null, sender_name: null, input_tokens: null, output_tokens: null, ctx_tokens: null, duration_api_ms: null, llm_provider_id: null, agent_profile_snapshot: { name: "Claude Code 默认" }, metadata: null, engine_anchor: null, failure_summary: null, run_kind: null, cwd: null, config_snapshot: null },
    ] as never);
    sessionApi.getAgentSessionLogs.mockImplementation(
      async (_sid: string, opts?: { runId?: string; before?: string }) => {
        if (opts?.runId === "run-sw") return [];
        if (opts?.before) return [];
        return turnLogs("run-c", 1, 10);
      },
    );
    await attachSession("s1", /第1轮提问内容/);
    // 孤儿配置行上屏（时间线内 data-turn-key 非 preview 行，含档案名；选择器
    // 限定滚动容器，避开导航刻度同名锚点——先例 run-x 用例同款）。
    await waitFor(() => {
      const row = document.querySelector(
        '[data-testid="turn-timeline-scroll"] [data-turn-key="run-sw"]:not([data-turn-preview])',
      );
      expect(row).toBeTruthy();
      expect(row!.textContent).toContain("Claude Code 默认");
    });
    // 全程无「点击展开」死卡；无内容轮不进展开链路（不发起单轮拉取）。
    expect(screen.queryByTestId("turn-preview-card")).not.toBeInTheDocument();
    expect(runIdCalls()).not.toContain("run-sw");
  });

  it("2026-10-19：真零正文轮点卡片出轻提示，重复点击幂等不再请求", async () => {
    // started_at 有值的零摘要轮（群聊空 user_input 形态）仍出预览卡（2026-09-29
    // 语义不变）；点击查回零正文 → empty 出 warning 轻提示（不再纯静默），卡片
    // 保持，再次点击被幂等标记短路不重复请求。
    sessionApi.fetchSessionTurnOutline.mockResolvedValue({
      session_id: "s1",
      total_turns: 2,
      items: [
        { run_id: "run-e2", seq: 1, created_at: "2026-08-26T10:00:00.0Z", started_at: "2026-08-26T10:00:00.0Z", status: "completed", prompt_summary: null },
        { run_id: "run-c", seq: 2, created_at: "2026-08-26T10:10:00.0Z", started_at: "2026-08-26T10:10:00.0Z", status: "completed", prompt_summary: "第三轮提问摘要" },
      ],
    });
    sessionApi.getAgentSessionLogs.mockImplementation(
      async (_sid: string, opts?: { runId?: string; before?: string }) => {
        if (opts?.runId === "run-e2") {
          // 群聊空 user_input 形态：一条无关紧要的系统行，装配无 prompt 无 output。
          return [
            { id: "log-run-e2-s", run_id: "run-e2", timestamp: "2026-08-26T10:00:30.0Z", channel: "system", content_redacted: "" },
          ];
        }
        if (opts?.runId === "run-c") return turnLogs("run-c", 2, 10);
        if (opts?.before) return [];
        return turnLogs("run-c", 2, 10);
      },
    );
    await attachSession("s1", /第2轮提问内容/);
    const card = screen.getByTestId("turn-preview-card");
    expect(card.getAttribute("data-turn-key")).toBe("run-e2");
    fireEvent.click(card);
    await waitFor(() => expect(runIdCalls()).toContain("run-e2"));
    await waitFor(() =>
      expect(notifyMock.warning).toHaveBeenCalledWith("该轮无对话内容"),
    );
    // 零正文：卡片保持（无内容可展开），重复点击短路不重复请求。
    expect(screen.getAllByTestId("turn-preview-card")).toHaveLength(1);
    const callsAfterFirst = runIdCalls().filter((r) => r === "run-e2").length;
    fireEvent.click(card);
    await new Promise((r) => setTimeout(r, 300));
    expect(runIdCalls().filter((r) => r === "run-e2").length).toBe(callsAfterFirst);
  });

  it("2026-10-19：静默切换轮导航刻度点击直接定位配置行——无 toast 无请求", async () => {
    // 真机验收发现的第三面：点静默轮导航刻度弹「操作失败」（直达查回 0 条日志
    // 走 notify.error 字符串被吞）。修复后：早退定位既有配置行，不发请求不弹 toast。
    sessionApi.fetchSessionTurnOutline.mockResolvedValue({
      session_id: "s1",
      total_turns: 2,
      items: [
        { run_id: "run-c", seq: 1, created_at: "2026-08-26T10:10:00.0Z", started_at: "2026-08-26T10:10:00.0Z", status: "completed", prompt_summary: "第三轮提问摘要" },
        { run_id: "run-sw", seq: 2, created_at: "2026-08-26T10:12:00.0Z", started_at: null, status: "completed", prompt_summary: null, answer_summary: null },
      ],
    });
    sessionApi.listSessionRuns.mockResolvedValue([
      { id: "run-sw", status: "completed", error_code: null, error_detail: null, started_at: null, created_at: "2026-08-26T10:12:00.0Z", finished_at: "2026-08-26T10:12:01.0Z", user_id: null, sender_name: null, input_tokens: null, output_tokens: null, ctx_tokens: null, duration_api_ms: null, llm_provider_id: null, agent_profile_snapshot: { name: "Claude Code 默认" }, metadata: null, engine_anchor: null, failure_summary: null, run_kind: null, cwd: null, config_snapshot: null },
    ] as never);
    sessionApi.getAgentSessionLogs.mockImplementation(
      async (_sid: string, opts?: { runId?: string; before?: string }) => {
        if (opts?.runId === "run-sw") return [];
        if (opts?.before) return [];
        return turnLogs("run-c", 1, 10);
      },
    );
    await attachSession("s1", /第1轮提问内容/);
    const tickSw = screen
      .getAllByTestId("turn-nav-tick")
      .find((el) => el.getAttribute("aria-label")?.startsWith("第2轮"));
    expect(tickSw).toBeTruthy();
    fireEvent.click(tickSw!);
    await new Promise((r) => setTimeout(r, 300));
    // 不发单轮请求、不弹任何 toast；配置行仍在（定位目标）。
    expect(runIdCalls()).not.toContain("run-sw");
    expect(notifyMock.error).not.toHaveBeenCalled();
    expect(notifyMock.warning).not.toHaveBeenCalled();
    expect(
      document.querySelector(
        '[data-testid="turn-timeline-scroll"] [data-turn-key="run-sw"]:not([data-turn-preview])',
      ),
    ).toBeTruthy();
    // 二次点击幂等同径（仍无请求无 toast）。
    fireEvent.click(tickSw!);
    await new Promise((r) => setTimeout(r, 300));
    expect(runIdCalls()).not.toContain("run-sw");
    expect(notifyMock.error).not.toHaveBeenCalled();
  });

  it("2026-10-19：真缺失日志轮（started_at 有值查回 0 条）导航点击报原文 warning 而非「操作失败」", async () => {
    // notify.error 收纯字符串会被 errMessage 吞成默认「操作失败」（errors.ts
    // misuse guard）；固定文案必须走 warning 原文。
    sessionApi.fetchSessionTurnOutline.mockResolvedValue({
      session_id: "s1",
      total_turns: 2,
      items: [
        { run_id: "run-m", seq: 1, created_at: "2026-08-26T10:00:00.0Z", started_at: "2026-08-26T10:00:00.0Z", status: "completed", prompt_summary: "缺失轮摘要" },
        { run_id: "run-c", seq: 2, created_at: "2026-08-26T10:10:00.0Z", started_at: "2026-08-26T10:10:00.0Z", status: "completed", prompt_summary: "第三轮提问摘要" },
      ],
    });
    sessionApi.getAgentSessionLogs.mockImplementation(
      async (_sid: string, opts?: { runId?: string; before?: string }) => {
        if (opts?.runId === "run-m") return [];
        if (opts?.before) return [];
        return turnLogs("run-c", 2, 10);
      },
    );
    await attachSession("s1", /第2轮提问内容/);
    const tickM = screen
      .getAllByTestId("turn-nav-tick")
      .find((el) => el.getAttribute("aria-label")?.startsWith("第1轮"));
    fireEvent.click(tickM!);
    await waitFor(() =>
      expect(notifyMock.warning).toHaveBeenCalledWith("该轮次日志不存在（可能已被清理）"),
    );
    expect(notifyMock.error).not.toHaveBeenCalled();
  });
});
