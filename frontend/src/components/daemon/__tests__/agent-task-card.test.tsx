/**
 * verify P1 返工（2026-08-24-platform-session-feedback-fix / FR-03）：
 * 后台 Agent 任务卡片（AgentTaskCard）渲染测试。
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { AgentTaskCard } from "@/components/daemon/agent-task-card";

describe("AgentTaskCard", () => {
  it("running 态：显示任务名、「后台任务进行中」徽标与进度条", () => {
    render(
      <AgentTaskCard
        taskId="task-1"
        taskName="Design Grill 审查"
        status="running"
        progress={40}
      />,
    );
    const card = screen.getByTestId("agent-task-card");
    expect(card).toHaveAttribute("data-status", "running");
    expect(screen.getByText("Design Grill 审查")).toBeTruthy();
    expect(screen.getByText("后台任务进行中")).toBeTruthy();
    expect(screen.getByText("40%")).toBeTruthy();
  });

  it("running 态无 progress → 不渲染进度条与百分比", () => {
    render(
      <AgentTaskCard taskId="task-2" taskName="子代理A" status="running" progress={null} />,
    );
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByText(/%\s*$/)).toBeNull();
  });

  it("completed 态：显示已完成、无进行中徽标、无进度条", () => {
    render(
      <AgentTaskCard taskId="task-3" taskName="子代理B" status="completed" progress={100} />,
    );
    const card = screen.getByTestId("agent-task-card");
    expect(card).toHaveAttribute("data-status", "completed");
    expect(screen.getByText(/已完成/)).toBeTruthy();
    expect(screen.queryByText("后台任务进行中")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("failed 态 + message → 显示失败状态与原因行", () => {
    render(
      <AgentTaskCard
        taskId="task-4"
        taskName="子代理C"
        status="failed"
        message="执行超时"
      />,
    );
    expect(screen.getByTestId("agent-task-card")).toHaveAttribute("data-status", "failed");
    expect(screen.getByText(/失败/)).toBeTruthy();
    expect(screen.getByText("执行超时")).toBeTruthy();
  });

  it("taskName 为空 → 兜底「后台任务」不渲染空标题", () => {
    render(<AgentTaskCard taskId="task-5" taskName="" status="running" />);
    expect(screen.getByText("后台任务")).toBeTruthy();
  });

  it("progress 越界钳制到 0~100（负数→0，>100→100）", () => {
    const { rerender } = render(
      <AgentTaskCard taskId="t" taskName="n" status="running" progress={-20} />,
    );
    expect(screen.getByText("0%")).toBeTruthy();
    rerender(<AgentTaskCard taskId="t" taskName="n" status="running" progress={140} />);
    expect(screen.getByText("100%")).toBeTruthy();
  });
});
