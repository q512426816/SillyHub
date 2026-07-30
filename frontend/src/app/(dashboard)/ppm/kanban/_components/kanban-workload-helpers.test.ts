/**
 * kanban-workload-helpers 单测 (task-08) — 钉死锚点偏离式各档颜色与休息态边界。
 *
 * 配色依据 design.md §7.4 + prototype-kanban-workload-heatmap.html:
 * 0=绿 / 1=无色(达标) / 0<h<1 绿→黄 / h>1 红→黑(≥3 趋黑) / 休息态灰底。
 */
import { describe, expect, it } from "vitest";

import {
  REST_CELL_COLOR,
  workloadCellColor,
  workloadCellColorForDay,
} from "./kanban-workload-helpers";

describe("workloadCellColor 锚点偏离式", () => {
  it("0 人天 = 纯绿(最闲)", () => {
    const c = workloadCellColor(0);
    expect(c.bg).toBe("hsl(140, 60%, 82%)");
    expect(c.fg).toBe("#14532d");
  });

  it("1 人天 = 无色(达标)", () => {
    const c = workloadCellColor(1);
    expect(c.bg).toBe("transparent");
  });

  it("0<h<1 绿→黄插值: 0.5 人天 hue=93(140 与 45 中点)", () => {
    const c = workloadCellColor(0.5);
    expect(c.bg).toBe("hsl(93, 65%, 80%)");
    expect(c.fg).toBe("#3f3f06");
  });

  it("接近 1 的不足值偏黄: 0.9 人天 hue=55", () => {
    const c = workloadCellColor(0.9);
    expect(c.bg).toBe("hsl(55, 65%, 80%)");
  });

  it("h>1 红: 2 人天 light=40,深色未过半仍暗红字", () => {
    const c = workloadCellColor(2);
    expect(c.bg).toBe("hsl(0, 70%, 40%)");
    expect(c.fg).toBe("#7f1d1d");
  });

  it("h>=3 趋黑: 3 人天 light=8,文字转白", () => {
    const c = workloadCellColor(3);
    expect(c.bg).toBe("hsl(0, 70%, 8%)");
    expect(c.fg).toBe("#f9fafb");
  });

  it("h>3 截断到黑(不越过 t=1)", () => {
    const c = workloadCellColor(5);
    expect(c.bg).toBe("hsl(0, 70%, 8%)");
    expect(c.fg).toBe("#f9fafb");
  });

  it("浮点边界: 0.95 / 1.04 四舍五入到 1.0 → 达标无色 (R-07)", () => {
    expect(workloadCellColor(0.95).bg).toBe("transparent");
    expect(workloadCellColor(1.04).bg).toBe("transparent");
  });

  it("浮点边界: 0.94 不进门 → 仍按 0.9 档染色", () => {
    expect(workloadCellColor(0.94).bg).toBe("hsl(55, 65%, 80%)");
  });
});

describe("workloadCellColorForDay 工作日接线", () => {
  it("普通周末(2026-08-01 周六)灰底休息态,不染色", () => {
    const c = workloadCellColorForDay("2026-08-01", 2);
    expect(c).toEqual(REST_CELL_COLOR);
  });

  it("法定假日(2026-01-01 元旦)灰底休息态,不染色", () => {
    const c = workloadCellColorForDay("2026-01-01", 2);
    expect(c).toEqual(REST_CELL_COLOR);
  });

  it("调休补班(2026-01-04 周日补班)按正常工作日染色", () => {
    const c = workloadCellColorForDay("2026-01-04", 2);
    expect(c.bg).toBe("hsl(0, 70%, 40%)");
  });

  it("普通工作日(2026-08-03 周一)正常染色", () => {
    const c = workloadCellColorForDay("2026-08-03", 1);
    expect(c.bg).toBe("transparent");
  });
});
