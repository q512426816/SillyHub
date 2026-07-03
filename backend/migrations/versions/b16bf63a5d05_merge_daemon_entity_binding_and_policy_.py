"""merge daemon entity binding and policy audit heads

Revision ID: b16bf63a5d05
Revises: 202607031302, p0la1ud1t006
Create Date: 2026-07-03 23:59:54.311933
"""

from __future__ import annotations

from typing import Sequence

revision: str = "b16bf63a5d05"
down_revision: str | None = ("202607031302", "p0la1ud1t006")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
