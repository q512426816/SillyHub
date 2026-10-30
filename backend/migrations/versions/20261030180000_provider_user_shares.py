"""llm_provider_shares 按用户共享供应商

Revision ID: 20261030180000
Revises: 20261030160000
Create Date: 2026-10-30

2026-10-30-provider-user-share：供应商属主可按用户共享凭证使用权。表只存
(provider, grantee) 关系与审计字段，不复制密钥；provider/用户删除时级联清理。
唯一约束 (provider_id, grantee_user_id) 保证重复共享幂等（service 层捕获
IntegrityError 回查既有行）。迁移单测在 SQLite 上跑本体，类型与索引均用
PG/SQLite 共同支持的写法。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20261030180000"
down_revision = "20261030160000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "llm_provider_shares",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("provider_id", sa.Uuid(), nullable=False),
        sa.Column("grantee_user_id", sa.Uuid(), nullable=False),
        sa.Column("shared_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["provider_id"], ["llm_providers.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["grantee_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["shared_by_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "provider_id",
            "grantee_user_id",
            name="ux_llm_provider_shares_provider_grantee",
        ),
    )
    op.create_index(
        "ix_llm_provider_shares_provider",
        "llm_provider_shares",
        ["provider_id"],
    )
    op.create_index(
        "ix_llm_provider_shares_grantee",
        "llm_provider_shares",
        ["grantee_user_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_llm_provider_shares_grantee", table_name="llm_provider_shares")
    op.drop_index("ix_llm_provider_shares_provider", table_name="llm_provider_shares")
    op.drop_table("llm_provider_shares")
