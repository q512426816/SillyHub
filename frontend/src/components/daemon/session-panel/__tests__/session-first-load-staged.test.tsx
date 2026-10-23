/**
 * 2026-10-23-session-first-load-ux / FR-02 / FR-03：首屏两段渲染整页集成测试。
 *
 * 锁定的行为：
 *   1. FR-02 主路径：底窗日志（HISTORY_PAGE_SIZE 满页）到达即渲染最近轮次——
 *      **不等** buildInitialWindow 补拉链（probe 挂起期间内容已上屏）；补拉完成
 *      后锚点轮整轮 + 更早轮增量 prepend（底窗内容不回退、块序正确）；
 *   2. FR-02 补拉在飞挂起翻页：probe 挂起期间（hasEarlier 已放开）无 before
 *      游标翻页请求发出——同步锁生效；
 *   3. FR-02 回退：probe 失败 → 整体回退底窗（内容保持、无增量、不崩）；
 *   4. FR-03：终态空会话（底窗空）保持原空态文案，不残留骨架。
 *
 * mock 风格照抄 session-preview-integration.test.tsx（page 模式 QueryClientProvider
 * + 仅 mock 网络层；probe/直达用 deferred 控时序）。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionPanel } from "../../session-panel";

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
  probeSessionLogBefore: vi.fn(), getSessionRunLogs: vi.fn(),
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
    agent_session_id: `ag-${id}`, config: null, turn_count: 2, created_at: "t",
    last_active_at: null, ended_at: null, current_run_id: null, workspace_id: "ws-1",
    llm_provider_id: null, agent_profile_id: null, title: `S${id}`, config_snapshot: null };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

/** 单条日志 fixture（秒序 id/ts 保证时间维全序）。 */
let seq = 0;
function entry(runId: string, tsSec: number, channel: string, content: string) {
  seq += 1;
  const mm = String(Math.floor(tsSec / 60)).padStart(2, "0");
  const ss = String(tsSec % 60).padStart(2, "0");
  return {
    id: `log-${String(seq).padStart(4, "0")}`,
    run_id: runId,
    timestamp: `2026-10-23T10:${mm}:${ss}.000Z`,
    channel,
    content_redacted: content,
  };
}

const ANCHOR = "run-anchor";
const NEW = "run-new";
/** 锚点轮被截断的底窗（400 行满页）：anchor 尾部 200 行 + new 整轮 200 行。 */
function makeBaseLogs() {
  const anchorTail: ReturnType<typeof entry>[] = [];
  for (let i = 0; i < 200; i += 1) {
    anchorTail.push(entry(ANCHOR, 60 + i, "stdout", `锚点轮尾部输出${i}`));
  }
  const newRun = [
    entry(NEW, 400, "user_input", "最新轮提问正文"),
    ...Array.from({ length: 199 }, (_, i) =>
      entry(NEW, 401 + i, "stdout", `最新轮输出${i}`)),
  ];
  return [...anchorTail, ...newRun];
}
/** 锚点整轮 = 底窗前部（user_input 轮首 + 早段）+ 尾部 200 行。 */
function makeAnchorFull(base: ReturnType<typeof makeBaseLogs>) {
  const head = [
    entry(ANCHOR, 10, "user_input", "锚点轮提问正文"),
    ...Array.from({ length: 49 }, (_, i) =>
      entry(ANCHOR, 11 + i, "stdout", `锚点轮早段输出${i}`)),
  ];
  // 直接复用底窗 anchor 行（id 一致，模拟同一批行——差集按 id 判定）。
  return [...head, ...base.filter((l) => l.run_id === ANCHOR)];
}

const OUTLINE = {
  session_id: "s1",
  total_turns: 2,
  items: [
    { run_id: ANCHOR, seq: 1, created_at: "2026-10-23T10:01:00.000Z", started_at: "2026-10-23T10:01:00.000Z", status: "completed", prompt_summary: "锚点轮摘要" },
    { run_id: NEW, seq: 2, created_at: "2026-10-23T10:07:00.000Z", started_at: "2026-10-23T10:07:00.000Z", status: "completed", prompt_summary: "最新轮摘要" },
  ],
};

function runSnapshot() {
  return [
    { id: ANCHOR, status: "completed", created_at: "2026-10-23T10:01:00.000Z", started_at: null, finished_at: null, error_code: null, error_detail: null, user_id: null, sender_name: null, input_tokens: null, output_tokens: null, ctx_tokens: null, duration_api_ms: null, llm_provider_id: null, agent_profile_snapshot: null, metadata: null, engine_anchor: null, failure_summary: null, run_kind: null, cwd: null, config_snapshot: null },
    { id: NEW, status: "completed", created_at: "2026-10-23T10:07:00.000Z", started_at: null, finished_at: null, error_code: null, error_detail: null, user_id: null, sender_name: null, input_tokens: null, output_tokens: null, ctx_tokens: null, duration_api_ms: null, llm_provider_id: null, agent_profile_snapshot: null, metadata: null, engine_anchor: null, failure_summary: null, run_kind: null, cwd: null, config_snapshot: null },
  ] as never[];
}

function Host({ sessionId }: { sessionId: string }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SessionPanel mode="page" sessionId={sessionId} machines={[]} llmProviders={[]} />
    </QueryClientProvider>
  );
}

const beforeCalls = () =>
  sessionApi.getAgentSessionLogs.mock.calls.filter((c) => c[1]?.before);

