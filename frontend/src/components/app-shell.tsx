"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { hasAdminPermission } from "@/lib/permission";
import { useSession } from "@/stores/session";

interface NavItem {
  href: string;
  icon: string;
  label: string;
  matchPattern?: string;
  absolute?: boolean;
}

const OVERVIEW_NAV: NavItem[] = [
  { href: "/workspaces", icon: "\u{1F3E0}", label: "Workspace 首页", absolute: true },
  { href: "components", icon: "\u{1F4E6}", label: "项目组组件", matchPattern: "/components" },
  { href: "components/topology", icon: "\u{1F5FA}", label: "拓扑图", matchPattern: "/components/topology" },
  { href: "changes", icon: "\u{1F504}", label: "变更中心", matchPattern: "/changes" },
  { href: "scan-docs", icon: "\u{1F4C4}", label: "扫描文档", matchPattern: "/scan-docs" },
  { href: "runtime", icon: "\u{26A1}", label: "运行时", matchPattern: "/runtime" },
  { href: "knowledge", icon: "\u{1F4DA}", label: "知识 & 日志", matchPattern: "/knowledge" },
  { href: "releases", icon: "\u{1F680}", label: "发布", matchPattern: "/releases" },
];

const MANAGEMENT_NAV: NavItem[] = [
  { href: "/settings/git-identities", icon: "\u{1F511}", label: "Git 身份管理", matchPattern: "/settings/git-identities", absolute: true },
  { href: "/settings/api-keys", icon: "\u{1F4A1}", label: "API Keys", matchPattern: "/settings/api-keys", absolute: true },
  { href: "agent", icon: "\u{1F916}", label: "Agent 控制台", matchPattern: "/agent" },
  { href: "approvals", icon: "✅", label: "审批中心", matchPattern: "/approvals" },
  { href: "audit", icon: "\u{1F4DC}", label: "审计中心", matchPattern: "/audit" },
  { href: "incidents", icon: "\u{1F6A8}", label: "事件", matchPattern: "/incidents" },
];

const SYSTEM_NAV: NavItem[] = [
  { href: "/runtimes", icon: "\u{1F5A5}", label: "Daemon 运行时", absolute: true, matchPattern: "/runtimes" },
  { href: "/settings", icon: "⚙️", label: "设置", absolute: true, matchPattern: "/settings" },
];

const ADMIN_NAV: NavItem[] = [
  { href: "/admin/users", icon: "\u{1F465}", label: "用户", absolute: true, matchPattern: "/admin/users" },
  { href: "/admin/organizations", icon: "\u{1F3E2}", label: "组织", absolute: true, matchPattern: "/admin/organizations" },
  { href: "/admin/roles", icon: "\u{1F511}", label: "角色", absolute: true, matchPattern: "/admin/roles" },
];

function useWorkspaceId(): string | null {
  const pathname = usePathname();
  const match = pathname.match(/^\/workspaces\/([^/]+)/);
  return match?.[1] ?? null;
}

const COLLAPSED_KEY = "sidebar-collapsed";

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const workspaceId = useWorkspaceId();
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

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, String(collapsed));
    } catch {
      // ignore storage errors
    }
  }, [collapsed]);

  const toggleCollapsed = () => setCollapsed((prev) => !prev);

  const displayName = useMemo(() => {
    if (!user) return "用户";
    return user.displayName || user.email;
  }, [user]);

  const resolveHref = (item: NavItem) =>
    item.absolute
      ? item.href
      : workspaceId
        ? `/workspaces/${workspaceId}/${item.href}`
        : "/workspaces";

  const isActive = (item: NavItem) => {
    if (item.absolute) {
      if (item.href === "/workspaces") return pathname === "/workspaces";
      if (item.matchPattern) return pathname.startsWith(item.matchPattern);
      return pathname === item.href;
    }
    if (!workspaceId) return false;
    if (item.matchPattern) return pathname.includes(item.matchPattern);
    const full = `/workspaces/${workspaceId}/${item.href}`;
    return pathname === full || pathname.startsWith(full + "/");
  };

  const onLogout = async () => {
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

  const renderNavLink = (item: NavItem) => {
    const hasWorkspace = !!workspaceId || item.absolute;
    const active = isActive(item);
    const href = resolveHref(item);

    const classes = hasWorkspace
      ? `flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium transition-colors ${
          active
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        }`
      : "flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium text-muted-foreground/40 cursor-not-allowed";

    const icon = (
      <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center text-[15px]">
        {item.icon}
      </span>
    );

    if (!hasWorkspace) {
      return (
        <span key={item.href} className={classes} title={collapsed ? item.label : undefined}>
          {icon}
          {!collapsed && <span className="truncate">{item.label}</span>}
        </span>
      );
    }

    return (
      <Link key={item.href} href={href} className={classes} title={collapsed ? item.label : undefined}>
        {icon}
        {!collapsed && <span className="truncate">{item.label}</span>}
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
        {/* Brand */}
        <div className="border-b px-5 pt-5 pb-4 flex items-center justify-between">
          <div className="overflow-hidden transition-all duration-200">
            <Link
              href="/workspaces"
              className="text-[15px] font-bold tracking-tight text-foreground hover:text-primary transition-colors whitespace-nowrap"
            >
              Multi-Agent Platform
            </Link>
            <p
              className={`mt-0.5 text-[11px] text-muted-foreground transition-all duration-200 ${
                collapsed ? "opacity-0 h-0" : "opacity-100"
              }`}
            >
              SillySpec Native
            </p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 pt-2 pb-4">
          <div className="px-2 pt-3 pb-1">
            <p
              className={`text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-all duration-200 ${
                collapsed ? "opacity-0 h-0 overflow-hidden" : "opacity-100"
              }`}
            >
              Overview
            </p>
          </div>
          {OVERVIEW_NAV.map(renderNavLink)}

          {renderGroupTitle("Management")}
          {MANAGEMENT_NAV.map(renderNavLink)}

          {hasAdminPermission(user) && (
            <>
              {renderGroupTitle("系统管理")}
              {ADMIN_NAV.map(renderNavLink)}
            </>
          )}

          {renderGroupTitle("System")}
          {SYSTEM_NAV.map(renderNavLink)}
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
              onClick={onLogout}
              title="退出登录"
              className="shrink-0"
            >
              {collapsed ? "🚪" : "退出"}
            </Button>
          </div>
        </div>

        {/* Collapse toggle */}
        <button
          onClick={toggleCollapsed}
          className="flex items-center justify-center border-t py-2.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          title={collapsed ? "展开侧边栏" : "收缩侧边栏"}
        >
          <span className="text-sm">
            {collapsed ? "→" : "←"}
          </span>
        </button>
      </aside>

      {/* Main content */}
      <div
        className={`flex min-w-0 flex-1 flex-col transition-all duration-200 ${
          collapsed ? "ml-[60px]" : "ml-[260px]"
        }`}
      >
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
