"use client";

import { usePathname, useRouter } from "next/navigation";
import { ArrowLeftRight, Bell, ChevronRight, LogOut, Search } from "lucide-react";

import {
  Avatar,
  AvatarFallback,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * 面包屑段名映射：pathname split 后的段值 → 中文标签。
 * 仅做常见段降级，未命中直接显示原段值，不报错不阻断。
 */
const SEGMENT_LABEL: Record<string, string> = {
  workspaces: "工作区",
  ppm: "项目管理",
  admin: "系统管理",
  settings: "设置",
  runtimes: "运行时",
  users: "用户",
  organizations: "组织",
  roles: "角色",
  projects: "项目",
  customers: "客户",
  "project-members": "项目成员",
  "project-stakeholders": "干系人",
  "project-plans": "项目计划",
  "plan-nodes": "计划节点",
  "milestone-details": "里程碑明细",
  "problem-list": "问题清单",
  "problem-changes": "问题变更",
  "task-plans": "任务计划",
  "work-hours": "工时",
  "work-hour-statistics": "工时统计",
  kanban: "看板",
};

function buildBreadcrumbs(pathname: string): string[] {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return ["首页"];

  // /workspaces/:id/... → 用 [工作区, 页面标签...] 避免显示 id 段
  if (segments[0] === "workspaces" && segments.length >= 2) {
    const rest = segments.slice(2).map((s) => SEGMENT_LABEL[s] ?? s);
    return ["工作区", ...rest];
  }

  return segments.map((s) => SEGMENT_LABEL[s] ?? s);
}

/**
 * ql-20260623-003-7c2e：解析当前平台，给出「切换平台」菜单项的文案与目标路径。
 *
 * 平台判断与 app-shell 菜单隔离一致：pathname 以 /ppm 开头 = 项目管理平台，
 * 否则 = SillyHub（主平台）。当前在 ppm → 提示切回 SillyHub；否则 → 提示切到项目管理平台。
 * 抽成纯函数便于单测（不依赖 radix DropdownMenu 的渲染时机）。
 */
export function resolvePlatformSwitch(pathname: string): {
  label: string;
  href: string;
} {
  const inPpm = pathname.startsWith("/ppm");
  return inPpm
    ? { label: "切换到 SillyHub", href: "/workspaces" }
    : { label: "切换到项目管理平台", href: "/ppm" };
}

export interface TopBarProps {
  displayName: string;
  onLogout: () => void;
}

export function TopBar({ displayName, onLogout }: TopBarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const crumbs = buildBreadcrumbs(pathname);
  const initial = (displayName?.trim()?.[0] ?? "?").toUpperCase();
  const { label: switchLabel, href: switchHref } = resolvePlatformSwitch(pathname);

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-slate-200 bg-white px-4 shadow-sm">
      {/* 面包屑 */}
      <nav className="flex min-w-0 flex-1 items-center gap-1 text-sm">
        {crumbs.map((label, idx) => {
          const isLast = idx === crumbs.length - 1;
          return (
            <span key={`${label}-${idx}`} className="flex items-center gap-1">
              {idx > 0 && (
                <ChevronRight className="h-3.5 w-3.5 text-slate-400" aria-hidden />
              )}
              <span
                className={
                  isLast
                    ? "truncate font-medium text-slate-800"
                    : "truncate text-slate-500"
                }
              >
                {label}
              </span>
            </span>
          );
        })}
      </nav>

      {/* 右侧：搜索 + 通知 + 用户 */}
      <div className="flex shrink-0 items-center gap-3">
        <div className="relative hidden sm:block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            placeholder="搜索..."
            className="w-[240px] rounded-md border border-transparent bg-slate-100 py-1.5 pl-8 pr-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:outline-none"
            aria-label="全局搜索"
          />
        </div>

        <button
          type="button"
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
          aria-label="通知"
        >
          <Bell className="h-5 w-5" />
          <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-red-500" />
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2 rounded-md p-1 transition-colors hover:bg-slate-100"
              aria-label="用户菜单"
            >
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-blue-600 text-xs font-medium text-white">
                  {initial}
                </AvatarFallback>
              </Avatar>
              <span className="hidden max-w-[120px] truncate text-sm text-slate-700 md:inline">
                {displayName}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel className="truncate">{displayName}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>个人设置</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push(switchHref)}>
              <ArrowLeftRight className="mr-2 h-4 w-4" />
              {switchLabel}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onLogout}>
              <LogOut className="mr-2 h-4 w-4" />
              退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
