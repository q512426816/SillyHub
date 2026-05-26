"""workspaces: drop hard unique constraints in favour of partial unique indexes

Soft-deleted rows must not block re-registering the same ``root_path`` /
``slug``. Switching to partial unique indexes (``WHERE deleted_at IS NULL``)
keeps active rows unique while letting service-layer code resurrect deleted
records.

Revision ID: 202605261000
Revises: 202605260900
Create Date: 2026-05-26 10:00:00.000000
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "202605261000"
down_revision: str | None = "202605260900"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("uq_workspaces_root_path", "workspaces", type_="unique")
    op.drop_constraint("uq_workspaces_slug", "workspaces", type_="unique")

    op.create_index(
        "ux_workspaces_root_path_active",
        "workspaces",
        ["root_path"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "ux_workspaces_slug_active",
        "workspaces",
        ["slug"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("ux_workspaces_slug_active", table_name="workspaces")
    op.drop_index("ux_workspaces_root_path_active", table_name="workspaces")
    op.create_unique_constraint("uq_workspaces_root_path", "workspaces", ["root_path"])
    op.create_unique_constraint("uq_workspaces_slug", "workspaces", ["slug"])
