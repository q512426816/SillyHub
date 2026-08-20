// styles/themes.test.ts
// task-14 / FR-01 / D-101@v1 / D-003@v2：主题注册表单一源结构一致性单测。
//
// 依据：
//   - .sillyspec/changes/2026-08-20-frontend-ai-native-style/tasks/task-14.md
//   - styles/themes.ts（task-01：themes / DEFAULT_THEME / ThemeDef 契约）
//
// 覆盖：
//   1. blue 与 ai-native 两套 color 键集合深度相等（Object.keys 递归排序后 toEqual）
//   2. 每套主题 brand 十一档（50-950）键齐全
//   3. 每套主题 semantic 五档（success/warning/error/info/neutral）键齐全
//   4. DEFAULT_THEME === "ai-native" 且 themes 恰含 blue / ai-native 两键
//   5. info 例外契约（D-003@v2）：两套 semantic.info 各等于各自 accent

import { describe, expect, it } from "vitest";

import { DEFAULT_THEME, themes, type ThemeName } from "@/styles/themes";

// 两套主题名（与 themes 键集合一一对应）
const THEME_NAMES: readonly ThemeName[] = ["blue", "ai-native"];

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
];

// semantic 语义档键集合
const SEMANTIC_KEYS = ["success", "warning", "error", "info", "neutral"];

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
  it("blue 与 ai-native 两套 color 键集合深度相等（递归排序后同构）", () => {
    expect(keySkeleton(themes.blue.color)).toEqual(
      keySkeleton(themes["ai-native"].color),
    );
  });

  it("每套主题 brand 色阶十一档（50-950）键齐全", () => {
    for (const name of THEME_NAMES) {
      expect(Object.keys(themes[name].color.brand).sort()).toEqual(
        [...BRAND_SCALE_KEYS].sort(),
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

  it("DEFAULT_THEME 为 ai-native，且 themes 恰含 blue 与 ai-native 两键", () => {
    expect(DEFAULT_THEME).toBe("ai-native");
    expect(Object.keys(themes).sort()).toEqual(["ai-native", "blue"]);
  });

  it("info 例外契约（D-003@v2）：两套 semantic.info 各等于各自 accent", () => {
    for (const name of THEME_NAMES) {
      expect(themes[name].color.semantic.info).toBe(themes[name].color.accent);
    }
  });
});
