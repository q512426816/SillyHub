// styles/themes.test.ts
// task-14 / FR-01 / D-101@v1 / D-003@v2：主题注册表单一源结构一致性单测。
// 2026-08-23-frontend-dark-theme task-10 / FR-01~FR-04 / D-004@v1 / D-005@v1：
// 扩 dark 主题取值完整性、对称翻转与浅色零回归断言。
//
// 依据：
//   - .sillyspec/changes/2026-08-20-frontend-ai-native-style/tasks/task-14.md
//   - .sillyspec/changes/2026-08-23-frontend-dark-theme/tasks/task-10.md
//   - styles/themes.ts（task-01：themes / DEFAULT_THEME / ThemeDef 契约；
//     2026-08-23-frontend-dark-theme task-01：dark 取值，design §5.1）
//
// 覆盖：
//   1. blue / ai-native / dark 三套 color 键集合深度相等（Object.keys 递归排序后 toEqual）
//   2. 每套主题 brand 十一档（50-950）键齐全
//   3. 每套主题 slate 十档（50-900）键齐全
//   4. 每套主题 semantic 五档（success/warning/error/info/neutral）键齐全
//   5. DEFAULT_THEME === "ai-native" 且 themes 恰含 blue / ai-native / dark 三键
//   6. info 例外契约（D-003@v2）：三套 semantic.info 各等于各自 accent
//   7. dark 取值完整性：brand / slate / semantic 全档与 primary 等关键单值
//      全为合法 6 位 hex（即非空且格式合法）
//   8. 对称翻转（D-004@v1）：dark slate 50↔900 … 400↔500 与浅色 slate 阶逐档
//      互逆；dark brand 50↔950 … 400↔600、500 自映，对照 ai-native violet 阶
//   9. 浅色零回归（D-005@v1）：blue 与 ai-native 的 slate 十档与 Tailwind v3
//      默认 hex 逐值相等（#f8fafc…#0f172a），防 slate 变量化漂移
//  10. dark 关键取值（design §5.1）：primary/primaryHover/accent/bg/card/border
//      与语义五色恰为指定 Tailwind v3 默认值

import { describe, expect, it } from "vitest";

import { DEFAULT_THEME, themes, type ThemeName } from "@/styles/themes";

// 三套主题名（与 themes 键集合一一对应）
const THEME_NAMES: readonly ThemeName[] = ["blue", "ai-native", "dark"];

// brand 色阶档位（Tailwind v3 默认 50-950 十一档）
const BRAND_SCALE_KEYS = [
  "50",
  "100",
  "200",
  "300",
  "400",
  "500",
  "600",
  "700",
  "800",
  "900",
  "950",
] as const;

// slate 中性色阶档位（Tailwind v3 默认 50-900 十档）
const SLATE_SCALE_KEYS = [
  "50",
  "100",
  "200",
  "300",
  "400",
  "500",
  "600",
  "700",
  "800",
  "900",
] as const;

// semantic 语义档键集合
const SEMANTIC_KEYS = [
  "success",
  "warning",
  "error",
  "info",
  "neutral",
] as const;

// Tailwind v3 默认 slate 阶（浅色零回归对照基准，D-005@v1；
// 色阶断言取值只允许 Tailwind v3 默认 hex，禁止自调）
const TAILWIND_V3_SLATE: Record<(typeof SLATE_SCALE_KEYS)[number], string> = {
  "50": "#f8fafc",
  "100": "#f1f5f9",
  "200": "#e2e8f0",
  "300": "#cbd5e1",
  "400": "#94a3b8",
  "500": "#64748b",
  "600": "#475569",
  "700": "#334155",
  "800": "#1e293b",
  "900": "#0f172a",
};

// 合法 6 位 hex（同时覆盖「非空」与「格式合法」两个口径）
const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

/**
 * 递归提取键骨架：每层取 Object.keys 后排序，叶子值折叠为 null。
 * 只对照结构（键集合同构）不对照取值——两主题取值本应不同，
 * 结构同构保证消费方（antd token / CSS 变量）对两主题可无差别取键。
 */
function keySkeleton(node: unknown): unknown {
  if (node !== null && typeof node === "object") {
    if (Array.isArray(node)) {
      return node.map((item) => keySkeleton(item));
    }
    const record = node as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key): [string, unknown] => [key, keySkeleton(record[key])]),
    );
  }
  return null;
}

