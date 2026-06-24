---
author: WhaleFall
created_at: 2026-06-24T09:40:00
---

# 任务:kanban 时间轴甘特图(plan 阶段细化 Wave 与依赖)

## Wave 1 — 核心算法与组件
- [ ] 新增 `kanban-gantt-helpers.ts`:`computeBarLayout`(日期→像素 + 裁剪) + `assignLanes`(贪心多行泳道) 纯函数
- [ ] 新增 `kanban-gantt-helpers.test.ts`:定位/裁剪/跨范围/泳道分配/null 兜底单测
- [ ] 新增 `kanban-gantt.tsx`:计划甘特(对齐 KanbanMatrix props:onTaskClick + onTaskContextMenu + projectColorMap + 必填 selected)
- [ ] 新增 `kanban-actual-gantt.tsx`:实际甘特(对齐 KanbanActualMatrix props:onEdit,无右键/无 projectColorMap,selected 可选)

## Wave 2 — 接入与清理
- [ ] 改 `page.tsx`:tab children 换 Gantt;实际 tab 不传 onTaskContextMenu/projectColorMap;删旧 import
- [ ] grep 确认无外部引用 → 删 `kanban-matrix.tsx` / `kanban-actual-matrix.tsx` / `kanban-actual-cell.tsx`
- [ ] grep 决定 `kanban-grouping.ts` 去留(仅 Matrix 用的函数删,整文件无其他引用则删)

## Wave 3 — 验证
- [ ] `pnpm typecheck` + 跑 `kanban-gantt-helpers` 单测 + kanban 现有测试
- [ ] Docker frontend 重建部署 + 人工验收(对照 design.md §9)

(plan 阶段拆细每个 task + 排 Wave 间依赖)
