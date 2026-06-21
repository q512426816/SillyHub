import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";

import { AntdProviders } from "@/components/antd-providers";
import { inter } from "@/styles/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "SillyHub",
  description: "SillySpec 原生查看器 + 多智能体执行平台。",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body
        className={`${inter.className} min-h-screen bg-background text-foreground`}
      >
        <AntdRegistry>
          <AntdProviders>{children}</AntdProviders>
        </AntdRegistry>
      </body>
    </html>
  );
}
