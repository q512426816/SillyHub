// task-11（FR-10 / D-006@v1）：session REST 客户端单测。
//
// 覆盖：
//   - createSession：POST /api/daemon/sessions + JSON body + provider/prompt/model；
//   - injectSession：POST /sessions/{id}/inject + body {prompt} + 编码 session id；
//   - interruptSession：POST /sessions/{id}/interrupt + no body；
//   - endSession：POST /sessions/{id}/end + no body；
//   - ApiError 透传（404 / 409）。
//
// 对齐 task-05 REST 契约（design.md §7.4）。

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  createSession,
  injectSession,
  interruptSession,
  endSession,
  streamSession,
  type SessionCreateResponse,
  type SessionStreamEnvelope,
  type SessionStreamHandlers,
} from "../daemon";

vi.mock("../../stores/session", () => ({
  useSession: {
    getState: () => ({ accessToken: "test-token" }),
  },
}));

function mockFetch(payload: unknown, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(payload), { status }),
  );
}

/** 取 mock fetch 的第 N 次调用 [url, init]，init 断言为 RequestInit。 */
function fetchCall(
  fetchMock: { mock: { calls: Array<[unknown, RequestInit?]> } },
  n = 0,
): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls[n]!;
  return { url: String(call[0]), init: (call[1] ?? {}) as RequestInit };
}

describe("createSession", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("POST /api/daemon/sessions，body 含 provider/prompt/model", async () => {
    const resp: SessionCreateResponse = {
      session_id: "sess-1",
      run_id: "run-1",
      lease_id: "lease-1",
      status: "active",
      stream_url: "/api/daemon/sessions/sess-1/stream",
    };
    const fetchMock = mockFetch(resp);

    const result = await createSession({
      provider: "claude",
      prompt: "hello",
      model: "sonnet",
    });

    expect(result).toEqual(resp);
    const { url, init } = fetchCall(fetchMock);
    expect(url).toContain("/api/daemon/sessions");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.provider).toBe("claude");
    expect(body.prompt).toBe("hello");
    expect(body.model).toBe("sonnet");
  });

  it("不带 model 时 body.model 默认 null", async () => {
    mockFetch({
      session_id: "s",
      run_id: "r",
      lease_id: "l",
      status: "active",
      stream_url: "u",
    });
    await createSession({ provider: "codex", prompt: "hi" });
    const init = (vi.mocked(globalThis.fetch).mock.calls[0]![1] ?? {}) as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.model).toBeNull();
  });

  it("404 抛 ApiError（不伪造 run 终态）", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "DAEMON_NOT_FOUND",
          message: "no daemon",
          request_id: null,
          details: null,
        }),
        { status: 404 },
      ),
    );
    await expect(createSession({ provider: "claude", prompt: "x" }))
      .rejects.toMatchObject({ name: "ApiError", status: 404 });
  });
});

describe("injectSession", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("POST /sessions/{id}/inject，body {prompt}，编码特殊字符 session id", async () => {
    const fetchMock = mockFetch({
      session_id: "sess a/b",
      run_id: "run-2",
      status: "active",
    });
    const result = await injectSession("sess a/b", "next question");
    expect(result.run_id).toBe("run-2");
    const { url, init } = fetchCall(fetchMock);
    // 编码后的 path 段
    expect(url).toContain("/api/daemon/sessions/sess%20a%2Fb/inject");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ prompt: "next question" });
  });

  it("409 turn conflict 抛 ApiError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "DAEMON_SESSION_TURN_CONFLICT",
          message: "turn running",
          request_id: null,
          details: null,
        }),
        { status: 409 },
      ),
    );
    await expect(injectSession("s", "p")).rejects.toMatchObject({
      name: "ApiError",
      status: 409,
      code: "DAEMON_SESSION_TURN_CONFLICT",
    });
  });
});

describe("interruptSession", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("POST /sessions/{id}/interrupt，无 body", async () => {
    const fetchMock = mockFetch({
      session_id: "s1",
      status: "active",
      current_run_id: "run-x",
    });
    const result = await interruptSession("s1");
    expect(result.current_run_id).toBe("run-x");
    const { url, init } = fetchCall(fetchMock);
    expect(url).toContain("/api/daemon/sessions/s1/interrupt");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });

  it("409 no-current-run 抛 ApiError（session 仍 active 语义由 UI 处理）", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "DAEMON_SESSION_NO_CURRENT_RUN",
          message: "no run",
          request_id: null,
          details: null,
        }),
        { status: 409 },
      ),
    );
    await expect(interruptSession("s")).rejects.toMatchObject({
      status: 409,
      code: "DAEMON_SESSION_NO_CURRENT_RUN",
    });
  });
});

