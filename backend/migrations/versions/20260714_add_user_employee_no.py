"""Add employee_no column to users table (PPM personal workbench FR-02, D-002@v1).

Revision ID: 20260714_user_emp_no
Revises: 20260713_fix_session_zombie
Create Date: 2026-07-14

变更 2026-07-13-ppm-personal-workbench-prototype / task-01。

users 表新增 ``employee_no`` 列，使 MeResponse 能返回当前登录人工号。
nullable，不加唯一约束 / 索引（D-002@v1：避免历史脏数据触发唯一冲突）。
本任务不回填工号值；login / bootstrap / create_user 逻辑不动。

注：revision id ≤32 字符（alembic_version.version_num varchar(32)）。

author: qinyi
created_at: 2026-07-14
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260714_user_emp_no"
down_revision = "20260713_fix_session_zombie"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("employee_no", sa.String(50), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "employee_no")
