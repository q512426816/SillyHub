---
id: task-01
title: PlatformChangeProgressORM model and package init
title_zh: 新建 platform_sync 模块包初始化与 PlatformChangeProgressORM 数据模型
author: qinyi
created_at: 2026-08-10 23:45:00
priority: P0
depends_on: []
blocks: [task-02, task-04]
requirement_ids: [FR-03]
decision_ids: [D-003@v1]
allowed_paths:
  - backend/app/modules/platform_sync/__init__.py
  - backend/app/modules/platform_sync/model.py
provides:
  PlatformChangeProgressORM:
    fields: [change_name(PK String), latest_progress(JSON), last_pushed_at(String nullable), last_pusher(String nullable), updated_at(DateTime tz)]
goal: >
  落进度同步层数据地基——新建 platform_sync 模块包 + 定义 PlatformChangeProgressORM
  对齐 design §8.1 字段。本任务只动 schema（ORM），不写业务行为，不做迁移（task-02）。
implementation:
  - 新建 backend/app/modules/platform_sync/__init__.py（空文件做包标记）
  - 新建 backend/app/modules/platform_sync/model.py 定义 PlatformChangeProgressORM：用 sqlmodel Field + sa_column 风格对齐 agent/model.py；__tablename__='platform_change_progress'
  - 字段：change_name=String 主键（sa_column PrimaryKey）；latest_progress=JSON（用 sqlalchemy.JSON 非 JSONB，保 SQLite 测试兼容，design §8.1 + Grill X-009）；last_pushed_at=String(64) nullable；last_pusher=String(255) nullable；updated_at=DateTime(timezone=True) server_default text(now())
  - model.py 顶部 import 对齐现有模块（from __future__ import annotations; from datetime import datetime; from sqlalchemy import JSON, text; from sqlmodel import Field, SQLModel）
acceptance:
  - platform_sync/__init__.py 存在（空包标记）
  - PlatformChangeProgressORM 字段齐全与 design §8.1 一致，可 from app.modules.platform_sync.model import PlatformChangeProgressORM
  - latest_progress 用 sqlalchemy.JSON（非 JSONB）保 SQLite 兼容
  - change_name String 主键就位
verify:
  - cd backend && uv run ruff format --check app/modules/platform_sync && uv run ruff check app/modules/platform_sync
  - cd backend && uv run mypy app/modules/platform_sync/model.py
  - cd backend && uv run python -c "from app.modules.platform_sync.model import PlatformChangeProgressORM; print(PlatformChangeProgressORM.__tablename__)"
constraints:
  - JSON() 非 JSONB()（SQLite 测试兼容，Grill X-009）
  - last_pushed_at/last_pusher 用 String 非 DateTime（字典序比对前提，契约 §7 / D-004）
  - updated_at 用 DateTime(timezone=True)（服务端审计字段，非比对基准）
  - ORM 用 sqlmodel Field 风格对齐 agent/model.py，不用裸 sqlalchemy declarative
  - 本任务不做迁移（task-02），不写业务（task-04）
---
