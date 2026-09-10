"""merge mcp_registry and users_avatar dual heads

Revision ID: b299f3782f7a
Revises: 20260910140000, 20260910160000
Create Date: 2026-09-10 21:22:40.422181
"""

from __future__ import annotations

from typing import Sequence

revision: str = "b299f3782f7a"
down_revision: str | None = ("20260910140000", "20260910160000")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