describe("task-14: themes 主题注册表结构一致性", () => {
  it("blue / ai-native / dark 三套 color 键集合深度相等（递归排序后同构）", () => {
    expect(keySkeleton(themes.blue.color)).toEqual(
      keySkeleton(themes["ai-native"].color),
    );
    expect(keySkeleton(themes.blue.color)).toEqual(
      keySkeleton(themes.dark.color),
    );
  });

  it("每套主题 brand 色阶十一档（50-950）键齐全", () => {
    for (const name of THEME_NAMES) {
      expect(Object.keys(themes[name].color.brand).sort()).toEqual(
        [...BRAND_SCALE_KEYS].sort(),
      );
    }
  });

  it("每套主题 slate 色阶十档（50-900）键齐全", () => {
    for (const name of THEME_NAMES) {
      expect(Object.keys(themes[name].color.slate).sort()).toEqual(
        [...SLATE_SCALE_KEYS].sort(),
      );
    }
  });

  it("每套主题 semantic 五档（success/warning/error/info/neutral）键齐全", () => {
    for (const name of THEME_NAMES) {
      expect(Object.keys(themes[name].color.semantic).sort()).toEqual(
        [...SEMANTIC_KEYS].sort(),
      );
    }
  });

  it("DEFAULT_THEME 为 ai-native，且 themes 恰含 blue / ai-native / dark 三键", () => {
    expect(DEFAULT_THEME).toBe("ai-native");
    expect(Object.keys(themes).sort()).toEqual(["ai-native", "blue", "dark"]);
  });

  it("info 例外契约（D-003@v2）：三套 semantic.info 各等于各自 accent", () => {
    for (const name of THEME_NAMES) {
      expect(themes[name].color.semantic.info).toBe(themes[name].color.accent);
    }
  });
});

describe("task-10: dark 主题取值完整性与对称翻转（2026-08-23-frontend-dark-theme）", () => {
  it("dark 取值完整性：brand 十一档 / slate 十档 / 语义五档 / primary 等关键单值全为合法 hex", () => {
    const dark = themes.dark.color;
    for (const step of BRAND_SCALE_KEYS) {
      expect(dark.brand[step]).toMatch(HEX_COLOR_RE);
    }
    for (const step of SLATE_SCALE_KEYS) {
      expect(dark.slate[step]).toMatch(HEX_COLOR_RE);
    }
    for (const key of SEMANTIC_KEYS) {
      expect(dark.semantic[key]).toMatch(HEX_COLOR_RE);
    }
    for (const key of [
      "primary",
      "primaryHover",
      "accent",
      "bg",
      "card",
      "border",
    ] as const) {
      expect(dark[key]).toMatch(HEX_COLOR_RE);
    }
  });

  it("dark slate 阶对称翻转（D-004@v1）：50↔900、100↔800、200↔700、300↔600、400↔500", () => {
    // 浅色两主题共用同一 slate 阶常量（themes.ts），取任一浅色主题对照即可
    const light = themes.blue.color.slate;
    const dark = themes.dark.color.slate;
    expect(dark["50"]).toBe(light["900"]);
    expect(dark["100"]).toBe(light["800"]);
    expect(dark["200"]).toBe(light["700"]);
    expect(dark["300"]).toBe(light["600"]);
    expect(dark["400"]).toBe(light["500"]);
    expect(dark["500"]).toBe(light["400"]);
    expect(dark["600"]).toBe(light["300"]);
    expect(dark["700"]).toBe(light["200"]);
    expect(dark["800"]).toBe(light["100"]);
    expect(dark["900"]).toBe(light["50"]);
  });

  it("dark brand 阶翻转+亮端降档（D-004@v1 + ql-20260824-013 刺眼反馈）：50-500 翻转不变、600-950 各降一档", () => {
    // dark 是 AI 紫暗色版，brand 翻转基准取 ai-native 的 violet 阶（非 blue 的 blue 阶）。
    // ql-20260824-013：对称翻转的亮紫端（600-950）反馈刺眼，各降一档——
    // 600 与 500 同取 violet-500（#8b5cf6，文字端起点与填充主档合流），往上逐档回落
    const light = themes["ai-native"].color.brand;
    const dark = themes.dark.color.brand;
    expect(dark["50"]).toBe(light["950"]);
    expect(dark["100"]).toBe(light["900"]);
    expect(dark["200"]).toBe(light["800"]);
    expect(dark["300"]).toBe(light["700"]);
    expect(dark["400"]).toBe(light["600"]);
    expect(dark["500"]).toBe(light["500"]);
    expect(dark["600"]).toBe(light["500"]); // violet-500（原 light[400]，降一档）
    expect(dark["700"]).toBe(light["400"]); // violet-400（原 light[300]）
    expect(dark["800"]).toBe(light["300"]);
    expect(dark["900"]).toBe(light["200"]);
    expect(dark["950"]).toBe(light["100"]);
  });

  it("浅色零回归（D-005@v1）：blue 与 ai-native 的 slate 十档与 Tailwind v3 默认 hex 逐值相等", () => {
    for (const name of ["blue", "ai-native"] as const) {
      for (const step of SLATE_SCALE_KEYS) {
        expect(themes[name].color.slate[step]).toBe(TAILWIND_V3_SLATE[step]);
      }
    }
  });

  it("dark 关键取值（design §5.1 + ql-20260824-013，全部 Tailwind v3 默认值）：主色 / 表面 / 边框 / 语义五色", () => {
    expect(themes.dark.color.primary).toBe("#7c3aed");
    expect(themes.dark.color.primaryHover).toBe("#8b5cf6");
    expect(themes.dark.color.accent).toBe("#22d3ee");
    expect(themes.dark.color.bg).toBe("#0f172a");
    expect(themes.dark.color.card).toBe("#1e293b");
    expect(themes.dark.color.border).toBe("#334155");
    expect(themes.dark.color.semantic).toEqual({
      success: "#10b981",
      warning: "#f59e0b",
      error: "#ef4444",
      info: "#22d3ee",
      neutral: "#94a3b8",
    });
  });
});
