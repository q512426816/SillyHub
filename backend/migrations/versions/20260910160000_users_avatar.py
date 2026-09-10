"""users.avatar：平台用户头像列（2026-09-10-account-avatar-upload / D-001@v1）

Revision ID: 20260910160000
Revises: 20260910120000
Create Date: 2026-09-10 16:00:00

soft-add 一列（design §数据模型，全可空、旧行 NULL=未设置）：

- ``users.avatar`` VARCHAR(512) NULL——头像 URL：文件中心 ``/api/file/{id}``
  或 http(s) 外链。本列永不存空串（清除由端点置 NULL），无索引、无默认值、
  不回填；NULL=未设置（前端回退首字）。

downgrade 对称 drop 该列。
"""

import sqlalchemy as sa
from alembic import op

revision = "20260910160000"
down_revision = "20260910120000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("avatar", sa.String(length=512), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "avatar")
