import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";

import { ChangeAgentRunLog } from "@/components/changes/detail/change-agent-run-log";
import type { DispatchResponse } from "@/lib/changes";

// 捕获 SillySpecStepProgress 收到的 props（验 FR-05b：onDispatch 不传）
const stepCapture = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));
vi.mock("@/components/sillyspec-step-progress", () => ({
  SillySpecStepProgress: (props: Record<string, unknown>) => {
    stepCapture.props = props;
    return <div data-testid="step-progress" />;
  },
}));
vi.mock("@/components/agent-run-panel", () => ({
  AgentRunPanel: ({ runId }: { runId: string | null }) => (
    <div data-testid="agent-run-panel" data-run={runId ?? ""} />
  ),
}));
vi.mock("@/components/team-progress", () => ({
  TeamProgress: ({ missionId }: { missionId: string }) => (
    <div data-testid="team-progress" data-mission={missionId} />
  ),
}));

function makeProps(over: Record<string, unknown> = {}) {
  return {
    workspaceId: "ws-1",
    panelRunId: "run-1",
    panelIsActive: true,
    agentStatus: {
      has_active_run: false,
      config_enabled: true,
      last_dispatch: { status: "completed", gate_status: null },
    } as unknown as DispatchResponse,
    gateStatus: null,
    currentStage: "execute",
    steps: undefined,
    teamMode: false,
    stageTeamMissionId: null,
    onDone: vi.fn(),
    onGateStatusChanged: vi.fn(),
    onRefresh: vi.fn(),
    refreshing: false,
    onDispatch: vi.fn(),
    dispatching: false,
    ...over,
  };
}

describe("ChangeAgentRunLog", () => {
  it("渲染子步骤进度，且不传 onDispatch/dispatching（FR-05b 消除双入口）", () => {
    render(<ChangeAgentRunLog {...makeProps()} />);
    expect(screen.getByTestId("step-progress")).toBeInTheDocument();
    expect(stepCapture.props).toBeTruthy();
    expect(stepCapture.props!.onDispatch).toBeUndefined();
    expect(stepCapture.props!.dispatching).toBeUndefined();
    // 刷新回调保留
    expect(stepCapture.props!.onRefresh).toBeDefined();
  });

  it("panelRunId 非空时渲染日志面板，默认折叠，点击展开见 AgentRunPanel", () => {
    render(<ChangeAgentRunLog {...makeProps({ panelRunId: "run-9" })} />);
    expect(screen.getByText("智能体执行日志")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-run-panel")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("▸ 展开"));
    const panel = screen.getByTestId("agent-run-panel");
    expect(panel).toHaveAttribute("data-run", "run-9");
  });

  it("panelRunId 为 null 时不渲染日志面板", () => {
    render(<ChangeAgentRunLog {...makeProps({ panelRunId: null })} />);
    expect(screen.queryByText("智能体执行日志")).not.toBeInTheDocument();
  });

  it("gate 徽标：decided 无 errors → ✓ 已通过", () => {
    render(
      <ChangeAgentRunLog
        {...makeProps({ gateStatus: { gate_status: "decided", errors_summary: null } as never })}
      />,
    );
    expect(screen.getByText("✓ 已通过")).toBeInTheDocument();
  });

  it("gate 徽标：pending → 客观核验中（animate-pulse）", () => {
    render(
      <ChangeAgentRunLog
        {...makeProps({ gateStatus: { gate_status: "pending" } as never })}
      />,
    );
    const badge = screen.getByText("客观核验中…");
    expect(badge.className).toContain("animate-pulse");
  });

  it("teamMode=true 且 stageTeamMissionId 非空 → 渲染 TeamProgress", () => {
    render(
      <ChangeAgentRunLog
        {...makeProps({ teamMode: true, stageTeamMissionId: "m-1" })}
      />,
    );
    expect(screen.getByTestId("team-progress")).toHaveAttribute("data-mission", "m-1");
  });

  it("teamMode=true 但 missionId 为空 → 不渲染 TeamProgress", () => {
    render(<ChangeAgentRunLog {...makeProps({ teamMode: true, stageTeamMissionId: null })} />);
    expect(screen.queryByTestId("team-progress")).not.toBeInTheDocument();
  });
});
