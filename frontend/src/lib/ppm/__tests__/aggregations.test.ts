import { describe, expect, it } from "vitest";

import {
  CHART_COLORS,
  toBarSeries,
  toCostSeries,
  toNumber,
  toPieSeries,
} from "@/lib/ppm/aggregations";
import type { PsProjectPlan } from "@/lib/ppm/types";

// echarts option 是复杂联合类型,测试中用宽松结构断言字段。
interface AxisLike {
  data?: unknown[];
}
interface SeriesLike {
  type?: string;
  data?: unknown[];
  itemStyle?: { color?: unknown };
}
interface OptionLike {
  xAxis?: AxisLike | AxisLike[];
  yAxis?: AxisLike | AxisLike[];
  series?: SeriesLike[];
  dataZoom?: unknown[];
}

function xAxisData(o: ReturnType<typeof toBarSeries>): unknown[] {
  const opt = o as unknown as OptionLike;
  const ax = Array.isArray(opt.xAxis) ? opt.xAxis[0] : opt.xAxis;
  return (ax?.data as unknown[]) ?? [];
}
function yAxisData(o: ReturnType<typeof toCostSeries>): unknown[] {
  const opt = o as unknown as OptionLike;
  const ax = Array.isArray(opt.yAxis) ? opt.yAxis[0] : opt.yAxis;
  return (ax?.data as unknown[]) ?? [];
}
function seriesOf(
  o: ReturnType<typeof toBarSeries> | ReturnType<typeof toCostSeries>,
): SeriesLike[] {
  return ((o as unknown as OptionLike).series as SeriesLike[]) ?? [];
}

function makePlan(
  id: string,
  over: Partial<PsProjectPlan> = {},
): PsProjectPlan {
  return {
    id,
    project_id: "p1",
    project_name: id,
    project_manager_id: null,
    project_manager_name: null,
    project_start_time: null,
    project_plan_end_time: null,
    contract_sign_time: null,
    contract_name: null,
    contract_amount: null,
    profit_margin: null,
    profit_amount: null,
    module: null,
    budget_amount: "100",
    budget_person_days: null,
    actual_consumption_person_days: null,
    remaining_available_person_days: null,
    status: "active",
    adjustment_person_days: null,
    total_cost: "40",
    labor_cost: null,
    remaining_cost: "60",
    cost_adjustment: null,
    company_name: null,
    create_name: null,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

describe("toNumber", () => {
  it("数字原样返回", () => {
    expect(toNumber(12.5)).toBe(12.5);
  });
  it("字符串数字解析", () => {
    expect(toNumber("100.5")).toBe(100.5);
  });
  it("null / undefined / 非数字 → 0", () => {
    expect(toNumber(null)).toBe(0);
    expect(toNumber(undefined)).toBe(0);
    expect(toNumber("abc")).toBe(0);
  });
});

describe("toBarSeries", () => {
  it("构造 X 轴 + 单 bar 系列", () => {
    const rows = [
      { name: "alice", total_hours: 10 },
      { name: "bob", total_hours: 5 },
      { name: "carol", total_hours: 2 },
    ];
    const option = toBarSeries(rows, "#1677ff");
    const s = seriesOf(option);
    expect(xAxisData(option)).toEqual(["alice", "bob", "carol"]);
    expect(s).toHaveLength(1);
    expect(s[0]!.type).toBe("bar");
    expect(s[0]!.data).toEqual([10, 5, 2]);
    expect(s[0]!.itemStyle!.color).toBe("#1677ff");
  });

  it("空数组返回合法 option 不抛错", () => {
    const option = toBarSeries([], "#1677ff");
    expect(xAxisData(option)).toEqual([]);
    expect(seriesOf(option)[0]!.data).toEqual([]);
  });

  it("类别 > 30 启用 dataZoom", () => {
    const rows = Array.from({ length: 35 }, (_, i) => ({
      name: `u${i}`,
      total_hours: 1,
    }));
    const option = toBarSeries(rows, "#1677ff");
    const opt = option as unknown as OptionLike;
    expect(opt.dataZoom).toBeDefined();
    expect((opt.dataZoom as unknown[]).length).toBeGreaterThan(0);
  });
});

describe("toPieSeries", () => {
  it("Top 5 + 其他聚合", () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({
      name: `u${i}`,
      total_hours: 10 - i,
    }));
    const option = toPieSeries(rows, 49);
    const s = seriesOf(option);
    const data = s[0]!.data as { name: string; value: number }[];
    // Top5(u0..u4) + 其他(2 项)
    expect(data).toHaveLength(6);
    // 其他 = u5(5) + u6(4) = 9
    const other = data.find((d) => d.name.startsWith("其他"))!;
    expect(other.value).toBe(9);
    expect(s[0]!.type).toBe("pie");
  });

  it("totalHours=0 返回空 series 不抛错", () => {
    const option = toPieSeries([{ name: "a", total_hours: 0 }], 0);
    const data = seriesOf(option)[0]!.data as unknown[];
    expect(data).toHaveLength(1);
    expect((data[0] as { value: number }).value).toBe(0);
  });

  it("空数组返回空 data", () => {
    const option = toPieSeries([], 0);
    expect(seriesOf(option)[0]!.data).toEqual([]);
  });

  it("颜色按 CHART_COLORS.pie 分配", () => {
    const rows = [{ name: "a", total_hours: 1 }];
    const option = toPieSeries(rows, 1);
    const data = seriesOf(option)[0]!.data as {
      itemStyle: { color: string };
    }[];
    expect(data[0]!.itemStyle.color).toBe(CHART_COLORS.pie[0]);
  });
});

describe("toCostSeries", () => {
  it("三系列 budget/actual/remaining,字符串解析", () => {
    const plans = [
      makePlan("A", {
        budget_amount: "100",
        total_cost: "40",
        remaining_cost: "60",
      }),
      makePlan("B", {
        budget_amount: "200",
        total_cost: "80",
        remaining_cost: "120",
      }),
    ];
    const option = toCostSeries(plans);
    const s = seriesOf(option);
    expect(yAxisData(option)).toEqual(["B", "A"]); // 反转
    expect(s).toHaveLength(3);
    expect(s[0]!.data).toEqual([200, 100]);
    expect(s[1]!.data).toEqual([80, 40]);
    expect(s[2]!.data).toEqual([120, 60]);
  });

  it("null 字段兜底为 0", () => {
    const plans = [
      makePlan("A", {
        budget_amount: null,
        total_cost: null,
        remaining_cost: null,
      }),
    ];
    const option = toCostSeries(plans);
    const s = seriesOf(option);
    expect(s[0]!.data).toEqual([0]);
    expect(s[1]!.data).toEqual([0]);
    expect(s[2]!.data).toEqual([0]);
  });

  it("actual 缺省 total_cost 回退 actual_consumption_person_days", () => {
    const plans = [
      makePlan("A", {
        total_cost: null,
        actual_consumption_person_days: "15",
      }),
    ];
    const option = toCostSeries(plans);
    const actual = seriesOf(option)[1]!.data as number[];
    expect(actual).toEqual([15]);
  });

  it("project_name 缺省回退 id", () => {
    const plans = [makePlan("X", { project_name: null })];
    const option = toCostSeries(plans);
    expect(yAxisData(option)).toEqual(["X"]);
  });

  it("空 plans 返回合法 option 不抛错", () => {
    const option = toCostSeries([]);
    expect(yAxisData(option)).toEqual([]);
    expect(seriesOf(option)).toHaveLength(3);
  });
});
