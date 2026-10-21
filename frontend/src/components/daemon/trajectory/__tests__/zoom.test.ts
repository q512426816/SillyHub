/**
 * 轨迹时间轴视野数学单测 —— 2026-10-20-session-page-dsh-alignment 档 1（D-026）的「缩放 / 平移」。
 *
 * 这些是纯函数（`zoom.ts`）：无 DOM、无 React、无时间源。断言的是**几何契约**：
 *   1. `zoomAt` 保持指针下的时刻不动（锚点稳定），只在钳制边界上才滑；
 *   2. 跨度恒落在 [60s, 整窗]；
 *   3. `panView` 只挪起点、不改跨度，且越界钳到边界；
 *   4. `tickTimes` 等距、含两端、`count` 个；
 *   5. `pickSpanAt` 的 6px 命中带与「中心最近」裁决。
 */
import { describe, expect, it } from "vitest";

import {
  HIT_BAND_PX,
  MIN_VIEW_SPAN_MS,
  axisTicks,
  clampView,
  formatTickLabel,
  formatViewRangeLabel,
  panView,
  pickSpanAt,
  timeAtRatio,
  tickTimes,
  tickTicks,
  viewSpan,
  viewSpanBounds,
  zoomAt,
  type ViewLimits,
  type ViewWindow,
} from "../zoom";

const T0 = Date.parse("2026-01-01T00:00:00.000Z");
const MIN = 60_000;

const LIMITS: ViewLimits = { start: T0, end: T0 + 60 * MIN };
const FULL: ViewWindow = { start: LIMITS.start, end: LIMITS.end };

describe("zoomAt", () => {
  it("放大时指针所指时刻保持在同一个 ratio 下（锚点稳定）", () => {
    const view: ViewWindow = { start: T0 + 10 * MIN, end: T0 + 30 * MIN };
    // 取视野 30% 处作锚点
    const anchor = timeAtRatio(view, 0.3);
    const next = zoomAt(view, anchor, 1.15, LIMITS);
    // epoch ms 量级（1.7e12）下 float64 的绝对精度约 4e-4 ms，故按比值断言。
    expect(viewSpan(next) / viewSpan(view)).toBeCloseTo(1 / 1.15, 6);
    expect(Math.abs(viewSpan(next) - viewSpan(view) / 1.15)).toBeLessThan(1);
    // 锚点仍在 30% 处：像素不漂
    expect((anchor - next.start) / viewSpan(next)).toBeCloseTo(0.3, 6);
    // 时间上不漂（1ms 内）
    expect(Math.abs(timeAtRatio(next, 0.3) - anchor)).toBeLessThanOrEqual(1);
  });

  it("连续放大到下限就停在 60s（不再缩小），且视野仍在整窗内", () => {
    let view = FULL;
    for (let i = 0; i < 80; i += 1) view = zoomAt(view, timeAtRatio(view, 0.5), 1.15, LIMITS);
    expect(viewSpan(view)).toBeCloseTo(MIN_VIEW_SPAN_MS, 6);
    expect(view.start).toBeGreaterThanOrEqual(LIMITS.start);
    expect(view.end).toBeLessThanOrEqual(LIMITS.end);
  });

  it("缩小到整窗即封顶（跨度不超过 windowEnd - windowStart）", () => {
    let view: ViewWindow = { start: T0 + 20 * MIN, end: T0 + 21 * MIN };
    for (let i = 0; i < 40; i += 1) view = zoomAt(view, timeAtRatio(view, 0.5), 1 / 1.15, LIMITS);
    expect(view.start).toBe(LIMITS.start);
    expect(view.end).toBe(LIMITS.end);
  });

  it("锚点贴左边界时缩放不会越过 windowStart（钳制而非漂出窗口）", () => {
    const view: ViewWindow = { start: T0 + 5 * MIN, end: T0 + 15 * MIN };
    const next = zoomAt(view, T0, 1 / 1.15, LIMITS); // 向过去缩小，锚点已在窗口最左
    expect(next.start).toBe(LIMITS.start);
    expect(next.end).toBeLessThanOrEqual(LIMITS.end);
  });

  it("整窗跨度短于 60s 时下限退化为整窗（不允许比数据更宽）", () => {
    const tiny: ViewLimits = { start: T0, end: T0 + 20_000 };
    const next = zoomAt({ start: T0, end: T0 + 20_000 }, T0 + 10_000, 1.15, tiny);
    expect(viewSpanBounds(tiny)).toEqual({ min: 20_000, max: 20_000 });
    expect(next).toEqual({ start: T0, end: T0 + 20_000 });
  });
});

