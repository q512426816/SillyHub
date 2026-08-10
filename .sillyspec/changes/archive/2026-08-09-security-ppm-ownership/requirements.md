---
author: qinyi
created_at: 2026-08-10 00:07:07
change: 2026-08-09-security-ppm-ownership
---

# 需求（Requirements）— PPM 代填冒名防护（ownership 校验）

> 决策覆盖：本需求引用全部当前版本决策 D-001@v1 ~ D-006@v1（见 [[decisions]]），无未覆盖的剩余 D-xxx@vN。

## 功能需求（FR）

- **FR-01** 新建 `backend/app/modules/ppm/common/ownership.py`：提供 `resolve_owner(*, actor, requested, field)` 归属校验原语 + `PpmOwnershipDenied(AppError)` 错误类（code=`HTTP_403_PPM_OWNERSHIP_DENIED`, http_status=403）。（D-003、D-004）
- **FR-02** `resolve_owner` 语义：requested=None→返回 None（不校验，保留默认）；actor.is_platform_admin→返回 requested（管理员代填放行）；requested==actor.id→返回 requested（自填放行）；其余→抛 PpmOwnershipDenied。（D-001、D-003）
- **FR-03** `ProblemService.execute_problem` 加 `*, actor: User`：router 透传 user + 原始 body.execute_user_id；service `resolved = resolve_owner(...)`，`final = resolved if resolved is not None else actor.id`，写 `exc.execute_user_id = exc.current_user_id = final`。（D-002）
- **FR-04** `PlanTaskService.start` / `execute_plan` 加 `*, actor: User`：router 透传 user + 原始 body.execute_user_id；service 各字段经 resolve_owner，None 保留既有默认。（D-002）
- **FR-05** `TaskExecuteService.create` / `update` 加 `*, actor: User`：execute_user_id / check_user_id / current_user_id 三字段各过 resolve_owner（仅提供的校验，None 保留默认）。（D-002）
- **FR-06** `WorkHourService.create` / `update` 加 `*, actor: User`：user_id 过 resolve_owner（create 必填字段，update 可选）。（D-002）
- **FR-07** router 7 端点（execute_problem / start_plan_task / execute_plan_task / create+update_task_execute / create+update_work_hour）把 `user` 作为 actor 透传进 service，不再在 router 内做 `or user.id` 折叠（折叠下移到 service 内，保零漂移）。（D-002、D-005）
- **FR-08** `PpmOwnershipDenied` 经 `core/errors.register_exception_handlers` 全局映射返 HTTP 403 + code，无需改 router/DTO/OpenAPI。（D-004）
- **FR-09** 新增 `ppm/common/tests/test_ownership.py`：resolve_owner 纯函数 4 分支 + 端点双角色（non-admin 代填→403 / admin 代填→201·200 / 自填→201·200）。（D-001）
- **FR-10** 既有 service 层直调测试（test_task.py ~13 处 + 2 helper / test_problem_flow.py 9 处）补 `actor=admin stub`（SimpleNamespace），不改断言语义。（D-006）

## 非功能需求（NFR）

- **NFR-01** 文档同步：CONCERNS.md PPM 冒名条目标 ✅ 已修复 + backend.md 模块卡片变更索引（归档前/收尾 task）。
- **NFR-02** 零行为漂移：None 保留默认、自填照旧、admin 代填照旧——非冒名路径与改动前逐字段等价（§7.2 #7 已论证 else actor.id 复刻旧 `or user.id`）。
- **NFR-03** 跨平台：纯 Python 逻辑校验，无 OS 相关调用，天然兼容 Windows/Linux/macOS（CLAUDE.md 规则 13）。
- **NFR-04** 不碰 OpenAPI/DTO/migration → 无需 `pnpm gen:types`（CLAUDE.md 规则 20）。

## 验收（AC，详见 design §9）

AC-1 非管理员代填 execute_user_id→403；AC-2 非管理员代填 work-hour user_id→403；AC-3 管理员代填任意→201/200；AC-4 自填→201/200 不变；AC-5 字段 None→保留默认不 403；AC-6 既有测试全绿（router 零改动 + service 补 admin stub）；AC-7 不改 OpenAPI/DTO/migration；AC-8 PpmOwnershipDenied 返 403+code。
