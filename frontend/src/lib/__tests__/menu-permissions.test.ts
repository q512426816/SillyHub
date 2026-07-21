import { describe, expect, it } from "vitest";

import type { MenuSection } from "../menu-permissions";
import { MENU_PERMISSION_GROUPS } from "../menu-permissions";

/**
 * 后端 Permission 枚举镜像常量（70 项）。
 *
 * 与 `backend/app/modules/auth/permissions.py` 的 `Permission` StrEnum 保持同步。
 * 若后端扩/删枚举，需同时更新本常量；用例 5 会在漂移时失败提示。
 *
 * 分组顺序与后端一致：
 * - Platform (7, 含 2026-06-18 ql-004/005 新增的 4 个管理子菜单独立 admin 权限)
 * - Workspace (4)
 * - Workspace 子菜单独立 read (6, 2026-06-18 ql-003 新增)
 * - Change (5)
 * - Task (6)
 * - Code (4)
 * - Deploy (3)
 * - Tool (4)
 * - Admin (7)
 * - PPM (8, change 2026-07-20-ppm-permission-simplify task-04 精简：删 16 个 write/delete/export/assign 摆设动作)
 *
 * 合计 7 + 4 + 6 + 5 + 6 + 4 + 3 + 4 + 7 + 8 = 54。
 */
const BACKEND_PERMISSION_KEYS = [
  // Platform (7, ql-004 新增 3 个管理子菜单 admin + ql-005 新增 git_identity:admin)
  "platform:admin",
  "platform:billing",
  "platform:audit:read",
  "settings:admin",
  "api_key:admin",
  "runtime:admin",
  "git_identity:admin",
  // Workspace (4)
  "workspace:read",
  "workspace:write",
  "workspace:admin",
  "workspace:member:manage",
  // Workspace 子菜单独立 read (6, 2026-06-18 ql-003 新增)
  "component:read",
  "topology:read",
  "scan-docs:read",
  "runtime:read",
  "knowledge:read",
  "incident:read",
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
  // PPM 项目与问题管理 (16, 已删问题变更)
  "ppm:project:read",
  "ppm:customer:read",
  "ppm:plan:read",
  "ppm:problem:read",
  "ppm:task:read",
  "ppm:work-hour:read",
  "ppm:work-hour:stat",
  "ppm:kanban:view",
  // ── 菜单专属权限（13 菜单各独立 key；plan/problem/task:read 3 旧 key 悬空保留）──
  "ppm:workbench:view",
  "ppm:project-member:read",
  "ppm:project-stakeholder:read",
  "ppm:project-plan:read",
  "ppm:plan-node:read",
  "ppm:milestone-detail:read",
  "ppm:problem-list:read",
  "ppm:task-plan:read",
] as const;

/** 33 个 menuKey 期望集合（FR-02 19 条 + Agent 团队 1 + PPM 13 条） */
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
  "missions",
  "approvals",
  "audit",
  "incidents",
  "users",
  "organizations",
  "roles",
  "runtimes",
  "settings",
  // PPM 13 条（已删问题变更）
  "ppm-workbench",
  "ppm-projects",
  "ppm-customers",
  "ppm-project-members",
  "ppm-project-stakeholders",
  "ppm-project-plans",
  "ppm-plan-nodes",
  "ppm-milestone-details",
  "ppm-problem-list",
  "ppm-task-plans",
  "ppm-work-hours",
  "ppm-work-hour-statistics",
  "ppm-kanban",
]);

const VALID_SECTIONS: ReadonlySet<string> = new Set([
  "overview",
  "management",
  "admin",
  "system",
  "ppm",
]);

