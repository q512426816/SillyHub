/**
 * 菜单按权限驱动显隐的单一数据源。
 *
 * 设计依据：
 * - `2026-06-18-menu-driven-permissions/design.md` §5.1（类型定义）+ §5.2（19 菜单权限映射表）
 * - 后端 Permission 枚举：`backend/app/modules/auth/permissions.py`（46 个值，含
 *   2026-06-18 ql-003 新增的 6 个子菜单独立 read 权限 + ql-004 新增的 3 个
 *   管理子菜单独立 admin 权限 + ql-005 git_identity:admin）
 *
 * 子菜单独立查看权限：每个 overview/management 子菜单有独立 read 权限
 * （component:read / topology:read / scan-docs:read / runtime:read /
 * knowledge:read / incident:read），避免共用 workspace:read 致 picker 冗余展示。
 * 后端各 router 已 require 对应权限。
 *
 * 管理菜单独立权限（ql-004/005）：所有 management/system 子菜单各有独立 admin 权限
 * （settings:admin / api_key:admin / runtime:admin / git_identity:admin），
 * 避免共用 platform:admin 致 picker 重复或缺失。后端 router 各自 require 对应权限。
 */

export type MenuSection =
  | "overview"
  | "management"
  | "admin"
  | "system"
  | "ppm";

export interface PermissionItem {
  /** 权限标识，必须命中后端 Permission 枚举 */
  key: string;
  /** 中文展示名 */
  name: string;
  /** 可选描述 */
  description?: string;
}

export interface MenuPermissionGroup {
  /** 所属 section，决定渲染分组 */
  section: MenuSection;
  /** 唯一 key，关联 nav 渲染与 picker 折叠状态 */
  menuKey: string;
  /** 菜单中文展示名 */
  menuLabel: string;
  /** emoji 图标字符串 */
  icon: string;
  /** 路由路径，relative 时拼 workspace 前缀，absolute 时直接用 */
  href: string;
  /** active 高亮判断依据，沿用 NavItem.matchPattern 语义 */
  matchPattern?: string;
  /** 是否绝对路径（不拼 workspace 前缀） */
  absolute?: boolean;
  /** 该菜单可见所需的权限列表（任一命中即可见） */
  permissions: PermissionItem[];
  /**
   * picker 隐藏标记：menu 与其他 menu 共享权限（无独立权限可配）时设 true，
   * AdminRolePermissionPicker 不渲染该 menu 卡片。canSeeMenu 仍按 permissions 判断。
   */
  pickerHidden?: boolean;
  /**
   * 侧边栏导航隐藏标记：二级页面（由其他页面跳转进入，非一级菜单）设 true，
   * app-shell 侧边栏不渲染该菜单项。路由仍可访问、权限映射/active 匹配保留。
   */
  navHidden?: boolean;
}

