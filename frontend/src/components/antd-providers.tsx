"use client";

import type { ReactNode } from "react";
import { App as AntApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";

export function AntdProviders({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: "#1e3a5f",
          borderRadius: 4,
          fontSize: 13,
        },
        components: {
          Table: {
            headerBg: "#f5f5f5",
            headerColor: "#444",
            rowHoverBg: "#f9fafb",
          },
        },
      }}
    >
      <AntApp>{children}</AntApp>
    </ConfigProvider>
  );
}
