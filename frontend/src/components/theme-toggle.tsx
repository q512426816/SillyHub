"use client";

import { Palette } from "lucide-react";

import { useThemeStore } from "@/stores/theme";
import { themes } from "@/styles/themes";

/**
 * 顶栏主题切换按钮 (task-07 / FR-02 / D-101@v1)。
 *
 * Palette 图标两态直切:当前 ai-native(AI 紫,默认) → 切 blue(明亮蓝),
 * 当前 blue → 切回 ai-native,不做下拉与第三主题 (design §3 非目标)。
 * 偏好经 useThemeStore 的 setTheme 走 persist 记忆 (localStorage sillyhub-theme),
 * 本组件不直接读写 localStorage;antd token 与 CSS 变量的联动各归
 * antd-providers (task-05) 与 layout 防闪烁 script (task-06)。
 * 按钮沿用顶栏既有图标钮规格 (尺寸/圆角/hover 与通知铃一致),语义类配色不写死蓝。
 */
export function ThemeToggle() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const label = `切换主题（当前：${themes[theme].label}）`;

  return (
    <button
      type="button"
      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
      title={label}
      aria-label={label}
      onClick={() => setTheme(theme === "ai-native" ? "blue" : "ai-native")}
    >
      <Palette className="h-5 w-5" />
    </button>
  );
}
