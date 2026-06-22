// tests/lib/__tests__/format-token.test.ts
// task-16 / FR-11：formatTokenCount 数字格式化单测。
//
// 依据：
//   - .sillyspec/changes/2026-06-22-agent-run-pipeline-fix/task-16.md §TDD
//   - design.md §5.5 Token 消耗展示（边界：1234 → 1.2k）
//   - requirements.md FR-11
//
// 覆盖边界（task-16.md §边界处理）：
//   1. null / undefined → "—"
//   2. 0 → "0"（与 null 区分，确认零消耗）
//   3. < 1000 → 原值
//   4. 1000 ≤ n < 1_000_000 → k 后缀（1 位小数）
//   5. ≥ 1_000_000 → M 后缀（1 位小数）

import { describe, it, expect } from "vitest";

import { formatTokenCount } from "../format-token";

describe("task-16: formatTokenCount 数字格式化 (FR-11)", () => {
  it("null / undefined 返回占位符", () => {
    expect(formatTokenCount(null)).toBe("—");
    expect(formatTokenCount(undefined)).toBe("—");
  });

  it("0 显示为字符串 0（与 null 区分）", () => {
    expect(formatTokenCount(0)).toBe("0");
  });

  it("小于 1000 原值显示", () => {
    expect(formatTokenCount(1)).toBe("1");
    expect(formatTokenCount(847)).toBe("847");
    expect(formatTokenCount(999)).toBe("999");
  });

  it("1000-999999 显示 k 后缀（1 位小数）", () => {
    expect(formatTokenCount(1000)).toBe("1.0k");
    expect(formatTokenCount(1234)).toBe("1.2k");
    expect(formatTokenCount(12345)).toBe("12.3k");
    expect(formatTokenCount(999999)).toBe("1000.0k");
  });

  it("≥ 1_000_000 显示 M 后缀（1 位小数）", () => {
    expect(formatTokenCount(1_000_000)).toBe("1.0M");
    expect(formatTokenCount(1_500_000)).toBe("1.5M");
    expect(formatTokenCount(123_456_789)).toBe("123.5M");
  });
});
