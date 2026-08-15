import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ChangeStepTimeline,
  type StepTimelineEntry,
} from "@/components/changes/detail/change-step-timeline";

/**
 * ChangeStepTimeline 组件测试（2026-08-15-change-step-visibility task-05 / FR-02）。
 *
 * 覆盖：七值状态色映射（含未知值灰兜底）/ stage 分组组头 / completed 时间与
 * output 摘要 / waiting 显示 wait_reason / steps null 空态 / 分组顺序遵循后端
 * entries 顺序（组件不再排序）/ entry key 稳定（stage-ordering）。
 */

function entry(
  over: Partial<StepTimelineEntry> & Pick<StepTimelineEntry, "name" | "stage">,
): StepTimelineEntry {
  return {
    status: "pending",
    output: null,
    completed_at: null,
    ordering: 0,
    wait_reason: null,
    ...over,
  };
}

/** 取状态点元素（data-status 挂在 .tl-dot 语义的 span 上） */
function dot(container: HTMLElement, status: string): HTMLElement {
  const el = container.querySelector(`[data-status="${status}"]`);
  expect(el, `dot[data-status=${status}] 应存在`).not.toBeNull();
  return el as HTMLElement;
}

describe("ChangeStepTimeline", () => {
  it("steps null / 空数组 → 空态不渲染不抛（D-003 降级）", () => {
    const { container } = render(<ChangeStepTimeline steps={null} />);
    expect(container).toBeEmptyDOMElement();
    const { container: c2 } = render(<ChangeStepTimeline steps={[]} />);
    expect(c2).toBeEmptyDOMElement();
  });

  it("七值状态色映射 + 未知值灰兜底", () => {
    const { container } = render(
      <ChangeStepTimeline
        steps={[
          entry({ name: "完成步", stage: "brainstorm", status: "completed", ordering: 1 }),
          entry({ name: "进行步", stage: "brainstorm", status: "in-progress", ordering: 2 }),
          entry({ name: "等待步", stage: "brainstorm", status: "waiting", ordering: 3 }),
          entry({ name: "失败步", stage: "brainstorm", status: "failed", ordering: 4 }),
          entry({ name: "阻塞步", stage: "brainstorm", status: "blocked", ordering: 5 }),
          entry({ name: "过期步", stage: "brainstorm", status: "stale", ordering: 6 }),
          entry({ name: "未来步", stage: "brainstorm", status: "pending", ordering: 7 }),
          entry({ name: "未知步", stage: "brainstorm", status: "weird-value", ordering: 8 }),
        ]}
      />,
    );
    expect(dot(container, "completed").className).toContain("bg-emerald-500");
    // in-progress 蓝点脉动
    const active = dot(container, "in-progress");
    expect(active.className).toContain("bg-blue-500");
    expect(active.className).toContain("animate-pulse");
    expect(dot(container, "waiting").className).toContain("bg-amber-500");
    expect(dot(container, "failed").className).toContain("bg-red-500");
    // blocked 与 stale 同为橙
    expect(dot(container, "blocked").className).toContain("bg-orange-500");
    expect(dot(container, "stale").className).toContain("bg-orange-500");
    expect(dot(container, "pending").className).toContain("bg-gray-300");
    // 未知值按 pending 灰兜底
    expect(dot(container, "weird-value").className).toContain("bg-gray-300");
  });

  it("按 stage 分组渲染组头（中文标签 + 完成数/总数）", () => {
    render(
      <ChangeStepTimeline
        steps={[
          entry({ name: "a1", stage: "brainstorm", status: "completed", ordering: 1 }),
          entry({ name: "a2", stage: "brainstorm", status: "pending", ordering: 2 }),
          entry({ name: "b1", stage: "plan", status: "completed", ordering: 1 }),
        ]}
      />,
    );
    const brainstormHeader = screen
      .getByText("需求分析")
      .closest("[data-stage]");
    expect(brainstormHeader).toHaveTextContent("1/2 步完成");
    const planHeader = screen.getByText("规划").closest("[data-stage]");
    expect(planHeader).toHaveTextContent("1/1 步完成");
  });

  it("未知 stage 组头显示原 stage 名（quick 兜底）", () => {
    render(
      <ChangeStepTimeline
        steps={[
          entry({ name: "q1", stage: "quick", status: "completed", ordering: 1 }),
        ]}
      />,
    );
    expect(screen.getByText("quick")).toBeInTheDocument();
    expect(screen.getByText("1/1 步完成")).toBeInTheDocument();
  });

  it("分组顺序遵循后端 entries 顺序，组件不再排序", () => {
    render(
      <ChangeStepTimeline
        steps={[
          entry({ name: "p1", stage: "plan", status: "completed", ordering: 1 }),
          entry({ name: "b1", stage: "brainstorm", status: "completed", ordering: 1 }),
        ]}
      />,
    );
    // 组头计数 span 按 DOM 序断言：输入序 plan 在前（即使 STAGE_ORDER 中 brainstorm 更早）
    const headers = screen.getAllByText(/步完成/);
    const first = headers[0]?.closest("[data-stage]");
    const second = headers[1]?.closest("[data-stage]");
    expect(first).toHaveAttribute("data-stage", "plan");
    expect(second).toHaveAttribute("data-stage", "brainstorm");
  });

  it("completed 步显示 ISO completed_at 与 output 摘要（line-clamp + word-break）", () => {
    render(
      <ChangeStepTimeline
        steps={[
          entry({
            name: "加载项目上下文",
            stage: "brainstorm",
            status: "completed",
            ordering: 1,
            completed_at: "2026-08-15T15:44:08+00:00",
            output: "关键发现：CLI 六表 JSON 已含 steps[] 数据，读侧仅投影 current_stage",
          }),
        ]}
      />,
    );
    const time = screen.getByText("2026-08-15T15:44:08+00:00");
    expect(time).toBeInTheDocument();
    expect(time).toHaveAttribute("datetime", "2026-08-15T15:44:08+00:00");
    const output = screen.getByText(/CLI 六表 JSON 已含 steps\[\] 数据/);
    expect(output.className).toContain("line-clamp-2");
    expect(output.className).toContain("break-words");
  });

  it("waiting 步显示 wait_reason 与状态文案", () => {
    render(
      <ChangeStepTimeline
        steps={[
          entry({
            name: "设计确认",
            stage: "plan",
            status: "waiting",
            ordering: 2,
            wait_reason: "等待 1 项用户决策：刷新机制选型",
          }),
        ]}
      />,
    );
    expect(
      screen.getByText(/等待原因：等待 1 项用户决策：刷新机制选型/),
    ).toBeInTheDocument();
    expect(screen.getByText("等待中")).toBeInTheDocument();
  });

  it("entry key=stage-ordering 稳定：步状态推进后 key 序列不变，变化步内容更新", () => {
    const base = [
      entry({ name: "步一", stage: "execute", status: "completed", ordering: 1 }),
      entry({ name: "步二", stage: "execute", status: "in-progress", ordering: 2 }),
      entry({ name: "步三", stage: "execute", status: "pending", ordering: 3 }),
    ];
    const { rerender } = render(<ChangeStepTimeline steps={base} />);
    const keysBefore = Array.from(
      document.querySelectorAll("[data-key]"),
    ).map((n) => n.getAttribute("data-key"));
    expect(keysBefore).toEqual(["execute-1", "execute-2", "execute-3"]);

    // 步二完成：仅该 entry 换对象（新引用），其余引用不变
    const stepTwo = base[1];
    expect(stepTwo).toBeDefined();
    const next: StepTimelineEntry[] = [
      base[0]!,
      { ...stepTwo!, status: "completed", completed_at: "2026-08-15T16:00:00+00:00" },
      base[2]!,
    ];
    rerender(<ChangeStepTimeline steps={next} />);
    const keysAfter = Array.from(
      document.querySelectorAll("[data-key]"),
    ).map((n) => n.getAttribute("data-key"));
    expect(keysAfter).toEqual(["execute-1", "execute-2", "execute-3"]);
    // 变化步内容更新：完成时间出现
    expect(screen.getByText("2026-08-15T16:00:00+00:00")).toBeInTheDocument();
  });
});
