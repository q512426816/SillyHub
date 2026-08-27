/**
 * ql-20260827-018：streamSession 首连缺口同步（cursor / initialSync）与
 * replayLogsFromDb 合成 envelope 归属字段透传的测试。
 *
 * mock 体系与 daemon-session-events.test.ts 同款（fetch + ReadableStream 假
 * SSE 流），REST（/logs /runs）按 URL 路由返回 JSON；核心断言：
 *  1. cursor / initialSync 时：runs 快照 + logs 增量回放发生在 SSE 建连**之前**
 *     （对齐 resync 时序，回放期间无实时事件竞争）；
 *  2. cursor 回放走 `after = cursor - 2s` 增量；initialSync 无 cursor 全量；
 *  3. 回放 log 事件携带 parent_tool_use_id / subagent_type / depth / tool_kind /
 *     edit_patch（与硬重载渲染一致）；
 *  4. 无 cursor / initialSync：立即建连，无额外 REST 前置调用；
 *  5. maxLogTimestamp 取最大 ISO timestamp。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { AgentRunLogEntry } from "@/lib/agent";
import {
  streamSession,
  maxLogTimestamp,
  type SessionStreamHandlers,
  type SessionStreamConnection,
} from "@/lib/daemon";

interface FetchCall {
  url: string;
}

interface StreamHarness {
  /** fetch 调用序列（按发生顺序，只记 URL）。 */
  calls: FetchCall[];
  /** SSE 流推送句柄（建连后可用）。 */
  stream: { push: (_text: string) => void } | null;
  /** REST 应答数据（按需注入）。 */
  runsJson: unknown;
  logsJson: unknown;
}

let harness: StreamHarness;

