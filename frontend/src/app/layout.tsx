import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";

import { AntdProviders } from "@/components/antd-providers";
import { AppProviders } from "@/lib/providers";
import { inter } from "@/styles/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "SillyHub",
  description: "SillySpec 原生查看器 + 多智能体执行平台。",
};

/**
 * 防闪烁 inline script (task-06 / FR-02 / D-102@v1, design §10 R-03)。
 *
 * 在首帧渲染前同步直读 localStorage["sillyhub-theme"] 设置 html data-theme,
 * 使 globals.css 双套 CSS 变量块首帧即命中正确主题。此时 store 尚未 hydrate,
 * 不经 useThemeStore;键与 zustand persist 一致,存储格式为
 * {"state":{"theme":"blue"},"version":0}。
 * 兜底口径与 store (merge) 一致:无值/解析失败/非法值一律回落 ai-native
 * (仅显式 'blue' 视为合法偏好;store 侧其余合法值即 ai-native,结果殊途同归)。
 */
const themeInitScript = `(function () {
  var theme = "ai-native";
  try {
    var raw = localStorage.getItem("sillyhub-theme");
    var saved = raw ? JSON.parse(raw) : null;
    var savedTheme = saved && saved.state ? saved.state.theme : null;
    if (savedTheme === "blue") theme = "blue";
  } catch (e) {
    theme = "ai-native";
  }
  document.documentElement.dataset.theme = theme;
})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* 首帧前同步执行,防 SSR 主题闪烁 (R-03);suppressHydrationWarning 消化 script 副作用 */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body
        className={`${inter.className} min-h-screen bg-background text-foreground`}
      >
        <AntdRegistry>
          <AntdProviders>
            <AppProviders>{children}</AppProviders>
          </AntdProviders>
        </AntdRegistry>
      </body>
    </html>
  );
}
