---
author: qinyi
created_at: 2026-07-09T22:48:00
---

# 需求规格（Requirements）— 工作区前置化

## 角色

| 角色 | 说明 |
|---|---|
| 普通成员 | 登录后强制选工作区，依赖工作区的功能需先进工作区 |
| 平台管理员 | 同样落选择器，但可走选择器页"后台旁路"直接进平台管理/系统设置（不强制选工作区） |
| 无工作区的新用户 | 选择器显示空状态，引导"创建工作区" |

## 功能需求

### FR-01: 工作区上下文 store（缓存层）

新建 `stores/workspace.ts`，缓存当前工作区对象 `{id, name, daemon_id, daemon_online}`，**非 persist**（随 URL，刷新重建）。进入 `/workspaces/[id]/*` 时写入缓存。
- 覆盖：D-002（switchWorkspace 基础）
- 不改：`useWorkspaceId` URL 正则解析仍为真相源，store 仅叠加

### FR-02: 登录后强制选工作区（客户端守卫）

`(dashboard)/layout.tsx` 加工作区守卫（与现有 `useSession` 登录守卫同层）：路径无 `/workspaces/:id` 且不在白名单 → `router.replace("/workspaces")`。
- 白名单：`/workspaces` `/admin` `/settings` `/ppm` `/runtimes`
- **实现顺序**：先判 `/workspaces/:id`（有则放行），再判白名单前缀（避免 `/workspaces/xxx` 被白名单 `/workspaces` 误匹配，CB-3）
- 覆盖：D-001 / D-006

### FR-03: 落地页改工作区选择器

`app/page.tsx` 登录态直接 `redirect("/workspaces")`，删除双入口标题页。`/workspaces` 列表页改造为选择器：顶部常驻"平台管理 / 系统设置"后台旁路入口（D-001）、强化 daemon 状态徽标、空状态显示"创建工作区"引导（D-004）。
- 覆盖：D-001 / D-004

### FR-04: 顶栏工作区切换器

`top-bar.tsx` 接入 `WorkspaceSwitcher`：显示当前工作区名 + daemon 在线徽标（绿/红，D-005），下拉列出可切换工作区（最近优先，每项带 daemon 状态），选中调 `switchWorkspace`（切同模块 D-002）。平台页（无 wsId）时切换器显示"选择工作区"引导态。
- 覆盖：D-002 / D-005

### FR-05: daemon 绑定弹窗

未绑定 daemon 的工作区，在选择器/切换器点击时弹 `WorkspaceBindingDialog`。弹窗**容器化包裹现有 `WorkspaceAccessGuide`**（不重写表单，CB-2）。详情页 `WorkspaceBindingGuard` 保留为"编辑我的接入配置"入口（CB-1）。
- 覆盖：D-003 / CB-1 / CB-2

### FR-06: daemon 状态数据接入

`fetchMyBindings`（批量，按 workspace_id 索引）+ `listDaemonInstances`（带在线状态）客户端聚合 daemon_id→online 映射，切换器/store 消费。`MemberBindingView` 不带 online 字段，必须二次映射（R-02 已核实）。
- 覆盖：R-02

## 非功能需求

- **零回归**：URL 路径派生不变，现有深链/刷新行为不变；平台后台路由不阻断；现有菜单灰显、`WorkspaceBindingGuard` 编辑入口保留。
- **样式一致**：遵循 `frontend-style-system` token（主色 `#2563EB`、slate 中性、圆角 12、状态徽标语义）。
- **跨平台**：Windows/Linux/macOS 浏览器一致（项目硬性规则）。
- **测试**：改 layout/router 必跑现有前端测试 + 新增守卫/store/switchWorkspace 单测（记忆教训：改 router 必跑 test_router 类回归）。
