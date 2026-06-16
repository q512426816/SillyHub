---
id: task-08
title: workspace 详情页 tab 化（Overview / Components / Changes / Members），保持现有 page.tsx 内容为 Overview
priority: P0
estimated_hours: 1.5
depends_on: []
blocks: [task-09]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/layout.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/page.tsx
  - frontend/src/components/workspace-tabs.tsx
---

# Task-08 — workspace 详情页 tab 化

## 1. 目标

把 `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx`（当前是单一 Overview 页面，673 行，含 header + 基本信息 + 默认 Agent provider + Overview cards + Spec Workspace + 快速导航）改造为 4 个 tab 的容器：

- **Overview** = 现有 page.tsx 全部内容（100% 保留，包括 header / Bootstrap SSE 面板 / 所有按钮与对话框）
- **Components** → link 到 `/workspaces/{id}/components`（已有目录 `components/page.tsx`）
- **Changes** → link 到 `/workspaces/{id}/changes`（已有目录 `changes/page.tsx`）
- **Members** → link 到 `/workspaces/{id}/members`（task-09 新建）

依据文档：

- `requirements.md` FR-07 第 1 个 GWT：顶部 tab 栏出现 4 个 tab；Members 高亮当 URL 为 `/workspaces/{W}/members`
- `design.md` §5.2 第 132-136 行："workspace 详情页 tab 化"：layout.tsx 或 page.tsx 改造；当前 `page.tsx` 是 Overview 内容，提取后保持原样；新增 `members/page.tsx`
- `design.md` §6 文件清单：`修改 frontend/src/app/(dashboard)/workspaces/[id]/page.tsx 或新增 layout` — tab 化

## 2. 修改文件

### 推荐方案：layout.tsx + workspace-tabs.tsx（共享组件） + page.tsx 仅作 Overview

**理由**：

1. Next.js App Router 中，`layout.tsx` 包裹同目录所有 `page.tsx`（含子目录 `members/` / `components/` / `changes/`），tab 栏只需渲染一次，不会因切换路由闪烁
2. Overview 内容（page.tsx）改动量最小 — 只删 page.tsx 自身的 `<header>` 重复部分（如果 layout 也要渲染 header），主体 100% 保留
3. tabs 逻辑封装到 `components/workspace-tabs.tsx`，便于将来在 `/scan-docs` / `/runtime` 等子路由复用同一 tab 栏（task 范围内只接 4 个 tab）
4. **不**强行提取 Overview 内容到独立子目录 — 保持 git diff 最小，避免触发 SSE stream / effect 依赖等回归

**文件改动清单**：

