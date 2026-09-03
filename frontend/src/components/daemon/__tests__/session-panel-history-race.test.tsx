// ql-20260903-018：「加载更早」换会话竞态回归——请求在途切换会话时旧响应
// 必须丢弃（纪元归属校验），不得 prepend 进新会话时间线串台。
//
// mock 网络层模板同 session-panel-variant.test.tsx / session-panel-team.test.tsx。
// 覆盖：
//   1. 正向控制：翻页在途未切换会话 → 响应正常 prepend（守卫不误伤正常翻页）；
//   2. 竞态：翻页在途切换会话 → 旧会话响应被丢弃，新会话时间线无旧会话内容。
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
  fetchPendingDialogs: vi.fn(),
  fetchSessionDialogHistory: vi.fn(),
  listSessionRuns: vi.fn(),
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
    fetchPendingDialogs: sessionApi.fetchPendingDialogs,
    fetchSessionDialogHistory: sessionApi.fetchSessionDialogHistory,
    listSessionRuns: sessionApi.listSessionRuns,
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

/* ----- fixture ----- */

const HISTORY_PAGE_SIZE = 100;

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

/** 满页初始历史（≥ HISTORY_PAGE_SIZE → hasEarlier=true，触顶可翻页）。 */
function makeFullHistory(marker: string) {
  return Array.from({ length: HISTORY_PAGE_SIZE }, (_, i) => ({
    id: `log-${marker}-${i}`,
    run_id: `run-${marker}-${Math.floor(i / 2)}`,
    timestamp: `2026-08-26T10:00:${String(i % 60).padStart(2, "0")}.${i}Z`,
    channel: i % 2 === 0 ? "user_input" : "stdout",
    content_redacted: `${marker}-历史${i}`,
  }));
}

/** 更早页（旧会话翻页响应的载荷）。 */
function makeOlderPage(marker: string) {
  return Array.from({ length: 2 }, (_, i) => ({
    id: `log-old-${marker}-${i}`,
    run_id: `run-old-${marker}`,
    timestamp: `2026-08-26T09:00:0${i}.00000${i}Z`,
    channel: i % 2 === 0 ? "user_input" : "stdout",
    content_redacted: `${marker}-更早内容`,
  }));
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function Host({ sessionId }: { sessionId: string; children?: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SessionPanel mode="page" sessionId={sessionId} machines={[]} llmProviders={[]} />
    </QueryClientProvider>
  );
}

/** 旧会话翻页（before= 调用）挂起的受控 promise；null = 不拦截（返空页）。 */
let pendingOlder: {
  promise: Promise<unknown[]>;
  resolve: (v: unknown[]) => void;
} | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  pendingOlder = null;
  sessionApi.getAgentSession.mockImplementation(async (sid: string) => makeDetail(sid));
  sessionApi.getAgentSessionLogs.mockImplementation(
    async (_sid: string, opts?: { before?: string }) => {
      if (opts?.before && pendingOlder) return pendingOlder.promise;
      if (opts?.before) return [];
      // 初始历史按当前会话 id 分流。
      return _sid === "sess-A" ? makeFullHistory("A") : makeFullHistory("B");
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
    expect(screen.getAllByText(/-历史0$/).length).toBeGreaterThan(0);
  });
  const el = document.querySelector('[data-testid="turn-timeline-scroll"]') as HTMLElement;
  el.scrollTop = 0;
  el.dispatchEvent(new Event("scroll"));
}

describe("「加载更早」换会话竞态（ql-20260903-018）", () => {
  it("正向控制：翻页在途未切换会话 → 旧页正常 prepend", async () => {
    pendingOlder = deferred<unknown[]>();
    render(<Host sessionId="sess-A" />);
    await scrollTimelineToTop();

    await waitFor(() =>
      expect(
        sessionApi.getAgentSessionLogs.mock.calls.some((c) => c[1]?.before),
      ).toBe(true),
    );
    pendingOlder!.resolve(makeOlderPage("A"));
    await waitFor(() => expect(screen.getByText("A-更早内容")).toBeTruthy());
  });

  it("竞态：翻页在途切换会话 → 旧会话响应丢弃，不串进新会话时间线", async () => {
    pendingOlder = deferred<unknown[]>();
    const { rerender } = render(<Host sessionId="sess-A" />);
    await scrollTimelineToTop();

    await waitFor(() =>
      expect(
        sessionApi.getAgentSessionLogs.mock.calls.some((c) => c[1]?.before),
      ).toBe(true),
    );
    // 翻页在途：切到会话 B（effect 重置 turnState + 纪元 +1 + abort）。
    rerender(<Host sessionId="sess-B" />);
    await waitFor(() => expect(screen.getByText("B-历史0")).toBeTruthy());
    expect(screen.queryByText("A-历史0")).toBeNull();

    // A 的旧响应此刻才回来——必须被丢弃（修复前会 prepend 进 B 的时间线）。
    pendingOlder!.resolve(makeOlderPage("A"));
    // 给丢弃路径一个微任务屏障（若被误写入，waitFor 会抓到）。
    await waitFor(() => expect(screen.getByText("B-历史0")).toBeTruthy());
    expect(screen.queryByText("A-更早内容")).toBeNull();
    expect(screen.queryByText("A-历史0")).toBeNull();
  });
});
