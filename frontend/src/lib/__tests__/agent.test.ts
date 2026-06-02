import { describe, it, expect, vi, beforeEach } from "vitest";
import { submitAgentRunInput } from "../agent";

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
