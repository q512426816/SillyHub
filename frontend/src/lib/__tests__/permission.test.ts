import { describe, expect, it } from "vitest";

import {
  canSeeMenu,
  hasAnyPermission,
  visibleMenusBySection,
} from "@/lib/permission";
import {
  MENU_PERMISSION_GROUPS,
  type MenuPermissionGroup,
  type MenuSection,
} from "@/lib/menu-permissions";
import type { SessionUser } from "@/stores/session";

/**
 * SessionUser 工厂函数：避免每个用例共享引用造成污染。
 * 默认非管理员 + 空 permissions，用例通过 overrides 表达场景。
 */
function mkUser(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: "u1",
    email: "test@example.com",
    displayName: "Test",
    permissions: [],
    ...overrides,
  };
}

const usersGroup: MenuPermissionGroup | undefined = MENU_PERMISSION_GROUPS.find(
  (g) => g.menuKey === "users",
);

describe("hasAnyPermission", () => {
  it("FR-04 #1: returns false when perms do not intersect user permissions", () => {
    // Given user.permissions = ["user:read"]
    // When hasAnyPermission(user, ["user:write", "user:login:manage"])
    // Then false
    const user = mkUser({ permissions: ["user:read"] });
    expect(hasAnyPermission(user, ["user:write", "user:login:manage"])).toBe(
      false,
    );
  });

  it("FR-04 #2: returns true when at least one perm is held", () => {
    // Given user.permissions = ["user:read"]
    // When hasAnyPermission(user, ["user:read", "organization:read"])
    // Then true
    const user = mkUser({ permissions: ["user:read"] });
    expect(hasAnyPermission(user, ["user:read", "organization:read"])).toBe(
      true,
    );
  });

  it("FR-04 #3: returns true (short-circuit) when is_platform_admin = true even with empty perms", () => {
    // Given is_platform_admin = true
    // When hasAnyPermission(user, [])
    // Then true
    const user = mkUser({ is_platform_admin: true, permissions: [] });
    expect(hasAnyPermission(user, [])).toBe(true);
  });

  it("FR-04 #4: returns false when user is null", () => {
    // Given user = null
    // When hasAnyPermission(null, ["user:read"])
    // Then false
    expect(hasAnyPermission(null, ["user:read"])).toBe(false);
  });

  it("boundary: returns false when user.permissions is undefined", () => {
    // Given user.permissions = undefined（缺省字段）
    // When hasAnyPermission(user, ["user:read"])
    // Then false
    const user = mkUser({ permissions: undefined });
    expect(hasAnyPermission(user, ["user:read"])).toBe(false);
  });

  it("boundary: returns false when user.permissions is [] and not admin", () => {
    // 短路逻辑只在 is_platform_admin = true 时触发；
    // 非 admin + 空权限 → 任意 perms 输入均 false。
    const user = mkUser({ is_platform_admin: false, permissions: [] });
    expect(hasAnyPermission(user, ["user:read"])).toBe(false);
  });

  it("boundary: returns false when perms input is [] and user is not admin", () => {
    // 非 admin + 空查询 perms → false（实现中显式检查 perms.length === 0）
    const user = mkUser({ permissions: ["user:read"] });
    expect(hasAnyPermission(user, [])).toBe(false);
  });
});

