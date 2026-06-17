import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";

import { AntdProviders } from "@/components/antd-providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Multi-Agent Platform",
  description: "SillySpec-native viewer + multi-agent execution platform.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground">
        <AntdRegistry>
          <AntdProviders>{children}</AntdProviders>
        </AntdRegistry>
      </body>
    </html>
  );
}
