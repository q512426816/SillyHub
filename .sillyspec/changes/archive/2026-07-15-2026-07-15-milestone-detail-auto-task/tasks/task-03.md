---
id: task-03
title: "_transition（save_process→DONE）在统一 commit 前接入 _ensure_task_for_detail"
title_zh: _transition 到 DONE 时接入建任务
author: WhaleFall
created_at: 2026-07-15 19:29:30
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-01]
decision_ids: []
allowed_paths:
  - backend/app/modules/ppm/plan/service.py
provides: {}
expects_from:
  task-01:
    - contract: PlanService detail-task 联动 helper 方法集
      needs: [_ensure_task_for_detail]
goal: 明细在 _transition 推进到 DONE 时，建/更新对应任务，且复用 _transition 既有的统一 commit 实现原子性。
implementation: |
  在 service.py _transition（555-601）内、`await self._session.commit()`（583）之前插入：
    if target is PlanNodeDetailStatus.DONE:
        await self._ensure_task_for_detail(detail)
  触发链路：save_process(510-535) 取 target=_FORWARD_NEXT[current]（232-235，APPROVE→DONE），调 _transition。
  `_ensure_task_for_detail` 由 task-01 提供。插入点在 commit(583) 之前，故 detail 与任务在同一事务提交，天然原子。
acceptance:
  - 明细 APPROVE→DONE（save_process 提交）后，对应任务被创建或更新。
  - 仅 target==PlanNodeDetailStatus.DONE 时触发；REVIEW/APPROVE/REJECTED 迁移不建任务。
  - _transition 既有 commit(583)、refresh(584)、_write_process(585) 顺序与履历写入保持不变。
verify:
  - "cd backend && pytest app/modules/ppm/plan/tests -q"
  - "ruff check app/modules/ppm/plan/service.py"
  - "mypy app/modules/ppm/plan/service.py"
constraints:
  - 仅当 target is PlanNodeDetailStatus.DONE 触发建/更新任务。
  - 不破坏 _transition 既有 commit / refresh / _write_process 履历逻辑。
  - 非 DONE 迁移（review/approve/rejected）不得建任务。
  - 调用须置于统一 commit(583) 之前以保证原子；不新增独立 commit。
---

# task-03 _transition 到 DONE 时接入建任务

## 背景
明细编辑后「提交」走 save_process→_transition 推进到 DONE，此刻要建/更新任务。
现状 _transition 已自行管理 session 并在 583 统一 commit，加一行调用即可天然原子。

## 依赖
- task-01 提供 `_ensure_task_for_detail(detail)` helper（expects_from）。
