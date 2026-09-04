/**
 * ql-20260904-028-3cb5：updateSpecWorkspace（PATCH /spec-workspace）透传测。
 *
 * 覆盖：PATCH 方法 + strategy/repo_sillyspec_path/profile_version 请求体透传、
 * 响应 SpecWorkspace 解析返回、非 2xx 抛 ApiError。UI 层（owner 门禁 / Modal /
 * 保存回调）见 components/workspace-config-card.test.tsx。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { updateSpecWorkspace } from "@/lib/spec-workspaces";
import { ApiError } from "@/lib/api";

// ── fetch harness（仿 lib/workspaces.test.ts）──────────────────────────────

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
    lastMethod: () => lastInit?.method,
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

const SPEC_WS_OK = {
  id: "sw-1",
  workspace_id: "ws-1",
  spec_root: "/data/spec-workspaces/ws-1",
  strategy: "repo-native",
  repo_sillyspec_path: null,
  profile_version: "0.1.0",
  sync_status: "clean",
  last_synced_at: "2026-09-04T00:00:00Z",
  created_at: "2026-06-30T00:55:12Z",
  updated_at: "2026-09-04T00:00:00Z",
};

describe("updateSpecWorkspace PATCH 透传（ql-20260904-028-3cb5）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("PATCH /api/workspaces/{id}/spec-workspace + strategy 请求体透传", async () => {
    const h = mockFetch({ status: 200, body: SPEC_WS_OK });
    const result = await updateSpecWorkspace("ws-1", { strategy: "repo-native" });

    expect(h.lastUrl()).toContain("/api/workspaces/ws-1/spec-workspace");
    expect(h.lastMethod()).toBe("PATCH");
    const body = h.lastBody();
    expect(body).not.toBeNull();
    expect(body!.strategy).toBe("repo-native");
    // 未传字段不进请求体（后端 SpecStrategyLiteral 值域由 Pydantic 422 把关）
    expect(body!.repo_sillyspec_path).toBeUndefined();
    expect(body!.profile_version).toBeUndefined();
    // 响应解析返回
    expect(result.strategy).toBe("repo-native");
    expect(result.workspace_id).toBe("ws-1");
  });

  it("三策略值均可透传", async () => {
    const strategies = ["platform-managed", "repo-mirrored", "repo-native"] as const;
    for (const strat of strategies) {
      const h = mockFetch({ status: 200, body: { ...SPEC_WS_OK, strategy: strat } });
      await updateSpecWorkspace("ws-1", { strategy: strat });
      expect(h.lastBody()?.strategy).toBe(strat);
    }
  });

  it("非 2xx → 抛 ApiError（不静默吞错）", async () => {
    mockFetch({
      status: 422,
      body: { code: "validation_error", message: "策略值非法" },
    });
    await expect(
      updateSpecWorkspace("ws-1", { strategy: "nope" as never }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
