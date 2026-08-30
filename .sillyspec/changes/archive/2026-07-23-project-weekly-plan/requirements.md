---
author: WhaleFall
created_at: 2026-07-23T18:30:00
---

# 项目周计划一览表 — 需求文档

## FR-01: 数据范围
展示所有项目实施阶段（三级里程碑 has_module=true）下的全部明细（PsPlanNodeDetail, 非 archived）。有 PlanTask 的显示任务信息（责任人/状态/时间），无的执行列留空。

## FR-02: 列定义（19 列）
序号/项目名称/计划类型/任务分类(detailed_stage)/平台(module_name)/任务主题/任务描述/工作量/周次(WEEKNUM)/责任人/开始日期/结束日期/状态/实际开始/实际完成/延期原因(留空)/执行说明(留空)/评估说明(留空)/备注(留空)。

## FR-03: 列表查询
GET /api/ppm/weekly-plan，服务端分页(page/page_size)，支持筛选：项目名称(ilike)、状态(多值)、责任人(user_id)、日期范围(start_time~end_time)。

## FR-04: 导出
GET /api/ppm/weekly-plan/export-excel，导出所有匹配行（不分页），按项目名称分组(grouped_report_to_workbook)，两级表头，4 列留空。

## FR-05: 前端页面
/ppm/weekly-plan，antd Table 两级表头，搜索区(项目/状态/责任人/日期范围)，导出按钮，服务端分页。

## NFR-01: 不新建数据库表/字段
全量 JOIN 现有 5 表，无 schema 变更。

## NFR-02: 权限
平台级认证(get_current_principal)，不做项目级数据范围过滤。

## NFR-03: 性能
一次 JOIN 取全量行，内存组装，避免 N+1。大数据量依赖现有索引。
