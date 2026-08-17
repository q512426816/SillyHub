"""merge quicklog_entries and agent_runs_user_id heads

Revision ID: 20260817100000
Revises: 20260817010000, 20260817090000
Create Date: 2026-08-17 10:10:00

多 agent 并行：远端 20260817010000（quicklog entries，父 20260816120000）与本
变更 20260817090000（agent_runs.user_id，父 d7a1f5c2b9e4）分叉出双 head，
合并为单 head。两分支 DDL 互不相交，merge 节点无操作。
"""

from __future__ import annotations

from typing import Sequence

revision: str = "20260817100000"
down_revision: str | None = ("20260817010000", "20260817090000")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
