import { describe, expect, it } from "vitest";

import { fmtDate, fmtDateTime } from "@/lib/ppm/format";

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
