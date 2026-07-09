// lib/__tests__/use-workspace-context.test.ts
// task-04（2026-07-09-workspace-prioritization）：工作区上下文组合 hook 单测。
//
// 覆盖：
//   1. buildSwitchPath 纯函数（D-002 路径替换，便于单测）：
//      - /workspaces/A/changes → /workspaces/B/changes（保留首个模块段）
//      - /workspaces/A/changes/123 → /workspaces/B/changes（截断子路径）
//      - /workspaces/A → /workspaces/B（无模块段）
//      - /workspaces/A/changes/123/edit → /workspaces/B/changes（只留首个模块段）
//      - 非 /workspaces/* 路径 → 降级 /workspaces/{targetId}
//      - targetId 含特殊字符也按段原样替换（URL 编码由 router 处理，本函数不负责）
//   2. useWorkspaceContext hook：
//      - workspaceId 由 usePathname 正则派生（/workspaces/([^/]+)）
//      - 进入 ws（workspaceId 非空且与 current.id 不一致）→ 调 setCurrent 写 store
//      - daemonOnline 由 useDaemonStatusMap().statusMap[workspaceId]?.online 聚合
//      - 无 workspaceId / 无 statusMap 条目 → daemonOnline=false
//      - switchWorkspace(id) → 调 router.push(buildSwitchPath(pathname, id))
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

// --- mock next/navigation（usePathname / useRouter）---
const pushMock = vi.fn();
const pathnameRef = { current: "/workspaces/A/changes" };
vi.mock("next/navigation", () => ({
  usePathname: () => pathnameRef.current,
  useRouter: () => ({ push: pushMock }),
}));

// --- mock useDaemonStatusMap（task-03）---
const statusMapRef = {
  current: {} as Record<string, { daemon_id: string | null; online: boolean; status: string | null }>,
};
vi.mock("@/lib/workspace-daemon-status", () => ({
  useDaemonStatusMap: () => ({
    statusMap: statusMapRef.current,
    isLoading: false,
    isError: false,
  }),
}));

import {
  buildSwitchPath,
  useWorkspaceContext,
} from "../use-workspace-context";
import { useWorkspaceStore } from "@/stores/workspace";

function mc() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, refetchInterval: false },
    },
  });
}
function w(c: QueryClient) {
  return function ProviderWrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: c }, children);
  };
}

beforeEach(() => {
  pushMock.mockReset();
  pathnameRef.current = "/workspaces/A/changes";
  statusMapRef.current = {};
  // 重置 store（zustand 非持久化，跨用例需手动清，避免互相污染）
  act(() => {
    useWorkspaceStore.getState().setCurrent(null);
  });
});

// ============================================================
// 1. buildSwitchPath 纯函数
// ============================================================
describe("buildSwitchPath（纯函数，D-002 路径替换）", () => {
  it("/workspaces/A/changes → /workspaces/B/changes（保留首个模块段）", () => {
    expect(buildSwitchPath("/workspaces/A/changes", "B")).toBe(
      "/workspaces/B/changes",
    );
  });

  it("/workspaces/A/changes/123 → /workspaces/B/changes（截断子路径）", () => {
    expect(buildSwitchPath("/workspaces/A/changes/123", "B")).toBe(
      "/workspaces/B/changes",
    );
  });

  it("/workspaces/A → /workspaces/B（无模块段，概览）", () => {
    expect(buildSwitchPath("/workspaces/A", "B")).toBe("/workspaces/B");
  });

  it("/workspaces/A/changes/123/edit → /workspaces/B/changes（只留首个模块段，深层截断）", () => {
    expect(buildSwitchPath("/workspaces/A/changes/123/edit", "B")).toBe(
      "/workspaces/B/changes",
    );
  });

  it("/workspaces/A/agents → /workspaces/B/agents（其他模块段同样保留）", () => {
    expect(buildSwitchPath("/workspaces/A/agents", "B")).toBe(
      "/workspaces/B/agents",
    );
  });

  it("/workspaces/A/ → /workspaces/B（尾部斜杠无模块段）", () => {
    expect(buildSwitchPath("/workspaces/A/", "B")).toBe("/workspaces/B");
  });

  it("非 /workspaces/* 路径 → 降级 /workspaces/{targetId}", () => {
    expect(buildSwitchPath("/admin/users", "B")).toBe("/workspaces/B");
    expect(buildSwitchPath("/", "B")).toBe("/workspaces/B");
    expect(buildSwitchPath("/ppm/kanban", "B")).toBe("/workspaces/B");
  });

  it("targetId 原样作为段替换（不做编码）", () => {
    expect(buildSwitchPath("/workspaces/A/changes", "uuid-123")).toBe(
      "/workspaces/uuid-123/changes",
    );
  });
});

