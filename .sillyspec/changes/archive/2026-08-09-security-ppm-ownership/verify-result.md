---
author: qinyi
created_at: 2026-08-10 07:08:36
change: 2026-08-09-security-ppm-ownership
stage: verify
---

# verify-result — change 2026-08-09-security-ppm-ownership（PPM 代填冒名防护）

## 结论

PASS WITH NOTES

本 change 已通过 verify：5 个 Wave 全实现、双门禁（Stage Review Gate acceptance + Task Review Gate 10/10）独立审查通过、ppm 模块全量 496 passed、ruff/format/mypy 全过。Notes 为非阻塞观察（见末节），不影响 PASS。

## 验证范围

交付文件 10 个（worktree 分支 `sillyspec/2026-08-09-security-ppm-ownership`，已手动 cp 到主仓库工作区——因主仓库存在并发未提交的 llm-provider 改动，`sillyspec worktree apply` 的 `git apply` 需干净工作区被阻断，按 change-1/2 既定经验走手动 cp，不 merge）：

- `backend/app/modules/ppm/common/ownership.py`（新，task-01）
- `backend/app/modules/ppm/task/service.py`（task-02/03/04）
- `backend/app/modules/ppm/problem/service.py`（task-05）
- `backend/app/modules/ppm/task/router.py` + `problem/router.py`（task-06）
- `backend/app/modules/ppm/common/tests/test_ownership.py`（新，task-07）
- `backend/app/modules/ppm/task/tests/test_task.py`（task-08）
- `backend/app/modules/ppm/problem/tests/test_problem_flow.py`（task-09）
- `.sillyspec/docs/SillyHub/scan/CONCERNS.md` + `.sillyspec/docs/multi-agent-platform/modules/backend.md`（task-10）

对照设计：design.md §4/§6/§7/§11、requirements.md FR-01~10 / AC-1~8 / NFR-01、decisions.md D-001~006、plan.md Wave 1~5、tasks/task-01~10.md。独立验收 acceptance review（24 项 checklist 全 pass，docHash 00904b1dbab6）已核实逐条 FR/AC/D 落地到 file:line。

## 单元测试结论

测试套件：`backend/app/modules/ppm`（含新增 `common/tests/test_ownership.py`）。

命令：`cd backend && uv run pytest app/modules/ppm -q --no-cov`

结果：**496 passed, 11 warnings in 81.44s**（主仓库 backend，cp 后复跑）。11 warnings 均为既有噪声（`HTTP_422_UNPROCESSABLE_ENTITY` DeprecationWarning 来自 `core/errors.py:216`；plan data_scope 的 `@pytest.mark.asyncio` 标在同步函数上的 PytestWarning），非本次改动引入。

新增用例（task-07 test_ownership.py，7 个）：resolve_owner 纯函数 4 分支 + PpmOwnershipDenied 错误语义（http_status=403 / code=HTTP_403_PPM_OWNERSHIP_DENIED / details）+ field 名可配置 + `start_plan_task` 端点双角色（非 admin 代填→403、非 admin 自填→201）。既有 test_task.py(13 处 actor stub)/test_problem_flow.py(9 处) 补 `actor=_ADMIN` 放行造数，零断言篡改（遵 CLAUDE 第 9 条）。

独立复跑：验收子代理在 worktree backend 独立执行同一命令 = 496 passed in 74.55s，与实现者自报一致，无 flaky。

## 集成证据（Integration Evidence）

design.md 命中关键词 `backend`（10 次）→ 触发集成级证据门控。本 change 的集成验证为 `test_ownership.py::TestStartPlanTaskOwnership` 两个 HTTP 端到端 integration test（非 mock 单测），覆盖真实集成链路：

- `test_non_admin_filling_other_rejected_403`：非平台管理员 `POST /api/ppm/task-plan/start` 传他人 `execute_user_id` → 经 router（AuthUser 认证）→ `PlanTaskService.start` → `resolve_owner(non_admin, other)` 抛 `PpmOwnershipDenied` → `core/errors` 全局 handler 映射 → **HTTP 403 + body `code=HTTP_403_PPM_OWNERSHIP_DENIED`**。这是真实 daemon↔backend 集成级的归属校验端到端验证（FastAPI app + httpx ASGITransport + in-memory SQLite DB + 全局 exception handler 全链路，非 service 层 mock）。
- `test_non_admin_filling_self_accepted_201`：非管理员自填 → resolve_owner 放行 → 落库 TaskExecute → **HTTP 201 + execute_user_id==自己**。

真实集成点：`start_plan_task` 端点仅 `AuthUser` 认证依赖（无额外权限门），非管理员可直达 service `start()` 的 `resolve_owner` 校验点（已在审查中 grep 两 router 全文 `or user.id` 零命中确认兜底折叠已彻底下移 service 层）。admin 代填→201（AC-3）由既有 `task/tests/test_router.py`（admin token 填随机 execute_user_id 走通）回归覆盖。

