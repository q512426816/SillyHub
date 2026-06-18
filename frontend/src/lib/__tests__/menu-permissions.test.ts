import { describe, expect, it } from "vitest";

import type { MenuSection } from "../menu-permissions";
import { MENU_PERMISSION_GROUPS } from "../menu-permissions";

/**
 * 后端 Permission 枚举镜像常量（36 项）。
 *
 * 与 `backend/app/modules/auth/permissions.py` 的 `Permission` StrEnum 保持同步。
 * 若后端扩/删枚举，需同时更新本常量；用例 5 会在漂移时失败提示。
 *
 * 分组顺序与后端一致：
 * - Platform (3)
 * - Workspace (4)
 * - Change (5)
 * - Task (6)
 * - Code (4)
 * - Deploy (3)
 * - Tool (4)
 * - Admin (7)
 *
 * 合计 3 + 4 + 5 + 6 + 4 + 3 + 4 + 7 = 36。
 */
const BACKEND_PERMISSION_KEYS = [
  // Platform (3)
  "platform:admin",
  "platform:billing",
  "platform:audit:read",
  // Workspace (4)
  "workspace:read",
  "workspace:write",
  "workspace:admin",
  "workspace:member:manage",
  // Change (5)
  "change:create",
  "change:read",
  "change:update",
  "change:approve",
  "change:archive",
  // Task (6)
  "task:read",
  "task:create",
  "task:assign",
  "task:run_agent",
  "task:cancel",
  "task:approve",
  // Code (4)
  "code:read",
  "code:write",
  "code:review",
  "code:merge",
  // Deploy (3)
  "deploy:staging",
  "deploy:production",
  "deploy:rollback",
  // Tool (4)
  "tool:shell_exec",
  "tool:network",
  "tool:database",
  "tool:secret:read",
  // Admin (7)
  "user:read",
  "user:write",
  "user:login:manage",
  "organization:read",
  "organization:write",
  "role:read",
  "role:write",
] as const;

/** 19 个 menuKey 期望集合（FR-02 清单） */
const EXPECTED_MENU_KEYS: ReadonlySet<string> = new Set([
  "workspaces",
  "components",
  "topology",
  "changes",
  "scan-docs",
  "runtime",
  "knowledge",
  "releases",
  "git-identities",
  "api-keys",
  "agent",
  "approvals",
  "audit",
  "incidents",
  "users",
  "organizations",
  "roles",
  "runtimes",
  "settings",
]);

const VALID_SECTIONS: ReadonlySet<string> = new Set([
  "overview",
  "management",
  "admin",
  "system",
]);