describe("panView", () => {
  it("平移只挪起点，跨度不变", () => {
    const view: ViewWindow = { start: T0 + 10 * MIN, end: T0 + 20 * MIN };
    const next = panView(view, 5 * MIN, LIMITS);
    expect(next.start).toBe(T0 + 15 * MIN);
    expect(viewSpan(next)).toBe(viewSpan(view));
  });

  it("向过去平移越界 → 起点钳到 windowStart", () => {
    const view: ViewWindow = { start: T0 + 10 * MIN, end: T0 + 20 * MIN };
    const next = panView(view, -999 * MIN, LIMITS);
    expect(next.start).toBe(LIMITS.start);
    expect(next.end).toBe(T0 + 10 * MIN);
  });

  it("向未来平移越界 → 终点钳到 windowEnd", () => {
    const view: ViewWindow = { start: T0 + 10 * MIN, end: T0 + 20 * MIN };
    const next = panView(view, 999 * MIN, LIMITS);
    expect(next.end).toBe(LIMITS.end);
    expect(next.start).toBe(T0 + 50 * MIN);
  });

  it("非有限 delta / 非法视野被规整而非产出 NaN", () => {
    const broken: ViewWindow = { start: T0, end: T0 };
    expect(panView(broken, Number.NaN, LIMITS)).toEqual(FULL);
    expect(clampView({ start: T0 - 10 * MIN, end: T0 + 999 * MIN }, LIMITS)).toEqual(FULL);
  });
});

