// task-11（FR-10 / D-006@v1）：session REST 客户端单测。
// 2026-08-14-sessions-portal task-16：createSession/injectSession 签名扩展
//（runtime_id/agent_profile_id/llm_provider_id），model 字段移除（design §5 Wave1）。
//
// 覆盖：
//   - createSession：POST /api/daemon/sessions + JSON body + provider/prompt +
//     新参数序列化（runtime_id/agent_profile_id/llm_provider_id）；
//   - injectSession：POST /sessions/{id}/inject + body {prompt}（+可选切换参数，
//     llm_provider_id 空串 "none" 语义=切回本机默认）+ 编码 session id；
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

  it("POST /api/daemon/sessions，body 含 provider/prompt", async () => {
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
    });

    expect(result).toEqual(resp);
    const { url, init } = fetchCall(fetchMock);
    expect(url).toContain("/api/daemon/sessions");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.provider).toBe("claude");
    expect(body.prompt).toBe("hello");
    // model 字段已移除（design §5 Wave1：由档案/默认派生），body 不携带。
    expect(body).not.toHaveProperty("model");
  });

  it("新参数 runtime_id/agent_profile_id/llm_provider_id 序列化进 body（task-16）", async () => {
    mockFetch({
      session_id: "s",
      run_id: "r",
      lease_id: "l",
      status: "active",
      stream_url: "u",
    });
    await createSession({
      prompt: "hi",
      runtime_id: "rt-1",
      agent_profile_id: "ap-1",
      llm_provider_id: "lp-1",
    });
    const init = (vi.mocked(globalThis.fetch).mock.calls[0]![1] ?? {}) as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.runtime_id).toBe("rt-1");
    expect(body.agent_profile_id).toBe("ap-1");
    expect(body.llm_provider_id).toBe("lp-1");
    // runtime_id 路径（新页面）可以不带 provider。
    expect(body).not.toHaveProperty("provider");
  });

  it("不传新参数时 body 与现状一致（/runtimes 弹窗零回归）", async () => {
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
    expect(body).toEqual({ provider: "codex", prompt: "hi" });
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
    // 2026-08-26-session-input-mention task-08（FR-06 / D-003）：不使用联想绑定时
    // bind 字段缺省不下发——请求体零变化（对齐 page_context 有值才带形态）。
    expect(body).not.toHaveProperty("bind_change_key");
    expect(body).not.toHaveProperty("bind_quick_id");
  });

  it("options 携带切换参数时序列化进 body（task-16 / FR-02）", async () => {
    const fetchMock = mockFetch({
      session_id: "s1",
      run_id: "run-3",
      status: "active",
    });
    await injectSession("s1", "switch please", {
      agent_profile_id: "ap-2",
      llm_provider_id: "lp-2",
    });
    const { init } = fetchCall(fetchMock);
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      prompt: "switch please",
      agent_profile_id: "ap-2",
      llm_provider_id: "lp-2",
    });
  });

  it("llm_provider_id 空串（\"none\" 语义=切回本机默认）仍下发该字段", async () => {
    mockFetch({
      session_id: "s1",
      run_id: "run-4",
      status: "active",
    });
    await injectSession("s1", "back to local", { llm_provider_id: "" });
    const init = (vi.mocked(globalThis.fetch).mock.calls[0]![1] ?? {}) as RequestInit;
    const body = JSON.parse(init.body as string);
    // 空串必须作为字段下发（backend 置 NULL），不能被真值判断吞掉。
    expect(body).toHaveProperty("llm_provider_id", "");
    expect(body).not.toHaveProperty("agent_profile_id");
  });

  // 2026-08-26-session-input-mention task-08（FR-06 / D-003）：@ 关联的会话绑定
  // 字段随 inject 下发（后端 binder 幂等写 M:N link）；与其它可选字段一样
  // 有值才带，business 接线（7 发送点位）归 task-05。
  it("options 携带 bind_change_key/bind_quick_id 时序列化进 body（task-08 / FR-06）", async () => {
    const fetchMock = mockFetch({
      session_id: "s1",
      run_id: "run-b",
      status: "active",
    });
    await injectSession("s1", "看看这个变更", {
      bind_change_key: "2026-08-26-session-input-mention",
      bind_quick_id: "ql-20260826-001",
    });
    const { init } = fetchCall(fetchMock);
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      prompt: "看看这个变更",
      bind_change_key: "2026-08-26-session-input-mention",
      bind_quick_id: "ql-20260826-001",
    });
  });

  it("bind 字段与既有可选字段混发时互不干扰（bind 分支独立）", async () => {
    const fetchMock = mockFetch({
      session_id: "s1",
      run_id: "run-c",
      status: "active",
    });
    await injectSession("s1", "切换并关联", {
      agent_profile_id: "ap-3",
      bind_quick_id: "ql-20260826-002",
    });
    const { init } = fetchCall(fetchMock);
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      prompt: "切换并关联",
      agent_profile_id: "ap-3",
      bind_quick_id: "ql-20260826-002",
    });
    // 只带 quick 绑定时 change 绑定不下发。
    expect(body).not.toHaveProperty("bind_change_key");
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
  /** ql-20260820-009 重连测试用：模拟服务端正常断开（reader done → onerror）。 */
  close?: () => void;
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

