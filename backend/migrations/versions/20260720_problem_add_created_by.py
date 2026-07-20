"""problem list add created_by

Revision ID: 20260720_problem_add_created_by
Revises: 20260720_drop_ppm_op
Create Date: 2026-07-20 16:00:00.000000

为 ``ppm_problem_list`` 新增 ``created_by`` 列(UUID, nullable),作为编辑/删除
权限判断依据(创建人放行)。历史数据置 NULL —— 这些问题仅超管 / 本项目经理 /
责任人可操作;新建问题起由 service 写入当前登录用户 id。

列类型用 ``sa.Uuid()``(PG 原生 uuid;SQLite 测试走 create_all 不经本迁移)。
两端通用的 ``add_column`` + ``drop_column``,无方言差异。

变更来源:/ppm/problem-list 编辑/删除按钮权限改造(quick)。
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260720_problem_add_created_by"
down_revision: str | None = "20260720_drop_ppm_op"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """新增 created_by 列(Nullable)。"""
    op.add_column(
        "ppm_problem_list",
        sa.Column("created_by", sa.Uuid(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("ppm_problem_list", "created_by")
