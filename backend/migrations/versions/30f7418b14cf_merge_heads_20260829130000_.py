"""merge heads 20260829130000 + 20260829150000 (parallel change convergence)

Revision ID: 30f7418b14cf
Revises: 20260829130000, 20260829150000
Create Date: 2026-08-29 20:40:07.065158
"""

from __future__ import annotations

from typing import Sequence

revision: str = "30f7418b14cf"
down_revision: str | None = ("20260829130000", "20260829150000")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
