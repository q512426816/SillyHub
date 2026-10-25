// 2026-10-25-subagent-card-unify-panel（FR-02）：弹窗会话子代理卡片 → Drawer 详情。
// mock 面与 setupPanel 复制自 session-panel-dialog.test.tsx（同源惯例）；
// 本文件只覆盖：子代理卡片渲染（含内嵌流动条）→ 点击开 Drawer → toggle 关闭。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

import { SessionPanel } from "../session-panel";
import { useMentionSources } from "@/lib/session-mention-sources";
import type { SessionStreamConnection } from "@/lib/daemon";

vi.mock("@/lib/session-mention-sources", () => ({
  useMentionSources: vi.fn(),
}));
vi.mocked(useMentionSources);

vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

const sessionApi = vi.hoisted(() => ({
  getSessionUsage: vi.fn().mockResolvedValue(null),
  listSessionRuns: vi.fn().mockResolvedValue([]),
  listSessionTasks: vi.fn().mockResolvedValue([]),
  listScheduledMessages: vi.fn().mockResolvedValue([]),
  createSession: vi.fn(),
  injectSession: vi.fn(),
  interruptSession: vi.fn(),
  endSession: vi.fn(),
  streamSession: vi.fn(),
  getAgentSession: vi.fn().mockResolvedValue(null),
  getAgentSessionLogs: vi.fn(),
  fetchSessionTurnOutline: vi.fn(),
  fetchPendingDialogs: vi.fn(),
  fetchSessionDialogHistory: vi.fn(),
  listSessionTeamMissions: vi.fn(),
  triggerSessionTeamMission: vi.fn(),
  fetchSessionQueue: vi.fn(),
  deleteSessionQueueEntry: vi.fn(),
  retrySessionQueueEntry: vi.fn(),
}));

vi.mock("@/lib/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/lib/daemon")>("@/lib/daemon");
  return {
    ...actual,
    getSessionUsage: sessionApi.getSessionUsage,
    listSessionTasks: sessionApi.listSessionTasks,
    listScheduledMessages: sessionApi.listScheduledMessages,
    listSessionRuns: sessionApi.listSessionRuns,
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
    listSessionTeamMissions: sessionApi.listSessionTeamMissions,
    triggerSessionTeamMission: sessionApi.triggerSessionTeamMission,
    fetchSessionQueue: sessionApi.fetchSessionQueue,
    deleteSessionQueueEntry: sessionApi.deleteSessionQueueEntry,
    retrySessionQueueEntry: sessionApi.retrySessionQueueEntry,
  };
});

/* ----- fake SSE connection（同 session-panel-dialog.test.tsx） ----- */

interface FakeConnHandlers {
  onTurnStarted: (_env: any) => void;
  onLog: (_env: any, _cursor?: string | null) => void;
  onTurnCompleted: (_env: any) => void;
  onSessionEnded: (_env: any) => void;
  onError: (_err: Error) => void;
  onPermissionRequest: (_req: any) => void;
  onPermissionResolved: (_resolved: any) => void;
  route: (_env: any, _cursor?: string | null) => void;
}

interface FakeConn extends SessionStreamConnection {
  handlers: FakeConnHandlers;
  closeSpy: ReturnType<typeof vi.fn>;
}

function makeStreamMock(): { conn: FakeConn; factory: ReturnType<typeof vi.fn> } {
  let captured: FakeConn | null = null;
  const factory = vi.fn((_sessionId: string, handlers: any): FakeConn => {
    const closeSpy = vi.fn();
    captured = {
      close: closeSpy,
      getLastEventId: () => null,
      closeSpy,
      handlers: {
        onTurnStarted: (env: any) => handlers.onTurnStarted(env),
        onLog: (env: any, cursor?: string | null) => handlers.onLog(env, cursor ?? null),
        onTurnCompleted: (env: any) => handlers.onTurnCompleted(env),
        onSessionEnded: (env: any) => handlers.onSessionEnded(env),
        onError: (err: Error) => handlers.onError(err),
        onPermissionRequest: (req: any) => handlers.onPermissionRequest?.(req),
        onPermissionResolved: (resolved: any) =>
          handlers.onPermissionResolved?.(resolved),
        route: (env: any, cursor?: string | null) => {
          switch (env.event) {
            case "turn_started": handlers.onTurnStarted(env); break;
            case "log": handlers.onLog(env, cursor ?? null); break;
            case "turn_completed": handlers.onTurnCompleted(env); break;
            case "session_ended": handlers.onSessionEnded(env); break;
          }
        },
      },
    };
    return captured;
  });
  return {
    get conn() { return captured!; },
    factory,
  };
}

