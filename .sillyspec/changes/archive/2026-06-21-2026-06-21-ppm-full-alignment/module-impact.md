---
author: qinyi
created_at: 2026-06-21T08:15:00+0800
change: 2026-06-21-ppm-full-alignment
stage: archive
analyzer: impact-analyzer
commit: af55ab9
---

# 模块影响矩阵

## 分析方法
三重交叉验证:声明范围(design.md §6 文件变更清单)∪ 任务范围(plan.md/tasks.md W1-W6)∪ 真实变更(`git diff --name-only HEAD~1`,45 文件)。以 git diff 为准(真实 > 声明)。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件数 | 更新内容摘要 | needs_review |
|------|----------|-----------|-------------|--------------|
| ppm | 逻辑变更 + 数据结构变更 + 接口变更 + 新增 | 19 | W1 kanban task CRUD + 新表 ppm_kanban_comment/subtask(D-011)+ comment/subtask 端点 + UserColumn saturation;W2 problem 变更流4节点 fsm(bug 跳部门经理)+ next_process/reject_process + plan submit_detail + audit_log + list-by-date-range;W3 plan three-level 三联表查询 + _derive_remaining(budget-actual,D-014);migration 2607210900 | false |
| frontend_app | 逻辑变更 + 新增 | 8 | W1 kanban/page + task-detail-drawer;W4 milestone-details 6 态表单 + 并发 422/409 处理;W6 task-execute 详情页(466 行)+ problem-changes 多态;W5 work-hour-statistics 图表;W3 project-plans 17 字段表单 + 三联表 | false |
| frontend_components | 新增 | 6 | ppm-project-plan-form(17 字段)+ ppm-project-plan-detail(三联表);charts/ WorkHourBarChart/WorkHourPieChart/ProjectPlanCostBarChart + index(D-013 echarts-for-react) | false |
| frontend_lib | 逻辑变更 + 新增 | 5 | lib/ppm/kanban.ts(task/comment/subtask API)+ plan.ts(three-level/submit-detail/process)+ problem.ts(next/reject/list-by-date-range)+ types.ts(CommentVO/SubtaskVO/ProjectPlanThreeLevelResp)+ aggregations.ts(图表聚合) | false |

## 未匹配文件

| 文件 | 原因 |
|---|---|
| frontend/package.json | 依赖声明(echarts ^6.1.0 + echarts-for-react ^3.0.6,D-013),非模块代码 |
| frontend/pnpm-lock.yaml | lockfile 自动生成 |
| .sillyspec/changes/2026-06-21-ppm-full-alignment/plan.md | sillyspec 变更文档(本次自身) |

## 影响摘要
本次变更影响 4 个模块(ppm / frontend_app / frontend_components / frontend_lib),全部为 ppm 全模块对齐源,无跨模块破坏性改动。ppm 模块为新增模块(2026-06-20 迁入),本次为首次大范围对齐源功能,建议 archive 后补充 ppm 模块卡片(scan)。

## 模块文档同步建议
- ppm 模块 `_module-map.yaml` needs_review=true(迁入未完善卡片):本次归档不强制更新卡片(无卡片可更新),建议作为 follow-up 跑 sillyspec scan 完善 ppm 模块文档
- frontend_app / frontend_components / frontend_lib:无独立卡片,沿用既有约定,无需同步
