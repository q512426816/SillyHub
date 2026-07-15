---
id: task-05
title: update_detail 重构为原子事务 + 接入 _sync_task_fields；delete_detail 重构 + 接入 _unlink_task
title_zh: 编辑同步与删除解关联接入
author: WhaleFall
created_at: 2026-07-15 19:29:30
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-03, FR-05]
decision_ids: [D-007@v1, D-004@v1]
allowed_paths:
  - backend/app/modules/ppm/plan/service.py
provides: {}
expects_from:
  task-01:
    - contract: PlanService detail-task 联动 helper 方法集
      needs: [_sync_task_fields, _unlink_task]
goal: |
  把 update_detail / delete_detail 从 _Crud.update / _Crud.delete（各自单独 commit）
  改为手动 session 操作 + 联动调用，保证编辑/删除与关联任务强一致（同事务）。
  update_detail 编辑已完成明细时把变更字段同步回关联任务（不改 task.status）；
  delete_detail 删除明细时把关联任务的 ps_plan_node_detail_id 置 null（任务保留）。
implementation: |
  1. update_detail(item_id, data) -> PsPlanNodeDetail:
     - await get_detail(item_id) 取明细
     - for k,v in data.items(): 仅当 v is not None 执行 setattr(obj, k, v)（沿用 _Crud.update 语义）
     - touch updated_at（复用 _touch_updated / _now）
     - await _sync_task_fields(obj)（task-01 提供，不改 task.status）
     - await self._session.commit(); await self._session.refresh(obj); return obj
  2. delete_detail(item_id) -> None:
     - await get_detail(item_id) 取明细
     - await _unlink_task(item_id)（task-01 提供，置关联任务 ps_plan_node_detail_id=null）
     - await self._session.delete(明细); await self._session.commit()
  3. 两方法签名与返回类型保持不变（router.py:623 update / router.py:633 delete 无需改）。
acceptance:
  - 编辑已完成明细 → 关联任务相关字段被同步，task.status 不变（D-007@v1）
  - 删除明细 → 关联任务 ps_plan_node_detail_id 置 null，任务行保留（D-004@v1）
  - update_detail / delete_detail 同事务，联动与明细写入要么同成要么同败
  - 两方法签名/返回不变，router 调用点零改动
verify: |
  cd backend && pytest app/modules/ppm/plan/tests -q
  cd backend && ruff check app/modules/ppm/plan/service.py
  cd backend && mypy app/modules/ppm/plan/service.py
constraints:
  - update_detail(item_id, data)->PsPlanNodeDetail / delete_detail(item_id)->None 签名与返回不变（router 不破）
  - _sync_task_fields 不修改 task.status（D-007@v1）
  - 明细无关联任务时：_sync 不新建关联，_unlink 无副作用（幂等）
  - 删除顺序固定：先 _unlink_task 解关联，再 session.delete 删明细，同事务 commit
  - 复用 get_detail 取对象，不新增重复查询
  - 非测试逻辑有误时不改测试通过
---
