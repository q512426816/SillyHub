// lib/__tests__/menu-overrides.test.ts
// 2026-09-18-web-menu-management task-12：菜单覆盖合并层单测（FR-05 / NFR-02）。
//
// 覆盖（task-12 蓝图 implementation 第 1 条，mergeMenus 六类纯函数行为）：
//   1. label 覆盖生效——非空 label 替换 menuLabel；label 为 null 直通代码默认名；
//   2. hidden 剔除——hidden=true 的行从合并结果移除；
//   3. menus 恒豁免（R-03 防自锁）——menuKey="menus" 的 hidden 覆盖不剔除该行，
//      但其 label / 组内排序覆盖仍正常生效；
//   4. 组内排序——sort_order 缺省回落声明序索引；覆盖后组内重排；同值保持声明序
//      （稳定排序）；section 之间顺序不变；
//   5. 孤儿 override 忽略（R-01）——registry 无此 menuKey 的覆盖静默丢弃，不抛错；
//   6. 空覆盖直通（NFR-02）——空数组输入输出与 registry 逐项全等（未覆盖行复用
//      原对象引用），且不 mutate 入参。
//
// 另补 useMenuOverrides hook 降级用例（NFR-02 / FR-05「拉取失败降级」场景）：
//   - 成功 → overrides = 接口 items；
//   - 失败（5xx）→ isError=true 且 overrides 恒为空数组（直通降级）；
//   - 首帧加载中 → overrides 为空数组（不阻塞导航渲染）。
//
// mergeMenus 用例全部为纯函数断言，不触网络与 React；hook 用例走
// renderHook + QueryClientProvider + mock @/lib/api（照搬 use-workspace-context.test.ts 惯例）。
import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

import { ApiError } from "@/lib/api";
import type { MenuOverrideRead } from "@/lib/menu-overrides";
import { mergeMenus, useMenuOverrides } from "@/lib/menu-overrides";
import type { MenuPermissionGroup } from "@/lib/menu-permissions";

/* ------------------------------------------------------------------ */
/*  fixture：合成注册表（不依赖真实 38 条，聚焦合并语义）                 */
/* ------------------------------------------------------------------ */

/** 最小合法菜单项工厂（权限 key 取后端枚举真实存在的值满足 PermissionKey 联合）。 */
function mkMenu(
  over: Partial<MenuPermissionGroup> & Pick<MenuPermissionGroup, "menuKey" | "menuLabel" | "section">,
): MenuPermissionGroup {
  return {
    icon: "x",
    href: `/${over.menuKey}`,
    absolute: true,
    permissions: [{ key: "workspace:read", name: "工作区查看" }],
    ...over,
  };
}

/**
 * 声明序：0 首页 / 1 报表 / 2 仪表盘（workspace 组），3 用户 / 4 菜单管理（system 组）。
 * section 首次出现顺序 workspace → system，供「section 间顺序不变」断言。
 */
function mkRegistry(): MenuPermissionGroup[] {
  return [
    mkMenu({ section: "workspace", menuKey: "home", menuLabel: "首页" }),
    mkMenu({ section: "workspace", menuKey: "reports", menuLabel: "报表" }),
    mkMenu({ section: "workspace", menuKey: "dashboards", menuLabel: "仪表盘" }),
    mkMenu({ section: "system", menuKey: "users", menuLabel: "用户" }),
    mkMenu({
      section: "system",
      menuKey: "menus",
      menuLabel: "菜单管理",
      permissions: [{ key: "menu:admin", name: "菜单管理" }],
    }),
  ];
}

/** 覆盖行工厂（MenuOverrideRead 全字段）。 */
function mkOverride(
  over: Partial<MenuOverrideRead> & Pick<MenuOverrideRead, "menu_key">,
): MenuOverrideRead {
  return { label: null, sort_order: null, hidden: false, ...over };
}

function keysOf(menus: MenuPermissionGroup[]): string[] {
  return menus.map((m) => m.menuKey);
}

/* ------------------------------------------------------------------ */
/*  mergeMenus 六类纯函数行为                                           */
/* ------------------------------------------------------------------ */

