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
    // 上一行已断言 length===3，noUncheckedIndexedAccess 下索引访问为 string|undefined，非空断言仅过类型不逻辑。
    expect(new Date(beforeCursors[1]!).getTime()).toBeLessThan(new Date(beforeCursors[0]!).getTime());
    expect(new Date(beforeCursors[2]!).getTime()).toBeLessThan(new Date(beforeCursors[1]!).getTime());
  });

  // ── task-07（2026-09-16-logs-cursor-tiebreaker）：(ts,id) 复合游标翻页行为 ──
  // 依据 session-panel-page.tsx：初始加载写点（logs[0] 双分量同点写）、翻页
  // 请求 beforeId 透传、游标前进取 older[0]、pageKey 含 older[0].id 前 8 位、
  // 换会话 effect 双清；sessions.ts before_id 仅与 before 同传。

  it("first loadEarlier sends composite cursor: before=oldest ts and beforeId=oldest row id of initial window (task-07)", async () => {
    const initPage = makePage("init", PAGE_SIZE, 13 * 3600);
    sessionApi.getAgentSessionLogs.mockImplementation(
      async (_sid: string, opts?: { before?: string; beforeId?: string }) => {
        if (opts?.before) return makePage("older", PAGE_SIZE, 0);
        return initPage;
      },
    );
    render(<Host sessionId="s4" />);
    await waitFor(() => expect(screen.getAllByText(/init-msg/).length).toBeGreaterThan(0));
    await scrollTimelineToTop();
    await waitFor(() => {
      const beforeCall = sessionApi.getAgentSessionLogs.mock.calls.find(
        (c) => (c[1] as { before?: string } | undefined)?.before,
      );
      expect(beforeCall).toBeTruthy();
      const opts = (beforeCall?.[1] ?? {}) as { before?: string; beforeId?: string };
      // ts 分量 = 初始窗口最旧行（logs[0]）timestamp；id 分量 = 同一行 id——
      // 复合游标同点派生（漏设 id 写点则 beforeId=undefined 走后端旧 <= 分支）。
      expect(opts.before).toBe(initPage[0]!.timestamp);
      expect(opts.beforeId).toBe(initPage[0]!.id);
    });
    await waitFor(() => expect(screen.getAllByText(/older-msg/).length).toBeGreaterThan(0));
  });

  it("same-ts full pages progress via beforeId: two loadEarlier requests prepend both pages, pageKey id suffix avoids key collision (task-07)", async () => {
    // 同 ts 满 100 行批跨页（修复场景）：ts 游标无法推进，靠 id 分量逐页递进。
    // uuid 递减模拟——同格式定长字符串字典序即 id 序（对齐后端 id<before_id）。
    const SAME_TS = "2026-08-26T12:00:00.000Z";
    const uuidAt = (seq: number) =>
      `${String(seq).padStart(8, "0")}-0000-4000-8000-000000000000`;
    const sameTsPage = (marker: string, seq: number) =>
      Array.from({ length: PAGE_SIZE }, (_, i) => ({
        id: `${uuidAt(seq)}-${i}`,
        run_id: `run-${marker}-${Math.floor(i / 5)}`,
        timestamp: SAME_TS,
        channel: i % 5 === 0 ? "user_input" : "stdout",
        content_redacted: `${marker}-msg${i}`,
      }));
    const initPage = sameTsPage("init", 5000);
    const older1 = sameTsPage("o1", 4900);
    const older2 = sameTsPage("o2", 4800);
    const beforeIds: string[] = [];
    sessionApi.getAgentSessionLogs.mockImplementation(
      async (_sid: string, opts?: { before?: string; beforeId?: string }) => {
        if (!opts?.before) return initPage;
        beforeIds.push(opts.beforeId ?? "");
        return beforeIds.length === 1 ? older1 : older2;
      },
    );
    // React 重复 key 告警 spy（pageKey 撞 key 的可达观测面——ts 数字串同值时
    // 仅 id 前 8 位后缀能区分两页，对齐 page.test.tsx m- 用例手法）。
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(<Host sessionId="s5" />);
      await waitFor(() => expect(screen.getAllByText(/init-msg/).length).toBeGreaterThan(0));
      for (let i = 0; i < 2; i++) {
        await scrollTimelineToTop();
        await waitFor(() => expect(beforeIds.length).toBe(i + 1), { timeout: 5000 });
      }
      // beforeId 递进：首翻 = 初始窗口最旧行 id；第二翻 = 第一更早页首行 id
      //（同 ts 下 ts 分量不动、仅 id 前进；uuid 递减模拟 → 字典序更小）。
      expect(beforeIds[0]).toBe(initPage[0]!.id);
      expect(beforeIds[1]).toBe(older1[0]!.id);
      expect(beforeIds[1]! < beforeIds[0]!).toBe(true);
      // 两页均正常 prepend（loadEarlier 路径不因 ts 停滞丢页）。
      expect(screen.getAllByText(/o1-msg/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/o2-msg/).length).toBeGreaterThan(0);
      const dupKeyErrors = errSpy.mock.calls.filter(
        (args) => typeof args[0] === "string" && args[0].includes("same key"),
      );
      expect(dupKeyErrors).toHaveLength(0);
    } finally {
      errSpy.mockRestore();
    }
  });

  it("session switch resets composite cursor: first loadEarlier on new session uses its own oldest id, not stale residue (task-07)", async () => {
    const s5Init = makePage("old-s", PAGE_SIZE, 13 * 3600);
    const s5Older = makePage("old-so", PAGE_SIZE, 11 * 3600);
    const s6Init = makePage("new-s", PAGE_SIZE, 10 * 3600);
    sessionApi.getAgentSessionLogs.mockImplementation(
      async (sid: string, opts?: { before?: string }) => {
        if (!opts?.before) return sid === "s5" ? s5Init : s6Init;
        // s5 翻页返回更早页（让游标前进产生残留源）；s6 翻页返回空（断言只看
        // 请求参数，不依赖响应内容）。
        return sid === "s5" ? s5Older : [];
      },
    );
    // 同一 QueryClient + 同组件实例换 sessionId prop（index.tsx 无 key 重挂，
    // 走换会话重置 effect 而非 remount）。
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const hostOf = (sid: string) => (
      <QueryClientProvider client={client}>
        <SessionPanel mode="page" sessionId={sid} machines={[]} llmProviders={[]} />
      </QueryClientProvider>
    );
    const view = render(hostOf("s5"));
    await waitFor(() => expect(screen.getAllByText(/old-s-msg/).length).toBeGreaterThan(0));
    // 旧会话先翻一页：游标二元组前进到 older 页首行（潜在残留）。
    await scrollTimelineToTop();
    await waitFor(() => expect(screen.getAllByText(/old-so-msg/).length).toBeGreaterThan(0));
    // 切会话：双清生效 → 新会话首翻取新会话初始窗口 logs[0] 二元组。
    view.rerender(hostOf("s6"));
    await waitFor(() => expect(screen.getAllByText(/new-s-msg/).length).toBeGreaterThan(0));
    await scrollTimelineToTop();
    await waitFor(() => {
      const beforeCall = sessionApi.getAgentSessionLogs.mock.calls.find(
        (c) => c[0] === "s6" && (c[1] as { before?: string } | undefined)?.before,
      );
      expect(beforeCall).toBeTruthy();
      const opts = (beforeCall?.[1] ?? {}) as { before?: string; beforeId?: string };
      expect(opts.before).toBe(s6Init[0]!.timestamp);
      expect(opts.beforeId).toBe(s6Init[0]!.id);
      expect(opts.beforeId).not.toBe(s5Older[0]!.id);
    });
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
