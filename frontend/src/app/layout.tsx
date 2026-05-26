import type { Metadata } from "next";

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
      <body className="min-h-screen bg-background text-foreground">{children}</body>
    </html>
  );
}
