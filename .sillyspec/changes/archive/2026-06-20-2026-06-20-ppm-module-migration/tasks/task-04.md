---
id: task-04
title: plan 子域四件套 + 里程碑状态机 + 迁移 + 测试
priority: P0
estimated_hours: 14
depends_on: [task-01]
blocks: [task-08]
requirement_ids: [FR-02, FR-04]
decision_ids: [D-002@v1]
author: qinyi
created_at: 2026-06-20T14:52:22+0800
---

## 目标
实现 plan 子域 7 张表(模板 3 + ps 计划 4),里程碑明细状态机:草稿→审核→审批→完成 + 驳回 + 变更(parent_id 版本链);弃 silly _node/_variable 表。流程端点 saveProcess/rejectProcess/changeProcess。

## 文件
- 新增 backend/app/modules/ppm/plan/{__init__,model,router,service,schema}.py
- 新增 backend/app/modules/ppm/plan/fsm.py(里程碑明细状态机实例)
- 新增 backend/migrations/versions/2026mmdd_create_ppm_plan_tables.py
- 新增 backend/app/modules/ppm/plan/tests/test_*.py(含状态机全路径)

## 实现要点(参照源)
- model.py:7 表对照源 DO:
  - 模板:ppm_plan_node(节点模板)、ppm_plan_node_detail(模板明细)、ppm_plan_node_module(模块)
  - ps:ppm_ps_project_plan(项目计划)、ppm_ps_plan_node(里程碑)、ppm_ps_plan_node_detail(里程碑明细 + parent_id 版本链 + status)、ppm_ps_plan_node_detail_process(流程履历)
- 关键简化(D-002@v1):
  - **弃 silly** _node/_variable 两表 → PsPlanNodeDetail 单表 + parent_id 指向旧版本(status=archived)+ status 驱动状态机
  - 变更:新版本 insert,parent_id = 旧 detail.id,旧版本 status='archived'
- fsm.py:基于 task-01 common.fsm.StateMachine 定义状态集 + TRANSITIONS:
  - 状态:草稿(draft)/ 审核(review)/ 审批(approve)/ 完成(done)/ 驳回(rejected)/ 归档(archived)
  - 迁移:draft→review→approve→done;任意未完成→rejected;rejected→draft(返工);变更走新建版本不走迁移
- service.py:
  - 模板 CRUD(6 件套)+ 模块/明细子表
  - ps 项目计划 CRUD + 里程碑 CRUD + 里程碑明细 CRUD
  - saveProcess(detail_id):草稿→审核;rejectProcess:→驳回;changeProcess:复制当前版本为新草稿,parent_id 指向旧,旧归档
- router.py:前缀 /plan-node, /plan-node-module, /project-plan, /plan-node(ps), /plan-node-detail(ps);/process 流程子端点。
- 迁移 env.py 补 7 model import。

## 验收
- [ ] 7 表 alembic upgrade 成功,字段对齐源 DO(不含 _node/_variable)
- [ ] 状态机全路径单测:草稿→审核→审批→完成、驳回、返工、非法迁移抛错
- [ ] changeProcess 生成新版本,parent_id 正确,旧版本 status=archived
- [ ] process 履历表每次流转插入一行(actor/from/to)
- [ ] saveProcess/rejectProcess 鉴权 PPM_PLAN_*
- [ ] pytest 全绿
