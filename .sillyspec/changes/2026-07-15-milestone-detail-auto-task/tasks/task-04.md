---
id: task-04
title: import_commit 在末尾统一 commit 前对每个 done 明细批量建任务
title_zh: 导入提交时为 done 明细批量建任务
author: WhaleFall
created_at: 2026-07-15 19:29:30
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/ppm/plan/service.py
provides: {}
expects_from:
  task-01:
    - contract: PlanService detail-task 联动 helper 方法集
      needs: [_ensure_task_for_detail]
goal: |
  在 import_commit 末尾统一 commit(1039) 之前，对所有 status==DONE 的新建
  PsPlanNodeDetail 逐个调用 _ensure_task_for_detail 批量建任务，保持同事务
  原子性（任一失败整批回滚）。draft 明细不建任务。
implementation: |
  文件：backend/app/modules/ppm/plan/service.py，import_commit(947-1047)。
  现状：第 3 步逐行建 detail（DONE if required_filled else DRAFT），
  self._session.add(detail) 后只累加 created_details；末尾 1039 行单次 commit。
  改动：
  1. 在第 3 步循环内，把 status==DONE 的新建 detail 收集到列表（如 done_details）。
     draft 不收集、不建任务。
  2. 在 commit(1039) 之前，遍历 done_details，对每个先确保 detail.id 可用：
     因 detail 是新建对象（id 已显式 uuid.uuid4() 赋值，可直接取），若 _ensure
     内部按 detail 查 DB 需要 flush，则在该循环前/中 await self._session.flush()
     使对象在事务内可见。
  3. 对每个 done detail 执行 await self._ensure_task_for_detail(detail)，
     _ensure 内部查重+建任务，共用同一 session，不单独 commit。
  4. 任一 _ensure 异常冒泡 → 不走到 commit → 整批（module+detail+task）回滚。
acceptance:
  - done 明细建出对应任务，draft 明细不建任务
  - 批量建任务与 module/detail 写入在同一事务，任一失败整体回滚
  - 不破坏 import_commit 既有 module 合并 / 汇总 / created_details 计数逻辑
verify: |
  cd backend && pytest app/modules/ppm/plan/tests/test_importer.py -q
  ruff/mypy 检查改动文件
constraints:
  - 仅 done 明细建任务，draft 明细不建
  - 批量建任务在同一事务，任一失败整批回滚（强一致）
  - 循环前/中 flush 确保 detail 在事务内可见（_ensure 查重需要）
  - 不破坏 import_commit 既有 module 合并 / 汇总 / skipped_rows / 计数逻辑
---
