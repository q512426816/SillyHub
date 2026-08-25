/**
 * URL 派生页面上下文（2026-08-25-unified-floating-session task-07/09/10/14）。
 *
 * 三级语义（与后端 PageContextCreateBlock 对齐）：
 * - workspace：/workspaces/:id/** → 实体上下文（workspace_id + tab_key 子页面键，
 *   后端注入工作区名/类型 + 子页面说明书 + 平台全局地图）；
 * - generic_page：注册路由 → route_key（后端注册表 Lookup 页面说明书 + 全局地图）；
 * - 未注册页面 → null（上下文条降级文案，不上送）。
 *
 * 实体级 PPM 上下文仍由显式入口携带（项目行按钮）；纯派生、无请求、无副作用。
 * 路由键与后端 PAGE_ROUTE_LABELS / WORKSPACE_TAB_LABELS 同键（两侧必须一致）。
 */
import { useMemo } from "react";
import { usePathname } from "next/navigation";

import type { FloatingPageContext } from "@/stores/floating-session";

/** 通用页面路由注册表：前缀 → route_key（与后端 PAGE_ROUTE_LABELS 同键）。 */
const PREFIX_RULES: ReadonlyArray<{ prefix: string; routeKey: string }> = [
  { prefix: "/settings/mcp", routeKey: "settings_mcp" },
  { prefix: "/settings/skills", routeKey: "settings_skills" },
  { prefix: "/settings/providers", routeKey: "settings_providers" },
  { prefix: "/settings/api-keys", routeKey: "settings_api_keys" },
  { prefix: "/settings/git-identities", routeKey: "settings_git_identities" },
  { prefix: "/settings", routeKey: "settings" },
  { prefix: "/runtimes", routeKey: "runtimes" },
  { prefix: "/sessions", routeKey: "sessions_portal" },
  { prefix: "/agent-profiles", routeKey: "agent_profiles" },
  { prefix: "/account", routeKey: "account" },
  { prefix: "/admin/organizations", routeKey: "admin_organizations" },
  { prefix: "/admin/users", routeKey: "admin_users" },
  { prefix: "/admin/roles", routeKey: "admin_roles" },
  { prefix: "/admin", routeKey: "admin" },
  { prefix: "/ppm/projects", routeKey: "ppm_projects" },
  { prefix: "/ppm/milestone-details", routeKey: "ppm_milestone_details" },
  { prefix: "/ppm/problem-list", routeKey: "ppm_problem_list" },
  { prefix: "/ppm/task-plans", routeKey: "ppm_task_plans" },
  { prefix: "/ppm/task-execute", routeKey: "ppm_task_execute" },
  { prefix: "/ppm/project-plans", routeKey: "ppm_project_plans" },
  { prefix: "/ppm/plan-nodes", routeKey: "ppm_plan_nodes" },
  { prefix: "/ppm/weekly-plan", routeKey: "ppm_weekly_plan" },
  { prefix: "/ppm/kanban", routeKey: "ppm_kanban" },
  { prefix: "/ppm/work-hours", routeKey: "ppm_work_hours" },
  { prefix: "/ppm/work-hour-statistics", routeKey: "ppm_work_hour_statistics" },
  { prefix: "/ppm/project-members", routeKey: "ppm_project_members" },
  { prefix: "/ppm/project-stakeholders", routeKey: "ppm_project_stakeholders" },
  { prefix: "/ppm/customers", routeKey: "ppm_customers" },
  { prefix: "/ppm/workbench", routeKey: "ppm_workbench" },
  { prefix: "/ppm", routeKey: "ppm_home" },
];

/** 机器审计子页（/runtimes/:id/audit）。 */
const RUNTIME_AUDIT_RE = /^\/runtimes\/[^/]+\/audit(\/|$)/;

/**
 * 工作区子页面映射：tab 路径段 → tab_key（与后端 WORKSPACE_TAB_LABELS 同键）。
 * changes 深层路径按"变更详情/变更会话"细分；未知段回落概览。
 */
const WORKSPACE_TAB_MAP: Record<string, string> = {
  "": "workspace_overview",
  sessions: "workspace_sessions_tab",
  explorer: "workspace_explorer",
  knowledge: "workspace_knowledge",
  "scan-docs": "workspace_scan_docs",
  runtime: "workspace_runtime_tab",
  "agent-profiles": "workspace_agent_profiles_tab",
  agent: "workspace_agent",
  skills: "workspace_skills_tab",
  "mcp-tokens": "workspace_mcp_tokens_tab",
  mcp: "workspace_mcp_tab",
  members: "workspace_members",
  files: "workspace_files",
  approvals: "workspace_approvals",
  audit: "workspace_audit",
  "git-log": "workspace_git_log",
  releases: "workspace_releases",
};

