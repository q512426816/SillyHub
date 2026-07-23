---
author: WhaleFall
created_at: 2026-07-23T18:30:00
---

# 项目周计划一览表 — 任务清单

## W1: 后端聚合查询 + API

- [ ] task-01: 新建 service 聚合查询(5表JOIN, PsPlanNodeDetail 驱动, LEFT JOIN PlanTask, WHERE has_module=true)
- [ ] task-02: 新建 schema (WeeklyPlanRow Pydantic DTO, 19 字段)
- [ ] task-03: 新建 router 端点 GET /api/ppm/weekly-plan (分页+筛选 project_name/status/user_id/date_range)
- [ ] task-04: 新建导出端点 GET /api/ppm/weekly-plan/export-excel (grouped_report_to_workbook 按项目分组)
- [ ] task-05: 后端聚合查询单测 (JOIN 正确性 + 筛选 + 分页)

## W2: 前端页面

- [ ] task-06: lib/ppm 新建 weekly-plan.ts 客户端 (listWeeklyPlan + exportWeeklyPlan) + types
- [ ] task-07: 新建 (dashboard)/ppm/weekly-plan/page.tsx (PageContainer + 搜索区 + DataTable 19列两级表头 + 导出)
- [ ] task-08: 前端页面测试

## W3: 集成

- [ ] task-09: 侧边栏菜单加「项目周计划」入口 (app-shell.tsx)
- [ ] task-10: ppm 模块文档更新 + 全量验证
