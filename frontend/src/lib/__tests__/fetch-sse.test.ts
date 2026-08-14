/**
 * fetch-sse 单测（task-12 / FR-10 / D-002@v1）。
 *
 * 覆盖：
 *   - Authorization header 携带 token、URL 无 token 参数（helper 存在的理由）；
 *   - 默认 data 帧解析（onmessage）；
 *   - 多行 data 拼接（\n 连接，对齐 EventSource 规范）；
 *   - 命名事件（event: 行 → addEventListener 分发，不进 onmessage）；
 *   - id: 行 → lastEventId 透出；
 *   - 注释行（`: connected` 心跳）忽略、不分发；
 *   - 跨 chunk 断帧拼接（半行 + 半帧）；
 *   - onopen 时点（response.ok 后、首帧前）；
 *   - 非 2xx → onerror({status})；
 *   - close() / AbortSignal 断流（不再分发后续帧）；
 *   - 流正常结束 → onerror（对齐 EventSource 断连行为，不自动重连）。
 */

import { describe, it, expect, vi, afterEach } from "vitest";

import { fetchSse, parseSseChunk } from "../fetch-sse";

/** 构造一个 body 可分多次 push、可手动关闭的 fetch Response。 */
function sseResponse(): {
  response: Response;
  push: (text: string) => void;
  end: () => void;
} {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const encoder = new TextEncoder();
  return {
    response: new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }),
    push: (text) => controller.enqueue(encoder.encode(text)),
    end: () => controller.close(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseSseChunk（纯解析）", () => {
  it("默认 data 帧 → event='' + data", () => {
    const { frames, rest } = parseSseChunk('data: {"a":1}\n\n');
    expect(rest).toBe("");
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ event: "", data: '{"a":1}' });
  });

  it("多行 data 以 \\n 拼接", () => {
    const { frames } = parseSseChunk("data: line1\ndata: line2\n\n");
    expect(frames[0]!.data).toBe("line1\nline2");
  });

  it("命名事件 event: 行 + id: 行", () => {
    const { frames } = parseSseChunk("event: done\nid: 42\ndata: {}\n\n");
    expect(frames[0]).toMatchObject({ event: "done", data: "{}", id: "42" });
  });

  it("注释行忽略；纯注释帧不派发", () => {
    const { frames } = parseSseChunk(": connected\n: keepalive\n\n");
    expect(frames).toHaveLength(0);
  });

  it("无 data 行的帧不派发", () => {
    const { frames } = parseSseChunk("event: ping\n\n");
    expect(frames).toHaveLength(0);
  });

  it("尾部半行交还 rest，完整帧仍派发", () => {
    const { frames, rest } = parseSseChunk('data: full\n\ndata: par');
    expect(frames).toHaveLength(1);
    expect(frames[0]!.data).toBe("full");
    expect(rest).toBe("data: par");
  });

  it("\\r\\n 行尾剥 CR（CRLF 容忍）", () => {
    const { frames } = parseSseChunk("data: crlf\r\n\r\n");
    expect(frames[0]!.data).toBe("crlf");
  });

  it("多个帧一次解析", () => {
    const { frames } = parseSseChunk("data: a\n\ndata: b\n\n");
    expect(frames.map((f) => f.data)).toEqual(["a", "b"]);
  });
});

