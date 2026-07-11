/**
 * task-15: lib/workspaces.ts scanGenerate spec_strategy 透传测（D-006@v1）。
 *
 * 2026-07-10-remove-server-local-workspace-mode（task-11）：scanGenerate 签名
 * 精简为 (rootPath, provider?, model?, specStrategy?, daemonId?) —— path_source
 * 字段从请求体移除（平台统一 daemon-client），daemon_id 替代旧 daemon_runtime_id。
 *
 * 覆盖：请求体含 spec_strategy 透传给 POST /api/workspaces/scan-generate。
 * 按钮渲染/互斥的 page 层测试见 workspaces/[id]/page.test.tsx。
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

  it("传 specStrategy + daemonId 时请求体含 spec_strategy + daemon_id（无 path_source/daemon_runtime_id）", async () => {
    const h = mockFetch({ status: 200, body: OK });
    await scanGenerate(
      "C:/proj",
      null,
      null,
      "repo-native",
      "daemon-1",
    );
    expect(h.lastUrl()).toContain("/api/workspaces/scan-generate");
    const body = h.lastBody();
    expect(body).not.toBeNull();
    expect(body!.root_path).toBe("C:/proj");
    expect(body!.spec_strategy).toBe("repo-native");
    expect(body!.daemon_id).toBe("daemon-1");
    // 2026-07-10：path_source / daemon_runtime_id 已从请求体移除。
    expect(body!.path_source).toBeUndefined();
    expect(body!.daemon_runtime_id).toBeUndefined();
  });

  it("不传 specStrategy 时请求体不含 spec_strategy", async () => {
    const h = mockFetch({ status: 200, body: OK });
    await scanGenerate("C:/proj", null, null, undefined, "daemon-1");
    const body = h.lastBody();
    expect(body).not.toBeNull();
    expect(body!.spec_strategy).toBeUndefined();
    expect(body!.daemon_id).toBe("daemon-1");
  });

  it("三策略值均可透传", async () => {
    const strategies = ["platform-managed", "repo-mirrored", "repo-native"] as const;
    for (const strat of strategies) {
      const h = mockFetch({ status: 200, body: OK });
      await scanGenerate("C:/proj", null, null, strat, "daemon-1");
      expect(h.lastBody()?.spec_strategy).toBe(strat);
    }
  });

  it("仅 rootPath（无 daemon/spec）→ 请求体只含 root_path", async () => {
    const h = mockFetch({ status: 200, body: OK });
    await scanGenerate("C:/proj");
    const body = h.lastBody();
    expect(body).not.toBeNull();
    expect(body!.root_path).toBe("C:/proj");
    expect(body!.spec_strategy).toBeUndefined();
    expect(body!.daemon_id).toBeUndefined();
    expect(body!.path_source).toBeUndefined();
  });
});
