// src/lib/daemon/__tests__/runtimes.test.ts
// 2026-10-15-zcode-engine-appserver task-07：引擎白名单单一源直测（不 mock 本模块）。
// 现有 sessions-portal / session-list-panel 测试均 mock @/lib/daemon/runtimes，
// 真实模块的白名单演进没有守护面——本文件补齐（真实 > mock）。

import { describe, it, expect } from "vitest";
import {
  SESSION_SUPPORTED_PROVIDERS,
  SESSION_ENGINE_OPTIONS,
  PROVIDER_META,
} from "../runtimes";

describe("SESSION_SUPPORTED_PROVIDERS（zcode 接入后）", () => {
  it("含六引擎：claude/codex/pi/cursor/dsh/zcode（有序）", () => {
    expect(SESSION_SUPPORTED_PROVIDERS).toEqual([
      "claude",
      "codex",
      "pi",
      "cursor",
      "dsh",
      "zcode",
    ]);
  });

  it("SESSION_ENGINE_OPTIONS 派生含 zcode 且 label 取 PROVIDER_META", () => {
    const zcode = SESSION_ENGINE_OPTIONS.find((o) => o.value === "zcode");
    expect(zcode).toBeDefined();
    expect(zcode?.label).toBe(PROVIDER_META["zcode"]?.label);
    expect(zcode?.label).toBe("ZCode");
  });

  it("PROVIDER_META zcode 条目三字段齐（label/icon/color）", () => {
    expect(PROVIDER_META["zcode"]).toEqual({
      label: "ZCode",
      icon: "🟤",
      color: "bg-stone-100 text-stone-800",
    });
  });

  it("白名单内每个 provider 均有 PROVIDER_META 条目（防 label 回退裸 key）", () => {
    for (const p of SESSION_SUPPORTED_PROVIDERS) {
      expect(PROVIDER_META[p], `PROVIDER_META 缺 ${p}`).toBeDefined();
    }
  });
});
