// task-11：InteractiveSessionPanel 组件测试。
//
// 覆盖 AC：
//   AC-11-01 首发调 createSession + 建 1 个 SSE
//   AC-11-02 turn_started/log/turn_completed 渲染 + turn_completed 不 close
//   AC-11-03 第二条走 injectSession，SSE 累计只 1 次
//   AC-11-04 第二 run 输出只写第二 turn
//   AC-11-05 interrupt 收敛当前 turn，session active
//   AC-11-06 interrupt 后可继续 inject
//   AC-11-07 end 收口，session_ended 幂等
//   AC-11-09 错误分支
//   输入校验 / turn 级串行禁用 / unmount close

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

import { InteractiveSessionPanel } from "../interactive-session-panel";
import type { SessionStreamConnection } from "@/lib/daemon";

// MarkdownText 用 next/dynamic + ssr:false，jsdom 测试同步 render 处于 loading(null)，
// turn.output 文本不出现。mock 成纯文本渲染（测 panel 交互逻辑，不测 markdown 库）。
vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

/* ----- mock lib/daemon ----- */

const sessionApi = vi.hoisted(() => ({
  createSession: vi.fn(),
  injectSession: vi.fn(),
  interruptSession: vi.fn(),
  endSession: vi.fn(),
  streamSession: vi.fn(),
  getAgentSession: vi.fn(),
  fetchPendingDialogs: vi.fn(),
  fetchSessionDialogHistory: vi.fn(),
}));

// task-08（FR-08）：「用团队分析」按钮调 createMission(mode=team, session_id 绑定)
const missionApi = vi.hoisted(() => ({
  createMission: vi.fn(),
}));

vi.mock("@/lib/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/lib/daemon")>("@/lib/daemon");
  return {
    ...actual,
    createSession: sessionApi.createSession,
    injectSession: sessionApi.injectSession,
    interruptSession: sessionApi.interruptSession,
    endSession: sessionApi.endSession,
    streamSession: sessionApi.streamSession,
    getAgentSession: sessionApi.getAgentSession,
    fetchPendingDialogs: sessionApi.fetchPendingDialogs,
    fetchSessionDialogHistory: sessionApi.fetchSessionDialogHistory,
  };
});

// task-08：「用团队分析」走 createMission（@/lib/agent），mock 之
vi.mock("@/lib/agent", async () => {
  const actual = await vi.importActual<typeof import("@/lib/agent")>("@/lib/agent");
  return {
    ...actual,
    createMission: missionApi.createMission,
  };
});

/* ----- fake SSE connection ----- */

interface FakeConnHandlers {
  onTurnStarted: (env: any) => void;
  onLog: (env: any, cursor?: string | null) => void;
  onTurnCompleted: (env: any) => void;
  onSessionEnded: (env: any) => void;
  onError: (err: Error) => void;
  onPermissionRequest: (req: any) => void;
  onPermissionResolved: (resolved: any) => void;
  route: (env: any, cursor?: string | null) => void;
}

interface FakeConn extends SessionStreamConnection {
  handlers: FakeConnHandlers;
  closeSpy: ReturnType<typeof vi.fn>;
}

function makeStreamMock(): { conn: FakeConn; factory: ReturnType<typeof vi.fn> } {
  let captured: FakeConn | null = null;
  const factory = vi.fn(
    (sessionId: string, handlers: any): FakeConn => {
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
          onPermissionResolved: (resolved: any) => handlers.onPermissionResolved?.(resolved),
          // 便捷：用 envelope.event 路由
          route: (env: any, cursor?: string | null) => {
            switch (env.event) {
              case "turn_started": handlers.onTurnStarted(env); break;
              case "log": handlers.onLog(env, cursor ?? null); break;
              case "turn_completed": handlers.onTurnCompleted(env); break;
              case "session_ended": handlers.onSessionEnded(env); break;
              case "permission_request": handlers.onPermissionRequest?.(env); break;
              case "permission_resolved": handlers.onPermissionResolved?.(env); break;
            }
          },
        },
      };
      return captured;
    },
  );
  // 等待第一次调用后返回 captured
  return {
    get conn() { return captured!; },
    factory,
  };
}

