"""file add description column

Revision ID: 20260823100000
Revises: 20260822090000
Create Date: 2026-08-23 10:00:00

Change 2026-08-23-agent-file-upload-mcp task-01（design §8 / D-006@v2，FR-06）：
file 表加 description 列（String(255)、nullable、无默认回填）——agent 上传
制品的描述持久化位置，支撑 sillyhub-file list 工具与前端文件卡片展示。

存量行处理：不做数据回填（design §9 兼容策略；项目未上线，nullable 列对
存量行为 NULL，旧代码不读该列不受影响）。

downgrade：对称 drop 列。
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260823100000"
down_revision: str | None = "20260822090000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 纯加列：nullable、无回填，旧行 NULL
    op.add_column(
        "file",
        sa.Column("description", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    # 与 upgrade 对称
    op.drop_column("file", "description")