function makeEnvelope(event: string, overrides: Record<string, any> = {}): any {
  return {
    event,
    session_id: "sess-1",
    run_id: null,
    turn: null,
    log_id: null,
    timestamp: "t",
    channel: null,
    content: null,
    status: null,
    exit_code: null,
    reason: null,
    ...overrides,
  };
}

function setupPanel() {
  return render(
    <SessionPanel
      mode="dialog"
      sessionId={null}
      providers={["claude", "codex"]}
      defaultProvider="claude"
      model={null}
      onModelChange={vi.fn()}
      hasOnlineProvider
    />,
  );
}

/** 建立 SSE 并推入一个带 children 的子代理容器段（Task 工具 + 归属思考行）。 */
async function establishSubagentTurn(stream: { conn: FakeConn }) {
  const input = screen.getByPlaceholderText(/输入首条消息创建会话/) as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: "帮我调研" } });
  fireEvent.click(screen.getByTitle("发送"));
  await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalled());

  const conn = stream.conn;
  act(() => {
    conn.handlers.route(makeEnvelope("turn_started", { run_id: "run-1", turn: 1 }));
    conn.handlers.route(
      makeEnvelope("log", {
        run_id: "run-1",
        channel: "tool_call",
        content:
          '{"tool":"Task","args":{"description":"调研"},"tool_use_id":"tu_1","success":true}',
      }),
      "L1",
    );
    // 归属子代理的思考行 → parent_tool_use_id 路由进 tu_1 的 children。
    conn.handlers.route(
      makeEnvelope("log", {
        run_id: "run-1",
        channel: "stdout",
        content: "[THINKING] 子代理内部思考",
        parent_tool_use_id: "tu_1",
        subagent_type: "research",
      }),
      "L2",
    );
  });
}

describe("弹窗子代理卡片 Drawer 详情（2026-10-25-subagent-card-unify-panel）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 挂载即取数的 API 默认 resolve（裸 vi.fn() 返回 undefined 会被 .then 同步崩）。
    sessionApi.fetchPendingDialogs.mockResolvedValue([]);
    sessionApi.fetchSessionDialogHistory.mockResolvedValue([]);
    sessionApi.listSessionTeamMissions.mockResolvedValue([]);
    sessionApi.fetchSessionQueue.mockResolvedValue([]);
    sessionApi.getAgentSessionLogs.mockResolvedValue({ logs: [] });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("点击子代理卡片打开 Drawer 详情，再点关闭（FR-02）", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-1",
      run_id: "run-1",
      lease_id: "l",
      status: "active",
      stream_url: "",
    });
    setupPanel();

    await establishSubagentTurn(stream);

    // 子代理卡片渲染：头部 + 内嵌流动条（children 含思考 → 思考条目）。
    const card = await waitFor(() => {
      const el = document.querySelector('[data-segment-id="tu_1"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    const marquee = card.querySelector('[data-testid="subagent-live-marquee"]');
    expect(marquee?.textContent).toContain("子代理内部思考");

    // 点击卡片头部 → Drawer 打开，内嵌详情面板（头部 + children 时间线）。
    const header = card.querySelector('div[role="button"]') as HTMLElement;
    expect(header).not.toBeNull();
    fireEvent.click(header);
    // Drawer 头部与卡片头部同名「调研」→ 打开后同名文本 ≥ 2 处。
    await waitFor(() => {
      expect(screen.getAllByText("调研").length).toBeGreaterThanOrEqual(2);
    });
    // Drawer 详情含子代理内部过程（思考行；卡片流动条同名 → ≥ 2 处）。
    await waitFor(() => {
      expect(screen.getAllByText(/子代理内部思考/).length).toBeGreaterThanOrEqual(2);
    });

    // 再点同一卡片 → toggle 关闭（详情面板卸载，同名文本回落到仅卡片 1 处）。
    fireEvent.click(header);
    await waitFor(() => {
      expect(screen.getAllByText("调研").length).toBe(1);
    });
  });
});
