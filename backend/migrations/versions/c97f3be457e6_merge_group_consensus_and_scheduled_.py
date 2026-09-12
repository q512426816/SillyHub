"""merge group_consensus and scheduled_message_origin heads

Revision ID: c97f3be457e6
Revises: 20260910130000, 20260912110000
Create Date: 2026-09-12 22:58:25.476073
"""

from __future__ import annotations

from typing import Sequence

revision: str = "c97f3be457e6"
down_revision: str | None = ("20260910130000", "20260912110000")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
