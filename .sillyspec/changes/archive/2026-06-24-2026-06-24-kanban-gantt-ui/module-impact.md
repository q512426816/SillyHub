---
author: WhaleFall
created_at: 2026-06-24T11:30:00
---

# 模块影响:kanban 时间轴甘特图

变更:`2026-06-24-kanban-gantt-ui`
分析方法:三重交叉(proposal/design 声明 + plan 任务路径 + git diff 真实变更),以 git diff 为准。
真实变更范围:7 个 commit(`d8e6966b` feat → `6f57bf06` style/fix),仅 kanban 目录 + grouping。

## 影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|------|----------|----------|-------------|-------------|
| frontend_app | 逻辑变更 / 新增 / 删除 / 调用关系 | `ppm/kanban/page.tsx`(改)<br>`ppm/kanban/_components/kanban-gantt.tsx`(新增)<br>`ppm/kanban/_components/kanban-actual-gantt.tsx`(新增)<br>`ppm/kanban/_components/kanban-gantt-helpers.ts`(新增)<br>`ppm/kanban/_components/kanban-gantt-helpers.test.ts`(新增)<br>`ppm/kanban/_components/kanban-matrix.tsx`(删除)<br>`ppm/kanban/_components/kanban-actual-matrix.tsx`(删除)<br>`ppm/kanban/_components/kanban-actual-cell.tsx`(删除) | 新增 2 甘特组件 + helpers(纯函数 14 单测)替代 2 Matrix + cell;page 两 tab 换 Gantt;多行泳道贪心 + 条形绝对定位 + 今天竖线/周末高亮。注:`kanban/_components/` 在 `app/` 下,归属 frontend_app | false |
| frontend_lib | 删除(死代码) | `lib/ppm/kanban-grouping.ts`(删除) | groupByUserAndDate/ExecuteDate/dateRangeKeys/weekdayMeta 仅被已删 Matrix 引用,随之删除 | false |

## 未匹配文件

无。所有变更文件均匹配到上述 2 个模块。

## 说明

- kanban/_components 在 `frontend/src/app/**` 下 → 归 frontend_app(非 frontend_components,后者 paths 是 `components/**`)。
- `git diff a6e037f4..HEAD` 含大量非本变更文件(其他 quick/变更累积),本矩阵仅统计本次 kanban 变更的 7 个 commit 实际触及的文件。
- 后端无改动(只读展示,无 API/数据模型变更)。
- `frontend_stores`(kanban store)、`frontend_lib/kanban.ts`(API)未改动,复用。