describe("endSession", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("POST /sessions/{id}/end，无 body，返回 ended status", async () => {
    const fetchMock = mockFetch({
      session_id: "s1",
      status: "ended",
      current_run_id: null,
    });
    const result = await endSession("s1");
    expect(result.status).toBe("ended");
    const { url, init } = fetchCall(fetchMock);
    expect(url).toContain("/api/daemon/sessions/s1/end");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* streamSession SSE client (task-06 envelope)                        */
/* ------------------------------------------------------------------ */

/**
 * fake EventSource：jsdom 不实现 EventSource。
 *
 * P0-1（2026-06-18）：backend stream_session_logs 对 turn/log/permission_* 统一发
 * 默认 data 帧（无 `event:` 行），前端用 onmessage 接收。本 fake 的 emit 因此
 * 默认走 onmessage 通道（与真实 EventSource 一致），同时保留命名事件分发
 * （addEventLister）以兼容 backend `event: done`/`event: error` 命名通道。
 */
class FakeEventSource {
  static lastInstance: FakeEventSource | null = null;
  static instances: FakeEventSource[] = [];
  url: string;
  listeners: Record<string, Array<(e: { data: string; lastEventId?: string }) => void>> = {};
  onmessage: ((e: { data: string; lastEventId?: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
    FakeEventSource.lastInstance = this;
  }

  addEventListener(type: string, handler: (e: { data: string; lastEventId?: string }) => void) {
    (this.listeners[type] ??= []).push(handler);
  }
  removeEventListener(type: string, handler: (e: { data: string }) => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((h) => h !== handler);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }

  /**
   * 测试工具：派发事件。默认通道 = onmessage（与 backend default data: 帧一致）；
   * type="done"/"error" 时走命名事件通道（backend `event: done`/`event: error`）。
   */
  emit(type: string, data: unknown, lastEventId?: string) {
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    const evt = { data: payload, lastEventId };
    if (type === "done" || type === "error") {
      for (const h of this.listeners[type] ?? []) h(evt);
    } else {
      // default 帧 → onmessage
      this.onmessage?.(evt);
    }
  }
}

describe("streamSession", () => {
  beforeEach(() => {
    vi.stubGlobal("EventSource", FakeEventSource);
    FakeEventSource.instances = [];
    FakeEventSource.lastInstance = null;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("通过 onmessage 收 default data 帧并按 parsed.event 分发 turn_started/log/turn_completed", () => {
    const handlers: SessionStreamHandlers = {
      onTurnStarted: vi.fn(),
      onLog: vi.fn(),
      onTurnCompleted: vi.fn(),
      onSessionEnded: vi.fn(),
      onError: vi.fn(),
    };
    const conn = streamSession("sess-1", handlers);
    const es = FakeEventSource.lastInstance!;
    expect(es).toBeTruthy();

    const ts: SessionStreamEnvelope = {
      event: "turn_started", session_id: "sess-1", run_id: "run-1", turn: 1,
      log_id: null, timestamp: "t", channel: null, content: null, status: null,
      exit_code: null, reason: null,
    };
    es.emit("turn_started", ts);
    expect(handlers.onTurnStarted).toHaveBeenCalledTimes(1);
    expect((handlers.onTurnStarted as any).mock.calls[0][0].run_id).toBe("run-1");

    const logEvt: SessionStreamEnvelope = {
      event: "log", session_id: "sess-1", run_id: "run-1", turn: 1,
      log_id: "log-1", timestamp: "t", channel: "stdout", content: "hello",
      status: null, exit_code: null, reason: null,
    };
    es.emit("log", logEvt, "log-1");
    expect(handlers.onLog).toHaveBeenCalledTimes(1);
    const logArgs = (handlers.onLog as any).mock.calls[0];
    expect(logArgs[0].content).toBe("hello");
    expect(logArgs[1]).toBe("log-1"); // cursor = lastEventId

    // turn_completed 不 close
    es.emit("turn_completed", { ...ts, event: "turn_completed", status: "completed" });
    expect(handlers.onTurnCompleted).toHaveBeenCalledTimes(1);
    expect(es.closed).toBe(false);

    conn.close();
  });

  // P0-1 防回归：backend stream_session_logs 对 turn/log 用 default data 帧（无 event: 行），
  // 前端若误用 addEventListener 命名事件则收不到。本测试用真实 EventSource 行为模拟：
  // 即便 backend 不发 `event:` 行（只发 `data:`），onmessage 仍能按 parsed.event 分发。
  it("P0-1 防回归：raw `data:` 帧（无 event: 行）经 onmessage 按 parsed.event 正确分发", () => {
    const handlers: SessionStreamHandlers = {
      onTurnStarted: vi.fn(),
      onLog: vi.fn(),
      onTurnCompleted: vi.fn(),
      onSessionEnded: vi.fn(),
      onError: vi.fn(),
    };
    streamSession("sess-1", handlers);
    const es = FakeEventSource.lastInstance!;

    // 模拟 backend 真实默认 data 帧（FakeEventSource.emit 非 done/error 走 onmessage）
    // turn_started
    es.emit("turn_started", {
      event: "turn_started", session_id: "sess-1", run_id: "run-x", turn: 1,
      log_id: null, timestamp: null, channel: null, content: null,
      status: null, exit_code: null, reason: null,
    });
    expect(handlers.onTurnStarted).toHaveBeenCalledTimes(1);

    // log
    es.emit("log", {
      event: "log", session_id: "sess-1", run_id: "run-x", turn: 1,
      log_id: "lg-1", timestamp: null, channel: "stdout", content: "hi",
      status: null, exit_code: null, reason: null,
    });
    expect(handlers.onLog).toHaveBeenCalledTimes(1);

    // turn_completed
    es.emit("turn_completed", {
      event: "turn_completed", session_id: "sess-1", run_id: "run-x",
      turn: 1, log_id: null, timestamp: null, channel: null, content: null,
      status: "completed", exit_code: 0, reason: null,
    });
    expect(handlers.onTurnCompleted).toHaveBeenCalledTimes(1);
  });

  it("session_ended 调 onSessionEnded 后 close（幂等，回调最多一次）", () => {
    const handlers: SessionStreamHandlers = {
      onTurnStarted: vi.fn(),
      onLog: vi.fn(),
      onTurnCompleted: vi.fn(),
      onSessionEnded: vi.fn(),
      onError: vi.fn(),
    };
    const conn = streamSession("sess-1", handlers);
    const es = FakeEventSource.lastInstance!;
    const endEvt: SessionStreamEnvelope = {
      event: "session_ended", session_id: "sess-1", run_id: null, turn: null,
      log_id: null, timestamp: "t", channel: null, content: null, status: "ended",
      exit_code: null, reason: "user_end",
    };
    es.emit("session_ended", endEvt);
    es.emit("session_ended", endEvt); // 重复
    expect(handlers.onSessionEnded).toHaveBeenCalledTimes(1);
    expect(es.closed).toBe(true);
    conn.close();
  });

  it("session_id 不匹配的事件 → onError（不写 UI）", () => {
    const handlers: SessionStreamHandlers = {
      onTurnStarted: vi.fn(),
      onLog: vi.fn(),
      onTurnCompleted: vi.fn(),
      onSessionEnded: vi.fn(),
      onError: vi.fn(),
    };
    streamSession("sess-1", handlers);
    const es = FakeEventSource.lastInstance!;
    es.emit("turn_started", {
      event: "turn_started", session_id: "OTHER", run_id: "r",
      turn: null, log_id: null, timestamp: null, channel: null, content: null,
      status: null, exit_code: null, reason: null,
    });
    expect(handlers.onTurnStarted).not.toHaveBeenCalled();
    expect(handlers.onError).toHaveBeenCalled();
  });

  it("turn_started/log/turn_completed 缺 run_id → onError", () => {
    const handlers: SessionStreamHandlers = {
      onTurnStarted: vi.fn(),
      onLog: vi.fn(),
      onTurnCompleted: vi.fn(),
      onSessionEnded: vi.fn(),
      onError: vi.fn(),
    };
    streamSession("sess-1", handlers);
    const es = FakeEventSource.lastInstance!;
    es.emit("log", {
      event: "log", session_id: "sess-1", run_id: null,
      turn: null, log_id: null, timestamp: null, channel: null, content: null,
      status: null, exit_code: null, reason: null,
    });
    expect(handlers.onLog).not.toHaveBeenCalled();
    expect(handlers.onError).toHaveBeenCalled();
  });

  it("非法 JSON → onError，不泄露原始 payload", () => {
    const handlers: SessionStreamHandlers = {
      onTurnStarted: vi.fn(),
      onLog: vi.fn(),
      onTurnCompleted: vi.fn(),
      onSessionEnded: vi.fn(),
      onError: vi.fn(),
    };
    streamSession("sess-1", handlers);
    const es = FakeEventSource.lastInstance!;
    es.emit("turn_started", "{not json");
    expect(handlers.onError).toHaveBeenCalledTimes(1);
    const msg = (handlers.onError as any).mock.calls[0][0].message as string;
    expect(msg).not.toContain("{not json");
  });

  it("URL 含 token + session id 编码，cursor 可选", () => {
    const handlers: SessionStreamHandlers = {
      onTurnStarted: vi.fn(),
      onLog: vi.fn(),
      onTurnCompleted: vi.fn(),
      onSessionEnded: vi.fn(),
      onError: vi.fn(),
    };
    streamSession("sess a/b", handlers, { cursor: "log-99" });
    const es = FakeEventSource.lastInstance!;
    expect(es.url).toContain("/api/daemon/sessions/sess%20a%2Fb/stream");
    expect(es.url).toContain("token=test-token");
    expect(es.url).toContain("cursor=log-99");
  });

  it("getLastEventId 反映最近一次 log 的 lastEventId", () => {
    const handlers: SessionStreamHandlers = {
      onTurnStarted: vi.fn(),
      onLog: vi.fn(),
      onTurnCompleted: vi.fn(),
      onSessionEnded: vi.fn(),
      onError: vi.fn(),
    };
    const conn = streamSession("sess-1", handlers);
    const es = FakeEventSource.lastInstance!;
    expect(conn.getLastEventId()).toBeNull();
    es.emit("log", {
      event: "log", session_id: "sess-1", run_id: "r", turn: 1,
      log_id: "L5", timestamp: "t", channel: "stdout", content: "x",
      status: null, exit_code: null, reason: null,
    }, "L5");
    expect(conn.getLastEventId()).toBe("L5");
    conn.close();
  });
});
