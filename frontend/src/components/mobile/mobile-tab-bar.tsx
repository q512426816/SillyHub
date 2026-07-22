"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeftRight,
  LayoutDashboard,
  ListTodo,
  UserRound,
  type LucideIcon,
} from "lucide-react";

/**
 * 移动端底部 5 Tab 导航（design §5.4 / D-004 / FR-02）。
 *
 * 关键约束：
 * - 链接一律用**原始路径**（/ppm/*、/workspaces、/account），手机访问由 task-01
 *   middleware 服务端 rewrite 到 /m/ 段（URL 不变、无 FOUC）。本组件不感知 /m/。
 * - 当前项高亮用 `usePathname()` 前缀匹配（与桌面侧 isActive 语义一致）；也支持
 *   外部 `activeTab` 受控覆盖（页面级精确指定时优先）。
 * - 触摸热区 ≥ 44×44px（R-04）：每个 Link `min-h/min-w-[44px]` + flex-1 撑满。
 * - 不复用 / 不依赖桌面 app-shell / 折叠 / localStorage（D-001 独立移动 UI）。
 */

/** 底部 5 Tab 的 key（受控高亮 / 测试引用）。顺序即渲染顺序。 */
export type TabKey =
  | "workbench"
  | "task-plans"
  | "problem-list"
  | "mine"
  | "switch";

export interface MobileTab {
  key: TabKey;
  /** 中文文案（导航微标签，非正文） */
  label: string;
  /** 原始路径：手机访问由 task-01 middleware rewrite 到 /m/ */
  href: string;
  /** 高亮前缀匹配依据（usePathman startsWith） */
  matchPrefix: string;
  icon: LucideIcon;
}

/**
 * 底部 5 Tab 配置（单一数据源）。
 * 图标沿用桌面 MENU_ICON_MAP 同语义项：工作台=LayoutDashboard、计划任务=ListTodo、
 * 问题清单=AlertTriangle、我的=UserRound（个人中心）、平台切换=ArrowLeftRight。
 */
export const MOBILE_TABS: MobileTab[] = [
  {
    key: "workbench",
    label: "工作台",
    href: "/ppm/workbench",
    matchPrefix: "/ppm/workbench",
    icon: LayoutDashboard,
  },
  {
    key: "task-plans",
    label: "计划任务",
    href: "/ppm/task-plans",
    matchPrefix: "/ppm/task-plans",
    icon: ListTodo,
  },
  {
    key: "problem-list",
    label: "问题清单",
    href: "/ppm/problem-list",
    matchPrefix: "/ppm/problem-list",
    icon: AlertTriangle,
  },
  {
    key: "mine",
    label: "我的",
    href: "/account",
    matchPrefix: "/account",
    icon: UserRound,
  },
  {
    key: "switch",
    label: "平台切换",
    href: "/workspaces",
    matchPrefix: "/workspaces",
    icon: ArrowLeftRight,
  },
];

/**
 * 判断指定 tab 是否高亮（前缀匹配，与桌面 isActive 同语义）。
 * 抽成纯函数便于单测，避免依赖 usePathname 的渲染时机。
 */
export function isTabActive(tab: MobileTab, pathname: string): boolean {
  return (
    pathname === tab.matchPrefix ||
    pathname.startsWith(tab.matchPrefix + "/")
  );
}

export interface MobileTabBarProps {
  /**
   * 可选：外部受控高亮。传入时覆盖 usePathname 推断（用于页面级显式指定当前 Tab，
   * 例如详情页想保持父级 Tab 高亮）。不传则按当前路由自动高亮。
   */
  activeTab?: TabKey;
}

export function MobileTabBar({ activeTab }: MobileTabBarProps) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="移动端主导航"
      data-testid="mobile-tab-bar"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] shadow-[var(--shadow-lg)]"
    >
      <ul className="mx-auto flex w-full max-w-[480px] items-stretch">
        {MOBILE_TABS.map((tab) => {
          const active = activeTab ? activeTab === tab.key : isTabActive(tab, pathname);
          const Icon = tab.icon;
          return (
            <li key={tab.key} className="flex flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                data-active={active ? "true" : "false"}
                data-tab-key={tab.key}
                className={[
                  "flex min-h-[44px] min-w-[44px] flex-1 flex-col items-center justify-center gap-0.5 py-1.5 transition-colors",
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                <Icon className="h-5 w-5 shrink-0" aria-hidden />
                <span className="text-[12px] leading-none">{tab.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
