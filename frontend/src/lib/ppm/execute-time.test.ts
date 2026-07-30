import { describe, expect, it } from "vitest";
import dayjs from "dayjs";

import { localDayTimeToIso, pickExecuteEndIso } from "./execute-time";

describe("localDayTimeToIso", () => {
  it("本地当天 23:59:59 → 解析回本地仍是当天 23:59:59(不跨日)", () => {
    const iso = localDayTimeToIso("2026-07-23", "23:59:59");
    // 往返一致(dayjs 同一时区解析/格式化),与时区无关 → 不 flaky
    expect(dayjs(iso).format("YYYY-MM-DD HH:mm:ss")).toBe("2026-07-23 23:59:59");
  });

  it("本地 12:00:00 → 解析回本地 12:00:00(非 UTC 12:00 在 +8 漂成的 20:00)", () => {
    const iso = localDayTimeToIso("2026-07-24", "12:00:00");
    expect(dayjs(iso).format("YYYY-MM-DD HH:mm:ss")).toBe("2026-07-24 12:00:00");
  });
});

describe("pickExecuteEndIso", () => {
  it("中间天 → 本地当天 23:59:59(回显当天,不是 UTC 23:59:59Z 漂到的次日 07:59:59)", () => {
    const iso = pickExecuteEndIso("2026-07-23", false);
    const back = dayjs(iso).format("YYYY-MM-DD HH:mm:ss");
    expect(back).toBe("2026-07-23 23:59:59");
    expect(back.startsWith("2026-07-23")).toBe(true);
  });

  it("中间天不受 now 影响(恒为当天日末)", () => {
    const iso = pickExecuteEndIso("2026-07-23", false, dayjs("2030-01-01T00:00:00"));
    expect(dayjs(iso).format("YYYY-MM-DD HH:mm:ss")).toBe("2026-07-23 23:59:59");
  });

  it("最后一天 → 提交时刻 now(回显提交时刻)", () => {
    const now = dayjs("2026-07-30T15:30:00");
    const iso = pickExecuteEndIso("2026-07-30", true, now);
    expect(dayjs(iso).format("YYYY-MM-DD HH:mm:ss")).toBe("2026-07-30 15:30:00");
  });

  it("最后一天恒用 now(上午提交 now 早于占位 start 12:00,也不退回日末)", () => {
    const now = dayjs("2026-07-30T10:00:00");
    const iso = pickExecuteEndIso("2026-07-30", true, now);
    expect(dayjs(iso).format("YYYY-MM-DD HH:mm:ss")).toBe("2026-07-30 10:00:00");
  });
});
