"""spec_workspace last_writer/last_writer_at（2026-09-26-spec-consistency-writer）

Revision ID: 20260926083000
Revises: 20260923090000
Create Date: 2026-09-26

双写者漂移信号（daemon 与 CLI platform sync 双写是 manifest 基线漂移、
SpecPushConflict 一周僵局的根因）：每次 apply_sync/apply_ops 记录写入方身份
与时间；GET /spec-workspace 透传展示。

down_revision 原接 20260926063000（change-events-r18-full 的平行分支），
2026-09-26-migration-chain-dedupe 删该重复分支后改接主线 20260923090000
（repair_archive_tombstone_victims），链恢复单线。
"""

import sqlalchemy as sa
from alembic import op

revision = "20260926083000"
down_revision = "20260923090000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "spec_workspaces",
        sa.Column("last_writer", sa.String(length=128), nullable=True),
    )
    op.add_column(
        "spec_workspaces",
        sa.Column("last_writer_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("spec_workspaces", "last_writer_at")
    op.drop_column("spec_workspaces", "last_writer")
