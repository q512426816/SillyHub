// 2026-10-13-load-earlier-full-turn：「加载更早」轮边界对齐回归——(ts,id)
// 复合游标按 400 行翻页，页边界 / 已加载窗口边界会把一轮（run）切成两半：
// 触顶加载后顶部那轮只有后半段（提问在更早未加载区）；「回到会话开头」复用
// 同一翻页链路（handleJumpToHead → loadEarlierOnce → handleLoadEarlier），
// 到头后跨页同轮分裂成多个轮块。对齐手段：跨界轮 run_id 直达拉整轮行，
// 当页该轮行替换为整轮行装配 + 摘窗口内同轮终态旧块，一轮一个完整块。
//
// mock 网络层模板同 session-panel-history-race.test.tsx（getAgentSessionLogs
// 按 opts 分流：runId=直达 / before+limit=1=探查 / before=翻页 / 其余=初始窗口）。
//
// 覆盖：
//   1. 窗口跨界 + 页顶跨界双命中：整轮直达合并单块（提问出现、旧行单显不双条、
//      窗口内同轮旧块被摘）；
//   2. 探查行属不同 run（页顶轮完整）→ 不发直达，当页照常 prepend；
//   3. 直达失败 → 静默降级现状行为（当页原样 prepend，无报错无卡死）；
//   4. 不满页（到头）→ 不发探查请求。
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { SessionPanel } from "../session-panel";

vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

