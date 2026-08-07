---
id: task-01
title: schema migration mcp_tokens + mcp_webhooks tables and agent_runs.read_only column with ORM
title_zh: schema 迁移 建 mcp_tokens 与 mcp_webhooks 两表 加 agent_runs.read_only 列 并落 ORM
author: qinyi
created_at: 2026-08-06 13:52:28
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02, FR-06, FR-07]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/mcp_gateway/model.py
  - backend/app/modules/agent/model.py
  - backend/migrations/versions/2026xxxxxxxx_add_mcp_tokens_webhooks_run_readonly.py
provides:
  McpTokenORM:
    fields: [id, workspace_id, name, token_hash, scope, created_by, created_at, last_used_at, revoked_at]
  McpWebhookORM:
    fields: [id, token_id, workspace_id, url, secret, events, active, created_at]
goal: >
  落对外 MCP 的数据地基 一次性建 mcp_tokens 与 mcp_webhooks 两张表 加 agent_runs.read_only
  一列 并写对应 ORM 让下游 token service 与 middleware 与 webhook 投递器直接 import 本任务
  只动 schema 不写任何业务行为
implementation:
  - 新建 backend/app/modules/mcp_gateway/model.py 定义 McpTokenORM 与 McpWebhookORM 字段对齐 design §8.1 与 §8.2 用 sqlmodel Field(sa_column) 风格对齐 agent/model.py（UUID 主键 ForeignKey ondelete CASCADE 或 SET NULL DateTime(timezone=True) JSON 列 created_at 带 server_default text(now())）若 mcp_gateway 包尚无 __init__.py 顺手建空文件做包标记
  - backend/app/modules/agent/model.py 的 AgentRun 类加 read_only 列 bool nullable default None 风格对齐 gate_status 与 is_resume 等 nullable 兼容列（model.py:269 与 281）
  - 新建 alembic 迁移 backend/migrations/versions/2026xxxxxxxx_add_mcp_tokens_webhooks_run_readonly.py 把文件名与 revision 的 xxxxxxxx 占位换成落地时间戳 down_revision 执行前 cd backend 跑 uv run alembic heads 确认当前 head 多 head 则先按 478e8976 惯例 merge 或取 merge 后 head
  - 迁移 upgrade 用 op.create_table 建 mcp_tokens 与 mcp_webhooks 再 op.add_column 给 agent_runs 加 read_only 建 token_hash 唯一索引 与 workspace_id 及 token_id 普通索引 downgrade 反向 drop 完全对称
acceptance:
  - mcp_gateway/model.py 定义 McpTokenORM 与 McpWebhookORM 字段齐全与 design §8.1 §8.2 一致 下游可 from app.modules.mcp_gateway.model import McpTokenORM McpWebhookORM
  - AgentRun.read_only 列就位 nullable bool 兼容老行 NULL
  - alembic upgrade head 与 downgrade -1 均无报错 且完全对称可逆
  - mcp_tokens.token_hash 唯一索引 与 workspace_id 普通索引就位
  - ruff format 与 ruff check 通过
verify:
  - cd backend && uv run alembic upgrade head
  - cd backend && uv run alembic downgrade -1 && uv run alembic upgrade head
  - cd backend && uv run ruff format --check app/modules/mcp_gateway app/modules/agent/model.py migrations/versions && uv run ruff check app/modules/mcp_gateway migrations/versions
  - cd backend && uv run pytest app/modules/mcp_gateway -q --no-cov
constraints:
  - agent_runs.read_only 必须 nullable bool（default None）让老 run 行 NULL 零回归（design §9 brownfield / FR-06）
  - 本项目未上线 无需历史数据回填（CLAUDE.md 规则 11）迁移只加结构不写数据
  - mcp_tokens.token_hash 建唯一索引 同时 workspace_id 建普通索引（design §8.1 索引要求）
  - ORM 用 sqlmodel Field 加 sa_column 风格对齐 agent/model.py 不用裸 sqlalchemy declarative
  - 迁移 dialect 无关 create_table 与 add_column 让 SQLite 测试与 PostgreSQL 生产对齐（precedent 7c77e09b84e1）secret 列只定 String 类型 加密归 task-11 service 层本任务不做
  - down_revision 执行前 alembic heads 确认 多 head 先 merge（478e8976 多 head 合并惯例）
---