| 操作 | 文件 | 改动说明 |
|------|------|----------|
| 新增 | `frontend/src/app/(dashboard)/workspaces/[id]/layout.tsx` | Server Component（无需 client）；读 `params.id` → 渲染 `<WorkspaceTabs workspaceId={id}>{children}</WorkspaceTabs>` |
| 新增 | `frontend/src/components/workspace-tabs.tsx` | `"use client"` 客户端组件；用 `usePathname` 判定 active tab；渲染 `<TabsList>` 4 个 `<TabsTrigger>`（用 `<Link>` 包裹或 `router.push`） |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx` | **保留 100% 内容**；只在 `return` 前移除原 `<header>`（已由 layout 提供）；或保留 header 但 layout 不渲染 header（择一，本任务取"layout 不渲染 header，page.tsx 保留 header"以最小化 page.tsx 改动） |

**次选方案（不推荐，仅 fallback）**：保持单文件，在 page.tsx 顶部加 `<Tabs>`，但该方案下 `/members` / `/components` / `/changes` 子路由不会自动包含 tab 栏（因为它们各自是独立 page.tsx），需在每个子 page.tsx 顶部重复 tab 栏 → 复制 4 次，违反 DRY。**不采用**。

## 3. 实现要求

1. **layout.tsx 必须是 Server Component**（不加 `"use client"`），保持 Next.js App Router 默认 SSR：
   ```tsx
   // frontend/src/app/(dashboard)/workspaces/[id]/layout.tsx
   import { WorkspaceTabs } from "@/components/workspace-tabs";

   export default function WorkspaceDetailLayout({
     params,
     children,
   }: {
     params: { id: string };
     children: React.ReactNode;
   }) {
     return (
       <main className="mx-auto flex max-w-5xl flex-col gap-5 px-6 py-8">
         <WorkspaceTabs workspaceId={params.id}>{children}</WorkspaceTabs>
       </main>
     );
   }
   ```

2. **workspace-tabs.tsx 必须是 `"use client"`**（依赖 hooks）：
   ```tsx
   "use client";
   import Link from "next/link";
   import { usePathname } from "next/navigation";
   import { cn } from "@/lib/utils";

   const TABS = [
     { key: "overview", label: "Overview", path: "" },        // /workspaces/{id}
     { key: "components", label: "Components", path: "/components" },
     { key: "changes", label: "Changes", path: "/changes" },
     { key: "members", label: "Members", path: "/members" },
   ] as const;

   export function WorkspaceTabs({
     workspaceId,
     children,
   }: {
     workspaceId: string;
     children: React.ReactNode;
   }) {
     const pathname = usePathname();
     const base = `/workspaces/${workspaceId}`;

     // active 判定：tab 的完整路径等于 pathname 或 pathname 以 "{tab路径}/" 开头
     const isActive = (tabPath: string) => {
       const full = `${base}${tabPath}`;
       if (tabPath === "") return pathname === base || pathname.startsWith(`${base}/`);
       return pathname === full || pathname.startsWith(`${full}/`);
     };

     return (
       <>
         <nav aria-label="Workspace tabs"
              className="flex flex-wrap gap-1 border-b border-border">
           {TABS.map((tab) => (
             <Link
               key={tab.key}
               href={`${base}${tab.path}`}
               aria-current={isActive(tab.path) ? "page" : undefined}
               className={cn(
                 "inline-flex h-8 items-center border-b-2 -mb-px px-3 text-xs",
                 isActive(tab.path)
                   ? "border-foreground text-foreground font-medium"
                   : "border-transparent text-muted-foreground hover:text-foreground",
               )}
             >
               {tab.label}
             </Link>
           ))}
         </nav>
         <div className="pt-4">{children}</div>
       </>
     );
   }
   ```
   > 本任务**不引入** `frontend/src/components/ui/tabs.tsx`（当前不存在；引入 shadcn Tabs 组件会触发样式依赖与生成命令；改用原生 `<nav>` + `<Link>` + `border-b-2` 下划线方案，视觉与产品需求等价，零依赖）。

3. **page.tsx（Overview）改动**：保留全部 673 行 JSX，仅在 `return` 内层 `<main>` 标签改成 `<div>` 或保留 `<main>`（layout 已包了 `<main>`，重复 `<main>` 不报错但语义冗余；本任务**允许保留** page.tsx 内层 `<main>`，因 React 不强制 main 唯一，避免触发不必要的 git diff；推荐实践是改为 `<section>` 或 `<div>`，但择一即可）。**关键约束**：page.tsx 内的 `<header>`（line 421-436）**保留**（layout 不渲染 header）。

4. **tab 顺序固定**：Overview / Components / Changes / Members（与 design.md §5.2 第 134 行一致）。**禁止**重排或省略。

5. **active 判定逻辑**：使用 `usePathname()` 返回的完整路径（如 `/workspaces/abc-123/members`）做字符串前缀匹配；**不**依赖 `<Link>` 的内置 active state（next/link 不提供 active 状态，必须自行判定）。

6. **链接形式**：所有 tab 必须是 `<Link href="...">`（server-renderable anchor），**禁止**用 `router.push` + `onClick`（会丢失右键新窗口打开 / 中键点击等浏览器原生行为）。

## 4. 接口定义

### `WorkspaceDetailLayout`（layout.tsx）

| 入参 | 类型 | 说明 |
|------|------|------|
| `params.id` | `string` | workspace UUID / slug，来自路由段 `[id]` |
| `children` | `React.ReactNode` | 当前路由对应的 page.tsx 渲染结果（Overview / Components / Changes / Members 之一） |

输出 JSX 结构：

```tsx
<main className="mx-auto flex max-w-5xl flex-col gap-5 px-6 py-8">
  <WorkspaceTabs workspaceId={params.id}>
    {children}
  </WorkspaceTabs>
