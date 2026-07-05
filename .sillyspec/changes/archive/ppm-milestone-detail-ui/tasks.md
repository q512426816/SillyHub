# Tasks — ppm 里程碑明细：模块ID下拉 + 日期中文化 + 回显修复

author: qinyi
created_at: 2026-06-21 23:57:07
id: ql-20260621-004-c4a1
type: quick

## 背景

`ppm/milestone-details/page.tsx`（2243 行）存在 3 类 UI 问题：

| # | 问题 | 根因 |
|---|------|------|
| 1 | 明细表单"所属模块 ID"是 `<Input>` 手填 | `module_id` 字段用 Input，未用父组件已有的 `modules` 列表做下拉 |
| 2 | DatePicker 周几/日历显示英文、时区非中国 | 全局仅配 `ConfigProvider locale={zhCN}`，**未配 `dayjs.locale('zh-cn')`**；antd v5 Picker 日历表头/边界依赖 dayjs locale |
| 3 | 表格日期列显示 `2025-03-31T00:00:00Z` | 日期列 `render: (v) => v ?? "—"` 原样输出后端 ISO 字符串 |

## 方案

1. `antd-providers.tsx`：`import 'dayjs/locale/zh-cn'; dayjs.locale('zh-cn')`，全局生效（周几中文 + Picker 边界按 zh-cn）。
2. `milestone-details` 明细表单 `module_id`：`<Input>` → `<Select>`，options 来自 `modules`（`listPlanNodeModules(planNodeId)` 已在父级 state），value=`id` label=`module_name`；需把 `modules` 透传进 `DetailDrawer`。
3. 抽轻量 `fmtDate(v)`（`dayjs(v).format('YYYY-MM-DD')`，空值 → `—`），替换所有日期列 `render` 原样输出。
4. 顺手用同一 `fmtDate` 修复其他 ppm 页面日期列回显（仅修实际返回 ISO 的字段）。

## Tasks

- [x] T1 全局配 dayjs locale zh-cn（`frontend/src/components/antd-providers.tsx`）
- [x] T2 milestone-details 明细表单 `module_id` Input→Select（透传 `modules`）
- [x] T3 抽 `fmtDate` + 修复 milestone-details 所有日期列回显
- [x] T4 修复其他 ppm 页面日期列回显（plan-nodes / project-plans / work-hours / work-hour-statistics / problem-list）
- [x] T5 跑前端 lint + 受影响测试验证
