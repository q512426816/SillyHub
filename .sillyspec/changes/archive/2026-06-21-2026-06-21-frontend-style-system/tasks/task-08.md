---
id: task-08
title: AppShell 重做(侧栏 lucide 图标 + 新增顶栏)
status: pending
priority: P0
depends_on: [task-05, task-07]
blocks: [task-09]
covers:
  - FR-05
  - D-003@v1
allowed_paths:
  - frontend/src/components/app-shell.tsx
  - frontend/src/components/top-bar.tsx
created_at: 2026-06-22T00:18:09
author: qinyi
---

## 现状

`frontend/src/components/app-shell.tsx`(234 行):

- 布局:`aside` 侧栏 fixed(展开 260px / 折叠 60px)+ `div.ml-[260px]` 内容区,内容区直接渲染 `children`,**无顶栏**。
- 菜单数据源:`@/lib/menu-permissions` 的 `SECTION_ORDER` / `SECTION_LABEL` + `visibleMenusBySection(user, section)` 返回 `MenuPermissionGroup[]`,菜单项字段含 `href` / `menuLabel` / `icon`(string)/ `absolute` / `matchPattern`。
- 菜单隔离:ppm 路径只渲染 ppm section,非 ppm 路径渲染其它 section(overview/management/admin/system),逻辑在 `SECTION_ORDER.filter` 内。
- 图标渲染:`<span>{menu.icon}</span>` 直接输出字符串(emoji 🚪 或字符 →/←),侧栏底部退出按钮 `🚪` / 折叠按钮 `→` / `←`。
- 折叠状态:`localStorage["sidebar-collapsed"]`,`useState` 初始化 + `useEffect` 持久化,逻辑保留不改。
- 激活态:`bg-primary/10 text-primary`(tailwind token),无左侧指示条。
- 用户区:底部 border-t 区块,显示 `displayName` + 退出按钮。

## 实现要点

### 1. 侧栏图标 emoji/字符 → lucide-react

在 app-shell.tsx 顶部新增**图标映射配置表**(配置处便于维护,key 为 `menu.icon` 原字符串或 `menu.href` 标识):

```ts
import {
  ClipboardList, ListTodo, Flag, BarChart3,
  LayoutDashboard, Home, Settings,
  ChevronsLeft, ChevronsRight, LogOut,
  type LucideIcon,
} from "lucide-react";

const MENU_ICON_MAP: Record<string, LucideIcon> = {
  // key 用 menu.href 标识,避免 emoji 字符串不可靠
  "kanban": LayoutDashboard,
  "projects": ClipboardList,   // 项目计划
  "tasks": ListTodo,
  "milestones": Flag,
  "work-hours": BarChart3,
  "home": Home,
  "settings": Settings,
};
```

渲染时按 `menu.href`(或新增的 icon key 字段)查表,命中则渲染 `<Icon className="h-[18px] w-[18px]" />`,未命中降级渲染原 `menu.icon` 字符串(保证不漏菜单)。底部退出按钮 `🚪` → `<LogOut />`,折叠按钮 `→` / `←` → `<ChevronsRight />` / `<ChevronsLeft />`。

> 实施时先 grep `lib/menu-permissions.ts` 确认每个菜单项的 `href` 取值,以 href 作为映射 key 最稳。

### 2. 激活态 blue 指示条

`renderNavLink` 内 active 分支改为:

- 容器:`bg-blue-50 text-blue-700`(`primary/10`→具体 blue token,见 task-01/03 设计)
- 左侧 3px 指示条:用 `relative` + 内层 `<span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r bg-blue-600" />`,仅 active 时渲染。
- 非激活态:`text-muted-foreground hover:bg-muted hover:text-foreground`(保留)。

### 3. 菜单分组标题样式

`renderGroupTitle` 保留现结构(`px-2 pt-5 pb-1` + 小号大写),仅同步色板到 design token(task-01 定义),不改逻辑。折叠时仍 `opacity-0 h-0`。