</main>
```

### `WorkspaceTabs`（workspace-tabs.tsx）

| 入参 | 类型 | 说明 |
|------|------|------|
| `workspaceId` | `string` | 透传 params.id，用于拼 tab href |
| `children` | `React.ReactNode` | layout 透传下来的页面内容 |

内部行为：

- 调用 `usePathname()` 取当前 URL
- 计算 4 个 tab 的 href = ``/workspaces/${workspaceId}${tab.path}``
- 计算 active 状态：tab.href === pathname || pathname.startsWith(`${tab.href}/`)
- 渲染 `<nav>` + 4 个 `<Link>`，每个 Link 加 `aria-current="page"` 当 active

## 5. 边界处理

1. **`ws_id` 不存在 / 加载失败**：layout.tsx 不做数据请求（纯 Server Component），ws 不存在的判断仍由 `page.tsx` 的 `if (!workspace)` 分支处理（line 409-417）。tab 栏在 ws 不存在时**仍然渲染**（用户能看到导航，点击其他 tab 可重试加载），避免"页面空白 + 无法导航"的死锁。

2. **Members tab URL 但用户无权限**：tab 栏**始终可见 4 个 tab**（design.md §5.2 + requirements.md FR-07 第 4 个 GWT：本变更取"显示但禁用"策略），不在 task-08 隐藏 tab；Members 内部的 + Add Member / Remove / Set Owner 等按钮由 `members/page.tsx`（task-09）按权限 disabled。本任务**不读取权限**，**不做条件渲染**。

3. **SSR 期间 `usePathname()` 返回 null**：Next.js 14+ 中 `usePathname()` 在 client 端首次渲染时一定有值（layout 已被 RSC 包裹，client 部分延迟 hydration 后 pathname 立即可用）。若极端情况下返回 `null`（理论不会），用 `pathname ?? ""` 防御，所有 tab 都按 inactive 处理（无下划线高亮），不影响点击导航。

4. **tab 顺序固定**：`TABS` 数组顺序 = Overview → Components → Changes → Members，**禁止**根据用户权限 / workspace 状态动态重排。Members 永远是第 4 个 tab。

5. **fallback 兼容**：现有 `/scan-docs` / `/runtime` / `/agent` / `/approvals` / `/audit` / `/incidents` / `/knowledge` / `/releases` / `/create-change` 子目录的 page.tsx **不会**自动获得 tab 栏（layout.tsx 会包裹它们，tab 栏会显示，但点击这 4 个 tab 之外的路由时无 active 高亮 — 这是预期行为，因为这些子路由不在本任务的 4 个 tab 范围内）。task-08 **不破坏**这些子路由的现有功能。

6. **移动端不溢出**：`<nav className="flex flex-wrap gap-1 border-b">` 使用 `flex-wrap`，移动端窄屏时 tab 自动换行；不引入水平滚动。

7. **layout 嵌套层级**：父级 `(dashboard)/layout.tsx` 已有侧边栏 + 顶部条；本 layout.tsx 是 `(dashboard)/workspaces/[id]/layout.tsx`，仅作用于 ws 详情路由段，**不影响**其他 ws 列表页（`/workspaces`）或全局页面。

## 6. 非目标

- **不改 Overview 内容**：page.tsx 内 673 行 JSX（header / Bootstrap SSE 面板 / Spec Workspace 卡片 / Agent provider 编辑等）100% 保留；本任务**禁止**重构、抽组件、改样式、改文案
- **不做权限隐藏 tab**：4 个 tab 始终可见；Members 内部按钮 disabled 由 task-09 处理
- **不引入 shadcn Tabs 组件**：当前 `components/ui/tabs.tsx` 不存在；引入需 `npx shadcn-ui add tabs`，会拉 Radix UI 依赖；本任务用原生 `<nav>` + `<Link>` 实现，零新依赖
- **不接入** `/scan-docs` / `/runtime` / `/agent` 等 tab：4 个 tab 是本变更上限；其他子路由作为 page 存在，但不在 tab 栏暴露（保留现状，未来按需扩展）
- **不写**前端单测 / vitest（design.md §3 非目标 + §11 自审：前端依赖 e2e 手动验收）
- **不改** members/page.tsx（属于 task-09）
- **不改** components/page.tsx / changes/page.tsx 现有内容（它们独立工作，task-08 只让它们出现在 tab 栏中）

## 7. 参考

- **Next.js Layout 约定**：https://nextjs.org/docs/app/api-reference/file-conventions/layout — `layout.tsx` 包裹所有同目录 page.tsx，children 是当前路由内容
- **`usePathname` API**：https://nextjs.org/docs/app/api-reference/functions/use-pathname — 返回当前 URL pathname（不含 query），客户端 hook
- **现有 dashboard layout**：`frontend/src/app/(dashboard)/layout.tsx`（侧边栏 + 顶部条）— 本 layout.tsx 与之嵌套，不冲突
- **现有 Overview 内容**：`frontend/src/app/(dashboard)/workspaces/[id]/page.tsx` 673 行 — 直接保留
- **现有子目录**：`components/` / `changes/` / `scan-docs/` / `runtime/` / `agent/` / `approvals/` / `audit/` / `incidents/` / `knowledge/` / `releases/` / `create-change/` — 已存在，task-08 不动它们的 page.tsx
- **`cn` 工具函数**：`frontend/src/lib/utils.ts`（应已存在；如不存在，本任务允许在 workspace-tabs.tsx 内联拼接 className 字符串替代）
- **不引入** `frontend/src/components/ui/tabs.tsx`（不存在；本任务用原生 `<nav>` 实现等价视觉）

## 8. TDD 步骤

本任务**不写自动化测试**（前端 e2e 手测）。手测流程：

1. **冷启动 dev server**：
   ```bash
   cd frontend && pnpm dev
   ```
   期望：无编译错误，dev server 起在 http://localhost:3000。

2. **访问 Overview tab**：
   - 浏览器打开 `http://localhost:3000/workspaces/{WS_ID}`（用真实 ws UUID 替换）
   - 期望：
     - 顶部出现 4 个 tab：Overview / Components / Changes / Members
     - **Overview tab 有下划线高亮**（active）
     - Overview 主体内容 = 改造前的全部内容（header "Workspaces ← " 链接 + 基本信息 + 默认 Agent provider + Overview cards + Spec Workspace 卡片 + 快速导航）
     - Bootstrap / Sync / Import 按钮可点（点击后行为不变）

