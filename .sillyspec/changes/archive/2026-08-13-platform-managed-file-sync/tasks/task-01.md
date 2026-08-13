---
id: task-01
title: '`spec_file_manifest` 表模型（`spec_workspace/model.py`，不复用 scan_documents）+ alembic migration（ux(workspace_id,path)+index(version)）'
title_zh: 独立增量清单表 spec_file_manifest（模型+migration）
author: qinyi
created_at: 2026-08-13 15:23:34
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-003@v1, D-004@v1, D-011@v1]
goal: >
  建独立 spec_file_manifest 表（D-011 不复用 scan_documents，scan_docs reparse 不碰），作增量同步唯一权威清单
implementation:
  - spec_workspace/model.py 新增 SpecFileManifest(BaseModel, table=True)
  - 字段：id(uid pk) / workspace_id(FK workspaces CASCADE) / path(相对 spec_root) / content_hash(SHA-256 hex) / version(int 默认1) / exists(bool 默认True) / updated_at(UTC)
  - __table_args__ 加 ux_spec_manifest_ws_path(workspace_id,path) 唯一 + ix_spec_manifest_version(version)
  - alembic 新建 revision（down_revision=execute 时实际 head，不写死旧 head，头部注释参照 20260811150000）；不写 scan_docs 模块文件
acceptance:
  - spec_file_manifest 表存在（alembic upgrade head 后可查询）
  - 模型字段齐全（workspace_id/path/content_hash/version/exists/updated_at）
  - ux(workspace_id,path) 唯一索引生效（同 ws 同 path 重复插入 IntegrityError）
  - scan_docs 模块零改动
verify:
  - cd backend && uv run alembic upgrade head && uv run ruff check app/modules/spec_workspace/model.py
constraints:
  - 表名 spec_file_manifest 不复用 scan_documents（D-011/BL-1）
  - migration down_revision 用 execute 实际 head，不写死旧 head
  - 不引入 scan_docs 依赖
allowed_paths:
  - backend/app/modules/spec_workspace/model.py
  - backend/migrations/versions/*.py
provides:
  - contract: spec_file_manifest_model
    fields: [workspace_id, path, content_hash, version, exists, updated_at]
  - contract: spec_file_manifest_migration
    fields: [table spec_file_manifest]
expects_from: []
---
