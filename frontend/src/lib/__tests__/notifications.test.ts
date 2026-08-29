// lib/__tests__/notifications.test.ts
// 2026-08-29-approval-notify-push task-10：通知前端数据层单测。
//
// 覆盖：
//   1. 四个 REST fetch 函数的 URL / method / 响应解析（fetch mock，apiFetch 直通）。
//   2. subscribeNotificationsEvents：notification 命名事件 → onEvent；connected
//      （onopen）→ onConnected 恰一次；坏 JSON 帧静默忽略；401 永久停连不再
//      重试；断连退避重连成功后 onConnected 再触发（断线补拉信号）；
//      close() 后不再重连（卸载清理）。
//   3. useNotificationsStream hook：notification 事件 → queryClient.invalidateQueries
//      被以 notifications all key 调用。
//
// mock 体系与 daemon-session-events.test.ts 同款：fetch + ReadableStream 假
// SSE 流，写 backend 真实输出形态的命名事件帧（event: notification）。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

import {
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  subscribeNotificationsEvents,
  useNotifications,
  useNotificationsStream,
  useUnreadCount,
} from "@/lib/notifications";
import { queryKeys } from "@/lib/query-keys";

// --- mock session store（apiFetch / fetchSse 取 accessToken）---
const hoisted = vi.hoisted(() => ({ sessionState: { accessToken: "tok-1" } }));
vi.mock("@/stores/session", () => ({
  useSession: {
    getState: () => hoisted.sessionState,
  },
}));

/* ------------------------------------------------------------------ */
/*  helpers                                                            */
/* ------------------------------------------------------------------ */

interface FakeSseStream {
  url: string;
  push: (text: string) => void;
  end: () => void;
}

const fetchCalls: { url: string; init?: RequestInit }[] = [];
let sseMode = false;
let nextStatus = 200;
let jsonBody: unknown = null;
let lastStream: FakeSseStream | null = null;

function installFetchMock(): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(
    (input: URL | RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      fetchCalls.push({ url, init });
      if (sseMode && url.includes("/api/notifications/events")) {
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            controller = c;
          },
        });
        const encoder = new TextEncoder();
        lastStream = {
          url,
          push: (text) => controller.enqueue(encoder.encode(text)),
          end: () => controller.close(),
        };
        return Promise.resolve(
          new Response(body, {
            status: nextStatus,
            headers: { "Content-Type": "text/event-stream" },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(jsonBody ?? {}), {
          status: nextStatus,
          headers: { "Content-Type": "application/json" },
        }),
      );
    },
  );
}

function emitNamed(stream: FakeSseStream, event: string, data: unknown) {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  stream.push(`event: ${event}\ndata: ${payload}\n\n`);
}