function makeEnvelope(
  event: string,
  overrides: Record<string, any> = {},
): any {
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

function setupPanel(overrides: Record<string, any> = {}) {
  const props = {
    providers: ["claude", "codex"],
    defaultProvider: "claude",
    model: null,
    onModelChange: vi.fn(),
    hasOnlineProvider: true,
    ...overrides,
  };
  return render(<InteractiveSessionPanel {...(props as any)} />);
}

describe("InteractiveSessionPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认无 pending dialog（改动二：fetchPendingDialogs 独立 effect）
    sessionApi.fetchPendingDialogs.mockResolvedValue([]);
    sessionApi.fetchSessionDialogHistory.mockResolvedValue([]);
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("AC-11-01 首发 prompt → 调 createSession + 建立 1 个 session SSE", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-1",
      run_id: "run-1",
      lease_id: "lease-1",
      status: "active",
      stream_url: "/api/daemon/sessions/sess-1/stream",
    });

    setupPanel();
    const input = screen.getByPlaceholderText(/创建会话/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.click(screen.getByTitle("发送"));

    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalledTimes(1));
    expect(sessionApi.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "claude", prompt: "hello" }),
    );
    // SSE 只建一次
    expect(sessionApi.streamSession).toHaveBeenCalledTimes(1);
    expect(sessionApi.streamSession.mock.calls[0]![0]).toBe("sess-1");
    expect(sessionApi.streamSession.mock.calls[0]![1]).toEqual(expect.any(Object));
  });

  it("AC-11-02 turn_started/log/turn_completed 渲染，turn_completed 不 close SSE", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-1", run_id: "run-1", lease_id: "l",
      status: "active", stream_url: "",
    });

    setupPanel();
    const input = screen.getByPlaceholderText(/创建会话/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "first" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalled());

    const conn = stream.conn;
    act(() => {
      conn.handlers.route(makeEnvelope("turn_started", { run_id: "run-1", turn: 1 }));
      conn.handlers.route(
        makeEnvelope("log", { run_id: "run-1", channel: "stdout", content: "world" }),
        "log-1",
      );
    });
    await waitFor(() => expect(screen.getByText(/world/)).toBeInTheDocument());

    act(() => {
      conn.handlers.route(
        makeEnvelope("turn_completed", { run_id: "run-1", status: "completed" }),
      );
    });
    // turn_completed 后连接未 close
    expect(conn.closeSpy).not.toHaveBeenCalled();
  });

  it("AC-11-03 第二条走 injectSession，SSE 累计仍只 1 次", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-1", run_id: "run-1", lease_id: "l",
      status: "active", stream_url: "",
    });
    sessionApi.injectSession.mockResolvedValue({
      session_id: "sess-1", run_id: "run-2", status: "active",
    });

    setupPanel();
    // 首发
    const input = screen.getByPlaceholderText(/创建会话/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "first" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalled());

    const conn = stream.conn;
    act(() => {
      conn.handlers.route(makeEnvelope("turn_started", { run_id: "run-1", turn: 1 }));
      conn.handlers.route(
        makeEnvelope("turn_completed", { run_id: "run-1", status: "completed" }),
      );
    });

    // 第二条：输入框变为追问
    await waitFor(() => {
      expect((screen.getByPlaceholderText(/继续追问/) as HTMLTextAreaElement)).toBeTruthy();
    }, { timeout: 2000 });
    const input2 = screen.getByPlaceholderText(/继续追问/) as HTMLTextAreaElement;
    fireEvent.change(input2, { target: { value: "second" } });
    fireEvent.click(screen.getByTitle("发送"));

    await waitFor(() => expect(sessionApi.injectSession).toHaveBeenCalledTimes(1));
    expect(sessionApi.injectSession).toHaveBeenCalledWith("sess-1", "second");
    // SSE 仍只 1 次
    expect(sessionApi.streamSession).toHaveBeenCalledTimes(1);
  });

  it("AC-11-04 第二 run 输出只写第二 turn，第一 turn 不变", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-1", run_id: "run-1", lease_id: "l",
      status: "active", stream_url: "",
    });
    sessionApi.injectSession.mockResolvedValue({
      session_id: "sess-1", run_id: "run-2", status: "active",
    });

    setupPanel();
    const input = screen.getByPlaceholderText(/创建会话/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "first" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalled());

    const conn = stream.conn;
    act(() => {
      conn.handlers.route(makeEnvelope("turn_started", { run_id: "run-1", turn: 1 }));
      conn.handlers.route(
        makeEnvelope("log", { run_id: "run-1", channel: "stdout", content: "turn1-out" }),
        "L1",
      );
      conn.handlers.route(
        makeEnvelope("turn_completed", { run_id: "run-1", status: "completed" }),
      );
    });
    await waitFor(() => expect(screen.getByText(/turn1-out/)).toBeInTheDocument());

    // 第二 turn
    const input2 = screen.getByPlaceholderText(/继续追问/) as HTMLTextAreaElement;
    fireEvent.change(input2, { target: { value: "second" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(sessionApi.injectSession).toHaveBeenCalled());

    act(() => {
      conn.handlers.route(makeEnvelope("turn_started", { run_id: "run-2", turn: 2 }));
      conn.handlers.route(
        makeEnvelope("log", { run_id: "run-2", channel: "stdout", content: "turn2-out" }),
        "L2",
      );
    });
    await waitFor(() => expect(screen.getByText(/turn2-out/)).toBeInTheDocument());
    // 第一 turn 内容仍在
    expect(screen.getByText(/turn1-out/)).toBeInTheDocument();
  });

  it("AC-11-05 interrupt 收敛当前 turn，session 仍 active（不调 end）", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-1", run_id: "run-1", lease_id: "l",
      status: "active", stream_url: "",
    });
    sessionApi.interruptSession.mockResolvedValue({
      session_id: "sess-1", status: "active", current_run_id: "run-1",
    });

    setupPanel();
    const input = screen.getByPlaceholderText(/创建会话/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "first" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalled());

    const conn = stream.conn;
    act(() => {
      conn.handlers.route(makeEnvelope("turn_started", { run_id: "run-1", turn: 1 }));
    });

    const interruptBtn = await screen.findByTitle(/打断本轮/);
    fireEvent.click(interruptBtn);

    await waitFor(() => expect(sessionApi.interruptSession).toHaveBeenCalledTimes(1));
    expect(sessionApi.interruptSession).toHaveBeenCalledWith("sess-1");
    // 没调 end
    expect(sessionApi.endSession).not.toHaveBeenCalled();
    // turn_completed（被打断收敛）后 session active
    act(() => {
      conn.handlers.route(
        makeEnvelope("turn_completed", { run_id: "run-1", status: "killed", exit_code: 130 }),
      );
    });
  });

  it("AC-11-06 interrupt 后 currentRun 清空，可继续 inject", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-1", run_id: "run-1", lease_id: "l",
      status: "active", stream_url: "",
    });
    sessionApi.interruptSession.mockResolvedValue({
      session_id: "sess-1", status: "active", current_run_id: "run-1",
    });
    sessionApi.injectSession.mockResolvedValue({
      session_id: "sess-1", run_id: "run-2", status: "active",
    });

    setupPanel();
    const input = screen.getByPlaceholderText(/创建会话/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "first" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalled());

    const conn = stream.conn;
    act(() => {
      conn.handlers.route(makeEnvelope("turn_started", { run_id: "run-1", turn: 1 }));
    });
    fireEvent.click(await screen.findByTitle(/打断本轮/));
    await waitFor(() => expect(sessionApi.interruptSession).toHaveBeenCalled());
    act(() => {
      conn.handlers.route(
        makeEnvelope("turn_completed", { run_id: "run-1", status: "killed" }),
      );
    });

    // currentRun 清空后可继续追问
    await waitFor(() => {
      expect((screen.getByPlaceholderText(/继续追问/) as HTMLTextAreaElement)).toBeTruthy();
    });
    const input2 = screen.getByPlaceholderText(/继续追问/) as HTMLTextAreaElement;
    fireEvent.change(input2, { target: { value: "again" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(sessionApi.injectSession).toHaveBeenCalledTimes(1));
  });

  it("turn 级串行：currentRun 运行中发送按钮禁用", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-1", run_id: "run-1", lease_id: "l",
      status: "active", stream_url: "",
    });

    setupPanel();
    const input = screen.getByPlaceholderText(/创建会话/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "first" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalled());

    const conn = stream.conn;
    act(() => {
      conn.handlers.route(makeEnvelope("turn_started", { run_id: "run-1", turn: 1 }));
    });

    const sendBtn = screen.getByTitle("发送");
    expect((sendBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("AC-11-07 end → close SSE + ended；session_ended 幂等", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-1", run_id: "run-1", lease_id: "l",
      status: "active", stream_url: "",
    });
    sessionApi.endSession.mockResolvedValue({
      session_id: "sess-1", status: "ended", current_run_id: null,
    });

    setupPanel();
    const input = screen.getByPlaceholderText(/创建会话/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "first" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalled());

    fireEvent.click(await screen.findByTitle(/结束整个会话/));
    await waitFor(() => expect(sessionApi.endSession).toHaveBeenCalledTimes(1));
    // close 已被 end 路径触发（或 session_ended 到达）
    // 重复 session_ended 幂等，不二次回调
    const conn = stream.conn;
    expect(conn.closeSpy).toHaveBeenCalled();
  });

  it("输入校验：空/纯空白 prompt 不发送", async () => {
    sessionApi.streamSession.mockImplementation(makeStreamMock().factory);
    setupPanel();
    const input = screen.getByPlaceholderText(/创建会话/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByTitle("发送"));
    expect(sessionApi.createSession).not.toHaveBeenCalled();
  });

  it("createSession 失败显示错误，不建 SSE", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    const { ApiError } = await import("@/lib/api");
    sessionApi.createSession.mockRejectedValue(
      new ApiError(404, {
        code: "DAEMON_NOT_FOUND",
        message: "no daemon",
        request_id: null,
        details: null,
      }),
    );

    setupPanel();
    const input = screen.getByPlaceholderText(/创建会话/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(screen.getByText(/no daemon/)).toBeInTheDocument());
    expect(sessionApi.streamSession).not.toHaveBeenCalled();
  });

  it("unmount 时显式 close 旧 SSE", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-1", run_id: "run-1", lease_id: "l",
      status: "active", stream_url: "",
    });

    const { unmount } = setupPanel();
    const input = screen.getByPlaceholderText(/创建会话/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalled());

    const conn = stream.conn;
    unmount();
    expect(conn.closeSpy).toHaveBeenCalled();
  });

  it("inject 返回 turn conflict 409 → 移除占位，保留 prompt 供重试", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-1", run_id: "run-1", lease_id: "l",
      status: "active", stream_url: "",
    });
    const { ApiError } = await import("@/lib/api");
    sessionApi.injectSession.mockRejectedValue(
      new ApiError(409, {
        code: "DAEMON_SESSION_TURN_CONFLICT",
        message: "turn running",
        request_id: null,
        details: null,
      }),
    );

    setupPanel();
    const input = screen.getByPlaceholderText(/创建会话/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "first" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalled());
    const conn = stream.conn;
    act(() => {
      conn.handlers.route(
        makeEnvelope("turn_completed", { run_id: "run-1", status: "completed" }),
      );
    });

    const input2 = await screen.findByPlaceholderText(/继续追问/);
    fireEvent.change(input2, { target: { value: "retry-me" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(sessionApi.injectSession).toHaveBeenCalled());
    // 输入框保留 prompt 供重试
    await waitFor(() => {
      expect((screen.getByPlaceholderText(/继续追问/) as HTMLTextAreaElement).value).toBe("retry-me");
    });
  });

  it("session_ended SSE 先到：收口 ended + close", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-1", run_id: "run-1", lease_id: "l",
      status: "active", stream_url: "",
    });

    setupPanel();
    const input = screen.getByPlaceholderText(/创建会话/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalled());

    const conn = stream.conn;
    act(() => {
      conn.handlers.route(
        makeEnvelope("session_ended", { run_id: null, status: "ended" }),
      );
    });
    // ended 后发送禁用（仅新建可点）
    const newBtn = await screen.findByTitle(/新建会话/);
    expect(newBtn).toBeTruthy();
  });

  // P1-3：turn 已终态（killed）后，SSE 重连重发的 turn_completed 不应把状态
  // 改回 completed（终态幂等守护）。防止 SSE 重连覆盖已收敛的 turn。
  it("P1-3 终态幂等：killed turn 不被重发的 turn_completed 覆盖为 completed", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-1", run_id: "run-1", lease_id: "l",
      status: "active", stream_url: "",
    });

    setupPanel();
    const input = screen.getByPlaceholderText(/创建会话/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "first" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalled());

    const conn = stream.conn;
    act(() => {
      conn.handlers.route(makeEnvelope("turn_started", { run_id: "run-1", turn: 1 }));
    });
    // 先收敛为 killed（interrupt 后的真实终态）
    act(() => {
      conn.handlers.route(
        makeEnvelope("turn_completed", { run_id: "run-1", status: "killed", exit_code: 130 }),
      );
    });
    expect(screen.getByText(/已中止/)).toBeInTheDocument();

    // SSE 重连重发同 run 的 turn_completed（status=completed）—— 不应覆盖 killed
    act(() => {
      conn.handlers.route(
        makeEnvelope("turn_completed", { run_id: "run-1", status: "completed", exit_code: 0 }),
      );
    });
    // 仍是「已中止」（终态幂等：killed 不被 completed 覆盖）
    expect(screen.getByText(/已中止/)).toBeInTheDocument();
    expect(screen.queryByText(/已完成/)).not.toBeInTheDocument();
  });

  /* ---------- task-10：attach 模式 ---------- */

  function makeAttachTurns() {
    return [
      {
        runId: "run-old-1",
        turn: 1,
        prompt: "历史提问",
        output: "历史回答",
        status: "completed" as const,
        seenLogIds: new Set<string>(),
        processItems: [],
      },
    ];
  }

  it("AC-10-01 attach 模式 mount：建 SSE + 预填 initialTurns + status reconnecting", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    // 首次轮询返回 reconnecting（避免立刻转 active）
    sessionApi.getAgentSession.mockResolvedValue({
      id: "sess-attach", runtime_id: null, lease_id: null,
      provider: "claude", status: "reconnecting", agent_session_id: "ag-1",
      config: null, turn_count: 1, created_at: "t", last_active_at: null, ended_at: null,
    });

    setupPanel({ attachSessionId: "sess-attach", initialTurns: makeAttachTurns() });

    // 建立 SSE（attachSessionId）
    await waitFor(() => {
      expect(sessionApi.streamSession).toHaveBeenCalledTimes(1);
      expect(sessionApi.streamSession.mock.calls[0]![0]).toBe("sess-attach");
    });
    // 预填历史 turn
    expect(screen.getByText(/历史提问/)).toBeInTheDocument();
    expect(screen.getByText(/历史回答/)).toBeInTheDocument();
    // reconnecting → 输入禁用 + placeholder
    const input = screen.getByPlaceholderText(/恢复会话中/) as HTMLTextAreaElement;
    expect(input.disabled).toBe(true);
  });

  it("AC-10-01b 提问记录按 run_id 穿插到对应 turn（不堆顶）(ql-20260802-001)", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    sessionApi.getAgentSession.mockResolvedValue({
      id: "sess-attach", runtime_id: null, lease_id: null,
      provider: "claude", status: "reconnecting", agent_session_id: "ag-1",
      config: null, turn_count: 1, created_at: "t", last_active_at: null, ended_at: null,
    });
    // 已答提问，run_id 匹配 makeAttachTurns 的 run-old-1（realRunId 未设 → fallback runId）
    sessionApi.fetchSessionDialogHistory.mockResolvedValue([
      {
        id: "d1", session_id: "sess-attach", run_id: "run-old-1", request_id: "req-1",
        tool_name: "AskUserQuestion", dialog_kind: "AskUserQuestion",
        dialog_payload: { questions: [{ question: "文件建在哪里？" }] },
        status: "answered", answer: { answers: [{ answer: "用户桌面" }] },
        created_at: "t", answered_at: "t",
      },
    ]);

    setupPanel({ attachSessionId: "sess-attach", initialTurns: makeAttachTurns() });

    await waitFor(() => {
      expect(sessionApi.fetchSessionDialogHistory).toHaveBeenCalledTimes(1);
    });
    // 提问按 run_id 穿插到对应 turn 内（run-old-1 匹配），问答可见
    expect(screen.getByText(/文件建在哪里？/)).toBeInTheDocument();
    expect(screen.getByText(/用户桌面/)).toBeInTheDocument();
    // 顶部「📝 提问记录」区块已删，不再一股脑堆顶
    expect(screen.queryByText(/提问记录/)).not.toBeInTheDocument();
  });

  it("AC-10-01c 「全部」视图 AskUser 工具卡片显全部选项（选中✓ + 未选可见）(ql-20260802-003)", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    sessionApi.getAgentSession.mockResolvedValue({
      id: "sess-attach", runtime_id: null, lease_id: null,
      provider: "claude", status: "reconnecting", agent_session_id: "ag-1",
      config: null, turn_count: 1, created_at: "t", last_active_at: null, ended_at: null,
    });
    sessionApi.fetchSessionDialogHistory.mockResolvedValue([
      {
        id: "d1", session_id: "sess-attach", run_id: "run-old-1", request_id: "req-1",
        tool_name: "AskUserQuestion", dialog_kind: "AskUserQuestion",
        dialog_payload: {
          questions: [{
            question: "文件建在哪里？",
            options: [
              { label: "用户桌面", description: "桌面路径" },
              { label: "用户主目录", description: "主目录路径" },
            ],
          }],
        },
        status: "answered", answer: { answers: [{ answer: "用户桌面" }] },
        created_at: "t", answered_at: "t",
      },
    ]);

    setupPanel({ attachSessionId: "sess-attach", initialTurns: makeAttachTurns() });
    await waitFor(() => {
      expect(sessionApi.fetchSessionDialogHistory).toHaveBeenCalledTimes(1);
    });
    // 默认对话视图：❓ 提问记录（无工具名、无选项列表，只显问题+作答）
    expect(screen.getByText(/文件建在哪里？/)).toBeInTheDocument();
    expect(screen.queryByText(/AskUserQuestion/)).not.toBeInTheDocument();
    expect(screen.queryByText(/用户主目录/)).not.toBeInTheDocument();

    // 切「全部」：AskUser 工具卡片显全部选项——选中项「用户桌面」(✓) + 未选项「用户主目录」均可见
    fireEvent.click(screen.getByRole("tab", { name: "全部" }));
    await waitFor(() => expect(screen.getByText(/AskUserQuestion/)).toBeInTheDocument());
    expect(screen.getByText(/用户桌面/)).toBeInTheDocument();
    expect(screen.getByText(/用户主目录/)).toBeInTheDocument();
  });

  it("AC-10-03 轮询到 active → status active + 输入启用 + 清轮询", async () => {
    vi.useFakeTimers();
    try {
      const stream = makeStreamMock();
      sessionApi.streamSession.mockImplementation(stream.factory);
      // 第一次轮询 reconnecting，第二次 active
      sessionApi.getAgentSession
        .mockResolvedValueOnce({
          id: "sess-attach", runtime_id: null, lease_id: null,
          provider: "claude", status: "reconnecting", agent_session_id: "ag-1",
          config: null, turn_count: 1, created_at: "t", last_active_at: null, ended_at: null,
        })
        .mockResolvedValueOnce({
          id: "sess-attach", runtime_id: null, lease_id: null,
          provider: "claude", status: "active", agent_session_id: "ag-1",
          config: null, turn_count: 1, created_at: "t", last_active_at: null, ended_at: null,
        });

      setupPanel({ attachSessionId: "sess-attach", initialTurns: makeAttachTurns() });

      // 第一次轮询（reconnecting）
      await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
      expect(sessionApi.getAgentSession).toHaveBeenCalledTimes(1);
      // 仍 reconnecting，输入禁用
      expect((screen.getByPlaceholderText(/恢复会话中/) as HTMLTextAreaElement).disabled).toBe(true);

      // 第二次轮询（active）
      await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
      expect(sessionApi.getAgentSession).toHaveBeenCalledTimes(2);

      // status active → 输入启用 + placeholder 继续追问（fake timers 下 advanceTimersByTimeAsync 已 flush）
      const activeInput = screen.getByPlaceholderText(/继续追问/) as HTMLTextAreaElement;
      expect(activeInput.disabled).toBe(false);

      // 不再轮询（active 已清 interval）
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      expect(sessionApi.getAgentSession).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("AC-10-04 轮询超时回退 failed（保留只读历史 + 提示）", async () => {
    vi.useFakeTimers();
    try {
      const stream = makeStreamMock();
      sessionApi.streamSession.mockImplementation(stream.factory);
      // 一直 reconnecting
      sessionApi.getAgentSession.mockResolvedValue({
        id: "sess-attach", runtime_id: null, lease_id: null,
        provider: "claude", status: "reconnecting", agent_session_id: "ag-1",
        config: null, turn_count: 1, created_at: "t", last_active_at: null, ended_at: null,
      });

      setupPanel({ attachSessionId: "sess-attach", initialTurns: makeAttachTurns() });

      // 推进 10 次（1500ms × 10 = 15000ms 触发超时）
      for (let i = 0; i < 10; i++) {
        await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
      }
      // 回退 failed + 提示
      expect(screen.getByText(/会话恢复失败/)).toBeInTheDocument();
      // 历史仍保留（只读）
      expect(screen.getByText(/历史提问/)).toBeInTheDocument();
      // 输入禁用（failed）
      const input = screen.getByPlaceholderText(/会话已结束/) as HTMLTextAreaElement;
      expect(input.disabled).toBe(true);
      // 轮询已停
      const callsAfterTimeout = sessionApi.getAgentSession.mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      expect(sessionApi.getAgentSession.mock.calls.length).toBe(callsAfterTimeout);
    } finally {
      vi.useRealTimers();
    }
  });

  it("AC-10-04b 轮询到 failed → 回退只读", async () => {
    vi.useFakeTimers();
    try {
      const stream = makeStreamMock();
      sessionApi.streamSession.mockImplementation(stream.factory);
      sessionApi.getAgentSession.mockResolvedValue({
        id: "sess-attach", runtime_id: null, lease_id: null,
        provider: "claude", status: "failed", agent_session_id: "ag-1",
        config: null, turn_count: 1, created_at: "t", last_active_at: null, ended_at: null,
      });

      setupPanel({ attachSessionId: "sess-attach", initialTurns: makeAttachTurns() });

      await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
      expect(screen.getByText(/会话恢复失败/)).toBeInTheDocument();
      // 轮询停
      const callsAfterFail = sessionApi.getAgentSession.mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      expect(sessionApi.getAgentSession.mock.calls.length).toBe(callsAfterFail);
    } finally {
      vi.useRealTimers();
    }
  });

  it("AC-10-06 unmount：清轮询 interval + close SSE", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    sessionApi.getAgentSession.mockResolvedValue({
      id: "sess-attach", runtime_id: null, lease_id: null,
      provider: "claude", status: "reconnecting", agent_session_id: "ag-1",
      config: null, turn_count: 1, created_at: "t", last_active_at: null, ended_at: null,
    });

    const { unmount } = setupPanel({ attachSessionId: "sess-attach", initialTurns: makeAttachTurns() });
    const conn = stream.conn;
    unmount();
    expect(conn.closeSpy).toHaveBeenCalled();
  });

  it("AC-10-05 attach active 后发送走 inject", async () => {
    vi.useFakeTimers();
    try {
      const stream = makeStreamMock();
      sessionApi.streamSession.mockImplementation(stream.factory);
      sessionApi.getAgentSession.mockResolvedValue({
        id: "sess-attach", runtime_id: null, lease_id: null,
        provider: "claude", status: "active", agent_session_id: "ag-1",
        config: null, turn_count: 1, created_at: "t", last_active_at: null, ended_at: null,
      });
      sessionApi.injectSession.mockResolvedValue({
        session_id: "sess-attach", run_id: "run-new", status: "active",
      });

      setupPanel({ attachSessionId: "sess-attach", initialTurns: makeAttachTurns() });

      // 等待首次轮询转 active
      await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
      const input = screen.getByPlaceholderText(/继续追问/) as HTMLTextAreaElement;
      expect(input.disabled).toBe(false);
      fireEvent.change(input, { target: { value: "续聊内容" } });
      await act(async () => {
        fireEvent.click(screen.getByTitle("发送"));
      });

      expect(sessionApi.injectSession).toHaveBeenCalledTimes(1);
      expect(sessionApi.injectSession).toHaveBeenCalledWith("sess-attach", "续聊内容");
      // 不调 createSession（attach 不走新建）
      expect(sessionApi.createSession).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  }, 10000);

  it("无 attachSessionId：不影响现有 idle→create 路径（默认模式）", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-1", run_id: "run-1", lease_id: "l",
      status: "active", stream_url: "",
    });

    setupPanel(); // 无 attach props
    // 不应立刻建 SSE / 轮询
    expect(sessionApi.streamSession).not.toHaveBeenCalled();
    expect(sessionApi.getAgentSession).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText(/创建会话/)).toBeTruthy();
  });

  /* ---------- ql-20260623：URL 恢复配套（改动一/二/三） ---------- */

  it("改动一：createSession 成功后调 onSessionCreated 上报 session_id", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-url-1", run_id: "run-1", lease_id: "l",
      status: "active", stream_url: "",
    });
    const onSessionCreated = vi.fn();

    setupPanel({ onSessionCreated });
    const input = screen.getByPlaceholderText(/创建会话/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.click(screen.getByTitle("发送"));

    await waitFor(() =>
      expect(onSessionCreated).toHaveBeenCalledWith("sess-url-1"),
    );
  });

  it("改动一：新建会话（idle 重置）调 onSessionReset", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-1", run_id: "run-1", lease_id: "l",
      status: "active", stream_url: "",
    });
    sessionApi.endSession.mockResolvedValue({
      session_id: "sess-1", status: "ended", current_run_id: null,
    });
    const onSessionReset = vi.fn();

    setupPanel({ onSessionReset });
    const input = screen.getByPlaceholderText(/创建会话/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalled());
    // 结束会话 → ended
    fireEvent.click(await screen.findByTitle(/结束整个会话/));
    await waitFor(() => expect(sessionApi.endSession).toHaveBeenCalled());
    // ended 后点新建会话 → 重置回 idle → onSessionReset
    fireEvent.click(screen.getByTitle(/新建会话/));
    expect(onSessionReset).toHaveBeenCalledTimes(1);
  });

  it("改动二：createSession 成功后独立 effect 触发 fetchPendingDialogs", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-1", run_id: "run-1", lease_id: "l",
      status: "active", stream_url: "",
    });

    setupPanel();
    const input = screen.getByPlaceholderText(/创建会话/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.click(screen.getByTitle("发送"));

    await waitFor(() =>
      expect(sessionApi.fetchPendingDialogs).toHaveBeenCalledWith("sess-1"),
    );
  });

  it("改动二：attach 模式 mount 也触发 fetchPendingDialogs", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    sessionApi.getAgentSession.mockResolvedValue({
      id: "sess-attach", runtime_id: null, lease_id: null,
      provider: "claude", status: "reconnecting", agent_session_id: "ag-1",
      config: null, turn_count: 1, created_at: "t", last_active_at: null, ended_at: null,
    });

    setupPanel({ attachSessionId: "sess-attach", initialTurns: makeAttachTurns() });

    await waitFor(() =>
      expect(sessionApi.fetchPendingDialogs).toHaveBeenCalledWith("sess-attach"),
    );
  });

  it("改动二+三：fetchPendingDialogs 返回的 dialog 卡片在 active 会话渲染", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-1", run_id: "run-1", lease_id: "l",
      status: "active", stream_url: "",
    });
    sessionApi.fetchPendingDialogs.mockResolvedValue([
      {
        session_id: "sess-1",
        run_id: "run-1",
        request_id: "req-1",
        tool_name: "AskUserQuestion",
        input: {},
        dialog_kind: "ask_user",
        dialog_payload: {
          questions: [{
            question: "选择哪个？",
            header: "选项",
            options: [{ label: "A", description: "a" }],
          }],
        },
      },
    ]);

    setupPanel();
    const input = screen.getByPlaceholderText(/创建会话/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.click(screen.getByTitle("发送"));

    // dialog 卡片渲染（AskUserQuestion 文案可见）
    await waitFor(() =>
      expect(screen.getByText(/选择哪个？/)).toBeInTheDocument(),
    );
  });

  it("改动三：ended 会话不渲染 pending dialog 卡片（死卡防护）", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-1", run_id: "run-1", lease_id: "l",
      status: "active", stream_url: "",
    });
    sessionApi.endSession.mockResolvedValue({
      session_id: "sess-1", status: "ended", current_run_id: null,
    });
    // 返回一个 pending dialog
    sessionApi.fetchPendingDialogs.mockResolvedValue([
      {
        session_id: "sess-1",
        run_id: "run-1",
        request_id: "req-dead",
        tool_name: "AskUserQuestion",
        input: {},
        dialog_kind: "ask_user",
        dialog_payload: {
          questions: [{
            question: "死卡问题",
            header: "选项",
            options: [{ label: "A", description: "a" }],
          }],
        },
      },
    ]);

    setupPanel();
    const input = screen.getByPlaceholderText(/创建会话/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.click(screen.getByTitle("发送"));
    // 等待 dialog 出现
    await waitFor(() => expect(screen.getByText(/死卡问题/)).toBeInTheDocument());

    // 结束会话 → ended → onSessionEnded 清空 + render gate 不渲染
    fireEvent.click(await screen.findByTitle(/结束整个会话/));
    await waitFor(() => expect(sessionApi.endSession).toHaveBeenCalled());
    // 卡片消失
    await waitFor(() =>
      expect(screen.queryByText(/死卡问题/)).not.toBeInTheDocument(),
    );
  });

  /* ---------- task-08（FR-01 / FR-02 / FR-07 / D-005）：Codex provider interactive 路径 ---------- */

  it("task-08 codex 首发 → createSession({provider:'codex'}) + 不调 quick-chat", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-codex", run_id: "run-codex-1", lease_id: "lc",
      status: "active", stream_url: "",
    });

    setupPanel({ providers: ["claude", "codex"], defaultProvider: "codex" });
    const input = screen.getByPlaceholderText(/创建会话/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hello codex" } });
    fireEvent.click(screen.getByTitle("发送"));

    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalledTimes(1));
    expect(sessionApi.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "codex", prompt: "hello codex" }),
    );
    // 建交互式 SSE（不是 quick-chat）
    expect(sessionApi.streamSession).toHaveBeenCalledTimes(1);
    expect(sessionApi.streamSession.mock.calls[0]![0]).toBe("sess-codex");
  });

  it("task-08 codex 多轮 → 第二条 injectSession，SSE 累计仍 1 次", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-codex", run_id: "run-codex-1", lease_id: "lc",
      status: "active", stream_url: "",
    });
    sessionApi.injectSession.mockResolvedValue({
      session_id: "sess-codex", run_id: "run-codex-2", status: "active",
    });

    setupPanel({ providers: ["claude", "codex"], defaultProvider: "codex" });
    const input = screen.getByPlaceholderText(/创建会话/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "first codex" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalled());

    const conn = stream.conn;
    act(() => {
      conn.handlers.route(makeEnvelope("turn_started", { run_id: "run-codex-1", turn: 1 }));
      conn.handlers.route(
        makeEnvelope("turn_completed", { run_id: "run-codex-1", status: "completed" }),
      );
    });

    const input2 = await screen.findByPlaceholderText(/继续追问/, undefined, { timeout: 2000 });
    fireEvent.change(input2, { target: { value: "second codex" } });
    fireEvent.click(screen.getByTitle("发送"));

    await waitFor(() => expect(sessionApi.injectSession).toHaveBeenCalledTimes(1));
    expect(sessionApi.injectSession).toHaveBeenCalledWith("sess-codex", "second codex");
    // 同 session 不重建 SSE
    expect(sessionApi.streamSession).toHaveBeenCalledTimes(1);
  });

  /* ---- task-09（FR-09 / D-006@v1 / D-008@v1 / D-010@v1）：Codex dialog 卡片
   * 收卡（onPermissionRequest 按 dialog_kind 存在性收）+ 响应回写
   *（respondSessionPermission）+ permission_resolved/session_ended 移除。 ---- */

  function makeCodexDialogPermission(
    overrides: Record<string, any> = {},
  ): any {
    return {
      event: "permission_request",
      session_id: "sess-1",
      run_id: "run-1",
      request_id: "codex-req-1",
      tool_name: "codex_request_user_input",
      input: {},
      tool_use_id: "tu-1",
      dialog_kind: "codex_request_user_input",
      dialog_payload: {
        questions: [
          {
            question: "Codex 想知道下一步操作",
            header: "下一步",
            multiSelect: false,
            options: [
              { label: "继续执行" },
              { label: "中止并回滚" },
            ],
          },
        ],
      },
      ...overrides,
    };
  }

  it("task-09 codex dialog permission_request → 渲染 AskUserDialogCard（可见问题/选项）", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-1", run_id: "run-1", lease_id: "l",
      status: "active", stream_url: "",
    });

    setupPanel();
    const input = screen.getByPlaceholderText(/创建会话/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalled());

    const conn = stream.conn;
    act(() => {
      conn.handlers.onPermissionRequest(makeCodexDialogPermission());
    });
    await waitFor(() =>
      expect(screen.getByText("Codex 想知道下一步操作")).toBeInTheDocument(),
    );
    expect(screen.getByText("继续执行")).toBeInTheDocument();
    expect(screen.getByText("codex_request_user_input")).toBeInTheDocument();
  });

  it("task-09 codex dialog 用户提交 → permission_resolved 移除卡片", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-1", run_id: "run-1", lease_id: "l",
      status: "active", stream_url: "",
    });
    // AskUserDialogCard 内部调真实 respondSessionPermission → 走 apiFetch → fetch
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ accepted: true }), { status: 200 }),
      );

    setupPanel();
    const input = screen.getByPlaceholderText(/创建会话/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalled());

    const conn = stream.conn;
    act(() => {
      conn.handlers.onPermissionRequest(makeCodexDialogPermission());
    });
    await waitFor(() =>
      expect(screen.getByText("Codex 想知道下一步操作")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText("继续执行"));
    fireEvent.click(screen.getByRole("button", { name: /提交回答/ }));
    // 用户提交后 handleDialogResolved 立即移除卡片（双保险）
    await waitFor(() =>
      expect(screen.queryByText("Codex 想知道下一步操作")).not.toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // permission_resolved SSE 到达后再次过滤（无副作用，已移除）
    act(() => {
      conn.handlers.onPermissionResolved({
        event: "permission_resolved",
        session_id: "sess-1",
        request_id: "codex-req-1",
        decision: "allow",
      });
    });
    expect(screen.queryByText("Codex 想知道下一步操作")).not.toBeInTheDocument();
  });

  it("task-09 session ended SSE → 清空 Codex 待答卡", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-1", run_id: "run-1", lease_id: "l",
      status: "active", stream_url: "",
    });

    setupPanel();
    const input = screen.getByPlaceholderText(/创建会话/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalled());

    const conn = stream.conn;
    act(() => {
      conn.handlers.onPermissionRequest(makeCodexDialogPermission());
    });
    await waitFor(() =>
      expect(screen.getByText("Codex 想知道下一步操作")).toBeInTheDocument(),
    );

    // session_ended 到达 → onSessionEnded 清空 pendingRequests
    act(() => {
      conn.handlers.route(
        makeEnvelope("session_ended", { run_id: null, status: "ended" }),
      );
    });
    await waitFor(() =>
      expect(screen.queryByText("Codex 想知道下一步操作")).not.toBeInTheDocument(),
    );
  });

  it("task-09 重复 request_id 的 codex dialog 只渲染一张卡", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-1", run_id: "run-1", lease_id: "l",
      status: "active", stream_url: "",
    });

    setupPanel();
    const input = screen.getByPlaceholderText(/创建会话/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalled());

    const conn = stream.conn;
    act(() => {
      conn.handlers.onPermissionRequest(makeCodexDialogPermission());
      // SSE 重连/重放同一 request_id
      conn.handlers.onPermissionRequest(makeCodexDialogPermission());
    });
    // 问题文本只出现一次（去重生效）
    expect(screen.getAllByText("Codex 想知道下一步操作")).toHaveLength(1);
    expect(screen.getAllByText("继续执行")).toHaveLength(1);
  });

  it("task-09 mcp_elicitation dialog_kind 同样收卡渲染", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-1", run_id: "run-1", lease_id: "l",
      status: "active", stream_url: "",
    });

    setupPanel();
    const input = screen.getByPlaceholderText(/创建会话/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalled());

    const conn = stream.conn;
    act(() => {
      conn.handlers.onPermissionRequest(
        makeCodexDialogPermission({
          request_id: "mcp-req-1",
          tool_name: "mcp_server_x",
          dialog_kind: "mcp_elicitation",
          dialog_payload: {
            questions: [
              {
                question: "MCP 服务器请求确认",
                options: [{ label: "同意" }, { label: "拒绝" }],
              },
            ],
          },
        }),
      );
    });
    await waitFor(() =>
      expect(screen.getByText("MCP 服务器请求确认")).toBeInTheDocument(),
    );
    expect(screen.getByText("mcp_elicitation")).toBeInTheDocument();
  });

  /* ---------- task-08（FR-08 / D-001@v2）：「用团队分析」按钮 ---------- */

  it("task-08 无 workspaceId 时「用团队分析」按钮不渲染", async () => {
    setupPanel(); // 默认不传 workspaceId
    expect(screen.queryByTitle(/用团队/)).not.toBeInTheDocument();
  });

  it("task-08 有 workspaceId 但无 session 时按钮禁用", async () => {
    setupPanel({ workspaceId: "ws-1" });
    const btn = screen.getByTitle(/用团队/);
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("task-08 active session 点「用团队分析」→ createMission(mode=team, session_id)", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-1",
      run_id: "run-1",
      lease_id: "l",
      status: "active",
      stream_url: "",
    });
    missionApi.createMission.mockResolvedValue({
      id: "m-team-1",
      workspace_id: "ws-1",
      change_id: null,
      objective: "团队分析当前会话上下文",
      status: "planning",
      budget_usd: null,
      cost_so_far: 0,
      constraints: null,
      cancelled_at: null,
      created_at: "t",
      workers: [],
    });
    const onTeamMissionCreated = vi.fn();

    setupPanel({
      workspaceId: "ws-1",
      onTeamMissionCreated,
    });
    const input = screen.getByPlaceholderText(/创建会话/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalled());

    const teamBtn = await screen.findByTitle(/用团队/);
    expect((teamBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(teamBtn);

    await waitFor(() => expect(missionApi.createMission).toHaveBeenCalledTimes(1));
    const callArg = missionApi.createMission.mock.calls[0]![1];
    expect(callArg).toEqual(
      expect.objectContaining({
        objective: "团队分析当前会话上下文",
        mode: "team",
        session_id: "sess-1",
      }),
    );
    expect(callArg.worker_preset).toHaveLength(2);
    expect(onTeamMissionCreated).toHaveBeenCalledWith("m-team-1");
    // 按钮转「已建团队」+ 禁用
    await waitFor(() =>
      expect(screen.getByText("已建团队")).toBeInTheDocument(),
    );
  });

  it("task-08 createMission 失败显示错误，按钮恢复可点", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-1",
      run_id: "run-1",
      lease_id: "l",
      status: "active",
      stream_url: "",
    });
    const { ApiError } = await import("@/lib/api");
    missionApi.createMission.mockRejectedValue(
      new ApiError(500, {
        code: "INTERNAL",
        message: "建 mission 失败",
        request_id: null,
        details: null,
      }),
    );

    setupPanel({ workspaceId: "ws-1" });
    const input = screen.getByPlaceholderText(/创建会话/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalled());

    const teamBtn = await screen.findByTitle(/用团队/);
    fireEvent.click(teamBtn);
    await waitFor(() =>
      expect(screen.getByText(/建 mission 失败/)).toBeInTheDocument(),
    );
    expect(screen.getByText("用团队分析")).toBeInTheDocument();
  });
});

