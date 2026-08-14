"""add documents + approval columns to platform_change_progress

Revision ID: 20260814220000
Revises: 20260814090000
Create Date: 2026-08-14 22:00:00

Change 2026-08-14-platform-sync-docs-approval task-01 / design §4.1 / D-002@v1 / D-003@v1：
``platform_change_progress`` 加两个 JSON nullable 列——

- ``documents``：四件套全文扁平 map（``{"proposal.md": "全文", ...}``，CLI syncDocuments
  写，POST /changes/{name}/documents 才动）。
- ``approval``：审批记录 ``{status, reason, decided_at, decided_by}``（平台写，
  POST /changes/{name}/approval 才动）。

两列独立于 ``latest_progress``（单写者纪律 D-003@v1）：upsert_progress 定向列 UPDATE
不触碰这两列，三个写入方互不覆盖。batch_alter_table 跨方言（SQLite 测试库 / PG 生产），
零回填（NULL 默认即「无」）。

down_revision 接 ``20260814090000``（change_session_links，execute 前实测 alembic 单 head）。

author: qinyi
created_at: 2026-08-14 22:00:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260814220000"
down_revision: str | None = "20260814090000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("platform_change_progress") as batch_op:
        batch_op.add_column(sa.Column("documents", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("approval", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("platform_change_progress") as batch_op:
        batch_op.drop_column("approval")
        batch_op.drop_column("documents")
