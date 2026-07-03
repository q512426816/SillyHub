/**
 * ql-20260702-002：agent 控制台 pending run 可见性测试。
 *
 * 覆盖 page.tsx 改动：pending run 并入活跃运行面板。原 runningRuns/completedRuns
 * 两条派生流都过滤掉 pending，但"总运行"SummaryCard=runs.length 把 pending 算进去了，
 * 导致用户看到"总运行 1"却看不到任何 run 也点不到日志。修复后 pending 应可见。
 *
 * 验证：pending 卡片在活跃面板可见 + "排队中"徽标 + 排队角标 + 总运行计数自洽 +
 * 终止 pending 调 killAgentRun（后端 kill_run 支持 pending lease 直接置 killed）。
 */
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentRun } from "@/lib/agent";

// next/link mock（page 用 Link 渲染 task/change 链接）
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// AgentRunPanel 整体 mock（隔离 SSE + markdown-text jsdom null 坑，见
// frontend-markdown-text-jsdom-null 记忆）。
vi.mock("@/components/agent-run-panel", () => ({
  AgentRunPanel: () => <div data-testid="agent-run-panel-mock" />,
}));

// @/lib/agent：override killAgentRun（避免真实 fetch），其余用 actual。
const agentApi = vi.hoisted(() => ({ killAgentRun: vi.fn() }));
vi.mock("@/lib/agent", async () => {
  const actual = await vi.importActual<typeof import("@/lib/agent")>("@/lib/agent");
  return { ...actual, killAgentRun: agentApi.killAgentRun };
});

// @/lib/use-agent-runs：返回静态 runs，绕过 react-query Provider（只测 page 渲染逻辑）。
const runsState = vi.hoisted(() => ({ runs: [] as AgentRun[] }));
vi.mock("@/lib/use-agent-runs", () => ({
  useAgentRuns: () => ({
    runs: runsState.runs,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

import AgentPage from "@/app/(dashboard)/workspaces/[id]/agent/page";

function makeRun(o: Partial<AgentRun>): AgentRun {
  return {
    id: "runid01",
    task_id: null,
    lease_id: null,
    change_id: null,
    agent_type: "claude_code",
    provider: null,
    model: null,
    status: "pending",
    started_at: null,
    finished_at: null,
    exit_code: null,
    output_redacted: null,
    spec_strategy: "platform-managed",
    profile_version: null,
    diff_summary: null,
    created_at: "2026-07-02T15:00:00Z",
    total_cost_usd: null,
    duration_ms: null,
    duration_api_ms: null,
    num_turns: null,
    session_id: null,
    agent_session_id: null,
    input_tokens: null,
    output_tokens: null,
    cache_read_tokens: null,
    cache_creation_tokens: null,
    post_scan_status: null,
    source_commit: null,
    is_resume: null,
    resumed_from_step: null,
    ...o,
  } as unknown as AgentRun;
}

beforeEach(() => {
  runsState.runs = [];
  agentApi.killAgentRun.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => cleanup());

describe("agent page — pending run 可见性 (ql-20260702-002)", () => {
  it("pending run 显示在活跃面板，带「排队中」徽标和 run id", () => {
    runsState.runs = [makeRun({ id: "pend0001", status: "pending" })];
    render(<AgentPage params={{ id: "ws-1" }} />);
    // 卡片"排队中"Badge（区别于 running 蓝脉动）。
    expect(screen.getByText("排队中")).toBeInTheDocument();
    // shortId：id 长度 <=8 返回原串。
    expect(screen.getByText("pend0001")).toBeInTheDocument();
  });

  it("running + pending 同时存在，两者都渲染且各有角标", () => {
    runsState.runs = [
      makeRun({ id: "runrun01", status: "running", started_at: "2026-07-02T15:00:00Z" }),
      makeRun({ id: "pendrun1", status: "pending" }),
    ];
    render(<AgentPage params={{ id: "ws-1" }} />);
    expect(screen.getByText("pendrun1")).toBeInTheDocument();
    expect(screen.getByText("runrun01")).toBeInTheDocument();
    // Header 角标：排队（琥珀）+ 运行（绿脉动）。
    expect(screen.getByText(/1 个排队中/)).toBeInTheDocument();
    expect(screen.getByText(/1 个运行中/)).toBeInTheDocument();
  });

  it("总运行 SummaryCard = runs.length（pending+running+completed 数字自洽）", () => {
    runsState.runs = [
      makeRun({ id: "aaaa1111", status: "pending" }),
      makeRun({ id: "bbbb2222", status: "running", started_at: "2026-07-02T15:00:00Z" }),
      makeRun({ id: "cccc3333", status: "completed", finished_at: "2026-07-02T15:01:00Z" }),
    ];
    render(<AgentPage params={{ id: "ws-1" }} />);
    // "总运行" label 的最近 div 含 label + value(3)。
    const totalLabel = screen.getByText("总运行");
    expect(totalLabel.closest("div")).toHaveTextContent("3");
  });

  it("终止 pending run 调用 killAgentRun(workspaceId, runId)", async () => {
    runsState.runs = [makeRun({ id: "kill0001", status: "pending" })];
    agentApi.killAgentRun.mockResolvedValue({});
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AgentPage params={{ id: "ws-1" }} />);
    fireEvent.click(screen.getByRole("button", { name: /终止/ }));
    await waitFor(() =>
      expect(agentApi.killAgentRun).toHaveBeenCalledWith("ws-1", "kill0001"),
    );
  });
});
