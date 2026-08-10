---
author: qinyi
created_at: 2026-08-10 00:07:07
change: 2026-08-09-security-ppm-ownership
---

# 决策台账 — PPM 代填冒名防护（ownership 校验）

> 来源：CONCERNS.md「2026-08-08 多代理审计」🔴 高危「PPM 代填冒名」+ 用户锁定决策（主 plan `cozy-stirring-corbato.md`）。串行 3 安全 change 之 3。详见 [[design]]。

## D-001@v1 — 仅平台管理员可代填

- **type**: policy
- **status**: accepted
- **source**: 用户锁定决策（主 plan）
- **question**: 谁有权把执行/工时归属字段填成「非当前登录用户」？
- **answer**: 仅 `is_platform_admin=True` 的平台管理员可代填（运维/纠错场景）；非管理员显式填他人 → HTTP 403。自填报（字段==自己）一切照旧。
- **normalized_requirement**: 非管理员在 7 个写端点把 execute_user_id/check_user_id/current_user_id/user_id 填成非自己 → 403；管理员代填放行。
- **impacts**: resolve_owner 的 admin 分支；覆盖 G1（冒名面）
- **evidence**: backend/app/modules/ppm/common/ownership.py（resolve_owner）；User.is_platform_admin
- **priority**: P0
- **理由**: PPM 已上线，真实工时/绩效/结算数据风险；管理员代填覆盖合法运维，非管理员一律收口为「只能填自己」。

## D-002@v1 — 校验放 service 层（纵深防御）

- **type**: architecture
- **status**: accepted
- **source**: 用户锁定决策（主 plan）+ Design Grill（确认纵深防御价值）
- **question**: 归属校验放 router 还是 service？
- **answer**: 放 service 层。router 把当前登录 User（actor）透传进 service，service 在落库前对每个归属字段调 resolve_owner。即使将来有内部代码直接调 service 也受保护。
- **normalized_requirement**: 6 个 service 方法签名加 required `*, actor: User`；router 7 端点透传 user。
- **impacts**: problem/service.execute_problem、task/service.{PlanTaskService.start/execute_plan, TaskExecuteService.create/update, WorkHourService.create/update}；覆盖 G2（内部绕过）
- **evidence**: design §4、§7.2
- **priority**: P0
- **理由**: 单纯 router 校验挡不住 service 间互调；service 层是落库最后一道，纵深防御。Design Grill 警告：勿为省测试把 actor 改 optional，否则瓦解此层。

## D-003@v1 — resolve_owner 只挡显式冒名

- **type**: design
- **status**: accepted
- **source**: brainstorm step 5
- **question**: 字段为 None（未指定）时如何处理？
- **answer**: None 不校验、不挡——保留调用方既有默认（如 start 的「登录用户 id」、execute_problem 的 `else actor.id`）。只挡「显式填他人且非管理员」。自填（==actor.id）放行。
- **normalized_requirement**: requested is None → return None；admin → return requested；non-admin+self → return requested；non-admin+other → PpmOwnershipDenied。
- **impacts**: resolve_owner 语义；覆盖 G3（误伤）
- **evidence**: design §7.1
- **priority**: P0
- **理由**: None 是合法的「不覆盖/用默认」，挡了会误伤跨天补填、多段执行等正常用法。

## D-004@v1 — PpmOwnershipDenied 错误类放 ppm 作用域

- **type**: design
- **status**: accepted
- **source**: brainstorm step 5
- **question**: 403 错误类放 core/errors.py 还是 ppm 模块？
- **answer**: 放 `ppm/common/ownership.py`（与 helper 共处），仿 tool_policy.SsrfBlocked 模式。code=`HTTP_403_PPM_OWNERSHIP_DENIED`、http_status=403。全局 handler 已自动按 http_status 映射 AppError 子类，无需改 router/core。
- **normalized_requirement**: PpmOwnershipDenied(AppError) 经全局 handler 返 403 + code，前端按 code 提示「无权代他人填报」。
- **impacts**: ppm/common/ownership.py；不改 core/errors.py、不改 OpenAPI/DTO
- **evidence**: core/errors.py:366（AppError→http_status 映射）；design §7.3
- **priority**: P1
- **理由**: 不污染公共错误命名空间；ppm 作用域清晰；零契约改动。

## D-005@v1 — 只加执行/工时/负责人写入口，不加通用 create/list

- **type**: design
- **status**: accepted
- **source**: 用户锁定决策（主 plan）+ brainstorm step 5
- **question**: resolve_owner 加在哪些入口？
- **answer**: 只加 7 个「执行/工时/任务负责人」写端点的 service 方法（execute_problem / start / execute_plan / task-execute create+update / work-hour create+update）。**绝不**加在通用 create/list/page（会误伤 test_task.py 大量随机 user_id 造数 + 计划负责人 user_id 不动）。
- **normalized_requirement**: §6 文件清单 + §7.2 逐端点对照，7 端点全覆盖；PlanTaskService.create（建计划 user_id）不在范围。
- **impacts**: design §6/§7.2；覆盖 G4（范围蔓延）
- **evidence**: design §3（非目标含 PlanTaskCreate / duty·audit_user_id / delete 端点）
- **priority**: P0
- **理由**: 计划负责人是计划阶段语义（非执行代填）；通用 create/list 的查询过滤属 data_scope 既有机制；收窄范围降低已上线模块回归面。

## D-006@v1 — 测试改动分级（router 零改动 / service 补 admin stub）

- **type**: test
- **status**: accepted
- **source**: Design Grill major 修正（brainstorm step 7）
- **question**: service 签名加 required actor 后，既有测试影响面？
- **answer**: 分两级——①router 层 test_router.py 经 auth_admin_token（admin）+ auth_headers，admin 代填放行 → **零改动**；②service 层直调 test_task.py（~13 处 + _seed_work_hour/_seed_task_execute 两 helper，被近 10 stat/page 测试复用）+ test_problem_flow.py（9 处 execute_problem 直调，均 omit execute_user_id 且不断言该字段）→ 补 `actor=admin stub`（SimpleNamespace(id, is_platform_admin=True)，resolve_owner 鸭子类型无 isinstance 不查库），admin 放行使既有随机 uuid 造数仍 OK，**不改断言语义**（规则 9「补参数模拟合法 admin」）。
- **normalized_requirement**: 既有测试全绿——router 零改动 + service 补 actor 参数；新增 test_ownership.py（resolve_owner 纯函数 + 端点双角色 403/200）。
- **impacts**: design §7.4/§6/AC-6；test_task.py / test_problem_flow.py
- **evidence**: design §7.4（逐 call site + 断言核对）；test_problem_flow.py:431/456/.../567；test_task.py:73/113/242/...
- **priority**: P0
- **理由**: Grill 初审 qualityVerdict=fail 正是因原设计误称「零改动」；逐文件核对后量化影响面，admin stub 方案使改动机械化且不损语义。
