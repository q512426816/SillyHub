"""create llm_providers table

Revision ID: 202607251100
Revises: 202607251000
Create Date: 2026-07-25 11:00:00

存储用户级 LLM 供应商凭证（design §7）。encrypted_api_key + key_id 复用
core/crypto.py 的 CredentialCipher（xchacha20-poly1305，D-009，照 git_identity）。
is_default 在 (user_id, agent_kind) 维度互斥（service 层事务内保证，R-05）。
"""

import sqlalchemy as sa
from alembic import op

revision = "202607251100"
down_revision = "202607251000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "llm_providers",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("agent_kind", sa.String(32), nullable=False),
        sa.Column("base_url", sa.String(512), nullable=True),
        sa.Column("encrypted_api_key", sa.LargeBinary, nullable=False),
        sa.Column("key_id", sa.String(64), nullable=False),
        sa.Column("model", sa.String(128), nullable=True),
        sa.Column("notes", sa.String(512), nullable=True),
        sa.Column("website_url", sa.String(512), nullable=True),
        sa.Column(
            "auth_field",
            sa.String(64),
            nullable=False,
            server_default="ANTHROPIC_AUTH_TOKEN",
        ),
        sa.Column("model_role_mappings", sa.JSON, nullable=True),
        sa.Column("default_fallback_model", sa.String(128), nullable=True),
        sa.Column("extra_env", sa.JSON, nullable=True),
        sa.Column(
            "is_default",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime,
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime,
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    op.create_index("ix_llm_providers_user", "llm_providers", ["user_id"])
    op.create_index(
        "ix_llm_providers_user_agent_default",
        "llm_providers",
        ["user_id", "agent_kind", "is_default"],
    )


def downgrade() -> None:
    op.drop_index("ix_llm_providers_user_agent_default", table_name="llm_providers")
    op.drop_index("ix_llm_providers_user", table_name="llm_providers")
    op.drop_table("llm_providers")