describe("fetchSse（fetch 流）", () => {
  it("token 走 Authorization header，URL 不含 token", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(sseResponse().response);
    const conn = fetchSse("http://localhost/api/sse?after=log-1", {
      token: "secret-jwt",
    });
    conn.close();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).not.toContain("token=");
    expect(String(url)).not.toContain("secret-jwt");
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer secret-jwt",
    );
    expect((init?.headers as Record<string, string>).Accept).toBe(
      "text/event-stream",
    );
  });

  it("默认 data 帧 → onmessage；id 透出 lastEventId", async () => {
    const sse = sseResponse();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(sse.response);
    const onmessage = vi.fn();
    const conn = fetchSse("http://localhost/sse");
    conn.onmessage = onmessage;

    await vi.waitFor(() => expect(conn.readyState).toBe(1));
    sse.push('id: log-1\ndata: {"event":"log"}\n\n');
    await vi.waitFor(() => expect(onmessage).toHaveBeenCalledTimes(1));
    expect(onmessage.mock.calls[0]![0]).toEqual({
      data: '{"event":"log"}',
      lastEventId: "log-1",
    });
    // id 记忆：后续无 id 帧沿用上一个 id（对齐 EventSource）
    sse.push('data: {"x":1}\n\n');
    await vi.waitFor(() => expect(onmessage).toHaveBeenCalledTimes(2));
    expect(onmessage.mock.calls[1]![0].lastEventId).toBe("log-1");
    sse.end();
    conn.close();
  });

  it("命名事件走 addEventListener，不进 onmessage", async () => {
    const sse = sseResponse();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(sse.response);
    const onDone = vi.fn();
    const onmessage = vi.fn();
    const conn = fetchSse("http://localhost/sse");
    conn.onmessage = onmessage;
    conn.addEventListener("done", onDone);

    await vi.waitFor(() => expect(conn.readyState).toBe(1));
    sse.push('event: done\ndata: {"status":"completed"}\n\n');
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(onDone.mock.calls[0]![0].data).toBe('{"status":"completed"}');
    expect(onmessage).not.toHaveBeenCalled();
    conn.close();
    sse.end();
  });

  it("注释行（: connected 心跳）不分发，但 onopen 已触发", async () => {
    const sse = sseResponse();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(sse.response);
    const onopen = vi.fn();
    const onmessage = vi.fn();
    const conn = fetchSse("http://localhost/sse");
    conn.onopen = onopen;
    conn.onmessage = onmessage;

    await vi.waitFor(() => expect(onopen).toHaveBeenCalledTimes(1));
    sse.push(": connected\n\n");
    await new Promise((r) => setTimeout(r, 20));
    expect(onmessage).not.toHaveBeenCalled();
    conn.close();
    sse.end();
  });

  it("跨 chunk 半帧拼接（帧被 TCP 分段切开）", async () => {
    const sse = sseResponse();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(sse.response);
    const onmessage = vi.fn();
    const conn = fetchSse("http://localhost/sse");
    conn.onmessage = onmessage;

    await vi.waitFor(() => expect(conn.readyState).toBe(1));
    sse.push('data: {"event":"log","con');
    sse.push('tent":"hi"}\n');
    sse.push("\n");
    await vi.waitFor(() => expect(onmessage).toHaveBeenCalledTimes(1));
    expect(onmessage.mock.calls[0]![0].data).toBe('{"event":"log","content":"hi"}');
    conn.close();
    sse.end();
  });

  it("非 2xx → onerror({status})，不触发 onopen", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("unauth", { status: 401 }),
    );
    const onopen = vi.fn();
    const onerror = vi.fn();
    const conn = fetchSse("http://localhost/sse", { token: "t" });
    conn.onopen = onopen;
    conn.onerror = onerror;

    await vi.waitFor(() => expect(onerror).toHaveBeenCalledTimes(1));
    expect(onerror.mock.calls[0]![0]).toEqual({ status: 401 });
    expect(onopen).not.toHaveBeenCalled();
    expect(conn.readyState).toBe(2);
  });

  it("close() 后不再分发帧（组件卸载断流）", async () => {
    const sse = sseResponse();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(sse.response);
    const onmessage = vi.fn();
    const conn = fetchSse("http://localhost/sse");
    conn.onmessage = onmessage;

    await vi.waitFor(() => expect(conn.readyState).toBe(1));
    conn.close();
    sse.push('data: after-close\n\n');
    await new Promise((r) => setTimeout(r, 20));
    expect(onmessage).not.toHaveBeenCalled();
    expect(conn.readyState).toBe(2);
    sse.end();
  });

  it("外部 AbortSignal abort → 断流且不触发 onerror", async () => {
    const sse = sseResponse();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(sse.response);
    const onerror = vi.fn();
    const ac = new AbortController();
    const conn = fetchSse("http://localhost/sse", { signal: ac.signal });
    conn.onerror = onerror;

    await vi.waitFor(() => expect(conn.readyState).toBe(1));
    ac.abort();
    await new Promise((r) => setTimeout(r, 20));
    expect(conn.readyState).toBe(2);
    expect(onerror).not.toHaveBeenCalled();
    sse.end();
  });

  it("流正常结束（backend 关闭）→ onerror（对齐 EventSource 断连，不自动重连）", async () => {
    const sse = sseResponse();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(sse.response);
    const onerror = vi.fn();
    const conn = fetchSse("http://localhost/sse");
    conn.onerror = onerror;

    await vi.waitFor(() => expect(conn.readyState).toBe(1));
    sse.end();
    await vi.waitFor(() => expect(onerror).toHaveBeenCalledTimes(1));
    expect(conn.readyState).toBe(2);
    conn.close();
  });
});
