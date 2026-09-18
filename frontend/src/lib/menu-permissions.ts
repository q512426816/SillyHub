/**
 * 菜单按权限驱动显隐的单一数据源。
 *
 * 设计依据：
 * - `2026-06-18-menu-driven-permissions/design.md` §5.1（类型定义）+ §5.2（19 菜单权限映射表）
 * - `2026-07-29-sidebar-menu-restructure/design.md` §5.1（新 6 分组结构表）+ §7.1
 *   （MenuSection 六值 + 新增 llm-providers/skills/mcp 菜单项定义）
 * - 后端 Permission 枚举：`backend/app/modules/auth/permissions.py`（含
 *   2026-06-18 ql-003 新增的 6 个子菜单独立 read 权限 + ql-004 新增的 3 个
 *   管理子菜单独立 admin 权限 + ql-005 git_identity:admin
 *   + 2026-07-29-sidebar-menu-restructure 新增 llm_provider:read）
 *
 * 子菜单独立查看权限：每个 workspace 子菜单有独立 read 权限
 * （component:read / topology:read / scan-docs:read / runtime:read /
 * knowledge:read / incident:read），避免共用 workspace:read 致 picker 冗余展示。
 * 后端各 router 已 require 对应权限。
 *
 * 管理菜单独立权限（ql-004/005）：config/system 组子菜单各有独立 admin 权限
 * （settings:admin / api_key:admin / runtime:admin / git_identity:admin），
 * 避免共用 platform:admin 致 picker 重复或缺失。后端 router 各自 require 对应权限。
 *
 * menuKey 稳定标识规约（R-01）：menuKey 是覆盖表 menu_overrides.menu_key 的
 * 关联键，禁止重命名或复用——前端重构改 menuKey 会使已存的覆盖行变孤儿、
 * 被合并层静默忽略（不报错）。menuKey/href/section/matchPattern 同为 nav 渲染
 * 与 picker 折叠的既有契约，非经变更评审不得改动。
 *
 * 2026-09-18-web-menu-management（FR-01/FR-04）：
 * - skills / mcp / agent-profiles / sessions 4 菜单由空 permissions（登录常显）
 *   改为各挂独立 read 权限（skill:read / mcp:read / agent_profile:read /
 *   agent_session:read），可在角色管理页按角色分配/收回；存量角色可见性由
 *   后端种子迁移保现状（4 个新权限 key 插入 role_permissions，覆盖全部现存角色）。
 * - system 组新增「菜单管理」menus 菜单项（menu:admin 门控，/admin/menus 入口）。
 * - PermissionItem.key 由 string 收紧为 api-types 生成的 Permission 联合类型
 *   （PermissionKey），后端枚举漂移在编译期暴露。
 */

import type { components } from "@/lib/api-types";

/**
 * 后端 Permission 枚举联合类型（OpenAPI 生成，api-types.ts）。
 * 权限 key 手写漂移在此编译期暴露（FR-04）。
 */
export type PermissionKey = components["schemas"]["Permission"];

export type MenuSection =
  | "workspace"
  | "agent"
  | "config"
  | "governance"
  | "system"
  | "ppm";

