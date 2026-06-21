---
id: task-05
title: shadcn 视觉组件 copy-in
status: pending
priority: P0
depends_on: [task-03, task-04]
blocks: [task-06, task-07, task-08, task-10]
covers: [FR-02, D-006@v1]
allowed_paths:
  - frontend/src/components/ui/**
created_at: 2026-06-22T00:18:09
author: qinyi
---

## 背景

前端样式系统重设计的 task-05。按 shadcn/ui 官方组件模式 copy-in,补全 SillyHub 前端缺失的纯视觉/展示组件,为 task-06(StatusBadge)、task-07(布局组件)提供基础。技术栈走 CVA + clsx + tailwind-merge,所有组件用现有 `lib/utils` 的 `cn()` 合并类。

### 现状(已确认)

- `frontend/src/components/ui/button.tsx`:已有 CVA 模式,4 variant(default/destructive/outline/ghost)× 3 size(default/sm/lg),但 variant 命名与任务要求(primary/secondary)不完全一致,且未消费 blue-600。
- `frontend/src/components/ui/badge.tsx`:已有 CVA,但 variant 走硬编码色 `bg-emerald-50`/`bg-amber-50`/`bg-red-50`,违反 task-03 语义 token 规则,需改为语义 token。
- `frontend/src/components/ui/input.tsx`:CVA 模式可参考。
- `frontend/src/lib/utils.ts`:`cn()` 已存在,直接复用,不重写。

## 实现要点

### 1. Button(补全)

- variant:**保留现有命名 `default` / `destructive` / `outline` / `ghost`(不重命名)**,只改颜色实现到 token:default→blue-600 主色、destructive→red-600、outline→白底 border、ghost→透明
- size:`sm` / `default` / `lg`
- 圆角 `rounded-md`(8px),主按钮带 `shadow-sm`,default 消费 `blue-600`(走 token 不硬编码)
- 保留 `forwardRef` + `ButtonHTMLAttributes` + `VariantProps`,默认 `type="button"`
- 注意:**严禁重命名 variant**,避免破坏全仓现有 `<Button variant="default|destructive|...">` 调用点

### 2. Card(新建)

- 子组件:`CardHeader` / `CardTitle` / `CardDescription` / `CardContent` / `CardFooter`
- 样式:`rounded-lg`(12px) + `shadow-sm` + `border border-slate-200`(border 走 token)
- 逐个 export + 一个聚合 `Card` 容器

### 3. Badge(改造)

- **保留现有 variant(`default` / `success` / `warning` / `destructive` / `outline`),不重命名**;颜色实现改走语义 token(消除硬编码 emerald/amber/red);可**新增** `info` / `error` variant 但不删除现有
- 消除硬编码 `emerald-50`/`amber-50`/`red-50`,改用 task-03 定义的 CSS 变量 / tailwind 语义类(如 `bg-success/10 text-success`)
- 保留 `BadgeProps` 接口形态

### 4. Tag(新建)

- 视觉替代 antd `Tag`,API 对齐(可 closable / color prop)
- 颜色同 Badge 走语义 token,不硬编码

### 5. Avatar(新建)

- 子组件:`Avatar` / `AvatarImage` / `AvatarFallback`
- `Radix @radix-ui/react-avatar`(按需在 package.json 加)
- fallback 无图时显示首字母/占位

### 6. Skeleton(新建)

- `animate-pulse` 占位块
- 简单 `<div className={cn("animate-pulse rounded-md bg-muted", className)} />`

### 7. Tooltip(新建)

- 优先 Radix `@radix-ui/react-tooltip`;若依赖体积受限,退化用原生 `title` 属性包装(任务要求二选一)
- TooltipProvider / Tooltip / TooltipTrigger / TooltipContent 四件套

### 8. DropdownMenu(新建)

- 用于用户菜单
- Radix `@radix-ui/react-dropdown-menu`
- 子组件:Root / Trigger / Content / Item / Separator / Label

### 9. Dialog(新建)

- 基础弹窗,仅视觉壳,**不替代 antd Modal/Drawer**(D-006 边界)
- Radix `@radix-ui/react-dialog`
- Overlay + Content + Header / Footer / Title / Description / Close

### 10. EmptyState(新建)

- 结构:`icon` + `title` + `description` + 可选 `action`(ReactNode)
- 用于列表/表格空态展示,不绑定 antd Table 的 locale.emptyText

## 边界

1. **严格遵守 D-006 双库边界**:本任务只做纯视觉/展示组件,**绝不**替换或包装 antd 的 `Table` / `Form` / `DatePicker` / `Select` / `Modal` / `Drawer` / `Tabs`。遇到业务容器需用 antd 的场景,留给业务层选择,本任务不输出此类封装。
2. **复用现有 `lib/utils` 的 `cn()`**,不重写 `cn`、不另起 classvariance 之外的合并工具。
3. **Badge/Tag 颜色必须走语义 token**(依赖 task-03 产出的 CSS 变量 / tailwind 配置),不硬编码 `emerald` / `amber` / `red` / `blue` 字面色值;blue-600 通过 token 间接消费。
4. **Radix 依赖按需添加**:Avatar / Tooltip / DropdownMenu / Dialog 涉及的 `@radix-ui/react-*` 必须在 `frontend/package.json` 显式声明,禁止隐式依赖全局未声明的包。
5. **variant 命名保持不变**:button.tsx/badge.tsx 改造时**保留现有 variant 命名**,只改颜色实现到语义 token。禁止重命名/删除现有 variant(避免破坏全仓调用点);如需新语义可新增 variant 但不替换旧的。execute 前先 `rg 'variant="' frontend/src` 摸清调用点。

## 非目标

- 不替换 antd 业务组件(D-006 边界已限定)
- 不写 StatusBadge(业务状态映射,归 task-06)
- 不写布局组件(Layout / PageContainer / Section,归 task-07)
- 不写表单类组件(Input 已有;Checkbox/Radio/Switch 不在本任务)

## 验收表格

| AC | 要求 | 验证方式 |
|----|------|----------|
| AC-01 | 10 个组件文件(button/card/badge/tag/avatar/skeleton/tooltip/dropdown-menu/dialog/empty-state)存在,全部用 `cn()` 合并类 | `ls frontend/src/components/ui/` + grep `cn(` |
| AC-02 | Badge / Tag 颜色走语义 token,无硬编码 `emerald` / `amber` / `red` 字面色值 | grep badge.tsx/tag.tsx 排除硬编码色 |
| AC-03 | 未引入 antd 业务组件(Table/Form/DatePicker/Select/Modal/Drawer/Tabs)作为包装对象 | grep 各文件无 `from "antd"` 业务组件 import |
| AC-04 | Button 含 4 variant(default/destructive/outline/ghost,命名不变)× 3 size(sm/default/lg),颜色走 token | 读 buttonVariants 配置 + `rg 'variant=' frontend/src` 无破坏 |
| AC-05 | TypeScript 编译通过 | `cd frontend && npx tsc --noEmit` |

## 操作顺序

1. grep 现有 button/badge 调用点(`rg 'variant=' frontend/src`),确认保留现有 variant 命名(不重命名)
2. 按 shadcn/ui 官方源码 copy-in 各组件骨架,替换硬编码色为语义 token,**variant 命名保持不变**
3. 更新 `frontend/package.json` 添加 Radix 依赖
4. 跑 `tsc --noEmit` 验收
