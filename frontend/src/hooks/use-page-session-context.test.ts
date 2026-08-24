/**
 * URL 派生页面上下文 hook 单测（task-07 / FR-6）。
 *
 * v1 语义：pathname 前缀 → 页面标签；pageContext 恒 null（实体 id 只来自
 * 显式入口——设计决策 D-007，searchParams 派生归 v2）。
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

  it("PPM 页面派生项目页标签", () => {
    const { result } = renderHook(() => usePageSessionContext());
    expect(result.current.label).toBe("PPM · 项目管理");
    expect(result.current.pageContext).toBeNull();
  });

  it("工作区页面派生工作区标签", () => {
    pathnameRef.current = "/workspaces/abc/changes";
    const { result } = renderHook(() => usePageSessionContext());
    expect(result.current.label).toBe("工作区");
  });

  it("非注册页面返回 null 标签（降级文案由宿主处理）", () => {
    pathnameRef.current = "/settings/mcp";
    const { result } = renderHook(() => usePageSessionContext());
    expect(result.current.label).toBeNull();
    expect(result.current.pageContext).toBeNull();
  });

  it("前缀不误匹配近名路由", () => {
    pathnameRef.current = "/ppms/other";
    const { result } = renderHook(() => usePageSessionContext());
    expect(result.current.label).toBeNull();
  });
});
