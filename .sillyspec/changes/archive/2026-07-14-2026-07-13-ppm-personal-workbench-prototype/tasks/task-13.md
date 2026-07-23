---
id: task-13
title: "端到端验证（页面三栏渲染 / 指标与库数据一致 / 待办派生 / 日历双圆点 / 占位空状态）（覆盖：FR-01~FR-12）"
title_zh: "工作台端到端验证"
author: qinyi
created_at: 2026-07-14 09:27:18
priority: P1
depends_on: [task-06, task-12]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07, FR-08, FR-09, FR-10, FR-11, FR-12]
decision_ids: []
allowed_paths:
  - backend/app/modules/ppm/workbench/router.py
expects_from:
  - contract: WorkbenchSummary
    needs: [metrics, todos]
  - contract: WorkbenchProfile
    needs: [display_name, employee_no, department_name, role_name]
  - contract: WorkbenchCalendar
    needs: [year_month, days]
goal: >
  在真实环境（docker compose 或本地 uvicorn + pnpm dev）验证 PPM 个人工作台全链路：三栏页面渲染、5 指标与库 SELECT count 一致、待办从 now_handle_user 正确派生、日历双圆点（load + alert）、消息/绩效占位空状态不报错，3 个聚合接口均 200。
implementation:
  - "起环境（二选一）：docker compose `docker compose up -d`（backend 8001 / frontend 3001），等 health 就绪；或本地 backend `cd backend && uv run uvicorn app.main:app --port 8001`，frontend `cd frontend && pnpm dev`（默认 3000）。"
  - "确认 task-01 migration 已 apply（employee_no 列存在）：`docker exec backend python -m alembic current` 或查 DB users 表含 employee_no 列。"
  - "登录（走 username 非 email，参照记忆 login-by-username-not-email）：默认账号 admin / admin123（后端 login 的 account 只按 username 查，不识别 @）；curl 登录拿 token `curl -s -X POST http://127.0.0.1:8001/api/auth/login -H 'Content-Type: application/json' -d '{\"account\":\"admin\",\"password\":\"admin123\"}'`，从响应取 access_token。"
  - "本机访问 docker 映射端口用 127.0.0.1 不用 localhost（IPv6 ::1 连 0.0.0.0 映射不通，参照 docker-localhost-ipv6-use-127.0.0.1）。"
  - "造测试数据（本项目未上线允许重置测试数据，CLAUDE.md 规则11）：取当前登录 admin 的 user_id（profile 接口或 DB SELECT id FROM users WHERE username='admin'）。"
  - "ppm_plan_task：插入当前人名下任务（user_id=admin.id，start_time 落本月内，含一条 status='已完成'、一条 status='进行中' + end_time<now 造延期），用于验 task_count/completion_rate/delay_rate。"
  - "ppm_problem_list：duty_user_id=admin.id 插一条 status!='4'（未关闭）造 defect_count。"
  - "ppm_problem_list_process_task / ppm_problem_change_process_task：now_handle_user 含 str(admin.id)（problem/service.py:433/459/610/703 写入格式为逗号分隔 str(user.id)），造待办。"
  - "ppm_task_execute：execute_user_id=admin.id 插一条 time_spent 造 work_hours（design §7.2 D-008 工时源=task_execute.time_spent，非 ppm_work_hour）。注：若 admin 账号已有历史数据满足条件可跳过插入，直接读现有。"
  - "验 3 个聚合接口（带 token，127.0.0.1）：profile `curl -s http://127.0.0.1:8001/api/ppm/workbench/profile -H \"Authorization: Bearer <token>\"` → 200 + 字段 display_name/employee_no/department_name/role_name/avatar_text。"
  - "summary `curl -s 'http://127.0.0.1:8001/api/ppm/workbench/summary?range=month' -H \"Authorization: Bearer <token>\"` → 200 + metrics{task_count,completion_rate,delay_rate,work_hours,defect_count} + todos[]。"
  - "calendar `curl -s 'http://127.0.0.1:8001/api/ppm/workbench/calendar?year_month=2026-07' -H \"Authorization: Bearer <token>\"` → 200 + year_month + days[]{date,load_level,alert_level,task_count}；逐接口确认非 4xx/5xx，字段齐全。"
  - "指标与库数据一致性核对（design §7.2 口径）：库对照（PG 或 docker exec backend psql）。"
  - "task_count = `SELECT count(*) FROM ppm_plan_task WHERE user_id='<admin.id>' AND start_time BETWEEN '<月初>' AND '<月末>'`（range=month 按当月 1 日~月末，start_time 区间，design §7.2 X-001）。"
  - "completion_rate 分子 = 同范围 status='已完成' count / task_count；delay_rate 分子 = 同范围 end_time<now AND status!='已完成' count / task_count（task_count=0 时接口返 0.0）。"
  - "work_hours = `SELECT COALESCE(SUM(time_spent),0) FROM ppm_task_execute WHERE execute_user_id='<admin.id>' AND <range 区间>`。"
  - "defect_count = `SELECT count(*) FROM ppm_problem_list WHERE duty_user_id='<admin.id>' AND status!='4'`（不受 range 影响）；比对接口返回值与库 SELECT 结果数值一致（允许 completion_rate/delay_rate 浮点误差 ≤0.01）。"
  - "页面渲染核对（浏览器访问 http://127.0.0.1:3001/ppm/workbench 或本地 3000）：① 左栏 ProfileSummaryCard：姓名/工号（employee_no，未录入显示「—」design §9）/部门/角色/头像首字；TodoListPanel 待办列表来自 now_handle_user 含当前人 + 非终态 plan_task（design §7.2 D-006）；消息通知占位 EmptyState 不报错。"
  - "② 中栏 PersonalMetricStrip：5 指标卡数值与库一致（同 step5）；WorkbenchTaskTable 任务操作表复用 personal-task-plan（当日完成二次确认弹窗能触发）。"
  - "③ 右栏 WorkCalendarPanel：当月日历每日双圆点（load_level=normal/mid/over 分档 0/1-2/3-4/≥5；alert_level 延期任务日显 over 红点，design §7.3）；QuickEntryGrid 快捷入口；RuleNotePanel 规则说明；绩效考评占位 EmptyState 不报错。截图存证（workbench 三栏全貌 + 至少一张日历双圆点特写）。"
  - "app-shell 菜单核对：PPM 菜单首项「个人工作台」可点击直达 /ppm/workbench（task-08 落地）；/ppm 仍 redirect /ppm/projects（D-001@v1 未改）。"
