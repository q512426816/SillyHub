---
id: task-09
title: 修改 frontend/src/components/top-bar.tsx — 左侧接入 <WorkspaceSwitcher />
title_zh: 顶栏接入工作区切换器
author: qinyi
created_at: 2026-07-09 23:10:00
priority: P1
depends_on: [task-08]
blocks: []
allowed_paths:
  - frontend/src/components/top-bar.tsx
---

## 目标(goal)

把工作区切换器接入顶栏，让"当前工作区"成为登录后顶层会话的可见锚点（design §5 P4 / FR-04 / AC-3）。本任务是**纯接入**：在 `TopBar` 左侧（面包屑之前）渲染 `<WorkspaceSwitcher />`，组件自身的名/徽标/下拉/弹窗逻辑全部在 task-08 内，本任务不实现任何切换逻辑。

覆盖：FR-04（顶栏全局工作区切换器）、AC-3（顶栏切换器显示当前工作区名 + daemon 状态徽标）。

## 实现(implementation)

修改 `frontend/src/components/top-bar.tsx`：

1. 顶部 import 区新增：`import { WorkspaceSwitcher } from "@/components/workspace-switcher";`
2. 在 `<header>` 内、面包屑 `<nav>` **之前**（最左侧）插入 `<WorkspaceSwitcher />`，并给一个右分隔间距（如 `mr-2` / `pr-2 border-r`，与现有 `gap-4` 协调，不破坏高度 `h-14` 居中）。
3. 面包屑 `<nav>` 保持原 `flex-1` 占位不变（切换器为定宽，面包屑继续吃剩余空间）。
4. `TopBarProps`（`displayName` / `onLogout`）、`buildBreadcrumbs`、`resolvePlatformSwitch`、右侧搜索/通知/用户菜单**全部不动**。

平台页（无 wsId，如 `/admin` `/ppm`）由 task-08 组件内部渲染"选择工作区"引导态（R-03），本任务无需做条件分支。

## provides

- `frontend/src/components/top-bar.tsx`：`<header>` 左侧渲染 `<WorkspaceSwitcher />`（面包屑之前）。
- 顶栏可见当前工作区名 + daemon 徽标（内容由 task-08 提供）。

## expects_from

- task-08（`frontend/src/components/workspace-switcher.tsx`）：`WorkspaceSwitcher` 组件，无 props，内部消费 `useWorkspaceContext`（task-04）+ daemon 状态映射（task-03），处理平台页引导态与未绑定弹窗（task-06）。

## 验收标准

- [ ] `frontend/src/components/top-bar.tsx` import `WorkspaceSwitcher`
- [ ] `<header>` 内面包屑之前渲染 `<WorkspaceSwitcher />`
- [ ] 面包屑/搜索/通知/用户菜单/`resolvePlatformSwitch`/`TopBarProps` 零改动
- [ ] 切换器与面包屑视觉不重叠、不撑高顶栏（h-14 不变）

## 验证(verify)

```bash
cd frontend
pnpm test -- top-bar   # 现有 resolvePlatformSwitch 测试回归（不渲染布局，新增 import 不影响）
pnpm typecheck
```

## 约束(constraints)

- 纯接入任务，切换/弹窗/徽标逻辑全在 task-08，本任务不写状态、不调接口、不加 props。
- 仅改 `frontend/src/components/top-bar.tsx`（allowed_paths）。
- 不动 `resolvePlatformSwitch` 纯函数与对应单测（现有测试只 import 纯函数，加组件 import 不破坏）。
