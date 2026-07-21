"""ps project plan add created_by

Revision ID: 20260721_ps_plan_add_created_by
Revises: 20260720_problem_add_created_by
Create Date: 2026-07-21 12:00:00.000000

为 ``ppm_ps_project_plan`` 新增 ``created_by`` 列(UUID, nullable),作为项目计划
创建人可见性判断依据(数据范围 OR 创建人)。历史数据置 NULL —— 这些计划仍按原
``project_manager_id`` 过滤;新建计划起由 service 写入当前登录用户 id。

列类型用 ``sa.Uuid()``(PG 原生 uuid;SQLite 测试走 create_all 不经本迁移)。
两端通用的 ``add_column`` + ``drop_column``,无方言差异。

变更来源:/ppm/project-plans 项目计划创建人可见性修复(对齐 projects/problem)。
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260721_ps_plan_add_created_by"
down_revision: str | None = "20260720_problem_add_created_by"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """新增 created_by 列(Nullable)。"""
    op.add_column(
        "ppm_ps_project_plan",
        sa.Column("created_by", sa.Uuid(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("ppm_ps_project_plan", "created_by")