describe("MENU_PERMISSION_GROUPS 数据完整性", () => {
  it("MENU_PERMISSION_GROUPS 长度 === 33", () => {
    expect(MENU_PERMISSION_GROUPS).toHaveLength(33);
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

  it("section 分布：overview 8 / management 7 / ppm 13 / admin 3 / system 2", () => {
    const counter: Record<MenuSection, number> = {
      overview: 0,
      management: 0,
      ppm: 0,
      admin: 0,
      system: 0,
    };
    MENU_PERMISSION_GROUPS.forEach((g) => {
      counter[g.section] += 1;
    });
    expect(counter.overview).toBe(8);
    expect(counter.management).toBe(7);
    expect(counter.ppm).toBe(13);
    expect(counter.admin).toBe(3);
    expect(counter.system).toBe(2);
  });

  it("每个 menu 至少 1 个 permission", () => {
    MENU_PERMISSION_GROUPS.forEach((g) => {
      expect(g.permissions.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("git-identities 菜单应有 1 个 permission (git_identity:admin；对齐后端 require_permission_any(GIT_IDENTITY_ADMIN))", () => {
    const g = MENU_PERMISSION_GROUPS.find((x) => x.menuKey === "git-identities");
    expect(g).toBeDefined();
    const keys = g!.permissions.map((p) => p.key).sort();
    expect(keys).toEqual(["git_identity:admin"]);
    expect(g!.permissions.length).toBe(1);
    // ql-005: 移除 pickerHidden，picker 现在渲染该 menu 卡片
    expect(g!.pickerHidden).toBeFalsy();
  });

  it("所有 menu 都不设 pickerHidden（ql-005 移除 git-identities 的 pickerHidden）", () => {
    // 验证全表无 pickerHidden=true 残留
    MENU_PERMISSION_GROUPS.forEach((g) => {
      expect(g.pickerHidden).toBeFalsy();
    });
  });

  it("所有 permission.key 命中 BACKEND_PERMISSION_KEYS，且镜像常量长度 === 63", () => {
    const valid = new Set<string>(BACKEND_PERMISSION_KEYS);
    // 镜像常量自身的完整性护栏：若被误删/重复，立即失败
    // 46 (非 PPM) + 16 (PPM 菜单/读，已删问题变更) = 62
    expect(BACKEND_PERMISSION_KEYS.length).toBe(62);
    expect(valid.size).toBe(62);

    MENU_PERMISSION_GROUPS.forEach((g) => {
      g.permissions.forEach((p) => {
        expect(valid.has(p.key)).toBe(true);
      });
    });
  });

  it("6 个子菜单有独立 read 权限（不再共用 workspace:read）", () => {
    const EXPECTED: Record<string, string> = {
      components: "component:read",
      topology: "topology:read",
      "scan-docs": "scan-docs:read",
      runtime: "runtime:read",
      knowledge: "knowledge:read",
      incidents: "incident:read",
    };
    Object.entries(EXPECTED).forEach(([menuKey, permKey]) => {
      const g = MENU_PERMISSION_GROUPS.find((x) => x.menuKey === menuKey);
      expect(g, `missing menu ${menuKey}`).toBeDefined();
      const keys = g!.permissions.map((p) => p.key);
      expect(keys).toContain(permKey);
      // 不应再用 workspace:read 兜底
      expect(keys).not.toContain("workspace:read");
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

  it("settings 菜单应有 1 个 permission (settings:admin；对齐后端 require_permission_any(SETTINGS_ADMIN))", () => {
    const g = MENU_PERMISSION_GROUPS.find((x) => x.menuKey === "settings");
    expect(g).toBeDefined();
    const keys = g!.permissions.map((p) => p.key).sort();
    expect(keys).toEqual(["settings:admin"]);
    expect(g!.permissions.length).toBe(1);
  });

  it("api-keys 菜单应有 1 个 permission (api_key:admin；对齐后端 require_permission_any(API_KEY_ADMIN))", () => {
    const g = MENU_PERMISSION_GROUPS.find((x) => x.menuKey === "api-keys");
    expect(g).toBeDefined();
    const keys = g!.permissions.map((p) => p.key).sort();
    expect(keys).toEqual(["api_key:admin"]);
    expect(g!.permissions.length).toBe(1);
  });

  it("runtimes 菜单应有 1 个 permission (runtime:admin；对齐后端 require_permission_any(RUNTIME_ADMIN))", () => {
    const g = MENU_PERMISSION_GROUPS.find((x) => x.menuKey === "runtimes");
    expect(g).toBeDefined();
    const keys = g!.permissions.map((p) => p.key).sort();
    expect(keys).toEqual(["runtime:admin"]);
    expect(g!.permissions.length).toBe(1);
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

  it("ppm-projects = ppm:project:read", () => {
    expect(keysOf("ppm-projects")).toEqual(["ppm:project:read"]);
  });

  it("ppm-milestone-details = ppm:milestone-detail:read", () => {
    expect(keysOf("ppm-milestone-details")).toEqual(["ppm:milestone-detail:read"]);
  });

  it("ppm-problem-list = ppm:problem-list:read", () => {
    expect(keysOf("ppm-problem-list")).toEqual(["ppm:problem-list:read"]);
  });

  it("ppm-kanban = ppm:kanban:view", () => {
    expect(keysOf("ppm-kanban")).toEqual(["ppm:kanban:view"]);
  });

  it("ppm-work-hour-statistics = ppm:work-hour:stat", () => {
    expect(keysOf("ppm-work-hour-statistics")).toEqual(["ppm:work-hour:stat"]);
  });

  it("ppm-project-members = ppm:project-member:read（change 2026-07-20-ppm-menu-unique-keys 菜单专属 key）", () => {
    expect(keysOf("ppm-project-members")).toEqual(["ppm:project-member:read"]);
  });

  it("ppm-workbench = ppm:workbench:view", () => {
    expect(keysOf("ppm-workbench")).toEqual(["ppm:workbench:view"]);
  });

  it("ppm-project-stakeholders = ppm:project-stakeholder:read", () => {
    expect(keysOf("ppm-project-stakeholders")).toEqual(["ppm:project-stakeholder:read"]);
  });

  it("ppm-project-plans = ppm:project-plan:read", () => {
    expect(keysOf("ppm-project-plans")).toEqual(["ppm:project-plan:read"]);
  });

  it("ppm-plan-nodes = ppm:plan-node:read", () => {
    expect(keysOf("ppm-plan-nodes")).toEqual(["ppm:plan-node:read"]);
  });

  it("ppm-task-plans = ppm:task-plan:read", () => {
    expect(keysOf("ppm-task-plans")).toEqual(["ppm:task-plan:read"]);
  });
});

describe("PPM 菜单 section 与 absolute 完整性", () => {
  it("13 个 ppm 菜单全部 section=ppm 且 absolute=true，href 以 /ppm/ 开头", () => {
    const ppmMenus = MENU_PERMISSION_GROUPS.filter((g) => g.section === "ppm");
    expect(ppmMenus).toHaveLength(13);
    ppmMenus.forEach((g) => {
      expect(g.absolute).toBe(true);
      expect(g.href.startsWith("/ppm/")).toBe(true);
      expect(g.matchPattern?.startsWith("/ppm/")).toBe(true);
    });
  });
});
