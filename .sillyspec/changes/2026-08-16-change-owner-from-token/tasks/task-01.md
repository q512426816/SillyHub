---
id: task-01
title: ChangeEventORM 模型 + 建表 migration
title_zh: change_events 通用事件表 ORM 定义与 Alembic 建表迁移
author: qinyi
created_at: 2026-08-16 11:40:00
priority: P0
depends_on: []
blocks: [task-02]
requirement_ids: [FR-02]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/change/model.py
  - backend/migrations/versions/
provides:
  - contract: ChangeEventORM
    fields: [id, workspace_id, change_id, event_type, detail, created_by, created_at]
goal: >
  在 change/model.py 新增 ChangeEventORM 建 change_events 表（workspace 隔离 + 时间线复合索引，通用 event_type+detail 扩展模型），
  并在 backend/migrations/versions/ 落一条 dialect 无关建表 migration，为 owner_change 留痕提供存储底座（design §5 Phase 1.1 / §7 / D-002@v1）。
implementation:
  - ORM 对齐同文件现有范式（BaseModel + Field(sa_column=Column(...))，参照 ChangeSessionLink）—— id UUID PK default uuid4、workspace_id FK→workspaces.id CASCADE、change_id FK→changes.id CASCADE
  - 字段逐字对齐 §7 —— event_type 用 String(50) not null、detail 用 dict JSON 列、created_by 用 UUID nullable（无外键仅语义引用）、created_at 用 DateTime(timezone=True) not null
  - detail 落地用 sa.JSON 非 postgresql.JSONB（SQLite 测试兼容，先例 20260810150000 Grill X-009；语义即 §7 JSONB 透传 dict）
  - __table_args__ 两索引 —— ix_change_events_change_created(change_id, created_at) 供时间线合成查询 + ix_change_events_workspace(workspace_id)；不加任何唯一约束（幂等=owner_id 现值复查，task-02 口径）
  - migration 落 backend/migrations/versions/（alembic.ini script_location 实际目录），文件名日期前缀实际生成时定（拟 20260816xxxxxx_add_change_events.py），revision 用同款时间戳串
  - migration 范式照抄 20260814_add_change_session_links —— dialect 无关 op.create_table/create_index、created_at 带 server_default sa.func.now()、downgrade 对称 drop；down_revision 接 execute 时实测 alembic heads（写卡时快照 d7a1f5c2b9e4 合并头，多 agent 并行可能已移动，以实测为准）
acceptance:
  - 表结构与 design §7 逐字段一致，字段名逐字相同
  - alembic upgrade head 单 head 无撞号，upgrade/downgrade 均可跑
  - 两索引齐备且无唯一约束
  - 既有 change 模块测试全绿（model.py 已被模块 import，metadata 自动注册建表，无需动 conftest）
verify:
  - cd backend && ./.venv/Scripts/python.exe -m pytest app/modules/change/tests -q --no-cov
  - cd backend && ./.venv/Scripts/python.exe -m alembic heads（确认单 head 指向本 migration）以及 alembic upgrade head 预检可跑
  - cd backend && ./.venv/Scripts/python.exe -m ruff format --check app/modules/change/model.py 与新建 migration 文件
constraints: 不加唯一约束（幂等靠 owner_id 现值复查，Grill note①）；字段名与 §7 逐字一致；migration 文件名日期前缀实际生成时定；不动 service/schema/tests（属 task-02/03/04 领地）。
---