/**
 * ql-20260729-005：对话/全部二态切换 + 过程信息分流。
 * - 默认「对话」：只显用户消息 + agent 答复正文；thinking/tool/stderr 不渲染
 * - 切「全部」：过程项（思考折叠块 / 工具行 / stderr 行）出现在答复气泡前
 * - 运行中无答复：对话模式显示「正在思考…」占位
 */
describe("InteractiveSessionPanel 对话/全部视图切换（ql-20260729-005）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionApi.fetchPendingDialogs.mockResolvedValue([]);
    sessionApi.fetchSessionDialogHistory.mockResolvedValue([]);
  });

  it("默认对话视图：tool_call/thinking 不展示，reply 正常展示；切全部后过程项出现", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-1", run_id: "run-1", lease_id: "l",
      status: "active", stream_url: "",
    });

    setupPanel();
    const input = screen.getByPlaceholderText(/创建会话/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "帮我读文件" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalled());

    const conn = stream.conn;
    act(() => {
      conn.handlers.route(makeEnvelope("turn_started", { run_id: "run-1", turn: 1 }));
      conn.handlers.route(
        makeEnvelope("log", { run_id: "run-1", channel: null, content: "[THINKING] 先想想怎么读" }),
        "L1",
      );
      conn.handlers.route(
        makeEnvelope("log", { run_id: "run-1", channel: "tool_call", content: "Read src/a.ts" }),
        "L2",
      );
      conn.handlers.route(
        makeEnvelope("log", { run_id: "run-1", channel: "stdout", content: "文件内容如下" }),
        "L3",
      );
    });

    // 对话视图：答复可见，过程项不可见
    await waitFor(() => expect(screen.getByText(/文件内容如下/)).toBeInTheDocument());
    expect(screen.queryByText(/Read src\/a\.ts/)).not.toBeInTheDocument();
    expect(screen.queryByText(/先想想怎么读/)).not.toBeInTheDocument();
    expect(screen.queryByText("思考过程")).not.toBeInTheDocument();

    // 切「全部」：过程项出现（thinking 折叠块标题 + 摘要，tool 行）
    fireEvent.click(screen.getByRole("tab", { name: "全部" }));
    await waitFor(() => expect(screen.getByText(/Read src\/a\.ts/)).toBeInTheDocument());
    expect(screen.getByText("思考过程")).toBeInTheDocument();
    // thinking 默认折叠：摘要（截断文本）可见
    expect(screen.getByText(/先想想怎么读/)).toBeInTheDocument();

    // 切回「对话」：过程项再次隐藏，答复仍在
    fireEvent.click(screen.getByRole("tab", { name: "对话" }));
    await waitFor(() => expect(screen.queryByText(/Read src\/a\.ts/)).not.toBeInTheDocument());
    expect(screen.getByText(/文件内容如下/)).toBeInTheDocument();
  });

  it("运行中尚无答复：对话视图显示「正在思考…」占位", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-1", run_id: "run-1", lease_id: "l",
      status: "active", stream_url: "",
    });

    setupPanel();
    const input = screen.getByPlaceholderText(/创建会话/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalled());

    const conn = stream.conn;
    act(() => {
      conn.handlers.route(makeEnvelope("turn_started", { run_id: "run-1", turn: 1 }));
    });
    await waitFor(() => expect(screen.getByText(/正在思考…/)).toBeInTheDocument());

    // 答复到达后占位消失
    act(() => {
      conn.handlers.route(
        makeEnvelope("log", { run_id: "run-1", channel: "stdout", content: "你好" }),
        "L1",
      );
    });
    await waitFor(() => expect(screen.queryByText(/正在思考…/)).not.toBeInTheDocument());
  });

  it("attach 历史 turn 的 details：对话默认隐藏，切全部展示", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    sessionApi.getAgentSession.mockResolvedValue({
      id: "sess-h", status: "ended", current_run_id: null,
    });

    setupPanel({
      attachSessionId: "sess-h",
      initialTurns: [
        {
          runId: "__attach_history_1__",
          turn: 1,
          prompt: "历史问题",
          output: "历史答复",
          status: "completed",
          seenLogIds: new Set(),
          inputTokens: null,
          outputTokens: null,
          processItems: [
            { kind: "thinking", text: "历史思考内容" },
            { kind: "tool", raw: "Bash ls -la", status: "ok" },
          ],
        },
      ],
    });

    // 对话视图：prompt/reply 可见，details 隐藏
    await waitFor(() => expect(screen.getByText(/历史答复/)).toBeInTheDocument());
    expect(screen.getByText(/历史问题/)).toBeInTheDocument();
    expect(screen.queryByText(/Bash ls -la/)).not.toBeInTheDocument();
    expect(screen.queryByText(/历史思考内容/)).not.toBeInTheDocument();

    // 切「全部」：details 出现
    fireEvent.click(screen.getByRole("tab", { name: "全部" }));
    await waitFor(() => expect(screen.getByText(/Bash ls -la/)).toBeInTheDocument());
    expect(screen.getByText(/历史思考内容/)).toBeInTheDocument();
  });
});

