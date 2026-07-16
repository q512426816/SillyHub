---
author: WhaleFall
created_at: 2026-07-16T09:32:00
---

# 决策台账 — 计划节点模板子表样式优化

> 本文件是变更 `2026-07-16-plan-node-subtable-style` 的决策台账，仅记录有实现 / 验收影响的决策。

## D-001@v1
- **type**: scope
- **status**: accepted
- **source**: 用户（brainstorm Step 6 对话式探索，AskUserQuestion）
- **question**: 本次子表样式优化的改动范围定在哪？
- **answer**: 只改「计划节点模板」页（plan-nodes），不动 `PpmSubTable` 通用组件。
- **normalized_requirement**: 变更范围限定 `frontend/src/app/(dashboard)/ppm/plan-nodes/page.tsx` 单文件；禁止修改 `frontend/src/components/ppm-sub-table.tsx`。
- **impacts**: 文件变更清单仅 1 文件；`milestone-details`、`ppm-project-plan-detail` 两处使用方零回归。覆盖 design §3 非目标 / §6 文件清单。
- **evidence**: 用户在 AskUserQuestion 选择「只改计划节点模板页（推荐）」。
- **priority**: P0

## D-002@v1
- **type**: scope
- **status**: accepted
- **source**: 用户（brainstorm Step 6，AskUserQuestion）
- **question**: 展开行里有两个子表（模板明细、模块），本次优化哪些？
- **answer**: 两个子表都优化。
- **normalized_requirement**: 明细子表（`PpmSubTable` editable，7 列）与模块子表（AntD `Table`，5 列）均纳入本次滚动隔离 + 列宽调整。
- **impacts**: `PlanNodeChildren` 内两个子表外层均加限宽滚动容器；明细列宽压缩。覆盖 design §5 总体方案。
- **evidence**: 用户在 AskUserQuestion 选择「两个子表都优化（推荐）」。
- **priority**: P1

## D-003@v1
- **type**: approach
- **status**: accepted
- **source**: 用户（brainstorm Step 8 方案选择，AskUserQuestion）
- **question**: 三个方案（A 外层滚动容器+压缩列宽 / B 子表固定宽度 / C 改母表列布局）视觉效果一致，选哪个实现路径？
- **answer**: 方案 A——外层滚动容器 + 压缩列宽。
- **normalized_requirement**: 采用「子表外层限宽 `overflow-x` 容器 + 明细列宽压缩」实现，淘汰方案 B（固定宽度需手算调试）与方案 C（动母表列布局，改动面大）。
- **impacts**: 实现方式 = wrapper div + `DETAIL_COLUMNS` width 调整；不动母表 scroll / 列结构。覆盖 design §5。
- **evidence**: 用户在 AskUserQuestion 选择「方案 A：外层滚动容器+压缩列宽（推荐）」。
- **priority**: P0

## D-004@v1
- **type**: implementation
- **status**: accepted
- **source**: 架构分析（brainstorm Step 9）
- **question**: 子表限宽容器用百分比（`max-w-full`）还是绝对值？
- **answer**: 绝对值 `calc(100vw - 340px)`。
- **normalized_requirement**: 滚动隔离容器宽度用 `calc(100vw - 340px)`（视口宽 − 左侧导航 256 − 页面 padding/展开缩进 ~84），不用百分比，以切断 AntD `scroll.x: max-content` 在嵌套场景的循环依赖。
- **impacts**: 决定 §5.1 容器实现；衍生 R-01（偏移值需实测）/ R-02（max-content 隔离失效则退固定 scroll.x）。
- **evidence**: design §5.1 论证（百分比在母表 max-content 下循环依赖，无法切断传导）。
- **priority**: P1
