---
id: task-05
title: platform_sync schema ConflictResponse ChangeListItem raw dict
title_zh: platform_sync schema 冲突响应与轻量列表项 裸六表 dict 透传
author: qinyi
created_at: 2026-08-10 23:45:00
priority: P0
depends_on: []
blocks: [task-06]
requirement_ids: [FR-05, FR-07]
decision_ids: [D-005@v1, D-007@v1]
allowed_paths:
  - backend/app/modules/platform_sync/schema.py
provides:
  ConflictResponse:
    fields: [conflict(bool), platform_progress(dict), last_pushed_at(str|None)]
  ChangeListItem:
    fields: [name(str), current_stage(str|None), last_pushed_at(str|None), last_pusher(str|None)]
goal: >
  定义 platform_sync 请求/响应 Pydantic v2 模型：裸六表用 dict[str,Any] 透传
  （不强类型化 NG-6），ConflictResponse（409 契约 §4.4），ChangeListItem（轻量列表）。
implementation:
  - 新建 backend/app/modules/platform_sync/schema.py
  - ConflictResponse(BaseModel)：conflict: bool = True；platform_progress: dict[str, Any]；last_pushed_at: str | None = None
  - ChangeListItem(BaseModel)：name: str；current_stage: str | None = None；last_pushed_at: str | None = None；last_pusher: str | None = None
  - POST 200 响应：定义 ProgressSyncOk(BaseModel)：ok: bool = True（客户端不读 body，任意 2xx 即可，契约 §4.3）
  - 不定义裸六表的强类型模型（NG-6：按 dict 透传，避免与客户端 serializeForSync 六表演进耦合）
acceptance:
  - ConflictResponse 字段对齐契约 §4.4（conflict/platform_progress/last_pushed_at）
  - ChangeListItem 字段对齐契约 §5（name/current_stage/last_pushed_at/last_pusher）
  - 裸六表用 dict[str, Any] 不强类型化
verify:
  - cd backend && uv run ruff format --check app/modules/platform_sync && uv run ruff check app/modules/platform_sync
  - cd backend && uv run mypy app/modules/platform_sync/schema.py
constraints:
  - 裸六表 dict[str, Any] 显式标注（mypy 友好，R-05）
  - 不强类型化 serializeForSync 六表（NG-6，避免客户端耦合）
  - Pydantic v2 BaseModel + Field 风格（CONVENTIONS）
---
