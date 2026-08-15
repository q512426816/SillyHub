import { describe, it, expect, vi, beforeEach } from "vitest";
import { getAgentRunLogs, submitAgentRunInput } from "../agent";

describe("submitAgentRunInput", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends POST to /api/workspaces/{workspaceId}/agent/runs/{runId}/input with JSON body", async () => {
    const mockResponse = {
      run_id: "run-1",
      accepted: true,
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      }),
    );

    const result = await submitAgentRunInput("ws-1", "run-1", {
      content: "Use defaults and continue.",
    });

    // Verify request URL and method
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toContain("/api/workspaces/ws-1/agent/runs/run-1/input");
    expect(init.method).toBe("POST");

    // Verify content-type header
    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");

    // Verify request body
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ content: "Use defaults and continue." });

    // Verify response shape
    expect(result).toEqual(mockResponse);
    expect(result.run_id).toBe("run-1");
    expect(result.accepted).toBe(true);
  });
});

// perf-remediation task-08 / FR-10 / D-001@v1：GET logs ?after= 增量游标——
// 核对（不重造）getAgentRunLogs 的 after 参数类型与编码。
describe("getAgentRunLogs after 增量游标（perf-remediation task-08）", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function stubFetchOk(body: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(body)),
      }),
    );
  }

  it("不传 after：无 query string（现状全量语义零回归）", async () => {
    stubFetchOk([]);
    await getAgentRunLogs("ws-1", "run-1");
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).not.toContain("?");
    expect(url).toContain("/api/workspaces/ws-1/agent/runs/run-1/logs");
  });

  it("传 after：ISO timestamp 经 encodeURIComponent 编码后作为唯一参数", async () => {
    stubFetchOk([]);
    await getAgentRunLogs("ws-1", "run-1", "2026-08-15T07:00:00.000Z");
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toContain(
      "/api/workspaces/ws-1/agent/runs/run-1/logs?after=2026-08-15T07%3A00%3A00.000Z",
    );
  });

  it("空字符串 after 视为未传（不发 after 参数）", async () => {
    stubFetchOk([]);
    await getAgentRunLogs("ws-1", "run-1", "");
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).not.toContain("after=");
  });
});
