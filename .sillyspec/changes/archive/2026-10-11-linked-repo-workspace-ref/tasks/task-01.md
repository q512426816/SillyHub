---
id: task-01
title: 'backend ref_workspace_id 迁移+模型+API+回显匹配（FR-01/02/03）'
title_zh: 'backend ref_workspace_id 迁移+模型+API+回显匹配（FR-01/02/03）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-11 16:58:00
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-02, FR-03]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - backend/app/modules/workspace/linked_repos/model.py
  - backend/migrations/versions/20261011020000_add_linked_repo_ref_workspace.py
  - backend/app/modules/workspace/linked_repos/schema.py
  - backend/app/modules/workspace/linked_repos/service.py
  - backend/app/modules/workspace/linked_repos/router.py
  - backend/app/modules/daemon/linked_repos_sync.py
  - backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py
target_files:
  - NEW:backend/migrations/versions/20261011020000_add_linked_repo_ref_workspace.py
provides:
  ref-workspace-api:
    fields: "Create/Update 加 ref_workspace_id?/str|null；Out 加 ref_workspace {id,name,slug}|null（读时过滤软删）；LocalSnapshotEntry 加 matched_workspace 同形态（仅 local_only 条目）"
    validation: "目标存在+非软删+不等于当前工作区 -> 422 REF_WORKSPACE_INVALID；null=摘除"
    match: "key 在当前用户可见工作区集（过滤软删）name/slug 精确匹配；多命中 name 优先 slug、仍多取 id 最小"

goal: >
  backend 迁移+模型+API——ref_workspace_id 可空 FK（DB 级 SET NULL 防御保留+读时降级过滤软删）+ 挂载/摘除/校验 + 回显 matched_workspace 匹配
implementation:
  - model.py 加 ref_workspace_id 列（UUID|None FK workspaces.id ondelete=SET NULL + 索引）
  - 迁移 20261011020000：add_column + FK + 索引
  - schema.py：Create/Update 加 ref_workspace_id；Out 加 ref_workspace 摘要；LocalSnapshotEntry 加 matched_workspace
  - service.py：create/update 支持挂载摘除（校验目标存在+非软删+非自身 -> AppError 422）；list_repos join 返回 ref 摘要（deleted_at IS NULL 过滤）
  - linked_repos_sync.py fetch_local_snapshot：local_only 条目按 key 在可见工作区集匹配附 matched_workspace
  - 测试：挂载/摘除/软删降级/匹配命中与 tie-break/422 三路径/权限
acceptance:
  - FR-01/02/03 GWT 全过；软删后摘要 null 行保留；matched 仅 local_only 且可见集限定
  - 老条目零影响（ref null）
verify:
  - cd backend && uv run pytest app/modules/workspace/linked_repos/tests -q --no-cov
constraints:
  - 不做自动写库匹配（只提示）；不级联删登记行；禁跑全量（CLAUDE.md 规则 0）
---
