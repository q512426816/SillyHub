// 2026-10-22-trajectory-view-redesign：
// 轨迹视图集成——顶部固定结构、工具栏四项、两列账本、折叠摘要行、详情四标签与选中失效。
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import type { Trajectory, TrajectoryRow } from "../build-trajectory";
import { TrajectoryView } from "../trajectory-view";

const START = Date.parse("2026-10-22T02:00:00.000Z");

function row(partial: Partial<TrajectoryRow> & { id: string }): TrajectoryRow {
  return {
    kind: "assistant",
    turnIndex: 1,
    stepIndex: 1,
    depth: 0,
    status: "ok",
    startedAt: START,
    endedAt: START + 1000,
    durationMs: 1000,
    ...partial,
  };
}

function makeTrajectory(): Trajectory {
  return {
    rows: [
      row({ id: "r1:user", kind: "user", stepIndex: 1, inputText: "跑一下测试" }),
      row({ id: "r1:a1", kind: "assistant", stepIndex: 2, outputText: "开始执行" }),
      row({
        id: "r1:tool1",
        kind: "tool",
        stepIndex: 3,
        toolName: "Bash",
        inputText: '{"command":"pnpm test"}',
        outputText: "ok",
        endedAt: START + 5000,
        durationMs: 4000,
      }),
      row({
        id: "r1:tool2",
        kind: "tool",
        stepIndex: 4,
        toolName: "Read",
        inputText: '{"file_path":"a.ts"}',
        outputText: "a.ts",
        meta: { resultFromPrimary: true },
      }),
    ],
    turns: [
      {
        index: 1,
        runId: "r1",
        startedAt: START,
        endedAt: START + 60_000,
        durationMs: 60_000,
        status: "completed",
      },
    ],
    lanes: { input: [], model: [], tool: [] },
    coverage: { modelMs: 0, toolMs: 0, windowMs: 60_000 },
    modelBasis: "approx",
    windowStart: START,
    windowEnd: START + 60_000,
  };
}

