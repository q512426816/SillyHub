// lib/__tests__/use-agent-runs.test.tsx
// task-07：useAgentRuns data/error + refetchInterval 谓词（FR-04 / D-003@v1）。
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ApiError } from "@/lib/api";
import { type AgentRun } from "@/lib/agent";

vi.mock("@/lib/agent", () => ({ listAgentRuns: vi.fn() }));
import { listAgentRuns } from "@/lib/agent";
import { agentRunsRefetchInterval, useAgentRuns } from "../use-agent-runs";

const listMock = vi.mocked(listAgentRuns);
function makeClient() { return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); }
function withProvider(client: QueryClient) {
  return function ProviderWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}
function makeRun(o: Partial<AgentRun> = {}): AgentRun { return { id:"r", task_id:"t", lease_id:"l", agent_type:"c", status:"completed", ...o } as unknown as AgentRun; }
function apiErr(s: number) { return new ApiError(s, { code:`E${s}`, message:`e${s}`, request_id:null, details:null }); }

describe("agentRunsRefetchInterval", () => {
  it("running -> 5000", () => { expect(agentRunsRefetchInterval([makeRun({status:"running"})])).toBe(5000); });
  it("no running -> false", () => {
    expect(agentRunsRefetchInterval([makeRun({status:"completed"})])).toBe(false);
    expect(agentRunsRefetchInterval([])).toBe(false);
    expect(agentRunsRefetchInterval(undefined)).toBe(false);
  });
});
describe("useAgentRuns", () => {
  beforeEach(() => { listMock.mockReset(); vi.spyOn(console,"error").mockImplementation(()=>{}); });
  it("success", async () => {
    const d = [makeRun({id:"a"})]; listMock.mockResolvedValue(d);
    const {result} = renderHook(()=>useAgentRuns("ws-1"), {wrapper:withProvider(makeClient())});
    await waitFor(()=>expect(result.current.runs).toEqual(d));
    expect(listMock).toHaveBeenCalledWith("ws-1");
  });
  it("error returns ApiError runs=[]", async () => {
    listMock.mockRejectedValue(apiErr(500));
    const {result} = renderHook(()=>useAgentRuns("ws-1"), {wrapper:withProvider(makeClient())});
    await waitFor(()=>expect(result.current.isError).toBe(true));
    expect(result.current.runs).toEqual([]);
    expect(result.current.error).toBeInstanceOf(ApiError);
  });
});
