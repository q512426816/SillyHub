import { render, screen } from "@testing-library/react";

import { ChangeStageHeader } from "@/components/changes/detail/change-stage-header";

describe("ChangeStageHeader", () => {
  it("execute 阶段：需求/规划显对勾、执行高亮、验证/归档弱化", () => {
    const { container } = render(
      <ChangeStageHeader currentStage="execute" stages={null} updatedAt={null} />,
    );
    expect(screen.getByText("执行").className).toContain("font-medium");
    expect(screen.getByText("需求分析").className).toContain("text-muted-foreground");
    // 对勾数量 = 已完成 2 个
    expect(container.querySelectorAll(".text-white").length).toBeGreaterThanOrEqual(2);
  });

  it("非线性阶段（quick/blocked/archived）返回 null 不渲染", () => {
    const { container } = render(
      <ChangeStageHeader currentStage="quick" stages={null} updatedAt={null} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("未知阶段返回 null", () => {
    const { container } = render(
      <ChangeStageHeader currentStage="draft" stages={null} updatedAt={null} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("currentStage 为 null 返回 null", () => {
    const { container } = render(
      <ChangeStageHeader currentStage={null} stages={null} updatedAt={null} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("lastActive 取 stages[currentStage].lastActive", () => {
    render(
      <ChangeStageHeader
        currentStage="plan"
        stages={{ plan: { lastActive: "2026-08-11T10:00:00Z" } }}
        updatedAt="2026-08-10T00:00:00Z"
      />,
    );
    expect(screen.getByText(/当前阶段:/)).toHaveTextContent("2026/8/11");
  });

  it("lastActive 缺失回落 updatedAt", () => {
    render(
      <ChangeStageHeader
        currentStage="plan"
        stages={{ plan: {} }}
        updatedAt="2026-08-09T00:00:00Z"
      />,
    );
    expect(screen.getByText(/当前阶段:/)).toHaveTextContent("2026/8/9");
  });

  it("lastActive 与 updatedAt 都缺失时不渲染时间行", () => {
    render(<ChangeStageHeader currentStage="plan" stages={null} updatedAt={null} />);
    expect(screen.queryByText(/当前阶段:/)).not.toBeInTheDocument();
  });
});
