"""add no (序号) to ppm_plan_node_module

给模块加「序号」字段,使里程碑明细三层(里程碑/模块/明细)都能按序号数值排序。
nullable,历史模块序号为 NULL(排序时排最后);新建模块由前端填入序号。

Revision ID: 202607231200
Revises: 202607222330
Create Date: 2026-07-23 12:00:00.000000
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "202607231200"
down_revision: str | None = "202607222330"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("ppm_plan_node_module", sa.Column("no", sa.String(32), nullable=True))


def downgrade() -> None:
    op.drop_column("ppm_plan_node_module", "no")
