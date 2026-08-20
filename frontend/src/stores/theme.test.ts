// stores/theme.test.ts
// task-14 / FR-02 / FR-03 / D-101@v1 / D-102@v1 / D-003@v2：主题偏好 store 单测。
//
// 依据：
//   - .sillyspec/changes/2026-08-20-frontend-ai-native-style/tasks/task-14.md
//   - stores/theme.ts（task-04：useThemeStore / persist / merge 兜底）
//   - styles/themes.ts（task-01：themes / DEFAULT_THEME 单一取值源）
//
// 覆盖：
//   1. 初始 theme === DEFAULT_THEME（ai-native）
//   2. setTheme 在 blue / ai-native 间切换，getState().theme 正确
//   3. persist：setTheme 后 window.localStorage["sillyhub-theme"] 写入
//      JSON 解析含当前 theme（partialize 仅持久化 theme 字段，D-102@v1）
//   4. 非法持久化值兜底：预写脏值（theme="dark"）后 vi.resetModules()
//      + 动态 import 重建 store，theme 回退 DEFAULT_THEME（design §9）
//   5. antd token 跟随（轻量对照）：两主题 color.primary 互异且均为合法 hex
//
// 取舍说明：antd ConfigProvider 渲染断言较重（需渲染整棵 provider 树），
// 本文件改为轻量对照——锁定数据侧 themes[theme].color 的可区分性与合法性，
// 保证切换主题时 colorPrimary 取值必然变化；antd token 的实际消费逻辑
// （ConfigProvider theme.token 逐键接线）由 task-15 集成验收覆盖。

import { beforeEach, describe, expect, it, vi } from "vitest";

import { useThemeStore } from "@/stores/theme";
import { DEFAULT_THEME, themes } from "@/styles/themes";

// 与 stores/theme.ts persist name 一致
const STORAGE_KEY = "sillyhub-theme";

describe("task-14: 主题偏好 store（useThemeStore）", () => {
  beforeEach(() => {
    // zustand 全局单例：先清持久化层，再把 theme 重置回默认，隔离跨用例污染
    window.localStorage.clear();
    useThemeStore.getState().setTheme(DEFAULT_THEME);
  });

  it("初始 theme === DEFAULT_THEME（ai-native）", () => {
    expect(useThemeStore.getState().theme).toBe(DEFAULT_THEME);
    expect(useThemeStore.getState().theme).toBe("ai-native");
  });

  it("setTheme 在 blue 与 ai-native 间切换，getState().theme 正确", () => {
    useThemeStore.getState().setTheme("blue");
    expect(useThemeStore.getState().theme).toBe("blue");
    useThemeStore.getState().setTheme("ai-native");
    expect(useThemeStore.getState().theme).toBe("ai-native");
    useThemeStore.getState().setTheme("blue");
    expect(useThemeStore.getState().theme).toBe("blue");
  });

  it("persist：setTheme 后 sillyhub-theme 写入 JSON 解析含当前 theme", () => {
    useThemeStore.getState().setTheme("blue");
    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    // zustand persist 包装结构：{ state: <partialize 结果>, version }
    const persisted = JSON.parse(raw ?? "{}") as {
      state?: Record<string, unknown>;
      version?: number;
    };
    expect(persisted.state?.["theme"]).toBe("blue");
    // partialize 契约（D-102@v1）：state 恰只持久化 theme 字段
    expect(Object.keys(persisted.state ?? {}).sort()).toEqual(["theme"]);
  });

  it("非法持久化值兜底：预写 dark 脏值后重建 store 回退 ai-native", async () => {
    // 预写非法持久化值（模拟用户手动写入 "dark"，design §9 兜底场景）
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { theme: "dark" }, version: 0 }),
    );
    const pre = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "{}",
    ) as { state?: { theme?: string } };
    expect(pre.state?.theme).toBe("dark");

    // 重建 store：重置模块注册表后动态 import，persist 建店时读取脏值经 merge 兜底
    vi.resetModules();
    const { useThemeStore: freshStore } = await import("@/stores/theme");
    expect(freshStore.getState().theme).toBe("ai-native");
    expect(freshStore.getState().theme).toBe(DEFAULT_THEME);
  });

  it("antd token 跟随（轻量对照）：两主题 primary 互异且均为合法 hex", () => {
    const bluePrimary = themes.blue.color.primary;
    const aiNativePrimary = themes["ai-native"].color.primary;
    // 两主题主色互异——保证切换主题时 antd colorPrimary 取值必然变化
    expect(bluePrimary).not.toBe(aiNativePrimary);
    // 均为合法 6 位 hex——保证可直接作为 ConfigProvider token 值
    expect(bluePrimary).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(aiNativePrimary).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});
