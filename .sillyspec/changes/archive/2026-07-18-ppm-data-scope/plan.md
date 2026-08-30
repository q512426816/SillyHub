---
author: qinyi
created_at: 2026-07-18 17:21:00
change: 2026-07-18-ppm-data-scope
---
plan_level: full

---

# 实现计划(Plan)— 任务计划/问题清单 数据查询范围

> ⚠️ 本计划为人工重写,纠正 sillyspec CLI 自动生成的错误版本(CLI 误规划"项目计划+组织子树+organization_id migration")。以本版本为准,严格对齐已重写的 design.md / decisions.md。

## Spike 前置验证

无。方案 A 纯查询过滤,复用现有 `PpmProjectMember.role_name` + `PlanTask`/`PpmProblemList` 现有字段,**无新技术、无新表、无 migration**(D-008)。

## Wave 1(基础模块,无依赖)

- [ ] **task-01**:新建 `backend/app/modules/ppm/common/data_scope.py`
  - 经理角色名常量 `MANAGER_ROLE_NAMES = {"部门经理","项目经理","开发经理","业务经理"}`(D-003)
  - `_manager_project_ids(session, user)`:查 `ppm_project_member(user_id=我)`,应用层拆分 `role_name` 后精确匹配经理集,返回其作为经理的 `pm_project_id` 集合(D-002)
  - `_is_super(session, user)`:`is_platform_admin` 或持 `super_admin` 角色(D-006)
  - `compute_task_scope_clause(session, user)` → 返回 `PlanTask` 的 where 条件(`or_(project_id.in_(经理集), user_id==我)`,超管返回 None=不加 where)(D-005/D-009)
  - `compute_problem_scope_clause(session, user)` → 返回 `PpmProblemList` 的 where 条件(`or_(project_id.in_(经理集), duty_user_id==我, audit_user_id==我, now_handle_user 拆分含我)`,超管 None)
  - 覆盖:D-001~D-006, D-009

## Wave 2(service 注入,依赖 W1)

- [ ] **task-02**:`PlanTaskService.page(req, *, user, session)` 与 `export-excel` 同源方法注入范围 where(任务计划)
  - 在现有 where 拼接后追加 `compute_task_scope_clause`(None 则跳过)(D-007)
  - 覆盖:FR-任务, AC-1~4, AC-8
- [ ] **task-03**:`ProblemService.list_problems(...)` 与 `list_problems_for_export` 注入范围 where(问题清单)
  - `now_handle_user` 应用层拆分匹配(避免 like 子串误匹配);同步导出防绕过(D-007)
  - 覆盖:FR-问题, AC-1~4, AC-6

## Wave 3(router 透传,依赖 W2)

- [ ] **task-04**:`task/router.py`(`/task-plan/page` task/router.py:141 + `/task-plan/export-excel`:237)与 `problem/router.py`(`/problem-list`:87 + `/problem-list/export-excel`:144)在 service 调用处补传 `user`(router 已有 `user` 依赖)
  - `require_permission_any(PPM_TASK_READ/PPM_PROBLEM_READ)` 保留(D-010 正交)
  - 覆盖:D-010

## Wave 4(测试,依赖 W1-3)

- [ ] **task-05**:`data_scope` 单测——5 档角色(超管/部门经理/项目经理/开发经理/业务经理/其余)+ 多项目并集 + `now_handle_user` 拆分匹配 + `project_id` NULL 边界 + `is_platform_admin` 兜底(AC-1~9)
- [ ] **task-06**:`service` 单测——task/problem 各 list+export 共 4 查询点的 full(超管)/scoped(经理)/scoped(自己负责)/empty 边界;SQLite/PG 方言兼容(AC-1~8)
- [ ] **task-07**:`router` 集成测——端到端 4 类用户范围 + 导出防绕过(AC-1~7)

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 D/AC |
|---|---|---|---|---|---|
| task-01 | data_scope.py 经理集+范围 where | W1 | P0 | — | D-001~006/009 |
| task-02 | PlanTaskService page+export 注入 | W2 | P0 | task-01 | AC-1~4,8 |
| task-03 | ProblemService list+export 注入 | W2 | P0 | task-01 | AC-1~4,6 |
| task-04 | router 4 端点透传 user | W3 | P0 | task-02,03 | D-010 |
| task-05 | data_scope 单测 | W4 | P0 | task-01 | AC-1~9 |
| task-06 | service 单测 | W4 | P0 | task-02,03 | AC-1~8 |
| task-07 | router 集成测 | W4 | P1 | task-04 | AC-1~7 |

## 关键路径

task-01 → task-02/03 → task-04 → task-06/07(最长路径)

## 全局验收标准

- [ ] `data_scope` / `service` / `router` 单测全绿(task-05/06/07),SQLite/PG 方言兼容
- [ ] `cd backend && uv run pytest -q --no-cov` 全绿(含新单测,无回归)
- [ ] `cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy app` 全绿
- [ ] curl 实测 5 档角色范围:超管全部 / 部门经理看相关项目全部 / 项目经理看相关项目全部 / 开发经理·业务经理同 / 其余只看自己负责的(AC-1~9)
- [ ] 导出接口同步过滤(防绕过)(AC-7)
- [ ] `project_id` NULL 任务仅负责人+超管可见(AC-8)
- [ ] 无 migration(D-008),无 alembic 操作

## 覆盖矩阵(decisions.md)

| ID | 覆盖任务 | 验收 |
|---|---|---|
| D-001(对象=任务计划+问题清单) | task-02, task-03, task-04 | AC-1~7 |
| D-002(经理判定=项目成员 role_name) | task-01 | AC-2,3,5,6 |
| D-003(经理角色集 4 个) | task-01 | AC-2,5,6 |
| D-004(部门经理同项目经理,不碰组织) | task-01 | AC-5 |
| D-005(自己要干的=只看自己负责) | task-01,02,03 | AC-4 |
| D-006(超管=is_platform_admin 或 super_admin) | task-01 | AC-1,9 |
| D-007(方案 A 公共过滤模块) | task-01~04 | 全 |
| D-008(无新表无 migration) | 全 | 回退零成本 |
| D-009(project_id NULL 归属) | task-01,02 | AC-8 |
| D-010(数据范围与功能权限正交) | task-04 | require_permission 保留 |
| D-011(不做前端) | — | 前端零改 |
