/**
 * ql-20260623-003-7c2e：TopBar「切换平台」逻辑测试。
 *
 * resolvePlatformSwitch 为纯函数，覆盖平台判断（/ppm 前缀）与文案/跳转目标；
 * 不依赖 radix DropdownMenu 的渲染时机，稳定可测。DropdownMenuItem 的点击路由
 * 跳转由其自身集成（next/navigation useRouter）保证，此处聚焦核心判断逻辑。
 *
 * task-09（2026-07-09-workspace-prioritization / FR-04 / AC-3）：
 *   新增一个渲染测试，确认顶栏左侧（面包屑之前）挂载了 WorkspaceSwitcher。
 *   直接 mock 掉 @/components/workspace-switcher，避免拖入 task-08 的 context /
 *   react-query / store 依赖（这些在 task-08 自身测试里覆盖，本任务只验接入）。
 *
 * ql-20260711-002-5b2c：pathname mock 改可变 hoisted ref，补 /ppm 下不渲染 WorkspaceSwitcher 用例。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// task-09：mock workspace-switcher，渲染时打一个稳定标记，断言接入即可。
// vi.mock 会被 vitest 提升到文件顶部（早于被测模块 import）。
vi.mock("@/components/workspace-switcher", () => ({
  WorkspaceSwitcher: () => (
    <div data-testid="workspace-switcher-mock">switcher</div>
  ),
}));

// next/navigation 在 jsdom 下需 mock，避免引入真实路由依赖。
// ql-20260711-002：pathname 改可变 hoisted ref，便于测 /ppm 下不渲染 WorkspaceSwitcher。
const { pathnameRef } = vi.hoisted(() => ({
  pathnameRef: { current: "/workspaces" },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => pathnameRef.current,
  useRouter: () => ({ push: () => {} }),
}));

import { resolvePlatformSwitch, TopBar } from "@/components/top-bar";

describe("resolvePlatformSwitch", () => {
  it("SillyHub（非 /ppm 路径）→ 提示「切换到项目管理平台」，目标 /ppm", () => {
    expect(resolvePlatformSwitch("/workspaces")).toEqual({
      label: "切换到项目管理平台",
      href: "/ppm",
    });
    expect(resolvePlatformSwitch("/workspaces/abc/runtime")).toEqual({
      label: "切换到项目管理平台",
      href: "/ppm",
    });
    expect(resolvePlatformSwitch("/admin/users")).toEqual({
      label: "切换到项目管理平台",
      href: "/ppm",
    });
    expect(resolvePlatformSwitch("/")).toEqual({
      label: "切换到项目管理平台",
      href: "/ppm",
    });
  });

  it("项目管理平台（/ppm 前缀）→ 提示「切换到 SillyHub」，目标 /workspaces", () => {
    expect(resolvePlatformSwitch("/ppm")).toEqual({
      label: "切换到 SillyHub",
      href: "/workspaces",
    });
    expect(resolvePlatformSwitch("/ppm/projects")).toEqual({
      label: "切换到 SillyHub",
      href: "/workspaces",
    });
    expect(resolvePlatformSwitch("/ppm/kanban")).toEqual({
      label: "切换到 SillyHub",
      href: "/workspaces",
    });
  });
});

/**
 * task-09：TopBar 渲染测试。
 *
 * 验证顶栏左侧（面包屑之前）挂载了 WorkspaceSwitcher（FR-04 / AC-3）。
 * ql-20260711-002-5b2c：补充 /ppm 下不渲染 WorkspaceSwitcher 的回归守护。
 */
describe("TopBar 渲染", () => {
  afterEach(() => {
    pathnameRef.current = "/workspaces";
  });

  it("顶栏左侧渲染 WorkspaceSwitcher（面包屑之前）", () => {
    const { container } = render(
      <TopBar displayName="管理员" onLogout={() => {}} />,
    );

    const switcher = screen.getByTestId("workspace-switcher-mock");
    expect(switcher).toBeTruthy();

    // 切换器位于 header 内、面包屑 nav 之前（DOM 顺序校验）
    const header = container.querySelector("header");
    expect(header).toBeTruthy();
    const nav = container.querySelector("header > nav");
    expect(nav).toBeTruthy();
    expect(header!.contains(switcher)).toBe(true);

    // switcher 可能被包在分隔容器 div 内，向上找到 header 的直接子节点，
    // 断言它在 nav 之前（顶栏左侧锚点位置）。
    const children = Array.from(header!.children);
    const navIdx = children.indexOf(nav!);
    const switcherAncestor = children.find((c) => c.contains(switcher));
    expect(switcherAncestor).toBeTruthy();
    const switcherIdx = children.indexOf(switcherAncestor!);
    expect(switcherIdx).toBeGreaterThanOrEqual(0);
    expect(switcherIdx).toBeLessThan(navIdx);
  });

  /**
   * ql-20260711-002-5b2c：/ppm 下顶栏不渲染 WorkspaceSwitcher。
   *
   * PPM 模块不依赖工作区（页面/API 全走 /api/ppm/...、导航全 absolute），
   * 顶栏「选择工作区」引导态在 /ppm 下会误导用户以为必须先选工作区。
   * 验证 /ppm 及其子路径下 mock 的 WorkspaceSwitcher 不挂载。
   */
  it("/ppm 路径下不渲染 WorkspaceSwitcher", () => {
    pathnameRef.current = "/ppm";
    render(<TopBar displayName="管理员" onLogout={() => {}} />);
    expect(screen.queryByTestId("workspace-switcher-mock")).toBeNull();
  });

  it("/ppm 子路径下也不渲染 WorkspaceSwitcher", () => {
    pathnameRef.current = "/ppm/projects";
    render(<TopBar displayName="管理员" onLogout={() => {}} />);
    expect(screen.queryByTestId("workspace-switcher-mock")).toBeNull();
  });
});