3. **点击 Components tab**：
   - 期望：URL 变为 `/workspaces/{WS_ID}/components`；Components tab 高亮；Overview tab 取消高亮；页面内容切到 components 列表

4. **点击 Changes tab**：
   - 期望：URL 变为 `/workspaces/{WS_ID}/changes`；Changes tab 高亮；页面内容切到 changes 列表

5. **点击 Members tab**：
   - 期望：URL 变为 `/workspaces/{WS_ID}/members`；Members tab 高亮；页面内容为 task-09 产出的成员表格（如 task-09 未完成则显示 404 或空白 — 本任务允许，task-08 只保证 tab 高亮正确）

6. **浏览器后退/前进**：URL 历史栈正确，tab 高亮跟随 URL 变化。

7. **直接访问 `/workspaces/{id}/members`**（不经过 Overview 跳转）：刷新页面后 Members tab 仍高亮（SSR 期间 pathname 已知）。

8. **移动端响应式**：Chrome DevTools 切到 iPhone SE（375px 宽），4 个 tab 不溢出，自动换行或紧凑展示。

9. **`pnpm build`**（生产构建）：
   ```bash
   cd frontend && pnpm build
   ```
   期望：无 TypeScript 错误，无 ESLint 错误，build 产物正常生成。

## 9. 验收标准

