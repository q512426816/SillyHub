/**
 * task-11 / FR-03 / FR-04: getRuntimesUsage(window) fetch URL + 类型映射单测。
 *
 * 依据文档:
 *   - .sillyspec/changes/2026-06-24-runtime-usage-stats/tasks/task-15.md
 *     §frontend daemon-usage.test.ts(getRuntimesUsage fetch URL + RuntimeUsageResponse 映射)
 *   - design.md §7(GET /api/daemon/runtimes/usage?window=1d|7d|30d)
 *   - decisions.md D-003@v2(LEFT JOIN+COALESCE 去重)/D-004@v1(非实时,切窗拉取)
 *
 * 覆盖:
 *   1. fetch URL 含 /api/daemon/runtimes/usage + window 参数
 *   2. window 参数透传(1d/7d/30d 三值)
 *   3. 默认 window=7d(省略参数)
 *   4. 返回类型 RuntimeUsageResponse 字段映射(window/runtimes/runtime_id/summary/daily)
 *   5. 非法 window 透传给后端(前端不校验,后端 422)
 *
 * 测试模式:用真实 apiFetch(不 mock @/lib/api),仅 stub global fetch,
 * 断言收到的 URL + Response body 映射。对齐 lib/__tests__/api.test.ts 的 fetch stub 模式。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import { useSession } from "@/stores/session";
import {
  getRuntimesUsage,
  type RuntimeUsageItem,
  type RuntimeUsagePoint,
  type RuntimeUsageResponse,
  type RuntimeUsageSummary,
  type RuntimeUsageWindow,
} from "@/lib/daemon";

// ── fetch harness ────────────────────────────────────────────────────────────

function mockFetchOk(body: unknown): {
  fetchMock: ReturnType<typeof vi.fn>;
  lastUrl: () => string;
} {
  const fetchMock = vi.fn();
  let lastUrl = "";
  const bodyStr = JSON.stringify(body);
  fetchMock.mockImplementation(async (url: string, _init?: RequestInit) => {
    lastUrl = url;
    return new Response(bodyStr, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, lastUrl: () => lastUrl };
}

function mockFetchStatus(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn();
  const bodyStr = JSON.stringify(body);
  fetchMock.mockImplementation(async (url: string) => {
    void url;
    return new Response(bodyStr, {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function makeSummary(over: Partial<RuntimeUsageSummary> = {}): RuntimeUsageSummary {
  return {
    input_tokens: 1000,
    output_tokens: 200,
    cache_read_tokens: 5000,
    cache_creation_tokens: 300,
    total_cost_usd: 1.5,
    ...over,
  };
}

function makePoint(ts: string, over: Partial<RuntimeUsagePoint> = {}): RuntimeUsagePoint {
  return {
    ts,
    input_tokens: 100,
    output_tokens: 50,
    cache_read_tokens: 200,
    cache_creation_tokens: 10,
    total_cost_usd: 0.1,
    ...over,
  };
}

function makeItem(
  runtime_id: string,
  over: Partial<RuntimeUsageItem> = {},
): RuntimeUsageItem {
  return {
    runtime_id,
    summary: makeSummary(),
    daily: [makePoint("2026-06-24T00:00:00Z")],
    ...over,
  };
}

beforeEach(() => {
  useSession.setState({ accessToken: "tok-rt-usage", hydrated: true } as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("task-11 getRuntimesUsage: fetch URL + window 参数", () => {
  it("GET /api/daemon/runtimes/usage?window=7d(URL + 参数完整)", async () => {
    const h = mockFetchOk({ window: "7d", runtimes: [] });
    await getRuntimesUsage("7d");
    const url = new URL(h.lastUrl());
    expect(url.pathname).toBe("/api/daemon/runtimes/usage");
    expect(url.searchParams.get("window")).toBe("7d");
  });

  it("window 参数透传:1d / 7d / 30d 各调一次,URL 参数正确", async () => {
    const windows: RuntimeUsageWindow[] = ["1d", "7d", "30d"];
    for (const w of windows) {
      const h = mockFetchOk({ window: w, runtimes: [] });
      await getRuntimesUsage(w);
      const url = new URL(h.lastUrl());
      expect(url.searchParams.get("window")).toBe(w);
      vi.unstubAllGlobals();
    }
  });

  it("默认 window=7d(省略参数)", async () => {
    const h = mockFetchOk({ window: "7d", runtimes: [] });
    await getRuntimesUsage();
    const url = new URL(h.lastUrl());
    expect(url.searchParams.get("window")).toBe("7d");
  });

  it("GET 方法(无 body)", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ window: "7d", runtimes: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await getRuntimesUsage("7d");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.method ?? "GET").toBe("GET");
  });
});

describe("task-11 getRuntimesUsage: RuntimeUsageResponse 类型映射", () => {
  it("返回类型字段映射正确(window + runtimes 数组)", async () => {
    const body: RuntimeUsageResponse = {
      window: "7d",
      runtimes: [
        makeItem("rt-a", { summary: makeSummary({ input_tokens: 7800000 }) }),
        makeItem("rt-b", { summary: makeSummary({ cache_read_tokens: 0 }) }),
      ],
    };
    mockFetchOk(body);
    const result = await getRuntimesUsage("7d");
    expect(result.window).toBe("7d");
    expect(result.runtimes).toHaveLength(2);
    expect(result.runtimes[0]?.runtime_id).toBe("rt-a");
    expect(result.runtimes[0]?.summary.input_tokens).toBe(7800000);
    expect(result.runtimes[0]?.summary.cache_read_tokens).toBe(5000);
    expect(result.runtimes[0]?.summary.total_cost_usd).toBe(1.5);
  });

  it("runtimes 为空数组(无 runtime 数据)", async () => {
    mockFetchOk({ window: "30d", runtimes: [] });
    const result = await getRuntimesUsage("30d");
    expect(result.runtimes).toEqual([]);
  });

  it("daily 时间序列字段映射(ts + token/cost 各维)", async () => {
    const body: RuntimeUsageResponse = {
      window: "1d",
      runtimes: [
        makeItem("rt-x", {
          daily: [
            makePoint("2026-06-24T00:00:00Z", { input_tokens: 10, output_tokens: 5 }),
            makePoint("2026-06-24T01:00:00Z", { input_tokens: 20, output_tokens: 8 }),
          ],
        }),
      ],
    };
    mockFetchOk(body);
    const result = await getRuntimesUsage("1d");
    const daily = result.runtimes[0]?.daily;
    expect(daily).toHaveLength(2);
    expect(daily?.[0]?.ts).toBe("2026-06-24T00:00:00Z");
    expect(daily?.[0]?.input_tokens).toBe(10);
    expect(daily?.[1]?.ts).toBe("2026-06-24T01:00:00Z");
    expect(daily?.[1]?.output_tokens).toBe(8);
    // cache 两维透传
    expect(daily?.[0]?.cache_read_tokens).toBe(200);
    expect(daily?.[0]?.cache_creation_tokens).toBe(10);
  });

  it("codex 系无 cache(D-001@v1):cache_* 恒 0,前端类型 number 不报错", async () => {
    const body: RuntimeUsageResponse = {
      window: "7d",
      runtimes: [
        makeItem("rt-codex", {
          summary: makeSummary({
            cache_read_tokens: 0,
            cache_creation_tokens: 0,
          }),
        }),
      ],
    };
    mockFetchOk(body);
    const result = await getRuntimesUsage("7d");
    expect(result.runtimes[0]?.summary.cache_read_tokens).toBe(0);
    expect(result.runtimes[0]?.summary.cache_creation_tokens).toBe(0);
    // 类型守卫:number 不 NaN
    expect(typeof result.runtimes[0]?.summary.cache_read_tokens).toBe("number");
  });
});

describe("task-11 getRuntimesUsage: 错误透传", () => {
  it("422 非法 window → ApiError(前端不校验,后端返回 422)", async () => {
    mockFetchStatus(422, {
      code: "HTTP_422",
      message: "window must be one of 1d, 7d, 30d",
      request_id: null,
      details: null,
    });
    await expect(getRuntimesUsage("2d" as RuntimeUsageWindow)).rejects.toBeInstanceOf(
      ApiError,
    );
  });

  it("401 未登录 → ApiError", async () => {
    mockFetchStatus(401, {
      code: "HTTP_401",
      message: "unauthorized",
      request_id: null,
      details: null,
    });
    await expect(getRuntimesUsage("7d")).rejects.toBeInstanceOf(ApiError);
  });
});
