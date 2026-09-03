/**
 * ql-20260829-007：终态会话 SSE 无限重连循环回归。
 *
 * backend stream_session_logs 对终态（ended/failed）会话连上即发命名事件
 * `event: done` 并关闭连接（连接时终态 race guard 与流中 session_ended 两场景）。
 * 修复前：done 是命名事件不进 onmessage/dispatch 且无人监听 → 连接关闭触发
 * onerror → 退避重连 → 秒收 done 又断 → 无限循环（终态会话打开面板时反复打
 * runs/logs/stream）。修复：streamSession 注册 addEventListener("done") 置
 * closed 终止本流。
 *
 * mock 体系与 daemon-session-stream-sync.test.ts 同款（fetch + ReadableStream
 * 假 SSE 流）。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  streamSession,
  type SessionStreamHandlers,
  type SessionStreamConnection,
} from "@/lib/daemon";

interface StreamHarness {
  streamCalls: number;
  runsCalls: number;
  logsCalls: number;
  /** 非空时 /stream 返回该状态码（永久性 HTTP 错误场景，ql-20260903-021）。 */
  streamStatus?: number;
  /** 非空时 /runs 返回该状态码（resync 阶段永久性错误场景，ql-20260904-H2）。 */
  runsStatus?: number;
  stream: {
    push: (_text: string) => void;
    close: () => void;
  } | null;
}

let harness: StreamHarness;

function installRoutedFetchMock(): void {
  harness = { streamCalls: 0, runsCalls: 0, logsCalls: 0, stream: null };
  vi.spyOn(globalThis, "fetch").mockImplementation(
    (input: URL | RequestInfo, _init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/stream")) {
        harness.streamCalls += 1;
        if (harness.streamStatus !== undefined) {
          return Promise.resolve(
            new Response(JSON.stringify({ detail: "not found" }), {
              status: harness.streamStatus,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            controller = c;
          },
        });
        const encoder = new TextEncoder();
        harness.stream = {
          push: (text) => controller.enqueue(encoder.encode(text)),
          close: () => controller.close(),
        };
        return Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          }),
        );
      }
      if (url.includes("/runs")) {
        harness.runsCalls += 1;
        if (harness.runsStatus !== undefined) {
          return Promise.resolve(
            new Response(JSON.stringify({ detail: "not found" }), {
              status: harness.runsStatus,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (url.includes("/logs")) {
        harness.logsCalls += 1;
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    },
  );
}

async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

function baseHandlers(): SessionStreamHandlers {
  return {
    onTurnStarted: vi.fn(),
    onLog: vi.fn(),
    onTurnCompleted: vi.fn(),
    onSessionEnded: vi.fn(),
    onError: vi.fn(),
  };
}

describe("streamSession — 终态 done 命名事件收口（ql-20260829-007）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installRoutedFetchMock();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("连上即 done（终态 race guard 场景）：连接关闭后不再重连", async () => {
    const conn: SessionStreamConnection = streamSession(
      "sess-ended",
      baseHandlers(),
    );
    await vi.runOnlyPendingTimersAsync();
    expect(harness.streamCalls).toBe(1);

    // backend 对终态会话的行为：connected 注释 → done 命名事件 → 关闭流。
    harness.stream!.push(": connected\n\n");
    harness
      .stream!.push(
        'event: done\ndata: {"status":"ended","reason":"session_terminated"}\n\n',
      );
    harness.stream!.close();
    await vi.runOnlyPendingTimersAsync();

    // 推进远超完整退避序列（1/2/4/8/16/30s）的时长——修复前此处会反复重建
    // SSE 并触发 resync（runs/logs 持续增长）。
    await vi.advanceTimersByTimeAsync(120_000);

    expect(harness.streamCalls).toBe(1);
    expect(harness.runsCalls).toBe(0);
    expect(harness.logsCalls).toBe(0);
    conn.close();
  });

  it("流中先收实时事件再 done（session_ended 场景）：同样终止不重连", async () => {
    const conn: SessionStreamConnection = streamSession(
      "sess-live-then-end",
      baseHandlers(),
    );
    await vi.runOnlyPendingTimersAsync();
    expect(harness.streamCalls).toBe(1);

    harness.stream!.push(": connected\n\n");
    harness.stream!.push(
      'data: {"kind":"turn_completed","run_id":"run-1","session_id":"sess-live-then-end"}\n\n',
    );
    harness
      .stream!.push(
        'event: done\ndata: {"status":"ended","reason":"session_terminated"}\n\n',
      );
    harness.stream!.close();
    await vi.runOnlyPendingTimersAsync();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(harness.streamCalls).toBe(1);
    conn.close();
  });

  it("无 done 的普通断流：仍走退避重连（修复不误伤）", async () => {
    const conn: SessionStreamConnection = streamSession(
      "sess-flap",
      baseHandlers(),
    );
    await vi.runOnlyPendingTimersAsync();
    expect(harness.streamCalls).toBe(1);

    // 无 done 直接待对端关闭（如网络中断 / Redis error 后断开）→ 应重连。
    harness.stream!.push(": connected\n\n");
    harness.stream!.close();
    await vi.runOnlyPendingTimersAsync();
    // 第一档退避 1s + resync 后重建。
    await vi.advanceTimersByTimeAsync(2_000);

    expect(harness.streamCalls).toBeGreaterThanOrEqual(2);
    conn.close();
  });
});

