"use client";

import type { ReactNode } from "react";
import { App as AntApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import { tokens } from "@/styles/tokens";

// 全局 dayjs 中文 locale:antd v5 DatePicker 日历表头(一二三四五六日)/月份名/日期边界
// 均依赖 dayjs 当前 locale,仅 ConfigProvider locale={zhCN} 不够,需在此 dayjs.locale 全局设置。
// 时区沿用浏览器本地(中国用户 UTC+8),日期字段统一以 YYYY-MM-DD 本地字符串存取,无时区错位。
dayjs.locale("zh-cn");

// ConfigProvider theme 全面定制 (task-03 / FR-01 / D-005@v1)
// 全部色值来自 tokens.ts 单一源,严禁散落 hex。旧深蓝主色已替换为新 primary。
export function AntdProviders({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          // 主色 + 状态语义色 (D-005)
          colorPrimary: tokens.color.primary, // #2563EB
          colorSuccess: tokens.color.semantic.success.color, // #10b981
          colorWarning: tokens.color.semantic.warning.color, // #f59e0b
          colorError: tokens.color.semantic.error.color, // #ef4444
          colorInfo: tokens.color.semantic.info.color, // #2563eb
          // 圆角 / 字号 / 字体
          borderRadius: tokens.radius.md, // 8
          fontSize: 14,
          fontFamily: tokens.font.sans,
          // 背景层
          colorBgLayout: tokens.color.bg, // #f8fafc
          colorBgContainer: tokens.color.card, // #ffffff
          // 控件高度 (保守值,不撑破 Table 行高与表单布局)
          controlHeight: 32,
          wireframe: false,
        },
        components: {
          Table: {
            headerBg: tokens.color.slate[100], // #f1f5f9
            headerColor: tokens.color.slate[600], // #475569
            rowHoverBg: tokens.color.slate[50], // #f8fafc
            footerBg: tokens.color.slate[100], // #f1f5f9
            borderColor: tokens.color.border, // #e2e8f0
          },
          Card: {
            borderRadiusLG: tokens.radius.lg, // 12
          },
          Modal: {
            borderRadiusLG: tokens.radius.lg, // 12
          },
          Tabs: {
            itemActiveColor: tokens.color.blue[600], // #2563eb
          },
          Menu: {
            itemSelectedBg: tokens.color.blue[50], // #eff6ff
            itemSelectedColor: tokens.color.blue[600], // #2563eb
          },
          Button: {
            borderRadius: tokens.radius.md, // 8
            controlHeight: 32,
          },
        },
      }}
    >
      <AntApp>{children}</AntApp>
    </ConfigProvider>
  );
}
