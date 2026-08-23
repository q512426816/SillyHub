// stores/theme.test.ts
// task-14 / FR-02 / FR-03 / D-101@v1 / D-102@v1 / D-003@v2：主题偏好 store 单测。
// 2026-08-23-frontend-dark-theme task-10 / FR-03 / D-002@v1：dark 合法路径、
// 无记录跟随 prefers-color-scheme 与 matchMedia 不可用兜底用例。
//
// 依据：
//   - .sillyspec/changes/2026-08-20-frontend-ai-native-style/tasks/task-14.md
//   - .sillyspec/changes/2026-08-23-frontend-dark-theme/tasks/task-10.md
//   - stores/theme.ts（task-04：useThemeStore / persist / merge 兜底；
//     2026-08-23-frontend-dark-theme：无记录跟随系统 + dark 合法值透传）
//   - styles/themes.ts（task-01：themes / DEFAULT_THEME 单一取值源）
//
// 覆盖：
//   1. 初始 theme === DEFAULT_THEME（ai-native）
//   2. setTheme 在 blue / ai-native / dark 间切换，getState().theme 正确
//   3. persist：setTheme 后 window.localStorage["sillyhub-theme"] 写入
//      JSON 解析含当前 theme（partialize 仅持久化 theme 字段，D-102@v1）
//   4. 非法持久化值兜底：dark 已转合法值（2026-08-23-frontend-dark-theme），
//      换用新非法样例（theme="midnight"）预写后 vi.resetModules() + 动态
//      import 重建 store，theme 回退 DEFAULT_THEME（design §9 口径不变）
//   5. 无记录（不预写 localStorage）+ 系统 prefers-color-scheme dark →
//      初始 dark（D-002@v1）；无记录 + matchMedia 不可用 → DEFAULT_THEME
//      （R-06 兜底）
//   6. antd token 跟随（轻量对照）：两主题 color.primary 互异且均为合法 hex
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

  it("setTheme 在 blue / ai-native / dark 间切换，getState().theme 正确", () => {
    useThemeStore.getState().setTheme("blue");
    expect(useThemeStore.getState().theme).toBe("blue");
    useThemeStore.getState().setTheme("ai-native");
    expect(useThemeStore.getState().theme).toBe("ai-native");
    useThemeStore.getState().setTheme("blue");
    expect(useThemeStore.getState().theme).toBe("blue");
    // dark 已转合法值（2026-08-23-frontend-dark-theme），补切换路径
    useThemeStore.getState().setTheme("dark");
    expect(useThemeStore.getState().theme).toBe("dark");
    useThemeStore.getState().setTheme("ai-native");
    expect(useThemeStore.getState().theme).toBe("ai-native");
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

    // dark 合法路径（2026-08-23-frontend-dark-theme）：切 dark 后 JSON 含 dark
    useThemeStore.getState().setTheme("dark");
    const darkRaw = window.localStorage.getItem(STORAGE_KEY);
    expect(darkRaw).not.toBeNull();
    const darkPersisted = JSON.parse(darkRaw ?? "{}") as {
      state?: Record<string, unknown>;
      version?: number;
    };
    expect(darkPersisted.state?.["theme"]).toBe("dark");
    expect(Object.keys(darkPersisted.state ?? {}).sort()).toEqual(["theme"]);
  });

  it("非法持久化值兜底：预写 midnight 脏值后重建 store 回退 ai-native", async () => {
    // 预写非法持久化值（模拟用户手动写入 "midnight"，design §9 兜底场景）。
    // 注：dark 已随 2026-08-23-frontend-dark-theme 转为合法值，不再作脏值样例
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { theme: "midnight" }, version: 0 }),
    );
    const pre = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "{}",
    ) as { state?: { theme?: string } };
    expect(pre.state?.theme).toBe("midnight");

    // 重建 store：重置模块注册表后动态 import，persist 建店时读取脏值经 merge 兜底
    vi.resetModules();
    const { useThemeStore: freshStore } = await import("@/stores/theme");
    expect(freshStore.getState().theme).toBe("ai-native");
    expect(freshStore.getState().theme).toBe(DEFAULT_THEME);
  });

  it("无记录 + 系统 prefers-color-scheme dark → 初始主题 dark（D-002@v1）", async () => {
    // 不预写 sillyhub-theme（用户从未选择过），merge 走 matchMedia 跟随系统分支
    window.localStorage.removeItem(STORAGE_KEY);
    // jsdom 的 window.matchMedia 恒为 matches:false，这里 mock 命中系统暗色
    const matchMediaSpy = vi
      .spyOn(window, "matchMedia")
      .mockReturnValue({
        matches: true,
        media: "(prefers-color-scheme: dark)",
      } as unknown as MediaQueryList);
    try {
      vi.resetModules();
      const { useThemeStore: freshStore } = await import("@/stores/theme");
      expect(freshStore.getState().theme).toBe("dark");
      // 查询串锁定：与 app/layout.tsx 防闪烁脚本口径成对一致
      expect(matchMediaSpy).toHaveBeenCalledWith(
        "(prefers-color-scheme: dark)",
      );
    } finally {
      matchMediaSpy.mockRestore();
    }
  });

  it("无记录 + matchMedia 不可用 → 回退 DEFAULT_THEME（R-06 兜底）", async () => {
    // 不预写 sillyhub-theme，且把 window.matchMedia 置空模拟不可用
    // （jsdom 自带 matchMedia，须直接在 window 上遮蔽；merge 的可选链不触发）
    window.localStorage.removeItem(STORAGE_KEY);
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = undefined as unknown as typeof window.matchMedia;
    try {
      vi.resetModules();
      const { useThemeStore: freshStore } = await import("@/stores/theme");
      expect(freshStore.getState().theme).toBe(DEFAULT_THEME);
      expect(freshStore.getState().theme).toBe("ai-native");
    } finally {
      window.matchMedia = originalMatchMedia;
    }
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
