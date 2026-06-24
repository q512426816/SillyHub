import { describe, it, expect } from "vitest";
import dayjs from "dayjs";

import {
  assignLanes,
  computeBarLayout,
  DAY_WIDTH,
  BAR_GAP,
  rangeDateKeys,
  isWeekendKey,
} from "./kanban-gantt-helpers";

const rangeStart = dayjs("2026-06-23"); // 周一
const rangeEnd = dayjs("2026-06-29"); // 周日

describe("computeBarLayout", () => {
  it("正常跨度:left=0,width=天数×DAY_WIDTH-gap", () => {
    const r = computeBarLayout("2026-06-23", "2026-06-25", rangeStart, rangeEnd);
    expect(r).not.toBeNull();
    expect(r!.left).toBe(0);
    expect(r!.width).toBe(3 * DAY_WIDTH - BAR_GAP);
    expect(r!.clippedStart).toBe(false);
    expect(r!.clippedEnd).toBe(false);
  });

  it("跨范围裁剪:clippedStart+clippedEnd,left 回到 0", () => {
    const r = computeBarLayout("2026-06-20", "2026-07-02", rangeStart, rangeEnd);
    expect(r).not.toBeNull();
    expect(r!.clippedStart).toBe(true);
    expect(r!.clippedEnd).toBe(true);
    expect(r!.left).toBe(0);
  });

  it("单边缺失返回 null(归未排期)", () => {
    expect(computeBarLayout(null, "2026-06-25", rangeStart, rangeEnd)).toBeNull();
    expect(computeBarLayout("2026-06-23", null, rangeStart, rangeEnd)).toBeNull();
    expect(computeBarLayout("", "2026-06-25", rangeStart, rangeEnd)).toBeNull();
  });

  it("无效日期返回 null", () => {
    expect(computeBarLayout("not-a-date", "2026-06-25", rangeStart, rangeEnd)).toBeNull();
  });

  it("start>deadline 兜底按 end 单日", () => {
    const r = computeBarLayout("2026-06-27", "2026-06-24", rangeStart, rangeEnd);
    expect(r).not.toBeNull();
    // 按 deadline 6/24 单日(第 2 天,index 1)
    expect(r!.left).toBe(1 * DAY_WIDTH);
    expect(r!.clippedStart).toBe(false);
  });
});

describe("assignLanes", () => {
  it("空数组 rowCount=1", () => {
    const r = assignLanes([]);
    expect(r.rowCount).toBe(1);
    expect(r.laneMap.size).toBe(0);
  });

  it("无并行(顺序)→ 1 行", () => {
    const r = assignLanes([
      { id: "a", start: dayjs("2026-06-23"), end: dayjs("2026-06-23") },
      { id: "b", start: dayjs("2026-06-24"), end: dayjs("2026-06-24") },
    ]);
    expect(r.rowCount).toBe(1);
    expect(r.laneMap.get("a")).toBe(0);
    expect(r.laneMap.get("b")).toBe(0);
  });

  it("并行重叠 → 多行(贪心首个不冲突槽)", () => {
    const r = assignLanes([
      { id: "a", start: dayjs("2026-06-23"), end: dayjs("2026-06-25") },
      { id: "b", start: dayjs("2026-06-24"), end: dayjs("2026-06-26") }, // 与 a 重叠
      { id: "c", start: dayjs("2026-06-24"), end: dayjs("2026-06-26") }, // 与 a,b 重叠
    ]);
    expect(r.rowCount).toBe(3);
    expect(r.laneMap.get("a")).toBe(0);
    expect(r.laneMap.get("b")).toBe(1);
    expect(r.laneMap.get("c")).toBe(2);
  });

  it("第三个任务可复用第一个空出的槽", () => {
    const r = assignLanes([
      { id: "a", start: dayjs("2026-06-23"), end: dayjs("2026-06-23") },
      { id: "b", start: dayjs("2026-06-23"), end: dayjs("2026-06-25") }, // 与 a 重叠 → 行1
      { id: "c", start: dayjs("2026-06-24"), end: dayjs("2026-06-24") }, // a 已结束 → 复用行0
    ]);
    expect(r.rowCount).toBe(2);
    expect(r.laneMap.get("a")).toBe(0);
    expect(r.laneMap.get("b")).toBe(1);
    expect(r.laneMap.get("c")).toBe(0);
  });
});

describe("rangeDateKeys", () => {
  it("生成范围内日期(含首尾)", () => {
    const keys = rangeDateKeys(rangeStart, rangeEnd);
    expect(keys).toHaveLength(7);
    expect(keys[0]).toBe("2026-06-23");
    expect(keys[6]).toBe("2026-06-29");
  });
});

describe("isWeekendKey", () => {
  it("周六日为 true", () => {
    expect(isWeekendKey("2026-06-27")).toBe(true); // 周六
    expect(isWeekendKey("2026-06-28")).toBe(true); // 周日
  });
  it("工作日为 false", () => {
    expect(isWeekendKey("2026-06-23")).toBe(false); // 周一
    expect(isWeekendKey("2026-06-26")).toBe(false); // 周四
  });
});