function installRoutedFetchMock(): void {
  harness = { calls: [], stream: null, runsJson: [], logsJson: [] };
  vi.spyOn(globalThis, "fetch").mockImplementation(
    (input: URL | RequestInfo, _init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      harness.calls.push({ url });
      if (url.includes("/stream")) {
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            controller = c;
          },
        });
        const encoder = new TextEncoder();
        harness.stream = {
          push: (text) => controller.enqueue(encoder.encode(text)),
        };
        return Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          }),
        );
      }
      if (url.includes("/runs")) {
        return Promise.resolve(
          new Response(JSON.stringify(harness.runsJson), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (url.includes("/logs")) {
        return Promise.resolve(
          new Response(JSON.stringify(harness.logsJson), {
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

const CURSOR = "2026-08-27T10:00:00.000Z";
const CURSOR_MINUS_2S = "2026-08-27T09:59:58.000Z";

function logEntry(overrides: Partial<AgentRunLogEntry> = {}): AgentRunLogEntry {
  return {
    id: "log-1",
    run_id: "run-1",
    timestamp: CURSOR,
    channel: "stdout",
    content_redacted: "[ASSISTANT] 回放日志",
    ...overrides,
  };
}

describe("streamSession — 首连缺口同步（ql-20260827-018）", () => {
  beforeEach(() => {
    installRoutedFetchMock();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("cursor：runs+logs 前置同步在 SSE 建连之前，logs 走 cursor-2s 增量", async () => {
    harness.runsJson = [
      { id: "run-live", status: "running", started_at: CURSOR, finished_at: null },
      {
        id: "run-done",
        status: "completed",
        started_at: "2026-08-27T09:00:00.000Z",
        finished_at: "2026-08-27T09:05:00.000Z",
      },
    ];
    harness.logsJson = [logEntry()];

    const onTurnStarted = vi.fn();
    const onTurnCompleted = vi.fn();
    const conn: SessionStreamConnection = streamSession(
      "sess-1",
      { ...baseHandlers(), onTurnStarted, onTurnCompleted },
      { cursor: CURSOR },
    );
    await flush();

    const urls = harness.calls.map((c) => c.url);
    const runsIdx = urls.findIndex((u) => u.includes("/runs"));
    const logsIdx = urls.findIndex((u) => u.includes("/logs"));
    const streamIdx = urls.findIndex((u) => u.includes("/stream"));
    expect(runsIdx).toBeGreaterThanOrEqual(0);
    expect(logsIdx).toBeGreaterThan(runsIdx);
    expect(streamIdx).toBeGreaterThan(logsIdx);
    // logs 增量：after = cursor - 2s（重叠窗口）。
    const logsUrl = urls[logsIdx]!;
    expect(logsUrl).toContain(`after=${encodeURIComponent(CURSOR_MINUS_2S)}`);
    // stream URL 仍带 cursor 业务参数（原有行为不变）。
    expect(urls[streamIdx]).toContain(`cursor=${encodeURIComponent(CURSOR)}`);

    // runs 快照合成：running → turn_started；completed → turn_completed。
    const startedRunIds = onTurnStarted.mock.calls.map(
      (c) => (c[0] as { run_id: string }).run_id,
    );
    const completedRunIds = onTurnCompleted.mock.calls.map(
      (c) => (c[0] as { run_id: string }).run_id,
    );
    expect(startedRunIds).toEqual(["run-live"]);
    expect(completedRunIds).toEqual(["run-done"]);

    conn.close();
  });

  it("cursor：回放 log 事件透传归属字段（与硬重载渲染一致）", async () => {
    harness.logsJson = [
      logEntry({
        parent_tool_use_id: "toolu_01",
        subagent_type: "general-purpose",
        depth: 1,
        tool_kind: "bash",
        edit_patch: '{"hunks":[]}',
      }),
    ];
    const onLog = vi.fn();
    const conn = streamSession(
      "sess-1",
      { ...baseHandlers(), onLog },
      { cursor: CURSOR },
    );
    await flush();

    expect(onLog).toHaveBeenCalled();
    const env = onLog.mock.calls[0]![0] as Record<string, unknown>;
    expect(env.event).toBe("log");
    expect(env.log_id).toBe("log-1");
    expect(env.parent_tool_use_id).toBe("toolu_01");
    expect(env.subagent_type).toBe("general-purpose");
    expect(env.depth).toBe(1);
    expect(env.tool_kind).toBe("bash");
    expect(env.edit_patch).toBe('{"hunks":[]}');
    conn.close();
  });

  it("initialSync（无 cursor）：logs 全量拉取（无 after），仍先同步后建连", async () => {
    harness.runsJson = [];
    harness.logsJson = [logEntry()];

    const conn = streamSession("sess-1", baseHandlers(), { initialSync: true });
    await flush();

    const urls = harness.calls.map((c) => c.url);
    const logsUrl = urls.find((u) => u.includes("/logs"));
    expect(logsUrl).toBeDefined();
    expect(logsUrl).not.toContain("after=");
    const streamIdx = urls.findIndex((u) => u.includes("/stream"));
    const logsIdx = urls.findIndex((u) => u.includes("/logs"));
    expect(streamIdx).toBeGreaterThan(logsIdx);
    conn.close();
  });

  it("无 cursor / initialSync：立即建连，无前置 REST 同步", async () => {
    const conn = streamSession("sess-1", baseHandlers());
    await flush();

    const urls = harness.calls.map((c) => c.url);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls[0]).toContain("/stream");
    expect(urls.some((u) => u.includes("/logs"))).toBe(false);
    expect(urls.some((u) => u.includes("/runs"))).toBe(false);
    conn.close();
  });

  it("cursor：同步 REST 失败不阻断建连（SSE 仍建立）", async () => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (input: URL | RequestInfo, _init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        harness.calls.push({ url });
        if (url.includes("/stream")) {
          const body = new ReadableStream<Uint8Array>({
            start() {
              /* 空流：建连成功即可 */
            },
          });
          return Promise.resolve(
            new Response(body, {
              status: 200,
              headers: { "Content-Type": "text/event-stream" },
            }),
          );
        }
        return Promise.resolve(
          new Response("boom", { status: 500 }),
        );
      },
    );

    const conn = streamSession("sess-1", baseHandlers(), { cursor: CURSOR });
    await flush();

    const urls = harness.calls.map((c) => c.url);
    const streamIdx = urls.findIndex((u) => u.includes("/stream"));
    expect(streamIdx).toBeGreaterThan(0);
    conn.close();
  });
});

describe("maxLogTimestamp（ql-20260827-018）", () => {
  it("取最大 ISO timestamp（不依赖入参顺序）", () => {
    const max = maxLogTimestamp([
      logEntry({ id: "a", timestamp: "2026-08-27T09:00:00.000Z" }),
      logEntry({ id: "b", timestamp: "2026-08-27T11:00:00.000Z" }),
      logEntry({ id: "c", timestamp: "2026-08-27T10:00:00.000Z" }),
    ]);
    expect(max).toBe("2026-08-27T11:00:00.000Z");
  });

  it("空数组 → undefined", () => {
    expect(maxLogTimestamp([])).toBeUndefined();
  });
});