describe("MENU_PERMISSION_GROUPS 数据完整性", () => {
  it("MENU_PERMISSION_GROUPS 长度 === 19", () => {
    expect(MENU_PERMISSION_GROUPS).toHaveLength(19);
  });

  it("所有 menuKey 互不重复，且严格等于 FR-02 预定义清单", () => {
    const keys = MENU_PERMISSION_GROUPS.map((g) => g.menuKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(keys)).toEqual(EXPECTED_MENU_KEYS);
  });

  it("section 字段只能是 overview/management/admin/system 之一", () => {
    MENU_PERMISSION_GROUPS.forEach((g) => {
      expect(VALID_SECTIONS.has(g.section)).toBe(true);
    });
  });

  it("section 分布：overview 8 / management 6 / admin 3 / system 2", () => {
    const counter: Record<MenuSection, number> = {
      overview: 0,
      management: 0,
      admin: 0,
      system: 0,
    };
    MENU_PERMISSION_GROUPS.forEach((g) => {
      counter[g.section] += 1;
    });
    expect(counter.overview).toBe(8);
    expect(counter.management).toBe(6);
    expect(counter.admin).toBe(3);
    expect(counter.system).toBe(2);
  });

  it("每个 menu 至少 1 个 permission", () => {
    MENU_PERMISSION_GROUPS.forEach((g) => {
      expect(g.permissions.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("所有 permission.key 命中 BACKEND_PERMISSION_KEYS，且镜像常量长度 === 36", () => {
    const valid = new Set<string>(BACKEND_PERMISSION_KEYS);
    // 镜像常量自身的完整性护栏：若被误删/重复，立即失败
    expect(BACKEND_PERMISSION_KEYS.length).toBe(36);
    expect(valid.size).toBe(36);

    MENU_PERMISSION_GROUPS.forEach((g) => {
      g.permissions.forEach((p) => {
        expect(valid.has(p.key)).toBe(true);
      });
    });
  });

  it("兜底菜单 components/topology/scan-docs/knowledge/incidents 必须包含 workspace:read", () => {
    const FALLBACK = ["components", "topology", "scan-docs", "knowledge", "incidents"];
    FALLBACK.forEach((menuKey) => {
      const g = MENU_PERMISSION_GROUPS.find((x) => x.menuKey === menuKey);
      expect(g).toBeDefined();
      const keys = g!.permissions.map((p) => p.key);
      expect(keys).toContain("workspace:read");
    });
  });

  it("每条记录 menuLabel / icon / href 是非空字符串", () => {
    MENU_PERMISSION_GROUPS.forEach((g) => {
      expect(typeof g.menuLabel).toBe("string");
      expect(g.menuLabel.length).toBeGreaterThan(0);
      expect(typeof g.icon).toBe("string");
      expect(g.icon.length).toBeGreaterThan(0);
      expect(typeof g.href).toBe("string");
      expect(g.href.length).toBeGreaterThan(0);
    });
  });

  it("permission.name 是非空字符串", () => {
    MENU_PERMISSION_GROUPS.forEach((g) => {
      g.permissions.forEach((p) => {
        expect(typeof p.name).toBe("string");
        expect(p.name.length).toBeGreaterThan(0);
      });
    });
  });

  it("workspaces 菜单应有 4 个 permissions (workspace:read/write/admin/member:manage)", () => {
    const g = MENU_PERMISSION_GROUPS.find((x) => x.menuKey === "workspaces");
    expect(g).toBeDefined();
    const keys = g!.permissions.map((p) => p.key).sort();
    expect(keys).toEqual(
      ["workspace:admin", "workspace:member:manage", "workspace:read", "workspace:write"].sort(),
    );
    expect(g!.permissions.length).toBe(4);
  });

  it("settings 菜单应有 3 个 permissions (platform:admin/billing + user:read)", () => {
    const g = MENU_PERMISSION_GROUPS.find((x) => x.menuKey === "settings");
    expect(g).toBeDefined();
    const keys = g!.permissions.map((p) => p.key).sort();
    expect(keys).toEqual(["platform:admin", "platform:billing", "user:read"].sort());
    expect(g!.permissions.length).toBe(3);
  });

  it("agent 菜单应有 13 个 permissions (task 5 + code 4 + tool 4)", () => {
    const g = MENU_PERMISSION_GROUPS.find((x) => x.menuKey === "agent");
    expect(g).toBeDefined();
    expect(g!.permissions.length).toBe(13);
    const keys = g!.permissions.map((p) => p.key).sort();
    expect(keys).toEqual(
      [
        "task:read",
        "task:create",
        "task:assign",
        "task:run_agent",
        "task:cancel",
        "code:read",
        "code:write",
        "code:review",
        "code:merge",
        "tool:shell_exec",
        "tool:network",
        "tool:database",
        "tool:secret:read",
      ].sort(),
    );
  });
});

describe("用户列明菜单的 permissions 精确匹配", () => {
  function keysOf(menuKey: string): string[] {
    const g = MENU_PERMISSION_GROUPS.find((x) => x.menuKey === menuKey);
    if (!g) throw new Error(`missing menu ${menuKey}`);
    return g.permissions.map((p) => p.key).sort();
  }

  it("users = user:login:manage + user:read + user:write", () => {
    expect(keysOf("users")).toEqual(["user:login:manage", "user:read", "user:write"].sort());
  });

  it("organizations = organization:read + organization:write", () => {
    expect(keysOf("organizations")).toEqual(["organization:read", "organization:write"].sort());
  });

  it("roles = role:read + role:write", () => {
    expect(keysOf("roles")).toEqual(["role:read", "role:write"].sort());
  });

  it("changes = change:create/read/update/approve/archive", () => {
    expect(keysOf("changes")).toEqual(
      ["change:approve", "change:archive", "change:create", "change:read", "change:update"].sort(),
    );
  });

  it("audit = platform:audit:read", () => {
    expect(keysOf("audit")).toEqual(["platform:audit:read"]);
  });

  it("releases = deploy:staging/production/rollback", () => {
    expect(keysOf("releases")).toEqual(
      ["deploy:production", "deploy:rollback", "deploy:staging"].sort(),
    );
  });
});
