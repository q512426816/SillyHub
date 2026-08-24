"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { FloatingSessionHost } from "@/components/floating/floating-session-host";
import { fetchMe } from "@/lib/auth";
import { useSession } from "@/stores/session";

// task-05：工作区守卫白名单（平台级后台路由 + 选择器页本身）。
// 设计依据 design §5 P2 + §9（白名单 = 现有平台级路由）。
// task-08：加入 /account（个人中心，平台级、不依赖工作区）。
// 2026-08-04-agent-profile-ui-redesign task-05 补：加入 /agent-profiles（智能体档案全局页，
// 独立一级菜单、跨工作区聚合视图，不依赖工作区上下文——execute 时遗漏，部署实测发现被守卫重定向）。
// 2026-08-14-sessions-portal task-10 补：加入 /sessions（智能体会话总入口，平台级
// 跨工作区视图，不依赖工作区上下文）。
// 2026-08-19-cross-workspace-team-mission task-15 补：加入 /projects（项目维度
// 跨工作区团队会话 /projects/{id}/missions，不依赖工作区上下文；ppm/projects 页
// 「Agent 团队」入口曾因漏配被守卫弹回 /workspaces，部署实测发现）。
const WORKSPACE_WHITELIST = ["/workspaces", "/admin", "/settings", "/ppm", "/runtimes", "/account", "/agent-profiles", "/sessions", "/projects"];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { hydrated, accessToken } = useSession();

  useEffect(() => {
    if (!hydrated) return;
    if (!accessToken) router.replace("/login");
  }, [hydrated, accessToken, router]);

  useEffect(() => {
    if (!hydrated || !accessToken) return;
    let cancelled = false;
    fetchMe()
      .then(() => {
        if (cancelled) return;
      })
      .catch(() => {
        // Best-effort refresh; if it fails the next API call will handle auth.
      });
    return () => {
      cancelled = true;
    };
  }, [hydrated, accessToken]);

  // task-05：工作区守卫（D-006 方案 A 客户端守卫）。
  // CB-3 顺序：先判 /workspaces/:id（有 wsId 放行）再判白名单前缀，
  // 否则 /workspaces/xxx 会被白名单 /workspaces 前缀误匹配造成重定向循环。
  useEffect(() => {
    if (!hydrated || !accessToken) return; // 登录守卫未过则不判工作区
    // 1. 先判 /workspaces/:id —— 有 wsId 一律放行
    if (/^\/workspaces\/[^/]+/.test(pathname)) return;
    // 2. 再判白名单前缀（精确或带 / 前缀，避免 /admins 误命中 /admin）
    if (WORKSPACE_WHITELIST.some((p) => pathname === p || pathname.startsWith(p + "/"))) return;
    // 3. 其余（依赖工作区但无 wsId）→ 重定向到选择器
    router.replace("/workspaces");
  }, [hydrated, accessToken, pathname, router]);

  if (!hydrated) return null;
  if (!accessToken) return null;

  // 2026-08-25-unified-floating-session task-05（FR-1~4）：全局悬浮会话宿主
  // （球+抽屉；门户三路由互斥自卸载；挂载门控见组件头约束 3）。
  return (
    <AppShell>
      {children}
      <FloatingSessionHost />
    </AppShell>
  );
}
