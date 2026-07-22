"use client";

/**
 * task-05 · /m/* 移动路由段统一外壳（design §5.2 / §9 / R-10 / FR-02 / FR-08）。
 *
 * 职责：
 *  1. 调 task-03 useMobileRouteGuard() 跑登录守卫 + 工作区白名单守卫（副作用重定向）：
 *     strip /m + 白名单 + /m/login 公开 + 未登录→/m/login + 非白名单无 wsId→/m/workspaces。
 *  2. useSession 取 hydrated/accessToken 决定渲染（防 FOUC，镜像桌面 (dashboard)/layout.tsx:54-55）。
 *  3. 守卫通过 → <MobileAppShell activeTab=推断>{children}</MobileAppShell>。
 *
 * ── R-10 防漂移锚点（改桌面守卫须同步 route-guard.ts + 本文件）──────────────────
 *  - !hydrated → return null        ← app/(dashboard)/layout.tsx:54
 *  - 受保护页 !accessToken → null   ← app/(dashboard)/layout.tsx:55（守卫 effect 已 replace）
 *
 * 与桌面 layout 的唯一语义差异（design §5.2 明确）：
 *  - 桌面 /login 在 (auth) 路由组、根本不进 (dashboard) layout，故桌面可无条件 !accessToken→null；
 *    移动 /m/login 与受保护页共用本 layout，必须显式放行（否则登录页空白、守卫无限重定向回 /m/login）。
 *  - activeTab 由 usePathname strip /m 后用 task-04 isTabActive 推断：MOBILE_TABS.matchPrefix
 *    是桌面形态（/ppm/workbench…，不带 /m 前缀），直接拿 /m/ppm/workbench 比较会全部落空。
 *
 * 桌面 (dashboard)/layout.tsx / app-shell.tsx / (auth)/login 全不动（FR-08 零回归）。
 */

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { MobileAppShell } from "@/components/mobile/mobile-app-shell";
import {
  MOBILE_TABS,
  isTabActive,
  type TabKey,
} from "@/components/mobile/mobile-tab-bar";
import { useMobileRouteGuard } from "@/lib/auth/route-guard";
import { useSession } from "@/stores/session";

/**
 * 把移动路由段的 /m 前缀 strip 成桌面形态，复用 task-04 MOBILE_TABS.matchPrefix 比较：
 *   /m              → /
 *   /m/login        → /login
 *   /m/ppm/workbench → /ppm/workbench
 * 镜像 route-guard.ts 的 stripMobilePrefix（task-03 未导出，此处按 allowed_paths 只新增本文件，
 * 不改 route-guard；两处定义保持同步，R-10 锚点已标注）。
 */
function stripMobilePrefix(pathname: string): string {
  if (pathname === "/m") return "/";
  if (pathname.startsWith("/m/")) return pathname.slice(2); // 去掉 "/m"，保留 "/..."
  return pathname;
}

/** 移动端公开页（strip 后比较）：/m/login 不要求 auth、不判工作区、不裹 Shell。 */
const PUBLIC_PATHS = new Set(["/login"]);

/**
 * 根据当前路径推断底部高亮 Tab key（design §5.4 / D-004）。
 * strip /m 后对 task-04 MOBILE_TABS 做 isTabActive 前缀匹配；无匹配（/m/login、/m/、
 * /m/workspaces/:id 等非 Tab 根页）返回 undefined，MobileAppShell 透传给 MobileTabBar
 * 时不强制高亮，避免误亮。
 */
function inferActiveTab(pathname: string): TabKey | undefined {
  const stripped = stripMobilePrefix(pathname);
  return MOBILE_TABS.find((tab) => isTabActive(tab, stripped))?.key;
}

export default function MobileLayoutShell({ children }: { children: ReactNode }) {
  // task-03 守卫：只负责重定向副作用，渲染由本组件按 hydrated/token 决定。
  useMobileRouteGuard();

  const pathname = usePathname();
  const { hydrated, accessToken } = useSession();

  // 防 FOUC：persist 未恢复前一律不渲染（镜像桌面 (dashboard)/layout.tsx:54）。
  if (!hydrated) return null;

  const isPublic = PUBLIC_PATHS.has(stripMobilePrefix(pathname));

  // 公开页（/m/login）始终渲染 children——登录页本身不要求 token（否则守卫无限重定向）。
  // 不裹 MobileAppShell：登录是独立全屏认证场景，底部 Tab 在未登录态无意义、点击只会被守卫弹回。
  if (isPublic) return <>{children}</>;

  // 受保护页：未登录返回 null（守卫 effect 已 replace /m/login，镜像桌面 layout:55）。
  if (!accessToken) return null;

  // 守卫通过：渲染移动外壳（顶栏 + 内容 + 底部 5 Tab），按当前路由高亮对应 Tab。
  const activeTab = inferActiveTab(pathname);
  return <MobileAppShell activeTab={activeTab}>{children}</MobileAppShell>;
}