async function flushSse(times = 3) {
  for (let i = 0; i < times; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

beforeEach(() => {
  fetchCalls.length = 0;
  sseMode = false;
  nextStatus = 200;
  jsonBody = null;
  lastStream = null;
  installFetchMock();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/* ------------------------------------------------------------------ */
/*  REST fetch 函数                                                    */
/* ------------------------------------------------------------------ */

describe("notifications REST 函数", () => {
  it("listNotifications：GET /api/notifications + query 参数 + 解析 items/total", async () => {
    jsonBody = { items: [{ id: "n1" }], total: 1 };
    const resp = await listNotifications({ limit: 20, offset: 40, unread_only: true });
    expect(fetchCalls[0]!.url).toContain("/api/notifications?");
    expect(fetchCalls[0]!.url).toContain("limit=20");
    expect(fetchCalls[0]!.url).toContain("offset=40");
    expect(fetchCalls[0]!.url).toContain("unread_only=true");
    expect(fetchCalls[0]!.init?.method).toBeUndefined(); // 默认 GET
    expect(resp.items).toEqual([{ id: "n1" }]);
    expect(resp.total).toBe(1);
  });

  it("getUnreadCount：GET /api/notifications/unread-count → {count}", async () => {
    jsonBody = { count: 7 };
    const resp = await getUnreadCount();
    expect(fetchCalls[0]!.url).toContain("/api/notifications/unread-count");
    expect(resp.count).toBe(7);
  });

  it("markNotificationRead：POST /api/notifications/{id}/read → NotificationRead", async () => {
    jsonBody = { id: "n-42", read_at: "2026-08-29T00:00:00Z" };
    const resp = await markNotificationRead("n-42");
    expect(fetchCalls[0]!.url).toContain("/api/notifications/n-42/read");
    expect(fetchCalls[0]!.init?.method).toBe("POST");
    expect(resp.id).toBe("n-42");
  });

  it("markAllNotificationsRead：POST /api/notifications/read-all → {updated}", async () => {
    jsonBody = { updated: 3 };
    const resp = await markAllNotificationsRead();
    expect(fetchCalls[0]!.url).toContain("/api/notifications/read-all");
    expect(fetchCalls[0]!.init?.method).toBe("POST");
    expect(resp.updated).toBe(3);
  });
});

/* ------------------------------------------------------------------ */
/*  SSE 订阅（subscribeNotificationsEvents）                           */
/* ------------------------------------------------------------------ */

describe("subscribeNotificationsEvents", () => {
  it("connected（onopen）→ onConnected 恰一次；notification 帧 → onEvent", async () => {
    sseMode = true;
    const onEvent = vi.fn();
    const onConnected = vi.fn();
    subscribeNotificationsEvents({ onEvent, onConnected });
    await flushSse();

    expect(fetchCalls[0]!.url).toContain("/api/notifications/events");
    expect(fetchCalls[0]!.init?.headers).toMatchObject({
      Authorization: "Bearer tok-1",
    });
    expect(onConnected).toHaveBeenCalledTimes(1);

    emitNamed(lastStream!, "notification", { id: "n1", title: "t" });
    await flushSse();
    expect(onEvent).toHaveBeenCalledTimes(1);
    // 同一连接周期内收到事件不再重复 onConnected。
    expect(onConnected).toHaveBeenCalledTimes(1);
  });

  it("坏 JSON 帧静默忽略（onEvent 不触发）", async () => {
    sseMode = true;
    const onEvent = vi.fn();
    subscribeNotificationsEvents({ onEvent, onConnected: vi.fn() });
    await flushSse();
    emitNamed(lastStream!, "notification", "{not-json");
    await flushSse();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("401 → 永久停连不重试", async () => {
    vi.useFakeTimers();
    sseMode = true;
    nextStatus = 401;
    const onEvent = vi.fn();
    subscribeNotificationsEvents({ onEvent, onConnected: vi.fn() });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchCalls).toHaveLength(1); // 无重连
  });

  it("断连后退避重连，成功后 onConnected 再触发一次（断线补拉信号）", async () => {
    vi.useFakeTimers();
    sseMode = true;
    const onConnected = vi.fn();
    const sub = subscribeNotificationsEvents({
      onEvent: vi.fn(),
      onConnected,
    });
    // fake timers 下用 advanceTimersByTimeAsync(0) flush 微任务/宏任务队列。
    await vi.advanceTimersByTimeAsync(0);
    expect(onConnected).toHaveBeenCalledTimes(1);

    // 流中断（backend 关闭）→ 1s 退避重连。
    lastStream!.end();
    await vi.advanceTimersByTimeAsync(1_100);
    expect(fetchCalls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(onConnected).toHaveBeenCalledTimes(2);
    sub.close();
  });

  it("close() 后清理：不再重连（卸载清理路径）", async () => {
    vi.useFakeTimers();
    sseMode = true;
    const sub = subscribeNotificationsEvents({
      onEvent: vi.fn(),
      onConnected: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);
    sub.close();
    lastStream!.end();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchCalls).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/*  useNotificationsStream hook                                        */
/* ------------------------------------------------------------------ */

describe("hooks 配置守护（D-005@v1 无轮询铁律）", () => {
  it("useNotifications / useUnreadCount 均不设 refetchInterval（query cache options 无轮询）", async () => {
    const queryClient = new QueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    const { rerender } = renderHook(() => useNotifications({ limit: 20 }), {
      wrapper,
    });
    rerender();
    renderHook(() => useUnreadCount(), { wrapper });

    const optionsList = queryClient
      .getQueryCache()
      .getAll()
      .map((q) => q.options as { refetchInterval?: unknown });
    expect(optionsList).toHaveLength(2);
    for (const options of optionsList) {
      // refetchInterval 为 undefined 才是无轮询（设为数值/函数都算违反 D-005@v1）。
      expect(options.refetchInterval).toBeUndefined();
    }
  });
});

describe("useNotificationsStream", () => {
  it("notification 事件 → invalidateQueries 以 notifications all key 调用", async () => {
    sseMode = true;
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    renderHook(() => useNotificationsStream(), { wrapper });
    await waitFor(() => expect(lastStream).not.toBeNull());
    // onopen 建立即补拉一次（首连）。
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledTimes(1));

    emitNamed(lastStream!, "notification", { id: "n1", title: "t" });
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledTimes(2));
    expect(invalidateSpy).toHaveBeenLastCalledWith({
      queryKey: queryKeys.notifications.all,
    });
  });

  it("notification 事件 → 未读数查询（unreadCount key）也被失效重拉（task-13 查漏）", async () => {
    sseMode = true;
    jsonBody = { count: 1 };
    const queryClient = new QueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    // 同时挂流 + 未读数查询，模拟铃铛数据层。
    renderHook(() => useNotificationsStream(), { wrapper });
    renderHook(() => useUnreadCount(), { wrapper });

    // 首载一次（queryFn）建立基线（onopen 建连补拉与流建立时序竞态，不作断言）。
    await waitFor(
      () =>
        expect(
          fetchCalls.filter((c) => c.url.includes("unread-count")).length,
        ).toBeGreaterThanOrEqual(1),
    );
    // 等未读数首载完成、流建立稳定后再取基线，避免把首载计入事件驱动刷新。
    await new Promise((r) => setTimeout(r, 50));
    const before =
      fetchCalls.filter((c) => c.url.includes("unread-count")).length;

    emitNamed(lastStream!, "notification", { id: "n2", title: "t2" });
    // notification 事件 invalidate notifications.all（前缀匹配 unreadCount
    // key）→ 未读数再拉一次，徽标即时刷新（FR-09 GWT 第二条）。
    await waitFor(
      () =>
        expect(
          fetchCalls.filter((c) => c.url.includes("unread-count")).length,
        ).toBeGreaterThan(before),
    );
  });
});
