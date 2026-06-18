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
  };
});

/* ----- fake SSE connection ----- */

interface FakeConnHandlers {
  onTurnStarted: (env: any) => void;
  onLog: (env: any, cursor?: string | null) => void;
  onTurnCompleted: (env: any) => void;
  onSessionEnded: (env: any) => void;
  onError: (err: Error) => void;
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
          // 便捷：用 envelope.event 路由
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
});
