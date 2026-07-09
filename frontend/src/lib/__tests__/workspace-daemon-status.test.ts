// lib/__tests__/workspace-daemon-status.test.ts
// task-03（2026-07-09-workspace-prioritization）：daemon 在线状态聚合单测。
//
// 覆盖：
//   1. aggregateDaemonStatus 纯函数（不依赖 React）：
//      - 在线 / 离线 / maintenance / disabled 各 status → online 计算
//      - daemon_id=null（未绑定）→ online=false，不报错
//      - daemon_id 指向的 instance 不在 instances（已下线/无权）→ online=false，不抛错
//      - 空 bindings / 空 instances → {} 空映射
//      - status 字段透传（online/offline/maintenance/disabled/缺失→null）
//   2. useDaemonStatusMap hook（react-query 聚合，模式照搬 use-daemon-machines.test）：
//      - 正常路径：statusMap 按 workspace_id 索引，含 online 判定
//      - listDaemonInstances 失败 → statusMap 降级 {}（不崩）
//      - fetchMyBindings 失败 → statusMap 降级 {}（fetchMyBindings 自身已 catch 返回 []）
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

vi.mock("@/lib/workspace-binding", () => ({
  fetchMyBindings: vi.fn(),
}));
vi.mock("@/lib/daemon", () => ({
  listDaemonInstances: vi.fn(),
}));
import { fetchMyBindings } from "@/lib/workspace-binding";
import { listDaemonInstances } from "@/lib/daemon";
import type { MemberBindingView } from "@/lib/workspace-binding";
import type { DaemonInstanceRead } from "@/lib/daemon";
import {
  aggregateDaemonStatus,
  useDaemonStatusMap,
} from "../workspace-daemon-status";

const bindingsMock = vi.mocked(fetchMyBindings);
const instancesMock = vi.mocked(listDaemonInstances);

function binding(workspaceId: string, daemonId: string | null): MemberBindingView {
  return {
    workspace_id: workspaceId,
    daemon_id: daemonId,
    root_path: "/proj",
    path_source: "daemon",
  } as unknown as MemberBindingView;
}
function instance(id: string, status: string): DaemonInstanceRead {
  return {
    id,
    hostname: id,
    display_alias: null,
    status,
    providers: [],
  } as unknown as DaemonInstanceRead;
}

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

