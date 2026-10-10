/**
 * 2026-10-10-session-turn-token-speed FR-03 / FR-04：轮级 tok/s 纯函数单测——
 * 格式化口径（≥10 取整 / <10 一位小数 / 负值钳 0）与显示门控（非终态 / 缺
 * 数据 / 时长非正一律 null 不伪造）。
 */
import { describe, expect, it } from "vitest";

import {
  formatTokensPerSecond,
  turnTokenSpeedText,
} from "@/components/daemon/turn-speed";

describe("formatTokensPerSecond", () => {
  it("≥10 四舍五入取整", () => {
    expect(formatTokensPerSecond(100)).toBe("100");
    expect(formatTokensPerSecond(34.4)).toBe("34");
    expect(formatTokensPerSecond(45.5)).toBe("46");
  });

  it("<10 保留 1 位小数", () => {
    expect(formatTokensPerSecond(3.14)).toBe("3.1");
    expect(formatTokensPerSecond(9.99)).toBe("10.0");
    expect(formatTokensPerSecond(0.5)).toBe("0.5");
  });

  it("负值钳 0；非有限值兜 0", () => {
    expect(formatTokensPerSecond(-5)).toBe("0.0");
    expect(formatTokensPerSecond(NaN)).toBe("0");
    expect(formatTokensPerSecond(Infinity)).toBe("0");
  });
});

describe("turnTokenSpeedText", () => {
  it("终态轮双值可得 → 返回 tok/s 文本（1250 tok / 12.5s = 100）", () => {
    expect(turnTokenSpeedText(1250, 12500, "completed")).toBe("100 tok/s");
  });

  it("低速保留一位小数（31 tok / 10s = 3.1）", () => {
    expect(turnTokenSpeedText(31, 10_000, "completed")).toBe("3.1 tok/s");
  });

  it.each(["running", "pending", "interrupting"] as const)(
    "非终态 %s 不显示（无 API 时长数据，禁止墙钟估速）",
    (status) => {
      expect(turnTokenSpeedText(1250, 12500, status)).toBeNull();
    },
  );

  it.each([
    ["outputTokens 缺失", null, 12500],
    ["apiDurationMs 缺失（旧数据 / 无时长引擎）", 1250, null],
    ["apiDurationMs 非正", 1250, 0],
  ])("%s → null 不伪造", (_name, outputTokens, apiDurationMs) => {
    expect(turnTokenSpeedText(outputTokens, apiDurationMs, "completed")).toBeNull();
  });

  it("失败/中止轮数据齐同样显示（速度与业务成败正交）", () => {
    expect(turnTokenSpeedText(1250, 12500, "failed")).toBe("100 tok/s");
    expect(turnTokenSpeedText(1250, 12500, "killed")).toBe("100 tok/s");
  });
});
