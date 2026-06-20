---
author: qinyi
created_at: 2026-06-21T02:30:40+0800
change: 2026-06-21-ppm-full-alignment
---
# Requirements
## 功能需求
### FR-01 看板任务工作站(D-011)
看板任务 CRUD + 评论/子任务/附件 + UserColumn 饱和度
### FR-02 变更流4节点+通知(D-012)
ProChangeProcesssExecutor + submitDetail + nextProcess/rejectProcess + 审计日志通知
### FR-03 projectplan三联表+成本(D-014)
项目计划→PS节点→任务联表 + 成本派生(remaining) + 17字段表单
### FR-04 psplannode审批6态
Add/Approve/Audit/ChangeApprove/Change/View 表单
### FR-05 图表(D-013)
echarts-for-react;work-hour统计(柱+饼)+ projectplan成本条形
### FR-06 收尾
task-execute详情/problemchange多态/plannodemodule/list-by-date-range
## 决策覆盖
D-011→FR-01;D-012→FR-02;D-013→FR-05;D-014→FR-03
