"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { fetchMe } from "@/lib/auth";
import { useSession } from "@/stores/session";

// task-05：工作区守卫白名单（平台级后台路由 + 选择器页本身）。
// 设计依据 design §5 P2 + §9（白名单 = 现有平台级路由）。
const WORKSPACE_WHITELIST = ["/workspaces", "/admin", "/settings", "/ppm", "/runtimes"];

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

  return <AppShell>{children}</AppShell>;
}