describe("aggregateDaemonStatus（纯函数）", () => {
  it("status==='online' → online=true", () => {
    const out = aggregateDaemonStatus(
      [binding("ws1", "d1")],
      [instance("d1", "online")],
    );
    expect(out.ws1).toEqual({
      daemon_id: "d1",
      online: true,
      status: "online",
    });
  });

  it("status==='offline' → online=false", () => {
    const out = aggregateDaemonStatus(
      [binding("ws1", "d1")],
      [instance("d1", "offline")],
    );
    expect(out.ws1).toEqual({ daemon_id: "d1", online: false, status: "offline" });
  });

  it("status==='maintenance' 视为离线（online=false，status 透传）", () => {
    const out = aggregateDaemonStatus(
      [binding("ws1", "d1")],
      [instance("d1", "maintenance")],
    );
    expect(out.ws1).toEqual({
      daemon_id: "d1",
      online: false,
      status: "maintenance",
    });
  });

  it("status==='disabled' 视为离线（online=false，status 透传）", () => {
    const out = aggregateDaemonStatus(
      [binding("ws1", "d1")],
      [instance("d1", "disabled")],
    );
    expect(out.ws1).toEqual({
      daemon_id: "d1",
      online: false,
      status: "disabled",
    });
  });

  it("daemon_id=null（未绑定）→ online=false, status=null, 不报错", () => {
    const out = aggregateDaemonStatus([binding("ws1", null)], [
      instance("d1", "online"),
    ]);
    expect(out.ws1).toEqual({ daemon_id: null, online: false, status: null });
  });

  it("daemon_id 指向的 instance 不在列表（已下线/无权）→ online=false, status=null, 不抛错", () => {
    const out = aggregateDaemonStatus(
      [binding("ws1", "d-missing")],
      [instance("d-other", "online")],
    );
    expect(out.ws1).toEqual({ daemon_id: "d-missing", online: false, status: null });
  });

  it("多个 workspace 并存：混合在线/离线/未绑定/缺失", () => {
    const out = aggregateDaemonStatus(
      [
        binding("ws-online", "d1"),
        binding("ws-offline", "d2"),
        binding("ws-unbound", null),
        binding("ws-missing", "d-x"),
      ],
      [instance("d1", "online"), instance("d2", "offline")],
    );
    expect(out["ws-online"]).toEqual({ daemon_id: "d1", online: true, status: "online" });
    expect(out["ws-offline"]).toEqual({ daemon_id: "d2", online: false, status: "offline" });
    expect(out["ws-unbound"]).toEqual({ daemon_id: null, online: false, status: null });
    expect(out["ws-missing"]).toEqual({ daemon_id: "d-x", online: false, status: null });
  });

  it("空 bindings → {}", () => {
    expect(aggregateDaemonStatus([], [instance("d1", "online")])).toEqual({});
  });

  it("空 instances → 所有已绑定 ws online=false, status=null", () => {
    const out = aggregateDaemonStatus([binding("ws1", "d1")], []);
    expect(out.ws1).toEqual({ daemon_id: "d1", online: false, status: null });
  });

  it("空 bindings + 空 instances → {}", () => {
    expect(aggregateDaemonStatus([], [])).toEqual({});
  });

  it("同一 daemon_id 被多个 ws 绑定 → 各自独立判定", () => {
    const out = aggregateDaemonStatus(
      [binding("ws1", "d1"), binding("ws2", "d1")],
      [instance("d1", "online")],
    );
    expect(out.ws1?.online).toBe(true);
    expect(out.ws2?.online).toBe(true);
  });
});

describe("useDaemonStatusMap（hook）", () => {
  beforeEach(() => {
    bindingsMock.mockReset();
    instancesMock.mockReset();
  });

  it("正常路径：statusMap 按 workspace_id 索引，含 online 判定", async () => {
    bindingsMock.mockResolvedValue([
      binding("ws1", "d1"),
      binding("ws2", "d2"),
    ]);
    instancesMock.mockResolvedValue([
      instance("d1", "online"),
      instance("d2", "offline"),
    ]);
    const { result } = renderHook(() => useDaemonStatusMap(), {
      wrapper: w(mc()),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isError).toBe(false);
    expect(result.current.statusMap["ws1"]).toEqual({
      daemon_id: "d1",
      online: true,
      status: "online",
    });
    expect(result.current.statusMap["ws2"]).toEqual({
      daemon_id: "d2",
      online: false,
      status: "offline",
    });
  });

  it("listDaemonInstances 失败 → statusMap 降级 {}（不崩，isError=false）", async () => {
    // fetchMyBindings 返回 []（自身 catch 降级），instances 抛错被 hook 内部 catch → []
    bindingsMock.mockResolvedValue([binding("ws1", "d1")]);
    instancesMock.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useDaemonStatusMap(), {
      wrapper: w(mc()),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isError).toBe(false);
    // instances 降级为 [] → ws1 的 d1 找不到 → online=false（statusMap 非空但全离线）
    expect(result.current.statusMap["ws1"]).toEqual({
      daemon_id: "d1",
      online: false,
      status: null,
    });
  });

  it("fetchMyBindings 返回 []（无绑定）→ statusMap={}", async () => {
    bindingsMock.mockResolvedValue([]);
    instancesMock.mockResolvedValue([instance("d1", "online")]);
    const { result } = renderHook(() => useDaemonStatusMap(), {
      wrapper: w(mc()),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.statusMap).toEqual({});
  });

  it("初始 isLoading=true，statusMap 默认 {}", () => {
    bindingsMock.mockReturnValue(new Promise(() => {})); // never resolves
    instancesMock.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useDaemonStatusMap(), {
      wrapper: w(mc()),
    });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.statusMap).toEqual({});
  });
});