acceptance:
  - "/ppm/workbench 页面三栏正常渲染（左 ProfileSummaryCard+TodoListPanel+消息占位 / 中 PersonalMetricStrip+WorkbenchTaskTable / 右 WorkCalendarPanel+QuickEntryGrid+RuleNotePanel+绩效占位）。"
  - "5 指标（task_count/completion_rate/delay_rate/work_hours/defect_count）与库 SELECT count/SUM 结果一致（口径符合 design §7.2）。"
  - "待办正确派生：来自 now_handle_user 含当前人的 process_task + 非终态 plan_task（D-006）。"
  - "日历双圆点：load_level 与 alert_level 分档正确（design §7.3 0/1-2/3-4/≥5 与延期预警）。"
  - "消息通知 / 绩效考评占位 EmptyState 不报错（D-007）。"
  - "3 个聚合接口（profile/summary/calendar）均返回 200 + 字段齐全。"
  - "app-shell PPM 菜单首项「个人工作台」直达 /ppm/workbench；/ppm redirect 不变。"
verify:
  - "curl -s http://127.0.0.1:8001/api/ppm/workbench/profile -H 'Authorization: Bearer <token>'"
  - "浏览器访问 /ppm/workbench 截图（三栏全貌 + 日历双圆点特写）"
constraints:
  - "本项目未正式上线，允许重置开发/测试数据（CLAUDE.md 规则11）；造数据可直接 INSERT 或清表重来。"
  - "本机访问 docker 映射端口（backend 8001 / frontend 3001）用 127.0.0.1 非 localhost（IPv6 ::1 坑，参照 docker-localhost-ipv6-use-127.0.0.1）。"
  - "登录走 username 非 email（admin/admin123，后端 account 只按 username 查，参照 login-by-username-not-email）。"
  - "范围过滤按 start_time 区间（design §7.2 X-001：PlanTask.month 可空不可靠），week=本周一~周日、month=当月 1 日~月末。"
  - "工时源 = task_execute.time_spent（D-008），非 ppm_work_hour 表（design §10 R-03 ppm_work_hour 实际为空）。"
  - "若 organizations/user_organizations 无数据致 department_name 为 null，工作台显示「—」属预期（design §9 nullable 兜底，R-04）。"
  - "验证入口改动仅限 backend/app/modules/ppm/workbench/router.py（如需加临时调试端点）；页面截图与 curl 不改源码。"
---
