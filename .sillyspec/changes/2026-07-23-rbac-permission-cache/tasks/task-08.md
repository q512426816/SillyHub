---
id: task-08
title: workspace/service _ensure_creator_as_owner 失效 hook（FR-04, D-006@v1）
title_zh: workspace/service _ensure_creator_as_owner 所有调用方失效 hook
author: qinyi
created_at: 2026-07-23 09:42:00
priority: P4
depends_on: [task-01]
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-006@v1, D-002@v2]
allowed_paths:
  - backend/app/modules/workspace/service.py
goal: >
  覆盖 `_ensure_creator_as_owner`(L729,L770 写 UserWorkspaceRole 授创建者 owner)的**所有调用方**——
  `create`(L148/165/222)与 `scan_generate`(L609,L669 调用,daemon-client 建工作区独立路径,不经 create)——
  commit 后调 invalidate_all_permissions。plan-review 发现 scan_generate 遗漏(Design Grill X2 未穷尽调用方),本 task 闭合。
implementation:
  - `_ensure_creator_as_owner`(L729)内 `await self._session.commit()`(或其调用方 commit)之后调 `await invalidate_all_permissions()`;或在 create(L121)/scan_generate(L609)各自 commit 后调用——取使两路径都覆盖的注入点(_ensure_creator_as_owner 内最简,因其是两路径共用写 UserWorkspaceRole 的唯一出口)
  - 从 core.permission_cache 导入 invalidate_all_permissions
  - 验证:_ensure_creator_as_owner 全部调用方 = create 内 L148/165/222 + scan_generate 内 L669(grep 实证 4 处),注入点覆盖全部
acceptance:
  - create 与 scan_generate 任一路径写 UserWorkspaceRole 并 commit 后,perm:* + ppm-scope:* 全部清空(scan_generate 路径必须有测试覆盖)
  - invalidate 失败时记 ERROR 且不阻断业务
verify:
  - cd backend && uv run pytest app/modules/workspace/tests/ -q -k "create or scan_generate or owner"
  - cd backend && uv run mypy app/modules/workspace/service.py
  - cd backend && uv run ruff check app/modules/workspace/service.py
constraints:
  - D-006@v1:必须覆盖 _ensure_creator_as_owner 的全部调用方(create + scan_generate),不能只覆盖 create
  - D-002@v2:commit 后调失效;失败升 ERROR 不阻断
  - auth/service.py 启动种子(seed_workspace_owner_roles/seed_platform_admin_role)免失效——进程冷启无缓存,本 task 不涉及
---

流程位置:Wave 2(失效触发,依赖 task-01)。与 task-03~07/09 同 Wave 可并行。本 task 是 plan-review 抓出的阻断项(scan_generate)的最终落地,task-10 含其安全测试。
