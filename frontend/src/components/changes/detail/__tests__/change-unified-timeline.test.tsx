import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChangeUnifiedTimeline, formatRowTime } from "@/components/changes/detail/change-unified-timeline";
import { mergeChangeTimeline } from "@/components/changes/detail/merge-change-timeline";

const ROWS = mergeChangeTimeline({
  bornAt: "2026-10-15T12:00:00Z",
  steps: [
    {
      name: "需求分析完成",
      stage: "brainstorm",
      status: "completed",
      output: "多行输出一\n多行输出二",
      completed_at: "2026-10-15T21:08:00Z",
      ordering: 1,
      wait_reason: null,
      kind: "step",
      event_type: null,
    },
    {
      name: "执行 · task-07 进行中",
      stage: "execute",
      status: "in-progress",
      output: null,
      completed_at: "2026-10-16T01:52:00Z",
      ordering: 2,
      wait_reason: null,
      kind: "step",
      event_type: null,
    },
  ],
  events: [
    {
      ts: "2026-10-16T01:37:00Z",
      kind: "commit",
      label: "a1b2c3d",
      rule: "",
      severity: "info",
      provisional: true,
      commit_title: "feat: 提交标题",
    },
  ],
});

describe("formatRowTime", () => {
  it("可解析时间 → MM-DD HH:mm；不可解析 → 原文；缺失 → 破折号", () => {
    expect(formatRowTime("2026-10-16T01:37:00Z")).toMatch(/^10-16 \d{2}:\d{2}$/);
    expect(formatRowTime("not-a-date")).toBe("not-a-date");
    expect(formatRowTime(null)).toBe("—");
  });
});

describe("ChangeUnifiedTimeline", () => {
  it("渲染全部行，行内带来源胶囊（步骤/事件/锚点）与阶段胶囊", () => {
    render(<ChangeUnifiedTimeline rows={ROWS} activeStage={null} onStageChange={() => undefined} />);
    expect(screen.getByText("变更诞生")).toBeInTheDocument();
    expect(screen.getByText("需求分析完成")).toBeInTheDocument();
    expect(screen.getByText("a1b2c3d feat: 提交标题")).toBeInTheDocument();
    expect(screen.getAllByText("步骤")).toHaveLength(2);
    expect(screen.getByText("事件")).toBeInTheDocument();
    expect(screen.getByText("锚点")).toBeInTheDocument();
  });

  it("阶段筛选受控：activeStage 命中时只显示该阶段行", () => {
    render(
      <ChangeUnifiedTimeline rows={ROWS} activeStage="execute" onStageChange={() => undefined} />,
    );
    expect(screen.getByText("执行 · task-07 进行中")).toBeInTheDocument();
    expect(screen.queryByText("需求分析完成")).not.toBeInTheDocument();
  });

  it("点击阶段 chip 回传阶段名；再次点击同 chip 回传 null（取消筛选）", () => {
    const onStageChange = vi.fn();
    render(
      <ChangeUnifiedTimeline rows={ROWS} activeStage="brainstorm" onStageChange={onStageChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /需求分析/ }));
    expect(onStageChange).toHaveBeenCalledWith(null);
    fireEvent.click(screen.getByRole("button", { name: /执行/ }));
    expect(onStageChange).toHaveBeenLastCalledWith("execute");
  });

  it("展开详情可看到步骤 output 全文（TimelineItem 折叠）", () => {
    render(<ChangeUnifiedTimeline rows={ROWS} activeStage={null} onStageChange={() => undefined} />);
    const toggles = screen.getAllByText("展开详情");
    expect(toggles).toHaveLength(1);
    const firstToggle = toggles[0];
    expect(firstToggle).toBeDefined();
    if (firstToggle) fireEvent.click(firstToggle);
    expect(screen.getByText(/多行输出一/)).toBeInTheDocument();
  });

  it("口径说明在场且含同键去重取舍声明（组件测试锚点，D-016/G-1）", () => {
    render(<ChangeUnifiedTimeline rows={ROWS} activeStage={null} onStageChange={() => undefined} />);
    expect(screen.getByText(/合并口径：源内按稳定键去重/)).toBeInTheDocument();
    expect(screen.getByText(/同一观测的重复上报/)).toBeInTheDocument();
  });

  it("空输入渲染空态；阶段筛选命中空组渲染筛选空态", () => {
    const { rerender } = render(
      <ChangeUnifiedTimeline rows={[]} activeStage={null} onStageChange={() => undefined} />,
    );
    expect(screen.getByText("暂无过程记录。")).toBeInTheDocument();
    rerender(
      <ChangeUnifiedTimeline rows={ROWS} activeStage="verify" onStageChange={() => undefined} />,
    );
    expect(screen.getByText("该阶段暂无过程记录。")).toBeInTheDocument();
  });
});
