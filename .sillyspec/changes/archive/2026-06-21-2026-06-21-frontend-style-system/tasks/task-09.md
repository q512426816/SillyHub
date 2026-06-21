---
id: task-09
title: 逐页适配(消除硬编码色/内联 width/统一组件)
status: pending
priority: P0
depends_on: [task-06, task-07, task-08]
blocks: [task-11]
covers: [FR-02, FR-04, D-006@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/kanban/page.tsx
  - frontend/src/app/(dashboard)/ppm/kanban/_components/*
  - frontend/src/app/(dashboard)/ppm/project-plans/page.tsx
  - frontend/src/app/(dashboard)/ppm/task-plans/page.tsx
  - frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx
  - frontend/src/app/(dashboard)/ppm/work-hour-statistics/page.tsx
  - frontend/src/components/ppm-resource-table.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/components/topology/page.tsx
created_at: 2026-06-22T00:18:09
author: qinyi
---

## 现状

### 看板 `ppm/kanban/page.tsx`

- 第 62-67 行硬编码 `PALETTE = ["#1677ff", "#52c41a", "#faad14", "#eb2f96", "#722ed1"]`（antd 老色板），第 177 行 `PALETTE[i % PALETTE.length]` 用于给人员着色
- 状态点（`#1677ff` 等）内联在状态显示逻辑中，未走 StatusBadge
- 矩阵单元格 `backgroundColor` 直接消费 PALETTE hex

### 列表页（project-plans / task-plans / milestone-details / work-hour-statistics）

- `project-plans/page.tsx` 共 6 处内联 `style={{ width: N }}`：
  - 第 382/390/414 行 `style={{ width: 220 }}`
  - 第 422/428/434 行 `<RangePicker style={{ width: 240 }} />`
- Button 混用：antd `Button type="link"` 与 shadcn `Button` 并存
- 容器零散（无统一 PageContainer/PageHeader/SectionCard/DataTable）

### topology `workspaces/[id]/components/topology/page.tsx`

- 第 28-35 行 `TYPE_COLORS` 使用 Tailwind 默认色阶，与主色脱节：
  - `#3b82f6` / `#10b981` / `#f59e0b` / `#6366f1` / `#ec4899` / `#8b5cf6` / `#06b6d4` / `#f97316`
- 第 45 行 `#64748b` 兜底色、第 113-114 行 `#94a3b8`/`#475569` 边线与标签色

### ppm-resource-table.tsx

- 硬编码 `inputCls` / `textareaCls` className 常量，未走 token / CSS 变量

## 实现要点

### 看板

1. `PALETTE` 替换为 tokens 的色阶数组（task-01 的 `blue`/`cyan`/`emerald`/`amber`/`pink`/`purple` 对应 DEFAULT 或 500/600 档），命名保留 `PALETTE` 以最小化改动面
2. 状态点（`#1677ff` 等）→ 用 task-06 的 `StatusBadge` 组件渲染
3. 矩阵单元格 `backgroundColor` 消费新的 token 色阶数组

### 列表页（4 个 page.tsx）

1. 容器替换：零散 div/Card → task-07 的 `PageContainer` / `PageHeader` / `SectionCard` / `DataTable`
2. 消除内联 width：
   - 第 382/390/414 行 `style={{ width: 220 }}` → `colWidth={220}` prop 或 `className="w-[220px]"`
   - 第 422/428/434 行 `RangePicker style={{ width: 240 }}` → `className="w-[240px]"`
3. Button 统一为 shadcn（task-05），行操作用 `variant="ghost"`；移除 antd `Button type="link"`（业务组件 antd Table/Form 保留，见 D-006）

### topology

1. `TYPE_COLORS` 替换为 brand/blue 色阶数组（task-01 tokens），保留 type→color 映射结构
2. 兜底色 `#64748b`、边线 `#94a3b8`、标签 `#475569` → token 对应档位

### ppm-resource-table.tsx

1. `inputCls` / `textareaCls` → 走 token / CSS 变量（如 `hsl(var(--input))` 等 shadcn 语义色或 tokens.ts 色阶常量）

### 收尾 grep 兜底

1. `rg -n '#[0-9a-fA-F]{6}' frontend/src/app/\(dashboard\)/ppm/`
2. `rg -n 'PALETTE' frontend/src/`
3. `rg -n 'style=\{\{' frontend/src/app/\(dashboard\)/ppm/`
4. 命中已迁移的记录确认、遗漏的逐一替换为 token

## 边界

1. 纯样式适配，绝不改业务逻辑 / 数据流 / API 调用（state、useEffect、fetch、表单提交逻辑原样保留）
2. 保留 antd `Table` / `Form` / `DatePicker` / `RangePicker` 等业务组件本体，只改它们的 className / style / 容器层级（D-006@v1）
3. 渐进迁移：页面多则按优先级推进（看板 → 列表页 → topology → ppm-resource-table），未在本任务周期内完成遗漏页在「遗留风险」记录
4. 内联 `style={{ width: N }}` 一律改为组件 `colWidth`/`width` prop 或 Tailwind `w-[Npx]` 类，不留任何 `style={{ width }}` 字面量
5. grep 兜底发现的散落 hex 色值逐一替换为 token，不放过任何一处（包括注释中的色值说明，至少改为引用 token 名称）

## 非目标

- 不改业务逻辑、不重写页面功能
- 不替换 antd 业务组件（Table/Form/DatePicker/RangePicker 等）
- 登录页归 task-10
- 不改 tokens 定义本身（task-01）、不改组件库本体（task-06/07/08）

## 验收

| 编号 | 验收项 | 验证方式 |
|------|--------|----------|
| AC-01 | grep 散落蓝（`#1e3a5f`/`#1677ff`/`#3b82f6` 等）在 ppm 目录为空 | `rg -n '#1677ff\|#3b82f6\|#1e3a5f\|#52c41a\|#faad14' frontend/src/app/\(dashboard\)/ppm/` 无命中 |
| AC-02 | 看板状态点用 StatusBadge 渲染 | grep kanban/page.tsx 与 _components 导入并使用 `StatusBadge`，无内联状态点 hex |
| AC-03 | 列表页用 PageContainer / DataTable 且无内联 width | grep 4 个列表页导入 `PageContainer`/`DataTable`；`rg 'style=\{\{ *width' frontend/src/app/\(dashboard\)/ppm/` 无命中 |
| AC-04 | topology 用 brand 色阶（无 `#3b82f6`/`#10b981`/`#8b5cf6` 等默认色） | `rg -n '#3b82f6\|#10b981\|#8b5cf6\|#06b6de\|#f97316' frontend/src/app/\(dashboard\)/workspaces/\[id\]/components/topology/` 无命中 |
| AC-05 | tsc 通过 | `cd frontend && npx tsc --noEmit` 零错误 |

## 依赖说明

- depends_on task-06：需要 `StatusBadge` 组件用于看板状态点替换
- depends_on task-07：需要 `PageContainer`/`PageHeader`/`SectionCard`/`DataTable` 用于列表页容器替换
- depends_on task-08：需要 ppm-resource-table 的 inputCls/textareaCls token 改造基准（若 task-08 含此文件改造则本任务只做校验，否则在本任务内完成）
- blocks task-11：整体回归与验收依赖本任务页面对齐完成
