/**
 * URL 派生页面上下文（2026-08-25-unified-floating-session task-07/task-09 / FR-6 / D-007）。
 *
 * 两级语义：
 * - task-09（用户反馈"任意页面都该知道"）：通用页面上下文——pathname 命中
 *   ROUTE_RULES 注册表 → 派生 { page_key: "generic_page", route_key }，悬浮
 *   宿主新建会话时自动携带（后端 PAGE_ROUTE_LABELS 同键注册表 Lookup 注入
 *   【页面上下文】- 页面：中文名；未注册键静默不注入——枚举键语义，零自由
 *   文本，防伪造注入）。
 * - 实体级上下文（如具体项目）仍由显式入口携带（PPM 行按钮 requestNewSession
 *   传 ppm_project 块）；searchParams 实体派生归 v2。
 *
 * 纯派生 hook：不发请求、无副作用；未注册页面返回 { pageContext: null }。
 * 路由键两侧（本文件 ROUTE_RULES ↔ backend PAGE_ROUTE_LABELS）必须一致。
 */
import { useMemo } from "react";
import { usePathname } from "next/navigation";

import type { FloatingPageContext } from "@/stores/floating-session";

/** 通用页面路由注册表：前缀（或正则）→ route_key（与后端注册表同键）。 */
const PREFIX_RULES: ReadonlyArray<{ prefix: string; routeKey: string }> = [
  { prefix: "/settings/mcp", routeKey: "settings_mcp" },
  { prefix: "/settings/skills", routeKey: "settings_skills" },
  { prefix: "/settings", routeKey: "settings" },
  { prefix: "/runtimes", routeKey: "runtimes" },
  { prefix: "/sessions", routeKey: "sessions_portal" },
  { prefix: "/agent-profiles", routeKey: "agent_profiles" },
  { prefix: "/account", routeKey: "account" },
  { prefix: "/admin", routeKey: "admin" },
  { prefix: "/ppm/projects", routeKey: "ppm_projects" },
  { prefix: "/ppm/workbench", routeKey: "ppm_workbench" },
];

/** 正则规则（带路径参数的页面，精确于前缀匹配的放前面）。 */
const REGEX_RULES: ReadonlyArray<{ re: RegExp; routeKey: string }> = [
  { re: /^\/workspaces\/[^/]+(\/|$)/, routeKey: "workspace_detail" },
];

/** route_key → 展示标签（与后端 PAGE_ROUTE_LABELS 文案保持一致，各自维护）。 */
export const ROUTE_LABELS: Record<string, string> = {
  settings_mcp: "设置 · MCP",
  settings_skills: "设置 · Skills",
  settings: "设置",
  runtimes: "运行时",
  sessions_portal: "会话门户",
  agent_profiles: "智能体档案",
  account: "个人中心",
  admin: "管理后台",
  workspaces: "工作区列表",
  workspace_detail: "工作区详情",
  ppm_projects: "PPM · 项目列表",
  ppm_workbench: "PPM · 工作台",
};

function deriveRouteKey(pathname: string): string | null {
  for (const { re, routeKey } of REGEX_RULES) {
    if (re.test(pathname)) return routeKey;
  }
  for (const { prefix, routeKey } of PREFIX_RULES) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) return routeKey;
  }
  if (pathname === "/workspaces") return "workspaces";
  return null;
}

/** 感知结果：pageContext 供创建轮上送（显式入口优先，宿主做 ?? 兜底）；label 供上下文条展示。 */
export interface PageSessionContext {
  pageContext: FloatingPageContext | null;
  /** 当前页面展示标签；null = 未注册页面（上下文条降级文案）。 */
  label: string | null;
}

export function usePageSessionContext(): PageSessionContext {
  const pathname = usePathname();
  return useMemo(() => {
    const routeKey = pathname ? deriveRouteKey(pathname) : null;
    if (!routeKey) return { pageContext: null, label: null };
    return {
      pageContext: { page_key: "generic_page", route_key: routeKey },
      label: ROUTE_LABELS[routeKey] ?? null,
    };
  }, [pathname]);
}
