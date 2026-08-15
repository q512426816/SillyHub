/**
 * task-04（2026-08-15-change-step-visibility / FR-01 / D-003@v1）：ChangeStepBadge 组件测试。
 *
 * 覆盖 task 验收：
 *   - active：蓝脉动标记 + step x/y 计数 + 当前步名
 *   - waiting：黄 + 「等待用户决策」chip 文案
 *   - done：绿勾全完成，无步名
 *   - 降级：stepProgress null / step_total 0 → 无摘要副行，stage 主行照常
 *   - 迷你进度条宽度按 steps_completed/step_total 完成比
 *   - 未知 current_step_status 兜底渲染不崩溃
 *
 * 范式参照 change-stage-header.test.tsx：纯 render + screen 断言，无 mock。
 */

import { render, screen } from "@testing-library/react";

import {
  ChangeStepBadge,
  type StepProgressSummary,
} from "@/components/changes/change-step-badge";

/** 构造摘要（字段对齐 api-types StepProgressSummary，勿增删字段名）。 */
function summary(overrides: Partial<StepProgressSummary>): StepProgressSummary {
  return {
    step_total: 8,
    steps_completed: 2,
    current_step_name: "对话式探索与需求澄清",
    current_step_status: "active",
    current_step_desc: null,
    ...overrides,
  };
}

describe("ChangeStepBadge", () => {
  it("active：蓝脉动点 + step x/y 计数 + 当前步名", () => {
    render(
      <ChangeStepBadge
        stage="brainstorm"
        stepProgress={summary({ step_total: 8, steps_completed: 2 })}
      />,
    );
    const dot = screen.getByTestId("step-active-dot");
    expect(dot.className).toContain("animate-pulse");
    expect(dot.className).toContain("bg-blue-600");
    expect(screen.getByTestId("step-count")).toHaveTextContent("step 2/8");
    expect(screen.getByText(/对话式探索与需求澄清/)).toBeInTheDocument();
  });

  it("waiting：黄色标记 + 「等待用户决策」chip", () => {
    render(
      <ChangeStepBadge
        stage="plan"
        stepProgress={summary({
          step_total: 5,
          steps_completed: 3,
          current_step_name: "设计确认",
          current_step_status: "waiting",
        })}
      />,
    );
    const chip = screen.getByTestId("step-waiting-chip");
    expect(chip).toHaveTextContent("等待用户决策");
    expect(chip.className).toContain("bg-yellow-100");
    expect(screen.getByTestId("step-count")).toHaveTextContent("step 3/5");
    expect(screen.queryByTestId("step-active-dot")).not.toBeInTheDocument();
  });

  it("done：绿勾全完成，无步名", () => {
    render(
      <ChangeStepBadge
        stage="verify"
        stepProgress={summary({
          step_total: 8,
          steps_completed: 8,
          current_step_name: null,
          current_step_status: null,
        })}
      />,
    );
    const check = screen.getByTestId("step-done-check");
    expect(check.className).toContain("text-emerald-600");
    expect(screen.getByTestId("step-count")).toHaveTextContent("step 8/8");
    // 全完成：绿条（满宽）+ 「全部完成」文案，不渲染步名
    expect(screen.getByTestId("step-bar").className).toContain("bg-emerald-500");
    expect(screen.getByText("· 全部完成")).toBeInTheDocument();
    expect(screen.queryByText(/对话式探索与需求澄清/)).not.toBeInTheDocument();
  });

  it("stage 主行：已知 stage 中文标签 + 色语义；未知 stage 原值兜底", () => {
    const { rerender } = render(
      <ChangeStepBadge stage="brainstorm" stepProgress={null} />,
    );
    expect(screen.getByText("需求分析")).toBeInTheDocument();

    rerender(<ChangeStepBadge stage="mystery-stage" stepProgress={null} />);
    expect(screen.getByText("mystery-stage")).toBeInTheDocument();
  });

  it("降级：stepProgress null → 只渲染 stage 主行，无摘要副行", () => {
    const { container } = render(
      <ChangeStepBadge stage="execute" stepProgress={null} />,
    );
    expect(screen.getByText("执行")).toBeInTheDocument();
    expect(screen.queryByTestId("step-sub-row")).not.toBeInTheDocument();
    expect(container.querySelector("[data-testid='step-bar']")).toBeNull();
  });

  it("降级：step_total 0 → 无摘要副行", () => {
    render(
      <ChangeStepBadge
        stage="execute"
        stepProgress={summary({ step_total: 0, steps_completed: 0 })}
      />,
    );
    expect(screen.getByText("执行")).toBeInTheDocument();
    expect(screen.queryByTestId("step-sub-row")).not.toBeInTheDocument();
  });

  it("stage null → 返回 null 不渲染", () => {
    const { container } = render(
      <ChangeStepBadge stage={null} stepProgress={summary({})} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("进度条宽度按完成比：2/8 → 25%", () => {
    render(
      <ChangeStepBadge
        stage="quick"
        stepProgress={summary({ step_total: 8, steps_completed: 2 })}
      />,
    );
    const bar = screen.getByTestId("step-bar");
    expect(bar.style.width).toBe("25%");
  });

  it("进度条宽度按完成比：3/5 → 60%", () => {
    render(
      <ChangeStepBadge
        stage="quick"
        stepProgress={summary({ step_total: 5, steps_completed: 3 })}
      />,
    );
    expect(screen.getByTestId("step-bar").style.width).toBe("60%");
  });

  it("越界数据钳位不崩溃：steps_completed > step_total → 100%", () => {
    render(
      <ChangeStepBadge
        stage="execute"
        stepProgress={summary({ step_total: 4, steps_completed: 9 })}
      />,
    );
    expect(screen.getByTestId("step-count")).toHaveTextContent("step 4/4");
    expect(screen.getByTestId("step-bar").style.width).toBe("100%");
  });

  it("未知 current_step_status 兜底渲染不崩溃（灰点 + 计数仍在）", () => {
    render(
      <ChangeStepBadge
        stage="execute"
        stepProgress={summary({ current_step_status: "mystery" })}
      />,
    );
    expect(screen.getByTestId("step-unknown-dot")).toBeInTheDocument();
    expect(screen.getByTestId("step-count")).toHaveTextContent("step 2/8");
  });

  it("未知 status 且无步名：仍渲染副行（后端契约外防御，零崩溃）", () => {
    render(
      <ChangeStepBadge
        stage="execute"
        stepProgress={summary({ current_step_name: null, current_step_status: "mystery" })}
      />,
    );
    expect(screen.getByTestId("step-sub-row")).toBeInTheDocument();
    expect(screen.getByTestId("step-count")).toHaveTextContent("step 2/8");
  });
});
