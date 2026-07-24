---
id: task-05
title: /personal-task-plan/page 加 target_user_id（覆盖：FR-02, FR-04, D-004@v1）
title_zh: task router — 个人任务计划分页加 target_user_id，仅走 _resolve_target_user
author: qinyi
created_at: 2026-07-24 09:07:27
priority: P0
depends_on: [task-02]
blocks: []
requirement_ids: [FR-02, FR-04]
decision_ids: [D-004@v1]
allowed_paths:
  - backend/app/modules/ppm/task/router.py
goal: >
  /personal-task-plan/page 加可选 target_user_id，使切换用户后「我的任务」表也跟随目标用户；仅走 workbench._resolve_target_user 收口，禁用 data_scope。
implementation:
  - personal_plan_task_page 增 target_user_id: str|None Query
  - 实例化 WorkbenchService(session)._resolve_target_user(user, target_user_id) 解析 target（跨子域 import workbench service）
  - req.user_id = target.id（替代 user.id）；svc.page(req) 不改
  - 绝不用 data_scope（语义不符，design F5/R-01）
acceptance:
  - 不传 target_user_id 行为与旧版完全一致
  - 经理/超管传可见集内 target→返回该 target 任务；越权→403
  - 未引入 data_scope 过滤
verify:
  - cd backend && uv run pytest app/modules/ppm/task -q --no-cov -k "personal"
constraints:
  - 仅 _resolve_target_user 一路收口，禁 data_scope
  - PlanTaskService.page 不改（通用按 req.user_id 过滤）
---
