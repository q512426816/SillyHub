"""create user_workspace_orders table

每人一套（user-scoped）的工作区拖拽顺序存储（change
``2026-09-14-workspace-drag-sort`` task-01，D-001@v1/D-011@v1 方案 A 数据层
落地第一步）。表结构照 design「数据模型」DDL，与
``app/modules/workspace/model.py`` 的 ``UserWorkspaceOrder`` 一一对应：

- ``id`` UUID PK / ``user_id`` FK users.id / ``workspace_id`` FK workspaces.id
  （FK 不带 ondelete：软删 workspace 的排序行保留，复活回原位，不做级联清理）
- ``sort_position`` DOUBLE PRECISION NOT NULL（浮点中点键，``sa.Float`` 跨
  PG/SQLite 双方言）
- ``created_at``/``updated_at`` TIMESTAMPTZ NOT NULL（应用层 default_factory
  赋值，无 server_default）
- ``ux_uwo_user_workspace`` 唯一索引 (user_id, workspace_id)：一人一工作区
  至多一行（move upsert 依据）
- ``ix_uwo_user_position`` 普通索引 (user_id, sort_position)：列表 LEFT JOIN
  排序热路径

零存量数据回填——排序行惰性物化归 task-03 move 服务首拖 backfill（D-006@v2），
本迁移纯 DDL、无数据变更。

Revision ID: 20260914100000
Revises: c97f3be457e6
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260914100000"
down_revision = "c97f3be457e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_workspace_orders",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column(
            "workspace_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("workspaces.id"),
            nullable=False,
        ),
        sa.Column("sort_position", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ux_uwo_user_workspace",
        "user_workspace_orders",
        ["user_id", "workspace_id"],
        unique=True,
    )
    op.create_index(
        "ix_uwo_user_position",
        "user_workspace_orders",
        ["user_id", "sort_position"],
    )


def downgrade() -> None:
    op.drop_index("ix_uwo_user_position", table_name="user_workspace_orders")
    op.drop_index("ux_uwo_user_workspace", table_name="user_workspace_orders")
    op.drop_table("user_workspace_orders")
