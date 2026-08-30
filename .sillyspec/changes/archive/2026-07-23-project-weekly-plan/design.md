---
author: WhaleFall
created_at: 2026-07-23T18:30:00
scale: large
---

# 项目周计划一览表 — 技术设计

## 1. 需求概述

新建「项目周计划一览表」模块，展示系统中**所有项目**实施阶段（三级里程碑 `has_module=true`）下的**全部明细及其关联任务计划（PlanTask）**，按用户提供的 Excel 格式（19 列）列表展示 + 导出。

- **数据范围**：实施阶段里程碑下所有明细（PsPlanNodeDetail），有 PlanTask 的显示任务信息，无的执行列留空。
- **延期原因/执行说明/评估说明/备注** 4 列：系统无对应字段，导出留空。
- **导出**：与 Excel 一致（按项目分组、两级表头、19 列）。

## 2. 数据模型（5 表 JOIN，不新建表/字段）

```
PpmProjectMaintenance (项目)
  └─ PsProjectPlan (项目计划)
       └─ PsPlanNode (里程碑, WHERE has_module=true)
            └─ PlanNodeModule (模块)
            └─ PsPlanNodeDetail (明细, 非 archived)
                 └─ PlanTask (任务计划, via ps_plan_node_detail_id)
```

### JOIN 逻辑

```sql
SELECT ... FROM ppm_plan_task t
LEFT JOIN ppm_ps_plan_node_detail d ON t.ps_plan_node_detail_id = d.id   -- 任务→明细
LEFT JOIN ppm_plan_node_module m ON d.module_id = m.id                   -- 明细→模块
INNER JOIN ppm_ps_plan_node n ON d.plan_node_id = n.id                   -- 明细→里程碑
INNER JOIN ppm_ps_project_plan p ON n.ps_project_plan_id = p.id          -- 里程碑→项目计划
INNER JOIN ppm_project_maintenance proj ON p.project_id = proj.id        -- 项目计划→项目
WHERE n.has_module = true                                                 -- 仅三级里程碑
  AND d.status != 'archived'                                              -- 非归档明细
```

注：无 PlanTask 的明细也要展示（LEFT JOIN），执行列留空。

### 修正：以明细为驱动（非 PlanTask）

实际上应该以 **PsPlanNodeDetail** 为驱动（用户要求"全部明细"），LEFT JOIN PlanTask：

```sql
SELECT ... FROM ppm_ps_plan_node_detail d
INNER JOIN ppm_ps_plan_node n ON d.plan_node_id = n.id
INNER JOIN ppm_ps_project_plan p ON n.ps_project_plan_id = p.id
INNER JOIN ppm_project_maintenance proj ON p.project_id = proj.id
LEFT JOIN ppm_plan_node_module m ON d.module_id = m.id
LEFT JOIN ppm_plan_task t ON t.ps_plan_node_detail_id = d.id
WHERE n.has_module = true AND d.status != 'archived'
ORDER BY proj.project_name, d.no
```

## 3. 列映射（19 列）

| # | Excel 列 | 数据源字段 | 说明 |
|---|---|---|---|
| A | 序号 | 行索引 | 自动编号 |
| B | 项目名称 | `proj.project_name` | 按项目分组合并 |
| C | 计划类型 | `m.plan_type`（正常计划/临时计划） | 模块的 plan_type |
| D | 任务分类 | `d.detailed_stage` | 明细阶段 |
| E | 平台/子系统 | `m.module_name` | 模块名 |
| F | 任务主题 | `d.task_theme` | — |
| G | 任务描述 | `d.task_description` | — |
| H | 工作量(人天) | `t.work_load` 或 `d.plan_workload` | 优先 PlanTask |
| I | 周次 | `=WEEKNUM(开始日期)` | 导出时计算 |
| J | 责任人 | `t.user_name` | PlanTask 责任人 |
| K | 开始日期 | `t.start_time` 或 `d.plan_begin_time` | 优先 PlanTask |
| L | 结束日期 | `t.end_time` 或 `d.plan_complete_time` | 优先 PlanTask |
| M | 状态 | `t.status`（未开始/进行中/已完成） | 无 PlanTask 时留空 |
| N | 开始时间 | `t.actual_start_time` | — |
| O | 完成时间 | `t.actual_end_time` | — |
| P | 延期原因 | — | **留空** |
| Q | 执行说明 | — | **留空** |
| R | 评估说明 | — | **留空** |
| S | 备注 | — | **留空** |

## 4. 后端 API

### 4.1 列表查询

```
GET /api/ppm/weekly-plan?page=1&page_size=20&project_name=&status=&user_id=&start_time=&end_time=
```

返回：`Page<WeeklyPlanRow>`，每行 = 一条明细+关联任务计划的扁平行。

