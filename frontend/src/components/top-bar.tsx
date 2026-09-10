"use client";

import { usePathname, useRouter } from "next/navigation";
import { ArrowLeftRight, ChevronRight, LogOut, Search, UserRound } from "lucide-react";

import { NotificationBell } from "@/components/notifications/notification-bell";
import { ThemeToggle } from "@/components/theme-toggle";
// task-09（2026-09-10-account-avatar-upload / FR-05）：平台头像 src 解析
// （文件中心 URL 带 token 取 blob / 外链直用 / 空回退首字），与 ChatMessageAvatar 同源。
import { useAvatarSrc } from "@/components/chat/use-avatar-src";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";

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
  /**
   * task-09（2026-09-10-account-avatar-upload / FR-05）：平台头像 URL
   * （文件中心 /api/file/{id} 或 http 外链）。可选——不传/为 null 行为与现状
   * 一致（AvatarFallback 首字回退，既有调用方零改动）。
   */
  avatar?: string | null;
}

export function TopBar({ displayName, onLogout, avatar }: TopBarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const crumbs = buildBreadcrumbs(pathname);
  const initial = (displayName?.trim()?.[0] ?? "?").toUpperCase();
  const { label: switchLabel, href: switchHref } = resolvePlatformSwitch(pathname);
  // task-09（FR-05）：头像 src 解析走 useAvatarSrc 共享管线——文件中心 URL 带
  // token 取 blob、外链直用、空/拉取失败为 null（Radix src 为空自动走 Fallback）。
  const avatarSrc = useAvatarSrc(avatar);

  return (
    /* 2026-09-09-sessions-visual-refresh task-09（FR-02/D-008@v1）：玻璃顶栏——
       bg-card 改半透 + backdrop-blur + saturate（壳层极光从下方穿过，sticky
       h-16 契约不动）。 */
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-4 border-b border-border/60 bg-card/60 px-4 shadow-sm backdrop-blur-xl backdrop-saturate-150">
      {/* task-09：工作区切换器（当前 ws 名 + daemon 徽标），顶栏最左侧锚点。
          ql-20260711-002：/ppm 下不渲染——PPM 不依赖工作区（页面/API 全走 /api/ppm/...、
          导航全 absolute），避免顶栏常驻「选择工作区」引导态误导用户以为必须先选工作区。 */}
      {!pathname.startsWith("/ppm") && (
        <div className="flex shrink-0 items-center pr-2">
          <WorkspaceSwitcher />
        </div>
      )}

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
            className="w-[240px] rounded-md border border-transparent bg-slate-100 py-1.5 pl-8 pr-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand-400 focus:bg-card focus:outline-none"
            aria-label="全局搜索"
          />
        </div>

        {/* task-11 / FR-09：通知铃铛（Badge 未读数 + Popover 下拉面板 + SSE 实时），
            替换原静态 Bell 占位按钮。 */}
        <NotificationBell />

        {/* task-07 / FR-02：主题切换（AI 紫 ↔ 明亮蓝 两态直切，经 store persist 记忆） */}
        <ThemeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2 rounded-md p-1 transition-colors hover:bg-slate-100"
              aria-label="用户菜单"
            >
              {/* task-09（FR-05）：有头像时渲染图片（src 由 useAvatarSrc 解析）；
                  无图 src 为 undefined，Radix Avatar 自动走下方 AvatarFallback
                  首字分支——既有首字逻辑与类名零改动。 */}
              <Avatar className="h-8 w-8">
                <AvatarImage src={avatarSrc ?? undefined} alt={displayName} />
                <AvatarFallback className="bg-brand-600 text-xs font-medium text-white">
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
            {/* task-08 / FR-08 / AC-09：个人中心入口跳 /account，
                沿用「切换平台」项的 router.push 模式。 */}
            <DropdownMenuItem onClick={() => router.push("/account")}>
              <UserRound className="mr-2 h-4 w-4" />
              个人中心
            </DropdownMenuItem>
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
