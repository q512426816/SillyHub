---
id: task-06
title: "workbench service 单测（指标口径 / task_count=0 边界 / now_handle_user 派生匹配 / 日历分档 / profile 部门关联）（覆盖：FR-05, FR-06, FR-08）"
title_zh: 工作台聚合 service 单元测试
author: qinyi
created_at: 2026-07-14 09:27:18
priority: P0
depends_on: [task-03, task-04, task-05]
blocks: [task-13]
requirement_ids: [FR-05, FR-06, FR-08]
decision_ids: []
allowed_paths:
  - backend/app/modules/ppm/workbench/tests/__init__.py
  - backend/app/modules/ppm/workbench/tests/conftest.py
  - backend/app/modules/ppm/workbench/tests/test_workbench_service.py
expects_from:
  - contract: WorkbenchProfile
    needs: [display_name, employee_no, department_name, role_name, avatar_text]
  - contract: WorkbenchMetrics
    needs: [task_count, completion_rate, delay_rate, work_hours, defect_count]
  - contract: WorkbenchTodoItem
    needs: [id, name, type, source]
  - contract: WorkbenchSummary
    needs: [metrics, todos]
  - contract: CalendarDay
    needs: [date, load_level, alert_level, task_count]
  - contract: WorkbenchCalendar
    needs: [year_month, days]
  - contract: WorkbenchService
    needs: [get_profile(session, user), get_summary(session, user, range), get_calendar(session, user, year_month)]
goal: >
  钉死 workbench 三块聚合（profile / summary / calendar）的口径与边界，防回归：
  指标完成率/延期率分母口径、task_count=0 零除边界、now_handle_user 逗号串派生待办、
  日历按 start_time 落点计数与分档、profile 部门关联 nullable 兜底。
implementation:
  - "范本参照 backend/app/modules/ppm/task/tests/test_task.py（根 conftest 的 in-memory SQLite db_session fixture + service 直调 + _seed_* helper）与 problem/tests/test_problem_flow.py（session.add + await session.commit() 直接造 ORM 行）"
  - "新建 tests/conftest.py 仅做模型注册（仿 problem/tests/conftest.py）：import app.modules.ppm.task.model / problem.model / project.model + workbench 所依赖的 auth.user_organizations / organizations 模型，确保根 conftest 的 create_all 能建出 plan_task / problem_list / problem_list_process_task / problem_change_process_task / user_organizations / organizations 表；新建空 tests/__init__.py"
  - "helper：_seed_plan(db_session, user_id, *, status, start_time, end_time) 直接 session.add(PlanTask(...)) + commit（覆盖「未开始/进行中/已完成」三态）；_seed_problem(db_session, *, duty_user_id, status, now_handle_user) 造 PpmProblemList（project_id 必填用 uuid4，duty_user_id/status/now_handle_user 可控）；_seed_process_task(db_session, *, business_id, now_handle_user) 造 PpmProblemListProcessTask；_seed_org_link(db_session, user_id, org_name) 造 Organization + UserOrganization 关联"
  - "测 get_summary —— ① 有任务时口径：造 3 条 plan_task（已完成1 / 进行中1 已延期1，start_time 落在 month 区间），断言 task_count=3、completion_rate≈1/3、delay_rate≈1/3、work_hours 来自 task_execute.time_spent 聚合（非 ppm_work_hour）；② task_count=0 边界：当前 user 无任何 start_time 落区间的 plan_task，断言 completion_rate==0.0 且 delay_rate==0.0（零除返回 0.0，非 NaN/异常）；③ now_handle_user 派生：造 problem_list_process_task.now_handle_user='uid_a,uid_b'（逗号串），断言 get_summary 对 user=uid_a 与 user=uid_b 都能在 todos 里命中该条，对 user=uid_c 不命中（Python 端 split 匹配，不依赖 SQL like，R-02）；④ defect_count 不受 range 影响：造 PpmProblemList duty_user_id=me status='1'（非'4'已关闭），分别 range=week/month/all 断言 defect_count 恒等"
  - "测 get_calendar —— ① 跨多日任务只计 start_time 当日：造一条 start_time=2026-07-03、end_time=2026-07-10 的任务，断言 days 中 07-03 task_count=1 而 07-04~07-10 task_count=0（不展开 end_time 区间，X-004）；② load_level 分档：同日 2 条→normal、4 条→mid、5 条→over、0 条→不显点/空；③ alert_level：当日有任务 end_time<now 且 status!='已完成' → alert=over（延期预警），否则 normal；④ year_month 越界/空值容错（按 design §7.3 取当月，传 '2026-07' 正确返回该月 days）"
  - "测 get_profile —— ① 有 user_organizations 关联：造 Organization(name='研发部') + UserOrganization，断言 department_name=='研发部'；② 无关联：不造 org 链接，断言 department_name is None（R-04 nullable 兜底）；③ employee_no：User.employee_no 有值时返回该值、为 None 时返回 None（brownfield 老用户兜底）；④ role_name 与 display_name/avatar_text 字段存在性（avatar_text 取 display_name 首字）"
  - "时间断言一律在 test 函数体内 datetime.now(UTC) 取值（禁止模块级 NOW 常量，参照 [[test-module-level-time-constant-pitfall]]）；'已延期' 用 now - timedelta(days=1) 构造 end_time，'未延期' 用 now + timedelta(days=1)"
