"""add kind column to daemon_change_writes

Revision ID: 202607021100
Revises: 202607011300
Create Date: 2026-07-02 11:00:00

Change 2026-07-02-change-detail-file-tree-editor (D-001@v1): 变更详情文件树手动编辑
经 DaemonChangeWrite outbox 队列写回本机。新增 ``kind`` 列区分任务类型：
- ``create`` (默认): proxy_create_change 创建新变更（MASTER/proposal/request），现有行为不变。
- ``edit``: 变更详情文件树手动编辑现有文件。

daemon 侧 runChangeWrite 通用写 files（不区分 kind），kind 仅 backend 用于
``GET /changes/{cid}/files/pending`` 过滤避免误纳 create 行。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202607021100"
down_revision = "202607011300"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "daemon_change_writes",
        sa.Column(
            "kind",
            sa.String(length=20),
            nullable=False,
            server_default="create",
        ),
    )


def downgrade() -> None:
    op.drop_column("daemon_change_writes", "kind")
