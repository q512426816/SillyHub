---
id: task-02
title: create_detail 重构为原子事务（session.add + 统一 commit），status=done 时触发 _ensure_task_for_detail
title_zh: create_detail 重构为原子事务并在 done 时建任务
author: WhaleFall
created_at: 2026-07-15 19:29:30
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-003@v1]
allowed_paths:
  - backend/app/modules/ppm/plan/service.py
provides: {}
expects_from:
  task-01:
    - contract: PlanService detail-task 联动 helper 方法集
      needs: [_ensure_task_for_detail]
goal: 把 `create_detail` 从「`_Crud.create` 内部单独 commit」改为手写原子事务，使明细创建与（status=done 时的）PlanTask 建表在同一事务内完成；任一失败整体回滚，保证强一致（R-07/D-003@v1）。
implementation: |
  改 `backend/app/modules/ppm/plan/service.py` 的 `create_detail`（现 388-390）：
  1. 保留 `data.setdefault("status", PlanNodeDetailStatus.DRAFT.value)`。
  2. 不再走 `_Crud(...).create(data)`（其 160-166 内 `commit()` 破坏原子性）；
     改为参照 `import_commit`(947-1047) 与 `_Crud.create` 的构造方式手写：
       obj = PsPlanNodeDetail(id=uuid.uuid4(), **data)
       obj = _Crud(self._session, PsPlanNodeDetail)._set_created_updated(obj)
       self._session.add(obj)
  3. 若 `data["status"] == PlanNodeDetailStatus.DONE.value`：先 `await self._session.flush()`
     拿到 obj.id，再 `await self._ensure_task_for_detail(obj)`（task-01 提供）。
  4. 末尾单次 `await self._session.commit()` + `await self._session.refresh(obj)`，return obj。
  `_set_created_updated` 为 `_Crud` 私有方法，可经 `_Crud` 实例访问或抽公共；保持 import 不变。
acceptance:
  - create_detail 签名 `create_detail(self, data: dict[str, Any]) -> PsPlanNodeDetail` 与返回类型不变。
  - status=draft（默认）时不触发 `_ensure_task_for_detail`，行为与现状一致（仅建明细）。
  - status=done 时先建明细 flush 出 id，再同事务内建 PlanTask；任一异常冒泡 → 不 commit → 整体回滚（明细 + 任务均不入库）。
  - 单元/回归测试 `test_service.py` / `test_plan_submit_detail.py` 全绿，无需改其调用点（router.py:568、夹具签名未变）。
verify: cd backend && pytest app/modules/ppm/plan/tests/test_service.py app/modules/ppm/plan/tests/test_plan_submit_detail.py -q && ruff check app/modules/ppm/plan/service.py && mypy app/modules/ppm/plan/service.py
constraints:
  - 保持 create_detail 签名与返回类型不变（router/测试调用点不破）。
  - status=draft 不建任务（保持现状语义）。
  - execute_user_id 为空时由 `_ensure_task_for_detail` 内部跳过建任务（task-01 契约），本处不重复判空。
  - 同事务原子：建任务失败则明细创建一并回滚，禁止中间 commit。
  - 禁止复用 `_Crud.create`（其内部 commit）；末尾仅单次 commit。
