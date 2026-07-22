---
id: task-08
title: 后端单测 execute_plan 带 file_urls 落库（FR-02）
title_zh: execute_plan file_urls 落库单测
author: qinyi
created_at: 2026-07-22 22:16:15
priority: P0
depends_on: [task-04]
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-007@v1]
allowed_paths:
  - backend/app/modules/ppm/task/tests/test_task.py
expects_from:
  task-04:
    - contract: execute_plan 落 file_urls
      needs: [file_urls]
goal: >
  单测 execute_plan 带 file_urls 落库 + 不传 file_urls 保留原值（D-007 守卫语义）。
implementation:
  - task/tests/test_task.py 照现有 execute 测试风格（start→execute_plan），新增用例：start 建 in-flight → PlanTaskService.execute_plan(ExecutePlanReq(..., file_urls=["f1","f2"])) → 查 TaskExecute.file_urls == ["f1","f2"]
  - 新增不传 file_urls（None）用例：原 file_urls 不被清空（D-007 is not None 守卫）
  - 断言 TaskExecuteResponse.file_urls 回显（from_attributes 映射）
acceptance:
  - 带 file_urls 落库正确；不传保留原值；Response 回显
  - 测试绿，现有 task 测试零回归
verify:
  - cd backend && uv run pytest app/modules/ppm/task/tests/test_task.py -q
  - cd backend && uv run pytest app/modules/ppm/task/tests -q
constraints:
  - D-007：必须断言 None 保留原值（防 default_factory=list 把附件清空）
  - 照 test_task.py 现有 start/execute_plan + ExecutePlanReq 风格写（service 层）
  - task 侧 router 直传 body 不拆包，无需 router 透传断言（与 problem 侧 task-09 对照）
---

流程位置：Wave 3（后端测试，依赖 Wave 1+2）。
