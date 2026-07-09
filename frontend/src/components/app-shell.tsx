"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Boxes,
  ClipboardList,
  Circle,
  Clock,
  ChevronsLeft,
  ChevronsRight,
  Cog,
  FileText,
  Flag,
  Folder,
  GitBranch,
  Home,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  ListTodo,
  LogOut,
  type LucideIcon,
  Network,
  Package,
  ScrollText,
  Settings,
  ShieldCheck,
  Siren,
  Terminal,
  Users,
  Workflow,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { LogoutConfirmDialog } from "@/components/logout-confirm-dialog";
import { TopBar } from "@/components/top-bar";
import {
  MENU_SECTION_LABEL as SECTION_LABEL,
  MENU_SECTION_ORDER as SECTION_ORDER,
  type MenuPermissionGroup,
} from "@/lib/menu-permissions";
import { useSession } from "@/stores/session";
import { ensureFreshAccessToken, decodeJwtExp } from "@/lib/token-refresh";
import { visibleMenusBySection } from "@/lib/permission";
// task-10：复用 task-04 的 useWorkspaceContext（URL 派生真相源 + 旁路写 store 缓存）。
// workspaceId 仍由内部 URL 正则 ^/workspaces/([^/]+) 解析（与原本地实现逐字一致），
// 进入工作区时经 hook 内 effect 写 workspace store 缓存（FR-01），app-shell 自身渲染无感。
import { useWorkspaceContext } from "@/lib/use-workspace-context";

/**
 * 菜单图标映射表：key 用 menu.href 的标识段。
 * 命中渲染对应 lucide 图标，未命中 fallback Circle。
 * 新增/改菜单图标只改这一处。
 */
const MENU_ICON_MAP: Record<string, LucideIcon> = {
  // overview / management（相对 href，workspace 前缀）
  components: Boxes,
  "components/topology": Network,
  changes: GitBranch,
  "scan-docs": FileText,
  runtime: Activity,
  knowledge: ScrollText,
  releases: Package,
  "git-identities": KeyRound,
  "api-keys": Cog,
  agent: Terminal,
  missions: Workflow,
  approvals: ShieldCheck,
  audit: ScrollText,
  incidents: Siren,
  // admin / system（absolute href）
  "/admin/users": Users,
  "/admin/organizations": Folder,
  "/admin/roles": KeyRound,
  "/runtimes": Activity,
  "/settings": Settings,
  "/workspaces": Home,
  // ppm（absolute href /ppm/*）
  "/ppm/projects": ClipboardList,
  "/ppm/customers": Users,
  "/ppm/project-members": Users,
  "/ppm/project-stakeholders": Users,
  "/ppm/project-plans": ClipboardList,
  "/ppm/plan-nodes": ListChecks,
  "/ppm/milestone-details": Flag,
  "/ppm/problem-list": AlertTriangle,
  "/ppm/problem-changes": GitBranch,
  "/ppm/task-plans": ListTodo,
  "/ppm/work-hours": Clock,
  "/ppm/work-hour-statistics": BarChart3,
  "/ppm/kanban": LayoutDashboard,
};

const FallbackIcon = Circle;

function resolveMenuIcon(menu: MenuPermissionGroup): LucideIcon {
  return MENU_ICON_MAP[menu.href] ?? FallbackIcon;
}

