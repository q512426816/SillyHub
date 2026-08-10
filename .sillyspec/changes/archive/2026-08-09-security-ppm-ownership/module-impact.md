---
author: qinyi
created_at: 2026-08-10 07:22:00
change: 2026-08-09-security-ppm-ownership
stage: archive
generator: impact-analyzer
---

# module-impact — change 2026-08-09-security-ppm-ownership（PPM 代填冒名防护）

> 真相源：worktree `git diff --name-only caca0584..HEAD`（baseline checkpoint 之后 = 本 change 真实改动，10 文件）。映射依据 `.sillyspec/docs/multi-agent-platform/modules/_module-map.yaml`（顶层粗粒度模块）。

## 模块影响矩阵

| 模块 | 子区域 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|------|--------|----------|----------|-------------|-------------|
| backend | ppm/common | 新增 | `backend/app/modules/ppm/common/ownership.py` | 新增归属校验原语 `resolve_owner`（4 分支：None→None / admin+任意→放行 / non-admin+self→放行 / non-admin+other→PpmOwnershipDenied）+ `PpmOwnershipDenied(AppError)` code=`HTTP_403_PPM_OWNERSHIP_DENIED` http_status=403 | false |
| backend | ppm/task | 逻辑变更 | `backend/app/modules/ppm/task/service.py` | PlanTaskService.start/execute_plan、TaskExecuteService.create/update、WorkHourService.create/update 共 6 方法加 `*, actor: User` keyword + 落库前各归属字段过 resolve_owner（execute_user_id/check_user_id/current_user_id/user_id） | false |
| backend | ppm/problem | 逻辑变更 | `backend/app/modules/ppm/problem/service.py` | ProblemService.execute_problem 加 actor + execute_user_id 过 resolve_owner（else actor.id 零漂移，复刻旧 router 折叠） | false |
| backend | ppm/task, ppm/problem | 调用关系变更 | `backend/app/modules/ppm/task/router.py`、`backend/app/modules/ppm/problem/router.py` | 7 写端点（start/execute_plan/task-execute create+update/work-hour create+update/execute_problem）router 透传 `actor=user`，删 `execute_user_id or user.id` 兜底收窄（纵深防御第一道） | false |
| backend | ppm/common, ppm/task, ppm/problem | 新增 | `backend/app/modules/ppm/common/tests/test_ownership.py` | 新增 resolve_owner 纯函数 4 分支 + PpmOwnershipDenied 语义 + start_plan_task 端点双角色 HTTP integration test（非 admin 代填→403 / 自填→201） | false |
| backend | ppm/task | 逻辑变更 | `backend/app/modules/ppm/task/tests/test_task.py` | 13 处（11 直调+2 helper）补 `actor=_ADMIN` stub 放行造数（规则 9，零断言篡改） | false |
| backend | ppm/problem | 逻辑变更 | `backend/app/modules/ppm/problem/tests/test_problem_flow.py` | 9 处 execute_problem 直调补 `actor=_ADMIN` stub | false |
| docs | scan/backend-card | 配置变更 | `.sillyspec/docs/SillyHub/scan/CONCERNS.md` | 「执行人/负责人 body 可控冒名填报」条目标 ✅ 已修复 + change 名 + 手段摘要 | false |
| docs | backend-card | 配置变更 | `.sillyspec/docs/multi-agent-platform/modules/backend.md` | 变更索引加 change-3 条目（ownership.py 原语 + 7 端点 actor + 测试 + 496 passed） | false |

## 未匹配文件

| 文件 | 原因 |
|------|------|
| （无） | 全部 10 个变更文件均映射到 _module-map.yaml 顶层模块（backend / docs） |

## 影响汇总

- **后端代码**：8 个文件，集中在 ppm 子域（common/task/problem）。新增 1 个归属校验原语模块（ownership.py）+ 1 个测试文件（test_ownership.py），6 处 service 方法 + 7 处 router 端点加 actor 透传/校验。不改 OpenAPI/DTO/migration（NFR-03，无需 gen:types）。
- **文档**：2 个文件（CONCERNS.md 审计条目 + backend.md 变更索引），纯标记/索引同步。
- **测试**：ppm 全量 496 passed（489 既有 + 7 新增 ownership），零回归。
- **跨模块依赖**：无。ownership.py 仅依赖 `app.core.errors.AppError`（单向），ppm/task 与 ppm/problem service 各 import ownership，无环。
- **needs_review**：全部 false——影响明确（service 层归属校验 + router 透传），已在双门禁（Stage acceptance review + Task review 10/10）核实到 file:line。