function workspaceTabKeyOf(rest: string): string {
  const seg = rest.split("/")[0] ?? "";
  if (seg === "changes") {
    if (rest === "changes" || rest === "changes/") return "workspace_changes";
    return rest.includes("/sessions") ? "workspace_change_sessions" : "workspace_change_detail";
  }
  if (seg === "components") {
    return rest.startsWith("components/topology") ? "workspace_topology" : "workspace_components";
  }
  if (seg === "incidents") return "workspace_incidents";
  return WORKSPACE_TAB_MAP[rest.replace(/\/$/, "")] ?? "workspace_overview";
}

/** route_key / tab_key → 展示标签（与后端文案一致，各自维护）。 */
export const ROUTE_LABELS: Record<string, string> = {
  settings_mcp: "设置 · MCP",
  settings_skills: "设置 · Skills",
  settings_providers: "设置 · 模型供应商",
  settings_api_keys: "设置 · API 密钥",
  settings_git_identities: "设置 · Git 身份",
  settings: "设置",
  runtimes: "运行时",
  runtimes_audit: "运行时 · 机器审计",
  sessions_portal: "会话门户",
  agent_profiles: "智能体档案",
  account: "个人中心",
  admin: "管理后台",
  admin_organizations: "管理后台 · 组织",
  admin_users: "管理后台 · 用户",
  admin_roles: "管理后台 · 角色权限",
  ppm_home: "PPM · 项目管理",
  ppm_projects: "PPM · 项目列表",
  ppm_workbench: "PPM · 工作台",
  ppm_milestone_details: "PPM · 里程碑详情",
  ppm_problem_list: "PPM · 问题单",
  ppm_task_plans: "PPM · 任务计划",
  ppm_task_execute: "PPM · 任务执行",
  ppm_project_plans: "PPM · 项目计划",
  ppm_plan_nodes: "PPM · 计划节点",
  ppm_weekly_plan: "PPM · 周计划",
  ppm_kanban: "PPM · 看板",
  ppm_work_hours: "PPM · 工时填报",
  ppm_work_hour_statistics: "PPM · 工时统计",
  ppm_project_members: "PPM · 项目成员",
  ppm_project_stakeholders: "PPM · 干系人",
  ppm_customers: "PPM · 客户",
  workspaces: "工作区列表",
  workspace_overview: "工作区 · 概览",
  workspace_changes: "工作区 · 变更",
  workspace_change_detail: "工作区 · 变更详情",
  workspace_change_sessions: "工作区 · 变更会话",
  workspace_sessions_tab: "工作区 · 会话",
  workspace_explorer: "工作区 · 文件",
  workspace_knowledge: "工作区 · 知识库",
  workspace_components: "工作区 · 组件",
  workspace_topology: "工作区 · 组件拓扑",
  workspace_scan_docs: "工作区 · 扫描文档",
  workspace_runtime_tab: "工作区 · 运行时",
  workspace_agent_profiles_tab: "工作区 · 智能体档案",
  workspace_agent: "工作区 · Agent 总览",
  workspace_skills_tab: "工作区 · Skills",
  workspace_mcp_tab: "工作区 · MCP",
  workspace_mcp_tokens_tab: "工作区 · MCP 令牌",
  workspace_members: "工作区 · 成员",
  workspace_files: "工作区 · 方案文件",
  workspace_approvals: "工作区 · 审批中心",
  workspace_audit: "工作区 · 审计日志",
  workspace_git_log: "工作区 · Git 提交记录",
  workspace_incidents: "工作区 · 事件",
  workspace_releases: "工作区 · 发布",
};

function deriveRouteKey(pathname: string): string | null {
  if (RUNTIME_AUDIT_RE.test(pathname)) return "runtimes_audit";
  for (const { prefix, routeKey } of PREFIX_RULES) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) return routeKey;
  }
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
    if (!pathname) return { pageContext: null, label: null };
    // 工作区详情（含子页面 tab）：实体 + 子页面说明书。
    const ws = pathname.match(/^\/workspaces\/([^/]+)(?:\/(.*))?$/);
    if (ws?.[1]) {
      const tabKey = workspaceTabKeyOf(ws[2] ?? "");
      const ctx: FloatingPageContext = {
        page_key: "workspace",
        workspace_id: ws[1],
        tab_key: tabKey,
      };
      return { pageContext: ctx, label: ROUTE_LABELS[tabKey] ?? "工作区详情" };
    }
    if (pathname === "/workspaces") {
      const wsCtx: FloatingPageContext = { page_key: "generic_page", route_key: "workspaces" };
      return { pageContext: wsCtx, label: ROUTE_LABELS.workspaces ?? "工作区列表" };
    }
    const routeKey = deriveRouteKey(pathname);
    if (!routeKey) return { pageContext: null, label: null };
    const ctx: FloatingPageContext = { page_key: "generic_page", route_key: routeKey };
    return { pageContext: ctx, label: ROUTE_LABELS[routeKey] ?? null };
  }, [pathname]);
}
