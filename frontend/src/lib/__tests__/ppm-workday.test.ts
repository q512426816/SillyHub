import { describe, expect, it } from "vitest";

import {
  addWorkingDaysDate,
  addWorkingDaysISO,
  addWorkingDaysMs,
} from "@/lib/ppm/workday";

/**
 * addWorkingDays 语义:工作量 N(工作日),**起点算第 1 天**,完成日 = 第 N 个工作日。
 * 跳过休息日(周末 + 2026 法定假日;调休补班算工作日)。
 *
 * 基准 2024-06-03 周一 09:00(2024 无节假日数据,仅跳周末):
 * - +1 → 当天 06-03(第 1 个工作日)
 * - +2 → 06-04(周二,第 2 个) — 用户口径:工作量 2 天、开始 7/1 → 完成 7/2
 * - +3 → 06-05,+5 → 06-07(周五),+7 → 06-11(跨周末)
 */
describe("ppm workday helpers", () => {
  // 固定基准:2024-06-03 周一 09:00:00(本地时区)
  const monday = new Date(2024, 5, 3, 9, 0, 0).getTime();

  it("工作量 1 天 → 当天(起点算第 1 天)", () => {
    expect(addWorkingDaysDate(monday, 1)).toBe("2024-06-03");
    const iso = addWorkingDaysISO(monday, 1);
    expect(iso.startsWith("2024-06-03")).toBe(true);
  });

  it("工作量 2 天 → 起点 +1 工作日(用户口径 7/1→7/2)", () => {
    expect(addWorkingDaysDate(monday, 2)).toBe("2024-06-04");
  });

  it("工作量 3 天 → 第 3 个工作日", () => {
    expect(addWorkingDaysDate(monday, 3)).toBe("2024-06-05");
  });

  it("工作量 5 天 → 第 5 个工作日(周五)", () => {
    expect(addWorkingDaysDate(monday, 5)).toBe("2024-06-07");
  });

  it("工作量 7 天 → 第 7 个工作日(跨周末到下周二)", () => {
    expect(addWorkingDaysDate(monday, 7)).toBe("2024-06-11");
  });

  it("起点是周六时顺延到周一(作为第 1 天)", () => {
    // 2024-06-08 周六 → 顺延到 06-10 周一(第 1 天),工作量 1 → 当天 06-10
    const saturday = new Date(2024, 5, 8, 10, 0, 0).getTime();
    expect(addWorkingDaysDate(saturday, 1)).toBe("2024-06-10");
  });

  it("起点是周日时顺延到周一(作为第 1 天)", () => {
    const sunday = new Date(2024, 5, 9, 10, 0, 0).getTime();
    expect(addWorkingDaysDate(sunday, 1)).toBe("2024-06-10");
  });

  it("ignoreWeekend=false 不跳周末(自然日推进)", () => {
    // 周一 +2(ignoreWeekend=false):第 2 个自然日 = 06-04
    expect(addWorkingDaysDate(monday, 2, false)).toBe("2024-06-04");
  });

  it("ISO 字符串入参也能正常计算", () => {
    expect(addWorkingDaysDate("2024-06-03T09:00:00", 3)).toBe("2024-06-05");
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

describe("addWorkingDays 跳过 2026 节假日/调休", () => {
  it("起点是法定假日 → 顺延到假日后第一个工作日(第 1 天)", () => {
    // 2026-09-25 周五 中秋假(9-25~9-27) → 顺延到 9-28 周一;工作量 1 → 9-28
    expect(addWorkingDaysDate("2026-09-25", 1)).toBe("2026-09-28");
  });

  it("工作量跨国庆假期 → 跳过 10-1~10-7", () => {
    // 起点 2026-09-30 周三,工作量 3 → 第 3 个工作日:9-30(1) → 10-8(2,跳国庆) → 10-9(3)
    expect(addWorkingDaysDate("2026-09-30", 3)).toBe("2026-10-09");
  });

  it("调休补班日视为工作日(不被跳过)", () => {
    // 2026-01-04 周日 = 元旦调休补班(上班);起点即第 1 天,工作量 2 → +1 工作日 = 01-05(周一)
    expect(addWorkingDaysDate("2026-01-04", 2)).toBe("2026-01-05");
  });
});
