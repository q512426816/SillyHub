/**
 * task-15: lib/workspaces.ts scanGenerate spec_strategy 透传测（D-006@v1）。
 *
 * 覆盖 task-14 的 lib 层改动：scanGenerate 加 specStrategy 参数，请求体
 * 含 spec_strategy 透传给 POST /api/workspaces/scan-generate。按钮渲染/互斥
 * 的 page 层测试见 workspaces/[id]/page.test.tsx。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { scanGenerate } from "@/lib/workspaces";

// ── fetch harness（仿 lib/daemon.test.ts）──────────────────────────────────

function mockFetch(resp: { status: number; body: unknown }) {
  const fetchMock = vi.fn();
  const bodyStr = JSON.stringify(resp.body);
  let lastUrl = "";
  let lastInit: RequestInit | undefined;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    lastUrl = url;
    lastInit = init;
    const headers = new Headers({ "content-type": "application/json" });
    return {
      ok: resp.status >= 200 && resp.status < 300,
      status: resp.status,
      statusText: resp.status === 200 ? "OK" : "Error",
      headers,
      text: async () => bodyStr,
      json: async () => resp.body,
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    lastUrl: () => lastUrl,
    lastBody: (): Record<string, unknown> | null => {
      if (!lastInit?.body) return null;
      try {
        return JSON.parse(lastInit.body as string) as Record<string, unknown>;
      } catch {
        return null;
      }
    },
  };
}

describe("scanGenerate spec_strategy 透传（task-14 / D-006@v1）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const OK = { workspace_id: "ws-1", agent_run_id: "run-1" };

  it("传 specStrategy 时请求体含 spec_strategy + daemon-client 字段", async () => {
    const h = mockFetch({ status: 200, body: OK });
    await scanGenerate(
      "C:/proj",
      null,
      null,
      "daemon-client",
      "rid-1",
      "repo-native",
    );
    expect(h.lastUrl()).toContain("/api/workspaces/scan-generate");
    const body = h.lastBody();
    expect(body).not.toBeNull();
    expect(body!.root_path).toBe("C:/proj");
    expect(body!.path_source).toBe("daemon-client");
    expect(body!.daemon_runtime_id).toBe("rid-1");
    expect(body!.spec_strategy).toBe("repo-native");
  });

  it("不传 specStrategy 时请求体不含 spec_strategy", async () => {
    const h = mockFetch({ status: 200, body: OK });
    await scanGenerate("C:/proj", null, null, "daemon-client", "rid-1");
    const body = h.lastBody();
    expect(body).not.toBeNull();
    expect(body!.spec_strategy).toBeUndefined();
  });

  it("三策略值均可透传", async () => {
    const strategies = ["platform-managed", "repo-mirrored", "repo-native"] as const;
    for (const strat of strategies) {
      const h = mockFetch({ status: 200, body: OK });
      await scanGenerate("C:/proj", null, null, "daemon-client", "rid-1", strat);
      expect(h.lastBody()?.spec_strategy).toBe(strat);
    }
  });

  it("server-local 调用不强制传 daemon 字段（向后兼容）", async () => {
    const h = mockFetch({ status: 200, body: OK });
    await scanGenerate("C:/proj");
    const body = h.lastBody();
    expect(body).not.toBeNull();
    expect(body!.root_path).toBe("C:/proj");
    expect(body!.path_source).toBeUndefined();
    expect(body!.spec_strategy).toBeUndefined();
  });
});
