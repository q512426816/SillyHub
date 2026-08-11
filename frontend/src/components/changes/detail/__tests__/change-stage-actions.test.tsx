import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";

import { ChangeStageActions } from "@/components/changes/detail/change-stage-actions";
import type {
  ChangeRead,
  DispatchResponse,
  VerifyGateResponse,
} from "@/lib/changes";

// 黑盒 mock 被复用组件（只测 ChangeStageActions 自身收口与回调）
vi.mock("@/components/AgentProviderSelect", () => ({
  AgentProviderSelect: ({ value }: { value: string | null }) => (
    <div data-testid="provider-select" data-value={value ?? ""} />
  ),
}));
vi.mock("@/components/AgentModelInput", () => ({
  AgentModelInput: ({ value }: { value: string | null }) => (
    <div data-testid="model-input" data-value={value ?? ""} />
  ),
}));
vi.mock("@/components/stage-team-config", () => ({
  StageTeamConfig: () => (
    <div data-testid="stage-team-config">
      <button>添加 Worker</button>
    </div>
  ),
}));

function makeChange(over: Partial<ChangeRead>): ChangeRead {
  return {
    current_stage: "execute",
    pending_review: null,
    ...over,
  } as unknown as ChangeRead;
}

function makeProps(over: Record<string, unknown> = {}) {
  return {
    change: makeChange({}),
    agentStatus: { has_active_run: false, config_enabled: true } as unknown as DispatchResponse,
    nextStage: "verify",
    verifyGate: null,
    gateComment: "",
    onGateCommentChange: vi.fn(),
    onGateAction: vi.fn(),
    onAdvance: vi.fn(),
    onRunVerifyGate: vi.fn(),
    onDispatch: vi.fn(),
    transitioning: false,
    dispatching: false,
    advancing: false,
    stageProvider: null,
    onStageProviderChange: vi.fn(),
    stageModel: null,
    onStageModelChange: vi.fn(),
    teamMode: false,
    onTeamModeChange: vi.fn(),
    stageWorkers: [],
    onStageWorkersChange: vi.fn(),
    ...over,
  };
}

describe("ChangeStageActions", () => {
  it("gate 面板：proposal_review 渲染按钮，点击调 onGateAction，textarea 调 onGateCommentChange", () => {
    const props = makeProps({
      change: makeChange({ current_stage: "brainstorm", pending_review: "proposal_review" }),
    });
    render(<ChangeStageActions {...props} />);
    expect(screen.getByText("四件套已生成，请确认")).toBeInTheDocument();
    fireEvent.click(screen.getByText("确认通过"));
    expect(props.onGateAction).toHaveBeenCalledWith("proposal_approve");
    fireEvent.change(screen.getByPlaceholderText("审核意见（可选）"), {
      target: { value: "意见" },
    });
    expect(props.onGateCommentChange).toHaveBeenCalledWith("意见");
  });

  it("推进横幅：有 nextStage + 无活跃 run + 无 gate 时显示，点推进调 onAdvance", () => {
    const props = makeProps({ nextStage: "verify" });
    render(<ChangeStageActions {...props} />);
    expect(screen.getByText("当前阶段已完成，待触发下一阶段")).toBeInTheDocument();
    fireEvent.click(screen.getByText('推进到「验证」'));
    expect(props.onAdvance).toHaveBeenCalled();
  });

  it("有活跃 run 时不显示推进横幅", () => {
    const props = makeProps({
      agentStatus: { has_active_run: true, config_enabled: true } as unknown as DispatchResponse,
    });
    render(<ChangeStageActions {...props} />);
    expect(screen.queryByText("当前阶段已完成，待触发下一阶段")).not.toBeInTheDocument();
  });

  it("verify 阶段显示运行验证门禁按钮，点击调 onRunVerifyGate", () => {
    const props = makeProps({ change: makeChange({ current_stage: "verify" }), nextStage: "archive" });
    render(<ChangeStageActions {...props} />);
    fireEvent.click(screen.getByText("运行验证门禁"));
    expect(props.onRunVerifyGate).toHaveBeenCalled();
  });

  it("verifyGate 结果文案：unavailable 显示暂不可用", () => {
    const props = makeProps({
      change: makeChange({ current_stage: "verify" }),
      nextStage: "archive",
      verifyGate: { source: "unavailable", exit_code: null, errors: [] } as unknown as VerifyGateResponse,
    });
    render(<ChangeStageActions {...props} />);
    expect(screen.getByText(/暂不可用/)).toBeInTheDocument();
  });

  it("触发智能体按钮：configEnabled + 无活跃 run 时显示，点击调 onDispatch", () => {
    const props = makeProps();
    render(<ChangeStageActions {...props} />);
    fireEvent.click(screen.getByText("🤖 触发智能体"));
    expect(props.onDispatch).toHaveBeenCalled();
  });

  it("team toggle：execute 阶段渲染，role=switch + aria-label=用团队执行 契约保留", () => {
    const props = makeProps({ change: makeChange({ current_stage: "execute" }) });
    render(<ChangeStageActions {...props} />);
    const sw = screen.getByRole("switch", { name: "用团队执行" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sw);
    expect(props.onTeamModeChange).toHaveBeenCalledWith(true);
  });

  it("team toggle：brainstorm 阶段不渲染", () => {
    const props = makeProps({ change: makeChange({ current_stage: "brainstorm" }) });
    render(<ChangeStageActions {...props} />);
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("开启 team toggle 后渲染 StageTeamConfig（出现 添加 Worker）", () => {
    const props = makeProps({
      change: makeChange({ current_stage: "execute" }),
      teamMode: true,
    });
    render(<ChangeStageActions {...props} />);
    expect(screen.getByText("添加 Worker")).toBeInTheDocument();
  });
});
