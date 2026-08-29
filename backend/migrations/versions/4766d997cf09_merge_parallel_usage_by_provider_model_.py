"""merge_parallel_usage_by_provider_model_and_control_commands

Revision ID: 4766d997cf09
Revises: 20260829010000, 20260829120000
Create Date: 2026-08-29 09:23:41.770796
"""

from __future__ import annotations

from typing import Sequence

revision: str = "4766d997cf09"
down_revision: str | None = ("20260829010000", "20260829120000")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
