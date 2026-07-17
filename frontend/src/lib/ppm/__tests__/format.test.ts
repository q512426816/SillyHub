import { describe, expect, it } from "vitest";

import { fmtDate, fmtDateTime, isOverEstimate, parseWorkLoadPersonDays } from "@/lib/ppm/format";

describe("fmtDate", () => {
  it("纯日期字符串原样格式化", () => {
    expect(fmtDate("2025-03-31")).toBe("2025-03-31");
  });

  it("ISO 字符串截取为 YYYY-MM-DD", () => {
    // 取 12:00 UTC:任意时区(UTC-12~+14)都不跨日,断言稳定不依赖运行机时区。
    expect(fmtDate("2025-03-15T12:00:00Z")).toBe("2025-03-15");
  });

  it("空值兜底 —", () => {
    expect(fmtDate(null)).toBe("—");
    expect(fmtDate(undefined)).toBe("—");
    expect(fmtDate("")).toBe("—");
  });

  it("自定义 fallback", () => {
    expect(fmtDate(null, "无")).toBe("无");
  });

  it("非法值兜底", () => {
    expect(fmtDate("not-a-date")).toBe("—");
  });
});

describe("fmtDateTime", () => {
  it("含时间格式化为 YYYY-MM-DD HH:mm", () => {
    // 日期部分 03-15 稳定;HH:mm 随时区变化,仅断言日期前缀 + 固定长度。
    const out = fmtDateTime("2025-03-15T12:00:00Z");
    expect(out.startsWith("2025-03-15")).toBe(true);
    expect(out).toHaveLength(16); // "YYYY-MM-DD HH:mm"
  });

  it("空值兜底", () => {
    expect(fmtDateTime(null)).toBe("—");
  });
});

describe("parseWorkLoadPersonDays", () => {
  it("纯数字 / d / 天 视为人天", () => {
    expect(parseWorkLoadPersonDays("8")).toBe(8);
    expect(parseWorkLoadPersonDays("0.5d")).toBe(0.5);
    expect(parseWorkLoadPersonDays("2天")).toBe(2);
  });

  it("h / 小时 换算为人天(÷8)", () => {
    expect(parseWorkLoadPersonDays("8h")).toBe(1);
    expect(parseWorkLoadPersonDays("16小时")).toBe(2);
  });

  it("空 / 非数字 返回 null(不高亮兜底)", () => {
    expect(parseWorkLoadPersonDays(null)).toBeNull();
    expect(parseWorkLoadPersonDays(undefined)).toBeNull();
    expect(parseWorkLoadPersonDays("")).toBeNull();
    expect(parseWorkLoadPersonDays("约三")).toBeNull();
  });
});

describe("isOverEstimate", () => {
  it("已消耗超过预估 → true", () => {
    expect(isOverEstimate(3, "2")).toBe(true);
    expect(isOverEstimate(2.5, "0.5d")).toBe(true);
  });

  it("已消耗等于/小于预估 → false", () => {
    expect(isOverEstimate(2, "2")).toBe(false);
    expect(isOverEstimate(1, "8")).toBe(false);
  });

  it("已消耗 ≤ 0 或预估无法解析 → false(不误报)", () => {
    expect(isOverEstimate(0, "2")).toBe(false);
    expect(isOverEstimate(null, "2")).toBe(false);
    expect(isOverEstimate(5, "")).toBe(false);
    expect(isOverEstimate(5, "约三")).toBe(false);
  });
});
