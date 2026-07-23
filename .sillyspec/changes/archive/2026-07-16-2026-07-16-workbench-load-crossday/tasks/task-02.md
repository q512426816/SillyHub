---
id: task-02
title: task/service.py execute_plan 改 action + 强制回填 actual_end + service 内跨天校验 + 新增 start
phase: W1
priority: P0
status: draft
owner: qinyi
estimated_hours: 4
affected_components: [backend]
allowed_paths:
  - backend/app/modules/ppm/task/service.py
depends_on: [task-01]
blocks: [task-03, task-11]
goal: "task/service.py execute_plan 改 action + 强制回填 actual_end + service 跨天校验 + 新增 start"
implementation:
  - "新增 start(plan_task_id, execute_user_id)：plan 未开始→进行中，创建 TaskExecute(actual_start=now, status=30)"
  - "execute_plan 读 action（替代 submit）；强制 exc.actual_end_time = req.actual_end_time or now（D-005）"
  - "service 内跨天校验：exc.actual_start_time.date != actual_end_time.date → TaskError 422"
  - "action=complete→status90+plan已完成；action=submit→status90+plan未开始"
acceptance:
  - "start 创建 TaskExecute(actual_start, status=30) + plan→进行中"
  - "submit→plan未开始 / complete→plan已完成"
  - "跨天抛 TaskError(422)；actual_end 强制回填（req 不带也写 now）"
verify:
  - "cd backend && uv run pytest app/modules/ppm/task -q"
constraints:
  - "D-005 强制回填是 W4 求和生效的前提"
  - "跨天校验在 service 内部（D-004），不依赖 schema validator"
---

## 目标
execute_plan 删 submit 改 action（submit/complete）+ 强制回填 actual_end_time=now + service 内跨天校验；新增 start 方法。

## 依据
design §5.1 / §7.2；D-002（状态机）/ D-003（action）/ D-004（跨天 service 内部）/ D-005（强制回填 actual_end——P1-2 关键，让新录入有 actual 区间）。

## steps
1. 新增 `async def start(self, plan_task_id, execute_user_id)`：plan 未开始→进行中；创建 TaskExecute(actual_start_time=now, status=STATUS_DOING(30), execute_user_id)；plan.actual_start_time 回填（若空）；commit+refresh+返回
2. execute_plan 改：读 `req.action`（替代 req.submit）；`exc = await get(req.task_execute_id)`（必填）；**强制 `exc.actual_end_time = req.actual_end_time or now`**（不再只在 req 带时写）；写 time_spent/execute_info
3. service 内跨天校验：`if exc.actual_start_time and exc.actual_start_time.date() != exc.actual_end_time.date(): raise TaskError(422, "执行起止时间不可跨天，请拆成每天单独填报")`
4. action=complete：exc.status=STATUS_END(90) + plan.status=已完成 + plan.actual_end_time 回填；action=submit：exc.status=90 + plan.status=未开始

## 验收标准
- start 创建 TaskExecute(actual_start, status=30) + plan→进行中
- submit→plan未开始 / complete→plan已完成
- 跨天抛 TaskError(422)；actual_end 强制回填（req 不带也写 now）
