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
  injectSession: vi.fn(), interruptSession: vi.fn(), endSession: vi.fn(),
  streamSession: vi.fn(), getAgentSession: vi.fn(), getAgentSessionLogs: vi.fn(),
  fetchPendingDialogs: vi.fn(), fetchSessionDialogHistory: vi.fn(),
  listSessionRuns: vi.fn(), listSessionTasks: vi.fn().mockResolvedValue([]),
  listSessionTeamMissions: vi.fn(), fetchSessionQueue: vi.fn(),
}));

vi.mock("@/lib/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/lib/daemon")>("@/lib/daemon");
  return { ...actual, ...Object.fromEntries(Object.entries(sessionApi).map(([k,v]) => [k,v])) };
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

const PAGE_SIZE = 100;
function makeDetail(id: string) {
  return { id, runtime_id: null, lease_id: null, provider: "claude", status: "active",
    agent_session_id: `ag-${id}`, config: null, turn_count: 3, created_at: "t",
    last_active_at: null, ended_at: null, current_run_id: null, workspace_id: "ws-1",
    llm_provider_id: null, agent_profile_id: null, title: `S${id}`, config_snapshot: null };
}
function makePage(marker: string, count: number, startSec: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `log-${marker}-${i}`, run_id: `run-${marker}-${Math.floor(i / 5)}`,
    timestamp: `2026-08-26T${String(10 + Math.floor(startSec / 3600)).padStart(2, "0")}:${String(Math.floor(startSec / 60) % 60).padStart(2, "0")}:${String((startSec + i) % 60).padStart(2, "0")}.${i}Z`,
    channel: i % 5 === 0 ? "user_input" : "stdout", content_redacted: `${marker}-msg${i}`,
  }));
}
function Host({ sessionId }: { sessionId: string; children?: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SessionPanel mode="page" sessionId={sessionId} machines={[]} llmProviders={[]} />
    </QueryClientProvider>
  );
}
async function scrollTimelineToTop() {
  await waitFor(() => {
    const el = document.querySelector('[data-testid="turn-timeline-scroll"]');
    expect(el).toBeTruthy();
  });
  const el = document.querySelector('[data-testid="turn-timeline-scroll"]') as HTMLElement;
  el.scrollTop = 0;
  el.dispatchEvent(new Event("scroll"));
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
});

describe("scroll-up history integration", () => {
  it("scroll to top triggers loadEarlier with before cursor, older content prepends", async () => {
    sessionApi.getAgentSessionLogs.mockImplementation(
      async (_sid: string, opts?: { before?: string }) => {
        if (opts?.before) return makePage("older", PAGE_SIZE, 0);
        return makePage("init", PAGE_SIZE, 13 * 3600);
      },
    );
    render(<Host sessionId="s1" />);
    await waitFor(() => expect(screen.getAllByText(/init-msg/).length).toBeGreaterThan(0));
    await scrollTimelineToTop();
    await waitFor(() =>
      expect(sessionApi.getAgentSessionLogs.mock.calls.some((c) => c[1]?.before)).toBe(true),
    );
    await waitFor(() => expect(screen.getAllByText(/older-msg/).length).toBeGreaterThan(0));
  });

  it("3 consecutive scroll-to-top = 1 initial + 3 before calls, cursor monotonically decreases", async () => {
    const beforeCursors: string[] = [];
    sessionApi.getAgentSessionLogs.mockImplementation(
      async (_sid: string, opts?: { before?: string }) => {
        if (opts?.before) {
          beforeCursors.push(opts.before);
          // 每页比上一页早 1 小时（简单固定递减，不做 epoch 换算）
          const hour = 12 - beforeCursors.length; // 11, 10, 9 (earlier than initial's 13)
          return makePage(`p${beforeCursors.length}`, PAGE_SIZE, hour * 3600);
        }
        return makePage("init", PAGE_SIZE, 13 * 3600);
      },
    );
    render(<Host sessionId="s2" />);
    await waitFor(() => expect(screen.getAllByText(/init-msg/).length).toBeGreaterThan(0));
    for (let i = 0; i < 3; i++) {
      await scrollTimelineToTop();
      await waitFor(() => expect(beforeCursors.length).toBe(i + 1), { timeout: 5000 });
    }
    expect(beforeCursors.length).toBe(3);
    expect(new Date(beforeCursors[1]).getTime()).toBeLessThan(new Date(beforeCursors[0]).getTime());
    expect(new Date(beforeCursors[2]).getTime()).toBeLessThan(new Date(beforeCursors[1]).getTime());
  });

  it("scroll container has overflowAnchor=none (double-anchoring fix)", async () => {
    sessionApi.getAgentSessionLogs.mockResolvedValue(makePage("anc", 20, 0));
    render(<Host sessionId="s3" />);
    await waitFor(() => {
      const el = document.querySelector('[data-testid="turn-timeline-scroll"]');
      expect(el).toBeTruthy();
    });
    const el = document.querySelector('[data-testid="turn-timeline-scroll"]') as HTMLElement;
    expect(el.style.overflowAnchor).toBe("none");
  });
});