describe("canSeeMenu", () => {
  it("FR-05 #1: returns true when user holds any permission declared by menu group", () => {
    // Given user.permissions = ["user:read"], group = users
    // When canSeeMenu(user, usersGroup)
    // Then true
    const user = mkUser({ permissions: ["user:read"] });
    expect(canSeeMenu(user, usersGroup!)).toBe(true);
  });

  it("FR-05 #2: returns false when user permissions do not intersect menu group", () => {
    // Given user.permissions = ["organization:read"], group = users
    // When canSeeMenu(user, usersGroup)
    // Then false
    const user = mkUser({ permissions: ["organization:read"] });
    expect(canSeeMenu(user, usersGroup!)).toBe(false);
  });

  it("FR-05 #3: returns true (short-circuit) for platform admin on arbitrary group", () => {
    // Given is_platform_admin = true, group = users
    // When canSeeMenu(user, usersGroup)
    // Then true
    const user = mkUser({ is_platform_admin: true, permissions: [] });
    expect(canSeeMenu(user, usersGroup!)).toBe(true);
  });

  it("boundary: returns false for null user", () => {
    expect(canSeeMenu(null, usersGroup!)).toBe(false);
  });

  it("boundary: returns false when user.permissions is [] and not admin", () => {
    const user = mkUser({ permissions: [] });
    expect(canSeeMenu(user, usersGroup!)).toBe(false);
  });

  it("boundary: empty group.permissions yields false for non-admin and true for admin", () => {
    // 构造一个 permissions 为空的 mock group，验证非 admin 看不到、admin 短路可见。
    const mockGroup: MenuPermissionGroup = {
      section: "admin",
      menuKey: "mock-empty",
      menuLabel: "Mock Empty",
      icon: "x",
      href: "/mock",
      permissions: [],
    };
    expect(canSeeMenu(mkUser({ permissions: ["user:read"] }), mockGroup)).toBe(
      false,
    );
    expect(
      canSeeMenu(
        mkUser({ is_platform_admin: true, permissions: [] }),
        mockGroup,
      ),
    ).toBe(true);
  });
});

describe("visibleMenusBySection", () => {
  it("FR-06 #1: with ['user:read'] on 'admin' returns only users (1 entry)", () => {
    // Given user.permissions = ["user:read"]
    // When visibleMenusBySection(user, "admin")
    // Then 长度 = 1 且 menuKey === "users"
    const user = mkUser({ permissions: ["user:read"] });
    const result = visibleMenusBySection(user, "admin");
    expect(result).toHaveLength(1);
    expect(result.map((g) => g.menuKey)).toEqual(["users"]);
  });

  it("FR-06 #2: with ['workspace:read'] on 'system' returns empty (no platform:admin)", () => {
    // Given user.permissions = ["workspace:read"]
    // When visibleMenusBySection(user, "system")
    // Then 空数组（system 段均为 platform:admin / platform:billing）
    const user = mkUser({ permissions: ["workspace:read"] });
    const result = visibleMenusBySection(user, "system");
    expect(result).toEqual([]);
  });

  it("FR-06 #3: platform admin sees all 3 entries in 'admin' section", () => {
    // Given is_platform_admin = true
    // When visibleMenusBySection(user, "admin")
    // Then 全部 3 条（users / organizations / roles），顺序与数据源一致
    const user = mkUser({ is_platform_admin: true, permissions: [] });
    const result = visibleMenusBySection(user, "admin");
    expect(result.map((g) => g.menuKey)).toEqual([
      "users",
      "organizations",
      "roles",
    ]);
  });

  it("FR-06 #4: with ['task:read'] on 'management' includes agent", () => {
    // Given user.permissions = ["task:read"]
    // When visibleMenusBySection(user, "management")
    // Then 至少包含 agent（不锁死其它菜单）
    const user = mkUser({ permissions: ["task:read"] });
    const result = visibleMenusBySection(user, "management");
    expect(result.some((g) => g.menuKey === "agent")).toBe(true);
  });

  it("FR-06 #5: with ['change:read'] on 'overview' includes changes", () => {
    // Given user.permissions = ["change:read"]
    // When visibleMenusBySection(user, "overview")
    // Then 至少包含 changes
    const user = mkUser({ permissions: ["change:read"] });
    const result = visibleMenusBySection(user, "overview");
    expect(result.some((g) => g.menuKey === "changes")).toBe(true);
  });

  it("boundary: returns [] for null user", () => {
    expect(visibleMenusBySection(null, "admin")).toEqual([]);
  });

  it("boundary: returns [] for non-admin user with empty permissions", () => {
    const user = mkUser({ permissions: [] });
    expect(visibleMenusBySection(user, "admin")).toEqual([]);
  });

  it("boundary: returns [] for nonexistent section at runtime (defensive)", () => {
    // 即使类型不允许，运行时若传入未知 section 也应返回 []，不抛异常。
    const user = mkUser({ permissions: ["user:read"] });
    expect(
      visibleMenusBySection(user, "nonexistent" as MenuSection),
    ).toEqual([]);
  });
});
