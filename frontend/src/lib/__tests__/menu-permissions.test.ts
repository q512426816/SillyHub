import { describe, expect, it } from "vitest";

import type { MenuSection } from "../menu-permissions";
import { MENU_PERMISSION_GROUPS } from "../menu-permissions";

/**
 * 后端 Permission 枚举镜像常量（69 项）。
 *
 * 与 `backend/app/modules/auth/permissions.py` 的 `Permission` StrEnum 保持同步。
 * 若后端扩/删枚举，需同时更新本常量；用例 5 会在漂移时失败提示。
 *
 * 分组顺序与后端一致：
 * - Platform (8, 含 2026-06-18 ql-004/005 新增的 4 个管理子菜单独立 admin 权限
 *   + 2026-07-29-sidebar-menu-restructure 新增 llm_provider:read)
 * - Workspace (4)
 * - Workspace 子菜单独立 read (6, 2026-06-18 ql-003 新增)
 * - Change (5)
 * - Task (6)
 * - Code (4)
 * - Deploy (3)
 * - Tool (4)
 * - Admin (7)
 * - PPM (8, change 2026-07-20-ppm-permission-simplify task-04 精简：删 16 个 write/delete/export/assign 摆设动作)
 * - 菜单读权限 + 菜单管理门控 (5, 2026-09-18-web-menu-management task-01 新增)
 */
const BACKEND_PERMISSION_KEYS = [
  // Platform (8, ql-004 新增 3 个管理子菜单 admin + ql-005 新增 git_identity:admin
  // + 2026-07-29-sidebar-menu-restructure 新增 llm_provider:read)
  "platform:admin",
  "platform:billing",
  "platform:audit:read",
  "settings:admin",
  "api_key:admin",
  "runtime:admin",
  "git_identity:admin",
  "llm_provider:read",
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
  // PPM 项目与问题管理 (17, 已删问题变更 + 新增 weekly-plan:view)
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
  // 实施计划汇总(weekly-plan 汇总视图)
  "ppm:weekly-plan:view",
  // ── 菜单读权限 + 菜单管理门控（2026-09-18-web-menu-management task-01 / FR-01，5 项）──
  // 4 个原常显菜单（技能管理/MCP 资产库/智能体档案/智能体会话）补独立 read 权限
  // 按角色开关；menu:admin 门控菜单管理页与覆盖写端点。
  "skill:read",
  "mcp:read",
  "agent_profile:read",
  "agent_session:read",
  "menu:admin",
] as const;

/** menuKey 期望集合（2026-09-18-web-menu-management task-08 system 组新增 menus） */
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
  // 2026-07-29-sidebar-menu-restructure 新增（D-002/D-003）
  "llm-providers",
  "skills",
  "mcp",
  // 2026-08-04-agent-profile-ui-redesign 新增（D-001/D-007，agent 组全局卡片墙一级菜单）
  "agent-profiles",
  // 2026-08-14-sessions-portal task-10 新增（agent 组会话总入口一级菜单）
  "sessions",
  "approvals",
  "audit",
  "incidents",
  "users",
  "organizations",
  "roles",
  "runtimes",
  "settings",
  // 2026-09-18-web-menu-management task-08 新增（system 组菜单管理页入口）
  "menus",
  // PPM 14 条
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
  "ppm-weekly-plan",
]);

const VALID_SECTIONS: ReadonlySet<string> = new Set([
  "workspace",
  "agent",
  "config",
  "governance",
  "system",
  "ppm",
]);