describe("tickTimes / axisTicks", () => {
  it("7 个等距刻度：首尾落在视野两端，严格递增", () => {
    const view: ViewWindow = { start: T0 + 3 * MIN, end: T0 + 9 * MIN };
    const ticks = tickTimes(view.start, view.end, 7);
    expect(ticks).toHaveLength(7);
    expect(ticks[0]).toBe(view.start);
    expect(ticks[ticks.length - 1]).toBe(view.end);
    for (let i = 1; i < ticks.length; i += 1) {
      expect(ticks[i]!).toBeGreaterThan(ticks[i - 1]!);
      expect(ticks[i]! - ticks[i - 1]!).toBeCloseTo(MIN, 6); // 6 分钟 / 6 段
    }
  });

  it("count 被夹到 ≥2；退化视野返回同一时刻的 count 个点", () => {
    expect(tickTimes(T0, T0 + MIN, 1)).toHaveLength(2);
    const flat = tickTimes(T0, T0, 5);
    expect(flat).toHaveLength(5);
    expect(new Set(flat)).toEqual(new Set([T0]));
  });

  it("axisTicks 的 ratio 从 0 到 1 且与 tickTimes 对齐；tickTicks 为规格别名", () => {
    const view: ViewWindow = { start: T0, end: T0 + 10 * MIN };
    const ticks = axisTicks(view.start, view.end, 5);
    expect(ticks.map((tick) => tick.ratio)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(ticks.map((tick) => tick.at)).toEqual(tickTimes(view.start, view.end, 5));
    expect(tickTicks).toBe(tickTimes);
  });
});

describe("刻度文案（随视野重算）", () => {
  it("长会话用钟点，窄视野自动补秒——7 个刻度不会撞成同一个时刻", () => {
    // 整窗 577 分钟；视野 2 小时
    const fullSpan = 577 * MIN;
    const twoHours: ViewWindow = { start: T0 + 200 * MIN, end: T0 + 320 * MIN };
    const wide = tickTimes(twoHours.start, twoHours.end, 7).map((at) =>
      formatTickLabel(at, twoHours, fullSpan),
    );
    expect(new Set(wide).size).toBe(7);
    expect(wide.every((label) => /^\d{2}:\d{2}$/.test(label))).toBe(true);

    // 缩到 1 分钟：HH:MM 会全撞在一起 → 补秒
    const oneMinute: ViewWindow = { start: T0 + 200 * MIN, end: T0 + 201 * MIN };
    const narrow = tickTimes(oneMinute.start, oneMinute.end, 7).map((at) =>
      formatTickLabel(at, oneMinute, fullSpan),
    );
    expect(new Set(narrow).size).toBe(7);
    expect(narrow.every((label) => /^\d{2}:\d{2}:\d{2}$/.test(label))).toBe(true);
  });

  it("短会话用相对视野起点的 +mm:ss；视野范围文案同步切换", () => {
    const fullSpan = 20 * MIN;
    const view: ViewWindow = { start: T0 + 5 * MIN, end: T0 + 15 * MIN };
    const labels = tickTimes(view.start, view.end, 3).map((at) => formatTickLabel(at, view, fullSpan));
    expect(labels).toEqual(["+00:00", "+05:00", "+10:00"]);
    expect(formatViewRangeLabel(view, T0, fullSpan)).toBe("+05:00 – +15:00");
    // 长会话下换成钟点；视野 <10 分钟再补秒（10 分钟整仍用 HH:MM）
    expect(formatViewRangeLabel({ start: T0 + 5 * MIN, end: T0 + 6 * MIN }, T0, 600 * MIN)).toMatch(
      /^\d{2}:\d{2}:\d{2} – \d{2}:\d{2}:\d{2}$/,
    );
    expect(formatViewRangeLabel({ start: T0, end: T0 + 120 * MIN }, T0, 600 * MIN)).toMatch(
      /^\d{2}:\d{2} – \d{2}:\d{2}$/,
    );
  });
});

describe("pickSpanAt", () => {
  const bands = [
    { span: { id: "a" }, leftPx: 10, rightPx: 12 }, // 2px 窄条
    { span: { id: "b" }, leftPx: 13, rightPx: 15 }, // 紧邻的 2px 窄条
    { span: { id: "wide" }, leftPx: 100, rightPx: 200 }, // 宽条
  ];

  it("2px 条在 6px 命中带内（中心两侧 3px）仍可命中", () => {
    expect(pickSpanAt(bands, 11, HIT_BAND_PX / 2)?.id).toBe("a");
    expect(pickSpanAt(bands, 8.5, HIT_BAND_PX / 2)?.id).toBe("a"); // 中心 11 - 2.5
    expect(pickSpanAt(bands, 13.5, HIT_BAND_PX / 2)?.id).toBe("b");
  });

  it("重叠时取中心离指针最近的那根（而不是先渲染的那根）", () => {
    const overlapping = [
      { span: { id: "left" }, leftPx: 0, rightPx: 40 },
      { span: { id: "right" }, leftPx: 36, rightPx: 40 },
    ];
    expect(pickSpanAt(overlapping, 38, HIT_BAND_PX / 2)?.id).toBe("right");
    expect(pickSpanAt(overlapping, 10, HIT_BAND_PX / 2)?.id).toBe("left");
  });

  it("宽条整段可点（不限于中心 3px）", () => {
    expect(pickSpanAt(bands, 195, HIT_BAND_PX / 2)?.id).toBe("wide");
  });

  it("离所有条都超过命中带 → null（点空白不选中）", () => {
    expect(pickSpanAt(bands, 60, HIT_BAND_PX / 2)).toBeNull();
  });
});
