---
id: task-05
title: W3 problem 子域四件套 + 4 节点审批流状态机
priority: P0
estimated_hours: 16
depends_on: [task-01, task-03]
blocks: [task-08, task-11]
requirement_ids: [FR-03]
decision_ids: [D-004@v1, D-006@v1]
author: qinyi
created_at: 2026-06-20T14:52:22+0800
---

## 目标
实现 problem 问题清单子域(问题清单 + 变更 + 在办/履历×2),4 节点审批流状态机:已保存(1)→审核中(2)→处置中(3)→待验证(6)→已关闭(4),驳回→已作废(5),bug 类型跳过部门经理节点,有未关闭变更标记"变更中"(7 内存态)。覆盖 FR-03、D-004@v1、D-006@v1。

## 文件
- 新增 `backend/app/modules/ppm/problem/{model,router,service,schema}.py`
- 新增 `backend/app/modules/ppm/problem/tests/test_problem_flow.py`
- 新增 `backend/migrations/versions/2026mmdd_create_ppm_problem_tables.py`(6 表)

## 实现要点
- model:6 表对齐源 DO(见 `ppdmq-module-ppm-biz/.../dal/dataobject/problem/`),表名 `ppm_problem_list / ppm_problem_change / ppm_problem_list_process_task / ppm_problem_list_process_log / ppm_problem_change_process_task / ppm_problem_change_process_log`;继承 `BaseModel`;`ppm_problem_change.resource_id` 关联源问题。
- 状态机参照 `change.TRANSITIONS` 写法,problem FSM:1→2→3→6→4;任何审核/处置节点 reject→5;bug(type=bug)跳过部门经理节点。
- service 端点:`nextProcess / rejectProcess / doneTask / closeTask`;每次流转同事务写 `ProcessLog` + `ProcessTask` + `audit_log`(D-006@v1 通知走审计日志,无站内信)。
- "找下一处理人":按 ppm 项目角色(开发/项目/部门经理)查 `ppm_project_member`(W3 依赖 task-03);缺失角色成员时 fallback 流程挂起 + 返回待指派提示(X-003)。
- 对照源 `service/process/ProblemNode10/20/30/40 + ProblemProcesssExecutor` 逐条核对节点跳转(design §12 自审存疑项)。
- router `require_permission_any(PPM_*)`;固定路径端点前置于参数化路由。

## 验收
- [ ] 6 表 alembic upgrade 成功,env.py import 完整
- [ ] 全状态路径:1→2→3→6→4、reject→5、bug 跳部门经理,pytest 全绿
- [ ] 每次流转 ProcessLog + ProcessTask + audit_log 三写
- [ ] 项目角色缺失时挂起并返回待指派提示(X-003)
- [ ] 端点 require_permission_any 鉴权,无权限 403
- [ ] 有未关闭变更标记"变更中"(7 内存态)正确
