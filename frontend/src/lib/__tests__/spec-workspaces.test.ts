import { describe, it, expect, vi, beforeEach } from "vitest";
import { bootstrapSpecWorkspace } from "../spec-workspaces";

describe("bootstrapSpecWorkspace", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends POST to /api/workspaces/{workspaceId}/spec-bootstrap", async () => {
    const mockResponse = {
      agent_run_id: "run-123",
      stream_url: "/api/workspaces/ws-1/agent/runs/run-123/stream",
      status: "pending" as const,
      spec_root: "C:/projects/.sillyspec",
      message: "Bootstrap agent run started.",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      }),
    );

    const result = await bootstrapSpecWorkspace("ws-1");

    // Verify request URL and method
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toContain("/api/workspaces/ws-1/spec-bootstrap");
    expect(init.method).toBe("POST");

    // Verify response shape
    expect(result).toEqual(mockResponse);
    expect(result.agent_run_id).toBe("run-123");
    expect(result.stream_url).toContain("/stream");
    expect(result.status).toBe("pending");
    expect(result.spec_root).toBe("C:/projects/.sillyspec");
    expect(result.message).toBe("Bootstrap agent run started.");
  });
});
