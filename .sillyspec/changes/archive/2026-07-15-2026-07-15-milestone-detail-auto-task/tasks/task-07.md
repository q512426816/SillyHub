---
id: task-07
title: 新增 test_detail_task_link.py 覆盖 FR-01~FR-07 全部 GWT 边界
title_zh: 明细-任务联动单测
author: WhaleFall
created_at: 2026-07-15 19:29:30
priority: P0
depends_on: [task-02, task-03, task-04, task-05, task-06]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07]
decision_ids: [D-001@v1, D-002@v1, D-003@v1, D-004@v1, D-005@v1, D-006@v1, D-007@v1]
allowed_paths:
  - backend/app/modules/ppm/plan/tests/test_detail_task_link.py
provides: {}
expects_from: {}
goal: |
  新建 backend/app/modules/ppm/plan/tests/test_detail_task_link.py，对明细-任务联动
  以 GWT（Given/When/Then）形式逐条覆盖 FR-01~FR-07，断言可观测行为（任务是否建、
  字段值、关联 ps_plan_node_detail_id、版本链、回滚），不绑定未实现的内部细节。
implementation: |
  复用根 conftest 的 in-memory SQLite ``db_session`` fixture + plan/tests/conftest.py
  注册的 plan/task 模型。fixture 范式对齐 test_three_level_query.py 的 _seed_plan/
  _seed_node/_seed_detail/_seed_task（直接 ORM 建 PsProjectPlan/PsPlanNode/
  PsPlanNodeDetail/PlanTask 并 commit/refresh），项目成员/执行人通过建 User +
  PpmProjectMember 或 PlanTask.user_id 指定合法 UUID（参考 test_service._ACTOR）。
  按 FR 分组用例：FR-01 create_detail done / save_process→DONE 建任务，execute_user_id
  空跳过；FR-02 导入 done 批量建、draft 不建、失败整批回滚；FR-03 编辑已完成明细同步
  任务字段且 task.status 不变、无关联不建；FR-04 变更迁移到新版本不产生第二条；
  FR-05 删除解关联（ps_plan_node_detail_id=null，任务保留）；FR-06 建任务失败→明细
  操作回滚；FR-07 历史 done 明细不被补建（仅实时触发）。
acceptance:
  - 文件存在于 allowed_paths，可被 pytest 收集
  - 每个 FR-01~FR-07 至少 1 个独立 GWT 用例，覆盖正/负边界
  - 只断言可观测行为，不断言私有方法调用顺序/内部状态细节
verify: |
  cd backend && pytest app/modules/ppm/plan/tests/test_detail_task_link.py -q
constraints:
  - 用与既有 plan 测试一致的 fixture/session 范式（db_session + ORM seed helper）
  - 每个 FR 的 GWT 边界为独立用例，不合并断言
  - 不断言未实现的内部细节，只验可观测行为（任务是否建/字段/关联/版本链/回滚）
  - execute_user_id 空的负例需用合法 UUID 形态构造，避免 FK 报错掩盖业务断言
---

task-07 已生成