acceptance:
  - "全部断言通过（cd backend && uv run pytest -q app/modules/ppm/workbench）"
  - "覆盖 task_count=0 零除边界（completion_rate/delay_rate 均 0.0 非 NaN）"
  - "覆盖 now_handle_user 逗号串 split 匹配（命中 me / 不命中他人，Python 端不依赖 SQL like）"
  - "覆盖日历 4 类：跨多日只计 start_time 当日、load_level 分档（normal/mid/over）、alert_level 延期预警、year_month 取月"
  - "覆盖 profile 部门关联（有链接返部门名 / 无链接 None）+ employee_no nullable 兜底"
  - "覆盖 defect_count 不受 range 影响（week/month/all 恒等）"
verify:
  - "cd backend && uv run pytest -q app/modules/ppm/workbench（全绿）"
  - "cd backend && uv run pytest -q app/modules/ppm/workbench --cov=app/modules/ppm/workbench/service --cov-fail-under=60（service 行覆盖率 ≥60%）"
  - "cd backend && uv run ruff check app/modules/ppm/workbench/tests && uv run mypy app/modules/ppm/workbench/tests（lint+类型绿）"
constraints:
  - "SQLite in-memory 测试（根 conftest db_session fixture），注意 PG 方言分支：date_trunc/strftime 等 PG 专有函数需在 service 内 dialect 分支（参照 [[backend-test-sqlite-vs-pg]]），now_handle_user 匹配必须 Python 端 split 不走 SQL like（R-02）"
  - "禁止 mock 掉被测 WorkbenchService —— 走真实 ORM 查询（防 mock 遮蔽真实 FK 路径，参照 [[scan-generate-failure-chain]] 教训）"
  - "时间断言用 test 函数体内 datetime.now()，禁止模块级 NOW 常量（全量 pytest collection→远端执行间隔>120s 致 ≈now 断言失败，参照 [[test-module-level-time-constant-pitfall]]）"
  - "PpmProblemList.project_id / business_id 为 NOT NULL UUID，造数据必须给值（uuid4 即可）；status 取 fsm.ProblemStatus 值（'4'=已关闭，非'4'算未关闭缺陷）"
  - "PlanTask.status 枚举为中文 '未开始'/'进行中'/'已完成'（非英文/数字），构造 fixture 时用中文常量"
  - "覆盖率门禁 --cov-fail-under=60（workbench service 行覆盖）"
---