describe("MENU_PERMISSION_GROUPS 数据完整性", () => {
  it("MENU_PERMISSION_GROUPS 长度 === 38（task-08 新增 menus 菜单项）", () => {
    expect(MENU_PERMISSION_GROUPS).toHaveLength(38);
  });

  it("所有 menuKey 互不重复，且严格等于 FR-02 预定义清单", () => {
    const keys = MENU_PERMISSION_GROUPS.map((g) => g.menuKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(keys)).toEqual(EXPECTED_MENU_KEYS);
  });

  it("section 字段只能是 workspace/agent/config/governance/system/ppm 之一", () => {
    MENU_PERMISSION_GROUPS.forEach((g) => {
      expect(VALID_SECTIONS.has(g.section)).toBe(true);
    });
  });

  it("section 分布：workspace 8 / agent 4 / config 4 / governance 3 / system 5 / ppm 14（task-08 system 组新增 menus）", () => {
    const counter: Record<MenuSection, number> = {
      workspace: 0,
      agent: 0,
      config: 0,
      governance: 0,
      system: 0,
      ppm: 0,
    };
    MENU_PERMISSION_GROUPS.forEach((g) => {
      counter[g.section] += 1;
    });
    expect(counter.workspace).toBe(8);
    expect(counter.agent).toBe(4);
    expect(counter.config).toBe(4);
    expect(counter.governance).toBe(3);
    expect(counter.system).toBe(5);
    expect(counter.ppm).toBe(14);
  });

  it("每个 menu 至少 1 个 permission（task-08 FR-01 后无空 permissions 菜单）", () => {
    MENU_PERMISSION_GROUPS.forEach((g) => {
      expect(g.permissions.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("4 个原常显菜单挂独立 read 权限（task-08 FR-01：可按角色分配/收回）", () => {
    const EXPECTED: Record<string, string> = {
      skills: "skill:read",
      mcp: "mcp:read",
      "agent-profiles": "agent_profile:read",
      sessions: "agent_session:read",
    };
    Object.entries(EXPECTED).forEach(([menuKey, permKey]) => {
      const g = MENU_PERMISSION_GROUPS.find((x) => x.menuKey === menuKey);
      expect(g, `missing menu ${menuKey}`).toBeDefined();
      expect(g!.permissions.map((p) => p.key)).toEqual([permKey]);
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

  it("所有 menu 都不设 pickerHidden（task-08 后 skills/mcp 补独立权限进勾选器，无例外）", () => {
    // 验证全表无 pickerHidden=true 残留（原 skills/mcp 空权限例外已随 FR-01 权限化移除）
    MENU_PERMISSION_GROUPS.forEach((g) => {
      expect(g.pickerHidden).toBeFalsy();
    });
  });

  it("所有 permission.key 命中 BACKEND_PERMISSION_KEYS，且镜像常量长度 === 69", () => {
    const valid = new Set<string>(BACKEND_PERMISSION_KEYS);
    // 镜像常量自身的完整性护栏：若被误删/重复，立即失败
    // 64 (原) + 5 (2026-09-18-web-menu-management task-01 新增菜单读权限 + menu:admin) = 69
    expect(BACKEND_PERMISSION_KEYS.length).toBe(69);
    expect(valid.size).toBe(69);

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

  it("runtimes 菜单应有 1 个 permission (runtime:admin；对齐后端 require_permission_any(RUNTIME_ADMIN))，且归入 config 组（D-006）", () => {
    const g = MENU_PERMISSION_GROUPS.find((x) => x.menuKey === "runtimes");
    expect(g).toBeDefined();
    const keys = g!.permissions.map((p) => p.key).sort();
    expect(keys).toEqual(["runtime:admin"]);
    expect(g!.permissions.length).toBe(1);
    expect(g!.section).toBe("config");
  });

  it("新增 llm-providers 菜单：config 组 /settings/providers + llm_provider:read（design §7.1）", () => {
    const g = MENU_PERMISSION_GROUPS.find((x) => x.menuKey === "llm-providers");
    expect(g).toBeDefined();
    expect(g!.section).toBe("config");
    expect(g!.menuLabel).toBe("我的供应商");
    expect(g!.href).toBe("/settings/providers");
    expect(g!.absolute).toBe(true);
    expect(g!.matchPattern).toBe("/settings/providers");
    expect(g!.permissions).toEqual([{ key: "llm_provider:read", name: "供应商管理" }]);
  });

  it("skills 菜单：agent 组 /settings/skills + skill:read 门控（task-08 FR-01 权限化，进角色勾选器）", () => {
    const g = MENU_PERMISSION_GROUPS.find((x) => x.menuKey === "skills");
    expect(g).toBeDefined();
    expect(g!.section).toBe("agent");
    expect(g!.menuLabel).toBe("技能管理");
    expect(g!.href).toBe("/settings/skills");
    expect(g!.absolute).toBe(true);
    expect(g!.matchPattern).toBe("/settings/skills");
    // 2026-09-18-web-menu-management FR-01：改挂独立 skill:read（去 pickerHidden 进勾选器）
    expect(g!.permissions).toEqual([{ key: "skill:read", name: "技能查看" }]);
    expect(g!.pickerHidden).toBeFalsy();
  });

  it("mcp 菜单：agent 组 /settings/mcp + mcp:read 门控（task-08 FR-01 权限化，进角色勾选器）", () => {
    const g = MENU_PERMISSION_GROUPS.find((x) => x.menuKey === "mcp");
    expect(g).toBeDefined();
    expect(g!.section).toBe("agent");
    expect(g!.menuLabel).toBe("MCP 资产库");
    expect(g!.href).toBe("/settings/mcp");
    expect(g!.absolute).toBe(true);
    expect(g!.matchPattern).toBe("/settings/mcp");
    // 2026-09-18-web-menu-management FR-01：改挂独立 mcp:read（去 pickerHidden 进勾选器）；
    // 库读写仍由 API 层权限矩阵控制（非 admin 平台库写 403）
    expect(g!.permissions).toEqual([{ key: "mcp:read", name: "MCP 查看" }]);
    expect(g!.pickerHidden).toBeFalsy();
  });

  it("agent-profiles 菜单：agent 组 /agent-profiles + agent_profile:read 门控（task-08 FR-01 权限化）", () => {
    const g = MENU_PERMISSION_GROUPS.find((x) => x.menuKey === "agent-profiles");
    expect(g).toBeDefined();
    expect(g!.section).toBe("agent");
    expect(g!.menuLabel).toBe("智能体档案");
    expect(g!.href).toBe("/agent-profiles");
    expect(g!.absolute).toBe(true);
    expect(g!.matchPattern).toBe("/agent-profiles");
    // 2026-09-18-web-menu-management FR-01：permissions 由 []（登录即可见）改为
    // 独立 agent_profile:read，可在角色管理按角色分配/收回
    expect(g!.permissions).toEqual([
      { key: "agent_profile:read", name: "智能体档案查看" },
    ]);
  });

  it("sessions 菜单：agent 组 /sessions + agent_session:read 门控（task-08 FR-01 权限化）", () => {
    const g = MENU_PERMISSION_GROUPS.find((x) => x.menuKey === "sessions");
    expect(g).toBeDefined();
    expect(g!.section).toBe("agent");
    expect(g!.menuLabel).toBe("智能体会话");
    expect(g!.href).toBe("/sessions");
    expect(g!.absolute).toBe(true);
    expect(g!.matchPattern).toBe("/sessions");
    // 2026-09-18-web-menu-management FR-01：permissions 由 []（登录即可见）改为
    // 独立 agent_session:read；会话列表后端仍按 user_id 隔离
    expect(g!.permissions).toEqual([
      { key: "agent_session:read", name: "智能体会话查看" },
    ]);
  });

  it("新增 menus 菜单：system 组 /admin/menus + menu:admin 门控（task-08 / R-03 注册表登记）", () => {
    const g = MENU_PERMISSION_GROUPS.find((x) => x.menuKey === "menus");
    expect(g).toBeDefined();
    expect(g!.section).toBe("system");
    expect(g!.menuLabel).toBe("菜单管理");
    expect(g!.href).toBe("/admin/menus");
    expect(g!.absolute).toBe(true);
    expect(g!.matchPattern).toBe("/admin/menus");
    // menu:admin 门控管理页入口与覆盖写端点（platform:admin 自动通过）；
    // hidden 覆盖豁免（防自锁 R-03）归 mergeMenus，此处只登记注册表数据
    expect(g!.permissions).toEqual([{ key: "menu:admin", name: "菜单管理" }]);
    expect(g!.pickerHidden).toBeFalsy();
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

  it("ppm-weekly-plan = ppm:weekly-plan:view", () => {
    expect(keysOf("ppm-weekly-plan")).toEqual(["ppm:weekly-plan:view"]);
  });
});

describe("PPM 菜单 section 与 absolute 完整性", () => {
  it("14 个 ppm 菜单全部 section=ppm 且 absolute=true，href 以 /ppm/ 开头", () => {
    const ppmMenus = MENU_PERMISSION_GROUPS.filter((g) => g.section === "ppm");
    expect(ppmMenus).toHaveLength(14);
    ppmMenus.forEach((g) => {
      expect(g.absolute).toBe(true);
      expect(g.href.startsWith("/ppm/")).toBe(true);
      expect(g.matchPattern?.startsWith("/ppm/")).toBe(true);
    });
  });
});