### 4. 新增 TopBar(`top-bar.tsx`)

新建 `frontend/src/components/top-bar.tsx`:

- 高度 `h-14`(56px),`bg-white border-b shadow-sm`,`flex items-center px-4 gap-4`。
- **左侧面包屑**:由 `usePathname()` 动态生成 —— split `/` 过滤空段,首段查 `SECTION_LABEL` / menu label 映射降级显示段名,无映射时直接显示当前段(降级)。
- **中间/右侧搜索框**:`input` + `rounded-md bg-slate-100 px-3 py-1.5 text-sm w-[240px]`(纯展示态,接 `onChange` 留 prop 但本任务不接业务)。
- **通知 icon-btn**:`button` + lucide `Bell` 图标,右上角 `absolute` 红点 `<span className="h-1.5 w-1.5 rounded-full bg-red-500" />`。
- **用户头像下拉**:用 task-05 的 `DropdownMenu` + antd6 `Avatar`(或 task-05 组件,优先复用),触发器显示 `displayName` 首字头像;下拉项含"个人设置"/"退出登录"(退出调 app-shell 的 onLogout,通过 prop 传入)。
- Props:`{ onLogout: () => void; displayName: string }`,避免在 TopBar 内重复引 session store。

### 5. 布局组装

`AppShell` return 改为:

```
<aside ...> {/* 侧栏,图标/激活态按上述改 */} </aside>
<div className={ml-[260px] / ml-[60px]}>
  <TopBar onLogout={onLogout} displayName={displayName} />
  <div className="min-w-0 flex-1">{children}</div>
</div>
```

折叠状态、`localStorage` 持久化、菜单隔离逻辑全部保留不动。

## 边界

1. 不改路由结构 / 菜单数据源(`menu-permissions.ts` 不动),只改图标渲染方式 + 加顶栏;菜单项 `href`/`menuLabel` 字段只读使用。
2. 图标映射表(`MENU_ICON_MAP`)写在 app-shell.tsx 顶部配置处,新增/改菜单图标时只改这一处。
3. 面包屑由 `pathname` split 推导,有 label 映射用映射,无映射降级显示当前段原值,不报错不阻断渲染。
4. 折叠状态(`collapsed`/`COLLAPSED_KEY`/`toggleCollapsed`/`useEffect` 持久化)逻辑完全保留,只改图标和激活态样式。
5. 用户下拉复用 task-05 `DropdownMenu`,不引入 headless-ui / radix / antd `Dropdown` 等新弹层库;头像用 antd6 `Avatar` 或 task-05 组件,不另造。

## 非目标

- 不改路由结构(菜单项 `href` 不变、新增/删除菜单项)。
- 不改鉴权逻辑(`useSession` / `onLogout` 的 fetch 流程不动,只在 UI 层复用)。
- 不改菜单数据结构(`MenuPermissionGroup` 类型 / `visibleMenusBySection` 不动,仅消费其字段)。
- 不接搜索框/通知的真实业务逻辑(本任务只做 UI 骨架,业务后续任务)。

## 验收

| AC | 判据 |
|----|------|
| AC-01 | 侧栏渲染全 lucide 图标,grep app-shell.tsx 无 `🚪`/`→`/`←`/emoji 字面量,图标来自 `lucide-react` |
| AC-02 | 顶栏含面包屑(usePathname 生成)+ 搜索框 + 通知 icon(红点)+ 用户头像下拉(task-05 DropdownMenu) |
| AC-03 | 激活态菜单项 `bg-blue-50 text-blue-700` + 左侧 3px `bg-blue-600` 指示条 |
| AC-04 | 折叠/展开功能保留:点折叠按钮侧栏 260px↔60px,`localStorage["sidebar-collapsed"]` 持久化,菜单隔离(ppm/非 ppm)不变 |
| AC-05 | `cd frontend && npx tsc --noEmit` 通过,无新增类型错误 |
