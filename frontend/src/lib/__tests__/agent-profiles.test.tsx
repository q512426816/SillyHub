/**
 * agent-profiles lib hooks 缓存失效行为单测
 * （2026-10-22-agent-profile-edit-refresh：全局页编辑后不刷新的根因修复）。
 *
 * 覆盖（FR-01 / FR-02 / FR-03）：
 *   1. useCreateAgentProfile / useUpdateAgentProfile 成功后必须同时失效
 *      workspaceList(wid) 与 mineList 两桶（全局卡片墙数据在 mineList 桶）。
 *   2. mutation 失败不触发失效（缓存保持旧值不闪错数据）。
 *
 * 根因背景：全局页（/agent-profiles）列表走 mineList 桶；此前 mutation 只失效
 * workspaceList(wid) 桶 → 编辑/新建保存后卡片墙不刷新（复制/删除当年已在
 * 页面层手动失效绕过，新建/编辑漏掉——page.tsx 头注释明载）。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import {
  agentProfileQueryKeys,
  useCreateAgentProfile,
  useUpdateAgentProfile,
} from "@/lib/agent-profiles";

const apiMock = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/api", () => ({
  ApiError: class extends Error {},
  apiFetch: (...args: unknown[]) => apiMock.fetch(...args),
}));

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, invalidateSpy, wrapper };
}

beforeEach(() => {
  apiMock.fetch.mockReset();
});

describe("useCreateAgentProfile 失效面（FR-01/FR-02）", () => {
  it("成功后失效 workspaceList(wid) 与 mineList 两桶", async () => {
    apiMock.fetch.mockResolvedValue({ id: "p-1", name: "新档" });
    const { invalidateSpy, wrapper } = setup();
    const { result } = renderHook(() => useCreateAgentProfile("ws-1"), {
      wrapper,
    });

    await result.current.mutateAsync({
      name: "新档",
      visibility: "private",
      system_prompt: null,
      skill_refs: [],
    });

    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: agentProfileQueryKeys.workspaceList("ws-1"),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: agentProfileQueryKeys.mineList,
    });
  });

  it("失败不触发失效（FR-03）", async () => {
    apiMock.fetch.mockRejectedValue(new Error("boom"));
    const { invalidateSpy, wrapper } = setup();
    const { result } = renderHook(() => useCreateAgentProfile("ws-1"), {
      wrapper,
    });

    await expect(
      result.current.mutateAsync({
        name: "x",
        visibility: "private",
        system_prompt: null,
        skill_refs: [],
      }),
    ).rejects.toThrow("boom");

    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe("useUpdateAgentProfile 失效面（FR-01/FR-02）", () => {
  it("成功后失效 workspaceList(wid) 与 mineList 两桶", async () => {
    apiMock.fetch.mockResolvedValue({ id: "p-1", name: "改后" });
    const { invalidateSpy, wrapper } = setup();
    const { result } = renderHook(() => useUpdateAgentProfile("ws-1"), {
      wrapper,
    });

    await result.current.mutateAsync({
      profileId: "p-1",
      body: {
        name: "改后",
        visibility: "private",
        system_prompt: null,
        skill_refs: [],
        model: null,
        llm_provider_id: null,
        tool_policy_id: null,
        mcp_refs: [],
      },
    });

    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: agentProfileQueryKeys.workspaceList("ws-1"),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: agentProfileQueryKeys.mineList,
    });
  });

  it("失败不触发失效（FR-03）", async () => {
    apiMock.fetch.mockRejectedValue(new Error("boom"));
    const { invalidateSpy, wrapper } = setup();
    const { result } = renderHook(() => useUpdateAgentProfile("ws-1"), {
      wrapper,
    });

    await expect(
      result.current.mutateAsync({
        profileId: "p-1",
        body: {
          name: "x",
          visibility: "private",
          system_prompt: null,
          skill_refs: [],
          model: null,
          llm_provider_id: null,
          tool_policy_id: null,
          mcp_refs: [],
        },
      }),
    ).rejects.toThrow("boom");

    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