describe("mergeMenus：空覆盖直通（NFR-02）", () => {
  it("空覆盖数组 → 输出与 registry 逐项全等，且未覆盖行复用原对象引用", () => {
    const registry = mkRegistry();
    const merged = mergeMenus(registry, []);
    expect(merged).toEqual(registry);
    // 纯函数语义：未覆盖行不拷贝（浅拷贝仅发生在 label 被覆盖时）
    registry.forEach((menu, i) => {
      expect(merged[i]).toBe(menu);
    });
  });

  it("混合覆盖后 registry 入参不被 mutate", () => {
    const registry = mkRegistry();
    const snapshot = structuredClone(registry);
    mergeMenus(registry, [
      mkOverride({ menu_key: "users", label: "成员" }),
      mkOverride({ menu_key: "reports", hidden: true }),
      mkOverride({ menu_key: "dashboards", sort_order: 0 }),
    ]);
    expect(registry).toEqual(snapshot);
  });
});

describe("mergeMenus：label 覆盖（规则 1）", () => {
  it("非空 label 替换 menuLabel，其余字段原样保留", () => {
    const merged = mergeMenus(mkRegistry(), [
      mkOverride({ menu_key: "users", label: "成员中心" }),
    ]);
    const users = merged.find((m) => m.menuKey === "users")!;
    expect(users.menuLabel).toBe("成员中心");
    // 未覆盖的维度不动：section / href / permissions 仍是注册表原值
    expect(users.section).toBe("system");
    expect(users.href).toBe("/users");
    expect(users.permissions).toEqual([{ key: "workspace:read", name: "工作区查看" }]);
    // 其它行不受影响
    expect(merged.find((m) => m.menuKey === "home")!.menuLabel).toBe("首页");
  });

  it("label 为 null 直通代码默认名（复用原对象引用）", () => {
    const registry = mkRegistry();
    const merged = mergeMenus(registry, [
      mkOverride({ menu_key: "users", label: null }),
    ]);
    const users = merged.find((m) => m.menuKey === "users")!;
    expect(users.menuLabel).toBe("用户");
    expect(users).toBe(registry[3]);
  });
});

describe("mergeMenus：hidden 剔除（规则 2）", () => {
  it("hidden=true 的行被剔除，其余行保留", () => {
    const merged = mergeMenus(mkRegistry(), [
      mkOverride({ menu_key: "reports", hidden: true }),
    ]);
    expect(keysOf(merged)).toEqual(["home", "dashboards", "users", "menus"]);
  });

  it("hidden=false 不剔除（显式恢复显示）", () => {
    const merged = mergeMenus(mkRegistry(), [
      mkOverride({ menu_key: "reports", hidden: false }),
    ]);
    expect(keysOf(merged)).toEqual(["home", "reports", "dashboards", "users", "menus"]);
  });
});

describe("mergeMenus：menus 恒豁免（规则 2 / R-03 防自锁）", () => {
  it("menuKey=menus 的 hidden 覆盖不剔除该行", () => {
    const merged = mergeMenus(mkRegistry(), [
      mkOverride({ menu_key: "menus", hidden: true }),
    ]);
    expect(keysOf(merged)).toContain("menus");
    expect(merged).toHaveLength(5);
  });

  it("menus 行的 label / 组内排序覆盖仍正常生效（豁免仅免 hidden）", () => {
    const merged = mergeMenus(mkRegistry(), [
      mkOverride({ menu_key: "menus", hidden: true, label: "菜单配置", sort_order: 0 }),
    ]);
    // system 组内被排到首位 + label 覆盖生效，但行未被剔除
    const systemKeys = keysOf(merged.filter((m) => m.section === "system"));
    expect(systemKeys).toEqual(["menus", "users"]);
    expect(merged.find((m) => m.menuKey === "menus")!.menuLabel).toBe("菜单配置");
  });

  it("非 menus 菜单同名场景对照：hidden + label 同时覆盖时仍被剔除", () => {
    const merged = mergeMenus(mkRegistry(), [
      mkOverride({ menu_key: "users", hidden: true, label: "成员" }),
    ]);
    expect(keysOf(merged)).not.toContain("users");
    expect(merged.find((m) => m.menuKey === "users")).toBeUndefined();
  });
});

