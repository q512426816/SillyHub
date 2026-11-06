// 2026-11-06-fork-enter-navigate：分叉成功「进入 B」的导航行为测试。
//
// 用户需求（生产会话 0aa54089 事故会话的交互诉求）：分叉成功后直接跳转 B 的
// 会话页（URL 变化），不要 WorkerSessionOverlay 浮层。本文件固化三分支：
//   A. page 模式接 onNavigateToSession（门户接线形态）→ 调回调、零浮层；
//   B. page 模式未接（WorkerSessionOverlay 浮层内嵌等宿主）→ 回退既有浮层
//      进入 B（零回归锚点）；
//   C. dialog 模式未接 onNavigateToSession → fallback 整页跳全局门户
//      （window.location.assign，handleSwitchProvider 同款先例——避免十余个
//      dialog 测试文件被迫 vi.mock next/navigation）。
//
// 夹具骨架抄 session-history-scroll.test.tsx（page 模式网络层全 mock 的最简
// 形态）；分叉入口走真实 TurnForkEntry（provider=claude → native 档 + runs
// 快照 engine_anchor 非空 → 可点）。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { SessionPanel } from "../session-panel";

// MarkdownText 走 next/dynamic，jsdom 同步 render 为 null——mock 纯文本
// （session-panel-ctx-tokens.test.tsx 同款）。
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
  reopenSession: vi.fn(),
  streamSession: vi.fn(),
  getAgentSession: vi.fn(),
  getAgentSessionLogs: vi.fn(),
  fetchSessionTurnOutline: vi.fn(),
  fetchPendingDialogs: vi.fn(),
  fetchSessionDialogHistory: vi.fn(),
  listSessionRuns: vi.fn(),
  listSessionTasks: vi.fn().mockResolvedValue([]),
  listSessionTeamMissions: vi.fn(),
  triggerSessionTeamMission: vi.fn(),
  fetchSessionQueue: vi.fn(),
  deleteSessionQueueEntry: vi.fn(),
  retrySessionQueueEntry: vi.fn(),
  forkSession: vi.fn(),
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
    reopenSession: sessionApi.reopenSession,
    streamSession: sessionApi.streamSession,
    getAgentSession: sessionApi.getAgentSession,
    getAgentSessionLogs: sessionApi.getAgentSessionLogs,
    fetchSessionTurnOutline: sessionApi.fetchSessionTurnOutline,
    fetchPendingDialogs: sessionApi.fetchPendingDialogs,
    fetchSessionDialogHistory: sessionApi.fetchSessionDialogHistory,
    listSessionRuns: sessionApi.listSessionRuns,
    listSessionTasks: sessionApi.listSessionTasks,
    listSessionTeamMissions: sessionApi.listSessionTeamMissions,
    triggerSessionTeamMission: sessionApi.triggerSessionTeamMission,
    fetchSessionQueue: sessionApi.fetchSessionQueue,
    deleteSessionQueueEntry: sessionApi.deleteSessionQueueEntry,
    retrySessionQueueEntry: sessionApi.retrySessionQueueEntry,
    forkSession: sessionApi.forkSession,
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

vi.mock("@/lib/ppm/project", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ppm/project")>(
    "@/lib/ppm/project",
  );
  return { ...actual, listProjects: workspaceApi.listProjects };
});

vi.mock("@/lib/workspace", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspace")>(
    "@/lib/workspace",
  );
  return { ...actual, listProjectWorkspaces: workspaceApi.listProjectWorkspaces };
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

function makeDetail() {
  return {
    id: "sess-A",
    runtime_id: null,
    lease_id: null,
    provider: "claude",
    status: "active",
    agent_session_id: "ag-A",
    config: null,
    turn_count: 1,
    created_at: "t",
    last_active_at: null,
    ended_at: null,
    current_run_id: null,
    workspace_id: null,
    llm_provider_id: null,
    agent_profile_id: null,
    title: "分叉源会话",
    config_snapshot: null,
  };
}

const FORKED_RESP = {
  forked_session_id: "sess-forked-B",
  lease_id: null,
  run_id: null,
  tier: "native",
  lineage: { source_session_id: "sess-A", source_title: "分叉源会话", at_run_seq: 1 },
} as const;

function makeLogs() {
  return [
    {
      id: "log-1",
      run_id: "r-1",
      timestamp: "2026-11-06T10:00:00Z",
      channel: "user_input",
      content_redacted: "第一问",
    },
    {
      id: "log-2",
      run_id: "r-1",
      timestamp: "2026-11-06T10:00:05Z",
      channel: "stdout",
      content_redacted: "第一答",
    },
  ];
}

function Host({
  onNavigateToSession,
}: {
  onNavigateToSession?: (sessionId: string, workspaceId: string | null) => void;
  children?: ReactNode;
}) {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SessionPanel
        mode="page"
        sessionId="sess-A"
        machines={[]}
        llmProviders={[]}
        onNavigateToSession={onNavigateToSession}
      />
    </QueryClientProvider>
  );
}