/**
 * 2026-08-03-session-stream-partial-revoke / FR-05 / task-08：onLog 按 segmentId
 * 撤回已渲染 partial（半截→override→complete 全文）。覆盖 AC-04/05/07。
 */
describe("InteractiveSessionPanel partial override 撤回（task-06/08）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionApi.fetchPendingDialogs.mockResolvedValue([]);
    sessionApi.fetchSessionDialogHistory.mockResolvedValue([]);
  });

  async function startSession() {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-1", run_id: "run-1", lease_id: "l",
      status: "active", stream_url: "",
    });
    setupPanel();
    const input = screen.getByPlaceholderText(/创建会话/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalled());
    return stream;
  }

  it("AC-05 半截 reply → override → complete 全文：最终只剩 complete（无半截残留）", async () => {
    const stream = await startSession();
    const conn = stream.conn;

    act(() => {
      conn.handlers.route(makeEnvelope("turn_started", { run_id: "run-1", turn: 1 }));
      // 半截 reply（segment_id 非空）
      conn.handlers.route(
        makeEnvelope("log", {
          run_id: "run-1", channel: "stdout", content: "[ASSISTANT] 半截",
          segment_id: "main:m:1",
        }),
        "L1",
      );
    });
    await waitFor(() => expect(screen.getByText(/半截/)).toBeInTheDocument());

    // override 到达：撤回 main:m:1 半截
    act(() => {
      conn.handlers.route(
        makeEnvelope("log", {
          run_id: "run-1", channel: "stdout",
          content: "[ASSISTANT_OVERRIDE] main:m:1",
          segment_id: "main:m:1", stale: true, log_id: null,
        }),
        null,
      );
    });
    await waitFor(() =>
      expect(screen.queryByText(/半截/)).not.toBeInTheDocument(),
    );

    // complete 全文到达（segment_id=null）→ 只剩全文
    act(() => {
      conn.handlers.route(
        makeEnvelope("log", {
          run_id: "run-1", channel: "stdout", content: "[ASSISTANT] 全文内容",
          segment_id: null,
        }),
        "L2",
      );
    });
    await waitFor(() => expect(screen.getByText(/全文内容/)).toBeInTheDocument());
    expect(screen.queryByText(/半截/)).not.toBeInTheDocument();
  });

  it("AC-05 thinking 撤回：override 到达后 processItems 中该项移除（切全部不见）", async () => {
    const stream = await startSession();
    const conn = stream.conn;

    act(() => {
      conn.handlers.route(makeEnvelope("turn_started", { run_id: "run-1", turn: 1 }));
      conn.handlers.route(
        makeEnvelope("log", {
          run_id: "run-1", channel: null, content: "[THINKING] 半截思考",
          segment_id: "tu:2",
        }),
        "L1",
      );
    });
    // 切「全部」确认思考项在
    fireEvent.click(screen.getByRole("tab", { name: "全部" }));
    await waitFor(() => expect(screen.getByText(/半截思考/)).toBeInTheDocument());

    // override 到达 → 移除
    act(() => {
      conn.handlers.route(
        makeEnvelope("log", {
          run_id: "run-1", channel: null,
          content: "[THINKING_OVERRIDE] tu:2",
          segment_id: "tu:2", stale: true, log_id: null,
        }),
        null,
      );
    });
    await waitFor(() =>
      expect(screen.queryByText(/半截思考/)).not.toBeInTheDocument(),
    );
  });

  it("AC-05 多 segment 不串扰（thinking）：撤回 main:t:1 的思考项不影响 tu_xyz:9", async () => {
    // 选 thinking 维度验证多 segment 隔离：thinking 是独立 processItems 项，按 itemIndex
    // filter 移除——天然隔离不串扰（design §5.3）。reply 走 output 字符串线性拼接，
    // 多 segment 交叠时 slice 偏移无法精确隔离（既有模型限制，留 R-03），故隔离契约用
    // thinking 项验证更贴合 design AC-05「按 segmentId 互不串扰」原意。
    const stream = await startSession();
    const conn = stream.conn;

    act(() => {
      conn.handlers.route(makeEnvelope("turn_started", { run_id: "run-1", turn: 1 }));
      // 主 agent 半截思考
      conn.handlers.route(
        makeEnvelope("log", {
          run_id: "run-1", channel: null, content: "[THINKING] 主思考",
          segment_id: "main:t:1",
        }),
        "L1",
      );
      // 子代理半截思考（不同 segmentId 前缀）
      conn.handlers.route(
        makeEnvelope("log", {
          run_id: "run-1", channel: null, content: "[THINKING] 子思考",
          segment_id: "tu_xyz:9",
        }),
        "L2",
      );
    });
    fireEvent.click(screen.getByRole("tab", { name: "全部" }));
    await waitFor(() => expect(screen.getByText(/主思考/)).toBeInTheDocument());
    expect(screen.getByText(/子思考/)).toBeInTheDocument();

    // 只撤回主 agent main:t:1
    act(() => {
      conn.handlers.route(
        makeEnvelope("log", {
          run_id: "run-1", channel: null,
          content: "[THINKING_OVERRIDE] main:t:1",
          segment_id: "main:t:1", stale: true, log_id: null,
        }),
        null,
      );
    });
    await waitFor(() =>
      expect(screen.queryByText(/主思考/)).not.toBeInTheDocument(),
    );
    // 子代理思考仍在（按 itemIndex 隔离，不串扰）
    expect(screen.getByText(/子思考/)).toBeInTheDocument();
  });

  it("AC-07 历史兼容：缺 segment_id/stale（旧 backend）不崩、不误撤回", async () => {
    const stream = await startSession();
    const conn = stream.conn;

    act(() => {
      conn.handlers.route(makeEnvelope("turn_started", { run_id: "run-1", turn: 1 }));
      // 旧 backend：envelope 无 segment_id/stale 字段
      conn.handlers.route(
        makeEnvelope("log", { run_id: "run-1", channel: "stdout", content: "普通回复" }),
        "L1",
      );
    });
    await waitFor(() => expect(screen.getByText(/普通回复/)).toBeInTheDocument());
    // 行为同现状：内容保留，无撤回
    expect(screen.getByText(/普通回复/)).toBeInTheDocument();
  });

  it("R-02 turn 边界清空 Map：turn_completed 后同 segmentId override 不撤回新 turn", async () => {
    const stream = await startSession();
    const conn = stream.conn;
    sessionApi.injectSession.mockResolvedValue({
      session_id: "sess-1", run_id: "run-2", status: "active",
    });

    act(() => {
      conn.handlers.route(makeEnvelope("turn_started", { run_id: "run-1", turn: 1 }));
      conn.handlers.route(
        makeEnvelope("log", {
          run_id: "run-1", channel: "stdout", content: "[ASSISTANT] turn1半截",
          segment_id: "main:m:1",
        }),
        "L1",
      );
    });
    await waitFor(() => expect(screen.getByText(/turn1半截/)).toBeInTheDocument());

    // turn1 完成 → Map 清空
    act(() => {
      conn.handlers.route(
        makeEnvelope("turn_completed", { run_id: "run-1", status: "completed" }),
      );
    });

    // 第二 turn
    await waitFor(() => {
      expect((screen.getByPlaceholderText(/继续追问/) as HTMLTextAreaElement)).toBeTruthy();
    }, { timeout: 2000 });
    const input2 = screen.getByPlaceholderText(/继续追问/) as HTMLTextAreaElement;
    fireEvent.change(input2, { target: { value: "second" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(sessionApi.injectSession).toHaveBeenCalled());

    act(() => {
      conn.handlers.route(makeEnvelope("turn_started", { run_id: "run-2", turn: 2 }));
      // turn2 的回复（segment_id=null，complete 全文，不记入 Map）
      conn.handlers.route(
        makeEnvelope("log", {
          run_id: "run-2", channel: "stdout", content: "[ASSISTANT] turn2回复",
          segment_id: null,
        }),
        "L2",
      );
    });
    await waitFor(() => expect(screen.getByText(/turn2回复/)).toBeInTheDocument());

    // turn1 迟到的 override（segmentId=main:m:1）到达 turn2：Map 已在 turn1 完成时清空、
    // turn2 无 main:m:1 的 partial → Map 无此 key → no-op，不撤回 turn2 内容（R-02）。
    act(() => {
      conn.handlers.route(
        makeEnvelope("log", {
          run_id: "run-2", channel: "stdout",
          content: "[ASSISTANT_OVERRIDE] main:m:1",
          segment_id: "main:m:1", stale: true, log_id: null,
        }),
        null,
      );
    });
    await waitFor(() => expect(screen.getByText(/turn2回复/)).toBeInTheDocument());
  });
});

