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
 * task-12：streamSession 底层从 EventSource 改为 fetch-sse（token 走
 * Authorization header），mock 体系随之从 FakeEventSource 改为
 * fetch + ReadableStream：每次 fetch 返回一个可手动 push 的 SSE 流，
 * 测试往流里写 ``data: {...}\n\n`` 原始帧（与 backend 输出形态一致）。
 *
 * 仍保留 P0-1 语义：turn/log/permission_* 统一发默认 data 帧（无 ``event:``
 * 行），经 onmessage 按 parsed.event 分发；done/error 走命名事件。
 */
interface FakeSseStream {
  url: string;
  init: RequestInit;
  push: (text: string) => void;
}

const streams: FakeSseStream[] = [];
let lastStream: FakeSseStream | null = null;

function installSseFetchMock(): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(
    (input: URL | RequestInfo, init?: RequestInit) => {
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          controller = c;
        },
      });
      const encoder = new TextEncoder();
      const stream: FakeSseStream = {
        url: typeof input === "string" ? input : input.toString(),
        init: (init ?? {}) as RequestInit,
        push: (text) => controller.enqueue(encoder.encode(text)),
      };
      streams.push(stream);
      lastStream = stream;
      return Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      );
    },
  );
}

/** 推一条默认 data 帧（无 event: 行，对齐 backend stream_session_logs）。 */
function emitDefault(stream: FakeSseStream, data: unknown, id?: string) {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  stream.push(`${id ? `id: ${id}\n` : ""}data: ${payload}\n\n`);
}

