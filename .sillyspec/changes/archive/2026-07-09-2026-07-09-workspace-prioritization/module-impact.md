---
author: qinyi
created_at: 2026-07-10T10:20:00
---

# 模块影响分析（Module Impact）— 工作区前置化

## 影响模块总览

| 模块 | 影响 | 文件数 |
|---|---|---|
| frontend | 主改 | 21（13 新 + 8 改，含 13 测试） |
| backend | 无 | 0 |
| sillyhub-daemon | 无 | 0 |
| deploy | 无 | 0 |
| ci | 无 | 0 |

## frontend 模块影响（主）

### 新建源码文件（5）

- `stores/workspace.ts` — 工作区上下文 zustand store（非 persist，CurrentWorkspace 5 字段 + setCurrent/clear）
- `lib/workspace-daemon-status.ts` — daemon 在线状态批量聚合（aggregateDaemonStatus 纯函数 + useDaemonStatusMap React Query 30s 轮询 + DaemonStatusEntry）
- `lib/use-workspace-context.ts` — 组合 hook（useWorkspaceContext/useWorkspaceId/buildSwitchPath 纯函数/switchWorkspace 切同模块）
- `components/workspace-binding-dialog.tsx` — daemon 绑定弹窗（Radix Dialog 容器化 WorkspaceAccessGuide）
- `components/workspace-switcher.tsx` — 顶栏工作区切换器（DropdownMenu 三态徽标 + 平台页引导态 + 未绑定弹窗）

### 修改源码文件（6）

- `app/page.tsx` — 落地页改 client component + redirect（登录→/workspaces，未登录→/login），删双入口标题页
- `app/(dashboard)/layout.tsx` — 加工作区守卫 useEffect（CB-3 先判 /workspaces/:id 后判白名单前缀，白名单=/workspaces /admin /settings /ppm /runtimes）
- `app/(dashboard)/workspaces/page.tsx` — 列表页改造选择器（顶部后台旁路 + daemon 三态徽标 + 空状态创建引导 + 卡片点击分流已绑定进/未绑定弹窗）
- `components/workspace-card.tsx` — 加 daemonStatus prop（三态徽标）+ 整卡 onActivate 点击
- `components/top-bar.tsx` — 接入 `<WorkspaceSwitcher />`（header 内面包屑前）
- `components/app-shell.tsx` — useWorkspaceId 复用 use-workspace-context（resolveHref/isActive/renderNavLink 逐字不动，D-006）

### 测试文件（13 新）

各 task 配套单测：stores/workspace.test / app/page.test / workspace-daemon-status.test / use-workspace-context.test / layout.test / workspace-binding-dialog.test / workspace-switcher.test / top-bar.test / workspace-card.test / workspaces page.test。

## 契约影响

- **无后端 API/DTO 改动**：只读消费现有 `GET /api/workspaces/{id}/my-binding`、`GET /api/workspaces/my-bindings`、`listDaemonInstances`（/api/daemon/instances）
- **无 daemon 生命周期/lease/session 改动**（design §7.5）：daemon 仅前端状态徽标数据源，不新增任何 daemon 事件
- **无 menu-permissions.ts 菜单数据结构改**：继续用 `absolute` 标记区分平台级/工作区级菜单
- **URL 路径派生不变**：`/workspaces/[id]/*` 路由结构 + `resolveHref` 逻辑逐字不动，深链/刷新行为零回归

## 复用关系

- `WorkspaceAccessGuide`（现有，components/workspace-access-guide.tsx）：task-06 Dialog 容器化复用其首次绑定模式（CB-2 不重写表单）
- `fetchMyBindings` / `listDaemonInstances`（现有 lib）：task-03 聚合消费（daemon_id→status==="online" 映射）
- `WorkspaceBindingGuard`（现有详情页）：保留为"编辑我的接入配置"入口（CB-1），不删

## 模块文档同步建议

- `frontend.md`「变更索引」：加本次变更条目（工作区前置化：顶栏切换器 + 落地页选择器 + 工作区守卫 + 上下文 store）
- `_module-map.yaml`：frontend 模块 entrypoints/main_symbols 不变（无新顶级路由，仅组件内增强）

## 风险

- 无跨模块风险（纯前端，无后端/daemon/deploy/ci 影响）
- lint Warning（use-workspace-context.ts / partial unused，66:16）非阻断，留 quick 修
