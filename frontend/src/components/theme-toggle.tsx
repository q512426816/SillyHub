"use client";

import { Dropdown, type MenuProps } from "antd";
import { Palette } from "lucide-react";

import { useThemeStore } from "@/stores/theme";
import { themes, type ThemeName } from "@/styles/themes";

// 菜单展示顺序:默认主题 ai-native 打头,再 blue、dark (task-07)。
// 此处仅固定顺序;主题数据(名称/文案/色值)仍由 themes 注册表派生,
// 不硬编码第三处主题清单。
const THEME_MENU_ORDER: ThemeName[] = ["ai-native", "blue", "dark"];

/**
 * 顶栏主题切换按钮 (task-07 / FR-02 / D-001@v1,变更 2026-08-23-frontend-dark-theme)。
 *
 * Palette 图标点击弹出 antd Dropdown 三选一菜单 (AI 紫 / 明亮蓝 / 暗夜 三主题并列,
 * 替代原二态直切;不做 blue 暗色版等第四主题,design §3 非目标):
 * - items 由 themes 注册表派生 (label 取 themes[name].label,色板小方块为
 *   primary→accent 渐变),当前主题项经 selectable + selectedKeys 高亮;
 * - 点击菜单项 setTheme(name) 即时全站换肤 (antd token 与 CSS 变量半边走既有
 *   联动:antd-providers task-06 / layout 防闪烁 script task-05),Dropdown 随之关闭;
 * - 偏好经 useThemeStore 的 setTheme 走 persist 记忆 (localStorage sillyhub-theme),
 *   本组件不直接读写 localStorage。
 * 触发器沿用顶栏既有图标钮规格 (尺寸/圆角/hover 与通知铃一致),语义类配色不写死蓝。
 */
export function ThemeToggle() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const label = `切换主题（当前：${themes[theme].label}）`;

  // 菜单项查表生成:key 即主题名,点击后经 menu onClick 统一 setTheme
  const items: MenuProps["items"] = THEME_MENU_ORDER.map((name) => ({
    key: name,
    label: (
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className="h-3.5 w-3.5 shrink-0 rounded-[4px] border border-slate-300"
          style={{
            background: `linear-gradient(135deg, ${themes[name].color.primary}, ${themes[name].color.accent})`,
          }}
        />
        {themes[name].label}
      </span>
    ),
  }));

  return (
    <Dropdown
      menu={{
        items,
        selectable: true,
        selectedKeys: [theme],
        // 点击即换肤,antd 点击菜单项后自动收起下拉
        onClick: ({ key }) => setTheme(key as ThemeName),
      }}
      trigger={["click"]}
    >
      <button
        type="button"
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
      >
        <Palette className="h-5 w-5" />
      </button>
    </Dropdown>
  );
}
