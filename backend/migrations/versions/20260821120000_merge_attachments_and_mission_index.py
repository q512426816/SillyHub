"""merge session_attachments and agent_mission_project_id_index heads

rebase 合线后两线迁移同祖 20260819100000 分叉成多头（本地 20260820100000
session_attachments / 远端 20260821100000 mission project_id 索引），此 merge
迁移收口为单 head，解 backend 启动 alembic upgrade head 报 Multiple head
revisions 起不来。

Revision ID: 20260821120000
Revises: 20260820100000, 20260821100000
Create Date: 2026-08-21 12:00:00.000000
"""

from __future__ import annotations

from typing import Sequence

revision: str = "20260821120000"
down_revision: str | None = ("20260820100000", "20260821100000")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
