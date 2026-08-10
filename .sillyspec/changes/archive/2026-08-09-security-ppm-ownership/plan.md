---
author: qinyi
created_at: 2026-08-10 00:20:00
change: 2026-08-09-security-ppm-ownership
plan_level: heavy
---

# 实现计划（Heavy Plan）：PPM 代填冒名防护（ownership 校验）

## 来源
brainstorm 已定稿：design.md 经「实现者自审 → Design Grill 独立审查（初审 qualityVerdict=fail，1 MAJOR：service 层测试影响 grounding 错误）→ 修正 → 复审（tier=independent，specVerdict/qualityVerdict 双 pass，无 P0/P1 blocker，4 NIT 留 plan 细化）」三轮。decisions.md D-001@v1 ~ D-006@v1 全 accepted，无 unresolved/superseded。需求：堵 PPM 7 个写端点的代填冒名（已上线模块）——非管理员显式填他人 → 403；管理员代填放行；自填/省略照旧。

## 范围（对齐 design §6 文件清单）
- 新增 `backend/app/modules/ppm/common/ownership.py`：`resolve_owner(*, actor, requested, field)` 原语 + `PpmOwnershipDenied(AppError, 403)` 错误类
- 修改 `backend/app/modules/ppm/task/service.py`：`PlanTaskService.start`/`execute_plan` + `TaskExecuteService.create`/`update` + `WorkHourService.create`/`update` 加 required `*, actor: User` + resolve_owner
- 修改 `backend/app/modules/ppm/problem/service.py`：`ProblemService.execute_problem` 加 `*, actor` + `final = resolved if resolved is not None else actor.id`（零漂移，复刻旧 `or user.id`）
- 修改 `backend/app/modules/ppm/task/router.py` + `problem/router.py`：7 端点透传 `actor=user`，移除 router 内 `or user.id` 折叠（下移 service）
- 新增 `backend/app/modules/ppm/common/tests/test_ownership.py`：resolve_owner 纯函数 4 分支 + 端点双角色（403/200）
- 修改 `backend/app/modules/ppm/task/tests/test_task.py`：~13 处 service 直调 + `_seed_work_hour`/`_seed_task_execute` 两 helper 补 `actor=admin stub`（SimpleNamespace）
- 修改 `backend/app/modules/ppm/problem/tests/test_problem_flow.py`：9 处 execute_problem 直调补 `actor=admin stub`
- `backend/app/modules/ppm/task/tests/test_router.py`：预期零改动（admin 代填放行，作回归网）
- 文档（Wave 5）：CONCERNS.md PPM 冒名条目标 ✅ + backend.md 变更索引
- 不改：DTO/OpenAPI/migration（403 经全局 handler 映射，无需 gen:types）/ data_scope / PlanTaskCreate / start_problem / duty·audit_user_id / delete 端点

## plan_level 判定
heavy —— 跨 ppm problem/task/common 三子域、7 写端点、6 service 方法签名变更、PPM 已上线零回归要求、service 层测试连锁改动（~22 处 + 2 helper）。

## Wave 1

- [x] task-01: 新建 ppm/common/ownership.py — resolve_owner 原语 + PpmOwnershipDenied(403)（FR-01/02, D-003/D-004；depends_on 无）

## Wave 2

> task-02/03/04 共享 task/service.py，须序列化（非真并行）；task-05 异文件可并行。

- [x] task-02: task/service.py PlanTaskService.start + execute_plan 加 actor + resolve_owner（FR-04, D-002；depends_on task-01）
- [x] task-03: task/service.py TaskExecuteService.create + update 加 actor + 三字段 resolve_owner（FR-05, D-002；depends_on task-01）
- [x] task-04: task/service.py WorkHourService.create + update 加 actor + user_id resolve_owner（FR-06, D-002；depends_on task-01）
- [x] task-05: problem/service.py execute_problem 加 actor + else actor.id 零漂移（FR-03, D-002；depends_on task-01）

## Wave 3

> task-06/08/09 异文件可并行。

- [x] task-06: problem/router.py + task/router.py 7 端点透传 actor=user（FR-07, D-002/D-005；depends_on task-02/03/04/05）
- [x] task-08: task/tests/test_task.py 补 actor=admin stub（~13 直调 + 2 helper，FR-10, D-006；depends_on task-02/03/04）
- [x] task-09: problem/tests/test_problem_flow.py 补 actor=admin stub（9 处，FR-10, D-006；depends_on task-05）

## Wave 4

- [x] task-07: 新增 ppm/common/tests/test_ownership.py — 纯函数 + 端点双角色（FR-09, D-001；depends_on task-01/06）

## Wave 5

- [x] task-10: CONCERNS.md + backend.md 文档同步 + ppm 全量回归（NFR-01, AC-6；depends_on task-07/08/09）

## 验收（AC，对齐 design §9）
- AC-1 非管理员代填 execute_user_id（problem/task-plan/task-execute）→ 403
- AC-2 非管理员代填 work-hour user_id → 403
- AC-3 管理员代填任意 → 201/200
- AC-4 自填报（字段==自己）→ 201/200，行为不变
- AC-5 字段 None → 保留既有默认，不 403
- AC-6 既有测试全绿（test_router.py 零改动 + test_task.py/test_problem_flow.py 补 admin stub 不改断言 + 新增 test_ownership.py）
- AC-7 不改 OpenAPI/DTO/migration（无需 gen:types）
- AC-8 PpmOwnershipDenied 经全局 handler 返 403 + code

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1（仅 admin 代填） | task-01, task-07 | AC-1, AC-2, AC-3 |
| D-002@v1（service 层纵深防御） | task-02, task-03, task-04, task-05, task-06 | AC-1, AC-4 |
| D-003@v1（只挡显式冒名） | task-01 | AC-5 |
| D-004@v1（PpmOwnershipDenied ppm 作用域） | task-01 | AC-8 |
| D-005@v1（只加执行/工时/负责人写入口） | task-06 | 范围收窄 |
| D-006@v1（测试改动分级） | task-08, task-09 | AC-6 |

## 验证命令（local.yaml test_strategy=module）
- 子模块套件：`cd backend && uv run pytest app/modules/ppm -q --no-cov`（命中 ppm 模块，精确到本变更范围）
- 单文件聚焦：`cd backend && uv run pytest app/modules/ppm/common/tests/test_ownership.py app/modules/ppm/task/tests/test_task.py app/modules/ppm/problem/tests/test_problem_flow.py app/modules/ppm/task/tests/test_router.py -q --no-cov`
- lint：`cd backend && uv run ruff check . && uv run ruff format --check .`

## 风险与对策（对齐 design §8）
- PPM 已上线 service 签名改动致回归 → keyword-only `*, actor` 不破位置参数 + admin 路径回归网 + None 保留默认
- service 层测试连锁 break（helper 被多测试复用）→ admin stub（SimpleNamespace）透传，修 2 helper 覆盖下游，不改断言（规则 9）
- 漏保护端点 → §6 清单 + §7.2 逐端点对照，7 端点全覆盖
