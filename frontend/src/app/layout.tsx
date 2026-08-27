import type { Metadata, Viewport } from "next";
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
 * 视口基线（quick-a4939946，用户反馈「莫名容易缩放」）：
 * - maximumScale=1 + userScalable=false：禁捏合/双击放大。/m/ 移动段是 app 化 UI
 *   （fixed 外壳 + 自管滚动），意外缩放后 480px 容器与视口错位、手势全乱；桌面
 *   浏览器窗口无 pinch 概念，width=device-width 对其无影响。
 * - interactiveWidget=resizes-content：Android 软键盘弹出压缩视口高而非平移，
 *   fixed 底部输入条/TabBar 才不会被键盘顶飞。
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  interactiveWidget: "resizes-content",
};

/**
 * 防闪烁 inline script (task-06 / FR-02 / FR-03 / D-002@v1, design §10 R-03;
 * 2026-08-23-frontend-dark-theme:合法值加 dark + 无记录跟随系统)。
 *
 * 在首帧渲染前同步直读 localStorage["sillyhub-theme"] 设置 html data-theme,
 * 使 globals.css 三套 CSS 变量块首帧即命中正确主题。此时 store 尚未 hydrate,
 * 不经 useThemeStore;键与 zustand persist 一致,存储格式为
 * {"state":{"theme":"blue"},"version":0}。
 * 三分支口径与 store (stores/theme.ts merge) 成对一致 (D-002@v1 / FR-03):
 *   - 合法记录值 blue / dark 直取记录值;
 *   - 无记录 (null/undefined,从未选择) 读 matchMedia prefers-color-scheme,
 *     系统暗色则 dark,否则默认 ai-native;
 *   - 非法/损坏记录与 matchMedia 异常或不可用一律回落 ai-native (R-06 兜底)。
 * 脚本保持 ES5 写法 (var + function,禁可选链/箭头函数),不经编译直跑浏览器。
 */
const themeInitScript = `(function () {
  var theme = "ai-native";
  try {
    var raw = localStorage.getItem("sillyhub-theme");
    var saved = raw ? JSON.parse(raw) : null;
    var savedTheme = saved && saved.state ? saved.state.theme : null;
    if (savedTheme === "blue" || savedTheme === "dark") {
      theme = savedTheme;
    } else if (savedTheme === null || savedTheme === undefined) {
      if (
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
      ) {
        theme = "dark";
      }
    }
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
