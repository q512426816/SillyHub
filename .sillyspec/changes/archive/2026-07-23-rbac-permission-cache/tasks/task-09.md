---
id: task-09
title: ppm/project/service.ProjectMemberService 失效 hook（FR-04, D-002@v2）
title_zh: ppm/project/service.ProjectMemberService 项目成员 CRUD 失效 hook
author: qinyi
created_at: 2026-07-23 09:42:00
priority: P4
depends_on: [task-01]
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-002@v2]
allowed_paths:
  - backend/app/modules/ppm/project/service.py
goal: >
  在 ProjectMemberService 的 create / update / delete commit 后调用 invalidate_all_permissions,
  保证 PpmProjectMember 变更后 PPM 数据范围缓存(ppm-scope:*)立即清空(经理 project_ids 变化)。
implementation:
  - ProjectMemberService.create(L520,PpmProjectMember 写点@527)、update(L552)、delete(L569):每个 commit 后调 `await invalidate_all_permissions()`
  - 从 core.permission_cache 导入 invalidate_all_permissions
acceptance:
  - create/update/delete 任一 commit 后,perm:* + ppm-scope:* 全部清空
  - invalidate 失败时记 ERROR 且不阻断业务
verify:
  - cd backend && uv run pytest tests/modules/ppm/ app/modules/ppm/ -q -k "project_member or member"
  - cd backend && uv run mypy app/modules/ppm/project/service.py
  - cd backend && uv run ruff check app/modules/ppm/project/service.py
constraints:
  - D-002@v2:commit 后调失效
  - PpmProjectMember 生产写点仅 L527(grep 实证),三个方法全覆盖
---

流程位置:Wave 2(失效触发,依赖 task-01)。与 task-03~08 同 Wave 可并行。本 task 是 PPM 数据范围缓存(ppm-scope:*)失效的关键触发点。
