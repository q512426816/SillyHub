"""workspace_member_runtimes add shared column + partial index

Revision ID: 202607251400
Revises: 202607251100
Create Date: 2026-07-25 11:00:00.000000

Change 2026-07-25-daemon-borrow-for-business task-01 / D-005@v1 / FR-01：
给 workspace_member_runtimes 加 shared 布尔列（默认 false）+ 部分索引
ix_wmr_shared（WHERE shared = true），让 lender（开发人员）能把自己的 daemon
标记为工作空间共享，业务/管理人员借用查询仅命中共享行。

零回归核心：server_default=false 保证既有 binding 行迁移后默认非共享，
现有「自带 daemon」派发路径行为完全不变（design §9）。

down_revision 接 202607251100（llm-provider-management 变更的
create_llm_providers 迁移，alembic heads 实测单 head 接续）。

renumber 说明（ql-20260726-001-ac8a）：原 revision 202607251100 与 llm-provider
变更撞 id 致 alembic 双 head（详见 daemon-borrow verify-result.md P0）。
llm-provider 先提交（5f8fbeb9）保留 1100，本变更 renumber 到 1400 接续 1100。
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "202607251400"
down_revision: str | None = "202607251100"
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
