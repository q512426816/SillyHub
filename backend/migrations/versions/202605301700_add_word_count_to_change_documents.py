"""Add word_count to change_documents.

Revision ID: 202605301700
Revises: 202606130900
Create Date: 2026-05-30 17:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "202605301700"
down_revision = "202606130900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("change_documents", sa.Column("word_count", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("change_documents", "word_count")