/** 微任务冲刷：等 fetch-sse reader 循环消化完已 push 的帧。 */
async function flushSse(times = 3) {
  for (let i = 0; i < times; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

describe("streamSession", () => {
  beforeEach(() => {
    installSseFetchMock();
    streams.length = 0;
    lastStream = null;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("通过 onmessage 收 default data 帧并按 parsed.event 分发 turn_started/log/turn_completed", async () => {
    const handlers: SessionStreamHandlers = {
      onTurnStarted: vi.fn(),
      onLog: vi.fn(),
      onTurnCompleted: vi.fn(),
      onSessionEnded: vi.fn(),
      onError: vi.fn(),
    };
    const conn = streamSession("sess-1", handlers);
    await flushSse();
    const es = lastStream!;
    expect(es).toBeTruthy();

    const ts: SessionStreamEnvelope = {
      event: "turn_started", session_id: "sess-1", run_id: "run-1", turn: 1,
      log_id: null, timestamp: "t", channel: null, content: null, status: null,
      exit_code: null, reason: null,
    };
    emitDefault(es, ts);
    await flushSse();
    expect(handlers.onTurnStarted).toHaveBeenCalledTimes(1);
    expect((handlers.onTurnStarted as any).mock.calls[0][0].run_id).toBe("run-1");

    const logEvt: SessionStreamEnvelope = {
      event: "log", session_id: "sess-1", run_id: "run-1", turn: 1,
      log_id: "log-1", timestamp: "t", channel: "stdout", content: "hello",
      status: null, exit_code: null, reason: null,
    };
    emitDefault(es, logEvt, "log-1");
    await flushSse();
    expect(handlers.onLog).toHaveBeenCalledTimes(1);
    const logArgs = (handlers.onLog as any).mock.calls[0];
    expect(logArgs[0].content).toBe("hello");
    expect(logArgs[1]).toBe("log-1"); // cursor = lastEventId

    // turn_completed 不 close
    emitDefault(es, { ...ts, event: "turn_completed", status: "completed" });
    await flushSse();
    expect(handlers.onTurnCompleted).toHaveBeenCalledTimes(1);
    expect(conn.getLastEventId()).toBe("log-1");

    conn.close();
  });

  // P0-1 防回归：backend stream_session_logs 对 turn/log 用 default data 帧（无 event: 行），
  // 前端若只监听命名事件则收不到。本测试推真实 raw `data:` 帧，onmessage 仍能按
  // parsed.event 分发。
  it("P0-1 防回归：raw `data:` 帧（无 event: 行）经 onmessage 按 parsed.event 正确分发", async () => {
    const handlers: SessionStreamHandlers = {
      onTurnStarted: vi.fn(),
      onLog: vi.fn(),
      onTurnCompleted: vi.fn(),
      onSessionEnded: vi.fn(),
      onError: vi.fn(),
    };
    streamSession("sess-1", handlers);
    await flushSse();
    const es = lastStream!;

    // turn_started
    emitDefault(es, {
      event: "turn_started", session_id: "sess-1", run_id: "run-x", turn: 1,
      log_id: null, timestamp: null, channel: null, content: null,
      status: null, exit_code: null, reason: null,
    });
    await flushSse();
    expect(handlers.onTurnStarted).toHaveBeenCalledTimes(1);

    // log
    emitDefault(es, {
      event: "log", session_id: "sess-1", run_id: "run-x", turn: 1,
      log_id: "lg-1", timestamp: null, channel: "stdout", content: "hi",
      status: null, exit_code: null, reason: null,
    });
    await flushSse();
    expect(handlers.onLog).toHaveBeenCalledTimes(1);

    // turn_completed
    emitDefault(es, {
      event: "turn_completed", session_id: "sess-1", run_id: "run-x",
      turn: 1, log_id: null, timestamp: null, channel: null, content: null,
      status: "completed", exit_code: 0, reason: null,
    });
    await flushSse();
    expect(handlers.onTurnCompleted).toHaveBeenCalledTimes(1);
  });

  it("session_ended 调 onSessionEnded 后 close（幂等，回调最多一次）", async () => {
    const handlers: SessionStreamHandlers = {
      onTurnStarted: vi.fn(),
      onLog: vi.fn(),
      onTurnCompleted: vi.fn(),
      onSessionEnded: vi.fn(),
      onError: vi.fn(),
    };
    const conn = streamSession("sess-1", handlers);
    await flushSse();
    const es = lastStream!;
    const endEvt: SessionStreamEnvelope = {
      event: "session_ended", session_id: "sess-1", run_id: null, turn: null,
      log_id: null, timestamp: "t", channel: null, content: null, status: "ended",
      exit_code: null, reason: "user_end",
    };
    emitDefault(es, endEvt);
    emitDefault(es, endEvt); // 重复
    await flushSse();
    expect(handlers.onSessionEnded).toHaveBeenCalledTimes(1);
    expect(conn.getLastEventId()).toBeNull();
    conn.close();
  });

  it("session_id 不匹配的事件 → onError（不写 UI）", async () => {
    const handlers: SessionStreamHandlers = {
      onTurnStarted: vi.fn(),
      onLog: vi.fn(),
      onTurnCompleted: vi.fn(),
      onSessionEnded: vi.fn(),
      onError: vi.fn(),
    };
    streamSession("sess-1", handlers);
    await flushSse();
    const es = lastStream!;
    emitDefault(es, {
      event: "turn_started", session_id: "OTHER", run_id: "r",
      turn: null, log_id: null, timestamp: null, channel: null, content: null,
      status: null, exit_code: null, reason: null,
    });
    await flushSse();
    expect(handlers.onTurnStarted).not.toHaveBeenCalled();
    expect(handlers.onError).toHaveBeenCalled();
  });

  it("turn_started/log/turn_completed 缺 run_id → onError", async () => {
    const handlers: SessionStreamHandlers = {
      onTurnStarted: vi.fn(),
      onLog: vi.fn(),
      onTurnCompleted: vi.fn(),
      onSessionEnded: vi.fn(),
      onError: vi.fn(),
    };
    streamSession("sess-1", handlers);
    await flushSse();
    const es = lastStream!;
    emitDefault(es, {
      event: "log", session_id: "sess-1", run_id: null,
      turn: null, log_id: null, timestamp: null, channel: null, content: null,
      status: null, exit_code: null, reason: null,
    });
    await flushSse();
    expect(handlers.onLog).not.toHaveBeenCalled();
    expect(handlers.onError).toHaveBeenCalled();
  });

  it("非法 JSON → onError，不泄露原始 payload", async () => {
    const handlers: SessionStreamHandlers = {
      onTurnStarted: vi.fn(),
      onLog: vi.fn(),
      onTurnCompleted: vi.fn(),
      onSessionEnded: vi.fn(),
      onError: vi.fn(),
    };
    streamSession("sess-1", handlers);
    await flushSse();
    const es = lastStream!;
    // 直接推非法 JSON 单行 data 帧
    es.push("data: {not json\n\n");
    await flushSse();
    expect(handlers.onError).toHaveBeenCalledTimes(1);
    const msg = (handlers.onError as any).mock.calls[0][0].message as string;
    expect(msg).not.toContain("{not json");
  });

  it("task-12：URL 含 session id 编码 + cursor，token 走 Authorization header 不进 URL", async () => {
    const handlers: SessionStreamHandlers = {
      onTurnStarted: vi.fn(),
      onLog: vi.fn(),
      onTurnCompleted: vi.fn(),
      onSessionEnded: vi.fn(),
      onError: vi.fn(),
    };
    const conn = streamSession("sess a/b", handlers, { cursor: "log-99" });
    await flushSse();
    const es = lastStream!;
    expect(es.url).toContain("/api/daemon/sessions/sess%20a%2Fb/stream");
    expect(es.url).toContain("cursor=log-99");
    // token 绝不能出现在 URL（访问日志明文泄漏）
    expect(es.url).not.toContain("token=");
    expect(es.url).not.toContain("test-token");
    // token 在 Authorization header
    const headers = es.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-token");
    conn.close();
  });

  it("getLastEventId 反映最近一次 log 的 lastEventId", async () => {
    const handlers: SessionStreamHandlers = {
      onTurnStarted: vi.fn(),
      onLog: vi.fn(),
      onTurnCompleted: vi.fn(),
      onSessionEnded: vi.fn(),
      onError: vi.fn(),
    };
    const conn = streamSession("sess-1", handlers);
    await flushSse();
    const es = lastStream!;
    expect(conn.getLastEventId()).toBeNull();
    emitDefault(es, {
      event: "log", session_id: "sess-1", run_id: "r", turn: 1,
      log_id: "L5", timestamp: "t", channel: "stdout", content: "x",
      status: null, exit_code: null, reason: null,
    }, "L5");
    await flushSse();
    expect(conn.getLastEventId()).toBe("L5");
    conn.close();
  });
});
