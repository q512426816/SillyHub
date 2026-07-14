"""Add plan_type column to ppm_plan_node_module (milestone-module-import task-01, D-003@v1).

Revision ID: 20260714_pnm_plan_type
Revises: 20260714_user_emp_no
Create Date: 2026-07-14

变更 2026-07-14-milestone-module-import / task-01。

``ppm_plan_node_module`` 表新增 ``plan_type`` 列（VARCHAR(32)，nullable），
为导入功能区分「正常计划」与「临时计划」提供存储基础（design.md §8）。

不加 NOT NULL / 不加 DB 枚举约束 —— 取值由业务层（importer / service）校验，
旧数据留 NULL，前端对 NULL 显示「—」（design.md §9 兼容策略）。

注：revision id ≤32 字符（alembic_version.version_num varchar(32)）；
``pnm`` = plan_node_module 缩写。

author: WhaleFall
created_at: 2026-07-14
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260714_pnm_plan_type"
down_revision = "20260714_user_emp_no"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ppm_plan_node_module",
        sa.Column("plan_type", sa.String(32), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("ppm_plan_node_module", "plan_type")
