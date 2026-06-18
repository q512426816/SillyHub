/**
 * 菜单按权限驱动显隐的单一数据源。
 *
 * 设计依据：
 * - `2026-06-18-menu-driven-permissions/design.md` §5.1（类型定义）+ §5.2（19 菜单权限映射表）
 * - 后端 Permission 枚举：`backend/app/modules/auth/permissions.py`（36 个值）
 *
 * 兜底说明：后端目前不含 `component:*` / `incident:*` / `scan:*` / `knowledge:*` 权限，
 * 相关菜单统一用 `workspace:read` 作为可见性兜底（理由：对应接口已通过 workspace
 * 成员关系校验，无细粒度 permission）。如需精细控制，后续变更扩后端枚举。
 *
 * alwaysVisible 说明：少数 menu 后端只校验登录身份（get_current_user），无任何
 * Permission 依赖（如 git-identities，用户自服务）。这类 menu 设 alwaysVisible=true，
 * canSeeMenu 直接返回 true；permissions 为空数组（picker 会过滤掉这类 menu，因为
 * role 无权限可配）。
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
  /**
   * 该菜单可见所需的权限列表（任一命中即可见）。
   * 当 alwaysVisible=true 时该数组应为空（picker 会过滤掉这类 menu）。
   */
  permissions: PermissionItem[];
  /**
   * 登录即可见标记：后端只校验登录身份（get_current_user）无 Permission 依赖时设 true。
   * canSeeMenu 会跳过权限检查直接返回 true（user 非 null 时）。
   */
  alwaysVisible?: boolean;
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
    // 兜底：后端无 component:* 权限，使用 workspace:read
    permissions: [{ key: "workspace:read", name: "Workspace 查看" }],
  },
  {
    section: "overview",
    menuKey: "topology",
    menuLabel: "拓扑图",
    icon: "\u{1F5FA}",
    href: "components/topology",
    matchPattern: "/components/topology",
    // 兜底：后端无 component:* 权限，使用 workspace:read
    permissions: [{ key: "workspace:read", name: "Workspace 查看" }],
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
    // 兜底：后端无 scan:* 权限，使用 workspace:read
    permissions: [{ key: "workspace:read", name: "Workspace 查看" }],
  },
  {
    section: "overview",
    menuKey: "runtime",
    menuLabel: "运行时",
    icon: "\u{26A1}",
    href: "runtime",
    matchPattern: "/runtime",
    permissions: [
      { key: "workspace:read", name: "Workspace 查看" },
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
    // 兜底：后端无 knowledge:* 权限，使用 workspace:read
    permissions: [{ key: "workspace:read", name: "Workspace 查看" }],
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
    // 后端 git_identity router 无 require_permission，仅 get_current_user；
    // 这是用户自服务菜单，登录即可见，role 无权限可配。
    alwaysVisible: true,
    permissions: [],
  },
  {
    section: "management",
    menuKey: "api-keys",
    menuLabel: "API Keys",
    icon: "\u{1F4A1}",
    href: "/settings/api-keys",
    absolute: true,
    matchPattern: "/settings/api-keys",
    permissions: [{ key: "platform:admin", name: "平台超级管理员" }],
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
    // 兜底：后端无 incident:* 权限，使用 workspace:read
    permissions: [{ key: "workspace:read", name: "Workspace 查看" }],
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
    permissions: [{ key: "platform:admin", name: "平台超级管理员" }],
  },
  {
    section: "system",
    menuKey: "settings",
    menuLabel: "设置",
    icon: "⚙️",
    href: "/settings",
    absolute: true,
    matchPattern: "/settings",
    // 后端 settings router 所有端点 require_platform_admin → platform:admin。
    // platform:billing/user:read 后端不强制，移除以避免 picker 冗余展示。
    permissions: [{ key: "platform:admin", name: "平台超级管理员" }],
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
