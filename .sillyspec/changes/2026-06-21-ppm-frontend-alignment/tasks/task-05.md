---
id: task-05
title: 里程碑审批表单差异化 + AntD Timeline 流程履历
priority: P1
estimated_hours: 10
depends_on: [task-01, task-04]
blocks: []
requirement_ids: [FR-03]
decision_ids: []
author: qinyi
created_at: 2026-06-21T01:10:00+0800
---

## 目标
里程碑明细按 status 分多抽屉表单(草稿/审核/审批/变更/查看),各字段按状态 disabled;AntD Timeline 展示 `ps_plan_node_detail_process` 流程履历。覆盖 FR-03。

## 文件
- `frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx`(改:操作列按 status 打开对应抽屉表单 + 右侧/底部 Timeline)

## 实现要点(对照源)
- 对照源 `psplannode` 下:`AuditNodeDetailForm`(审核)、`ApproveNodeDetailForm`(审批)、`ChangeNodeDetailForm`(变更)、草稿/查看表单。
- 按 status 路由表单:status=10 草稿(全字段可编辑)、20/25/30 审核/审批(审核意见/审批结论字段可编辑,其余 disabled)、变更(变更原因字段)、查看(全 disabled)。
- 复用 task-01 PpmUserSelect(审批人按角色筛 res=projectMember + searchData role_name)。
- Timeline:取 `ps_plan_node_detail_process`,按时间倒序 AntD `<Timeline>`,每项 操作人/动作/时间/意见(PpmText 渲染人名)。
- 表单提交复用 lib/ppm 审批接口。

## 验收
- [ ] 操作列按 status 打开正确抽屉表单(5 类)
- [ ] 各表单字段 disabled 策略对照源,草稿可编辑/查看全锁
- [ ] 审批人下拉按项目+角色过滤(res=projectMember + role_name)
- [ ] Timeline 渲染 process 履历,人名经 PpmText 解析
- [ ] frontend typecheck + build 通过
