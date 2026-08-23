import { describe, expect, it } from "vitest";

import {
  chartColors,
  toBarSeries,
  toNumber,
  toPieSeries,
} from "@/lib/ppm/aggregations";
import { DEFAULT_THEME, themes } from "@/styles";

// CHART_COLORS 编译期常量已改工厂 chartColors(theme) (task-09),
// 旧行为等价于 chartColors(DEFAULT_THEME) 取值。
const CHART_COLORS = chartColors(DEFAULT_THEME);

// echarts option 是复杂联合类型,测试中用宽松结构断言字段。
interface AxisLike {
  data?: unknown[];
  axisLabel?: { color?: unknown };
  nameTextStyle?: { color?: unknown };
  splitLine?: { lineStyle?: { color?: unknown } };
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
  legend?: { textStyle?: { color?: unknown } };
}

function xAxisData(o: ReturnType<typeof toBarSeries>): unknown[] {
  const opt = o as unknown as OptionLike;
  const ax = Array.isArray(opt.xAxis) ? opt.xAxis[0] : opt.xAxis;
  return (ax?.data as unknown[]) ?? [];
}
function firstAxis(
  o: ReturnType<typeof toBarSeries> | ReturnType<typeof toPieSeries>,
  key: "xAxis" | "yAxis",
): AxisLike | undefined {
  const opt = o as unknown as OptionLike;
  const ax = opt[key];
  return Array.isArray(ax) ? ax[0] : ax;
}
function seriesOf(o: ReturnType<typeof toBarSeries>): SeriesLike[] {
  return ((o as unknown as OptionLike).series as SeriesLike[]) ?? [];
}

describe("chartColors", () => {
  it("七键结构完整,pie 六色", () => {
    const c = chartColors("ai-native");
    expect(Object.keys(c).sort()).toEqual([
      "actual",
      "budget",
      "negative",
      "pie",
      "project",
      "remaining",
      "user",
    ]);
    expect(c.pie).toHaveLength(6);
    expect(c.pie.every((v) => typeof v === "string" && v.startsWith("#"))).toBe(
      true,
    );
  });

  it("取值映射 themes 注册表(与旧 CHART_COLORS 静态表同源)", () => {
    const c = chartColors("ai-native");
    const t = themes["ai-native"].color;
    expect(c.user).toBe(t.brand[600]);
    expect(c.project).toBe(t.semantic.success);
    expect(c.actual).toBe(t.semantic.warning);
    expect(c.negative).toBe(t.semantic.error);
    expect(c.pie).toEqual([
      t.brand[600],
      t.accent,
      t.semantic.success,
      t.semantic.warning,
      t.semantic.error,
      t.semantic.neutral,
    ]);
  });

  it("dark 主题取值翻转(亮灰系,区别于浅色主题)", () => {
    const light = chartColors(DEFAULT_THEME);
    const dark = chartColors("dark");
    expect(dark.user).toBe(themes.dark.color.brand[600]);
    expect(dark.user).not.toBe(light.user);
    expect(dark.pie).not.toEqual(light.pie);
    expect(dark.pie).toHaveLength(6);
  });
});

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
    const option = toBarSeries(rows, CHART_COLORS.user);
    const s = seriesOf(option);
    expect(xAxisData(option)).toEqual(["alice", "bob", "carol"]);
    expect(s).toHaveLength(1);
    expect(s[0]!.type).toBe("bar");
    expect(s[0]!.data).toEqual([10, 5, 2]);
    expect(s[0]!.itemStyle!.color).toBe(CHART_COLORS.user);
  });

  it("空数组返回合法 option 不抛错", () => {
    const option = toBarSeries([], CHART_COLORS.user);
    expect(xAxisData(option)).toEqual([]);
    expect(seriesOf(option)[0]!.data).toEqual([]);
  });

  it("类别 > 30 启用 dataZoom", () => {
    const rows = Array.from({ length: 35 }, (_, i) => ({
      name: `u${i}`,
      total_hours: 1,
    }));
    const option = toBarSeries(rows, CHART_COLORS.user);
    const opt = option as unknown as OptionLike;
    expect(opt.dataZoom).toBeDefined();
    expect((opt.dataZoom as unknown[]).length).toBeGreaterThan(0);
  });

  it("textColor/splitColor 注入坐标轴文字与值轴分割线", () => {
    const option = toBarSeries([{ name: "a", total_hours: 1 }], "#123456", {
      textColor: "#dddddd",
      splitColor: "#333333",
    });
    const x = firstAxis(option, "xAxis")!;
    const y = firstAxis(option, "yAxis")!;
    expect(x.axisLabel!.color).toBe("#dddddd");
    expect(y.axisLabel!.color).toBe("#dddddd");
    expect(y.nameTextStyle!.color).toBe("#dddddd");
    expect(y.splitLine!.lineStyle!.color).toBe("#333333");
  });

  it("不传主题入参时回落 DEFAULT_THEME 浅色取值", () => {
    const option = toBarSeries([{ name: "a", total_hours: 1 }], "#123456");
    const t = themes[DEFAULT_THEME].color;
    expect(firstAxis(option, "xAxis")!.axisLabel!.color).toBe(t.slate[600]);
    expect(firstAxis(option, "yAxis")!.splitLine!.lineStyle!.color).toBe(
      t.border,
    );
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

  it("颜色按 chartColors(theme).pie 分配", () => {
    const rows = [{ name: "a", total_hours: 1 }];
    const option = toPieSeries(rows, 1);
    const data = seriesOf(option)[0]!.data as {
      itemStyle: { color: string };
    }[];
    expect(data[0]!.itemStyle.color).toBe(CHART_COLORS.pie[0]);
  });

  it("pieColors/textColor 入参覆盖默认取值(dark 场景)", () => {
    const rows = [{ name: "a", total_hours: 1 }];
    const dark = chartColors("dark");
    const option = toPieSeries(rows, 1, 5, {
      pieColors: dark.pie,
      textColor: themes.dark.color.slate[600],
    });
    const data = seriesOf(option)[0]!.data as {
      itemStyle: { color: string };
    }[];
    expect(data[0]!.itemStyle.color).toBe(dark.pie[0]);
    expect((option as unknown as OptionLike).legend!.textStyle!.color).toBe(
      themes.dark.color.slate[600],
    );
  });

  it("不传主题入参时 legend 文字色回落 DEFAULT_THEME 取值", () => {
    const option = toPieSeries([{ name: "a", total_hours: 1 }], 1);
    expect((option as unknown as OptionLike).legend!.textStyle!.color).toBe(
      themes[DEFAULT_THEME].color.slate[600],
    );
  });
});
