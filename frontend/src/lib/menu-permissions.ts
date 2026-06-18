/**
 * 菜单按权限驱动显隐的单一数据源。
 *
 * 设计依据：
 * - `2026-06-18-menu-driven-permissions/design.md` §5.1（类型定义）+ §5.2（19 菜单权限映射表）
 * - 后端 Permission 枚举：`backend/app/modules/auth/permissions.py`（45 个值，含
 *   2026-06-18 ql-003 新增的 6 个子菜单独立 read 权限 + ql-004 新增的 3 个
 *   管理子菜单独立 admin 权限 settings:admin / api_key:admin / runtime:admin）
 *
 * 子菜单独立查看权限：每个 overview/management 子菜单有独立 read 权限
 * （component:read / topology:read / scan-docs:read / runtime:read /
 * knowledge:read / incident:read），避免共用 workspace:read 致 picker 冗余展示。
 * 后端各 router 已 require 对应权限。
 *
 * 管理菜单独立权限（ql-004）：settings / api-keys / runtimes 三个 management/system
 * 子菜单各有独立 admin 权限（settings:admin / api_key:admin / runtime:admin），
 * 避免共用 platform:admin 致 picker 重复展示。后端 router 各自 require 对应权限。
 *
 * pickerHidden 说明：git-identities 后端不强制任何 permission，前端兜底用
 * platform:admin（无其他 menu 共享），设 pickerHidden=true 仅避免 picker 中显示
 * 一个"挂名"权限卡片。canSeeMenu 仍按 permissions 正常判断。
 */

export type MenuSection = "overview" | "management" | "admin" | "system";

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
}

export const MENU_PERMISSION_GROUPS: MenuPermissionGroup[] = [
  // ── overview（8 条）──────────────────────────────────────────
  {
    section: "overview",
    menuKey: "workspaces",
    menuLabel: "Workspace 首页",
    icon: "\u{1F3E0}",
    href: "/workspaces",
    absolute: true,
    permissions: [
      { key: "workspace:read", name: "Workspace 查看" },
      { key: "workspace:write", name: "Workspace 编辑" },
      { key: "workspace:admin", name: "Workspace 管理" },
      { key: "workspace:member:manage", name: "Workspace 成员管理" },
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
    // 后端 git_identity router 无 require_permission，仅 get_current_user。
    // 前端用 platform:admin 兜底（与 api-keys/settings 共享），让平台管理员可见、
    // 普通用户不可见。pickerHidden=true 让 picker 不渲染（避免 platform:admin 重复）。
    permissions: [{ key: "platform:admin", name: "平台超级管理员" }],
    pickerHidden: true,
  },
  {
    section: "management",
    menuKey: "api-keys",
    menuLabel: "API Keys",
    icon: "\u{1F4A1}",
    href: "/settings/api-keys",
    absolute: true,
    matchPattern: "/settings/api-keys",
    // 后端 auth/router 3 个 /api-keys 端点 require api_key:admin（platform:admin 自动通过）。
    permissions: [{ key: "api_key:admin", name: "API Keys 管理" }],
  },
  {
    section: "management",
    menuKey: "agent",
    menuLabel: "Agent 控制台",
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
    menuLabel: "Daemon 运行时",
    icon: "\u{1F5A5}",
    href: "/runtimes",
    absolute: true,
    matchPattern: "/runtimes",
    // 后端 daemon/router 管理 UI 端点（list/get/disable/enable/leases）
    // require runtime:admin（platform:admin 自动通过）。
    permissions: [{ key: "runtime:admin", name: "Daemon 运行时管理" }],
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
];

/** section 固定渲染顺序，供 AppShell / Picker 使用 */
export const MENU_SECTION_ORDER: MenuSection[] = [
  "overview",
  "management",
  "admin",
  "system",
];

/** section 中文标题，供 AppShell 渲染分组标题使用 */
export const MENU_SECTION_LABEL: Record<MenuSection, string> = {
  overview: "Overview",
  management: "Management",
  admin: "系统管理",
  system: "System",
};