## Runtime Evidence

主仓库 backend 实跑（cp 后，2026-08-10 07:06）：

```
$ cd backend && uv run pytest app/modules/ppm -q --no-cov
..............................SSSS.............................................X
... (496 项) ...
496 passed, 11 warnings in 81.44s
```

归属校验关键路径运行时确认（test_ownership.py 端点用例输出片段）：
```
app/modules/ppm/common/tests/test_ownership.py::TestStartPlanTaskOwnership::test_non_admin_filling_other_rejected_403 PASSED
app/modules/ppm/common/tests/test_ownership.py::TestStartPlanTaskOwnership::test_non_admin_filling_self_accepted_201 PASSED
app/modules/ppm/common/tests/test_ownership.py::TestResolveOwner::test_non_admin_other_raises_with_403_semantics PASSED
```

无 daemon/lease 跨进程链路（本 change 纯 backend service 层校验，不涉及 daemon↔backend 心跳/lease/lifecycle），故无需 daemon 集成证据；HTTP 端到端 integration test 即本变更实际改动入口（FastAPI router→service）的真实启动级证据。

## Lint / 静态检查

- `ruff check`（8 个变更源/测文件）：All checks passed!
- `ruff format --check app/modules/ppm/`：85 files already formatted
- `mypy`（5 个生产文件 ownership/task-service/problem-service/task-router/problem-router）：Success: no issues found in 5 source files

不碰 OpenAPI/DTO/migration → 无需 `pnpm gen:types`（design §3 显式声明，NFR-03）。

## 决策追踪矩阵（D-xxx@vN → FR → task → evidence）

| 决策 | FR | task | evidence |
|---|---|---|---|
| D-001@v1 仅平台管理员可代填 | FR-01/02/09 | task-01/07 | ownership.py:69-70 admin 分支放行任意 requested；test_ownership admin+任意→放行用例 |
| D-002@v1 校验放 service 层（纵深防御） | FR-03~07 | task-02/03/04/05/06 | task/problem service 7 写方法均 required `*, actor` keyword + 调 resolve_owner（task/service.py:283/373/426-432/459/561/581、problem/service.py:646）；router 透传 actor=user |
| D-003@v1 resolve_owner 只挡显式冒名（None 不校验） | FR-01 | task-01 | ownership.py:67-68 requested is None→return None；test_ownership test_requested_none_returns_none |
| D-004@v1 PpmOwnershipDenied 放 ppm 作用域（仿 SsrfBlocked） | FR-02 | task-01 | ownership.py:33-43 code=HTTP_403_PPM_OWNERSHIP_DENIED http_status=403；core/errors.py 全局 handler 按 http_status 映射，未改 router |
| D-005@v1 只加执行/工时/负责人写入口，不加通用 create/list | FR-03~07 | task-02~06 | 仅 7 个写端点（start/execute_plan/task-execute create+update/work-hour create+update/execute_problem）加校验；PlanTaskService.create 建计划、通用 list 不动 |
| D-006@v1 测试改动分级（router 零改动 / service 补 admin stub） | FR-10 | task-08/09 | task test_router.py 零改动（admin token 代填走通作 AC-3 回归）；test_task.py(13)/test_problem_flow.py(9) 补 actor=_ADMIN stub 放行造数，零断言篡改 |

6 探针结果：① 未实现标记=无（10/10 task 实现）；② 关键词缺失=无（design §4/§7 关键概念全落地）；③ 测试缺失=无（496 passed 含 7 新增 ownership）；④ 决策未闭环=无（D-001~006@v1 全 accepted）；⑤ API 契约缺口=无（不改 DTO/OpenAPI，NFR-03）；⑥ 代码删除对账=删 2 处 `execute_user_id or user.id` 兜底（task/router.py:224、problem/router.py:504）+ 死代码 plan.user_id，design §7.2 已记（复刻旧折叠有效默认=actor.id）。

## Notes（非阻塞）

1. AC-2 其余 6 个归属端点（execute_plan / task-execute create+update / work-hour create+update / execute_problem）未各起独立 HTTP 403 用例，依赖 test_ownership 单端点(start_plan_task) HTTP + resolve_owner 纯函数原语 4 分支覆盖。design §7.4 已显式声明此策略（共用同一 resolve_owner 调用模式，task-02~06 接线 + 纯函数测试已证原语）。建议后续如需更强端点覆盖可补 parametrize。
2. CONCERNS.md / backend.md 同步目前以未提交改动形式存在于主仓库工作区（待用户 commit 到 main），与 change-1/2 交付模式一致。
3. backend.md change-3 条目 test_task.py actor stub 计数已订正为 13（11 直调 + 2 helper，独立审查指出）。
