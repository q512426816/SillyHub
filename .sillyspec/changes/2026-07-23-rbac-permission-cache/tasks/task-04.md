---
id: task-04
title: ppm/common/data_scope.py 缓存接入（FR-03, D-005@v1）
title_zh: ppm/common/data_scope.py manager_project_ids/is_super_admin 缓存接入
author: qinyi
created_at: 2026-07-23 09:42:00
priority: P3
depends_on: [task-01]
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/ppm/common/data_scope.py
goal: >
  在 manager_project_ids / is_super_admin 入口插入"查 ppm-scope 缓存 → miss 查库 → 回填"逻辑。
  task/problem_scope_clause 用缓存值构建,不直接缓存(返回 SQLAlchemy where 表达式不可序列化)。
implementation:
  - manager_project_ids(session, user_id):先 get_cached_ppm_scope,miss 时执行现有查库(PpmProjectMember),再 set_cached_ppm_scope;返回 set[uuid.UUID]
  - is_super_admin(session, user_id):同读 ppm-scope 缓存的 is_super_admin 字段;miss 查库回填
  - task_scope_clause / problem_scope_clause:基于上述缓存值构建 where 表达式,本身不缓存(N1 非目标)
acceptance:
  - manager_project_ids/is_super_admin 查 ppm-scope 缓存,miss 查库+回填
  - task/problem_scope_clause 用缓存值构建,返回的 where 表达式行为不变
  - 经理(部门/项目/开发/业务)经 problem_operable 的编辑/删除权限在缓存启用后仍正确(AC-05)
verify:
  - cd backend && uv run pytest tests/modules/ppm/ app/modules/ppm/ -q -k "scope or manager or super_admin or problem_operable"
  - cd backend && uv run mypy app/modules/ppm/common/data_scope.py
  - cd backend && uv run ruff check app/modules/ppm/common/data_scope.py
constraints:
  - D-005@v1:get_cached_ppm_scope 已保证 manager_project_ids 为 set[uuid.UUID],此处直接用,不再转换
  - 缓存值仅 manager_project_ids/is_super_admin 两底层值;scope_clause 表达式不缓存
---

流程位置:Wave 2(缓存读接入,依赖 task-01)。与 task-03(rbac 读接入)、task-05~09(失效触发)同 Wave 可并行。
