"use client";

import type { ReactNode } from "react";

import { MobileTabBar, type TabKey } from "./mobile-tab-bar";
import { MobileTopBar } from "./mobile-top-bar";

/**
 * 移动端 App 外壳（design §5.2）：三段式 = 移动顶栏 + 内容区 + 固定底部 TabBar。
 *
 * - 独立于桌面 app-shell.tsx（D-001 独立移动 App UI），不引入桌面侧边栏 / 折叠 /
 *   localStorage；桌面零回归。
 * - 内容区 flex-1 overflow-auto，自带滚动；底部留 pb 避让固定 TabBar。
 * - 正文 ≥ 14px（R-04）：main 显式 text-[14px]（与 globals.css body 14px 对齐）。
 * - 移动容器：h-[100dvh]（动态视口，兼容移动浏览器地址栏伸缩）+ max-w-[480px] 居中
 *   （/m/ 仅手机访问，宽屏上限避免拉伸）。
 * - 守卫不在本组件（守卫在 app/m/layout，属另一任务）。
 */
export interface MobileAppShellProps {
  children: ReactNode;
  /** 可选：受控高亮底部 Tab（透传给 MobileTabBar）。不传则按当前路由自动高亮。 */
  activeTab?: TabKey;
  /** 可选：顶栏标题（透传给 MobileTopBar）。 */
  title?: string;
  /** 可选：传入则顶栏渲染返回箭头并以此回调（透传给 MobileTopBar）。 */
  onBack?: () => void;
}

export function MobileAppShell({
  children,
  activeTab,
  title,
  onBack,
}: MobileAppShellProps) {
  return (
    <div className="mx-auto flex h-[100dvh] w-full max-w-[480px] flex-col bg-background">
      <MobileTopBar title={title} onBack={onBack} />
      <main className="min-w-0 flex-1 overflow-y-auto px-4 py-3 pb-20 text-[14px] text-foreground">
        {children}
      </main>
      <MobileTabBar activeTab={activeTab} />
    </div>
  );
}
