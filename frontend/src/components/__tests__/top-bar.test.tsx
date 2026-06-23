/**
 * ql-20260623-003-7c2e：TopBar「切换平台」逻辑测试。
 *
 * resolvePlatformSwitch 为纯函数，覆盖平台判断（/ppm 前缀）与文案/跳转目标；
 * 不依赖 radix DropdownMenu 的渲染时机，稳定可测。DropdownMenuItem 的点击路由
 * 跳转由其自身集成（next/navigation useRouter）保证，此处聚焦核心判断逻辑。
 */

import { describe, expect, it } from "vitest";

import { resolvePlatformSwitch } from "@/components/top-bar";

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