export const MENU_PERMISSION_GROUPS: MenuPermissionGroup[] = [
  // ── overview（8 条）──────────────────────────────────────────
  {
    section: "overview",
    menuKey: "workspaces",
    menuLabel: "工作区首页",
    icon: "\u{1F3E0}",
    href: "/workspaces",
    absolute: true,
    permissions: [
      { key: "workspace:read", name: "工作区查看" },
      { key: "workspace:write", name: "工作区编辑" },
      { key: "workspace:admin", name: "工作区管理" },
      { key: "workspace:member:manage", name: "工作区成员管理" },
    ],
  },
  {
    section: "overview",
    menuKey: "components",
    menuLabel: "项目组组件",
    icon: "\u{1F4E6}",
    href: "components",
    matchPattern: "/components",
    permissions: [{ key: "component:read", name: "组件查看" }],
  },
  {
    section: "overview",
    menuKey: "topology",
    menuLabel: "拓扑图",
    icon: "\u{1F5FA}",
    href: "components/topology",
    matchPattern: "/components/topology",
    permissions: [{ key: "topology:read", name: "拓扑查看" }],
  },
  {
    section: "overview",
    menuKey: "changes",
    menuLabel: "变更中心",
    icon: "\u{1F504}",
    href: "changes",
    matchPattern: "/changes",
    permissions: [
      { key: "change:create", name: "变更创建" },
      { key: "change:read", name: "变更查看" },
      { key: "change:update", name: "变更更新" },
      { key: "change:approve", name: "变更审批" },
      { key: "change:archive", name: "变更归档" },
    ],
  },
  {
    section: "overview",
    menuKey: "scan-docs",
    menuLabel: "扫描文档",
    icon: "\u{1F4C4}",
    href: "scan-docs",
    matchPattern: "/scan-docs",
    permissions: [{ key: "scan-docs:read", name: "扫描文档查看" }],
  },
  {
    section: "overview",
    menuKey: "runtime",
    menuLabel: "运行时",
    icon: "\u{26A1}",
    href: "runtime",
    matchPattern: "/runtime",
    permissions: [
      { key: "runtime:read", name: "运行时查看" },
      { key: "task:read", name: "任务查看" },
    ],
  },
  {
    section: "overview",
    menuKey: "knowledge",
    menuLabel: "知识 & 日志",
    icon: "\u{1F4DA}",
    href: "knowledge",
    matchPattern: "/knowledge",
    permissions: [{ key: "knowledge:read", name: "知识查看" }],
  },
  {
    section: "overview",
    menuKey: "releases",
    menuLabel: "发布",
    icon: "\u{1F680}",
    href: "releases",
    matchPattern: "/releases",
    permissions: [
      { key: "deploy:staging", name: "预发部署" },
      { key: "deploy:production", name: "生产部署" },
      { key: "deploy:rollback", name: "回滚" },
    ],
  },

  // ── management（6 条）───────────────────────────────────────
  {
    section: "management",
    menuKey: "git-identities",
    menuLabel: "Git 身份管理",
    icon: "\u{1F511}",
    href: "/settings/git-identities",
    absolute: true,
    matchPattern: "/settings/git-identities",
    // 后端 git_identity router 全部端点 require git_identity:admin
    // （platform:admin 自动通过）。
    permissions: [{ key: "git_identity:admin", name: "Git 身份访问" }],
  },
  {
    section: "management",
    menuKey: "api-keys",
    menuLabel: "API 密钥",
    icon: "\u{1F4A1}",
    href: "/settings/api-keys",
    absolute: true,
    matchPattern: "/settings/api-keys",
    // 后端 auth/router 3 个 /api-keys 端点 require api_key:admin（platform:admin 自动通过）。
    permissions: [{ key: "api_key:admin", name: "API 密钥管理" }],
  },
  {
    section: "management",
    menuKey: "agent",
    menuLabel: "智能体控制台",
    icon: "\u{1F916}",
    href: "agent",
    matchPattern: "/agent",
    permissions: [
      { key: "task:read", name: "任务查看" },
      { key: "task:create", name: "任务创建" },
      { key: "task:assign", name: "任务分配" },
      { key: "task:run_agent", name: "任务执行" },
      { key: "task:cancel", name: "任务取消" },
      { key: "code:read", name: "代码查看" },
      { key: "code:write", name: "代码编辑" },
      { key: "code:review", name: "代码审查" },
      { key: "code:merge", name: "代码合并" },
      { key: "tool:shell_exec", name: "Shell 工具" },
      { key: "tool:network", name: "网络工具" },
      { key: "tool:database", name: "数据库工具" },
      { key: "tool:secret:read", name: "密钥读取" },
    ],
  },
  {
    section: "management",
    menuKey: "missions",
    menuLabel: "Agent 团队",
    icon: "\u{1F91D}",
    href: "missions",
    matchPattern: "/missions",
    permissions: [
      { key: "workspace:write", name: "工作区写入" },
      { key: "task:read", name: "任务查看" },
    ],
  },
  {
    section: "management",
    menuKey: "approvals",
    menuLabel: "审批中心",
    icon: "✅",
    href: "approvals",
    matchPattern: "/approvals",
    permissions: [
      { key: "task:approve", name: "任务审批" },
      { key: "change:approve", name: "变更审批" },
    ],
  },
  {
    section: "management",
    menuKey: "audit",
    menuLabel: "审计中心",
    icon: "\u{1F4DC}",
    href: "audit",
    matchPattern: "/audit",
    permissions: [
      {
        key: "platform:audit:read",
        name: "平台审计读取",
        description: "跨工作空间的平台级审计日志访问",
      },
    ],
  },
  {
    section: "management",
    menuKey: "incidents",
    menuLabel: "事件",
    icon: "\u{1F6A8}",
    href: "incidents",
    matchPattern: "/incidents",
    permissions: [{ key: "incident:read", name: "事件查看" }],
  },

  // ── admin（3 条）────────────────────────────────────────────
  {
    section: "admin",
    menuKey: "users",
    menuLabel: "用户",
    icon: "\u{1F465}",
    href: "/admin/users",
    absolute: true,
    matchPattern: "/admin/users",
    permissions: [
      { key: "user:read", name: "用户查看" },
      { key: "user:write", name: "用户编辑" },
      { key: "user:login:manage", name: "登录权限管理" },
    ],
  },
  {
    section: "admin",
    menuKey: "organizations",
    menuLabel: "组织",
    icon: "\u{1F3E2}",
    href: "/admin/organizations",
    absolute: true,
    matchPattern: "/admin/organizations",
    permissions: [
      { key: "organization:read", name: "组织查看" },
      { key: "organization:write", name: "组织编辑" },
    ],
  },
  {
    section: "admin",
    menuKey: "roles",
    menuLabel: "角色",
    icon: "\u{1F511}",
    href: "/admin/roles",
    absolute: true,
    matchPattern: "/admin/roles",
    permissions: [
      { key: "role:read", name: "角色查看" },
      { key: "role:write", name: "角色编辑" },
    ],
  },

  // ── system（2 条）───────────────────────────────────────────
  {
    section: "system",
    menuKey: "runtimes",
    menuLabel: "守护进程运行时",
    icon: "\u{1F5A5}",
    href: "/runtimes",
    absolute: true,
    matchPattern: "/runtimes",
    // 后端 daemon/router 管理 UI 端点（list/get/disable/enable/leases）
    // require runtime:admin（platform:admin 自动通过）。
    permissions: [{ key: "runtime:admin", name: "守护进程运行时管理" }],
  },
  {
    section: "system",
    menuKey: "settings",
    menuLabel: "设置",
    icon: "⚙️",
    href: "/settings",
    absolute: true,
    matchPattern: "/settings",
    // 后端 settings/router 的 GET/PUT /settings require settings:admin
    // （platform:admin 自动通过）。/users 系列仍 require_platform_admin。
    permissions: [{ key: "settings:admin", name: "平台设置管理" }],
  },

  // ── ppm（13 条，平台级项目与问题管理）──────────────────────
  // change 2026-06-20-ppm-module-migration task-13：13 个 ppm 子域页面登记。
  // 全部 absolute（平台级，不拼 workspace 前缀），href 指向 /ppm/<页面>。
  // permissions 映射后端 Permission.PPM_*（task-02 产出），任一命中即可见。
  // 后端各 router 用 require_permission_any(PPM_*)，写/删操作在 router 内单独 require。
  {
    section: "ppm",
    menuKey: "ppm-workbench",
    menuLabel: "个人工作台",
    icon: "\u{1F4CA}",
    href: "/ppm/workbench",
    absolute: true,
    matchPattern: "/ppm/workbench",
    // 菜单专属 key（change 2026-07-20-ppm-menu-unique-keys，14 菜单各独立 key）。
    permissions: [{ key: "ppm:workbench:view", name: "工作台查看" }],
  },
  {
    section: "ppm",
    menuKey: "ppm-projects",
    menuLabel: "项目",
    icon: "\u{1F4C1}",
    href: "/ppm/projects",
    absolute: true,
    matchPattern: "/ppm/projects",
    permissions: [{ key: "ppm:project:read", name: "项目查看" }],
  },
  {
    section: "ppm",
    menuKey: "ppm-customers",
    menuLabel: "客户",
    icon: "\u{1F465}",
    href: "/ppm/customers",
    absolute: true,
    matchPattern: "/ppm/customers",
    permissions: [{ key: "ppm:customer:read", name: "客户查看" }],
  },
  {
    section: "ppm",
    menuKey: "ppm-project-members",
    menuLabel: "项目成员",
    icon: "\u{1F465}",
    href: "/ppm/project-members",
    absolute: true,
    matchPattern: "/ppm/project-members",
    navHidden: true, // 二级页面:由 /ppm/projects「成员管理」跳转,不在侧边栏菜单显示
    // 菜单专属 key（change 2026-07-20-ppm-menu-unique-keys）。
    permissions: [{ key: "ppm:project-member:read", name: "项目成员查看" }],
  },
  {
    section: "ppm",
    menuKey: "ppm-project-stakeholders",
    menuLabel: "干系人",
    icon: "\u{1F91D}",
    href: "/ppm/project-stakeholders",
    absolute: true,
    matchPattern: "/ppm/project-stakeholders",
    permissions: [{ key: "ppm:project-stakeholder:read", name: "干系人查看" }],
  },
  {
    section: "ppm",
    menuKey: "ppm-project-plans",
    menuLabel: "项目计划",
    icon: "\u{1F4CB}",
    href: "/ppm/project-plans",
    absolute: true,
    matchPattern: "/ppm/project-plans",
    permissions: [{ key: "ppm:project-plan:read", name: "项目计划查看" }],
  },
  {
    section: "ppm",
    menuKey: "ppm-plan-nodes",
    menuLabel: "计划节点",
    icon: "\u{1F5C2}",
    href: "/ppm/plan-nodes",
    absolute: true,
    matchPattern: "/ppm/plan-nodes",
    permissions: [{ key: "ppm:plan-node:read", name: "计划节点查看" }],
  },
  {
    section: "ppm",
    menuKey: "ppm-milestone-details",
    menuLabel: "里程碑明细",
    icon: "\u{1F3C1}",
    href: "/ppm/milestone-details",
    absolute: true,
    matchPattern: "/ppm/milestone-details",
    navHidden: true, // 二级页面:由 /ppm/project-plans「里程碑」按钮跳转,不在侧边栏菜单显示
    permissions: [{ key: "ppm:milestone-detail:read", name: "里程碑明细查看" }],
  },
  {
    section: "ppm",
    menuKey: "ppm-problem-list",
    menuLabel: "问题清单",
    icon: "\u{26A0}",
    href: "/ppm/problem-list",
    absolute: true,
    matchPattern: "/ppm/problem-list",
    permissions: [{ key: "ppm:problem-list:read", name: "问题清单查看" }],
  },
  {
    section: "ppm",
    menuKey: "ppm-task-plans",
    menuLabel: "任务计划",
    icon: "\u{1F4DD}",
    href: "/ppm/task-plans",
    absolute: true,
    matchPattern: "/ppm/task-plans",
    permissions: [{ key: "ppm:task-plan:read", name: "任务计划查看" }],
  },
  {
    section: "ppm",
    menuKey: "ppm-work-hours",
    menuLabel: "工时",
    icon: "\u{23F1}",
    href: "/ppm/work-hours",
    absolute: true,
    matchPattern: "/ppm/work-hours",
    permissions: [{ key: "ppm:work-hour:read", name: "工时查看" }],
  },
  {
    section: "ppm",
    menuKey: "ppm-work-hour-statistics",
    menuLabel: "工时统计",
    icon: "\u{1F4CA}",
    href: "/ppm/work-hour-statistics",
    absolute: true,
    matchPattern: "/ppm/work-hour-statistics",
    permissions: [{ key: "ppm:work-hour:stat", name: "工时统计" }],
  },
  {
    section: "ppm",
    menuKey: "ppm-kanban",
    menuLabel: "看板",
    icon: "\u{1F4D4}",
    href: "/ppm/kanban",
    absolute: true,
    matchPattern: "/ppm/kanban",
    permissions: [{ key: "ppm:kanban:view", name: "看板查看" }],
  },
  {
    section: "ppm",
    menuKey: "ppm-weekly-plan",
    menuLabel: "项目计划",
    icon: "\u{1F4C5}",
    href: "/ppm/weekly-plan",
    absolute: true,
    matchPattern: "/ppm/weekly-plan",
    permissions: [],
  },
];

/** section 固定渲染顺序，供 AppShell / Picker 使用 */
export const MENU_SECTION_ORDER: MenuSection[] = [
  "overview",
  "management",
  "ppm",
  "admin",
  "system",
];

/** section 中文标题，供 AppShell 渲染分组标题使用 */
export const MENU_SECTION_LABEL: Record<MenuSection, string> = {
  overview: "概览",
  management: "管理",
  ppm: "项目管理",
  admin: "系统管理",
  system: "系统",
};
