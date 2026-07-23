---
author: qinyi
created_at: 2026-07-16 09:20:22
---

# 设计文档（Design）— 工作台"我的任务"查询改造

## 1. 背景
个人工作台"我的任务"区域查询能力不足：①【本周/本月/全部】按钮在指标条（位置不当）；② 无具体日期范围选择器；③ 项目是文本输入（不便）；④ 模块从结果推导但不联动项目；⑤ 无状态筛选。

## 2. 需求（用户确认）
1. 【本周/本月/全部】按钮从指标条移到"我的任务"查询区。
2. 加日期范围选择器（RangePicker），3 按钮控制其值（本周→周一~周日、本月→1 号~月末、全部→置空）。
3. 按日期范围查询任务。
4. 项目名称改下拉选（`listSimpleProjects`），联动模块下拉（选项目后模块 options 更新）。
5. 加任务状态下拉筛选（未开始/进行中/已完成）。
- 指标卡固定"本月"（不随任务查询联动）。
- 任务走后端查（`PlanTaskPageReq` 已支持 `start_time`/`end_time`/`project_id`/`status`）。

## 3. 设计

### 3.1 PersonalMetricStrip（指标条）
- 去掉【本周/本月/全部】按钮 + `onRangeChange` prop + `range` prop。
- 指标固定按"本月"显示（前缀"本月"或去掉前缀）。

### 3.2 page.tsx
- 去掉 `range` state + `inTaskRange` + `visibleTasks` + `tasks`/`loadTasks`（任务装配移到 WorkbenchTaskTable 自包含）。
- `loadSummary` 固定 `fetchWorkbenchSummary("month")`（不依赖 range）。
- `WorkbenchTaskTable` 改为自包含（不再下传 tasks）。

### 3.3 WorkbenchTaskTable（核心重构）
- **自包含 fetch**：内部调 `listPersonalPlanTasks({ start_time, end_time, project_id, status, page, page_size })`。
- **筛选 toolbar**（一行）：
  - 预设按钮：本周 / 本月 / 全部（点击设 RangePicker 值）
  - `DatePicker.RangePicker`（自定义日期范围；预设按钮设置它，全部置空）
  - 项目下拉（`listSimpleProjects`，value=project_id）
  - 模块下拉（options 从当前结果 tasks 的 `module_name` 推导；选项目→后端查→options 自动更新=联动）
  - 状态下拉（未开始/进行中/已完成，value=status）
  - 重置按钮
- **过滤分工**：日期范围/项目/状态 → 后端查；模块 → 前端过滤（`PlanTaskPageReq` 无 module 字段）。
- **查询触发**：日期范围/项目/状态 变 → useEffect 重查；模块变 → 前端 filter（不重查）。
- 选项目时清空 moduleId（旧模块可能不在新结果）。
- 执行/详情/Toast 逻辑保留。

## 4. 文件变更

| 操作 | 文件 | 说明 |
|---|---|---|
| 修改 | frontend/.../workbench/page.tsx | 去 range/tasks 装配，summary 固定 month，WorkbenchTaskTable 自包含 |
| 修改 | frontend/.../workbench/_components/workbench-task-table.tsx | 重构：自包含 fetch + 4 筛选 toolbar + 模块前端过滤 |
| 修改 | frontend/.../workbench/_components/personal-metric-strip.tsx | 去 range 按钮 + onRangeChange/range prop |

## 5. 非目标
- 不改后端（`PlanTaskPageReq` 已支持过滤）。
- 不改日历（上次已改）。
- 不改任务执行/详情逻辑。

## 6. 风险
- 模块下拉 options 依赖当前查询结果（选项目后从新结果推导），若结果为空则模块无选项 —— 可接受（符合筛选语义）。
- 日期范围预设用本地周一/月末（dayjs），与后端 UTC 过滤可能有边界差异 —— 沿用现有 `inTaskRange` 口径（本地日）。