describe("streamSession — 永久性 HTTP 错误停连（ql-20260903-021，R7）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installRoutedFetchMock();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("404（已删除/无权限会话）→ 停连不重连：不再每 30s 重打 stream + resync", async () => {
    harness.streamStatus = 404;
    const conn: SessionStreamConnection = streamSession(
      "sess-gone",
      baseHandlers(),
    );
    await vi.runOnlyPendingTimersAsync();
    expect(harness.streamCalls).toBe(1);

    // 推进远超完整退避序列（1/2/4/8/16/30s）——修复前每轮重打 SSE 并触发
    // resync（runs/logs 持续增长），永久循环。
    await vi.advanceTimersByTimeAsync(120_000);

    expect(harness.streamCalls).toBe(1);
    expect(harness.runsCalls).toBe(0);
    expect(harness.logsCalls).toBe(0);
    conn.close();
  });

  it("连接中会话被删：断连后 resync 阶段 404 → 停连（resync 永久错误不再无限重试）", async () => {
    // ql-20260904-H2（R7 补口）：es.onerror 的停连分支只在建连后可达——本例
    // 先正常建连（200），会话随后被删（runs 回 404），再模拟网络断连：
    // scheduleReconnect → resyncAndReconnect → resync REST 404（ApiError）。
    // 修复前该 404 与网络错误无差别进 catch 退避重试 → 每 30s 一轮必败
    // resync 永久循环（修复只覆盖了首连 404 场景）。
    const conn: SessionStreamConnection = streamSession(
      "sess-deleted-mid",
      baseHandlers(),
    );
    await vi.runOnlyPendingTimersAsync();
    expect(harness.streamCalls).toBe(1);

    harness.stream!.push(": connected\n\n");
    // 会话随后被删（如另一标签页删除）——resync 的 runs 快照开始回 404。
    harness.runsStatus = 404;
    // 网络断连（无 status 的普通 onerror）→ 进入退避重连。
    harness.stream!.close();
    await vi.runOnlyPendingTimersAsync();

    // 推进远超完整退避序列——修复前 runs/logs 每 30s 一轮持续增长。
    await vi.advanceTimersByTimeAsync(120_000);

    // 恰一轮 resync（runs 打了一次 404）即停：不再重打 runs/logs/stream。
    expect(harness.runsCalls).toBe(1);
    expect(harness.logsCalls).toBe(0);
    expect(harness.streamCalls).toBe(1);
    conn.close();
  });
});