describe("mergeMenus：组内排序（规则 3）", () => {
  it("sort_order 缺省回落声明序索引：仅覆盖 system 组时 workspace 组顺序不变", () => {
    const merged = mergeMenus(mkRegistry(), [
      mkOverride({ menu_key: "users", label: "成员" }),
    ]);
    expect(keysOf(merged)).toEqual(["home", "reports", "dashboards", "users", "menus"]);
  });

  it("sort_order 覆盖为组内最大值 → 该行沉到组尾", () => {
    const merged = mergeMenus(mkRegistry(), [
      mkOverride({ menu_key: "home", sort_order: 9 }),
    ]);
    expect(keysOf(merged.filter((m) => m.section === "workspace"))).toEqual([
      "reports",
      "dashboards",
      "home",
    ]);
  });

  it("sort_order 覆盖为 0 与未覆盖行回落值同值 → 稳定排序保声明序", () => {
    // home 未覆盖 sortValue=0（声明序索引），dashboards 覆盖 0：同值按声明序
    // home(声明0) 在 dashboards(声明2) 前；未覆盖的 reports(1) 居中不受干扰。
    const merged = mergeMenus(mkRegistry(), [
      mkOverride({ menu_key: "dashboards", sort_order: 0 }),
    ]);
    expect(keysOf(merged.filter((m) => m.section === "workspace"))).toEqual([
      "home",
      "dashboards",
      "reports",
    ]);
  });

  it("两行覆盖同值 sort_order → 相对位置保持声明序（稳定排序）", () => {
    // home(声明0) 与 reports(声明1) 覆盖同值 7 → 声明序在前；dashboards 未覆盖=2
    expect(
      keysOf(
        mergeMenus(mkRegistry(), [
          mkOverride({ menu_key: "home", sort_order: 7 }),
          mkOverride({ menu_key: "reports", sort_order: 7 }),
        ]).filter((m) => m.section === "workspace"),
      ),
    ).toEqual(["dashboards", "home", "reports"]);
  });

  it("section 之间顺序不变（system 组排序值再小也不跨组）", () => {
    const merged = mergeMenus(mkRegistry(), [
      mkOverride({ menu_key: "menus", sort_order: 0 }),
    ]);
    // 分桶按首次出现顺序拼接：workspace 块整体在前，system 块在后
    expect(merged.map((m) => m.section)).toEqual([
      "workspace",
      "workspace",
      "workspace",
      "system",
      "system",
    ]);
    expect(keysOf(merged.filter((m) => m.section === "system"))).toEqual([
      "menus",
      "users",
    ]);
  });
});

describe("mergeMenus：孤儿 override 忽略（规则 4 / R-01）", () => {
  it("registry 无此 menuKey 的覆盖静默忽略，不抛错", () => {
    const merged = mergeMenus(mkRegistry(), [
      mkOverride({ menu_key: "ghost", label: "幽灵菜单", sort_order: 0, hidden: true }),
      mkOverride({ menu_key: "home", label: "主页" }),
    ]);
    expect(merged).toHaveLength(5);
    expect(merged.find((m) => m.menuKey === "home")!.menuLabel).toBe("主页");
    expect(merged.find((m) => m.menuKey === "ghost")).toBeUndefined();
  });

  it("整批全是孤儿 → 完全直通", () => {
    const registry = mkRegistry();
    const merged = mergeMenus(registry, [
      mkOverride({ menu_key: "a", hidden: true }),
      mkOverride({ menu_key: "b", sort_order: 0 }),
    ]);
    expect(merged).toEqual(registry);
  });
});

/* ------------------------------------------------------------------ */
/*  useMenuOverrides 降级（NFR-02 / FR-05「拉取失败降级」）              */
/* ------------------------------------------------------------------ */

const apiFetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiFetch: apiFetchMock };
});

function mkQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

function wrapper(client: QueryClient) {
  return function QueryWrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children);
  };
}

describe("useMenuOverrides：降级语义（NFR-02）", () => {
  it("成功 → overrides = 接口 items", async () => {
    const items: MenuOverrideRead[] = [
      mkOverride({ menu_key: "home", label: "主页" }),
    ];
    apiFetchMock.mockResolvedValue({ items });
    const { result } = renderHook(() => useMenuOverrides(), {
      wrapper: wrapper(mkQueryClient()),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isError).toBe(false);
    expect(result.current.overrides).toEqual(items);
    expect(apiFetchMock).toHaveBeenCalledWith("/api/menu-overrides");
  });

  it("首帧加载中 → overrides 为空数组（不阻塞导航渲染）", () => {
    apiFetchMock.mockReturnValue(new Promise(() => {})); // 永不 resolve
    const { result } = renderHook(() => useMenuOverrides(), {
      wrapper: wrapper(mkQueryClient()),
    });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.overrides).toEqual([]);
  });

  it("拉取失败（5xx）→ isError=true 且 overrides 恒为空数组（直通降级）", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError(500, {
        code: "INTERNAL_ERROR",
        message: "服务器内部错误",
        request_id: null,
        details: null,
      }),
    );
    const { result } = renderHook(() => useMenuOverrides(), {
      wrapper: wrapper(mkQueryClient()),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.overrides).toEqual([]);
  });
});