export interface PermissionItem {
  /** 权限标识，必须命中后端 Permission 枚举（生成联合类型，漂移在编译期暴露） */
  key: PermissionKey;
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
  /**
   * emoji 图标字符串（遗留数据字段）。
   * 侧边栏实际图标由 app-shell.tsx 的 MENU_ICON_MAP（lucide）按 href 解析渲染，
   * 本字段目前无任何渲染消费者，仅为历史数据保留；新增菜单可填语义贴近的 emoji 占位。
   * （2026-07-29-sidebar-menu-restructure task-04 排查确认：app-shell / picker /
   * permission.ts 均不消费 icon 字段。）
   */
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
  // ── workspace 工作区（8 条，原 overview 组平移）───────────────
  {
    section: "workspace",
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
    section: "workspace",
    menuKey: "components",
    menuLabel: "项目组组件",
    icon: "\u{1F4E6}",
    href: "components",
    matchPattern: "/components",
    permissions: [{ key: "component:read", name: "组件查看" }],
  },
  {
    section: "workspace",
    menuKey: "topology",
    menuLabel: "拓扑图",
    icon: "\u{1F5FA}",
    href: "components/topology",
    matchPattern: "/components/topology",
    permissions: [{ key: "topology:read", name: "拓扑查看" }],
  },
  {
    section: "workspace",
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
    section: "workspace",
    menuKey: "scan-docs",
    menuLabel: "扫描文档",
    icon: "\u{1F4C4}",
    href: "scan-docs",
    matchPattern: "/scan-docs",
    permissions: [{ key: "scan-docs:read", name: "扫描文档查看" }],
  },
  {
    section: "workspace",
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
    section: "workspace",
    menuKey: "knowledge",
    // ql-20260821-015：快速日志入口移除（变更中心保留完整入口），改名知识库
    menuLabel: "知识库",
    icon: "\u{1F4DA}",
    href: "knowledge",
    matchPattern: "/knowledge",
    permissions: [{ key: "knowledge:read", name: "知识查看" }],
  },
  {
    section: "workspace",
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
  {
    // 2026-07-29-sidebar-menu-restructure 新增：技能管理提为独立菜单，指向平台级
    // /settings/skills（工作区级仍在工作区内部访问）。
    // 2026-07-31-custom-skill-per-user D-003：曾放宽为空 permissions（登录可见）。
    // 2026-09-18-web-menu-management FR-01：改挂独立 skill:read 权限，可在角色
    // 管理按角色分配/收回（进入 picker 勾选器，去 pickerHidden）；存量角色可见性
    // 由后端种子迁移保现状（4 个新 read 权限 key 授予全部现存角色）。
    section: "agent",
    menuKey: "skills",
    menuLabel: "技能管理",
    icon: "\u{1F9E9}",
    href: "/settings/skills",
    absolute: true,
    matchPattern: "/settings/skills",
    permissions: [{ key: "skill:read", name: "技能查看" }],
  },
  {
    // 2026-07-29-sidebar-menu-restructure 新增（D-003）：MCP 管理提为独立菜单，
    // 指向平台级 /settings/mcp。
    // 2026-09-10-mcp-central-registry task-11：菜单名改「MCP 资产库」（页面重构为
    // 平台共享库/我的库双 tab 资产管理），permissions 曾放开为 []（对齐 skills 先例）。
    // 2026-09-18-web-menu-management FR-01：改挂独立 mcp:read 权限，可在角色管理
    // 按角色分配/收回（进入 picker 勾选器，去 pickerHidden）；存量角色可见性由后端
    // 种子迁移保现状。菜单仍只是入口可见性，库读写由 API 层权限矩阵控制
    // （非 admin 平台库写 403）。URL 不变。
    section: "agent",
    menuKey: "mcp",
    menuLabel: "MCP 资产库",
    icon: "\u{1F517}",
    href: "/settings/mcp",
    absolute: true,
    matchPattern: "/settings/mcp",
    permissions: [{ key: "mcp:read", name: "MCP 查看" }],
  },
  {
    // 2026-08-04-agent-profile-ui-redesign task-05 新增（D-001/D-007）：智能体档案
    // 提为侧边栏一级菜单，点击直达全局卡片墙 /agent-profiles（跨工作区聚合视图）。
    // 2026-09-18-web-menu-management FR-01：permissions 由 []（登录即可见）改为
    // 独立 agent_profile:read 权限（任一命中即可见），可在角色管理按角色分配/收回；
    // 存量角色可见性由后端种子迁移保现状。工作区详情页快捷入口
    // （workspaces/[id]/page.tsx:361）保留不动。
    section: "agent",
    menuKey: "agent-profiles",
    menuLabel: "智能体档案",
    icon: "🤖",
    href: "/agent-profiles",
    absolute: true,
    matchPattern: "/agent-profiles",
    permissions: [{ key: "agent_profile:read", name: "智能体档案查看" }],
  },
  {
    // 2026-08-14-sessions-portal task-10 新增（design §5 Wave3 / FR-01 / FR-02）：
    // 智能体会话总入口 /sessions（左会话列表 + 右新建/会话两态，跨机器跨智能体统一
    // 会话视图）。2026-09-18-web-menu-management FR-01：permissions 由 []（登录
    // 即可见）改为独立 agent_session:read 权限（任一命中即可见），可在角色管理按
    // 角色分配/收回；存量角色可见性由后端种子迁移保现状。会话列表后端仍按
    // user_id 隔离。
    section: "agent",
    menuKey: "sessions",
    menuLabel: "智能体会话",
    icon: "💬",
    href: "/sessions",
    absolute: true,
    matchPattern: "/sessions",
    permissions: [{ key: "agent_session:read", name: "智能体会话查看" }],
  },

  // ── config 配置中心（4 条，含新增 llm-providers；runtimes 自 system 移入，D-006）
  {
    // 2026-07-29-sidebar-menu-restructure 新增（D-002）：我的供应商提为独立菜单，
    // 可见性由新权限 llm_provider:read 控制（可在角色管理分配/收回）。
    section: "config",
    menuKey: "llm-providers",
    menuLabel: "我的供应商",
    icon: "\u{1F50C}",
    href: "/settings/providers",
    absolute: true,
    matchPattern: "/settings/providers",
    permissions: [{ key: "llm_provider:read", name: "供应商管理" }],
  },
  {
    section: "config",
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
    section: "config",
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
    // D-006：守护进程运行时归入配置中心（管 daemon 实例/版本等平台运行资源）。
    section: "config",
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

  // ── governance 协作治理（3 条）────────────────────────────────
  {
    section: "governance",
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
    section: "governance",
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
    section: "governance",
    menuKey: "incidents",
    menuLabel: "事件",
    icon: "\u{1F6A8}",
    href: "incidents",
    matchPattern: "/incidents",
    permissions: [{ key: "incident:read", name: "事件查看" }],
  },

  // ── system 系统管理（5 条：用户/组织/角色/设置/菜单）──────────
  {
    section: "system",
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
    section: "system",
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
    section: "system",
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
  {
    // 2026-09-18-web-menu-management 新增：菜单管理页入口 /admin/menus（菜单覆盖
    // 的显示名/组内排序/全局隐藏管理）。menu:admin 门控（platform:admin 自动通过），
    // 后端 GET /api/menu-overrides 仅需认证，PUT/DELETE require menu:admin。
    // app-shell 渲染时对本 menuKey 的 hidden 覆盖豁免（防自锁，R-03）。
    section: "system",
    menuKey: "menus",
    menuLabel: "菜单管理",
    icon: "📑",
    href: "/admin/menus",
    absolute: true,
    matchPattern: "/admin/menus",
    permissions: [{ key: "menu:admin", name: "菜单管理" }],
  },

  // ── ppm（14 条，平台级项目与问题管理）──────────────────────
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
    menuLabel: "实施计划汇总",
    icon: "\u{1F4C5}",
    href: "/ppm/weekly-plan",
    absolute: true,
    matchPattern: "/ppm/weekly-plan",
    // 菜单专属 key（仿 ppm:kanban:view）。ppm 域菜单权限为前端可见性语义，
    // 后端 plan/router 走 get_current_principal + DataScope 仅认证不授权。
    permissions: [{ key: "ppm:weekly-plan:view", name: "实施计划汇总查看" }],
  },
];

/** section 固定渲染顺序，供 AppShell / Picker 使用 */
export const MENU_SECTION_ORDER: MenuSection[] = [
  "workspace",
  "agent",
  "config",
  "governance",
  "ppm",
  "system",
];

/** section 中文标题，供 AppShell 渲染分组标题使用 */
export const MENU_SECTION_LABEL: Record<MenuSection, string> = {
  workspace: "工作区",
  agent: "智能体",
  config: "配置中心",
  governance: "协作治理",
  system: "系统管理",
  ppm: "项目管理",
};
