---
id: task-03
title: auth/rbac.py collect_* 缓存接入（FR-02, D-003@v2）
title_zh: auth/rbac.py collect_permissions_* 缓存接入
author: qinyi
created_at: 2026-07-23 09:42:00
priority: P2
depends_on: [task-01]
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-003@v2]
allowed_paths:
  - backend/app/modules/auth/rbac.py
goal: >
  在 collect_permissions_platform / _all / _workspace 入口插入"查缓存 → miss 查库 → 回填"逻辑;
  collect_permissions_everywhere 改读 platform+all 内存并集(不查库、不单独缓存)。has_permission 签名不变。
implementation:
  - collect_permissions_platform(user_id):先 get_cached_permissions(scope='platform'),miss 时执行现有查库,再 set_cached_permissions(scope='platform')
  - collect_permissions_all(user_id):同上,scope='all'
  - collect_permissions(user_id, workspace_id)(单工作区):scope='workspace',workspace_id 传入
  - collect_permissions_everywhere(user_id):改为 `get platform ∪ get all` 内存并集(两键都 miss 时各自触发查库回填),不再单独查库/缓存
  - has_permission(session, *, user, permission, workspace_id)(L87)三级短路逻辑不变;is_platform_admin 第一级短路(读 user 对象字段)不缓存
acceptance:
  - collect_permissions_platform/_all/_workspace 入口查缓存,miss 时查库+回填
  - collect_permissions_everywhere 读 platform+all 内存并集,不单独查库不单独缓存
  - has_permission 签名与三级短路语义不变
verify:
  - cd backend && uv run pytest app/modules/auth/tests/ -q
  - cd backend && uv run mypy app/modules/auth/rbac.py
  - cd backend && uv run ruff check app/modules/auth/rbac.py
constraints:
  - D-003@v2:三键分离,everywhere 不单独存(避免 platform/all/everywhere 互相覆盖污染)
  - 不改 auth_deps 调用层语义(缓存插入点在 rbac.py 内部)
---

流程位置:Wave 2(缓存读接入,依赖 task-01)。与 task-04(data_scope 读接入)、task-05~09(失效触发)同 Wave 可并行。