**筛选**：项目名称(ilike)、状态(PlanTask.status 多值)、责任人(user_id)、日期范围(开始/结束)。

### 4.2 导出

```
GET /api/ppm/weekly-plan/export-excel?project_name=&status=&...
```

返回：Excel 文件（grouped_report_to_workbook，按项目名称分组，两级表头）。

## 5. 前端设计

### 5.1 新页面 `/ppm/weekly-plan`

- **路由**：`(dashboard)/ppm/weekly-plan/page.tsx`
- **布局**：PageContainer + PageHeader + SectionCard(搜索区) + DataTable(19 列)
- **搜索**：项目名称(Input)、状态(Select 多选)、责任人(PpmUserSelect)、日期范围(RangePicker)
- **导出**：导出按钮(SectionCard 工具栏，复用 downloadExcel)
- **表格**：antd Table，服务端分页，两级表头(rowSpan/colSpan)，项目名称列不合并(服务端分页无法跨页合并)，状态列 Tag

### 5.2 列定义（前端）

两级表头：
- 第一级：序号 / 项目名称 / 计划类型 / 任务分类 / 平台 / 任务主题 / 任务描述 / 工作量 / [任务计划安排] / [计划执行情况] / 评估说明 / 备注
- 第二级（任务计划安排）：周次 / 责任人 / 开始日期 / 结束日期
- 第二级（计划执行情况）：状态 / 开始时间 / 完成时间 / 延期原因 / 执行说明

## 6. 实现范围

| Wave | 任务 | 文件 |
|---|---|---|
| W1 | 后端 service 聚合查询 + schema | `ppm/plan/service.py` 或新 `ppm/weekly_plan/` |
| W1 | 后端 router(列表+导出) | `ppm/plan/router.py` 或新 router |
| W2 | 前端 lib/ppm 客户端 | `lib/ppm/weekly-plan.ts` + types |
| W2 | 前端页面 | `(dashboard)/ppm/weekly-plan/page.tsx` |
| W3 | 侧边栏菜单 | `app-shell.tsx` 加菜单项 |
| W3 | 测试 | 后端聚合查询单测 + 前端页面测试 |

## 7. 风险与边界

- **N+1**：聚合查询一次 JOIN 取全量，内存组装，避免逐行查。
- **版本链**：明细可能有版本链（parent_id），只取非 archived 的当前版本。
- **孤儿任务**：PlanTask.ps_plan_node_detail_id 为 null 的不纳入（LEFT JOIN 不会产生）。
- **权限**：走平台级认证(get_current_principal)，不做项目级数据范围过滤（所有项目可见）。
- **性能**：全量 JOIN + 分页，大数据量需加索引（已有 ix_ppm_plan_task_project 等）。

## 8. 文件变更清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `backend/app/modules/ppm/plan/service.py` | 修改 | 新增 `list_weekly_plan` + `list_weekly_plan_for_export` 聚合查询 |
| `backend/app/modules/ppm/plan/router.py` | 修改 | 新增 `GET /weekly-plan` + `GET /weekly-plan/export-excel` |
| `backend/app/modules/ppm/plan/schema.py` | 修改 | 新增 `WeeklyPlanRow` DTO + 查询请求 schema |
| `backend/app/modules/ppm/plan/tests/test_weekly_plan.py` | 新增 | 聚合查询单测 |
| `frontend/src/lib/ppm/weekly-plan.ts` | 新增 | API 客户端 |
| `frontend/src/lib/ppm/types.ts` | 修改 | 加 `WeeklyPlanRow` 类型 |
| `frontend/src/app/(dashboard)/ppm/weekly-plan/page.tsx` | 新增 | 页面 |
| `frontend/src/app/(dashboard)/ppm/weekly-plan/__tests__/` | 新增 | 页面测试 |
| `frontend/src/components/app-shell.tsx` | 修改 | 侧边栏加菜单项 |

## 9. 自审

| 检查项 | 结论 |
|---|---|
| 数据模型完整？ | ✅ 5 表 JOIN 覆盖全部需求字段 |
| API 契约清晰？ | ✅ 列表+导出 2 端点，筛选参数明确 |
| 列映射无遗漏？ | ✅ 19 列全覆盖，4 列留空已标注 |
| 不引入新表/字段？ | ✅ 纯 JOIN 现有表 |
| 性能？ | ✅ 一次 JOIN + 分页，避免 N+1 |
| 权限？ | ✅ 平台级认证，不过滤项目 |
| 前端两级表头？ | ✅ antd Table column.children 实现 |
| 导出格式匹配 Excel？ | ✅ grouped_report_to_workbook 按项目分组 |
| 边界（版本链/孤儿/空值）？ | ✅ 已处理 |
