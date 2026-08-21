import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

  it("非线性阶段（quick/blocked）返回 null 不渲染", () => {
    const { container } = render(
      <ChangeStageHeader currentStage="quick" stages={null} updatedAt={null} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("archived 终态映射为 archive 渲染：前四阶段对勾、归档节点高亮", () => {
    const { container } = render(
      <ChangeStageHeader currentStage="archived" stages={null} updatedAt={null} />,
    );
    expect(screen.getByText("归档")).toBeInTheDocument();
    expect(screen.getByText("归档").className).toContain("font-medium");
    // 已完成 4 个（brainstorm/plan/execute/verify）+ 当前 archive 节点共 5 个可见
    expect(container.querySelectorAll(".rounded-full").length).toBe(5);
    // 对勾数量应 ≥ 4
    expect(container.querySelectorAll(".text-white").length).toBeGreaterThanOrEqual(4);
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

// ── 阶段-步骤联动（ql-20260821-017：节点点击筛选步骤时间线）────────────────

describe("ChangeStageHeader 阶段-步骤联动", () => {
  it("未传联动 props → 纯展示（无 button），旧挂载方式零变化", () => {
    render(<ChangeStageHeader currentStage="execute" stages={null} updatedAt={null} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText("执行")).toBeInTheDocument();
  });

  it("stepStages 中的阶段节点可点击：点击回调携带 stage", () => {
    const onStageClick = vi.fn();
    render(
      <ChangeStageHeader
        currentStage="execute"
        stages={null}
        updatedAt={null}
        stepStages={["brainstorm", "plan", "execute"]}
        focusStage={null}
        onStageClick={onStageClick}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /需求分析/ }));
    expect(onStageClick).toHaveBeenCalledWith("brainstorm");
    fireEvent.click(screen.getByRole("button", { name: /执行/ }));
    expect(onStageClick).toHaveBeenCalledWith("execute");
  });

  it("无步骤数据的阶段节点 disabled 不可点击", () => {
    const onStageClick = vi.fn();
    render(
      <ChangeStageHeader
        currentStage="execute"
        stages={null}
        updatedAt={null}
        stepStages={["brainstorm"]}
        focusStage={null}
        onStageClick={onStageClick}
      />,
    );
    const planBtn = screen.getByRole("button", { name: /规划/ });
    expect(planBtn).toBeDisabled();
    fireEvent.click(planBtn);
    expect(onStageClick).not.toHaveBeenCalled();
  });

  it("focusStage 选中节点：aria-pressed + brand ring 高亮 + 标签 brand 色", () => {
    render(
      <ChangeStageHeader
        currentStage="execute"
        stages={null}
        updatedAt={null}
        stepStages={["brainstorm", "plan"]}
        focusStage="plan"
        onStageClick={() => {}}
      />,
    );
    const planBtn = screen.getByRole("button", { name: /规划/ });
    expect(planBtn).toHaveAttribute("aria-pressed", "true");
    // 圆点（按钮内首个 div）带 brand ring（ring-offset-2 为选中态独有，
    // 悬停态是 group-hover:ring-offset-1，避免子串误伤）；标签为 brand 色
    const circle = planBtn.querySelector("div");
    expect(circle?.className).toContain("ring-brand-500");
    expect(circle?.className).toContain("ring-offset-2");
    expect(screen.getByText("规划").className).toContain("text-brand-600");
    // 未选中节点 aria-pressed=false 且无选中 ring
    const brainstormBtn = screen.getByRole("button", { name: /需求分析/ });
    expect(brainstormBtn).toHaveAttribute("aria-pressed", "false");
    expect(brainstormBtn.querySelector("div")?.className).not.toContain(
      "ring-offset-2",
    );
  });

  it("archived 终态联动：归档节点可点击并回调 'archive'", () => {
    const onStageClick = vi.fn();
    render(
      <ChangeStageHeader
        currentStage="archived"
        stages={null}
        updatedAt={null}
        stepStages={["archive"]}
        focusStage={null}
        onStageClick={onStageClick}
      />,
    );
    const archiveBtn = screen.getByRole("button", { name: /归档/ });
    expect(archiveBtn).not.toBeDisabled();
    fireEvent.click(archiveBtn);
    expect(onStageClick).toHaveBeenCalledWith("archive");
  });

  it("只传 stepStages 不传 onStageClick → 不启用联动（按钮缺席）", () => {
    render(
      <ChangeStageHeader
        currentStage="execute"
        stages={null}
        updatedAt={null}
        stepStages={["brainstorm"]}
      />,
    );
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