// ============================================================
// 2. useWorkspaceContext hook
// ============================================================
describe("useWorkspaceContext", () => {
  it("workspaceId 由 usePathname 正则派生（/workspaces/([^/]+)）", () => {
    pathnameRef.current = "/workspaces/ws-xyz/changes/42";
    const { result } = renderHook(() => useWorkspaceContext(), {
      wrapper: w(mc()),
    });
    expect(result.current.workspaceId).toBe("ws-xyz");
  });

  it("非工作区路径 → workspaceId=null", () => {
    pathnameRef.current = "/admin/users";
    const { result } = renderHook(() => useWorkspaceContext(), {
      wrapper: w(mc()),
    });
    expect(result.current.workspaceId).toBeNull();
  });

  it("进入 ws（workspaceId 非空且与 store.current.id 不一致）→ 调 setCurrent 写 store（id 与 URL 一致）", async () => {
    pathnameRef.current = "/workspaces/ws-enter/changes";
    const { result } = renderHook(() => useWorkspaceContext(), {
      wrapper: w(mc()),
    });
    await waitFor(() => {
      expect(useWorkspaceStore.getState().current?.id).toBe("ws-enter");
    });
    // current 对象字段：id 一致，name 暂空（由 task-08/task-10 列表数据补全）
    expect(result.current.current?.id).toBe("ws-enter");
  });

  it("workspaceId 与 current.id 一致时不重复 setCurrent（幂等）", async () => {
    pathnameRef.current = "/workspaces/ws-stable/changes";
    // 预置一致 current
    act(() => {
      useWorkspaceStore.getState().setCurrent({
        id: "ws-stable",
        name: "稳定工作区",
        daemon_id: "d1",
        daemon_online: true,
      });
    });
    const spy = vi.spyOn(useWorkspaceStore.getState(), "setCurrent");
    renderHook(() => useWorkspaceContext(), { wrapper: w(mc()) });
    // effect 跑完后不应再次 setCurrent（id 已一致）
    await waitFor(() => {
      expect(spy).not.toHaveBeenCalled();
    });
    spy.mockRestore();
  });

  it("daemonOnline 由 statusMap[workspaceId]?.online 聚合（在线）", async () => {
    pathnameRef.current = "/workspaces/ws-online/changes";
    statusMapRef.current = {
      "ws-online": { daemon_id: "d1", online: true, status: "online" },
    };
    const { result } = renderHook(() => useWorkspaceContext(), {
      wrapper: w(mc()),
    });
    await waitFor(() => {
      expect(result.current.daemonOnline).toBe(true);
    });
  });

  it("statusMap 条目 online=false → daemonOnline=false", async () => {
    pathnameRef.current = "/workspaces/ws-off/changes";
    statusMapRef.current = {
      "ws-off": { daemon_id: "d2", online: false, status: "offline" },
    };
    const { result } = renderHook(() => useWorkspaceContext(), {
      wrapper: w(mc()),
    });
    await waitFor(() => {
      expect(result.current.daemonOnline).toBe(false);
    });
  });

  it("workspaceId 在 statusMap 无条目 → daemonOnline=false（不报错）", async () => {
    pathnameRef.current = "/workspaces/ws-nostatus/changes";
    statusMapRef.current = {};
    const { result } = renderHook(() => useWorkspaceContext(), {
      wrapper: w(mc()),
    });
    await waitFor(() => {
      expect(result.current.daemonOnline).toBe(false);
    });
  });

  it("无 workspaceId（平台页）→ daemonOnline=false，current 保持", async () => {
    pathnameRef.current = "/admin/users";
    const { result } = renderHook(() => useWorkspaceContext(), {
      wrapper: w(mc()),
    });
    await waitFor(() => {
      expect(result.current.workspaceId).toBeNull();
      expect(result.current.daemonOnline).toBe(false);
    });
  });

  it("switchWorkspace(id) → 调 router.push(buildSwitchPath(pathname, id))", () => {
    pathnameRef.current = "/workspaces/A/changes/123";
    const { result } = renderHook(() => useWorkspaceContext(), {
      wrapper: w(mc()),
    });
    act(() => {
      result.current.switchWorkspace("B");
    });
    expect(pushMock).toHaveBeenCalledWith("/workspaces/B/changes");
  });

  it("switchWorkspace 在非工作区路径 → 降级 push /workspaces/{id}", () => {
    pathnameRef.current = "/admin/users";
    const { result } = renderHook(() => useWorkspaceContext(), {
      wrapper: w(mc()),
    });
    act(() => {
      result.current.switchWorkspace("B");
    });
    expect(pushMock).toHaveBeenCalledWith("/workspaces/B");
  });

  it("返回对象含全部 4 字段（workspaceId/current/daemonOnline/switchWorkspace）", () => {
    pathnameRef.current = "/workspaces/A/changes";
    const { result } = renderHook(() => useWorkspaceContext(), {
      wrapper: w(mc()),
    });
    const keys = Object.keys(result.current);
    expect(keys).toEqual(
      expect.arrayContaining([
        "workspaceId",
        "current",
        "daemonOnline",
        "switchWorkspace",
      ]),
    );
    expect(typeof result.current.switchWorkspace).toBe("function");
  });
});
