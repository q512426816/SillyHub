"""user_skill_enables: add workspace_id column + dual partial unique indexes

Change 2026-09-11-workspace-asset-bridges task-01（design §数据模型 / D-003
单表双 scope——字段唯一权威）：

1. ``workspace_id`` UUID NULL FK ``workspaces.id`` ON DELETE CASCADE——NULL =
   user 个人绑定（旧行为，存量行即 NULL），非 NULL = workspace 维度绑定
   （该行 ``user_id`` 仅作操作者审计，唯一性由 workspace partial 承担）。
2. DROP 表级 ``UNIQUE(user_id, skill_key)``（``uq_user_skill_enables_user_skill_key``），
   换成双 partial unique index：
   - ``ux_user_skill_enables_user_scope`` (user_id, skill_key)
     ``WHERE workspace_id IS NULL``——user 维度唯一性与旧约束逐字等价
     （存量行全为 NULL，建索引即原约束内容）；
   - ``ux_user_skill_enables_workspace_scope`` (workspace_id, skill_key)
     ``WHERE workspace_id IS NOT NULL``——每 workspace 每技能一条。
   双方言 ``postgresql_where`` + ``sqlite_where`` 声明（workspaces 202605261000
   partial unique 先例 + model.py 同口径；SQLite 的 partial index 原生支持
   WHERE 谓词，测试内存库与生产 PG 同语义）。

downgrade 对称回落：先删两 partial index，再清 workspace 维度行（旧 schema
容不下 ws 行——本项目未上线允许重置，CLAUDE.md 规则 11），删列（PG 随列
级联清 FK），最后还原表级 UNIQUE。

Revision ID: 20260911220000
Revises: 5e295549e20f
Create Date: 2026-09-11 22:00:00

author: qinyi
created_at: 2026-09-11 22:00:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260911220000"
down_revision: str | None = "5e295549e20f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "user_skill_enables",
        sa.Column(
            "workspace_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.drop_constraint("uq_user_skill_enables_user_skill_key", "user_skill_enables", type_="unique")
    # user 维度 partial：WHERE workspace_id IS NULL——语义与原表级 UNIQUE 等价。
    op.create_index(
        "ux_user_skill_enables_user_scope",
        "user_skill_enables",
        ["user_id", "skill_key"],
        unique=True,
        postgresql_where=sa.text("workspace_id IS NULL"),
        sqlite_where=sa.text("workspace_id IS NULL"),
    )
    # workspace 维度 partial：WHERE workspace_id IS NOT NULL（user_id 仅审计不入键）。
    op.create_index(
        "ux_user_skill_enables_workspace_scope",
        "user_skill_enables",
        ["workspace_id", "skill_key"],
        unique=True,
        postgresql_where=sa.text("workspace_id IS NOT NULL"),
        sqlite_where=sa.text("workspace_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ux_user_skill_enables_workspace_scope", table_name="user_skill_enables")
    op.drop_index("ux_user_skill_enables_user_scope", table_name="user_skill_enables")
    # workspace 维度行在旧 schema（纯 user 维度 UNIQUE）下无处安放——先清再还原。
    op.execute("DELETE FROM user_skill_enables WHERE workspace_id IS NOT NULL")
    op.drop_column("user_skill_enables", "workspace_id")
    op.create_unique_constraint(
        "uq_user_skill_enables_user_skill_key", "user_skill_enables", ["user_id", "skill_key"]
    )
