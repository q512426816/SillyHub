---
id: task-01
title: 6 个 ppm router 端点改用 get_current_principal 仅认证
title_zh: 把 ppm 六个 router 的 ppm 权限校验依赖换成仅认证的 get_current_principal
author: qinyi
created_at: 2026-07-20 13:12:48
priority: P0
depends_on: []
blocks: [task-04, task-05]
requirement_ids: [FR-03]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/ppm/project/router.py
  - backend/app/modules/ppm/plan/router.py
  - backend/app/modules/ppm/task/router.py
  - backend/app/modules/ppm/problem/router.py
  - backend/app/modules/ppm/kanban/router.py
  - backend/app/modules/ppm/workbench/router.py
goal: >
  把 project/plan/task/problem/kanban/workbench 六个 ppm router 的端点权限校验依赖从
  Depends(require_permission_any(Permission.PPM_*)) 统一换成 Depends(get_current_principal)，
  使登录用户（或持有合法 API key 的 daemon）即可调用、未认证返回 401，不再做 ppm 操作权限授权。
provides: []
expects_from: []
implementation:
  - 在 6 个 router 中逐文件 grep 所有 `require_permission_any(Permission.PPM_*` 引用，覆盖三种声明形态——顶部集中类型别名（project 的 `_PROJECT_*`/`_CUSTOMER_*`、task 的 `TaskWriteUser` 等、kanban 的 `KanbanViewUser`/`KanbanAssignUser`、workbench 复用 PPM_TASK_READ 的别名）、端点签名内联 `Annotated[User, _X]`、以及散落端点无 Annotated 的 `user: User = Depends(require_permission_any(...))`（task router 的 update_plan_task / delete_plan_task / update_task_execute / delete_task_execute / update_work_hour / delete_work_hour 等端点，plan/problem router 同类散落声明）。
  - 统一替换为 `Annotated[User, Depends(get_current_principal)]`，`get_current_principal` 从 `app.core.auth_deps` 导入（与已 import 的 require_permission_any 同模块，import 行只需把符号名换成 get_current_principal）。
  - 集中别名收敛为单一 `AuthUser = Annotated[User, Depends(get_current_principal)]`，端点签名改用 `user: AuthUser`（或 kanban 中 `_user: AuthUser` 保持原参数名不变）；删除原 `_PROJECT_*`/`TaskWriteUser`/`KanbanViewUser` 等中间别名及 `_CUSTOMER_*` 全部行，避免悬空符号。
  - 清理 import：删除不再使用的 `require_permission_any` 引用；task router 原本就 import 了 `get_current_user`（用于 personal-task-plan 等），保留 `get_current_principal` 后若 `get_current_user` 不再有引用则一并删除，否则保留。
  - 保留 `get_session` / `SessionDep` / `get_ppm_data_scope` / `Query` 等非权限依赖与端点业务逻辑、参数、响应模型一律不动。
acceptance:
  - 6 个 router 文件 grep `require_permission_any` 零命中。
  - 6 个 router 文件 grep `Permission.PPM_` 零命中（无残留权限引用）。
  - 未携带 Authorization/X-API-Key 的请求访问任一 ppm 端点返回 401。
  - 携带合法 JWT 或 API key 的请求可正常访问原需 ppm 权限的端点（不再 403）。
  - 6 个 router 模块均可正常 import，无 NameError / 未定义符号 / 未使用 import（ruff F401）。
verify:
  - cd backend && uv run ruff check app/modules/ppm
  - cd backend && uv run mypy app/modules/ppm
  - cd backend && uv run python -c "from app.modules.ppm.project import router as r1; from app.modules.ppm.plan import router as r2; from app.modules.ppm.task import router as r3; from app.modules.ppm.problem import router as r4; from app.modules.ppm.kanban import router as r5; from app.modules.ppm.workbench import router as r6"
constraints:
  - 保留 get_current_principal 的 JWT + API key 双路径认证语义（daemon API key 调用路径不能受影响）。
  - 不改任何端点的业务逻辑、路径、HTTP 方法、参数、Query 校验、响应模型与状态码。
  - 不删 get_session / SessionDep / get_ppm_data_scope 等非权限依赖。
  - plan/problem router 的散落端点声明（无 Annotated 的 `user: User = Depends(...)`）必须逐一改完，不允许遗漏导致半改残留 require_permission_any。
  - task router 三种声明形态（集中别名 / 内联 Annotated / 裸 Depends）必须全部收敛到 get_current_principal，不得只改别名。
  - 不在本 task 改 permissions.py 枚举（属 task-04）、不改前端（task-03/06）、不改迁移（task-02）；本 task 仅动 6 个 router 文件。
---
