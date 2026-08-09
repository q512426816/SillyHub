---
id: task-01
title: add api_format column + alembic migration backfill anthropic
title_zh: model 加 api_format 列 + Alembic 迁移老行回填 anthropic
author: qinyi
created_at: 2026-08-09 01:31:00
priority: P0
depends_on: []
blocks: [task-02]
allowed_paths:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/llm_provider/model.py
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/migrations/versions/202608091100_add_llm_provider_api_format.py
related_tests:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/llm_provider/tests/test_llm_provider.py
goal: >
  在 LlmProvider 模型加 api_format 列（String(32) NOT NULL server_default 'anthropic'）并写 Alembic 迁移加列 + 老行回填 'anthropic'，为后续 schema/service/前端提供持久的格式字段（FR-01, D-001@v1）。
implementation:
  - model.py：在 auth_field 列之后（或 model_role_mappings 之前）加 api_format 字段，照 design §8 逐字写：default="anthropic"、max_length=32、sa_column=Column(String(32), nullable=False, server_default="anthropic")；类型注解 api_format: str = Field(...)
  - 新建 backend/migrations/versions/202608091100_add_llm_provider_api_format.py：revision="202608091100"，down_revision="20260806140000"（当前 head，跑 `uv run alembic heads` 核对）
  - 迁移 upgrade：op.add_column("llm_providers", sa.Column("api_format", sa.String(32), nullable=False, server_default="anthropic"))——server_default 让老行自动回填 anthropic（design §8 / NFR-02 零回归）
  - 迁移 downgrade：op.drop_column("llm_providers", "api_format")
  - 索引不变（不动 ix_llm_providers_user / ix_llm_providers_user_agent_default）
  - 不新增 is_full_url 列（D-001@v1：完整 URL 走算法归一，由 task-02 实现）
acceptance:
  - model.py 出现 api_format 列定义，逐字匹配 design §8（String(32) / NOT NULL / server_default 'anthropic'）
  - `cd backend && uv run alembic upgrade head` 成功，llm_providers 表有 api_format 列且既有行值为 'anthropic'
  - `cd backend && uv run alembic downgrade -1` 再 `alembic upgrade head` 可逆跑通（迁移正反无残缺）
  - 列定义与迁移一一对齐（防漂移，照 model.py 顶部 docstring 既有约定）
verify:
  - cd backend && uv run alembic heads（迁移合入后 head 指向 202608091100）
  - cd backend && uv run alembic upgrade head && uv run alembic downgrade -1 && uv run alembic upgrade head
  - cd backend && uv run pytest app/modules/llm_provider -q --no-cov（CRUD 既有用例不回归）
constraints:
  - brownfield 零回归：仅加列 + 回填，不改既有列/索引；未配 openai 的链路逐字不变（NFR-02）
  - 不加 is_full_url 列（D-001@v1）；完整 URL 归一由 task-02 算法实现
  - 仅本任务范围改 model.py + 一个迁移文件，不动 schema/service/probe/router（task-02）
provides:
  - LlmProvider.api_format 列（str，default "anthropic"，值域 anthropic|openai_chat，DB 层 NOT NULL）
  - Alembic 迁移 202608091100_add_llm_provider_api_format（down_revision=20260806140000），老行回填 anthropic
expects_from: {}
---

# task-01 实现笔记

design 锚点：§6 文件清单第 1~2 行 / §8 数据模型 / §11 D-001@v1。

本任务是 Wave1 链路起点：task-02 的 schema Create/Update/Read 加 api_format 字段、service 透传 format 都依赖本任务的列先落地（否则 ORM 写入/查询缺列）；前端 gen:types 间接经 task-02 schema 才能看到字段。

迁移命名照 202607251100_create_llm_providers.py 风格（YYYYMMDDHHMM_snake_desc）。revision id 用 12 位（202608091100）即可，down_revision 必须指向当前 head 20260806140000——执行前实跑 `uv run alembic heads` 复核，若 head 已被其它合入变更推前，down_revision 跟随最新 head。
