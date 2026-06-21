---
author: qinyi
created_at: 2026-06-21T02:30:40+0800
change: 2026-06-21-ppm-full-alignment
---

# ppm 全模块对齐源设计

## 1. 背景
ppm 后端(20表/102路由)+ 前端(13页面/交互对齐)已就绪。源(dept_project_back/front)有更多功能:看板任务工作站、变更流4节点、projectplan三联表+成本、psplannode审批6态、图表。全模块对齐,除文件上传/工作流。

## 2. 目标
W1-W6 全量对齐源功能(看板/审批流/计划/图表/收尾)。

## 3. 非目标
文件上传(D-007/010)、工作流 silly 引擎(D-002 状态机替代)、silly 动态表单。

## 4. 拆分
6 Wave,单变更内管理,复用现有 ppm-sub-table/ppm-status-actions/PpmUserSelect。

## 5. 方案(W1-W6)
- **W1 看板**:任务 CRUD(POST/PUT/DELETE /kanban/task)+ assignee + TaskDetailDrawer(评论/子任务/附件);UserColumnVO 加 taskCount/totalHours/saturation
- **W2 审批流**:ProChangeProcesssExecutor 变更流4节点(复用 problem 流骨架)+ psplannode submitDetail + problem-change nextProcess/rejectProcess + 通知(审计日志)
- **W3 projectplan**:三联表(项目计划→PS节点→任务)+ 成本派生(remaining=budget-actual)+ 前端17字段表单
- **W4 psplannode 审批6态**:Add/Approve/Audit/ChangeApprove/Change/View 表单(复用 ppm-status-actions + ppm-sub-table)
- **W5 图表**:echarts-for-react;work-hour 统计(柱+饼)+ projectplan 成本条形
- **W6 收尾**:task-execute 详情/problemchange 多态/plannodemodule 独立页/list-by-date-range

## 6. 文件变更清单
| Wave | 后端 | 前端 |
|---|---|---|
| W1 | kanban router/service task CRUD + comment/subtask 表 | kanban/page.tsx TaskDetailDrawer |
| W2 | problem/service 变更流4节点 + submitDetail + 通知 | problem-change 页 |
| W3 | plan/service 三联表查询 + 成本计算 | project-plans 三联表 + 17字段 |
| W4 | plan/router submitDetail | milestone-details 6态表单 |
| W5 | - | work-hour-statistics + project-plans 图表 |
| W6 | problem list-by-date-range | task-execute 详情等 |

## 7. 接口/组件
看板:/api/ppm/kanban/task CRUD + /task/{id}/{comments,subtasks};变更流:problem-change nextProcess/rejectProcess(复用 problem fsm);图表:echarts-for-react。

## 8. 数据模型
W1 新表:ppm_kanban_comment, ppm_kanban_subtask(D-011)。其余复用现有 20 表。

## 9. 兼容
扩展现有,不破坏。

## 10. 风险
R-01 W4 审批6态工作量大(对照源9 Vue);R-02 W1 看板评论/子任务新表;R-03 对话context长,execute建议分批/新对话续。

## 11. 决策追踪
D-011 看板评论/子任务新表 / D-012 通知审计日志(延续D-006)/ D-013 echarts-for-react / D-014 成本派生计算。

## 12. 自审
全覆盖 W1-W6;D-011~014;约定一致;YAGNI(除文件/工作流);各 Wave 独立 verify。
