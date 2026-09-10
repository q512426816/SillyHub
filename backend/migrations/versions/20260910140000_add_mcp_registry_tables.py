"""MCP 中央资产库三表：mcp_servers / mcp_server_bindings / mcp_templates

Revision ID: 20260910140000
Revises: 20260910120000
Create Date: 2026-09-10 14:00:00

Change 2026-09-10-mcp-central-registry task-01（FR-01/02 / D-001 / D-002 /
D-005，design「数据模型」节——字段唯一权威，逐字段对照）单文件迁移：

1. ``mcp_servers``——MCP server 定义实体：owner_user_id UUID NULL FK users ON
   DELETE CASCADE（NULL=平台共享，D-001）；server_type VARCHAR(10) 默认 stdio
   （'stdio'|'http'|'sse' 建模预留，写路径仅 stdio 属 task-02，D-005）；
   server_config JSON（env 仅非 secret 明文）+ encrypted_env JSON NULL（Grill
   CC-03 逐键密文信封 {ct, key_id}）；tags JSON / note TEXT / enabled BOOL /
   source VARCHAR(30) / dedup_key VARCHAR(200) NULL（'ws:<ws>:<name>' 去重锚）。
2. ``mcp_server_bindings``——启用绑定表（D-002）：server_id FK mcp_servers ON
   DELETE CASCADE；UNIQUE(server_id, scope_type, scope_ref) 拆两条 partial
   unique index（PG 原生能力，R-02 单一目标库）：``uq_binding_platform`` 按
   server_id WHERE scope_type='platform'、``uq_binding_user`` 按 (server_id,
   scope_ref) WHERE scope_type='user'。
3. ``mcp_templates``——收藏模板：明文 server_config（无 secret）+ is_preset +
   owner_user_id UUID NULL（NULL=平台预置 seed；design 未声明 FK，按字面裸列）。

唯一性函数索引 ``uq_mcp_servers_owner_name``：
``COALESCE(owner_user_id, '00000000-0000-0000-0000-000000000000') + name``
——PG NULL 不参与唯一约束，sentinel 化 owner 维度让平台位同名互斥。表达式
不写 ``::uuid`` 显式转换：SQLite 测试侧 create_all 不识别 PG cast，PG 对未知
类型字面量在 COALESCE 上下文隐式收敛为 uuid（双方言同语义；与 ORM 侧
model.py ``__table_args__`` 逐字一致防 autogenerate 漂移）。

新表 NOT NULL 非时间戳列不设 server_default（默认在 ORM Python 侧，建表与
模型声明逐列一致，20260829010000 / 20260902010000 先例）；created_at 走
``now()``（mcp_gateway 先例）。无数据回填（新表零存量）。

down_revision 接执行时唯一 head 20260910120000（alembic heads 实测单 head）。
downgrade 对称回落：先删 bindings（FK CASCADE 依赖方向）→ 删三索引 → 删三表。

author: qinyi
created_at: 2026-09-10 14:00:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260910140000"
down_revision: str | None = "20260910120000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_OWNER_SENTINEL_UUID = "00000000-0000-0000-0000-000000000000"
_PLATFORM_WHERE = "scope_type = 'platform'"
_USER_WHERE = "scope_type = 'user'"


def upgrade() -> None:
    # ── 1. mcp_servers（design 数据模型节，模型 app/modules/mcp_registry/model.py）──
    op.create_table(
        "mcp_servers",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "owner_user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("server_type", sa.String(length=10), nullable=False),
        sa.Column("server_config", sa.JSON(), nullable=False),
        sa.Column("encrypted_env", sa.JSON(), nullable=True),
        sa.Column("tags", sa.JSON(), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("source", sa.String(length=30), nullable=False),
        sa.Column("dedup_key", sa.String(length=200), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "uq_mcp_servers_owner_name",
        "mcp_servers",
        [
            sa.text(f"COALESCE(owner_user_id, '{_OWNER_SENTINEL_UUID}')"),
            sa.text("name"),
        ],
        unique=True,
    )

    # ── 2. mcp_server_bindings（D-002 独立绑定表）──
    op.create_table(
        "mcp_server_bindings",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "server_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("mcp_servers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("scope_type", sa.String(length=10), nullable=False),
        sa.Column("scope_ref", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "uq_binding_platform",
        "mcp_server_bindings",
        ["server_id"],
        unique=True,
        postgresql_where=sa.text(_PLATFORM_WHERE),
        sqlite_where=sa.text(_PLATFORM_WHERE),
    )
    op.create_index(
        "uq_binding_user",
        "mcp_server_bindings",
        ["server_id", "scope_ref"],
        unique=True,
        postgresql_where=sa.text(_USER_WHERE),
        sqlite_where=sa.text(_USER_WHERE),
    )

    # ── 3. mcp_templates（收藏模板，seed 落地 W3 task）──
    op.create_table(
        "mcp_templates",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("server_config", sa.JSON(), nullable=False),
        sa.Column("is_preset", sa.Boolean(), nullable=False),
        sa.Column("owner_user_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )


def downgrade() -> None:
    # 与 upgrade 对称反序：先 bindings（FK 依赖），再 servers（函数索引随表前先删亦可，
    # 显式 drop_index 保持三条唯一索引的对称回落可读性）。
    op.drop_index("uq_binding_user", table_name="mcp_server_bindings")
    op.drop_index("uq_binding_platform", table_name="mcp_server_bindings")
    op.drop_table("mcp_server_bindings")
    op.drop_index("uq_mcp_servers_owner_name", table_name="mcp_servers")
    op.drop_table("mcp_servers")
    op.drop_table("mcp_templates")
