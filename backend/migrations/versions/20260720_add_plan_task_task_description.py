"""ppm_plan_task +task_description (同步明细 task_description 到任务计划).

Revision ID: 20260720_plan_task_desc
Revises: 20260718_project_org_id
Create Date: 2026-07-20

里程碑明细变 done 建任务 / 编辑明细同步任务时,明细的 task_description
需一并带到任务计划并展示 (ql-20260720-007)。

- ``ppm_plan_task`` ADD ``task_description`` TEXT (nullable) —— 对齐明细
  ``PsPlanNodeDetail.task_description`` 的 Text 类型,存长文本任务描述。
- 纯加列,nullable,不破坏既有数据。

author: WhaleFall
created_at: 2026-07-20 11:45:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260720_plan_task_desc"
down_revision = "20260718_project_org_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ppm_plan_task",
        sa.Column("task_description", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("ppm_plan_task", "task_description")
