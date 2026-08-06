"""merge lease_terminating_at and daemon_started_at heads

Revision ID: d5d239112387
Revises: 20260805110000, 20260805_lease_terminating_at
Create Date: 2026-08-06 09:21:31.540762
"""

from __future__ import annotations

from typing import Sequence

revision: str = "d5d239112387"
down_revision: str | None = ("20260805110000", "20260805_lease_terminating_at")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
