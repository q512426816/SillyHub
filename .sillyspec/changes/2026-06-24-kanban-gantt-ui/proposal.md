---
author: WhaleFall
created_at: 2026-06-24T09:40:00
---

# 提案:kanban 矩阵 → 时间轴甘特图 UI 重做

## 背景
`/ppm/kanban` 当前主体是人员×日期矩阵(`KanbanMatrix`/`KanbanActualMatrix`),看「单日谁做什么」直观,但**看不出任务跨天排期、并行重叠、排期冲突**。

## 目标
把主体改成**时间轴甘特图**:纵轴人员(多行泳道),横轴日期,任务以跨日条形呈现(`start→deadline` / `actual_start→actual_end`),一眼看清排期冲突和并行。其余功能区保留。

## 方案概要(方案 A 自研,已与用户确认)
- 新增 `KanbanGantt`/`KanbanActualGantt` + `kanban-gantt-helpers`(纯函数 + 单测)替代两个 Matrix
- `page.tsx` 换标签,两个新组件**各自对齐自己的 Matrix props**
- 多行泳道(贪心分配首个不冲突槽) + 条形 CSS 绝对定位 + 今天竖线 + 周末高亮
- 复用 SearchBar/DateNav/WorkHourChart/CRUD 弹窗/计划-实际两 tab;只读 + 点击详情

## 影响范围
- **前端**:`kanban/page.tsx`(改) + `_components/`(新增 kanban-gantt/kanban-actual-gantt/kanban-gantt-helpers + test,删 kanban-matrix/kanban-actual-matrix/kanban-actual-cell,grouping.ts 待 grep)
- **后端**:无(只读展示,不改 API/数据模型)
- **数据契约**:复用 `KanbanTaskCard`/`TaskExecuteWithPlan`,不改

## 风险
- 横向滚动 + sticky 表头性能(人员多/范围长)→ `DAY_WIDTH=90px` 固定横向滚动,虚拟化 YAGNI
- 删 Matrix/grouping 死代码 → execute 前 grep 确认无其他引用

详见 `design.md`。
