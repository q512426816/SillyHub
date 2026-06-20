"""merge ppm W1 heads (task / plan / project)

Revision ID: 202607041200
Revises: 202607041100, 202607042000, 202607200900
Create Date: 2026-07-04 12:00:00.000000

三个 ppm W1 子域建表迁移均从 ``202607041000`` (seed ppm perms) 分叉:
- ``202607041100`` task (task-06)
- ``202607042000`` plan (task-05)
- ``202607200900`` project (task-03)

本 merge 仅收口多 head,不产生 DDL。
"""

from __future__ import annotations

from typing import Sequence

revision: str = "202607041200"
down_revision: str | Sequence[str] | None = (
    "202607041100",
    "202607042000",
    "202607200900",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
