/**
 * URL 派生页面上下文 hook 单测（task-07/task-09 / FR-6）。
 *
 * task-09 起：注册路由派生 generic_page/route_key 上下文（供创建轮上送，
 * 后端注册表 Lookup 注入页面中文名）；未注册页面 null。实体级上下文仍由
 * 显式入口携带（v2 做 searchParams 派生）。
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pathnameRef = { current: "/ppm/projects" };

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameRef.current,
}));

import { usePageSessionContext } from "@/hooks/use-page-session-context";

describe("usePageSessionContext", () => {
  beforeEach(() => {
    pathnameRef.current = "/ppm/projects";
  });

  it("设置 MCP 页派生 settings_mcp 上下文与标签", () => {
    pathnameRef.current = "/settings/mcp";
    const { result } = renderHook(() => usePageSessionContext());
    expect(result.current.label).toBe("设置 · MCP");
    expect(result.current.pageContext).toEqual({
      page_key: "generic_page",
      route_key: "settings_mcp",
    });
  });

  it("工作区详情页派生 workspace_detail", () => {
    pathnameRef.current = "/workspaces/abc/changes";
    const { result } = renderHook(() => usePageSessionContext());
    expect(result.current.label).toBe("工作区详情");
    expect(result.current.pageContext?.page_key).toBe("generic_page");
  });

  it("工作区列表精确匹配（/workspaces 本体）", () => {
    pathnameRef.current = "/workspaces";
    const { result } = renderHook(() => usePageSessionContext());
    expect(result.current.label).toBe("工作区列表");
  });

  it("PPM 项目列表页派生 ppm_projects", () => {
    pathnameRef.current = "/ppm/projects";
    const { result } = renderHook(() => usePageSessionContext());
    expect(result.current.label).toBe("PPM · 项目列表");
    expect(result.current.pageContext).toEqual({
      page_key: "generic_page",
      route_key: "ppm_projects",
    });
  });

  it("未注册页面返回 null（降级文案由宿主处理）", () => {
    pathnameRef.current = "/ppm/milestone-details";
    const { result } = renderHook(() => usePageSessionContext());
    expect(result.current.label).toBeNull();
    expect(result.current.pageContext).toBeNull();
  });

  it("前缀不误匹配近名路由", () => {
    pathnameRef.current = "/admins/other";
    const { result } = renderHook(() => usePageSessionContext());
    expect(result.current.label).toBeNull();
  });
});
