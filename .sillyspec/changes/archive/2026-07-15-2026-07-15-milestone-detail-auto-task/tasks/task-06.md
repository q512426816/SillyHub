---
id: task-06
title: change_process 在统一 commit 前接入 _migrate_task_to_version
title_zh: 变更时迁移任务到新版本
author: WhaleFall
created_at: 2026-07-15 19:29:30
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/ppm/plan/service.py
provides: {}
expects_from:
  task-01:
    - contract: PlanService detail-task 联动 helper 方法集
      needs: [_migrate_task_to_version]
goal:
  - 在 change_process 统一 commit(669) 前接入 _migrate_task_to_version，把旧版本关联任务的 ps_plan_node_detail_id 由 old.id 迁到 new.id，保证一条明细族始终只对应一条任务 (D-001 防重复)。
implementation:
  - 读 change_process(service.py 603-686)：校验 old.status==done → old.status=archived → 复制字段新建 new(draft,parent_id=old.id) → session.add(new)(668) → commit(669) → refresh(670) → _write_process 履历。
  - 在 session.add(new)(668) 之后、await self._session.commit()(669) 之前，新增 await self._migrate_task_to_version(old.id, new.id)。
  - 迁移语义：把所有 ps_plan_node_detail_id == old.id 的任务更新为 ps_plan_node_detail_id = new.id；与归档/新建同事务，原子提交于 commit(669)。
  - _migrate_task_to_version 由 task-01 提供，本任务仅调用，不实现。
acceptance:
  - change_process 在 commit 前调用 _migrate_task_to_version(old.id, new.id)。
  - 迁移与归档、版本链、履历写入在同一事务内完成。
  - 旧版本无关联任务时调用不报错、无副作用。
verify:
  - cd backend && pytest app/modules/ppm/plan/tests -q
  - cd backend && ruff check app/modules/ppm/plan/service.py
  - cd backend && mypy app/modules/ppm/plan/service.py
constraints:
  - 迁移必须发生在 change_process 同事务内、统一 commit(669) 之前，不得另开事务。
  - 旧版本无关联任务时 _migrate 无副作用（不抛错、不改写）。
  - 不得破坏 change_process 既有归档(old→archived)、版本链(parent_id=old.id)、履历(_write_process node_key=change) 逻辑。
  - 保留“仅 done 可发起变更”前置校验（622-629）原样不动。
---
