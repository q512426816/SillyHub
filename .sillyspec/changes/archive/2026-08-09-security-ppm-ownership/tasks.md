---
author: qinyi
created_at: 2026-08-10 00:07:07
change: 2026-08-09-security-ppm-ownership
---

# 任务清单（Tasks）— PPM 代填冒名防护（ownership 校验）

> brainstorm 阶段任务骨架（任务名级）；plan 阶段拆 Wave + 依赖关系 + allowed_paths 细化。详见 [[design]] §6/§7。

## Wave 1 — ownership 原语 + 错误类

- [ ] **task-01**: 新建 `backend/app/modules/ppm/common/ownership.py`——`PpmOwnershipDenied(AppError)`（code=`HTTP_403_PPM_OWNERSHIP_DENIED`, http_status=403）+ `resolve_owner(*, actor, requested, field)` 原语（None→None / admin→放行 / self→放行 / non-admin+other→raise），鸭子类型读 `actor.is_platform_admin`/`actor.id`

## Wave 2 — service 层注入（6 方法加 actor + resolve_owner）

- [ ] **task-02**: `task/service.py`——`PlanTaskService.start` / `execute_plan` 加 required `*, actor: User`，execute_user_id 经 resolve_owner，None 保留默认
- [ ] **task-03**: `task/service.py`——`TaskExecuteService.create` / `update` 加 `*, actor`，execute_user_id/check_user_id/current_user_id 三字段各过 resolve_owner（仅提供的校验）
- [ ] **task-04**: `task/service.py`——`WorkHourService.create` / `update` 加 `*, actor`，user_id 过 resolve_owner
- [ ] **task-05**: `problem/service.py`——`execute_problem` 加 `*, actor`，`final = resolved if resolved is not None else actor.id`（复刻旧 `or user.id`，零漂移），写 execute_user_id=current_user_id=final

## Wave 3 — router 透传 actor（7 端点）

- [ ] **task-06**: `problem/router.py` execute_problem + `task/router.py` 7 端点（start_plan_task / execute_plan_task / create+update_task_execute / create+update_work_hour）把 `user` 作 actor 透传，移除 router 内 `or user.id` 折叠（下移 service）

## Wave 4 — 测试

- [ ] **task-07**: 新增 `ppm/common/tests/test_ownership.py`——resolve_owner 纯函数 4 分支 + 端点双角色（non-admin 代填→403 / admin 代填→201·200 / 自填→201·200）
- [ ] **task-08**: `task/tests/test_task.py` 补 actor=admin stub——~13 处直调 + `_seed_work_hour`/`_seed_task_execute` 两 helper（覆盖近 10 stat/page 复用），不改断言
- [ ] **task-09**: `problem/tests/test_problem_flow.py` 补 actor=admin stub——9 处 execute_problem 直调（均 omit execute_user_id），不改断言

## Wave 5 — 验收 + 文档

- [ ] **task-10**: CONCERNS.md PPM 冒名条目标 ✅ 已修复 + backend.md 模块卡片变更索引；全量回归（ppm problem+task 测试套件全绿）