const COLLAPSED_KEY = "sidebar-collapsed";

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  // task-10：workspaceId 改由 useWorkspaceContext 提供（task-04）。
  // 变量名/类型（string | null）不变，下游 resolveHref/isActive/renderNavLink 全部无感。
  // 进入工作区时 hook 内 effect 顺带写 workspace store 缓存（FR-01），app-shell 不直接操作 store。
  const { workspaceId } = useWorkspaceContext();
  const { user, accessToken, refreshToken, clear } = useSession();

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      const stored = localStorage.getItem(COLLAPSED_KEY);
      return stored === "true";
    } catch {
      return false;
    }
  });

  // 退出二次确认弹窗状态（ql-20260623-003-7c2e）：两处退出入口统一请求打开本弹窗。
  const [logoutOpen, setLogoutOpen] = useState(false);

  // 当前平台：/ppm 前缀=项目管理平台，否则=SillyHub。用于侧边栏 Brand 区平台名称展示，
  // 与 TopBar 切换平台 / 菜单 section 隔离保持一致。
  const inPpm = pathname.startsWith("/ppm");
  const platformName = inPpm ? "项目管理平台" : "SillyHub";

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, String(collapsed));
    } catch {
      // ignore storage errors
    }
  }, [collapsed]);

  /**
   * 主动刷新定时器(D-004@v1 / FR-06):
   * 每 60s tick 一次,读当前 accessToken,解析 exp/iat;
   * 若剩余有效期 < 1/3 TTL(30min TTL → 约 10min)则调单飞锁 ensureFreshAccessToken() 续期。
   * - token 缺失 / decode 失败:静默跳过(不抛、不跳转)。
   * - ensureFreshAccessToken 失败:catch 吞掉(401 由 api 层处理,主动刷新不负责登录态清理)。
   * 依赖数组空:只在挂载时启定时器;tick 内用 getState() 读最新 token,避免闭包旧值。
   */
  useEffect(() => {
    const REFRESH_INTERVAL_MS = 60_000; // 每分钟校验一次

    const timer = setInterval(() => {
      const { accessToken } = useSession.getState();
      // 未登录 / 已登出:无 token 可续,静默跳过。
      if (!accessToken) return;

      const claims = decodeJwtExp(accessToken);
      // token 非 JWT / 损坏 / 缺 exp|iat:静默跳过(decodeJwtExp 返回 null 不抛)。
      if (!claims) return;

      const now = Math.floor(Date.now() / 1000); // 秒级,与 JWT exp/iat 对齐
      const ttl = claims.exp - claims.iat; // token 总有效期(秒)
      const remain = claims.exp - now; // 剩余有效期(秒)

      // remain < ttl/3:剩余不足 1/3 TTL → 触发主动续期。
      // (30min TTL → 约 10min;15min TTL → 约 5min;完全由 token 自带 exp/iat 推算,不硬编码)
      if (remain > 0 && remain < ttl / 3) {
        // 复用单飞锁:与 task-08 的 401 被动刷新共享 inflight,不会并发发起两次 refresh。
        // 失败静默吞掉 —— 主动刷新不负责 clear()/跳转 /login,那是 api 层 401 分支的职责。
        ensureFreshAccessToken().catch(() => {
          /* 静默:刷新失败不跳转,等真正 401 时由 api 层处理 */
        });
      }
    }, REFRESH_INTERVAL_MS);

    // 组件卸载时清掉定时器,避免泄漏 / 卸载后仍发请求。
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 空依赖:只在挂载时启一次;token 变化靠 getState() 动态读取

  const toggleCollapsed = () => setCollapsed((prev) => !prev);

  const displayName = useMemo(() => {
    if (!user) return "用户";
    return user.displayName || user.email;
  }, [user]);

  const resolveHref = (menu: MenuPermissionGroup) =>
    menu.absolute
      ? menu.href
      : workspaceId
        ? `/workspaces/${workspaceId}/${menu.href}`
        : "/workspaces";

  const isActive = (menu: MenuPermissionGroup) => {
    if (menu.absolute) {
      if (menu.href === "/workspaces") return pathname === "/workspaces";
      if (menu.matchPattern) return pathname.startsWith(menu.matchPattern);
      return pathname === menu.href;
    }
    if (!workspaceId) return false;
    if (menu.matchPattern) return pathname.includes(menu.matchPattern);
    const full = `/workspaces/${workspaceId}/${menu.href}`;
    return pathname === full || pathname.startsWith(full + "/");
  };

  // 用户点退出（TopBar 菜单 / 侧边栏底部）→ 先弹确认，确认后才执行真正登出。
  const requestLogout = () => setLogoutOpen(true);

  const performLogout = async () => {
    setLogoutOpen(false);
    try {
      if (refreshToken) {
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            Authorization: accessToken ? `Bearer ${accessToken}` : "",
          },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
      }
    } finally {
      clear();
      router.replace("/login");
    }
  };

  const renderNavLink = (menu: MenuPermissionGroup) => {
    const hasWorkspace = !!workspaceId || menu.absolute;
    const active = isActive(menu);
    const href = resolveHref(menu);
    const Icon = resolveMenuIcon(menu);

    const base =
      "flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium transition-colors";
    const classes = hasWorkspace
      ? `${base} ${
          active
            ? "relative bg-blue-50 text-blue-700"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        }`
      : `${base} text-muted-foreground/40 cursor-not-allowed`;

    const indicator = active ? (
      <span
        className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-blue-600"
        aria-hidden
      />
    ) : null;

    const icon = (
      <Icon className="h-[18px] w-[18px] shrink-0" />
    );

    if (!hasWorkspace) {
      return (
        <span key={menu.href} className={classes} title={collapsed ? menu.menuLabel : undefined}>
          {indicator}
          {icon}
          {!collapsed && <span className="truncate">{menu.menuLabel}</span>}
        </span>
      );
    }

    return (
      <Link key={menu.href} href={href} className={classes} title={collapsed ? menu.menuLabel : undefined}>
        {indicator}
        {icon}
        {!collapsed && <span className="truncate">{menu.menuLabel}</span>}
      </Link>
    );
  };

  const renderGroupTitle = (title: string) => (
    <div className="px-2 pt-5 pb-1">
      <p
        className={`text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-all duration-200 ${
          collapsed ? "opacity-0 h-0 overflow-hidden" : "opacity-100"
        }`}
      >
        {title}
      </p>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex flex-col border-r bg-card transition-all duration-200 ${
          collapsed ? "w-[60px]" : "w-[260px]"
        }`}
      >
        {/* Brand：项目 LOGO（public/logo.png，含 SILLYHUB 文字） */}
        <div
          className={`border-b flex items-center gap-2 py-4 transition-all duration-200 ${
            collapsed ? "justify-center px-2" : "px-5"
          }`}
        >
          <Link
            href={inPpm ? "/ppm" : "/workspaces"}
            className="flex items-center overflow-hidden transition-all duration-200 hover:opacity-80"
            title={platformName}
          >
            <Image
              src="/logo.png"
              alt={platformName}
              width={690}
              height={788}
              priority
              className={collapsed ? "h-8 w-auto" : "h-9 w-auto"}
            />
          </Link>
          {!collapsed && (
            <span
              className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${
                inPpm
                  ? "bg-violet-50 text-violet-700"
                  : "bg-blue-50 text-blue-700"
              }`}
            >
              {platformName}
            </span>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 pt-2 pb-4">
          {SECTION_ORDER.filter((section) => {
            // 菜单隔离：进入 /ppm/* 只渲染 ppm section，
            // 其它路径只渲染非 ppm section（overview/management/admin/system）。
            // 设计依据：用户要求 ppm 与主平台菜单完全隔离、互不可见。
            const inPpm = pathname.startsWith("/ppm");
            return inPpm ? section === "ppm" : section !== "ppm";
          }).map((section) => {
            const menus = visibleMenusBySection(user, section);
            if (menus.length === 0) return null;
            return (
              <Fragment key={section}>
                {renderGroupTitle(SECTION_LABEL[section])}
                {menus.map((menu) => renderNavLink(menu))}
              </Fragment>
            );
          })}
        </nav>

        {/* User section at bottom */}
        <div className="border-t px-4 py-3">
          <div className="flex items-center justify-between">
            <span
              className={`truncate text-xs text-muted-foreground transition-all duration-200 ${
                collapsed ? "opacity-0 w-0 overflow-hidden" : "opacity-100"
              }`}
            >
              {displayName}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={requestLogout}
              title="退出登录"
              className="shrink-0 gap-1.5"
            >
              <LogOut className="h-4 w-4" />
              {!collapsed && <span>退出</span>}
            </Button>
          </div>
        </div>

        {/* Collapse toggle */}
        <button
          onClick={toggleCollapsed}
          className="flex items-center justify-center border-t py-2.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          title={collapsed ? "展开侧边栏" : "收缩侧边栏"}
          aria-label={collapsed ? "展开侧边栏" : "收缩侧边栏"}
        >
          {collapsed ? (
            <ChevronsRight className="h-4 w-4" />
          ) : (
            <ChevronsLeft className="h-4 w-4" />
          )}
        </button>
      </aside>

      {/* Main content */}
      <div
        className={`flex min-w-0 flex-1 flex-col transition-all duration-200 ${
          collapsed ? "ml-[60px]" : "ml-[260px]"
        }`}
      >
        <TopBar onLogout={requestLogout} displayName={displayName} />
        <div className="min-w-0 flex-1">{children}</div>
        <LogoutConfirmDialog
          open={logoutOpen}
          onOpenChange={setLogoutOpen}
          onConfirm={performLogout}
        />
      </div>
    </div>
  );
}
