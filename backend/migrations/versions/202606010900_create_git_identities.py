"""create git_identities table

Revision ID: 202606010900
Revises: 202605310900
"""

import sqlalchemy as sa
from alembic import op

revision = "202606010900"
down_revision = "202605310900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "git_identities",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("provider", sa.String(30), nullable=False),
        sa.Column("git_username", sa.String(200), nullable=True),
        sa.Column("git_email", sa.String(200), nullable=True),
        sa.Column("credential_type", sa.String(20), nullable=False),
        sa.Column("encrypted_credential", sa.LargeBinary, nullable=False),
        sa.Column("key_id", sa.String(50), nullable=False),
        sa.Column("allowed_repositories", sa.String, nullable=False, server_default="[]"),
        sa.Column("expires_at", sa.DateTime, nullable=True),
        sa.Column("revoked_at", sa.DateTime, nullable=True),
        sa.Column("last_used_at", sa.DateTime, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )

    op.create_index(
        "idx_git_identities_user",
        "git_identities",
        ["user_id", "revoked_at"],
    )

    op.execute(
        "ALTER TABLE git_identities ADD CONSTRAINT ck_git_id_credential_type "
        "CHECK (credential_type IN ('pat', 'oauth', 'ssh_key', 'app'))"
    )

    op.execute(
        "ALTER TABLE git_identities ADD CONSTRAINT ck_git_id_provider "
        "CHECK (provider IN ('github', 'gitlab', 'gitea', 'generic'))"
    )


def downgrade() -> None:
    op.drop_index("idx_git_identities_user", table_name="git_identities")
    op.drop_table("git_identities")
