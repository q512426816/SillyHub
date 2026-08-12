// task-08（2026-08-11-change-detail-layout-rework / §9 测试迁移 / R-06 DOM 契约）：
// team toggle 已从 page.tsx 迁入 ChangeStageActions（task-04），本测试相应重写为
// 直接渲染 ChangeStageActions 组件——不再整页 render page.tsx，避免页面异步加载
// 带来的 act() 警告与 3s+ 慢测试，聚焦 team toggle 可见性矩阵本身。
//
// 覆盖（design §7 ChangeStageActionsProps + R-06 硬 DOM 契约）：
//   - execute stage：渲染 role=switch + aria-label=用团队执行
//   - verify stage：渲染 + 可见文案「用团队验证」
//   - plan + pending_review=plan_review：渲染（即将进 execute）
//   - verify + pending_review=human_test：渲染（verify 流转用）
//   - brainstorm / plan（无 pending）/ archived：不渲染
//   - 开启 toggle 后渲染 StageTeamConfig（+ 添加 Worker / Stage Worker 预设）

import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";

import { ChangeStageActions } from "@/components/changes/detail/change-stage-actions";
import type { ChangeRead, DispatchResponse } from "@/lib/changes";

// 2026-08-12-dispatch-bind-agent-profile：ChangeStageActions 内部用 AgentProfileSelect
// （react-query hook），mock 掉避免 QueryClientProvider 依赖（聚焦 team toggle 矩阵）。
vi.mock("@/components/agent-profile-select", () => ({
  AgentProfileSelect: ({ value }: { value: string | null }) => (
    <div data-testid="profile-select" data-value={value ?? ""} />
  ),
}));

// 轻量替身：StageTeamConfig 内部依赖较重，mock 成可断言 testid + 真实文案
// （+ 添加 Worker / Stage Worker 预设），不断言 aria 契约（那是 ChangeStageActions 自身的 switch）。
vi.mock("@/components/stage-team-config", () => ({
  StageTeamConfig: () => (
    <div data-testid="stage-team-config">
      <p>Stage Worker 预设</p>
      <button>+ 添加 Worker</button>
    </div>
  ),
}));

// AgentProviderSelect / AgentModelInput：重依赖替身（本测试不关心其内部）
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
    agentStatus: {
      has_active_run: false,
      config_enabled: true,
    } as unknown as DispatchResponse,
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
    // 2026-08-12-dispatch-bind-agent-profile：ChangeStageActions Props 改选档案
    // （去 stageProvider/stageModel，加 workspaceId/stageProfileId/onStageProfileChange）。
    workspaceId: "ws-1",
    stageProfileId: null,
    onStageProfileChange: vi.fn(),
    teamMode: false,
    onTeamModeChange: vi.fn(),
    stageWorkers: [],
    onStageWorkersChange: vi.fn(),
    ...over,
  };
}

describe("ChangeStageActions team toggle 可见性矩阵（task-08 迁移自 page-team-toggle）", () => {
  it("execute stage 渲染 team toggle（role=switch + aria-label=用团队执行 + aria-checked=false）", () => {
    render(
      <ChangeStageActions
        {...makeProps({ change: makeChange({ current_stage: "execute" }) })}
      />,
    );
    const sw = screen.getByRole("switch", { name: "用团队执行" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/用团队执行/)).toBeInTheDocument();
  });

  it("verify stage 渲染 team toggle（可见文案切「用团队验证」）", () => {
    render(
      <ChangeStageActions
        {...makeProps({
          change: makeChange({ current_stage: "verify" }),
          nextStage: "archive",
        })}
      />,
    );
    // aria-label 固定为「用团队执行」（R-06 契约），可见文案随 stage 切「验证」
    expect(screen.getByRole("switch", { name: "用团队执行" })).toBeInTheDocument();
    expect(screen.getByText(/用团队验证/)).toBeInTheDocument();
  });

  it("plan + pending_review=plan_review 渲染 team toggle（即将进 execute）", () => {
    render(
      <ChangeStageActions
        {...makeProps({
          change: makeChange({ current_stage: "plan", pending_review: "plan_review" }),
        })}
      />,
    );
    expect(screen.getByRole("switch", { name: "用团队执行" })).toBeInTheDocument();
  });

  it("verify + pending_review=human_test 渲染 team toggle（verify 流转用）", () => {
    render(
      <ChangeStageActions
        {...makeProps({
          change: makeChange({ current_stage: "verify", pending_review: "human_test" }),
          nextStage: "archive",
        })}
      />,
    );
    expect(screen.getByRole("switch", { name: "用团队执行" })).toBeInTheDocument();
  });

  it("brainstorm stage 不渲染 team toggle", () => {
    render(
      <ChangeStageActions
        {...makeProps({ change: makeChange({ current_stage: "brainstorm" }) })}
      />,
    );
    expect(screen.queryByRole("switch", { name: /用团队/ })).not.toBeInTheDocument();
  });

  it("plan stage（无 plan_review pending）不渲染 team toggle", () => {
    render(
      <ChangeStageActions
        {...makeProps({ change: makeChange({ current_stage: "plan", pending_review: null }) })}
      />,
    );
    expect(screen.queryByRole("switch", { name: /用团队/ })).not.toBeInTheDocument();
  });

  it("archived stage 不渲染 team toggle", () => {
    render(
      <ChangeStageActions
        {...makeProps({ change: makeChange({ current_stage: "archive" }) })}
      />,
    );
    expect(screen.queryByRole("switch", { name: /用团队/ })).not.toBeInTheDocument();
  });

  it("开启 team toggle 后渲染 StageTeamConfig（+ 添加 Worker / Stage Worker 预设）", () => {
    // ChangeStageActions 受控：用 Harness 包一层 useState 模拟 page 的 onTeamModeChange 接线，
    // 点击 switch → setTeamMode(true) → StageTeamConfig 展开（与真实交互一致）
    function Harness() {
      const [teamMode, setTeamMode] = useState(false);
      return (
        <ChangeStageActions
          {...makeProps({ change: makeChange({ current_stage: "execute" }) })}
          teamMode={teamMode}
          onTeamModeChange={setTeamMode}
        />
      );
    }
    render(<Harness />);
    // 初始关闭：无 StageTeamConfig
    expect(screen.queryByTestId("stage-team-config")).not.toBeInTheDocument();
    // 点击开启
    fireEvent.click(screen.getByRole("switch", { name: "用团队执行" }));
    // 展开 StageTeamConfig
    expect(screen.getByTestId("stage-team-config")).toBeInTheDocument();
    expect(screen.getByText("+ 添加 Worker")).toBeInTheDocument();
    expect(screen.getByText(/Stage Worker 预设/)).toBeInTheDocument();
  });
});
