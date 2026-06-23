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

/* ----- mock lib/daemon ----- */

const sessionApi = vi.hoisted(() => ({
  createSession: vi.fn(),
  injectSession: vi.fn(),
  interruptSession: vi.fn(),
  endSession: vi.fn(),
  streamSession: vi.fn(),
  getAgentSession: vi.fn(),
  fetchPendingDialogs: vi.fn(),
  // task-08（FR-07 / D-005）：codex 路径不得调用 quick-chat API，mock 供断言 not.toHaveBeenCalled
  quickChat: vi.fn(),
  streamQuickChat: vi.fn(),
  getQuickChatResult: vi.fn(),
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
    quickChat: sessionApi.quickChat,
    streamQuickChat: sessionApi.streamQuickChat,
    getQuickChatResult: sessionApi.getQuickChatResult,
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
    // 全程不调 quick-chat API
    expect(sessionApi.quickChat).not.toHaveBeenCalled();
    expect(sessionApi.streamQuickChat).not.toHaveBeenCalled();
    expect(sessionApi.getQuickChatResult).not.toHaveBeenCalled();
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
    // 全程不调 quick-chat
    expect(sessionApi.quickChat).not.toHaveBeenCalled();
    expect(sessionApi.streamQuickChat).not.toHaveBeenCalled();
    expect(sessionApi.getQuickChatResult).not.toHaveBeenCalled();
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
});
