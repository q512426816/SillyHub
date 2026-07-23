---
id: task-04
title: 删 permissions.py 17 个 PPM_* 操作权限枚举成员 + 更新 test_ppm_permissions.py（覆盖：FR-01, FR-02, FR-05, D-004@v1）
title_zh: 删除 PPM 模块 17 个摆设操作权限枚举并同步权限枚举测试
author: qinyi
created_at: 2026-07-20 13:12:48
priority: P0
depends_on: [task-01]
blocks: [task-06]
requirement_ids: [FR-01, FR-02, FR-05]
decision_ids: [D-004@v1]
allowed_paths:
  - backend/app/modules/auth/permissions.py
  - backend/tests/modules/auth/test_ppm_permissions.py
goal: >
  删除 17 个摆设的 ppm 操作权限枚举成员只留 8 个菜单权限，同步把权限枚举测试的期望值与计数断言改到 8。
provides: {}
expects_from: {}
implementation:
  - "permissions.py：删除 17 个操作权限枚举成员——PPM_PROJECT_WRITE/PPM_PROJECT_DELETE/PPM_PROJECT_EXPORT、PPM_CUSTOMER_WRITE/PPM_CUSTOMER_DELETE/PPM_CUSTOMER_EXPORT、PPM_PLAN_WRITE/PPM_PLAN_DELETE/PPM_PLAN_EXPORT、PPM_PROBLEM_WRITE/PPM_PROBLEM_DELETE/PPM_PROBLEM_EXPORT、PPM_TASK_WRITE/PPM_TASK_DELETE/PPM_TASK_EXPORT、PPM_WORKHOUR_WRITE、PPM_KANBAN_ASSIGN（即所有 write/delete/export/assign，共 4+3+3+3+3+1+0=17，注意 work-hour 删 write 留 read+stat、kanban 删 assign 留 view）。"
  - "permissions.py：保留 8 个菜单/读类权限——PPM_PROJECT_READ、PPM_CUSTOMER_READ、PPM_PLAN_READ、PPM_PROBLEM_READ、PPM_TASK_READ、PPM_WORKHOUR_READ、PPM_WORKHOUR_STAT、PPM_KANBAN_VIEW。删除时连带删除被弃枚举成员上方的分组注释（如「写/删/导出」语义行）以免遗留误导，但保留每域的 read 注释与 ppm: 前缀分组注释。"
  - "permissions.py：group property 不改——仍按 `if prefix == \"ppm\"` 归类，8 个保留成员同样以 ppm: 前缀落入 PermissionGroup.PPM。"
  - "test_ppm_permissions.py：把 EXPECTED_PPM_PERMISSIONS 从 25 项裁剪到 8 项，仅保留 8 个 ppm: 菜单权限成员（PPM_PROJECT_READ/PPM_CUSTOMER_READ/PPM_PLAN_READ/PPM_PROBLEM_READ/PPM_TASK_READ/PPM_WORKHOUR_READ/PPM_WORKHOUR_STAT/PPM_KANBAN_VIEW）；同步更新字典上方注释「design §6 指定的 N 个 PPM_* 成员」与各域分组注释。"
  - "test_ppm_permissions.py：把 test_ppm_permission_member_count_is_25 重命名为 test_ppm_permission_member_count_is_8（或改测试体），断言 `len(EXPECTED_PPM_PERMISSIONS) == 8`，docstring 同步改为「8 个菜单权限」。"
  - "test_ppm_permissions.py：test_platform_admin_seed_grants_all_ppm_permissions 与 test_non_system_role_has_no_ppm_permissions 无需改逻辑——它们遍历 EXPECTED_PPM_PERMISSIONS.values()，字典裁到 8 项后自动只校验这 8 个菜单权限的授予/回归。"
acceptance:
  - "sum(1 for p in Permission if p.value.startswith(\"ppm:\")) == 8（枚举内 ppm: 前缀成员恰好 8 个）。"
  - "cd backend && uv run pytest tests/modules/auth/test_ppm_permissions.py -v 全绿，包括裁剪后的成员存在性、计数、group 归类、platform_admin 授予 8 个菜单权限、普通角色不含 PPM_* 全部通过。"
  - "PermissionGroup.PPM 仍正确包含这 8 个保留成员（group property 对每个保留成员返回 PPM）。"
  - "被删的 17 个枚举成员在 Permission 中已不存在（hasattr(Permission, 'PPM_PROJECT_WRITE') 等为 False）。"
verify:
  - "cd backend && uv run pytest tests/modules/auth/test_ppm_permissions.py -v"
  - "cd backend && uv run ruff check app/modules/auth"
  - "cd backend && uv run mypy app/modules/auth"
constraints:
  - "依赖 task-01：6 个 ppm router 必须已先改为不再 import 被删的 17 个枚举成员（否则 `from app.modules.auth.permissions import Permission` 后引用会 AttributeError / import 报错），task-01 完成前不可执行本 task。"
  - "枚举与测试必须在同一 task 内一并改：中间状态（枚举已删但测试仍断言 25，或反之）不可工作，pytest 会立即失败。"
  - "group property 不改——仍以 ppm: 前缀归类，这是 D-004@v1「保留 8 个菜单权限并继续按前缀折叠到 PPM 组」的落地。"
  - "不删非 PPM 权限（user/workspace/change/task 等其它前缀的枚举成员与本 task 无关，保持原样）。"
  - "不触碰迁移文件与 seed：被删权限点的 DB 种子清理由 task-05（迁移 down/seed 收敛）负责，本 task 只改枚举源与对应单元测试。"
---