beforeEach(() => {
  vi.clearAllMocks();
  seq = 0;
  sessionApi.getAgentSession.mockImplementation(async (sid: string) => makeDetail(sid));
  sessionApi.listSessionRuns.mockResolvedValue(runSnapshot());
  sessionApi.streamSession.mockImplementation(() => ({ close: vi.fn(), getLastEventId: () => null }));
  sessionApi.fetchPendingDialogs.mockResolvedValue([]);
  sessionApi.fetchSessionDialogHistory.mockResolvedValue([]);
  sessionApi.listSessionTeamMissions.mockResolvedValue([]);
  sessionApi.fetchSessionQueue.mockResolvedValue([]);
  sessionApi.fetchSessionTurnOutline.mockResolvedValue(OUTLINE);
  // 底窗立即返回；before 翻页一律到头（[]）。
  sessionApi.getAgentSessionLogs.mockImplementation(
    async (_sid: string, opts?: { before?: string; runId?: string }) => {
      if (opts?.before || opts?.runId) return [];
      return makeBaseLogs();
    },
  );
  sessionApi.getSessionRunLogs.mockResolvedValue([]);
});

describe("首屏两段渲染（2026-10-23-session-first-load-ux）", () => {
  it("FR-02 主路径：底窗先渲染（probe 挂起期间已上屏），补拉完成后锚点整轮增量合并", async () => {
    const base = makeBaseLogs();
    const anchorFull = makeAnchorFull(base);
    sessionApi.getAgentSessionLogs.mockImplementation(
      async (_sid: string, opts?: { before?: string; runId?: string }) => {
        if (opts?.before || opts?.runId) return [];
        return base;
      },
    );
    // probe 挂起：补拉链停在第一步。
    const probeGate = deferred<{ run_id: string }[]>();
    sessionApi.probeSessionLogBefore.mockReturnValue(probeGate.promise);
    sessionApi.getSessionRunLogs.mockResolvedValue(anchorFull);

    render(<Host sessionId="s1" />);

    // ── 第一段断言（补拉未完成）：底窗内容已渲染 ──
    await waitFor(() =>
      expect(screen.getAllByText(/最新轮提问正文/).length).toBeGreaterThan(0),
    );
    // 锚点轮轮首（直达才会带回）尚未上屏。
    expect(screen.queryByText(/锚点轮提问正文/)).not.toBeInTheDocument();
    // 补拉在飞：before 游标翻页请求零发出（同步锁挂起触顶/自动补拉）。
    await waitFor(() => expect(sessionApi.probeSessionLogBefore).toHaveBeenCalled());
    expect(beforeCalls()).toHaveLength(0);

    // ── 放行补拉链：probe 判定截断 → 直达锚点整轮 → 增量合并 ──
    probeGate.resolve([{ run_id: ANCHOR }]);
    await waitFor(() =>
      expect(sessionApi.getSessionRunLogs).toHaveBeenCalledWith(
        "s1",
        ANCHOR,
        expect.anything(),
      ),
    );
    // 锚点整轮（含轮首提问）prepend 上屏。
    await waitFor(() =>
      expect(screen.getAllByText(/锚点轮提问正文/).length).toBeGreaterThan(0),
    );
    // 底窗内容不回退（最新轮仍在屏）。
    expect(screen.getAllByText(/最新轮提问正文/).length).toBeGreaterThan(0);
    // 块序：锚点轮在最新轮之前（prepend 头部）。
    const blocks = screen.getAllByTestId("turn-block");
    const firstHasAnchor = blocks[0]!.textContent?.includes("锚点轮提问正文") ?? false;
    const lastHasNew = blocks[blocks.length - 1]!.textContent?.includes("最新轮提问正文") ?? false;
    expect(firstHasAnchor).toBe(true);
    expect(lastHasNew).toBe(true);
    // 底窗锚点旧块已摘（同轮不双显）：含锚点提问的块只有一个。
    const anchorBlocks = blocks.filter((b) =>
      b.textContent?.includes("锚点轮提问正文"),
    );
    expect(anchorBlocks).toHaveLength(1);
  });

  it("FR-02 回退：probe 失败 → 整体回退底窗（内容保持、无增量、不崩）", async () => {
    sessionApi.probeSessionLogBefore.mockRejectedValue(new Error("probe down"));

    render(<Host sessionId="s1" />);

    await waitFor(() =>
      expect(screen.getAllByText(/最新轮提问正文/).length).toBeGreaterThan(0),
    );
    // 回退：直达未发起（probe 失败即阻断自适应）、锚点轮首不上屏、内容稳定在屏。
    expect(sessionApi.getSessionRunLogs).not.toHaveBeenCalled();
    expect(screen.queryByText(/锚点轮提问正文/)).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getAllByText(/最新轮提问正文/).length).toBeGreaterThan(0),
    );
  });

  it("FR-03：终态空会话保持原空态文案，不残留骨架屏", async () => {
    sessionApi.fetchSessionTurnOutline.mockResolvedValue({
      session_id: "s1", total_turns: 0, items: [],
    });
    sessionApi.listSessionRuns.mockResolvedValue([]);
    sessionApi.getAgentSessionLogs.mockResolvedValue([]);

    render(<Host sessionId="s1" />);

    // 空会话终态：原空态文案在场，骨架不在。
    await waitFor(() =>
      expect(
        screen.getByText(/已就绪|没有在线守护进程/),
      ).toBeTruthy(),
    );
    expect(screen.queryByTestId("turn-history-skeleton")).not.toBeInTheDocument();
  });
});
