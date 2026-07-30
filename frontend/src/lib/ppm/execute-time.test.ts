import { describe, expect, it } from "vitest";
import dayjs from "dayjs";

import { pickExecuteEndIso } from "./execute-time";

describe("pickExecuteEndIso", () => {
  it("中间天(非最后一天)→ 当天日末 23:59:59Z", () => {
    const end = pickExecuteEndIso("2026-07-28", false, "2026-07-28T12:00:00Z");
    expect(end).toBe("2026-07-28T23:59:59Z");
  });

  it("中间天不受 start / now 影响(恒为日末)", () => {
    const end = pickExecuteEndIso(
      "2026-07-28",
      false,
      "2026-07-28T12:00:00Z",
      dayjs("2026-07-30T10:00:00Z"),
    );
    expect(end).toBe("2026-07-28T23:59:59Z");
  });

  it("最后一天且 now 晚于 start → 用提交时刻 now", () => {
    const now = dayjs("2026-07-30T15:30:00Z");
    const end = pickExecuteEndIso("2026-07-30", true, "2026-07-30T09:00:00Z", now);
    expect(end).toBe(now.toISOString());
    // 开始 ≠ 结束
    expect(end).not.toBe("2026-07-30T09:00:00Z");
  });

  it("最后一天且 now 早于 start(上午提交, start 占位12:00)→ 倒置兜底退回日末", () => {
    const end = pickExecuteEndIso(
      "2026-07-30",
      true,
      "2026-07-30T12:00:00Z",
      dayjs("2026-07-30T10:00:00Z"),
    );
    expect(end).toBe("2026-07-30T23:59:59Z");
  });

  it("最后一天且 now == start → 用 now(不倒置)", () => {
    const now = dayjs("2026-07-30T12:00:00Z");
    const end = pickExecuteEndIso("2026-07-30", true, "2026-07-30T12:00:00Z", now);
    expect(end).toBe(now.toISOString());
  });

  it("首条跨天(isLast=false) start 为真实启动时刻 → end 仍为当天日末且 > start", () => {
    const end = pickExecuteEndIso("2026-07-28", false, "2026-07-28T14:30:00Z");
    expect(end).toBe("2026-07-28T23:59:59Z");
    expect(end > "2026-07-28T14:30:00Z").toBe(true);
  });
});
