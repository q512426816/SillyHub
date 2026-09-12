"""merge workspace_scope and agent_log_attribution dual heads

Revision ID: 1d763051eb15
Revises: 20260911220000, 20260912050000
Create Date: 2026-09-12 07:11:53.701467
"""

from __future__ import annotations

from typing import Sequence

revision: str = "1d763051eb15"
down_revision: str | None = ("20260911220000", "20260912050000")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
