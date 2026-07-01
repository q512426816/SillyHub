// lib/__tests__/use-daemon-runtimes.test.tsx
// task-08：useDaemonRuntimes data shape + params queryKey switch + sessions failure（FR-05/D-005@v1）。
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/lib/daemon", () => ({ listDaemonRuntimesPage: vi.fn(), listAgentSessions: vi.fn() }));
import { listDaemonRuntimesPage, listAgentSessions, type DaemonRuntimeRead, type AgentSessionRead } from "@/lib/daemon";
import { useDaemonRuntimes } from "../use-daemon-runtimes";

const listMock = vi.mocked(listDaemonRuntimesPage);
const sessMock = vi.mocked(listAgentSessions);
function mc() { return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); }
function w(c: QueryClient) {
  return function ProviderWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={c}>{children}</QueryClientProvider>;
  };
}
function rt(id: string) { return { id, name: id, provider: "c", status: "online" } as unknown as DaemonRuntimeRead; }
function ss(id: string) { return { id, runtime_id: "r", provider: "c", status: "active" } as unknown as AgentSessionRead; }

describe("useDaemonRuntimes", () => {
  beforeEach(() => { listMock.mockReset(); sessMock.mockReset(); });
  it("returns combined items/total/sessions", async () => {
    listMock.mockResolvedValue({ items:[rt("r1")], total:1, limit:20, offset:0 });
    sessMock.mockResolvedValue({ items:[ss("s1")], total:1, limit:100, offset:0 });
    const {result} = renderHook(()=>useDaemonRuntimes({limit:20}), {wrapper: w(mc())});
    await waitFor(()=>expect(result.current.items.length).toBe(1));
    expect(result.current.sessions.length).toBe(1);
    expect(listMock).toHaveBeenCalledWith({limit:20});
  });
  it("params switch triggers new query (queryKey change)", async () => {
    listMock.mockResolvedValue({ items:[], total:0, limit:20, offset:0 });
    sessMock.mockResolvedValue({ items:[], total:0, limit:100, offset:0 });
    const {rerender} = renderHook(({p})=>useDaemonRuntimes(p), {initialProps:{p:{q:"x",limit:20}}, wrapper:w(mc())});
    await waitFor(()=>expect(listMock).toHaveBeenCalledWith({q:"x",limit:20}));
    rerender({p:{q:"y",limit:20}});
    await waitFor(()=>expect(listMock).toHaveBeenCalledWith({q:"y",limit:20}));
  });
  it("sessions failure degrades to []", async () => {
    listMock.mockResolvedValue({ items:[rt("r1")], total:1, limit:20, offset:0 });
    sessMock.mockRejectedValue(new Error("boom"));
    const {result} = renderHook(()=>useDaemonRuntimes({limit:20}), {wrapper: w(mc())});
    await waitFor(()=>expect(result.current.items.length).toBe(1));
    expect(result.current.sessions).toEqual([]);
  });
});