describe("轨迹视图集成（D-002/D-003/D-004/D-005）", () => {
  it("顶部固定结构：工具栏与时间线在账本滚动容器之外", () => {
    render(<TrajectoryView trajectory={makeTrajectory()} />);

    const grid = screen.getByTestId("trajectory-grid");
    expect(screen.getByTestId("trajectory-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("trajectory-timeline")).toBeInTheDocument();
    expect(grid.contains(screen.getByTestId("trajectory-toolbar"))).toBe(false);
    expect(grid.contains(screen.getByTestId("trajectory-timeline"))).toBe(false);
  });

  it("两列账本：类型标签 + 摘要，行内无耗时、无请求边界点", () => {
    render(<TrajectoryView trajectory={makeTrajectory()} />);

    const rows = screen.getAllByTestId("trajectory-row");
    expect(rows).toHaveLength(4);
    expect(rows[2]!.textContent).toContain("工具");
    expect(rows[2]!.textContent).toContain("Bash");
    expect(rows[2]!.textContent).not.toContain("ms");
    expect(screen.queryByTestId("trajectory-request-dot")).toBeNull();
  });

  it("工具栏：时长切换隐藏时间轴，再切回恢复", () => {
    render(<TrajectoryView trajectory={makeTrajectory()} />);

    expect(screen.getByTestId("trajectory-axis")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /时长/ }));
    expect(screen.queryByTestId("trajectory-axis")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /时长/ }));
    expect(screen.getByTestId("trajectory-axis")).toBeInTheDocument();
  });

  it("工具栏：轮次收起出现摘要行，点击摘要行展开恢复", () => {
    render(<TrajectoryView trajectory={makeTrajectory()} />);

    fireEvent.click(screen.getByRole("button", { name: /轮次/ }));
    const summary = screen.getByTestId("trajectory-summary-row");
    expect(summary.textContent).toContain("4 个步骤");
    expect(screen.getAllByTestId("trajectory-row")).toHaveLength(1);

    fireEvent.click(summary);
    expect(screen.getAllByTestId("trajectory-row")).toHaveLength(4);
  });

  it("工具栏：调用收起合并连续工具行", () => {
    render(<TrajectoryView trajectory={makeTrajectory()} />);

    fireEvent.click(screen.getByRole("button", { name: /调用/ }));
    const summary = screen.getByTestId("trajectory-summary-row");
    expect(summary.textContent).toContain("2 个工具调用");
    expect(summary.textContent).toContain("Bash");
    expect(screen.getAllByTestId("trajectory-row")).toHaveLength(2);
  });

  it("工具栏：搜索只保留命中行，零命中显示空态", () => {
    const { container } = render(<TrajectoryView trajectory={makeTrajectory()} />);

    fireEvent.change(screen.getByLabelText("搜索轨迹"), { target: { value: "pnpm" } });
    expect(screen.getAllByTestId("trajectory-row")).toHaveLength(1);
    expect(screen.getByTestId("trajectory-row").textContent).toContain("Bash");

    fireEvent.change(screen.getByLabelText("搜索轨迹"), { target: { value: "不存在" } });
    expect(container.querySelectorAll('[data-testid="trajectory-row"]')).toHaveLength(0);
    expect(screen.getByTestId("trajectory-no-match").textContent).toContain("没有匹配的记录");
  });

  it("工具栏：等宽模式不拦截滚轮、时间轴不渲染", () => {
    render(<TrajectoryView trajectory={makeTrajectory()} />);

    const timeline = screen.getByTestId("trajectory-timeline");
    const before = timeline.getAttribute("data-view-start");
    fireEvent.click(screen.getByRole("button", { name: /时长/ }));
    expect(screen.queryByTestId("trajectory-axis")).toBeNull();
    fireEvent.wheel(timeline, { deltaY: 300, clientX: 10 });
    expect(timeline.getAttribute("data-view-start")).toBe(before);
  });

  it("详情：工具行四标签（无 Schema），参数取 raw、结果取 result、缺失标注未捕获", () => {
    render(<TrajectoryView trajectory={makeTrajectory()} />);

    fireEvent.click(screen.getAllByTestId("trajectory-row")[2]!);
    const panel = screen.getByTestId("trajectory-detail-panel");
    expect(panel.textContent).toContain("概述");
    expect(panel.textContent).toContain("参数");
    expect(panel.textContent).toContain("结果");
    expect(panel.textContent).toContain("计时");
    expect(panel.textContent).not.toContain("Schema");

    fireEvent.click(screen.getByRole("tab", { name: "参数" }));
    expect(panel.textContent).toContain("pnpm test");

    fireEvent.click(screen.getByRole("tab", { name: "结果" }));
    expect(panel.textContent).toContain("ok");
    expect(panel.textContent).not.toContain("仅摘要，未捕获结果");

    // 无配对 result 的工具行：退回 primary 并显式标注（D-015 / FR-05）。
    fireEvent.click(screen.getAllByTestId("trajectory-row")[3]!);
    fireEvent.click(screen.getByRole("tab", { name: "结果" }));
    expect(panel.textContent).toContain("仅摘要，未捕获结果");
  });

  it("详情：计时按轮级 attempt 采样计算 TTFT/生成/吞吐", () => {
    const trajectory = makeTrajectory();
    trajectory.turns[0] = {
      ...trajectory.turns[0]!,
      timing: {
        attempts: [
          {
            startedAt: new Date(START).toISOString(),
            firstTokenAt: new Date(START + 800).toISOString(),
            endedAt: new Date(START + 4_000).toISOString(),
            outputTokens: 100,
          },
        ],
      } as never,
    };
    render(<TrajectoryView trajectory={trajectory} />);

    fireEvent.click(screen.getAllByTestId("trajectory-row")[2]!);
    fireEvent.click(screen.getByRole("tab", { name: "计时" }));
    const panel = screen.getByTestId("trajectory-detail-panel");
    expect(panel.textContent).toContain("800ms");
    expect(panel.textContent).toContain("3.2s");
    expect(panel.textContent).toContain("31.3 tok/s");
  });

  it("折叠隐藏选中行后清空选中并关闭详情（D-014）", () => {
    render(<TrajectoryView trajectory={makeTrajectory()} />);

    fireEvent.click(screen.getAllByTestId("trajectory-row")[2]!);
    expect(screen.getByTestId("trajectory-detail-panel")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /调用/ }));
    expect(screen.queryByTestId("trajectory-detail-panel")).toBeNull();
  });

  it("受控模式：外部 selectedRowId 生效", () => {
    const onSelectRow = vi.fn();
    render(
      <TrajectoryView
        trajectory={makeTrajectory()}
        selectedRowId="r1:a1"
        onSelectRow={onSelectRow}
      />,
    );

    const rows = screen.getAllByTestId("trajectory-row");
    expect(rows[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.click(rows[0]!);
    expect(onSelectRow).toHaveBeenCalledWith("r1:user");
  });
});
