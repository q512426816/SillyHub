---
author: WhaleFall
created_at: 2026-07-23T18:30:00
---

# 项目周计划一览表 — 方案概述

## 一句话

新建「项目周计划一览表」模块，聚合展示所有项目实施阶段（三级）里程碑下的明细+任务计划（PlanTask），19 列列表 + 导出 Excel（匹配用户提供模板）。

## 数据源

5 表 JOIN：PpmProjectMaintenance → PsProjectPlan → PsPlanNode(has_module=true) → PsPlanNodeDetail → PlanTask(LEFT JOIN)。**不新建表/字段**。

## 产出

1. **后端**：聚合查询 service + 列表/导出 2 个 API 端点。
2. **前端**：新页面 `/ppm/weekly-plan`（antd Table 19 列两级表头 + 搜索 + 导出）。
3. **导出**：grouped_report_to_workbook 按项目分组，两级表头，4 列留空。

## 原型

`prototype-weekly-plan.html` — 完整 HTML 原型，3 项目示例数据。

## 规模

scale=large（跨 ppm/task 子域，新后端端点 + 新前端页面 + 导出）。
