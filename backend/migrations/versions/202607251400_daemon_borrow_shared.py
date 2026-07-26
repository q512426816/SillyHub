"""workspace_member_runtimes add shared column + partial index

Revision ID: 202607251100
Revises: 202607251000
Create Date: 2026-07-25 11:00:00.000000

Change 2026-07-25-daemon-borrow-for-business task-01 / D-005@v1 / FR-01：
给 workspace_member_runtimes 加 shared 布尔列（默认 false）+ 部分索引
ix_wmr_shared（WHERE shared = true），让 lender（开发人员）能把自己的 daemon
标记为工作空间共享，业务/管理人员借用查询仅命中共享行。

零回归核心：server_default=false 保证既有 binding 行迁移后默认非共享，
现有「自带 daemon」派发路径行为完全不变（design §9）。

down_revision 接 202607251000（alembic heads 实测当前单 head，避免多 head
分叉，见 migration-chain-fragmentation-pattern 记忆）。
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "202607251100"
down_revision: str | None = "202607251000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "workspace_member_runtimes",
        sa.Column(
            "shared",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    # 部分索引：仅 shared=TRUE 时命中，加速 resolve_shared_daemon_for_borrow 借用查询。
    # postgresql_where 为 PG 方言 kw，SQLite Alembic 会忽略（建为普通索引）；
    # 兼容双 dialect（见 backend-test-sqlite-vs-pg / 202606241300 同款写法）。
    op.create_index(
        "ix_wmr_shared",
        "workspace_member_runtimes",
        ["shared"],
        postgresql_where=sa.text("shared = true"),
    )


def downgrade() -> None:
    op.drop_index("ix_wmr_shared", table_name="workspace_member_runtimes")
    op.drop_column("workspace_member_runtimes", "shared")
