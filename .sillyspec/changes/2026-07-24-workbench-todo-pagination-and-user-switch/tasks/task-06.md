---
id: task-06
title: 后端测试（覆盖：FR-01, FR-03, FR-04）
title_zh: workbench 测试 — 可见用户四口径/分页/target透传/越权403/超管
author: qinyi
created_at: 2026-07-24 09:07:27
priority: P0
depends_on: [task-04, task-05]
blocks: []
requirement_ids: [FR-01, FR-03, FR-04]
decision_ids: [D-001@v1, D-002@v1, D-003@v1]
allowed_paths:
  - backend/app/modules/ppm/workbench/tests/test_workbench_service.py
goal: >
  覆盖切换用户可见用户四口径、待办分页、target 透传、越权 403、超管任意；并更新现有测试适配 Summary 去 todos。
implementation:
  - 新增 _visible_user_ids 四口径用例：部门经理→org子树成员；项目/开发/业务经理→项目成员；并集；超管→全部
  - 新增 _resolve_target_user 越权 403 / 不存在 404 / 超管任意 / 自己兼容
  - 新增 get_todos 分页（page/page_size/total/切片）用例
  - 新增 profile/summary/calendar 传 target 返回目标数据用例
  - 更新现有 summary 测试：断言不再含 todos
acceptance:
  - 四口径可见用户集正确
  - 越权 403、不存在 404、超管放行
  - 分页 total 准确、切片正确
  - 现有 workbench 测试适配 Summary 去 todos 后全绿
verify:
  - cd backend && uv run pytest app/modules/ppm/workbench -q --no-cov
constraints:
  - 走 SQLite 测试库（与现有 conftest 一致）
  - 不为通过而改测试逻辑本身有误的断言
---
