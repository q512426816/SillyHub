---
schema_version: 1
doc_type: module-card
module_id: ppm
author: qinyi
created_at: 2026-06-20T15:35:00+0800
---

# ppm — 项目与问题管理

## 定位
平台级业务模块(不绑 workspace),从 dept_project_back/ppdmq-module-ppm 全量复刻。路由 `/api/ppm/*`,`require_permission_any(PPM_*)`。

## 契约摘要
- **5 子域**:`project`(项目/客户/成员/干系人)、`plan`(模板 + ps 计划/里程碑)、`problem`(问题清单 + 变更)、`task`(任务计划/执行/工时)、`kanban`(看板聚合)
- **common**:`crud`(分页泛型 Page[T])/`export`(openpyxl)/`fsm`(状态机基类,参照 change.TRANSITIONS)
- **21 表 / 102 路由 / 2 套状态机**(问题 4 节点审批流 + 里程碑 draft→review→approve→done + 变更版本链)
- **权限**:PPM_PROJECT_*/CUSTOMER_*/PLAN_*/PROBLEM_*/TASK_*/WORKHOUR_*/KANBAN_*(24 个,auth/permissions.py)

## 关键逻辑
- 问题审批流:申请→开发经理→项目经理→部门经理→验证→关闭;**bug 跳过部门经理**;按项目角色查 project_member 找下一处理人(缺失则挂起 ProblemPendingAssignment)
- 里程碑变更:走 `parent_id` 版本链(旧版 archived,新版 draft),不走状态迁移
- 复用 auth(User/Org/Role)、audit_logs、settings

## 注意事项
- 平台级,**无 workspace_id**
- 通知走 audit_logs(**无独立站内信**),附件用 `file_urls` JSON(**无上传服务**)
- silly 动态表单已弃(状态机替代),多租户 tenant_id 丢弃
- 工时统计 stat-by-user/project;看板 reorder 持久化 kanban_order

## 人工备注
<!-- MANUAL_NOTES_START -->
迁移自 dept_project_back/ppdmq-module-ppm + dept_project_front(变更 2026-06-20-ppm-module-migration)。源 ~120 接口/22 表/2 套审批流。e2e 动态验证待运行环境。
<!-- MANUAL_NOTES_END -->
