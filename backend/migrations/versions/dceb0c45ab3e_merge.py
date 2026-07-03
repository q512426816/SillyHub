"""merge

Revision ID: dceb0c45ab3e
Revises: p0la1ud1t006, 202607022300
Create Date: 2026-07-03 07:57:27.604833
"""

from __future__ import annotations

from typing import Sequence

revision: str = "dceb0c45ab3e"
down_revision: str | None = ("p0la1ud1t006", "202607022300")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