const sessionApi = vi.hoisted(() => ({
  getSessionUsage: vi.fn().mockResolvedValue(null),
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

vi.mock("@/lib/workspaces", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspaces")>(
    "@/lib/workspaces",
  );
  return { ...actual, listWorkspaces: vi.fn().mockResolvedValue({ items: [] }) };
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

/* ----- fixture：时间维 run-Z（最早）→ run-A（跨窗口边界）→ run-B（窗口内） -----
 * 行数与源常量对齐（HISTORY_PAGE_SIZE=400）：初始窗口 400 行满页 / 翻页页
 * 400 行满页，两个边界（窗口最旧行 / 页顶最旧行）各切一轮。 */

/** 秒级严格递增时间戳（i 秒偏移；跨分钟进位由格式化保证唯一）。 */
function tsAt(base: string, i: number): string {
  const t = new Date(`2026-08-26T${base}Z`).getTime() + i * 1000;
  return new Date(t).toISOString().replace(/\.000Z$/, "Z");
}

function log(id: string, runId: string, timestamp: string, channel: string, text: string) {
  return { id, run_id: runId, timestamp, channel, content_redacted: text };
}

/** run-Z（会话最早轮）：提问 + 4 行输出（09:00:00–09:00:04）。 */
function runZFull() {
  return [
    log("z-0", "run-Z", tsAt("09:00:00", 0), "user_input", "Z 完整提问"),
    log("z-1", "run-Z", tsAt("09:00:00", 1), "stdout", "Z-输出-1"),
    log("z-2", "run-Z", tsAt("09:00:00", 2), "stdout", "Z-输出-2"),
    log("z-3", "run-Z", tsAt("09:00:00", 3), "stdout", "Z-输出-3"),
    log("z-4", "run-Z", tsAt("09:00:00", 4), "stdout", "Z-输出-4"),
  ];
}

/** run-A（跨窗口边界轮）：提问 + 399 行输出（09:30:00 起 400 行整轮）。 */
function runAFull() {
  const rows = [
    log("a-0", "run-A", tsAt("09:30:00", 0), "user_input", "A 完整提问"),
  ];
  for (let i = 1; i < 400; i += 1) {
    // 末 2 行（i=398/399）带「窗口尾部」标记——窗口侧旧块摘除断言锚点。
    const text = i >= 398 ? `A-窗口尾部-${i}` : `A-输出-${i}`;
    rows.push(log(`a-${i}`, "run-A", tsAt("09:30:00", i), "stdout", text));
  }
  return rows;
}

/** run-B（窗口内完整轮）：提问 + 397 行输出（10:00:00 起 398 行）。 */
function runBFull() {
  const rows = [
    log("b-0", "run-B", tsAt("10:00:00", 0), "user_input", "B 窗口提问"),
  ];
  for (let i = 1; i < 398; i += 1) {
    rows.push(log(`b-${i}`, "run-B", tsAt("10:00:00", i), "stdout", `B-输出-${i}`));
  }
  return rows;
}

/** 初始窗口 400 行 = run-A 末 2 行 + run-B 全 398 行（升序）。 */
function initialWindow() {
  const a = runAFull();
  return [...a.slice(398), ...runBFull()];
}

/** 翻页页 400 行（满页）= run-A 前 398 行 + run-Z 最新 2 行（升序）。 */
function olderPageFull() {
  const a = runAFull();
  const z = runZFull();
  return [...a.slice(0, 398), ...z.slice(3)];
}

function makeDetail(id: string) {
  return {
    id,
    runtime_id: null,
    lease_id: null,
    provider: "claude",
    status: "active",
    agent_session_id: `ag-${id}`,
    config: null,
    turn_count: 3,
    created_at: "t",
    last_active_at: null,
    ended_at: null,
    current_run_id: null,
    workspace_id: "ws-1",
    llm_provider_id: null,
    agent_profile_id: null,
    title: `会话${id}`,
    config_snapshot: null,
  };
}

function Host({ sessionId }: { sessionId: string; children?: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SessionPanel mode="page" sessionId={sessionId} machines={[]} llmProviders={[]} />
    </QueryClientProvider>
  );
}

/** mock 分流配置（每测试按需覆写）。 */
let olderPage: unknown[] = [];
let probePage: unknown[] = [];
/** run_id 直达响应表；值 null = 该轮请求 reject（失败降级用例）。 */
let directRunLogs: Record<string, unknown[] | null> = {};

beforeEach(() => {
  vi.clearAllMocks();
  olderPage = [];
  probePage = [];
  directRunLogs = {};
  sessionApi.getAgentSession.mockImplementation(async (sid: string) => makeDetail(sid));
  sessionApi.getAgentSessionLogs.mockImplementation(
    async (_sid: string, opts?: { runId?: string; before?: string; limit?: number }) => {
      if (opts?.runId) {
        const hit = directRunLogs[opts.runId];
        if (hit === null) return Promise.reject(new Error("直达失败"));
        return hit ?? [];
      }
      if (opts?.before && opts?.limit === 1) return probePage;
      if (opts?.before) return olderPage;
      return initialWindow();
    },
  );
  sessionApi.listSessionRuns.mockResolvedValue([]);
  sessionApi.streamSession.mockImplementation(() => ({
    close: vi.fn(),
    getLastEventId: () => null,
  }));
  sessionApi.fetchPendingDialogs.mockResolvedValue([]);
  sessionApi.fetchSessionDialogHistory.mockResolvedValue([]);
  sessionApi.listSessionTeamMissions.mockResolvedValue([]);
  sessionApi.fetchSessionQueue.mockResolvedValue([]);
});

/** 等初始历史渲染 + 触顶滚动（capture 监听挂 bodyWrap，jsdom 手动派发）。 */
async function scrollTimelineToTop() {
  await waitFor(() => {
    const el = document.querySelector('[data-testid="turn-timeline-scroll"]');
    expect(el).toBeTruthy();
    expect(screen.getAllByText(/A-窗口尾部-398/).length).toBeGreaterThan(0);
  });
  const el = document.querySelector('[data-testid="turn-timeline-scroll"]') as HTMLElement;
  el.scrollTop = 0;
  el.dispatchEvent(new Event("scroll"));
}

function callsWith(fn: ReturnType<typeof vi.fn>, pred: (_opts: unknown) => unknown) {
  return fn.mock.calls.filter((c) => Boolean(pred(c[1])));
}

/** 包含指定文本的 markdown 渲染元素列表——连续 stdout 行在装配层合并成单段
 *  （reply delta 直接 concat），行级 getByText 精确匹配失效；单显/双显判定
 *  改数「包含该文本的元素数」（合并段与独立段各算 1，摘块失败即 2）。 */
function markdownElsContaining(text: string) {
  return screen
    .getAllByTestId("markdown-text")
    .filter((el) => (el.textContent ?? "").includes(text));
}

describe("「加载更早」轮边界对齐（2026-10-13-load-earlier-full-turn）", () => {
  it("窗口跨界 + 页顶跨界轮直达整轮合并：提问出现、旧行单显、窗口同轮旧块被摘", async () => {
    olderPage = olderPageFull();
    // 探查（页顶最旧行 run-Z 之下的紧邻更早行）：同 run-Z → 页顶轮被切。
    probePage = [log("z-2", "run-Z", tsAt("09:00:00", 2), "stdout", "Z-输出-2")];
    directRunLogs = { "run-A": runAFull(), "run-Z": runZFull() };

    render(<Host sessionId="sess-A" />);
    await scrollTimelineToTop();

    await waitFor(() =>
      expect(callsWith(sessionApi.getAgentSessionLogs, (o) => (o as { runId?: string })?.runId).length)
        .toBeGreaterThanOrEqual(2),
    );
    // 整轮提问出现（修复前：提问段在更早页之上未加载，永不可见）。
    await waitFor(() => expect(screen.getByText("A 完整提问")).toBeTruthy());
    expect(screen.getByText("Z 完整提问")).toBeTruthy();
    // 窗口内 run-A 旧块已摘：直达整轮含末 2 行，文本单显不双条（摘块失败会 2 次）。
    expect(markdownElsContaining("A-窗口尾部-398").length).toBe(1);
    expect(markdownElsContaining("A-窗口尾部-399").length).toBe(1);
    // 翻页页内 run-A 行（已被整轮行替换）与 run-Z 页内行同样单显。
    expect(markdownElsContaining("A-输出-1").length).toBe(1);
    expect(markdownElsContaining("Z-输出-4").length).toBe(1);
    // run-B（窗口完整轮）不受影响。
    expect(screen.getByText("B 窗口提问")).toBeTruthy();
  });

  it("探查行属不同 run（页顶轮完整）→ 页顶不触发直达（仅窗口跨界轮直达）", async () => {
    olderPage = olderPageFull();
    // 探查返回不同 run（更早的独立轮）→ oldest 所在 run-Z 轮在页内完整。
    probePage = [log("x-0", "run-X", tsAt("08:00:00", 0), "stdout", "X-更早")];
    // 只配置窗口跨界轮 run-A 的直达响应——run-Z 若被误判页顶切轮会发
    // runId=run-Z 请求并拿空表，断言 runId 调用集合可抓到。
    directRunLogs = { "run-A": runAFull() };

    render(<Host sessionId="sess-A" />);
    await scrollTimelineToTop();

    // 页内内容照常渲染（run-Z 页内行 + run-A 整轮合并行）。
    await waitFor(() =>
      expect(markdownElsContaining("Z-输出-4").length).toBeGreaterThan(0),
    );
    await waitFor(() => expect(screen.getByText("A 完整提问")).toBeTruthy());
    // 直达只发给窗口跨界轮 run-A——页顶轮 run-Z 完整，不发 run-Z 直达。
    const directRuns = callsWith(
      sessionApi.getAgentSessionLogs,
      (o) => (o as { runId?: string })?.runId,
    ).map((c) => (c[1] as { runId: string }).runId);
    expect(directRuns).toEqual(["run-A"]);
  });

  it("直达失败 → 静默降级：当页原样 prepend，不报错不卡死", async () => {
    olderPage = olderPageFull();
    probePage = [log("z-2", "run-Z", tsAt("09:00:00", 2), "stdout", "Z-输出-2")];
    // 全部直达 reject → crossRuns 降级为空，当页行原样装配 prepend。
    directRunLogs = { "run-A": null, "run-Z": null };

    render(<Host sessionId="sess-A" />);
    await scrollTimelineToTop();

    await waitFor(() =>
      expect(callsWith(sessionApi.getAgentSessionLogs, (o) => (o as { runId?: string })?.runId).length)
        .toBeGreaterThanOrEqual(2),
    );
    // 当页内容照常渲染（现状分裂行为，内容不缺失）。
    await waitFor(() =>
      expect(markdownElsContaining("A-输出-1").length).toBeGreaterThan(0),
    );
    expect(markdownElsContaining("Z-输出-4").length).toBeGreaterThan(0);
    // 窗口内 run-A 旧块保留（未摘——直达失败不产生整轮替换）。
    expect(markdownElsContaining("A-窗口尾部-398").length).toBe(1);
  });

  it("不满页（到头）→ 不发探查请求，当页照常 prepend", async () => {
    // 只返回 2 行（< 400）：页顶轮必然完整（无更早行），不应有 limit=1 探查。
    olderPage = runZFull().slice(0, 2);

    render(<Host sessionId="sess-A" />);
    await scrollTimelineToTop();

    await waitFor(() => expect(screen.getByText("Z-输出-1")).toBeTruthy());
    expect(
      callsWith(
        sessionApi.getAgentSessionLogs,
        (o) => (o as { before?: string; limit?: number })?.limit === 1,
      ).length,
    ).toBe(0);
  });
});