/* ------------------------------------------------------------------ */
/* streamSession 断线重连（ql-20260820-009：退避 + 全量回放 + 终态合成） */
/* ------------------------------------------------------------------ */

describe("streamSession 断线重连（ql-20260820-009）", () => {
  /** 路由 fetch：/stream → 可控 SSE 流；/runs、/logs → JSON 固件。 */
  let runsFixture: Array<Record<string, unknown>>;
  let logsFixture: Array<Record<string, unknown>>;
  /** P4：捕获 /logs 请求 URL（断言 after 增量游标）。 */
  const logsFetchUrls: string[] = [];

  function installRoutingFetchMock(): void {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (input: URL | RequestInfo, init?: RequestInit) => {
        const u = typeof input === "string" ? input : input.toString();
        if (u.includes("/stream")) {
          let controller!: ReadableStreamDefaultController<Uint8Array>;
          const body = new ReadableStream<Uint8Array>({
            start(c) {
              controller = c;
            },
          });
          const encoder = new TextEncoder();
          streams.push({
            url: u,
            init: (init ?? {}) as RequestInit,
            push: (text) => controller.enqueue(encoder.encode(text)),
            close: () => controller.close(),
          });
          lastStream = streams[streams.length - 1]!;
          return Promise.resolve(
            new Response(body, {
              status: 200,
              headers: { "Content-Type": "text/event-stream" },
            }),
          );
        }
        const payload = u.includes("/runs") ? runsFixture : logsFixture;
        if (u.includes("/logs")) logsFetchUrls.push(u);
        return Promise.resolve(
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      },
    );
  }

  /** 终态 run 快照（r-1 completed）+ 两条日志（断连前后各一）。 */
  function seedFixtures(): void {
    runsFixture = [
      {
        id: "r-1",
        status: "completed",
        error_code: null,
        error_detail: null,
        started_at: "2026-08-20T02:00:00Z",
        finished_at: "2026-08-20T02:01:00Z",
        exit_code: 0,
        agent_profile_snapshot: null,
        llm_provider_id: null,
        input_tokens: 10,
        output_tokens: 2,
        user_id: null,
        sender_name: null,
      },
    ];
    logsFixture = [
      {
        id: "log-1",
        run_id: "r-1",
        timestamp: "2026-08-20T02:00:10Z",
        channel: "stdout",
        content_redacted: "断连前已见",
        parent_tool_use_id: null,
        subagent_type: null,
        depth: null,
        tool_kind: null,
      },
      {
        id: "log-2",
        run_id: "r-1",
        timestamp: "2026-08-20T02:00:40Z",
        channel: "stdout",
        content_redacted: "断连期间新增",
        parent_tool_use_id: null,
        subagent_type: null,
        depth: null,
        tool_kind: null,
      },
    ];
  }

  function makeHandlers(): SessionStreamHandlers {
    return {
      onTurnStarted: vi.fn(),
      onLog: vi.fn(),
      onTurnCompleted: vi.fn(),
      onSessionEnded: vi.fn(),
      onError: vi.fn(),
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    streams.length = 0;
    lastStream = null;
    logsFetchUrls.length = 0;
    seedFixtures();
    installRoutingFetchMock();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("断流 → 1s 退避重连：回放全量日志（含断连缺口）+ 终态 run 合成 turn_completed + 重建 SSE", async () => {
    const handlers = makeHandlers();
    const conn = streamSession("sess-1", handlers);
    await vi.advanceTimersByTimeAsync(0);
    expect(streams).toHaveLength(1);

    // 断连前收到一条实时日志
    emitDefault(
      streams[0]!,
      {
        event: "log", session_id: "sess-1", run_id: "r-1", turn: 1,
        log_id: "log-1", timestamp: "t", channel: "stdout", content: "断连前已见",
        status: null, exit_code: null, reason: null,
      },
      "log-1",
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(handlers.onLog).toHaveBeenCalledTimes(1);

    // 服务端断开 → fetch-sse onerror → 1s 退避后 resync + 重连
    streams[0]!.close!();
    await vi.advanceTimersByTimeAsync(1000);

    // 回放：全量日志经 onLog 分发（去重由调用方 seenLogIds 负责）
    const logContents = (handlers.onLog as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => (c[0] as { content: string | null }).content,
    );
    expect(logContents).toContain("断连期间新增");
    // 终态 run 合成 turn_completed（status/tokens 对齐快照）
    expect(handlers.onTurnCompleted).toHaveBeenCalledTimes(1);
    const tc = (handlers.onTurnCompleted as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as SessionStreamEnvelope;
    expect(tc.run_id).toBe("r-1");
    expect(tc.status).toBe("completed");
    expect(tc.input_tokens).toBe(10);
    // 终态 run 不合成 turn_started
    expect(handlers.onTurnStarted).not.toHaveBeenCalled();
    // 重连建立了第二条 SSE 连接
    expect(streams).toHaveLength(2);

    conn.close();
  });

  it("重连后 5s 延迟复核：再次合成终态（幂等，页面侧终态守卫消化）", async () => {
    const handlers = makeHandlers();
    const conn = streamSession("sess-1", handlers);
    await vi.advanceTimersByTimeAsync(0);
    streams[0]!.close!();
    await vi.advanceTimersByTimeAsync(1000);
    expect(handlers.onTurnCompleted).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(handlers.onTurnCompleted).toHaveBeenCalledTimes(2);
    conn.close();
  });

  it("P4 增量回放：已有游标时断连重连只拉 after=游标-2s 的增量（首次仍全量）", async () => {
    const handlers = makeHandlers();
    const conn = streamSession("sess-1", handlers);
    await vi.advanceTimersByTimeAsync(0);
    expect(streams).toHaveLength(1);
    // 尚无游标 → 首次（如有）拉取不带 after
    const initialUrls = [...logsFetchUrls];

    // 直播收到一条带真实 ISO 时间戳的日志 → 游标 = 2026-08-20T02:00:20Z
    emitDefault(
      streams[0]!,
      {
        event: "log", session_id: "sess-1", run_id: "r-1", turn: 1,
        log_id: "log-1", timestamp: "2026-08-20T02:00:20Z", channel: "stdout",
        content: "已见", status: null, exit_code: null, reason: null,
      },
      "log-1",
    );
    await vi.advanceTimersByTimeAsync(0);

    // 断连 → 1s 退避 resync：/logs 请求带 after=游标-2s（重叠窗口兜同批同 timestamp 边界）
    streams[0]!.close!();
    await vi.advanceTimersByTimeAsync(1000);

    const incrementalUrl = logsFetchUrls.find(
      (u) => u !== undefined && u.includes("after="),
    );
    expect(incrementalUrl).toBeTruthy();
    expect(incrementalUrl).toContain("sessions/sess-1/logs");
    expect(decodeURIComponent(incrementalUrl!)).toContain("2026-08-20T02:00:18"); // 20Z - 2s

    // 首次（连接前无游标）不应有带 after 的请求
    expect(initialUrls.every((u) => !u.includes("after="))).toBe(true);
    conn.close();
  });

  it("close() 后断流不重连（无新增连接、无 runs/logs 拉取）", async () => {
    const handlers = makeHandlers();
    const conn = streamSession("sess-1", handlers);
    await vi.advanceTimersByTimeAsync(0);
    conn.close();
    const fetchCount = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    streams[0]!.close!();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(streams).toHaveLength(1);
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      fetchCount,
    );
  });

  it("session_ended 事件后不再重连", async () => {
    const handlers = makeHandlers();
    const conn = streamSession("sess-1", handlers);
    await vi.advanceTimersByTimeAsync(0);
    emitDefault(streams[0]!, {
      event: "session_ended", session_id: "sess-1", run_id: null, turn: null,
      log_id: null, timestamp: "t", channel: null, content: null, status: "ended",
      exit_code: null, reason: null,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(handlers.onSessionEnded).toHaveBeenCalledTimes(1);
    expect(streams).toHaveLength(1); // 未重连
    conn.close();
  });

  it("轮后对账（ql-20260820-010）：连接未断、turn_completed 已到 → 1.5s 后重拉日志补发布丢失的尾部文本", async () => {
    const handlers = makeHandlers();
    const conn = streamSession("sess-1", handlers);
    await vi.advanceTimersByTimeAsync(0);
    // 直播收到 turn_completed（连接活着），但最终文本 log 事件从未经 SSE 到达
    // （DB 已有：log-2「断连期间新增」= 发布丢失场景）。
    emitDefault(streams[0]!, {
      event: "turn_completed", session_id: "sess-1", run_id: "r-1", turn: 1,
      log_id: null, timestamp: "t", channel: null, content: null,
      status: "completed", exit_code: 0, reason: null,
      input_tokens: 10, output_tokens: 2,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(handlers.onTurnCompleted).toHaveBeenCalledTimes(1);
    const live = (handlers.onLog as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => (c[0] as { content: string | null }).content,
    );
    expect(live).not.toContain("断连期间新增");

    // 1.5s 对账窗口后从 DB 补回（不重连、不发 turn 事件，仅回放 log）
    await vi.advanceTimersByTimeAsync(1500);
    const after = (handlers.onLog as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => (c[0] as { content: string | null }).content,
    );
    expect(after).toContain("断连期间新增");
    expect(streams).toHaveLength(1); // 连接从未断开
    expect(handlers.onTurnCompleted).toHaveBeenCalledTimes(1); // 无重复合成
    conn.close();
  });
});

/* ------------------------------------------------------------------ */
/* streamSession resync REST 超时（F7：TCP 挂起不卡死重连循环）       */
/* ------------------------------------------------------------------ */

describe("streamSession resync REST 超时（F7）", () => {
  // describe 体在收集期执行（fake timers 安装前）——此刻捕获真实 setTimeout，
  // 供 AbortSignal.timeout（原生计时，不受 fake timers 控制）路径做真实等待。
  const realSetTimeout = globalThis.setTimeout.bind(globalThis);

  beforeEach(() => {
    vi.useFakeTimers();
    streams.length = 0;
    lastStream = null;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("resync 快照拉取永挂起 → 注入毫秒级超时 abort → 失败退避分支继续重连循环", async () => {
    // /runs、/logs 永挂起（模拟 TCP 半开）：仅响应 RequestInit.signal 的 abort
    const restCalls: Array<RequestInit | undefined> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
        const u = typeof input === "string" ? input : input.toString();
        if (u.includes("/stream")) {
          let controller!: ReadableStreamDefaultController<Uint8Array>;
          const body = new ReadableStream<Uint8Array>({
            start(c) {
              controller = c;
            },
          });
          const encoder = new TextEncoder();
          const stream: FakeSseStream = {
            url: u,
            init: (init ?? {}) as RequestInit,
            push: (text) => controller.enqueue(encoder.encode(text)),
            close: () => controller.close(),
          };
          streams.push(stream);
          lastStream = stream;
          return Promise.resolve(
            new Response(body, {
              status: 200,
              headers: { "Content-Type": "text/event-stream" },
            }),
          );
        }
        restCalls.push(init);
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(new Error("The operation was aborted"));
          } else if (signal) {
            signal.addEventListener("abort", () =>
              reject(new Error("The operation was aborted")),
            );
          }
        });
      },
    );

    const handlers: SessionStreamHandlers = {
      onTurnStarted: vi.fn(),
      onLog: vi.fn(),
      onTurnCompleted: vi.fn(),
      onSessionEnded: vi.fn(),
      onError: vi.fn(),
    };
    // 测试注入 30ms 超时（生产默认 10s，经 streamSession options 覆盖）
    const conn = streamSession("sess-1", handlers, { resyncTimeoutMs: 30 });
    await vi.advanceTimersByTimeAsync(0);
    expect(streams).toHaveLength(1);

    // 断连 → 1s 退避 → resync 发起（/runs 挂起）
    streams[0]!.close!();
    await vi.advanceTimersByTimeAsync(1000);
    expect(restCalls.length).toBe(1);
    expect(restCalls[0]?.signal).toBeInstanceOf(AbortSignal);

    // 30ms 超时为原生计时（AbortSignal.timeout）：真实等待触发 abort → resync
    // 失败 → 退避分支。退化路径（环境无 AbortSignal.timeout，手动 AbortController
    // 走 fake timers）由下方 advance 兜住，两路都能推进断言。
    await new Promise<void>((r) => realSetTimeout(r, 80));
    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(0);
    // 第二轮退避（2s 档）后重试 resync：重连循环未被卡死
    await vi.advanceTimersByTimeAsync(2000);
    expect(restCalls.length).toBe(2);
    expect(restCalls[1]?.signal).toBeInstanceOf(AbortSignal);

    conn.close();
  });
});
