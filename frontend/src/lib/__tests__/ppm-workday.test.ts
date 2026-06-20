import { describe, expect, it } from "vitest";

import {
  addWorkingDaysDate,
  addWorkingDaysISO,
  addWorkingDaysMs,
} from "@/lib/ppm/workday";

/**
 * 测试用例严格对照源 `dept_project_front/src/utils/formatTime.ts` 的
 * `addWorkingDays` 语义(含其 `days - 0.01` 微调与边界行为)。
 * 期望值由源算法实测得到(node 复跑),确保我方实现逐位对齐源。
 *
 * 起点 2024-06-03 周一 09:00:
 * - +1 → 2024-06-05(源算法 0.99 天跨日副作用,N+1 天而非 N 天)
 * - +2 → 2024-06-06,+3 → 2024-06-07,+5 → 2024-06-10(跨周末)
 * - +7 → 2024-06-13(再跨一周)
 */
describe("ppm workday helpers", () => {
  // 固定基准:2024-06-03 周一 09:00:00(本地时区)
  const monday = new Date(2024, 5, 3, 9, 0, 0).getTime();

  it("加 1 天落到周三(源 N+1 跨日副作用)", () => {
    expect(addWorkingDaysDate(monday, 1)).toBe("2024-06-05");
    const iso = addWorkingDaysISO(monday, 1);
    expect(iso.startsWith("2024-06-05")).toBe(true);
  });

  it("加 2 天落到周四", () => {
    expect(addWorkingDaysDate(monday, 2)).toBe("2024-06-06");
  });

  it("加 3 天落到周五", () => {
    expect(addWorkingDaysDate(monday, 3)).toBe("2024-06-07");
  });

  it("加 5 天跨周末到下周一", () => {
    expect(addWorkingDaysDate(monday, 5)).toBe("2024-06-10");
  });

  it("加 7 天再跨一周到下周三", () => {
    expect(addWorkingDaysDate(monday, 7)).toBe("2024-06-13");
  });

  it("起点是周六时顺延到周一再加工作日", () => {
    // 2024-06-08 周六 → 顺延到 06-10 周一,再 + 1 天 = 06-11 周二?源实测 06-10
    // (顺延到周一当天后,+1 的跨日副作用未再推进)
    const saturday = new Date(2024, 5, 8, 10, 0, 0).getTime();
    expect(addWorkingDaysDate(saturday, 1)).toBe("2024-06-10");
  });

  it("起点是周日时顺延到周一", () => {
    const sunday = new Date(2024, 5, 9, 10, 0, 0).getTime();
    expect(addWorkingDaysDate(sunday, 1)).toBe("2024-06-10");
  });

  it("ignoreWeekend=false 不跳周末(自然日推进)", () => {
    // 周一 + 2 自然日 = 周三(源实测 06-06,因 +1 跨日副作用)
    expect(addWorkingDaysDate(monday, 2, false)).toBe("2024-06-06");
  });

  it("ISO 字符串入参也能正常计算", () => {
    expect(addWorkingDaysDate("2024-06-03T09:00:00", 3)).toBe("2024-06-07");
  });

  it("毫秒输出单调递增", () => {
    const a = addWorkingDaysMs(monday, 3);
    const b = addWorkingDaysMs(monday, 5);
    expect(b).toBeGreaterThan(a);
  });

  it("工时为 0 或非法时不抛错,返回合理值", () => {
    expect(() => addWorkingDaysMs(monday, 0)).not.toThrow();
    expect(() => addWorkingDaysMs(monday, Number.NaN)).not.toThrow();
  });

  it("ISO 输出长度恒为 19(YYYY-MM-DD HH:mm:ss)", () => {
    const out = addWorkingDaysISO(monday, 1);
    expect(out.length).toBe(19);
  });
});