/** 走完「点⑂ → 确认弹层 → 点创建」链，直到 forkSession resolve。 */
async function confirmFork(): Promise<void> {
  const entry = await screen.findByTestId("turn-fork-entry");
  expect((entry as HTMLButtonElement).disabled).toBe(false);
  await act(async () => {
    fireEvent.click(entry);
  });
  const confirmBtn = await screen.findByRole("button", { name: "创建分叉并进入" });
  await act(async () => {
    fireEvent.click(confirmBtn);
  });
  await waitFor(() => expect(sessionApi.forkSession).toHaveBeenCalledTimes(1));
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionApi.getAgentSession.mockResolvedValue(makeDetail());
  sessionApi.getAgentSessionLogs.mockResolvedValue(makeLogs());
  sessionApi.fetchSessionTurnOutline.mockResolvedValue({
    session_id: "sess-A",
    total_turns: 1,
    items: [],
  });
  // runs 快照带 engine_anchor（forkEngineAnchors 数据源）→ native 档⑂可点。
  // 字段补全对齐 SessionRunRead（enrichOne 读 meta.error_detail 等键，缺键崩）。
  sessionApi.listSessionRuns.mockResolvedValue([
    {
      id: "r-1",
      created_at: "2026-11-06T10:00:00Z",
      status: "completed",
      engine_anchor: "u-anchor-1",
      error_code: null,
      failure_summary: null,
      error_detail: null,
      started_at: "2026-11-06T10:00:00Z",
      finished_at: "2026-11-06T10:00:10Z",
      exit_code: 0,
      agent_profile_snapshot: null,
      llm_provider_id: null,
      input_tokens: null,
      output_tokens: null,
      ctx_tokens: null,
      user_id: null,
      sender_name: null,
    },
  ]);
  sessionApi.streamSession.mockImplementation(() => ({
    close: vi.fn(),
    getLastEventId: () => null,
  }));
  sessionApi.fetchPendingDialogs.mockResolvedValue([]);
  sessionApi.fetchSessionDialogHistory.mockResolvedValue([]);
  sessionApi.listSessionTeamMissions.mockResolvedValue([]);
  sessionApi.fetchSessionQueue.mockResolvedValue([]);
  sessionApi.forkSession.mockResolvedValue(FORKED_RESP);
  workspaceApi.listWorkspaces.mockResolvedValue({ items: [] });
  workspaceApi.listProjects.mockResolvedValue([]);
  workspaceApi.listProjectWorkspaces.mockResolvedValue([]);
});

describe("fork-enter-navigate：分叉成功进入 B 的导航三分支", () => {
  it("A. page 模式接 onNavigateToSession（门户接线）→ 调回调切选中，不弹浮层", async () => {
    const onNavigateToSession = vi.fn();
    render(<Host onNavigateToSession={onNavigateToSession} />);

    await confirmFork();

    // 回调收到 B 的 id + 源会话 workspace_id（门户据此切选中/写 ?session=）。
    await waitFor(() =>
      expect(onNavigateToSession).toHaveBeenCalledWith("sess-forked-B", null),
    );
    // 不弹浮层（WorkerSessionOverlay 的 data-overlay-title 不出现）。
    expect(document.querySelector("[data-overlay-title]")).toBeNull();
  });

  it("B. page 模式未接回调（浮层内嵌宿主）→ 回退既有浮层进入 B（零回归）", async () => {
    render(<Host />);

    await confirmFork();

    const overlay = await waitFor(() => {
      const el = document.querySelector('[data-overlay-title="分叉会话"]');
      expect(el).toBeTruthy();
      return el;
    });
    expect(overlay).toBeTruthy();
  });

  it("C. dialog 模式未接回调 → fallback 整页跳全局门户（?session=B，无浮层）", async () => {
    // jsdom window.location.assign 未实现（调用抛 Not implemented）——defineProperty
    // 替换为 spy，用例后恢复原对象。
    const assignSpy = vi.fn();
    const origLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...origLocation, assign: assignSpy },
    });
    try {
      render(
        <SessionPanel
          mode="dialog"
          sessionId="sess-A"
          providers={["claude"]}
          defaultProvider="claude"
          model={null}
          onModelChange={vi.fn()}
          hasOnlineProvider
          initialTurns={[
            {
              runId: "r-1",
              turn: 1,
              prompt: "第一问",
              output: "第一答",
              status: "completed",
              seenLogIds: new Set<string>(),
              inputTokens: null,
              outputTokens: null,
            },
          ]}
          onSessionCreated={vi.fn()}
          onSessionReset={vi.fn()}
        />,
      );

      await confirmFork();

      // fallback：整页跳全局门户，深链 ?session=B（门户深链自动解析 B 的
      // workspace_id 过滤）；不弹浮层。
      await waitFor(() =>
        expect(assignSpy).toHaveBeenCalledWith("/sessions?session=sess-forked-B"),
      );
      expect(document.querySelector("[data-overlay-title]")).toBeNull();
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: origLocation,
      });
    }
  });
});
