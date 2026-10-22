/**
 * 轨迹泳道时间轴组件单测 —— 2026-10-20-session-page-dsh-alignment 档 1（D-024）。
 *
 * 锁定用户可见行为（视觉样式本身按仓规不写测试）：
 *   1. 三条泳道标签 + 每条泳道的条数（tick/条一一对应）；
 *   2. 条的位置是**共享绝对时间轴**的线性换算（越晚越靠右，同一窗口同一比例）；
 *   3. 点条 → onSelectRow(rowId)；选中条 aria-pressed=true；
 *   4. 轴刻度 5–7 档且两端落在窗口边界。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Trajectory, TrajectoryLaneKind, TrajectorySpan } from "../build-trajectory";
import { TrajectoryTimeline } from "../trajectory-timeline";

const T0 = Date.parse("2026-01-01T00:00:00.000Z");
const MIN = 60_000;

function span(
  lane: TrajectoryLaneKind,
  startOffset: number,
  endOffset: number,
  rowId: string,
  label: string,
): TrajectorySpan {
  return {
    id: `${lane}:${rowId}`,
    lane,
    start: T0 + startOffset,
    end: T0 + endOffset,
    label,
    status: "ok",
    rowId,
    turnIndex: startOffset < 10 * MIN ? 1 : 2,
    depth: 0,
    tokensLevel: "turn",
    subRow: 0,
  };
}

function makeTrajectory(): Trajectory {
  return {
    rows: [],
    turns: [
      {
        index: 1,
        runId: "run-1",
        startedAt: T0,
        endedAt: T0 + 10 * MIN,
        durationMs: 10 * MIN,
        status: "completed",
      },
      {
        index: 2,
        runId: "run-2",
        startedAt: T0 + 10 * MIN,
        endedAt: T0 + 20 * MIN,
        durationMs: 10 * MIN,
        status: "completed",
      },
    ],
    lanes: {
      input: [span("input", 0, 0, "row-u1", "问题一"), span("input", 10 * MIN, 10 * MIN, "row-u2", "问题二")],
      model: [span("model", MIN, 5 * MIN, "row-m1", "思考 · 甲"), span("model", 11 * MIN, 18 * MIN, "row-m2", "答复 · 乙")],
      tool: [
        span("tool", 5 * MIN, 7 * MIN, "row-t1", "Bash"),
        span("tool", 12 * MIN, 13 * MIN, "row-t2", "Read"),
      ],
    },
    coverage: { modelMs: 11 * MIN, toolMs: 3 * MIN, windowMs: 20 * MIN },
    modelBasis: "approx",
    windowStart: T0,
    windowEnd: T0 + 20 * MIN,
  };
}

function barsOf(lane: TrajectoryLaneKind): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(`[data-testid="trajectory-bar"][data-lane="${lane}"]`),
  );
}

describe("TrajectoryTimeline", () => {
  it("三条泳道标签齐全，条数按泳道一一对应", () => {
    render(<TrajectoryTimeline trajectory={makeTrajectory()} />);
    const labels = screen.getAllByTestId("trajectory-lane-label");
    expect(labels.map((label) => label.dataset.lane)).toEqual(["input", "model", "tool"]);
    expect(labels.map((label) => label.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("输入"), expect.stringContaining("模型"), expect.stringContaining("工具")]),
    );
    expect(barsOf("input")).toHaveLength(2);
    expect(barsOf("model")).toHaveLength(2);
    expect(barsOf("tool")).toHaveLength(2);
    // 输入 tick 固定 2px；模型/工具条按时间跨度算百分比宽度。
    expect(barsOf("input")[0]!.style.width).toBe("2px");
    expect(parseFloat(barsOf("tool")[0]!.style.width)).toBeCloseTo((2 * MIN) / (20 * MIN) * 100, 5);
  });

  it("条位置是共享绝对时间轴：越晚越靠右，且百分比等于 (start-windowStart)/span", () => {
    render(<TrajectoryTimeline trajectory={makeTrajectory()} />);
    const [first, second] = barsOf("tool");
    expect(parseFloat(first!.style.left)).toBeCloseTo(25, 5);
    expect(parseFloat(second!.style.left)).toBeCloseTo(60, 5);
    expect(parseFloat(second!.style.left)).toBeGreaterThan(parseFloat(first!.style.left));
  });

  it("点条 → onSelectRow(rowId)；选中条 aria-pressed=true", () => {
    const onSelectRow = vi.fn();
    const trajectory = makeTrajectory();
    const { rerender } = render(
      <TrajectoryTimeline trajectory={trajectory} onSelectRow={onSelectRow} />,
    );
    fireEvent.click(barsOf("tool")[0]!);
    expect(onSelectRow).toHaveBeenCalledWith("row-t1");
    rerender(
      <TrajectoryTimeline
        trajectory={trajectory}
        selectedRowId="row-t1"
        onSelectRow={onSelectRow}
      />,
    );
    expect(barsOf("tool")[0]!.getAttribute("aria-pressed")).toBe("true");
    expect(barsOf("tool")[1]!.getAttribute("aria-pressed")).toBe("false");
  });

  it("轴刻度 7 档、两端落在窗口边界，且轮边界竖线按轮数生成", () => {
    render(<TrajectoryTimeline trajectory={makeTrajectory()} />);
    const ticks = screen.getAllByTestId("trajectory-axis-tick");
    expect(ticks).toHaveLength(7);
    expect(parseFloat(ticks[0]!.style.left)).toBe(0);
    expect(parseFloat(ticks[ticks.length - 1]!.style.left)).toBeCloseTo(100, 5);
    expect(ticks[0]!.textContent).toBe("+00:00");
    expect(screen.getAllByTestId("trajectory-turn-guide")).toHaveLength(2);
  });

  it("空泳道：仍渲染三个标签与一根零条基准线，不产幽灵条", () => {
    const empty: Trajectory = {
      ...makeTrajectory(),
      lanes: { input: [], model: [], tool: [] },
    };
    render(<TrajectoryTimeline trajectory={empty} />);
    expect(screen.getAllByTestId("trajectory-lane-label")).toHaveLength(3);
    expect(screen.queryAllByTestId("trajectory-bar")).toHaveLength(0);
  });

  it("覆盖率 hint：按 coverage 算百分比，空档 = 100 - 模型 - 工具", () => {
    render(<TrajectoryTimeline trajectory={makeTrajectory()} />);
    const coverage = screen.getByTestId("trajectory-coverage").textContent ?? "";
    // 11/20 = 55% · 3/20 = 15% · 余下 30%
    expect(coverage).toContain("模型 55%");
    expect(coverage).toContain("工具 15%");
    expect(coverage).toContain("空档 30%");
  });

  it("初始视野 = 整窗：范围文案、data-view-*、重置按钮禁用、总览刷子铺满", () => {
    render(<TrajectoryTimeline trajectory={makeTrajectory()} />);
    const timeline = screen.getByTestId("trajectory-timeline");
    expect(timeline.dataset.viewStart).toBe(String(T0));
    expect(timeline.dataset.viewEnd).toBe(String(T0 + 20 * MIN));
    expect(screen.getByTestId("trajectory-view-range").textContent).toBe("+00:00 – +20:00");
    expect(screen.getByTestId("trajectory-reset")).toBeDisabled();
    expect(parseFloat(screen.getByTestId("trajectory-overview-brush").style.width)).toBeCloseTo(100, 5);
  });

  it("模型泳道口径标注：observed「真实占用」/ approx「近似（无 TTFT 采样）」互斥", () => {
    const { rerender } = render(
      <TrajectoryTimeline trajectory={{ ...makeTrajectory(), modelBasis: "approx" }} />,
    );
    const approxBasis = screen.getByTestId("trajectory-model-basis");
    expect(approxBasis.dataset.basis).toBe("approx");
    expect(approxBasis.textContent).toBe("近似（无 TTFT 采样）");
    expect(screen.queryByText("真实占用")).toBeNull();

    rerender(<TrajectoryTimeline trajectory={{ ...makeTrajectory(), modelBasis: "observed" }} />);
    const observedBasis = screen.getByTestId("trajectory-model-basis");
    expect(observedBasis.dataset.basis).toBe("observed");
    expect(observedBasis.textContent).toBe("真实占用");
    expect(screen.queryByText(/近似（无 TTFT 采样）/)).toBeNull();

    // 既有摘要与条数不受口径标注影响。
    const coverage = screen.getByTestId("trajectory-coverage").textContent ?? "";
    expect(coverage).toContain("模型 55%");
    expect(barsOf("model")).toHaveLength(2);
  });
});
