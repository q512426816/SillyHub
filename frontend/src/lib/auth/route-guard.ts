"use client";

/**
 * task-03：移动端路由守卫（design §5.2 / §9 / R-10 / FR-08）。
 *
 * 策略 A（移动独立守卫，桌面不改）：把桌面 app/(dashboard)/layout.tsx 的
 * 「登录守卫 + 工作区白名单守卫」在 /m 前缀下重实现成一个可复用 hook，
 * 供 Wave2 app/m/layout.tsx 调用 useMobileRouteGuard()。桌面 layout 保持不动（零回归）。
 *
 * ── R-10 防漂移锚点（改桌面守卫须同步本文件 + route-guard.test.ts）──────────────
 *  - MOBILE_WORKSPACE_WHITELIST ← app/(dashboard)/layout.tsx:14（WORKSPACE_WHITELIST，桌面路径形态）
 *  - 登录守卫 effect            ← app/(dashboard)/layout.tsx:21-24（!hydrated 等；!accessToken → replace）
 *  - 工作区守卫 CB-3 顺序 effect ← app/(dashboard)/layout.tsx:44-52（先 :id 放行，再白名单前缀，否则 /workspaces）
 *
 * 与桌面的唯一语义差异（design §5.2 明确）：
 *  - 重定向目标带 /m 前缀：/m/login、/m/workspaces（不回桌面 /login、/workspaces）
 *  - /m/login 判为公开页（不要求 auth），避免登录页无限重定向。
 *    桌面不需要这条，因为桌面 /login 在 (auth) 路由组、根本不进 (dashboard) layout；
 *    移动端 /m/login 与受保护页共用同一个 app/m/layout.tsx，故必须显式放行。
 */

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

import { useSession } from "@/stores/session";

/**
 * 工作区白名单（平台级后台路由 + 选择器页本身）。
 * 镜像 app/(dashboard)/layout.tsx:14 的 WORKSPACE_WHITELIST，保持桌面路径形态（不含 /m 前缀）。
 * 判定时先把当前路径的 /m 前缀 strip 掉再比较（见 stripMobilePrefix），
 * 因此“路径含或不含 /m 前缀”都能正确命中：/m/ppm/x 与 /ppm/x 行为一致。
 */
export const MOBILE_WORKSPACE_WHITELIST = [
  "/workspaces",
  "/admin",
  "/settings",
  "/ppm",
  "/runtimes",
  "/account",
] as const;

/**
 * 移动端公开页（strip /m 后比较，不要求 auth、不判工作区）。
 * 仅 /m/login：登录页本身必须在未登录态下放行，否则守卫会无限重定向回 /m/login。
 */
const PUBLIC_PATHS = ["/login"] as const;

/**
 * 把移动路由段的 /m 前缀 strip 成桌面形态，便于复用桌面白名单正则/比较：
 *   /m              → /
 *   /m/login        → /login
 *   /m/workspaces   → /workspaces
 *   /m/workspaces/A → /workspaces/A
 *   其它（不在 /m 下，理论上不会发生在 app/m/layout 内）→ 原样返回。
 */
function stripMobilePrefix(pathname: string): string {
  if (pathname === "/m") return "/";
  if (pathname.startsWith("/m/")) return pathname.slice(2); // 去掉前两个字符 "/m"，保留后续 "/..."
  return pathname;
}

/**
 * 移动端路由守卫 hook（在 app/m/layout.tsx 顶层调用一次）。
 *
 * 镜像桌面 (dashboard)/layout.tsx 的两个守卫 effect，仅做 /m 前缀 + /m/login 公开页适配。
 * 只负责重定向副作用；渲染（未 hydrated / 未登录返回 null）由调用方 layout 自行决定。
 */
export function useMobileRouteGuard(): void {
  const router = useRouter();
  const pathname = usePathname();
  const { hydrated, accessToken } = useSession();

  const stripped = stripMobilePrefix(pathname);
  const isPublic = PUBLIC_PATHS.includes(stripped as (typeof PUBLIC_PATHS)[number]);

  // ── 登录守卫 ← 镜像 (dashboard)/layout.tsx:21-24 ─────────────────────────────
  // !hydrated 等（persist 未恢复前不跳转，避免闪跳）；公开页（/m/login）跳过，防无限重定向。
  useEffect(() => {
    if (!hydrated) return;
    if (isPublic) return;
    if (!accessToken) router.replace("/m/login");
  }, [hydrated, isPublic, accessToken, router]);

  // ── 工作区守卫 ← 镜像 (dashboard)/layout.tsx:44-52（CB-3 顺序）──────────────────
  // 登录守卫未过（!hydrated || !accessToken）或公开页 → 不判工作区。
  // CB-3 顺序：先判 /workspaces/:id 放行，再判白名单前缀，否则 /workspaces/xxx 会被
  // 白名单 /workspaces 前缀误匹配造成重定向循环。
  useEffect(() => {
    if (!hydrated || !accessToken) return; // 登录守卫未过则不判工作区
    if (isPublic) return; // 公开页（/m/login）不判工作区
    const p = stripped;
    // 1. 先判 /workspaces/:id —— 有 wsId 一律放行
    if (/^\/workspaces\/[^/]+/.test(p)) return;
    // 2. 再判白名单前缀（精确或带 / 前缀，避免 /admins 误命中 /admin）
    if (MOBILE_WORKSPACE_WHITELIST.some((w) => p === w || p.startsWith(w + "/"))) return;
    // 3. 其余（依赖工作区但无 wsId）→ 重定向到移动选择器
    router.replace("/m/workspaces");
  }, [hydrated, accessToken, isPublic, stripped, router]);
}