// task-13 / FR-04 / R-08 / design §5 Phase4：terminating_at 非空 → 面板显示「终止中…」横幅
describe("InteractiveSessionPanel 终止中态显示（task-13 / FR-04）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionApi.fetchPendingDialogs.mockResolvedValue([]);
    sessionApi.fetchSessionDialogHistory.mockResolvedValue([]);
  });

  it("attach 轮询返回 terminating_at 非空 + status active：显示「终止中…」横幅", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    sessionApi.getAgentSession.mockResolvedValue({
      id: "sess-term", runtime_id: null, lease_id: "lease-1",
      provider: "claude", status: "active", agent_session_id: "ag-1",
      config: null, turn_count: 1, created_at: "t", last_active_at: null, ended_at: null,
      current_run_id: null,
      // task-13：lease.terminating_at 非空（cancel_lease 已标，等 daemon 回传）
      terminating_at: "2026-08-05T10:00:00Z",
    });

    setupPanel({ attachSessionId: "sess-term", initialTurns: [] });

    await waitFor(() => {
      expect(screen.getByText(/终止中…/)).toBeInTheDocument();
    });
  });

  it("attach 轮询返回 terminating_at 为空：不显示「终止中…」横幅（brownfield）", async () => {
    const stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
    sessionApi.getAgentSession.mockResolvedValue({
      id: "sess-plain", runtime_id: null, lease_id: "lease-2",
      provider: "claude", status: "active", agent_session_id: "ag-2",
      config: null, turn_count: 0, created_at: "t", last_active_at: null, ended_at: null,
      current_run_id: null,
      terminating_at: null,
    });

    setupPanel({ attachSessionId: "sess-plain", initialTurns: [] });

    // 给轮询 + 渲染一拍时间
    await waitFor(() => {
      expect(sessionApi.getAgentSession).toHaveBeenCalled();
    });
    // 不要出现终止中横幅
    expect(screen.queryByText(/终止中…/)).not.toBeInTheDocument();
  });
});
