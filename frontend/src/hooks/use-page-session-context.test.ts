/**
 * URL 派生页面上下文 hook 单测（task-07/09/10/14）。
 * task-14（用户反馈⑧/⑨）：全路由派生（平台/PPM 子菜单 + 工作区 tab）+
 * 全局地图（后端注入，前端不感知）。
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pathnameRef = { current: "/ppm/projects" };

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameRef.current,
}));

import { usePageSessionContext } from "@/hooks/use-page-session-context";
import type { FloatingPageContext } from "@/stores/floating-session";


/** 窄化辅助：取 workspace 变体的 tab_key（联合类型访问需先判别 page_key）。 */
function tabKeyOf(pc: FloatingPageContext | null): string | undefined {
  return pc?.page_key === "workspace" ? pc.tab_key : undefined;
}

describe("usePageSessionContext", () => {
  beforeEach(() => {
    pathnameRef.current = "/ppm/projects";
  });

  it("PPM 子菜单派生（问题单/看板/工时）", () => {
    pathnameRef.current = "/ppm/problem-list";
    expect(renderHook(() => usePageSessionContext()).result.current).toEqual({
      pageContext: { page_key: "generic_page", route_key: "ppm_problem_list" },
      label: "PPM · 问题单",
    });
    pathnameRef.current = "/ppm/kanban";
    expect(renderHook(() => usePageSessionContext()).result.current.pageContext).toEqual({
      page_key: "generic_page",
      route_key: "ppm_kanban",
    });
    pathnameRef.current = "/ppm/work-hours";
    expect(renderHook(() => usePageSessionContext()).result.current.pageContext).toEqual({
      page_key: "generic_page",
      route_key: "ppm_work_hours",
    });
  });

  it("设置/管理子页派生", () => {
    pathnameRef.current = "/settings/providers";
    expect(renderHook(() => usePageSessionContext()).result.current.pageContext).toEqual({
      page_key: "generic_page",
      route_key: "settings_providers",
    });
    pathnameRef.current = "/admin/roles";
    expect(renderHook(() => usePageSessionContext()).result.current.label).toBe("管理后台 · 角色权限");
  });

  it("机器审计子页派生 runtimes_audit", () => {
    pathnameRef.current = "/runtimes/abc/audit";
    expect(renderHook(() => usePageSessionContext()).result.current.pageContext).toEqual({
      page_key: "generic_page",
      route_key: "runtimes_audit",
    });
  });

  it("工作区 tab：概览默认 / 变更 / 变更详情 / 变更会话", () => {
    pathnameRef.current = "/workspaces/w1";
    expect(renderHook(() => usePageSessionContext()).result.current.pageContext).toEqual({
      page_key: "workspace",
      workspace_id: "w1",
      tab_key: "workspace_overview",
    });
    pathnameRef.current = "/workspaces/w1/changes";
    expect(renderHook(() => usePageSessionContext()).result.current.pageContext).toEqual({
      page_key: "workspace",
      workspace_id: "w1",
      tab_key: "workspace_changes",
    });
    pathnameRef.current = "/workspaces/w1/changes/c9";
    expect(tabKeyOf(renderHook(() => usePageSessionContext()).result.current.pageContext)).toBe(
      "workspace_change_detail",
    );
    pathnameRef.current = "/workspaces/w1/changes/c9/sessions";
    expect(tabKeyOf(renderHook(() => usePageSessionContext()).result.current.pageContext)).toBe(
      "workspace_change_sessions",
    );
  });

  it("工作区 tab：知识库/拓扑/审批/Git 记录", () => {
    pathnameRef.current = "/workspaces/w1/knowledge";
    expect(tabKeyOf(renderHook(() => usePageSessionContext()).result.current.pageContext)).toBe(
      "workspace_knowledge",
    );
    pathnameRef.current = "/workspaces/w1/components/topology";
    expect(tabKeyOf(renderHook(() => usePageSessionContext()).result.current.pageContext)).toBe(
      "workspace_topology",
    );
    pathnameRef.current = "/workspaces/w1/approvals";
    expect(renderHook(() => usePageSessionContext()).result.current.label).toBe("工作区 · 审批中心");
    pathnameRef.current = "/workspaces/w1/git-log";
    expect(tabKeyOf(renderHook(() => usePageSessionContext()).result.current.pageContext)).toBe(
      "workspace_git_log",
    );
  });

  it("未知 tab 回落概览；工作区列表精确匹配", () => {
    pathnameRef.current = "/workspaces/w1/quicklog/ql1/sessions";
    expect(tabKeyOf(renderHook(() => usePageSessionContext()).result.current.pageContext)).toBe(
      "workspace_overview",
    );
    pathnameRef.current = "/workspaces";
    expect(renderHook(() => usePageSessionContext()).result.current.pageContext).toEqual({
      page_key: "generic_page",
      route_key: "workspaces",
    });
  });

  it("未注册页面返回 null（近名路由不误匹配）", () => {
    pathnameRef.current = "/admins/other";
    expect(renderHook(() => usePageSessionContext()).result.current.label).toBeNull();
  });
});
