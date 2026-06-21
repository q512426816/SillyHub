import localFont from "next/font/local";

/**
 * Inter 自托管字体。
 *
 * 使用 `next/font/local` 加载 `@fontsource/inter` 自带的 woff2,
 * 构建期不发起任何外网请求(规避 Docker 构建代理无法访问 Google Fonts)。
 *
 * - 暴露 CSS 变量 `--font-inter`,由 globals.css / antd ConfigProvider 消费(task-03 / task-04)。
 * - `fallback` 显式给出中英文系统字体栈,Inter 加载失败时自动降级。
 *
 * 见 task-02(D-004@v2):禁用 Google Fonts 在线加载,全部走本地 woff2。
 */
export const inter = localFont({
  src: [
    {
      path: "../../node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../node_modules/@fontsource/inter/files/inter-latin-500-normal.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../../node_modules/@fontsource/inter/files/inter-latin-600-normal.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "../../node_modules/@fontsource/inter/files/inter-latin-700-normal.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-inter",
  display: "swap",
  preload: true,
  fallback: [
    "PingFang SC",
    "Source Han Sans CN",
    "Microsoft YaHei",
    "system-ui",
    "sans-serif",
  ],
});