| 编号 | 检查项 | 通过条件 |
|------|--------|----------|
| AC-1 | 4 个 tab 都渲染 | 访问 `/workspaces/{id}` 时，顶部 tab 栏顺序渲染 Overview / Components / Changes / Members 4 个 `<Link>`，文本与 `TABS` 数组一致 |
| AC-2 | URL 切换 active 正确 | 访问 `/workspaces/{id}` → Overview 高亮；`/members` → Members 高亮；`/components` → Components 高亮；`/changes` → Changes 高亮；切换 tab 时 active 状态实时更新，无延迟 |
| AC-3 | Overview 内容 100% 保留 | `git diff frontend/src/app/(dashboard)/workspaces/[id]/page.tsx` 改动行数 < 10（理想 = 0 行；最多为 wrapper `<main>` → `<div>` 或类似微调），Bootstrap SSE / Spec Workspace / 默认 Agent provider 等所有功能与改造前完全一致 |
| AC-4 | `pnpm build` 通过 | 执行 `cd frontend && pnpm build` 无 TypeScript / ESLint 错误，无 "usePathname must be in Client Component" 类警告 |
| AC-5 | 移动端不溢出 | Chrome DevTools 切 iPhone SE (375px)，4 个 tab 不超出 viewport，不出现水平滚动条 |
| AC-6 | 子路由 fallback | 访问 `/workspaces/{id}/scan-docs` / `/runtime` / `/agent` 等**不在 4 tab 范围**的子路由时，tab 栏仍渲染（4 个 tab 都不高亮），页面内容正常显示，不报错 |
| AC-7 | tab 链接形式正确 | 每个 tab 渲染为 `<a href="/workspaces/{id}{path}">`，右键可"新窗口打开"，中键可后台打开（原生 anchor 行为，非 onClick 阻断） |
| AC-8 | layout 不读权限/不请求数据 | `layout.tsx` 是纯 Server Component，无 `fetch` / `apiFetch` / `useSession` 调用；ws 不存在时 tab 栏仍渲染（不依赖 ws 加载成功） |

## 10. 风险与回滚

- **风险 R-1**：page.tsx 顶层 `<main>` 与 layout.tsx 的 `<main>` 嵌套（双重 `<main>`），HTML 语义警告但不影响渲染。**缓解**：page.tsx 内层改 `<section>` 或 `<div>`；如保留 `<main>`，浏览器与 SEO 不报错（HTML5 spec 允许多个 main with `hidden`，但 React 渲染两个 main 会被部分 lint 规则告警）。
- **风险 R-2**：`usePathname` 在 Next.js 14 早期版本首次 render 时返回 null（已修复，本仓库 Next 14+ 应安全）。**缓解**：用 `pathname ?? ""` 防御，active 判定降级为"无高亮"。
- **风险 R-3**：layout.tsx 包裹了 `create-change/` 等子目录，导致创建变更流程页面也出现 tab 栏，可能不符合产品预期。**缓解**：task-08 接受这个副作用（design.md 未禁止）；如产品要求 `create-change` 不显示 tab，可在 layout.tsx 内读 `usePathname` 并对特定路径隐藏（但需把 layout 改成 client component，权衡后**不在 task-08 做**）。
- **风险 R-4**：tab 栏 max-width 与 page.tsx 内 header 的 max-width 不一致导致视觉错位。**缓解**：layout.tsx 的 `<main className="mx-auto max-w-5xl">` 与 page.tsx 原 `<main className="mx-auto max-w-5xl">` 完全一致，padding `px-6 py-8` 也一致。
- **回滚**：
  1. 删除 `frontend/src/app/(dashboard)/workspaces/[id]/layout.tsx`
  2. 删除 `frontend/src/components/workspace-tabs.tsx`
  3. `git checkout frontend/src/app/(dashboard)/workspaces/[id]/page.tsx`（恢复原状）
  4. 无数据库 / 配置 / 后端变更，回滚成本 = 3 个 git 操作
