// lib/__tests__/use-daemon-machines.test.ts
// task-10：useDaemonMachines 单测（FR-4,6 / D-002）。
//
// 覆盖：
//   1. data shape 返回 items/total/sessions（machine 级 list + session 聚合）。
//   2. params 变化走 queryKeys.daemonMachines.list（queryKey 切换触发新查询）。
//   3. listAgentSessions 失败 → sessions 降级为 []，不阻塞 items 列表渲染。
//   4. refetchInterval=15000（15s 无条件轮询）配置在 useQuery options。
//
// 模式照搬 use-daemon-runtimes.test.tsx（renderHook + waitFor +
// QueryClientProvider retry:false/gcTime:0）。
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

vi.mock("@/lib/daemon", () => ({
  listDaemonMachines: vi.fn(),
  listAgentSessions: vi.fn(),
}));
import {
  listDaemonMachines,
  listAgentSessions,
  type DaemonMachineRead,
  type AgentSessionRead,
} from "@/lib/daemon";
import { useDaemonMachines } from "../use-daemon-machines";

const listMock = vi.mocked(listDaemonMachines);
const sessMock = vi.mocked(listAgentSessions);

function mc() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, refetchInterval: false } },
  });
}
function w(c: QueryClient) {
  return function ProviderWrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: c }, children);
  };
}
function mach(id: string) {
  return {
    id,
    hostname: id,
    display_alias: null,
    os: "linux",
    arch: "x64",
    status: "online",
    last_heartbeat_at: "2026-07-07T10:00:00Z",
    version: "1.4.2",
    build_id: "a1b2c3d",
    created_at: "2026-07-07T09:00:00Z",
    owner: null,
    runtime_count: 0,
    online_runtime_count: 0,
    runtimes: [],
  } as unknown as DaemonMachineRead;
}
function ss(id: string) {
  return {
    id,
    runtime_id: "rt",
    provider: "claude",
    status: "active",
  } as unknown as AgentSessionRead;
}

describe("useDaemonMachines", () => {
  beforeEach(() => {
    listMock.mockReset();
    sessMock.mockReset();
  });

  it("returns combined items/total/sessions", async () => {
    listMock.mockResolvedValue({ items: [mach("m1")], total: 1, limit: 20, offset: 0 });
    sessMock.mockResolvedValue({ items: [ss("s1")], total: 1, limit: 100, offset: 0 });
    const { result } = renderHook(() => useDaemonMachines({ limit: 20 }), {
      wrapper: w(mc()),
    });
    await waitFor(() => expect(result.current.items.length).toBe(1));
    expect(result.current.total).toBe(1);
    expect(result.current.sessions.length).toBe(1);
    expect(listMock).toHaveBeenCalledWith({ limit: 20 });
  });

  it("params switch triggers new query (queryKey change)", async () => {
    listMock.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });
    sessMock.mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
    const { rerender } = renderHook(({ p }) => useDaemonMachines(p), {
      initialProps: { p: { q: "x", limit: 20 } },
      wrapper: w(mc()),
    });
    await waitFor(() => expect(listMock).toHaveBeenCalledWith({ q: "x", limit: 20 }));
    rerender({ p: { q: "y", limit: 20 } });
    await waitFor(() => expect(listMock).toHaveBeenCalledWith({ q: "y", limit: 20 }));
  });

  it("sessions failure degrades to [] (不阻塞列表)", async () => {
    listMock.mockResolvedValue({ items: [mach("m1")], total: 1, limit: 20, offset: 0 });
    sessMock.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useDaemonMachines({ limit: 20 }), {
      wrapper: w(mc()),
    });
    await waitFor(() => expect(result.current.items.length).toBe(1));
    expect(result.current.sessions).toEqual([]);
  });

  // task-10 第 4 点：refetchInterval=15000（15s 无条件轮询，FR-6）。
  // 用 fake timers 验轮询触发：首次 queryFn 调一次，advance 15s 后应再调一次。
  it("refetchInterval=15000 触发 15s 轮询（listDaemonMachines 二次调用）", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      listMock.mockResolvedValue({ items: [mach("m1")], total: 1, limit: 20, offset: 0 });
      sessMock.mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
      const { result } = renderHook(() => useDaemonMachines({ limit: 20 }), {
        wrapper: w(mc()),
      });
      // 首次拉取完成。
      await waitFor(() => expect(result.current.items.length).toBe(1));
      expect(listMock).toHaveBeenCalledTimes(1);
      // 推进 15s → refetchInterval 触发轮询，listDaemonMachines 再调一次。
      vi.advanceTimersByTime(15_000);
      await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    } finally {
      vi.useRealTimers();
    }
  });
});
