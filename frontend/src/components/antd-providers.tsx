"use client";

import { useEffect, type ReactNode } from "react";
import { App as AntApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";

import { useThemeStore } from "@/stores/theme";
import { themes } from "@/styles/themes";

// 全局 dayjs 中文 locale:antd v5 DatePicker 日历表头(一二三四五六日)/月份名/日期边界
// 均依赖 dayjs 当前 locale,仅 ConfigProvider locale={zhCN} 不够,需在此 dayjs.locale 全局设置。
// 时区沿用浏览器本地(中国用户 UTC+8),日期字段统一以 YYYY-MM-DD 本地字符串存取,无时区错位。
dayjs.locale("zh-cn");

// 非颜色共享维度:radius/font 不随主题变化,不进 themes.ts (design §5 P0),
// 本文件以局部常量写死现值,彻底解除对 tokens.ts 的依赖
// (本文件原是 tokens 的 9 处消费方之一,tokens 删除归 task-08,届时无需再进本文件)。
const RADIUS_MD = 8; // 原 tokens.radius.md
const RADIUS_LG = 12; // 原 tokens.radius.lg
const FONT_SIZE = 14;
const CONTROL_HEIGHT = 32;
const FONT_SANS = 'Inter, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'; // 原 tokens.font.sans

// ConfigProvider theme 全面定制 (task-05 / FR-03 / D-101@v1)
// 颜色全部取自 themes.ts 当前主题 (themes[theme].color),随 useThemeStore 切换即时生效;
// hover 档 (colorPrimaryHover 等) 由 antd 自动派生不手写,严禁散落 hex。
export function AntdProviders({ children }: { children: ReactNode }) {
  const theme = useThemeStore((s) => s.theme);
  const t = themes[theme].color;

  // CSS 变量半边的 React 驱动:同步 html data-theme,使 globals.css 双套变量块
  // 与 antd token 同源切换 (SSR 首帧防闪烁归 task-06 的 layout inline script)。
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          // 主色 + 状态语义色 (D-005;info=各主题 accent 青,D-003@v2)
          colorPrimary: t.primary,
          colorSuccess: t.semantic.success,
          colorWarning: t.semantic.warning,
          colorError: t.semantic.error,
          colorInfo: t.semantic.info,
          // 圆角 / 字号 / 字体
          borderRadius: RADIUS_MD,
          fontSize: FONT_SIZE,
          fontFamily: FONT_SANS,
          // 背景层
          colorBgLayout: t.bg,
          colorBgContainer: t.card,
          // 控件高度 (保守值,不撑破 Table 行高与表单布局)
          controlHeight: CONTROL_HEIGHT,
          wireframe: false,
        },
        components: {
          Table: {
            headerBg: t.slate[100], // 中性表头底,两主题同构
            headerColor: t.slate[600],
            rowHoverBg: t.bg, // blue 主题下=#f8fafc,与旧 tokens.slate[50] 一致
            footerBg: t.slate[100],
            borderColor: t.border,
          },
          Card: {
            borderRadiusLG: RADIUS_LG,
          },
          Modal: {
            borderRadiusLG: RADIUS_LG,
          },
          Tabs: {
            itemActiveColor: t.brand[600], // blue 主题下=旧 blue[600] #2563eb
          },
          Menu: {
            itemSelectedBg: t.brand[50], // blue 主题下=旧 blue[50] #eff6ff
            itemSelectedColor: t.brand[600],
          },
          Button: {
            borderRadius: RADIUS_MD,
            controlHeight: CONTROL_HEIGHT,
          },
        },
      }}
    >
      <AntApp>{children}</AntApp>
    </ConfigProvider>
  );
}
